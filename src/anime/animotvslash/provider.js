/// <reference path="./online-streaming-provider.d.ts" />
class Provider {
  constructor() {
    this.base = "https://animotvslash.org";
    this.streamApi = "https://animotvslash.ru";
    this.referer = "https://animotvslash.ru/";
  }

  getSettings() {
    return {
      episodeServers: ["HD-2", "HD-1", "Hard SUB"],
      supportsDub: false,
    };
  }

  async search(query) {
    const res = await fetch(
      `${this.base}/?s=${encodeURIComponent(query.query)}`,
      { headers: { Referer: this.referer } }
    );
    const html = await res.text();

    const results = [];
    let match;
    const articleRegex =
      /<article\b[^>]*class\s*=\s*["'][^"']*\bbs\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;

    while ((match = articleRegex.exec(html)) !== null) {
      const anchor = match[1].match(
        /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\btitle\s*=\s*["']([^"']*)["'][^>]*\brel\s*=\s*["'](\d+)["']/i
      );
      if (!anchor) continue;

      const href = anchor[1];
      const title = anchor[2].replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
      const animeId = anchor[3];

      results.push({
        id: `${animeId}|${href}`,
        title,
        url: href,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const [animeId, animeUrl] = id.split("|");
    const url = animeUrl || `${this.base}/${id}`;
    console.log("findEpisodes fetching:", url);

    const res = await fetch(url, { headers: { Referer: this.referer } });
    const html = await res.text();
    console.log("findEpisodes html length:", html.length);

    const listMatch = html.match(
      /<ul\b[^>]*\bid\s*=\s*["']ts-ep-list["'][^>]*>([\s\S]*?)<\/ul>/i
    );
    const scope = listMatch ? listMatch[1] : html;

    const epRegex =
      /<li\b[^>]*>[\s\S]*?<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
    const episodes = [];
    let match;

    while ((match = epRegex.exec(scope)) !== null) {
      const numMatch = match[2].match(
        /class\s*=\s*["']epl-num["'][^>]*>\s*(\d+(?:\.\d+)?)\s*</i
      );
      const number = numMatch ? Number.parseFloat(numMatch[1]) : null;
      if (number === null || !Number.isFinite(number)) continue;

      episodes.push({
        id: `${animeId}|${number}|${match[1]}`,
        title: `Episode ${number}`,
        number,
        url: match[1],
        animeId,
      });
    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const [animeId, number] = episode.id.split("|");

    const epPageUrl = episode.url || episode.id.split("|")[2];
    let resolvedAnimeId = animeId;

    if (epPageUrl) {
      try {
        const pageRes = await fetch(epPageUrl, {
          headers: { Referer: this.referer },
        });
        const pageHtml = await pageRes.text();

        const iframeMatch = pageHtml.match(
          /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']*\/watch\/(\d+)\/(\d+(?:\.\d+)?)[^"']*)["']/i
        );
        if (iframeMatch) {
          resolvedAnimeId = iframeMatch[2];
        }
      } catch (e) {
        console.log("episode page fetch failed, falling back", e.message);
      }
    }

    const apiUrl = `${this.streamApi}/api/stream/sources/koto?anilistId=${encodeURIComponent(
      resolvedAnimeId
    )}&episode=${encodeURIComponent(number)}&lang=sub`;

    const res = await fetch(apiUrl, {
      headers: {
        Referer: this.referer,
        Origin: this.streamApi,
      },
    });
    if (!res.ok) throw new Error(`Stream API responded ${res.status}`);
    const data = await res.json();

    const wanted = (server || "").toLowerCase();
    let source = null;

    if (wanted.includes("hard") || wanted.includes("h-sub")) {
      source = (data.sources || []).find((s) => /H-SUB/i.test(s.name));
    } else if (wanted.includes("hd-1")) {
      source = (data.sources || []).find((s) => /^HD-1$/i.test(s.name));
    } else if (wanted.includes("hd-2")) {
      source = (data.sources || []).find((s) => /^HD-2$/i.test(s.name));
    }

    if (!source && data.sources && data.sources.length) {
      source = data.sources[0];
    }
    if (!source) throw new Error("No video sources returned");

    const subtitles = (data.subtitles || [])
      .filter((s) => s && s.url)
      .map((s, index) => ({
        id: `animotvslash-subtitle-${index + 1}`,
        url: s.url,
        language: s.language || s.label || "Unknown",
        isDefault: Boolean(s.default) || index === 0,
      }));

    return {
      server: server || source.name,
      headers: {
        Referer: this.referer,
        Origin: this.streamApi,
      },
      videoSources: [
        {
          url: source.url,
          quality: source.name || "auto",
          type: data.type === "hls" ? "m3u8" : "mp4",
          subtitles,
        },
      ],
    };
  }
}
