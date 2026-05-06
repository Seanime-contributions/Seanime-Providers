/**
 * Seanime Extension for Comix
 * Implements MangaProvider interface for 'https://comix.to'.
 */

// [RC4 key, mutKey, prefKey] x 5 rounds. Matches the current Comix request signature.
const COMIX_KEYS = [
    "13YDu67uDgFczo3DnuTIURqas4lfMEPADY6Jaeqky+w=",
    "yEy7wBfBc+gsYPiQL/4Dfd0pIBZFzMwrtlRQGwMXy3Q=",
    "yrP+EVA1Dw==",
    "vZ23RT7pbSlxwiygkHd1dhToIku8SNHPC6V36L4cnwM=",
    "QX0sLahOByWLcWGnv6l98vQudWqdRI3DOXBdit9bxCE=",
    "WJwgqCmf",
    "BkWI8feqSlDZKMq6awfzWlUypl88nz65KVRmpH0RWIc=",
    "v7EIpiQQjd2BGuJzMbBA0qPWDSS+wTJRQ7uGzZ6rJKs=",
    "1SUReYlCRA==",
    "RougjiFHkSKs20DZ6BWXiWwQUGZXtseZIyQWKz5eG34=",
    "LL97cwoDoG5cw8QmhI+KSWzfW+8VehIh+inTxnVJ2ps=",
    "52iDqjzlqe8=",
    "U9LRYFL2zXU4TtALIYDj+lCATRk/EJtH7/y7qYYNlh8=",
    "e/GtffFDTvnw7LBRixAD+iGixjqTq9kIZ1m0Hj+s6fY=",
    "xb2XwHNB",
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

function rotl8(value, shift) {
    return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

function rotr8(value, shift) {
    return ((value >>> shift) | (value << (8 - shift))) & 0xff;
}

function mutC(value) {
    return (value + 115) & 0xff;
}

function mutB(value) {
    return (value - 12 + 256) & 0xff;
}

function mutY(value) {
    return rotr8(value, 1);
}

function mutDollar(value) {
    return rotl8(value, 4);
}

function mutH(value) {
    return (value - 42 + 256) & 0xff;
}

function mutS(value) {
    return (value + 143) & 0xff;
}

function mutL(value) {
    return rotr8(value, 1);
}

function mutK(value) {
    return (value - 241 + 256) & 0xff;
}

function mutF(value) {
    return (value - 188 + 256) & 0xff;
}

function mutG(value) {
    return rotl8(value, 2);
}

function mutM(value) {
    return (value ^ 177) & 0xff;
}

function mutUnderscore(value) {
    return (value - 20 + 256) & 0xff;
}

function getMutKey(mutKey, index) {
    const keyIndex = index % 32;
    return mutKey.length > 0 && keyIndex < mutKey.length ? mutKey[keyIndex] : 0;
}

function applyRound(data, rc4KeyIndex, mutKeyIndex, prefKeyIndex, prefLength, mutate) {
    const encrypted = rc4(getKeyBytes(rc4KeyIndex), data);
    const mutKey = getKeyBytes(mutKeyIndex);
    const prefKey = getKeyBytes(prefKeyIndex);
    const output = [];

    for (let i = 0; i < encrypted.length; i++) {
        if (i < prefLength && i < prefKey.length) {
            output.push(prefKey[i]);
        }

        const value = (encrypted[i] ^ getMutKey(mutKey, i)) & 0xff;
        output.push(mutate(i % 10, value));
    }

    return new Uint8Array(output);
}

function round1(data) {
    return applyRound(data, 0, 1, 2, 7, (mode, value) => {
        switch (mode) {
            case 0:
            case 9:
                return mutC(value);
            case 1:
                return mutB(value);
            case 2:
                return mutY(value);
            case 3:
                return mutDollar(value);
            case 4:
            case 6:
                return mutH(value);
            case 5:
                return mutS(value);
            case 7:
                return mutK(value);
            case 8:
                return mutL(value);
            default:
                return value;
        }
    });
}

function round2(data) {
    return applyRound(data, 3, 4, 5, 6, (mode, value) => {
        switch (mode) {
            case 0:
            case 8:
                return mutC(value);
            case 1:
                return mutB(value);
            case 2:
            case 6:
                return mutDollar(value);
            case 3:
                return mutH(value);
            case 4:
            case 9:
                return mutS(value);
            case 5:
                return mutK(value);
            case 7:
                return mutUnderscore(value);
            default:
                return value;
        }
    });
}

function round3(data) {
    return applyRound(data, 6, 7, 8, 7, (mode, value) => {
        switch (mode) {
            case 0:
                return mutC(value);
            case 1:
                return mutF(value);
            case 2:
            case 8:
                return mutS(value);
            case 3:
                return mutG(value);
            case 4:
                return mutY(value);
            case 5:
                return mutM(value);
            case 6:
                return mutDollar(value);
            case 7:
                return mutK(value);
            case 9:
                return mutB(value);
            default:
                return value;
        }
    });
}

function round4(data) {
    return applyRound(data, 9, 10, 11, 8, (mode, value) => {
        switch (mode) {
            case 0:
                return mutB(value);
            case 1:
            case 9:
                return mutM(value);
            case 2:
            case 7:
                return mutL(value);
            case 3:
            case 5:
                return mutS(value);
            case 4:
            case 6:
                return mutUnderscore(value);
            case 8:
                return mutY(value);
            default:
                return value;
        }
    });
}

function round5(data) {
    return applyRound(data, 12, 13, 14, 6, (mode, value) => {
        switch (mode) {
            case 0:
                return mutUnderscore(value);
            case 1:
            case 7:
                return mutS(value);
            case 2:
                return mutC(value);
            case 3:
            case 5:
                return mutM(value);
            case 4:
                return mutB(value);
            case 6:
                return mutF(value);
            case 8:
                return mutDollar(value);
            case 9:
                return mutG(value);
            default:
                return value;
        }
    });
}

function generateComixHash(path, bodySize, time) {
    const base = `${path}:${bodySize}:${time}`;
    const encoded = encodeURIComponent(base)
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
        this.apiUrl = "https://comix.to/api/v2";
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

    /**
     * Searches for manga.
     */
    async search(opts) {
        const queryParam = opts.query;
        const url = `${this.apiUrl}/manga?keyword=${encodeURIComponent(queryParam)}&order[relevance]=desc`;

        try {
            const data = await this.fetchJson(url);
            if (!data || !data.result || !data.result.items) return [];

            const items = data.result.items;
            const mangas = [];

            items.forEach((item) => {
                const compositeId = `${item.hash_id}|${item.slug}`;

                let imageUrl = "";
                if (item.poster) {
                    imageUrl = item.poster.medium || item.poster.large || item.poster.small || "";
                }

                mangas.push({
                    id: compositeId,
                    title: item.title,
                    synonyms: item.alt_titles || [],
                    year: undefined,
                    image: imageUrl,
                });
            });

            return mangas;
        }
        catch (e) {
            return [];
        }
    }

    buildChapterUrl(hashId, page, token) {
        const path = `/manga/${hashId}/chapters`;
        const time = 1;
        const requestToken = token || generateComixHash(path, 0, time);
        return `${this.apiUrl}${path}?order[number]=desc&limit=100&page=${page}&time=${time}&_=${encodeURIComponent(requestToken)}`;
    }

    async fetchChapterItems(hashId, page, token) {
        const data = await this.fetchJson(this.buildChapterUrl(hashId, page, token));
        if (!data || !data.result || !data.result.items) return [];
        return data.result.items;
    }

    /**
     * Finds all chapters.
     */
    async findChapters(mangaId) {
        const parts = mangaId.split("|");
        const hashId = parts[0];
        const slug = parts[1];
        if (!hashId || !slug) return [];

        try {
            const path = `/manga/${hashId}/chapters`;
            const token = generateComixHash(path, 0, 1);
            const firstData = await this.fetchJson(this.buildChapterUrl(hashId, 1, token));
            if (!firstData || !firstData.result || !firstData.result.items) return [];

            const pagination = firstData.result.pagination || {};
            const totalPages = pagination.last_page || 1;
            const allChapters = firstData.result.items.slice();
            const remainingPages = [];

            for (let page = 2; page <= totalPages; page++) {
                remainingPages.push(page);
            }

            const pageResults = await this.fetchInBatches(
                remainingPages,
                this.chapterPageConcurrency,
                (page) => this.fetchChapterItems(hashId, page, token)
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

                const chapterNumber = item.number != null ? item.number.toString() : "";
                if (!chapterNumber) return;

                const chapterTitle = item.name && item.name.trim().length > 0
                    ? `Chapter ${chapterNumber} - ${item.name}`
                    : `Chapter ${chapterNumber}`;
                const scanlator = item.is_official === 1
                    ? "Official"
                    : (item.scanlation_group && item.scanlation_group.name ? item.scanlation_group.name.trim() : undefined);

                chapters.push({
                    id: `${hashId}|${slug}|${item.chapter_id}|${chapterNumber}`,
                    url: `${this.api}/title/${hashId}-${slug}/${item.chapter_id}-chapter-${chapterNumber}`,
                    title: chapterTitle,
                    chapter: chapterNumber,
                    index: 0,
                    scanlator: scanlator,
                    language: "en",
                    rating: item.votes,
                    updatedAt: item.updated_at ? item.updated_at.toString() : undefined,
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
        const parts = chapterId.split("|");
        if (parts.length < 3) return [];

        const specificChapterId = parts[2];

        try {
            const data = await this.fetchJson(`${this.apiUrl}/chapters/${specificChapterId}`);
            if (!data) return [];

            const result = data.result || {};
            const images = result.images || [];

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
