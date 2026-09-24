/// <reference path="./core.d.ts" />
/// <reference path="./manga-provider.d.ts" />

class Provider {
    private baseURL = 'https://mangadot.net';
    private apiURL = `${this.baseURL}/api`;
    private ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    private cacheTtl = 3600;

    getSettings(): Settings {
        return {
            supportsMultiLanguage: true,
            supportsMultiScanlator: true,
        };
    }

    async search(opts: { query: string }): Promise<SearchResult[]> {
        let cookie: string | undefined = this.readCache('mangadot_cookie');
        if (!cookie) {
            await this.refreshCF();
            cookie = this.readCache('mangadot_cookie') as string;
        }
        cookie = JSON.parse(cookie).join('; ') as string;

        const params = new URLSearchParams();
        params.append('search', opts.query.trim());
        params.append('sortBy', 'relevance');
        params.append('sortOrder', 'desc');
        params.append('limit', '28');

        const res = await fetch(`${this.apiURL}/search?${params.toString()}`, {
            method: 'GET',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                Cookie: cookie
            }
        });

        if (res.status === 403) {
            await this.refreshCF();
            return this.search(opts);
        }

        const data: MangaDotSearch = res.json();

        return data.manga_list.map(v => ({
            id: `${v.id}`,
            title: v.title,
            year: v.year,
            image: `${this.baseURL}${v.photo}`
        }));
    }

    async findChapters(mangaId: string): Promise<ChapterDetails[]> {
        let cookie: string | undefined = this.readCache('mangadot_cookie');
        if (!cookie) {
            await this.refreshCF();
            cookie = this.readCache('mangadot_cookie') as string;
        }
        cookie = JSON.parse(cookie).join('; ') as string;

        const res = await fetch(`${this.apiURL}/manga/${mangaId}/chapters/list`, {
            method: 'GET',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                Cookie: cookie
            }
        });

        if (res.status === 403) {
            await this.refreshCF();
            return this.findChapters(mangaId);
        }

        const data: Array<MangaDotChapter> = res.json();

        return data.map(v => ({
            id: `${v.id}`,
            url: `https://mangadot.net/manga/${mangaId}`,
            title: v.chapter_title,
            index: v.chapter_number * 10,
            chapter: `${v.chapter_number}`,
            language: v.language,
            scanlator: v.group_name,
            updatedAt: v.date_added
        }));
    }

    async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
        let cookie: string | undefined = this.readCache('mangadot_cookie');
        if (!cookie) {
            await this.refreshCF();
            cookie = this.readCache('mangadot_cookie') as string;
        }
        cookie = JSON.parse(cookie).join('; ') as string;

        const res = await fetch(`${this.apiURL}/uploads/${chapterId}/images`, {
            method: 'GET',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                Cookie: cookie
            }
        });

        if (res.status === 403) {
            await this.refreshCF();
            return this.findChapterPages(chapterId);
        }

        const data: MangaDotImages = res.json();
        const pages: ChapterPage[] = [];

        for (const page in data.images) {
            const image = data.images[page];
            pages.push({
                url: `${this.baseURL}${image.url}`,
                index: +page,
                headers: {
                    referer: this.baseURL
                }
            })
        }

        return pages;
    }

    async refreshCF() {
        const solvedResponse = await fetch('http://127.0.0.1:8191/v1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cmd: 'request.get',
                url: this.baseURL,
                session: 'seanime',
                maxTimeout: 60000,
            }),
        });

        const solved = solvedResponse.json<any>();

        if (solved.status !== 'ok') {
            console.error(solved.message || 'Solver failed');
            throw new Error(solved.message || 'Solver failed');
        }

        const solution = solved.solution;
        const cookies = solution.cookies || [];
        const cookieHeader = cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`);

        this.writeCache('mangadot_cookie', JSON.stringify(cookieHeader));
    }

    private now(): number {
        try {
            return Date.now();
        } catch (_e) {
            return 0;
        }
    }

    private readCache<T>(key: string, ttl?: number): T | undefined {
        const entry = $store.get<{ at: number; data: T }>(key);
        const t = this.now();
        const max = ttl === undefined ? this.cacheTtl : ttl;
        if (entry && t > 0 && entry.at > 0 && t - entry.at < max) return entry.data;
        if (entry !== undefined && entry !== null) {
            try {
                $store.remove(key);
            } catch (_e) {}
        }
        return undefined;
    }

    private writeCache<T>(key: string, data: T): void {
        const t = this.now();
        if (t > 0) $store.set(key, { at: t, data });
    }
}

interface MangaDotSearch {
    manga_list: Array<MangaDotSearchData>,
    pagination: {
        current_page: number,
        total_pages: number,
        total_results: number,
        per_page: number,
        next_cursor: string,
    },
    query: string,
    search_engine: string
}

interface MangaDotSearchData {
    year: number,
    last_chapter_date: string,
    country_of_origin: string,
    description: string,
    photo: string,
    title: string,
    has_volumes: boolean,
    is_adult: number,
    rating_count: number,
    is_longstrip: boolean,
    genres: Array<string>,
    has_scanlator_group: boolean,
    avg_rating: number,
    content_rating: string,
    id: number,
    chapter_count: number,
    status: string,
    hiatus: string,
    highlight: {
        description: string,
        title: string,
    },
    is_blurworthy: number,
    latest_chapter_number: number
}

interface MangaDotChapter {
    id: number,
    chapter_number: number,
    volume_number: null,
    chapter_title: string,
    language: string,
    group_id: number,
    group_name: string,
    group_slug: string,
    group_is_scanlator: boolean,
    uploader_id: string,
    uploader_username: string,
    uploader_upload_status: string,
    date_added: string,
    page_count: number,
    source: string,
    scanlator_name: string,
    comment_count: number,
    groups: Array<MangaDotChapterGroup>
}

interface MangaDotChapterGroup {
    id: number,
    name: string,
    slug: string,
    is_scanlator: boolean
}

interface MangaDotImages {
    chapter: MangaDotChapter,
    images: Array<{ filename: string, h: number, url: string, w: number }>,
    manga: {
        country_of_origin: string,
        id: number,
        is_longstrip: unknown | null,
        photo: string,
        title: string
    },
    next_chapter_id: number,
    next_source: string,
    next_volume_id: unknown | null,
    prev_chapter_id: number,
    prev_source: string,
    prev_volume_id: unknown | null,
    source: string,
    type: string,
    volume_number: unknown | null
}
