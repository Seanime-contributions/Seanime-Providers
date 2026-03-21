/// <reference path="../goja_onlinestream_test/onlinestream-provider.d.ts" />
/// <reference path="../goja_plugin_types/core.d.ts" />

type EpisodeData = {
    id: number; episode: number; title: string; snapshot: string; filler: number; session: string; created_at?: string
}

type AnimeData = {
    id: number; title: string; type: string; year: number; poster: string; session: string
}

class Provider {

    api = "https://animepahe.si"
    headers = { Referer: "https://kwik.cx" }

    getSettings(): Settings {
        return {
            episodeServers: ["Kwik", "Pahe"],
            supportsDub: false,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const req = await fetch(`${this.api}/api?m=search&q=${encodeURIComponent(opts.query)}`, {
            headers: {
                Cookie: "__ddg1_=;__ddg2_=;",
            },
        })

        if (!req.ok) {
            return []
        }
        const data = (await req.json()) as { data: AnimeData[] }
        const results: SearchResult[] = []

        if (!data?.data) {
            return []
        }

        data.data.map((item: AnimeData) => {
            results.push({
                subOrDub: "sub",
                id: item.session,
                title: item.title,
                url: "",
            })
        })

        return results
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        let episodes: EpisodeDetails[] = []

        const req =
            await fetch(
                `${this.api}${id.includes("-") ? `/anime/${id}` : `/a/${id}`}`,
                {
                    headers: {
                        Cookie: "__ddg1_=;__ddg2_=;",
                    },
                },
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
                headers: {
                    Cookie: "__ddg1_=;__ddg2_=;",
                },
            })
        ).json()) as {
            last_page: number;
            data: EpisodeData[]
        }

        pushData(data)

        const pageNumbers = Array.from({ length: last_page - 1 }, (_, i) => i + 2)

        const promises = pageNumbers.map((pageNumber) =>
            fetch(`${this.api}/api?m=release&id=${tempId}&sort=episode_asc&page=${pageNumber}`, {
                headers: {
                    Cookie: "__ddg1_=;__ddg2_=;",
                },
            }).then((res) => res.json()),
        )
        const results = (await Promise.all(promises)) as {
            data: EpisodeData[]
        }[]

        results.forEach((showData) => {
            for (const data of showData.data) {
                if (data) {
                    pushData([data])
                }
            }
        });

        episodes.sort((a, b) => a.number - b.number)

        if (episodes.length === 0) {
            throw new Error("No episodes found.")
        }


        const lowest = episodes[0].number
        if (lowest > 1) {
            for (let i = 0; i < episodes.length; i++) {
                episodes[i].number = episodes[i].number - lowest + 1
            }
        }

        episodes = episodes.filter((episode) => Number.isInteger(episode.number))

        return episodes
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const episodeId = episode.id.split("$")[0]
        const animeId = episode.id.split("$")[1]

        const req = await fetch(
            `${this.api}/play/${animeId}/${episodeId}`,
            {
                headers: {
                    Cookie: "__ddg1_=;__ddg2_=;",
                },
            },
        )

        const html = await req.text()
        const regex = /https:\/\/kwik\.cx\/e\/\w+/g
        const matches = html.match(regex)

        if (matches === null) {
            throw new Error("Failed to fetch episode server.")
        }

        const $ = LoadDoc(html)

        const result: EpisodeServer = {
            videoSources: [],
            headers: this.headers ?? {},
            server: server, // Dynamically sets to "Kwik" or "Pahe" based on call
        }

        const sourcePromises = $("button[data-src]").map(async (_, el): Promise<VideoSource | null> => {
            let kwikEmbedUrl = el.data("src")!
            if (!kwikEmbedUrl) return null

            const fansub = el.data("fansub")!
            const quality = el.data("resolution")!
            let label = `${quality}p - ${fansub}`
            if (el.data("audio") === "eng") label += " (Eng)"
            if (kwikEmbedUrl === matches[0]) label += " (default)"

            try {
                const src_req = await fetch(kwikEmbedUrl, {
                    headers: {
                        Referer: this.headers.Referer,
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
                    },
                })

                const src_html = await src_req.text()
                const scripts = src_html.match(/eval\(f.+?\}\)\)/g)
                if (!scripts) return null

                for (const _script of scripts) {
                    const scriptMatch = _script.match(/eval(.+)/)
                    if (!scriptMatch || !scriptMatch[1]) continue

                    try {
                        const decoded = eval(scriptMatch[1])
                        const linkMatch = decoded.match(/source='(.+?)'/)
                        if (linkMatch && linkMatch[1]) {
                            const m3u8Url = linkMatch[1]

                            if (server === "Pahe") {
                                // Transform: vault-XX.owocdn.top/stream/PATH/uwu.m3u8 -> vault-XX.kwik.cx/mp4/PATH
                                const paheUrl = m3u8Url
                                    .replace("owocdn.top", "kwik.cx")
                                    .replace("/stream/", "/mp4/")
                                    .replace("/uwu.m3u8", "");
                                
                                return {
                                    url: paheUrl,
                                    type: "mp4",
                                    quality: label,
                                    subtitles: []
                                }
                            } else {
                                // Default Kwik logic (m3u8)
                                return {
                                    url: m3u8Url,
                                    type: "m3u8",
                                    quality: label,
                                    subtitles: []
                                }
                            }
                        }
                    } catch (e) {
                        console.error("Failed to extract link", e)
                    }
                }
                return null
            } catch (e) {
                return null
            }
        })

        const resolvedSources = await Promise.all(sourcePromises)
        result.videoSources = resolvedSources.filter((source): source is VideoSource => source !== null)

        if (result.videoSources.length === 0) {
            throw new Error(`Failed to extract any sources for ${server}.`)
        }

        return result
    }
}
