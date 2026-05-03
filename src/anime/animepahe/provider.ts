/// <reference path="../goja_onlinestream_test/onlinestream-provider.d.ts" />
/// <reference path="../goja_plugin_types/core.d.ts" />

type EpisodeData = {
    id: number; episode: number; title: string; snapshot: string; filler: number; session: string; created_at?: string
}

type AnimeData = {
    id: number; title: string; type: string; year: number; poster: string; session: string
}

class Provider {

    api = "https://animepahe.pw"
    headers = { Referer: "https://kwik.cx" }

    // Up to 8 slots each, matching max buttons expected on a play page
    getSettings(): Settings {
        return {
            episodeServers: [
                "Kwik 1", "Kwik 2", "Kwik 3", "Kwik 4",
                "Kwik 5", "Kwik 6", "Kwik 7", "Kwik 8",
                "Pahe 1", "Pahe 2", "Pahe 3", "Pahe 4",
                "Pahe 5", "Pahe 6", "Pahe 7", "Pahe 8",
            ],
            supportsDub: false,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const req = await fetch(`${this.api}/api?m=search&q=${encodeURIComponent(opts.query)}`, {
            headers: { Cookie: "__ddg1_=;__ddg2_=;" },
        })

        if (!req.ok) return []

        const data = (await req.json()) as { data: AnimeData[] }
        if (!data?.data) return []

        return data.data.map((item: AnimeData) => ({
            subOrDub: "sub",
            id: item.session,
            title: item.title,
            url: "",
        }))
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        let episodes: EpisodeDetails[] = []

        const req = await fetch(
            `${this.api}${id.includes("-") ? `/anime/${id}` : `/a/${id}`}`,
            { headers: { Cookie: "__ddg1_=;__ddg2_=;" } },
        )

        const html = await req.text()

        function pushData(data: EpisodeData[]) {
            for (const item of data) {
                episodes.push({
                    id: item.session + "$" + id,
                    number: item.episode,
                    title: item.title && item.title.length > 0 ? item.title : "Episode " + item.episode,
                    url: req.url,
                })
            }
        }

        const $ = LoadDoc(html)
        const tempId = $("head > meta[property='og:url']").attr("content")!.split("/").pop()!

        const { last_page, data } = (await (
            await fetch(`${this.api}/api?m=release&id=${tempId}&sort=episode_asc&page=1`, {
                headers: { Cookie: "__ddg1_=;__ddg2_=;" },
            })
        ).json()) as { last_page: number; data: EpisodeData[] }

        pushData(data)

        const pageNumbers = Array.from({ length: last_page - 1 }, (_, i) => i + 2)
        const results = (await Promise.all(
            pageNumbers.map((pageNumber) =>
                fetch(`${this.api}/api?m=release&id=${tempId}&sort=episode_asc&page=${pageNumber}`, {
                    headers: { Cookie: "__ddg1_=;__ddg2_=;" },
                }).then((res) => res.json()),
            )
        )) as { data: EpisodeData[] }[]

        results.forEach((showData) => {
            for (const data of showData.data) {
                if (data) pushData([data])
            }
        })

        episodes.sort((a, b) => a.number - b.number)

        if (episodes.length === 0) throw new Error("No episodes found.")

        const lowest = episodes[0].number
        if (lowest > 1) {
            for (let i = 0; i < episodes.length; i++) {
                episodes[i].number = episodes[i].number - lowest + 1
            }
        }

        episodes = episodes.filter((episode) => Number.isInteger(episode.number))

        // Fetch the play page for the first episode to extract button labels,
        // then encode them into every episode ID so findEpisodeServer can use them
        // without an extra fetch. Format:
        //   {episodeSession}${animeId}${label0|label1|...}
        try {
            const firstEp = episodes[0]
            const firstEpisodeId = firstEp.id.split("$")[0]
            const firstAnimeId = firstEp.id.split("$")[1]

            const playReq = await fetch(
                `${this.api}/play/${firstAnimeId}/${firstEpisodeId}`,
                { headers: { Cookie: "__ddg1_=;__ddg2_=;" } },
            )
            const playHtml = await playReq.text()
            const $play = LoadDoc(playHtml)

            const labels: string[] = []
            $play("button[data-src]").each((_, el) => {
                const fansub = $play(el).attr("data-fansub") ?? ""
                const quality = $play(el).attr("data-resolution") ?? ""
                const isEng = $play(el).attr("data-audio") === "eng"
                const label = `${quality}p ${fansub}${isEng ? " Eng" : ""}`.trim()
                labels.push(label)
            })

            if (labels.length > 0) {
                const encodedLabels = labels.join("|")
                episodes = episodes.map((ep) => ({
                    ...ep,
                    id: ep.id + "$" + encodedLabels,
                }))
            }
        } catch (_) {
            // If label fetch fails, fall back to Kwik N / Pahe N slot names
        }

        return episodes
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const parts = episode.id.split("$")
        const episodeId = parts[0]
        const animeId = parts[1]
        // parts[2] is the encoded labels string (may be undefined if fetch failed)
        const encodedLabels = parts[2] ?? ""
        const labels = encodedLabels.length > 0 ? encodedLabels.split("|") : []

        const isPahe = server.startsWith("Pahe")
        const slotIndex = parseInt(server.split(" ")[1]) - 1

        // Build a reverse map from real label -> slot index so we can match
        // e.g. "1080p HorribleSubs" -> 0
        const labelToIndex: Record<string, number> = {}
        labels.forEach((lbl, i) => { labelToIndex[lbl] = i })

        // If server matches a real label directly, use that index instead
        const resolvedIndex = server in labelToIndex ? labelToIndex[server] : slotIndex

        const req = await fetch(
            `${this.api}/play/${animeId}/${episodeId}`,
            { headers: { Cookie: "__ddg1_=;__ddg2_=;" } },
        )

        const html = await req.text()
        const regex = /https:\/\/kwik\.cx\/e\/\w+/g
        const matches = html.match(regex)

        if (matches === null) throw new Error("Failed to fetch episode server.")

        const $ = LoadDoc(html)
        const buttons = $("button[data-src]")

        if (resolvedIndex >= buttons.length) {
            throw new Error(`Slot ${server} not available for this episode.`)
        }

        const el = buttons.eq(resolvedIndex)
        const kwikEmbedUrl = el.attr("data-src")!

        const fansub = el.attr("data-fansub") ?? ""
        const quality = el.attr("data-resolution") ?? ""
        const isEng = el.attr("data-audio") === "eng"
        const sourceLabel = `${quality}p ${fansub}${isEng ? " Eng" : ""}`.trim()

        // Original Kwik extraction logic
        const src_req = await fetch(kwikEmbedUrl, {
            headers: {
                Referer: this.headers.Referer,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
            },
        })

        const src_html = await src_req.text()
        const scripts = src_html.match(/eval\(f.+?\}\)\)/g)
        if (!scripts) throw new Error("Failed to fetch episode server.")

        for (const _script of scripts) {
            const scriptMatch = _script.match(/eval(.+)/)
            if (!scriptMatch || !scriptMatch[1]) continue

            try {
                const decoded = eval(scriptMatch[1])
                const linkMatch = decoded.match(/source='(.+?)'/)
                if (linkMatch && linkMatch[1]) {
                    const m3u8Url = linkMatch[1]

                    if (isPahe) {
                        return {
                            videoSources: [{
                                url: m3u8Url.replace("/stream/", "/mp4/").replace("/uwu.m3u8", ""),
                                type: "mp4",
                                quality: sourceLabel,
                                subtitles: [],
                                headers: { Referer: "https://kwik.cx/e/GP7f5AoOyjyT" },
                            }],
                            headers: { Referer: "https://kwik.cx/e/GP7f5AoOyjyT" },
                            server: sourceLabel,
                        }
                    } else {
                        return {
                            videoSources: [{
                                url: m3u8Url,
                                type: "m3u8",
                                quality: sourceLabel,
                                subtitles: [],
                                headers: { Referer: "https://kwik.cx/e/GP7f5AoOyjyT" },
                            }],
                            headers: { Referer: "https://kwik.cx/e/GP7f5AoOyjyT" },
                            server: sourceLabel,
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to extract link", e)
            }
        }

        throw new Error(`Failed to extract any sources for ${server}.`)
    }
}
