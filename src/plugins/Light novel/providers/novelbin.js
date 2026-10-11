(function() {
    // Check if script is already loaded
    if (window.NovelBinSource) {
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

    const NOVELBIN_URL = "https://novelbin.me";
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
     * Searches NovelBin for a query
     * @param {string} query 
     * @returns {Promise<SearchResult[]>}
     */
    async function manualSearch(query) {
        const url = proxyUrl(`${NOVELBIN_URL}/search?keyword=${encodeURIComponent(query)}`);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const results = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            // Select only title links, then find their parent row
            const titleElements = doc.querySelectorAll('.list-novel h3.novel-title a'); 
            
            titleElements.forEach(titleElement => {
                const item = titleElement.closest('.row'); // Find the parent .row
                if (!item) return; 

                const title = titleElement?.title?.trim() || "Unknown Title";
                let novelUrl = titleElement?.getAttribute('href') || "#";
                let image = item.querySelector('.cover')?.getAttribute('src') || "";
                if (image.startsWith("//")) { 
                    image = `https:${image}`; 
                } else if (image.startsWith("/")) {
                    image = `${NOVELBIN_URL}${image}`;
                }

                const latestChapterElement = item.querySelector('.col-xs-2.text-info a span.chapter-title');
                const latestChapter = latestChapterElement?.textContent?.trim() || "No Chapter";
              
                results.push({ 
                    title: title, 
                    url: novelUrl, 
                    image: image, 
                    latestChapter: latestChapter 
                });
            });
            return results;
        } catch (err) {
            console.error("[novel-plugin] NovelBin Search Error:", err);
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
            // Extract the novel slug from the URL
            const urlSlugMatch = novelUrl.match(/novel-book\/(.+)/);
            if (!urlSlugMatch || !urlSlugMatch[1]) {
                 throw new Error(`Could not extract novel slug from URL: ${novelUrl}`);
            }
            const novelSlug = urlSlugMatch[1];
            
            // Use the correct API endpoint provided by user
            const chapterApiUrl = `${NOVELBIN_URL}/ajax/chapter-archive?novelId=${novelSlug}`;

            const chapterRes = await fetch(proxyUrl(chapterApiUrl));
            if (!chapterRes.ok) throw new Error(`Chapter API failed: ${chapterRes.status}`);
            const html = await chapterRes.text();
            
            const chapters = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const chapterItems = doc.querySelectorAll('ul.list-chapter li a');
            
            chapterItems.forEach(link => {
                const url = link.getAttribute('href');
                const title = link.getAttribute('title')?.trim() || "Unknown Chapter";
                if (url) {
                    chapters.push({ url: url, title: title });
                }
            });
            return chapters; // API returns them in correct order, no reverse needed
        } catch (err) {
            console.error("[novel-plugin] NovelBin Details Error:", err);
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
            const res = await fetch(proxyUrl(chapterUrl));
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            const contentElement = doc.querySelector('#chr-content');
    
            if (!contentElement) {
                throw new Error("Could not extract chapter content.");
            }
    
            // --- NEW ROBUST CLEANING ---
            
            // 1. Remove known ad divs and scripts first
            contentElement.querySelectorAll('script, div[id^="pf-"], div[style*="text-align:center"], ins, div[align="center"]').forEach(el => el.remove());
            
            // 2. Iterate through all paragraphs and filter out junk
            const paragraphs = contentElement.querySelectorAll('p');
            let cleanHtml = '';
            
            paragraphs.forEach(p => {
                let pText = p.textContent || '';
                
                // --- FIX: Remove unwanted pattern ---
                // Remove the specific triangle pattern
                pText = pText.replace(/△▼△▼△▼△/g, '');
                 // Also remove the repeated "※" pattern you mentioned
                pText = pText.replace(/[※\s]{2,}/g, ''); 
                // --- END FIX ---

                const pHTML = p.innerHTML.trim();
                
                // Check for ad-related text
                const isAdText = pText.includes('Remove Ads From $1') || pText.includes('Buy no ads experience for 1$');
                // Check for empty paragraphs or paragraphs with only a space
                const isEmpty = pHTML === '' || pHTML === '&nbsp;' || pText.trim() === '';
                
                // Only keep paragraphs that are NOT ads and NOT empty
                if (!isAdText && !isEmpty) {
                     // Update the paragraph content if we stripped text
                    if (p.textContent !== pText) {
                        p.textContent = pText;
                    }
                    cleanHtml += p.outerHTML; // Add the clean <p>...</p> tag
                }
            });
            // --- END NEW CLEANING ---
    
            return cleanHtml;
        } catch (err) {
            console.error("[novel-plugin] NovelBin ChapterContent Error:", err);
            return "<p>Error loading chapter content.</p>";
        }
    }

    /**
     * Tries to find the best match on NovelBin for an Anilist title
     * @param {string} romajiTitle 
     * @param {string} englishTitle 
     * @returns {Promise<{ match: SearchResult, similarity: number } | null>}
     */
    async function autoMatch(romajiTitle, englishTitle) {
        console.log(`[novel-plugin-matcher] (NovelBin) START: Matching for "${romajiTitle}"`);
        
        // 1. Get results for Romaji title
        const romajiResults = await manualSearch(romajiTitle);
        let bestRomajiMatch = null;
        let bestRomajiScore = 0.0;
        if (romajiResults && romajiResults.length > 0) {
            romajiResults.forEach(item => {
                const similarity = getSimilarity(romajiTitle, item.title);
                console.log(`[novel-plugin-matcher] (NovelBin) Romaji Compare: "${romajiTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                if (similarity > bestRomajiScore) {
                    bestRomajiScore = similarity;
                    bestRomajiMatch = item;
                }
            });
        }
        console.log(`[novel-plugin-matcher] (NovelBin) Romaji Best: "${bestRomajiMatch?.title}" (Score: ${bestRomajiScore.toFixed(2)})`);

        // 2. Get results for English title
        let bestEnglishMatch = null;
        let bestEnglishScore = 0.0;
        if (englishTitle && englishTitle.toLowerCase() !== romajiTitle.toLowerCase()) {
            console.log(`[novel-plugin-matcher] (NovelBin) INFO: Also matching with English: "${englishTitle}"`);
            const englishResults = await manualSearch(englishTitle);
            if (englishResults && englishResults.length > 0) {
                englishResults.forEach(item => {
                    const similarity = getSimilarity(englishTitle, item.title);
                    console.log(`[novel-plugin-matcher] (NovelBin) English Compare: "${englishTitle}" vs "${item.title}" (Score: ${similarity.toFixed(2)})`);
                    if (similarity > bestEnglishScore) {
                        bestEnglishScore = similarity;
                        bestEnglishMatch = item;
                    }
                });
            }
            console.log(`[novel-plugin-matcher] (NovelBin) English Best: "${bestEnglishMatch?.title}" (Score: ${bestEnglishScore.toFixed(2)})`);
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

        console.log(`[novel-plugin-matcher] (NovelBin) Final Best: "${bestMatch?.title}" (Score: ${highestSimilarity.toFixed(2)})`);

        // 4. Check against the 0.8 threshold
        if (highestSimilarity > 0.8 && bestMatch) {
            console.log(`[novel-plugin-matcher] (NovelBin) SUCCESS: Match found (Score > 0.8).`);
            return {
                match: bestMatch,
                similarity: highestSimilarity
            };
        } else {
            console.log(`[novel-plugin-matcher] (NovelBin) FAILURE: No match found above 0.8 threshold.`);
            return null;
        }
    }

    // --- Create and Register The Source ---

    const novelBinSource = {
        id: "novelbin",
        name: "NovelBin",
        autoMatch,
        manualSearch,
        getChapters,
        getChapterContent
    };

    if (window.novelPluginRegistry) {
        window.novelPluginRegistry.registerSource(novelBinSource);
        console.log('[novel-plugin] NovelBinSource registered.');
    } else {
        console.error('[novel-plugin] NovelBinSource: Registry not found!');
    }

})();
