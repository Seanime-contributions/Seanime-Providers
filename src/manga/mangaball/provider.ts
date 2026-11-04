/// <reference path="./core.d.ts" />
/// <reference path="../manga-provider.d.ts" />

class Provider {
  private baseURL = "https://mangaball.com";
  private apiURL = `${this.baseURL}/api/v1`;

  getSettings(): Settings {
    return {
      supportsMultiLanguage: true,
      supportsMultiScanlator: false,
    };
  }

  async search(opts: { query: string }): Promise<SearchResult[]> {
    const params = new URLSearchParams();
    params.append("keyword", opts.query.trim());
    params.append("sort_by", "lastupdate");
    params.append("sort_order", "desc");
    params.append("adult_mode", "all");
    params.append("tag_mode", "AND");
    params.append("limit", "28");

    const res = await fetch(
      `${this.apiURL}/title/search-advanced?${params.toString()}`,
      {
        method: "get",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
        },
      },
    );

    const data: MangaBallSearch = res.json();

    return data.data.map((v) => {
      return {
        id: v._id,
        title: v.name,
      };
    });
  }

  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    const url = `${this.apiURL}/title/chapter-listing?title_id=${mangaId}&page=1&limit=20&group_by=chapter_number&sort_order=asc`;
    const res = await fetch(url);
    const mangaData = await res.json();

    if (!mangaData?.data) return [];

    const pages = mangaData.pagination.total_pages;
    let chapters: ChapterDetails[] = [];

    for (let page = 1; page <= pages; page++) {
      let data: any = mangaData;
      if (page > 1) {
        const url = `${this.apiURL}/title/chapter-listing?title_id=${mangaId}&page=${page}&limit=20&group_by=chapter_number&sort_order=asc`;
        const res = await fetch(url);
        const mangaData = await res.json();

        data = mangaData;
      }
      chapters.push(
        ...data.data.map((chapter: any, i: number) => {
          return {
            id: chapter.id,
            url: chapter.url,
            title:
              !chapter.name || !chapter.name.trim()
                ? `Chapter ${chapter.number}`
                : chapter.name.startsWith("(1r0n)")
                  ? `Chapter ${chapter.number}`
                  : chapter.name,
            index: page * 20 - 20 + i,
            chapter: `${chapter.number}`,
            language: chapter.lang,
            scanlator: chapter.group_name,
            updatedAt: `${chapter.created_at}`,
          };
        }),
      );
    }

    return chapters;
  }

  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const res = await fetch(
      `https://api.mangaball.com/api/v1/chapter-detail?chapter_id=${chapterId}`,
    );

    const data = res.json();

    let parsedImages = data.data.chapter.pages.map(
      (value: string, index: number) => ({
        url: value,
        index,
        headers: {
          Referer: `${this.baseURL}/chapter-detail/${chapterId}`,
        },
      }),
    );

    return parsedImages;
  }
}

interface MangaBallSearch {
  code: number;
  message: string;
  data: Array<MangaBallSearchData>;
  pagination: {
    total: number;
    limit: number;
    start: number;
    current_page: number;
    last_page: number;
    from: number;
    to: number;
  };
}

interface MangaBallSearchData {
  _id: string;
  name: string;
  alternateName: string;
  cover: string;
  background: string;
  tags: string;
  authors: string;
  status: string;
  url: string;
  last_chapter: string;
  updated_at: string;
  languageFlag: string;
  isAdult: boolean;
}

interface MangaBallChapters {
  code: number;
  message: string;
  TOTAL_CHAPTERS: number;
  ALL_CHAPTERS: Array<MangaBallChapter>;
  ALL_LANGUAGES: Array<string>;
  ALL_VOLUMES: Array<string>;
  TOTAL_TRANSLATIONS: number;
  ALL_CHAPTER_LIKED_IDS: Array<unknown>;
  IS_USER_LOGGED_IN: boolean;
}

interface MangaBallChapter {
  number: string;
  number_float: number;
  title: string;
  translations: Array<MangaBallChapterTranslation>;
}

interface MangaBallChapterTranslation {
  id: string;
  name: string;
  language: string;
  languageName: string;
  group: {
    _id: string;
    name: string;
    icon: string;
  };
  date: string;
  views: number;
  likes: number;
  comments: number;
  description: string;
  tags: Array<unknown>;
  size: string;
  url: string;
  volume: number;
  dropdownAction: string;
}
