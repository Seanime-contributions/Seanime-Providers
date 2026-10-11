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

  // Derives the real chapter number from ch.name or the URL slug.
  // Looks for a number following the word "chapter" to avoid matching
  // volume numbers (e.g. "Vol.1 Chapter 5" must return "5", not "1").
  // Falls back to the URL slug, then null if nothing can be parsed.
  parseChapterNumber(ch) {
    // 1. Prefer the number that follows the word "chapter" in the title.
    const fromName = (ch.name || "").match(/chapter[-\s](\d+(?:[-.]\d+)?)/i);
    if (fromName) return fromName[1].replace("-", ".");

    // 2. Try the URL slug next (e.g. "chapter-118-5" → "118.5").
    const fromUrl = (ch.url || "").match(/chapter[-/](\d+(?:[-.]\d+)?)/i);
    if (fromUrl) return fromUrl[1].replace("-", ".");

    // 3. Couldn't parse — signal that this chapter needs a fallback index.
    return null;
  }

  // After all chapters have been mapped, chapters whose number could not be
  // parsed are assigned decimal sub-numbers based on the last valid chapter:
  //
  //   lastValid = 134  →  faulty chapters become 134.1, 134.2, …
  //
  // If no valid predecessor exists, they are numbered 0.1, 0.2, …
  assignFallbackNumbers(chapters) {
    // Group consecutive null-chapter runs and assign sub-numbers.
    let lastValid = "0";
    // We need to track how many fallback chapters follow each valid anchor.
    // First pass: resolve all parseable numbers.
    // Second pass: for each null run, assign anchor.1, anchor.2, …
    const result = [];
    let runStart = -1;

    const flushRun = (endIdx) => {
      if (runStart === -1) return;
      const anchor = parseFloat(lastValid);
      for (let k = runStart; k < endIdx; k++) {
        const subN = k - runStart + 1;
        result[k] = {
          ...result[k],
          chapter: `${anchor}.${subN}`,
        };
      }
      runStart = -1;
    };

    // Copy chapters into result first so we can mutate.
    for (let i = 0; i < chapters.length; i++) {
      result.push({ ...chapters[i] });
    }

    for (let i = 0; i < result.length; i++) {
      if (result[i].chapter !== null) {
        flushRun(i);
        lastValid = result[i].chapter;
      } else {
        if (runStart === -1) runStart = i;
        // Keep going — will flush when we hit the next valid chapter or end.
      }
    }
    // Flush any trailing null run.
    flushRun(result.length);

    return result;
  }

  async findChapters(mangaId) {
    try {
      const [hashId, cv] = mangaId.split(":::");
      const chaptersUrl = cv
        ? `${this.apiBase}/titles/${hashId}/chapters?cv=${cv}`
        : `${this.apiBase}/titles/${hashId}/chapters`;
      const json = await this.fetchJSON(chaptersUrl);
      if (!json.success || !json.data?.chapters) return [];

      // Step 1: map every chapter; unparseable ones get chapter: null.
      const mapped = json.data.chapters.map((ch) => ({
        id: ch.url.startsWith("/") ? ch.url.slice(1) : ch.url,
        url: `${this.api}${ch.url}`,
        title: ch.name,
        chapter: this.parseChapterNumber(ch),
      }));

      // Step 2: sort parseable chapters ascending; null chapters stay in
      // their relative position (sort is stable in modern JS).
      mapped.sort((a, b) => {
        const an = a.chapter !== null ? parseFloat(a.chapter) : Infinity;
        const bn = b.chapter !== null ? parseFloat(b.chapter) : Infinity;
        return an - bn;
      });

      // Step 3: assign decimal sub-numbers to null chapters.
      return this.assignFallbackNumbers(mapped);
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
