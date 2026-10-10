function init() {
    $ui.register((ctx) => {
        const webview = ctx.newWebview({
            slot: "screen",
            fullWidth: true,
            autoHeight: true,
            sidebar: {
                label: "Anime News",
                icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h8"/></svg>`,
            },
        });

        const news = ctx.state([]);
        const loading = ctx.state(false);
        const error = ctx.state("");

        webview.channel.sync("news", news);
        webview.channel.sync("loading", loading);
        webview.channel.sync("error", error);

        const decodeXml = (value) => value
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
            .replace(/&#x([\da-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;|&#39;/g, "'")
            .replace(/&amp;/g, "&");

        const textFromXml = (value) => decodeXml(value)
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const readTag = (xml, tag) => {
            const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`, "i"));
            return match ? match[1].trim() : "";
        };

        const parseFeed = (xml) => {
            const items = [];
            const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi) || [];
            for (const block of blocks.slice(0, 24)) {
                const title = textFromXml(readTag(block, "title")) || "Untitled article";
                const linkValue = textFromXml(readTag(block, "link"));
                let link = "";
                try {
                    const parsed = new URL(linkValue);
                    if (parsed.protocol === "https:" && parsed.hostname === "www.animenewsnetwork.com") link = parsed.href;
                } catch {
                    // Ignore malformed or unexpected feed URLs.
                }
                if (!link) continue;
                const description = textFromXml(readTag(block, "description"));
                const publishedAt = textFromXml(readTag(block, "pubDate"));
                items.push({ title, link, description, publishedAt });
            }
            return items;
        };

        const fetchNews = async () => {
            loading.set(true);
            error.set("");
            try {
                const response = await ctx.fetch("https://www.animenewsnetwork.com/all/rss.xml", {
                    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
                });
                if (!response.ok) throw new Error(`Anime News Network returned HTTP ${response.status}`);
                const feed = parseFeed(await response.text());
                if (!feed.length) throw new Error("The Anime News Network feed did not contain any articles.");
                news.set(feed);
            } catch (cause) {
                error.set(cause?.message || "Could not load the latest news. Please try again.");
            } finally {
                loading.set(false);
            }
        };

        webview.channel.on("refresh", () => fetchNews());
        webview.setContent(() => `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html { color-scheme: dark; background: transparent; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; color: #f1f3f5; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .app { max-width: 1240px; margin: 0 auto; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 24px; }
    .heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .logo { width: 42px; height: 42px; border-radius: 12px; object-fit: cover; background: #20242b; }
    h1 { margin: 0; font-size: clamp(20px, 3vw, 28px); letter-spacing: -0.03em; }
    .subtitle { margin: 5px 0 0; color: #98a2b3; font-size: 13px; }
    button { border: 1px solid #343a46; border-radius: 9px; padding: 10px 14px; color: #f1f3f5; background: #1a1f29; font-weight: 650; cursor: pointer; }
    button:hover { background: #252c38; }
    button:disabled { opacity: .55; cursor: wait; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr)); gap: 14px; }
    .card { display: flex; flex-direction: column; min-height: 205px; padding: 18px; border: 1px solid #2a303a; border-radius: 14px; background: linear-gradient(145deg, rgba(28,34,44,.96), rgba(17,20,26,.96)); }
    .date { color: #8f9bad; font-size: 11px; margin-bottom: 10px; }
    h2 { margin: 0 0 10px; font-size: 16px; line-height: 1.45; }
    .description { margin: 0 0 20px; color: #b8c0cc; font-size: 13px; line-height: 1.6; }
    .article-link { display: inline-flex; align-items: center; gap: 7px; margin-top: auto; width: fit-content; color: #88b9ff; text-decoration: none; font-size: 13px; font-weight: 650; }
    .article-link:hover { color: #b3d2ff; text-decoration: underline; }
    .notice { padding: 36px 20px; border: 1px dashed #394150; border-radius: 14px; color: #aab3c0; text-align: center; }
    .notice.error { color: #ff9696; }
    @media (max-width: 560px) { body { padding: 16px; } header { align-items: flex-start; } .logo { width: 36px; height: 36px; } }
  </style>
</head>
<body>
  <main class="app">
    <header>
      <div class="heading">
        <img class="logo" src="https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/refs/heads/main/public/animenewsnetwork.png" alt="">
        <div><h1>Anime News</h1><p class="subtitle">The latest headlines from Anime News Network</p></div>
      </div>
      <button id="refresh" type="button">Refresh</button>
    </header>
    <section id="content" aria-live="polite"><div class="notice">Loading the latest headlines…</div></section>
  </main>
  <script>
    const content = document.getElementById("content");
    const refreshButton = document.getElementById("refresh");
    let articles = [];
    let isLoading = true;
    let currentError = "";

    function formatDate(value) {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    function render() {
      refreshButton.disabled = isLoading;
      refreshButton.textContent = isLoading ? "Loading…" : "Refresh";
      if (isLoading && !articles.length) {
        content.innerHTML = '<div class="notice">Loading the latest headlines…</div>';
        return;
      }
      if (currentError && !articles.length) {
        const notice = document.createElement("div");
        notice.className = "notice error";
        notice.textContent = currentError;
        content.replaceChildren(notice);
        return;
      }
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const article of articles) {
        const card = document.createElement("article");
        card.className = "card";
        const date = document.createElement("div");
        date.className = "date";
        date.textContent = formatDate(article.publishedAt);
        const title = document.createElement("h2");
        title.textContent = article.title;
        const description = document.createElement("p");
        description.className = "description";
        description.textContent = article.description || "Read the full story at Anime News Network.";
        const link = document.createElement("a");
        link.className = "article-link";
        link.href = article.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Read full article →";
        card.append(date, title, description, link);
        grid.append(card);
      }
      content.replaceChildren(grid);
      if (currentError) {
        const note = document.createElement("p");
        note.className = "subtitle";
        note.textContent = "Refresh failed. Showing previously loaded headlines.";
        content.prepend(note);
      }
    }

    if (window.webview) {
      window.webview.on("news", value => { articles = Array.isArray(value) ? value : []; render(); });
      window.webview.on("loading", value => { isLoading = Boolean(value); render(); });
      window.webview.on("error", value => { currentError = String(value || ""); render(); });
    }
    refreshButton.addEventListener("click", () => window.webview && window.webview.send("refresh"));
  </script>
</body>
</html>
`);

        fetchNews();
    });
}
