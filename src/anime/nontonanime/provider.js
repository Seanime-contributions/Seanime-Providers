/// <reference path="../online-streaming-provider.d.ts" />
class Provider {
  constructor() {
    this.base = "https://www.nontonanimeid.my.id";
    this.userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["Server 1"],
      supportsDub: false,
    };
  }

  decodeBase64(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const input = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
    let output = "";
    for (let index = 0; index < input.length;) {
      const a = alphabet.indexOf(input.charAt(index++));
      const b = alphabet.indexOf(input.charAt(index++));
      const c = alphabet.indexOf(input.charAt(index++));
      const d = alphabet.indexOf(input.charAt(index++));
      if (a < 0 || b < 0) break;
      output += String.fromCharCode((a << 2) | (b >> 4));
      if (c !== 64 && c >= 0) output += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== 64 && d >= 0) output += String.fromCharCode(((c & 3) << 6) | d);
    }
    return output;
  }

  extractAttribute(attributes, name) {
    const pattern = new RegExp(name + "\\s*=\\s*[\\\"']([^\\\"']*)[\\\"']", "i");
    const match = String(attributes || "").match(pattern);
    return match ? match[1].trim() : "";
  }

  decodeHtml(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  async search(query) {
    const response = await fetch(`${this.base}/search?q=${encodeURIComponent(query.query)}`, {
      headers: { "User-Agent": this.userAgent },
    });
    const html = await response.text();
    const results = [];
    const cardRegex = /<article\b[^>]*class=["'][^"']*\banime-card\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
    let cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const card = cardMatch[1];
      const linkMatch = card.match(/<a\b([^>]*)>/i);
      if (!linkMatch) continue;
      const url = this.decodeHtml(this.extractAttribute(linkMatch[1], "href"));
      if (!url) continue;
      const titleMatch = card.match(/<h2\b[^>]*class=["'][^"']*\bcard-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
      const title = (titleMatch ? titleMatch[1] : this.extractAttribute(linkMatch[1], "title"))
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title) continue;
      results.push({ id: url, title, url, subOrDub: "sub" });
    }
    if (!results.length) console.log("[NonTonAnime] No anime found");
    return results;
  }

  async findEpisodes(id) {
    const pageUrl = /^https?:\/\//i.test(String(id)) ? String(id) : `${this.base}/${String(id).replace(/^\/+/, "")}`;
    const response = await fetch(pageUrl, { headers: { "User-Agent": this.userAgent } });
    const html = await response.text();
    const episodes = [];
    const serverLists = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
    let serverMatch;
    let listMatch;
    while ((listMatch = serverLists.exec(html)) !== null) {
      const attributes = listMatch[1];
      if (/\bclass\s*=\s*["'][^"']*\bserverEpisode\b[^"']*["']/i.test(attributes)
        && /\bid\s*=\s*["']Server 1["']/i.test(attributes)) {
        serverMatch = listMatch;
        break;
      }
    }
    if (!serverMatch) {
      console.log("[NonTonAnime] Server 1 episode list not found");
      return [];
    }
    const episodeHtml = serverMatch[2];
    const episodeRegex = /<li\b[^>]*>[\s\S]*?\bdata-embed\s*=\s*["'][\s\S]*?<\/li>/gi;
    let episodeMatch;
    while ((episodeMatch = episodeRegex.exec(episodeHtml)) !== null) {
      const item = episodeMatch[0];
      const embedMatch = item.match(/\bdata-embed\s*=\s*(["'])(.*?)\1/i);
      const numberMatch = item.match(/<span\b[^>]*>([^<]+)<\/span>/i);
      if (!embedMatch || !numberMatch) continue;
      const streamUrl = this.decodeHtml(embedMatch[2].trim());
      const numberText = numberMatch[1].replace(/\s+/g, " ").trim();
      const number = Number.parseFloat(numberText);
      if (!streamUrl || !Number.isFinite(number)) continue;
      episodes.push({
        id: streamUrl,
        number,
        title: `Episode ${number}`,
        url: pageUrl,
        streamUrl,
        sourcePage: pageUrl,
      });
    }
    const unique = new Map();
    episodes.forEach(episode => {
      if (!unique.has(episode.number)) unique.set(episode.number, episode);
    });
    return [...unique.values()].sort((a, b) => a.number - b.number);
  }

  async resolveEmbed(streamUrl) {
    if (/\.m3u8(?:[?#&]|$)/i.test(streamUrl)) {
      return { url: streamUrl, type: "m3u8", quality: "auto" };
    }
    if (/\.mp4(?:[?#&]|$)/i.test(streamUrl)) {
      return { url: streamUrl, type: "mp4", quality: "auto" };
    }
    let embed;
    try {
      embed = new URL(streamUrl);
    } catch (_) {
      console.log("[NonTonAnime] Invalid episode stream URL", streamUrl);
      return null;
    }
    const encodedData = embed.searchParams.get("data");
    if (!encodedData) {
      console.log("[NonTonAnime] Unsupported episode embed URL", streamUrl);
      return null;
    }
    let data;
    try {
      data = JSON.parse(this.decodeBase64(encodedData));
    } catch (_) {
      console.log("[NonTonAnime] Could not decode episode embed data", streamUrl);
      return null;
    }
    if (!data.video) {
      console.log("[NonTonAnime] Episode embed has no video ID", streamUrl);
      return null;
    }
    const response = await fetch(`https://geo.dailymotion.com/videos/${encodeURIComponent(data.video)}`);
    if (!response.ok) {
      console.log(`[NonTonAnime] Dailymotion returned HTTP ${response.status}`);
      return null;
    }
    const payload = await response.json();
    const url = payload?.stream?.url;
    if (!url) {
      console.log("[NonTonAnime] Dailymotion returned no stream URL", data.video);
      return null;
    }
    return { url, type: "m3u8", quality: "auto" };
  }

  async findEpisodeServer(episode, server) {
    const streamUrl = episode?.streamUrl || episode?.id || episode?.url;
    if (!streamUrl) {
      console.log("[NonTonAnime] Episode has no stream URL", episode);
      return { server: server || "Server 1", headers: {}, videoSources: [] };
    }
    const source = await this.resolveEmbed(streamUrl);
    if (!source) return { server: server || "Server 1", headers: {}, videoSources: [] };
    const sourceHost = (() => {
      try { return new URL(source.url).hostname; } catch (_) { return ""; }
    })();
    const referer = /(?:rumble\.cloud|rumble\.com)$/i.test(sourceHost)
      ? "https://rumble.com/"
      : /dailymotion\.com$/i.test(sourceHost)
        ? "https://geo.dailymotion.com/"
        : episode.sourcePage || episode.url || this.base;
    return {
      server: server || "Server 1",
      headers: {
        Referer: referer,
        Origin: this.base,
        "User-Agent": this.userAgent,
      },
      videoSources: [{
        url: source.url,
        type: source.type,
        quality: source.quality,
        subtitles: [],
      }],
    };
  }
}
