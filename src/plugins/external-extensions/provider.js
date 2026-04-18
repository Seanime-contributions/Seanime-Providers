function init() {
    $ui.register(async (ctx) => {
        ctx.dom.onReady(async () => {

            const script = await ctx.dom.createElement("script");

            // This bootstrap is the ONLY thing bundled into the plugin.
            // Everything else is fetched from GitHub at runtime.
            const bootstrap = `
(function() {

    var BASE = "https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/refs/heads/main/src/plugins/external-extensions/";

    var ASSETS = {
        css:           BASE + "global.css",
        appJs:         BASE + "app.js",
        chapterListJs: BASE + "chapter-list.js",
        chaptersJs:    BASE + "chapters.js",
        components: [
            "installed-card",
            "add-modal",
            "picker-modal",
            "ext-source-dropdown"
        ]
    };

    // raw.githubusercontent.com sends Access-Control-Allow-Origin: *
    // so plain fetch() works fine from any origin.
    function fetchText(url) {
        return fetch(url, { cache: "no-cache" }).then(function(r) {
            if (!r.ok) throw new Error("Failed to fetch " + url + " (" + r.status + ")");
            return r.text();
        });
    }

    function injectCSS(css) {
        if (document.getElementById("ext-bridge-styles")) return;
        var el = document.createElement("style");
        el.id = "ext-bridge-styles";
        el.textContent = css;
        document.head.appendChild(el);
    }

    // Components are stored as HTML strings in window.__extComponents so
    // app.js / chapter-list.js can call window.__extComponents["name"]()
    // to get a fresh DocumentFragment clone each time.
    function registerComponent(name, html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var tpl = doc.body;
        window.__extComponents = window.__extComponents || {};
        window.__extComponents[name] = function() {
            var frag = document.createDocumentFragment();
            Array.from(tpl.childNodes).forEach(function(n) {
                frag.appendChild(n.cloneNode(true));
            });
            return frag;
        };
    }

    function runScript(code) {
        // eslint-disable-next-line no-new-func
        (new Function(code))();
    }

    // Boot sequence:
    // 1. Fetch CSS + all component HTML files in parallel.
    // 2. Once both are ready, fetch and run app.js (extensions page logic).
    // 3. Then fetch and run chapter-list.js (chapter list UI hijack).
    //    chapter-list.js runs after app.js so __extComponents is guaranteed
    //    to be populated when chapter-list.js calls stamp().
    var componentFetches = ASSETS.components.map(function(name) {
        return fetchText(BASE + "components/" + name + ".html").then(function(html) {
            registerComponent(name, html);
        });
    });

    Promise.all([
        fetchText(ASSETS.css).then(injectCSS),
        Promise.all(componentFetches)
    ])
    .then(function() {
        return fetchText(ASSETS.appJs);
    })
    .then(function(appCode) {
        runScript(appCode);
        fetchText(ASSETS.chapterListJs).then(runScript).catch(function(err) {
            console.error("[ext-bridge] chapter-list.js failed:", err);
        });

        fetchText(ASSETS.chaptersJs).then(runScript).catch(function(err) {
            console.error("[ext-bridge] chapters.js failed:", err);
        });
    })
    .catch(function(err) {
        console.error("[ext-bridge] Boot failed:", err);
    });

})();

`;

            await script.setText(bootstrap);
            const body = await ctx.dom.queryOne("body");
            if (body) await body.append(script);
        });
    });
}
