(function() {
    // Check if script is already loaded
    if (window.NovelBuddySource) {
        return;
    }

    const NOVELBUDDY_URL = "https://corsproxy.io/?url=https://novelbuddy.com";

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
     * Searches NovelBuddy for a query
     * @param {string} query 
     * @returns {Promise<SearchResult[]>}
     */
    async function manualSearch(query) {
        const url = `${NOVELBUDDY_URL}/search?q=${encodeURIComponent(query)}`;
        try {
            const res = await fetch(url);
            const html = await res.text();
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const items = doc.querySelectorAll('.book-item');
            
            items.forEach(item => {
                const titleElement = item.querySelector('h3 a');
                const title = titleElement?.title?.trim() || "Unknown Title";
                const novelUrl = titleElement?.getAttribute('href') || "#";
                let image = item.querySelector('.thumb img.lazy')?.getAttribute('data-src') || "";
                if (image.startsWith("//")) { 
                    image = `https:${image}`; 
                } else if (image.startsWith("/")) {
                    image = `${NOVELBUDDY_URL}${image}`;
                }
                const latestChapter = item.querySelector('.latest-chapter')?.textContent?.trim() || "No Chapter";
              
                results.push({ 
                    title: title, 
                    url: novelUrl, 
                    image: image, 
                    latestChapter: latestChapter 
                });
            });
            return results;
        } catch (err) {
            console.error("[novel-plugin] NovelBuddy Search Error:", err);
            return [];
        }
    }

    /**
     * Gets all chapter URLs and titles for a novel
     * @param {string} novelUrl 
     * @returns {Promise<Chapter[]>}
     */
    async function getChapters(novelUrl) {
        const url = `${NOVELBUDDY_URL}${novelUrl}`;
        try {
            const res = await fetch(url);
            const html = await res.text();
            const bookIdMatch = html.match(/var bookId = (\d+);/);
            if (!bookIdMatch || !bookIdMatch[1]) {
                throw new Error("Could not find bookId on novel page.");
            }
            const bookId = bookIdMatch[1];
            const chapterApiUrl = `${NOVELBUDDY_URL}/api/manga/${bookId}/chapters?source=detail`;
            const chapterRes = await fetch(chapterApiUrl);
            const chapterHtml = await chapterRes.text();
            const chapters = [];
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(chapterHtml, "text/html");
            const chapterItems = doc.querySelectorAll('ul.chapter-list li a');
            chapterItems.forEach(link => {
                const url = link.getAttribute('href');
                let title = link.querySelector('strong.chapter-title')?.textContent?.trim();
                if (!title || title.length === 0) {
                    title = link.getAttribute('title')?.trim() || "Unknown Chapter";
                }
                if (url) {
                    chapters.push({ url: url, title: title });
                }
            });
            return chapters.reverse(); // Reverse to get CH 1 first
        } catch (err) {
            console.error("[novel-plugin] NovelBuddy Details Error:", err);
            return [];
        }
    }

    /**
     * Gets the processed HTML content for a single chapter
     * @param {string} chapterUrl 
     * @returns {Promise<string>}
     */
    async function getChapterContent(chapterUrl) {
        const url = `${NOVELBUDDY_URL}${chapterUrl}`;
        try {
            const res = await fetch(url);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const contentElement = doc.querySelector('.content-inner');
    
            if (!contentElement) {
                throw new Error("Could not extract chapter content.");
            }
    
            contentElement.querySelectorAll('script, div[id^="pf-"], div[style="text-align:center"], ins, div[align="center"]').forEach(el => el.remove());
            contentElement.querySelectorAll('div').forEach(div => {
                if (div.innerHTML.trim() === '') div.remove();
            });
    
            return contentElement.innerHTML;
        } catch (err) {
            console.error("[novel-plugin] NovelBuddy ChapterContent Error:", err);
            return "<p>Error loading chapter content.</p>";
        }
    }

    /**
     * Tries to find the best match on NovelBuddy for an Anilist title
     * @param {string} romajiTitle 
     * @param {string} englishTitle 
     * @returns {Promise<{ match: SearchResult, similarity: number } | null>}
     */
    async function autoMatch(romajiTitle, englishTitle) {
        // --- THIS IS THE CORRECT, REFFACTORED FUNCTION ---
        console.log(`[novel-plugin-matcher] (NovelBuddy) START: Matching for "${romajiTitle}"`);
        
        // 1. Get results for Romaji title
        const romajiResults = await manualSearch(romajiTitle);
        let bestRomajiMatch = null;
        let bestRomajiScore = 0.0;
        if (romajiResults && romajiResults.length > 0) {
            romajiResults.forEach(item => {
                const similarity = getSimilarity(romajiTitle, item.title);
                console.log(`[novel-plugin-matcher] (NovelBuddy) Romaji Compare: "${romajiTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                if (similarity > bestRomajiScore) {
                    bestRomajiScore = similarity;
                    bestRomajiMatch = item;
                }
            });
        }
        console.log(`[novel-plugin-matcher] (NovelBuddy) Romaji Best: "${bestRomajiMatch?.title}" (Score: ${bestRomajiScore.toFixed(2)})`);

        // 2. Get results for English title
        let bestEnglishMatch = null;
        let bestEnglishScore = 0.0;
        if (englishTitle && englishTitle.toLowerCase() !== romajiTitle.toLowerCase()) {
            console.log(`[novel-plugin-matcher] (NovelBuddy) INFO: Also matching with English: "${englishTitle}"`);
            const englishResults = await manualSearch(englishTitle);
            if (englishResults && englishResults.length > 0) {
                englishResults.forEach(item => {
                    const similarity = getSimilarity(englishTitle, item.title);
                    console.log(`[novel-plugin-matcher] (NovelBuddy) English Compare: "${englishTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                    if (similarity > bestEnglishScore) {
                        bestEnglishScore = similarity;
                        bestEnglishMatch = item;
                    }
                });
            }
            console.log(`[novel-plugin-matcher] (NovelBuddy) English Best: "${bestEnglishMatch?.title}" (Score: ${bestEnglishScore.toFixed(2)})`);
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

        console.log(`[novel-plugin-matcher] (NovelBuddy) Final Best: "${bestMatch?.title}" (Score: ${highestSimilarity.toFixed(2)})`);

        // 4. Check against the 0.8 threshold
        if (highestSimilarity > 0.8 && bestMatch) {
            console.log(`[novel-plugin-matcher] (NovelBuddy) SUCCESS: Match found (Score > 0.8).`);
            return {
                match: bestMatch,
                similarity: highestSimilarity
            };
        } else {
            console.log(`[novel-plugin-matcher] (NovelBuddy) FAILURE: No match found above 0.8 threshold.`);
            return null;
        }
    }

    // --- Create and Register The Source ---

    const novelBuddySource = {
        id: "novelbuddy",
        name: "NovelBuddy",
        autoMatch,
        manualSearch,
        getChapters,
        getChapterContent
    };

    if (window.novelPluginRegistry) {
        window.novelPluginRegistry.registerSource(novelBuddySource);
        console.log('[novel-plugin] NovelBuddySource registered.');
    } else {
        console.error('[novel-plugin] NovelBuddySource: Registry not found!');
    }

})();
