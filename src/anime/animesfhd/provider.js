/// <reference path="../online-streaming-provider.d.ts" />
/// <reference path="../../core.d.ts" />

class Provider {
  constructor() {
    this.api = "https://animesfhd.net";
    this.headers = {
      "Referer": `${this.api}/`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    };
    this.lastRequest = 0;
    this.details = new Map();
  }
  getSettings() {
    return { episodeServers: ["AnimesFHD"], supportsDub: true };
  }
  async search(opts) {
    var _a, _b, _c;
    const query = opts.query.trim();
    if (!query) return [];
    const results = [];
    const seenSeries = new Set();
    const seenVersions = new Set();
    const audio = opts.dub ? "dublado" : "legendado";
    {
      const res = await this.request(`${this.api}/api/series?pagination=1&page=1&per_page=24&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!Array.isArray(data.series)) throw new Error("AnimesFHD: resposta de busca inv\xE1lida");
      for (const item of data.series) {
        const id = String(item.id);
        if (seenSeries.has(id)) continue;
        if (seenSeries.size >= 8) break;
        seenSeries.add(id);
        const detail = await this.seriesDetail(id);
        const versions = ((_a = detail.versions) == null ? void 0 : _a.length) ? detail.versions : [{
          series_id: detail.series.id,
          title: detail.series.title,
          audio: ((_b = detail.seo) == null ? void 0 : _b.audio) || detail.series.category || ""
        }];
        const primarySeason = ((_c = versions.find((v) => String(v.series_id) === String(detail.series.id))) == null ? void 0 : _c.season) || 1;
        const sameTitleIds = versions.filter((v) => v.audio === audio && v.title === detail.series.title).sort((a, b) => (a.season || 0) - (b.season || 0) || (a.part || 0) - (b.part || 0)).map((v) => String(v.series_id));
        for (const version of versions) {
          const versionId = String(version.series_id);
          if (version.audio !== audio || seenVersions.has(versionId)) continue;
          seenVersions.add(versionId);
          const sameTitle = version.title === detail.series.title;
          const synonyms = sameTitle ? (detail.series.alt_titles || item.alt_titles || "").split(/[\n\r]+/).map((t) => t.trim()).filter(Boolean) : [];
          let title = version.title;
          if (sameTitle && (version.season || 1) !== primarySeason) {
            const n = version.season || 1, ordinal = n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
            title += ` Season ${n}`;
            synonyms.length = 0;
            synonyms.push(`${version.title} ${ordinal} Season`, `${version.title} - ${version.season_label || `Temporada ${n}`}`);
          }
          const isPrimary = sameTitle && (version.season || 1) === primarySeason;
          results.push({
            id: isPrimary && sameTitleIds.length > 1 ? `all:${[versionId, ...sameTitleIds.filter((v) => v !== versionId)].join(",")}` : versionId,
            title,
            url: `${this.api}/serie/${versionId}`,
            subOrDub: opts.dub ? "dub" : "sub",
            image: item.cover_image,
            synonyms
          });
        }
      }
    }
    return results;
  }
  async findEpisodes(id) {
    var _a, _b;
    if (!id.startsWith("all:")) return (await this.seasonEpisodes(id, false)).episodes;
    const [first, ...rest] = id.slice(4).split(",").filter(Boolean);
    const head = await this.seasonEpisodes(first, true);
    if (!((_a = head.mal) == null ? void 0 : _a.id)) return head.episodes;
    const all = [...head.episodes];
    const used = new Set(all.map((e) => e.number));
    for (const versionId of rest) {
      const season = await this.seasonEpisodes(versionId, true);
      if (((_b = season.mal) == null ? void 0 : _b.id) !== head.mal.id) continue;
      for (const episode of season.episodes) if (!used.has(episode.number)) {
        used.add(episode.number);
        all.push(episode);
      }
    }
    return all.sort((a, b) => b.number - a.number);
  }
  // Episódios de uma ficha. absolute=true soma o episode_offset do MAL (temporadas de uma entrada só).
  async seasonEpisodes(id, absolute) {
    var _a;
    const episodes = [];
    const seen = new Set();
    let mal = null;
    for (let page = 1; page <= 100; page++) {
      const res = await this.request(`${this.api}/api/series/${encodeURIComponent(id)}?page=${page}&per_page=200`);
      const data = await res.json();
      if (!Array.isArray(data.episodes)) throw new Error("AnimesFHD: resposta de epis\xF3dios inv\xE1lida");
      if (page === 1) mal = data.mal || null;
      const offset = absolute && (mal == null ? void 0 : mal.id) ? Number(mal.episode_offset) || 0 : 0;
      let added = 0;
      for (const item of data.episodes) {
        const episodeId = String(item.id);
        if (seen.has(episodeId)) continue;
        seen.add(episodeId);
        added++;
        if (item.episode_number == null || String(item.episode_number).trim() === "") continue;
        const number = Number(item.episode_number);
        if (!Number.isInteger(number) || number < 0) continue;
        episodes.push({
          id: episodeId,
          number: number + offset,
          title: ((_a = item.title) == null ? void 0 : _a.trim()) || `Epis\xF3dio ${number}`,
          url: `${this.api}/episod/${episodeId}`
        });
      }
      if (!data.has_more) return { episodes: episodes.sort((a, b) => b.number - a.number), mal };
      if (!added) throw new Error("AnimesFHD: pagina\xE7\xE3o de epis\xF3dios n\xE3o avan\xE7ou");
    }
    throw new Error("AnimesFHD: limite de pagina\xE7\xE3o de epis\xF3dios excedido");
  }
  async findEpisodeServer(episode, _server) {
    var _a, _b, _c;
    const res = await this.request(`${this.api}/api/episodes/${encodeURIComponent(episode.id)}`);
    const data = await res.json();
    if (!Array.isArray(data.sources)) throw new Error("AnimesFHD: resposta de fontes inv\xE1lida");
    const result = { server: "AnimesFHD", headers: this.headers, videoSources: [] };
    const seen = new Set();
    const qualities = new Set();
    for (const source of data.sources) {
      if (!source.native_video || source.kind === "embed" || !((_a = source.url) == null ? void 0 : _a.trim())) continue;
      try {
        let url = this.absolute(source.url);
        if (seen.has(url)) continue;
        seen.add(url);
        let type = source.media_kind === "s6" ? "m3u8" : this.videoType(url);
        if (type === "unknown") {
          const video = await this.request(url, "GET", "manual");
          const location = this.header(video, "location");
          if (video.status >= 300 && video.status < 400) {
            if (!location) throw new Error("AnimesFHD: redirecionamento sem destino");
            url = this.absolute(location);
            type = this.videoType(url);
            if (type === "unknown") {
              const target = await this.request(url, "HEAD");
              url = this.absolute(target.url || url);
              type = this.videoType(url, this.header(target, "content-type") || "");
            }
          } else {
            type = this.videoType(url, this.header(video, "content-type") || "");
          }
        }
        const subtitle = source.subtitle_url || ((_b = data.episode) == null ? void 0 : _b.subtitle_url);
        const label = ((_c = source.label) == null ? void 0 : _c.trim()) || "Player";
        const audio = source.audio === "dublado" ? "Dublado" : source.audio === "legendado" ? "Legendado" : "";
        const baseQuality = audio ? `${label} - ${audio}` : label;
        let quality = baseQuality;
        for (let suffix = 2; qualities.has(quality); suffix++) quality = `${baseQuality} (${suffix})`;
        qualities.add(quality);
        result.videoSources.push({
          url,
          type,
          quality,
          subtitles: subtitle ? [{ id: `${source.id}-pt-BR`, url: this.absolute(subtitle), language: "pt-BR", isDefault: true }] : []
        });
      } catch (error) {
        console.error(`AnimesFHD: falha na fonte ${source.id}`, error);
      }
    }
    if (!result.videoSources.length) throw new Error("AnimesFHD: nenhum v\xEDdeo nativo dispon\xEDvel");
    return result;
  }
  async seriesDetail(id) {
    const cached = this.details.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;
    const res = await this.request(`${this.api}/api/series/${encodeURIComponent(id)}?page=1&per_page=1`);
    const data = await res.json();
    if (!data.series) throw new Error("AnimesFHD: obra inv\xE1lida");
    this.details.set(id, { data, expires: Date.now() + 6e4 });
    return data;
  }
  async request(url, method = "GET", redirect = "follow") {
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = 500 - (Date.now() - this.lastRequest);
      if (wait > 0) await $sleep(wait);
      this.lastRequest = Date.now();
      const res = await fetch(url, { method, headers: this.headers, redirect });
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(this.header(res, "retry-after"));
        await $sleep(Math.min(3e4, Math.max(1e3, (retryAfter || 1) * 1e3)));
        continue;
      }
      if (!res.ok && !(redirect === "manual" && res.status >= 300 && res.status < 400)) {
        throw new Error(`AnimesFHD: HTTP ${res.status}`);
      }
      return res;
    }
    throw new Error("AnimesFHD: limite de requisi\xE7\xF5es atingido");
  }
  // O fetch do Seanime devolve os cabeçalhos como objeto simples com nomes no formato do Go
  // ("Location", "Content-Type"), sem .get(); o fetch padrão devolve Headers. Aceita os dois.
  header(res, name) {
    var _a;
    const headers = res.headers;
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || "";
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) if (key.toLowerCase() === wanted) return String((_a = headers[key]) != null ? _a : "");
    return "";
  }
  absolute(url) {
    const value = url.trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("/")) return `${this.api}${value}`;
    throw new Error("AnimesFHD: URL de m\xEDdia inv\xE1lida");
  }
  videoType(url, contentType = "") {
    if (/\.m3u8(?:$|[?&#])/i.test(url) || /mpegurl/i.test(contentType)) return "m3u8";
    if (/\.mp4(?:$|[?&#])/i.test(url) || /video\/mp4/i.test(contentType)) return "mp4";
    return "unknown";
  }
}
