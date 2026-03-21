class Provider {
    constructor() {
        this.api = 'https://www.mangabats.com';
        this.proxyBase = 'http://localhost:43211/api/v1/image-proxy';
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        };
    }

    applyProxy(targetUrl) {
        const headers = JSON.stringify({ "Referer": `${this.api}/` });
        return `${this.proxyBase}?url=${encodeURIComponent(targetUrl)}&headers=${encodeURIComponent(headers)}`;
    }

    async search(opts) {
        const queryParam = opts.query.replace(/\s+/g, '_');
        const url = `${this.api}/search/story/${encodeURIComponent(queryParam)}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Referer': this.api,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const body = await response.text();
            let mangas = [];

            const itemRegex = /<div class="story_item"[\s\S]*?<\/div>\s*<\/div>/g;
            
            let match;
            while ((match = itemRegex.exec(body)) !== null) {
                const itemHtml = match[0];
                const idMatch = itemHtml.match(/href="https:\/\/www\.mangabats\.com\/manga\/([^"]+)"/);
                if (!idMatch) continue;
                
                const mangaId = idMatch[1];
                const imgMatch = itemHtml.match(/<img[^>]*src="([^"]+)"[^>]*>/);
                const imageUrl = imgMatch ? imgMatch[1] : '';
                const titleMatch = itemHtml.match(/class="story_name"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
                if (!titleMatch) continue;
                
                const title = titleMatch[1].trim();
                
                mangas.push({
                    id: mangaId,
                    title: title,
                    image: imageUrl ? this.applyProxy(imageUrl) : ''
                });
            }
            
            return mangas;
        } catch (e) {
            console.error('Search error:', e);
            return [];
        }
    }

    async findChapters(mangaId) {
        const cleanMangaId = mangaId.replace(/\/$/, '');
        let allChapters = [];
        let offset = 0;
        const limit = 50;
        let hasMore = true;

        try {
            while (hasMore) {
                const url = `${this.api}/api/manga/${cleanMangaId}/chapters?limit=${limit}&offset=${offset}`;
                
                const response = await fetch(url, {
                    headers: { 
                        'Referer': `${this.api}/manga/${cleanMangaId}`,
                        'Origin': this.api,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                
                if (!response.ok) break;
                
                const data = await response.json();
                let batch = [];

                if (data.success && data.data?.chapters) batch = data.data.chapters;
                else if (data.data && Array.isArray(data.data)) batch = data.data;
                else if (data.chapters) batch = data.chapters;

                if (batch.length === 0) {
                    hasMore = false;
                    break;
                }

                batch.forEach(chapter => {
                    const chapterNum = chapter.chapter_num || chapter.attributes?.chapter || '0';
                    const slug = chapter.chapter_slug || (chapter.id ? `chapter/${chapter.id}` : `chapter-${chapterNum}`);
                    
                    allChapters.push({
                        id: `manga/${cleanMangaId}/${slug}`,
                        url: `${this.api}/manga/${cleanMangaId}/${slug}`,
                        title: chapter.chapter_name || `Chapter ${chapterNum}`,
                        chapter: chapterNum.toString()
                    });
                });

                if (batch.length < limit) hasMore = false;
                else offset += limit;
            }

            if (allChapters.length === 0) {
                return await this.findChaptersAlternative(cleanMangaId);
            }

            return allChapters
                .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter))
                .map((chap, index) => ({ ...chap, index }));

        } catch (e) {
            console.error('API Error:', e);
            return await this.findChaptersAlternative(mangaId);
        }
    }

    async findChaptersAlternative(mangaId) {
        const cleanMangaId = mangaId.replace(/\/$/, '');
        const url = `${this.api}/manga/${cleanMangaId}`;

        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const body = await response.text();
            let chapters = [];
            
            const chapterRegex = /<a[^>]*href="\/manga\/[^"]+\/(chapter-([\d.]+))"[^>]*>Chapter\s+[\d.]+<\/a>/g;
            let match;
            while ((match = chapterRegex.exec(body)) !== null) {
                chapters.push({
                    id: `manga/${cleanMangaId}/${match[1]}`,
                    url: `${this.api}/manga/${cleanMangaId}/${match[1]}`,
                    title: `Chapter ${match[2]}`,
                    chapter: match[2],
                });
            }
            
            return chapters.sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
        } catch (e) {
            return [];
        }
    }

    async findChapterPages(chapterId) {
        const url = `${this.api}/${chapterId}`;
        try {
            const response = await fetch(url, {
                headers: { 
                    'Referer': this.api,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (!response.ok) return [];
            
            const body = await response.text();
            const cdnsRaw = body.match(/var\s+cdns\s*=\s*\[([\s\S]*?)\];/i);
            const imagesRaw = body.match(/var\s+chapterImages\s*=\s*\[([\s\S]*?)\];/i);

            if (!cdnsRaw || !imagesRaw) return [];

            const clean = (str) => str.split(',')
                .map(s => s.trim().replace(/^["']|["']$/g, '').replace(/\\/g, ''))
                .filter(Boolean);

            const cdns = clean(cdnsRaw[1]);
            const imagePaths = clean(imagesRaw[1]);

            // Keep trailing slash intact so domain + path join correctly
            const baseCdn = cdns[0].endsWith('/') ? cdns[0] : `${cdns[0]}/`;

            return imagePaths.map((path, index) => {
                const cleanPath = path.replace(/^\//, '');
                const fullUrl = path.startsWith('http') ? path : `${baseCdn}${cleanPath}`;
                
                return {
                    url: this.applyProxy(fullUrl),
                    index: index,
                };
            });
        } catch (e) {
            console.error('Pages error:', e);
            return [];
        }
    }
}
