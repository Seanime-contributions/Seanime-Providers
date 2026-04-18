function init() {
    $ui.register(async (ctx) => {
        ctx.dom.onReady(async () => {

            const script = await ctx.dom.createElement("script");

            const code = `
(function() {

    const STORAGE_KEY = "seanime_ext_bridge_installed";

    // ── storage helpers ───────────────────────────────────────────────────────

    function getInstalled() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
    }
    function saveInstalled(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    function isInstalled(pkg) {
        return getInstalled().some(function(e) { return e.pkg === pkg; });
    }
    function installExt(ext) {
        var list = getInstalled();
        if (!list.some(function(e) { return e.pkg === ext.pkg; })) {
            list.push(ext);
            saveInstalled(list);
        }
    }
    function uninstallExt(pkg) {
        saveInstalled(getInstalled().filter(function(e) { return e.pkg !== pkg; }));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function faviconUrl(baseUrl) {
        try {
            var domain = new URL(baseUrl).hostname;
            return "https://www.google.com/s2/favicons?domain=" + domain + "&sz=64";
        } catch(e) { return ""; }
    }

    function langLabel(lang) {
        if (!lang || lang === "all") return "All";
        try { return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang; }
        catch(e) { return lang; }
    }

    // ── inject global styles (once) ───────────────────────────────────────────

    if (!document.getElementById("ext-bridge-styles")) {
        var styleEl = document.createElement("style");
        styleEl.id = "ext-bridge-styles";
        styleEl.textContent = [
            "@keyframes ext-fade-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}",
            "@keyframes ext-fade-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.97)}}",
            "@keyframes ext-overlay-in{from{opacity:0}to{opacity:1}}",
            "@keyframes ext-overlay-out{from{opacity:1}to{opacity:0}}",
            ".ext-modal-enter{animation:ext-fade-in .18s cubic-bezier(.22,1,.36,1) forwards}",
            ".ext-modal-leave{animation:ext-fade-out .15s ease forwards}",
            ".ext-overlay-enter{animation:ext-overlay-in .18s ease forwards}",
            ".ext-overlay-leave{animation:ext-overlay-out .15s ease forwards}",
            ".ext-row{transition:background .1s,border-color .1s}",
            ".ext-row:hover{background:rgba(255,255,255,.045)!important}",
            ".ext-btn-ghost{transition:background .1s,opacity .1s}",
            ".ext-btn-ghost:hover{background:rgba(255,255,255,.07)!important;opacity:1!important}",
            ".ext-installed-card{transition:border-color .15s}",
            ".ext-installed-card:hover{border-color:rgba(255,255,255,.14)!important}",
            ".ext-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:rgba(140,165,255,.7);border-radius:50%;animation:ext-spin .7s linear infinite}",
            "@keyframes ext-spin{to{transform:rotate(360deg)}}"
        ].join("");
        document.head.appendChild(styleEl);
    }

    // ── close overlay with animation ──────────────────────────────────────────

    function closeOverlay(overlay, modal) {
        overlay.classList.add("ext-overlay-leave");
        modal.classList.add("ext-modal-leave");
        setTimeout(function() { overlay.remove(); }, 160);
    }

    // ── badge factory ─────────────────────────────────────────────────────────

    function makeBadge(text, style) {
        var b = document.createElement("span");
        b.style.cssText = "display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;border:0.5px solid;font-size:11px;font-weight:600;letter-spacing:.02em;white-space:nowrap;" + (style || "border-color:rgba(255,255,255,.12);color:rgba(255,255,255,.45);");
        b.textContent = text;
        return b;
    }

    // ── installed card ────────────────────────────────────────────────────────

    function buildInstalledCard(ext, onUninstall) {
        var baseUrl = (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "";
        var icon = faviconUrl(baseUrl);
        var lang = langLabel(ext.lang);

        var card = document.createElement("div");
        card.className = "ext-installed-card";
        card.style.cssText = "position:relative;background:rgba(255,255,255,.03);border-radius:12px;padding:14px;border:0.5px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:10px;";

        var top = document.createElement("div");
        top.style.cssText = "display:flex;gap:10px;align-items:flex-start;";

        var iconWrap = document.createElement("div");
        iconWrap.style.cssText = "width:44px;height:44px;border-radius:10px;background:rgba(255,255,255,.06);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border:0.5px solid rgba(255,255,255,.08);";
        if (icon) {
            var img = document.createElement("img");
            img.src = icon;
            img.width = 28;
            img.height = 28;
            img.loading = "lazy";
            img.decoding = "async";
            img.style.cssText = "object-fit:contain;";
            iconWrap.appendChild(img);
        } else {
            iconWrap.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
        }

        var info = document.createElement("div");
        info.style.cssText = "min-width:0;flex:1;";

        var name = document.createElement("p");
        name.style.cssText = "margin:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        name.textContent = ext.name;

        var pkgEl = document.createElement("p");
        pkgEl.style.cssText = "margin:3px 0 0;font-size:11px;opacity:.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        pkgEl.textContent = ext.pkg || "";

        info.appendChild(name);
        info.appendChild(pkgEl);
        top.appendChild(iconWrap);
        top.appendChild(info);

        var badges = document.createElement("div");
        badges.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;align-items:center;";
        badges.appendChild(makeBadge(ext.version || "?"));
        badges.appendChild(makeBadge("Tachiyomi", "border-color:rgba(100,160,255,.25);color:rgba(140,175,255,.85);"));
        badges.appendChild(makeBadge(lang));
        if (ext.nsfw) {
            badges.appendChild(makeBadge("18+", "border-color:rgba(210,50,50,.3);color:#e05555;background:rgba(210,50,50,.1);"));
        }

        var removeBtn = document.createElement("button");
        removeBtn.className = "ext-btn-ghost";
        removeBtn.style.cssText = "margin-top:auto;width:100%;background:rgba(200,50,50,.06);border:0.5px solid rgba(200,50,50,.2);border-radius:8px;padding:7px;font-size:12px;font-weight:600;color:rgba(220,100,100,.7);cursor:pointer;";
        removeBtn.textContent = "Remove";
        removeBtn.onclick = function() {
            uninstallExt(ext.pkg);
            onUninstall();
        };

        card.appendChild(top);
        card.appendChild(badges);
        card.appendChild(removeBtn);
        return card;
    }

    // ── picker modal (browse extensions) ─────────────────────────────────────

    function openPickerModal(manifestUrl, onDone) {
        var existing = document.getElementById("ext-picker-overlay");
        if (existing) existing.remove();

        var allExts = [];
        var filtered = [];
        var selectedPkgs = {};
        var searchTimer = null;

        var overlay = document.createElement("div");
        overlay.id = "ext-picker-overlay";
        overlay.className = "ext-overlay-enter";
        overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;";

        var modal = document.createElement("div");
        modal.className = "ext-modal-enter";
        // height:86vh with flex-direction:column lets the list actually fill space
        modal.style.cssText = "background:var(--background,#13161c);border-radius:14px;border:0.5px solid rgba(255,255,255,.07);width:600px;max-width:100%;height:86vh;max-height:700px;display:flex;flex-direction:column;overflow:hidden;";

        // ── header (matches native dialog: icon + title + close ×) ──
        var header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:12px;padding:18px 18px 14px;flex-shrink:0;border-bottom:0.5px solid rgba(255,255,255,.06);position:relative;";

        var headerIcon = document.createElement("div");
        headerIcon.style.cssText = "width:40px;height:40px;border-radius:9px;background:rgba(255,255,255,.05);border:0.5px solid rgba(255,255,255,.09);flex-shrink:0;display:flex;align-items:center;justify-content:center;";
        headerIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(140,165,255,.65)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

        var headerText = document.createElement("div");
        headerText.style.cssText = "flex:1;min-width:0;";

        var titleEl = document.createElement("p");
        titleEl.style.cssText = "margin:0;font-size:15px;font-weight:600;";
        titleEl.textContent = "Browse extensions";

        var titleSub = document.createElement("p");
        titleSub.style.cssText = "margin:2px 0 0;font-size:12px;opacity:.38;";
        titleSub.textContent = "Select extensions to install from the manifest";

        headerText.appendChild(titleEl);
        headerText.appendChild(titleSub);

        var closeBtn = document.createElement("button");
        closeBtn.className = "ext-btn-ghost";
        closeBtn.style.cssText = "position:absolute;right:14px;top:14px;width:28px;height:28px;border-radius:50%;border:0.5px solid transparent;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:inherit;opacity:.4;";
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

        header.appendChild(headerIcon);
        header.appendChild(headerText);
        header.appendChild(closeBtn);

        // ── search + status (fixed, never scrolls) ──
        var searchWrap = document.createElement("div");
        searchWrap.style.cssText = "padding:12px 18px 0;flex-shrink:0;";

        var searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search by name, language or package ID...";
        searchInput.style.cssText = "width:100%;box-sizing:border-box;background:rgba(255,255,255,.03);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;color:inherit;outline:none;";
        searchWrap.appendChild(searchInput);

        var statusBar = document.createElement("div");
        statusBar.style.cssText = "padding:8px 18px 6px;font-size:12px;opacity:.35;flex-shrink:0;display:flex;align-items:center;gap:8px;";

        var statusText = document.createElement("span");
        statusText.textContent = "Loading...";
        statusBar.appendChild(statusText);

        var spinnerEl = document.createElement("div");
        spinnerEl.className = "ext-spinner";
        statusBar.appendChild(spinnerEl);

        // ── scrollable list — flex:1 + min-height:0 is the key fix ──
        var listWrap = document.createElement("div");
        listWrap.style.cssText = "flex:1;min-height:0;overflow-y:auto;padding:0 18px 8px;display:flex;flex-direction:column;gap:3px;";

        var footer = document.createElement("div");
        footer.style.cssText = "padding:12px 18px;border-top:0.5px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:8px;";

        var selectedCount = document.createElement("span");
        selectedCount.style.cssText = "font-size:12px;opacity:.38;";
        selectedCount.textContent = "0 selected";

        var footerRight = document.createElement("div");
        footerRight.style.cssText = "display:flex;gap:8px;";

        var cancelFooterBtn = document.createElement("button");
        cancelFooterBtn.className = "ext-btn-ghost";
        cancelFooterBtn.style.cssText = "background:transparent;border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 14px;font-size:13px;color:inherit;cursor:pointer;opacity:.6;";
        cancelFooterBtn.textContent = "Cancel";

        var installBtn = document.createElement("button");
        installBtn.style.cssText = "background:rgba(99,130,255,.15);border:0.5px solid rgba(99,130,255,.3);border-radius:8px;padding:7px 18px;font-size:13px;font-weight:600;color:rgba(140,165,255,.95);cursor:pointer;opacity:.35;pointer-events:none;transition:opacity .15s;";
        installBtn.textContent = "Install selected";

        footerRight.appendChild(cancelFooterBtn);
        footerRight.appendChild(installBtn);
        footer.appendChild(selectedCount);
        footer.appendChild(footerRight);

        modal.appendChild(header);
        modal.appendChild(searchWrap);
        modal.appendChild(statusBar);
        modal.appendChild(listWrap);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        var doClose = function() { closeOverlay(overlay, modal); document.removeEventListener("keydown", onKeyDown); };

        closeBtn.onclick = doClose;
        cancelFooterBtn.onclick = doClose;
        overlay.onclick = function(e) { if (e.target === overlay) doClose(); };

        // ESC key
        var onKeyDown = function(e) { if (e.key === "Escape") doClose(); };
        document.addEventListener("keydown", onKeyDown);

        function updateFooter() {
            var count = Object.keys(selectedPkgs).filter(function(k) { return selectedPkgs[k]; }).length;
            selectedCount.textContent = count + " selected";
            installBtn.style.opacity = count > 0 ? "1" : ".35";
            installBtn.style.pointerEvents = count > 0 ? "auto" : "none";
        }

        // Render rows via DocumentFragment for performance
        function renderList() {
            var query = searchInput.value.toLowerCase().trim();
            filtered = query
                ? allExts.filter(function(e) {
                    return e.name.toLowerCase().includes(query)
                        || (e.pkg || "").toLowerCase().includes(query)
                        || langLabel(e.lang).toLowerCase().includes(query);
                })
                : allExts;

            statusText.textContent = filtered.length + " extension" + (filtered.length !== 1 ? "s" : "");
            spinnerEl.style.display = "none";

            var frag = document.createDocumentFragment();

            if (filtered.length === 0) {
                var empty = document.createElement("p");
                empty.style.cssText = "text-align:center;opacity:.3;font-size:13px;padding:32px 0;";
                empty.textContent = "No extensions match your search.";
                frag.appendChild(empty);
            } else {
                for (var i = 0; i < filtered.length; i++) {
                    frag.appendChild(renderRow(filtered[i]));
                }
            }

            listWrap.innerHTML = "";
            listWrap.appendChild(frag);
        }

        function renderRow(ext) {
            var baseUrl = (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "";
            var icon = faviconUrl(baseUrl);
            var installed = isInstalled(ext.pkg);
            var selected = !!selectedPkgs[ext.pkg];

            var row = document.createElement("div");
            row.className = "ext-row";
            row.style.cssText = "display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:0.5px solid "
                + (selected ? "rgba(99,130,255,.4)" : "rgba(255,255,255,.06)")
                + ";background:" + (selected ? "rgba(99,130,255,.07)" : "rgba(255,255,255,.015)")
                + ";cursor:" + (installed ? "default" : "pointer") + ";";

            var iconWrap = document.createElement("div");
            iconWrap.style.cssText = "width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.05);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border:0.5px solid rgba(255,255,255,.07);";
            if (icon) {
                var img = document.createElement("img");
                img.src = icon;
                img.width = 20;
                img.height = 20;
                img.loading = "lazy";
                img.decoding = "async";
                img.style.cssText = "object-fit:contain;";
                iconWrap.appendChild(img);
            } else {
                iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
            }

            var info = document.createElement("div");
            info.style.cssText = "flex:1;min-width:0;";

            var rowName = document.createElement("p");
            rowName.style.cssText = "margin:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            rowName.textContent = ext.name;

            var meta = document.createElement("p");
            meta.style.cssText = "margin:2px 0 0;font-size:11px;opacity:.35;";
            meta.textContent = langLabel(ext.lang) + " \u00b7 v" + (ext.version || "?");

            info.appendChild(rowName);
            info.appendChild(meta);

            var rightSide = document.createElement("div");
            rightSide.style.cssText = "flex-shrink:0;display:flex;align-items:center;gap:6px;";

            if (ext.nsfw) {
                rightSide.appendChild(makeBadge("18+", "border-color:rgba(210,50,50,.3);color:#e05555;background:rgba(210,50,50,.1);"));
            }

            if (installed) {
                rightSide.appendChild(makeBadge("Installed", "border-color:rgba(50,180,100,.25);color:rgba(80,200,120,.8);background:rgba(50,180,100,.08);"));
            } else {
                var checkbox = document.createElement("div");
                checkbox.style.cssText = "width:17px;height:17px;border-radius:5px;border:1.5px solid "
                    + (selected ? "rgba(99,130,255,.9)" : "rgba(255,255,255,.2)")
                    + ";background:" + (selected ? "rgba(99,130,255,.45)" : "transparent")
                    + ";display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .1s,background .1s;";
                if (selected) {
                    checkbox.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>';
                }
                rightSide.appendChild(checkbox);

                row.onclick = function() {
                    selectedPkgs[ext.pkg] = !selectedPkgs[ext.pkg];
                    renderList();
                    updateFooter();
                };
            }

            row.appendChild(iconWrap);
            row.appendChild(info);
            row.appendChild(rightSide);
            return row;
        }

        // Debounced search for performance
        searchInput.oninput = function() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(renderList, 120);
        };

        installBtn.onclick = function() {
            Object.keys(selectedPkgs).forEach(function(pkg) {
                if (!selectedPkgs[pkg]) return;
                var ext = allExts.find(function(e) { return e.pkg === pkg; });
                if (ext) installExt(ext);
            });
            doClose();
            onDone();
        };

        fetch(manifestUrl)
            .then(function(r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function(data) {
                allExts = (Array.isArray(data) ? data : [data]).map(function(ext) {
                    return Object.assign({}, ext, {
                        baseUrl: (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "",
                        ecosystem: "Tachiyomi",
                    });
                });
                renderList();
                setTimeout(function() { searchInput.focus(); }, 50);
            })
            .catch(function(e) {
                statusText.textContent = "Failed to load: " + e.message;
                spinnerEl.style.display = "none";
            });
    }

    // ── add manifest modal (redesigned to match native Seanime style) ─────────

    function openAddModal(onDone) {
        var existing = document.getElementById("ext-bridge-overlay");
        if (existing) existing.remove();

        var overlay = document.createElement("div");
        overlay.id = "ext-bridge-overlay";
        overlay.className = "ext-overlay-enter";
        overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;";

        // Modal matches Seanime's UI-Modal__content style
        var modal = document.createElement("div");
        modal.className = "ext-modal-enter";
        modal.style.cssText = "position:relative;background:var(--background,#13161c);border-radius:14px;border:0.5px solid rgba(255,255,255,.07);padding:24px;width:480px;max-width:calc(100vw - 32px);display:grid;gap:16px;";

        // Close ×
        var closeX = document.createElement("button");
        closeX.className = "ext-btn-ghost";
        closeX.style.cssText = "position:absolute;right:12px;top:12px;width:30px;height:30px;border-radius:50%;border:0.5px solid transparent;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:inherit;opacity:.45;";
        closeX.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

        // Icon (matching the extension icon shown in native dialog)
        var iconBlock = document.createElement("div");
        iconBlock.style.cssText = "width:48px;height:48px;border-radius:10px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;";
        iconBlock.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(140,165,255,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

        // Info block (title + description + badges)
        var infoBlock = document.createElement("div");
        infoBlock.style.cssText = "display:flex;flex-direction:column;gap:8px;";

        var titleRow = document.createElement("div");
        titleRow.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:8px;";

        var titleEl = document.createElement("p");
        titleEl.style.cssText = "margin:0;font-size:15px;font-weight:600;";
        titleEl.textContent = "Add extension manifest";

        titleRow.appendChild(titleEl);

        var desc = document.createElement("p");
        desc.style.cssText = "margin:0;font-size:13px;opacity:.45;line-height:1.55;";
        desc.textContent = "Enter the URL of a Tachiyomi-compatible manifest JSON. You can then browse and install extensions from it.";

        var badgeRow = document.createElement("div");
        badgeRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
        badgeRow.appendChild(makeBadge("Tachiyomi compatible", "border-color:rgba(99,130,255,.25);color:rgba(140,165,255,.8);"));
        badgeRow.appendChild(makeBadge("JSON manifest", "border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.4);"));

        infoBlock.appendChild(titleRow);
        infoBlock.appendChild(desc);
        infoBlock.appendChild(badgeRow);

        // Input block
        var inputBlock = document.createElement("div");
        inputBlock.style.cssText = "display:flex;flex-direction:column;gap:6px;";

        var inputLabel = document.createElement("p");
        inputLabel.style.cssText = "margin:0;font-size:12px;font-weight:500;opacity:.4;";
        inputLabel.textContent = "Manifest URL";

        var input = document.createElement("input");
        input.type = "text";
        input.placeholder = "https://raw.githubusercontent.com/example/index.json";
        input.style.cssText = "width:100%;box-sizing:border-box;background:rgba(255,255,255,.03);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;font-size:13px;color:inherit;outline:none;";

        var status = document.createElement("div");
        status.style.cssText = "font-size:12px;color:#e05555;min-height:16px;";

        inputBlock.appendChild(inputLabel);
        inputBlock.appendChild(input);
        inputBlock.appendChild(status);

        // Footer actions
        var actionsRow = document.createElement("div");
        actionsRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

        var cancelBtn = document.createElement("button");
        cancelBtn.className = "ext-btn-ghost";
        cancelBtn.style.cssText = "background:transparent;border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 16px;font-size:13px;color:inherit;cursor:pointer;opacity:.7;";
        cancelBtn.textContent = "Cancel";

        var nextBtn = document.createElement("button");
        nextBtn.style.cssText = "background:rgba(99,130,255,.15);border:0.5px solid rgba(99,130,255,.3);border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;color:rgba(140,165,255,.95);cursor:pointer;transition:background .1s;";
        nextBtn.textContent = "Browse extensions";

        actionsRow.appendChild(cancelBtn);
        actionsRow.appendChild(nextBtn);

        modal.appendChild(closeX);
        modal.appendChild(iconBlock);
        modal.appendChild(infoBlock);
        modal.appendChild(inputBlock);
        modal.appendChild(actionsRow);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        var doClose = function() { closeOverlay(overlay, modal); };
        cancelBtn.onclick = doClose;
        closeX.onclick = doClose;
        overlay.onclick = function(e) { if (e.target === overlay) doClose(); };

        // ESC to close
        var onKeyDown = function(e) {
            if (e.key === "Escape") { doClose(); document.removeEventListener("keydown", onKeyDown); }
        };
        document.addEventListener("keydown", onKeyDown);

        nextBtn.onclick = function() {
            var url = input.value.trim();
            if (!url) { status.textContent = "Please enter a URL."; return; }
            doClose();
            // Small delay so close animation can start
            setTimeout(function() { openPickerModal(url, onDone); }, 80);
        };

        setTimeout(function() { input.focus(); }, 50);
    }

    // ── main injected section ─────────────────────────────────────────────────

    function buildSection() {
        var installed = getInstalled();

        var section = document.createElement("div");
        section.id = "ext-bridge-section";
        section.style.cssText = "margin-top:16px;";

        var card = document.createElement("div");
        card.style.cssText = "border-radius:12px;border:0.5px solid rgba(255,255,255,.07);padding:16px;";

        var topRow = document.createElement("div");
        topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;" + (installed.length > 0 ? "margin-bottom:16px;" : "");

        var heading = document.createElement("h3");
        heading.style.cssText = "margin:0;font-size:15px;font-weight:600;";
        heading.textContent = "External extensions";

        var addBtn = document.createElement("button");
        addBtn.className = "ext-btn-ghost";
        addBtn.style.cssText = "display:inline-flex;align-items:center;gap:5px;background:rgba(99,130,255,.1);border:0.5px solid rgba(99,130,255,.25);border-radius:7px;padding:5px 12px;font-size:12px;font-weight:600;color:rgba(140,165,255,.9);cursor:pointer;";
        addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add extension';

        topRow.appendChild(heading);
        topRow.appendChild(addBtn);
        card.appendChild(topRow);

        if (installed.length === 0) {
            var empty = document.createElement("p");
            empty.style.cssText = "margin:10px 0 0;font-size:13px;opacity:.3;line-height:1.5;";
            empty.textContent = "No external extensions installed yet. Click \u201cAdd extension\u201d to browse a Tachiyomi manifest.";
            card.appendChild(empty);
        } else {
            var grid = document.createElement("div");
            grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:10px;";

            var frag = document.createDocumentFragment();
            installed.forEach(function(ext) {
                frag.appendChild(buildInstalledCard(ext, function() {
                    var old = document.getElementById("ext-bridge-section");
                    if (old) old.replaceWith(buildSection());
                }));
            });
            grid.appendChild(frag);
            card.appendChild(grid);
        }

        section.appendChild(card);

        addBtn.onclick = function() {
            openAddModal(function() {
                var old = document.getElementById("ext-bridge-section");
                if (old) old.replaceWith(buildSection());
            });
        };

        return section;
    }

    // ── route watcher ─────────────────────────────────────────────────────────

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
        var attempts = 0;
        var poll = setInterval(function() {
            tryInject();
            attempts++;
            if (document.getElementById("ext-bridge-section") || attempts > 60) clearInterval(poll);
        }, 100);
    }

    ["pushState", "replaceState"].forEach(function(fn) {
        var orig = history[fn].bind(history);
        history[fn] = function() { orig.apply(history, arguments); onNavigate(); };
    });
    window.addEventListener("popstate", onNavigate);
    onNavigate();

})();
`;

            await script.setText(code);
            const body = await ctx.dom.queryOne("body");
            if (body) await body.append(script);
        });
    });
}
