/// <reference path="../manga-provider.d.ts" />

class Provider {
  constructor() {
    this.siteBase = "https://mangastash.org";
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
  }

  getSettings() {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    };
  }

  // Headers matching a browser <img> request for page images
  pageHeaders(referer, cookies) {
    const headers = {
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Priority": "i",
      "Referer": referer,
      "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "image",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "same-origin",
      "User-Agent": this.userAgent,
    };
    if (cookies) headers["Cookie"] = cookies;
    return headers;
  }

  async fetchHTML(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: `${this.siteBase}/`,
        "User-Agent": this.userAgent,
      },
    });
    if (!response.ok) throw new Error(`MangaStash request failed (HTTP ${response.status})`);
    return response.text();
  }

  async search(options) {
    const query = String(options?.query || "").trim();
    if (!query) return [];

    try {
      const url = new URL("/search", this.siteBase);
      url.searchParams.set("q", query);
      const html = await this.fetchHTML(url.toString());
      const cards = html.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bsearch-result-row\b[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi) || [];
      return cards.flatMap((card) => {
        const href = getAttribute(card, "href");
        if (!href) return [];
        const mangaUrl = new URL(href, this.siteBase);
        const id = mangaUrl.pathname.replace(/^\/+|\/+$/g, "");
        if (!id) return [];

        const title = getInnerHTML(card, /<h3\b[^>]*>([\s\S]*?)<\/h3>/i)
          || getAttribute(card, "alt");
        if (!title) return [];
        const image = getAttribute(card, "src") || getAttribute(card, "data-src");
        return [{
          id,
          title: decodeHtml(title).trim(),
          image: image ? new URL(image, this.siteBase).toString() : undefined,
        }];
      });
    } catch (error) {
      console.error("MangaStash search error:", error);
      return [];
    }
  }

  async findChapters(id) {
    const mangaPath = normalizeSitePath(id, this.siteBase);
    if (!mangaPath) return [];
    try {
      const html = await this.fetchHTML(new URL(mangaPath, this.siteBase).toString());
      const rows = html.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bchapter-row\b[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi) || [];
      const chapters = [];
      for (const row of rows) {
        const href = getAttribute(row, "href");
        if (!href) continue;
        const chapterUrl = new URL(href, this.siteBase);
        const chapterPath = chapterUrl.pathname.replace(/^\/+/, "");
        if (!chapterPath.startsWith(`${mangaPath}/`)) continue;

        const chapterValue = getAttribute(row, "data-num")
          || getInnerHTML(row, /<span\b[^>]*class=["'][^"']*\bchapter-num\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
          || chapterPath.match(/chapter-([^/]+)/i)?.[1];
        if (chapterValue == null || !String(chapterValue).trim()) continue;
        const chapter = decodeHtml(String(chapterValue)).trim().replace(/^ch(?:apter)?\.?\s*/i, "");
        const title = getInnerHTML(row, /<span\b[^>]*class=["'][^"']*\bchapter-num\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
          || `Chapter ${chapter}`;
        chapters.push({
          id: chapterPath,
          url: chapterUrl.toString(),
          title: decodeHtml(title).trim(),
          chapter,
          index: chapters.length,
        });
      }
      return chapters;
    } catch (error) {
      console.error("MangaStash findChapters error:", error);
      return [];
    }
  }

  async findChapterPages(id) {
    const chapterPath = normalizeSitePath(id, this.siteBase);
    if (!chapterPath) return [];
    try {
      // The chapter page itself is fetched normally.
      const chapterUrl = new URL(chapterPath, this.siteBase).toString();
      const html = await this.fetchHTML(chapterUrl);

      // Scrape the mr-imgok value from the meta tag on the reader page.
      const imgok = getAttribute(
        html.match(/<meta\b[^>]*\bname=["']mr-imgok["'][^>]*>/i)?.[0] || "",
        "content"
      );
      const cookies = imgok ? `mr_imgok=${imgok}` : "";

      // Referer for page images excludes the trailing slash
      const pageReferer = chapterUrl.replace(/\/+$/, "");
      const pages = [];
      const seen = new Set();
      const pageStarts = Array.from(html.matchAll(/<div\b(?=[^>]*\bclass=["'][^"']*\breader-page\b[^"']*["'])[^>]*>/gi));

      for (let pageIndex = 0; pageIndex < pageStarts.length; pageIndex++) {
        const start = pageStarts[pageIndex].index;
        const end = pageStarts[pageIndex + 1]?.index ?? html.length;
        const block = html.slice(start, end);
        const imageTag = block.match(/<img\b[^>]*>/i)?.[0];
        if (!imageTag) continue;
        const imagePath = getAttribute(imageTag, "data-src") || getAttribute(imageTag, "src");
        if (!imagePath) continue;
        const imageUrl = new URL(imagePath, this.siteBase).toString();
        if (seen.has(imageUrl)) continue;
        seen.add(imageUrl);

        const pageNumber = Number(getAttribute(block, "data-page"));
        pages.push({
          url: imageUrl,
          index: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : pages.length,
          // Full browser-like headers for the image request, including the mr_imgok cookie.
          headers: this.pageHeaders(pageReferer, cookies),
        });
      }

      return pages.sort((a, b) => a.index - b.index).map((page, index) => ({ ...page, index }));
    } catch (error) {
      console.error("MangaStash findChapterPages error:", error);
      return [];
    }
  }
}

function normalizeSitePath(value, siteBase) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input, siteBase);
    if (url.origin !== siteBase) return "";
    return url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function getAttribute(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html).match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : "";
}

function getInnerHTML(html, expression) {
  const match = String(html).match(expression);
  return match ? stripTags(match[1]) : "";
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
