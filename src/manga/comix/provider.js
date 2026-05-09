/**
 * Seanime Extension for Comix
 * Implements MangaProvider interface for 'https://comix.to'.
 */

// [RC4 key, mutKey, prefKey] x 5 rounds. Matches the current Comix request signature.
const COMIX_KEYS = [
    "JxTcdyiA5GZxnbrmthXBQfU2IMTKcY1+3nNhbq98Sgo=",
    "3PordjODbhqla382Cxapmo/1JiABJQcjiJj1+48gTJ4=",
    "OaKvnI5ARA==",
    "MHNBHYWA7lvy867fXgvGcJwWDk79KqUJUVFsh3RwnnI=",
    "8i0Cru/VJBSVB2Y1GcMDVpzx2WepOcfnWdd81yxICl4=",
    "Fyskubz8VvA=",
    "B46L1x+UeWP+19cRpQ+OZvdLAK9EHID8g3mSgn57tew=",
    "DTSTmUt6LpDUw9r1lSQqyb3YlFTzruT8tk8wUGkwehQ=",
    "vY/meeI=",
    "7xWfIF5THL5LAnRgAARg+4mjWHPU9n3PQwvzbaMNi+Q=",
    "bewtiTuV+HJk56xxkf2iCljLgruCpBmN9BgE8i6gc9M=",
    "/Xcb2zAu8AU=",
    "WgeCQ3T8R51uTwVSiVa7Zy0dN6JOg6Z5JleMS+HV8Aw=",
    "yXayUVFrrcW56jQCEfZzuCidjpnWKjTDUNT7XeX9i7k=",
    "tSLco2w=",
];

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64ToBytes(b64) {
    const source = b64.replace(/=+$/, "");
    const output = new Uint8Array((source.length * 6) >> 3);
    let outIndex = 0;
    let bits = 0;
    let bitCount = 0;

    for (let i = 0; i < source.length; i++) {
        bits = (bits << 6) | B64_ALPHABET.indexOf(source.charAt(i));
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            output[outIndex++] = (bits >> bitCount) & 0xff;
        }
    }

    return output;
}

function bytesToUrlB64NoPad(bytes) {
    let output = "";
    let bits = 0;
    let bitCount = 0;

    for (let i = 0; i < bytes.length; i++) {
        bits = (bits << 8) | bytes[i];
        bitCount += 8;
        while (bitCount >= 6) {
            bitCount -= 6;
            output += B64_URL_ALPHABET.charAt((bits >> bitCount) & 0x3f);
        }
    }

    if (bitCount > 0) {
        output += B64_URL_ALPHABET.charAt((bits << (6 - bitCount)) & 0x3f);
    }

    return output;
}

function strToAsciiBytes(value) {
    const output = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
        output[i] = value.charCodeAt(i) & 0xff;
    }
    return output;
}

function getKeyBytes(index) {
    return b64ToBytes(COMIX_KEYS[index]);
}

function rc4(key, data) {
    if (key.length === 0) {
        return new Uint8Array(data);
    }

    const state = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        state[i] = i;
    }

    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + state[i] + key[i % key.length]) & 0xff;
        const tmp = state[i];
        state[i] = state[j];
        state[j] = tmp;
    }

    const output = new Uint8Array(data.length);
    let i = 0;
    j = 0;

    for (let n = 0; n < data.length; n++) {
        i = (i + 1) & 0xff;
        j = (j + state[i]) & 0xff;
        const tmp = state[i];
        state[i] = state[j];
        state[j] = tmp;
        output[n] = data[n] ^ state[(state[i] + state[j]) & 0xff];
    }

    return output;
}

function opShiftRight7Left1(value) {
    return ((value >>> 7) | (value << 1)) & 0xff;
}

function opShiftLeft1Right7(value) {
    return ((value << 1) | (value >>> 7)) & 0xff;
}

function opShiftRight2Left6(value) {
    return ((value >>> 2) | (value << 6)) & 0xff;
}

function opShiftLeft4Right4(value) {
    return ((value << 4) | (value >>> 4)) & 0xff;
}

function opShiftRight4Left4(value) {
    return ((value >>> 4) | (value << 4)) & 0xff;
}

function getMutKey(mutKey, index) {
    const keyIndex = index % 32;
    return mutKey.length > 0 && keyIndex < mutKey.length ? mutKey[keyIndex] : 0;
}

function mutateRound(data, mutKeyIndex, prefKeyIndex, prefLength, round) {
    const mutKey = getKeyBytes(mutKeyIndex);
    const prefKey = getKeyBytes(prefKeyIndex);
    const output = [];

    for (let i = 0; i < data.length; i++) {
        if (i < prefLength && i < prefKey.length) {
            output.push(prefKey[i]);
        }

        let value = (data[i] ^ getMutKey(mutKey, i)) & 0xff;
        const mode = i % 10;

        switch (round) {
            case 1:
                switch (mode) {
                    case 0:
                        value = opShiftRight7Left1(value);
                        break;
                    case 1:
                        value ^= 37;
                        break;
                    case 2:
                        value ^= 81;
                        break;
                    case 3:
                        value ^= 147;
                        break;
                    case 4:
                        value = opShiftRight2Left6(value);
                        break;
                    case 5:
                    case 8:
                        value = opShiftRight4Left4(value);
                        break;
                    case 6:
                        value ^= 218;
                        break;
                    case 7:
                        value = (value + 159) & 0xff;
                        break;
                    case 9:
                        value ^= 180;
                        break;
                    default:
                        break;
                }
                break;
            case 2:
                switch (mode) {
                    case 0:
                    case 9:
                        value ^= 180;
                        break;
                    case 1:
                        value = opShiftLeft1Right7(value);
                        break;
                    case 2:
                        value ^= 147;
                        break;
                    case 3:
                        value = opShiftRight7Left1(value);
                        break;
                    case 4:
                        value = opShiftRight2Left6(value);
                        break;
                    case 5:
                        value = opShiftRight4Left4(value);
                        break;
                    case 6:
                    case 8:
                        value = (value + 159) & 0xff;
                        break;
                    case 7:
                        value = (value + 34) & 0xff;
                        break;
                    default:
                        break;
                }
                break;
            case 3:
                switch (mode) {
                    case 0:
                        value ^= 81;
                        break;
                    case 1:
                        value = opShiftRight4Left4(value);
                        break;
                    case 2:
                    case 9:
                        value = opShiftLeft4Right4(value);
                        break;
                    case 3:
                        value ^= 37;
                        break;
                    case 4:
                        value = (value + 159) & 0xff;
                        break;
                    case 5:
                        value = opShiftLeft1Right7(value);
                        break;
                    case 6:
                        value ^= 180;
                        break;
                    case 7:
                        value = (value + 34) & 0xff;
                        break;
                    case 8:
                        value = opShiftRight2Left6(value);
                        break;
                    default:
                        break;
                }
                break;
            case 4:
                switch (mode) {
                    case 0:
                    case 7:
                        value ^= 218;
                        break;
                    case 1:
                    case 4:
                        value = opShiftLeft1Right7(value);
                        break;
                    case 2:
                        value = opShiftRight7Left1(value);
                        break;
                    case 3:
                        value = (value + 159) & 0xff;
                        break;
                    case 5:
                    case 8:
                        value ^= 180;
                        break;
                    case 6:
                        value ^= 147;
                        break;
                    case 9:
                        value ^= 37;
                        break;
                    default:
                        break;
                }
                break;
            case 5:
                switch (mode) {
                    case 0:
                        value = opShiftLeft4Right4(value);
                        break;
                    case 1:
                    case 3:
                        value ^= 147;
                        break;
                    case 2:
                        value = (value + 34) & 0xff;
                        break;
                    case 4:
                    case 9:
                        value ^= 218;
                        break;
                    case 5:
                    case 7:
                        value = opShiftLeft1Right7(value);
                        break;
                    case 6:
                        value ^= 180;
                        break;
                    case 8:
                        value = opShiftRight2Left6(value);
                        break;
                    default:
                        break;
                }
                break;
            default:
                break;
        }

        output.push(value & 0xff);
    }

    return new Uint8Array(output);
}

function applyRound(data, rc4KeyIndex, mutKeyIndex, prefKeyIndex, prefLength, round) {
    const mutated = mutateRound(data, mutKeyIndex, prefKeyIndex, prefLength, round);
    return rc4(getKeyBytes(rc4KeyIndex), mutated);
}

function round1(data) {
    return applyRound(data, 0, 1, 2, 7, 1);
}

function round2(data) {
    return applyRound(data, 3, 4, 5, 8, 2);
}

function round3(data) {
    return applyRound(data, 6, 7, 8, 5, 3);
}

function round4(data) {
    return applyRound(data, 9, 10, 11, 8, 4);
}

function round5(data) {
    return applyRound(data, 12, 13, 14, 5, 5);
}

function generateComixHash(path) {
    const encoded = encodeURIComponent(path)
        .replace(/\+/g, "%20")
        .replace(/\*/g, "%2A")
        .replace(/%7E/g, "~");
    const bytes = strToAsciiBytes(encoded);
    const result = round5(round4(round3(round2(round1(bytes)))));
    return bytesToUrlB64NoPad(result);
}

class Provider {

    constructor() {
        this.api = "https://comix.to";
        this.apiUrl = "https://comix.to/api/v1";
        this.chapterPageConcurrency = 8;
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: true,
        };
    }

    async fetchJson(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    Referer: `${this.api}/`,
                },
            });

            if (!response.ok) return null;
            return await response.json();
        }
        catch (e) {
            return null;
        }
    }

    async fetchInBatches(items, batchSize, fn) {
        const results = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(async (item) => {
                try {
                    return await fn(item);
                }
                catch (e) {
                    return [];
                }
            }));
            results.push.apply(results, batchResults);
        }

        return results;
    }

    extractTitleSlug(url) {
        if (!url) return "";

        const value = String(url);
        const marker = "/title/";
        const slug = value.indexOf(marker) >= 0
            ? value.slice(value.indexOf(marker) + marker.length)
            : value.replace(/^\/?title\//, "").replace(/^\/+/, "");

        return slug.split(/[/?#]/)[0] || "";
    }

    slugWithoutHash(hashId, slug) {
        const cleanSlug = String(slug || "").trim().replace(/^\/+/, "");
        if (!cleanSlug) return "";
        if (cleanSlug === hashId) return "";
        return cleanSlug.indexOf(`${hashId}-`) === 0 ? cleanSlug.slice(hashId.length + 1) : cleanSlug;
    }

    normalizeMangaId(mangaId) {
        const rawId = String(mangaId || "").trim();
        const parts = rawId.split("|");

        let hashId = parts[0] || "";
        let slug = parts[1] || "";

        if (rawId.indexOf("|") < 0 && rawId.indexOf("-") > 0) {
            hashId = rawId.split("-")[0];
            slug = rawId.slice(hashId.length + 1);
        }

        slug = this.slugWithoutHash(hashId, slug);

        return {
            hashId,
            slug,
            fullSlug: slug ? `${hashId}-${slug}` : hashId,
        };
    }

    extractSlugFromItem(item, hashId) {
        return this.slugWithoutHash(hashId, item.slug || this.extractTitleSlug(item.url));
    }

    normalizeSynonyms(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map((item) => {
                if (typeof item === "string") return item;
                return item && item.title ? String(item.title) : "";
            })
            .filter((item) => item.length > 0);
    }

    getPosterUrl(item) {
        const poster = item.poster || {};
        return poster.large || poster.medium || poster.small || "";
    }

    getYear(item) {
        const value = item.year || item.startDate;
        const year = parseInt(value, 10);
        return isNaN(year) ? undefined : year;
    }

    getLastPage(result) {
        const pagination = (result && (result.meta || result.pagination)) || {};
        const lastPage = pagination.lastPage || pagination.last_page || 1;
        const parsed = parseInt(lastPage, 10);
        return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }

    formatChapterNumber(value) {
        const str = String(value);
        return str.endsWith(".0") ? str.slice(0, -2) : str;
    }

    /**
     * Searches for manga.
     */
    async search(opts) {
        const queryParam = opts && opts.query ? opts.query : "";
        const url = `${this.apiUrl}/manga?keyword=${encodeURIComponent(queryParam)}&order[relevance]=desc&limit=28&page=1`;

        try {
            const data = await this.fetchJson(url);
            if (!data || !data.result || !data.result.items) return [];

            const items = data.result.items;
            const mangas = [];

            items.forEach((item) => {
                const hashId = item.hid || item.hash_id;
                if (!hashId) return;

                const slug = this.extractSlugFromItem(item, hashId);
                const compositeId = `${hashId}|${slug}`;

                mangas.push({
                    id: compositeId,
                    title: item.title || slug || hashId,
                    synonyms: this.normalizeSynonyms(item.altTitles || item.alt_titles),
                    year: this.getYear(item),
                    image: this.getPosterUrl(item),
                });
            });

            return mangas;
        }
        catch (e) {
            return [];
        }
    }

    buildChapterUrl(hashId, mangaSlug, page, token) {
        const path = `/manga/${hashId}/chapters`;
        const requestToken = token || generateComixHash(path);
        return `${this.apiUrl}${path}?order[number]=desc&limit=100&page=${page}&_=${encodeURIComponent(requestToken)}&mangaSlug=${encodeURIComponent(mangaSlug)}`;
    }

    async fetchChapterItems(hashId, mangaSlug, page, token) {
        const data = await this.fetchJson(this.buildChapterUrl(hashId, mangaSlug, page, token));
        if (!data || !data.result || !data.result.items) return [];
        return data.result.items;
    }

    /**
     * Finds all chapters.
     */
    async findChapters(mangaId) {
        const manga = this.normalizeMangaId(mangaId);
        const hashId = manga.hashId;
        const slug = manga.slug;
        const fullSlug = manga.fullSlug;
        if (!hashId) return [];

        try {
            const path = `/manga/${hashId}/chapters`;
            const token = generateComixHash(path);
            const firstData = await this.fetchJson(this.buildChapterUrl(hashId, fullSlug, 1, token));
            if (!firstData || !firstData.result || !firstData.result.items) return [];

            const totalPages = this.getLastPage(firstData.result);
            const allChapters = firstData.result.items.slice();
            const remainingPages = [];

            for (let page = 2; page <= totalPages; page++) {
                remainingPages.push(page);
            }

            const pageResults = await this.fetchInBatches(
                remainingPages,
                this.chapterPageConcurrency,
                (page) => this.fetchChapterItems(hashId, fullSlug, page, token)
            );

            pageResults.forEach((items) => {
                if (items.length > 0) {
                    allChapters.push.apply(allChapters, items);
                }
            });

            const chapters = [];

            allChapters.forEach((item) => {
                if (item.language && item.language.toLowerCase() !== "en" && item.language.toLowerCase() !== "english") {
                    return;
                }

                const chapterId = item.id != null ? item.id : item.chapter_id;
                const chapterNumber = item.number != null
                    ? this.formatChapterNumber(item.number)
                    : (item.chapter || item.chap || "");
                if (!chapterId) return;
                if (!chapterNumber) return;

                const chapterTitle = item.name && item.name.trim().length > 0
                    ? `Chapter ${chapterNumber}: ${item.name}`
                    : `Chapter ${chapterNumber}`;
                const group = item.group || item.scanlation_group;
                const isOfficial = item.isOfficial === true || item.isOfficial === 1 || item.is_official === true || item.is_official === 1;
                const scanlator = group && group.name
                    ? group.name.trim()
                    : (isOfficial ? "Official" : undefined);

                chapters.push({
                    id: `${hashId}|${slug}|${chapterId}|${chapterNumber}`,
                    url: `${this.api}/title/${fullSlug}/${chapterId}-chapter-${chapterNumber}`,
                    title: chapterTitle,
                    chapter: chapterNumber,
                    index: 0,
                    scanlator: scanlator,
                    language: "en",
                    rating: item.votes,
                    updatedAt: item.updatedAtFormatted || item.createdAtFormatted || (item.updated_at ? item.updated_at.toString() : undefined),
                });
            });

            chapters.sort((a, b) => {
                const chapterDiff = this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter);
                if (chapterDiff !== 0) return chapterDiff;
                return this.extractChapterId(a.id) - this.extractChapterId(b.id);
            });

            chapters.forEach((chapter, index) => {
                chapter.index = index;
            });

            return chapters;
        }
        catch (e) {
            return [];
        }
    }

    extractChapterNumber(chapterStr) {
        const num = parseFloat(chapterStr);
        if (!isNaN(num)) {
            return num;
        }

        const match = chapterStr.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
    }

    extractChapterId(chapterId) {
        const parts = chapterId.split("|");
        const num = parseInt(parts[2], 10);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Finds all image pages.
     */
    async findChapterPages(chapterId) {
        const parts = String(chapterId || "").split("|");
        const rawChapterId = parts.length >= 3
            ? parts[2]
            : String(chapterId || "").split("/").pop();
        const specificChapterId = String(rawChapterId || "").split("-")[0];
        if (!specificChapterId) return [];

        try {
            const path = `/chapters/${specificChapterId}`;
            const token = generateComixHash(path);
            const data = await this.fetchJson(`${this.apiUrl}${path}?_=${encodeURIComponent(token)}`);
            if (!data) return [];

            const result = data.result || {};
            const images = result.pages || result.images || [];

            return images
                .filter((img) => img && img.url)
                .map((img, index) => ({
                    url: img.url,
                    index,
                    headers: {
                        Referer: `${this.api}/`,
                    },
                }));
        }
        catch (e) {
            return [];
        }
    }
}
