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
            title { romaji english native }
          }
        }
      }
    `;
    const data = await this.anilistRequest(query, { search: opts.query });
    return (data?.data?.Page?.media || []).map(media => ({
      id: String(media.id),
      title: media.title?.english || media.title?.romaji || media.title?.native || String(media.id),
      url: `https://anilist.co/anime/${media.id}`,
      subOrDub: "both",
    }));
  }

  async findEpisodes(id) {
    const mediaId = Number.parseInt(String(id), 10);
    if (!Number.isFinite(mediaId)) return [];

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english native }
          episodes
          nextAiringEpisode { episode }
        }
      }
    `;
    const data = await this.anilistRequest(query, { id: mediaId });
    const media = data?.data?.Media;
    if (!media) return [];

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
        id: `${mediaId}:${number}`,
        number,
        title: `Episode ${number}`,
        url: `${this.baseUrl}/stream/ani/${mediaId}/${number}/sub`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    const parsed = this.parseEpisodeId(episode.id);
    if (!parsed) throw new Error("Invalid Megaplay episode ID");

    const selectedServer = this.normalizeServer(server);
    if (!selectedServer) throw new Error(`Unsupported Megaplay server: ${server}`);

    const audio = selectedServer.toLowerCase();
    const streamUrl = `${this.baseUrl}/stream/ani/${parsed.mediaId}/${parsed.number}/${audio}`;
    const page = await this.request(streamUrl, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const html = await page.text();
    const fileId = this.extractFileId(html);
    if (!fileId) throw new Error(`Megaplay file ID not found for episode ${parsed.number}`);

    const sourceUrl = new URL("/stream/getSources", this.baseUrl);
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
    const response = await fetch(url, {
      ...options,
      headers: { "User-Agent": this.userAgent, ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
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

  parseEpisodeId(id) {
    const match = String(id).match(/^(\d+):(\d+)$/);
    if (!match) return undefined;
    return { mediaId: Number(match[1]), number: Number(match[2]) };
  }

  normalizeServer(server) {
    const value = String(server || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }
}
