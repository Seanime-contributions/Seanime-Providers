class Provider {
  constructor() {
    this.api = "https://asuracomic.net";
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
        Accept: "*/*",
        Referer: this.api,
      },
    });
  }

  async search(opts) {
    const url = `${this.api}/series?page=1&name=${encodeURIComponent(opts.query)}`;

    try {
      const response = await this.fetchWithHeaders(url);
      if (!response.ok) return [];

      const html = await response.text();
      const entryRegex = /<a[^>]+href="series\/([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"/gi;

      const mangas = [];
      let match;

      while ((match = entryRegex.exec(html)) !== null) {
        const id = match[1];
        const img = match[2];
        
        const title = id
          .replace(/-[\w\d]+$/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase());

        if (!id) continue;

        mangas.push({
          id: id,
          title: title,
          image: img,
        });
      }

      return mangas;
    } catch (e) {
      console.error("Search error:", e);
      return [];
    }
  }

  async findChapters(mangaId) {
    try {
      const response = await this.fetchWithHeaders(`${this.api}/series/${mangaId}`);
      if (!response.ok) return [];

      const html = await response.text();
      const chapters = [];
      const seenChapters = new Set(); // Deduplication Set

      const chapterRegex = new RegExp(
        `<a[^>]+href="${mangaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/chapter/([^"]+)"`,
        "gi"
      );

      let match;
      while ((match = chapterRegex.exec(html)) !== null) {
        const chapterNum = match[1];

        // Deduplication check
        if (seenChapters.has(chapterNum)) continue;
        seenChapters.add(chapterNum);

        const chapterUrl = `${this.api}/series/${mangaId}/chapter/${chapterNum}`;

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

      // Updated Regex to match escaped quotes: \"pages\"
      // Matches: ,\"pages\":[ ... ]
      const pagesRegex = /pages\\":(\[.*?\])/;
      const match = pagesRegex.exec(html);

      if (!match) {
        console.error("No pages found in regex match");
        return [];
      }

      // match[1] contains the array string with escaped quotes inside
      // Example: [{\"order\":1,\"url\":\"...\"}]
      let rawString = match[1];

      // Unescape the JSON string (remove backslashes before quotes)
      const cleanJson = rawString.replace(/\\"/g, '"');

      try {
        const json = JSON.parse(cleanJson);
        return json.map((p) => ({
          url: p.url,
          index: p.order || 0,
          headers: { Referer: this.api }
        }));
      } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        return [];
      }

    } catch (e) {
      console.error("findChapterPages error:", e);
      return [];
    }
  }
}
