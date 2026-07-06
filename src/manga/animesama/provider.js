/**
 * Seanime Extension for Anime-Sama
 * Implements MangaProvider interface for 'https://anime-sama.to'.
 */
class Provider {

    constructor() {
        this.api = 'https://anime-sama.to';
        this.s2 = 'https://anime-sama.to/s2/scans';
        this.imgCdn = 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu';
        this.lang = 'vf';
    }

    api = '';
    s2 = '';
    imgCdn = '';
    lang = '';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        const query = opts.query;
        const url = `${this.api}/catalogue/?search=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            if (!response.ok) return [];

            const html = await response.text();
            return this.parseSearchResults(html);
        } catch (e) {
            return [];
        }
    }

    /**
     * Parses the catalogue listing HTML into search results.
     * Each result is a `.catalog-card` block. Only cards whose
     * "Types" info-value includes "Scans" are kept — this is how
     * we know the title actually has a manga available.
     */
    parseSearchResults(html) {
        const results = [];

        // Split the HTML into individual card blocks
        const cardRegex = /<div class="shrink-0 catalog-card card-base">([\s\S]*?)<\/a>\s*<\/div>/g;
        let cardMatch;

        while ((cardMatch = cardRegex.exec(html)) !== null) {
            const card = cardMatch[1];

            // Extract slug from href="https://anime-sama.to/catalogue/<slug>"
            const hrefMatch = card.match(/href="https?:\/\/[^"]*\/catalogue\/([^"/]+)\/?"/);
            if (!hrefMatch) continue;
            const slug = hrefMatch[1];

            // Extract title
            const titleMatch = card.match(/<h2[^>]*class="card-title"[^>]*>([^<]*)<\/h2>/);
            const title = titleMatch ? titleMatch[1].trim() : slug;

            // Extract alternate titles / synonyms
            const altMatch = card.match(/<p[^>]*class="alternate-titles"[^>]*>([^<]*)<\/p>/);
            const synonym = altMatch ? altMatch[1].trim() : undefined;

            // Extract cover image
            const imgMatch = card.match(/<img[^>]+src="([^"]+)"/);
            const image = imgMatch ? imgMatch[1] : undefined;

            // Extract the "Types" info-value (e.g. "Anime, Scans")
            const typesMatch = card.match(/<p[^>]*class="info-value"[^>]*>([^<]*)<\/p>/);
            const types = typesMatch ? typesMatch[1].trim() : '';

            // Skip results that don't have a "Scans" (manga) entry
            const hasScans = types
                .split(',')
                .map((t) => t.trim().toLowerCase())
                .includes('scans');

            if (!hasScans) continue;

            results.push({
                id: slug,
                title: title,
                synonyms: synonym ? [synonym] : undefined,
                image: image,
            });
        }

        return results;
    }

    async findChapters(mangaId) {
        // mangaId is the slug, e.g. "horimiya"
        // First verify the catalogue page has a Manga section and determine lang
        try {
            const catalogueUrl = `${this.api}/catalogue/${mangaId}`;
            const pageResponse = await fetch(catalogueUrl, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            if (!pageResponse.ok) return [];

            const pageHtml = await pageResponse.text();

            // The oeuvre param the scan API expects is the raw display title
            // (exact spacing/casing as shown on the page), not the URL slug.
            // e.g. title "Blue Lock  " (with trailing spaces) -> oeuvre=Blue%20Lock%20%20
            const titleMatch = pageHtml.match(/<h1[^>]*id=["']titreOeuvre["'][^>]*>([^<]*)<\/h1>/)
                || pageHtml.match(/<h1[^>]*>([^<]*)<\/h1>/);
            const oeuvre = titleMatch ? titleMatch[1] : mangaId;

            // The Manga section declares its scan panels via JS calls like:
            //   panneauScan("Scans", "scan/vf");
            //   panneauScan("Blue Lock Spin-off", "scan_spin-off/vf");
            // We only want the main "Scans" panel (not spin-offs/side stories),
            // and we extract its path (e.g. "scan/vf") to know the lang segment.
            const panneauRegex = /panneauScan\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
            let scanPath = null;
            let panneauMatch;

            while ((panneauMatch = panneauRegex.exec(pageHtml)) !== null) {
                const name = panneauMatch[1].trim().toLowerCase();
                const path = panneauMatch[2].trim();

                if (name === 'scans') {
                    scanPath = path;
                    break;
                }
            }

            // No manga section found
            if (!scanPath) return [];

            // scanPath looks like "scan/vf" or "scan/vostfr" — the lang is the last segment
            const lang = scanPath.split('/').pop();

            // Fetch chapter count map: { "1": numPages, "2": numPages, ... }
            // Note: this endpoint takes only "oeuvre" (the raw title), no "lang" param.
            const chapUrl = `${this.s2}/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(oeuvre)}`;
            const chapResponse = await fetch(chapUrl, {
                headers: {
                    'Referer': `${this.api}/`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                },
            });

            if (!chapResponse.ok) return [];

            const chapMap = await chapResponse.json();

            // chapMap keys are chapter numbers as strings, values are page counts
            const chapters = Object.keys(chapMap).map((chapNum, i) => ({
                // Encode mangaId, oeuvre title, lang, chapter number and page count
                // so findChapterPages can build static image URLs + a correct referer.
                id: `${mangaId}|${encodeURIComponent(oeuvre)}|${lang}|${chapNum}|${chapMap[chapNum]}`,
                url: `${this.api}/catalogue/${mangaId}/${scanPath}/${chapNum}`,
                title: `Chapter ${chapNum}`,
                chapter: chapNum,
                index: i,
            }));

            // Sort numerically ascending
            chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
            chapters.forEach((c, i) => { c.index = i; });

            return chapters;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "mangaId|encodedOeuvre|lang|chapNum|pageCount"
        const parts = chapterId.split('|');
        const mangaId = parts[0];
        const encodedOeuvre = parts[1];
        const lang = parts[2];
        const chapNum = parts[3];
        const pageCount = parseInt(parts[4], 10) || 0;

        const referer = `${this.api}/catalogue/${mangaId}/scan/${lang}/${chapNum}`;

        // Pages are static images at:
        // https://anime-sama.to/s2/scans/{oeuvre}/{chapNum}/{pageNum}.jpg
        const pages = [];
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            pages.push({
                url: `${this.s2}/${encodedOeuvre}/${chapNum}/${pageNum}.jpg`,
                index: pageNum - 1,
                headers: { 'Referer': referer },
            });
        }

        return pages;
    }
}