class Provider {

    constructor() {
        this.api = 'https://kuramanga.com';
        this.imgCdn = 'https://kuramanga.com';
    }

    api = '';
    imgCdn = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        const query = opts.query;
        const url = `${this.api}/search?ajax=1&page=1&name=${encodeURIComponent(query)}`;

        console.log(`[Kuramanga] search: query="${query}"`);
        console.log(`[Kuramanga] search: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Kuramanga] search: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Kuramanga] search: non-OK response, returning empty array`);
                return [];
            }

            const data = await response.json();

            if (!data.data || !Array.isArray(data.data)) {
                console.log(`[Kuramanga] search: no "data" array in response, returning empty array`);
                return [];
            }

            console.log(`[Kuramanga] search: received ${data.data.length} raw hits`);

            const results = data.data.map(item => ({
                // Encode both id and normalized_title (slug) so findChapters can reconstruct the request
                id: `${item.id}|${item.normalized_title}`,
                title: item.title,
                image: item.thumb || undefined,
            }));

            console.log(`[Kuramanga] search: returning ${results.length} manga results`);

            return results;
        } catch (e) {
            console.log(`[Kuramanga] search: exception caught - ${e.message}`);
            return [];
        }
    }

    async findChapters(mangaId) {
        // mangaId is "id|slug"
        const separatorIndex = mangaId.indexOf('|');
        const slug = separatorIndex !== -1 ? mangaId.substring(separatorIndex + 1) : mangaId;

        const url = `${this.api}/${slug}`;

        console.log(`[Kuramanga] findChapters: mangaId="${mangaId}" -> slug="${slug}"`);
        console.log(`[Kuramanga] findChapters: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Kuramanga] findChapters: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Kuramanga] findChapters: non-OK response, returning empty array`);
                return [];
            }

            const html = await response.text();

            // Match each chapter-item block and pull out the href + chapter title
            const chapterItemRegex = /<div class="chapter-item">\s*<a href="([^"]+)">([^<]+)<\/a>/g;

            let chapters = [];
            let match;
            while ((match = chapterItemRegex.exec(html)) !== null) {
                const href = match[1];
                const title = match[2].trim();

                // href looks like /emperorofsoloplay/chapter-10
                const parts = href.split('/').filter(Boolean);
                const chapterSlug = parts[parts.length - 1]; // e.g. "chapter-10"

                const numberMatch = chapterSlug.match(/([\d.]+)/);
                const chapterNumber = numberMatch ? numberMatch[1] : title.replace(/\D/g, '');

                chapters.push({
                    // Encode both slug and chapterSlug so findChapterPages can reconstruct the request
                    id: `${slug}|${chapterSlug}`,
                    url: `${this.api}${href}`,
                    title: title,
                    chapter: chapterNumber,
                });
            }

            console.log(`[Kuramanga] findChapters: received ${chapters.length} raw chapters`);

            // Page returns newest-to-oldest first; sort numerically ascending by chapter number
            chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));

            // Remove duplicate chapters (same chapter number), keeping the first occurrence
            const seenChapterNumbers = new Set();
            const beforeDedupeCount = chapters.length;
            chapters = chapters.filter(c => {
                if (seenChapterNumbers.has(c.chapter)) return false;
                seenChapterNumbers.add(c.chapter);
                return true;
            });

            if (beforeDedupeCount !== chapters.length) {
                console.log(`[Kuramanga] findChapters: removed ${beforeDedupeCount - chapters.length} duplicate chapter(s)`);
            }

            chapters.forEach((c, i) => { c.index = i; });

            console.log(`[Kuramanga] findChapters: returning ${chapters.length} sorted chapters`);

            return chapters;
        } catch (e) {
            console.log(`[Kuramanga] findChapters: exception caught - ${e.message}`);
            return [];
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "slug|chapterSlug"
        const separatorIndex = chapterId.indexOf('|');
        const slug = chapterId.substring(0, separatorIndex);
        const chapterSlug = chapterId.substring(separatorIndex + 1);

        const url = `${this.api}/${slug}/${chapterSlug}`;
        const referer = url;

        console.log(`[Kuramanga] findChapterPages: chapterId="${chapterId}" -> slug="${slug}", chapterSlug="${chapterSlug}"`);
        console.log(`[Kuramanga] findChapterPages: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': referer,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Kuramanga] findChapterPages: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Kuramanga] findChapterPages: non-OK response, returning empty array`);
                return [];
            }

            const html = await response.text();

            // Match each <img> tag's src attribute, restricted to actual chapter page images
            // (the reader page also contains unrelated images like logos/nav icons/ads)
            const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;

            const pages = [];
            let match;
            let index = 0;
            while ((match = imgRegex.exec(html)) !== null) {
                const src = match[1];

                // Only keep images served from the manga chapters CDN path
                if (!src.includes('/chapters/')) continue;

                pages.push({
                    url: src.startsWith('http') ? src : `${this.imgCdn}${src}`,
                    index: index,
                    headers: { 'Referer': referer },
                });
                index++;
            }

            console.log(`[Kuramanga] findChapterPages: returning ${pages.length} pages`);

            return pages;
        } catch (e) {
            console.log(`[Kuramanga] findChapterPages: exception caught - ${e.message}`);
            return [];
        }
    }
}
