/**
 * Seanime Extension for Anime-Sama
 * Implements MangaProvider interface for 'https://anime-sama.to'.
 */
class Provider {
    api = 'https://anime-sama.to';
    s2 = 'https://anime-sama.to/s2/scans';
    imgCdn = 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu';
    lang = 'vf';

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    getHeaders(referer) {
        return {
            'Referer': referer || `${this.api}/`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        };
    }

    getWorkTitle(html) {
        // The oeuvre param the scan API expects is the raw display title
        // (exact spacing/casing as shown on the page), not the URL slug.
        // e.g. title "Blue Lock  " (with trailing spaces) -> oeuvre=Blue%20Lock%20%20
        const match = html.match(/<[^>]*id=["']titreOeuvre["'][^>]*>([^<]*)/i);
        return match?.[1] ?? "";
    }

    async search(opts) {
        const url = `${this.api}/catalogue/?search=${encodeURIComponent(opts.query)}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
            });

            if (!response.ok) return [];

            return this.parseSearchResults(await response.text());
        } catch (e) {
            return [];
        }
    }

    /**
     * Parses the catalogue listing HTML into search results.
     * Only cards whose "Types" info-value includes "Scans" are kept.
     */
    parseSearchResults(html) {
        const results = [];
        const cardRegex = /<div[^>]*class=["'][^"']*catalog-card[^"']*["'][^>]*>([\s\S]*?)<\/a>\s*<\/div>/g;

        for (const cardMatch of html.matchAll(cardRegex)) {
            const card = cardMatch[1];

            // Extract slug from href="https://anime-sama.to/catalogue/<slug>"
            const hrefMatch = card.match(/href=["'](?:https?:\/\/[^/"']*)?\/catalogue\/([^/"']+)\/?["']/);
            if (!hrefMatch) continue;

            // Skip results that don't have a "Scans" (manga) entry
            const typesMatch = card.match(/<p[^>]*class=["'][^"']*info-value[^"']*["'][^>]*>([^<]*)<\/p>/);
            if (!typesMatch || !/scans/i.test(typesMatch[1])) continue;

            const slug = hrefMatch[1];
            const titleMatch = card.match(/<h2[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([^<]*)<\/h2>/);
            const altMatch = card.match(/<p[^>]*class=["'][^"']*alternate-titles[^"']*["'][^>]*>([^<]*)<\/p>/);
            const imgMatch = card.match(/<img[^>]+src=["']([^"']+)["']/);

            const title = titleMatch ? titleMatch[1].trim() : slug;
            const synonyms = (altMatch && altMatch[1].trim()) ? [altMatch[1].trim()] : undefined;

            results.push({
                id: slug,
                title,
                synonyms,
                image: imgMatch?.[1],
            });
        }

        return results;
    }

    async findChapters(mangaId) {
        // mangaId is the slug, e.g. "horimiya"
        try {
            const catalogueUrl = `${this.api}/catalogue/${mangaId}`;
            const pageResponse = await fetch(catalogueUrl, { headers: this.getHeaders() });

            if (!pageResponse.ok) return [];

            const documentHtml = await pageResponse.text();

            // The Manga section declares its scan panels via JS calls like:
            //   panneauScan("Scans", "scan/vf");
            //   panneauScan("Blue Lock Spin-off", "scan_spin-off/vf");
            const panneauRegex = /panneauScan\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;

            // Extract valid scan panels (excluding "va" - version anglaise)
            const panels = Array.from(documentHtml.matchAll(panneauRegex))
                .map(m => ({ scanTitle: m[1], scanPath: m[2].trim() }))
                .filter(p => !p.scanPath.includes('va'));

            if (!panels.length) return [];

            // Process each valid panel concurrently
            const allPanelsResults = await Promise.all(panels.map(async ({ scanPath, scanTitle }) => {
                // scanPath looks like "scan/vf" — the lang is the last segment
                const lang = scanPath.split('/').pop();
                const subMangaUrl = `${this.api}/catalogue/${mangaId}/${scanPath}/`;

                const subResponse = await fetch(subMangaUrl, { headers: this.getHeaders(catalogueUrl) });
                if (!subResponse.ok) return [];
                const subHtml = await subResponse.text();

                const title = this.getWorkTitle(subHtml);
                if (!title.trim()) return [];

                // Fetch chapter count map: { "1": numPages, "2": numPages, ... }
                // Note: this endpoint takes only "oeuvre" (the raw title), no "lang" param.
                const chapUrl = `${this.s2}/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(title)}`;
                const chapResponse = await fetch(chapUrl, { headers: this.getHeaders() });

                if (!chapResponse.ok) return [];

                let apiImageCountJson = {};
                try {
                    apiImageCountJson = await chapResponse.json();
                } catch (e) {
                    return [];
                }

                if (!apiImageCountJson || typeof apiImageCountJson !== 'object') return [];

                return Object.entries(apiImageCountJson).map(([chapName, numPages]) => ({
                    // Encode mangaId, oeuvre title, lang, chapter number and page count
                    // so findChapterPages can build static image URLs + a correct referer.
                    id: `${mangaId}|${encodeURIComponent(title)}|${lang}|${chapName}|${numPages}`,
                    url: `${this.api}/catalogue/${mangaId}/${scanPath}/${chapName}`,
                    title: `Chapitre ${chapName}`,
                    chapter: chapName,
                }));
            }));

            // Deduplicate chapters by name across multiple panels
            const chapters = [];
            const seenNames = new Set();

            for (const panelChapters of allPanelsResults) {
                for (const chapter of panelChapters) {
                    if (!seenNames.has(chapter.chapter)) {
                        seenNames.add(chapter.chapter);
                        chapters.push(chapter);
                    }
                }
            }

            // Sort numerically ascending
            chapters.sort((a, b) => {
                const numA = parseFloat(a.chapter);
                const numB = parseFloat(b.chapter);
                if (isNaN(numA) || isNaN(numB)) {
                    return a.chapter.localeCompare(b.chapter, undefined, { numeric: true });
                }
                return numA - numB;
            });
            
            chapters.forEach((c, i) => c.index = i);

            return chapters;
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        // chapterId is "mangaId|encodedOeuvre|lang|chapNum|pageCount"
        const [, encodedOeuvre, , chapNum, pageCountStr] = chapterId.split('|');
        const pageCount = parseInt(pageCountStr, 10) || 0;
        const referer = `${this.api}/`;

        // Pages are static images at:
        // https://anime-sama.to/s2/scans/{oeuvre}/{chapNum}/{pageNum}.jpg
        return Array.from({ length: pageCount }, (_, i) => ({
            url: `${this.s2}/${encodedOeuvre}/${chapNum}/${i + 1}.jpg`,
            index: i,
            headers: { 'Referer': referer },
        }));
    }
}