class Provider {
  constructor() {
    this.base = "https://allanime.day";
    this.apiHost = "https://api.allanime.day";
    this.referer = "https://allanime.to/";
    this.agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";
  }

  getSettings() {
    return {
      episodeServers: ["wixmp"],
      supportsDub: true,
    };
  }

  async search(query) {
    const translationType = query.opts?.dub ? "dub" : "sub";
    const gql = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType){
      shows(search:$search limit:$limit page:$page translationType:$translationType){
        edges{_id name availableEpisodes}
      }
    }`;
    const data = await this._gql(gql, {
      search: { query: query.query, allowAdult: false, allowUnknown: false },
      limit: 20,
      page: 1,
      translationType,
    });

    return (data?.data?.shows?.edges || []).map((s) => ({
      id: `${s._id}|||${translationType}`,    // encode language in the ID
      title: s.name,
      url: `${this.base}/anime/${s._id}`,
      subOrDub: translationType,
    }));
  }

  async findEpisodes(id) {
    // id format: "showId|||lang"
    const [showId, lang] = id.split("|||");
    const language = lang === "dub" ? "dub" : "sub";

    const gql = `query($showId:String!){show(_id:$showId){_id availableEpisodesDetail}}`;
    const data = await this._gql(gql, { showId });
    const detail = data?.data?.show?.availableEpisodesDetail;
    const eps = language === "dub" ? (detail?.dub || []) : (detail?.sub || []);

    return eps.map((e) => ({
      id: `${showId}|||${language}|||${e}`,   // encode language + episode number
      title: `Episode ${e}`,
      number: parseFloat(e),
      url: `${this.base}/anime/${showId}/episodes/${e}`,
    })).sort((a, b) => a.number - b.number);
  }

  async findEpisodeServer(episode, server) {
    // episode.id format: "showId|||lang|||episodeString"
    const parts = episode.id.split("|||");
    if (parts.length !== 3) throw new Error("Invalid episode ID format");
    const [showId, translationType, episodeString] = parts;

    const gql = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){
      episode(showId:$showId translationType:$translationType episodeString:$episodeString){sourceUrls}
    }`;
    const data = await this._gql(gql, { showId, translationType, episodeString });
    const sources = data?.data?.episode?.sourceUrls;

    if (!sources || sources.length === 0) throw new Error("No sources found");

    const priority = ["wixmp", "S-mp4", "Luf-Mp4", "Mp4", "Default"];
    let selected = null;
    for (const name of priority) {
      selected = sources.find((s) => s.sourceName?.toLowerCase() === name.toLowerCase());
      if (selected) break;
    }

    return this._resolveSource(selected || sources[0], server);
  }

  // ------------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------------
  async _gql(query, variables) {
    const res = await fetch(`${this.apiHost}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": this.referer,
        "User-Agent": this.agent,
      },
      body: JSON.stringify({ variables, query }),
    });
    if (!res.ok) throw new Error(`GQL request failed: ${res.status}`);
    return res.json();
  }

  _decodeUrl(encoded) {
    const map = {
      "79":"A","7a":"B","7b":"C","7c":"D","7d":"E","7e":"F","7f":"G","70":"H",
      "71":"I","72":"J","73":"K","74":"L","75":"M","76":"N","77":"O","68":"P",
      "69":"Q","6a":"R","6b":"S","6c":"T","6d":"U","6e":"V","6f":"W","60":"X",
      "61":"Y","62":"Z","59":"a","5a":"b","5b":"c","5c":"d","5d":"e","5e":"f",
      "5f":"g","50":"h","51":"i","52":"j","53":"k","54":"l","55":"m","56":"n",
      "57":"o","48":"p","49":"q","4a":"r","4b":"s","4c":"t","4d":"u","4e":"v",
      "4f":"w","40":"x","41":"y","42":"z","08":"0","09":"1","0a":"2","0b":"3",
      "0c":"4","0d":"5","0e":"6","0f":"7","00":"8","01":"9","15":"-","16":".",
      "67":"_","46":"~","02":":","17":"/","07":"?","1b":"#","63":"[","65":"]",
      "78":"@","19":"!","1c":"$","1e":"&","10":"(","11":")","12":"*","13":"+",
      "14":",","03":";","05":"=","1d":"%",
    };
    let out = "";
    for (let i = 0; i < encoded.length; i += 2) {
      const byte = encoded.substring(i, i + 2);
      out += map[byte] !== undefined ? map[byte] : "";
    }
    out = out.replace(/\/clock/g, "/clock.json");
    return out;
  }

  async _resolveSource(source, server) {
    let rawUrl = source.sourceUrl || "";
    const sourceName = source.sourceName || "";

    if (rawUrl.startsWith("--")) {
      rawUrl = this._decodeUrl(rawUrl.slice(2));
    }

    let absoluteUrl;
    if (rawUrl.startsWith("http")) {
      absoluteUrl = rawUrl;
    } else {
      const path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
      absoluteUrl = `https://allanime.day${path}`;
    }

    try {
      const res = await fetch(absoluteUrl, {
        headers: {
          "Referer": this.referer,
          "User-Agent": this.agent,
        },
      });
      if (!res.ok) throw new Error(`Clock API returned ${res.status}`);
      const json = await res.json();

      if (!json.links || !Array.isArray(json.links)) {
        throw new Error("Response missing 'links' array");
      }

      const videoSources = json.links.map((link) => ({
        url: link.link,
        quality: link.resolutionStr || "auto",
        type: link.link?.includes(".m3u8") ? "m3u8" : "mp4",
        subtitles: [],   // optional, can be filled if needed
      }));

      return { server, videoSources, headers: {} };
    } catch (err) {
      console.error(`[AllAnime] Resolution Error for ${sourceName}: ${err.message}`);
      return { server, videoSources: [], headers: {} };
    }
  }
}
