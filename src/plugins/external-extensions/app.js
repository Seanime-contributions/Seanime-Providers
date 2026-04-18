// app.js — runs after bootstrap has fetched global.css + all components.
// Expects: window.__extComponents["installed-card" | "add-modal" | "picker-modal"]
(function() {

    var STORAGE_KEY = "seanime_ext_bridge_installed";

    // ── component helpers ─────────────────────────────────────────────────────

    // Clone a registered component template into a wrapper div and return it.
    // Using a div wrapper so we can querySelector inside the stamped fragment.
    function stamp(name) {
        var c = window.__extComponents && window.__extComponents[name];
        if (!c) throw new Error("[ext-bridge] Component not loaded: " + name);
        var wrap = document.createElement("div");
        wrap.appendChild(c());
        var root = wrap.firstElementChild;
        // qs/qsa query from root itself so they still work after
        // root is moved into the live document via appendChild.
        root.qs  = function(sel) { return root.querySelector(sel); };
        root.qsa = function(sel) { return root.querySelectorAll(sel); };
        return root;
    }

    // ── storage ───────────────────────────────────────────────────────────────

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

    // ── display helpers ───────────────────────────────────────────────────────

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

    function makeBadge(text, style) {
        var b = document.createElement("span");
        b.style.cssText = "display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;border:0.5px solid;font-size:11px;font-weight:600;letter-spacing:.02em;white-space:nowrap;"
            + (style || "border-color:rgba(255,255,255,.12);color:rgba(255,255,255,.45);");
        b.textContent = text;
        return b;
    }

    function setFavicon(wrap, baseUrl) {
        var url = faviconUrl(baseUrl);
        if (url) {
            var img = document.createElement("img");
            img.src = url;
            img.width = 28;
            img.height = 28;
            img.loading = "lazy";
            img.decoding = "async";
            img.style.cssText = "object-fit:contain;";
            wrap.appendChild(img);
        } else {
            wrap.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
        }
    }

    // ── overlay close with animation ──────────────────────────────────────────

    function closeOverlay(overlay, modal, onKeyDown) {
        if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
        overlay.classList.add("ext-overlay-leave");
        modal.classList.add("ext-modal-leave");
        setTimeout(function() { overlay.remove(); }, 160);
    }

    function bindEsc(fn) {
        var handler = function(e) { if (e.key === "Escape") fn(); };
        document.addEventListener("keydown", handler);
        return handler;
    }

    // ── installed card ────────────────────────────────────────────────────────

    function buildInstalledCard(ext, onUninstall) {
        var baseUrl = (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "";
        var lang = langLabel(ext.lang);

        var card = stamp("installed-card");

        setFavicon(card.qs(".ext-card-icon"), baseUrl);
        card.qs(".ext-card-name").textContent = ext.name;
        card.qs(".ext-card-pkg").textContent  = ext.pkg || "";

        var badges = card.qs(".ext-card-badges");
        badges.appendChild(makeBadge(ext.version || "?"));
        badges.appendChild(makeBadge("Tachiyomi", "border-color:rgba(100,160,255,.25);color:rgba(140,175,255,.85);"));
        badges.appendChild(makeBadge(lang));
        if (ext.nsfw) {
            badges.appendChild(makeBadge("18+", "border-color:rgba(210,50,50,.3);color:#e05555;background:rgba(210,50,50,.1);"));
        }

        card.qs(".ext-card-remove").onclick = function() {
            uninstallExt(ext.pkg);
            onUninstall();
        };

        return card;
    }

    // ── picker modal ──────────────────────────────────────────────────────────

    function openPickerModal(manifestUrl, onDone) {
        var existing = document.getElementById("ext-picker-overlay");
        if (existing) existing.remove();

        var allExts      = [];
        var selectedPkgs = {};
        var searchTimer  = null;

        var overlay = stamp("picker-modal");
        // stamp() returns the root <div id="ext-picker-overlay">
        document.body.appendChild(overlay);

        var modal      = overlay.qs(".ext-modal-enter");
        var searchInput = overlay.qs(".ext-picker-search");
        var statusText  = overlay.qs(".ext-picker-status-text");
        var spinnerEl   = overlay.qs(".ext-spinner");
        var listWrap    = overlay.qs(".ext-list-wrap");
        var countEl     = overlay.qs(".ext-picker-count");
        var installBtn  = overlay.qs(".ext-picker-install");

        var doClose = closeOverlay.bind(null, overlay, modal, null);
        // patch doClose to remove ESC listener
        var escHandler;
        var doCloseWithEsc = function() { closeOverlay(overlay, modal, escHandler); };
        escHandler = bindEsc(doCloseWithEsc);

        overlay.qs(".ext-modal-close").onclick = doCloseWithEsc;
        overlay.qs(".ext-picker-cancel").onclick  = doCloseWithEsc;
        overlay.onclick = function(e) { if (e.target === overlay) doCloseWithEsc(); };

        function updateFooter() {
            var count = Object.keys(selectedPkgs).filter(function(k) { return selectedPkgs[k]; }).length;
            countEl.textContent = count + " selected";
            installBtn.style.opacity      = count > 0 ? "1" : ".35";
            installBtn.style.pointerEvents = count > 0 ? "auto" : "none";
        }

        function renderRow(ext) {
            var baseUrl   = (ext.sources && ext.sources[0] && ext.sources[0].baseUrl) || ext.baseUrl || "";
            var icon      = faviconUrl(baseUrl);
            var installed = isInstalled(ext.pkg);
            var selected  = !!selectedPkgs[ext.pkg];

            var row = document.createElement("div");
            row.className = "ext-row";
            row.style.cssText = "display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:0.5px solid "
                + (selected ? "rgba(99,130,255,.4)"     : "rgba(255,255,255,.06)")
                + ";background:" + (selected ? "rgba(99,130,255,.07)" : "rgba(255,255,255,.015)")
                + ";cursor:" + (installed ? "default" : "pointer") + ";";

            var iconWrap = document.createElement("div");
            iconWrap.style.cssText = "width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.05);flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border:0.5px solid rgba(255,255,255,.07);";
            if (icon) {
                var img = document.createElement("img");
                img.src      = icon;
                img.width    = 20;
                img.height   = 20;
                img.loading  = "lazy";
                img.decoding = "async";
                img.style.cssText = "object-fit:contain;";
                iconWrap.appendChild(img);
            } else {
                iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
            }

            var info = document.createElement("div");
            info.style.cssText = "flex:1;min-width:0;";
            info.innerHTML = '<p style="margin:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></p>'
                           + '<p style="margin:2px 0 0;font-size:11px;opacity:.35;"></p>';
            info.children[0].textContent = ext.name;
            info.children[1].textContent = langLabel(ext.lang) + " \u00b7 v" + (ext.version || "?");

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

        function renderList() {
            var query    = searchInput.value.toLowerCase().trim();
            var filtered = query
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
            doCloseWithEsc();
            onDone();
        };

        fetch(manifestUrl, { cache: "no-cache" })
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

    // ── add-manifest modal ────────────────────────────────────────────────────

    function openAddModal(onDone) {
        var existing = document.getElementById("ext-bridge-overlay");
        if (existing) existing.remove();

        var overlay = stamp("add-modal");
        document.body.appendChild(overlay);

        var modal  = overlay.qs(".ext-modal-enter");
        var input  = overlay.qs(".ext-add-input");
        var status = overlay.qs(".ext-add-status");
        var badges = overlay.qs(".ext-add-badges");

        badges.appendChild(makeBadge("Tachiyomi compatible", "border-color:rgba(99,130,255,.25);color:rgba(140,165,255,.8);"));
        badges.appendChild(makeBadge("JSON manifest",        "border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.4);"));

        var escHandler;
        var doClose = function() { closeOverlay(overlay, modal, escHandler); };
        escHandler = bindEsc(doClose);

        overlay.qs(".ext-modal-close").onclick = doClose;
        overlay.qs(".ext-add-cancel").onclick  = doClose;
        overlay.onclick = function(e) { if (e.target === overlay) doClose(); };

        overlay.qs(".ext-add-next").onclick = function() {
            var url = input.value.trim();
            if (!url) { status.textContent = "Please enter a URL."; return; }
            doClose();
            setTimeout(function() { openPickerModal(url, onDone); }, 80);
        };

        setTimeout(function() { input.focus(); }, 50);
    }

    // ── injected section ──────────────────────────────────────────────────────

    function buildSection() {
        var installed = getInstalled();

        var section = document.createElement("div");
        section.id = "ext-bridge-section";
        section.style.cssText = "margin-top:16px;";

        var card = document.createElement("div");
        card.style.cssText = "border-radius:12px;border:0.5px solid rgba(255,255,255,.07);padding:16px;";

        var topRow = document.createElement("div");
        topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;"
            + (installed.length > 0 ? "margin-bottom:16px;" : "");

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

        var streamingH3 = Array.from(document.querySelectorAll("h3")).find(function(h) {
            return h.textContent.toLowerCase().includes("online streaming");
        });
        if (!streamingH3) return;

        var anchorCard = streamingH3.closest('[class*="Card"]')
            || streamingH3.closest('[class*="card"]')
            || streamingH3.parentElement.parentElement;

        anchorCard.insertAdjacentElement("afterend", buildSection());
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
