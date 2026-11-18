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

    const fetchPage = async (page) => {
      const searchUrl = new URL("/api/v1/anime", this.apiBase);
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("limit", "8");
      searchUrl.searchParams.set("page", String(page));
      const response = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`AnimeUnion search failed on page ${page} (HTTP ${response.status})`);
      return response.json();
    };

    const firstPage = await fetchPage(1);
    const results = Array.isArray(firstPage?.data) ? [...firstPage.data] : [];
    const reportedPages = Number(firstPage?.meta?.totalPages);
    const totalPages = Number.isInteger(reportedPages) && reportedPages > 1 ? Math.min(reportedPages, 1000) : 1;
    for (let start = 2; start <= totalPages; start += 4) {
      const pageNumbers = Array.from({ length: Math.min(4, totalPages - start + 1) }, (_, index) => start + index);
      const pages = await Promise.allSettled(pageNumbers.map(fetchPage));
      for (const [index, page] of pages.entries()) {
        if (page.status === "fulfilled" && Array.isArray(page.value?.data)) {
          results.push(...page.value.data);
        } else if (page.status === "rejected") {
          console.error(`[Union] Failed to fetch search page ${pageNumbers[index]}`, page.reason);
        }
      }
    }

    const uniqueResults = Array.from(new Map(results.filter((anime) => anime?.slug).map((anime) => [String(anime.slug), anime])).values());
    return uniqueResults
      .filter((anime) => anime && anime.slug)
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
        return {
          // Keep the stable slug in the anime ID; episode totals can be unknown or stale.
          id: slug,
          title: anime.titleEng || anime.title || anime.titleIta || slug,
          image: anime.coverImage || anime.bannerImage,
          url: `${this.siteBase}/anime/${encodeURIComponent(slug)}`,
          subOrDub,
        };
      });
  }

  async findEpisodes(id) {
    const [slug, countValue] = String(id || "").split("|");
    if (!slug || !/^[\w-]+$/.test(slug)) return [];

    const legacyCount = Number.parseInt(countValue || "", 10);
    const encodedSlug = encodeURIComponent(slug);
    const animePageUrl = `${this.siteBase}/anime/${encodedSlug}/__data.json?x-sveltekit-invalidated=01`;
    let episodeRows = [];
    try {
      const response = await fetch(animePageUrl, {
        headers: { Accept: "application/json", Referer: `${this.siteBase}/` },
      });
      if (!response.ok) throw new Error(`AnimeUnion anime request failed (HTTP ${response.status})`);
      const animePage = decodeSvelteKitData(await response.json());
      const episodes = animePage?.episodes;
      episodeRows = Array.isArray(episodes) ? episodes : Array.isArray(episodes?.data) ? episodes.data : [];
    } catch (error) {
      console.error(`[Union] Could not load episode list for ${slug}`, error);
    }

    const numbers = episodeRows
      .map((episode, index) => Number(episode?.number) || index + 1)
      .filter((number) => Number.isInteger(number) && number > 0);
    const count = numbers.length || (Number.isInteger(legacyCount) && legacyCount > 0 ? legacyCount : 0);
    const episodeNumbers = numbers.length
      ? Array.from(new Set(numbers)).sort((a, b) => a - b)
      : Array.from({ length: count }, (_, index) => index + 1);

    return episodeNumbers.map((number) => ({
      id: `${slug}|${number}`,
      number,
      title: `Episode ${number}`,
      url: `${this.siteBase}/anime/${encodedSlug}/${number}/__data.json?x-sveltekit-invalidated=01`,
    }));
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
