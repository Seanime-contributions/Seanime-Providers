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

    // Global loading flag so chapter-list.js can show a spinner even if
    // prefetch starts before the dropdown is injected.
    window.__extBridgeLoading = window.__extBridgeLoading || false;

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
        var src = String(ktSource || "");

        function m(re) {
            var mm = src.match(re);
            return mm ? mm[1] : "";
        }

        function unescapeKotlinString(s) {
            return String(s || "")
                .replace(/\\n/g, "\n")
                .replace(/\\t/g, "\t")
                .replace(/\\r/g, "\r")
                .replace(/\\\\/g, "\\")
                .replace(/\\\"/g, '"');
        }

        var name = unescapeKotlinString(
            m(/override\s+val\s+name\s*:\s*String\s*=\s*"([^"]+)"/)
        );
        var lang = unescapeKotlinString(
            m(/override\s+val\s+lang\s*:\s*String\s*=\s*"([^"]+)"/)
        );
        var baseUrl = unescapeKotlinString(
            m(/override\s+val\s+baseUrl\s*:\s*String\s*=\s*"([^"]+)"/)
        );

        var chapterListSelector = unescapeKotlinString(
            m(/override\s+fun\s+chapterListSelector\s*\(\s*\)\s*:\s*String\s*=\s*"([^"]+)"/)
        );
        var pageImageSelector = unescapeKotlinString(
            m(/document\.select\(\s*"([^"]+)"\s*\)\.forEachIndexed\s*\{/)
        );

        var dateFormat = unescapeKotlinString(
            m(/SimpleDateFormat\(\s*"([^"]+)"\s*,\s*Locale\.[A-Z_]+\s*\)/)
        );
        if (!dateFormat) dateFormat = "yyyy/MM/dd";

        function parseDate(str) {
            var s = String(str || "").trim();
            if (!s) return 0;

            if (dateFormat === "yyyy/MM/dd") {
                var mm = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
                if (!mm) return 0;
                var y = parseInt(mm[1], 10);
                var mo = parseInt(mm[2], 10) - 1;
                var d = parseInt(mm[3], 10);
                var dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
                return dt.getTime();
            }
            var dt2 = new Date(s);
            return isNaN(dt2.getTime()) ? 0 : dt2.getTime();
        }

        function toAbsUrl(u) {
            try { return new URL(u, baseUrl).toString(); } catch (_) { return u; }
        }

        function stripDomain(u) {
            try {
                var url = new URL(u, baseUrl);
                return url.pathname + (url.search || "") + (url.hash || "");
            } catch (_) {
                return u;
            }
        }

        function fetchDocument(url) {
            return fetch(url, { cache: "no-cache" })
                .then(function(r) {
                    if (!r.ok) throw new Error("HTTP " + r.status);
                    return r.text();
                })
                .then(function(html) {
                    var p = new DOMParser();
                    return p.parseFromString(html, "text/html");
                });
        }

        function cssSelectAll(doc, selector) {
            if (!doc || !selector) return [];
            try {
                if (selector.includes(":has(")) {
                    var safe = selector.replace(/:has\([^\)]*\)/g, "").replace(/\s+/g, " ").trim();
                    if (!safe) return [];
                    return Array.from(doc.querySelectorAll(safe)).filter(function(el) {
                        try {
                            return el.querySelector("a") != null;
                        } catch (_) {
                            return true;
                        }
                    });
                }
                return Array.from(doc.querySelectorAll(selector));
            } catch (_) {
                return [];
            }
        }

        function parseChaptersFromDoc(doc) {
            var rows = cssSelectAll(doc, chapterListSelector);
            var chapters = rows.map(function(row) {
                var nameEl = row.querySelector("td");
                var a = row.querySelector("a");
                var dateTd = row.querySelector("td:nth-child(2)");
                var chName = nameEl ? nameEl.textContent.trim() : (a ? a.textContent.trim() : "");
                var href = a ? a.getAttribute("href") : "";
                var abs = href ? toAbsUrl(href) : "";

                return {
                    name: chName,
                    url: stripDomain(abs),
                    urlAbsolute: abs,
                    date_upload: parseDate(dateTd ? dateTd.textContent : ""),
                };
            });

            return chapters.filter(function(c) { return !!c.urlAbsolute; }).reverse();
        }

        function getChapters(mangaUrl) {
            var url = toAbsUrl(mangaUrl);
            return fetchDocument(url).then(parseChaptersFromDoc);
        }

        function getPages(chapterUrl) {
            var url = toAbsUrl(chapterUrl);
            return fetchDocument(url).then(function(doc) {
                var sel = pageImageSelector || "img#gohere[src]";
                var imgs = cssSelectAll(doc, sel);
                return imgs.map(function(img, idx) {
                    var srcAttr = img.getAttribute("abs:src") || img.getAttribute("src") || "";
                    var abs = toAbsUrl(srcAttr);
                    return { index: idx, url: abs };
                }).filter(function(p) { return !!p.url; });
            });
        }

        return {
            kind: "tachiyomi_parsed_http_source",
            name: name,
            lang: lang,
            baseUrl: baseUrl,
            selectors: {
                chapterListSelector: chapterListSelector,
                pageImageSelector: pageImageSelector,
            },
            getChapters: getChapters,
            getPages: getPages,
            raw: src,
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

        window.__extBridgeLoading = true;
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
                window.__extBridgeLoading = false;
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

    // ── chapter list replacement ───────────────────────────────────────────────

    function getMangaUrlFromPage() {
        // Try to extract manga URL from the current page.
        // This is a best-effort approach - the exact location depends on Seanime's routing.
        try {
            var path = window.location.pathname || "";
            // Common pattern: /manga/{id} or /anime/{id}/chapters
            var match = path.match(/\/(?:manga|anime)\/([^\/]+)/);
            if (match && match[1]) {
                // Return the slug/id - the extension will construct the full URL
                return match[1];
            }
        } catch (_) {
            // ignore
        }
        return null;
    }

    function replaceChapterList(chapters) {
        var tbody = document.querySelector(".UI-DataGrid__tableBody");
        if (!tbody) {
            console.warn("[ext-bridge] Chapter table body not found");
            return;
        }

        // Clear existing rows
        tbody.innerHTML = "";

        chapters.forEach(function(ch) {
            var tr = document.createElement("tr");
            tr.className = "UI-DataGrid__tr hover:bg-[--subtle] truncate";

            // Checkbox column
            var tdCheck = document.createElement("td");
            tdCheck.className = "UI-DataGrid__td px-2 py-2 w-full whitespace-nowrap text-base font-normal text-[--foreground] data-[is-selection-col=true]:px-2 data-[is-selection-col=true]:sm:px-0 data-[is-selection-col=true]:text-center data-[action-col=false]:truncate data-[action-col=false]:overflow-ellipsis data-[row-selected=true]:bg-brand-50 dark:data-[row-selected=true]:bg-gray-800 data-[editing=true]:ring-1 data-[editing=true]:ring-[--ring] ring-inset data-[editable=true]:hover:bg-[--subtle] md:data-[editable=true]:focus:ring-2 md:data-[editable=true]:focus:ring-[--slate] focus:outline-none border-b border-[rgba(255,255,255,0.05)]";
            tdCheck.style.width = "6px";
            tdCheck.style.maxWidth = "6px";
            tdCheck.setAttribute("data-is-selection-col", "true");
            tdCheck.setAttribute("data-action-col", "false");

            var checkboxWrap = document.createElement("div");
            var checkboxLabel = document.createElement("label");
            checkboxLabel.className = "UI-Checkbox__container inline-flex gap-2 items-center";
            var checkbox = document.createElement("button");
            checkbox.type = "button";
            checkbox.role = "checkbox";
            checkbox.setAttribute("aria-checked", "false");
            checkbox.setAttribute("data-state", "unchecked");
            checkbox.setAttribute("data-disabled", "false");
            checkbox.className = "UI-Checkbox__root appearance-none peer block relative overflow-hidden transition shrink-0 text-white rounded-[--radius-md] ring-offset-1 border ring-offset-[--background] border-gray-300 dark:border-gray-700 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:cursor-not-allowed data-[disabled=true]:opacity-50 data-[state=unchecked]:bg-white dark:data-[state=unchecked]:bg-gray-700 data-[state=unchecked]:hover:bg-gray-100 dark:data-[state=unchecked]:hover:bg-gray-600 data-[state=checked]:bg-brand dark:data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=indeterminate]:bg-[--muted] dark:data-[state=indeterminate]:bg-gray-700 data-[state=indeterminate]:text-white data-[state=indeterminate]:border-transparent data-[error=true]:border-red-500 data-[error=true]:dark:border-red-500 data-[error=true]:data-[state=checked]:border-red-500 data-[error=true]:dark:data-[state=checked]:border-red-500 h-5 w-5";
            checkbox.setAttribute("data-error", "false");
            checkbox.setAttribute("aria-readonly", "false");
            checkbox.setAttribute("data-readonly", "false");
            var hiddenInput = document.createElement("input");
            hiddenInput.type = "checkbox";
            hiddenInput.className = "appearance-none absolute bottom-0 border-0 w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap [clip:rect(0px,0px,0px,0px)] [overflow-wrap:normal]";
            hiddenInput.setAttribute("aria-hidden", "true");
            hiddenInput.tabIndex = -1;
            hiddenInput.value = "off";
            hiddenInput.checked = false;
            checkboxLabel.appendChild(checkbox);
            checkboxLabel.appendChild(hiddenInput);
            checkboxWrap.appendChild(checkboxLabel);
            tdCheck.appendChild(checkboxWrap);
            tr.appendChild(tdCheck);

            // Name column
            var tdName = document.createElement("td");
            tdName.className = "UI-DataGrid__td px-2 py-2 w-full whitespace-nowrap text-base font-normal text-[--foreground] data-[is-selection-col=true]:px-2 data-[is-selection-col=true]:sm:px-0 data-[is-selection-col=true]:text-center data-[action-col=false]:truncate data-[action-col=false]:overflow-ellipsis data-[row-selected=true]:bg-brand-50 dark:data-[row-selected=true]:bg-gray-800 data-[editing=true]:ring-1 data-[editing=true]:ring-[--ring] ring-inset data-[editable=true]:hover:bg-[--subtle] md:data-[editable=true]:focus:ring-2 md:data-[editable=true]:focus:ring-[--slate] focus:outline-none border-b border-[rgba(255,255,255,0.05)]";
            tdName.style.width = "90px";
            tdName.style.maxWidth = "9.0072e+15px";
            tdName.setAttribute("data-is-selection-col", "false");
            tdName.setAttribute("data-action-col", "false");
            tdName.textContent = ch.name || "";
            tr.appendChild(tdName);

            // Number column (placeholder for now)
            var tdNum = document.createElement("td");
            tdNum.className = "UI-DataGrid__td px-2 py-2 w-full whitespace-nowrap text-base font-normal text-[--foreground] data-[is-selection-col=true]:px-2 data-[is-selection-col=true]:sm:px-0 data-[is-selection-col=true]:text-center data-[action-col=false]:truncate data-[action-col=false]:overflow-ellipsis data-[row-selected=true]:bg-brand-50 dark:data-[row-selected=true]:bg-gray-800 data-[editing=true]:ring-1 data-[editing=true]:ring-[--ring] ring-inset data-[editable=true]:hover:bg-[--subtle] md:data-[editable=true]:focus:ring-2 md:data-[editable=true]:focus:ring-[--slate] focus:outline-none border-b border-[rgba(255,255,255,0.05)]";
            tdNum.style.width = "20px";
            tdNum.style.maxWidth = "9.0072e+15px";
            tdNum.setAttribute("data-is-selection-col", "false");
            tdNum.setAttribute("data-action-col", "false");
            tdNum.textContent = "";
            tr.appendChild(tdNum);

            // Action column
            var tdAction = document.createElement("td");
            tdAction.className = "UI-DataGrid__td px-2 py-2 w-full whitespace-nowrap text-base font-normal text-[--foreground] data-[is-selection-col=true]:px-2 data-[is-selection-col=true]:sm:px-0 data-[is-selection-col=true]:text-center data-[action-col=false]:truncate data-[action-col=false]:overflow-ellipsis data-[row-selected=true]:bg-brand-50 dark:data-[row-selected=true]:bg-gray-800 data-[editing=true]:ring-1 data-[editing=true]:ring-[--ring] ring-inset data-[editable=true]:hover:bg-[--subtle] md:data-[editable=true]:focus:ring-2 md:data-[editable=true]:focus:ring-[--slate] focus:outline-none border-b border-[rgba(255,255,255,0.05)]";
            tdAction.style.width = "20px";
            tdAction.style.maxWidth = "9.0072e+15px";
            tdAction.setAttribute("data-is-selection-col", "false");
            tdAction.setAttribute("data-action-col", "true");
            
            var actionWrap = document.createElement("div");
            actionWrap.className = "flex justify-end gap-2 items-center w-full";
            tdAction.appendChild(actionWrap);
            tr.appendChild(tdAction);

            tbody.appendChild(tr);
        });

        console.log("[ext-bridge] Replaced chapter list with", chapters.length, "chapters");
    }

    function fetchAndReplaceChapters() {
        var ext = getActive();
        if (!ext || !cache.translated) {
            console.log("[ext-bridge] No active extension or not translated yet");
            return Promise.resolve(null);
        }

        var translated = cache.translated;
        if (!translated.getChapters) {
            console.warn("[ext-bridge] Translated extension has no getChapters method");
            return Promise.resolve(null);
        }

        var mangaSlug = getMangaUrlFromPage();
        if (!mangaSlug) {
            console.warn("[ext-bridge] Could not determine manga URL from page");
            return Promise.resolve(null);
        }

        // Construct the manga URL based on the extension's baseUrl
        var mangaUrl;
        try {
            mangaUrl = new URL(mangaSlug, translated.baseUrl).toString();
        } catch (_) {
            mangaUrl = translated.baseUrl + "/" + mangaSlug.replace(/^\//, "");
        }

        console.log("[ext-bridge] Fetching chapters from:", mangaUrl);
        window.__extBridgeLoading = true;
        dispatch("ext:chaptersFetchLoading", { ext: ext, url: mangaUrl });

        return translated.getChapters(mangaUrl)
            .then(function(chapters) {
                console.log("[ext-bridge] Fetched", chapters.length, "chapters");
                replaceChapterList(chapters);
                dispatch("ext:chaptersFetchLoaded", { ext: ext, chapters: chapters });
                return chapters;
            })
            .catch(function(err) {
                console.error("[ext-bridge] Failed to fetch chapters:", err);
                dispatch("ext:bridgeError", { ext: ext, error: String(err && err.message || err) });
                throw err;
            })
            .finally(function() {
                window.__extBridgeLoading = false;
            });
    }

    // ── public API ───────────────────────────────────────────────────────────

    window.__extBridge = window.__extBridge || {};

    window.__extBridge.getActiveExtension = getActive;
    window.__extBridge.prefetchActiveExtension = prefetchActiveExtension;
    window.__extBridge.getCache = function() { return cache; };
    window.__extBridge.fetchAndReplaceChapters = fetchAndReplaceChapters;

    // React to dropdown selection
    document.addEventListener("ext:sourceChanged", function() {
        // Prefetch immediately so the UI can show a spinner and we fail fast.
        prefetchActiveExtension()
            .then(function(translated) {
                if (translated) {
                    // After translation is done, fetch and replace chapters
                    fetchAndReplaceChapters().catch(function(err) {
                        console.error("[ext-bridge] Chapter fetch failed:", err);
                    });
                }
            })
            .catch(function(err) {
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
