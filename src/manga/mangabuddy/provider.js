class Provider {
  constructor() {
    this.api = "https://mangak.io";
    this.apiBase = "https://api.mangak.io";
  }
  getSettings() {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    };
  }
  async fetchJSON(url) {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${this.api}/`,
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }
  async fetchHTML(url) {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Accept: "text/html",
        Referer: `${this.api}/`,
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  }
  async search(opts) {
    try {
      const url = `${this.apiBase}/titles/search?page=1&limit=10&q=${encodeURIComponent(opts.query)}`;
      const json = await this.fetchJSON(url);
      if (!json.success || !json.data?.items) return [];
      return json.data.items.map((item) => ({
        id: `${item.id}:::${item.cv}`,
        title: item.name,
        image: item.cover,
      }));
    } catch (e) {
      console.error("Search error:", e);
      return [];
    }
  }
  // Derives the real chapter number from ch.name or the URL slug,
  // falling back to chapter_number/index only when no number can be parsed.
  parseChapterNumber(ch, i) {
    const fromName = (ch.name || "").match(/(\d+(?:\.\d+)?)/);
    if (fromName) return fromName[1];
    const fromUrl = (ch.url || "").match(/chapter[-/](\d+(?:[-.]\d+)?)/i);
    if (fromUrl) return fromUrl[1].replace("-", ".");
    return String(ch.chapter_number ?? i);
  }
  async findChapters(mangaId) {
    try {
      const [hashId, cv] = mangaId.split(":::");
      const chaptersUrl = cv
        ? `${this.apiBase}/titles/${hashId}/chapters?cv=${cv}`
        : `${this.apiBase}/titles/${hashId}/chapters`;
      const json = await this.fetchJSON(chaptersUrl);
      if (!json.success || !json.data?.chapters) return [];
      return json.data.chapters
        .map((ch, i) => ({
          id: ch.url.startsWith("/") ? ch.url.slice(1) : ch.url,
          url: `${this.api}${ch.url}`,
          title: ch.name,
          chapter: this.parseChapterNumber(ch, i),
        }))
        .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
    } catch (e) {
      console.error("findChapters error:", e);
      return [];
    }
  }
  async findChapterPages(chapterId) {
    try {
      const url = `${this.api}/${chapterId}`;
      const html = await this.fetchHTML(url);

      // The page embeds all image URLs in the __NEXT_DATA__ JSON block as initialChapter.images
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (nextDataMatch) {
        const nextData = JSON.parse(nextDataMatch[1]);
        const images = nextData?.props?.pageProps?.initialChapter?.images;
        if (Array.isArray(images) && images.length > 0) {
          console.log(`Found ${images.length} pages for chapter ${chapterId} (via __NEXT_DATA__)`);
          return images.map((src, index) => ({
            url: src,
            index,
            headers: { Referer: "https://mangak.io/" },
          }));
        }
      }

      // Fallback: scrape <img> tags if __NEXT_DATA__ is absent or empty.
      const imgRegex = /<img[^>]+class="[^"]*w-full h-full object-cover[^"]*"[^>]+src="([^"]+)"/gi;
      const pages = [];
      const seen = new Set();
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if (!seen.has(src)) {
          seen.add(src);
          pages.push({
            url: src,
            index: pages.length,
            headers: { Referer: "https://mangak.io/" },
          });
        }
      }
      console.log(`Found ${pages.length} pages for chapter ${chapterId} (via img fallback)`);
      return pages;
    } catch (e) {
      console.error("findChapterPages error:", e);
      return [];
    }
  }
}
