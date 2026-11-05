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

    let response;
    try {
      response = await fetch(this.base, { headers: this.commonHeaders });
    } catch (error) {
      console.log("[MMani] token request failed", error);
      return "";
    }
    console.log(`[MMani] token request status=${response.status}`);
    if (!response.ok) {
      console.log(`[MMani] homepage request failed status=${response.status}`);
      return "";
    }
    const html = await response.text();
    const token = html.match(/\}\)\(window\.fetch\s*,\s*["']([^"']+)["']\s*\)/i)?.[1]
      || html.match(/X-KF-Req["']\s*,\s*["']([^"']+)["']/i)?.[1];
    console.log(`[MMani] token found=${Boolean(token)} tokenLength=${token?.length || 0} homepageLength=${html.length}`);
    if (!token) {
      console.log("[MMani] request token was not found");
      return "";
    }

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
    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      console.log(`[MMani] JSON request failed url=${url}`, error);
      return null;
    }
    const body = await response.text();
    console.log(`[MMani] JSON request url=${url} status=${response.status} response=${body}`);
    if (!response.ok) {
      console.log(`[MMani] JSON request failed url=${url} status=${response.status}`);
      return null;
    }
    try {
      return JSON.parse(body);
    } catch (error) {
      console.log(`[MMani] invalid JSON response url=${url}`, error);
      return null;
    }
  }

  async requestText(url, options = {}) {
    const token = await this.getKfToken();
    const headers = {
      ...this.commonHeaders,
      "X-KF-Req": token,
      ...(options.headers || {}),
    };
    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      console.log(`[MMani] text request failed url=${url}`, error);
      return "";
    }
    if (!response.ok) {
      console.log(`[MMani] text request failed url=${url} status=${response.status}`);
      return "";
    }
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

    if (!mapped.length) console.log(`[MMani] no anime found for query=${query.query}`);
    return mapped;
  }

  async findEpisodes(id) {
    const payload = await this.requestJson(`${this.base}/ajax.php?episodes&epid=${encodeURIComponent(id)}`);
    if (!Array.isArray(payload)) {
      console.log(`[MMani] invalid episode list for id=${id}`);
      return [];
    }

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
    if (!episodes.length) console.log(`[MMani] no episodes found for id=${id}`);
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
    if (!Array.isArray(links)) {
      console.log(`[MMani] invalid server list for data=${details.data}`);
      return this.emptyEpisodeServer(server);
    }

    const selected = links.find((item) => String(item?.server || "") === String(server)) || links[0];
    if (!selected?.link) {
      console.log(`[MMani] server unavailable server=${server}`);
      return this.emptyEpisodeServer(server);
    }

    const refererHeaders = {
      "Referer": `${this.base}/`,
    };
    const playerHtml = await this.requestText(selected.link, { headers: refererHeaders });
    const playerConfig = this.extractPlayerConfig(playerHtml);
    if (!playerConfig?.videoUrl) {
      console.log(`[MMani] player configuration not found url=${selected.link}`);
      return this.emptyEpisodeServer(selected.server || server);
    }

    const streamUrl = this.resolveUrl(playerConfig.videoUrl, selected.link, "video");
    if (!streamUrl) return this.emptyEpisodeServer(selected.server || server);
    const subtitles = (Array.isArray(playerConfig.tracks) ? playerConfig.tracks : [])
      .filter((track) => track && track.file && String(track.kind || "captions").toLowerCase() === "captions")
      .map((track, index) => {
        const subtitleUrl = this.resolveUrl(track.file, selected.link, "subtitle");
        if (!subtitleUrl) return null;
        return {
          id: `mmani-${index + 1}`,
          url: subtitleUrl,
          language: String(track.label || "English"),
          isDefault: Boolean(track.default) || index === 0,
        };
      })
      .filter(Boolean);

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

  emptyEpisodeServer(server) {
    return {
      server: String(server || "MMani"),
      headers: { ...this.commonHeaders },
      videoSources: [],
    };
  }

  resolveUrl(value, base, type) {
    try {
      return new URL(value, base).toString();
    } catch (error) {
      console.log(`[MMani] invalid ${type} URL value=${value}`, error);
      return "";
    }
  }

  extractPlayerConfig(html) {
    const match = html.match(/window\.PLAYER_CONFIG\s*=\s*(\{[\s\S]*\})\s*;?\s*<\/script>/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      console.log("[MMani] invalid PLAYER_CONFIG JSON", error);
      return null;
    }
  }
}
