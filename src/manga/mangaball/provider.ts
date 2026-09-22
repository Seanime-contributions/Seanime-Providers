/// <reference path="./core.d.ts" />
/// <reference path="./manga-provider.d.ts" />

class Provider {
    private baseURL = 'https://mangaball.net';
    private apiURL = `${this.baseURL}/api/v1`;
    private ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    private cacheTtl = 3600;

    getSettings(): Settings {
        return {
            supportsMultiLanguage: true,
            supportsMultiScanlator: false,
        };
    }

    async search(opts: { query: string }): Promise<SearchResult[]> {
        let cookie: string | undefined = this.readCache('mangaball_cookie');
        if (!cookie) {
            await this.refreshCF();
            cookie = this.readCache('mangaball_cookie') as string;
        }
        cookie = JSON.parse(cookie).join('; ') as string;

        let csrf: string | undefined = this.readCache('mangaball_csrf');
        if (!csrf) {
            await this.refreshCF();
            csrf = this.readCache('mangaball_csrf') as string;
        }

        const formData = new FormData();
        formData.set("search_input", opts.query.trim());
        formData.set("filters[sort]", "updated_chapters_desc");
        formData.set("filters[page]", "1");
        formData.set("filters[tag_included_mode]", "and");
        formData.set("filters[tag_excluded_mode]", "and");
        formData.set("filters[contentRating]", "any");
        formData.set("filters[demographic]", "any");
        formData.set("filters[person]", "any");
        formData.set("filters[originalLanguages]", "any");
        formData.set("filters[publicationYear]", "");
        formData.set("filters[publicationStatus]", "any");
        formData.set("filters[publicationStatus]", "false");

        const res = await fetch(`${this.apiURL}/title/search-advanced/`, {
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                Cookie: cookie,
                'X-Csrf-Token': csrf,
            },
            body: formData,
        });

        if (res.status === 403) {
            await this.refreshCF();
            return this.search(opts);
        }

        const data: MangaBallSearch = res.json();

        return data.data.map(v => {
            return {
                id: v._id,
                title: v.name,
            };
        });
    }

    async findChapters(mangaId: string): Promise<ChapterDetails[]> {
        let cookie: string | undefined = this.readCache('mangaball_cookie');
        if (!cookie) {
            await this.refreshCF();
            cookie = this.readCache('mangaball_cookie') as string;
        }
        cookie = JSON.parse(cookie).join('; ') as string;

        let csrf: string | undefined = this.readCache('mangaball_csrf');
        if (!csrf) {
            await this.refreshCF();
            csrf = this.readCache('mangaball_csrf') as string;
        }

        const formData = new FormData();
        formData.set("title_id", mangaId);
        formData.set("userSettingsEnabled", "false");

        const res = await fetch(`${this.apiURL}/chapter/chapter-listing-by-title-id/`, {
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                Cookie: cookie,
                'X-Csrf-Token': csrf,
            },
            body: formData,
        });

        if (res.status === 403) {
            await this.refreshCF();
            return this.findChapters(mangaId);
        }

        const data: MangaBallChapters = res.json();
        let allChapters = data.ALL_CHAPTERS;
        allChapters.sort((a, b) => a.number_float - b.number_float);
      
        let chapters: ChapterDetails[] = [];
        let index = 0;
        for (const chapter of allChapters) {
          for (const translation of chapter.translations) {
            chapters.push({
              id: translation.id,
              url: translation.url,
              title: `Chapter ${chapter.number_float}`,
              index,
              chapter: `${chapter.number_float}`,
              language: translation.language,
              updatedAt: translation.date
            });
          }
          index++;
        }
        
        return chapters;
    }

    async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
        const solvedResponse = await fetch('http://127.0.0.1:8191/v1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cmd: 'request.get',
                url: `${this.baseURL}/chapter-detail/${chapterId}`,
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

        const imageMatch = solution.response.match(/const\s+chapterImages\s*=\s*JSON\.parse\(`([^`]+)`\)/gm)[0];
        const images = JSON.parse(imageMatch.replace("const chapterImages = JSON.parse(`", "").replace("`)", ""));

        let parsedImages = images.map((value: string, index: number) => ({
            url: value,
            index,
            headers: {
                Referer: `${this.baseURL}/chapter-detail/${chapterId}`,
                'User-Agent': this.ua
            }
        }));

        return parsedImages;
    }

    async solver(url: string) {
      const solvedResponse = await fetch('http://127.0.0.1:8191/v1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cmd: 'request.get',
                url: url,
                session: 'seanime',
                maxTimeout: 60000,
            }),
        });

        const solved = solvedResponse.json<any>();

        if (solved.status !== 'ok') {
            console.error(solved.message || 'Solver failed');
            throw new Error(solved.message || 'Solver failed');
        }

        return solved;
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

        const metaRegex = /<meta name="csrf-token" content="([^"]+)">/gm;
        const csrfMeta = solution.response.match(metaRegex);
        const csrf = csrfMeta[0].replace('\u003cmeta name="csrf-token" content="', "").replace('"\u003e', "");

        this.writeCache('mangaball_cookie', JSON.stringify(cookieHeader));
        this.writeCache('mangaball_csrf', csrf);
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

interface MangaBallSearch {
  code: number,
  message: string,
  data: Array<MangaBallSearchData>,
  pagination: {
    total: number,
    limit: number,
    start: number,
    current_page: number,
    last_page: number,
    from: number,
    to: number
  }
}

interface MangaBallSearchData {
  _id: string,
  name: string,
  alternateName: string,
  cover: string,
  background: string,
  tags: string,
  authors: string,
  status: string,
  url: string,
  last_chapter: string,
  updated_at: string,
  languageFlag: string,
  isAdult: boolean,
}

interface MangaBallChapters {
  code: number,
  message: string,
  TOTAL_CHAPTERS: number,
  ALL_CHAPTERS: Array<MangaBallChapter>,
  ALL_LANGUAGES: Array<string>,
  ALL_VOLUMES: Array<string>,
  TOTAL_TRANSLATIONS: number,
  ALL_CHAPTER_LIKED_IDS: Array<unknown>,
  IS_USER_LOGGED_IN: boolean
}

interface MangaBallChapter {
  number: string,
  number_float: number,
  title: string,
  translations: Array<MangaBallChapterTranslation>
}

interface MangaBallChapterTranslation {
  id: string,
  name: string,
  language: string,
  languageName: string,
  group: {
    _id: string,
    name: string,
    icon: string
  },
  date: string,
  views: number,
  likes: number,
  comments: number,
  description: string,
  tags: Array<unknown>,
  size: string,
  url: string,
  volume: number,
  dropdownAction: string
}