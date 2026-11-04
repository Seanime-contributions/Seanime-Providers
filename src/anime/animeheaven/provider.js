/// <reference path="./online-streaming-provider.d.ts" />
class Provider {
  constructor() {
    this.base = "https://animeheaven.me";
  }

  getSettings() {
    return {
      episodeServers: ["Server 1"],
      supportsDub: false,
    };
  }

  async search(query) {
    const res = await fetch(`${this.base}/search.php?s=${encodeURIComponent(query.query)}`);
    const html = await res.text();
    const regex = /<div class='similarimg'>.*?<a href='(anime\.php\?.*?)'><img.*?alt='(.*?)'/gs;
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = `${this.base}/${match[1]}`;
      const title = match[2].replace(/&#039;/g, "'");
      const id = match[1].replace("anime.php?", "");
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

  async findEpisodes(id) {
    const url = `${this.base}/anime.php?${id}`;
    console.log("findEpisodes fetching:", url);
    const res = await fetch(url);
    const html = await res.text();
    console.log("findEpisodes html length:", html.length);
    console.log("findEpisodes html snippet:", html.slice(0, 500));

    // Each episode is an anchor with a stable id. The inline gatea handler
    // contains inconsistent whitespace, so use the anchor id instead.
    const regex = /<a\b([^>]*\bid\s*=\s*["'][^"']+["'][^>]*)>[\s\S]*?<div[^>]*\bwatch2\b[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/div>[\s\S]*?<\/a>/gi;
    const episodes = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      const gateKey = match[1].match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const number = Number.parseFloat(match[2]);
      if (!gateKey || !Number.isFinite(number)) continue;
      episodes.push({
        id: gateKey,
        title: `Episode ${number}`,
        number,
        url: `${this.base}/gate.php`,
      });
    }

    // Sort ascending since the page lists newest first
    episodes.sort((a, b) => a.number - b.number);
    return episodes;
  }

  async findEpisodeServer(episode, _server) {
    const gateKey = episode.id;
    const animeReferer = `${this.base}/anime.php`;
    const res = await fetch(`${this.base}/gate.php`, {
      headers: {
        "Cookie": `key=${gateKey}`,
        "Referer": animeReferer,
      },
    });
    const html = await res.text();

    // Only inspect the actual player element. The page may contain a
    // commented-out <source> near the title that points to a stale/wrong MP4.
    let videoUrl = null;
    const playerMatch = html.match(/<video\b(?=[^>]*\bid\s*=\s*["']vid["'])[^>]*>([\s\S]*?)<\/video\s*>/i);
    if (playerMatch) {
      const sourceRegex = /<source\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
      let sourceMatch;
      while ((sourceMatch = sourceRegex.exec(playerMatch[1])) !== null) {
        if (/\.mp4(?:[?#]|$)/i.test(sourceMatch[2])) {
          videoUrl = sourceMatch[2].replace(/&amp;/gi, "&");
          break;
        }
      }
    }

    // Secondary fallback: use the explicit Download Episode anchor.
    if (!videoUrl) {
      const anchorRegex = /<a\b([^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*)>([\s\S]*?)<\/a\s*>/gi;
      let anchorMatch;
      while ((anchorMatch = anchorRegex.exec(html)) !== null) {
        const href = anchorMatch[3].replace(/&amp;/gi, "&");
        const label = `${anchorMatch[1]} ${anchorMatch[4]}`;
        if (/Download\s+Episode\b/i.test(label) && /\/video\.mp4(?:[?#]|$)/i.test(href)) {
          videoUrl = href;
          break;
        }
      }
    }

    // Fallback: reconstruct from known pattern using tokens in the page
    if (!videoUrl) {
      const tokenMatch = html.match(/video\.mp4\?([a-f0-9]+)&([a-f0-9]+)/);
      if (tokenMatch) {
        videoUrl = `https://ax.animeheaven.me/video.mp4?${tokenMatch[1]}&${tokenMatch[2]}`;
      }
    }

    if (!videoUrl) throw new Error("Video URL not found in gate.php response");

    return {
      server: "Server 1",
      headers: {
        "Referer": "https://animeheaven.me/",
        "Origin": "https://animeheaven.me",
      },
      videoSources: [
        {
          url: videoUrl,
          quality: "auto",
          type: "mp4",
          subtitles: [],
        },
      ],
    };
  }
}
