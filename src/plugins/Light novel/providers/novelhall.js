(function() {
    // Check if script is already loaded
    if (window.NovelBinSource) {
        return;
    }

    const NOVELHALL_URL = "https://www.novelhall.com";

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
     * Searches NovelHall for a query
     * @param {string} query 
     * @returns {Promise<SearchResult[]>}
     */
    async function manualSearch(query) {
        const url = `${NOVELHALL_URL}/index.php?s=so&module=book&keyword=${encodeURIComponent(query)}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Select all rows in the search results table
            const rows = doc.querySelectorAll('table tbody tr');

            rows.forEach(row => {
                const titleLink = row.querySelector('td:nth-child(2) a');
                if (!titleLink) return;

                const title = titleLink?.textContent?.trim() || "Unknown Title";
                let novelUrl = titleLink?.getAttribute('href') || "#";

                // Convert relative URL to absolute
                if (novelUrl.startsWith("/")) {
                    novelUrl = `${NOVELHALL_URL}${novelUrl}`;
                }

                const latestChapterElement = row.querySelector('td:nth-child(3) a.chapter');
                const latestChapter = latestChapterElement?.textContent?.trim() || "No Chapter";

                // NovelHall doesn't have images in search results, use empty string
                results.push({ 
                    title: title, 
                    url: novelUrl, 
                    image: "", 
                    latestChapter: latestChapter 
                });
            });
            return results;
        } catch (err) {
            console.error("[novel-plugin] NovelHall Search Error:", err);
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
            const url = `${novelUrl}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Chapter fetch failed: ${res.status}`);
            const html = await res.text();

            const chapters = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Select the "All Section Catalog" div (hidden-xs with id "morelist")
            const allSectionDiv = doc.querySelector('.book-catalog.inner.mt20.hidden-xs#morelist');
            if (!allSectionDiv) {
                throw new Error("Could not find 'All Section Catalog' section.");
            }

            // Get all chapter links within this div
            const chapterItems = allSectionDiv.querySelectorAll('ul li a');

            chapterItems.forEach(link => {
                let url = link.getAttribute('href');
                const title = link.textContent?.trim() || "Unknown Chapter";

                // Convert relative URL to absolute
                if (url && url.startsWith("/")) {
                    url = `${NOVELHALL_URL}${url}`;
                }

                if (url) {
                    chapters.push({ url: url, title: title });
                }
            });

            // Return chapters in correct order (newest first based on the HTML structure)
            return chapters.reverse();
        } catch (err) {
            console.error("[novel-plugin] NovelHall Details Error:", err);
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
            const res = await fetch(`${chapterUrl}`);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const contentElement = doc.querySelector('#htmlContent');

            if (!contentElement) {
                throw new Error("Could not extract chapter content.");
            }

            // Clean and process the content
            // 1. Clone the element to avoid modifying the original DOM
            const contentClone = contentElement.cloneNode(true);

            // 2. Remove any script tags, ads, or unwanted elements
            contentClone.querySelectorAll('script, style, ins, iframe, .ads, [class*="ad-"], [id*="ad-"]').forEach(el => el.remove());

            // 3. Clean up each text node
            const walker = document.createTreeWalker(contentClone, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }

            textNodes.forEach(textNode => {
                let text = textNode.nodeValue;
                // Remove excessive whitespace and line breaks
                text = text.replace(/\s+/g, ' ');
                text = text.replace(/\s*<br\s*\/?>\s*/gi, '<br>');
                textNode.nodeValue = text;
            });

            // 4. Wrap consecutive text in paragraphs or preserve existing structure
            let cleanHtml = contentClone.innerHTML;

            // Ensure proper paragraph structure
            // Replace double <br> tags with paragraph breaks
            cleanHtml = cleanHtml.replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>');

            // Wrap in paragraphs if not already
            if (!cleanHtml.includes('<p>') && !cleanHtml.includes('<div')) {
                cleanHtml = `<p>${cleanHtml}</p>`;
            }

            return cleanHtml;
        } catch (err) {
            console.error("[novel-plugin] NovelHall ChapterContent Error:", err);
            return "<p>Error loading chapter content.</p>";
        }
    }

    /**
     * Tries to find the best match on NovelHall for an Anilist title
     * @param {string} romajiTitle 
     * @param {string} englishTitle 
     * @returns {Promise<{ match: SearchResult, similarity: number } | null>}
     */
    async function autoMatch(romajiTitle, englishTitle) {
        console.log(`[novel-plugin-matcher] (NovelHall) START: Matching for "${romajiTitle}"`);

        // 1. Get results for Romaji title
        const romajiResults = await manualSearch(romajiTitle);
        let bestRomajiMatch = null;
        let bestRomajiScore = 0.0;
        if (romajiResults && romajiResults.length > 0) {
            romajiResults.forEach(item => {
                const similarity = getSimilarity(romajiTitle, item.title);
                console.log(`[novel-plugin-matcher] (NovelHall) Romaji Compare: "${romajiTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                if (similarity > bestRomajiScore) {
                    bestRomajiScore = similarity;
                    bestRomajiMatch = item;
                }
            });
        }
        console.log(`[novel-plugin-matcher] (NovelHall) Romaji Best: "${bestRomajiMatch?.title}" (Score: ${bestRomajiScore.toFixed(2)})`);

        // 2. Get results for English title
        let bestEnglishMatch = null;
        let bestEnglishScore = 0.0;
        if (englishTitle && englishTitle.toLowerCase() !== romajiTitle.toLowerCase()) {
            console.log(`[novel-plugin-matcher] (NovelHall) INFO: Also matching with English: "${englishTitle}"`);
            const englishResults = await manualSearch(englishTitle);
            if (englishResults && englishResults.length > 0) {
                englishResults.forEach(item => {
                    const similarity = getSimilarity(englishTitle, item.title);
                    console.log(`[novel-plugin-matcher] (NovelHall) English Compare: "${englishTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                    if (similarity > bestEnglishScore) {
                        bestEnglishScore = similarity;
                        bestEnglishMatch = item;
                    }
                });
            }
            console.log(`[novel-plugin-matcher] (NovelHall) English Best: "${bestEnglishMatch?.title}" (Score: ${bestEnglishScore.toFixed(2)})`);
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

        console.log(`[novel-plugin-matcher] (NovelHall) Final Best: "${bestMatch?.title}" (Score: ${highestSimilarity.toFixed(2)})`);

        // 4. Check against the 0.8 threshold
        if (highestSimilarity > 0.8 && bestMatch) {
            console.log(`[novel-plugin-matcher] (NovelHall) SUCCESS: Match found (Score > 0.8).`);
            return {
                match: bestMatch,
                similarity: highestSimilarity
            };
        } else {
            console.log(`[novel-plugin-matcher] (NovelHall) FAILURE: No match found above 0.8 threshold.`);
            return null;
        }
    }

    // --- Create and Register The Source ---

    const novelHallSource = {
        id: "novelhall",
        name: "NovelHall",
        autoMatch,
        manualSearch,
        getChapters,
        getChapterContent
    };

    if (window.novelPluginRegistry) {
        window.novelPluginRegistry.registerSource(novelHallSource);
        console.log('[novel-plugin] NovelHallSource registered.');
    } else {
        console.error('[novel-plugin] NovelHallSource: Registry not found!');
    }

})();