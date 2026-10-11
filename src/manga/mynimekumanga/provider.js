/// <reference path="./manga-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
  }

  async search(query) {
    const searchUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const body = [
      `action=${encodeURIComponent("mynimeku_live_search")}`,
      `nonce=${encodeURIComponent("92e6c9e843")}`,
      `keyword=${encodeURIComponent(query.query)}`,
    ].join("&");

    const res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": this.baseUrl,
        "Referer": `${this.baseUrl}/`,
      },
      body,
    });

    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.success === false ? [] : data?.data?.items ?? [];
    const seen = new Set();

    return items
      .filter(item => item?.type === "MANGA" && typeof item.url === "string" && item.url.includes("/komik/"))
      .filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .map(item => ({
        id: item.url,
        title: item.title?.trim() || "Unknown",
        url: item.url,
        image: item.cover,
      }));
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
