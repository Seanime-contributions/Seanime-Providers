class Provider {
  constructor() {
    this.anilistUrl = "https://graphql.anilist.co";
    this.baseUrl = "https://zokoanime.video/";
    this.referer = this.baseUrl;
    this.obfuscationKey = "otaku-embed-v1";
    this.userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["Sub", "Dub"],
      supportsDub: true,
    };
  }

  async search(opts) {
    console.log("[ZokoAnime] search", { query: opts?.query });
    const query = `
      query ($search: String) {
        Page(perPage: 25) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            idMal
            title { romaji english native }
          }
        }
      }
    `;
    const data = await this.anilistRequest(query, { search: opts.query });
    const results = (data?.data?.Page?.media || [])
      .filter(media => Number.isInteger(Number(media.idMal)) && Number(media.idMal) > 0)
      .map(media => ({
        id: String(media.idMal),
        title: media.title?.english || media.title?.romaji || media.title?.native || String(media.idMal),
        url: `${this.baseUrl}stream/mal/${media.idMal}/1/sub`,
        subOrDub: "both",
      }));
    console.log("[ZokoAnime] search results", { count: results.length, sampleIds: results.slice(0, 5).map(result => result.id) });
    return results;
  }

  async findEpisodes(id) {
    const malId = Number.parseInt(String(id), 10);
    console.log("[ZokoAnime] findEpisodes", { rawId: id, malId });
    if (!Number.isInteger(malId) || malId <= 0) return [];

    const query = `
      query ($idMal: Int) {
        Media(idMal: $idMal, type: ANIME) {
          idMal
          title { romaji english native }
          episodes
          nextAiringEpisode { episode }
        }
      }
    `;
    const data = await this.anilistRequest(query, { idMal: malId });
    const media = data?.data?.Media;
    if (!media) {
      console.log("[ZokoAnime] findEpisodes: AniList returned no media", { malId });
      return [];
    }

    const knownCount = Number(media.episodes);
    const nextAiringEpisode = Number(media.nextAiringEpisode?.episode);
    const count = Number.isInteger(knownCount) && knownCount > 0
      ? knownCount
      : Number.isInteger(nextAiringEpisode) && nextAiringEpisode > 1
        ? nextAiringEpisode - 1
        : 0;
    if (count <= 0) {
      console.log("[ZokoAnime] findEpisodes: no episode count", { malId, knownCount, nextAiringEpisode });
      return [];
    }

    console.log("[ZokoAnime] findEpisodes: resolved count", { malId, count });

    return Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        id: `${malId}:${number}`,
        number,
        title: `Episode ${number}`,
        url: `${this.baseUrl}stream/mal/${malId}/${number}/sub`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    console.log("[ZokoAnime] findEpisodeServer: start", { episodeId: episode?.id, number: episode?.number, server });
    const parsed = this.parseEpisodeId(episode.id);
    if (!parsed) {
      console.log("[ZokoAnime] findEpisodeServer: invalid episode ID", { episodeId: episode?.id });
      throw new Error("Invalid ZokoAnime episode ID");
    }

    const selectedServer = this.normalizeServer(server);
    if (!selectedServer) {
      console.log("[ZokoAnime] findEpisodeServer: unsupported server", { server });
      throw new Error(`Unsupported ZokoAnime server: ${server}`);
    }

    const audio = selectedServer.toLowerCase();
    const streamUrl = `${this.baseUrl}stream/mal/${parsed.malId}/${parsed.number}/${audio}`;
    console.log("[ZokoAnime] findEpisodeServer: requesting player page", { streamUrl, referer: this.referer });
    const page = await this.request(streamUrl);
    console.log("[ZokoAnime] findEpisodeServer: player response", { status: page.status, statusText: page.statusText });
    const html = await page.text();
    console.log("[ZokoAnime] findEpisodeServer: player HTML", { length: html.length });
    const payload = this.extractPayload(html);
    console.log("[ZokoAnime] findEpisodeServer: payload", { found: Boolean(payload), length: payload?.length || 0 });
    if (!payload) throw new Error(`ZokoAnime player payload not found for episode ${parsed.number}`);

    let playerData;
    try {
      playerData = this.deobfuscate(payload);
    } catch (error) {
      console.log("[ZokoAnime] findEpisodeServer: payload decode failed", { message: error?.message || String(error) });
      throw new Error(`Failed to decode ZokoAnime player payload: ${error?.message || error}`);
    }

    const videoUrl = playerData?.src;
    console.log("[ZokoAnime] findEpisodeServer: decoded payload", {
      keys: playerData && typeof playerData === "object" ? Object.keys(playerData) : [],
      hasStream: Boolean(videoUrl),
      subtitleCount: Array.isArray(playerData?.subtitles) ? playerData.subtitles.length : 0,
    });
    if (!videoUrl) throw new Error("ZokoAnime player payload did not contain a stream URL");

    const subtitles = (Array.isArray(playerData.subtitles) ? playerData.subtitles : [])
      .filter(track => track?.src)
      .map(track => ({
        id: track.src,
        url: track.src,
        // ZokoAnime currently reports every track's lang as "en".
        // The label contains the actual subtitle language, including regional variants.
        language: track.label || track.lang || "und",
        isDefault: Boolean(track.default),
      }));

    console.log("[ZokoAnime] findEpisodeServer: source ready", {
      streamUrl: videoUrl,
      subtitleCount: subtitles.length,
      referer: this.referer,
    });

    return {
      server: selectedServer,
      headers: { Referer: this.referer },
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
    console.log("[ZokoAnime] request", { method: fetchOptions.method || "GET", url, referer: this.referer });
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        "User-Agent": this.userAgent,
        Referer: this.referer,
        ...(options.headers || {}),
      },
    });
    console.log("[ZokoAnime] response", { method: fetchOptions.method || "GET", url, status: response.status, statusText: response.statusText });
    if (!response.ok && !allowHttpError) throw new Error(`Request failed (${response.status}): ${url}`);
    return response;
  }

  extractPayload(html) {
    const match = String(html).match(/window\.__P\s*=\s*["']([^"']+)["']/);
    return match?.[1];
  }

  deobfuscate(blob) {
    const encodedBytes = this.decodeBase64(blob);
    const decodedBytes = new Array(encodedBytes.length);
    for (let index = 0; index < encodedBytes.length; index++) {
      decodedBytes[index] = encodedBytes[index]
        ^ this.obfuscationKey.charCodeAt(index % this.obfuscationKey.length);
    }
    return JSON.parse(this.decodeUtf8(decodedBytes));
  }

  decodeBase64(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const input = String(value).replace(/\s/g, "");
    if (!input || input.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
      throw new Error("Invalid Base64 payload");
    }

    const bytes = [];
    for (let index = 0; index < input.length; index += 4) {
      const a = alphabet.indexOf(input[index]);
      const b = alphabet.indexOf(input[index + 1]);
      const c = input[index + 2] === "=" ? 0 : alphabet.indexOf(input[index + 2]);
      const d = input[index + 3] === "=" ? 0 : alphabet.indexOf(input[index + 3]);
      if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid Base64 character");

      bytes.push((a << 2) | (b >> 4));
      if (input[index + 2] !== "=") bytes.push(((b & 15) << 4) | (c >> 2));
      if (input[index + 3] !== "=") bytes.push(((c & 3) << 6) | d);
    }
    return bytes;
  }

  decodeUtf8(bytes) {
    let output = "";
    for (let index = 0; index < bytes.length;) {
      const first = bytes[index++];
      if (first < 0x80) {
        output += String.fromCharCode(first);
      } else if (first >= 0xc2 && first <= 0xdf) {
        const second = bytes[index++];
        if ((second & 0xc0) !== 0x80) throw new Error("Invalid UTF-8 sequence");
        output += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      } else if (first >= 0xe0 && first <= 0xef) {
        const second = bytes[index++];
        const third = bytes[index++];
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) throw new Error("Invalid UTF-8 sequence");
        const codePoint = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw new Error("Invalid UTF-8 code point");
        output += String.fromCharCode(codePoint);
      } else if (first >= 0xf0 && first <= 0xf4) {
        const second = bytes[index++];
        const third = bytes[index++];
        const fourth = bytes[index++];
        if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 || (fourth & 0xc0) !== 0x80) {
          throw new Error("Invalid UTF-8 sequence");
        }
        const codePoint = ((first & 7) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
        if (codePoint > 0x10ffff) throw new Error("Invalid UTF-8 code point");
        const adjusted = codePoint - 0x10000;
        output += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      } else {
        throw new Error("Invalid UTF-8 leading byte");
      }
    }
    return output;
  }

  parseEpisodeId(id) {
    const match = String(id).match(/^(\d+):(\d+)$/);
    if (!match) return undefined;
    return { malId: Number(match[1]), number: Number(match[2]) };
  }

  normalizeServer(server) {
    const value = String(server || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }
}
