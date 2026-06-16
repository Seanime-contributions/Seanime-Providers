/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://www.animegg.org";
  }

  getSettings() {
    return {
      episodeServers: ["GG-SUB", "GG-DUB"],
      supportsDub: true,
    };
  }

  async search(query) {
    const isDub = query.opts && query.opts.dub;
    const res = await fetch(`${this.base}/search/?q=${encodeURIComponent(query.query)}`);
    const html = await res.text();

    const regex = /<a href="(\/series\/[^"]+)" class="mse">.*?<h2>(.*?)<\/h2>/gs;
    const results = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      const relativeUrl = match[1];
      const title = match[2];
      const id = relativeUrl.replace("/series/", "");

      results.push({
        id: id,
        title: title,
        url: `${this.base}${relativeUrl}`,
        subOrDub: isDub ? "dub" : "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const res = await fetch(`${this.base}/series/${id}`);
    const html = await res.text();
    const episodes = [];

    const epRegex = /<a href="([^"]+)" class="anm_det_pop">[\s\S]*?<strong>(.*?)<\/strong>[\s\S]*?<i class="anititle">(.*?)<\/i>/g;

    let match;
    while ((match = epRegex.exec(html)) !== null) {
      const href = match[1];
      const strongText = match[2];
      const italicText = match[3];

      let epNumStr = href.match(/-episode-(\d+)/);
      let epNum = epNumStr ? parseInt(epNumStr[1]) : 0;

      if (!epNum) {
        const numMatch = strongText.match(/(\d+)$/);
        epNum = numMatch ? parseInt(numMatch[1]) : 0;
      }

      episodes.push({
        id: href,
        title: italicText.trim(),
        number: epNum,
        url: `${this.base}${href}`,
      });
    }

    if (!episodes.length) throw new Error("No episodes found");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(episode.url);
    const html = await res.text();

    let targetTabId = server === "GG-DUB" ? "dubbed-Animegg" : "subbed-Animegg";

    if (!html.includes(`id="${targetTabId}"`)) {
      if (targetTabId === "subbed-Animegg" && html.includes('id="dubbed-Animegg"')) {
        targetTabId = "dubbed-Animegg";
        server = "GG-DUB";
      } else if (targetTabId === "dubbed-Animegg" && html.includes('id="subbed-Animegg"')) {
        targetTabId = "subbed-Animegg";
        server = "GG-SUB";
      } else {
        throw new Error("Selected server not found");
      }
    }

    const tabRegex = new RegExp(`<div id="${targetTabId}"[^>]*>\\s*<iframe src="(.*?)"`, "s");
    const iframeMatch = html.match(tabRegex);

    if (!iframeMatch) throw new Error("Embed iframe not found");

    const embedUrl = `${this.base}${iframeMatch[1]}`;
    const embedRes = await fetch(embedUrl);
    const embedHtml = await embedRes.text();

    const sourceMatch = embedHtml.match(/var\s+videoSources\s*=\s*(\[.*?\])/s);
    if (!sourceMatch) throw new Error("Video sources variable not found in embed");

    const rawSourceStr = sourceMatch[1];
    const parsedSources = [];

    const objRegex = /{.*?file:\s*"(.*?)".*?label:\s*"(.*?)".*?}/g;
    let objMatch;
    while ((objMatch = objRegex.exec(rawSourceStr)) !== null) {
      parsedSources.push({ file: objMatch[1], label: objMatch[2] });
    }

    if (!parsedSources.length) throw new Error("No video sources parsed from embed");

    const bestSource = parsedSources.reduce((prev, current) => {
      const prevQuality = parseInt(prev.label) || 0;
      const currQuality = parseInt(current.label) || 0;
      return currQuality > prevQuality ? current : prev;
    });

    if (!bestSource) throw new Error("No valid video source item found");

    const headers = { Referer: this.base };

    return {
      server: server,
      headers: headers,
      videoSources: [
        {
          url: `${this.base}${bestSource.file}`,
          quality: bestSource.label,
          type: "mp4",
          headers: headers,
        },
      ],
    };
  }
}
