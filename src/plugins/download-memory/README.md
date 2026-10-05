# Download Memory

Stops Seanime's Auto Downloader from re-downloading episodes you already have.

## The problem

You download a season, then Shoko (or Sonarr, or a rename script) imports it: the files get renamed and moved to the folder Jellyfin reads from. The next time Seanime scans, those files are gone from its library, so the Auto Downloader sees the episodes as missing and downloads them again. Duplicates, wasted disk.

Seanime only treats an episode as handled if one of these is true right now:

- a matching file is in the library
- your AniList progress already covers the episode
- a queue entry for it exists (these are deleted after every scan)
- the torrent is still in the torrent client

None of that survives an external tool moving the file, and there is no setting for it.

## How it works

The plugin keeps a ledger of every episode that has ever been downloaded, and vetoes the Auto Downloader when it picks one of them again. The ledger is filled from three sources:

1. **Library scans.** Every episode file a scan finds is remembered, so a batch that was in the library even once stays remembered after Shoko moves it.
2. **The Auto Downloader itself.** Every torrent it sends to your torrent client is remembered immediately, before the file even exists.
3. **Shoko Server** (optional). Shoko is asked which episodes it already has a file for. This happens on a schedule, and again live at the moment the Auto Downloader is about to download something that is not in the ledger yet. A batch that Shoko imported before Seanime ever scanned it is therefore still caught.

The ledger only ever grows. If you deliberately delete an episode and want it downloaded again, forget that anime from the tray.

## Setup

1. Add the extension in Seanime under `Settings > Extensions` with this manifest URL:

   ```
   https://raw.githubusercontent.com/Ari-03/Seanime-Providers/main/src/plugins/download-memory/manifest.json
   ```

2. Grant the `storage` and `database` permissions and the network permission. The network permission is only used for your own Shoko Server, and only if you turn Shoko on.

3. On first load the plugin remembers everything currently in your library. You are protected from that point on.

### Shoko (recommended for the Shoko + Jellyfin setup)

Open the tray icon:

1. Turn on **Check Shoko for episodes it already has**.
2. Enter the Shoko URL. The default is `http://127.0.0.1:8111`.
3. Either paste an API key, or type your Shoko username and password and press **Get key**. The password is sent to Shoko once to create a key and is never stored.
4. Press **Test connection**.

A sync runs as soon as Shoko is turned on, a moment after you paste or generate a key, a few seconds after Seanime starts, after every library scan, and on the interval you pick. Only anime with an Auto Downloader rule are checked, since those are the only ones the Auto Downloader can act on. The tray shows when the last sync ran and which anime were skipped.

Anime are matched to Shoko through the AniDB ID in Seanime's own metadata. Episode numbers are translated with Seanime's own episode list, so shows where AniDB and AniList disagree about episode 0 or specials still line up.

## The tray

- **Enabled** turns the veto on or off without losing the ledger.
- **Also hide remembered episodes from missing/download lists** removes remembered episodes from the home screen's missing-episodes list and the anime page's download list. Off by default because it changes what you see while browsing, not just what gets downloaded. The plugin's own Shoko episode map is always built from the unfiltered list.
- **Recently blocked** lists the downloads the plugin stopped. *Confirmed by Shoko* means the live check caught it. *Preview run* entries come from the Auto Downloader's preview mode, which the plugin filters too so the preview is accurate.
- **Remember current library** re-reads the library on demand.
- **Forget an anime** drops one anime from the ledger and discards the cached Shoko answer for it, so the next check asks Shoko again rather than trusting an answer from before you deleted the file.
- **Clear everything** empties the ledger, the cached Shoko lookups, and the blocked list. Settings are kept. Both this and Forget leave a marker behind so a sync or live check that was already running cannot write the old data back.

The badge on the tray icon counts real blocked downloads since you last opened it.

## Good to know

- Batch torrents never go through the Auto Downloader, so the plugin only ever has to reason about single episodes.
- Episodes you have watched on AniList are already skipped by Seanime itself, with or without this plugin.
- Manual downloads are not hookable in Seanime, so a manual batch is learned from the scan that sees it or from Shoko once it is imported. The only remaining gap is a batch that is still sitting unscanned in the download folder and not yet imported by Shoko at the exact moment the Auto Downloader runs. Keeping Seanime's auto scanner on closes it.
- When a rule is added for an anime the plugin has not looked up in Shoko yet, the next Auto Downloader run pauses for up to ten seconds while the lookup is built. The same happens when the Auto Downloader picks an episode that had not aired when the lookup was last built, so a freshly aired episode is still checked against Shoko instead of slipping past. If the lookup is still not ready, that anime's episodes are deferred to the next run rather than downloaded blind. Deferred episodes show up in the tray. An anime that is not in Shoko, or has no AniDB mapping, is remembered as such for five minutes and then asked about again. If the lookup fails instead, because Shoko or Seanime's metadata could not answer, the anime's downloads stay deferred and the lookup is retried every couple of minutes until it works.
- Shoko episodes are only matched through Seanime's own episode list for that anime. Episodes Seanime does not list for it are ignored, so two AniList entries that share one Shoko series never borrow each other's episodes.
- Upgrading from version 1.0.0 keeps your ledger. The old storage format is converted the first time it is read. The recently blocked list starts fresh.
- If the Auto Downloader is set to queue instead of downloading immediately, an episode is remembered when its file is scanned or when Shoko reports it, not when it is queued.
- The live Shoko check runs inside the Auto Downloader and blocks it for the duration of one request per anime, cached for two minutes. Requests time out after 15 seconds. If the check fails, the episode is deferred to the next run rather than downloaded blind, so while Shoko is unreachable the anime it tracks wait. A failure is remembered for a minute, so an outage costs one timed-out request per anime per minute, not one per episode. Turn the Shoko switch off to go back to ledger-only behaviour during a long outage.
- Cached Shoko lookups are tied to the Shoko URL, so pointing the plugin at a different server never reuses stale IDs. Changing the URL or key while a sync is running stops that sync and starts a fresh one.
- An alternative without a plugin is to add Shoko's destination folder as an extra library path in Seanime, so Seanime keeps seeing the files. That only works if Seanime can parse Shoko's renamed file names correctly, which is not a given for multi-season shows.
- Requires Seanime 3.7.1 or newer.

## Development checks

With Go 1.25 or newer and Bun installed, run `go test -v` from `tests/`.
The test runs the plugin in Seanime 3.10.2's Goja version with Go-backed episode types.
It checks library recording, Shoko mapping, and duplicate vetoes while excluding specials and invalid mappings.
