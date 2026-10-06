const vm = require("node:vm");
const ts = require("typescript");
const cheerio = require("cheerio");

const CATALOG_URL = "https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/main/marketplace/main.json";
const IGNORE_CHECK_URL = "https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/main/marketplace/ignore-check.json";
const DEFAULT_QUERY = "One Piece";
const MAX_QUERY_LENGTH = 80;
const REQUEST_TIMEOUT_MS = 8000;
const OPERATION_TIMEOUT_MS = 9000;
const MAX_CONCURRENCY = 12;
const MAX_EXTENSIONS_PER_REQUEST = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RESULT_CACHE_TTL_MS = 3 * 60 * 1000;
const CONTENT_TYPES = new Set(["onlinestream-provider", "manga-provider", "anime-torrent-provider"]);
const rateLimitStore = new Map();
const activeRequests = new Map();
const resultCache = new Map();

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function request(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(url, label) {
  const response = await request(url);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

async function readText(url, label) {
  const response = await request(url);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.text();
}

function normalizeQuery(value) {
  const query = String(value || DEFAULT_QUERY).trim().replace(/\s+/g, " ");
  return (query || DEFAULT_QUERY).slice(0, MAX_QUERY_LENGTH);
}

function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"] || req.headers?.["X-Forwarded-For"];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0].trim();
  return candidate || String(req.headers?.["x-real-ip"] || req.headers?.["X-Real-IP"] || "unknown").trim() || "unknown";
}

function pruneStores(now) {
  for (const [ip, timestamps] of rateLimitStore) {
    const current = timestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (current.length) rateLimitStore.set(ip, current);
    else rateLimitStore.delete(ip);
  }
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) resultCache.delete(key);
  }
}

function getRateLimitState(ip, now) {
  const timestamps = (rateLimitStore.get(ip) || []).filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  return { timestamps, remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - timestamps.length) };
}

function resultCacheKey(query, ids, ignoreIds) {
  return JSON.stringify({ query, ids: [...ids].map(String).sort(), ignoreIds: [...ignoreIds].map(String).sort() });
}

function providerTypeLabel(type) {
  return ({
    "onlinestream-provider": "Anime",
    "manga-provider": "Manga",
    "anime-torrent-provider": "Torrent",
  })[type] || type;
}

async function verifyAccessible(url, headers, label) {
  if (!url) throw new Error(`${label} did not return a URL`);
  const response = await request(url, { headers: headers || {} });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  if (response.body?.cancel) await response.body.cancel();
  return response.status;
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "remote endpoint").slice(0, 220);
}

// Seanime exposes LoadDoc to providers. This small adapter preserves the
// DocSelection methods used by the repository while running on Vercel.
function createDocSelection(nodes, $) {
  const wrap = value => createDocSelection(value, $);
  return {
    attr: name => nodes.first().attr(name),
    attrs: () => nodes.first().attr() || {},
    children: selector => wrap(nodes.children(selector)),
    closest: selector => wrap(nodes.closest(selector)),
    contents: () => wrap(nodes.contents()),
    contentsFiltered: selector => wrap(nodes.contents().filter(selector)),
    data: name => name === undefined ? nodes.first().data() : nodes.first().data(name),
    each: callback => { nodes.each((index, element) => callback(index, wrap($(element)))); return wrap(nodes); },
    end: () => wrap(nodes),
    eq: index => wrap(nodes.eq(index)),
    filter: predicate => typeof predicate === "function"
      ? wrap(nodes.filter((index, element) => predicate(index, wrap($(element)))))
      : wrap(nodes.filter(predicate)),
    find: selector => wrap(nodes.find(selector)),
    first: () => wrap(nodes.first()),
    has: selector => wrap(nodes.has(selector)),
    text: () => nodes.text(),
    html: () => nodes.first().html(),
    is: predicate => typeof predicate === "function"
      ? nodes.toArray().some((element, index) => predicate(index, wrap($(element))))
      : nodes.is(predicate),
    last: () => wrap(nodes.last()),
    length: nodes.length,
    map: callback => nodes.toArray().map((element, index) => callback(index, wrap($(element)))),
    next: selector => wrap(nodes.next(selector)),
    nextAll: selector => wrap(nodes.nextAll(selector)),
    nextUntil: selector => wrap(nodes.nextUntil(selector)),
    not: predicate => typeof predicate === "function"
      ? wrap(nodes.filter((index, element) => !predicate(index, wrap($(element)))))
      : wrap(nodes.not(predicate)),
    parent: selector => wrap(nodes.parent(selector)),
    parents: selector => wrap(nodes.parents(selector)),
    parentsUntil: selector => wrap(nodes.parentsUntil(selector)),
    prev: selector => wrap(nodes.prev(selector)),
    prevAll: selector => wrap(nodes.prevAll(selector)),
    prevUntil: selector => wrap(nodes.prevUntil(selector)),
    siblings: selector => wrap(nodes.siblings(selector)),
  };
}

function loadDoc(html) {
  const $ = cheerio.load(html);
  return selector => createDocSelection($(selector), $);
}

function loadProvider(source, sourceUrl) {
  let code = source;
  if (/\.tsx?([?#]|$)/i.test(sourceUrl)) {
    code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
      fileName: sourceUrl,
    }).outputText;
  }

  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: quietConsole,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    AbortController,
    TextEncoder,
    TextDecoder,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch: (url, options) => request(url, options),
    LoadDoc: loadDoc,
  };
  vm.runInNewContext(`${code}\nmodule.exports = Provider;`, sandbox, { filename: sourceUrl, timeout: 2500 });
  if (typeof sandbox.module.exports !== "function") throw new Error("Provider payload did not define a Provider class");
  return sandbox.module.exports;
}

async function checkProvider(item, query) {
  const startedAt = Date.now();
  const result = {
    id: item.id,
    name: item.name || item.id,
    type: providerTypeLabel(item.type),
    author: item.author || "Unknown",
    status: "down",
    phase: "manifest",
    message: "Not checked",
    durationMs: 0,
    checks: {
      search: { status: "fail", message: "Not checked" },
      entries: { status: "fail", message: "Not checked" },
      stream: { status: "fail", message: "Not checked" },
    },
  };

  try {
    const manifest = await readJson(item.manifestURI, "Manifest");
    result.version = manifest.version || item.version || "—";
    result.icon = manifest.icon ? new URL(manifest.icon, item.manifestURI).toString() : (item.icon || "");
    result.language = manifest.lang || item.lang || "—";
    result.phase = "payload";
    if (!manifest.payloadURI) throw new Error("Manifest has no payloadURI");

    const payloadUrl = new URL(manifest.payloadURI, item.manifestURI).toString();
    const payload = await readText(payloadUrl, "Payload");
    const Provider = loadProvider(payload, payloadUrl);
    const provider = new Provider();
    const settings = typeof provider.getSettings === "function" ? await withTimeout(Promise.resolve(provider.getSettings()), OPERATION_TIMEOUT_MS, "getSettings") : {};
    result.servers = Array.isArray(settings?.episodeServers) ? settings.episodeServers : [];

    if (typeof provider.search !== "function") throw new Error("Provider has no search method");
    const input = {
      query,
      opts: { query, dub: false },
      media: { id: 0, title: query, synonyms: [], isAdult: false },
      dub: false,
      year: undefined,
    };
    result.phase = "search";
    const matches = await withTimeout(Promise.resolve(provider.search(input)), OPERATION_TIMEOUT_MS, "search");
    if (!Array.isArray(matches) || matches.length === 0) throw new Error("Search returned no results");
    result.match = matches[0]?.title || matches[0]?.name || query;
    result.checks.search = { status: "success", message: `${matches.length} result${matches.length === 1 ? "" : "s"}` };

    const firstMatch = matches[0];
    const entryLabel = item.type === "manga-provider" ? "chapters" : "episodes";
    let entries;
    if (item.type === "manga-provider") {
      if (typeof provider.findChapters !== "function") throw new Error("Provider has no findChapters method");
      entries = await withTimeout(Promise.resolve(provider.findChapters(firstMatch.id)), OPERATION_TIMEOUT_MS, "findChapters");
    } else {
      if (typeof provider.findEpisodes !== "function") throw new Error("Provider has no findEpisodes method");
      entries = await withTimeout(Promise.resolve(provider.findEpisodes(firstMatch.id)), OPERATION_TIMEOUT_MS, "findEpisodes");
    }
    if (!Array.isArray(entries) || entries.length === 0) throw new Error(`Search succeeded but no ${entryLabel} were returned`);
    result.entries = entries.length;
    result.checks.entries = { status: "success", message: `${entries.length} ${entryLabel}` };

    result.phase = "stream";
    if (item.type === "manga-provider") {
      if (typeof provider.findChapterPages !== "function") throw new Error("Provider has no findChapterPages method");
      const pages = await withTimeout(Promise.resolve(provider.findChapterPages(entries[0].id)), OPERATION_TIMEOUT_MS, "findChapterPages");
      if (!Array.isArray(pages) || pages.length === 0) throw new Error("findChapterPages returned no pages");
      const page = pages.find(candidate => candidate?.url) || pages[0];
      const httpStatus = await withTimeout(verifyAccessible(page?.url, page?.headers, "Chapter page"), REQUEST_TIMEOUT_MS + 1000, "Chapter page check");
      result.checks.stream = { status: "success", message: `Page accessible (HTTP ${httpStatus})` };
    } else {
      if (typeof provider.findEpisodeServer !== "function") throw new Error("Provider has no findEpisodeServer method");
      if (!result.servers.length) throw new Error("Provider has no episode servers configured");
      const serverChecks = await Promise.all(result.servers.map(async server => {
        try {
          const episodeServer = await withTimeout(Promise.resolve(provider.findEpisodeServer(entries[0], server)), OPERATION_TIMEOUT_MS, `episode server ${server}`);
          const source = episodeServer?.videoSources?.find(candidate => candidate?.url);
          const httpStatus = await withTimeout(verifyAccessible(source?.url, episodeServer?.headers, `Episode stream (${server})`), REQUEST_TIMEOUT_MS + 1000, `Episode stream (${server}) check`);
          return { server, status: "success", httpStatus };
        } catch (error) {
          return { server, status: "fail", message: errorMessage(error) };
        }
      }));
      const working = serverChecks.filter(check => check.status === "success");
      const streamStatus = working.length === 0
        ? "fail"
        : working.length === serverChecks.length
          ? "success"
          : "warning";
      result.checks.stream = {
        status: streamStatus,
        message: `${working.length}/${serverChecks.length} episode server${serverChecks.length === 1 ? "" : "s"} accessible`,
        servers: serverChecks,
      };
      if (!working.length) throw new Error(result.checks.stream.message);
    }

    result.status = result.checks.stream.status === "warning" ? "warning" : "up";
    result.phase = "complete";
    result.message = result.status === "warning"
      ? `Search and ${entryLabel} checks succeeded; some episode servers failed`
      : `Search, ${entryLabel}, and ${item.type === "manga-provider" ? "page" : "stream"} checks succeeded`;
  } catch (error) {
    const message = errorMessage(error);
    if (/LoadDoc is not defined|Seanime document helper/i.test(message)) {
      result.status = "unsupported";
      result.phase = "runtime";
      result.message = "Seanime document helper unavailable";
    } else {
      result.status = /timed out/i.test(String(error?.message)) ? "timeout" : "down";
      result.message = message;
    }
    if (result.checks.search.status !== "success") result.checks.search.message = result.phase === "search" ? message : result.checks.search.message;
    if (result.checks.entries.status !== "success" && result.checks.search.status === "success") result.checks.entries.message = message;
    if (result.checks.stream.status !== "success" && result.checks.entries.status === "success") result.checks.stream.message = result.checks.stream.message === "Not checked" ? message : result.checks.stream.message;
    const checkStatuses = Object.values(result.checks).map(check => check.status);
    const passedChecks = checkStatuses.filter(status => status === "success").length;
    const failedChecks = checkStatuses.filter(status => status === "fail" || status === "timeout").length;
    if ((result.status === "down" || result.status === "timeout") && passedChecks > 0 && failedChecks > 0) {
      result.status = "warning";
      result.message = `Partial check failure: ${message}`;
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
  return result;
}

function ignoredResult(item, reason) {
  return {
    id: item.id,
    name: item.name || item.id,
    type: providerTypeLabel(item.type),
    author: item.author || "Unknown",
    status: "ignored",
    phase: "ignored",
    message: reason,
    durationMs: 0,
    checks: {
      search: { status: "ignored", message: "Not tested" },
      entries: { status: "ignored", message: "Not tested" },
      stream: { status: "ignored", message: "Not tested" },
    },
    version: item.version || "—",
    icon: item.icon || "",
  };
}

function getConfiguredIgnoreIds(ignoreConfig, requestedIgnoreIds) {
  const legacyArray = Array.isArray(ignoreConfig);
  const entries = legacyArray ? ignoreConfig : ignoreConfig?.extensions;
  const ignoreAll = legacyArray || ignoreConfig?.ignoreAll === true;
  const configured = new Map(
    (Array.isArray(entries) ? entries : [])
      .filter(entry => entry?.id && entry?.reason && (ignoreAll || entry.ignore === true))
      .map(entry => [String(entry.id), String(entry.reason)])
  );
  if (!Array.isArray(requestedIgnoreIds)) return configured;
  const requestable = new Map(
    (Array.isArray(entries) ? entries : [])
      .filter(entry => entry?.id && entry?.reason)
      .map(entry => [String(entry.id), String(entry.reason)])
  );
  const requested = new Set(requestedIgnoreIds.map(String));
  return new Map([...requestable].filter(([id]) => requested.has(id)));
}

async function mapWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const query = normalizeQuery(body.query || req.query?.query);
  const requestedIds = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(String))]
    : [...new Set(String(req.query?.ids || "").split(",").map(value => value.trim()).filter(Boolean))];
  const requestedIgnoreIds = Array.isArray(body.ignoreIds) ? body.ignoreIds : undefined;

  if (requestedIds.length > MAX_EXTENSIONS_PER_REQUEST) {
    return res.status(400).json({ error: `Select at most ${MAX_EXTENSIONS_PER_REQUEST} extensions per request.` });
  }

  const now = Date.now();
  pruneStores(now);
  const ip = getClientIp(req);
  const cacheKey = resultCacheKey(query, requestedIds, requestedIgnoreIds === undefined ? ["__configured__"] : requestedIgnoreIds);
  const rate = getRateLimitState(ip, now);
  if (rate.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((rate.timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
    res.setHeader("X-RateLimit-Remaining", "0");
    return res.status(429).json({ error: "Too many detector requests. Please try again later.", retryAfter });
  }

  rate.timestamps.push(now);
  rateLimitStore.set(ip, rate.timestamps);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX_REQUESTS - rate.timestamps.length)));

  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    res.setHeader("X-Detector-Cache", "HIT");
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  if (activeRequests.has(ip)) {
    res.setHeader("Retry-After", "15");
    return res.status(429).json({ error: "A detector request is already running for this IP. Please wait for it to finish." });
  }

  activeRequests.set(ip, now);
  try {
    const catalog = await readJson(CATALOG_URL, "Marketplace catalog");
    const ignoreConfig = await readJson(IGNORE_CHECK_URL, "Checker ignore list");
    const ignoreById = getConfiguredIgnoreIds(ignoreConfig, requestedIgnoreIds);
    const items = (Array.isArray(catalog) ? catalog : []).filter(item => CONTENT_TYPES.has(item?.type) && (!requestedIds.length || requestedIds.includes(item.id)));
    const results = await mapWithConcurrency(items, item => {
      const reason = ignoreById.get(String(item.id));
      return reason ? ignoredResult(item, reason) : checkProvider(item, query);
    }, MAX_CONCURRENCY);
    const summary = results.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
    const payload = { query, checkedAt: new Date().toISOString(), total: results.length, selected: requestedIds, ignored: [...ignoreById.keys()], summary, results };
    resultCache.set(cacheKey, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, payload });
    res.setHeader("X-Detector-Cache", "MISS");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({ query, error: errorMessage(error) });
  } finally {
    activeRequests.delete(ip);
  }
};
