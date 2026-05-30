/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://anidao.to";
  }

  getSettings() {
    return {
      episodeServers: [
        "HD-2 SUB", "HD-2 DUB",
        "StreamHG SUB", "StreamHG DUB",
        "Earnvids SUB", "Earnvids DUB",
      ],
      supportsDub: true,
    };
  }

  async search(query) {
    const searchUrl = `${this.base}/search?q=${encodeURIComponent(query.query)}`;
    const res = await fetch(searchUrl);
    const html = await res.text();

    const results = [];

    const cardRegex = /<article class="an-anime-card">([\s\S]*?)<\/article>/g;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];

      const hrefMatch = card.match(/<a class="an-anime-card__image"[^>]+href="([^"]+)"/);
      const titleMatch = card.match(/<a class="an-anime-card__image"[^>]+title="([^"]+)"/);

      if (!hrefMatch || !titleMatch) continue;

      const url = this.base + hrefMatch[1];
      const title = titleMatch[1].trim();

      results.push({
        id: url,
        title: title,
        url: url,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const res = await fetch(id);
    const html = await res.text();
    const episodes = [];

    const rowRegex = /<article class="an-episode-row">([\s\S]*?)<\/article>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
      const row = match[1];

      const hrefMatch = row.match(/<a class="an-episode-row__thumb"[^>]+href="([^"]+)"/);
      const titleMatch = row.match(/<h3 class="an-episode-row__title"><a[^>]+>([^<]+)<\/a>/);

      if (!hrefMatch) continue;

      const epUrl = this.base + hrefMatch[1];
      const epTitle = titleMatch ? titleMatch[1].trim() : "";

      const numberMatch = hrefMatch[1].match(/episode-(\d+)$/i);
      const number = numberMatch ? parseInt(numberMatch[1]) : 0;

      episodes.push({
        id: epUrl,
        title: epTitle,
        number: number,
        url: epUrl,
      });
    }

    const seenUrls = new Set();
    const seenNumbers = new Set();
    const deduped = [];
    for (const ep of episodes) {
      if (seenUrls.has(ep.url) || (ep.number !== 0 && seenNumbers.has(ep.number))) continue;
      seenUrls.add(ep.url);
      if (ep.number !== 0) seenNumbers.add(ep.number);
      deduped.push(ep);
    }

    deduped.sort((a, b) => a.number - b.number);

    return deduped;
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(episode.url);
    const html = await res.text();

    const serverBtnMap = {
      "HD-2 SUB":     ["hsub-2", "sub-2"],
      "HD-2 DUB":     ["dub-2"],
      "StreamHG SUB": ["hsub-3", "sub-3"],
      "StreamHG DUB": ["dub-3"],
      "Earnvids SUB": ["hsub-4", "sub-4"],
      "Earnvids DUB": ["dub-4"],
    };

    const btnKeys = serverBtnMap[server];
    if (!btnKeys) throw new Error(`Unknown server: ${server}`);

    let embedUrl = null;
    for (const key of btnKeys) {
      const btnRegex = new RegExp(
        `data-an-server-btn="${key}"[^>]+data-an-video="([^"]+)"`,
        "i"
      );
      const btnRegex2 = new RegExp(
        `data-an-video="([^"]+)"[^>]+data-an-server-btn="${key}"`,
        "i"
      );
      const m = html.match(btnRegex) || html.match(btnRegex2);
      if (m) {
        embedUrl = m[1];
        break;
      }
    }

    if (!embedUrl) throw new Error(`No embed URL found for server: ${server}`);

    // vibeplayer.site (HD-2)
    if (embedUrl.includes("vibeplayer.site")) {
      const embedRes = await fetch(embedUrl);
      const embedHtml = await embedRes.text();

      const srcMatch = embedHtml.match(/src\s*=\s*["']([^"']+\.m3u8[^"']*)['"]/i)
        || embedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);

      if (srcMatch) {
        return {
          server: server,
          videoSources: [{
            url: srcMatch[1],
            quality: "auto",
            type: "hls",
          }],
        };
      }
    }

    // otakuhg.site (StreamHG) packed JS
    if (embedUrl.includes("otakuhg.site")) {
      const embedRes = await fetch(embedUrl);
      const embedHtml = await embedRes.text();

      const unpacked = this.unPack(embedHtml);
      if (unpacked) {
        const m3u8Match = unpacked.match(/"(?:hls2|hls3|hls4|hls)":\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
        if (m3u8Match) {
          return {
            server: server,
            videoSources: [{
              url: m3u8Match[1],
              quality: "auto",
              type: "hls",
            }],
          };
        }

        const anyM3u8 = unpacked.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
        if (anyM3u8) {
          return {
            server: server,
            videoSources: [{
              url: anyM3u8[1],
              quality: "auto",
              type: "hls",
            }],
          };
        }
      }
    }

    // otakuvid.online (Earnvids) packed JS
    if (embedUrl.includes("otakuvid.online")) {
      const embedRes = await fetch(embedUrl, {
        headers: { Referer: embedUrl },
      });
      const embedHtml = await embedRes.text();

      const unpacked = this.unPack(embedHtml);
      if (unpacked) {
        const m3u8Match = unpacked.match(/"(?:hls2|hls3|hls4|hls)":\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
        if (m3u8Match) {
          return {
            server: server,
            headers: { Referer: embedUrl },
            videoSources: [{
              url: m3u8Match[1],
              quality: "auto",
              type: "hls",
            }],
          };
        }

        const anyM3u8 = unpacked.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/);
        if (anyM3u8) {
          return {
            server: server,
            headers: { Referer: embedUrl },
            videoSources: [{
              url: anyM3u8[1],
              quality: "auto",
              type: "hls",
            }],
          };
        }
      }
    }

    throw new Error(`Could not extract stream from ${embedUrl}`);
  }

  // Dean Edwards unpacker (handles both eval-based packing styles)
  unPack(code) {
    const regex = /eval\(function\(p,a,c,k,e,(?:r|d)\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/;
    const match = code.match(regex);
    if (!match) return null;

    let [_, p, a, c, k] = match;
    a = parseInt(a);
    c = parseInt(c);
    k = k.split('|');

    const e = (n) => {
      return (n < a ? '' : e(Math.floor(n / a))) +
        ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    };

    for (let i = c - 1; i >= 0; i--) {
      if (k[i]) {
        p = p.replace(new RegExp('\\b' + e(i) + '\\b', 'g'), k[i]);
      }
    }

    return p.replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
}
