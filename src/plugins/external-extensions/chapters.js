// chapters.js — web-tree-sitter
// Replaces the regex Kotlin translator with a proper AST-based extractor.
// Pipeline:
//   1. Load web-tree-sitter + Kotlin WASM grammar (once, cached on window)
//   2. On ext:sourceChanged → fetch the .kt source → parse AST → extract "recipe"
//   3. Resolve AniList ID from URL → GraphQL to get all titles/synonyms
//   4. Search extension for best match → fetch chapter list → replace table
(function () {

    // ── constants ─────────────────────────────────────────────────────────────

    var TREE_SITTER_JS   = "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.js";
    var KOTLIN_WASM_URL  = "https://unpkg.com/tree-sitter-wasms@0.1.11/out/tree-sitter-kotlin.wasm";
    var DEFAULT_MANIFEST = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json";
    var ANILIST_API      = "https://graphql.anilist.co";
    var RECIPE_CACHE_KEY = "ext_recipe_cache"; // sessionStorage key prefix

    // ── global state ──────────────────────────────────────────────────────────

    window.__extBridgeLoading = window.__extBridgeLoading || false;

    var parserReady     = null; // Promise<{Parser, KotlinLang}>
    var activeRecipe    = null; // current extracted recipe
    var activeExt       = null; // current extension object

    // ── dispatch helper ───────────────────────────────────────────────────────

    function dispatch(name, detail) {
        try { document.dispatchEvent(new CustomEvent(name, { detail: detail || null })); }
        catch (_) {}
    }

    // ── 1. Tree-sitter loader ─────────────────────────────────────────────────

    function loadTreeSitter() {
        if (parserReady) return parserReady;

        parserReady = new Promise(function (resolve, reject) {
            // If already loaded from a previous script run
            if (window.TreeSitter && window.__extKotlinLang) {
                resolve({ Parser: window.TreeSitter, KotlinLang: window.__extKotlinLang });
                return;
            }

            // Inject tree-sitter.js
            var s = document.createElement("script");
            s.src = TREE_SITTER_JS;
            s.onload = function () {
                var Parser = window.TreeSitter;
                if (!Parser) { reject(new Error("TreeSitter not found on window")); return; }

                Parser.init().then(function () {
                    // Fetch the Kotlin WASM as ArrayBuffer
                    return fetch(KOTLIN_WASM_URL, { cache: "force-cache" })
                        .then(function (r) {
                            if (!r.ok) throw new Error("WASM fetch failed: " + r.status);
                            return r.arrayBuffer();
                        });
                }).then(function (wasmBuf) {
                    return Parser.Language.load(new Uint8Array(wasmBuf));
                }).then(function (lang) {
                    window.__extKotlinLang = lang;
                    resolve({ Parser: Parser, KotlinLang: lang });
                }).catch(reject);
            };
            s.onerror = function () { reject(new Error("Failed to load tree-sitter.js")); };
            document.head.appendChild(s);
        });

        return parserReady;
    }

    // ── 2. AST extraction helpers ─────────────────────────────────────────────

    // Walk a tree-sitter node and collect all nodes matching a predicate
    function walkNodes(node, predicate, results) {
        results = results || [];
        if (predicate(node)) results.push(node);
        for (var i = 0; i < node.childCount; i++) {
            walkNodes(node.child(i), predicate, results);
        }
        return results;
    }

    // Extract the text content of a Kotlin string literal node
    // Strips outer quotes and handles basic escape sequences
    function extractStringValue(node) {
        if (!node) return "";
        var text = node.text || "";
        // string_literal wraps in quotes: "foo" → foo
        if (text.startsWith('"') && text.endsWith('"')) {
            text = text.slice(1, -1);
        }
        // basic Kotlin string unescape
        return text
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\r/g, "\r")
            .replace(/\\\\/g, "\\")
            .replace(/\\"/g, '"');
    }

    // Convert jQuery-style selectors to CSS selectors
    // e.g. td:eq(0) → td:nth-child(1), td:eq(1) → td:nth-child(2)
    function jqueryToCssSelector(selector) {
        if (!selector) return selector;
        return selector.replace(/:eq\((\d+)\)/g, function(match, index) {
            // jQuery :eq() is 0-indexed, CSS :nth-child() is 1-indexed
            return ":nth-child(" + (parseInt(index, 10) + 1) + ")";
        });
    }

    // Find the first node of a given type
    function firstOfType(node, type) {
        if (node.type === type) return node;
        for (var i = 0; i < node.childCount; i++) {
            var found = firstOfType(node.child(i), type);
            if (found) return found;
        }
        return null;
    }

    // Find all nodes of a given type
    function allOfType(node, type, results) {
        results = results || [];
        if (node.type === type) results.push(node);
        for (var i = 0; i < node.childCount; i++) {
            allOfType(node.child(i), type, results);
        }
        return results;
    }

    // Get the text of a named child by field name (graceful fallback)
    function fieldText(node, field) {
        var child = node.childForFieldName && node.childForFieldName(field);
        return child ? child.text : "";
    }

    // ── 2a. Property/val extractor ────────────────────────────────────────────
    // Looks for:  override val <name> ... = "<value>"
    // or:         override val <name> ... = "part1" + "part2" (concatenation)

    function extractValString(rootNode, valName) {
        var props = walkNodes(rootNode, function (n) {
            return n.type === "property_declaration";
        });
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var text = prop.text || "";
            // Check the identifier matches
            var idNode = firstOfType(prop, "simple_identifier");
            if (!idNode || idNode.text !== valName) continue;

            // Find the value part (after the `=`)
            // Collect all string literals in this declaration
            var strings = allOfType(prop, "string_literal");
            if (strings.length > 0) {
                // Join concatenated parts
                return strings.map(extractStringValue).join("").trim();
            }
        }
        return "";
    }

    // ── 2b. Function return-string extractor ──────────────────────────────────
    // Looks for:  override fun <name>(...): String = "..."
    // or:         override fun <name>(...) { return "..." }

    function extractFunString(rootNode, funName) {
        var funs = walkNodes(rootNode, function (n) {
            return n.type === "function_declaration";
        });
        for (var i = 0; i < funs.length; i++) {
            var fun = funs[i];
            var idNode = firstOfType(fun, "simple_identifier");
            if (!idNode || idNode.text !== funName) continue;

            var strings = allOfType(fun, "string_literal");
            if (strings.length > 0) {
                return extractStringValue(strings[0]);
            }
        }
        return "";
    }

    // ── 2c. Find the class that extends ParsedHttpSource / HttpSource ─────────

    function findSourceClass(rootNode) {
        var classes = walkNodes(rootNode, function (n) {
            return n.type === "class_declaration";
        });
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var text = cls.text || "";
            if (/ParsedHttpSource|HttpSource|MangaThemesia|Madara|WPMangaStream/.test(text)) {
                return cls;
            }
        }
        // Fallback: first class
        return classes[0] || rootNode;
    }

    // ── 2d. Detect parent theme/factory class ─────────────────────────────────

    function detectParentClass(rootNode) {
        var superCalls = walkNodes(rootNode, function (n) {
            return n.type === "delegation_specifier";
        });
        for (var i = 0; i < superCalls.length; i++) {
            var text = (superCalls[i].text || "").trim();
            // Strip call args
            var m = text.match(/^(\w+)/);
            if (m) return m[1];
        }
        return "";
    }

    // Known theme defaults (populated lazily from AST if possible)
    var THEME_DEFAULTS = {
        Madara: {
            chapterListSelector: "li.wp-manga-chapter",
            pageImageSelector: "div.page-break img, div.reading-content img",
            popularMangaSelector: "div.post-title",
            searchMangaSelector: "div.post-title",
        },
        MangaThemesia: {
            chapterListSelector: "div#chapterlist li",
            pageImageSelector: "div#readerarea img",
        },
        WPMangaStream: {
            chapterListSelector: "div#chapterlist li",
            pageImageSelector: "div#readerarea img",
        },
    };

    // ── 2e. Main extraction function ──────────────────────────────────────────

    function extractRecipe(ktSource, Parser, KotlinLang) {
        var parser = new Parser();
        parser.setLanguage(KotlinLang);
        var tree = parser.parse(ktSource);
        var root = tree.rootNode;

        var cls = findSourceClass(root);
        var parent = detectParentClass(root);
        var themeDefaults = THEME_DEFAULTS[parent] || {};

        // Core string vals
        var baseUrl = extractValString(root, "baseUrl");
        var name    = extractValString(root, "name");
        var lang    = extractValString(root, "lang");

        // Selectors — check as both val and fun
        function sel(key) {
            return extractValString(root, key)
                || extractFunString(root, key)
                || themeDefaults[key]
                || "";
        }

        var chapterListSelector = jqueryToCssSelector(sel("chapterListSelector"));
        var pageImageSelector   = jqueryToCssSelector(sel("pageImageSelector"));
        var popularMangaSelector = jqueryToCssSelector(sel("popularMangaSelector"));
        var searchMangaSelector  = jqueryToCssSelector(sel("searchMangaSelector")) || popularMangaSelector;

        // Extract the link selector used in searchMangaFromElement / mangaFromElement
        // e.g. mangaFromElement(element, "h3 a, h5 a") → we want "h3 a, h5 a"
        var searchMangaLinkSelector = "";
        var searchFromElNodes = walkNodes(root, function (n) {
            return n.type === "function_declaration"
                && (firstOfType(n, "simple_identifier") || {}).text === "searchMangaFromElement";
        });
        if (searchFromElNodes.length > 0) {
            // Look for string literals that look like CSS selectors (contain spaces or commas)
            var sfStrings = allOfType(searchFromElNodes[0], "string_literal");
            for (var si = 0; si < sfStrings.length; si++) {
                var sv = extractStringValue(sfStrings[si]);
                // Heuristic: if it contains "a" and looks like a selector
                if (sv && /\ba\b/.test(sv) && (sv.includes(" ") || sv.includes(","))) {
                    searchMangaLinkSelector = sv;
                    break;
                }
            }
        }
        // Also check mangaFromElement helper which is often called with a urlSelector arg
        if (!searchMangaLinkSelector) {
            var mangaFromElNodes = walkNodes(root, function (n) {
                return n.type === "function_declaration"
                    && (firstOfType(n, "simple_identifier") || {}).text === "mangaFromElement";
            });
            if (mangaFromElNodes.length > 0) {
                // The urlSelector parameter is typically used as-is for the link
                var params = walkNodes(mangaFromElNodes[0], function (n) {
                    return n.type === "parameter";
                });
                // The last parameter is usually urlSelector
                if (params.length > 1) {
                    var lastParam = params[params.length - 1];
                    searchMangaLinkSelector = (firstOfType(lastParam, "simple_identifier") || {}).text || "";
                    // This gives us the param name, not the value — we need callsite analysis
                    // Look for the call in searchMangaFromElement body
                    if (searchFromElNodes.length > 0) {
                        var callStrings = allOfType(searchFromElNodes[0], "string_literal");
                        for (var csi = 0; csi < callStrings.length; csi++) {
                            var csv2 = extractStringValue(callStrings[csi]);
                            if (csv2 && /\ba\b/.test(csv2)) {
                                searchMangaLinkSelector = csv2;
                                break;
                            }
                        }
                    }
                }
            }
        }
        searchMangaLinkSelector = jqueryToCssSelector(searchMangaLinkSelector);

        // ── Search URL strategy ───────────────────────────────────────────────
        // We extract enough metadata from searchMangaRequest to replicate it
        // in JS. There are two dominant patterns in Tachiyomi extensions:
        //
        //  A) Path-segment style:
        //       url.addPathSegments("Find/$query")
        //     → baseUrl/Find/{query}
        //
        //  B) Query-parameter style:
        //       url.addQueryParameter("s", query)
        //     → baseUrl/?s={query}
        //
        // We walk the searchMangaRequest function body as text (not AST here,
        // since the string arguments are what matter) and look for both patterns.

        var searchStrategy = null; // { type: "path"|"param", value: string }

        // Isolate the searchMangaRequest function body
        var searchFuncBody = "";
        var searchFunNodes = walkNodes(root, function (n) {
            return n.type === "function_declaration"
                && (firstOfType(n, "simple_identifier") || {}).text === "searchMangaRequest";
        });
        if (searchFunNodes.length > 0) {
            searchFuncBody = searchFunNodes[0].text || "";
        }

        if (searchFuncBody) {
            // Pattern A: addPathSegments("...query...")
            // e.g.  url.addPathSegments("Find/$query")
            //       url.addPathSegments("search?q=$query")
            // Matches both $query and ${query} interpolation
            var pathSegMatch = searchFuncBody.match(
                /addPathSegments\s*\(\s*"([^"]*?\$[{]?query[}]?[^"]*?)"\s*\)/
            );
            if (pathSegMatch) {
                // Extract the literal prefix before the $query interpolation
                // e.g. "Find/$query" → prefix = "Find/"
                var segTemplate = pathSegMatch[1];
                searchStrategy = { type: "path", template: segTemplate };
            }

            if (!searchStrategy) {
                // Pattern B: addQueryParameter("key", query)
                var qpMatch = searchFuncBody.match(
                    /addQueryParameter\s*\(\s*["']([^"']+)["']\s*,\s*(?:query|encodedQuery|searchQuery)\b/
                );
                if (qpMatch) {
                    searchStrategy = { type: "param", paramName: qpMatch[1] };
                }
            }

            if (!searchStrategy) {
                // Pattern C: direct string interpolation in GET("$baseUrl/path/$query")
                var directMatch = searchFuncBody.match(
                    /GET\s*\(\s*"\$baseUrl\/([^"]*?\$[{]?query[}]?[^"]*?)"\s*[,)]/
                );
                if (directMatch) {
                    searchStrategy = { type: "path", template: directMatch[1] };
                }
            }
        }

        // Fallback: if the extension has a searchMangaSelector but we still
        // couldn't figure out the URL, mark it as unknown so we skip search
        // and go straight to the popular/latest page approach.
        if (!searchStrategy) {
            console.warn("[ext-bridge] Could not determine search URL strategy from searchMangaRequest");
            searchStrategy = { type: "unknown" };
        }

        // Chapter URL / name selectors
        var chapterUrlSelector  = extractFunString(root, "chapterFromElement") || "a";
        var chapterNameSelector = "";

        // Look for chapterFromElement body for attr("href") and text patterns
        var chapterFunNodes = walkNodes(root, function (n) {
            return n.type === "function_declaration"
                && (firstOfType(n, "simple_identifier") || {}).text === "chapterFromElement";
        });
        if (chapterFunNodes.length > 0) {
            var body = chapterFunNodes[0].text || "";
            console.log("[ext-bridge] chapterFromElement body:", body);
            var hrefMatch = body.match(/\.select\("([^"]+)"\)[\s\S]{0,100}?\.attr\(["']href["']\)/);
            if (hrefMatch) {
                console.log("[ext-bridge] Found href selector:", hrefMatch[1], "->", jqueryToCssSelector(hrefMatch[1]));
                chapterUrlSelector = jqueryToCssSelector(hrefMatch[1]);
            }
            var nameMatch = body.match(/\.select\("([^"]+)"\)[\s\S]{0,100}?\.text\(\)/);
            if (nameMatch) {
                console.log("[ext-bridge] Found name selector:", nameMatch[1], "->", jqueryToCssSelector(nameMatch[1]));
                chapterNameSelector = jqueryToCssSelector(nameMatch[1]);
            }
        }
        // Fallback: if chapterNameSelector is still empty, try a broader pattern
        if (!chapterNameSelector && chapterFunNodes.length > 0) {
            var body = chapterFunNodes[0].text || "";
            var allSelectMatches = body.matchAll(/\.select\("([^"]+)"\)/g);
            for (var match of allSelectMatches) {
                var sel = match[1];
                if (sel && !sel.includes("a")) {
                    // Likely the name selector (not the link selector)
                    console.log("[ext-bridge] Fallback found selector:", sel, "->", jqueryToCssSelector(sel));
                    chapterNameSelector = jqueryToCssSelector(sel);
                    break;
                }
            }
        }
        console.log("[ext-bridge] Final chapterNameSelector:", chapterNameSelector);

        // Page image: look for pageListParse
        var pageListNodes = walkNodes(root, function (n) {
            return n.type === "function_declaration"
                && (firstOfType(n, "simple_identifier") || {}).text === "pageListParse";
        });
        if (pageListNodes.length > 0 && !pageImageSelector) {
            var body2 = pageListNodes[0].text || "";
            var imgMatch = body2.match(/\.select\("([^"]+)"\)/);
            if (imgMatch) pageImageSelector = jqueryToCssSelector(imgMatch[1]);
        }

        // Date format
        var dateFormatMatch = ktSource.match(/SimpleDateFormat\(\s*"([^"]+)"/);
        var dateFormat = dateFormatMatch ? dateFormatMatch[1] : "yyyy-MM-dd";

        // Headers
        var headers = {};
        var refererMatch = ktSource.match(/["']Referer["']\s*(?:to|,)\s*["']([^"']+)["']/);
        if (refererMatch) headers["Referer"] = refererMatch[1];

        var recipe = {
            name: name,
            lang: lang,
            baseUrl: baseUrl,
            parent: parent,
            selectors: {
                chapterList: chapterListSelector,
                chapterUrl: chapterUrlSelector,
                chapterName: chapterNameSelector,
                pageImages: pageImageSelector,
                searchManga: searchMangaSelector,
                searchMangaLink: searchMangaLinkSelector,
            },
            searchStrategy: searchStrategy,
            dateFormat: dateFormat,
            headers: headers,
        };

        return recipe;
    }

    // ── 3. Kotlin source fetcher ──────────────────────────────────────────────

    function pkgToPath(pkg) {
        return String(pkg || "").split(".").join("/");
    }
    function extIdFromPkg(pkg) {
        var parts = String(pkg || "").split(".");
        return parts[parts.length - 1] || "";
    }
    function langFromPkg(pkg) {
        var parts = String(pkg || "").split(".");
        var idx = parts.indexOf("extension");
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
        return (parts.find(function (p) { return /^[a-z]{2}$/.test(p); }) || "");
    }
    function titleCase(s) {
        s = String(s || "");
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }
    function buildKtUrl(ext) {
        var pkg  = ext.pkg || "";
        var id   = extIdFromPkg(pkg);
        var lang = langFromPkg(pkg);
        if (!id || !lang) return "";
        return "https://raw.githubusercontent.com/keiyoushi/extensions-source/refs/heads/main/src/"
            + lang + "/" + id + "/src/" + pkgToPath(pkg) + "/" + titleCase(id) + ".kt";
    }

    function fetchText(url) {
        return fetch(url, { cache: "no-cache" }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status + " fetching " + url);
            return r.text();
        });
    }

    // Recipe sessionStorage cache
    function recipeKey(ext) {
        return RECIPE_CACHE_KEY + "|" + (ext.pkg || "") + "|" + (ext.version || "");
    }
    function getCachedRecipe(ext) {
        try { return JSON.parse(sessionStorage.getItem(recipeKey(ext)) || "null"); }
        catch (_) { return null; }
    }
    function cacheRecipe(ext, recipe) {
        try { sessionStorage.setItem(recipeKey(ext), JSON.stringify(recipe)); } catch (_) {}
    }

    // ── 4. AniList GraphQL ────────────────────────────────────────────────────

    function getAnilistIdFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search);
            var id = params.get("id");
            if (id) return parseInt(id, 10);
        } catch (_) {}
        return null;
    }

    function fetchAnilistTitles(anilistId) {
        var query = "\n            query ($id: Int) {\n                Media(id: $id, type: MANGA) {\n                    title {\n                        romaji\n                        english\n                        native\n                        userPreferred\n                    }\n                    synonyms\n                }\n            }\n        ";
        return fetch(ANILIST_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, variables: { id: anilistId } }),
        }).then(function (r) {
            if (!r.ok) throw new Error("AniList API error: " + r.status);
            return r.json();
        }).then(function (data) {
            var media = data && data.data && data.data.Media;
            if (!media) throw new Error("No media found for id " + anilistId);
            var titles = [];
            var t = media.title || {};
            // Preferred title first
            if (t.userPreferred) titles.push(t.userPreferred);
            if (t.english && titles.indexOf(t.english) < 0)   titles.push(t.english);
            if (t.romaji  && titles.indexOf(t.romaji)  < 0)   titles.push(t.romaji);
            if (t.native  && titles.indexOf(t.native)  < 0)   titles.push(t.native);
            // Synonyms
            (media.synonyms || []).forEach(function (s) {
                if (s && titles.indexOf(s) < 0) titles.push(s);
            });
            return titles;
        });
    }

    // ── 5. Extension search & best-match ─────────────────────────────────────

    function buildSearchUrl(recipe, query) {
        var base = recipe.baseUrl.replace(/\/$/, "");
        var strategy = recipe.searchStrategy || { type: "unknown" };

        if (strategy.type === "path") {
            // Replace Kotlin string interpolation: $query or ${query}
            // The template is the raw string argument to addPathSegments,
            // e.g. "Find/$query" → base + "/Find/" + encodeURIComponent(query)
            var filled = strategy.template
                .replace(/\$\{?query\}?/g, encodeURIComponent(query))
                .replace(/\$\{?encodedQuery\}?/g, encodeURIComponent(query))
                .replace(/\$\{?searchQuery\}?/g, encodeURIComponent(query));
            // Some templates already include a leading slash, others don't
            var sep = filled.startsWith("/") ? "" : "/";
            return base + sep + filled;
        }

        if (strategy.type === "param") {
            return base + "/?" + strategy.paramName + "=" + encodeURIComponent(query);
        }

        // type === "unknown": we can't construct a search URL from the source.
        // Return null so the caller knows to skip search.
        return null;
    }

    function fetchDocument(url, headers) {
        var proxiedUrl = "https://corsproxy.io/?url=" + encodeURIComponent(url);
        return fetch(proxiedUrl, { cache: "no-cache", headers: headers || {} })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
                return r.text();
            }).then(function (html) {
                return new DOMParser().parseFromString(html, "text/html");
            });
    }

    function cssSelectSafe(doc, selector) {
        if (!doc || !selector) return [];
        try {
            // Strip :has() for browsers that don't support it
            if (!CSS.supports("selector(:has(a))") && selector.includes(":has(")) {
                selector = selector.replace(/:has\([^)]*\)/g, "").trim();
            }
            return Array.from(doc.querySelectorAll(selector));
        } catch (_) { return []; }
    }

    // Score a manga title match — higher is better
    function scoreMatch(candidateTitle, queryTitle) {
        var c = candidateTitle.toLowerCase().trim();
        var q = queryTitle.toLowerCase().trim();
        if (c === q) return 100;
        if (c.includes(q) || q.includes(c)) return 60;
        // word overlap
        var cWords = c.split(/\W+/).filter(Boolean);
        var qWords = q.split(/\W+/).filter(Boolean);
        var overlap = qWords.filter(function (w) { return cWords.indexOf(w) >= 0; }).length;
        return (overlap / Math.max(qWords.length, 1)) * 40;
    }

    function searchForManga(recipe, titles) {
        // If the search strategy is unknown we cannot search — fail fast
        // so the caller can decide to skip or error cleanly.
        if (!recipe.searchStrategy || recipe.searchStrategy.type === "unknown") {
            return Promise.reject(new Error(
                "Cannot determine search URL for this extension. "
                + "The searchMangaRequest function uses an unsupported URL-building pattern."
            ));
        }

        // Try each title in order, stop at first successful result with a good score
        var tried = [];
        function tryNext(idx) {
            if (idx >= titles.length) {
                return Promise.reject(new Error(
                    "No manga found after searching " + tried.length + " title(s): "
                    + tried.slice(0, 3).map(function (t) { return '"' + t + '"'; }).join(", ")
                ));
            }
            var title = titles[idx];
            tried.push(title);

            var url = buildSearchUrl(recipe, title);
            if (!url) {
                // Shouldn't happen if strategy check above passed, but guard anyway
                return Promise.reject(new Error("buildSearchUrl returned null"));
            }

            console.log("[ext-bridge] Searching (" + (idx + 1) + "/" + titles.length + "):", url);

            return fetchDocument(url, recipe.headers).then(function (doc) {
                var sel = recipe.selectors.searchManga || recipe.selectors.popularManga;
                if (!sel) throw new Error("No searchMangaSelector in recipe");

                var results = cssSelectSafe(doc, sel);
                console.log("[ext-bridge] Search results for '" + title + "':", results.length);

                if (results.length === 0) {
                    return tryNext(idx + 1);
                }

                // Score every result against all known titles
                var best = null;
                var bestScore = -1;
                results.forEach(function (el) {
                    // Find the link element — try the configured selector first
                    var linkSel = recipe.selectors.searchMangaLink || "h3 a, h5 a, a";
                    var aEl = el.querySelector(linkSel) || (el.tagName === "A" ? el : null);
                    if (!aEl) return;
                    var elTitle = (aEl.getAttribute("title") || aEl.textContent || "").trim();
                    var score = 0;
                    titles.forEach(function (t) {
                        var s = scoreMatch(elTitle, t);
                        if (s > score) score = s;
                    });
                    if (score > bestScore) {
                        bestScore = score;
                        var href = aEl.getAttribute("href") || "";
                        // Resolve relative URLs against the extension's baseUrl
                        if (href && !href.startsWith("http")) {
                            try { href = new URL(href, recipe.baseUrl).toString(); } catch (_) {}
                        }
                        best = { url: href, title: elTitle, score: score };
                    }
                });

                if (best && best.score >= 40) {
                    console.log("[ext-bridge] Best match:", best.title, "(score " + best.score + ")");
                    return best;
                }

                // Score too low — try the next title
                console.log("[ext-bridge] Best score too low (" + bestScore + ") for '" + title + "', trying next title");
                return tryNext(idx + 1);

            }).catch(function (err) {
                // Network/parse error for this title — try the next one rather than hard-failing
                console.warn("[ext-bridge] Search error for '" + title + "':", err.message);
                return tryNext(idx + 1);
            });
        }

        return tryNext(0);
    }

    // ── 6. Chapter list fetching ──────────────────────────────────────────────

    function parseDate(str, fmt) {
        str = String(str || "").trim();
        if (!str) return 0;
        // Try direct parse first
        var d = new Date(str);
        if (!isNaN(d.getTime())) return d.getTime();
        // yyyy/MM/dd or yyyy-MM-dd
        var m = str.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
        return 0;
    }

    function fetchChapters(recipe, mangaUrl) {
        console.log("[ext-bridge] Fetching chapters from:", mangaUrl);
        return fetchDocument(mangaUrl, recipe.headers).then(function (doc) {
            var sel = recipe.selectors.chapterList;
            if (!sel) throw new Error("No chapterListSelector in recipe");
            var rows = cssSelectSafe(doc, sel);
            console.log("[ext-bridge] Found", rows.length, "chapter rows");

            var chapters = rows.map(function (row) {
                // URL
                var aEl = row.querySelector("a") || (row.tagName === "A" ? row : null);
                var href = aEl ? (aEl.href || aEl.getAttribute("href") || "") : "";
                if (href && !href.startsWith("http")) {
                    try { href = new URL(href, recipe.baseUrl).toString(); } catch (_) {}
                }

                // Name
                var nameSel = recipe.selectors.chapterName;
                var nameEl  = nameSel ? row.querySelector(nameSel) : null;
                var name    = (nameEl || aEl || row).textContent.trim();

                // Date — look for common date containers
                var dateSel  = "span.chapter-release-date, td:nth-child(2), .chapter-date, time";
                var dateEl   = row.querySelector(dateSel);
                var dateText = dateEl ? (dateEl.getAttribute("datetime") || dateEl.textContent).trim() : "";

                return {
                    name: name,
                    url: href,
                    date: parseDate(dateText, recipe.dateFormat),
                };
            }).filter(function (c) { return !!c.url; });

            // Most extensions return newest-first; reverse to oldest-first for display
            // Actually keep as-is (extension order is canonical)
            return chapters;
        });
    }

    // ── 7. Chapter list DOM replacement ──────────────────────────────────────

    function setChapterListLoading(on) {
        var overlay = document.querySelector(".ext-chapterlist-overlay");
        if (!overlay) {
            var container = document.querySelector('[data-chapter-list-bulk-actions-container="true"]');
            if (container) {
                container.style.position = container.style.position || "relative";
                overlay = document.createElement("div");
                overlay.className = "ext-chapterlist-overlay ext-chapterlist-overlay-heavy";
                var spinner = document.createElement("span");
                spinner.className = "ext-spinner";
                var label = document.createElement("p");
                label.className = "ext-chapterlist-overlay-label";
                label.textContent = "Loading chapters…";
                overlay.appendChild(spinner);
                overlay.appendChild(label);
                container.appendChild(overlay);
            }
        }
        if (overlay) overlay.style.display = on ? "flex" : "none";
    }

    function setOverlayLabel(text) {
        var label = document.querySelector(".ext-chapterlist-overlay-label");
        if (label) label.textContent = text;
    }

    // Build a single chapter row matching Seanime's existing table structure
    function buildChapterRow(ch) {
        var tr = document.createElement("tr");
        tr.className = "UI-DataGrid__tr hover:bg-[--subtle] truncate";

        var tdClass = "UI-DataGrid__td px-2 py-2 w-full whitespace-nowrap text-base font-normal "
            + "text-[--foreground] data-[action-col=false]:truncate border-b border-[rgba(255,255,255,0.05)]";

        // Checkbox cell
        var tdChk = document.createElement("td");
        tdChk.className = tdClass + " ext-chapter-row-td";
        tdChk.setAttribute("data-is-selection-col", "true");
        tdChk.setAttribute("data-action-col", "false");
        tdChk.setAttribute("data-row-selected", "false");
        var chkWrap = document.createElement("div");
        var chkLabel = document.createElement("label");
        chkLabel.className = "UI-Checkbox__container inline-flex gap-2 items-center";
        var chkBtn = document.createElement("button");
        chkBtn.type = "button";
        chkBtn.role = "checkbox";
        chkBtn.setAttribute("aria-checked", "false");
        chkBtn.setAttribute("data-state", "unchecked");
        chkBtn.setAttribute("data-disabled", "false");
        chkBtn.className = "UI-Checkbox__root appearance-none peer block relative overflow-hidden "
            + "transition shrink-0 text-white rounded-[--radius-md] ring-offset-1 border "
            + "ring-offset-[--background] border-gray-300 dark:border-gray-700 outline-none "
            + "h-5 w-5 dark:bg-gray-700";
        chkLabel.appendChild(chkBtn);
        chkWrap.appendChild(chkLabel);
        tdChk.appendChild(chkWrap);
        tr.appendChild(tdChk);

        // Name cell
        var tdName = document.createElement("td");
        tdName.className = tdClass + " ext-chapter-row-name";
        tdName.setAttribute("data-is-selection-col", "false");
        tdName.setAttribute("data-action-col", "false");
        tdName.textContent = ch.name || "";
        tr.appendChild(tdName);

        // Number cell (empty for external chapters)
        var tdNum = document.createElement("td");
        tdNum.className = tdClass + " ext-chapter-row-num";
        tdNum.setAttribute("data-is-selection-col", "false");
        tdNum.setAttribute("data-action-col", "false");
        // Try to parse a number from the chapter name
        var numMatch = (ch.name || "").match(/[\d]+(?:\.\d+)?/);
        tdNum.textContent = numMatch ? numMatch[0] : "";
        tr.appendChild(tdNum);

        // Action cell — read button linking to chapter URL
        var tdAction = document.createElement("td");
        tdAction.className = tdClass + " ext-chapter-row-action";
        tdAction.setAttribute("data-is-selection-col", "false");
        tdAction.setAttribute("data-action-col", "true");
        tdAction.setAttribute("data-row-selected", "false");
        var actWrap = document.createElement("div");
        actWrap.className = "flex justify-end gap-2 items-center w-full";
        if (ch.url) {
            var readBtn = document.createElement("a");
            readBtn.href = ch.url;
            readBtn.target = "_blank";
            readBtn.className = "ext-chapter-read-btn";
            readBtn.innerHTML = '<svg stroke="currentColor" fill="none" stroke-width="2" '
                + 'viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" '
                + 'height="1em" width="1em">'
                + '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>'
                + '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>'
                + '</svg>';
            actWrap.appendChild(readBtn);
        }
        tdAction.appendChild(actWrap);
        tr.appendChild(tdAction);

        return tr;
    }

    function replaceChapterList(chapters) {
        var tbody = document.querySelector(".UI-DataGrid__tableBody");
        if (!tbody) {
            console.warn("[ext-bridge] tbody not found");
            return false;
        }
        // Clear native rows
        tbody.innerHTML = "";

        if (chapters.length === 0) {
            var emptyRow = document.createElement("tr");
            var emptyCell = document.createElement("td");
            emptyCell.colSpan = 4;
            emptyCell.className = "ext-chapter-empty-cell";
            emptyCell.textContent = "No chapters found from external source.";
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
            return true;
        }

        var frag = document.createDocumentFragment();
        chapters.forEach(function (ch) { frag.appendChild(buildChapterRow(ch)); });
        tbody.appendChild(frag);
        console.log("[ext-bridge] Replaced chapter list with", chapters.length, "chapters");

        // Update footer page count
        var footerStrong = document.querySelector(".UI-DataGrid__footerPageDisplayContainer strong");
        if (footerStrong) footerStrong.textContent = "1 / 1";

        return true;
    }

    // ── 8. Main pipeline ──────────────────────────────────────────────────────

    function runPipeline(ext) {
        activeExt = ext;
        window.__extBridgeLoading = true;
        setChapterListLoading(true);
        setOverlayLabel("Loading tree-sitter…");
        dispatch("ext:chaptersLoading", { ext: ext });

        var ktUrl = buildKtUrl(ext);
        if (!ktUrl) {
            var err = "Cannot derive .kt URL from pkg: " + (ext.pkg || "");
            dispatch("ext:bridgeError", { ext: ext, error: err });
            setChapterListLoading(false);
            window.__extBridgeLoading = false;
            return Promise.reject(new Error(err));
        }

        // Check recipe cache first
        var cached = getCachedRecipe(ext);
        var recipePromise;
        if (cached) {
            console.log("[ext-bridge] Using cached recipe for", ext.pkg);
            activeRecipe = cached;
            recipePromise = Promise.resolve(cached);
        } else {
            setOverlayLabel("Fetching extension source…");
            recipePromise = Promise.all([
                loadTreeSitter(),
                fetchText(ktUrl),
            ]).then(function (results) {
                var ts       = results[0];
                var ktSource = results[1];
                setOverlayLabel("Parsing Kotlin AST…");
                var recipe = extractRecipe(ktSource, ts.Parser, ts.KotlinLang);
                console.log("[ext-bridge] Recipe:", recipe);
                activeRecipe = recipe;
                cacheRecipe(ext, recipe);
                dispatch("ext:chaptersReady", { ext: ext, recipe: recipe });
                return recipe;
            });
        }

        return recipePromise.then(function (recipe) {
            if (!recipe.baseUrl) throw new Error("No baseUrl extracted from extension");

            // Determine manga URL
            setOverlayLabel("Looking up manga titles…");
            var anilistId = getAnilistIdFromUrl();
            if (!anilistId) throw new Error("Cannot determine AniList ID from current URL");

            return fetchAnilistTitles(anilistId).then(function (titles) {
                console.log("[ext-bridge] AniList titles:", titles);
                setOverlayLabel("Searching extension…");
                return searchForManga(recipe, titles);
            }).then(function (match) {
                if (!match || !match.url) throw new Error("No matching manga found in extension");
                var mangaUrl = match.url;
                if (!mangaUrl.startsWith("http")) {
                    try { mangaUrl = new URL(mangaUrl, recipe.baseUrl).toString(); } catch (_) {}
                }
                setOverlayLabel("Fetching chapter list…");
                return fetchChapters(recipe, mangaUrl);
            }).then(function (chapters) {
                replaceChapterList(chapters);
                dispatch("ext:chaptersFetchLoaded", { ext: ext, chapters: chapters });
            });
        }).catch(function (err) {
            console.error("[ext-bridge] Pipeline failed:", err);
            dispatch("ext:bridgeError", { ext: ext, error: String(err.message || err) });
            // Show error in table
            var tbody = document.querySelector(".UI-DataGrid__tableBody");
            if (tbody) {
                tbody.innerHTML = "";
                var errRow = document.createElement("tr");
                var errCell = document.createElement("td");
                errCell.colSpan = 4;
                errCell.className = "ext-chapter-error-cell";
                errCell.textContent = "External source error: " + (err.message || err);
                errRow.appendChild(errCell);
                tbody.appendChild(errRow);
            }
        }).finally(function () {
            setChapterListLoading(false);
            dispatch("ext:chaptersLoaded", { ext: ext });
            window.__extBridgeLoading = false;
        });
    }

    // ── 9. Public API ─────────────────────────────────────────────────────────

    window.__extBridge = window.__extBridge || {};
    window.__extBridge.getActiveExtension    = function () { return activeExt; };
    window.__extBridge.getActiveRecipe       = function () { return activeRecipe; };
    window.__extBridge.loadTreeSitter        = loadTreeSitter;
    window.__extBridge.runPipeline           = runPipeline;
    window.__extBridge.fetchAndReplaceChapters = function () {
        var ext = window.__extActiveSource;
        if (!ext) return Promise.resolve(null);
        return runPipeline(ext);
    };

    // ── 10. Event listeners ───────────────────────────────────────────────────

    document.addEventListener("ext:sourceChanged", function (e) {
        var ext = e.detail;
        if (!ext) {
            // "None" selected — restore native chapter list (reload page section)
            setChapterListLoading(false);
            return;
        }
        runPipeline(ext).catch(function (err) {
            console.error("[ext-bridge] runPipeline error:", err);
        });
    });

    // Preload tree-sitter in the background so it's warm when needed
    loadTreeSitter().catch(function (err) {
        console.warn("[ext-bridge] tree-sitter preload failed:", err.message);
    });

    // If there's already an active source from a previous session, run the pipeline
    if (window.__extActiveSource) {
        runPipeline(window.__extActiveSource).catch(function (err) {
            console.error("[ext-bridge] Initial pipeline error:", err);
        });
    }

})();
