/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
    this.proxyBase = "https://corsproxy.io?url=";
  }

  proxy(url) {
    return `${this.proxyBase}${encodeURIComponent(url)}`;
  }

  getSettings() {
    return {
      episodeServers: ["CLOUD", "DRIVE", "PROXY"],
      supportsDub: false,
    };
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/search/${encodeURIComponent(query.query)}/`;
    const res = await fetch(this.proxy(searchUrl));
    const html = await res.text();

    const results = [];
    const regex = /<a class="mynimeku-search-feed__cover"[^>]*href="(https:\/\/www\.mynimeku\.com\/series\/[^"]+)"[^>]*aria-label="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/gs;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const image = match[3];

      results.push({
        id: url,
        title,
        url,
        image,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const res = await fetch(this.proxy(id));
    const html = await res.text();
    const episodes = [];

    const epRegex = /<a[^>]*class='komik-series-chapter-item'[^>]*data-episode-number='(\d+)'[^>]*href='([^']+)'[^>]*>[\s\S]*?<span class='komik-series-chapter-item__title'>([^<]+)<\/span>/g;

    let match;
    while ((match = epRegex.exec(html)) !== null) {
      const number = parseInt(match[1]);
      const url = match[2];
      const title = match[3].trim();

      episodes.push({
        id: url,
        title,
        number,
        url,
      });
    }

    return episodes.reverse();
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(this.proxy(episode.url));
    const html = await res.text();

    const serverRegex = /<button[^>]*class='mynimeku-episode-server-btn[^']*'[^>]*data-player-url='([^']+)'[^>]*data-player-host='([^']+)'[^>]*>/g;

    const candidates = [];
    let match;
    const targetServer = server.toUpperCase();

    while ((match = serverRegex.exec(html)) !== null) {
      const url = match[1].replace(/&#038;/g, "&");
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

    const playerOrigin = new URL(selectedUrl).origin;

    const playerRes = await fetch(this.proxy(selectedUrl));
    const playerHtml = await playerRes.text();

    let scriptHtml = playerHtml;
    const iframeMatch = playerHtml.match(/<iframe[^>]*src="([^"]+)"/);
    if (iframeMatch && !playerHtml.includes("eval(function")) {
      const iframeRes = await fetch(this.proxy(iframeMatch[1]));
      scriptHtml = await iframeRes.text();
    }

    const packedRegex = /eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[\s\S]*?\)\)/;
    const packedMatch = scriptHtml.match(packedRegex);
    if (!packedMatch) throw new Error("Packed script not found");

    const unpacked = this.unpack(packedMatch[0]);

    const fileMatch = unpacked.match(/file"?\s*:\s*"([^"]+)"/);
    if (!fileMatch) throw new Error("Video source not found in unpacked script");

    const videoUrl = fileMatch[1];

    return {
      server: server,
      headers: {
        "Referer": playerOrigin + "/",
        "Origin": playerOrigin,
      },
      videoSources: [
        {
          url: videoUrl,
          type: "mp4",
        },
      ],
    };
  }

  unpack(packedCode) {
    try {
      const regex = /\}\('(.*)',(\d+),(\d+),'(.*)'\.split\('\|'\)/s;
      const m = packedCode.match(regex);
      if (!m) return "";

      let payload = m[1];
      const radix = parseInt(m[2]);
      const count = parseInt(m[3]);
      const keywords = m[4].split("|");

      const encode = (c) => {
        return (
          (c < radix ? "" : encode(parseInt(c / radix))) +
          ((c = c % radix) > 35 ? String.fromCharCode(c + 29) : c.toString(36))
        );
      };

      for (let i = count; i--; ) {
        if (keywords[i]) {
          payload = payload.replace(new RegExp("\\b" + encode(i) + "\\b", "g"), keywords[i]);
        }
      }
      return payload;
    } catch (e) {
      console.error("Unpack failed", e);
      return "";
    }
  }
}
