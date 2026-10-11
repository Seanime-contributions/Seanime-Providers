# Default Torrent Filters

Tired of re-checking the same boxes in the torrent search "Filters" popover every time you download an episode or season? This plugin applies your preferred filters automatically, server-side, before results even reach the UI.

## How it works

Seanime's built-in filter panel is ephemeral — it resets every time you open the search drawer. This plugin instead hooks into `onTorrentSearch` on the server and removes non-matching torrents from the response, using the same torrent-name parsing (Habari metadata) that powers the native filter panel.

## Configuration

Click the plugin's tray icon to configure:

- **Enabled** — master switch, turn filtering off without losing your preferences.
- **Multi Subs** — only keep torrents with multiple subtitle tracks.
- **Dubbed / Dual Audio** — only keep dubbed or dual-audio torrents.
- **Video codec (any of)** — HEVC/H.265, AV1, AVC/H.264. Unlike the native panel (which ANDs every checkbox), selecting several here keeps torrents matching *any* of them.
- **Audio codec (any of)** — AAC, AC3, EAC3, DTS/DCA, Opus/Vorbis, FLAC/ALAC. Also OR'd.
- **Keep unrecognized results** — torrents whose names couldn't be parsed can't be judged; keep them (default) or drop them.

Changes save instantly and apply to your next search. The tray badge shows how many filters are active.

## Notes

- Seanime caches search responses briefly, so repeating the exact same search right after changing settings may show pre-change results. Change the episode number or toggle a search option to force a fresh search.
- Filters are based on torrent names and can miss some results — same caveat as the native panel.

## Installation

Add the extension in Seanime via `Settings > Extensions` using the manifest URL:

```
https://raw.githubusercontent.com/Ari-03/Seanime-Providers/main/src/plugins/default-torrent-filters/manifest.json
```

Then grant the `storage` permission when prompted.
