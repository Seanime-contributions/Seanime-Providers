class Provider {
  constructor() {
    this.api = "https://scanita.org";
  }

  api = "";

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
        "X-Requested-With": "XMLHttpRequest",
        Referer: this.api,
      },
    });
  }

  async search(opts) {
    const url = `${this.api}/search?q=${encodeURIComponent(opts.query)}`;

    try {
      const response = await this.fetchWithHeaders(url);
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const text = await response.text();

      let html;
      try {
        const parsed = JSON.parse(text);
        html = typeof parsed === "string" ? parsed : parsed?.html || "";
      } catch {
        html = text;
      }

      if (!html.trim()) return [];

      html = html.replace(/\\u([\dA-F]{4})/gi, (_, g) =>
        String.fromCharCode(parseInt(g, 16))
      );

      const decoded = typeof he !== "undefined" ? he.decode(html) : html;
      const entryRegex =
        /<a[^>]+href="\/manga\/([^"]+)"[\s\S]*?(?:<img[^>]+src="([^"]+)"[^>]*>)[\s\S]*?(?:<h3[^>]*>([^<]+)<\/h3>|<p[^>]*>([^<]+)<\/p>)/gi;

      const mangas = [];
      let match;
      while ((match = entryRegex.exec(decoded)) !== null) {
        const id = match[1];
        const img = match[2];
        const title = (match[3] || match[4] || id)?.trim();

        if (!img || !id) continue;

        mangas.push({
          id,
          title,
          image: `https://images.weserv.nl/?url=${encodeURIComponent(img.replace(/^https?:\/\//, ""))}`,
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
      const response = await this.fetchWithHeaders(`${this.api}/manga/${mangaId}`);
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const html = await response.text();
      const decoded = typeof he !== "undefined" ? he.decode(html) : html;

      const moreMatch = decoded.match(/<button[^>]+data-path="([^"]+)"/i);
      const chapterUrl = moreMatch
        ? moreMatch[1].startsWith("http")
          ? moreMatch[1]
          : `${this.api}${moreMatch[1]}`
        : `${this.api}/manga/${mangaId}`;

      const chaptersResp = await this.fetchWithHeaders(chapterUrl);
      if (!chaptersResp.ok)
        throw new Error(`${chaptersResp.status} ${chaptersResp.statusText}`);

      const chaptersHtml = await chaptersResp.text();
      const chaptersDecoded =
        typeof he !== "undefined" ? he.decode(chaptersHtml) : chaptersHtml;

      const chapterRegex =
        /<a[^>]+href="\/scan\/(\d+)"[^>]*>[\s\S]*?(?:Capitolo|Chapter|Ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/gi;

      const chapters = [];
      let match;
      while ((match = chapterRegex.exec(chaptersDecoded)) !== null) {
        const chapterId = match[1];
        const chapterNum = match[2];
        chapters.push({
          id: chapterId,
          url: `${this.api}/scan/${chapterId}`,
          title: `Capitolo ${chapterNum}`,
          chapter: chapterNum,
        });
      }

      return chapters
        .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter))
        .map((c, i) => ({ ...c, index: i }));
    } catch (e) {
      console.error("findChapters error:", e);
      return [];
    }
  }

  async findChapterPages(chapterId) {
    const pages = [];
    const visited = new Set();
    const activePromises = new Set();

    const addToQueue = (url) => {
      if (!visited.has(url)) {
        visited.add(url);
        const p = fetchPage(url).finally(() => activePromises.delete(p));
        activePromises.add(p);
      }
    };

    const fetchPage = async (url) => {
      try {
        const resp = await this.fetchWithHeaders(url);
        if (!resp.ok) return;

        let html = await resp.text();

        html = html
          .replace(/\\u([\dA-F]{4})/gi, (_, g) =>
            String.fromCharCode(parseInt(g, 16))
          )
          .replace(/\\u0026amp;/g, "&")
          .replace(/\\u0026/g, "&")
          .replace(/&amp;/g, "&");

        const decoded = typeof he !== "undefined" ? he.decode(html) : html;

        const imgRegex =
          /<div[^>]*class=["'][^"']*book-page[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

        let m;
        while ((m = imgRegex.exec(decoded)) !== null) {
          let imgUrl = m[1].trim();

          if (imgUrl.startsWith("/")) imgUrl = `${this.api}${imgUrl}`;
          if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
          
          const directUrl = imgUrl;

          pages.push({
            url: directUrl,
            index: pages.length,
            headers: { Referer: this.api }, 
          });
        }

        const nextMatch = decoded.match(
          /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*btn-next[^"']*["'][^>]*>/
        );
        if (nextMatch && nextMatch[1]) {
          const nextUrl = nextMatch[1].startsWith("http")
            ? nextMatch[1]
            : `${this.api}${nextMatch[1]}`;
          addToQueue(nextUrl);
        }
      } catch (e) {
        console.error("Error fetching page:", e);
      }
    };

    addToQueue(`${this.api}/scan/${chapterId}`);

    while (activePromises.size > 0) {
      await Promise.all([...activePromises]);
    }

    return pages.sort((a, b) => a.index - b.index);
  }
}
