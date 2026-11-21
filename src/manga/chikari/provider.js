class Provider {

    constructor() {
        this.api = 'https://chikari.moe/api';
    }

    api = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    /**
     * Search for manga using the Chikari API.
     */
    async search(opts) {
        const query = opts.query;

        const url = `${this.api}/search?q=${encodeURIComponent(query)}&include_novels=false`;

        try {
            const response = await fetch(url);

            if (!response.ok) return [];

            const results = await response.json();

            if (!Array.isArray(results)) return [];

            return results.map(manga => ({
                id: manga.slug,
                title: manga.title,
                synonyms: undefined,
                year: undefined,
                image: manga.cover_url,
            }));
        }
        catch (e) {
            console.error('Chikari search error:', e);
            return [];
        }
    }

    /**
     * Find all chapters for a manga.
     * Supports API pagination.
     */
    async findChapters(mangaId) {
        const limit = 100;
        let offset = 0;
        let total = Infinity;
        let chapters = [];

        try {
            while (offset < total) {
                const url = `${this.api}/series/${encodeURIComponent(mangaId)}/chapters?order=desc&limit=${limit}&offset=${offset}`;

                const response = await fetch(url);

                if (!response.ok) break;

                const data = await response.json();

                if (!Array.isArray(data.items)) break;

                total = data.total ?? data.items.length;

                data.items.forEach(chapter => {
                    const number = String(chapter.number);

                    chapters.push({
                        // Format: horimiya|130
                        id: `${mangaId}|${number}`,

                        url: `${this.api}/series/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(number)}`,

                        title: chapter.title || `Chapter ${number}`,
                        chapter: number,
                        index: 0,
                    });
                });

                if (data.items.length === 0) break;

                offset += data.items.length;
            }

            // Remove duplicate chapters.
            chapters = Array.from(
                new Map(
                    chapters.map(chapter => [chapter.id, chapter])
                ).values()
            );

            // Sort chapters ascending.
            chapters.sort(
                (a, b) => parseFloat(a.chapter) - parseFloat(b.chapter)
            );

            // Assign sequential indexes.
            chapters.forEach((chapter, index) => {
                chapter.index = index;
            });

            return chapters;
        }
        catch (e) {
            console.error('Chikari chapters error:', e);
            return [];
        }
    }

    /**
     * Fetch image pages for a chapter.
     */
    async findChapterPages(chapterId) {
        try {
            // Expected ID format: horimiya|130
            const separator = chapterId.lastIndexOf('|');

            if (separator === -1) {
                console.error(
                    'Invalid Chikari chapter ID:',
                    chapterId
                );
                return [];
            }

            const mangaId = chapterId.substring(0, separator);
            const chapterNumber = chapterId.substring(separator + 1);

            const url = `${this.api}/series/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterNumber)}`;

            const response = await fetch(url);

            if (!response.ok) return [];

            const data = await response.json();

            if (!Array.isArray(data.pages)) return [];

            return data.pages.map((pageUrl, index) => ({
                url: pageUrl,
                index: index,
                headers: {
                    Referer: url,
                },
            }));
        }
        catch (e) {
            console.error('Chikari pages error:', e);
            return [];
        }
    }
}
