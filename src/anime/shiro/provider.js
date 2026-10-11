class Provider {
  constructor() {
    this.anilistUrl = "https://graphql.anilist.co";
    this.shiroBase = "https://shiro.so";
    this.userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
  }

  getSettings() {
    return {
      episodeServers: ["Sub", "Dub"],
      supportsDub: true,
    };
  }

  async search(opts) {
    const query = `
      query ($search: String) {
        Page(perPage: 25) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
          }
        }
      }
    `;
    const data = await this.anilistRequest(query, { search: opts.query });
    return (data?.data?.Page?.media || []).map(media => ({
      id: String(media.id),
      title: media.title?.english || media.title?.romaji || media.title?.native || String(media.id),
      url: "",
      subOrDub: "both",
    }));
  }

  async findEpisodes(id) {
    const mediaId = Number.parseInt(String(id), 10);
    if (!Number.isFinite(mediaId)) return [];

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english native }
          episodes
          nextAiringEpisode { episode }
        }
      }
    `;
    const data = await this.anilistRequest(query, { id: mediaId });
    const media = data?.data?.Media;
    const knownCount = Number(media?.episodes);
    // AniList leaves `episodes` null for some ongoing series. In that case,
    // the next airing episode gives us the number of episodes released so far.
    const nextAiringEpisode = Number(media?.nextAiringEpisode?.episode);
    const count = Number.isInteger(knownCount) && knownCount > 0
      ? knownCount
      : Number.isInteger(nextAiringEpisode) && nextAiringEpisode > 1
        ? nextAiringEpisode - 1
        : 0;
    if (!media || !Number.isInteger(count) || count <= 0) return [];

    const title = media.title?.english || media.title?.romaji || media.title?.native || String(mediaId);
    const slug = this.slugify(title);
    return Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        id: `${mediaId}:${number}:${slug}`,
        number,
        title: `Episode ${number}`,
        url: `${this.shiroBase}/anime/${mediaId}-${slug}/${number}`,
      };
    });
  }

  async findEpisodeServer(episode, server) {
    const parsed = this.parseEpisodeId(episode.id);
    if (!parsed) throw new Error("Invalid Shiro episode ID");

    const selectedServer = this.normalizeServer(server);
    if (!selectedServer) throw new Error(`Unsupported Shiro server: ${server}`);

    const watchUrl = `${this.shiroBase}/anime/${parsed.mediaId}-${parsed.slug}/${parsed.number}`;
    console.log(`[Shiro] Resolving ${selectedServer} episode: AniList ${parsed.mediaId}, episode ${parsed.number}`);
    console.log(`[Shiro] Watch URL: ${watchUrl}`);
    const pageResponse = await this.request(watchUrl, { method: "HEAD" });
    console.log(`[Shiro] Watch-page response: ${pageResponse.status} ${pageResponse.statusText || ""}`.trim());
    console.log(`[Shiro] Watch-page raw header keys: ${Object.keys(pageResponse.rawHeaders || {}).join(", ") || "none"}`);
    console.log(`[Shiro] Watch-page cookie keys: ${Object.keys(pageResponse.cookies || {}).join(", ") || "none"}`);
    console.log(`[Shiro] set-cookie header available: ${this.getSetCookieHeader(pageResponse) ? "yes" : "no"}`);
    let cookie = this.extractCookie(pageResponse);
    if (!cookie) {
      console.log("[Shiro] HTTP response did not expose a watch cookie; using ChromeDP fallback");
      cookie = await this.getCookieWithBrowser(watchUrl);
    }
    console.log(`[Shiro] Watch cookie extracted: ${cookie ? "yes" : "no"}`);
    if (!cookie) throw new Error("Shiro watch cookie was not returned");

    console.log(`[Shiro] Requesting episode API for AniList ${parsed.mediaId}, episode ${parsed.number}`);
    const response = await this.request(`${this.shiroBase}/api/episode`, {
      allowHttpError: true,
      method: "POST",
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: this.shiroBase,
        Pragma: "no-cache",
        Referer: watchUrl,
        "Sec-CH-UA": '"Chromium";v="137", "Not/A)Brand";v="24"',
        "Sec-CH-UA-Mobile": "?1",
        "Sec-CH-UA-Platform": '"Android"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ anilistId: parsed.mediaId, episode: parsed.number }),
    });
    console.log(`[Shiro] Episode API response: ${response.status} ${response.statusText || ""}`.trim());
    if (!response.ok) {
      const errorBody = await response.text();
      console.log(`[Shiro] Episode API error body: ${errorBody.slice(0, 500) || "empty"}`);
      throw new Error(`Shiro episode API returned HTTP ${response.status}`);
    }
    const data = await response.json();
    console.log(`[Shiro] Episode API status: ${data?.status || "missing"}; variants: ${Array.isArray(data?.variants) ? data.variants.length : 0}`);
    if (data?.status !== "ready") throw new Error(`Shiro episode is not ready: ${data?.status || "unknown"}`);

    const variants = Array.isArray(data.variants) ? data.variants : [];
    for (const variant of variants) {
      console.log(`[Shiro] Variant ${variant?.label || variant?.id || "unknown"}: ${Array.isArray(variant?.sources) ? variant.sources.length : 0} sources`);
    }

    const variant = variants.find(candidate => this.variantServer(candidate) === selectedServer);
    const source = variant?.sources?.find(candidate => candidate?.url);
    if (!source) throw new Error(`No Shiro ${selectedServer.toLowerCase()} video source found`);

    // Shiro can expose several hosts per language. The selected language gets its
    // first usable host so Sub and Dub remain independent server choices.
    const videoSources = [{
      url: this.absoluteUrl(source.url),
      type: this.sourceType(source.type, source.url),
      quality: source.label || variant.label || "Auto",
      label: variant.label || selectedServer,
      subtitles: (source.tracks || []).filter(track => track.src).map(track => ({
        id: track.id || track.src,
        url: this.absoluteUrl(track.src),
        language: track.language || "und",
        isDefault: Boolean(track.default),
      })),
    }];
    console.log(`[Shiro] Selected first ${selectedServer} source`);

    return {
      server: selectedServer,
      headers: { Referer: watchUrl, Cookie: cookie },
      videoSources,
    };
  }

  async anilistRequest(query, variables) {
    const response = await this.request(this.anilistUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const data = await response.json();
    if (data.errors?.length) throw new Error(data.errors[0].message || "AniList request failed");
    return data;
  }

  async request(url, options = {}) {
    const { allowHttpError, ...fetchOptions } = options;
    const response = await fetch(url, {
      ...fetchOptions,
      headers: { "User-Agent": this.userAgent, ...(options.headers || {}) },
    });
    if (!response.ok && !allowHttpError) throw new Error(`Request failed (${response.status}): ${url}`);
    return response;
  }

  extractCookie(response) {
    const cookies = response.cookies || {};
    if (typeof cookies === "object") {
      const cookieValue = cookies.shiro_watch || cookies["shiro-watch"];
      if (cookieValue) return cookieValue.startsWith("shiro_watch=") ? cookieValue : `shiro_watch=${cookieValue}`;
    }
    const rawHeaders = response.rawHeaders;
    const setCookie = rawHeaders?.["set-cookie"] || rawHeaders?.["Set-Cookie"];
    if (Array.isArray(setCookie) && setCookie.length) return setCookie[0].split(";", 1)[0];
    if (typeof setCookie === "string") return setCookie.split(";", 1)[0];
    const header = this.getSetCookieHeader(response);
    return header ? header.split(";", 1)[0] : undefined;
  }

  getSetCookieHeader(response) {
    return response.headers?.get?.("set-cookie") || response.headers?.["set-cookie"];
  }

  async getCookieWithBrowser(url) {
    if (typeof ChromeDP === "undefined" || typeof ChromeDP.newBrowser !== "function") {
      console.log("[Shiro] ChromeDP browser API is unavailable");
      return undefined;
    }

    let browser;
    try {
      browser = await ChromeDP.newBrowser({ timeout: 30, userAgent: this.userAgent });
      try {
        await browser.navigate(url);
      } catch (error) {
        // chromedp reports ERR_ABORTED when the page starts a redirect or a
        // second navigation. The browser still follows that navigation, so
        // keep the session alive and inspect its final cookie jar below.
        console.log(`[Shiro] ChromeDP navigation did not complete cleanly; continuing after redirect: ${error?.message || error}`);
      }
      // Allow redirects and client-side scripts that set the cookie after load
      // to finish before querying the browser cookie jar.
      await browser.sleep(1000);
      const result = await browser.executeCDP("Network.getAllCookies");
      const cookies = Array.isArray(result?.cookies) ? result.cookies : [];
      const cookie = cookies.find(candidate =>
        candidate?.name === "shiro_watch" || candidate?.name === "shiro-watch"
      );
      if (!cookie?.value) {
        console.log(`[Shiro] ChromeDP found no Shiro cookie (${cookies.length} cookies returned)`);
        return undefined;
      }
      console.log(`[Shiro] ChromeDP extracted ${cookie.name} cookie`);
      return `${cookie.name}=${cookie.value}`;
    } catch (error) {
      console.log(`[Shiro] ChromeDP cookie fallback failed: ${error?.message || error}`);
      return undefined;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          console.log(`[Shiro] Failed to close ChromeDP browser: ${error?.message || error}`);
        }
      }
    }
  }

  parseEpisodeId(id) {
    const match = String(id).match(/^(\d+):(\d+):(.+)$/);
    if (!match) return undefined;
    return { mediaId: Number(match[1]), number: Number(match[2]), slug: match[3] };
  }

  normalizeServer(server) {
    const value = String(server || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }

  variantServer(variant) {
    const value = String(variant?.id || variant?.label || "").trim().toLowerCase();
    if (value === "sub") return "Sub";
    if (value === "dub") return "Dub";
    return undefined;
  }

  slugify(value) {
    return String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "anime";
  }

  sourceType(type, url) {
    if (type === "application/vnd.apple.mpegurl" || /\.m3u8(?:\?|$)/i.test(url)) return "m3u8";
    if (/\.mp4(?:\?|$)/i.test(url)) return "mp4";
    return "unknown";
  }

  absoluteUrl(url) {
    return new URL(url, this.shiroBase).toString();
  }
}
