class Provider {
  constructor() {
    this.api = "https://asurascans.com";
  }

  getSettings() {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    };
  }

  async fetchWithHeaders(url) {
    return fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        Referer: `${this.api}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Upgrade-Insecure-Requests": "1",
      },
    });
  }

  async search(opts) {
    const url = `${this.api}/browse?search=${encodeURIComponent(opts.query)}`;
    try {
      const response = await this.fetchWithHeaders(url);
      if (!response.ok) return [];
      const html = await response.text();

      const props = this._extractAstroProps(html, "BrowseFilters");
      if (!props) {
        console.error("Could not find BrowseFilters props");
        return [];
      }

      const initialSeries = props["initialSeries"];
      if (!initialSeries || initialSeries[0] !== 1) return [];

      const mangas = [];
      for (const entry of initialSeries[1]) {
        if (!Array.isArray(entry) || entry[0] !== 0) continue;
        const s = entry[1];

        const slug = this._astroVal(s["slug"]);
        const title = this._astroVal(s["title"]);
        const cover = this._astroVal(s["cover"]);
        const publicUrl = this._astroVal(s["public_url"]);

        if (!slug) continue;

        mangas.push({
          id: publicUrl || `/comics/${slug}`, // Use public_url as ID
          title: title || slug,
          image: cover || "",
          slug: slug, // Keep slug as backup
        });
      }

      return mangas;
    } catch (e) {
      console.error("Search error:", e);
      return [];
    }
  }

  async findChapters(mangaId) {
    // Search may return either a root-relative public_url or an absolute URL.
    // Do not prepend the API host twice when the latter is returned.
    const rawMangaId = String(mangaId || "").trim().replace(/^['"]|['"]$/g, "");
    const comicUrl = /^https?:\/\//i.test(rawMangaId)
      ? rawMangaId
      : `${this.api}${rawMangaId.startsWith("/") ? "" : "/"}${rawMangaId}`;
    try {
      const urls = [comicUrl];
      if (/^https?:\/\/asurascans\.com\//i.test(comicUrl)) {
        urls.push(comicUrl.replace(/^https?:\/\/asurascans\.com/i, "https://www.asurascans.com"));
      }
      let response;
      let html = "";
      for (let i = 0; i < urls.length; i++) {
        if (i > 0) console.warn("Retrying chapter page on fallback host:", urls[i]);
        response = await this.fetchWithHeaders(urls[i]);
        console.log("Chapter page:", response.status, response.url || urls[i]);
        if (!response.ok) {
          console.error("Chapter page request failed:", response.status);
          continue;
        }
        html = await response.text();
        console.log("HTML length:", html.length, "has chapter links:", html.includes("/chapter/"));
        if (html.includes("/chapter/")) break;
        console.warn("Chapter page contained no chapter links");
      }
      if (!response || !response.ok || !html.includes("/chapter/")) return [];

      const chapters = [];
      const seen = new Set();

      // Parse every href and inspect its URL path instead of depending on the
      // exact surrounding anchor markup.
      const normalizedHtml = String(html)
        .replace(/&quot;/gi, '"')
        .replace(/&#x27;|&#39;/gi, "'")
        .replace(/&amp;/gi, "&")
        .replace(/\\(["'])/g, "$1");
      const hrefRegex = /\bhref\s*=\s*(["'])(.*?)\1/gi;
      let match;
      while ((match = hrefRegex.exec(normalizedHtml)) !== null) {
        const href = match[2].trim();
        let url;
        try {
          url = new URL(href, response.url || comicUrl);
        } catch (_error) {
          continue;
        }

        const chapterMatch = url.pathname.match(/\/comics\/[^/]+\/chapter\/([^/]+)\/?$/i);
        if (!chapterMatch) continue;

        const chapterNum = chapterMatch[1];

        if (seen.has(chapterNum)) continue;
        seen.add(chapterNum);

        chapters.push({
          id: url.href,
          url: url.href,
          title: `Chapter ${chapterNum}`,
          chapter: chapterNum,
          index: 0,
        });
      }

      chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
      chapters.forEach((chapter, index) => {
        chapter.index = index;
      });
      return chapters;
    } catch (e) {
      console.error("findChapters error:", e);
      return [];
    }
  }

  async findChapterPages(chapterUrl) {
    try {
      const response = await this.fetchWithHeaders(chapterUrl);
      if (!response.ok) return [];
      const html = await response.text();

      const props = this._extractAstroProps(html, "ChapterReader");
      if (!props) {
        console.error("Could not find ChapterReader props");
        return [];
      }

      // pages -> [1, [ [0, {url, width, height}], ... ]]
      const pagesData = props["pages"];
      if (!pagesData || pagesData[0] !== 1) {
        console.error("No pages data found in props");
        return [];
      }

      const pages = [];
      for (let i = 0; i < pagesData[1].length; i++) {
        const entry = pagesData[1][i];
        if (!Array.isArray(entry) || entry[0] !== 0) continue;
        const p = entry[1];

        const pageUrl = this._astroVal(p["url"]);
        if (!pageUrl) continue;

        pages.push({
          url: pageUrl,
          index: i,
          headers: { Referer: this.api },
        });
      }

      return pages;
    } catch (e) {
      console.error("findChapterPages error:", e);
      return [];
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  // Extract and parse the props JSON from a named astro-island component.
  _extractAstroProps(html, componentName) {
    const regex = new RegExp(
      `component-export="default"[^>]*props="([^"]+)"[^>]*ssr[^>]*client="load"[^>]*opts="[^"]*${componentName}`
    );
    const match = regex.exec(html);
    if (!match) return null;

    const propsJson = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    try {
      return JSON.parse(propsJson);
    } catch (e) {
      console.error(`Failed to parse ${componentName} props:`, e);
      return null;
    }
  }

  // Decode Astro's [type, value] encoded primitive. type 0 = scalar, type 1 = array.
  _astroVal(encoded) {
    if (!Array.isArray(encoded)) return encoded;
    const [type, value] = encoded;
    if (type === 0) return value;
    if (type === 1) return value.map(v => this._astroVal(v));
    return value;
  }
}
