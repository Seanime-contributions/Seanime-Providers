(function() {
    // Check if script is already loaded
    if (window.NovelBuddySource) {
        return;
    }

    // Cached port for the session
    let cachedPort = null;

    // Helper function to detect port from network requests
    function detectPortFromNetwork() {
        try {
            // Check existing performance entries
            const entries = window.performance.getEntries();
            for (const entry of entries) {
                if (entry.name && entry.name.match(/http:\/\/127\.0\.0\.1:(\d+)\/api\/v1\//)) {
                    const match = entry.name.match(/http:\/\/127\.0\.0\.1:(\d+)\/api\/v1\//);
                    if (match && match[1]) {
                        console.log('[novel-plugin] Detected port from network request:', match[1]);
                        return match[1];
                    }
                }
            }
            
            // Also try localhost pattern
            for (const entry of entries) {
                if (entry.name && entry.name.match(/http:\/\/localhost:(\d+)\/api\/v1\//)) {
                    const match = entry.name.match(/http:\/\/localhost:(\d+)\/api\/v1\//);
                    if (match && match[1]) {
                        console.log('[novel-plugin] Detected port from network request:', match[1]);
                        return match[1];
                    }
                }
            }
            
            console.log('[novel-plugin] No Seanime API request found in network history');
            return null;
        } catch (e) {
            console.error('[novel-plugin] Error detecting port from network:', e);
            return null;
        }
    }

    // Helper function to get Seanime proxy URL
    function getProxyUrl() {
        try {
            // Return cached port if available
            if (cachedPort) {
                return `http://localhost:${cachedPort}/api/v1/proxy?url=`;
            }
            
            // Try to detect from network requests
            const detectedPort = detectPortFromNetwork();
            if (detectedPort) {
                cachedPort = detectedPort;
                return `http://localhost:${cachedPort}/api/v1/proxy?url=`;
            }
            
            // Fallback to window.location.port
            const port = window.location.port;
            if (port) {
                cachedPort = port;
                console.log('[novel-plugin] Detected port from window.location:', port);
                return `http://localhost:${port}/api/v1/proxy?url=`;
            }
            
            console.error('[novel-plugin] No port detected');
            return '';
        } catch (e) {
            console.error('[novel-plugin] Error getting proxy URL:', e);
            return '';
        }
    }

    const NOVELBUDDY_BASE_URL = "https://novelbuddy.com";
    const NOVELBUDDY_API_URL = "https://api.novelbuddy.com";
    const PROXY_BASE = getProxyUrl();

    // Helper function to proxy a URL
    function proxyUrl(targetUrl) {
        if (!PROXY_BASE) return targetUrl;
        return PROXY_BASE + encodeURIComponent(targetUrl);
    }

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
     * Searches NoveproxyUrl(lBuddy for a _BASEquery)
     * @param {string} query 
     * @returns {Promise<SearchResult[]>}
     */
    async function manualSearch(query) {
        const url = proxyUrl(`${NOVELBUDDY_API_URL}/titles/search?page=1&limit=24&q=${encodeURIComponent(query)}`);
        try {
            const res = await fetch(url);
            const json = await res.json();
            const results = [];
            
            if (json.success && json.data && json.data.items) {
                json.data.items.forEach(item => {
                    results.push({
                        title: item.name,
                        url: item.id,
                        id: item.id,
                        image: item.cover,
                        latestChapter: item.latest_chapters && item.latest_chapters[0] ? item.latest_chapters[0].name : "No Chapter"
                    });
                });
            }
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
        try {
            // novelUrl is now the ID from search results
            const url = proxyUrl(`${NOVELBUDDY_API_URL}/titles/${novelUrl}/chapters`);
            const res = await fetch(url);
            const json = await res.json();
            const chapters = [];
            
            if (json.success && json.data && json.data.chapters) {
                json.data.chapters.forEach(chapter => {
                    chapters.push({
                        url: chapter.url,
                        title: chapter.name
                    });
                });
            }
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
        const targetUrl = `${NOVELBUDDY_BASE_URL}${chapterUrl}`;
        const url = proxyUrl(targetUrl);
        try {
            const res = await fetch(url);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const contentElement = doc.querySelector('.novel-tts-content');
    
            if (!contentElement) {
                throw new Error("Could not extract chapter content.");
            }
    
            // Remove translation selector and other UI elements
            contentElement.querySelectorAll('select, .mb-6').forEach(el => el.remove());
            
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

