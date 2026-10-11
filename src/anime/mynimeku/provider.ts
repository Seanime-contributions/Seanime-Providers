/// <reference path="../online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
  }

  getSettings() {
    return {
      episodeServers: ["CLOUD", "DRIVE", "PROXY"],
      supportsDub: false,
    };
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const body = [
      `action=${encodeURIComponent("mynimeku_live_search")}`,
      `nonce=${encodeURIComponent("92e6c9e843")}`,
      `keyword=${encodeURIComponent(query.query)}`,
    ].join("&");

    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": this.baseUrl,
        "Referer": `${this.baseUrl}/`,
      },
      body,
    });

    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.success === false ? [] : data?.data?.items ?? [];
    const seen = new Set();

    return items
      .filter(item => item?.type !== "MANGA" && typeof item.url === "string" && item.url.includes("/series/"))
      .filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .map(item => ({
        id: item.url,
        title: item.title?.trim() || "Unknown",
        url: item.url,
        image: item.cover,
        subOrDub: "sub",
      }));
  }

  async findEpisodes(id) {
    const res = await fetch(id);
    const html = await res.text();
    const episodes = [];

    // Match each episode link block
    const epRegex = /<a[^>]*class='komik-series-chapter-item'[^>]*data-episode-number='(\d+)'[^>]*href='([^']+)'[^>]*>[\s\S]*?<span class='komik-series-chapter-item__title'>([^<]+)<\/span>/g;

    let match;
    while ((match = epRegex.exec(html)) !== null) {
      const number = parseInt(match[1]);
      const url    = match[2];
      const title  = match[3].trim();

      episodes.push({ id: url, title, number, url });
    }

    return episodes.reverse();
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(episode.url);
    const html = await res.text();

    const serverRegex = /<button[^>]*class='mynimeku-episode-server-btn[^']*'[^>]*data-player-url='([^']+)'[^>]*data-player-host='([^']+)'[^>]*>/g;

    const candidates = [];
    let match;
    const targetServer = server.toUpperCase();

    while ((match = serverRegex.exec(html)) !== null) {
      const url  = match[1].replace(/&#038;/g, "&");
      const host = match[2].toUpperCase();

      if (host.includes(targetServer)) {
        const resolutionMatch = host.match(/(\d+)[pP]/);
        const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 0;
        candidates.push({ url, host, resolution });
      }
    }

    if (candidates.length === 0) {
      const firstMatch = html.match(/data-player-url='([^']+)'/);
      if (firstMatch) {
        candidates.push({ url: firstMatch[1].replace(/&#038;/g, "&"), resolution: 0 });
      } else {
        throw new Error("No server URL found");
      }
    }

    candidates.sort((a, b) => b.resolution - a.resolution);
    const selectedUrl = candidates[0].url;

    return {
      server,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      videoSources: [
        { url: selectedUrl, type: "mp4" },
      ],
    };
  }
}
