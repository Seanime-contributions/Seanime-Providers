// chapters.js
// Bridges the selected external Tachiyomi extension into Seanime's chapter list.
//
// Responsibilities:
// - React to ext:sourceChanged and prefetch/translate the extension Kotlin source.
// - Expose a small API on window.__extBridge for other scripts to call.
//
// NOTE: The actual mapping from Kotlin source to chapter fetching logic is
// intentionally conservative here until we have stable Kotlin patterns.
(function() {

    var DEFAULT_MANIFEST_URL = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json";

    function getActive() {
        return window.__extActiveSource || null;
    }

    function extIdFromPkg(pkg) {
        if (!pkg) return "";
        var parts = String(pkg).split(".");
        return parts[parts.length - 1] || "";
    }

    function langFromPkg(pkg) {
        // eu.kanade.tachiyomi.extension.en.mangafreak
        if (!pkg) return "";
        var parts = String(pkg).split(".");
        var idx = parts.indexOf("extension");
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
        // fallback: try to detect a 2-letter language segment
        var maybe = parts.find(function(p) { return /^[a-z]{2}$/.test(p); });
        return maybe || "";
    }

    function pkgPath(pkg) {
        return String(pkg || "").split(".").join("/");
    }

    function titleCase(s) {
        s = String(s || "");
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function buildBaseSourceDir(ext) {
        var pkg = ext && ext.pkg;
        var id = extIdFromPkg(pkg);
        var lang = langFromPkg(pkg);
        if (!id || !lang || !pkg) return "";

        // https://raw.githubusercontent.com/keiyoushi/extensions-source/refs/heads/main/src/en/mangafreak/src/eu/kanade/tachiyomi/extension/en/mangafreak/
        return "https://raw.githubusercontent.com/keiyoushi/extensions-source/refs/heads/main/src/"
            + encodeURIComponent(lang) + "/" + encodeURIComponent(id)
            + "/src/" + pkgPath(pkg) + "/";
    }

    function guessMainKtFile(ext) {
        // Best-effort: many extensions use <ExtId>.kt with leading capital.
        var id = extIdFromPkg(ext && ext.pkg);
        return titleCase(id) + ".kt";
    }

    function dispatch(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: detail }));
        } catch (_) {
            // ignore
        }
    }

    function closest(el, selector) {
        while (el && el !== document.documentElement) {
            if (el.matches && el.matches(selector)) return el;
            el = el.parentElement;
        }
        return null;
    }

    function fetchText(url) {
        return fetch(url, { cache: "no-cache" }).then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
            return r.text();
        });
    }

    // ── Kotlin -> JS translation (placeholder) ───────────────────────────────

    function translateKotlinToJs(ktSource) {
        // This will be replaced with real regex-based translation rules.
        // For now, keep the raw source and expose it for debugging.
        return {
            kind: "kotlin_raw",
            source: ktSource,
        };
    }

    // ── load / cache extension source ────────────────────────────────────────

    var cache = {
        key: "",
        baseDir: "",
        ktFile: "",
        kt: "",
        translated: null,
        error: "",
    };

    function cacheKey(ext) {
        if (!ext) return "";
        var manifestUrl = ext.manifestUrl || DEFAULT_MANIFEST_URL;
        return [manifestUrl, ext.pkg || "", ext.version || ""].join("|");
    }

    function ensureManifestUrl(ext) {
        if (!ext) return ext;
        if (!ext.manifestUrl) ext.manifestUrl = DEFAULT_MANIFEST_URL;
        return ext;
    }

    function prefetchActiveExtension() {
        var ext = getActive();
        if (!ext) {
            cache = { key: "", baseDir: "", ktFile: "", kt: "", translated: null, error: "" };
            dispatch("ext:bridgeIdle", null);
            return Promise.resolve(null);
        }

        ext = ensureManifestUrl(Object.assign({}, ext));
        var key = cacheKey(ext);
        if (cache.key === key && cache.translated) return Promise.resolve(cache.translated);

        var baseDir = buildBaseSourceDir(ext);
        if (!baseDir) {
            var err = "Cannot derive source path from pkg: " + (ext.pkg || "");
            cache = { key: key, baseDir: "", ktFile: "", kt: "", translated: null, error: err };
            dispatch("ext:bridgeError", { ext: ext, error: err });
            return Promise.reject(new Error(err));
        }

        var ktFile = guessMainKtFile(ext);
        var url = baseDir + ktFile;

        dispatch("ext:chaptersLoading", { ext: ext, url: url });

        return fetchText(url)
            .then(function(kt) {
                var translated = translateKotlinToJs(kt);
                cache = { key: key, baseDir: baseDir, ktFile: ktFile, kt: kt, translated: translated, error: "" };
                dispatch("ext:chaptersReady", { ext: ext, url: url, translated: translated });
                return translated;
            })
            .catch(function(e) {
                cache = { key: key, baseDir: baseDir, ktFile: ktFile, kt: "", translated: null, error: String(e && e.message || e) };
                dispatch("ext:bridgeError", { ext: ext, url: url, error: cache.error });
                throw e;
            })
            .finally(function() {
                dispatch("ext:chaptersLoaded", { ext: ext });
            });
    }

    function needsPrefetch() {
        var ext = getActive();
        if (!ext) return false;
        var key = cacheKey(ensureManifestUrl(Object.assign({}, ext)));
        return !(cache.key === key && cache.translated);
    }

    function attachRowSpinner(rowEl) {
        if (!rowEl || rowEl.nodeType !== 1) return function() {};
        if (rowEl.getAttribute("data-ext-row-loading") === "true") return function() {};

        var actionCell = rowEl.querySelector('td[data-action-col="true"]') || rowEl.lastElementChild;
        if (!actionCell) return function() {};

        var existing = actionCell.querySelector(".ext-row-spinner");
        if (existing) existing.remove();

        var spinner = document.createElement("span");
        spinner.className = "ext-spinner ext-row-spinner";
        spinner.style.cssText = "margin-left:8px;";
        actionCell.appendChild(spinner);
        rowEl.setAttribute("data-ext-row-loading", "true");

        return function detach() {
            rowEl.removeAttribute("data-ext-row-loading");
            if (spinner && spinner.parentNode) spinner.remove();
        };
    }

    // ── public API ───────────────────────────────────────────────────────────

    window.__extBridge = window.__extBridge || {};

    window.__extBridge.getActiveExtension = getActive;
    window.__extBridge.prefetchActiveExtension = prefetchActiveExtension;
    window.__extBridge.getCache = function() { return cache; };

    // React to dropdown selection
    document.addEventListener("ext:sourceChanged", function() {
        // Prefetch immediately so the UI can show a spinner and we fail fast.
        prefetchActiveExtension().catch(function(err) {
            console.error("[ext-bridge] Prefetch failed:", err);
        });
    });

    // React to chapter selection (clicks inside the chapter list container).
    // If the extension hasn't been translated yet, show a row spinner and prefetch.
    document.addEventListener("click", function(e) {
        try {
            if (!needsPrefetch()) return;
            var container = closest(e.target, '[data-chapter-list-bulk-actions-container="true"]');
            if (!container) return;

            var row = closest(e.target, "tr.UI-DataGrid__tr");
            if (!row) return;

            var detach = attachRowSpinner(row);
            prefetchActiveExtension().catch(function(err) {
                console.error("[ext-bridge] Prefetch failed:", err);
            }).finally(function() {
                detach();
            });
        } catch (_) {
            // ignore
        }
    }, true);

    // If the user already has an active source in session, prefetch on load.
    if (getActive()) {
        prefetchActiveExtension().catch(function() {});
    }

})();
