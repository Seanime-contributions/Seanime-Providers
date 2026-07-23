/// <reference path="./manga-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/search/${encodeURIComponent(query.query)}/`;
    const res = await fetch(searchUrl);
    const html = await res.text();

    const results = [];
    const regex = /<a class="mynimeku-search-feed__cover"[^>]*href="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/gs;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const image = match[3];

      if (!url.includes("/komik/")) continue;

      results.push({
        id: url,
        title,
        url,
        image,
      });
    }

    if (!results.length) throw new Error("No manga found");
    return results;
  }

  async findChapters(id) {
    const res = await fetch(id);
    const html = await res.text();
    const chapters = [];

    const chapterRegex = /<div[^>]*data-chapter-number='([\d.]+)'[^>]*>[\s\S]*?<a[^>]*class='komik-series-chapter-item'[^>]*href='([^']+)'[^>]*>[\s\S]*?<span class='komik-series-chapter-item__title'>([^<]+)<\/span>/g;

    let match;
    while ((match = chapterRegex.exec(html)) !== null) {
      const number = match[1];
      const url = match[2];
      const title = match[3].trim();

      chapters.push({
        id: url,
        title,
        chapter: number,
      });
    }

    return chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
  }

  async findChapterPages(id) {
    const res = await fetch(id);
    const html = await res.text();
    const pages = [];

    const contentMatch = html.match(/<div[^>]*class="komik-reader-content"[^>]*>([\s\S]*?)<\/div>/);
    if (!contentMatch) throw new Error("Reader content not found");

    const imgRegex = /<img[^>]*src="(?:\/\/)?(image\.mydriveku\.my\.id\/api\/view-image\/[^"]+)"/g;

    let match;
    let index = 0;
    while ((match = imgRegex.exec(contentMatch[1])) !== null) {
      const url = `https://${match[1]}`;
      pages.push({
        index,
        url,
        headers: {
          "Referer": this.baseUrl + "/",
        },
      });
      index++;
    }

    if (!pages.length) throw new Error("No pages found");
    return pages;
  }
}