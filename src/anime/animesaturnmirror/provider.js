/// <reference path="./online-streaming-provider.d.ts" />
/// <reference path="./doc.d.ts" />

class Provider {

    constructor() {
        this.apiUrl = "https://animesaturn.ro";
        this.defaultHeaders = {
            'Content-Type': 'text/html; charset=utf-8',
            'Referer': 'https://animesaturn.ro/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
        };
    }

    getSettings() {
        return {
            episodeServers: ["Server 1"],
            supportsDub: true,
        }
    }

    async search(query) {

        let normalizedQuery = normalizeQuery(query.query);

        const url = this.apiUrl + "/?s=" + encodeURIComponent(normalizedQuery);
        const response = await fetch(url, { method: 'GET', headers: this.defaultHeaders });
        if (!response.ok) throw new Error("Failed to fetch search: " + response.statusText);
        const html = await response.text();
        const $ = LoadDoc(html);

        const results = [];

        $("article.bs").each(function(_, element) {
            const anchor = element.find("a");
            const href = anchor.attr("href") || "";
            const rawTitle = anchor.attr("title") || element.find(".tt").text().trim();
            const cleanedTitle = cleanTitle(rawTitle);
            const id = href.replace(/^https?:\/\/animesaturn\.ro\//, "").replace(/\/$/, "");

            const badgeText = element.find(".sb").text().trim().toLowerCase();
            const isDub = badgeText === "dub";
            const subOrDub = isDub ? "dub" : "sub";


            if (query.dub && !isDub) return;
            if (!query.dub && isDub) return;

            results.push({
                id: id,
                title: cleanedTitle,
                url: href,
                subOrDub: subOrDub,
            });
        }.bind(this));

        if (results.length === 0) {
            throw new Error("No results found for: " + query.query);
        }

        return results;
    }

    async findEpisodes(id) {
        const url = this.apiUrl + "/" + id + "/";
        const response = await fetch(url, { method: 'GET', headers: this.defaultHeaders });
        if (!response.ok) throw new Error("Failed to fetch episodes: " + response.statusText);
        const html = await response.text();
        const $ = LoadDoc(html);

        const episodes = [];

        $(".eplister ul li a").each(function(_, element) {
            const href = element.attr("href") || "";
            const numText = element.find(".epl-num").text().trim();
            const number = parseInt(numText, 10);
            const epId = href.replace(/^https?:\/\/animesaturn\.ro\//, "").replace(/\/$/, "");

            episodes.push({
                id: epId,
                number: isNaN(number) ? 0 : number,
                url: href,
                title: "Episode " + number,
            });
        }.bind(this));

        return episodes;
    }

    async findEpisodeServer(episode, _server) {
        const server = _server !== "default" ? _server : "Server 1";

        // Step 1: Get the episode page and extract the iframe embed URL
        const episodeRes = await fetch(episode.url, { method: 'GET', headers: this.defaultHeaders });
        if (!episodeRes.ok) throw new Error("Failed to fetch episode page: " + episodeRes.statusText);
        const episodeHtml = await episodeRes.text();
        const $ = LoadDoc(episodeHtml);

        const iframeSrc = $("#pembed iframe").attr("src") || "";
        if (!iframeSrc) {
            throw new Error("Could not find embed iframe for episode: " + episode.url);
        }


        // Step 2: Fetch the player page to extract the JWPlayer file URL
        const playerRes = await fetch(iframeSrc, { method: 'GET', headers: this.defaultHeaders });
        if (!playerRes.ok) throw new Error("Failed to fetch player page: " + playerRes.statusText);
        const playerHtml = await playerRes.text();

        const fileMatch = playerHtml.match(/file:\s*"([^"]+)"/);
        if (!fileMatch) {
            throw new Error("Could not find file URL in player page");
        }

        const rawFileUrl = fileMatch[1].replace(/\\u0026/g, "&");

        // Step 3: Determine type from the cache URL's src param
        const srcParamMatch = rawFileUrl.match(/[?&]src=([^&]+)/);
        const decodedSrc = srcParamMatch ? decodeURIComponent(srcParamMatch[1]) : rawFileUrl;
        const fileType = decodedSrc.endsWith(".m3u8") ? "m3u8" : "mp4";


        const headers = {
            "Referer": iframeSrc,
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
            "Accept": "*/*",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        };

        const videoSources = [{
            quality: "auto",
            url: rawFileUrl,
            type: fileType,
            subtitles: [],
        }];

        return {
            server: server,
            headers: headers,
            videoSources: videoSources,
        };
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cleanTitle(title) {
    return title
        .replace(/\(\s*ITA\s*\)/gi, "")
        .replace(/\bSub\s+ITA\b/gi, "")
        .replace(/\bITA\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeQuery(query) {
    let normalizedQuery = query
        .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
        .replace(/(\d+)\s*Season/i, '$1')
        .replace(/Season\s*(\d+)/i, '$1')
        .replace(/-.*?-/g, '')
        .replace(/\bThe(?=\s+Movie\b)/gi, '')
        .replace(/~/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const match = normalizedQuery.match(/[^a-zA-Z0-9 ]/);
    if (match) {
        return normalizedQuery.slice(0, match.index).trim();
    }
    return normalizedQuery;
}
