/// <reference path="./manga-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
    this.proxyBase = "https://corsproxy.io?url=";
  }

  proxy(url) {
    return `${this.proxyBase}${encodeURIComponent(url)}`;
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/search/${encodeURIComponent(query.query)}/`;
    const res = await fetch(this.proxy(searchUrl));
    const html = await res.text();

    const results = [];
    const regex = /<a class="mynimeku-search-feed__cover"[^>]*href="(https:\/\/www\.mynimeku\.com\/komik\/[^"]+)"[^>]*aria-label="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/gs;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const image = match[3];

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
    const res = await fetch(this.proxy(id));
    const html = await res.text();
    const chapters = [];

    const chapterRegex = /<div[^>]*class='komik-series-chapter-row'[^>]*data-chapter-number='([\d.]+)'[^>]*>[\s\S]*?<a[^>]*class='komik-series-chapter-item'[^>]*href='([^']+)'[^>]*>[\s\S]*?<span class='komik-series-chapter-item__title'>([^<]+)<\/span>/g;

    let match;
    while ((match = chapterRegex.exec(html)) !== null) {
      const number = parseFloat(match[1]);
      const url = match[2];
      const title = match[3].trim();

      chapters.push({
        id: url,
        title,
        number,
        url,
      });
    }

    return chapters.reverse();
  }

  async findChapterPages(id) {
    const res = await fetch(this.proxy(id));
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
