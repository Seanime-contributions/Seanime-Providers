/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "https://www.agedm.io";
    // Mapping our allowed servers to the IDs found in the HTML tabs
    this.allowedServers = {
      "3": "playlist-source-bfzym3u8",
      "5": "playlist-source-hnm3u8",
      "6": "playlist-source-lzm3u8",
      "7": "playlist-source-wolong"
    };
  }

  getSettings() {
    return {
      episodeServers: ["Server 3", "Server 5", "Server 6", "Server 7"],
      supportsDub: false,
    };
  }

  async search(query) {
    const res = await fetch(`${this.base}/search?query=${encodeURIComponent(query.query)}`);
    const html = await res.text();

    // Regex to capture the URL from the h5 title and the Original Name (Other Name)
    const regex = /<h5 class="card-title"><a href="(.*?)">.*?<\/div><div class="video_detail_info"><span>其他名称：<\/span>(.*?)<\/div>/gs;
    const results = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      results.push({
        id: match[1].split("/detail/")[1], // Extract ID from URL
        title: match[2].trim(),
        url: match[1].startsWith('http') ? match[1] : `${this.base}${match[1]}`,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  async findEpisodes(id) {
    const res = await fetch(`${this.base}/detail/${id}`);
    const html = await res.text();
    const episodes = [];

    // We pick the first available server from our allowed list to return a single list
    let targetTabId = "";
    for (const key of ["3", "5", "6", "7"]) {
      if (html.includes(this.allowedServers[key])) {
        targetTabId = this.allowedServers[key];
        break;
      }
    }

    if (!targetTabId) throw new Error("No supported episode servers found");

    // Scrape only the episodes within the selected server's tab
    const tabRegex = new RegExp(`<div class="tab-pane[^>]*id="${targetTabId}".*?>(.*?)<\\/ul>`, "s");
    const tabMatch = html.match(tabRegex);

    if (tabMatch) {
      const epRegex = /<li><a href="(.*?)" class="video_detail_spisode_link">(.*?)<\/a><\/li>/g;
      let epMatch;
      while ((epMatch = epRegex.exec(tabMatch[1])) !== null) {
        episodes.push({
          id: epMatch[1], // This is the /play/... URL
          title: epMatch[2],
          number: parseInt(epMatch[2].replace(/\D/g, "")),
          url: `${this.base}${epMatch[1]}`,
        });
      }
    }

    return episodes;
  }

  async findEpisodeServer(episode, server) {
    // Determine which server index to use based on user selection or default
    // server name comes from getSettings().episodeServers
    const serverMap = { "Server 3": "3", "Server 5": "5", "Server 6": "6", "Server 7": "7" };
    const selectedKey = serverMap[server] || "3";
    
    // The episode ID passed from findEpisodes might be server-specific (e.g. /play/ID/1/1)
    // We adjust it to match the requested server
    const serverSpecificUrl = episode.url.replace(/\/play\/(\d+)\/\d+\//, `/play/$1/${selectedKey}/`);

    // 1. Go to the episode page
    const res = await fetch(serverSpecificUrl);
    const html = await res.text();

    // 2. Scrape the iframe source
    const iframeMatch = html.match(/<iframe id="iframeForVideo" src="(.*?)"/);
    if (!iframeMatch) throw new Error("Embed iframe not found");

    // 3. Go to the embed page to get the actual Vurl
    const embedRes = await fetch(iframeMatch[1]);
    const embedHtml = await embedRes.text();

    const vurlMatch = embedHtml.match(/var Vurl = '(.*?)'/);
    if (!vurlMatch) throw new Error("M3U8 stream URL not found");

    return {
      server: server,
      videoSources: [
        {
          url: vurlMatch[1],
          quality: "auto",
          type: "hls",
        },
      ],
    };
  }
}
