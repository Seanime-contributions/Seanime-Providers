/// <reference path="../online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://mmani.com";
    this.commonHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `${this.base}/`,
      "sec-fetch-site": "same-origin",
    };
    this.kfToken = null;
  }

  getSettings() {
    return {
      episodeServers: ["R-HD", "SR"],
      supportsDub: false,
    };
  }

  async getKfToken() {
    if (this.kfToken) return this.kfToken;

    const response = await fetch(this.base, { headers: this.commonHeaders });
    if (!response.ok) throw new Error(`MMani homepage request failed (HTTP ${response.status})`);
    const html = await response.text();
    const token = html.match(/\}\)\(window\.fetch\s*,\s*["']([^"']+)["']\s*\)/i)?.[1]
      || html.match(/X-KF-Req["']\s*,\s*["']([^"']+)["']/i)?.[1];
    if (!token) throw new Error("MMani request token was not found");

    this.kfToken = token;
    return token;
  }

  async requestJson(url, options = {}) {
    const token = await this.getKfToken();
    const headers = {
      ...this.commonHeaders,
      "X-KF-Req": token,
      ...(options.headers || {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`MMani request failed (HTTP ${response.status})`);
    return response.json();
  }

  async requestText(url, options = {}) {
    const token = await this.getKfToken();
    const headers = {
      ...this.commonHeaders,
      "X-KF-Req": token,
      ...(options.headers || {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`MMani request failed (HTTP ${response.status})`);
    return response.text();
  }

  async search(query) {
    const url = `${this.base}/ajax.php?search&keyword=${encodeURIComponent(query.query)}&page=1&limit=20`;
    const payload = await this.requestJson(url);
    const results = Array.isArray(payload?.data) ? payload.data : [];

    const mapped = results
      .filter((item) => item && item.postid != null)
      .map((item) => ({
        id: String(item.postid),
        title: String(item.postname || "Untitled"),
        url: `${this.base}/?postid=${encodeURIComponent(item.postid)}`,
        image: item.ani_cover_large || undefined,
        subOrDub: "sub",
      }));

    if (!mapped.length) throw new Error("No anime found");
    return mapped;
  }

  async findEpisodes(id) {
    const payload = await this.requestJson(`${this.base}/ajax.php?episodes&epid=${encodeURIComponent(id)}`);
    if (!Array.isArray(payload)) throw new Error("MMani returned an invalid episode list");

    const episodes = [];
    for (const server of payload) {
      const serverName = String(server?.server_name || "S-sub");
      const entries = Array.isArray(server?.server_data) ? server.server_data : [];
      for (const entry of entries) {
        const number = Number.parseFloat(entry?.name ?? entry?.slug);
        if (!entry?.link || !Number.isFinite(number)) continue;
        episodes.push({
          id: JSON.stringify({ data: String(entry.link), server: serverName }),
          title: `Episode ${number}`,
          number,
          url: `${this.base}/ajax.php?eplink&data=${encodeURIComponent(entry.link)}`,
        });
      }
    }

    episodes.sort((a, b) => a.number - b.number);
    if (!episodes.length) throw new Error("No episodes found");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    let details;
    try {
      details = JSON.parse(episode.id);
    } catch (_) {
      details = { data: episode.id, server };
    }

    const links = await this.requestJson(`${this.base}/ajax.php?eplink&data=${encodeURIComponent(details.data)}`);
    if (!Array.isArray(links)) throw new Error("MMani returned an invalid server list");

    const selected = links.find((item) => String(item?.server || "") === String(server)) || links[0];
    if (!selected?.link) throw new Error(`MMani server ${server} is unavailable`);

    const refererHeaders = {
      "Referer": `${this.base}/`,
    };
    const playerHtml = await this.requestText(selected.link, { headers: refererHeaders });
    const playerConfig = this.extractPlayerConfig(playerHtml);
    if (!playerConfig?.videoUrl) throw new Error("MMani player configuration was not found");

    const streamUrl = new URL(playerConfig.videoUrl, selected.link).toString();
    const subtitles = (Array.isArray(playerConfig.tracks) ? playerConfig.tracks : [])
      .filter((track) => track && track.file && String(track.kind || "captions").toLowerCase() === "captions")
      .map((track, index) => ({
        id: `mmani-${index + 1}`,
        url: new URL(track.file, selected.link).toString(),
        language: String(track.label || "English"),
        isDefault: Boolean(track.default) || index === 0,
      }));

    const playbackHeaders = {
      ...this.commonHeaders,
      "X-KF-Req": await this.getKfToken(),
      "Referer": `${this.base}/`,
    };

    return {
      server: String(selected.server || server || "MMani"),
      headers: playbackHeaders,
      videoSources: [{
        url: streamUrl,
        type: "m3u8",
        quality: String(selected.server || server || "auto"),
        subtitles,
      }],
    };
  }

  extractPlayerConfig(html) {
    const match = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*<\/script>/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (_) {
      return null;
    }
  }
}
