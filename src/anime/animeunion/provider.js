/// <reference path="../online-streaming-provider.d.ts" />

function decodeSvelteKitData(payload) {
  const dataNode = payload?.nodes?.find((node) => node?.type === "data" && Array.isArray(node.data));
  const table = dataNode?.data;
  if (!Array.isArray(table) || !table.length) return null;

  const resolveNode = (value, seen) => {
    if (Array.isArray(value)) return value.map((entry) => resolveRef(entry, seen));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveRef(entry, seen)]));
    }
    return value;
  };

  const resolveRef = (value, seen = new Set()) => {
    if (Number.isInteger(value) && value >= 0 && value < table.length) {
      if (seen.has(value)) return null;
      const nextSeen = new Set(seen);
      nextSeen.add(value);
      return resolveNode(table[value], nextSeen);
    }
    return resolveNode(value, seen);
  };

  return resolveRef(0);
}

function streamType(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".m3u8")) return "m3u8";
    if (path.endsWith(".mp4")) return "mp4";
  } catch {
    // The URL is validated before this helper is called.
  }
  return "unknown";
}

function displayQuality(value) {
  return String(value || "Auto")
    .replace(/^Q_/i, "")
    .replace(/(\d+)P$/i, "$1p");
}

class Provider {
  constructor() {
    this.apiBase = "https://api.animeunion.tv";
    this.siteBase = "https://animeunion.tv";
  }

  getSettings() {
    return {
      episodeServers: ["Sub", "Dub"],
      supportsDub: true,
    };
  }

  async search(options) {
    const query = String(options?.query || "").trim();
    if (!query) return [];

    const searchUrl = new URL("/api/v1/anime", this.apiBase);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", "8");

    const response = await fetch(searchUrl.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`AnimeUnion search failed (HTTP ${response.status})`);

    const payload = await response.json();
    const results = Array.isArray(payload?.data) ? payload.data : [];
    return results
      .filter((anime) => anime && anime.slug && Number.isInteger(Number(anime.episodeCount)) && Number(anime.episodeCount) > 0)
      .filter((anime) => {
        const languages = Array.isArray(anime.availableLanguages) ? anime.availableLanguages.map((value) => String(value).toUpperCase()) : [];
        return !options?.dub || !languages.length || languages.some((language) => language.startsWith("DUB"));
      })
      .map((anime) => {
        const languages = Array.isArray(anime.availableLanguages) ? anime.availableLanguages.map((value) => String(value).toUpperCase()) : [];
        const hasSub = languages.some((language) => language.startsWith("SUB"));
        const hasDub = languages.some((language) => language.startsWith("DUB"));
        const subOrDub = hasSub && hasDub ? "both" : hasDub ? "dub" : hasSub ? "sub" : "both";
        const slug = String(anime.slug);
        const episodeCount = Number(anime.episodeCount);
        return {
          // Carry episodeCount into findEpisodes without an extra request.
          id: `${slug}|${episodeCount}`,
          title: anime.titleEng || anime.title || anime.titleIta || slug,
          url: `${this.siteBase}/anime/${encodeURIComponent(slug)}`,
          subOrDub,
        };
      });
  }

  async findEpisodes(id) {
    const [slug, countValue] = String(id || "").split("|");
    const episodeCount = Number.parseInt(countValue, 10);
    if (!slug || !/^[\w-]+$/.test(slug) || !Number.isInteger(episodeCount) || episodeCount < 1) return [];

    const encodedSlug = encodeURIComponent(slug);
    return Array.from({ length: episodeCount }, (_, index) => {
      const number = index + 1;
      return {
        id: `${slug}|${number}`,
        number,
        title: `Episode ${number}`,
        url: `${this.siteBase}/anime/${encodedSlug}/${number}/__data.json?x-sveltekit-invalidated=01`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    const response = await fetch(episode.url, {
      headers: {
        Accept: "application/json",
        Referer: this.siteBase + "/",
      },
    });
    if (!response.ok) throw new Error(`AnimeUnion episode request failed (HTTP ${response.status})`);

    const page = decodeSvelteKitData(await response.json());
    const links = page?.episode?.streamLinks;
    if (!Array.isArray(links)) throw new Error("AnimeUnion did not provide stream links for this episode.");

    const isDub = /dub/i.test(String(server || ""));
    const languagePrefix = isDub ? "DUB" : "SUB";
    const playbackHeaders = {
      Origin: this.siteBase,
      Referer: `${this.siteBase}/`,
    };
    const videoSources = links
      .filter((link) => link && link.isActive !== false && String(link.language || "").toUpperCase().startsWith(languagePrefix))
      .map((link) => {
        let url;
        try {
          url = new URL(link.url);
          if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        } catch {
          return null;
        }
        const quality = displayQuality(link.quality);
        return {
          url: url.toString(),
          type: streamType(url.toString()),
          quality,
          label: `${quality} · ${link.language}`,
          headers: { ...playbackHeaders },
          subtitles: [],
        };
      })
      .filter(Boolean);

    if (!videoSources.length) throw new Error(`AnimeUnion has no active ${isDub ? "dub" : "sub"} stream for this episode.`);

    return {
      server: isDub ? "Dub" : "Sub",
      headers: playbackHeaders,
      videoSources,
    };
  }
}
