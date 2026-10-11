/**
 * Seanime Extension for MangaHub
 * Implements MangaProvider interface for 'https://mangahub.ru'.
 */
class Provider {

    constructor() {
        this.api = 'https://mangahub.ru';
    }

    api = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    /**
     * Searches for manga based on a query.
     */
    async search(opts) {
        const queryParam = opts.query;
        const url = `${this.api}/search?query=${encodeURIComponent(queryParam)}`;

        try {
            const response = await fetch(url, {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            });

            if (!response.ok) return [];

            const body = await response.text();
            const doc = LoadDoc(body);

            let mangas = [];

            doc('div.item-slide').each((index, element) => {
                const linkElement = element.find('a.fw-medium').first();
                const imageElement = element.find('img.item-slide-image').first();
                const metaElement = element.find('div.text-muted').first();

                const title = linkElement.text().trim();
                const href = linkElement.attrs()['href']; // e.g. /title/fly_me_to_the_moon
                const mangaId = href.replace('/title/', '');
                const thumbnailUrl = imageElement.attrs()['src'];

                // Parse year from meta text like "2018, Манга"
                const metaText = metaElement ? metaElement.text().trim() : '';
                const yearMatch = metaText.match(/(\d{4})/);
                const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

                if (!mangaId || !title) return;

                mangas.push({
                    id: mangaId,
                    title: title,
                    synonyms: undefined,
                    year: year,
                    image: thumbnailUrl ? (thumbnailUrl.startsWith('http') ? thumbnailUrl : `https:${thumbnailUrl}`) : undefined,
                });
            });

            return mangas;
        }
        catch (e) {
            return [];
        }
    }

    /**
     * Finds and parses all chapters for a given manga ID.
     * Chapter list page: https://mangahub.ru/title/{mangaId}/chapters
     */
    async findChapters(mangaId) {
        const url = `${this.api}/title/${mangaId}/chapters`;

        try {
            const response = await fetch(url, {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            });

            if (!response.ok) return [];

            const body = await response.text();
            const doc = LoadDoc(body);

            let chapters = [];

            doc('a.fs-2.fw-medium').each((index, element) => {
                const href = element.attrs()['href']; // e.g. /read/289191
                if (!href) return;

                // Chapter ID is the numeric part after /read/
                const chapterId = href.replace('/read/', '');

                // Full text: e.g. "Том 7. Глава 61 - Some subtitle"
                const fullText = element.find('span.text-truncate').text().trim();

                // Extract chapter number from something like "Глава 61" or "Chapter 61"
                const chapterMatch = fullText.match(/(?:Глава|Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
                const chapterNumber = chapterMatch ? chapterMatch[1] : '0';

                chapters.push({
                    id: chapterId,
                    url: `${this.api}/read/${chapterId}`,
                    title: fullText,
                    chapter: chapterNumber,
                    index: 0,
                });
            });

            // Sort ascending by chapter number
            chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));

            // Assign index after sort
            chapters.forEach((chapter, i) => {
                chapter.index = i;
            });

            return chapters;
        }
        catch (e) {
            return [];
        }
    }

    /**
     * Finds and parses the image pages for a given chapter ID.
     * Chapter read page: https://mangahub.ru/read/{chapterId}
     *
     * Images are in <reader-scan> elements. The first image uses `src`,
     * subsequent (lazy-loaded) images use `data-src`.
     */
    async findChapterPages(chapterId) {
        const url = `${this.api}/read/${chapterId}`;
        const referer = url;

        try {
            const response = await fetch(url, {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            });

            if (!response.ok) return [];

            const body = await response.text();
            const doc = LoadDoc(body);

            let pages = [];

            doc('reader-scan img').each((index, element) => {
                const attrs = element.attrs();

                // Prefer data-src (lazy), fall back to src (eager first image)
                const rawUrl = attrs['data-src'] || attrs['src'];
                if (!rawUrl) return;

                // Ensure protocol is present (src may be protocol-relative: //...)
                const imgUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;

                pages.push({
                    url: imgUrl,
                    index: index,
                    headers: {
                        'Referer': referer,
                    },
                });
            });

            return pages;
        }
        catch (e) {
            return [];
        }
    }
}
