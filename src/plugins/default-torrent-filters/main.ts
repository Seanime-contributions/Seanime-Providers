/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

// Default Torrent Filters
//
// Automatically applies your preferred filters (Multi Subs, Dubbed, video/audio codecs)
// to every torrent search, so you don't have to re-check the "Filters" boxes each time.
//
// - Filtering happens server-side via the onTorrentSearch hook, before results reach the UI.
// - Video codecs are OR'd together (e.g. HEVC + AV1 selected = keep torrents matching either).
// - Audio codecs are OR'd together the same way.
// - Multi Subs / Dubbed are hard requirements when enabled.
// - Detection logic mirrors Seanime's native filter panel (based on parsed torrent names).
// - Configure everything from the tray icon; settings persist via $storage.

function init() {

    $app.onTorrentSearch((e) => {
        try {
            const stored = $storage.get<Record<string, any>>("config")

            if (!stored || !stored.enabled || !e.searchData) {
                e.next()
                return
            }

            const cfg: Record<string, any> = stored

            const videoSelected: string[] = []
            if (cfg.videoHevc) videoSelected.push("hevc")
            if (cfg.videoAv1) videoSelected.push("av1")
            if (cfg.videoAvc) videoSelected.push("avc")

            const audioSelected: string[] = []
            if (cfg.audioAac) audioSelected.push("aac")
            if (cfg.audioAc3) audioSelected.push("ac3")
            if (cfg.audioEac3) audioSelected.push("eac3")
            if (cfg.audioDts) audioSelected.push("dts")
            if (cfg.audioOpus) audioSelected.push("opus")
            if (cfg.audioFlac) audioSelected.push("flac")

            const anyActive = !!cfg.multiSubs || !!cfg.dubbed || videoSelected.length > 0 || audioSelected.length > 0
            if (!anyActive) {
                e.next()
                return
            }

            // Same patterns as Seanime's native filter panel
            const videoPatterns: Record<string, RegExp> = {
                hevc: /265|hevc|h265/i,
                av1: /av1|vp9|vp8/i,
                avc: /264|avc|h264/i,
            }
            const audioPatterns: Record<string, RegExp> = {
                aac: /aac|aac_latm/i,
                ac3: /ac3|ac-3/i,
                eac3: /eac3|e-ac3|e-ac-3/i,
                dts: /dts|dca/i,
                opus: /opus|vorbis/i,
                flac: /flac|alac/i,
            }

            const metadataMap = e.searchData.torrentMetadata || {}

            function lower(arr?: string[]): string[] {
                return (arr || []).map((s) => s.toLowerCase())
            }

            function matches(torrent: $app.HibikeTorrent_AnimeTorrent | undefined): boolean {
                if (!torrent) return true

                const entry = torrent.infoHash ? metadataMap[torrent.infoHash] : undefined
                const meta = entry && entry.metadata

                // Torrents whose names couldn't be parsed can't be judged
                if (!meta) return cfg.keepUnknown !== false

                const subs = lower(meta.subtitles)
                const audio = lower(meta.audio_term)
                const video = lower(meta.video_term)

                if (cfg.multiSubs && !subs.some((s) => s.indexOf("multi") !== -1)) {
                    return false
                }

                if (cfg.dubbed) {
                    const isDubbed = subs.some((s) => s.indexOf("dub") !== -1)
                        || audio.some((a) => a.indexOf("dual") !== -1 || a.indexOf("multi") !== -1)
                    if (!isDubbed) return false
                }

                if (videoSelected.length > 0) {
                    const ok = videoSelected.some((k) => video.some((v) => videoPatterns[k].test(v)))
                    if (!ok) return false
                }

                if (audioSelected.length > 0) {
                    const ok = audioSelected.some((k) => audio.some((a) => audioPatterns[k].test(a)))
                    if (!ok) return false
                }

                return true
            }

            if (e.searchData.torrents) {
                e.searchData.torrents = e.searchData.torrents.filter((t) => matches(t))
            }
            if (e.searchData.previews) {
                e.searchData.previews = e.searchData.previews.filter((p) => matches(p.torrent))
            }
        }
        catch (err) {
            console.error("default-torrent-filters:", err)
        }

        e.next()
    })

    $ui.register((ctx) => {

        const defaults: Record<string, any> = {
            enabled: true,
            multiSubs: false,
            dubbed: false,
            videoHevc: false,
            videoAv1: false,
            videoAvc: false,
            audioAac: false,
            audioAc3: false,
            audioEac3: false,
            audioDts: false,
            audioOpus: false,
            audioFlac: false,
            keepUnknown: true,
        }

        const filterKeys = [
            "multiSubs", "dubbed",
            "videoHevc", "videoAv1", "videoAvc",
            "audioAac", "audioAc3", "audioEac3", "audioDts", "audioOpus", "audioFlac",
        ]

        const saved = $storage.get<Record<string, any>>("config") || {}
        const cfg: Record<string, any> = {}
        for (const key in defaults) {
            cfg[key] = saved[key] !== undefined ? saved[key] : defaults[key]
        }
        $storage.set("config", cfg)

        const tray = ctx.newTray({
            iconUrl: "https://raw.githubusercontent.com/5rahim/seanime/main/seanime-web/public/logo_2.png",
            withContent: true,
        })

        function activeCount(): number {
            return filterKeys.filter((k) => !!cfg[k]).length
        }

        function updateBadge() {
            const n = cfg.enabled ? activeCount() : 0
            tray.updateBadge({ number: n, intent: "info" })
        }

        const refs: Record<string, any> = {}
        for (const key in defaults) {
            const ref = ctx.fieldRef<boolean>(cfg[key])
            ref.onValueChange((value: boolean) => {
                cfg[key] = value
                $storage.set("config", cfg)
                updateBadge()
            })
            refs[key] = ref
        }

        ctx.registerEventHandler("reset", () => {
            for (const key in defaults) {
                cfg[key] = defaults[key]
                refs[key].setValue(defaults[key])
            }
            $storage.set("config", cfg)
            updateBadge()
            ctx.toast.info("Default torrent filters reset")
        })

        updateBadge()

        tray.render(() => tray.stack([
            tray.text("Applied automatically to torrent search results.", { className: "text-sm text-[--muted]" }),
            tray.switch("Enabled", { fieldRef: refs.enabled }),
            tray.checkbox("Multi Subs", { fieldRef: refs.multiSubs }),
            tray.checkbox("Dubbed / Dual Audio", { fieldRef: refs.dubbed }),
            tray.text("Video codec (any of)", { className: "text-sm font-semibold pt-2" }),
            tray.checkbox("HEVC / H.265", { fieldRef: refs.videoHevc }),
            tray.checkbox("AV1", { fieldRef: refs.videoAv1 }),
            tray.checkbox("AVC / H.264", { fieldRef: refs.videoAvc }),
            tray.text("Audio codec (any of)", { className: "text-sm font-semibold pt-2" }),
            tray.checkbox("AAC", { fieldRef: refs.audioAac }),
            tray.checkbox("AC3 / AC-3", { fieldRef: refs.audioAc3 }),
            tray.checkbox("EAC3", { fieldRef: refs.audioEac3 }),
            tray.checkbox("DTS / DCA", { fieldRef: refs.audioDts }),
            tray.checkbox("Opus / Vorbis", { fieldRef: refs.audioOpus }),
            tray.checkbox("FLAC / ALAC", { fieldRef: refs.audioFlac }),
            tray.text("Other", { className: "text-sm font-semibold pt-2" }),
            tray.checkbox("Keep unrecognized results", { fieldRef: refs.keepUnknown }),
            tray.button("Reset", { onClick: "reset", intent: "gray-subtle", size: "sm" }),
        ], { style: { gap: "0.35rem" } }))
    })
}
