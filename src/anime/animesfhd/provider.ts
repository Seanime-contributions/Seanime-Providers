/// <reference path="../online-streaming-provider.d.ts" />
/// <reference path="../../core.d.ts" />

type FHDSeries = {
    id: number | string
    title: string
    alt_titles?: string
    cover_image?: string
    category?: string
}

type FHDVersion = {
    series_id: number | string
    title: string
    season?: number
    season_label?: string
    audio: string
}

type FHDSeriesDetail = {
    series: FHDSeries
    versions?: FHDVersion[]
    seo?: { audio?: string }
    episodes: { id: number | string, episode_number: number | string | null, title?: string }[]
    has_more: boolean
}

type FHDSource = {
    id: number | string
    url: string
    native_video: boolean
    kind?: string
    media_kind?: string
    label?: string
    audio?: string
    subtitle_url?: string
}

class Provider {
    api = "https://animesfhd.net"
    headers = {
        "Referer": `${this.api}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }
    private lastRequest = 0
    private details = new Map<string, { data: FHDSeriesDetail, expires: number }>()

    getSettings(): Settings {
        return { episodeServers: ["AnimesFHD"], supportsDub: true }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = opts.query.trim()
        if (!query) return []

        // O Seanime já chama search para cada sinônimo do AniList.
        const results: (SearchResult & { synonyms: string[], image?: string })[] = []
        const seenSeries = new Set<string>()
        const seenVersions = new Set<string>()
        const audio = opts.dub ? "dublado" : "legendado"

        // Limite de tráfego: uma página de busca e no máximo 8 fichas abertas
        // por chamada (o Seanime já repete a busca para cada sinônimo).
        {
            const res = await this.request(`${this.api}/api/series?pagination=1&page=1&per_page=24&q=${encodeURIComponent(query)}`)
            const data = await res.json() as { series: FHDSeries[], has_more: boolean }
            if (!Array.isArray(data.series)) throw new Error("AnimesFHD: resposta de busca inválida")

            for (const item of data.series) {
                const id = String(item.id)
                if (seenSeries.has(id)) continue
                if (seenSeries.size >= 8) break
                seenSeries.add(id)

                const detail = await this.seriesDetail(id)
                // category pode ser 'filme': o áudio vem da versão ou do SEO.
                const versions: FHDVersion[] = detail.versions?.length ? detail.versions : [{
                    series_id: detail.series.id,
                    title: detail.series.title,
                    audio: detail.seo?.audio || detail.series.category || "",
                }]
                const primarySeason = versions.find(v => String(v.series_id) === String(detail.series.id))?.season || 1
                for (const version of versions) {
                    const versionId = String(version.series_id)
                    if (version.audio !== audio || seenVersions.has(versionId)) continue
                    seenVersions.add(versionId)
                    // Não atribuir os aliases da temporada principal às outras temporadas.
                    const sameTitle = version.title === detail.series.title
                    const synonyms = sameTitle ? (detail.series.alt_titles || item.alt_titles || "").split(/[\n\r]+/).map(t => t.trim()).filter(Boolean) : []
                    let title = version.title
                    if (sameTitle && (version.season || 1) !== primarySeason) {
                        title += ` - ${version.season_label || `Temporada ${version.season}`}`
                        synonyms.length = 0
                    }
                    results.push({
                        id: versionId,
                        title,
                        url: `${this.api}/serie/${versionId}`,
                        subOrDub: opts.dub ? "dub" : "sub",
                        image: item.cover_image,
                        synonyms,
                    })
                }
            }
        }
        return results
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const episodes: EpisodeDetails[] = []
        const seen = new Set<string>()
        for (let page = 1; page <= 100; page++) {
            const res = await this.request(`${this.api}/api/series/${encodeURIComponent(id)}?page=${page}&per_page=200`)
            const data = await res.json() as FHDSeriesDetail
            if (!Array.isArray(data.episodes)) throw new Error("AnimesFHD: resposta de episódios inválida")
            let added = 0
            for (const item of data.episodes) {
                const episodeId = String(item.id)
                if (seen.has(episodeId)) continue
                seen.add(episodeId)
                added++
                // Não arredondar especiais (7.5) nem transformar null em episódio 0.
                if (item.episode_number == null || String(item.episode_number).trim() === "") continue
                const number = Number(item.episode_number)
                if (!Number.isInteger(number) || number < 0) continue
                episodes.push({
                    id: episodeId,
                    number,
                    title: item.title?.trim() || `Episódio ${number}`,
                    url: `${this.api}/episod/${episodeId}`,
                })
            }
            if (!data.has_more) return episodes.sort((a, b) => b.number - a.number)
            if (!added) throw new Error("AnimesFHD: paginação de episódios não avançou")
        }
        throw new Error("AnimesFHD: limite de paginação de episódios excedido")
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const res = await this.request(`${this.api}/api/episodes/${encodeURIComponent(episode.id)}`)
        const data = await res.json() as { episode: { subtitle_url?: string }, sources: FHDSource[] }
        if (!Array.isArray(data.sources)) throw new Error("AnimesFHD: resposta de fontes inválida")
        const result: EpisodeServer = { server: "AnimesFHD", headers: this.headers, videoSources: [] }
        const seen = new Set<string>()
        const qualities = new Set<string>()

        for (const source of data.sources) {
            if (!source.native_video || source.kind === "embed" || !source.url?.trim()) continue
            try {
                let url = this.absolute(source.url)
                if (seen.has(url)) continue
                seen.add(url)
                let type = source.media_kind === "s6" ? "m3u8" as VideoSourceType : this.videoType(url)
                if (type === "unknown") {
                    // A API aceita GET, não HEAD. Não seguir o 307 com GET:
                    // o fetch do Seanime pode carregar o vídeo inteiro na memória.
                    const video = await this.request(url, "GET", "manual")
                    const location = video.headers.get("location")
                    if (video.status >= 300 && video.status < 400) {
                        if (!location) throw new Error("AnimesFHD: redirecionamento sem destino")
                        url = this.absolute(location)
                        type = this.videoType(url)
                        if (type === "unknown") {
                            const target = await this.request(url, "HEAD")
                            url = this.absolute(target.url || url)
                            type = this.videoType(url, target.headers.get("content-type") || "")
                        }
                    } else {
                        type = this.videoType(url, video.headers.get("content-type") || "")
                    }
                }
                const subtitle = source.subtitle_url || data.episode?.subtitle_url
                const label = source.label?.trim() || "Player"
                const audio = source.audio === "dublado" ? "Dublado" : source.audio === "legendado" ? "Legendado" : ""
                const baseQuality = audio ? `${label} - ${audio}` : label
                let quality = baseQuality
                for (let suffix = 2; qualities.has(quality); suffix++) quality = `${baseQuality} (${suffix})`
                qualities.add(quality)
                result.videoSources.push({
                    url,
                    type,
                    quality,
                    subtitles: subtitle ? [{ id: `${source.id}-pt-BR`, url: this.absolute(subtitle), language: "pt-BR", isDefault: true }] : [],
                })
            } catch (error) {
                console.error(`AnimesFHD: falha na fonte ${source.id}`, error)
            }
        }
        if (!result.videoSources.length) throw new Error("AnimesFHD: nenhum vídeo nativo disponível")
        return result
    }

    private async seriesDetail(id: string): Promise<FHDSeriesDetail> {
        const cached = this.details.get(id)
        if (cached && cached.expires > Date.now()) return cached.data
        const res = await this.request(`${this.api}/api/series/${encodeURIComponent(id)}?page=1&per_page=1`)
        const data = await res.json() as FHDSeriesDetail
        if (!data.series) throw new Error("AnimesFHD: obra inválida")
        this.details.set(id, { data, expires: Date.now() + 60000 })
        return data
    }

    private async request(url: string, method = "GET", redirect: "follow" | "manual" = "follow") {
        for (let attempt = 0; attempt < 2; attempt++) {
            const wait = 500 - (Date.now() - this.lastRequest)
            if (wait > 0) await $sleep(wait)
            this.lastRequest = Date.now()
            const res = await fetch(url, { method, headers: this.headers, redirect })
            if (res.status === 429 && attempt === 0) {
                const retryAfter = Number(res.headers.get("retry-after"))
                await $sleep(Math.min(30000, Math.max(1000, (retryAfter || 1) * 1000)))
                continue
            }
            if (!res.ok && !(redirect === "manual" && res.status >= 300 && res.status < 400)) {
                throw new Error(`AnimesFHD: HTTP ${res.status}`)
            }
            return res
        }
        throw new Error("AnimesFHD: limite de requisições atingido")
    }

    private absolute(url: string): string {
        const value = url.trim()
        if (/^https?:\/\//i.test(value)) return value
        if (value.startsWith("//")) return `https:${value}`
        if (value.startsWith("/")) return `${this.api}${value}`
        throw new Error("AnimesFHD: URL de mídia inválida")
    }

    private videoType(url: string, contentType = ""): VideoSourceType {
        if (/\.m3u8(?:$|[?&#])/i.test(url) || /mpegurl/i.test(contentType)) return "m3u8"
        if (/\.mp4(?:$|[?&#])/i.test(url) || /video\/mp4/i.test(contentType)) return "mp4"
        return "unknown"
    }
}
