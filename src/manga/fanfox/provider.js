/**
 * Seanime Extension for FanFox
 * Implements MangaProvider interface for 'https://m.fanfox.net'.
 */
class Provider {

    constructor() {
        this.api = 'https://m.fanfox.net';
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    }

    api = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    /**
     * Normalizes a URL/href to an absolute https URL.
     */
    normalizeUrl(href) {
        if (!href) return '';
        if (href.startsWith('//')) return `https:${href}`;
        if (href.startsWith('/')) return `${this.api}${href}`;
        if (href.startsWith('http://')) return href.replace('http://', 'https://');
        if (href.startsWith('https://')) return href;
        return `${this.api}/${href}`;
    }

    /**
     * Searches for manga based on a query.
     */
    async search(opts) {
        const queryParam = opts.query;
        const url = `${this.api}/search?k=${encodeURIComponent(queryParam)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': this.userAgent,
                },
            });

            if (!response.ok) return [];

            const body = await response.text();
            const doc = LoadDoc(body);

            let mangas = [];

            // Search results are in li > div.post-one.clearfix
            doc('li div.post-one.clearfix').each((index, element) => {
                const linkElement = element.find('a').first();
                const imgElement = element.find('span.cover img').first();
                const titleElement = element.find('p.title').first();

                if (!linkElement || !titleElement) return;

                const title = titleElement.text().trim();
                const mangaUrl = linkElement.attrs()['href']; // e.g. /manga/horimiya

                // Extract manga ID from URL (everything after /manga/)
                const mangaId = mangaUrl.replace(/^.*\/manga\//, '').replace(/\/$/, '');

                const imgElementSrc = imgElement ? imgElement.attrs()['src'] : '';
                const imageUrl = this.normalizeUrl(imgElementSrc);

                mangas.push({
                    id: mangaId,
                    title: title,
                    synonyms: undefined,
                    year: undefined,
                    image: imageUrl,
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
     */
    async findChapters(mangaId) {
        const url = `${this.api}/manga/${mangaId}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': this.userAgent,
                },
            });
            const body = await response.text();
            const doc = LoadDoc(body);

            let chapters = [];

            // Chapters are in dd.chlist > a (skip dt.chtitle which are volume headers)
            doc('dd.chlist a').each((index, element) => {
                const href = element.attrs()['href']; // e.g. //m.fanfox.net/manga/horimiya/v17/c131/1.html
                if (!href) return;

                // Clone the node so we can strip marker spans without mutating
                // the live DOM.
                let chapterText;
                try {
                    const cloned = element.clone();
                    // Remove release date span, "new" marker, and any other
                    // non-title spans FanFox injects into chapter links.
                    cloned.find('.chdate, .chnew, .new, .label, span.hot').remove();
                    chapterText = cloned.text();
                } catch (err) {
                    chapterText = element.text();
                }

                // Collapse whitespace
                chapterText = chapterText.replace(/\s+/g, ' ').trim();

                // Fallback cleanup for anything that slipped through
                chapterText = chapterText
                    // ISO or "Mon D, YYYY" dates
                    .replace(/\s*(?:[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})\s*$/, '')
                    // Relative dates: "new Yesterday", "3 days ago", "today", "2 hours ago", etc.
                    .replace(/\s*\b(?:new|hot|updated|yesterday|today)\b(?:\s+\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago)?\s*$/i, '')
                    .replace(/\s*\b\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago\b\s*$/i, '')
                    .trim();

                // Final safety net: keep only the "Ch NNN" prefix and drop
                // everything after it (dates, "new", "yesterday", etc.)
                const labelMatch = chapterText.match(/^(Ch\s*\d+(?:\.\d+)?)/i);
                if (labelMatch) {
                    chapterText = labelMatch[1];
                }

                // Extract chapter number
                const chapMatch = chapterText.match(/Ch\s*(\d+(?:\.\d+)?)/i);
                const chapterNumber = chapMatch ? chapMatch[1] : '0';

                // Build clean absolute URL first
                const absoluteUrl = this.normalizeUrl(href);

                // Strip protocol and host to get a clean path-based ID
                const id = absoluteUrl.replace(/^https?:\/\//, '');

                chapters.push({
                    id: id, // e.g. "m.fanfox.net/manga/horimiya/v17/c131/1.html"
                    url: absoluteUrl,
                    title: chapterText,
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
     * Chapter ID is the URL without the protocol, e.g.
     * "m.fanfox.net/manga/horimiya/v17/c131/1.html"
     */
    async findChapterPages(chapterId) {
        // Build the absolute chapter URL
        const chapterUrl = chapterId.startsWith('http')
            ? chapterId
            : `https://${chapterId}`;

        // Convert to roll format: /manga/ -> /roll_manga/
        const rollUrl = chapterUrl.replace('/manga/', '/roll_manga/');
        const referer = chapterUrl;

        try {
            const response = await fetch(rollUrl, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Referer': referer,
                },
            });

            const body = await response.text();
            const doc = LoadDoc(body);

            let pages = [];

            // Images have class "reader-page" and use data-original for actual URL
            doc('img.reader-page').each((index, element) => {
                const attrs = element.attrs();
                // Prefer data-original (lazy-loaded), fall back to src
                const imgUrl = attrs['data-original'] || attrs['src'];
                if (!imgUrl) return;

                const finalUrl = this.normalizeUrl(imgUrl);

                pages.push({
                    url: finalUrl,
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