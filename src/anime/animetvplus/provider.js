class Provider {
  constructor() {
    this.searchBase = "https://search.animetvplus.site";
    this.siteBase = "https://animetvplus.xyz";
    this.embedBase = "https://embed.animetvplus.site";
    this.streamOrigin = this.embedBase;
  }

  getSettings() {
    return {
      episodeServers: ["Default"],
      supportsDub: false,
    };
  }

  async search(query) {
    const url = `${this.searchBase}/v1/search?q=${encodeURIComponent(query.query)}&offset=0&limit=20`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    const results = Array.isArray(payload?.data) ? payload.data : [];
    const items = results
      .filter(item => item && item.mal_id != null && item.title)
      .map(item => ({
        id: String(item.mal_id),
        title: String(item.title),
        url: `${this.siteBase}/anime/${encodeURIComponent(item.mal_id)}`,
        subOrDub: "sub",
      }));
    if (!items.length) throw new Error("No anime found");
    return items;
  }

  async findEpisodes(id) {
    const malId = String(id).split(":", 1)[0];
    if (!/^\d+$/.test(malId)) return [];

    const response = await fetch(`${this.siteBase}/anime/${encodeURIComponent(malId)}`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const html = await response.text();
    const card = this.extractInitialCard(html);
    if (!card) throw new Error("AniTVPlus anime data was not found on the page");

    const seasons = Array.isArray(card.seasons) ? card.seasons : [];
    const season = seasons.find(item =>
      String(item?.owner_mal ?? item?.mal_id ?? "") === malId && Array.isArray(item?.episodes)
    )
      || (String(card.selected_season?.owner_mal ?? card.selected_season?.mal_id ?? "") === malId
        ? card.selected_season
        : undefined)
      || card.selected_season
      || seasons.find(item => String(item?.owner_mal ?? item?.mal_id ?? "") === malId)
      || seasons.find(item => item?.is_primary)
      || seasons[0];
    const sourceEpisodes = Array.isArray(season?.episodes) ? season.episodes : [];
    const episodes = sourceEpisodes
      .filter(item => item && item.has_stream !== false && item.stream_ep != null)
      .map(item => {
        const number = Number(item.ep);
        const streamEpisode = Number(item.stream_ep);
        if (!Number.isFinite(number) || !Number.isFinite(streamEpisode)) return null;
        return {
          id: `${malId}:${streamEpisode}`,
          title: item.title ? `Episode ${number}: ${item.title}` : `Episode ${number}`,
          number,
          url: `${this.siteBase}/anime/${encodeURIComponent(malId)}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.number - b.number);

    if (!episodes.length) throw new Error("No streamable AniTVPlus episodes found");
    return episodes;
  }

  async findEpisodeServer(episode, _server) {
    const match = String(episode.id || "").match(/^(\d+):(\d+)$/);
    if (!match) throw new Error("Invalid AniTVPlus episode ID");
    const [, malId, streamEpisode] = match;
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
    const resolved = await this.resolveUqloadPlaylist(malId, streamEpisode, { "User-Agent": userAgent });

    return {
      server: "Default",
      headers: resolved.headers,
      videoSources: [{
        url: resolved.playlistUrl,
        quality: "auto",
        type: "m3u8",
        subtitles: resolved.subtitles,
      }],
    };
  }

  async resolveUqloadPlaylist(malId, episodeNumber, requestHeaders) {
    const resolverUrl = new URL("/home/api/v1/resolve", this.embedBase);
    resolverUrl.searchParams.set("mal", malId);
    resolverUrl.searchParams.set("ep", episodeNumber);
    const resolverResponse = await fetch(resolverUrl.toString(), {
      headers: { Accept: "application/json", "User-Agent": requestHeaders["User-Agent"] },
    });
    if (!resolverResponse.ok) throw new Error(`AniTVPlus resolver failed (HTTP ${resolverResponse.status})`);
    const resolved = await resolverResponse.json();
    const embedUrl = resolved?.uqload?.embed_url;
    if (!resolved?.ok || !embedUrl) throw new Error("AniTVPlus resolver did not return a UQLoad embed URL");

    const embedResponse = await fetch(embedUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: resolverUrl.origin + "/",
        "User-Agent": requestHeaders["User-Agent"],
      },
    });
    if (!embedResponse.ok) throw new Error(`UQLoad embed request failed (HTTP ${embedResponse.status})`);
    const html = await embedResponse.text();
    const packedScripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    let playlistUrl;
    let subtitles = [];
    for (const script of packedScripts) {
      const unpacked = this.unpackDeanEdwards(script);
      const found = unpacked?.match(/https?:\/\/[^"'\s<>]+?\.m3u8(?:\?[^"'\s<>]*)?/i)?.[0];
      if (found) {
        playlistUrl = found.replace(/&amp;/gi, "&");
        subtitles = this.extractUqloadSubtitles(unpacked, embedUrl);
        break;
      }
    }
    if (!playlistUrl) throw new Error("Could not extract an HLS playlist from the UQLoad embed");

    const embedOrigin = new URL(embedUrl).origin;
    return {
      playlistUrl,
      subtitles,
      headers: { Referer: embedUrl, Origin: embedOrigin },
    };
  }

  extractUqloadSubtitles(playerConfig, embedUrl) {
    const tracksMatch = String(playerConfig).match(/\btracks\s*:\s*\[([\s\S]*?)\]/);
    if (!tracksMatch) return [];
    const trackObjects = tracksMatch[1].match(/\{[^{}]*\}/g) || [];
    return trackObjects.flatMap((track, index) => {
      const readString = (key) => {
        const property = new RegExp(`(?:["']?${key}["']?)\\s*:\\s*(["'])(.*?)\\1`, "s");
        return property.exec(track)?.[2]?.replace(/\\([\\"'])/g, "$1");
      };
      const file = readString("file");
      const kind = readString("kind");
      const label = readString("label");
      if (!file || !/^(?:captions|subtitles)$/i.test(kind || "")) return [];
      if (/upload captions/i.test(label || "") || /\/empty\.srt(?:$|[?#])/i.test(file)) return [];
      let url;
      try {
        url = new URL(file, embedUrl).toString();
      } catch {
        return [];
      }
      if (!/^https?:/i.test(url)) return [];
      return [{
        id: `uqload-${this.languageCode(label || `subtitle-${index + 1}`)}`,
        url,
        language: this.languageCode(label),
        label: label || `Subtitle ${index + 1}`,
        isDefault: /(?:["']?default["']?)\s*:\s*true\b/i.test(track),
      }];
    });
  }

  unpackDeanEdwards(source) {
    const marker = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(/.exec(String(source));
    if (!marker) return "";
    let cursor = marker.index + marker[0].length;
    const readStringLiteral = () => {
      const quote = source[cursor++];
      if (quote !== "'" && quote !== '"') throw new Error("Invalid packed-script string");
      let value = "";
      while (cursor < source.length) {
        let character = source[cursor++];
        if (character === quote) return value;
        if (character !== "\\") {
          value += character;
          continue;
        }
        character = source[cursor++];
        const simpleEscapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };
        if (Object.prototype.hasOwnProperty.call(simpleEscapes, character)) value += simpleEscapes[character];
        else if (character === "x" || character === "u") {
          const digits = character === "x" ? 2 : 4;
          const code = source.slice(cursor, cursor + digits);
          if (!new RegExp(`^[0-9a-f]{${digits}}$`, "i").test(code)) throw new Error("Invalid packed-script escape");
          value += String.fromCharCode(parseInt(code, 16));
          cursor += digits;
        } else if (character !== "\n" && character !== "\r") value += character;
      }
      throw new Error("Unterminated packed-script string");
    };
    const skipWhitespace = () => { while (/\s/.test(source[cursor] || "")) cursor++; };
    const readNumber = () => {
      skipWhitespace();
      const number = /^\d+/.exec(source.slice(cursor));
      if (!number) throw new Error("Invalid packed-script number");
      cursor += number[0].length;
      return Number(number[0]);
    };

    try {
      const payload = readStringLiteral();
      skipWhitespace();
      if (source[cursor++] !== ",") return "";
      const radix = readNumber();
      skipWhitespace();
      if (source[cursor++] !== ",") return "";
      const count = readNumber();
      skipWhitespace();
      if (source[cursor++] !== ",") return "";
      skipWhitespace();
      const dictionary = readStringLiteral().split("|");
      if (radix < 2 || radix > 62 || count > 10000) return "";
      return payload.replace(/\b\w+\b/g, (word) => {
        const index = parseInt(word, radix);
        return Number.isInteger(index) && index >= 0 && index < count && dictionary[index]
          ? dictionary[index]
          : word;
      });
    } catch (error) {
      console.log(`[AniTVPlus] Could not unpack UQLoad player script: ${error?.message || error}`);
      return "";
    }
  }

  resolveSubtitleUrl(file, metaUrl) {
    const value = String(file).trim();
    // Absolute URLs pass through unchanged.
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return new URL(value, metaUrl).toString();
    // Strip any leading slashes so the path stays beneath the bundle directory.
    const relativePath = value.replace(/^\/+/, "");
    // Drop the query string and the "meta.json" filename, keeping the bundle
    // directory (e.g. /hls2/14/201514/q3e6l5wtsehj_n/).
    const cleanMetaUrl = metaUrl.split(/[?#]/, 1)[0];
    const bundleDirectory = cleanMetaUrl.replace(/[^/]*$/, "");
    console.log(`[AniTVPlus] resolve clean=${cleanMetaUrl} dir=${bundleDirectory} rel=${relativePath}`);
    // Pure string concatenation — don't rely on `new URL(relative, base)` which
    // behaves inconsistently inside the extension sandbox.
    return bundleDirectory + relativePath;
  }

  extractInitialCard(html) {
    const match = String(html).match(/<astro-island\b[^>]*\bprops\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!match) return undefined;
    const encodedProps = this.decodeHtmlEntities(match[2]);
    let props;
    try {
      props = JSON.parse(encodedProps);
    } catch (error) {
      throw new Error(`Could not parse AniTVPlus Astro data: ${error?.message || error}`);
    }
    const decoded = this.decodeAstroValue(props);
    return decoded?.initialCrCard || decoded?.initial_cr_card;
  }

  decodeAstroValue(value) {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isInteger(value[0])) {
        const [type, payload] = value;
        if (type === 1 && Array.isArray(payload)) return payload.map(item => this.decodeAstroValue(item));
        return this.decodeAstroValue(payload);
      }
      return value.map(item => this.decodeAstroValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.decodeAstroValue(item)]));
    }
    return value;
  }

  decodeHtmlEntities(value) {
    return String(value)
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&#x0*27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }

  languageCode(label) {
    const value = String(label || "").trim().toLowerCase();
    const codes = {
      arabic: "ar", chinese: "zh", english: "en", french: "fr", german: "de",
      indonesian: "id", italian: "it", japanese: "ja", korean: "ko", malay: "ms",
      polish: "pl", portuguese: "pt", romanian: "ro", spanish: "es", thai: "th",
      turkish: "tr", vietnamese: "vi",
    };
    if (codes[value]) return codes[value];
    return value || "und";
  }
}
