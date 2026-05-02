/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
  $ui.register((ctx) => {
    const lastUrl = ctx.state<string>($storage.get("seabrowse.lastUrl") ?? "https://anilist.co");
    const loading = ctx.state<boolean>(false);
    const error = ctx.state<string | null>(null);

    const panel = ctx.newWebview({
      slot: "screen",
      fullWidth: true,
      autoHeight: true,
      sidebar: {
        label: "SeaBrowse",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>`,
      },
    });

    panel.channel.sync("lastUrl", lastUrl);
    panel.channel.sync("loading", loading);
    panel.channel.sync("error", error);

    panel.channel.on("navigate", async (url: string) => {
      try {
        error.set(null);
        loading.set(true);

        const normalized = normalizeUrl(url);
        lastUrl.set(normalized);
        $storage.set("seabrowse.lastUrl", normalized);

        const html = await scrapeFullyRenderedHtml(normalized);
        panel.channel.send("page-html", html);
      } catch (e: any) {
        error.set(String(e?.message ?? e));
      } finally {
        loading.set(false);
      }
    });

    panel.setContent(() => webviewHtml());
  });
}

function normalizeUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "https://anilist.co";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function scrapeFullyRenderedHtml(url: string): Promise<string> {
  const browser = await ChromeDP.newBrowser({
    timeout: 60000,
    userAgent: "SeaBrowse/1.0 (Seanime)",
  });

  try {
    await browser.navigate(url);
    await browser.sleep(1000);

    const html = await browser.html();
    return html;
  } finally {
    await browser.close();
  }
}

function webviewHtml(): string {
  return `<!DOCTYPE html>
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
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .meta { margin-top: 10px; display: flex; gap: 10px; align-items: center; }
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
    iframe { width: 100%; height: 74vh; border: 0; background: white; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <input id="url" class="input" placeholder="Enter a URL (e.g. anilist.co)" />
      <button id="go" class="btn">Go</button>
    </div>

    <div class="meta">
      <div id="status" class="pill">Idle</div>
      <div id="err" class="pill error" style="display:none"></div>
    </div>

    <div class="viewer">
      <iframe id="frame" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
    </div>
  </div>

  <script>
    const input = document.getElementById('url');
    const btn = document.getElementById('go');
    const status = document.getElementById('status');
    const err = document.getElementById('err');
    const frame = document.getElementById('frame');

    let loading = false;

    function setLoading(v) {
      loading = v;
      btn.disabled = v;
      status.textContent = v ? 'Loading… (rendering with ChromeDP)' : 'Idle';
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
      window.webview.send('navigate', url);
    }

    btn.addEventListener('click', navigate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate();
    });

    if (window.webview) {
      window.webview.on('lastUrl', (v) => { if (typeof v === 'string' && !input.value) input.value = v; });
      window.webview.on('loading', (v) => setLoading(!!v));
      window.webview.on('error', (v) => setError(v || null));

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
</html>`;
}
