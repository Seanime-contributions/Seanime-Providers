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
        const currentArticle = ctx.state(null);
        const articleLoading = ctx.state(false);
        const articleError = ctx.state("");

        webview.channel.sync("news", news);
        webview.channel.sync("loading", loading);
        webview.channel.sync("error", error);
        webview.channel.sync("currentArticle", currentArticle);
        webview.channel.sync("articleLoading", articleLoading);
        webview.channel.sync("articleError", articleError);

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

        const extractDivByClass = (html, className) => {
            const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const startPattern = new RegExp(`<div\\b[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${escapedClass}\\b[^"']*\\1[^>]*>`, "i");
            const start = startPattern.exec(html);
            if (!start) return "";
            const divTags = /<\/?div\b[^>]*>/gi;
            divTags.lastIndex = start.index + start[0].length;
            let depth = 1;
            let end;
            let match;
            while ((match = divTags.exec(html))) {
                if (/^<\//.test(match[0])) depth -= 1;
                else if (!/\/\s*>$/.test(match[0])) depth += 1;
                if (depth === 0) {
                    end = match.index;
                    break;
                }
            }
            return end === undefined ? "" : html.slice(start.index + start[0].length, end);
        };

        const safeArticleImage = (value, baseUrl) => {
            try {
                const url = new URL(decodeXml(value), baseUrl);
                return url.protocol === "https:" && (url.hostname === "animenewsnetwork.com" || url.hostname.endsWith(".animenewsnetwork.com")) ? url.href : "";
            } catch {
                return "";
            }
        };

        const sanitizeArticleHtml = (html, baseUrl) => {
            const withoutActiveContent = html
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<(script|style|iframe|object|embed|noscript|form|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
            const allowedTags = new Set(["div", "p", "br", "hr", "h2", "h3", "h4", "h5", "strong", "b", "em", "i", "ul", "ol", "li", "blockquote", "figure", "figcaption", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "sup", "sub", "small", "pre", "code"]);
            const voidTags = new Set(["br", "hr", "img"]);
            const escapeAttribute = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
            return withoutActiveContent.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (tagHtml, tagName, attrs) => {
                const tag = tagName.toLowerCase();
                if (!allowedTags.has(tag)) return "";
                if (tagHtml.startsWith("</")) return voidTags.has(tag) ? "" : `</${tag}>`;
                if (tag === "img") {
                    const srcMatch = attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
                    if (!srcMatch) return "";
                    const src = safeArticleImage(srcMatch[2], baseUrl);
                    if (!src) return "";
                    const altMatch = attrs.match(/\balt\s*=\s*(["'])(.*?)\1/i);
                    const alt = altMatch ? escapeAttribute(decodeXml(altMatch[2])) : "";
                    return `<img src="${escapeAttribute(src)}" alt="${alt}" loading="lazy">`;
                }
                if (tag === "div" && /\bclass\s*=\s*(["'])[^"']*\bmeat\b[^"']*\1/i.test(attrs)) return '<div class="meat">';
                return voidTags.has(tag) ? `<${tag}>` : `<${tag}>`;
            });
        };

        const extractArticleContent = (html, baseUrl) => {
            const cleanHtml = html
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
            const articleHtml = extractDivByClass(cleanHtml, "KonaBody");
            if (!articleHtml) return null;
            const introHtml = extractDivByClass(articleHtml, "intro");
            const intro = introHtml ? textFromXml(introHtml) : "";
            const bodyHtml = introHtml
                ? articleHtml.replace(/<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bintro\b[^"']*\1[^>]*>[\s\S]*?<\/div\s*>/i, "")
                : articleHtml;
            const image = (cleanHtml.match(/<meta\b[^>]*>/gi) || []).map((tag) => {
                const key = tag.match(/\b(?:property|name)\s*=\s*(["'])(?:og:image|twitter:image)\1/i);
                const value = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
                return key && value ? value[2] : "";
            }).find(Boolean) || "";
            return {
                intro,
                bodyHtml: sanitizeArticleHtml(bodyHtml, baseUrl),
                heroImage: safeArticleImage(image, baseUrl),
            };
        };

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

        const openArticle = async (link) => {
            const item = news.get().find((candidate) => candidate.link === link);
            if (!item) return;
            currentArticle.set({ ...item, body: "" });
            articleError.set("");
            articleLoading.set(true);
            try {
                const response = await ctx.fetch(item.link, {
                    headers: { Accept: "text/html,application/xhtml+xml" },
                });
                if (!response.ok) throw new Error(`Article page returned HTTP ${response.status}`);
                const content = extractArticleContent(await response.text(), item.link);
                if (!content || !content.bodyHtml) throw new Error("Could not extract readable article content from the page.");
                currentArticle.set({ ...item, ...content });
            } catch (cause) {
                articleError.set(cause?.message || "Could not load this article. Please try again.");
            } finally {
                articleLoading.set(false);
            }
        };

        webview.channel.on("refresh", () => fetchNews());
        webview.channel.on("open-article", (link) => openArticle(link));
        webview.channel.on("back-to-news", () => {
            currentArticle.set(null);
            articleError.set("");
            articleLoading.set(false);
        });
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
    .reader { max-width: 940px; margin: 0 auto; padding: clamp(20px, 5vw, 54px); border: 1px solid #2a303a; border-radius: 20px; background: linear-gradient(155deg, rgba(26,31,40,.98), rgba(15,18,24,.98)); box-shadow: 0 18px 60px rgba(0,0,0,.22); }
    .reader-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 36px; }
    .back-button { flex: 0 0 auto; white-space: nowrap; border-color: #394251; padding: 9px 13px; background: #202632; }
    .reader-heading { max-width: 790px; margin: 0 auto 28px; }
    .reader h2 { margin: 0; color: #f6f7f9; font-size: clamp(28px, 5vw, 44px); font-weight: 780; letter-spacing: -.035em; line-height: 1.12; }
    .reader-meta { margin-top: 16px; color: #8f9bad; font-size: 13px; }
    .reader-hero { display: block; width: min(100%, 640px); max-height: 320px; margin: 0 auto 28px; border: 1px solid rgba(255,255,255,.08); border-radius: 15px; object-fit: cover; background: #202632; }
    .reader-dek { max-width: 790px; margin: 0 auto 28px; padding: 0 0 24px; border-bottom: 1px solid #2b323e; color: #bfc9d7; font-size: clamp(17px, 2.3vw, 21px); font-weight: 450; line-height: 1.55; }
    .reader-prose { max-width: 740px; margin: 0 auto; color: #d8dde5; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.82; overflow-wrap: anywhere; }
    .reader-prose p { margin: 0 0 1.35em; }
    .reader-prose h2, .reader-prose h3, .reader-prose h4 { margin: 1.7em 0 .7em; color: #f1f3f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 1.25em; letter-spacing: -.015em; line-height: 1.3; }
    .reader-prose ul, .reader-prose ol { padding-left: 1.5em; margin: .7em 0 1.4em; }
    .reader-prose li { padding-left: .25em; margin: .35em 0; }
    .reader-prose blockquote { margin: 1.5em 0; padding: .3em 0 .3em 1.1em; border-left: 3px solid #6d9ee8; color: #adb8c8; }
    .reader-prose hr { height: 1px; margin: 2em 0; border: 0; background: #303744; }
    .reader-prose img { display: block; max-width: 100%; height: auto; margin: 1.5em auto; border-radius: 12px; }
    .reader-prose table { display: block; max-width: 100%; margin: 1.5em 0; overflow-x: auto; border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.5; }
    .reader-prose th, .reader-prose td { padding: 9px 11px; border: 1px solid #37404e; text-align: left; vertical-align: top; }
    .reader-prose th { color: #f1f3f6; background: #202632; font-weight: 700; }
    .reader-prose .meat { color: #d8dde5; }
    .reader-loading { margin: 0; color: #9ba7b7; }
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
    let selectedArticle = null;
    let isArticleLoading = false;
    let currentArticleError = "";

    function formatDate(value) {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    function render() {
      if (selectedArticle) {
        refreshButton.hidden = true;
        renderArticle();
        return;
      }
      refreshButton.hidden = false;
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
        const link = document.createElement("button");
        link.className = "article-link";
        link.type = "button";
        link.textContent = "Read full article →";
        link.addEventListener("click", () => window.webview && window.webview.send("open-article", article.link));
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

    function renderArticle() {
      const reader = document.createElement("article");
      reader.className = "reader";
      const toolbar = document.createElement("div");
      toolbar.className = "reader-toolbar";
      const back = document.createElement("button");
      back.className = "back-button";
      back.type = "button";
      back.textContent = "← Headlines";
      back.addEventListener("click", () => window.webview && window.webview.send("back-to-news"));
      toolbar.append(back);
      reader.append(toolbar);

      const heading = document.createElement("header");
      heading.className = "reader-heading";
      const title = document.createElement("h2");
      title.textContent = selectedArticle.title;
      const date = document.createElement("div");
      date.className = "reader-meta";
      date.textContent = formatDate(selectedArticle.publishedAt);
      heading.append(title, date);
      reader.append(heading);

      if (isArticleLoading) {
        const notice = document.createElement("div");
        notice.className = "notice reader-loading";
        notice.textContent = "Loading the full article…";
        reader.append(notice);
      } else if (currentArticleError) {
        const notice = document.createElement("div");
        notice.className = "notice error";
        notice.textContent = currentArticleError;
        reader.append(notice);
      } else {
        if (selectedArticle.heroImage) {
          const hero = document.createElement("img");
          hero.className = "reader-hero";
          hero.src = selectedArticle.heroImage;
          hero.alt = selectedArticle.title;
          hero.loading = "lazy";
          reader.append(hero);
        }
        if (selectedArticle.intro) {
          const intro = document.createElement("p");
          intro.className = "reader-dek";
          intro.textContent = selectedArticle.intro;
          reader.append(intro);
        }
        const body = document.createElement("div");
        body.className = "reader-prose";
        body.innerHTML = selectedArticle.bodyHtml || "<p>No article text was available.</p>";
        reader.append(body);
      }
      content.replaceChildren(reader);
    }

    if (window.webview) {
      window.webview.on("news", value => { articles = Array.isArray(value) ? value : []; render(); });
      window.webview.on("loading", value => { isLoading = Boolean(value); render(); });
      window.webview.on("error", value => { currentError = String(value || ""); render(); });
      window.webview.on("currentArticle", value => { selectedArticle = value && typeof value === "object" ? value : null; render(); });
      window.webview.on("articleLoading", value => { isArticleLoading = Boolean(value); render(); });
      window.webview.on("articleError", value => { currentArticleError = String(value || ""); render(); });
    }
    refreshButton.addEventListener("click", () => window.webview && window.webview.send("refresh"));
  </script>
</body>
</html>
`);

        fetchNews();
    });
}
