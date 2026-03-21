/// <reference path='./online-streaming-provider.d.ts' />
/// <reference path='./doc.d.ts' />

class Provider {
    api: string = 'https://www.hentaiworld.me';
    threshold: number = 0.7;

    getSettings(): Settings {
        return {
            episodeServers: ['HentaiWorld Server'],
            supportsDub: false,
        };
    }

    async search(query: SearchOptions): Promise<SearchResult[]> {
        let normalizedQuery = this.normalizeQuery(query['query']);
        console.log('Normalized Query: ' + normalizedQuery);

        const aniListData: AniListAnimeDetails = await getAniListMangaDetails(query['query']);
        const aniListTitlesAndSynonyms = [...aniListData.title, ...aniListData.synonyms];

        let url = `${this.api}/archive?search=${encodeURIComponent(normalizedQuery)}`;
        let data = await this._makeRequest(url);

        if (data.includes("Non ci sono")) {
            normalizedQuery = this.addSeasonWordToQuery(normalizedQuery);
            url = `${this.api}/archive?search=${encodeURIComponent(normalizedQuery)}`;
            data = await this._makeRequest(url);
        }

        if (data.includes("Non ci sono")) {
            throw new Error("No results found");
        }

        const $: DocSelectionFunction = LoadDoc(data);
        const animes: SearchResult[] = [];
        const validTitles: { title: string; score: number }[] = [];

        $('article.group\\/item').each((index: number, element: DocSelection) => {
            const aTag = element.find('a.absolute.inset-0');
            const rawHref: string = aTag.attr('href') ?? '';
            const titleElement = element.find('header h3.text-lead');
            const title: string = titleElement.text().trim();

            if (!rawHref || !title) return;

            const id = rawHref;
            const url: string = `${this.api}${id}`;
            const titleToCompare: string = title.toLowerCase().replace(/\s*\(\s*ita\s*\)\s*/gi, '').trim();

            console.log(titleToCompare);

            try {
                const bestScore: number | null = filterBySimilarity(titleToCompare, aniListTitlesAndSynonyms, this.threshold);
                if (bestScore != null) {
                    validTitles.push({ title, score: bestScore });
                }
            } catch (error) {
                console.error('Error: ' + error);
            }

            animes.push({ id, url, title, subOrDub: 'sub' });
        });

        if (validTitles.length > 0) {
            const bestMatch = validTitles.reduce((prev, current) => (prev.score > current.score) ? prev : current);
            const animeToReturn = animes.find(anime => anime.title.toLowerCase() === bestMatch.title.toLowerCase());
            if (animeToReturn) return [animeToReturn];
        }

        throw new Error("No results found");
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const url = `${this.api}${id}`;
        const data = await this._makeRequest(url);
        const $ = LoadDoc(data);
        const episodes: EpisodeDetails[] = [];

        $('article.episode-item').each((index, element) => {
            const aTag = element.find('a.absolute.inset-0');
            const href = aTag.attr('href') ?? '';
            if (!href) return;

            const epNumText = element.attr('data-episode') ?? '';
            const episodeId = element.attr('data-slug') ?? '';
            const episodeUrl = href.startsWith('http') ? href : `${this.api}${href}`;

            episodes.push({
                id: episodeId,
                url: episodeUrl,
                title: `Episodio ${epNumText}`,
                number: Number(epNumText) || (index + 1),
            });
        });

        return episodes.reverse();
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const server = _server !== 'default' ? _server : 'HentaiWorld Server';

        const [videoUrl, type] = await this.getMp4Url(episode.url);

        if (!videoUrl) {
            throw new Error("No server found");
        }

        const episodeServer: EpisodeServer = {
            server,
            headers: {},
            videoSources: [
                {
                    quality: '720p',
                    subtitles: [],
                    type: type as VideoSourceType,
                    url: videoUrl,
                },
            ],
        };

        return episodeServer;
    }

    async _makeRequest(url: string): Promise<string> {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                Cookie: '__ddg1_=;__ddg2_=;',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        return response.text();
    }

    normalizeQuery(query: string): string {
        const extras = [
            'EXTRA PART',
            'OVA',
            'SPECIAL',
            'RECAP',
            'FINAL SEASON',
            'BONUS',
            'SIDE STORY',
            'PART\\s*\\d+',
            'EPISODE\\s*\\d+',
            'UNCENSORED',
        ];

        const pattern = new RegExp(`\\b(${extras.join('|')})\\b`, 'gi');

        return query
            .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
            .replace(/(\d+)\s*Season/i, '$1')
            .replace(/Season\s*(\d+)/i, '$1')
            .replace(pattern, '')
            .replace(/-.*?-/g, '')
            .replace(/\bThe(?=\s+Movie\b)/gi, '')
            .replace(/~/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    addSeasonWordToQuery(query: string): string {
        if (/Season/i.test(query)) return query;
        const match = query.match(/\b(\d+)(st|nd|rd|th)?\b/);
        if (match && match.index !== undefined) {
            return `${query} Season`;
        }
        return query;
    }

    async getMp4Url(url: string): Promise<string[]> {
        const body = await this._makeRequest(url);
        const $ = LoadDoc(body);

        let videoUrl = '';
        let type = 'mp4';

        $('script').each((index, element) => {
            const scriptContent = element.text();
            const match = scriptContent.match(/const\s+videoUrl\s*=\s*'([^']+)'/);
            if (match && match[1]) {
                videoUrl = match[1];
                type = videoUrl.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4';
                return false;
            }
        });

        if (!videoUrl) {
            $('div.widget-body center a').each((index, element) => {
                const href = element.attr('href');
                if (href && href.toLowerCase().includes('.mp4')) {
                    videoUrl = href;
                    return false;
                }
                if (href && (element.text().toLowerCase().includes('alternativo') || element.attr('download') !== undefined)) {
                    if (!videoUrl) videoUrl = href;
                }
            });
        }

        return [videoUrl, type];
    }
}

// --- UTILITY FUNCTIONS ---

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) matrix[i] = [i];
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
}

function similarityScore(a: string, b: string): number {
    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - distance / maxLen;
}

function filterBySimilarity(input: string, candidates: string[], threshold: number): number | null {
    const validMatches = candidates
        .map(candidate => ({
            title: candidate,
            score: similarityScore(
                normalizeStringBeforeLevenshtein(input),
                normalizeStringBeforeLevenshtein(candidate)
            ),
        }))
        .filter(item => item.score >= threshold);

    if (validMatches.length > 0) {
        return validMatches.reduce((prev, current) => (prev.score > current.score) ? prev : current).score;
    }
    return null;
}

async function getAniListMangaDetails(query: string, id: number = 0): Promise<AniListAnimeDetails> {
    const aniListAPI = 'https://graphql.anilist.co';

    const variables = id === 0 ? { search: query } : { mediaId: id };
    const aniListQuery = getAniListQueryString(id === 0 ? 'search' : 'id');

    const responseGraph = await fetch(aniListAPI, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ query: aniListQuery, variables }),
    });

    if (!responseGraph.ok) {
        console.warn(`AniList fetch failed: ${responseGraph.statusText}`);
        return { title: [], synonyms: [], year: 0 };
    }

    const data: GraphQLResponse = await responseGraph.json();

    if (!data.data || !data.data.Media) {
        return { title: [], synonyms: [], year: 0 };
    }

    const { Media } = data.data;
    const titles: string[] = [];
    if (Media.title.english) titles.push(Media.title.english);
    if (Media.title.romaji) titles.push(Media.title.romaji);

    return {
        title: titles,
        synonyms: Media.synonyms ?? [],
        year: Media.startDate.year,
    };
}

function getAniListQueryString(type: string): string {
    let query = 'query';
    switch (type) {
        case 'id':
            query += '($mediaId: Int) { Media(id: $mediaId) {';
            break;
        case 'search':
            query += '($search: String) { Media(search: $search, format_in: [OVA, ONA, SPECIAL], isAdult: true) {';
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

function normalizeStringBeforeLevenshtein(input: string): string {
    return input
        .replace(/Season/gi, '')
        .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// --- INTERFACES ---

interface AniListAnimeDetails {
    title: string[];
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
