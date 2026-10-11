/// <reference path="./online-streaming-provider.d.ts" />
class Provider {
  constructor() {
    this.base = "https://donghuastream.org";
    this.ua =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["Server 1", "Server 2"],
      supportsDub: false,
    };
  }

  // ---------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------

  async search(query) {
    const res = await fetch(`${this.base}/?s=${encodeURIComponent(query.query)}`, {
      headers: { "User-Agent": this.ua },
    });
    const html = await res.text();

    const results = [];
    const cardRegex = /<a href="([^"]+)" itemprop="url" title="([^"]+)"/g;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const id = url.replace(/^https?:\/\/[^/]+\/anime\//, "").replace(/\/$/, "");

      results.push({
        id,
        title,
        url,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  // ---------------------------------------------------------------------
  // episodes
  // ---------------------------------------------------------------------

  async findEpisodes(id) {
    const animePageUrl = `${this.base}/anime/${id}/`;
    const res = await fetch(animePageUrl, { headers: { "User-Agent": this.ua } });
    const html = await res.text();

    const epRegex =
      /<a href="([^"]+)"><div class="epl-num">([^<]+)<\/div><div class="epl-title">([^<]+)<\/div>/g;

    const episodes = [];
    let match;
    while ((match = epRegex.exec(html)) !== null) {
      const url = match[1];
      const epNumRaw = match[2].trim();
      const title = match[3].trim();

      const numMatch = epNumRaw.match(/(\d+(?:\.\d+)?)/);
      const number = numMatch ? parseFloat(numMatch[1]) : episodes.length + 1;

      episodes.push({
        id: url,
        number,
        title,
        url,
      });
    }

    // Listings are typically newest-first; sort ascending by episode number.
    episodes.sort((a, b) => a.number - b.number);

    if (!episodes.length) throw new Error("No episodes found");
    return episodes;
  }

  // ---------------------------------------------------------------------
  // streaming
  // ---------------------------------------------------------------------

  async findEpisodeServer(episode, server) {
    const res = await fetch(episode.url, { headers: { "User-Agent": this.ua } });
    const html = await res.text();

    const optionRegex = /<option value="([^"]+)" data-index="(\d+)">\s*([^<]+)<\/option>/g;
    const options = [];
    let match;
    while ((match = optionRegex.exec(html)) !== null) {
      options.push({ b64: match[1], index: match[2], label: match[3].trim() });
    }
    if (!options.length) throw new Error("No server options found on episode page");

    // "Server 1" -> the 1st option on the page, "Server 2" -> the 2nd, etc.
    const numMatch = server.match(/(\d+)$/);
    if (!numMatch) throw new Error(`Unrecognized server: ${server}`);
    const serverIndex = parseInt(numMatch[1], 10) - 1;

    const chosen = options[serverIndex];
    if (!chosen) throw new Error(`${server} is not available for this episode`);

    const decodedIframe = Buffer.from(chosen.b64, "base64").toString("utf8");
    const srcMatch = decodedIframe.match(/src="([^"]+)"/);
    if (!srcMatch) throw new Error("Could not find iframe src in decoded server option");
    const embedUrl = srcMatch[1];

    if (/dailymotion\.com/i.test(embedUrl)) {
      return this.scrapeDailymotion(embedUrl, server);
    }
    if (/rumble\.com/i.test(embedUrl)) {
      return this.scrapeRumble(embedUrl, server);
    }

    throw new Error(`No scraper implemented for embed host: ${embedUrl}`);
  }

  async scrapeDailymotion(embedUrl, server) {
    const res = await fetch(embedUrl, { headers: { "User-Agent": this.ua } });
    const html = await res.text();

    // Try to extract from PLAYER_CONFIG first (new method)
    const configMatch = html.match(/window\.__PLAYER_CONFIG__\s*=\s*({.*?});\s*<\/script>/s);
    if (configMatch) {
      try {
        const config = JSON.parse(configMatch[1]);
        const streamUrl = config?.criticalMetadata?.stream?.url;
        if (streamUrl) {
          const m3u8Url = streamUrl.replace(/\\\//g, "/");
          return {
            server,
            headers: { Referer: "https://geo.dailymotion.com/" },
            videoSources: [{ url: m3u8Url, quality: "auto", type: "m3u8", subtitles: [] }],
          };
        }
      } catch (e) {
        // If JSON parsing fails, fall through to old method
        console.warn("Failed to parse PLAYER_CONFIG, falling back to old method:", e.message);
      }
    }

    // Fallback to old method (manifestUrl)
    const manifestMatch = html.match(/"manifestUrl":"([^"]+)"/);
    if (!manifestMatch) throw new Error("manifestUrl not found on dailymotion embed");
    const m3u8Url = manifestMatch[1].replace(/\\\//g, "/");

    return {
      server,
      headers: { Referer: "https://geo.dailymotion.com/" },
      videoSources: [{ url: m3u8Url, quality: "auto", type: "m3u8", subtitles: [] }],
    };
  }

  async scrapeRumble(embedUrl, server) {
    const res = await fetch(embedUrl, { headers: { "User-Agent": this.ua } });
    const html = await res.text();

    // Try to extract from Rumble config (new method)
    // Look for the m.f["videoId"] = { ... } config object
    const configMatch = html.match(/m\.f\["([^"]+)"\]\s*=\s*({[^;]+);/);
    if (configMatch) {
      try {
        const configStr = configMatch[2];
        
        // Extract HLS URL (preferred - adaptive streaming)
        const hlsMatch = configStr.match(/"hls":\{"url":"([^"]+)"/);
        if (hlsMatch) {
          const streamUrl = hlsMatch[1].replace(/\\\//g, "/");
          return {
            server,
            headers: { Referer: "https://rumble.com/" },
            videoSources: [{ url: streamUrl, quality: "auto", type: "m3u8", subtitles: [] }],
          };
        }
        
        // Extract all quality levels from the "ua" object
        const videoSources = [];
        const qualityRegex = /"(\d+)":\{"url":"([^"]+)"/g;
        let qualityMatch;
        while ((qualityMatch = qualityRegex.exec(configStr)) !== null) {
          const quality = qualityMatch[1];
          const url = qualityMatch[2].replace(/\\\//g, "/");
          videoSources.push({ url, quality, type: "m3u8", subtitles: [] });
        }
        
        if (videoSources.length) {
          // Sort by quality (low to high)
          videoSources.sort((a, b) => parseInt(a.quality) - parseInt(b.quality));
          return {
            server,
            headers: { Referer: "https://rumble.com/" },
            videoSources,
          };
        }
      } catch (e) {
        console.warn("Failed to parse Rumble config, falling back to old method:", e.message);
      }
    }

    // Fallback to old method (tar URL)
    const match = html.match(/"tar":\{"url":"([^"]+)"/);
    if (!match) throw new Error("tar url not found on rumble embed");
    const streamUrl = match[1].replace(/\\\//g, "/");

    return {
      server,
      headers: { Referer: "https://rumble.com/" },
      videoSources: [{ url: streamUrl, quality: "auto", type: "m3u8", subtitles: [] }],
    };
  }
}