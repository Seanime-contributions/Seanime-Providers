class Provider {
  constructor() {
    this.anilistUrl = "https://graphql.anilist.co";
    this.baseUrl = "https://megaplay.buzz/";
    this.decryptUrl = "https://enc-dec.app/api/dec-megaplay";
    this.userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["Sub", "Dub"],
      supportsDub: true,
    };
  }

  async search(opts) {
    const query = `
      query ($search: String) {
        Page(perPage: 25) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            idMal
            title { romaji english native }
          }
        }
      }
    `;
    const data = await this.anilistRequest(query, { search: opts.query });
    return (data?.data?.Page?.media || []).map(media => ({
      // Seanime passes this value back to findEpisodes, so keep it as the AniList ID.
      // findEpisodes requests idMal again and embeds it into each episode ID.
      id: String(media.id),
      title: media.title?.english || media.title?.romaji || media.title?.native || String(media.id),
      url: `https://anilist.co/anime/${media.id}`,
      subOrDub: "both",
    }));
  }

  async findEpisodes(id) {
    const parsed = this.parseMediaId(id);
    if (!parsed) return [];

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          idMal
          title { romaji english native }
          episodes
          nextAiringEpisode { episode }
        }
      }
    `;
    const data = await this.anilistRequest(query, { id: parsed.anilistId });
    const media = data?.data?.Media;
    if (!media) return [];
    const malId = parsed.malId || Number(media.idMal);

    const knownCount = Number(media.episodes);
    const nextAiringEpisode = Number(media.nextAiringEpisode?.episode);
    const count = Number.isInteger(knownCount) && knownCount > 0
      ? knownCount
      : Number.isInteger(nextAiringEpisode) && nextAiringEpisode > 1
        ? nextAiringEpisode - 1
        : 0;
    if (count <= 0) return [];

    return Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        id: `${parsed.anilistId}:${malId || 0}:${number}`,
        number,
        title: `Episode ${number}`,
        url: `${this.baseUrl}/stream/ani/${parsed.anilistId}/${number}/sub`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    const parsed = this.parseEpisodeId(episode.id);
    if (!parsed) throw new Error("Invalid Megaplay episode ID");

    const selectedServer = this.normalizeServer(server);
    if (!selectedServer) throw new Error(`Unsupported Megaplay server: ${server}`);

    const audio = selectedServer.toLowerCase();
    const streamCandidates = [
      parsed.anilistId
        ? `${this.baseUrl}stream/ani/${parsed.anilistId}/${parsed.number}/${audio}`
        : undefined,
      parsed.malId
        ? `${this.baseUrl}stream/mal/${parsed.malId}/${parsed.number}/${audio}`
        : undefined,
    ].filter(Boolean);

    let streamUrl;
    let fileId;
    for (const candidate of streamCandidates) {
      try {
        const page = await this.request(candidate, {
          allowHttpError: true,
          headers: { Referer: `${this.baseUrl}/` },
        });
        if (!page.ok) continue;
        const html = await page.text();
        fileId = this.extractFileId(html);
        if (fileId) {
          streamUrl = candidate;
          break;
        }
      } catch (error) {
        // Try the MAL URL if the AniList URL fails at the network/request level.
      }
    }
    if (!fileId) throw new Error(`Megaplay file ID not found for episode ${parsed.number}`);

    const sourceUrl = new URL("stream/getSources", this.baseUrl);
    sourceUrl.searchParams.set("id", fileId);
    sourceUrl.searchParams.set("platform", "OTHER");
    const sourceResponse = await this.request(sourceUrl.toString(), {
      headers: { Referer: streamUrl },
    });
    const sourceData = await sourceResponse.json();
    if (!sourceData?.enc) throw new Error("Megaplay source response did not contain an enc value");

    const decryptResponse = await this.request(this.decryptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: streamUrl,
      },
      body: JSON.stringify({ text: sourceData.enc }),
    });
    const decryptData = await decryptResponse.json();
    const videoUrl = decryptData?.result?.file;
    if (!videoUrl) throw new Error("Megaplay decryption response did not contain a stream URL");

    const subtitles = (Array.isArray(sourceData.tracks) ? sourceData.tracks : [])
      .filter(track => track?.kind === "captions" && track.file)
      .map(track => ({
        id: track.file,
        url: track.file,
        language: track.label || "und",
        isDefault: Boolean(track.default),
      }));

    return {
      server: selectedServer,
      headers: { Referer: this.baseUrl },
      videoSources: [{
        url: videoUrl,
        type: "m3u8",
        quality: "Auto",
        label: selectedServer,
        subtitles,
      }],
    };
  }

  async anilistRequest(query, variables) {
    const response = await this.request(this.anilistUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const data = await response.json();
    if (data.errors?.length) throw new Error(data.errors[0].message || "AniList request failed");
    return data;
  }

  async request(url, options = {}) {
    const { allowHttpError, ...fetchOptions } = options;
    const response = await fetch(url, {
      ...fetchOptions,
      headers: { "User-Agent": this.userAgent, ...(options.headers || {}) },
    });
    if (!response.ok && !allowHttpError) throw new Error(`Request failed (${response.status}): ${url}`);
    return response;
  }

  extractFileId(html) {
    const titleMatch = String(html).match(/<title\b[^>]*>\s*File\s+(\d+)\s*-\s*MegaPlay\s*<\/title>/i);
    if (titleMatch) return titleMatch[1];

    const playerTag = String(html).match(/<div\b(?=[^>]*\sid=["']megaplay-player["'])(?=[^>]*\sdata-id=["'](\d+)["'])[^>]*>/i);
    if (playerTag) return playerTag[1];

    const dataIdMatch = String(html).match(/\sdata-id=["'](\d+)["']/i);
    return dataIdMatch?.[1];
  }

  parseMediaId(id) {
    const match = String(id).match(/^(\d+)(?::(\d+))?$/);
    if (!match) return undefined;
    const anilistId = Number(match[1]);
    const malId = Number(match[2]);
    return {
      anilistId,
      malId: Number.isInteger(malId) && malId > 0 ? malId : undefined,
    };
  }

  parseEpisodeId(id) {
    const match = String(id).match(/^(\d+)(?::(\d+))?:(\d+)$/);
    if (!match) return undefined;
    const anilistId = Number(match[1]);
    const possibleMalId = Number(match[2]);
    const number = Number(match[3]);
    return {
      anilistId,
      malId: Number.isInteger(possibleMalId) && possibleMalId > 0 ? possibleMalId : undefined,
      number,
    };
  }

  normalizeServer(server) {
    const value = String(server || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }
}
