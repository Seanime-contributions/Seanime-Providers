/// <reference path="../online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
  }

  getSettings() {
    return {
      episodeServers: ["CLOUD", "DRIVE", "PROXY"],
      supportsDub: false,
    };
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const homeRes = await fetch(`${this.baseUrl}/`, {
      headers: { "Accept": "text/html,application/xhtml+xml" },
    });
    if (!homeRes.ok) throw new Error(`Failed to load MyNimeku search form (HTTP ${homeRes.status})`);
    const homeHtml = await homeRes.text();
    const searchForm = homeHtml.match(/<form\b(?=[^>]*\bdata-live-search-form\b)[^>]*>/i)?.[0];
    const nonce = searchForm ? getHtmlAttribute(searchForm, "data-nonce") : "";
    if (!nonce) throw new Error("Could not find MyNimeku live-search nonce");

    const body = [
      `action=${encodeURIComponent("mynimeku_live_search")}`,
      `nonce=${encodeURIComponent(nonce)}`,
      `keyword=${encodeURIComponent(query.query)}`,
    ].join("&");

    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": this.baseUrl,
        "Referer": `${this.baseUrl}/`,
      },
      body,
    });

    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.success === false ? [] : data?.data?.items ?? [];
    const seen = new Set();

    return items
      .filter(item => item?.type !== "MANGA" && typeof item.url === "string" && item.url.includes("/series/"))
      .filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .map(item => ({
        id: item.url,
        title: item.title?.trim() || "Unknown",
        url: item.url,
        image: item.cover,
        subOrDub: "sub",
      }));
  }

  async findEpisodes(id) {
    const res = await fetch(id);
    if (!res.ok) throw new Error(`Failed to fetch MyNimeku series page (HTTP ${res.status})`);
    const html = await res.text();
    const episodes = [];

    const linkRegex = /<a\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bkomik-series-chapter-item\b[^"']*\1)[^>]*>[\s\S]*?<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const linkTag = linkMatch[0].match(/^<a\b[^>]*>/i)?.[0] || "";
      const number = Number(getHtmlAttribute(linkTag, "data-episode-number"));
      const rawUrl = getHtmlAttribute(linkTag, "href");
      const titleMatch = linkMatch[0].match(/<span\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bkomik-series-chapter-item__title\b[^"']*\1)[^>]*>([\s\S]*?)<\/span>/i);
      const title = titleMatch ? decodeHtml(titleMatch[2].replace(/<[^>]*>/g, "")).trim() : "";
      if (!Number.isFinite(number) || !rawUrl) continue;
      const url = new URL(rawUrl, id).toString();
      episodes.push({ id: url, title, number, url });
    }

    return episodes.sort((a, b) => a.number - b.number);
  }

  async findEpisodeServer(episode, server) {
    const res = await fetch(episode.url);
    if (!res.ok) throw new Error(`Failed to fetch MyNimeku episode page (HTTP ${res.status})`);
    const html = await res.text();

    const candidates = [];
    const buttonRegex = /<button\b[^>]*>/gi;
    let buttonMatch;
    while ((buttonMatch = buttonRegex.exec(html)) !== null) {
      const button = buttonMatch[0];
      const classes = getHtmlAttribute(button, "class") || "";
      if (!classes.split(/\s+/).includes("mynimeku-episode-server-btn")) continue;
      const rawUrl = getHtmlAttribute(button, "data-player-url");
      if (!rawUrl) continue;
      const url = new URL(rawUrl, episode.url).toString();
      const host = (getHtmlAttribute(button, "data-player-host") || "").toUpperCase();

      const resolutionMatch = host.match(/(\d+)P\b/);
      candidates.push({ url, host, resolution: resolutionMatch ? Number(resolutionMatch[1]) : 0 });
    }

    const targetServer = String(server || "").toUpperCase();
    const matchingCandidates = targetServer && targetServer !== "DEFAULT"
      ? candidates.filter(candidate => candidate.host.includes(targetServer))
      : candidates;
    const eligibleCandidates = matchingCandidates.length ? matchingCandidates : candidates;

    if (!eligibleCandidates.length) throw new Error("No server URL found");
    eligibleCandidates.sort((a, b) => b.resolution - a.resolution);
    const selected = eligibleCandidates[0];

    return {
      server: server || "Default",
      headers: {
        "Referer": `${this.baseUrl}/`,
      },
      videoSources: [
        { url: selected.url, type: "mp4", quality: selected.resolution ? `${selected.resolution}p` : "auto", subtitles: [] },
      ],
    };
  }
}

function getHtmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:(["'])([\\s\\S]*?)\\1|([^\\s>]+))`, "i"));
  return match ? decodeHtml(match[2] ?? match[3] ?? "") : "";
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
