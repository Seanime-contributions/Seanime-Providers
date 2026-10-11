class Provider {
    constructor() {
        this.baseURL = 'https://xcomic.me';
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    async search(opts) {
        try {
            const params = new URLSearchParams({
                word: opts.query.trim(),
                sortby: 'score',
                page: '1',
            });
            const response = await this.request(`${this.baseURL}/search?${params.toString()}`);
            const html = await response.text();
            const results = [];
            const seen = new Set();
            const titlePattern = /<a[^>]+href=["'](\/title\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            let match;

            while ((match = titlePattern.exec(html)) !== null) {
                const id = match[1].split('/').filter(Boolean).pop();
                if (!id || seen.has(id) || /<img\b/i.test(match[2])) continue;
                const title = this.decodeHtml(this.stripTags(match[2]) || id);
                const precedingMarkup = html.slice(Math.max(0, match.index - 1200), match.index);
                const imageMatches = [...precedingMarkup.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
                const imageMatch = imageMatches[imageMatches.length - 1];
                results.push({
                    id,
                    title: title.trim(),
                    image: imageMatch ? this.absoluteURL(this.decodeHtml(imageMatch[1])) : undefined,
                });
                seen.add(id);
            }

            return results;
        } catch (_error) {
            return [];
        }
    }

    async findChapters(mangaId) {
        try {
            const response = await this.request(`${this.baseURL}/title/${encodeURIComponent(mangaId)}`);
            const html = await response.text();
            const sources = this.parseSources(html);
            console.log(`[xComic] Parsed ${sources.length} language sources for manga ${mangaId}.`);
            const englishSources = sources.filter(source => source.language === 'en');
            console.log(`[xComic] Found ${englishSources.length} English sources for manga ${mangaId}.`);
            if (englishSources.length === 0) {
                const languages = [...new Set(sources.map(source => source.language || 'unknown'))];
                console.log(`[xComic] Detected source languages for manga ${mangaId}: ${languages.join(', ') || 'none'}.`);
                return [];
            }

            englishSources.sort((a, b) => b.chapterCount - a.chapterCount);
            const source = englishSources[0];
            const sourcePage = await this.request(`${this.baseURL}/source/${encodeURIComponent(source.id)}`);
            return this.parseSourceChapters(await sourcePage.text());
        } catch (_error) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        try {
            const response = await this.request(`${this.baseURL}/chapter/${encodeURIComponent(chapterId)}`);
            const html = await response.text();
            const pages = [];
            const seen = new Set();
            const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
            let match;

            while ((match = imagePattern.exec(html)) !== null) {
                const url = this.absoluteURL(this.decodeHtml(match[1]));
                if (!this.isChapterImage(url) || seen.has(url)) continue;
                seen.add(url);
                pages.push({
                    url,
                    index: pages.length,
                    headers: { Referer: `${this.baseURL}/chapter/${encodeURIComponent(chapterId)}` },
                });
            }

            // The live page serializes the image list as imageUrls instead of
            // rendering the URLs directly in img[src] attributes.
            const serializedURLPattern = /https?:\/\/[^"'\\\s<>]+/gi;
            while ((match = serializedURLPattern.exec(html)) !== null) {
                const url = this.absoluteURL(this.decodeHtml(match[0]).replace(/\\u002F/g, '/'));
                if (!this.isChapterImage(url) || seen.has(url)) continue;
                seen.add(url);
                pages.push({
                    url,
                    index: pages.length,
                    headers: { Referer: `${this.baseURL}/chapter/${encodeURIComponent(chapterId)}` },
                });
            }
            return pages;
        } catch (_error) {
            return [];
        }
    }

    async request(url) {
        const response = await fetch(url, {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': this.userAgent,
            },
        });
        if (!response.ok) throw new Error(`xComic request failed: ${response.status}`);
        return response;
    }

    parseSources(html) {
        const sources = [];
        const sourcePattern = /<a[^>]+href=["']\/source\/([^"']+)["'][^>]*>/gi;
        const sourceLinks = [];
        let match;
        while ((match = sourcePattern.exec(html)) !== null) {
            sourceLinks.push({ id: match[1], index: match.index, end: sourcePattern.lastIndex });
        }

        sourceLinks.forEach((link, index) => {
            if (sources.some(source => source.id === link.id)) return;
            const nextIndex = sourceLinks[index + 1]?.index ?? html.length;
            const card = html.slice(Math.max(0, link.index - 180), nextIndex);
            const chapterMatch = card.match(/([\d,]+)\s+chapters?/i);
            const flagMatch = card.match(/([\u{1F1E6}-\u{1F1FF}]{2})/u);
            sources.push({
                id: link.id,
                chapterCount: chapterMatch ? parseInt(chapterMatch[1].replace(/,/g, ''), 10) : 0,
                language: flagMatch ? this.languageFromFlag(flagMatch[1]) : undefined,
            });
        });
        return sources;
    }

    parseSourceChapters(html) {
        const chapters = [];
        const chapterPattern = /<a[^>]+href=["']\/chapter\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const seen = new Set();
        let match;
        while ((match = chapterPattern.exec(html)) !== null) {
            const id = match[1];
            if (seen.has(id)) continue;
            seen.add(id);
            const title = this.decodeHtml(this.stripTags(match[2]).trim());
            const chapter = this.extractChapterNumber(title);
            chapters.push({
                id,
                url: `${this.baseURL}/chapter/${encodeURIComponent(id)}`,
                title: `Chapter ${chapter}`,
                chapter,
                index: 0,
            });
        }

        chapters.sort((a, b) => this.chapterSortValue(a.chapter) - this.chapterSortValue(b.chapter));
        chapters.forEach((chapter, index) => { chapter.index = index; });
        return chapters;
    }

    languageFromFlag(title) {
        const flag = title.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
        if (!flag) return undefined;
        const languageByFlag = {
            '🇬🇧': 'en', '🇺🇸': 'en', '🇨🇦': 'en', '🇦🇺': 'en', '🇳🇿': 'en', '🇮🇪': 'en',
            '🇪🇸': 'es', '🇲🇽': 'es', '🇦🇷': 'es', '🇨🇱': 'es', '🇨🇴': 'es', '🇵🇪': 'es',
            '🇫🇷': 'fr', '🇧🇪': 'fr',
            '🇩🇪': 'de', '🇦🇹': 'de', '🇨🇭': 'de',
            '🇮🇹': 'it', '🇵🇹': 'pt', '🇧🇷': 'pt', '🇯🇵': 'ja', '🇰🇷': 'ko',
            '🇨🇳': 'zh', '🇹🇼': 'zh', '🇭🇰': 'zh', '🇷🇺': 'ru', '🇺🇦': 'uk',
            '🇹🇷': 'tr', '🇮🇩': 'id', '🇲🇾': 'ms', '🇹🇭': 'th', '🇻🇳': 'vi',
            '🇵🇱': 'pl', '🇳🇱': 'nl', '🇸🇪': 'sv', '🇳🇴': 'no', '🇩🇰': 'da',
            '🇫🇮': 'fi', '🇮🇱': 'he', '🇮🇳': 'hi', '🇸🇦': 'ar', '🇦🇪': 'ar',
            '🇮🇷': 'fa', '🇬🇷': 'el', '🇨🇿': 'cs', '🇸🇮': 'sl',
        };
        return languageByFlag[flag];
    }

    extractChapterNumber(title) {
        const match = title.match(/\b(?:ch(?:apter)?\.?)\s*(\d+(?:\.\d+)?)/i) || title.match(/\b(\d+(?:\.\d+)?)/);
        return match?.[1] || '0';
    }

    chapterSortValue(chapter) {
        const value = Number.parseFloat(chapter);
        return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    }

    isChapterImage(url) {
        return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url);
    }

    absoluteURL(url) {
        return new URL(url, this.baseURL).toString();
    }

    stripTags(value) {
        return value.replace(/<[^>]*>/g, '');
    }

    decodeHtml(value) {
        return value
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    }
}
