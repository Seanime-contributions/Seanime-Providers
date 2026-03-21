/// <reference path='./manga-provider.d.ts' />
/// <reference path='./doc.d.ts' />

class Provider {
  private api = 'https://www.mangaworldadult.net';

  getSettings(): Settings {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    };
  }

  async search(opts: QueryOptions): Promise<SearchResult[]> {
    let queryParam: string = opts.query;
    queryParam = queryParam.toLowerCase();

    const url = `${this.api}/archive?keyword=${encodeURIComponent(queryParam)}`;

    if (url == null) {
      return [];
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch search results: ${response.statusText}`);
      }

      const body = await response.text();
      const doc: DocSelectionFunction = LoadDoc(body);

      let mangas: SearchResult[] = await Promise.all(
        doc('div.comics-grid>div.entry').map(async (index, element) => {
          const title = element
            .find('a.manga-title')
            .first()
            .attrs()['title'];
          const thumbnailUrl = element.find('a.thumb img').first().attrs()['src'];
          const mangaId = element
            .find('a.thumb')
            .first()
            .attrs()
          ['href'].split('manga/')[1];

          let aniListDetails = await this.getAniListMangaDetails(queryParam);

          let mangaDetails = {
            id: mangaId,
            title: title,
            synonyms: aniListDetails.synonyms,
            year: aniListDetails.year,
            image: thumbnailUrl,
          };

          return mangaDetails;
        })
      );

      let uniqueMangas = Array.from(
        new Map(mangas.map((m) => [m.id, m])).values()
      );
      return uniqueMangas;
    }
    catch (e: any) {
      console.error(e);
      return [];
    }
  }

  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    console.info('kRYstall9 - mangaId: ' + mangaId);

    const url = `${this.api}/manga/${mangaId}`;

    try {
      let response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch chapters: ${response.statusText}`);
      }

      let body = await response.text();
      const doc: DocSelectionFunction = LoadDoc(body);

      const chaptersWrapper = doc('div.chapters-wrapper');

      const volumesContainer = chaptersWrapper.has('div.volume-element');

      let finalChapters: ChapterDetails[] = [];

      if (volumesContainer.html() != '') {
        const volumes = chaptersWrapper
          .children('div.volume-element')
          .map((index: number, element: DocSelection) => {
            return element.children('div.volume-chapters');
          });

        for (let volume of volumes) {
          let chapters = volume.children('div').map((index, element) => {
            let id = element
              .find('a')
              .first()
              .attrs()
            ['href'].split('manga/')[1]
              .split('?')[0];
            let url = element.find('a').first().attrs()['href'].split('?')[0];
            let title = element.find('span').first().text();
            let chapter = title.split(' ')[1];
            let chapterIndex = this.getConvertedIndex(chapter);

            let chapterDetails: ChapterDetails = {
              id: id,
              url: url,
              title: title,
              chapter: chapter,
              index: chapterIndex,
            };
            return chapterDetails;
          });
          finalChapters.push(...chapters);
        }
      } else {
        doc('div.chapters-wrapper>div.chapter').each((_, elem) => {
          let id = elem
            .find('a')
            .first()
            .attrs()
          ['href'].split('manga/')[1]
            .split('?')[0];
          let url = elem.find('a').first().attrs()['href'].split('?')[0];
          let title = elem.find('span.d-inline-block').text();
          let chapter = `${title.split(' ')[1]}`;
          let chapterIndex = this.getConvertedIndex(chapter);

          let chapterDetails: ChapterDetails = {
            id: id,
            url: url,
            title: title,
            chapter: chapter,
            index: chapterIndex,
          };

          finalChapters.push(chapterDetails);
        });
      }

      finalChapters.reverse();
      return finalChapters;
    }
    catch (e: any) {
      console.error(e);
      return []
    }

  }

  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const url = `${this.api}/manga/${chapterId}?style=list`;
    const referer = url.split('/read')[0];

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch chapter pages: ${response.statusText}`);
      }

      const body = await response.text();
      const doc: DocSelectionFunction = LoadDoc(body);

      let pages: ChapterPage[] = [];
      doc('div#page>img').each((index, element) => {
        let obj: ChapterPage = {
          url: element.attrs()['src'],
          index: index,
          headers: {
            Referer: referer,
          },
        };
        pages.push(obj);
      });
      return pages;
    }
    catch (e: any) {
      console.error(e);
      return []
    }
  }
  async getAniListMangaDetails(query: string, id: number = 0) {
    const aniListAPI = 'https://graphql.anilist.co';
    let variables = {};
    let aniListQuery = '';

    if (id == 0) {
      variables = {
        search: query,
      };
      aniListQuery = this.getAniListQueryString('search');
    } else {
      variables = {
        mediaId: id,
      };
      aniListQuery = this.getAniListQueryString('id');
    }

    let options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: aniListQuery,
        variables: variables,
      }),
    };
    let responseGraph = await fetch(aniListAPI, options);

    if (!responseGraph.ok) {
      throw new Error(
        `Failed to fetch search results: ${responseGraph.statusText}`
      );
    }

    let data: GraphQLResponse = await responseGraph.json();
    let mangaYear = data.data.Media.startDate['year'];
    let mangaSynonyms = data.data.Media.synonyms;

    let mangaDetails: AniListMangaDetails = {
      title: data.data.Media.title.english,
      synonyms: mangaSynonyms ?? [],
      year: mangaYear,
    };

    return mangaDetails;
  }

  getAniListQueryString(type: string): string {
    let query = `query`;

    switch (type) {
      case 'id':
        query += `($mediaId: Int) {
              Media(id: $mediaId) {`;
        break;
      case 'search':
        query += `($search: String) {
              Media(search: $search) {`;
        break;
    }
    query += `id
        title {
          romaji
          english
          native
        }
        startDate {
          day
          month
          year
        }
        meanScore
        synonyms
        updatedAt
        coverImage {
          large
        }
      }
      }`;
    return query;
  }

  getConvertedIndex(mangaChapter: string): number {
    let chapterNumber = mangaChapter.split('.');
    return Number(chapterNumber[0]);
  }
}

interface MangaDetails {
  id: string;
  title: string;
  synonyms?: string[];
  year?: number;
  image?: string;
}

interface AniListMangaDetails {
  title: string;
  synonyms: string[];
  year: number;
}

interface GraphQLResponse {
  data: {
    Media: {
      id: number;
      title: {
        romaji: string;
        english: string;
        native: string;
      };
      startDate: {
        day: number;
        month: number;
        year: number;
      };
      meanScore: number;
      synonyms: string[];
      updatedAt: string;
      coverImage: {
        large: string;
      };
    };
  };
}
