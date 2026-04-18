function init() {
    $ui.register(async (ctx) => {
        ctx.dom.onReady(async () => {

            const script = await ctx.dom.createElement("script");
            await script.setText(`
(function() {

    const STORAGE_KEY = "seanime_ext_bridge_manifests";

    function getStoredManifests() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
    }

    function saveManifests(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function getStoredExtensions() {
        return getStoredManifests().flatMap(m => m.extensions || []);
    }

    function faviconUrl(baseUrl) {
        try {
            const domain = new URL(baseUrl).hostname;
            return "https://www.google.com/s2/favicons?domain=" + domain + "&sz=64";
        } catch { return ""; }
    }

    function langLabel(lang) {
        if (!lang || lang === "all") return "All languages";
        try { return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang; }
        catch { return lang; }
    }

    function buildExtensionCard(ext) {
        const icon = faviconUrl(ext.baseUrl);
        const lang = langLabel(ext.lang);
        const nsfwHtml = ext.nsfw ? '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(210,50,50,.15);color:#e05555;border:0.5px solid rgba(210,50,50,.3);">18+</span>' : "";
        const iconHtml = icon
            ? '<img src="' + icon + '" width="26" height="26" style="object-fit:contain;" onerror="this.style.display=\'none\'" />'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';

        return '<div style="position:relative;overflow:hidden;background:rgba(255,255,255,.03);border-radius:12px;padding:12px;border:1px solid rgba(255,255,255,.07);">'
            + '<div style="display:flex;gap:10px;align-items:flex-start;">'
            + '<div style="width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,.05);flex-shrink:0;display:flex;align-items:center;justify-content:center;">' + iconHtml + '</div>'
            + '<div style="min-width:0;flex:1;">'
            + '<p style="margin:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ext.name + '</p>'
            + '<p style="margin:3px 0 0;font-size:11px;opacity:.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (ext.pkg || "") + '</p>'
            + '</div></div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;align-items:center;">'
            + '<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;border:0.5px solid rgba(255,255,255,.12);opacity:.7;">' + (ext.version || "?") + '</span>'
            + '<span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;border:0.5px solid rgba(100,160,255,.25);color:rgba(140,175,255,.85);">' + (ext.ecosystem || "Tachiyomi") + '</span>'
            + '<span style="font-size:11px;opacity:.4;">' + lang + '</span>'
            + nsfwHtml
            + '</div>'
            + '</div>';
    }

    async function fetchManifest(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const arr = Array.isArray(data) ? data : [data];
        return arr.map(function(ext) {
            return Object.assign({}, ext, {
                baseUrl: (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "",
                ecosystem: "Tachiyomi",
                _manifestUrl: url,
            });
        });
    }

    function openAddModal(onSave) {
        var existing = document.getElementById("ext-bridge-overlay");
        if (existing) existing.remove();

        var overlay = document.createElement("div");
        overlay.id = "ext-bridge-overlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;";
        overlay.innerHTML = '<div style="background:#13161c;border-radius:14px;border:1px solid rgba(255,255,255,.1);padding:24px;width:460px;max-width:calc(100vw - 32px);">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
            + '<h3 style="margin:0;font-size:15px;font-weight:600;">Add extension manifest</h3>'
            + '<button id="ebm-close" style="background:none;border:none;cursor:pointer;font-size:18px;line-height:1;opacity:.4;color:inherit;">&#x2715;</button>'
            + '</div>'
            + '<p style="margin:0 0 12px;font-size:13px;opacity:.45;line-height:1.5;">Paste the URL of a Tachiyomi-compatible manifest (JSON array).</p>'
            + '<input id="ebm-input" type="text" placeholder="https://raw.githubusercontent.com/…/index.json" style="width:100%;box-sizing:border-box;background:#0d0f13;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px 12px;font-size:13px;color:inherit;outline:none;margin-bottom:8px;" />'
            + '<div id="ebm-status" style="font-size:12px;color:#e05555;min-height:16px;margin-bottom:14px;"></div>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
            + '<button id="ebm-cancel" style="background:none;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 16px;font-size:13px;color:inherit;cursor:pointer;opacity:.6;">Cancel</button>'
            + '<button id="ebm-save" style="background:rgba(99,130,255,.15);border:1px solid rgba(99,130,255,.3);border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;color:rgba(140,165,255,.95);cursor:pointer;">Load</button>'
            + '</div></div>';

        document.body.appendChild(overlay);

        var close = function() { overlay.remove(); };
        overlay.querySelector("#ebm-close").onclick = close;
        overlay.querySelector("#ebm-cancel").onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };

        var saveBtn = overlay.querySelector("#ebm-save");
        var status  = overlay.querySelector("#ebm-status");
        var input   = overlay.querySelector("#ebm-input");

        saveBtn.onclick = async function() {
            var url = input.value.trim();
            if (!url) { status.textContent = "Please enter a URL."; return; }
            saveBtn.textContent = "Loading\u2026";
            saveBtn.disabled = true;
            status.textContent = "";
            try {
                var extensions = await fetchManifest(url);
                var manifests = getStoredManifests();
                if (manifests.find(function(m) { return m.url === url; })) {
                    status.textContent = "This manifest is already added.";
                    saveBtn.textContent = "Load"; saveBtn.disabled = false; return;
                }
                manifests.push({ url: url, extensions: extensions, addedAt: Date.now() });
                saveManifests(manifests);
                close();
                onSave();
            } catch(e) {
                status.textContent = "Failed: " + e.message;
                saveBtn.textContent = "Load"; saveBtn.disabled = false;
            }
        };
        setTimeout(function() { input.focus(); }, 50);
    }

    function buildSection() {
        var extensions = getStoredExtensions();
        var section = document.createElement("div");
        section.id = "ext-bridge-section";

        var cardsHtml = extensions.length === 0
            ? '<p style="margin:12px 0 0;font-size:13px;opacity:.3;line-height:1.5;">No external extensions yet. Click <strong style="font-weight:600;opacity:.8;">Add extension</strong> to load a Tachiyomi manifest.</p>'
            : '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:16px;">' + extensions.map(buildExtensionCard).join("") + '</div>';

        section.innerHTML = '<div style="border-radius:12px;border:1px solid rgba(255,255,255,.07);padding:16px;margin-top:16px;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;">'
            + '<h3 style="margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;">'
            + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.6;flex-shrink:0;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>'
            + 'External extensions</h3>'
            + '<button id="ext-bridge-add-btn" style="display:inline-flex;align-items:center;gap:6px;background:rgba(99,130,255,.12);border:1px solid rgba(99,130,255,.25);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;color:rgba(140,165,255,.9);cursor:pointer;white-space:nowrap;">'
            + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            + 'Add extension</button>'
            + '</div>'
            + cardsHtml
            + '</div>';

        section.querySelector("#ext-bridge-add-btn").onclick = function() {
            openAddModal(function() {
                var old = document.getElementById("ext-bridge-section");
                if (old) old.replaceWith(buildSection());
            });
        };

        return section;
    }

    function tryInject() {
        if (!window.location.pathname.startsWith("/extensions")) return;
        if (document.getElementById("ext-bridge-section")) return;

        var allH3 = Array.from(document.querySelectorAll("h3"));
        var streamingH3 = allH3.find(function(h) {
            return h.textContent.toLowerCase().includes("online streaming");
        });
        if (!streamingH3) return;

        var card = streamingH3.closest('[class*="Card"]')
            || streamingH3.closest('[class*="card"]')
            || streamingH3.parentElement.parentElement;

        card.insertAdjacentElement("afterend", buildSection());
    }

    function onNavigate() {
        if (!window.location.pathname.startsWith("/extensions")) {
            var s = document.getElementById("ext-bridge-section");
            if (s) s.remove();
            return;
        }
        // poll until the streaming card appears
        var attempts = 0;
        var poll = setInterval(function() {
            tryInject();
            attempts++;
            if (document.getElementById("ext-bridge-section") || attempts > 60) {
                clearInterval(poll);
            }
        }, 100);
    }

    // patch History API
    ["pushState", "replaceState"].forEach(function(fn) {
        var orig = history[fn].bind(history);
        history[fn] = function() {
            orig.apply(history, arguments);
            onNavigate();
        };
    });
    window.addEventListener("popstate", onNavigate);

    // fire immediately in case the page is already on /extensions
    onNavigate();

})();
`);

            const body = await ctx.dom.queryOne("body");
            if (body) await body.append(script);
        });
    });
}
