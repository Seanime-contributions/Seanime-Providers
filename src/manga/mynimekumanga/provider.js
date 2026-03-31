/**
 * Seanime Extension for MyNimeku
 * Implements MangaProvider interface for 'https://www.mynimeku.com'.
 */
class Provider {
    constructor() {
        this.api = "https://www.mynimeku.com";
        this.proxyBase = "https://corsproxy.io/?url=";
    }

    // Proxy helper
    proxy(url) {
        return `${this.proxyBase}${encodeURIComponent(url)}`;
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        const url = `${this.api}/?s=${encodeURIComponent(opts.query)}`;
        
        try {
            const res = await fetch(this.proxy(url));
            const html = await res.text();

            const results = [];
            /**
             * Regex logic:
             * 1. Matches <article> tags
             * 2. Captures the block inside
             * 3. Uses 'gs' flags for global multi-line matching
             */
            const regex = /<article[^>]*>([\s\S]*?)<\/article>/gs;
            
            let match;
            while ((match = regex.exec(html)) !== null) {
                const block = match[1];

                // Only proceed if the type is "Komik"
                if (!block.includes('<div class="type">Komik</div>')) continue;

                // Extract ID/Slug from the href
                const idMatch = block.match(/href="https?:\/\/[^"]*\/komik\/([^/"]+)\/"/);
                if (!idMatch) continue;
                const id = idMatch[1];

                // Extract Title
                const titleMatch = block.match(/<div class="title"><h2>\s*([^<]+)<\/h2><\/div>/);
                const title = titleMatch ? titleMatch[1].trim() : id;

                // Extract Image
                const imgMatch = block.match(/<img[^>]+src="(.*?)"/);
                const image = imgMatch ? imgMatch[1] : undefined;

                results.push({ id, title, image });
            }

            return results;
        } catch (e) {
            console.error("Search failed", e);
            return [];
        }
    }

    async findChapters(mangaId) {
        const url = `${this.api}/komik/${mangaId}/`;

        try {
            const res = await fetch(this.proxy(url));
            const html = await res.text();
            const chapters = [];

            // Matches the chapter listing structure
            const epRegex = /<div class="chap-wrapper">.*?<a href="(.*?)"><item>(.*?)<\/item><\/a>.*?<span class="lchx"><a[^>]*>(.*?)<\/a>/gs;

            let match;
            while ((match = epRegex.exec(html)) !== null) {
                const href = match[1];
                const chapterIdMatch = href.match(/\/chapter\/([^/]+)\//);
                const chapterId = chapterIdMatch ? chapterIdMatch[1] : href;

                chapters.push({
                    id: chapterId,
                    url: href,
                    title: match[3].trim(),
                    chapter: match[2].trim(),
                    index: 0,
                });
            }

            // Sort ascending and set index
            chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            chapters.forEach((c, i) => { c.index = i; });

            return chapters;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        const url = `${this.api}/chapter/${chapterId}/`;

        try {
            const res = await fetch(this.proxy(url));
            const html = await res.text();

            const readerMatch = html.match(/<div class="reader-area"[^>]*>([\s\S]*?)<\/div>/);
            if (!readerMatch) return [];

            const pages = [];
            // Regex to find images with IDs and SRCs
            const imgRegex = /<img[^>]+(?:img-id="(\d+)"[^>]+src="([^"]+)"|src="([^"]+)"[^>]+img-id="(\d+)")/g;
            
            let match;
            while ((match = imgRegex.exec(readerMatch[1])) !== null) {
                const index = parseInt(match[1] || match[4], 10);
                let src = match[2] || match[3];
                if (src.startsWith('//')) src = 'https:' + src;

                pages.push({
                    url: src,
                    index: index,
                    headers: { 'Referer': this.api + '/' },
                });
            }

            return pages.sort((a, b) => a.index - b.index);
        } catch (e) {
            return [];
        }
    }
}
