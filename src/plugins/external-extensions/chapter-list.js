// chapter-list.js
// Watches for Seanime's chapter list toolbar via MutationObserver and injects
// an "External Source" dropdown that lists installed Tachiyomi extensions.
// Scope: UI only. Selecting an extension stores it in window.__extActiveSource.
// Selecting "None" (or when no extensions are installed) is a no-op.
(function() {

    var STORAGE_KEY    = "seanime_ext_bridge_installed";
    var INJECTED_ATTR  = "data-ext-source-injected";
    var ACTIVE_KEY     = "ext_active_source";

    // ── storage ───────────────────────────────────────────────────────────────

    function getInstalled() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
    }

    function getActive() {
        try { return JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null"); } catch { return null; }
    }

    function setActive(ext) {
        // null means "None"
        if (ext) {
            sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(ext));
        } else {
            sessionStorage.removeItem(ACTIVE_KEY);
        }
        // Expose on window so chapters.js can read it without re-parsing storage
        window.__extActiveSource = ext || null;
    }

    // Initialise window state from session on load
    window.__extActiveSource = getActive();

    // ── component stamp ───────────────────────────────────────────────────────
    // Reuses the same stamp() pattern from app.js but self-contained so
    // chapter-list.js can be loaded independently.

    function stamp(name) {
        var c = window.__extComponents && window.__extComponents[name];
        if (!c) { console.warn("[ext-bridge] Component not loaded:", name); return null; }
        var wrap = document.createElement("div");
        wrap.appendChild(c());
        var root = wrap.firstElementChild;
        root.qs  = function(sel) { return root.querySelector(sel); };
        root.qsa = function(sel) { return root.querySelectorAll(sel); };
        return root;
    }

    // ── dropdown option factory ───────────────────────────────────────────────

    function makeOption(label, value, isSelected) {
        var el = document.createElement("div");
        el.className = "ext-source-option";
        el.dataset.value = value === null ? "__none__" : value;
        el.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;"
            + "padding:8px 10px;border-radius:8px;font-size:13px;cursor:pointer;"
            + "transition:background .1s;"
            + (isSelected ? "background:rgba(99,130,255,.12);color:rgba(140,165,255,.95);" : "");

        var labelEl = document.createElement("span");
        labelEl.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        labelEl.textContent = label;
        el.appendChild(labelEl);

        if (isSelected) {
            var check = document.createElement("span");
            check.innerHTML = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="rgba(140,165,255,.9)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>';
            el.appendChild(check);
        }

        el.addEventListener("mouseenter", function() {
            if (!isSelected) el.style.background = "rgba(255,255,255,.05)";
        });
        el.addEventListener("mouseleave", function() {
            if (!isSelected) el.style.background = "";
        });

        return el;
    }

    // ── build & wire the dropdown ─────────────────────────────────────────────

    function buildDropdown(toolbar) {
        var installed = getInstalled();
        var active    = getActive();

        var root = stamp("ext-source-dropdown");
        if (!root) return;

        var trigger  = root.qs(".ext-source-trigger");
        var labelEl  = root.qs(".ext-source-label");
        var dropdown = root.qs(".ext-source-dropdown");

        // ── populate options ──────────────────────────────────────────────────

        function populateOptions() {
            var currentActive = getActive();
            dropdown.innerHTML = "";

            // "None" option
            var noneOpt = makeOption("None", null, currentActive === null);
            noneOpt.addEventListener("click", function() {
                setActive(null);
                labelEl.textContent = "None";
                labelEl.style.opacity = ".5";
                closeDropdown();
                populateOptions();
            });
            dropdown.appendChild(noneOpt);

            if (installed.length === 0) {
                var empty = document.createElement("div");
                empty.style.cssText = "padding:8px 10px;font-size:12px;opacity:.3;";
                empty.textContent = "No extensions installed";
                dropdown.appendChild(empty);
                return;
            }

            // Divider
            var divider = document.createElement("div");
            divider.style.cssText = "height:0.5px;background:rgba(255,255,255,.07);margin:4px 2px;";
            dropdown.appendChild(divider);

            installed.forEach(function(ext) {
                var isSelected = currentActive && currentActive.pkg === ext.pkg;
                var opt = makeOption(ext.name, ext.pkg, isSelected);
                opt.addEventListener("click", function() {
                    setActive(ext);
                    labelEl.textContent = ext.name;
                    labelEl.style.opacity = "1";
                    closeDropdown();
                    populateOptions();

                    // Dispatch a custom event so chapters.js (future) can react
                    document.dispatchEvent(new CustomEvent("ext:sourceChanged", { detail: ext }));
                });
                dropdown.appendChild(opt);
            });
        }

        // ── open / close ──────────────────────────────────────────────────────

        var isOpen = false;

        function openDropdown() {
            populateOptions();
            dropdown.style.display = "block";
            isOpen = true;
        }

        function closeDropdown() {
            dropdown.style.display = "none";
            isOpen = false;
        }

        trigger.addEventListener("click", function(e) {
            e.stopPropagation();
            if (isOpen) { closeDropdown(); } else { openDropdown(); }
        });

        // Close on outside click
        document.addEventListener("click", function onOutside(e) {
            if (!root.contains(e.target)) closeDropdown();
        });

        // Close on ESC
        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape" && isOpen) closeDropdown();
        });

        // Seed label from persisted session state
        if (active) {
            labelEl.textContent = active.name;
            labelEl.style.opacity = "1";
        } else {
            labelEl.style.opacity = ".5";
        }

        // ── inject into toolbar ───────────────────────────────────────────────
        // Append to the right end of the toolbar flex row

        toolbar.style.display = "flex";
        toolbar.style.alignItems = "center";
        toolbar.appendChild(root);
        toolbar.setAttribute(INJECTED_ATTR, "true");
    }

    // ── toolbar finder ────────────────────────────────────────────────────────
    // The chapter list toolbar has class UI-DataGrid__toolbar and lives inside
    // a bulk-actions container. We key on a stable data attribute.

    function findToolbar() {
        return document.querySelector(
            '[data-chapter-list-bulk-actions-container] .UI-DataGrid__toolbar'
        );
    }

    function tryInject() {
        var toolbar = findToolbar();
        if (!toolbar) return false;
        if (toolbar.getAttribute(INJECTED_ATTR)) return true; // already done
        buildDropdown(toolbar);
        return true;
    }

    // ── MutationObserver ──────────────────────────────────────────────────────
    // Watch the whole document for subtree changes. When the chapter list
    // mounts (or re-mounts after a navigation), re-attempt injection.
    // Debounced to avoid hammering on rapid DOM mutations.

    var injectTimer = null;

    var observer = new MutationObserver(function() {
        clearTimeout(injectTimer);
        injectTimer = setTimeout(tryInject, 80);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also attempt immediately in case the page is already loaded
    tryInject();

})();
