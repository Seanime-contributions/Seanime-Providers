class Provider {
  constructor() {
    this.api = "https://ravenscans.org";
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
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: this.api,
      },
    });
  }

  async search(opts) {
    const url = `${this.api}/?s=${encodeURIComponent(opts.query)}`;
    try {
      const response = await this.fetchWithHeaders(url);
      if (!response.ok) return [];
      const html = await response.text();

      const mangas = [];
      const seen = new Set();

      // Match each .bsx anchor: href, title, and image src
      const entryRegex = /<div class="bsx">\s*<a\s+href="([^"]+)"\s+title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/gi;
      let match;
      while ((match = entryRegex.exec(html)) !== null) {
        const href = match[1];
        const title = match[2];
        const image = match[3];

        // Extract slug from URL: /manga/{slug}/
        const slugMatch = /\/manga\/([^/]+)\/?$/.exec(href);
        if (!slugMatch) continue;
        const slug = slugMatch[1];

        if (seen.has(slug)) continue;
        seen.add(slug);

        mangas.push({
          id: slug,
          title: title.trim(),
          image: image,
        });
      }

      return mangas;
    } catch (e) {
      console.error("Search error:", e);
      return [];
    }
  }

  async findChapters(mangaId) {
    // mangaId is the slug, e.g. "emperor-of-solo-play"
    const comicUrl = `${this.api}/manga/${mangaId}/`;
    try {
      const response = await this.fetchWithHeaders(comicUrl);
      if (!response.ok) return [];
      const html = await response.text();

      const chapters = [];
      const seen = new Set();

      // Match <li data-num="60"><div class="chbox">...<a href="...">
      const liRegex = /<li\s+data-num="([^"]+)"[\s\S]*?<a\s+href="([^"]+)"/gi;
      let match;
      while ((match = liRegex.exec(html)) !== null) {
        const chapterNum = match[1];
        const chapterUrl = match[2];

        if (seen.has(chapterNum)) continue;
        seen.add(chapterNum);

        chapters.push({
          id: chapterUrl,
          title: `Chapter ${chapterNum}`,
          chapter: chapterNum,
        });
      }

      return chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
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

      // Pages are inside #readerarea > noscript > <p> as <img> tags
      const readerMatch = /<div\s+id="readerarea"[\s\S]*?<noscript>([\s\S]*?)<\/noscript>/i.exec(html);
      if (!readerMatch) {
        console.error("Could not find readerarea noscript block");
        return [];
      }

      const noscriptContent = readerMatch[1];
      const pages = [];
      const imgRegex = /<img[^>]+src="([^"]+)"/gi;
      let match;
      let index = 0;

      while ((match = imgRegex.exec(noscriptContent)) !== null) {
        const pageUrl = match[1];
        pages.push({
          url: pageUrl,
          index: index++,
          headers: { Referer: this.api },
        });
      }

      return pages;
    } catch (e) {
      console.error("findChapterPages error:", e);
      return [];
    }
  }
}
