/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://eng.animeapps.top";
    this.epBase = "https://epeng.animeapps.top";
    this.playBase = "https://playeng.animeapps.top";
    this.referer = "https://anibd.thankpet.com/";
  }

  getSettings() {
    return {
      episodeServers: ["SUB"],
      supportsDub: false,
    };
  }

  async search(query) {
    const searchUrl = `${this.base}/api/search3.php?keyword=${encodeURIComponent(query.query)}&page=1&limit=10`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    if (data.status !== "success" || !data.data || !data.data.length) {
      throw new Error("No anime found");
    }

    const results = data.data.map((item) => ({
      id: item.anilist,
      title: item.postname,
      url: `${this.base}/api/search3.php?keyword=${encodeURIComponent(query.query)}`,
      subOrDub: "sub",
      cover: item.ani_cover_large,
    }));

    return results;
  }

  async findEpisodes(id) {
    const apiUrl = `${this.epBase}/api2.php?epid=${id}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!Array.isArray(data) || !data.length) throw new Error("No episodes found");

    const subServer = data.find((s) => s.server_name === "S-sub");
    if (!subServer || !subServer.server_data || !subServer.server_data.length) {
      throw new Error("No SUB episodes found");
    }

    const episodes = subServer.server_data.map((ep) => ({
      id: ep.link,
      title: `Episode ${ep.name}`,
      number: parseInt(ep.name) || 0,
      url: ep.link,
    }));

    return episodes;
  }

  async findEpisodeServer(episode, server) {
    if (server === "DUB") throw new Error("DUB not available for this provider");

    const apiUrl = `${this.epBase}/apilink.php?data=${episode.id}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!Array.isArray(data) || !data.length) throw new Error("No stream sources found");

    const srServer = data.find((s) => s.server === "SR");
    if (!srServer) throw new Error("SR server not available");

    const embedUrl = srServer.link;
    const referer = this.referer;

    const embedRes = await fetch(embedUrl, {
      headers: {
        Referer: referer,
      },
    });
    const embedHtml = await embedRes.text();

    // Flexible regex: matches videoUrl or url with any m3u8 path
    const srcMatch = embedHtml.match(/(?:videoUrl|url)\s*:\s*['"]([^'"]*\.m3u8[^'"]*)['"]/i);

    if (!srcMatch) throw new Error("Could not extract HLS stream from embed");

    let m3u8Path = srcMatch[1];

    // Build full URL depending on path format
    let fullUrl;
    if (m3u8Path.startsWith("http")) {
      fullUrl = m3u8Path;
    } else if (m3u8Path.startsWith("/")) {
      fullUrl = `${this.playBase}${m3u8Path}`;
    } else {
      // legacy cache/... format
      fullUrl = `${this.playBase}/r2/${m3u8Path}`;
    }

    // Extract subtitle tracks from the player config, e.g.:
    // tracks: [{ "label": "English", "file": "...sub.vtt", "kind": "captions", "default": true }]
    const subtitles = this.extractSubtitles(embedHtml);

    return {
      server: server,
      videoSources: [{
        url: fullUrl,
        quality: "auto",
        type: "hls",
        headers: { Referer: referer },
        subtitles: subtitles,
      }],
      headers: { Referer: referer },
    };
  }

  extractSubtitles(html) {
    // Grab the tracks: [ ... ] array (non-greedy up to the matching closing bracket)
    const tracksMatch = html.match(/tracks\s*:\s*(\[[\s\S]*?\])\s*,?\s*(?:title|\n\s*\})/i);
    if (!tracksMatch) return [];

    let tracksRaw = tracksMatch[1];

    let tracks;
    try {
      // Tracks are usually valid-ish JSON but may use unquoted keys in some embeds;
      // try strict JSON first, then fall back to a quoting fix.
      tracks = JSON.parse(tracksRaw);
    } catch (e) {
      try {
        const fixed = tracksRaw.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
        tracks = JSON.parse(fixed);
      } catch (e2) {
        return [];
      }
    }

    if (!Array.isArray(tracks)) return [];

    return tracks
      .filter((t) => t && t.file && (t.kind === "captions" || t.kind === "subtitles" || !t.kind))
      .map((t, i) => ({
        id: String(i + 1),
        url: t.file,
        language: this.labelToLangCode(t.label),
        isDefault: !!t.default,
      }));
  }

  labelToLangCode(label) {
    if (!label) return "en";
    const map = {
      english: "en",
      indonesian: "id",
      malay: "ms",
      spanish: "es",
      portuguese: "pt",
      french: "fr",
      german: "de",
      arabic: "ar",
      thai: "th",
      vietnamese: "vi",
      japanese: "ja",
    };
    const key = label.trim().toLowerCase();
    return map[key] || key.slice(0, 2);
  }
}