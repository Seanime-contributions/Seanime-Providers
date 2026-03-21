function init() {
    $ui.register((ctx) => {
        ctx.setInterval(async () => {
            try {
                const torrents = await ctx.torrentClient.getActiveTorrents();
                for (const torrent of torrents) {
                    if (torrent.status == "seeding") {
                        ctx.toast.info("Finished downloading - " + torrent.name);
                        await ctx.torrentClient.pauseTorrents([torrent.hash]); 
                        ctx.toast.info("Removed the torrent from torrent client.");
                    }
                }
            } catch (error) {
                console.error("Error getting torrents:", error)
            }
        }, 1000);
    });
}