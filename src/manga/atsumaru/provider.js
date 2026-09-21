/**
 * Seanime Extension for Atsu.moe
 * Implements MangaProvider interface for 'https://atsu.moe'.
 */
class Provider {

    constructor() {
        this.api = 'https://atsu.moe';
        this.imgCdn = 'https://cdn.atsu.moe';
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
        const url = `${this.api}/collections/manga/documents/search?q=${encodeURIComponent(query)}&query_by=title%2CenglishTitle%2CotherNames`;

        console.log(`[Atsu.moe] search: query="${query}"`);
        console.log(`[Atsu.moe] search: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Atsu.moe] search: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Atsu.moe] search: non-OK response, returning empty array`);
                return [];
            }

            const data = await response.json();

            if (!data.hits || !Array.isArray(data.hits)) {
                console.log(`[Atsu.moe] search: no "hits" array in response, returning empty array`);
                return [];
            }

            console.log(`[Atsu.moe] search: received ${data.hits.length} raw hits`);

            const results = data.hits
                .filter(hit => hit.document)
                .map(hit => ({
                    id: hit.document.id,
                    title: hit.document.title,
                    image: hit.document.posterMedium
                        ? `${this.imgCdn}${hit.document.posterMedium}`
                        : hit.document.poster
                            ? `${this.imgCdn}${hit.document.poster}`
                            : undefined,
                }));

            console.log(`[Atsu.moe] search: returning ${results.length} manga results`);

            return results;
        } catch (e) {
            console.log(`[Atsu.moe] search: exception caught - ${e.message}`);
            return [];
        }
    }

    async findChapters(mangaId) {
        const url = `${this.api}/api/manga/allChapters?mangaId=${encodeURIComponent(mangaId)}`;

        console.log(`[Atsu.moe] findChapters: mangaId="${mangaId}"`);
        console.log(`[Atsu.moe] findChapters: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Atsu.moe] findChapters: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Atsu.moe] findChapters: non-OK response, returning empty array`);
                return [];
            }

            const data = await response.json();

            if (!data.chapters || !Array.isArray(data.chapters)) {
                console.log(`[Atsu.moe] findChapters: no "chapters" array in response, returning empty array`);
                return [];
            }

            console.log(`[Atsu.moe] findChapters: received ${data.chapters.length} raw chapters`);

            let chapters = data.chapters.map(chapter => ({
                // Encode both mangaId and chapterId so findChapterPages can reconstruct the request
                id: `${mangaId}|${chapter.id}`,
                url: `${this.api}/read/${mangaId}/${chapter.id}`,
                title: chapter.title || `Chapter ${chapter.number}`,
                chapter: String(chapter.number),
                index: chapter.index,
            }));

            // Sort numerically ascending by chapter number
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
                console.log(`[Atsu.moe] findChapters: removed ${beforeDedupeCount - chapters.length} duplicate chapter(s)`);
            }

            chapters.forEach((c, i) => { c.index = i; });

            console.log(`[Atsu.moe] findChapters: returning ${chapters.length} sorted chapters`);

            return chapters;
        } catch (e) {
            console.log(`[Atsu.moe] findChapters: exception caught - ${e.message}`);
            return [];
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "mangaId|chapterId"
        const separatorIndex = chapterId.indexOf('|');
        const mangaId = chapterId.substring(0, separatorIndex);
        const chapId = chapterId.substring(separatorIndex + 1);

        const url = `${this.api}/api/read/chapter?mangaId=${encodeURIComponent(mangaId)}&chapterId=${encodeURIComponent(chapId)}`;
        const referer = `${this.api}/read/${mangaId}/${chapId}`;

        console.log(`[Atsu.moe] findChapterPages: chapterId="${chapterId}" -> mangaId="${mangaId}", chapId="${chapId}"`);
        console.log(`[Atsu.moe] findChapterPages: url=${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': referer,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            console.log(`[Atsu.moe] findChapterPages: response status=${response.status}`);

            if (!response.ok) {
                console.log(`[Atsu.moe] findChapterPages: non-OK response, returning empty array`);
                return [];
            }

            const data = await response.json();

            if (!data.readChapter || !Array.isArray(data.readChapter.pages)) {
                console.log(`[Atsu.moe] findChapterPages: no "readChapter.pages" array in response, returning empty array`);
                return [];
            }

            console.log(`[Atsu.moe] findChapterPages: received ${data.readChapter.pages.length} pages`);

            const pages = data.readChapter.pages.map(page => ({
                url: page.image.startsWith('http') ? page.image : `${this.imgCdn}${page.image}`,
                index: page.number,
                headers: { 'Referer': referer },
            }));

            console.log(`[Atsu.moe] findChapterPages: returning ${pages.length} pages`);

            return pages;
        } catch (e) {
            console.log(`[Atsu.moe] findChapterPages: exception caught - ${e.message}`);
            return [];
        }
    }
}
