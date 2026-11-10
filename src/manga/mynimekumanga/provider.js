/// <reference path="./manga-provider.d.ts" />

class Provider {
  constructor() {
    this.baseUrl = "https://www.mynimeku.com";
  }

  async getSearchNonce() {
    const res = await fetch(`${this.baseUrl}/`, {
      headers: {
        "Referer": `${this.baseUrl}/`,
      },
    });

    if (!res.ok) throw new Error(`Failed to load MyNimeKu root page: ${res.status}`);

    const html = await res.text();
    const formMatch = html.match(/<form\b[^>]*\bid=["']search-form["'][^>]*>/i);
    const nonceMatch = formMatch?.[0].match(/\bdata-nonce\s*=\s*["']([^"']+)["']/i);
    if (!nonceMatch) throw new Error("MyNimeKu search nonce not found");

    return nonceMatch[1];
  }

  async search(query) {
    const nonce = await this.getSearchNonce();
    const searchUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
    const body = [
      `action=${encodeURIComponent("mynimeku_live_search")}`,
      `nonce=${encodeURIComponent(nonce)}`,
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
