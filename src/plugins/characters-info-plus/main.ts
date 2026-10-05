function init() {
    $ui.register((ctx) => {
        ctx.dom.onReady(async () => {
            const head = await ctx.dom.queryOne("head");
            if (!head) return;

            const script = await ctx.dom.createElement("script");
            script.setText(`
(function () {
    "use strict";

    const PLUGIN_VERSION = "7";
    if (window.__charactersInfoPlusVersion === PLUGIN_VERSION) return;
    window.__charactersInfoPlusVersion = PLUGIN_VERSION;
    window.__charactersInfoPlusLoaded = true;

    const STYLE_ID = "characters-info-plus-styles-v7";
    const TOOLTIP_ID = "characters-info-plus-tooltip-v7";
    const BOUND_KEY = "cipBoundV7";
    const CARD_SELECTOR = '[data-media-entry-characters-section-grid-item="true"]';
    const LINK_SELECTOR = '[data-media-entry-characters-section-grid-item-content-link="true"]';
    const cache = new Map();
    let activeCard = null;
    let activeCharacterId = null;
    let tooltip = null;
    let overTooltip = false;
    let hideTimer = null;
    let scanTimer = null;

    function onEntryRoute() {
        return /^(\\/manga)?\\/entry\\/?$/.test(window.location.pathname)
            && new URLSearchParams(window.location.search).has("id");
    }

    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        ["characters-info-plus-styles", "characters-info-plus-styles-v2", "characters-info-plus-styles-v3", "characters-info-plus-styles-v4", "characters-info-plus-styles-v5", "characters-info-plus-styles-v6"].forEach(function (styleId) {
            const legacyStyle = document.getElementById(styleId);
            if (legacyStyle) legacyStyle.remove();
        });
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = \`
            @keyframes cip-pop-in {
                from { opacity: 0; transform: translateY(8px) scale(.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes cip-fade-out {
                from { opacity: 1; transform: translateY(0) scale(1); }
                to { opacity: 0; transform: translateY(5px) scale(.98); }
            }
            @keyframes cip-image-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(var(--color-brand-500), 0); }
                50% { box-shadow: 0 0 0 5px rgba(var(--color-brand-500), .18); }
            }
            .cip-character-card {
                cursor: help;
            }
            .cip-character-card:hover [data-media-entry-characters-section-grid-item-image-container="true"] {
                animation: cip-image-pulse 1.2s ease-in-out;
            }
            #\${TOOLTIP_ID} {
                position: fixed;
                z-index: 2147483000;
                width: min(340px, calc(100vw - 24px));
                box-sizing: border-box;
                padding: 14px;
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 14px;
                background: rgba(0, 0, 0, .97);
                color: #fff;
                box-shadow: 0 16px 45px rgba(0,0,0,.42);
                backdrop-filter: blur(14px);
                font-family: inherit;
                pointer-events: auto;
                animation: cip-pop-in .18s ease-out both;
            }
            #\${TOOLTIP_ID}.cip-hiding { pointer-events:none; animation: cip-fade-out .18s ease-in both; }
            #\${TOOLTIP_ID} .cip-close { position:absolute; top:5px; right:7px; width:22px; height:22px; padding:0; border:0; background:transparent; color:#fff; opacity:.62; cursor:pointer; font:inherit; font-size:20px; line-height:20px; }
            #\${TOOLTIP_ID} .cip-close:hover { color:rgb(var(--color-brand-500)); opacity:1; }
            #\${TOOLTIP_ID} .cip-header { display:flex; gap:10px; align-items:center; }
            #\${TOOLTIP_ID} .cip-avatar { width:48px; height:64px; flex:none; object-fit:cover; border-radius:8px; background:#111; }
            #\${TOOLTIP_ID} .cip-name { margin:0; font-size:15px; line-height:1.2; font-weight:700; }
            #\${TOOLTIP_ID} .cip-native { margin:3px 0 0; color:#fff; opacity:.62; font-size:11px; }
            #\${TOOLTIP_ID} .cip-role { margin:10px 0 0; color:rgb(var(--color-brand-500)); font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
            #\${TOOLTIP_ID} .cip-description { position:relative; margin:9px 0 0; max-height:190px; overflow:hidden; opacity:.86; font-size:12px; line-height:1.5; }
            #\${TOOLTIP_ID} .cip-description::after { content:""; position:absolute; right:0; bottom:0; left:0; height:34px; background:linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,.97)); pointer-events:none; }
            #\${TOOLTIP_ID} .cip-description p { margin:0 0 8px; }
            #\${TOOLTIP_ID} .cip-description p:last-child { margin-bottom:0; }
            #\${TOOLTIP_ID} .cip-description h1, #\${TOOLTIP_ID} .cip-description h2, #\${TOOLTIP_ID} .cip-description h3 { margin:0 0 7px; color:#fff; font-size:13px; line-height:1.3; }
            #\${TOOLTIP_ID} .cip-description ul, #\${TOOLTIP_ID} .cip-description ol { margin:0 0 8px 18px; padding:0; }
            #\${TOOLTIP_ID} .cip-description blockquote { margin:0 0 8px; padding-left:9px; border-left:2px solid rgb(var(--color-brand-500)); opacity:.8; }
            #\${TOOLTIP_ID} .cip-description code { padding:1px 4px; border-radius:4px; background:#171717; color:rgb(var(--color-brand-500)); font-size:11px; }
            #\${TOOLTIP_ID} .cip-description a { color:rgb(var(--color-brand-500)); text-decoration:underline; }
            #\${TOOLTIP_ID} .cip-meta { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; opacity:.72; font-size:10px; }
            #\${TOOLTIP_ID} .cip-meta span { padding:3px 6px; border:1px solid currentColor; border-radius:999px; }
            #\${TOOLTIP_ID} .cip-more { display:inline-flex; margin-top:12px; padding:7px 10px; border-radius:8px; background:rgb(var(--color-brand-500)); color:#000; font-size:11px; font-weight:700; text-decoration:none; }
            #\${TOOLTIP_ID} .cip-more:hover { filter:brightness(1.1); }
            #\${TOOLTIP_ID} .cip-loading { color:#fff; opacity:.7; font-size:12px; }
            #\${TOOLTIP_ID} .cip-error { color:#fff; opacity:.8; font-size:12px; }
            #characters-info-plus-tooltip, #characters-info-plus-tooltip-v2, #characters-info-plus-tooltip-v3, #characters-info-plus-tooltip-v4, #characters-info-plus-tooltip-v5, #characters-info-plus-tooltip-v6 { display:none !important; }
        \`;
        document.head.appendChild(style);
    }

    function characterId(card) {
        const link = card.querySelector(LINK_SELECTOR);
        const match = link && link.href.match(/\\/character\\/(\\d+)/);
        return match ? match[1] : null;
    }

    function characterUrl(id) {
        return "https://anilist.co/character/" + encodeURIComponent(id);
    }

    function fetchCharacter(id) {
        if (cache.has(id)) return cache.get(id);
        const request = fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                query: \`query ($id: Int) {
                    Character(id: $id) {
                        id
                        name { full native }
                        image { large }
                        description(asHtml: false)
                        gender
                        dateOfBirth { year month day }
                        age
                        bloodType
                        siteUrl
                    }
                }\`,
                variables: { id: Number(id) }
            })
        }).then(function (response) {
            if (!response.ok) throw new Error("AniList returned HTTP " + response.status);
            return response.json();
        }).then(function (payload) {
            if (!payload.data || !payload.data.Character) throw new Error("Character not found");
            return payload.data.Character;
        });
        let timeoutId;
        const promise = Promise.race([
            request,
            new Promise(function (_, reject) {
                timeoutId = setTimeout(function () { reject(new Error("AniList request timed out")); }, 6000);
            })
        ]).finally(function () { clearTimeout(timeoutId); });
        cache.set(id, promise);
        return promise;
    }

    function ensureTooltip() {
        if (tooltip && tooltip.isConnected) return tooltip;
        tooltip = document.createElement("div");
        tooltip.id = TOOLTIP_ID;
        tooltip.addEventListener("mouseenter", function () {
            overTooltip = true;
            clearTimeout(hideTimer);
        });
        tooltip.addEventListener("mouseleave", function () {
            overTooltip = false;
            scheduleHide();
        });
        document.body.appendChild(tooltip);
        return tooltip;
    }

    function positionTooltip(card) {
        if (!tooltip || !card || !card.isConnected) return;
        const thumbnail = card.querySelector('[data-media-entry-characters-section-grid-item-image-container="true"]');
        const rect = (thumbnail || card).getBoundingClientRect();
        const gap = 6;
        const width = Math.min(340, window.innerWidth - 24);
        const height = tooltip.offsetHeight || 220;
        let left = rect.right + gap;
        if (left + width > window.innerWidth - 12) left = rect.left - width - gap;
        left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
        let top = rect.top;
        if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12;
        top = Math.max(12, top);
        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
    }

    function closeTooltip() {
        if (!tooltip) return;
        activeCard = null;
        activeCharacterId = null;
        tooltip.classList.remove("cip-visible");
        tooltip.classList.add("cip-hiding");
        setTimeout(function () {
            if (tooltip && tooltip.classList.contains("cip-hiding")) {
                tooltip.style.display = "none";
                tooltip.classList.remove("cip-hiding");
            }
        }, 180);
    }

    function resetTooltip(box) {
        box.className = "cip-visible";
        box.innerHTML = "";
        const closeButton = document.createElement("button");
        closeButton.className = "cip-close";
        closeButton.type = "button";
        closeButton.textContent = "×";
        closeButton.setAttribute("aria-label", "Close character information");
        closeButton.title = "Close";
        closeButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            closeTooltip();
        });
        box.appendChild(closeButton);
    }

    function showLoading(card) {
        const box = ensureTooltip();
        resetTooltip(box);
        appendText(box, "div", "cip-loading", "Loading character info…");
        box.style.display = "block";
        positionTooltip(card);
    }

    function appendText(parent, tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }

    function markdownInline(value) {
        let text = escapeHtml(value);
        text = text.replace(/\\x60([^\\x60\\n]+)\\x60/g, "<code>$1</code>");
        text = text.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        text = text.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
        text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
        text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        text = text.replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g, "$1<em>$2</em>");
        text = text.replace(/(^|[^_])_([^_\\n]+)_(?!_)/g, "$1<em>$2</em>");
        return text;
    }

    function markdownToHtml(value) {
        const lines = String(value || "").replace(/\\r/g, "").split("\\n");
        const output = [];
        let paragraph = [];
        let listType = null;

        function closeParagraph() {
            if (paragraph.length) {
                output.push("<p>" + paragraph.map(markdownInline).join("<br>") + "</p>");
                paragraph = [];
            }
        }
        function closeList() {
            if (listType) {
                output.push("</" + listType + ">");
                listType = null;
            }
        }

        lines.forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed) {
                closeParagraph();
                closeList();
                return;
            }
            const heading = trimmed.match(/^(#{1,3})\\s+(.+)$/);
            const unordered = trimmed.match(/^[-*+]\\s+(.+)$/);
            const ordered = trimmed.match(/^\\d+[.]\\s+(.+)$/);
            const quote = trimmed.match(/^>\\s?(.+)$/);
            if (heading) {
                closeParagraph();
                closeList();
                const tag = "h" + heading[1].length;
                output.push("<" + tag + ">" + markdownInline(heading[2]) + "</" + tag + ">");
            } else if (unordered || ordered) {
                closeParagraph();
                const nextType = unordered ? "ul" : "ol";
                if (listType !== nextType) {
                    closeList();
                    listType = nextType;
                    output.push("<" + listType + ">");
                }
                output.push("<li>" + markdownInline((unordered || ordered)[1]) + "</li>");
            } else if (quote) {
                closeParagraph();
                closeList();
                output.push("<blockquote>" + markdownInline(quote[1]) + "</blockquote>");
            } else {
                closeList();
                paragraph.push(line);
            }
        });
        closeParagraph();
        closeList();
        return output.join("") || "<p>No description available.</p>";
    }

    function renderCharacter(card, character) {
        const box = ensureTooltip();
        resetTooltip(box);
        const header = document.createElement("div");
        header.className = "cip-header";
        const avatar = document.createElement("img");
        avatar.className = "cip-avatar";
        avatar.alt = "";
        avatar.src = character.image && character.image.large || "";
        header.appendChild(avatar);
        const heading = document.createElement("div");
        appendText(heading, "p", "cip-name", character.name && character.name.full || "Unknown character");
        if (character.name && character.name.native) appendText(heading, "p", "cip-native", character.name.native);
        header.appendChild(heading);
        box.appendChild(header);
        appendText(box, "p", "cip-role", "Character information");
        const description = document.createElement("div");
        description.className = "cip-description";
        description.innerHTML = markdownToHtml(character.description || "No description available.");
        box.appendChild(description);
        const meta = document.createElement("div");
        meta.className = "cip-meta";
        if (character.gender) appendText(meta, "span", "", character.gender);
        if (character.age) appendText(meta, "span", "", "Age " + character.age);
        if (character.bloodType) appendText(meta, "span", "", "Blood " + character.bloodType);
        if (meta.childNodes.length) box.appendChild(meta);
        const more = document.createElement("a");
        more.className = "cip-more";
        more.href = character.siteUrl || characterUrl(character.id);
        more.target = "_blank";
        more.rel = "noopener noreferrer";
        more.textContent = "Show more info";
        box.appendChild(more);
        box.style.display = "block";
        positionTooltip(card);
    }

    function renderError(card) {
        const box = ensureTooltip();
        resetTooltip(box);
        appendText(box, "div", "cip-error", "Character information is unavailable right now.");
        box.style.display = "block";
        positionTooltip(card);
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            if (!overTooltip && activeCard === null && tooltip) closeTooltip();
        }, 130);
    }

    function bindCard(card) {
        if (card.dataset[BOUND_KEY] === "true") return;
        const id = characterId(card);
        if (!id) return;
        card.dataset[BOUND_KEY] = "true";
        card.classList.add("cip-character-card");
        fetchCharacter(id).catch(function () {});
        card.addEventListener("mouseenter", function () {
            clearTimeout(hideTimer);
            activeCard = card;
            activeCharacterId = id;
            showLoading(card);
            fetchCharacter(id).then(function (character) {
                if (activeCharacterId === id && onEntryRoute()) renderCharacter(activeCard || card, character);
            }).catch(function () {
                if (activeCharacterId === id && onEntryRoute()) renderError(activeCard || card);
            });
        });
        card.addEventListener("mouseleave", function () {
            activeCard = null;
            scheduleHide();
        });
    }

    function scan() {
        if (!onEntryRoute()) {
            closeTooltip();
            return;
        }
        installStyles();
        document.querySelectorAll(CARD_SELECTOR).forEach(bindCard);
    }

    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(scan, 80);
    }

    document.addEventListener("click", function (event) {
        const link = event.target.closest && event.target.closest(LINK_SELECTOR);
        if (link) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", scheduleScan);
    window.addEventListener("hashchange", scheduleScan);
    window.addEventListener("resize", function () {
        if (activeCard && tooltip && tooltip.style.display !== "none") positionTooltip(activeCard);
    });
    const originalPushState = history.pushState;
    history.pushState = function () {
        const result = originalPushState.apply(this, arguments);
        scheduleScan();
        return result;
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        const result = originalReplaceState.apply(this, arguments);
        scheduleScan();
        return result;
    };

    scan();
})();
            `);
            await head.append(script);
        });
    });
}
