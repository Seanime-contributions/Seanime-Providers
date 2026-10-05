/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

// Download Memory
//
// Stops the Auto Downloader from re-downloading episodes that were already downloaded but have
// since been moved out of the library by an external tool (Shoko, Sonarr, a rename script...).
//
// Seanime decides that an episode is missing by looking at the files that are in the library
// *right now*. This plugin keeps its own memory (a ledger) of every episode that has ever been
// downloaded and vetoes the Auto Downloader when it picks one of them again.
//
// Ledger sources
//   1. Library scans            every "main" episode file a scan finds (onScanCompleted)
//   2. Auto Downloader          every torrent it actually sends to the torrent client
//   3. Shoko Server (optional)  every episode Shoko already has a file for, fetched on a schedule
//                               AND checked live at veto time, so a file Shoko imported seconds ago
//                               is still caught
//
// Ledger guards
//   1. onAutoDownloaderRunStarted             makes sure Shoko lookups exist for every rule
//   2. onAutoDownloaderBestCandidateSelected  vetoes the episode before anything is queued
//   3. onAutoDownloaderBeforeDownloadTorrent  last line of defense, also covers delayed queue items
//   4. onAnimeEntryDownloadInfo               hides remembered episodes from "missing" lists (opt-in)
//
// Hooks and the UI context run in isolated runtimes, so helpers live in a $shared module that
// exposes three parts: `ledger` (persistence), `shoko` (transport, mapping, live checks) and
// `guard` (the veto decision).
//
// Seanime's $storage rewrites the whole plugin record on every set, without a lock, so two
// runtimes writing at once lose one of the writes, and hooks run on a pool of runtimes. Only the
// UI runtime writes to $storage. Hooks queue their writes in $store and the UI applies them in
// order, re-checking each fence at that moment, which is what makes the fence atomic. Readers
// merge the queue, so a queued write is visible everywhere at once.
//
// All durable state lives in $storage:
//   config              plugin settings (see DEFAULTS)
//   ledger:<mediaId>    { title?, gen, episodes: { "<episode>": { source, recordedAt, torrentName? } } }
//   shoko-map:<mediaId> Shoko lookup for one anime, tied to the Shoko URL. Three outcomes:
//                         found   series ID plus AniDB->Seanime episode map, kept until the URL changes
//                         absent  not in Shoko / no AniDB mapping, a fact, trusted for a few minutes
//                         error   Shoko or Seanime could not answer, retried every couple of minutes.
//                                 Until it succeeds the anime's downloads are deferred, not allowed
//   shoko-last-sync     one-line summary of the last Shoko sync
//   blocked             last 30 vetoed or deferred downloads, newest first, each with a reason:
//                       "ledger" (remembered), "shoko" (live check), "lookup-pending" (deferred).
//                       Opening the tray marks them seen; the unseen real ones drive the badge
//   generation, reset-gen, forgotten
//                       "Clear everything" and "Forget" bump a counter. Every operation carries the
//                       counter value it started with (a fence) and stamps it on whatever it writes.
//                       A write is refused once its fence is behind, and anything stamped with an
//                       old value is ignored on read, which also neutralises a write from another
//                       runtime that slipped past the check. Together that keeps in-flight work
//                       from resurrecting cleared data
// Short-lived state lives in $store:
//   download-memory:shoko-live  live check results per "<shoko url>|<series id>": AniDB keys with
//                               files for 2 minutes, or a failure for 1 minute so an outage costs
//                               one request per series instead of one per episode
//   download-memory:need-maps   hook -> UI request to resolve Shoko lookups for some anime
//   download-memory:maps-ready  UI -> hook, the serial of the request it just answered
//   download-memory:write:<id>  a ledger or blocked-list write queued by a hook, applied by the UI
//   download-memory:write       hook -> UI, the key of the write just queued
//   download-memory:mapping:<mediaId>  set while the UI builds that anime's episode map, so the
//                               "hide remembered episodes" hook leaves that list alone
//   download-memory:scan        hook -> UI notification
// $storage.keys() lists nested paths as well ("ledger:21.episodes.1"), so only exact
// "<prefix><number>" keys are treated as entries.

// Bound by Seanime (internal/plugin/store.go) but missing from its typings
declare namespace $store {
    function remove(key: string): void
}

type LedgerSource = "scan" | "auto" | "shoko" | "library"

interface LedgerEntry {
    source: LedgerSource
    recordedAt: number
    torrentName?: string
}

interface MediaLedger {
    title?: string
    gen: number
    episodes: Record<string, LedgerEntry>
}

// Shape written by version 1.0.0, converted on first read
interface LegacyMediaLedger {
    title?: string
    eps?: Record<string, { src?: LedgerSource; at?: number; name?: string }>
}

interface Config {
    enabled: boolean
    hideFromUi: boolean
    shokoEnabled: boolean
    shokoUrl: string
    shokoApiKey: string
    shokoIntervalMin: number
}

// Why a download was stopped: already remembered, confirmed live by Shoko, or Shoko could not be
// consulted yet (deferred to the next run)
type BlockReason = "ledger" | "shoko" | "lookup-pending"

interface BlockedDownload {
    mediaId: number
    title: string
    episode: number
    torrentName: string
    blockedAt: number
    simulated: boolean
    reason: BlockReason
    gen: number
    seen: boolean
}

// Captured when an operation starts and stamped on everything it writes. A write is refused once a
// Clear or Forget moved the counter on, and stored data is checked the same way when it is read.
interface Fence {
    gen: number
}

// Episodes to record for one anime
interface Addition {
    mediaId: number
    episodes: number[]
    source: LedgerSource
    torrentName?: string
    title?: string
}

// A write a hook could not make itself, waiting for the UI runtime to apply it
type QueuedWrite =
    | { kind: "add"; at: Fence; add: Addition }
    | { kind: "block"; at: Fence; entry: Omit<BlockedDownload, "gen" | "seen"> }

// AniDB identifies episodes as "1", "2"... and specials as "S1", "S2"...
type AniDBEpisodeKey = `${number}` | `S${number}`

type EpisodeMap = Partial<Record<AniDBEpisodeKey, number>>

// Per-anime Shoko lookup. Resolved in the UI context, read by hooks for live checks.
interface ShokoLookupBase {
    url: string
    gen: number
    resolvedAt: number
}

interface ShokoFound extends ShokoLookupBase {
    status: "found"
    seriesId: number
    // AniDB episode key -> Seanime episode number, the way Seanime itself maps them
    anidbToEpisode: EpisodeMap
}

interface ShokoAbsent extends ShokoLookupBase {
    status: "absent"
    reason: string
}

interface ShokoError extends ShokoLookupBase {
    status: "error"
    reason: string
}

type ShokoLookup = ShokoFound | ShokoAbsent | ShokoError

// What a guard can conclude about an anime's Shoko lookup right now
type ShokoLookupState = "found" | "absent" | "pending"

// A hook asking the UI context to build lookups. The UI echoes the serial when it is done.
interface MapRequest {
    serial: number
    mediaIds: number[]
}

interface LiveCacheEntry {
    gen: number
    fetchedAt: number
    keys?: AniDBEpisodeKey[]
    failed?: boolean
}

// Shoko Server API v3 shapes (only the fields we read)
interface ShokoSeries {
    IDs?: { ID?: number }
}

interface ShokoEpisode {
    Size?: number
    AniDB?: { EpisodeNumber?: number; Type?: string }
}

interface ShokoList<T> {
    Total?: number
    List?: T[]
}

// The global fetch (hooks) and ctx.fetch (UI) both satisfy this
type FetchLike = (
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
) => Promise<{ ok: boolean; status: number; json<T = unknown>(): T }>

interface LedgerModule {
    config(): Config
    saveConfig(cfg: Config): void
    episodes(mediaId: number): Record<string, LedgerEntry>
    has(mediaId: number, episode: number): boolean
    add(
        fence: Fence,
        mediaId: number,
        episodes: number[],
        source: LedgerSource,
        torrentName?: string,
        title?: string,
    ): number
    rememberFiles(files: $app.Anime_LocalFile[], source: LedgerSource): number
    forget(mediaId: number): void
    all(): Record<string, MediaLedger>
}

interface ShokoModule {
    base(cfg: Config): string
    request(fetchFn: FetchLike, cfg: Config, path: string): ReturnType<FetchLike>
    episodesPath(seriesId: number): string
    anidbKey(value: string): AniDBEpisodeKey | undefined
    anidbKeysWithFiles(list: ShokoEpisode[]): AniDBEpisodeKey[]
    translate(keys: AniDBEpisodeKey[], anidbToEpisode: EpisodeMap): number[]
    found(mediaId: number, cfg: Config): ShokoFound | undefined
    state(mediaId: number, cfg: Config): ShokoLookupState
    settled(mediaId: number, cfg: Config): boolean
    save(fence: Fence, mediaId: number, lookup: ShokoLookup): void
    liveEpisodes(fence: Fence, mediaId: number, cfg: Config): number[] | "failed"
    // While the UI builds an anime's episode map, the "hide remembered episodes" hook must leave
    // that anime's download info alone, or the map would miss every remembered episode
    markMapBuild(mediaId: number, building: boolean): void
    mapBuilding(mediaId: number): boolean
}

interface GuardModule {
    shouldBlock(rule: $app.Anime_AutoDownloaderRule, episode: number, torrentName: string, simulated: boolean): boolean
    waitForMaps(mediaIds: number[]): void
    // The blocked list for the tray, and how many real vetoes happened since it was last opened
    blocked(): { list: BlockedDownload[]; unseen: number }
    markSeen(): void
}

// What $shared.use("download-memory") returns in every runtime
interface Modules {
    ledger: LedgerModule
    shoko: ShokoModule
    guard: GuardModule
    fence(): Fence
    isStale(fence: Fence, mediaId?: number): boolean
    clearAll(): void
    // The UI runtime calls this once: from then on it writes to $storage directly and applies
    // what hooks queue. Also converts what version 1.0.0 left behind.
    claimWriter(): void
    applyQueued(): void
}

function init() {
    // The factory is re-run inside each runtime that calls $shared.use, so it must be self-contained.
    $shared.define<Modules>("download-memory", () => {
        const DEFAULTS: Config = {
            enabled: true,
            hideFromUi: false,
            shokoEnabled: false,
            shokoUrl: "http://127.0.0.1:8111",
            shokoApiKey: "",
            shokoIntervalMin: 15,
        }
        const LEDGER = "ledger:"
        const SHOKO_MAP = "shoko-map:"
        const LEGACY_SHOKO_SERIES = "shoko-series:"
        const LIVE = "download-memory:shoko-live"
        const WRITE = "download-memory:write:"
        const WRITE_SIGNAL = "download-memory:write"
        const MAPPING = "download-memory:mapping:"
        const LIVE_CACHE_MS = 2 * 60 * 1000
        const LIVE_FAILURE_MS = 60 * 1000
        // How long "not in Shoko" is trusted before a run asks again
        const ABSENT_LOOKUP_MS = 5 * 60 * 1000
        // How long a failed lookup attempt holds off the next attempt
        const RETRY_LOOKUP_MS = 2 * 60 * 1000
        // How long a hook waits for the UI context to resolve Shoko lookups (rounds x step)
        const MAP_WAIT_ROUNDS = 40
        const MAP_WAIT_STEP_MS = 250

        // $await blocks the current runtime until the promise settles and returns its value.
        // The typings say void, the implementation (internal/util/goja/async.go) returns the result.
        const awaitSync = $await as unknown as <T>(promise: Promise<T>) => T

        // Exact "<prefix><mediaId>" keys only, $storage.keys() also lists every nested path
        function entryKeys(prefix: string): string[] {
            const pattern = new RegExp("^" + prefix + "\\d+$")
            return $storage.keys().filter((key) => pattern.test(key))
        }

        function removeKeys(prefix: string) {
            for (const key of entryKeys(prefix)) $storage.remove(key)
        }

        function shokoActive(cfg: Config): boolean {
            return cfg.shokoEnabled && cfg.shokoUrl.trim() !== "" && cfg.shokoApiKey !== ""
        }

        // ------------------------------------------------------------ fences

        function generation(): number {
            return $storage.get<number>("generation") || 0
        }

        function bumpGeneration(): number {
            const next = generation() + 1
            $storage.set("generation", next)
            return next
        }

        function fence(): Fence {
            return { gen: generation() }
        }

        // A Clear after the fence makes everything stale, a Forget only that anime's ledger
        function isStale(at: Fence, mediaId?: number): boolean {
            if (($storage.get<number>("reset-gen") || 0) > at.gen) return true
            if (mediaId === undefined) return false
            const forgotten = $storage.get<Record<string, number>>("forgotten") || {}
            return (forgotten[String(mediaId)] || 0) > at.gen
        }

        // ------------------------------------------------------------ persistence

        // Whether this is the UI runtime, the only one that writes to $storage
        let writer = false

        function queued(): { key: string; write: QueuedWrite }[] {
            const all: Record<string, unknown> = $store.getAll()
            const out: { key: string; write: QueuedWrite }[] = []
            for (const key in all) {
                if (key.indexOf(WRITE) === 0 && all[key]) out.push({ key, write: all[key] as QueuedWrite })
            }
            return out.sort((a, b) => (a.key < b.key ? -1 : 1))
        }

        function queue(write: QueuedWrite) {
            const key = WRITE + Date.now() + ":" + Math.random().toString(36).slice(2)
            $store.set(key, write)
            $store.set(WRITE_SIGNAL, key)
        }

        // Persist first, then remove from the queue: readers rely on a write being in at least
        // one of the two places at any moment
        function applyQueued() {
            for (const { key, write } of queued()) {
                if (write.kind === "add") applyAdd(write.at, write.add)
                else applyBlock(write.at, write.entry)
                $store.remove(key)
            }
        }

        // ------------------------------------------------------------ ledger

        function config(): Config {
            const stored = $storage.get<Partial<Config>>("config") || {}
            return {
                enabled: stored.enabled ?? DEFAULTS.enabled,
                hideFromUi: stored.hideFromUi ?? DEFAULTS.hideFromUi,
                shokoEnabled: stored.shokoEnabled ?? DEFAULTS.shokoEnabled,
                shokoUrl: stored.shokoUrl ?? DEFAULTS.shokoUrl,
                shokoApiKey: stored.shokoApiKey ?? DEFAULTS.shokoApiKey,
                shokoIntervalMin: stored.shokoIntervalMin ?? DEFAULTS.shokoIntervalMin,
            }
        }

        // The stored ledger of one anime, converted from the 1.0.0 shape if needed. Empty when there
        // is none, or when it was written by an operation a Clear or Forget has since overtaken.
        function storedLedger(mediaId: number): MediaLedger {
            const stored = $storage.get<Partial<MediaLedger> & LegacyMediaLedger>(LEDGER + mediaId)
            const ledger: MediaLedger = { gen: 0, episodes: {} }
            if (!stored) return ledger
            if (stored.episodes) {
                ledger.gen = stored.gen ?? 0
                ledger.episodes = stored.episodes
            } else {
                // Version 1.0.0 wrote { eps: { "<episode>": { src, at, name } } }. It predates the
                // counter, so it is as current as anything. The UI rewrites it in this shape at
                // startup; nothing can interleave with that, since hooks never write.
                ledger.gen = generation()
                const legacy = stored.eps || {}
                for (const episode in legacy) {
                    const old = legacy[episode]
                    const entry: LedgerEntry = { source: old.src || "library", recordedAt: old.at || Date.now() }
                    if (old.name) entry.torrentName = old.name
                    ledger.episodes[episode] = entry
                }
            }
            if (isStale(ledger, mediaId)) return { gen: 0, episodes: {} }
            if (stored.title) ledger.title = stored.title
            return ledger
        }

        // Records episodes in a ledger, in memory. Returns how many were new, and whether anything
        // changed at all (a title alone is worth writing).
        function merge(ledger: MediaLedger, add: Addition): { added: number; changed: boolean } {
            let added = 0
            for (const episode of add.episodes) {
                const key = String(episode)
                if (!(episode >= 0) || ledger.episodes[key]) continue
                const entry: LedgerEntry = { source: add.source, recordedAt: Date.now() }
                if (add.torrentName) entry.torrentName = add.torrentName
                ledger.episodes[key] = entry
                added++
            }
            const titled = !!add.title && !ledger.title
            if (titled) ledger.title = add.title
            return { added, changed: added > 0 || titled }
        }

        // One anime's ledger as every runtime should see it: what is stored plus what hooks queued.
        // The queue is read first: the UI may persist a write and drop it from the queue between
        // the two reads, and since it persists before it drops, this order cannot hide an episode.
        function read(mediaId: number): MediaLedger {
            const pending = queued()
            const ledger = storedLedger(mediaId)
            for (const { write } of pending) {
                if (write.kind === "add" && write.add.mediaId === mediaId && !isStale(write.at, mediaId))
                    merge(ledger, write.add)
            }
            return ledger
        }

        function has(mediaId: number, episode: number): boolean {
            return !!read(mediaId).episodes[String(episode)]
        }

        function applyAdd(at: Fence, add: Addition): number {
            if (isStale(at, add.mediaId)) return 0
            const ledger = storedLedger(add.mediaId)
            const { added, changed } = merge(ledger, add)
            if (changed) {
                ledger.gen = at.gen
                $storage.set(LEDGER + add.mediaId, ledger)
            }
            return added
        }

        function add(
            at: Fence,
            mediaId: number,
            episodes: number[],
            source: LedgerSource,
            torrentName?: string,
            title?: string,
        ): number {
            if (isStale(at, mediaId)) return 0
            const addition: Addition = { mediaId, episodes, source, torrentName, title }
            if (writer) return applyAdd(at, addition)
            // Queue only what is new, so a scan of an unchanged library queues nothing
            const { added, changed } = merge(read(mediaId), addition)
            if (changed) queue({ kind: "add", at, add: addition })
            return added
        }

        const ledger: LedgerModule = {
            config,
            saveConfig(cfg) {
                $storage.set("config", cfg)
            },
            episodes(mediaId) {
                return read(mediaId).episodes
            },
            has,
            add,
            // Records every "main" episode file of a local file list, grouped per anime
            rememberFiles(files, source) {
                const at = fence()
                const byMedia: Record<string, number[]> = {}
                const titles: Record<string, string> = {}
                for (const lf of files) {
                    // Goja exposes Go's named string types as objects; normalize before comparing.
                    if (!lf.mediaId || !lf.metadata || String(lf.metadata.type) !== "main") continue
                    const key = String(lf.mediaId)
                    if (!byMedia[key]) byMedia[key] = []
                    byMedia[key].push(lf.metadata.episode)
                    if (!titles[key]) {
                        const folder = lf.parsedFolderInfo && lf.parsedFolderInfo[0]
                        titles[key] = (folder && folder.title) || (lf.parsedInfo && lf.parsedInfo.title) || ""
                    }
                }
                let added = 0
                for (const key in byMedia) added += add(at, Number(key), byMedia[key], source, undefined, titles[key])
                return added
            },
            forget(mediaId) {
                $storage.remove(LEDGER + mediaId)
                // Bump last, so an operation that started while the key was being removed is
                // behind the fence as well
                const forgotten = $storage.get<Record<string, number>>("forgotten") || {}
                forgotten[String(mediaId)] = bumpGeneration()
                $storage.set("forgotten", forgotten)
            },
            all() {
                const ids = entryKeys(LEDGER).map((key) => Number(key.slice(LEDGER.length)))
                for (const { write } of queued()) {
                    if (write.kind === "add" && ids.indexOf(write.add.mediaId) === -1) ids.push(write.add.mediaId)
                }
                const out: Record<string, MediaLedger> = {}
                for (const mediaId of ids) {
                    const entry = read(mediaId)
                    if (Object.keys(entry.episodes).length > 0 || entry.title) out[String(mediaId)] = entry
                }
                return out
            },
        }

        // ------------------------------------------------------------ shoko

        function base(cfg: Config): string {
            return cfg.shokoUrl.trim().replace(/\/+$/, "")
        }

        function anidbKey(value: string): AniDBEpisodeKey | undefined {
            return /^S?\d+$/.test(value) ? (value as AniDBEpisodeKey) : undefined
        }

        // The stored lookup, only if it belongs to the configured Shoko server and survived any Clear
        function stored(mediaId: number, cfg: Config): ShokoLookup | undefined {
            const lookup = $storage.get<ShokoLookup>(SHOKO_MAP + mediaId)
            if (!lookup || !lookup.status || lookup.url !== base(cfg) || isStale(lookup)) return undefined
            return lookup
        }

        function found(mediaId: number, cfg: Config): ShokoFound | undefined {
            const lookup = stored(mediaId, cfg)
            return lookup && lookup.status === "found" && lookup.seriesId > 0 ? lookup : undefined
        }

        // Whether the anime's lookup can produce this Seanime episode number at all. Seanime's
        // episode list leaves out unaired episodes, so a lookup built before an episode aired
        // cannot translate it and has to be rebuilt before the live check means anything.
        function covers(mediaId: number, cfg: Config, episode: number): boolean {
            const lookup = found(mediaId, cfg)
            return !!lookup && Object.values(lookup.anidbToEpisode).indexOf(episode) !== -1
        }

        function age(lookup: ShokoLookupBase): number {
            return Date.now() - (lookup.resolvedAt || 0)
        }

        // What a guard may conclude. "absent" is a fact, but an old one has to be re-confirmed
        // before it is trusted again, and "error" means nobody knows yet.
        function state(mediaId: number, cfg: Config): ShokoLookupState {
            const lookup = stored(mediaId, cfg)
            if (!lookup) return "pending"
            switch (lookup.status) {
                case "found":
                    return lookup.seriesId > 0 ? "found" : "pending"
                case "absent":
                    return age(lookup) < ABSENT_LOOKUP_MS ? "absent" : "pending"
                case "error":
                    return "pending"
            }
        }

        // Whether a run should bother asking for this lookup: found ones are done, absent ones are
        // trusted for a while, failed ones are not retried immediately
        function settled(mediaId: number, cfg: Config): boolean {
            const lookup = stored(mediaId, cfg)
            if (!lookup) return false
            switch (lookup.status) {
                case "found":
                    return lookup.seriesId > 0
                case "absent":
                    return age(lookup) < ABSENT_LOOKUP_MS
                case "error":
                    return age(lookup) < RETRY_LOOKUP_MS
            }
        }

        function liveCache(): Record<string, LiveCacheEntry> {
            return $store.get<Record<string, LiveCacheEntry> | undefined>(LIVE) || {}
        }

        const shoko: ShokoModule = {
            base,
            request(fetchFn, cfg, path) {
                return fetchFn(base(cfg) + path, {
                    headers: { apikey: cfg.shokoApiKey, Accept: "application/json" },
                    timeout: 15,
                })
            },
            // Default filters already drop episodes without files. Specials are included because
            // Seanime sometimes counts an AniDB special as a main episode (episode 0).
            episodesPath(seriesId) {
                return `/api/v3/Series/${seriesId}/Episode?pageSize=0&type=Episode,Special&includeDataFrom=AniDB&includeHidden=true`
            },
            anidbKey,
            // The AniDB identities of every Shoko episode that has at least one file
            anidbKeysWithFiles(list) {
                const out: AniDBEpisodeKey[] = []
                for (const ep of list) {
                    const anidb = ep.AniDB
                    if (!anidb || !anidb.EpisodeNumber) continue
                    if (ep.Size !== undefined && ep.Size <= 0) continue
                    const isSpecial = anidb.Type === "Special"
                    const isNormal = anidb.Type === "Episode" || anidb.Type === "Normal"
                    if (!isSpecial && !isNormal) continue
                    const key = anidbKey((isSpecial ? "S" : "") + anidb.EpisodeNumber)
                    if (key) out.push(key)
                }
                return out
            },
            // AniDB keys -> Seanime episode numbers for one anime. Keys outside the anime's own map
            // are dropped: when a Shoko series is shared, they belong to another AniList entry.
            translate(keys, anidbToEpisode) {
                const out: number[] = []
                for (const key of keys) {
                    const mapped = anidbToEpisode[key]
                    if (mapped !== undefined) out.push(mapped)
                }
                return out
            },
            found,
            state,
            settled,
            markMapBuild(mediaId, building) {
                if (building) $store.set(MAPPING + mediaId, true)
                else $store.remove(MAPPING + mediaId)
            },
            mapBuilding(mediaId) {
                return !!$store.get<boolean | undefined>(MAPPING + mediaId)
            },
            save(at, mediaId, lookup) {
                if (isStale(at)) return
                lookup.gen = at.gen
                $storage.set(SHOKO_MAP + mediaId, lookup)
            },
            // Asks Shoko, synchronously, which episodes of an anime it has files for. The raw AniDB
            // keys are cached per server and series for a couple of minutes and translated per anime
            // on every call, so one run makes at most one request per series. Failures are cached
            // too, briefly, so an outage costs one request per series rather than one per episode.
            // Returns "failed" when there is no trustworthy answer, which callers treat like a
            // pending lookup.
            liveEpisodes(at, mediaId, cfg) {
                const lookup = found(mediaId, cfg)
                if (!lookup || !cfg.shokoApiKey) return "failed"
                const id = base(cfg) + "|" + lookup.seriesId
                const cache = liveCache()
                const hit = cache[id]
                // A cached answer predating a Forget of this anime is not reused for it, so a file
                // the user deleted before forgetting is not remembered again from an old answer
                if (hit && !isStale(hit, mediaId)) {
                    const hitAge = Date.now() - hit.fetchedAt
                    if (hit.failed && hitAge < LIVE_FAILURE_MS) return "failed"
                    if (!hit.failed && hit.keys && hitAge < LIVE_CACHE_MS)
                        return shoko.translate(hit.keys, lookup.anidbToEpisode)
                }
                function remember(entry: LiveCacheEntry) {
                    // A Clear or Forget that happened while we waited must not be undone by this answer
                    if (isStale(at, mediaId)) return
                    const fresh = liveCache()
                    fresh[id] = entry
                    $store.set(LIVE, fresh)
                }
                try {
                    const res = awaitSync(shoko.request(fetch, cfg, shoko.episodesPath(lookup.seriesId)))
                    // Settings may have changed while the request was in flight, then the answer is not ours
                    const now = config()
                    if (!shokoActive(now) || base(now) !== base(cfg) || now.shokoApiKey !== cfg.shokoApiKey)
                        return "failed"
                    let keys: AniDBEpisodeKey[] = []
                    if (res.status !== 404) {
                        if (!res.ok) throw new Error(`Shoko returned ${res.status}`)
                        keys = shoko.anidbKeysWithFiles(res.json<ShokoList<ShokoEpisode>>().List || [])
                    }
                    remember({ gen: at.gen, fetchedAt: Date.now(), keys })
                    return shoko.translate(keys, lookup.anidbToEpisode)
                } catch (err) {
                    console.error("download-memory: live Shoko check failed", err)
                    remember({ gen: at.gen, fetchedAt: Date.now(), failed: true })
                    return "failed"
                }
            },
        }

        // ------------------------------------------------------------ guard

        // The blocked list minus entries a Clear has overtaken. Entries without a generation were
        // written by version 1.0.0 and are dropped as well.
        function blockedList(): BlockedDownload[] {
            const list = $storage.get<BlockedDownload[]>("blocked") || []
            return list.filter((entry) => entry.gen !== undefined && !isStale(entry))
        }

        function applyBlock(at: Fence, entry: Omit<BlockedDownload, "gen" | "seen">) {
            if (isStale(at)) return
            const list = blockedList()
            list.unshift(Object.assign({ gen: at.gen, seen: false }, entry))
            $storage.set("blocked", list.slice(0, 30))
        }

        function logBlocked(at: Fence, entry: Omit<BlockedDownload, "gen" | "seen">) {
            if (isStale(at)) return
            if (writer) applyBlock(at, entry)
            else queue({ kind: "block", at, entry })
        }

        // Only the UI context can build Shoko lookups. Ask it for some anime and hold the hook until
        // it echoes the request back or the wait budget runs out. Returns whether it answered.
        function requestMaps(mediaIds: number[]): boolean {
            const previous = $store.get<MapRequest | undefined>("download-memory:need-maps")
            const request: MapRequest = { serial: (previous ? previous.serial : 0) + 1, mediaIds }
            $store.set("download-memory:need-maps", request)
            for (let round = 0; round < MAP_WAIT_ROUNDS; round++) {
                $sleep(MAP_WAIT_STEP_MS)
                if ($store.get<number | undefined>("download-memory:maps-ready") === request.serial) return true
            }
            console.log(
                `download-memory: Shoko lookups for #${mediaIds.join(", #")} were not ready, their episodes are deferred to the next run`,
            )
            return false
        }

        const guard: GuardModule = {
            // The one decision both Auto Downloader guards make: is this episode already ours?
            shouldBlock(rule, episode, torrentName, simulated) {
                const cfg = config()
                if (!cfg.enabled || !rule || rule.mediaId <= 0) return false
                const at = fence()
                let reason: BlockReason | undefined
                if (has(rule.mediaId, episode)) {
                    reason = "ledger"
                } else if (shokoActive(cfg)) {
                    switch (state(rule.mediaId, cfg)) {
                        case "absent":
                            // Shoko does not know this anime, nothing to check
                            break
                        case "pending":
                            // No usable lookup yet. Skipping this run is cheaper than a duplicate.
                            reason = "lookup-pending"
                            break
                        case "found": {
                            // A freshly aired episode is missing from a lookup built before it aired.
                            // Rebuild the lookup first; if it still cannot place the episode, defer.
                            if (!covers(rule.mediaId, cfg, episode)) requestMaps([rule.mediaId])
                            if (!covers(rule.mediaId, cfg, episode)) {
                                reason = "lookup-pending"
                                break
                            }
                            const live = shoko.liveEpisodes(at, rule.mediaId, cfg)
                            if (live === "failed") {
                                reason = "lookup-pending"
                            } else if (live.indexOf(episode) !== -1) {
                                add(at, rule.mediaId, [episode], "shoko", undefined, rule.comparisonTitle)
                                reason = "shoko"
                            }
                        }
                    }
                }
                if (!reason) return false
                logBlocked(at, {
                    mediaId: rule.mediaId,
                    title: rule.comparisonTitle,
                    episode,
                    torrentName,
                    blockedAt: Date.now(),
                    simulated,
                    reason,
                })
                return true
            },
            // Live checks need a Shoko lookup per anime. Ask for the missing ones before the run
            // starts matching, so a brand new rule is covered too.
            waitForMaps(mediaIds) {
                const cfg = config()
                if (!cfg.enabled || !shokoActive(cfg)) return
                const missing = mediaIds.filter((id) => !settled(id, cfg))
                if (missing.length > 0) requestMaps(missing)
            },
            blocked() {
                const list = blockedList()
                return { list, unseen: list.filter((entry) => !entry.simulated && !entry.seen).length }
            },
            markSeen() {
                $storage.set(
                    "blocked",
                    blockedList().map((entry) => Object.assign({}, entry, { seen: true })),
                )
            },
        }

        return {
            ledger,
            shoko,
            guard,
            fence,
            isStale,
            clearAll() {
                removeKeys(LEDGER)
                removeKeys(SHOKO_MAP)
                removeKeys(LEGACY_SHOKO_SERIES)
                $storage.remove("shoko-last-sync")
                $storage.remove("blocked")
                $storage.remove("forgotten")
                $store.set(LIVE, {})
                // Bump last, so an operation that started while the keys were being removed is
                // behind the fence as well
                $storage.set("reset-gen", bumpGeneration())
            },
            claimWriter() {
                writer = true
                // Version 1.0.0 left Shoko series IDs and an unseen counter under keys that are
                // unused now, and ledgers in a shape that is converted on every read
                removeKeys(LEGACY_SHOKO_SERIES)
                $storage.remove("blocked-unseen")
                for (const key of entryKeys(LEDGER)) {
                    const stored = $storage.get<Partial<MediaLedger>>(key)
                    if (!stored || stored.episodes) continue
                    const ledger = storedLedger(Number(key.slice(LEDGER.length)))
                    ledger.gen = generation()
                    $storage.set(key, ledger)
                }
                applyQueued()
            },
            applyQueued,
        }
    })

    // ------------------------------------------------------------------ sources

    // Every "main" episode file a scan finds. Fires before the result is written to the database.
    $app.onScanCompleted((e) => {
        try {
            const added = $shared.use<Modules>("download-memory").ledger.rememberFiles(e.localFiles || [], "scan")
            if (added > 0) console.log(`download-memory: remembered ${added} episode(s) from the library scan`)
            $store.set("download-memory:scan", Date.now())
        } catch (err) {
            console.error("download-memory: onScanCompleted", err)
        }
        e.next()
    })

    // Every torrent the Auto Downloader actually hands to the torrent client
    $app.onAutoDownloaderAfterDownloadTorrent((e) => {
        try {
            if (e.downloaded && !e.isSimulation && e.rule && e.rule.mediaId > 0 && e.episode > 0) {
                const modules = $shared.use<Modules>("download-memory")
                const name = e.torrent ? e.torrent.name : undefined
                modules.ledger.add(modules.fence(), e.rule.mediaId, [e.episode], "auto", name, e.rule.comparisonTitle)
            }
        } catch (err) {
            console.error("download-memory: onAutoDownloaderAfterDownloadTorrent", err)
        }
        e.next()
    })

    // ------------------------------------------------------------------ guards

    // Before any matching happens, make sure every rule has a Shoko lookup for live checks
    $app.onAutoDownloaderRunStarted((e) => {
        try {
            const mediaIds: number[] = []
            for (const rule of e.rules || []) {
                if (rule.mediaId > 0 && mediaIds.indexOf(rule.mediaId) === -1) mediaIds.push(rule.mediaId)
            }
            $shared.use<Modules>("download-memory").guard.waitForMaps(mediaIds)
        } catch (err) {
            console.error("download-memory: onAutoDownloaderRunStarted", err)
        }
        e.next()
    })

    // Fires once per rule and episode, before anything is queued, delayed or downloaded
    $app.onAutoDownloaderBestCandidateSelected((e) => {
        try {
            // Untagged Go fields reach the runtime in lowerCamel, the typings say `Torrent`
            const candidate = e.candidate as
                ($app.AutoDownloader_Candidate & { torrent?: $app.AutoDownloader_NormalizedTorrent }) | undefined
            const torrent = candidate && (candidate.torrent || candidate.Torrent)
            if (
                e.rule &&
                $shared
                    .use<Modules>("download-memory")
                    .guard.shouldBlock(e.rule, e.episode, torrent ? torrent.name : "", e.isSimulation)
            ) {
                e.preventDefault()
            }
        } catch (err) {
            console.error("download-memory: onAutoDownloaderBestCandidateSelected", err)
        }
        e.next()
    })

    // Delayed queue items skip candidate selection, so check again right before the download
    $app.onAutoDownloaderBeforeDownloadTorrent((e) => {
        try {
            if (
                e.rule &&
                $shared
                    .use<Modules>("download-memory")
                    .guard.shouldBlock(e.rule, e.episode, e.torrent ? e.torrent.name : "", e.isSimulation)
            ) {
                e.preventDefault()
            }
        } catch (err) {
            console.error("download-memory: onAutoDownloaderBeforeDownloadTorrent", err)
        }
        e.next()
    })

    // Drops remembered episodes from an anime's "episodes to download". The home screen's
    // missing-episodes list is built from the same data, so it is filtered as well.
    $app.onAnimeEntryDownloadInfo((e) => {
        try {
            const info = e.entryDownloadInfo
            const toDownload = info && info.episodesToDownload
            if (info && toDownload && toDownload.length > 0) {
                const { ledger, shoko } = $shared.use<Modules>("download-memory")
                const cfg = ledger.config()
                const first = toDownload[0].episode
                const mediaId = first && first.baseAnime ? first.baseAnime.id : 0
                if (cfg.enabled && cfg.hideFromUi && mediaId > 0 && !shoko.mapBuilding(mediaId)) {
                    const remembered = ledger.episodes(mediaId)
                    info.episodesToDownload = toDownload.filter((d) => !remembered[String(d.episodeNumber)])
                }
            }
        } catch (err) {
            console.error("download-memory: onAnimeEntryDownloadInfo", err)
        }
        e.next()
    })

    // ------------------------------------------------------------------ UI

    $ui.register((ctx) => {
        const modules = $shared.use<Modules>("download-memory")
        const { ledger, shoko, guard } = modules
        // This runtime is the only one that writes to $storage (see the header)
        modules.claimWriter()
        const cfg = ledger.config()

        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/5rahim/seanime/main/seanime-web/public/logo_2.png",
            withContent: true,
            width: "440px",
        })

        const summary = ctx.state({ anime: 0, episodes: 0 })
        const blocked = ctx.state<BlockedDownload[]>([])
        const mediaOptions = ctx.state<{ label: string; value: string }[]>([])
        const lastSync = ctx.state("never")
        const syncing = ctx.state(false)

        function errMsg(err: unknown): string {
            return err instanceof Error ? err.message : String(err)
        }

        function shokoConfigured(): boolean {
            return cfg.shokoEnabled && !!cfg.shokoUrl && !!cfg.shokoApiKey
        }

        function save<K extends keyof Config>(key: K, value: Config[K]) {
            cfg[key] = value
            ledger.saveConfig(cfg)
        }

        // Rule titles are the most readable names we have for an anime
        function ruleTitles(): Record<string, string> {
            const titles: Record<string, string> = {}
            try {
                for (const rule of $database.autoDownloaderRules.getAll())
                    titles[String(rule.mediaId)] = rule.comparisonTitle
            } catch (err) {
                // database permission not granted, fall back to stored titles
            }
            return titles
        }

        function refreshBlocked() {
            const { list, unseen } = guard.blocked()
            blocked.set(list)
            tray.updateBadge({ number: unseen, intent: "info" })
        }

        function refresh() {
            const all = ledger.all()
            const titles = ruleTitles()
            const options: { label: string; value: string }[] = []
            let episodes = 0
            for (const mediaId in all) {
                const count = Object.keys(all[mediaId].episodes).length
                episodes += count
                options.push({
                    label: `${titles[mediaId] || all[mediaId].title || "#" + mediaId} (${count})`,
                    value: mediaId,
                })
            }
            options.sort((a, b) => a.label.localeCompare(b.label))
            summary.set({ anime: options.length, episodes })
            mediaOptions.set(options)
            lastSync.set($storage.get<string>("shoko-last-sync") || "never")
            refreshBlocked()
        }

        // ---- settings fields

        const enabledRef = ctx.fieldRef<boolean>(cfg.enabled)
        enabledRef.onValueChange((value) => save("enabled", value))

        const hideRef = ctx.fieldRef<boolean>(cfg.hideFromUi)
        hideRef.onValueChange((value) => save("hideFromUi", value))

        const shokoEnabledRef = ctx.fieldRef<boolean>(cfg.shokoEnabled)
        shokoEnabledRef.onValueChange((value) => {
            save("shokoEnabled", value)
            scheduleSync()
            if (value) syncShoko(false)
        })

        // Text fields change on every keystroke, so sync a moment after the user stops typing
        const shokoUrlRef = ctx.fieldRef<string>(cfg.shokoUrl)
        shokoUrlRef.onValueChange((value) => {
            save("shokoUrl", value.trim())
            syncSoon()
        })

        const shokoKeyRef = ctx.fieldRef<string>(cfg.shokoApiKey)
        shokoKeyRef.onValueChange((value) => {
            save("shokoApiKey", value.trim())
            syncSoon()
        })

        const shokoIntervalRef = ctx.fieldRef<string>(String(cfg.shokoIntervalMin))
        shokoIntervalRef.onValueChange((value) => {
            save("shokoIntervalMin", Number(value) || 15)
            scheduleSync()
        })

        const shokoUserRef = ctx.fieldRef<string>("")
        const shokoPassRef = ctx.fieldRef<string>("")
        const forgetRef = ctx.fieldRef<string>("")

        // ---- Shoko Server

        // Every sync works from a frozen copy of the settings. If the user edits them while a
        // request is in flight, the result is thrown away instead of being filed under the new server.
        class SettingsChanged extends Error {
            constructor() {
                super("Shoko settings changed while a request was in flight")
            }
        }

        function snapshotConfig(): Config {
            return Object.assign({}, cfg)
        }

        function assertSettingsUnchanged(snap: Config) {
            if (
                snap.shokoUrl !== cfg.shokoUrl ||
                snap.shokoApiKey !== cfg.shokoApiKey ||
                snap.shokoEnabled !== cfg.shokoEnabled
            ) {
                throw new SettingsChanged()
            }
        }

        // Returns undefined on 404 so callers can treat "not in Shoko" as a normal case
        async function shokoGet<T>(snap: Config, path: string): Promise<T | undefined> {
            const res = await shoko.request(ctx.fetch, snap, path)
            assertSettingsUnchanged(snap)
            if (res.status === 404) return undefined
            if (res.status === 401 || res.status === 403) throw new Error("Shoko rejected the API key")
            if (!res.ok) throw new Error(`Shoko returned ${res.status} for ${path}`)
            return res.json<T>()
        }

        // Exchanges a username and password for a permanent API key
        async function shokoLogin(user: string, pass: string): Promise<string> {
            const url = shoko.base(cfg)
            const res = await ctx.fetch(url + "/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user, pass, device: "Seanime Download Memory" }),
                timeout: 30,
            })
            if (shoko.base(cfg) !== url) throw new Error("the Shoko URL changed while logging in, try again")
            if (res.status === 401) throw new Error("Shoko rejected the username or password")
            if (!res.ok) throw new Error(`Shoko login failed (${res.status})`)
            const key = res.json<{ apikey?: string }>().apikey
            if (!key) throw new Error("Shoko did not return an API key")
            return key
        }

        // Seanime's own episode list gives the AniDB -> episode number mapping, discrepancies included.
        // Throws when Seanime could not build a trustworthy list, so nothing is saved from it.
        async function episodeMapFor(mediaId: number): Promise<EpisodeMap> {
            // Seanime builds the collection from the same download info the "hide remembered
            // episodes" hook filters, and caches it for ten minutes. Flag the build so the hook
            // leaves it alone, and drop the cache so a filtered copy is never served instead.
            shoko.markMapBuild(mediaId, true)
            try {
                ctx.anime.clearEpisodeCollectionCache()
                const collection = await ctx.anime.getEpisodeCollection(mediaId)
                if (collection.hasMappingError) throw new Error("Seanime reported an episode mapping error")
                const map: EpisodeMap = {}
                for (const ep of collection.episodes || []) {
                    if (String(ep.type) !== "main" || ep.isInvalid || !ep.aniDBEpisode) continue
                    const key = shoko.anidbKey(ep.aniDBEpisode)
                    if (key) map[key] = ep.episodeNumber
                }
                if (Object.keys(map).length === 0) throw new Error("Seanime's episode list has no AniDB data")
                return map
            } finally {
                shoko.markMapBuild(mediaId, false)
            }
        }

        // Resolves (or refreshes) the Shoko lookup for one anime and stores the outcome:
        //   found   Shoko has the series and Seanime could map its episodes
        //   absent  a definite no (not in Shoko, no AniDB mapping), trusted for a few minutes
        //   error   something failed, retried later. Downloads stay deferred until it succeeds.
        // A lookup that was found before survives a transient failure. Returns found lookups only.
        async function ensureShokoMap(
            at: Fence,
            mediaId: number,
            snap: Config,
            skipped: string[],
        ): Promise<ShokoFound | undefined> {
            const existing = shoko.found(mediaId, snap)
            const common = { url: shoko.base(snap), gen: at.gen, resolvedAt: 0 }
            let lookup: ShokoLookup
            try {
                let seriesId = existing ? existing.seriesId : 0
                let absent: string | undefined
                if (!seriesId) {
                    const meta = await ctx.anime.getAnimeMetadata("anilist", mediaId)
                    assertSettingsUnchanged(snap)
                    const anidbId = meta && meta.mappings ? meta.mappings.anidbId : undefined
                    if (!anidbId) {
                        absent = "no AniDB mapping in Seanime's metadata"
                    } else {
                        const series = await shokoGet<ShokoSeries>(snap, `/api/v3/Series/AniDB/${anidbId}/Series`)
                        seriesId = (series && series.IDs && series.IDs.ID) || 0
                        if (!seriesId) absent = "not in Shoko"
                    }
                }
                if (absent) {
                    lookup = Object.assign(common, { status: "absent" as const, reason: absent })
                } else {
                    const anidbToEpisode = await episodeMapFor(mediaId)
                    assertSettingsUnchanged(snap)
                    lookup = Object.assign(common, { status: "found" as const, seriesId, anidbToEpisode })
                }
            } catch (err) {
                if (err instanceof SettingsChanged) throw err
                if (existing) {
                    skipped.push(`#${mediaId} ${errMsg(err)} (kept the previous lookup)`)
                    return existing
                }
                lookup = Object.assign(common, { status: "error" as const, reason: errMsg(err) })
            }
            lookup.resolvedAt = Date.now()
            if (lookup.status !== "found") skipped.push(`#${mediaId} ${lookup.reason}`)
            shoko.save(at, mediaId, lookup)
            return lookup.status === "found" ? lookup : undefined
        }

        // Only anime with a rule can be auto-downloaded, so those are the ones worth checking
        function ruleMediaIds(): number[] {
            const ids: number[] = []
            for (const rule of $database.autoDownloaderRules.getAll()) {
                if (rule.mediaId > 0 && ids.indexOf(rule.mediaId) === -1) ids.push(rule.mediaId)
            }
            return ids
        }

        // Set when a sync is requested while one is running, or when settings change mid-sync,
        // so exactly one fresh sync follows the current one.
        let syncAgain = false

        async function syncShoko(manual: boolean) {
            if (syncing.get()) {
                if (manual) ctx.toast.info("A Shoko sync is already running")
                else syncAgain = true
                return
            }
            if (!shokoConfigured()) {
                if (manual) ctx.toast.warning("Turn on Shoko and fill in the URL and API key first")
                return
            }
            const snap = snapshotConfig()
            const at = modules.fence()
            syncing.set(true)
            let added = 0
            let synced = 0
            let total = 0
            const skipped: string[] = []
            try {
                const mediaIds = ruleMediaIds()
                total = mediaIds.length
                for (const mediaId of mediaIds) {
                    try {
                        const lookup = await ensureShokoMap(at, mediaId, snap, skipped)
                        if (!lookup) continue
                        const page = await shokoGet<ShokoList<ShokoEpisode>>(snap, shoko.episodesPath(lookup.seriesId))
                        const keys = shoko.anidbKeysWithFiles((page && page.List) || [])
                        const episodes = shoko.translate(keys, lookup.anidbToEpisode)
                        added += ledger.add(at, mediaId, episodes, "shoko", undefined, ruleTitles()[String(mediaId)])
                        synced++
                    } catch (err) {
                        if (err instanceof SettingsChanged) throw err
                        skipped.push(`#${mediaId} ${errMsg(err)}`)
                    }
                }
                const when = new Date().toLocaleString()
                const skippedText = skipped.length > 0 ? ` · skipped ${skipped.join("; ")}` : ""
                // A Clear during the sync also cleared the summary, do not bring it back
                if (!modules.isStale(at)) {
                    $storage.set(
                        "shoko-last-sync",
                        `${when} · ${synced}/${total} anime · +${added} episodes${skippedText}`,
                    )
                }
                if (manual) ctx.toast.success(`Shoko sync done, ${added} new episode(s) remembered`)
                if (added > 0) $app.invalidateClientQuery(["ANIME-ENTRIES-get-missing-episodes"])
            } catch (err) {
                if (err instanceof SettingsChanged) {
                    syncAgain = true
                } else {
                    if (!modules.isStale(at)) {
                        $storage.set("shoko-last-sync", `${new Date().toLocaleString()} · failed: ${errMsg(err)}`)
                    }
                    if (manual) ctx.toast.error("Shoko sync failed: " + errMsg(err))
                }
            } finally {
                syncing.set(false)
                refresh()
                if (syncAgain) {
                    syncAgain = false
                    syncShoko(false)
                }
            }
        }

        let cancelPendingSync: (() => void) | undefined
        function syncSoon() {
            if (cancelPendingSync) cancelPendingSync()
            cancelPendingSync = ctx.setTimeout(() => {
                cancelPendingSync = undefined
                syncShoko(false)
            }, 1500)
        }

        let cancelSync: (() => void) | undefined
        function scheduleSync() {
            if (cancelSync) {
                cancelSync()
                cancelSync = undefined
            }
            if (!cfg.shokoEnabled) return
            const minutes = Math.max(1, cfg.shokoIntervalMin || 15)
            cancelSync = ctx.setInterval(
                () => {
                    syncShoko(false)
                },
                minutes * 60 * 1000,
            )
        }

        // ---- event handlers

        ctx.registerEventHandler("sync-now", () => {
            syncShoko(true)
        })

        ctx.registerEventHandler("test-shoko", async () => {
            try {
                if (!cfg.shokoUrl || !cfg.shokoApiKey) throw new Error("fill in the URL and API key first")
                await shokoGet<unknown>(snapshotConfig(), "/api/v3/Series?pageSize=1&page=1")
                ctx.toast.success("Shoko is reachable and the API key works")
                syncShoko(false)
            } catch (err) {
                ctx.toast.error("Shoko test failed: " + errMsg(err))
            }
        })

        ctx.registerEventHandler("shoko-login", async () => {
            try {
                if (!cfg.shokoUrl) throw new Error("fill in the Shoko URL first")
                const key = await shokoLogin(shokoUserRef.current || "", shokoPassRef.current || "")
                shokoKeyRef.setValue(key)
                save("shokoApiKey", key)
                shokoPassRef.setValue("")
                ctx.toast.success("Shoko API key saved")
                syncShoko(false)
            } catch (err) {
                ctx.toast.error(errMsg(err))
            }
        })

        ctx.registerEventHandler("remember-library", () => {
            try {
                const added = ledger.rememberFiles($database.localFiles.getAll(), "library")
                ctx.toast.success(`Remembered ${added} new episode(s) from the current library`)
                refresh()
            } catch (err) {
                ctx.toast.error("Could not read the library: " + errMsg(err))
            }
        })

        ctx.registerEventHandler("forget", () => {
            const mediaId = Number(forgetRef.current)
            if (!mediaId) return
            ledger.forget(mediaId)
            forgetRef.setValue("")
            refresh()
            $app.invalidateClientQuery(["ANIME-ENTRIES-get-missing-episodes"])
            ctx.toast.info("Forgot that anime, its episodes can be downloaded again")
        })

        ctx.registerEventHandler("clear-all", () => {
            modules.clearAll()
            refresh()
            $app.invalidateClientQuery(["ANIME-ENTRIES-get-missing-episodes"])
            ctx.toast.info("Download memory cleared")
        })

        // ---- wiring

        tray.onOpen(() => {
            guard.markSeen()
            refresh()
        })

        // Hooks cannot write to $storage themselves (see the header), they queue writes for here
        $store.watch<string>("download-memory:write", () => {
            modules.applyQueued()
            refresh()
        })
        // A write queued since the writer role was claimed signalled nobody, drain once more
        modules.applyQueued()

        // A scan means files just appeared or vanished, a good moment to ask Shoko what it has
        $store.watch<number>("download-memory:scan", () => {
            refresh()
            syncShoko(false)
        })

        // An Auto Downloader run is waiting for Shoko lookups it does not have yet. Resolve them
        // all at once so the run can continue, then fill the ledger for them in the background.
        $store.watch<MapRequest>("download-memory:need-maps", async (request) => {
            if (!shokoConfigured() || !request || !request.mediaIds) return
            const snap = snapshotConfig()
            const at = modules.fence()
            const skipped: string[] = []
            await Promise.all(
                request.mediaIds.map(async (mediaId) => {
                    try {
                        await ensureShokoMap(at, mediaId, snap, skipped)
                    } catch (err) {
                        if (!(err instanceof SettingsChanged)) {
                            console.error("download-memory: could not resolve the Shoko lookup for #" + mediaId, err)
                        }
                    }
                }),
            )
            $store.set("download-memory:maps-ready", request.serial)
            syncShoko(false)
        })

        // First run: seed the ledger with whatever is in the library right now
        if (Object.keys(ledger.all()).length === 0) {
            try {
                ledger.rememberFiles($database.localFiles.getAll(), "library")
            } catch (err) {
                console.error("download-memory: could not seed from the library", err)
            }
        }

        scheduleSync()
        if (shokoConfigured()) {
            ctx.setTimeout(() => {
                syncShoko(false)
            }, 3 * 1000)
        }
        refresh()

        // ---- render

        const INTERVALS = [
            { label: "5 minutes", value: "5" },
            { label: "15 minutes", value: "15" },
            { label: "30 minutes", value: "30" },
            { label: "60 minutes", value: "60" },
        ]

        tray.render(() => {
            const s = summary.get()
            const recent = blocked.get().slice(0, 8)

            return tray.stack(
                [
                    tray.text(`Remembering ${s.episodes} episode(s) across ${s.anime} anime.`, {
                        className: "text-sm text-[--muted]",
                    }),
                    tray.switch("Enabled", { fieldRef: enabledRef }),
                    tray.checkbox("Also hide remembered episodes from missing/download lists", { fieldRef: hideRef }),

                    tray.text("Shoko Server", { className: "text-sm font-semibold pt-2" }),
                    tray.switch("Check Shoko for episodes it already has", { fieldRef: shokoEnabledRef }),
                    tray.input("URL", { fieldRef: shokoUrlRef, placeholder: "http://127.0.0.1:8111" }),
                    tray.input("API key", {
                        fieldRef: shokoKeyRef,
                        placeholder: "Paste a key, or log in below to create one",
                    }),
                    tray.flex(
                        [
                            tray.input("Username", { fieldRef: shokoUserRef }),
                            tray.input("Password", { fieldRef: shokoPassRef }),
                            tray.button("Get key", { onClick: "shoko-login", intent: "gray-subtle", size: "sm" }),
                        ],
                        { gap: 2, style: { alignItems: "flex-end" } },
                    ),
                    tray.select("Sync every", { options: INTERVALS, fieldRef: shokoIntervalRef }),
                    tray.flex(
                        [
                            tray.button("Sync now", {
                                onClick: "sync-now",
                                intent: "primary-subtle",
                                size: "sm",
                                loading: syncing.get(),
                            }),
                            tray.button("Test connection", {
                                onClick: "test-shoko",
                                intent: "gray-subtle",
                                size: "sm",
                            }),
                        ],
                        { gap: 2 },
                    ),
                    tray.text(`Last sync: ${lastSync.get()}`, { className: "text-xs text-[--muted]" }),

                    tray.text("Recently blocked", { className: "text-sm font-semibold pt-2" }),
                    ...(recent.length === 0
                        ? [tray.text("Nothing yet.", { className: "text-xs text-[--muted]" })]
                        : recent.map((b) =>
                              tray.text(
                                  `${b.title || "#" + b.mediaId} · Episode ${b.episode}` +
                                      (b.reason === "shoko" ? " · confirmed by Shoko" : "") +
                                      (b.reason === "lookup-pending"
                                          ? " · deferred, Shoko could not be consulted"
                                          : "") +
                                      (b.simulated ? " (preview run)" : ""),
                                  { className: "text-xs" },
                              ),
                          )),

                    tray.text("Maintenance", { className: "text-sm font-semibold pt-2" }),
                    tray.button("Remember current library", {
                        onClick: "remember-library",
                        intent: "gray-subtle",
                        size: "sm",
                    }),
                    tray.select("Forget an anime", {
                        options: mediaOptions.get(),
                        fieldRef: forgetRef,
                        placeholder: "Pick an anime",
                    }),
                    tray.flex(
                        [
                            tray.button("Forget selected", { onClick: "forget", intent: "warning-subtle", size: "sm" }),
                            tray.button("Clear everything", {
                                onClick: "clear-all",
                                intent: "alert-subtle",
                                size: "sm",
                            }),
                        ],
                        { gap: 2 },
                    ),
                ],
                { style: { gap: "0.35rem" } },
            )
        })
    })
}
