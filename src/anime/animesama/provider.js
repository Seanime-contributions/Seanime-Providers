/// <reference path="./online-streaming-provider.d.ts" />
class Provider {
  constructor() {
    this.base = "https://anime-sama.to";
    this.ua =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["SUB 1", "SUB 2", "SUB 3", "DUB 1", "DUB 2", "DUB 3"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------------
  // query parsing helpers
  // ---------------------------------------------------------------------

  /**
   * Detects a season/part indicator at the end of a query, e.g.
   * "Horimiya Season 1", "Horimiya Part 2", "Horimiya S2".
   * Returns { cleanTitle, season } where season is a number or null.
   */
  parseSeasonFromQuery(query) {
    const seasonRegex = /\s+(?:season|saison|part|cour)\s*(\d+)\s*$|\s+s(\d+)\s*$/i;
    const match = query.match(seasonRegex);
    if (!match) return { cleanTitle: query.trim(), season: null };
    const season = parseInt(match[1] || match[2], 10);
    return { cleanTitle: query.slice(0, match.index).trim(), season };
  }

  /**
   * Detects the "{title}-{tag}" alternative format, e.g. "Horimiya-piece".
   * Returns { cleanTitle, tag } (tag is null if not present).
   */
  parseTagFromQuery(query) {
    const match = query.match(/^(.*)-([a-zA-Z0-9]+)$/);
    if (!match) return { cleanTitle: query.trim(), tag: null };
    return { cleanTitle: match[1].trim(), tag: match[2].trim().toLowerCase() };
  }

  // ---------------------------------------------------------------------
  // search
  // ---------------------------------------------------------------------

  async search(query) {
    const rawQuery = query.query;

    // "{title}-{tag}" format takes priority over season detection.
    const { cleanTitle: tagCleanTitle, tag } = this.parseTagFromQuery(rawQuery);
    let searchTitle;
    let season = null;

    if (tag) {
      searchTitle = tagCleanTitle;
    } else {
      const parsed = this.parseSeasonFromQuery(rawQuery);
      searchTitle = parsed.cleanTitle;
      season = parsed.season; // null means "treat as season 1"
    }

    const res = await fetch(`${this.base}/catalogue/?search=${encodeURIComponent(searchTitle)}`, {
      headers: { "User-Agent": this.ua },
    });
    const html = await res.text();

    const results = [];
    // Each catalogue card is a <div class="shrink-0 catalog-card card-base">
    // wrapping an <a href>, an <h2 class="card-title"> for the title, and a
    // <p class="info-value"> that lists content types (e.g. "Anime, Scans").
    const cardRegex =
      /<div class="shrink-0 catalog-card card-base">[\s\S]*?<a href="([^"]+)">[\s\S]*?<h2 class="card-title">([^<]+)<\/h2>[\s\S]*?<p class="info-value">([^<]*)<\/p>[\s\S]*?<\/a>\s*<\/div>/g;

    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const fullUrl = match[1];
      const title = match[2].trim();
      const infoValue = match[3].trim();

      const tags = infoValue.split(",").map((s) => s.trim());
      if (!tags.includes("Anime")) continue; // skip non-anime results

      const slug = fullUrl
        .replace(/^https?:\/\/[^/]+\/catalogue\//, "")
        .replace(/\/$/, "");
      const encodedId = tag ? `${slug}::${tag}` : `${slug}::s${season || 1}`;

      results.push({
        id: encodedId,
        title,
        url: fullUrl,
        subOrDub: "sub",
      });
    }

    if (!results.length) throw new Error("No anime found");
    return results;
  }

  // ---------------------------------------------------------------------
  // panneau (season/arc) parsing
  // ---------------------------------------------------------------------

  parsePanneaux(html) {
    const blockMatch = html.match(
      /<div[^>]*class="flex flex-wrap[^"]*"[^>]*>[\s\S]*?<script>([\s\S]*?)<\/script>/
    );
    if (!blockMatch) return [];

    // Strip /* ... */ and // ... comments so example/placeholder calls
    // (e.g. the "nom", "url" template) don't get picked up.
    const scriptNoComments = blockMatch[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const panneauRegex = /panneauAnime\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    const panneaux = [];
    let match;
    while ((match = panneauRegex.exec(scriptNoComments)) !== null) {
      panneaux.push({ name: match[1], path: match[2] });
    }
    return panneaux;
  }

  choosePanneau(panneaux, { tag, season }) {
    if (!panneaux.length) return null;

    if (tag) {
      const byTag = panneaux.find(
        (p) => p.name.toLowerCase().includes(tag) || p.path.toLowerCase().includes(tag)
      );
      return byTag || panneaux[0];
    }

    const targetSeason = season || 1;
    const seasonPatterns = [
      new RegExp(`saison\\s*${targetSeason}\\b`, "i"),
      new RegExp(`season\\s*${targetSeason}\\b`, "i"),
      new RegExp(`part\\s*${targetSeason}\\b`, "i"),
    ];
    const bySeason = panneaux.find((p) =>
      seasonPatterns.some((re) => re.test(p.name) || re.test(p.path))
    );
    return bySeason || panneaux[0];
  }

  /**
   * Decodes the id produced by search(): "slug::s2" or "slug::piece".
   */
  decodeId(id) {
    const [slug, marker] = id.split("::");
    const seasonMatch = marker && marker.match(/^s(\d+)$/i);
    if (seasonMatch) {
      return { slug, tag: null, season: parseInt(seasonMatch[1], 10) };
    }
    return { slug, tag: marker || null, season: null };
  }

  // ---------------------------------------------------------------------
  // episodes
  // ---------------------------------------------------------------------

  async findEpisodes(id) {
    const { slug, tag, season } = this.decodeId(id);

    const animePageRes = await fetch(`${this.base}/catalogue/${slug}/`, {
      headers: { "User-Agent": this.ua },
    });
    const animePageHtml = await animePageRes.text();

    const panneaux = this.parsePanneaux(animePageHtml);
    if (!panneaux.length) throw new Error("No seasons/panneaux found for this anime");

    const chosen = this.choosePanneau(panneaux, { tag, season });
    if (!chosen) throw new Error("Could not determine which season/panneau to use");

    // chosen.path already includes the language variant, e.g. "saison1/vostfr"
    const episodesPageUrl = `${this.base}/catalogue/${slug}/${chosen.path.replace(/\/$/, "")}/`;
    const episodesPageRes = await fetch(episodesPageUrl, { headers: { "User-Agent": this.ua } });
    const episodesPageHtml = await episodesPageRes.text();

    const scriptMatch = episodesPageHtml.match(/episodes\.js\?filever=(\d+)/);
    if (!scriptMatch) throw new Error("episodes.js reference not found on season page");
    const filever = scriptMatch[1];

    const episodesJsUrl = `${episodesPageUrl}episodes.js?filever=${filever}`;
    const episodesJsRes = await fetch(episodesJsUrl, { headers: { "User-Agent": this.ua } });
    const episodesJs = await episodesJsRes.text();

    const episodeCount = this.countEpisodes(episodesJs);
    if (episodeCount === 0) throw new Error("No episodes found in episodes.js");

    // Base path (without trailing language segment) so we can swap
    // vostfr <-> vf for dub lookups at stream time.
    const basePathNoLang = `${slug}/${chosen.path.replace(/\/(vostfr|vf)\/?$/, "")}`;

    const episodes = [];
    for (let i = 1; i <= episodeCount; i++) {
      episodes.push({
        id: `${basePathNoLang}::ep${i}`,
        number: i,
        title: `Episode ${i}`,
        url: episodesPageUrl,
      });
    }

    return episodes;
  }

  /**
   * Counts episodes based on the largest eps array found in episodes.js.
   */
  countEpisodes(js) {
    const arrayRegex = /var\s+eps\w*\s*=\s*\[([\s\S]*?)\];/g;
    let max = 0;
    let match;
    while ((match = arrayRegex.exec(js)) !== null) {
      const body = match[1];
      const urlMatches = body.match(/'https?:\/\/[^']+'/g) || [];
      if (urlMatches.length > max) max = urlMatches.length;
    }
    return max;
  }

  /**
   * Parses all eps* arrays out of episodes.js into { epsN: [urls...] }.
   */
  parseEpisodeArrays(js) {
    const arrayRegex = /var\s+(eps\w*)\s*=\s*\[([\s\S]*?)\];/g;
    const arrays = {};
    let match;
    while ((match = arrayRegex.exec(js)) !== null) {
      const name = match[1];
      const body = match[2];
      const urls = (body.match(/'(https?:\/\/[^']+)'/g) || []).map((s) => s.slice(1, -1));
      arrays[name] = urls;
    }
    return arrays;
  }

  // ---------------------------------------------------------------------
  // streaming
  // ---------------------------------------------------------------------

  /**
   * Identifies which known host an embed URL belongs to, based on its
   * domain, rather than trusting the eps array's numeric suffix (the
   * array index does NOT reliably correspond to a fixed host across
   * different titles/pages - e.g. eps1 might be vidmoly on one page and
   * sibnet on another).
   */
  detectHost(embedUrl) {
    if (/sendvid\.com/i.test(embedUrl)) return "sendvid";
    if (/vidmoly\.(to|biz|net)/i.test(embedUrl)) return "vidmoly";
    if (/sibnet\.ru/i.test(embedUrl)) return "sibnet";
    return null;
  }

  /**
   * Builds an ordered list of { arrayName, host, urls } for every eps*
   * array in episodes.js, using the actual embed URLs to identify the
   * host rather than the array's numeric suffix. The order the arrays
   * appear in the file determines which one is "server 1", "server 2", etc.
   */
  buildServerList(js) {
    const arrays = this.parseEpisodeArrays(js);
    const serverList = [];
    for (const [arrayName, urls] of Object.entries(arrays)) {
      if (!urls.length) continue;
      const host = this.detectHost(urls[0]);
      if (!host) continue; // skip unrecognized hosts
      serverList.push({ arrayName, host, urls });
    }
    return serverList;
  }

  async findEpisodeServer(episode, server) {
    const [basePathNoLang, epMarker] = episode.id.split("::ep");
    const episodeNumber = parseInt(epMarker, 10);

    const isDub = server.startsWith("DUB");
    const lang = isDub ? "vf" : "vostfr";
    const seasonPageUrl = `${this.base}/catalogue/${basePathNoLang}/${lang}/`;

    const pageRes = await fetch(seasonPageUrl, { headers: { "User-Agent": this.ua } });
    if (!pageRes.ok) {
      throw new Error(`${lang.toUpperCase()} variant not available for this season`);
    }
    const pageHtml = await pageRes.text();

    const scriptMatch = pageHtml.match(/episodes\.js\?filever=(\d+)/);
    if (!scriptMatch) throw new Error("episodes.js reference not found");
    const filever = scriptMatch[1];

    const episodesJsRes = await fetch(`${seasonPageUrl}episodes.js?filever=${filever}`, {
      headers: { "User-Agent": this.ua },
    });
    const episodesJs = await episodesJsRes.text();

    // "SUB 2" / "DUB 2" -> the 2nd recognized-host array on the page (1-indexed).
    const numMatch = server.match(/(\d+)$/);
    if (!numMatch) throw new Error(`Unrecognized server: ${server}`);
    const serverIndex = parseInt(numMatch[1], 10) - 1;

    const serverList = this.buildServerList(episodesJs);
    const entry = serverList[serverIndex];
    if (!entry) throw new Error(`${server} is not available for this episode`);

    const embedUrl = entry.urls[episodeNumber - 1];
    if (!embedUrl) {
      throw new Error(`No embed found for ${server} on episode ${episodeNumber}`);
    }

    if (entry.host === "sendvid") return this.scrapeSendvid(embedUrl, server);
    if (entry.host === "vidmoly") return this.scrapeVidmoly(embedUrl, server);
    if (entry.host === "sibnet") return this.scrapeSibnet(embedUrl, server);

    throw new Error(`No scraper implemented for host ${entry.host}`);
  }

  async scrapeSendvid(embedUrl, server) {
    const res = await fetch(embedUrl, { headers: { "User-Agent": this.ua } });
    const html = await res.text();
    const match = html.match(/<source src="([^"]+)"[^>]*type="video\/mp4"/);
    if (!match) throw new Error("mp4 source not found on sendvid embed");

    return {
      server,
      headers: { Referer: "https://sendvid.com/" },
      videoSources: [{ url: match[1], quality: "auto", type: "mp4", subtitles: [] }],
    };
  }

  async scrapeVidmoly(embedUrl, server) {
    const rewritten = embedUrl.replace("vidmoly.to", "vidmoly.biz");
    const res = await fetch(rewritten, { headers: { "User-Agent": this.ua } });
    const html = await res.text();
    const match = html.match(/sources:\s*\[\{\s*file:\s*'([^']+)'/);
    if (!match) throw new Error("m3u8 source not found on vidmoly embed");

    return {
      server,
      headers: { Referer: "https://vidmoly.biz/" },
      videoSources: [{ url: match[1], quality: "auto", type: "m3u8", subtitles: [] }],
    };
  }

  async scrapeSibnet(embedUrl, server) {
    const res = await fetch(embedUrl, { headers: { "User-Agent": this.ua } });
    const html = await res.text();
    const match = html.match(/player\.src\(\[\{src:\s*"([^"]+)"/);
    if (!match) throw new Error("mp4 source not found on sibnet embed");

    const videoUrl = `https://video.sibnet.ru${match[1]}`;

    return {
      server,
      headers: {
        Referer: embedUrl,
        "User-Agent": this.ua,
      },
      videoSources: [{ url: videoUrl, quality: "auto", type: "mp4", subtitles: [] }],
    };
  }
}
