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
    const res = await fetch(this.proxy(`${this.baseUrl}/?s=${encodeURIComponent(query.query)}`));
    const html = await res.text();

    const results = [];
    const regex = /<article[^>]*class="(?![^"]*type-manga)[^"]*"[^>]*>.*?<a[^>]*href="(.*?)"[^>]*title="(.*?)"[^>]*>.*?<img[^>]*src="(.*?)"/gs;

    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        id: match[1],
        title: match[2].trim(),
        url: match[1],
        image: match[3],
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

    const epRegex = /<div class="eps-wrapper">.*?<a href="(.*?)"><item>(.*?)<\/item><\/a>.*?<span class="lchx"><a[^>]*>(.*?)<\/a>/gs;

    let match;
    while ((match = epRegex.exec(html)) !== null) {
      episodes.push({
        id: match[1],
        title: match[3].trim(),
        number: parseInt(match[2].trim()),
        url: match[1],
      });
    }

    return episodes.reverse();
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(this.proxy(episode.url));
    const html = await res.text();

    const serverRegex = /<button[^>]*class="server-btn[^"]*"[^>]*data-player-url="(.*?)"[^>]*>\s*(.*?)\s*<\/button>/g;

    const candidates = [];
    let match;
    const targetServer = server.toUpperCase();

    while ((match = serverRegex.exec(html)) !== null) {
      const url = match[1];
      const name = match[2].toUpperCase();

      if (name.includes(targetServer)) {
        const resolutionMatch = name.match(/(\d+)[pP]/);
        const resolution = resolutionMatch ? parseInt(resolutionMatch[1]) : 0;

        candidates.push({
          url: url,
          name: name,
          resolution: resolution,
        });
      }
    }

    if (candidates.length === 0) {
      const firstMatch = html.match(/data-player-url="(.*?)"/);
      if (firstMatch) {
        candidates.push({ url: firstMatch[1], resolution: 0 });
      } else {
        throw new Error("No server URL found");
      }
    }

    candidates.sort((a, b) => b.resolution - a.resolution);
    const selectedUrl = candidates[0].url;

    const playerRes = await fetch(this.proxy(selectedUrl));
    const playerHtml = await playerRes.text();

    let scriptHtml = playerHtml;
    const iframeMatch = playerHtml.match(/<iframe[^>]*src="(.*?)"/);
    if (iframeMatch && !playerHtml.includes("eval(function")) {
      const iframeRes = await fetch(this.proxy(iframeMatch[1]));
      scriptHtml = await iframeRes.text();
    }

    const packedRegex = /eval\(function\(p,a,c,k,e,d\).*?\.split\('\|'\).*?\)\)/s;
    const packedMatch = scriptHtml.match(packedRegex);

    if (!packedMatch) throw new Error("Packed script not found");

    const unpacked = this.unpack(packedMatch[0]);

    const fileMatch = unpacked.match(/file"?\s*:\s*"(.*?)"/);
    if (!fileMatch) throw new Error("Video source not found in unpacked script");

    return {
      server: server,
      videoSources: [
        {
          url: fileMatch[1],
          quality: "auto",
          type: "mp4",
        },
      ],
    };
  }

  unpack(packedCode) {
    try {
      const regex = /\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/;
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
