function init() {
    $ui.register(async (ctx) => {
        ctx.dom.onReady(async () => {

            const STORAGE_KEY = "seanime_ext_bridge_manifests";
            const INJECTED_KEY = "seanime_ext_bridge_injected";

            // ─── helpers ────────────────────────────────────────────────────

            function getStoredManifests() {
                try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
            }

            function saveManifests(list) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            }

            function getStoredExtensions() {
                const manifests = getStoredManifests();
                return manifests.flatMap(m => m.extensions || []);
            }

            function faviconUrl(baseUrl) {
                try {
                    const domain = new URL(baseUrl).hostname;
                    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                } catch { return ""; }
            }

            function langLabel(lang) {
                if (!lang || lang === "all") return "All languages";
                try {
                    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang;
                } catch { return lang; }
            }

            function nsfwBadge(nsfw) {
                return nsfw ? `<span style="
                    display:inline-flex;align-items:center;
                    font-size:10px;font-weight:600;letter-spacing:.04em;
                    padding:2px 7px;border-radius:4px;
                    background:rgba(210,50,50,.15);color:#e05555;border:0.5px solid rgba(210,50,50,.3);
                ">18+</span>` : "";
            }

            function buildExtensionCard(ext) {
                const icon = faviconUrl(ext.baseUrl);
                const lang = langLabel(ext.lang);
                const nsfw = nsfwBadge(ext.nsfw);
                return `
                <div style="
                    position:relative;overflow:hidden;
                    background:#111318;border-radius:12px;padding:12px;
                    border:1px solid rgba(255,255,255,.06);
                ">
                    <div style="position:absolute;right:0;top:0;height:100%;width:150px;
                        background:linear-gradient(to left,rgba(15,17,22,.9),transparent);pointer-events:none;z-index:0;"></div>
                    <div style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%;">
                        <div style="display:flex;gap:12px;align-items:flex-start;padding-right:8px;">
                            <div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:#1a1d24;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                                ${icon
                                    ? `<img src="${icon}" width="28" height="28" onerror="this.style.display='none'" style="object-fit:contain;" />`
                                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>`
                                }
                            </div>
                            <div style="min-width:0;flex:1;">
                                <p style="margin:0;font-size:13px;font-weight:600;color:rgba(255,255,255,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ext.name}</p>
                                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ext.pkg || ""}</p>
                            </div>
                        </div>
                        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:12px;align-items:center;">
                            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;border:0.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.6);">${ext.version || "?"}</span>
                            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;border:0.5px solid rgba(100,160,255,.25);color:rgba(120,170,255,.8);">${ext.ecosystem || "Tachiyomi"}</span>
                            <span style="font-size:11px;color:rgba(255,255,255,.4);padding:2px 0;">${lang}</span>
                            ${nsfw}
                        </div>
                    </div>
                </div>`;
            }

            async function fetchManifest(url) {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const arr = Array.isArray(data) ? data : [data];
                return arr.map(ext => ({
                    ...ext,
                    baseUrl: ext.sources?.[0]?.baseUrl || ext.baseUrl || "",
                    ecosystem: "Tachiyomi",
                    _manifestUrl: url,
                }));
            }

            // ─── modal ──────────────────────────────────────────────────────

            function openAddModal(onSave) {
                const overlay = document.getElementById("ext-bridge-overlay");
                if (overlay) overlay.remove();

                const el = document.createElement("div");
                el.id = "ext-bridge-overlay";
                el.style.cssText = `
                    position:fixed;inset:0;z-index:9999;
                    background:rgba(0,0,0,.65);
                    display:flex;align-items:center;justify-content:center;
                `;
                el.innerHTML = `
                <div id="ext-bridge-modal" style="
                    background:#13161c;border-radius:14px;
                    border:1px solid rgba(255,255,255,.1);
                    padding:24px;width:480px;max-width:calc(100vw - 32px);
                    box-shadow:0 24px 48px rgba(0,0,0,.5);
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
                        <h3 style="margin:0;font-size:15px;font-weight:600;color:rgba(255,255,255,.9);">Add extension manifest</h3>
                        <button id="ext-bridge-close" style="
                            background:none;border:none;cursor:pointer;padding:4px;
                            color:rgba(255,255,255,.4);font-size:18px;line-height:1;
                        ">✕</button>
                    </div>
                    <p style="margin:0 0 14px;font-size:13px;color:rgba(255,255,255,.45);line-height:1.5;">
                        Paste the URL of a Tachiyomi-compatible extension manifest (JSON array of extensions).
                    </p>
                    <input id="ext-bridge-url-input" type="text" placeholder="https://raw.githubusercontent.com/…/index.json"
                        style="
                            width:100%;box-sizing:border-box;
                            background:#0d0f13;border:1px solid rgba(255,255,255,.12);
                            border-radius:8px;padding:10px 12px;
                            font-size:13px;color:rgba(255,255,255,.85);
                            outline:none;margin-bottom:10px;
                        " />
                    <div id="ext-bridge-modal-status" style="font-size:12px;color:rgba(255,100,100,.8);min-height:18px;margin-bottom:14px;"></div>
                    <div style="display:flex;justify-content:flex-end;gap:8px;">
                        <button id="ext-bridge-cancel" style="
                            background:none;border:1px solid rgba(255,255,255,.12);
                            border-radius:8px;padding:8px 16px;
                            font-size:13px;font-weight:500;color:rgba(255,255,255,.5);cursor:pointer;
                        ">Cancel</button>
                        <button id="ext-bridge-save" style="
                            background:rgba(99,130,255,.2);border:1px solid rgba(99,130,255,.35);
                            border-radius:8px;padding:8px 20px;
                            font-size:13px;font-weight:600;color:rgba(140,165,255,.95);cursor:pointer;
                        ">Load</button>
                    </div>
                </div>`;

                document.body.appendChild(el);

                const close = () => el.remove();
                el.querySelector("#ext-bridge-close").onclick = close;
                el.querySelector("#ext-bridge-cancel").onclick = close;
                el.onclick = (e) => { if (e.target === el) close(); };

                const saveBtn = el.querySelector("#ext-bridge-save");
                const status = el.querySelector("#ext-bridge-modal-status");
                const input = el.querySelector("#ext-bridge-url-input");

                saveBtn.onclick = async () => {
                    const url = input.value.trim();
                    if (!url) { status.textContent = "Please enter a URL."; return; }
                    saveBtn.textContent = "Loading…";
                    saveBtn.disabled = true;
                    status.textContent = "";
                    try {
                        const extensions = await fetchManifest(url);
                        const manifests = getStoredManifests();
                        const exists = manifests.find(m => m.url === url);
                        if (exists) { status.textContent = "This manifest is already added."; saveBtn.textContent = "Load"; saveBtn.disabled = false; return; }
                        manifests.push({ url, extensions, addedAt: Date.now() });
                        saveManifests(manifests);
                        close();
                        onSave();
                    } catch (e) {
                        status.textContent = `Failed to load: ${e.message}`;
                        saveBtn.textContent = "Load";
                        saveBtn.disabled = false;
                    }
                };
                setTimeout(() => input.focus(), 50);
            }

            // ─── settings section injection ──────────────────────────────────

            async function injectExtensionsSection() {
                if (document.getElementById("ext-bridge-section")) return;

                // wait for streaming card to appear
                const streamingCard = await waitFor(() =>
                    [...document.querySelectorAll("h3")].find(h => h.textContent.includes("Online streaming"))
                        ?.closest(".UI-Card__root, [class*='Card'], [class*='card']") ||
                    [...document.querySelectorAll("h3")].find(h => h.textContent.includes("Online streaming"))
                        ?.parentElement?.parentElement
                , 5000);

                if (!streamingCard) return;

                const section = document.createElement("div");
                section.id = "ext-bridge-section";
                section.style.cssText = "margin-top:16px;";

                function renderSection() {
                    const extensions = getStoredExtensions();
                    const isEmpty = extensions.length === 0;

                    section.innerHTML = `
                    <div style="
                        border-radius:12px;border:1px solid rgba(255,255,255,.07);
                        background:var(--paper,#13161c);
                        box-shadow:0 1px 3px rgba(0,0,0,.2);
                        padding:16px;
                    ">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isEmpty ? "0" : "16px"};">
                            <h3 style="margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;color:inherit;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.7;">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                                </svg>
                                External extensions
                            </h3>
                            <button id="ext-bridge-add-btn" style="
                                display:inline-flex;align-items:center;gap:6px;
                                background:rgba(99,130,255,.12);
                                border:1px solid rgba(99,130,255,.25);
                                border-radius:8px;padding:6px 14px;
                                font-size:12px;font-weight:600;color:rgba(140,165,255,.9);
                                cursor:pointer;white-space:nowrap;
                            ">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                Add extension
                            </button>
                        </div>
                        ${isEmpty ? `
                            <p style="margin:12px 0 0;font-size:13px;color:rgba(255,255,255,.3);line-height:1.5;">
                                No external extensions added yet. Click <strong style="color:rgba(255,255,255,.45);font-weight:600;">Add extension</strong> to load a Tachiyomi-compatible manifest.
                            </p>
                        ` : `
                            <div style="
                                display:grid;
                                grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
                                gap:10px;
                            ">
                                ${extensions.map(buildExtensionCard).join("")}
                            </div>
                        `}
                    </div>`;

                    section.querySelector("#ext-bridge-add-btn").onclick = () =>
                        openAddModal(renderSection);
                }

                renderSection();
                streamingCard.insertAdjacentElement("afterend", section);
            }

            // ─── route watcher ───────────────────────────────────────────────

            function waitFor(fn, timeout = 3000) {
                return new Promise((resolve, reject) => {
                    const start = Date.now();
                    const tick = () => {
                        const result = fn();
                        if (result) return resolve(result);
                        if (Date.now() - start > timeout) return reject(new Error("waitFor timeout"));
                        requestAnimationFrame(tick);
                    };
                    tick();
                });
            }

            let lastPath = location.pathname + location.search;

            function onRouteChange() {
                const path = location.pathname + location.search;
                if (path === lastPath) return;
                lastPath = path;
                if (path.includes("/settings")) {
                    setTimeout(() => injectExtensionsSection(), 400);
                }
            }

            // intercept History API
            const _pushState = history.pushState.bind(history);
            const _replaceState = history.replaceState.bind(history);
            history.pushState = (...args) => { _pushState(...args); onRouteChange(); };
            history.replaceState = (...args) => { _replaceState(...args); onRouteChange(); };
            window.addEventListener("popstate", onRouteChange);

            // also poll for SPA navigations that don't use History API
            setInterval(onRouteChange, 500);

            // run immediately if already on settings
            if (location.pathname.includes("/settings")) {
                setTimeout(() => injectExtensionsSection(), 600);
            }
        });
    });
}
