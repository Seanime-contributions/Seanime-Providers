class Provider {
  constructor() {
    this.api = "https://mangadot.net";
  }

  getSettings() {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: true,
    };
  }

  async search(opts) {
    const url = `${this.api}/search?search=${encodeURIComponent(opts.query)}&page=1`;

    try {
      const response = await fetch(url, {
        headers: {
          Referer: `${this.api}/`,
        },
      });

      if (!response.ok) return [];

      const html = await response.text();

      const mangas = [];
      const seen = new Set();

      const entryRegex = /<a\s+class="group\s+flex\s+flex-col\s+gap-1\.5"\s+href="\/manga\/([^\"]+)"[\s\S]*?<img\s+src="([^\"]+)"[\s\S]*?<div\s+class="line-clamp-2\s+text-\[12px\][\s\S]*?">([\s\S]*?)<\/div><\/a>/gi;

      let match;
      while ((match = entryRegex.exec(html)) !== null) {
        const id = match[1]?.trim();
        const img = match[2]?.trim();
        const title = match[3]?.trim();

        if (!id || seen.has(id)) continue;
        seen.add(id);

        const image = img
          ? img.startsWith("http")
            ? img
            : `${this.api}${img}`
          : undefined;

        mangas.push({
          id,
          title: title || "Untitled",
          image,
          synonyms: undefined,
          year: undefined,
        });
      }

      return mangas;
    } catch (e) {
      console.error("Search error:", e);
      return [];
    }
  }

  async findChapters(mangaId) {
    const url = `${this.api}/api/manga/${encodeURIComponent(mangaId)}/chapters/list?lang=en`;

    try {
      const response = await fetch(url, {
        headers: {
          Referer: `${this.api}/manga/${encodeURIComponent(mangaId)}`,
        },
      });

      if (!response.ok) return [];

      const json = await response.json();
      const items = Array.isArray(json) ? json : [];

      const chapters = items
        .map((ch) => {
          const id = ch?.id != null ? String(ch.id) : "";
          if (!id) return null;

          const chapNum = ch?.chapter_number != null ? String(ch.chapter_number) : "0";
          const chapTitle = ch?.chapter_title ? String(ch.chapter_title) : null;

          const scanlator =
            (ch?.scanlator_name && String(ch.scanlator_name).trim()) ||
            (ch?.group_name && String(ch.group_name).trim()) ||
            "Default";

          return {
            id,
            url: `${this.api}/manga/${encodeURIComponent(mangaId)}`,
            title: chapTitle ? `Chapter ${chapNum} — ${chapTitle}` : `Chapter ${chapNum}`,
            chapter: chapNum,
            index: 0,
            scanlator,
            language: ch?.language ?? "en",
          };
        })
        .filter(Boolean);

      chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
      chapters.forEach((c, i) => {
        c.index = i;
      });

      return chapters;
    } catch (e) {
      console.error("findChapters error:", e);
      return [];
    }
  }

  async findChapterPages(chapterId) {
    const url = `${this.api}/api/chapters/${encodeURIComponent(chapterId)}/images`;

    try {
      const response = await fetch(url, {
        headers: {
          Referer: `${this.api}/`,
        },
      });

      if (!response.ok) return [];

      const json = await response.json();
      const images = Array.isArray(json?.images) ? json.images : [];

      return images
        .map((img, index) => {
          const rel = img?.url;
          if (!rel) return null;

          const absolute = rel.startsWith("http") ? rel : `${this.api}${rel}`;

          return {
            url: absolute,
            index,
            headers: {
              Referer: `${this.api}/`,
            },
          };
        })
        .filter(Boolean);
    } catch (e) {
      console.error("findChapterPages error:", e);
      return [];
    }
  }
}
