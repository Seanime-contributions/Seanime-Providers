/**
 * Seanime Extension for Taiyo
 * Implements MangaProvider interface for 'https://taiyo.moe'.
 */
class Provider {

    constructor() {
        this.api = 'https://taiyo.moe';
        this.searchApi = 'https://meilisearch.taiyo.moe';
        this.cdn = 'https://cdn.taiyo.moe';
        this.searchToken = '48aa86f73de09a7705a2938a1a35e5a12cff6519695fcad395161315182286e5'; // doesn't seem like a session based token, so we can hardcode it
    }

    api = '';
    searchApi = '';
    cdn = '';
    searchToken = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        const query = opts.query;
        const url = `${this.searchApi}/multi-search`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.searchToken}`,
                    'Origin': 'https://taiyo.moe',
                    'Referer': 'https://taiyo.moe/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
                body: JSON.stringify({
                    queries: [{
                        indexUid: 'medias',
                        q: query,
                        facets: ['type'],
                        filter: ['deletedAt IS NULL'],
                        attributesToHighlight: ['*'],
                        highlightPreTag: '__ais-highlight__',
                        highlightPostTag: '__/ais-highlight__',
                        limit: 21,
                        offset: 0,
                    }],
                }),
            });

            if (!response.ok) return [];

            const data = await response.json();
            const hits = data?.results?.[0]?.hits ?? [];

            return hits.map((hit) => {
                const mainTitle = hit.titles?.find(t => t.isMainTitle && t.language === 'en') ?? hit.titles?.[0];
                const title = mainTitle?.title ?? 'Unknown';
                const synonyms = hit.titles?.filter(t => !t.isMainTitle)?.map(t => t.title) ?? [];
                const image = hit.mainCoverId
                    ? `${this.cdn}/medias/${hit.id}/covers/${hit.mainCoverId}.jpg`
                    : undefined;

                return {
                    id: hit.id,
                    title: title,
                    synonyms: synonyms.length > 0 ? synonyms : undefined,
                    year: hit.startDate ? new Date(hit.startDate * 1000).getFullYear() : undefined,
                    image: image,
                };
            });
        } catch (e) {
            return [];
        }
    }

    async findChapters(mangaId) {
        const perPage = 30;
        let allChapters = [];
        let page = 1;
        let totalPages = 1;

        try {
            do {
                const input = encodeURIComponent(JSON.stringify({
                    '0': { json: { mediaId: mangaId, page: page, perPage: perPage } },
                }));

                const url = `${this.api}/api/trpc/chapters.getByMediaId?batch=1&input=${input}`;
                const response = await fetch(url, {
                    headers: {
                        'Referer': `${this.api}/`,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                    },
                });

                if (!response.ok) break;

                const data = await response.json();
                const result = data?.[0]?.result?.data?.json;
                if (!result) break;

                totalPages = result.totalPages ?? 1;

                for (const chapter of result.chapters ?? []) {
                    // Encode mangaId into the chapter id as "mangaId|chapterId"
                    // so findChapterPages can reconstruct the CDN URL without scraping
                    const mergedId = `${mangaId}|${chapter.id}`;
                    allChapters.push({
                        id: mergedId,
                        url: `${this.api}/chapter/${chapter.id}/1`,
                        title: chapter.title ?? `Chapter ${chapter.number}`,
                        chapter: String(chapter.number ?? '0'),
                        index: 0,
                    });
                }

                page++;
            } while (page <= totalPages);

            // Deduplicate by chapter number, keeping first occurrence
            const seen = new Set();
            const unique = allChapters.filter(c => {
                if (seen.has(c.chapter)) return false;
                seen.add(c.chapter);
                return true;
            });

            unique.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            unique.forEach((chapter, i) => { chapter.index = i; });

            return unique;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "mangaId|realChapterId" — split it out
        const parts = chapterId.split('|');
        const mangaId = parts[0];
        const realChapterId = parts[1];

        const url = `${this.api}/chapter/${realChapterId}/1`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            if (!response.ok) return [];

            const body = await response.text();

            // Collect all __next_f.push([1,"..."]) chunks and concatenate
            const pushRegex = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
            let combined = '';
            let m;
            while ((m = pushRegex.exec(body)) !== null) {
                combined += m[1]
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\')
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t');
            }

            if (!combined) return [];

            // Extract the pages array — extension field may be absent in some chapters
            const pagesMatch = combined.match(/"pages":\[([\s\S]*?)\](?=,\"previousChapter\"|,\"nextChapter\"|,\"uploader\")/);
            if (!pagesMatch) return [];

            const pagesJson = JSON.parse(`[${pagesMatch[1]}]`);

            return pagesJson.map((page, index) => ({
                url: `${this.cdn}/medias/${mangaId}/chapters/${realChapterId}/${page.id}.${page.extension ?? 'jpg'}`,
                index: index,
                headers: { 'Referer': url },
            }));
        } catch (e) {
            return [];
        }
    }
}
