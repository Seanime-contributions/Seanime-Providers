/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
  $ui.register((ctx) => {
    const lastUrl = ctx.state<string>($storage.get("seabrowse.lastUrl") ?? "https://anilist.co");
    const loading = ctx.state<boolean>(false);
    const error = ctx.state<string | null>(null);
    const history = ctx.state<string[]>($storage.get("seabrowse.history") ?? []);
    const historyIndex = ctx.state<number>($storage.get("seabrowse.historyIndex") ?? -1);

    const injectBaseHrefAndInterception = async (html: string, pageUrl: string): Promise<string> => {
      try {
        if (!html) return html;

        const baseHref = new URL(pageUrl).toString();
        let result = html;

        if (!/<base\s+/i.test(result)) {
          if (/<head(\s|>)/i.test(result)) {
            result = result.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<base href="${baseHref}">`);
          } else {
            result = `<head><base href="${baseHref}"></head>${result}`;
          }
        }

        // Fetch and inline stylesheet links
        const styleLinkRegex = /<link\s+([^>]*rel=["']stylesheet["'][^>]*href=["'])([^"']+)(["'][^>]*)>/gi;
        const matches = [...html.matchAll(styleLinkRegex)];
        const cssReplacements: Promise<{ match: string, replacement: string }>[] = [];

        for (const m of matches) {
          const match = m[0];
          const href = m[2];
          if (!href || href.startsWith('data:') || href.startsWith('#') || href.startsWith('blob:')) continue;
          cssReplacements.push((async () => {
            try {
              const u = new URL(href, baseHref);
              if (u.protocol === 'http:' || u.protocol === 'https:') {
                console.log('[SeaBrowse] Fetching CSS:', u.toString());
                const proxyUrl = `http://127.0.0.1:43211/api/v1/proxy?url=${encodeURIComponent(u.toString())}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) return { match, replacement: match };
                const css = await response.text();
                // Rewrite url() in CSS to use data URIs
                const finalCss = await (async () => {
                  const urlMatches = [...css.matchAll(/url\(["']?([^)"']+)["']?\)/gi)];
                  let resultCss = css;
                  for (const [full, urlPath] of urlMatches) {
                    if (urlPath.startsWith('data:') || urlPath.startsWith('#')) continue;
                    try {
                      const fontUrl = new URL(urlPath, u.toString()).toString();
                      console.log('[SeaBrowse] Fetching font:', fontUrl);
                      const fontProxyUrl = `http://127.0.0.1:43211/api/v1/proxy?url=${encodeURIComponent(fontUrl)}`;
                      const fontResp = await fetch(fontProxyUrl);
                      if (fontResp.ok) {
                        const fontBuffer = await fontResp.arrayBuffer();
                        const base64 = btoa(String.fromCharCode(...new Uint8Array(fontBuffer)));
                        const mimeType = fontUrl.endsWith('.woff2') ? 'font/woff2' :
                                        fontUrl.endsWith('.woff') ? 'font/woff' :
                                        fontUrl.endsWith('.ttf') ? 'font/ttf' :
                                        fontUrl.endsWith('.otf') ? 'font/otf' : 'application/octet-stream';
                        resultCss = resultCss.replace(full, `url("data:${mimeType};base64,${base64}")`);
                      }
                    } catch (e) {
                      console.log('[SeaBrowse] Font fetch error:', urlPath, e);
                    }
                  }
                  return resultCss;
                })();
                console.log('[SeaBrowse] Inlined CSS with fonts');
                return { match, replacement: `<style>${finalCss}</style>` };
              }
            } catch (e) {
              console.log('[SeaBrowse] CSS fetch error:', e);
            }
            return { match, replacement: match };
          })());
        }

        const replacements = await Promise.all(cssReplacements);
        for (const { match, replacement } of replacements) {
          result = result.replace(match, replacement);
        }

        const pageScript = `<script>(function(){if(window.__sb)return;window.__sb=true;const s=document.createElement('style');s.textContent='.fc-dialog,.fc-consent-root,.fc-noscroll,.fc-floating-button,[class*="consent"],[id*="consent"],.fc-dialog-overlay,.fc-dialog-container{display:none!important}html,body{overflow:auto!important}';document.head.appendChild(s);function r(){['.fc-dialog','.fc-consent-root','.fc-noscroll','.fc-floating-button','[id*="fc-"]','.fc-dialog-overlay','.fc-dialog-container'].forEach(x=>document.querySelectorAll(x).forEach(e=>e.remove()));}r();setInterval(r,500);document.addEventListener('click',function(e){const a=(e.composedPath?e.composedPath()[0]:e.target).closest?.('a[href]');if(!a)return;const h=a.getAttribute('href');if(!h||h.startsWith('#')||h.startsWith('javascript:'))return;e.preventDefault();e.stopPropagation();try{window.parent.postMessage({type:'seabrowse-navigate',url:new URL(h,document.baseURI).toString()},'*');}catch{window.parent.postMessage({type:'seabrowse-navigate',url:h},'*');}},true);})();<\/script>`;

        // Insert script just before closing </body> or append to end
        const bodyCloseMatch = result.match(/<\/body>/i);
        if (bodyCloseMatch && bodyCloseMatch.index) {
          const idx = bodyCloseMatch.index;
          result = result.slice(0, idx) + pageScript + result.slice(idx);
        } else {
          result = result + pageScript;
        }

        return result;
      } catch {
        return html;
      }
    };

    const normalizeUrl = (input: string): string => {
      const trimmed = (input ?? "").trim();
      if (!trimmed) return "https://anilist.co";
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      // If it's a search query (no dots, has spaces or looks like keywords), use DuckDuckGo
      if (!trimmed.includes('.') || trimmed.includes(' ')) {
        return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}&ia=web`;
      }
      return `https://${trimmed}`;
    };

    const scrapeFullyRenderedHtml = async (url: string): Promise<string> => {
      const browser = await ChromeDP.newBrowser({
        timeout: 30000,
        userAgent: "SeaBrowse/1.0 (Seanime)",
      });

      try {
        await browser.navigate(url);
        await browser.sleep(500);
        const fullHtml = await browser.outerHTML("html");
        return fullHtml;
      } catch (err: any) {
        throw new Error(`ChromeDP error: ${err?.message || String(err)}`);
      } finally {
        await browser.close();
      }
    };

    const panel = ctx.newWebview({
      slot: "screen",
      fullWidth: true,
      autoHeight: true,
      sidebar: {
        label: "  SeaBrowse",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>`,
      },
    });

    panel.channel.sync("lastUrl", lastUrl);
    panel.channel.sync("loading", loading);
    panel.channel.sync("error", error);
    panel.channel.sync("canGoBack", ctx.state<boolean>(false));
    panel.channel.sync("canGoForward", ctx.state<boolean>(false));

    panel.channel.on("navigate-snapshot", async (url: string) => {
      try {
        error.set(null);
        loading.set(true);

        const normalized = normalizeUrl(url);
        lastUrl.set(normalized);
        $storage.set("seabrowse.lastUrl", normalized);

        // Add to history
        const hist = history.get();
        const idx = historyIndex.get();
        // Remove any forward history if we're not at the end
        const newHist = hist.slice(0, idx + 1);
        newHist.push(normalized);
        history.set(newHist);
        historyIndex.set(newHist.length - 1);
        $storage.set("seabrowse.history", newHist);
        $storage.set("seabrowse.historyIndex", newHist.length - 1);
        panel.channel.send("history-state", { canGoBack: newHist.length > 1, canGoForward: false });

        const html = await scrapeFullyRenderedHtml(normalized);
        const withBase = await injectBaseHrefAndInterception(html, normalized);
        panel.channel.send("page-html", withBase);
      } catch (e: any) {
        error.set(String(e?.message ?? e));
      } finally {
        loading.set(false);
      }
    });

    panel.channel.on("follow-link", async (url: string) => {
      try {
        error.set(null);
        loading.set(true);

        const normalized = normalizeUrl(url);
        lastUrl.set(normalized);
        $storage.set("seabrowse.lastUrl", normalized);

        // Add to history
        const hist = history.get();
        const idx = historyIndex.get();
        const newHist = hist.slice(0, idx + 1);
        newHist.push(normalized);
        history.set(newHist);
        historyIndex.set(newHist.length - 1);
        $storage.set("seabrowse.history", newHist);
        $storage.set("seabrowse.historyIndex", newHist.length - 1);
        panel.channel.send("history-state", { canGoBack: newHist.length > 1, canGoForward: false });

        const html = await scrapeFullyRenderedHtml(normalized);
        const withBase = await injectBaseHrefAndInterception(html, normalized);
        panel.channel.send("page-html", withBase);
      } catch (e: any) {
        error.set(String(e?.message ?? e));
      } finally {
        loading.set(false);
      }
    });

    panel.channel.on("go-back", async () => {
      const idx = historyIndex.get();
      if (idx > 0) {
        const newIdx = idx - 1;
        historyIndex.set(newIdx);
        $storage.set("seabrowse.historyIndex", newIdx);
        const hist = history.get();
        const url = hist[newIdx];
        lastUrl.set(url);
        $storage.set("seabrowse.lastUrl", url);
        panel.channel.send("history-state", { canGoBack: newIdx > 0, canGoForward: true });

        try {
          loading.set(true);
          const html = await scrapeFullyRenderedHtml(url);
          const withBase = await injectBaseHrefAndInterception(html, url);
          panel.channel.send("page-html", withBase);
        } catch (e: any) {
          error.set(String(e?.message ?? e));
        } finally {
          loading.set(false);
        }
      }
    });

    panel.channel.on("go-forward", async () => {
      const idx = historyIndex.get();
      const hist = history.get();
      if (idx < hist.length - 1) {
        const newIdx = idx + 1;
        historyIndex.set(newIdx);
        $storage.set("seabrowse.historyIndex", newIdx);
        const url = hist[newIdx];
        lastUrl.set(url);
        $storage.set("seabrowse.lastUrl", url);
        panel.channel.send("history-state", { canGoBack: true, canGoForward: newIdx < hist.length - 1 });

        try {
          loading.set(true);
          const html = await scrapeFullyRenderedHtml(url);
          const withBase = await injectBaseHrefAndInterception(html, url);
          panel.channel.send("page-html", withBase);
        } catch (e: any) {
          error.set(String(e?.message ?? e));
        } finally {
          loading.set(false);
        }
      }
    });

    panel.setContent(() => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html { color-scheme: dark; overflow: hidden; }
    body {
      margin: 0;
      background: transparent;
      font-family: -apple-system, system-ui, sans-serif;
      color: #e2e8f0;
    }
    :root {
      --bg: rgba(15, 23, 42, 0.65);
      --panel: rgba(2, 6, 23, 0.5);
      --border: rgba(148, 163, 184, 0.18);
      --text: #e2e8f0;
      --muted: rgba(226, 232, 240, 0.65);
      --accent: #3b82f6;
      --danger: #ef4444;
    }
    .wrap { padding: 14px; }
    .toolbar {
      display: flex;
      gap: 10px;
      align-items: center;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px;
      backdrop-filter: blur(8px);
    }
    .input {
      flex: 1;
      background: rgba(0,0,0,0.25);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 10px;
      padding: 10px 12px;
      outline: none;
    }
    .btn {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .nav-btn { padding: 10px; background: rgba(59,130,246,0.15); display: flex; align-items: center; justify-content: center; }
    .meta { margin-top: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .loading-bar {
      width: 100%;
      height: 4px;
      background: rgba(59,130,246,0.2);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
      display: none;
    }
    .loading-bar.active { display: block; }
    .loading-bar::after {
      content: '';
      display: block;
      width: 40%;
      height: 100%;
      background: var(--accent);
      border-radius: 2px;
      animation: loadSlide 1s infinite ease-in-out;
    }
    @keyframes loadSlide {
      0% { transform: translateX(-100%); }
      50% { transform: translateX(150%); }
      100% { transform: translateX(-100%); }
    }
    .pill {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .error {
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.35);
    }
    .viewer {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: rgba(0,0,0,0.15);
    }
    iframe { width: 100%; height: 90vh; border: 0; background: #0f172a; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <button id="back" class="btn nav-btn" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
      <button id="forward" class="btn nav-btn" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
      <input id="url" class="input" placeholder="Enter a URL or search..." />
      <button id="go" class="btn">Go</button>
    </div>

    <div class="meta">
      <div id="status" class="pill">Idle</div>
      <div id="err" class="pill error" style="display:none"></div>
    </div>
    <div id="loadingBar" class="loading-bar"></div>

    <div class="viewer">
      <iframe id="frame"></iframe>
    </div>
  </div>

  <script>
    const input = document.getElementById('url');
    const btn = document.getElementById('go');
    const backBtn = document.getElementById('back');
    const forwardBtn = document.getElementById('forward');
    const status = document.getElementById('status');
    const err = document.getElementById('err');
    const frame = document.getElementById('frame');

    let loading = false;

    const loadingBar = document.getElementById('loadingBar');

    function setLoading(v) {
      loading = v;
      btn.disabled = v;
      if (backBtn) backBtn.disabled = v || !canGoBack;
      if (forwardBtn) forwardBtn.disabled = v || !canGoForward;
      if (loadingBar) loadingBar.classList.toggle('active', v);
      status.textContent = v ? 'Loading…' : 'Idle';
    }

    let canGoBack = false;
    let canGoForward = false;

    function updateNavState(state) {
      canGoBack = state.canGoBack;
      canGoForward = state.canGoForward;
      if (backBtn) backBtn.disabled = loading || !canGoBack;
      if (forwardBtn) forwardBtn.disabled = loading || !canGoForward;
    }

    function setError(msg) {
      if (!msg) {
        err.style.display = 'none';
        err.textContent = '';
        return;
      }
      err.style.display = 'inline-block';
      err.textContent = msg;
    }

    function navigate() {
      const url = (input.value || '').trim();
      if (!url) return;
      setError(null);
      setLoading(true);
      window.webview.send('navigate-snapshot', url);
    }

    btn.addEventListener('click', navigate);
    backBtn.addEventListener('click', () => {
      setLoading(true);
      window.webview.send('go-back');
    });
    forwardBtn.addEventListener('click', () => {
      setLoading(true);
      window.webview.send('go-forward');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate();
    });

    // Listen for messages from iframe (link clicks)
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'seabrowse-navigate' && e.data.url) {
        setLoading(true);
        window.webview.send('follow-link', e.data.url);
      }
    });

    if (window.webview) {
      window.webview.on('lastUrl', (v) => { if (typeof v === 'string' && !input.value) input.value = v; });
      window.webview.on('loading', (v) => setLoading(!!v));
      window.webview.on('error', (v) => setError(v || null));
      window.webview.on('history-state', (state) => updateNavState(state));

      window.webview.on('page-html', (html) => {
        try {
          frame.srcdoc = String(html || '');
        } catch (e) {
          setError(String(e));
        }
      });
    }
  </script>
</body>
</html>`);
  });
}
