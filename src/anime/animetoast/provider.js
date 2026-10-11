class Provider {
  constructor() {
    this.base = "https://www.animetoast.cc";
  }

  getSettings() {
    return {
      episodeServers: ["mp4"],
      supportsDub: true,
    };
  }

  async search(query) {
    const url = `${this.base}/?s=${encodeURIComponent(query.query)}`;
    const res = await fetch(url);
    const html = await res.text();
    
    const results = [];
    
    const regex = /<div id="post-\d+"[^>]*>[\s\S]*?<h3><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const rawTitle = match[2];
      
      const cleanedTitle = rawTitle.replace(/\s*Ger\s*(Sub|Dub)\s*/gi, '').trim();
      const id = url.replace(this.base, '').replace(/^\//, '').replace(/\/$/, '');
      const isDub = rawTitle.toLowerCase().includes('dub');
      
      results.push({
        id: id,
        title: cleanedTitle,
        url: url,
        subOrDub: isDub ? "dub" : "sub",
      });
    }
    
    if (!results.length) {
      throw new Error("No anime found");
    }
    
    if (query.dub) {
      results.sort((a, b) => {
        if (a.subOrDub === "dub" && b.subOrDub !== "dub") return -1;
        if (a.subOrDub !== "dub" && b.subOrDub === "dub") return 1;
        return 0;
      });
    }
    
    return results;
  }

  async findEpisodes(id) {
    try {
      const res = await fetch(`${this.base}/${id}/`);
      const html = await res.text();
      
      const episodes = [];
      const serverMap = await this.parseServerTabs(html);
      
      let tabContent = null;
      
      if (serverMap.mp4 !== undefined) {
        const mp4TabRegex = new RegExp(`<div[^>]*id="multi_link_tab${serverMap.mp4}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
        const mp4Match = html.match(mp4TabRegex);
        if (mp4Match) tabContent = mp4Match[1];
      }
      
      if (!tabContent) {
        const firstTabRegex = /<div[^>]*id="multi_link_tab\d+"[^>]*>([\s\S]*?)<\/div>/i;
        const firstMatch = html.match(firstTabRegex);
        if (firstMatch) tabContent = firstMatch[1];
      }
      
      if (tabContent) {
        const epRegex = /Ep\.?\s*(\d+)/gi;
        let epMatch;
        const episodeNumbers = new Set();
        
        while ((epMatch = epRegex.exec(tabContent)) !== null) {
          episodeNumbers.add(parseInt(epMatch[1]));
        }
        
        for (const epNum of Array.from(episodeNumbers).sort((a, b) => a - b)) {
          episodes.push({
            id: `${id}-${epNum}`,
            title: `Episode ${epNum}`,
            number: epNum,
            url: `${this.base}/${id}/`,
          });
        }
      }
      
      if (episodes.length === 0) {
        throw new Error("No episodes found");
      }
      
      console.log(`Found ${episodes.length} episodes`);
      return episodes;
      
    } catch (error) {
      console.error("Error in findEpisodes:", error);
      throw new Error(`Failed to fetch episodes: ${error.message}`);
    }
  }

  async parseServerTabs(html) {
    const serverMap = {};
    const tabHeaderRegex = /<a[^>]*data-toggle="tab"[^>]*href="#multi_link_tab(\d+)"[^>]*>([^<]+)<\/a>/gi;
    let tabMatch;
    
    while ((tabMatch = tabHeaderRegex.exec(html)) !== null) {
      const tabId = parseInt(tabMatch[1]);
      const tabName = tabMatch[2].toLowerCase().trim();
      
      if (tabName.includes('mp4upload')) {
        serverMap.mp4 = tabId;
      }
    }
    
    console.log("Server tab mapping:", serverMap);
    return serverMap;
  }

  async findEpisodeServer(episode, server) {
    const animeId = episode.id.split('-').slice(0, -1).join('-');
    const animeUrl = `${this.base}/${animeId}/`;
    
    const res = await fetch(animeUrl);
    const html = await res.text();
    
    const serverMap = await this.parseServerTabs(html);
    
    if (!serverMap[server]) {
      throw new Error(`Server ${server} not available for this anime`);
    }
    
    const tabId = serverMap[server];
    
    const tabRegex = new RegExp(`<div[^>]*id="multi_link_tab${tabId}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
    const tabMatch = html.match(tabRegex);
    
    if (!tabMatch) {
      throw new Error(`Tab for server ${server} not found`);
    }
    
    const tabContent = tabMatch[1];
    
    let linkParam = null;
    
    const exactRegex = new RegExp(`href="[^"]*\\?link=(\\d+)"[^>]*>[^<]*Ep\\.?\\s*${episode.number}\\b`, 'i');
    const exactMatch = tabContent.match(exactRegex);
    
    if (exactMatch) {
      linkParam = exactMatch[1];
    } else {
      const allLinks = tabContent.match(/href="[^"]*\?link=(\d+)"/gi);
      if (allLinks && allLinks.length >= episode.number) {
        const epLink = allLinks[episode.number - 1];
        const linkMatch = epLink.match(/\?link=(\d+)/);
        if (linkMatch) {
          linkParam = linkMatch[1];
        }
      }
    }
    
    if (!linkParam) {
      throw new Error(`Could not find link parameter for episode ${episode.number} on server ${server}`);
    }
    
    const episodeUrl = `${animeUrl}?link=${linkParam}`;
    console.log(`Fetching ${server} episode ${episode.number} from: ${episodeUrl}`);
    
    if (server === "mp4") {
      return await this.handleMp4Upload(episodeUrl);
    }
    
    throw new Error(`Server ${server} not implemented`);
  }

  async handleMp4Upload(episodeUrl) {
    try {
      const res = await fetch(episodeUrl);
      const html = await res.text();
      
      let embedUrl = null;
      
      const iframeRegex1 = /<iframe[^>]*src="(https:\/\/www\.mp4upload\.com\/[^"]+)"[^>]*/i;
      const iframeMatch1 = html.match(iframeRegex1);
      if (iframeMatch1) embedUrl = iframeMatch1[1];
      
      if (!embedUrl) {
        const iframeRegex2 = /<iframe[^>]*src="([^"]*mp4upload[^"]*)"[^>]*/i;
        const iframeMatch2 = html.match(iframeRegex2);
        if (iframeMatch2) embedUrl = iframeMatch2[1];
      }
      
      if (!embedUrl) {
        throw new Error("mp4upload iframe not found");
      }
      
      console.log(`Found mp4upload embed URL: ${embedUrl}`);
      
      const embedRes = await fetch(embedUrl, {
        headers: {
          'Referer': 'https://www.animetoast.cc/'
        }
      });
      const embedHtml = await embedRes.text();
      
      let mp4Url = null;
      
      const mp4Regex1 = /src:\s*"([^"]*\.mp4)"/i;
      const mp4Match1 = embedHtml.match(mp4Regex1);
      if (mp4Match1) mp4Url = mp4Match1[1];
      
      if (!mp4Url) {
        const mp4Regex2 = /"src":"([^"]*\.mp4)"/i;
        const mp4Match2 = embedHtml.match(mp4Regex2);
        if (mp4Match2) mp4Url = mp4Match2[1].replace(/\\\//g, '/');
      }
      
      if (!mp4Url) {
        throw new Error("MP4 URL not found in embed page");
      }
      
      return {
        server: "mp4",
        headers: {
          'Referer': 'https://www.mp4upload.com/'
        },
        videoSources: [
          {
            url: mp4Url,
            quality: "auto",
            type: "mp4",
          },
        ],
      };
    } catch (error) {
      console.error("Error in handleMp4Upload:", error);
      throw error;
    }
  }
}
