/**
 * Seanime Extension for LelManga
 * Implements MangaProvider interface for 'https://www.lelmanga.com'.
 */
class Provider {

    constructor() {
        this.api = 'https://www.lelmanga.com';
    }

    api = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        const query = opts.query;
        const url = `${this.api}/?s=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                    'Referer': this.api,
                },
            });

            if (!response.ok) return [];

            const html = await response.text();
            const results = [];

            // Match manga anchors inside the `.bs` result cards. Attribute
            // order and whitespace vary between LelManga responses.
            const anchorRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
            let match;
            const seen = new Set();

            while ((match = anchorRegex.exec(html)) !== null) {
                const attributes = match[1];
                const inner = match[2];
                const hrefMatch = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i);
                const titleMatch = attributes.match(/\btitle\s*=\s*["']([^"']+)["']/i);
                if (!hrefMatch || !titleMatch) continue;

                let href;
                try {
                    href = new URL(hrefMatch[1], this.api).toString();
                } catch {
                    continue;
                }

                const slugMatch = new URL(href).pathname.match(/\/manga\/([^/]+)\/?$/i);
                if (!slugMatch) continue;
                const slug = slugMatch[1];
                if (seen.has(slug)) continue;
                seen.add(slug);
                const title = titleMatch[1].trim();

                // Extract cover image
                const imgMatch = inner.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
                const image = imgMatch ? new URL(imgMatch[1], this.api).toString() : undefined;

                results.push({
                    id: slug,
                    title: title,
                    image: image,
                });
            }

            return results;
        } catch (e) {
            return [];
        }
    }

    async findChapters(mangaId) {
        const url = `${this.api}/manga/${mangaId}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                    'Referer': this.api,
                },
            });

            if (!response.ok) return [];

            const html = await response.text();
            const chapters = [];

            // Match <li data-num="..."> directly — no outer-div extraction needed
            const liRegex = /<li\s+data-num="([^"]+)">([\s\S]*?)<\/li>/g;
            let liMatch;

            while ((liMatch = liRegex.exec(html)) !== null) {
                const chapNum = liMatch[1].trim();
                const liInner = liMatch[2];

                // Extract chapter URL
                const aMatch = liInner.match(/<a\s+href="([^"]+)"/);
                if (!aMatch) continue;
                const chapUrl = aMatch[1];

                // Extract chapter title label
                const titleMatch = liInner.match(/<span class="chapternum">([^<]+)<\/span>/);
                const title = titleMatch ? titleMatch[1].trim() : `Chapitre ${chapNum}`;

                chapters.push({
                    id: chapUrl,
                    url: chapUrl,
                    title: title,
                    chapter: chapNum,
                    index: 0,
                });
            }

            // Sort numerically ascending
            chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            chapters.forEach((c, i) => { c.index = i; });

            return chapters;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        const url = chapterId;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                    'Referer': this.api,
                },
            });

            if (!response.ok) return [];

            const html = await response.text();

            // Extract #readerarea block
            const readerMatch = html.match(/<div[^>]+id="readerarea"[^>]*>([\s\S]*?)<\/div>/);
            if (!readerMatch) return [];

            const readerHtml = readerMatch[1];
            const pages = [];

            const imgRegex = /<img[^>]+src="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp|gif)[^"]*)"/gi;
            let imgMatch;
            let index = 0;

            while ((imgMatch = imgRegex.exec(readerHtml)) !== null) {
                const imgUrl = imgMatch[1];

                // Skip WordPress thumbnails (small resize hints)
                if (imgUrl.includes('resize=165') || imgUrl.includes('resize=130')) continue;

                pages.push({
                    url: imgUrl,
                    index: index++,
                    headers: { 'Referer': url },
                });
            }

            return pages;
        } catch (e) {
            return [];
        }
    }
}
