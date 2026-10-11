/**
 * Seanime Extension for Comix
 * Implements MangaProvider interface for 'https://comix.to'.
 *
 * comix.to protects its API in three layers:
 *   1. Cloudflare. Every request needs the user's `cf_clearance` cookie, sent with the exact
 *      User-Agent of the browser that earned it. Both come from the extension settings.
 *   2. Request signing. Every /api/v1 call carries `_=<token>`: three S-box/XOR/feedback rounds
 *      over `path?canonicalQuery`, encoded as unpadded base64url.
 *   3. Response encryption. Most bodies arrive as {"e": "<base64url>"} and are decrypted with
 *      the inverse rounds.
 *
 * The three S-boxes and keys ("cipher material") live in the site's obfuscated bundle and change
 * with site builds. They come from the $store cache, then the bundled snapshot below, then a
 * ChromeDP capture that hooks window.atob while comix.to loads.
 *
 * Chapter images need no cookie, but any Referer makes the image hosts answer 403.
 */

const SITE_URL = "https://comix.to";
const API_URL = `${SITE_URL}/api/v1`;
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

const MATERIAL_KEY = "comix:material";
const SITE_BUILD_KEY = "comix:site-build";
const SNAPSHOT_REJECTED_KEY = "comix:snapshot-rejected";
const CAPTURE_LEASE_KEY = "comix:capture-lease";
const CAPTURE_FAILURE_KEY = "comix:capture-failure";

// Pause before the one transient retry an API call gets (network error, 5xx, 429).
const RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 3000;

const CHAPTERS_PER_PAGE = 100;
const MAX_CHAPTER_PAGES = 200;
// Chapter pages are fetched in small parallel batches, paced to about 5 requests per second.
const CHAPTER_BATCH_SIZE = 4;
const MIN_MS_PER_REQUEST = 200;

const CAPTURE_URL = `${SITE_URL}/browse?keyword=a`;
const CAPTURE_POLL_MS = 500;
// Wall-clock budget for one capture once Chrome is up. Each CDP step is also capped at
// BROWSER_STEP_TIMEOUT_S, so a hung renderer overshoots the budget by at most one step.
const CAPTURE_DEADLINE_MS = 40000;
const BROWSER_STEP_TIMEOUT_S = 20;
// A Cloudflare challenge page that lasts this many polls will not clear for an automated Chrome.
const CHALLENGE_POLL_LIMIT = 20;
const CHALLENGE_TITLE = /just a moment|attention required/i;
// Only one VM captures at a time. The lease outlives the slowest capture (budget, one hung step,
// start-up and close); waiting requests poll for its result.
const CAPTURE_LEASE_MS = CAPTURE_DEADLINE_MS + 2 * BROWSER_STEP_TIMEOUT_S * 1000 + 10000;
const LEASE_CONFIRM_MS = 50;
const LEASE_POLL_MS = 250;
// Requests Chrome skips while capturing: third-party fonts and analytics, and images. Only
// comix.to's own scripts are needed to decode the keys.
const CAPTURE_BLOCKED_URLS = [
    "*fonts.googleapis.com*",
    "*fonts.gstatic.com*",
    "*cloudflareinsights.com*",
    "*whos.amung.us*",
    "*.png*",
    "*.jpg*",
    "*.jpeg*",
    "*.webp*",
    "*.gif*",
    "*.svg*",
    "*.ico*",
    "*.woff*",
    "*.woff2*",
];

// Initial feedback byte of each cipher round.
const FEEDBACK = [189, 133, 32];

// Cipher material for site build "tmboun", captured from comix.to's own atob calls on 2026-10-04.
// This is public site data. It saves a Chrome launch until the site ships a new build.
const SNAPSHOT = {
    buildId: "tmboun",
    capturedAt: "2026-10-04T00:00:00Z",
    sboxes: [
        "gbicCvAMzfcXEtGAyjvvhmb2yCWzWhjqcxXZ7ZhpzANOzoQLo3nuPZ2vK9dkb9hJExC0Vni/hdQBceI+mw611gkhQFjBuf4bJg1TxYqM+SL4YDqtwjxiGSdeH7so7Fn1HiRo37Z+RNvl44twXWVhomtMjw+8bemfmv9XEXr7mS82MxaCOJZRR0oHd9PLI5O+gyBGT6hcLoduNa7yCObVVCk3bFWsoD+xcqTrBcP6dNJN/NB1Br2QGhSN2snHAqeRNKVFQiyeAFLPSKGwY8aq9EPgsi17qd4ywPMxiH8w6N1qX1tLKtzhOeemHWeJQfFQ5H23q7qSlJUcjgTEl3x2/Q==",
        "2lQehmgyYFAoWUi0haazZqHy5zZ34NN+VzlfsoB2Y1yY0IuMLjgVcV2xt8t4moH+AP0NMJ5qekW7DFIHEWKkOgIBIMhDdA8lbM6iHKjDlq6IChpb3CnA9NmsvQW/afdt1SfJjTdwcvpKqunCJLxBFmXX9hecm6tGb+HRxD7BC3njoxPxgnX5pdKP1IMSkd4/O3NRfZSE6DVLG2s9uexaipA05cpJzE8Qkv/z5jzHAwlEWOLd3yxA+0cvVbpOoJPFGc8f1lb4vu2HUxjuuEwEQk0GsPCVnyKvfOoh9TG2YYmZLV4I67UU2NsrrakqZ47k/O+ne25/DjPGZCMdnZcmzQ==",
        "+mhJSFwzaV+PQPDyKp2scO/S9SdFsy/7e56UWT8XHbK3E2+19nEPwfwOgE9uVCaDtOAWTobCZX+cBCXlIbBqyDyQB1beKLspW6kGPhBCV9x0jf0KUeFhHjmlMf7qMFIB41PfDFprZ3bJiK4YxrZDv+K6dcwJmggVO8f5ktrXTM0cZL4fer0SpnkbvNajPbHxfuTz5lVEBarOI4rdc+2V6zTsjpfQYjgN1MMr6EvA6eehN6dQ1bgUogt9rZOBbQBeNnLYY00uZqSoJBnFi5gthCJsWF33ykosn9v/9KB8udMCz0YRYImrA4VHr5mMgpH4xDXLeEHRd5vZOiAalofuMg==",
    ],
    keys: [
        "rafYl4oSAKQX+GYoic9oW4iGwiYpZzs0",
        "2USAq+VTo5ht4bQn+K9DUcpUQRTtrB56",
        "yNHlokVEnuecesDrB/lDhVuUNiheWc3a47VtkwZ2ENg=",
    ],
    // Tokens the live site produced for this build. Used to self-test the decoded snapshot.
    selfTest: [
        ["/manga/55k2l", "IZ-P1pUtAqg2Su1q"],
        ["/chapters/11442054", "IQ6wvJBq2kpghZShPp_jctfO"],
        [
            "/manga/55k2l/chapters?limit=20&order[number]=desc&page=1",
            "IZ-P1pUtAqg2Su1qkCrZLo-bzeBDZM7pv9lrT7wtAafBDb5txD-qNq9gnd8k1xD3TcCW5dJSADA",
        ],
    ],
};

// Runs in the page before site scripts. Records every decoded atob output that is 256 bytes
// (an S-box) or 24/32 bytes (a key), in the order the site decodes them.
const ATOB_HOOK = `(() => {
    if (window.__comixCaptures) return;
    window.__comixCaptures = [];
    const original = window.atob;
    window.atob = function () {
        const decoded = original.apply(this, arguments);
        if (decoded.length === 256 || decoded.length === 24 || decoded.length === 32) {
            const bytes = new Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i) & 255;
            window.__comixCaptures.push(bytes);
        }
        return decoded;
    };
})();`;

// Evaluated in the page while polling. A single expression, because evaluate() does not await promises.
const CAPTURE_STATE = `JSON.stringify({
    title: document.title,
    build: ((((document.querySelector('script[src*="/dist/main-"]') || {}).src || "").match(/\\/dist\\/main-([a-z0-9]+)-/) || [])[1] || ""),
    captures: window.__comixCaptures || [],
})`;

const MESSAGES = {
    missingConfig:
        "Comix: set both the cf_clearance cookie and the User-Agent in the extension settings. Open https://comix.to in your browser, copy the cf_clearance cookie (DevTools > Application > Cookies) and the value of navigator.userAgent from the same browser.",
    cloudflare:
        "Comix: Cloudflare rejected the request. The cf_clearance cookie has expired or does not match the User-Agent. Open https://comix.to in your browser, then copy a fresh cf_clearance cookie and that same browser's navigator.userAgent into the extension settings.",
    waf: "Comix: comix.to's firewall wants a captcha (captcha_required). Open https://comix.to in your browser, solve the check, wait a minute, then retry.",
    rateLimited: "Comix: comix.to is rate limiting requests (HTTP 429). Wait a minute, then retry.",
    noChrome:
        "Comix: the site's signing keys changed and must be refreshed with Chrome, but Chrome could not start. Install Google Chrome or Chromium on the Seanime host, or wait for an extension update.",
    chromeFailed:
        "Comix: Chrome stopped while capturing the comix.to signing keys. Retry, or check that Chrome or Chromium runs on the Seanime host.",
    captureWait: "Comix: timed out waiting for another request to refresh the comix.to signing keys. Retry.",
    stillRejected:
        "Comix: comix.to still rejects requests after refreshing the signing keys. The site probably changed its signing scheme; wait for an extension update.",
};

// ---------------------------------------------------------------------------------------------
// Byte helpers. Seanime's runtime has no atob, btoa, TextEncoder or TextDecoder.
// ---------------------------------------------------------------------------------------------

const B64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encodes a string as UTF-8 bytes. */
function utf8Encode(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            const low = text.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                i++;
            }
        }
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        } else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        } else {
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
    }
    return bytes;
}

/** Decodes UTF-8 bytes into a string. */
function utf8Decode(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length;) {
        const lead = bytes[i++];
        let code;
        if (lead < 0x80) {
            code = lead;
        } else if (lead >= 0xf0) {
            code = ((lead & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        } else if (lead >= 0xe0) {
            code = ((lead & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        } else {
            code = ((lead & 31) << 6) | (bytes[i++] & 63);
        }
        if (code > 0xffff) {
            code -= 0x10000;
            text += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
        } else {
            text += String.fromCharCode(code);
        }
    }
    return text;
}

/** Encodes bytes as base64url without padding. */
function base64UrlEncode(bytes) {
    let text = "";
    let bits = 0;
    let bitCount = 0;
    for (let i = 0; i < bytes.length; i++) {
        bits = ((bits << 8) | bytes[i]) & 0xffff;
        bitCount += 8;
        while (bitCount >= 6) {
            bitCount -= 6;
            text += B64_URL_ALPHABET.charAt((bits >> bitCount) & 63);
        }
    }
    if (bitCount > 0) {
        text += B64_URL_ALPHABET.charAt((bits << (6 - bitCount)) & 63);
    }
    return text;
}

/** Decodes standard or url-safe base64, with or without padding. */
function base64Decode(text) {
    const bytes = [];
    let bits = 0;
    let bitCount = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        let value = B64_URL_ALPHABET.indexOf(ch);
        if (ch === "+") value = 62;
        if (ch === "/") value = 63;
        if (value < 0) continue;
        bits = ((bits << 6) | value) & 0xffff;
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            bytes.push((bits >> bitCount) & 255);
        }
    }
    return bytes;
}

// ---------------------------------------------------------------------------------------------
// Cipher
// ---------------------------------------------------------------------------------------------

/** Signs `path?canonicalQuery` (path without the /api/v1 prefix) into the `_` token. */
function signRequest(text, material) {
    let data = utf8Encode(text);
    for (let round = 0; round < 3; round++) {
        const sbox = material.sboxes[round];
        const key = material.keys[round];
        const output = new Array(data.length);
        let previous = FEEDBACK[round];
        for (let i = 0; i < data.length; i++) {
            previous = sbox[data[i] ^ key[i % key.length] ^ previous];
            output[i] = previous;
        }
        data = output;
    }
    return base64UrlEncode(data);
}

/** Decrypts an API `e` payload by running the signing rounds in reverse. */
function decryptPayload(payload, material) {
    let data = base64Decode(payload);
    for (let round = 2; round >= 0; round--) {
        const sbox = material.sboxes[round];
        const key = material.keys[round];
        const inverse = new Array(256);
        for (let i = 0; i < 256; i++) inverse[sbox[i]] = i;
        const output = new Array(data.length);
        let previous = FEEDBACK[round];
        for (let i = 0; i < data.length; i++) {
            output[i] = inverse[data[i]] ^ key[i % key.length] ^ previous;
            previous = data[i];
        }
        data = output;
    }
    return utf8Decode(data);
}

/**
 * Builds the signed query entries the way the site does: keys sorted, `[]` suffixes turned into
 * `[0]`, `[1]`, ..., values trimmed. The signature covers raw values; the URL carries them encoded.
 */
function canonicalEntries(params) {
    const entries = [];
    Object.keys(params)
        .sort()
        .forEach((rawName) => {
            const value = params[rawName];
            const isList = Array.isArray(value) || rawName.endsWith("[]");
            const name = rawName.endsWith("[]") ? rawName.slice(0, -2) : rawName;
            if (!isList) {
                entries.push([name, String(value).trim()]);
                return;
            }
            [].concat(value).forEach((item, index) => entries.push([`${name}[${index}]`, String(item).trim()]));
        });
    return entries;
}

/** True when `sbox` is a 256-entry byte permutation. */
function isPermutation(sbox) {
    if (!Array.isArray(sbox) || sbox.length !== 256) return false;
    const seen = new Array(256);
    for (let i = 0; i < 256; i++) {
        const value = sbox[i];
        if (typeof value !== "number" || value < 0 || value > 255 || seen[value]) return false;
        seen[value] = true;
    }
    return true;
}

/** Checks the shape of cipher material: three permutation S-boxes and three 24/32-byte keys. */
function isValidMaterial(material) {
    return (
        !!material &&
        Array.isArray(material.sboxes) &&
        material.sboxes.length === 3 &&
        material.sboxes.every(isPermutation) &&
        Array.isArray(material.keys) &&
        material.keys.length === 3 &&
        material.keys.every((key) => Array.isArray(key) && (key.length === 24 || key.length === 32))
    );
}

/** Picks the first three S-boxes and keys out of atob captures, in capture order. */
function materialFromCaptures(captures) {
    const sboxes = captures.filter((bytes) => bytes.length === 256).slice(0, 3);
    const keys = captures.filter((bytes) => bytes.length === 24 || bytes.length === 32).slice(0, 3);
    const material = { sboxes, keys };
    return isValidMaterial(material) ? material : null;
}

// ---------------------------------------------------------------------------------------------
// Material cache. Values are stored as JSON strings so they never cross VMs as Go-backed objects.
// ---------------------------------------------------------------------------------------------

/** Reads a JSON string value from $store, or null. */
function readStoredJson(key) {
    const raw = $store.get(key);
    if (typeof raw !== "string" || !raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/** Reads cached material from $store, or null. */
function readCachedMaterial() {
    const material = readStoredJson(MATERIAL_KEY);
    return isValidMaterial(material) ? material : null;
}

/** Caches material in $store and returns it. */
function cacheMaterial(material) {
    $store.set(MATERIAL_KEY, JSON.stringify(material));
    return material;
}

/**
 * Logs a failure and returns the value to throw. Seanime reports a rejected provider call by
 * exporting the thrown value, and an Error object exports as an empty map, so the message string
 * itself is thrown to keep it visible in Seanime's error and UI.
 */
function fail(message) {
    console.error(message);
    return message;
}

/** Turns a thrown value (JS or Go error) into a short string. */
function errorText(error) {
    return String((error && error.message) || error).slice(0, 300);
}

/** Names a request for error messages, e.g. "/manga/pvry/chapters page 2". */
function describeRequest(path, params) {
    return params && params.page ? `${path} page ${params.page}` : path;
}

/**
 * Returns `value` when it is an array. Anything else means a cut-off or changed response, which
 * must fail loudly: Seanime caches whatever list a provider returns.
 */
function requireList(value, label, field) {
    if (Array.isArray(value)) return value;
    throw fail(
        `Comix: ${label} returned no ${field} list. The response was cut off or the API changed; retry, or wait for an extension update.`,
    );
}

/** True when a response is Cloudflare's challenge page rather than comix.to's API. */
function isCloudflareChallenge(response, text) {
    const headers = response.headers || {};
    return headers["Cf-Mitigated"] === "challenge" || /<title>\s*just a moment|challenge-platform/i.test(text);
}

/** Pause before retrying: Retry-After seconds when given, capped at 3s, otherwise 1s. */
function retryDelayMs(response) {
    const seconds = parseInt(((response && response.headers) || {})["Retry-After"], 10);
    return isNaN(seconds) ? RETRY_DELAY_MS : Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_DELAY_MS);
}

/**
 * True for https URLs on comix.to or one of its subdomains, without userinfo. Goja's URL follows
 * Go's net/url, the parser Seanime's image proxy connects with, so both agree on the host.
 */
function isComixUrl(value) {
    let url;
    try {
        url = new URL(String(value || ""));
    } catch (e) {
        return false;
    }
    const host = url.hostname.toLowerCase();
    return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (host === "comix.to" || host.endsWith(".comix.to"))
    );
}

/**
 * The capture running in this VM, if any. Requests that share a VM (a chapter batch runs its pages
 * concurrently in one VM) await it instead of polling the $store lease: $sleep blocks the whole
 * VM, which would stop the capture they are waiting for from ever finishing.
 */
let inFlightCapture = null;

class Provider {
    constructor() {
        this.api = SITE_URL;
        this.apiUrl = API_URL;
    }

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: true,
        };
    }

    // -----------------------------------------------------------------------------------------
    // Transport
    // -----------------------------------------------------------------------------------------

    /** Reads cf_clearance and User-Agent from the extension settings. Accepts a pasted `cf_clearance=...` too. */
    readCredentials() {
        const rawCookie = String($getUserPreference("cfClearance") || "").trim();
        const match = rawCookie.match(/cf_clearance=([^;\s]+)/);
        const cookie = (match ? match[1] : rawCookie).replace(/^["']|["']$/g, "");
        const userAgent = String($getUserPreference("userAgent") || "")
            .trim()
            .replace(/^["']|["']$/g, "");
        if (!cookie || !userAgent) throw fail(MESSAGES.missingConfig);
        return { cookie, userAgent };
    }

    /** Sends one GET to comix.to with the user's clearance cookie and matching User-Agent. */
    async send(url, credentials) {
        return fetch(url, {
            headers: {
                "User-Agent": credentials.userAgent,
                Cookie: `cf_clearance=${credentials.cookie}`,
                Accept: "application/json, text/plain, */*",
            },
        });
    }

    /** Builds the full API URL with the `_` signature for `path` (without /api/v1). */
    signedUrl(path, entries, material) {
        const plainQuery = entries.map((entry) => `${entry[0]}=${entry[1]}`).join("&");
        const token = signRequest(plainQuery ? `${path}?${plainQuery}` : path, material);
        const query = entries.map((entry) => `${encodeURIComponent(entry[0])}=${encodeURIComponent(entry[1])}`);
        query.push(`_=${token}`);
        return `${this.apiUrl}${path}?${query.join("&")}`;
    }

    /**
     * Classifies a non-200 response, recognised bodies first: a Cloudflare challenge or the WAF
     * captcha throws, a rejected signature returns "token". Only then is an unrecognised 429 or
     * 5xx called "transient"; any other status throws.
     */
    checkResponse(response, text, label) {
        if (isCloudflareChallenge(response, text)) {
            throw fail(`${MESSAGES.cloudflare} (HTTP ${response.status} on ${label})`);
        }
        if (/captcha_required/.test(text)) throw fail(MESSAGES.waf);
        if (/(Missing|Invalid) token/i.test(text)) return "token";
        if (response.status === 429 || response.status >= 500) return "transient";
        throw fail(`Comix: HTTP ${response.status} from ${label}: ${text.slice(0, 120)}`);
    }

    /**
     * Throws for an application error inside an HTTP 200 body, such as {"status":"error"} or
     * {"error":"captcha_required"}. Successful bodies carry {"status":"ok"}.
     */
    checkEnvelope(body, label) {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw fail(`Comix: ${label} returned an unexpected response.`);
        }
        if (!body.error && (body.status === undefined || body.status === "ok")) return body;

        const detail = JSON.stringify({ status: body.status, error: body.error, message: body.message });
        if (/captcha_required/i.test(detail)) throw fail(MESSAGES.waf);
        throw fail(`Comix: ${label} returned an error: ${detail.slice(0, 200)}`);
    }

    /** Parses an API body, decrypting `{e}` payloads. Returns undefined when decryption fails. */
    decodeBody(text, material, label) {
        let root;
        try {
            root = JSON.parse(text);
        } catch (e) {
            throw fail(`Comix: unexpected non-JSON response from ${label}: ${text.slice(0, 120)}`);
        }
        if (!root || typeof root.e !== "string") return root;
        try {
            return JSON.parse(decryptPayload(root.e, material));
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Records the site build from `X-Build-Id`, which keeps the bundled snapshot from being picked
     * for a different build. Material from an older build keeps being used while the server accepts
     * its tokens and its bodies decrypt; a rejected token is what triggers a refresh.
     */
    noteBuild(response, material) {
        const build = (response.headers || {})["X-Build-Id"];
        if (!build || $store.get(SITE_BUILD_KEY) === build) return;
        $store.set(SITE_BUILD_KEY, build);
        if (material.buildId && material.buildId !== build) {
            console.warn(
                `Comix: site build is now ${build}; cipher material is from ${material.buildId} (${material.source}). It will refresh if the site starts rejecting it.`,
            );
        }
    }

    /**
     * Sends a signed GET for `path` (relative to /api/v1) and returns the decoded JSON.
     *
     * One call makes at most three requests. It has one transient retry (network or TLS error,
     * unrecognised 429 or 5xx) after a short pause, and one refresh when the token is rejected or
     * the body does not decrypt. Each is spent once per call, in whichever order the failures come.
     */
    async apiGet(path, params) {
        const credentials = this.readCredentials();
        const entries = canonicalEntries(params || {});
        const label = describeRequest(path, params);
        let retryLeft = true;
        let refreshLeft = true;
        let rejected = null;

        for (;;) {
            const material = await this.getMaterial(credentials, rejected);
            rejected = null;

            let response = null;
            let problem;
            let reason;
            let failure;
            try {
                response = await this.send(this.signedUrl(path, entries, material), credentials);
            } catch (e) {
                reason = errorText(e).replace(/^Get "[^"]*":\s*/, "");
                problem = "transient";
                failure = `Comix: could not reach comix.to for ${label} (${reason}). Check the Seanime host's connection and retry.`;
            }

            if (response) {
                const text = response.text();
                this.noteBuild(response, material);
                if (response.status === 200) {
                    const body = this.decodeBody(text, material, label);
                    if (body !== undefined) return this.checkEnvelope(body, label);
                    problem = "token";
                    console.warn(`Comix: could not decrypt the response from ${label}`);
                } else {
                    problem = this.checkResponse(response, text, label);
                    if (problem === "token")
                        console.warn(`Comix: ${label} rejected the request token (${text.slice(0, 60)})`);
                    reason = `HTTP ${response.status}`;
                    failure =
                        response.status === 429
                            ? MESSAGES.rateLimited
                            : `Comix: HTTP ${response.status} from ${label}: ${text.slice(0, 120)}`;
                }
            }

            if (problem === "token") {
                if (!refreshLeft) throw fail(MESSAGES.stillRejected);
                refreshLeft = false;
                rejected = material;
                continue;
            }

            if (!retryLeft) throw fail(failure);
            retryLeft = false;
            const delay = retryDelayMs(response);
            console.warn(`Comix: ${label} failed (${reason}); retrying in ${delay} ms`);
            // $sleep blocks this VM; the pause is short and capped, so it only delays siblings.
            $sleep(delay);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Cipher material
    // -----------------------------------------------------------------------------------------

    /**
     * Resolves cipher material: $store cache, then the bundled snapshot, then a ChromeDP capture.
     * `rejected` is material the server just refused; it is dropped and not used again.
     */
    async getMaterial(credentials, rejected) {
        let cached = readCachedMaterial();

        if (rejected) {
            console.warn(
                `Comix: dropping rejected cipher material (${rejected.source}, build ${rejected.buildId || "unknown"})`,
            );
            if (rejected.source === "snapshot") $store.set(SNAPSHOT_REJECTED_KEY, true);
            if (cached && cached.id === rejected.id) {
                $store.remove(MATERIAL_KEY);
                cached = null;
            }
        }
        if (cached) return cached;

        const snapshot = this.snapshotMaterial();
        if (snapshot) {
            console.log(`Comix: using the bundled cipher snapshot for build ${snapshot.buildId}`);
            return cacheMaterial(snapshot);
        }

        if (!inFlightCapture) {
            inFlightCapture = this.captureOnce(credentials, rejected).finally(() => {
                inFlightCapture = null;
            });
        }
        return inFlightCapture;
    }

    /**
     * Captures material with Chrome, one capture at a time across the extension's VMs. The first
     * caller takes a lease in $store and captures; callers in other VMs wait for its material or
     * its error instead of launching their own Chrome. Only one call per VM gets here (see
     * inFlightCapture), so the blocking poll below never stalls a capture in its own VM.
     */
    async captureOnce(credentials, rejected) {
        const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const waitingSince = Date.now();
        const giveUpAt = waitingSince + CAPTURE_LEASE_MS + 5000;

        while (Date.now() < giveUpAt) {
            if (this.takeCaptureLease(owner)) {
                try {
                    return cacheMaterial(await this.captureMaterial(credentials));
                } catch (e) {
                    $store.set(CAPTURE_FAILURE_KEY, JSON.stringify({ at: Date.now(), message: errorText(e) }));
                    throw e;
                } finally {
                    const lease = readStoredJson(CAPTURE_LEASE_KEY);
                    if (lease && lease.owner === owner) $store.remove(CAPTURE_LEASE_KEY);
                }
            }

            $sleep(LEASE_POLL_MS);
            const material = readCachedMaterial();
            if (material && (!rejected || material.id !== rejected.id)) return material;
            const failure = readStoredJson(CAPTURE_FAILURE_KEY);
            if (failure && failure.at >= waitingSince) throw fail(failure.message);
        }
        throw fail(MESSAGES.captureWait);
    }

    /**
     * Takes the capture lease when nobody holds a live one. $store has no compare-and-set, so the
     * lease is written, then re-read after a short pause; the last writer wins and the rest wait.
     */
    takeCaptureLease(owner) {
        const lease = readStoredJson(CAPTURE_LEASE_KEY);
        if (lease && lease.until > Date.now()) return false;

        $store.set(CAPTURE_LEASE_KEY, JSON.stringify({ owner, until: Date.now() + CAPTURE_LEASE_MS }));
        $sleep(LEASE_CONFIRM_MS);
        const confirmed = readStoredJson(CAPTURE_LEASE_KEY);
        return !!confirmed && confirmed.owner === owner;
    }

    /** Decodes and self-tests the bundled snapshot. Null when it is absent, rejected or for another build. */
    snapshotMaterial() {
        if (!SNAPSHOT || $store.get(SNAPSHOT_REJECTED_KEY)) return null;
        const siteBuild = $store.get(SITE_BUILD_KEY);
        if (siteBuild && siteBuild !== SNAPSHOT.buildId) return null;

        const material = {
            id: `snapshot@${SNAPSHOT.buildId}`,
            source: "snapshot",
            buildId: SNAPSHOT.buildId,
            capturedAt: SNAPSHOT.capturedAt,
            sboxes: SNAPSHOT.sboxes.map(base64Decode),
            keys: SNAPSHOT.keys.map(base64Decode),
        };
        const passes =
            isValidMaterial(material) && SNAPSHOT.selfTest.every((pair) => signRequest(pair[0], material) === pair[1]);
        if (!passes) {
            console.error("Comix: bundled cipher snapshot failed its self-test; ignoring it");
            return null;
        }
        return material;
    }

    /**
     * Opens comix.to in headless Chrome with the user's clearance and records the S-boxes and keys
     * the site decodes through window.atob. Needs Chrome or Chromium on the Seanime host.
     */
    async captureMaterial(credentials) {
        console.log("Comix: capturing cipher material with Chrome");
        let browser = null;
        try {
            browser = await ChromeDP.newBrowser({
                userAgent: credentials.userAgent,
                headless: true,
                timeout: BROWSER_STEP_TIMEOUT_S,
            });
        } catch (e) {
            throw fail(`${MESSAGES.noChrome} (${errorText(e)})`);
        }

        try {
            return await this.readMaterialFromPage(browser, credentials);
        } catch (e) {
            // Classified failures are already strings. Anything else is Chrome or CDP failing.
            if (typeof e === "string") throw e;
            throw fail(`${MESSAGES.chromeFailed} (${errorText(e)})`);
        } finally {
            try {
                await browser.close();
            } catch (e) {
                // Keep the capture's own outcome; a failed close has nothing useful to add.
            }
        }
    }

    /** Loads comix.to in `browser` and polls the atob captures until three S-boxes and keys appear. */
    async readMaterialFromPage(browser, credentials) {
        const deadline = Date.now() + CAPTURE_DEADLINE_MS;

        // Chrome runs with navigator.webdriver = true, so Cloudflare only lets it through
        // with the user's clearance cookie and the matching User-Agent.
        await browser.executeCDP("Network.setCookie", {
            name: "cf_clearance",
            value: credentials.cookie,
            domain: ".comix.to",
            path: "/",
            secure: true,
            httpOnly: true,
        });
        try {
            await browser.executeCDP("Network.enable", {});
            await browser.executeCDP("Network.setBlockedURLs", { urls: CAPTURE_BLOCKED_URLS });
        } catch (e) {
            console.warn(`Comix: could not block third-party requests during capture (${errorText(e)})`);
        }
        await browser.executeCDP("Page.addScriptToEvaluateOnNewDocument", { source: ATOB_HOOK });
        try {
            await browser.navigate(CAPTURE_URL);
        } catch (e) {
            console.warn(`Comix: Chrome navigation did not finish cleanly (${errorText(e)}); still polling`);
        }

        let state = { title: "", build: "", captures: [] };
        let challengePolls = 0;
        while (Date.now() < deadline && challengePolls < CHALLENGE_POLL_LIMIT) {
            try {
                state = JSON.parse(await browser.evaluate(CAPTURE_STATE));
            } catch (e) {
                // The page may be mid-navigation (Cloudflare redirect); poll again.
            }
            const material = materialFromCaptures(state.captures || []);
            if (material) {
                const capturedAt = new Date().toISOString();
                console.log(`Comix: captured cipher material for build ${state.build || "unknown"}`);
                return {
                    id: `chrome@${capturedAt}`,
                    source: "chrome",
                    buildId: state.build || "",
                    capturedAt,
                    sboxes: material.sboxes,
                    keys: material.keys,
                };
            }
            challengePolls = CHALLENGE_TITLE.test(state.title || "") ? challengePolls + 1 : 0;
            await browser.sleep(CAPTURE_POLL_MS);
        }

        if (CHALLENGE_TITLE.test(state.title || "")) {
            throw fail(`${MESSAGES.cloudflare} (Chrome was stopped by the challenge page)`);
        }
        throw fail(
            `Comix: Chrome loaded comix.to ("${state.title}") but the site never decoded its signing keys. The site changed how it ships them; wait for an extension update.`,
        );
    }

    // -----------------------------------------------------------------------------------------
    // Ids and mapping
    // -----------------------------------------------------------------------------------------

    /** Returns the `<hid>-<slug>` part of a `/title/<hid>-<slug>/...` URL. */
    extractTitleSlug(url) {
        if (!url) return "";

        const value = String(url);
        const marker = "/title/";
        const slug =
            value.indexOf(marker) >= 0
                ? value.slice(value.indexOf(marker) + marker.length)
                : value.replace(/^\/?title\//, "").replace(/^\/+/, "");

        return slug.split(/[/?#]/)[0] || "";
    }

    /** Strips the `<hid>-` prefix from a slug. */
    slugWithoutHash(hashId, slug) {
        const cleanSlug = String(slug || "")
            .trim()
            .replace(/^\/+/, "");
        if (!cleanSlug) return "";
        if (cleanSlug === hashId) return "";
        return cleanSlug.indexOf(`${hashId}-`) === 0 ? cleanSlug.slice(hashId.length + 1) : cleanSlug;
    }

    /** Parses a manga id: `<hid>|<slug>` (current) or `<hid>-<slug>` (legacy). */
    normalizeMangaId(mangaId) {
        const rawId = String(mangaId || "").trim();
        const parts = rawId.split("|");

        let hashId = parts[0] || "";
        let slug = parts[1] || "";

        if (rawId.indexOf("|") < 0 && rawId.indexOf("-") > 0) {
            hashId = rawId.split("-")[0];
            slug = rawId.slice(hashId.length + 1);
        }

        slug = this.slugWithoutHash(hashId, slug);

        return {
            hashId,
            slug,
            fullSlug: slug ? `${hashId}-${slug}` : hashId,
        };
    }

    /** Returns the numeric chapter id from `<hid>|<slug>|<chapterId>|<number>` or a chapter URL. */
    extractNumericChapterId(chapterId) {
        const parts = String(chapterId || "").split("|");
        const raw =
            parts.length >= 3
                ? parts[2]
                : String(chapterId || "")
                      .split("/")
                      .pop();
        const match = String(raw || "").match(/^\d+/);
        return match ? match[0] : "";
    }

    normalizeSynonyms(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map((item) => {
                if (typeof item === "string") return item;
                return item && item.title ? String(item.title) : "";
            })
            .filter((item) => item.length > 0);
    }

    getPosterUrl(item) {
        const poster = item.poster || {};
        return poster.large || poster.medium || poster.small || "";
    }

    getYear(item) {
        const value = item.year || item.startDate;
        const year = parseInt(value, 10);
        return isNaN(year) ? undefined : year;
    }

    /** The page count the API declares, or 0 when it is missing or not a positive integer. */
    declaredLastPage(result) {
        const pagination = result.meta || result.pagination || {};
        const lastPage = pagination.lastPage !== undefined ? pagination.lastPage : pagination.last_page;
        return Number.isInteger(lastPage) && lastPage > 0 ? lastPage : 0;
    }

    formatChapterNumber(value) {
        const str = String(value);
        return str.endsWith(".0") ? str.slice(0, -2) : str;
    }

    extractChapterNumber(chapterStr) {
        const num = parseFloat(chapterStr);
        if (!isNaN(num)) return num;

        const match = String(chapterStr).match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
    }

    extractChapterId(chapterId) {
        const num = parseInt(chapterId.split("|")[2], 10);
        return isNaN(num) ? 0 : num;
    }

    /** Maps an API chapter to Seanime's ChapterDetails, or null for non-English or incomplete items. */
    toChapterDetails(item, manga) {
        const language = String(item.language || "en").toLowerCase();
        if (language !== "en" && language !== "english") return null;

        const chapterId = item.id != null ? item.id : item.chapter_id;
        const chapterNumber = item.number != null ? this.formatChapterNumber(item.number) : "";
        if (!chapterId || !chapterNumber) return null;

        const name = item.name ? String(item.name).trim() : "";
        const group = item.group || item.scanlation_group;
        const isOfficial = item.isOfficial === true || item.isOfficial === 1;
        const url =
            typeof item.url === "string" && item.url.indexOf("/title/") >= 0
                ? item.url.indexOf("http") === 0
                    ? item.url
                    : `${this.api}${item.url}`
                : `${this.api}/title/${manga.fullSlug}/${chapterId}-chapter-${chapterNumber}`;

        return {
            id: `${manga.hashId}|${manga.slug}|${chapterId}|${chapterNumber}`,
            url,
            title: name ? `Chapter ${chapterNumber}: ${name}` : `Chapter ${chapterNumber}`,
            chapter: chapterNumber,
            index: 0,
            scanlator: group && group.name ? String(group.name).trim() : isOfficial ? "Official" : undefined,
            language: "en",
            rating: item.votes,
            updatedAt: item.updatedAtFormatted || item.createdAtFormatted || undefined,
        };
    }

    // -----------------------------------------------------------------------------------------
    // MangaProvider
    // -----------------------------------------------------------------------------------------

    /**
     * Searches for manga.
     */
    async search(opts) {
        const query = String((opts && opts.query) || "").trim();
        if (!query) return [];

        const data = await this.apiGet("/manga", {
            keyword: query,
            "order[relevance]": "desc",
            limit: 28,
            page: 1,
        });
        const items = requireList(data.result && data.result.items, "/manga search", "result.items");

        // Covers on static.comix.to sit behind Cloudflare too, so Seanime's image proxy needs the
        // clearance. The cookie only appears in the image-proxy URL the user's own Seanime client
        // requests from their own Seanime server, and is attached to comix.to covers only.
        const credentials = this.readCredentials();
        const coverHeaders = {
            Cookie: `cf_clearance=${credentials.cookie}`,
            "User-Agent": credentials.userAgent,
        };

        const mangas = [];
        items.forEach((item) => {
            const hashId = item.hid || item.hash_id;
            if (!hashId) return;

            const slug = this.slugWithoutHash(hashId, item.slug || this.extractTitleSlug(item.url));
            const image = this.getPosterUrl(item);
            const manga = {
                id: `${hashId}|${slug}`,
                title: item.title || slug || hashId,
                synonyms: this.normalizeSynonyms(item.altTitles || item.alt_titles),
                year: this.getYear(item),
                image,
            };
            if (isComixUrl(image)) manga.imageHeaders = coverHeaders;
            mangas.push(manga);
        });
        return mangas;
    }

    /**
     * Finds all English chapters, sorted ascending. Any failed or malformed page fails the whole
     * call, because Seanime caches the list it gets and a partial one would hide chapters.
     *
     * Paging always reaches a valid declared `lastPage`, fetching those pages in parallel batches,
     * and then continues one page at a time while the last page fetched was full. So neither a
     * short page before `lastPage` nor missing or understated metadata can cut the list short.
     * An empty page means the list has ended: the batch in flight is kept and no more are fetched.
     * Lists longer than MAX_CHAPTER_PAGES pages, declared or discovered, fail instead of being cut.
     */
    async findChapters(mangaId) {
        const manga = this.normalizeMangaId(mangaId);
        if (!manga.hashId) return [];

        const path = `/manga/${manga.hashId}/chapters`;
        const fetchPage = (page) =>
            this.apiGet(path, {
                limit: CHAPTERS_PER_PAGE,
                "order[number]": "desc",
                page,
            });
        const itemsOf = (data, page) =>
            requireList(data.result && data.result.items, describeRequest(path, { page }), "result.items");

        const first = await fetchPage(1);
        const rawChapters = itemsOf(first, 1).slice();
        let lastPageFull = rawChapters.length >= CHAPTERS_PER_PAGE;
        let sawEmptyPage = rawChapters.length === 0;
        const tooManyPages = `Comix: ${path} has more than ${MAX_CHAPTER_PAGES} pages of chapters. Refusing to return a partial chapter list; wait for an extension update.`;
        const declared = this.declaredLastPage(first.result);
        if (declared > MAX_CHAPTER_PAGES) throw fail(tooManyPages);
        if (lastPageFull && !declared) {
            const meta = JSON.stringify(first.result.meta || first.result.pagination || null);
            console.warn(
                `Comix: ${describeRequest(path, { page: 1 })} is full but declares no usable lastPage (${meta.slice(0, 120)}); fetching pages one at a time until a short page`,
            );
        }

        let page = 1;
        while ((page < declared || lastPageFull) && !sawEmptyPage) {
            if (page >= MAX_CHAPTER_PAGES) throw fail(tooManyPages);
            if (page === declared) {
                console.warn(
                    `Comix: ${path} page ${declared}, the declared last page, is full; checking for more pages one at a time`,
                );
            }
            const batchEnd = page < declared ? Math.min(page + CHAPTER_BATCH_SIZE, declared) : page + 1;
            const pages = [];
            for (let p = page + 1; p <= batchEnd; p++) pages.push(p);

            const started = Date.now();
            const results = await Promise.all(pages.map(fetchPage));
            results.forEach((data, i) => {
                const items = itemsOf(data, pages[i]);
                rawChapters.push.apply(rawChapters, items);
                if (items.length === 0) sawEmptyPage = true;
                if (pages[i] === batchEnd) lastPageFull = items.length >= CHAPTERS_PER_PAGE;
            });
            page = batchEnd;

            const wait = pages.length * MIN_MS_PER_REQUEST - (Date.now() - started);
            if (wait > 0 && (page < declared || lastPageFull) && !sawEmptyPage) $sleep(wait);
        }

        // Pages can shift while new chapters are published, so drop repeated chapter ids.
        const seen = {};
        const chapters = [];
        rawChapters.forEach((item) => {
            const chapter = this.toChapterDetails(item, manga);
            if (!chapter || seen[chapter.id]) return;
            seen[chapter.id] = true;
            chapters.push(chapter);
        });

        chapters.sort((a, b) => {
            const chapterDiff = this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter);
            if (chapterDiff !== 0) return chapterDiff;
            return this.extractChapterId(a.id) - this.extractChapterId(b.id);
        });
        chapters.forEach((chapter, index) => {
            chapter.index = index;
        });

        return chapters;
    }

    /**
     * Finds all image pages. Images are fetched without Referer or Origin; the hosts reject any Referer.
     * Non-empty headers make Seanime load them through its image proxy instead of the browser.
     */
    async findChapterPages(chapterId) {
        const numericId = this.extractNumericChapterId(chapterId);
        if (!numericId) return [];

        const path = `/chapters/${numericId}`;
        const data = await this.apiGet(path, {});
        const pages = (data.result && data.result.pages) || {};
        const items = Array.isArray(pages) ? pages : requireList(pages.items, path, "result.pages.items");
        const baseUrl = String(pages.baseUrl || "").replace(/\/+$/, "");

        if (items.length === 0) console.warn(`Comix: chapter ${numericId} has no pages`);

        return items
            .filter((item) => item && item.url)
            .map((item, index) => ({
                url: /^https?:\/\//i.test(item.url) ? item.url : `${baseUrl}/${String(item.url).replace(/^\/+/, "")}`,
                index,
                headers: {
                    Accept: IMAGE_ACCEPT,
                },
            }));
    }
}
