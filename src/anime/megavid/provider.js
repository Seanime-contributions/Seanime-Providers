class Provider {
  constructor() {
    this.anilistUrl = "https://graphql.anilist.co";
    this.baseUrl = "https://megavid.buzz/";
    this.referer = this.baseUrl;
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
      url: `${this.baseUrl}ani/${media.id}/1/sub/source?axsv=loli`,
      subOrDub: "both",
    }));
  }

  async findEpisodes(id) {
    const mediaId = Number.parseInt(String(id), 10);
    if (!Number.isInteger(mediaId) || mediaId <= 0) return [];

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          idMal
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

    const malId = Number(media.idMal);
    return Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        id: `${mediaId}:${Number.isInteger(malId) && malId > 0 ? malId : 0}:${number}`,
        number,
        title: `Episode ${number}`,
        url: `${this.baseUrl}ani/${mediaId}/${number}/sub/source?axsv=loli`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    const parsed = this.parseEpisodeId(episode.id);
    if (!parsed) throw new Error("Invalid Megavid episode ID");

    const selectedServer = this.normalizeServer(server);
    if (!selectedServer) throw new Error(`Unsupported Megavid server: ${server}`);

    const audio = selectedServer.toLowerCase();
    const candidates = [
      `${this.baseUrl}ani/${parsed.anilistId}/${parsed.number}/${audio}/source?axsv=loli`,
      parsed.malId
        ? `${this.baseUrl}mal/${parsed.malId}/${parsed.number}/${audio}/source?axsv=loli`
        : undefined,
    ].filter(Boolean);

    let sourceData;
    let selectedUrl;
    for (const candidate of candidates) {
      try {
        const response = await this.request(candidate, { allowHttpError: true });
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.status === "ok" && data.source) {
          sourceData = data;
          selectedUrl = candidate;
          break;
        }
      } catch (error) {
        // Try the MAL endpoint when the AniList endpoint fails or returns invalid JSON.
      }
    }

    if (!sourceData?.source) {
      throw new Error(`No Megavid source found for episode ${parsed.number}`);
    }

    const subtitles = (Array.isArray(sourceData.tracks) ? sourceData.tracks : [])
      .filter(track => track?.kind === "captions" && track?.file && track?.label)
      .map(track => ({
        id: track.file,
        url: track.file,
        language: track.label,
        isDefault: Boolean(track.default),
      }));

    return {
      server: selectedServer,
      headers: { Referer: this.referer },
      videoSources: [{
        url: sourceData.source,
        type: sourceData.type === "hls" || /\.m3u8(?:\?|$)/i.test(sourceData.source) ? "m3u8" : "unknown",
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
      headers: {
        "User-Agent": this.userAgent,
        Referer: this.referer,
        ...(options.headers || {}),
      },
    });
    if (!response.ok && !allowHttpError) throw new Error(`Request failed (${response.status}): ${url}`);
    return response;
  }

  parseEpisodeId(id) {
    const match = String(id).match(/^(\d+):(\d+):(\d+)$/);
    if (!match) return undefined;
    const anilistId = Number(match[1]);
    const malId = Number(match[2]);
    return {
      anilistId,
      malId: Number.isInteger(malId) && malId > 0 ? malId : undefined,
      number: Number(match[3]),
    };
  }

  normalizeServer(server) {
    const value = String(server || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }
}
