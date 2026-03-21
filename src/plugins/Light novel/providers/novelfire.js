(function() {
    // Check if script is already loaded
    if (window.NovelFireSource) {
        return;
    }

    const NOVELFIRE_URL = "https://novelfire.net";
    const CORS_PROXY_URL = "https://corsproxy.io/?url=";

    // --- Private Utility Functions ---

    function getLevenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) == a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                }
            }
        }
        return matrix[b.length][a.length];
    }

    function getSimilarity(s1, s2) {
        let longer = s1.toLowerCase();
        let shorter = s2.toLowerCase();
        if (s1.length < s2.length) { longer = s2.toLowerCase(); shorter = s1.toLowerCase(); }
        let longerLength = longer.length;
        if (longerLength == 0) { return 1.0; }
        const distance = getLevenshteinDistance(longer, shorter);
        return (longerLength - distance) / parseFloat(longerLength);
    }

    // --- Interface Implementation ---

    /**
     * Searches NovelFire for a query
     * @param {string} query 
     * @returns {Promise<SearchResult[]>}
     */
    async function manualSearch(query) {
        const url = `${CORS_PROXY_URL}${NOVELFIRE_URL}/search?keyword=${encodeURIComponent(query)}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Select all novel items
            const novelItems = doc.querySelectorAll('.novel-item');

            novelItems.forEach(item => {
                const link = item.querySelector('a');
                if (!link) return;

                const title = link.getAttribute('title')?.trim() || "Unknown Title";
                let novelUrl = link.getAttribute('href') || "#";

                // Convert relative URL to absolute
                if (novelUrl.startsWith("/")) {
                    novelUrl = `${NOVELFIRE_URL}${novelUrl}`;
                }

                // Get cover image
                const imgElement = item.querySelector('.novel-cover img');
                let image = imgElement?.getAttribute('src') || "";
                if (image && image.startsWith("/")) {
                    image = `${NOVELFIRE_URL}${image}`;
                }

                // Get chapters count from stats
                const stats = item.querySelectorAll('.novel-stats');
                let latestChapter = "No Chapter";
                stats.forEach(stat => {
                    const text = stat.textContent?.trim() || "";
                    if (text.includes('Chapters')) {
                        latestChapter = text.replace('Chapters', 'Ch').trim();
                    } else if (text.includes('Rank')) {
                        // Could use rank as fallback info
                    }
                });

                results.push({ 
                    title: title, 
                    url: novelUrl, 
                    image: image, 
                    latestChapter: latestChapter 
                });
            });
            return results;
        } catch (err) {
            console.error("[novel-plugin] NovelFire Search Error:", err);
            return [];
        }
    }

    /**
     * Gets all chapter URLs and titles for a novel
     * @param {string} novelUrl 
     * @returns {Promise<Chapter[]>}
     */
    async function getChapters(novelUrl) {
        try {
            // Append "/chapters" to the novel URL to get the chapter list
            let chaptersUrl = novelUrl;
            if (!novelUrl.endsWith('/chapters')) {
                chaptersUrl = novelUrl.endsWith('/') 
                    ? `${novelUrl}chapters` 
                    : `${novelUrl}/chapters`;
            }

            const url = `${CORS_PROXY_URL}${chaptersUrl}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Chapter fetch failed: ${res.status}`);
            const html = await res.text();

            const chapters = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Select all chapter items
            const chapterItems = doc.querySelectorAll('.chapter-list li a');

            chapterItems.forEach(link => {
                let url = link.getAttribute('href');
                const title = link.getAttribute('title')?.trim() || link.querySelector('.chapter-title')?.textContent?.trim() || "Unknown Chapter";

                // Convert relative URL to absolute
                if (url && url.startsWith("/")) {
                    url = `${NOVELFIRE_URL}${url}`;
                }

                if (url) {
                    chapters.push({ url: url, title: title });
                }
            });

            // Return chapters in correct order (already in order from the HTML)
            return chapters;
        } catch (err) {
            console.error("[novel-plugin] NovelFire Details Error:", err);
            return [];
        }
    }

    /**
     * Gets the processed HTML content for a single chapter
     * @param {string} chapterUrl 
     * @returns {Promise<string>}
     */
    async function getChapterContent(chapterUrl) {
        try {
            const res = await fetch(`${CORS_PROXY_URL}${chapterUrl}`);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const contentElement = doc.querySelector('#content');

            if (!contentElement) {
                throw new Error("Could not extract chapter content.");
            }

            // Clean and process the content
            // 1. Clone the element to avoid modifying the original DOM
            const contentClone = contentElement.cloneNode(true);

            // 2. Remove any script tags, ads, or unwanted elements
            contentClone.querySelectorAll('script, style, ins, iframe, .ads, [class*="ad-"], [id*="ad-"]').forEach(el => el.remove());

            // 3. Clean up italics and other formatting
            contentClone.querySelectorAll('i, em').forEach(el => {
                const text = el.textContent;
                el.replaceWith(`<em>${text}</em>`);
            });

            // 4. Ensure proper paragraph structure
            let cleanHtml = contentClone.innerHTML;

            // Replace any double line breaks with paragraph breaks
            cleanHtml = cleanHtml.replace(/(<\/p>\s*<p>)/g, '</p><p>');

            // If there's no paragraph structure, wrap in paragraphs
            if (!cleanHtml.includes('<p>')) {
                const paragraphs = cleanHtml.split('\n').filter(p => p.trim());
                cleanHtml = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
            }

            return cleanHtml;
        } catch (err) {
            console.error("[novel-plugin] NovelFire ChapterContent Error:", err);
            return "<p>Error loading chapter content.</p>";
        }
    }

    /**
     * Tries to find the best match on NovelFire for an Anilist title
     * @param {string} romajiTitle 
     * @param {string} englishTitle 
     * @returns {Promise<{ match: SearchResult, similarity: number } | null>}
     */
    async function autoMatch(romajiTitle, englishTitle) {
        console.log(`[novel-plugin-matcher] (NovelFire) START: Matching for "${romajiTitle}"`);

        // 1. Get results for Romaji title
        const romajiResults = await manualSearch(romajiTitle);
        let bestRomajiMatch = null;
        let bestRomajiScore = 0.0;
        if (romajiResults && romajiResults.length > 0) {
            romajiResults.forEach(item => {
                const similarity = getSimilarity(romajiTitle, item.title);
                console.log(`[novel-plugin-matcher] (NovelFire) Romaji Compare: "${romajiTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                if (similarity > bestRomajiScore) {
                    bestRomajiScore = similarity;
                    bestRomajiMatch = item;
                }
            });
        }
        console.log(`[novel-plugin-matcher] (NovelFire) Romaji Best: "${bestRomajiMatch?.title}" (Score: ${bestRomajiScore.toFixed(2)})`);

        // 2. Get results for English title
        let bestEnglishMatch = null;
        let bestEnglishScore = 0.0;
        if (englishTitle && englishTitle.toLowerCase() !== romajiTitle.toLowerCase()) {
            console.log(`[novel-plugin-matcher] (NovelFire) INFO: Also matching with English: "${englishTitle}"`);
            const englishResults = await manualSearch(englishTitle);
            if (englishResults && englishResults.length > 0) {
                englishResults.forEach(item => {
                    const similarity = getSimilarity(englishTitle, item.title);
                    console.log(`[novel-plugin-matcher] (NovelFire) English Compare: "${englishTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                    if (similarity > bestEnglishScore) {
                        bestEnglishScore = similarity;
                        bestEnglishMatch = item;
                    }
                });
            }
            console.log(`[novel-plugin-matcher] (NovelFire) English Best: "${bestEnglishMatch?.title}" (Score: ${bestEnglishScore.toFixed(2)})`);
        }

        // 3. Compare the best scores
        let bestMatch = null;
        let highestSimilarity = 0.0;
        if (bestRomajiScore > bestEnglishScore) {
            bestMatch = bestRomajiMatch;
            highestSimilarity = bestRomajiScore;
        } else {
            bestMatch = bestEnglishMatch;
            highestSimilarity = bestEnglishScore;
        }

        console.log(`[novel-plugin-matcher] (NovelFire) Final Best: "${bestMatch?.title}" (Score: ${highestSimilarity.toFixed(2)})`);

        // 4. Check against the 0.8 threshold
        if (highestSimilarity > 0.8 && bestMatch) {
            console.log(`[novel-plugin-matcher] (NovelFire) SUCCESS: Match found (Score > 0.8).`);
            return {
                match: bestMatch,
                similarity: highestSimilarity
            };
        } else {
            console.log(`[novel-plugin-matcher] (NovelFire) FAILURE: No match found above 0.8 threshold.`);
            return null;
        }
    }

    // --- Create and Register The Source ---

    const novelFireSource = {
        id: "novelfire",
        name: "NovelFire",
        autoMatch,
        manualSearch,
        getChapters,
        getChapterContent
    };

    if (window.novelPluginRegistry) {
        window.novelPluginRegistry.registerSource(novelFireSource);
        console.log('[novel-plugin] NovelFireSource registered.');
    } else {
        console.error('[novel-plugin] NovelFireSource: Registry not found!');
    }

})();