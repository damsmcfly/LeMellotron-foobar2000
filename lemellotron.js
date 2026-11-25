// ==PREPROCESSOR==
// @name "Le Mellotron Standalone Player"
// @author "Custom"
// ==/PREPROCESSOR==

// Main feed: lemellotron.com. Fallback feed: RadioKing, used automatically when the main feed fails.
const STREAM_URL = "https://play.lemellotron.com/main";
const FALLBACK_STREAM_URL = "https://play.radioking.io/lemellotron-stream";
// A playing item belongs to the radio if its path contains one of these (both stream URLs contain "lemellotron")
const STREAM_MATCH = "lemellotron";
const FALLBACK_STREAM_MATCH = "radioking";

const API_URL = "https://api.lemellotron.com/api/widget/track/current";
const FALLBACK_API_URL = "https://api.radioking.io/widget/radio/lemellotron-stream/track/current";

const FEED_OPTIONS = [
    {
        id: "lemellotron",
        label: "Le  Mellotron (lemellotron.com)",
        shortLabel: "lemellotron.com",
        streamUrl: STREAM_URL,
        apiUrl: API_URL,
        allowAutoFallback: true
    },
    {
        id: "radioking",
        label: "Le  Mellotron (radioking.io)",
        shortLabel: "radioking.io",
        streamUrl: FALLBACK_STREAM_URL,
        apiUrl: FALLBACK_API_URL,
        allowAutoFallback: false
    }
];

const RADIO_PLAYLIST_NAME = "Le Mellotron Stream";
const POLL_INTERVAL_MS = 10000;
const STREAM_FALLBACK_TIMEOUT_MS = 5000;
const MAX_HISTORY = 200;
const HEADER_HEIGHT = 96;
const HIST_ROW_H = 36;
const THUMB_SIZE = 32; // size of the cover thumbnails in the history list
const SCROLL_STEP_ROWS = 5;

// GDI DrawText flags
const DT_CENTER = 0x00000001;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const DT_END_ELLIPSIS = 0x00008000;

const FLAGS_LEFT_ELLIPSIS = DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS;
const FLAGS_BTN = DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;

const CACHE_DIR = fb.ProfilePath + "lemellotron-cache\\";
if (!utils.IsDirectory(CACHE_DIR)) {
    utils.CreateFolder(CACHE_DIR);
}
const ARTWORK_DIR = CACHE_DIR + "artwork\\";
if (!utils.IsDirectory(ARTWORK_DIR)) {
    utils.CreateFolder(ARTWORK_DIR);
}
const THUMB_DIR = CACHE_DIR + "thumbs\\";
if (!utils.IsDirectory(THUMB_DIR)) {
    utils.CreateFolder(THUMB_DIR);
}
const HISTORY_FILE = CACHE_DIR + "history.json";

let state = {
    artist: "Le Mellotron",
    title: "Click Play to tune in",
    album: "",
    coverUrl: "",
    coverImg: null,
    currentCoverPath: "",
    loadedCoverUrl: "",
    coverRequestPath: "",
    coverRequestUrl: "",
    coverCounter: 0,
    currentTaskId: null,
    addTaskId: null,
    pendingPlay: false,
    selectedFeedId: "lemellotron",
    feedMenuOpen: false,
    usingFallbackStream: false,
    usingFallbackApi: false,
    copiedNotice: "",
    hoveredTarget: null,
    history: [],
    historyRev: 0,
    scrollOffset: 0,
    searchText: "",
    searchTokens: [],
    searchCaret: 0,
    searchAnchor: 0,
    searchStart: 0,
    searchDragging: false,
    searchIbeam: false,
    searchFocused: false
};

const fontArtist = gdi.Font("Segoe UI", 16, 1);
const fontTitle = gdi.Font("Segoe UI", 14, 0);
const fontAlbum = gdi.Font("Segoe UI", 12, 2);
const fontNotice = gdi.Font("Segoe UI", 10, 0);
const fontBtn = gdi.Font("Segoe UI", 10, 1);
const fontDiscogsBtn = gdi.Font("Segoe UI", 9, 1);
const fontFeedBtn = gdi.Font("Segoe UI", 10, 0);
const fontSecHeader = gdi.Font("Segoe UI", 10, 1);
const fontHistIdx = gdi.Font("Segoe UI", 9, 1);
const fontHistMain = gdi.Font("Segoe UI", 12, 0);
const fontHistSub = gdi.Font("Segoe UI", 10, 2);
const fontClearBtn = gdi.Font("Segoe UI", 9, 1);

let pollTimer = null;
let noticeTimer = null;
let fallbackPlayTimer = null;
let btnRect = { x: 0, y: 0, w: 58, h: 24 };
let discogsBtnRect = { x: 0, y: 0, w: 58, h: 20, visible: false };
let feedBtnRect = { x: 0, y: 0, w: 120, h: 19, visible: false };
let feedMenuRect = { x: 0, y: 0, w: 210, h: 48, visible: false };
let clearBtnRect = { x: 0, y: 0, w: 52, h: 20, visible: false };
let histListRect = { x: 0, y: 0, w: 0, h: 0, visibleRows: 0 };
let searchRect = { x: 0, y: 0, w: 0, h: 20, visible: false };
let searchClearRect = { x: 0, y: 0, w: 0, h: 20 };
let searchViewCache = { rev: -1, text: null, list: [] };
let hitTargets = [];

// ===================== Last.fm scrobbling =====================
const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_AUTH_URL = "https://www.last.fm/api/auth/";
const LASTFM_CONFIG_FILE = CACHE_DIR + "lastfm_config.json";
const LASTFM_FILE = CACHE_DIR + "lastfm.json";
const SCROBBLE_DELAY_MS = 30000; // radio gives no track length: scrobble after 30 s of listening on the same track (Last.fm minimum)
const LASTFM_MAX_QUEUE = 500;

let lfmConfig = { apiKey: "", apiSecret: "" };
let lfm = { sessionKey: "", user: "", enabled: true, token: "", queue: [] };
let lfmTasks = {};
let lfmCurrentKey = "";
let lfmFlushing = false;
let scrobbleTimer = null;
let lfmBtnRect = { x: 0, y: 0, w: 100, h: 20, visible: false };

// --- MD5 (needed for the Last.fm API signature) ---
/**
 * Converts a JS (UTF-16) string to an array of UTF-8 bytes, handling surrogate pairs.
 * Needed by md5() because Last.fm signs the UTF-8 form of the parameters.
 * @param {string} str
 * @returns {number[]} byte values (0-255)
 */
function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
            const c2 = str.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                i++;
            }
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}

/**
 * Pure-JS MD5 implementation (JSplitter has no built-in hashing).
 * Used only to compute the Last.fm `api_sig` request signature.
 * @param {string} str - input text (hashed as UTF-8)
 * @returns {string} 32-char lowercase hex digest
 */
function md5(str) {
    const rl = function (n, c) { return (n << c) | (n >>> (32 - c)); };
    const add = function (x, y) { return (x + y) | 0; };
    const bytes = utf8Bytes(str);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (8 * i)) & 0xFF);
    for (let i = 0; i < 4; i++) bytes.push(0);

    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

    let a0 = 0x67452301 | 0, b0 = 0xEFCDAB89 | 0, c0 = 0x98BADCFE | 0, d0 = 0x10325476 | 0;

    for (let off = 0; off < bytes.length; off += 64) {
        const M = [];
        for (let j = 0; j < 16; j++) {
            const p = off + j * 4;
            M[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
        }
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = add(add(F, A), add(K[i], M[g]));
            A = D; D = C; C = B;
            B = add(B, rl(F, S[(i >> 4) * 4 + (i & 3)]));
        }
        a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }

    let hex = "";
    [a0, b0, c0, d0].forEach(function (x) {
        for (let j = 0; j < 4; j++) {
            hex += ((x >>> (8 * j)) & 0xFF).toString(16).padStart(2, "0");
        }
    });
    return hex;
}

// --- Persistence ---
/**
 * Creates a starter lastfm_config.json template in the cache folder if one does not exist yet.
 */
function lfmEnsureConfigTemplate() {
    try {
        if (!utils.IsFile(LASTFM_CONFIG_FILE)) {
            utils.WriteTextFile(LASTFM_CONFIG_FILE, JSON.stringify({
                apiKey: "",
                apiSecret: ""
            }, null, 2));
        }
    } catch (e) {
        console.log("Last.fm config template error:", e);
    }
}

/**
 * Loads Last.fm API credentials from lastfm_config.json in the cache folder.
 */
function lfmLoadConfig() {
    lfmConfig = { apiKey: "", apiSecret: "" };
    lfmEnsureConfigTemplate();
    try {
        const raw = utils.ReadTextFile(LASTFM_CONFIG_FILE);
        if (!raw) return;
        const d = JSON.parse(raw.replace(/^\uFEFF/, "")); // tolerate a BOM added by some editors
        lfmConfig.apiKey = typeof d.apiKey === "string" ? d.apiKey.trim() : "";
        lfmConfig.apiSecret = typeof d.apiSecret === "string" ? d.apiSecret.trim() : "";
    } catch (e) {
        console.log("Last.fm config load error:", e);
    }
}

/**
 * Loads the saved Last.fm state (session key, user name, on/off flag, pending scrobble queue)
 * from lastfm.json in the cache folder, along with credentials from lastfm_config.json.
 * Invalid queue entries are discarded. Never throws.
 */
function lfmLoad() {
    lfmLoadConfig();
    try {
        const raw = utils.ReadTextFile(LASTFM_FILE);
        if (!raw) return;
        const d = JSON.parse(raw);
        lfm.sessionKey = typeof d.sessionKey === "string" ? d.sessionKey : "";
        lfm.user = typeof d.user === "string" ? d.user : "";
        lfm.enabled = d.enabled !== false;
        lfm.queue = Array.isArray(d.queue) ? d.queue.filter(function (q) {
            return q && typeof q.artist === "string" && typeof q.title === "string" && q.ts;
        }).slice(0, LASTFM_MAX_QUEUE) : [];
    } catch (e) {
        console.log("Last.fm load error:", e);
    }
}

/**
 * Writes the Last.fm state (session key, user, enabled flag, scrobble queue) to lastfm.json.
 * The temporary auth token is intentionally not persisted.
 */
function lfmSave() {
    try {
        utils.WriteTextFile(LASTFM_FILE, JSON.stringify({
            sessionKey: lfm.sessionKey,
            user: lfm.user,
            enabled: lfm.enabled,
            queue: lfm.queue
        }, null, 2));
    } catch (e) {
        console.log("Last.fm save error:", e);
    }
}

// --- API plumbing ---
/**
 * True once real API credentials are present in lastfm_config.json.
 * @returns {boolean}
 */
function lfmConfigured() {
    return !!(lfmConfig.apiKey && lfmConfig.apiSecret);
}

/**
 * True when scrobbling can actually happen: credentials set, account linked, and toggle on.
 * @returns {boolean}
 */
function lfmActive() {
    return lfmConfigured() && !!lfm.sessionKey && lfm.enabled;
}

/**
 * Builds the Last.fm `api_sig`: parameters sorted by name, concatenated as name+value,
 * shared secret appended, then MD5. `format` and `callback` are excluded per the API spec.
 * @param {Object} params - request parameters (without api_sig)
 * @returns {string} md5 hex signature
 */
function lfmSign(params) {
    const keys = Object.keys(params).filter(function (k) {
        return k !== "format" && k !== "callback";
    }).sort();
    let s = "";
    keys.forEach(function (k) { s += k + params[k]; });
    return md5(s + lfmConfig.apiSecret);
}

/**
 * Sends a signed request to the Last.fm API asynchronously.
 * Adds api_key, api_sig and format=json, then registers the callback in lfmTasks so that
 * on_http_request_done can route the response back to it.
 * @param {Object} params - API parameters (must include `method`)
 * @param {boolean} post - true: POST (write methods); false: GET (auth methods)
 * @param {function(boolean, string, number)} cb - called with (success, responseText, httpStatus)
 */
function lfmRequest(params, post, cb) {
    params.api_key = lfmConfig.apiKey;
    params.api_sig = lfmSign(params);
    params.format = "json";
    const body = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");

    let id;
    if (post) {
        id = utils.HTTPRequestAsync(1, LASTFM_API_ROOT, "Content-Type: application/x-www-form-urlencoded", body);
    } else {
        id = utils.HTTPRequestAsync(0, LASTFM_API_ROOT + "?" + body);
    }
    lfmTasks[id] = cb;
}

/**
 * JSON.parse that returns null instead of throwing.
 * @param {string} text
 * @returns {Object|null}
 */
function lfmParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
}

// --- Linking ---
/**
 * Returns the text of the footer Last.fm button for the current state:
 * setup -> Link -> Finish link -> On (n queued) / Off.
 * @returns {string}
 */
function lfmButtonLabel() {
    if (!lfmConfigured()) return "Last.fm: setup";
    if (!lfm.sessionKey) return lfm.token ? "Last.fm: Finish link" : "Last.fm: Link";
    return lfm.enabled ? "Last.fm: On" + (lfm.queue.length ? " (" + lfm.queue.length + ")" : "") : "Last.fm: Off";
}

/**
 * Handles a click on the Last.fm button. Depending on state it:
 *   1. reloads config and warns if apiKey / apiSecret are missing from lastfm_config.json;
 *   2. if linked, toggles scrobbling on/off;
 *   3. if not linked and no token yet, requests a token and opens the Last.fm authorization page;
 *   4. if a token exists, exchanges it for a session key (auth.getSession) to finish linking.
 */
function lfmButtonClick() {
    lfmLoadConfig();
    if (!lfmConfigured()) {
        showStatusNotice("Add apiKey & apiSecret in lastfm_config.json");
        return;
    }
    if (lfm.sessionKey) {
        lfm.enabled = !lfm.enabled;
        lfmSave();
        lfmReset();
        showStatusNotice("Last.fm scrobbling " + (lfm.enabled ? "on" : "off"));
        return;
    }
    if (!lfm.token) {
        lfmRequest({ method: "auth.getToken" }, false, function (ok, text) {
            const d = lfmParse(text);
            if (!ok || !d || !d.token) {
                showStatusNotice("Last.fm: couldn't get token");
                return;
            }
            lfm.token = d.token;
            utils.Run(LASTFM_AUTH_URL + "?api_key=" + lfmConfig.apiKey + "&token=" + d.token);
            showStatusNotice("Authorize in browser, then click again");
        });
    } else {
        lfmRequest({ method: "auth.getSession", token: lfm.token }, false, function (ok, text) {
            const d = lfmParse(text);
            if (d && d.session && d.session.key) {
                lfm.sessionKey = d.session.key;
                lfm.user = d.session.name || "";
                lfm.token = "";
                lfm.enabled = true;
                lfmSave();
                showStatusNotice("Last.fm linked: " + lfm.user);
            } else if (d && d.error === 14) {
                showStatusNotice("Not authorized yet - approve in browser");
            } else {
                lfm.token = ""; // expired/invalid: start over
                showStatusNotice("Link failed - click Link again");
            }
        });
    }
}

// --- Now playing / scrobbling ---
/**
 * Cancels the pending scrobble timer and forgets the current track key.
 * Called when playback stops or scrobbling is toggled, so a track that was interrupted
 * before SCROBBLE_DELAY_MS is never scrobbled.
 */
function lfmReset() {
    if (scrobbleTimer) {
        window.ClearTimeout(scrobbleTimer);
        scrobbleTimer = null;
    }
    lfmCurrentKey = "";
}

/**
 * Called for every poll result. When the track changed, sends track.updateNowPlaying immediately
 * and starts a SCROBBLE_DELAY_MS timer; if the track is still current when it fires, the scrobble is
 * queued (using the freshest album name) and flushed. Placeholder tracks are ignored.
 * @param {string} artist
 * @param {string} title
 * @param {string} album - may be empty
 */
function lfmOnTrack(artist, title, album) {
    if (!lfmActive() || isPlaceholderTrack(artist, title)) return;

    const key = artist + "\u0001" + title;
    if (key === lfmCurrentKey) return;
    lfmCurrentKey = key;

    if (scrobbleTimer) window.ClearTimeout(scrobbleTimer);

    const ts = Math.floor(Date.now() / 1000);

    const np = { method: "track.updateNowPlaying", sk: lfm.sessionKey, artist: artist, track: title };
    if (album) np.album = album;
    lfmRequest(np, true, function () {});

    scrobbleTimer = window.SetTimeout(function () {
        scrobbleTimer = null;
        // the album sometimes arrives a poll later: use the freshest one
        const alb = (state.artist === artist && state.title === title && state.album) ? state.album : album;
        lfm.queue.push({ artist: artist, title: title, album: alb || "", ts: ts });
        if (lfm.queue.length > LASTFM_MAX_QUEUE) lfm.queue.shift();
        lfmSave();
        lfmFlush();
    }, SCROBBLE_DELAY_MS);
}

/**
 * Sends queued scrobbles to Last.fm (up to 50 per request, as the API allows).
 * On success the batch is removed from the queue and the next one is sent.
 * Temporary errors (network, error 11/16) keep the queue for a retry on the next poll;
 * error 9 (invalid session) unlinks the account; any other error drops the batch so the queue cannot get stuck.
 * Does nothing if a flush is already in progress.
 */
function lfmFlush() {
    if (lfmFlushing || !lfm.sessionKey || lfm.queue.length === 0) return;

    const batch = lfm.queue.slice(0, 50);
    const p = { method: "track.scrobble", sk: lfm.sessionKey };
    batch.forEach(function (it, i) {
        p["artist[" + i + "]"] = it.artist;
        p["track[" + i + "]"] = it.title;
        p["timestamp[" + i + "]"] = String(it.ts);
        if (it.album) p["album[" + i + "]"] = it.album;
    });

    lfmFlushing = true;
    lfmRequest(p, true, function (ok, text, status) {
        lfmFlushing = false;
        const d = lfmParse(text);

        if (ok && status >= 200 && status < 300 && d && !d.error) {
            lfm.queue.splice(0, batch.length);
            lfmSave();
            const last = batch[batch.length - 1];
            showStatusNotice("Scrobbled: " + last.artist + " - " + last.title);
            if (lfm.queue.length) lfmFlush();
        } else if (d && d.error === 9) {
            lfm.sessionKey = "";
            lfmSave();
            showStatusNotice("Last.fm session expired - relink");
        } else if (!d || d.error === 11 || d.error === 16) {
            // network / temporary: keep the queue, retried on next poll
            console.log("Last.fm scrobble will retry:", status, text);
        } else {
            // permanent error for this batch: drop it so the queue can't get stuck
            console.log("Last.fm scrobble rejected:", text);
            lfm.queue.splice(0, batch.length);
            lfmSave();
        }
    });
}

/**
 * Draws the Last.fm button, updates lfmBtnRect and registers its hit target for hover/click.
 * @param {GdiGraphics} gr
 * @param {number} x
 * @param {number} y
 * @param {string|null} hoveredKey - key of the currently hovered hit target
 */
function lfmDrawButton(gr, x, y, hoveredKey) {
    const label = lfmButtonLabel();
    const w = measureTextWidth(gr, label, fontClearBtn) + 16;
    lfmBtnRect.x = x; lfmBtnRect.y = y; lfmBtnRect.w = w; lfmBtnRect.h = 20;
    lfmBtnRect.visible = true;

    const key = "action:lfm";
    hitTargets.push({ rect: { x: x, y: y, w: w, h: 20 }, type: "action", key: key, value: "", label: "Last.fm" });

    const on = lfmActive();
    const hov = (hoveredKey === key);
    gr.FillSolidRect(x, y, w, 20, hov ? 0xFF2A2A2A : 0xFF222222);
    gr.DrawRect(x, y, w, 20, 1, on ? 0xFFB71C1C : (hov ? 0xFF555555 : 0xFF3A3A3A));
    gr.GdiDrawText(label, fontClearBtn, on ? 0xFFEF9A9A : (hov ? 0xFFFFFFFF : 0xFFB0B0B0),
        x, y, w, 20, FLAGS_BTN);
}
// ===================== end Last.fm =====================


// --- Feed Helpers ---

/**
 * Returns the FEED_OPTIONS entry matching state.selectedFeedId (first entry as fallback).
 * @returns {Object} feed option
 */
function getSelectedFeedOption() {
    for (let i = 0; i < FEED_OPTIONS.length; i++) {
        if (FEED_OPTIONS[i].id === state.selectedFeedId) {
            return FEED_OPTIONS[i];
        }
    }
    return FEED_OPTIONS[0];
}

/**
 * Switches the active feed (stream URL + metadata API). If the radio is playing or starting,
 * reconnects immediately on the new stream and refreshes the metadata.
 * @param {string} feedId - id from FEED_OPTIONS
 */
function selectFeed(feedId) {
    const feed = FEED_OPTIONS.find(function (f) { return f.id === feedId; }) || FEED_OPTIONS[0];
    state.selectedFeedId = feed.id;
    state.feedMenuOpen = false;
    state.usingFallbackStream = false;
    state.usingFallbackApi = false;
    clearFallbackPlayTimer();
    showStatusNotice(feed.label);

    if (isMellotronPlaying() || state.pendingPlay) {
        state.title = "Connecting...";
        state.album = "";
        queueStreamUrl(feed.streamUrl, !feed.allowAutoFallback);
        if (pollTimer) {
            fetchTrackInfo();
        }
    } else {
        window.Repaint();
    }
}

// --- Time, Clipboard & Discogs Helpers ---

/**
 * Current local time as HH:MM (used to stamp history entries).
 * @returns {string}
 */
function formatNowTime() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
}

/**
 * Shows a short message in green under the track info for about 2.2 s, then clears it.
 * @param {string} text
 */
function showStatusNotice(text) {
    if (!text) return;
    state.copiedNotice = cleanMetaString(text);
    if (noticeTimer) {
        window.ClearTimeout(noticeTimer);
        noticeTimer = null;
    }
    noticeTimer = window.SetTimeout(function () {
        state.copiedNotice = "";
        noticeTimer = null;
        window.Repaint();
    }, 2200);
    window.Repaint();
}

/**
 * Copies a value to the clipboard and shows a "Copied <label>: <value>" notice.
 * @param {string} label - e.g. "Artist"
 * @param {string} value
 */
function showCopiedNotice(label, value) {
    if (!value) return;
    utils.SetClipboardText(value);
    showStatusNotice("Copied " + label + ": " + value);
}

/**
 * Opens a Discogs search in the default browser for artist + title + album.
 * @param {{artist: string, title: string, album: string}} item
 */
let lastDiscogsTime = 0;
function openDiscogsSearch(item) {
    if (!item) return;
    if (Date.now() - lastDiscogsTime < 800) return; // a double click would otherwise open two tabs
    lastDiscogsTime = Date.now();
    const parts = [item.artist, item.title, item.album].filter(function (v) {
        return typeof v === "string" && v.trim().length > 0;
    });
    if (parts.length === 0) return;

    const queryText = parts.join(" ");
    const url = "https://www.discogs.com/search/?q=" + encodeURIComponent(queryText) + "&type=all";
    try {
        utils.Run(url);
        showStatusNotice("Discogs: " + parts.join(" - "));
    } catch (e) {
        console.log("Failed to open Discogs URL:", e);
        showStatusNotice("Discogs launch failed");
    }
}

/**
 * Hit test: is (x, y) inside the rectangle {x, y, w, h}?
 * @returns {boolean}
 */
function pointInRect(x, y, rect) {
    if (!rect) return false;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Returns the first registered hit target under (x, y), or null.
 * Targets are rebuilt on every paint in on_paint().
 * @returns {Object|null}
 */
function findHitTarget(x, y) {
    for (let i = 0; i < hitTargets.length; i++) {
        if (pointInRect(x, y, hitTargets[i].rect)) {
            return hitTargets[i];
        }
    }
    return null;
}

// --- History Search Box ---

/**
 * Lower-cases a string and strips accents, so "Beyoncé" matches "beyonce".
 * @param {string} str
 * @returns {string}
 */
function normalizeForSearch(str) {
    let out = String(str || "").toLowerCase();
    try {
        out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
        // normalize() unavailable: keep the plain lower-cased text
    }
    return out;
}

/**
 * True when a search text is active (the history list is being filtered).
 * @returns {boolean}
 */
function isSearching() {
    return state.searchTokens.length > 0;
}

/**
 * Returns the list of history entries to display: the whole history, or only the entries whose
 * artist, title or album contain every word typed in the search box (case and accent insensitive).
 * The filtered list is cached until the search text or the history changes.
 * @returns {Object[]}
 */
function getHistoryView() {
    if (!isSearching()) return state.history;
    if (searchViewCache.rev === state.historyRev && searchViewCache.text === state.searchText) {
        return searchViewCache.list;
    }

    const tokens = state.searchTokens;
    const list = [];
    for (let i = 0; i < state.history.length; i++) {
        const it = state.history[i];
        const hay = normalizeForSearch(it.artist + "\n" + it.title + "\n" + it.album);
        let ok = true;
        for (let t = 0; t < tokens.length; t++) {
            if (hay.indexOf(tokens[t]) === -1) {
                ok = false;
                break;
            }
        }
        if (ok) list.push(it);
    }

    searchViewCache = { rev: state.historyRev, text: state.searchText, list: list };
    return list;
}

// Search box text editing: a caret (searchCaret) and a selection anchor (searchAnchor); the selection is
// the range between them. searchLayout holds the character x offsets measured during the last paint,
// so mouse clicks can be converted to a caret position.
const SEARCH_MAX_LENGTH = 100;
const SEARCH_SELECTION_COLOUR = 0xFF3A6EA5;
let searchLayout = null;
let searchLastDblTime = 0;

/**
 * Sets the search text and puts the caret at the given position (no selection), rebuilds the search
 * words, scrolls the list back to the top and repaints.
 * @param {string} text
 * @param {number} caret - caret index in text
 */
function searchSetText(text, caret) {
    state.searchText = text;
    state.searchCaret = Math.max(0, Math.min(text.length, caret));
    state.searchAnchor = state.searchCaret;
    state.searchTokens = normalizeForSearch(text).split(/\s+/).filter(function (t) { return t.length > 0; });
    state.scrollOffset = 0;
    state.hoveredTarget = null;
    window.Repaint();
}

/**
 * Character class used for word boundaries: 0 = whitespace, 1 = letter/digit/underscore, 2 = punctuation.
 * @param {string} ch
 * @returns {number}
 */
function searchCharClass(ch) {
    if (/\s/.test(ch)) return 0;
    if (/[\w\u00C0-\uFFFF]/.test(ch)) return 1;
    return 2;
}

/**
 * Start and end of the word (or whitespace / punctuation run) at a character index.
 * Used by double-click. An index past the end selects the last run.
 * @param {number} idx
 * @returns {number[]} [start, end)
 */
function searchWordRange(idx) {
    const t = state.searchText;
    if (!t) return [0, 0];
    const i = Math.max(0, Math.min(idx, t.length - 1));
    const cls = searchCharClass(t.charAt(i));
    let s = i;
    let e = i + 1;
    while (s > 0 && searchCharClass(t.charAt(s - 1)) === cls) s--;
    while (e < t.length && searchCharClass(t.charAt(e)) === cls) e++;
    return [s, e];
}

/**
 * Ctrl+Left target: start of the previous word.
 * @param {number} i - caret index
 * @returns {number}
 */
function searchWordLeft(i) {
    const t = state.searchText;
    while (i > 0 && searchCharClass(t.charAt(i - 1)) === 0) i--;
    if (i > 0) {
        const cls = searchCharClass(t.charAt(i - 1));
        while (i > 0 && searchCharClass(t.charAt(i - 1)) === cls) i--;
    }
    return i;
}

/**
 * Ctrl+Right target: start of the next word.
 * @param {number} i - caret index
 * @returns {number}
 */
function searchWordRight(i) {
    const t = state.searchText;
    const len = t.length;
    if (i < len) {
        const cls = searchCharClass(t.charAt(i));
        while (i < len && searchCharClass(t.charAt(i)) === cls) i++;
    }
    while (i < len && searchCharClass(t.charAt(i)) === 0) i++;
    return i;
}

/**
 * True when some text is selected in the search box.
 * @returns {boolean}
 */
function searchHasSelection() {
    return state.searchAnchor !== state.searchCaret;
}

/**
 * Selected range of the search text.
 * @returns {number[]} [start, end) (equal when nothing is selected)
 */
function searchSelRange() {
    return [Math.min(state.searchAnchor, state.searchCaret), Math.max(state.searchAnchor, state.searchCaret)];
}

/**
 * Selects a range: the caret ends up at `caret`, the other end stays at `anchor`.
 * @param {number} anchor
 * @param {number} caret
 */
function searchSelect(anchor, caret) {
    const len = state.searchText.length;
    state.searchAnchor = Math.max(0, Math.min(len, anchor));
    state.searchCaret = Math.max(0, Math.min(len, caret));
    window.Repaint();
}

/**
 * Moves the caret. With `extend`, the selection grows (Shift); otherwise it is cleared.
 * @param {number} idx
 * @param {boolean} extend
 */
function searchMoveCaret(idx, extend) {
    state.searchCaret = Math.max(0, Math.min(state.searchText.length, idx));
    if (!extend) state.searchAnchor = state.searchCaret;
    window.Repaint();
}

/**
 * Replaces the selection (or inserts at the caret) with some text and re-filters the history.
 * @param {string} ins - text to insert, may be empty (= delete the selection)
 */
function searchReplaceSelection(ins) {
    const r = searchSelRange();
    const t = state.searchText;
    let nt = t.substring(0, r[0]) + ins + t.substring(r[1]);
    if (nt.length > SEARCH_MAX_LENGTH) nt = nt.substring(0, SEARCH_MAX_LENGTH);
    searchSetText(nt, r[0] + ins.length);
}

/**
 * Converts a mouse x position to a character index in the search text, using the offsets measured
 * during the last paint.
 * @param {number} x
 * @param {boolean} [underPointer=false] - true: index of the character under the pointer (double-click);
 *                                         false: nearest gap between characters (caret placement)
 * @returns {number}
 */
function searchIndexAt(x, underPointer) {
    const L = searchLayout;
    if (!L || !state.searchText) return 0;
    const rel = x - L.textX;
    if (rel <= 0) return L.start;
    for (let k = 0; k < L.xs.length - 1; k++) {
        const boundary = underPointer ? L.xs[k + 1] : (L.xs[k] + L.xs[k + 1]) / 2;
        if (rel < boundary) return L.start + k;
    }
    return L.start + L.xs.length - 1;
}

/**
 * Draws the search box in the footer (placeholder, text with selection, caret, clear "x") and updates
 * searchRect and searchLayout. Nothing is drawn, and the box cannot be clicked, if there is less than
 * 90 px of room.
 * @param {GdiGraphics} gr
 * @param {number} x
 * @param {number} y
 * @param {number} w - available width
 * @param {number} h
 */
function drawSearchBox(gr, x, y, w, h) {
    if (w < 90) return;
    searchRect.x = x;
    searchRect.y = y;
    searchRect.w = w;
    searchRect.h = h;
    searchRect.visible = true;

    const focused = state.searchFocused;
    const text = state.searchText;
    const hasText = text.length > 0;
    const clearW = hasText ? 18 : 0;
    const textX = x + 6;
    const innerW = Math.max(10, w - 12 - clearW);
    const flags = DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX;

    searchClearRect = { x: x + w - clearW, y: y, w: clearW, h: h };

    gr.FillSolidRect(x, y, w, h, 0xFF202020);
    gr.DrawRect(x, y, w, h, 1, focused ? 0xFF64B5F6 : 0xFF3A3A3A);

    let caretX = textX;
    if (!hasText) {
        searchLayout = null;
        state.searchStart = 0;
        if (!focused) {
            gr.GdiDrawText("Search artist, title, album", fontFeedBtn, 0xFF6E6E6E, textX, y, innerW, h, FLAGS_LEFT_ELLIPSIS);
        }
    } else {
        const caret = Math.min(state.searchCaret, text.length);

        // first visible character, chosen so that the caret always stays inside the box
        let start = Math.min(state.searchStart, text.length);
        if (caret < start) start = caret;
        while (start < caret && measureTextWidth(gr, text.substring(start, caret), fontFeedBtn) > innerW - 2) {
            start++;
        }
        state.searchStart = start;

        // x offset of every character boundary from `start` (stops a little after the right edge)
        const xs = [0];
        for (let i = start + 1; i <= text.length; i++) {
            const wi = measureTextWidth(gr, text.substring(start, i), fontFeedBtn);
            xs.push(wi);
            if (wi > innerW + 40) break;
        }
        searchLayout = { textX: textX, start: start, xs: xs };

        const last = start + xs.length - 1;
        const selS = Math.max(start, Math.min(state.searchAnchor, caret));
        const selE = Math.min(last, Math.max(state.searchAnchor, caret));
        const drawPart = function (from, to, colour) {
            if (to <= from) return;
            const px = xs[from - start];
            const pw = Math.min(xs[to - start] - px + 2, innerW - px);
            if (pw > 0) gr.GdiDrawText(text.substring(from, to), fontFeedBtn, colour, textX + px, y, pw, h, flags);
        };

        if (selE > selS) {
            const hx = xs[selS - start];
            const hw = Math.min(xs[selE - start], innerW) - hx;
            if (hw > 0) gr.FillSolidRect(textX + hx, y + 3, hw, h - 6, SEARCH_SELECTION_COLOUR);
            drawPart(start, selS, 0xFFE6E6E6);
            drawPart(selS, selE, 0xFFFFFFFF);
            drawPart(selE, last, 0xFFE6E6E6);
        } else {
            drawPart(start, last, 0xFFE6E6E6);
        }

        caretX = textX + xs[Math.min(caret, last) - start];
        gr.GdiDrawText("\u00D7", fontFeedBtn, 0xFF8C8C8C, searchClearRect.x, y, clearW, h, FLAGS_BTN);
    }

    if (focused) {
        gr.FillSolidRect(caretX, y + 4, 1, h - 8, 0xFF90CAF9);
    }
}

/**
 * Asks the host to deliver typed characters and all keys (arrows included) to this panel.
 * In JSplitter, window.DlgCode is a property: on_char is only called once DLGC_WANTCHARS is set, and
 * without it Windows treats the keystrokes as unhandled and plays the error sound.
 * 0x0004 = DLGC_WANTALLKEYS, 0x0080 = DLGC_WANTCHARS.
 */
function requestKeyboardInput() {
    try {
        window.DlgCode = 0x0004 | 0x0080;
    } catch (e) {
        console.log("Le Mellotron DlgCode error:", e);
    }
}

/**
 * foobar callback: a character was typed. Edits the search text while the box has focus; typing replaces
 * the selection. Enter: leave the box. Esc: clear the text (or leave the box if already empty).
 * Ctrl+A selects all, Ctrl+C / Ctrl+X copy / cut the selection, Ctrl+V pastes,
 * Ctrl+Backspace deletes the previous word.
 * @param {number} code - character code
 * @returns {boolean} true when the key was consumed by the search box
 */
function on_char(code) {
    if (!state.searchFocused) return false;
    const t = state.searchText;
    const c = state.searchCaret;

    if (code === 8) { // Backspace
        if (!searchHasSelection() && c > 0) state.searchAnchor = c - 1;
        if (searchHasSelection()) searchReplaceSelection("");
    } else if (code === 127) { // Ctrl+Backspace
        if (!searchHasSelection() && c > 0) state.searchAnchor = searchWordLeft(c);
        if (searchHasSelection()) searchReplaceSelection("");
    } else if (code === 13) { // Enter
        state.searchFocused = false;
        window.Repaint();
    } else if (code === 27) { // Esc
        if (t) {
            searchSetText("", 0);
        } else {
            state.searchFocused = false;
            window.Repaint();
        }
    } else if (code === 1) { // Ctrl+A
        searchSelect(0, t.length);
    } else if (code === 3 || code === 24) { // Ctrl+C / Ctrl+X
        if (searchHasSelection()) {
            const r = searchSelRange();
            utils.SetClipboardText(t.substring(r[0], r[1]));
            if (code === 24) searchReplaceSelection("");
        }
    } else if (code === 22) { // Ctrl+V
        try {
            const clip = String(utils.GetClipboardText() || "").replace(/[\r\n\t]+/g, " ");
            if (clip) searchReplaceSelection(clip);
        } catch (e) {
            console.log("Le Mellotron paste error:", e);
        }
    } else if (code >= 32 && code !== 127) {
        searchReplaceSelection(String.fromCharCode(code));
    }
    return true; // tell the host the key was handled (avoids the Windows error sound)
}

/**
 * foobar callback: a key was pressed. Left / Right / Home / End move the caret (with Shift: extend the
 * selection; with Ctrl: jump by word), Delete erases (Ctrl+Delete: next word). While the box has focus
 * every key is reported as handled, so foobar2000 shortcuts do not fire.
 * @param {number} vkey - virtual key code
 * @returns {boolean} true when the key was consumed by the search box
 */
function on_key_down(vkey) {
    if (!state.searchFocused) return false;
    const shift = utils.IsKeyPressed(0x10);
    const ctrl = utils.IsKeyPressed(0x11);
    const t = state.searchText;
    const c = state.searchCaret;
    const r = searchSelRange();

    if (vkey === 37) { // Left
        if (!shift && searchHasSelection()) searchMoveCaret(r[0], false);
        else searchMoveCaret(ctrl ? searchWordLeft(c) : c - 1, shift);
    } else if (vkey === 39) { // Right
        if (!shift && searchHasSelection()) searchMoveCaret(r[1], false);
        else searchMoveCaret(ctrl ? searchWordRight(c) : c + 1, shift);
    } else if (vkey === 36) { // Home
        searchMoveCaret(0, shift);
    } else if (vkey === 35) { // End
        searchMoveCaret(t.length, shift);
    } else if (vkey === 46) { // Delete
        if (!searchHasSelection() && c < t.length) state.searchAnchor = ctrl ? searchWordRight(c) : c + 1;
        if (searchHasSelection()) searchReplaceSelection("");
    }
    return true;
}

/**
 * foobar callback: left button pressed. Inside the search box: focuses it and places the caret
 * (Shift extends the selection), starts a drag selection, clears the text if the "x" was hit, and
 * selects everything on a triple click (a click right after a double click).
 * @param {number} x
 * @param {number} y
 * @param {number} mask - mouse modifier flags (4 = Shift)
 */
function on_mouse_lbtn_down(x, y, mask) {
    if (!searchRect.visible || !pointInRect(x, y, searchRect)) return;

    state.searchFocused = true;
    requestKeyboardInput();

    if (state.searchText && pointInRect(x, y, searchClearRect)) {
        searchSetText("", 0);
        return;
    }

    if (Date.now() - searchLastDblTime < 500) { // triple click: select all
        searchLastDblTime = 0;
        searchSelect(0, state.searchText.length);
        return;
    }

    const idx = searchIndexAt(x, false);
    state.searchDragging = true;
    searchMoveCaret(idx, !!(mask & 4));
}

/**
 * foobar callback: double click. Inside the search box it selects the word under the pointer.
 * @param {number} x
 * @param {number} y
 * @param {number} mask
 */
function on_mouse_lbtn_dblclk(x, y, mask) {
    if (!searchRect.visible || !pointInRect(x, y, searchRect)) return;
    if (state.searchText && pointInRect(x, y, searchClearRect)) return;

    state.searchFocused = true;
    state.searchDragging = false;
    requestKeyboardInput();

    const r = searchWordRange(searchIndexAt(x, true));
    searchLastDblTime = Date.now();
    searchSelect(r[0], r[1]);
}

/**
 * Extends the selection while the mouse is dragged from inside the search box. Dragging past the left or
 * right edge moves the caret one character per mouse event, which scrolls the text.
 * @param {number} x
 */
function searchDragTo(x) {
    if (!utils.IsKeyPressed(0x01)) { // button released outside the panel
        state.searchDragging = false;
        return;
    }
    const left = searchRect.x + 6;
    const right = searchRect.x + searchRect.w - 6;
    let idx;
    if (x < left) idx = state.searchCaret - 1;
    else if (x > right) idx = state.searchCaret + 1;
    else idx = searchIndexAt(x, false);

    if (idx !== state.searchCaret) searchMoveCaret(idx, true);
}

/**
 * Shows the text (I-beam) cursor over the search box and the normal arrow elsewhere.
 * @param {number} x
 * @param {number} y
 */
function searchUpdateCursor(x, y) {
    const over = searchRect.visible && pointInRect(x, y, searchRect) &&
        !(state.searchText && pointInRect(x, y, searchClearRect));
    if (over !== state.searchIbeam) {
        state.searchIbeam = over;
        try {
            window.SetCursor(over ? 32513 : 32512);
        } catch (e) {}
    }
}

/**
 * foobar callback: the panel gained or lost keyboard focus. Losing it leaves the search box.
 * @param {boolean} is_focused
 */
function on_focus(is_focused) {
    if (!is_focused && state.searchFocused) {
        state.searchFocused = false;
        state.searchDragging = false;
        window.Repaint();
    }
}

/**
 * Highest valid scroll offset of the history list (total rows minus visible rows).
 * @param {number} [visibleRows] - defaults to the last painted row count
 * @returns {number}
 */
function getMaxScrollOffset(visibleRows) {
    const vis = Math.max(1, visibleRows || histListRect.visibleRows || 1);
    return Math.max(0, getHistoryView().length - vis);
}

/**
 * Keeps state.scrollOffset within [0, max].
 * @param {number} [visibleRows]
 */
function clampScrollOffset(visibleRows) {
    const maxOff = getMaxScrollOffset(visibleRows);
    if (state.scrollOffset > maxOff) state.scrollOffset = maxOff;
    if (state.scrollOffset < 0) state.scrollOffset = 0;
}

/**
 * Pixel width of a string in a given font (rounded up).
 * @param {GdiGraphics} gr
 * @param {string} text
 * @param {GdiFont} font
 * @returns {number}
 */
function measureTextWidth(gr, text, font) {
    if (!text) return 0;
    return Math.ceil(gr.CalcTextWidth(text, font));
}

// --- History Thumbnails ---
// Every history entry remembers the URL of its cover. A copy of each cover is kept in the thumbs folder
// (named after a hash of the URL, so tracks of the same album share one file) and shown as a small square
// in the history list, loaded and resized only once per URL.

let thumbCache = {};   // cover URL -> { img: GdiBitmap|null, loading: boolean }
let thumbPending = {}; // lower-cased download path -> cover URL

/**
 * Path of the cached cover file for a cover URL.
 * @param {string} url
 * @returns {string}
 */
function thumbPath(url) {
    const extMatch = url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    return THUMB_DIR + hashString(url) + "." + ext;
}

/**
 * Loads a cached cover file, crops it to a square and resizes it to THUMB_SIZE, then stores it in thumbCache.
 * A file that cannot be read (for example an interrupted download) is deleted so that it is fetched again
 * next time.
 * @param {string} url
 * @param {string} path
 */
function loadThumb(url, path) {
    let img = null;
    try {
        const full = gdi.Image(path);
        if (full) {
            const side = Math.min(full.Width, full.Height);
            const square = (full.Width === full.Height) ? full : full.Clone(
                Math.floor((full.Width - side) / 2), Math.floor((full.Height - side) / 2), side, side);
            img = square.Resize(THUMB_SIZE, THUMB_SIZE, 7); // 7 = HighQualityBicubic
        }
    } catch (e) {
        console.log("Le Mellotron thumbnail error:", e);
    }
    if (!img) {
        try { utils.RemovePath(path); } catch (e) {}
    }
    thumbCache[url] = { img: img, loading: false };
}

/**
 * Returns the thumbnail of a cover URL, or null if it is not available (yet).
 * The first call for an URL loads the cached file, or starts its download; on_download_file_done
 * repaints the panel when the download is finished.
 * @param {string} url
 * @returns {GdiBitmap|null}
 */
function getThumb(url) {
    if (!url) return null;
    const cached = thumbCache[url];
    if (cached) return cached.img;

    const path = thumbPath(url);
    if (utils.IsFile(path)) {
        loadThumb(url, path);
    } else {
        thumbCache[url] = { img: null, loading: true };
        thumbPending[path.toLowerCase()] = url;
        utils.DownloadFileAsync(url, path);
    }
    return thumbCache[url].img;
}

/**
 * Deletes the thumbnail files that no history entry uses any more.
 */
function cleanupThumbs() {
    try {
        const keep = {};
        for (let i = 0; i < state.history.length; i++) {
            if (state.history[i].cover) keep[thumbPath(state.history[i].cover).toLowerCase()] = true;
        }
        const files = utils.Glob(THUMB_DIR + "*");
        for (let i = 0; i < files.length; i++) {
            if (!keep[files[i].toLowerCase()]) {
                try { utils.RemovePath(files[i]); } catch (e) {}
            }
        }
    } catch (e) {
        console.log("Le Mellotron thumbnail cleanup error:", e);
    }
}

// --- History Helpers & JSON Persistence ---

/**
 * Reads history.json and returns a sanitized array (max MAX_HISTORY entries, newest first).
 * Returns an empty array if the file is missing or corrupt.
 * @returns {Object[]}
 */
function loadHistory() {
    try {
        const raw = utils.ReadTextFile(HISTORY_FILE);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        const clean = [];
        for (let i = 0; i < parsed.length && clean.length < MAX_HISTORY; i++) {
            const entry = parsed[i];
            if (entry && typeof entry.artist === "string" && typeof entry.title === "string") {
                clean.push({
                    artist: cleanMetaString(entry.artist),
                    title: cleanMetaString(entry.title),
                    album: cleanMetaString(entry.album),
                    cover: typeof entry.cover === "string" ? cleanMetaString(entry.cover) : "",
                    timeStr: typeof entry.timeStr === "string" ? cleanMetaString(entry.timeStr) : ""
                });
            }
        }
        return clean;
    } catch (e) {
        console.log("Le Mellotron history load error:", e);
        return [];
    }
}

/**
 * Writes the (capped) play history to history.json.
 */
function saveHistory() {
    try {
        utils.WriteTextFile(HISTORY_FILE, JSON.stringify(state.history.slice(0, MAX_HISTORY), null, 2));
    } catch (e) {
        console.log("Le Mellotron history save error:", e);
    }
}

/**
 * Empties the history list, resets scrolling, persists the change and shows a notice.
 */
function clearHistory() {
    state.history = [];
    thumbCache = {};
    state.historyRev++;
    state.scrollOffset = 0;
    state.hoveredTarget = null;
    clearBtnRect.visible = false;
    saveHistory();
    cleanupThumbs();
    showStatusNotice("History cleared");
}

/**
 * True for non-track states ("Click Play to tune in", "Connecting...", "Stopped", empty values...).
 * These are never added to the history nor scrobbled.
 * @param {string} artist
 * @param {string} title
 * @returns {boolean}
 */
function isPlaceholderTrack(artist, title) {
    if (!artist || !title) return true;
    const a = artist.toLowerCase();
    const t = title.toLowerCase();
    if (a === "le mellotron" && (
        t === "live broadcast" ||
        t === "stopped" ||
        t === "connecting..." ||
        t === "click play to tune in" ||
        t === "stream unavailable"
    )) {
        return true;
    }
    return false;
}

/**
 * Adds a track to the top of the history unless it is a placeholder or the same as the latest entry.
 * If the latest entry has no album yet and one arrives, it is filled in. Keeps the scrolled view stable.
 * @param {string} artist
 * @param {string} title
 * @param {string} album
 */
function recordHistoryTrack(artist, title, album, cover) {
    if (isPlaceholderTrack(artist, title)) return;

    const latest = state.history.length > 0 ? state.history[0] : null;
    if (latest && latest.artist === artist && latest.title === title) {
        let changed = false;
        if (!latest.album && album) {
            latest.album = album;
            changed = true;
        }
        if (!latest.cover && cover) {
            latest.cover = cover;
            changed = true;
        }
        if (changed) {
            state.historyRev++;
            saveHistory();
        }
        return;
    }

    state.historyRev++;
    state.history.unshift({
        artist: artist,
        title: title,
        album: album || "",
        cover: cover || "",
        timeStr: formatNowTime()
    });

    if (state.history.length > MAX_HISTORY) {
        state.history.length = MAX_HISTORY;
        cleanupThumbs();
    }

    if (state.scrollOffset > 0 && !isSearching()) {
        state.scrollOffset = Math.min(state.scrollOffset + 1, getMaxScrollOffset());
    }

    saveHistory();
}

// --- Playback & Stream Helpers ---

/**
 * Cancels the timer that triggers the stream fallback.
 */
function clearFallbackPlayTimer() {
    if (fallbackPlayTimer) {
        window.ClearTimeout(fallbackPlayTimer);
        fallbackPlayTimer = null;
    }
}

/**
 * True if foobar is playing a Le Mellotron stream: the path of the playing item matches a stream URL.
 * Only when the path of the playing item is unknown is the polling state used as a hint. A local file
 * is therefore never mistaken for the radio, even while polling is still running.
 * @returns {boolean}
 */
function isMellotronPlaying() {
    if (!fb.IsPlaying) return false;
    const handle = fb.GetNowPlaying();
    if (handle && handle.Path) {
        const p = handle.Path.toLowerCase();
        return p.includes(STREAM_MATCH) || p.includes(FALLBACK_STREAM_MATCH);
    }
    return pollTimer !== null;
}

/**
 * Returns the index of the dedicated "Le Mellotron Stream" playlist, creating it if needed.
 * @returns {number}
 */
function getOrCreateRadioPlaylist() {
    for (let i = 0; i < plman.PlaylistCount; i++) {
        if (plman.GetPlaylistName(i) === RADIO_PLAYLIST_NAME) {
            return i;
        }
    }
    return plman.CreatePlaylist(plman.PlaylistCount, RADIO_PLAYLIST_NAME);
}

/**
 * Asks foobar to load a stream URL asynchronously (result handled in on_locations_added).
 * If the feed allows auto-fallback, also arms a timeout that switches to the fallback stream.
 * @param {string} url
 * @param {boolean} useFallback - true when this URL is already the fallback
 */
function queueStreamUrl(url, useFallback) {
    state.usingFallbackStream = !!useFallback;
    state.pendingPlay = true;
    state.addTaskId = fb.AddLocationsAsync([url]);

    clearFallbackPlayTimer();
    const feed = getSelectedFeedOption();
    if (!useFallback && feed.allowAutoFallback) {
        fallbackPlayTimer = window.SetTimeout(function () {
            fallbackPlayTimer = null;
            if (!state.pendingPlay && !isMellotronPlaying()) {
                triggerStreamFallback("main stream timed out");
            } else if (state.pendingPlay) {
                triggerStreamFallback("main stream unresponsive");
            }
        }, STREAM_FALLBACK_TIMEOUT_MS);
    }
}

/**
 * Switches to FALLBACK_STREAM_URL when the primary stream fails.
 * If fallback is not allowed or already in use, shows "Stream unavailable" instead.
 * @param {string} reason - logged to the console
 */
function triggerStreamFallback(reason) {
    const feed = getSelectedFeedOption();
    if (!feed.allowAutoFallback || state.usingFallbackStream) {
        state.pendingPlay = false;
        state.title = "Stream unavailable";
        window.Repaint();
        return;
    }
    console.log("Le Mellotron fallback stream triggered:", reason);
    showStatusNotice("Stream down - using RadioKing fallback");
    queueStreamUrl(FALLBACK_STREAM_URL, true);
}

/**
 * Starts playback of the currently selected feed (UI goes to "Connecting...").
 */
function startRadioStream() {
    const feed = getSelectedFeedOption();
    state.feedMenuOpen = false;
    state.usingFallbackStream = !feed.allowAutoFallback;
    state.usingFallbackApi = !feed.allowAutoFallback;
    state.title = "Connecting...";
    state.album = "";
    state.copiedNotice = "";
    window.Repaint();
    queueStreamUrl(feed.streamUrl, !feed.allowAutoFallback);
}

/**
 * Stops playback, cancels pending timers and stops metadata polling.
 */
function stopRadioStream() {
    clearFallbackPlayTimer();
    state.feedMenuOpen = false;
    state.pendingPlay = false;
    if (isMellotronPlaying()) {
        fb.Stop();
    }
    stopPolling();
}

/**
 * foobar callback: the stream URL was resolved. Puts it in the radio playlist and plays it,
 * or triggers the fallback if nothing was returned.
 * @param {number} task_id
 * @param {FbMetadbHandleList} handle_list
 */
function on_locations_added(task_id, handle_list) {
    if (task_id !== state.addTaskId || !state.pendingPlay) return;
    state.pendingPlay = false;

    if (!handle_list || handle_list.Count === 0) {
        clearFallbackPlayTimer();
        const feed = getSelectedFeedOption();
        if (feed.allowAutoFallback && !state.usingFallbackStream) {
            triggerStreamFallback("main stream returned no items");
        } else {
            state.title = "Stream unavailable";
            window.Repaint();
        }
        return;
    }

    const idx = getOrCreateRadioPlaylist();
    plman.ClearPlaylist(idx);
    plman.InsertPlaylistItems(idx, 0, handle_list);
    plman.PlayingPlaylist = idx;
    plman.ExecutePlaylistDefaultAction(idx, 0);
}

// --- Cover Art, Idle Logo & Metadata Polling ---

/**
 * Decodes common HTML entities (named and numeric) found in API metadata.
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
    return str
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, function (_, code) {
            const n = parseInt(code, 10);
            return (n > 0 && n < 0x10FFFF) ? String.fromCharCode(n) : "";
        })
        .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
            const n = parseInt(hex, 16);
            return (n > 0 && n < 0x10FFFF) ? String.fromCharCode(n) : "";
        });
}

/**
 * Normalizes a metadata string: decodes entities, strips control/zero-width characters,
 * collapses whitespace and trims. Returns "" for non-strings.
 * @param {*} str
 * @returns {string}
 */
function cleanMetaString(str) {
    if (!str || typeof str !== "string") return "";
    let out = decodeHtmlEntities(str);
    out = out.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, " ");
    out = out.replace(/\u00A0/g, " ");
    return out.trim().replace(/\s+/g, " ");
}

/**
 * Small FNV-1a hash (hex), used to build unique cover cache file names.
 * @param {string} str
 * @returns {string}
 */
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

// Placeholder logo shown when there is no cover art (SVG, rasterized on demand by gdi.LoadSVG).
// fill-rule="evenodd" makes the three bars transparent, so the panel background shows through them.
const LOGO_SVG_PATH = "M82.6,0L82.6,0C37,0,0,37,0,82.6l0,0c0,45.6,37,82.6,82.6,82.6l0,0c45.6,0,82.6-37,82.6-82.6l0,0 C165.2,37,128.2,0,82.6,0z M69.3,82.8l-9.2,24.2c-2,5.3-7.9,8-13.3,6l-1-0.4c-5.3-2-8-8-6-13.3L56.4,56c1.7-4.5,6.4-7.2,11.2-6.5 c0.5,0.1,0.9,0.6,0.9,1.1c0,0.1,0,0.2-0.1,0.3l-6.5,17.2c-2,5.3,0.7,11.3,6,13.3l1,0.4C69.3,81.9,69.5,82.4,69.3,82.8z M100,85.1 l-9.2,24.2c-2,5.3-8,8-13.3,6l-1-0.4c-5.3-2-8-8-6-13.3L87,58.3c1.7-4.5,6.3-7.2,11-6.5c0.6,0.1,1,0.6,0.9,1.2 c0,0.1,0,0.1-0.1,0.2l-6.3,16.6c-2,5.9,0.7,11.8,6,13.9l1,0.4l0,0C99.9,84.2,100.2,84.7,100,85.1C100,85.1,100,85.1,100,85.1z M125.3,100.6l-3.1,8.1c-1.8,5.7-7.9,8.8-13.6,7c-5.7-1.8-8.8-7.9-7-13.6c0.1-0.4,0.2-0.7,0.4-1l3-8.1c2-5.7,8.1-8.7,13.8-6.7 c5.7,2,8.7,8.1,6.7,13.8C125.4,100.2,125.3,100.4,125.3,100.6L125.3,100.6z";
const LOGO_COLOUR = "#8E8E8E";
let logoCache = {}; // size in px -> rasterized logo (the header logo and the 32 px placeholders coexist)

/**
 * Returns the logo rasterized at the given size (square), cached per size.
 * @param {number} size - width and height in px
 * @returns {GdiBitmap|null} null if the SVG could not be loaded
 */
function getLogoImage(size) {
    const px = Math.round(size);
    if (logoCache[px]) return logoCache[px];

    let img = null;
    try {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="165.2" height="165.2" viewBox="0 0 165.2 165.2">' +
            '<path fill="' + LOGO_COLOUR + '" fill-rule="evenodd" d="' + LOGO_SVG_PATH + '"/></svg>';
        img = gdi.LoadSVG(svg, px);
    } catch (e) {
        console.log("Le Mellotron logo error:", e);
    }
    if (img) {
        if (Object.keys(logoCache).length >= 8) logoCache = {}; // panel resizing creates many sizes: keep it small
        logoCache[px] = img;
    }
    return img;
}

/**
 * Draws the placeholder Mellotron logo (grey disc with three slanted bars)
 * when no cover art is available.
 * @param {GdiGraphics} gr
 * @param {number} x
 * @param {number} y
 * @param {number} size - diameter in px
 */
function drawRadioLogo(gr, x, y, size) {
    if (size <= 4) return;
    const img = getLogoImage(size);
    if (img) {
        gr.DrawImage(img, x, y, size, size, 0, 0, img.Width, img.Height);
    }
}

/**
 * Shares the current radio track with other panels (e.g. "Track Details" or "Album Art" panels) through
 * window.NotifyOthers, as a JSON string {artist, title, album, cover} on the channel "lemellotron_nowplaying".
 * `cover` is the path of the downloaded cover image file, or "" if there is none yet.
 * Also called when a cover download finishes.
 * Called on every poll so a panel loaded later catches up within one poll interval.
 * Pass a placeholder or empty artist to send an empty message, which tells receivers to clear it.
 * @param {string} artist
 * @param {string} title
 * @param {string} album
 */
function broadcastNowPlaying(artist, title, album) {
    try {
        const valid = artist && title && !isPlaceholderTrack(artist, title);
        // the cover file path is only sent when the downloaded file really is the cover of the current track
        const cover = (state.loadedCoverUrl && state.loadedCoverUrl === state.coverUrl) ? state.currentCoverPath : "";
        window.NotifyOthers("lemellotron_nowplaying", valid ? JSON.stringify({ artist: artist, title: title, album: album || "", cover: cover }) : "");
    } catch (e) {
        console.log("Le Mellotron broadcast error:", e);
    }
}

/**
 * Forgets the current cover image and its URL.
 */
function clearCover() {
    state.coverImg = null;
    state.coverUrl = "";
    state.currentCoverPath = "";
    state.loadedCoverUrl = "";
}

/**
 * Deletes cached cover files (in the artwork subfolder) except the one in use.
 * @param {string} keepPath
 */
function cleanupOldCovers(keepPath) {
    try {
        const files = utils.Glob(ARTWORK_DIR + "cover_*");
        for (let i = 0; i < files.length; i++) {
            if (files[i] !== keepPath) {
                try {
                    utils.RemovePath(files[i]);
                } catch (e) {
                    // a file still in use is simply kept until the next cleanup
                }
            }
        }
    } catch (e) {
        console.log("Le Mellotron cover cleanup error:", e);
    }
}

/**
 * Downloads a cover image into the artwork subfolder of the cache folder (async; handled in on_download_file_done).
 * A counter in the file name guarantees a fresh file for every request.
 * @param {string} url
 */
function requestCoverDownload(url) {
    state.coverCounter++;
    const extMatch = url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const destPath = ARTWORK_DIR + "cover_" + state.coverCounter + "_" + hashString(url + "#" + state.coverCounter) + "." + ext;
    state.coverRequestPath = destPath;
    state.coverRequestUrl = url;
    utils.DownloadFileAsync(url, destPath);
}

/**
 * Metadata API URL to poll: the selected feed's API, or the fallback API if the main one failed
 * (only for a feed that allows auto-fallback).
 * @returns {string}
 */
function getActiveApiUrl() {
    const feed = getSelectedFeedOption();
    if (feed.allowAutoFallback && state.usingFallbackApi) {
        return FALLBACK_API_URL;
    }
    return feed.apiUrl;
}

/**
 * Starts polling the metadata API every POLL_INTERVAL_MS (and fetches immediately).
 */
function startPolling() {
    if (pollTimer) return;
    fetchTrackInfo();
    pollTimer = window.SetInterval(fetchTrackInfo, POLL_INTERVAL_MS);
}

/**
 * Stops polling, cancels any pending scrobble, resets the display to "Stopped" and clears the cover.
 */
function stopPolling() {
	lfmReset();
	state.currentTaskId = null; // a reply still in flight must not be recorded or scrobbled
	broadcastNowPlaying(null);
    if (pollTimer) {
        window.ClearInterval(pollTimer);
        pollTimer = null;
    }
    state.artist = "Le Mellotron";
    state.title = "Stopped";
    state.album = "";
    clearCover();
    window.Repaint();
}

/**
 * Requests the current track from the metadata API. Stops polling if nothing is playing.
 */
function fetchTrackInfo() {
    if (!fb.IsPlaying || !isMellotronPlaying()) {
        stopPolling();
        return;
    }
    state.currentTaskId = utils.HTTPRequestAsync(0, getActiveApiUrl());
}

/**
 * Switches to the fallback metadata API (if allowed) and retries immediately.
 */
function switchToFallbackApiAndRetry() {
    const feed = getSelectedFeedOption();
    if (!feed.allowAutoFallback || state.usingFallbackApi) return;
    state.usingFallbackApi = true;
    console.log("Le Mellotron fallback API triggered");
    showStatusNotice("API down - using RadioKing fallback");
    if (fb.IsPlaying) {
        state.currentTaskId = utils.HTTPRequestAsync(0, FALLBACK_API_URL);
    }
}

/**
 * foobar callback for all HTTP requests.
 * Last.fm responses are routed to their registered callback first. Otherwise, the response of the
 * metadata API is parsed: state, history, Last.fm now-playing/scrobble and cover art are updated,
 * and the fallback API is used on HTTP or JSON errors.
 * @param {number} task_id
 * @param {boolean} success
 * @param {string} response_text
 * @param {number} status - HTTP status
 */
function on_http_request_done(task_id, success, response_text, status) {
	if (lfmTasks[task_id]) {
        const cb = lfmTasks[task_id];
        delete lfmTasks[task_id];
        cb(success, response_text, status);
        return;
    }
	
    if (task_id !== state.currentTaskId) return;

    const isDeadStatus = (!success || !status || status < 200 || status >= 300);
    if (isDeadStatus) {
        const feed = getSelectedFeedOption();
        if (feed.allowAutoFallback && !state.usingFallbackApi) {
            switchToFallbackApiAndRetry();
        }
        return;
    }

    try {
        const data = JSON.parse(response_text);
        const newArtist = cleanMetaString(data.artist) || "Le Mellotron";
        const newTitle = cleanMetaString(data.title) || "Live Broadcast";
        const newAlbum = cleanMetaString(data.album);
        const newCover = cleanMetaString(data.cover);

        const trackChanged = (state.artist !== newArtist || state.title !== newTitle);
        let needsRepaint = false;

        if (
            state.artist !== newArtist ||
            state.title !== newTitle ||
            state.album !== newAlbum
        ) {
            state.artist = newArtist;
            state.title = newTitle;
            state.album = newAlbum;
            needsRepaint = true;
        }

        recordHistoryTrack(newArtist, newTitle, newAlbum, newCover);
		
		broadcastNowPlaying(newArtist, newTitle, newAlbum);
		lfmOnTrack(newArtist, newTitle, newAlbum);
        lfmFlush(); // retries anything left in the queue

        if (newCover && (newCover !== state.coverUrl || (trackChanged && !state.coverImg))) {
            state.coverUrl = newCover;
            requestCoverDownload(newCover);
        } else if (!newCover && state.coverImg) {
            clearCover();
            needsRepaint = true;
        }

        if (needsRepaint) window.Repaint();
    } catch (e) {
        console.log("Le Mellotron JSON parse error:", e);
        const feed = getSelectedFeedOption();
        if (feed.allowAutoFallback && !state.usingFallbackApi) {
            switchToFallbackApiAndRetry();
        }
    }
}

/**
 * foobar callback: a cover download finished. Loads the image, cleans old covers and repaints.
 * @param {string} path
 * @param {boolean} success
 * @param {string} error_text
 */
function on_download_file_done(path, success, error_text) {
    const thumbUrl = thumbPending[String(path).toLowerCase()];
    if (thumbUrl) { // a history thumbnail, not the current cover
        delete thumbPending[String(path).toLowerCase()];
        if (success) {
            loadThumb(thumbUrl, path);
        } else {
            console.log("Le Mellotron thumbnail download failed:", error_text || path);
            thumbCache[thumbUrl] = { img: null, loading: false };
            try { utils.RemovePath(path); } catch (e) {}
        }
        window.Repaint();
        return;
    }
    if (!success) {
        console.log("Le Mellotron cover download failed:", error_text || path);
        return;
    }
    const img = gdi.Image(path);
    if (img) {
        state.coverImg = img;
        state.currentCoverPath = path;
        if (String(path).toLowerCase() === String(state.coverRequestPath).toLowerCase()) {
            state.loadedCoverUrl = state.coverRequestUrl;
        }
        cleanupOldCovers(path);
        broadcastNowPlaying(state.artist, state.title, state.album); // other panels can now get the cover file
        window.Repaint();
    }
}

// --- foobar2000 Events & UI ---

/**
 * foobar callback: a new item started. Starts polling if it is the radio, otherwise stops it.
 */
function on_playback_new_track() {
    if (isMellotronPlaying()) {
        clearFallbackPlayTimer();
        state.pendingPlay = false;
        startPolling();
    } else {
        // something else (a local file, for example) is playing: end the radio session, so that
        // nothing is polled, shown or scrobbled for the radio any more
        clearFallbackPlayTimer();
        state.pendingPlay = false;
        stopPolling();
    }
    window.Repaint();
}

/**
 * foobar callback: playback stopped. Resets state and stops polling
 * (ignored when reason == 2, i.e. starting another track).
 * @param {number} reason
 */
function on_playback_stop(reason) {
    if (reason !== 2) {
        clearFallbackPlayTimer();
        state.pendingPlay = false;
        stopPolling();
        window.Repaint();
    }
}

/**
 * Scrolls the history list by SCROLL_STEP_ROWS rows; closes the feed menu if open.
 * @param {number} step - positive: up, negative: down
 */
function on_mouse_wheel(step) {
    if (state.feedMenuOpen) {
        state.feedMenuOpen = false;
        window.Repaint();
        return;
    }
    if (getHistoryView().length === 0) return;
    const maxOff = getMaxScrollOffset();
    if (maxOff <= 0) return;

    const prev = state.scrollOffset;
    if (step > 0) {
        state.scrollOffset = Math.max(0, state.scrollOffset - SCROLL_STEP_ROWS);
    } else if (step < 0) {
        state.scrollOffset = Math.min(maxOff, state.scrollOffset + SCROLL_STEP_ROWS);
    }

    if (state.scrollOffset !== prev) {
        state.hoveredTarget = null;
        window.Repaint();
    }
}

/**
 * Tracks which clickable element is hovered and repaints when it changes.
 * @param {number} x
 * @param {number} y
 */
function on_mouse_move(x, y) {
    if (state.searchDragging) {
        searchDragTo(x);
        return;
    }
    searchUpdateCursor(x, y);

    const hit = findHitTarget(x, y);
    const nextKey = hit ? hit.key : null;
    const prevKey = state.hoveredTarget ? state.hoveredTarget.key : null;

    if (nextKey !== prevKey) {
        state.hoveredTarget = hit;
        window.Repaint();
    }
}

/**
 * Clears the hover state when the mouse leaves the panel.
 */
function on_mouse_leave() {
    if (state.searchIbeam) {
        state.searchIbeam = false;
        try {
            window.SetCursor(32512);
        } catch (e) {}
    }
    if (state.hoveredTarget !== null) {
        state.hoveredTarget = null;
        window.Repaint();
    }
}

/**
 * Handles left clicks: feed menu, feed button, Play/Stop, Discogs button, Last.fm button,
 * Clear button, then clickable text fields (copy to clipboard) and history index (Discogs).
 * @param {number} x
 * @param {number} y
 */
function on_mouse_lbtn_up(x, y) {
    if (state.searchDragging) { // end of a drag selection started in the search box
        state.searchDragging = false;
        return;
    }
    if (searchRect.visible && pointInRect(x, y, searchRect)) {
        return; // handled by on_mouse_lbtn_down / on_mouse_lbtn_dblclk
    }
    if (state.searchFocused) {
        state.searchFocused = false;
        window.Repaint();
    }

    if (state.feedMenuOpen) {
        for (let i = 0; i < FEED_OPTIONS.length; i++) {
            const optRect = {
                x: feedMenuRect.x,
                y: feedMenuRect.y + i * 24,
                w: feedMenuRect.w,
                h: 24
            };
            if (pointInRect(x, y, optRect)) {
                selectFeed(FEED_OPTIONS[i].id);
                return;
            }
        }
        state.feedMenuOpen = false;
        window.Repaint();
        if (!pointInRect(x, y, feedBtnRect)) {
            return;
        }
    }

    if (feedBtnRect.visible && pointInRect(x, y, feedBtnRect)) {
        state.feedMenuOpen = !state.feedMenuOpen;
        window.Repaint();
        return;
    }

    if (pointInRect(x, y, btnRect)) {
        if (isMellotronPlaying() || state.pendingPlay) {
            stopRadioStream();
        } else {
            startRadioStream();
        }
        return;
    }

    if (discogsBtnRect.visible && pointInRect(x, y, discogsBtnRect)) {
        openDiscogsSearch({
            artist: state.artist,
            title: state.title,
            album: state.album
        });
        return;
    }

    if (lfmBtnRect.visible && pointInRect(x, y, lfmBtnRect)) {
        lfmButtonClick();
        return;
    }
	
    if (clearBtnRect.visible && pointInRect(x, y, clearBtnRect)) {
        clearHistory();
        return;
    }

    const hit = findHitTarget(x, y);
    if (!hit) return;

    if (hit.type === "discogs") {
        openDiscogsSearch(hit.item);
    } else if (hit.value) {
        showCopiedNotice(hit.label, hit.value);
    }
}

/**
 * Draws the whole panel: header (cover/logo, artist, title, album, notice, Play/Stop and Discogs buttons),
 * the scrollable "Last played" table, the feed selector, the footer buttons (Clear, Last.fm) and the
 * feed dropdown. Rebuilds the hitTargets list on every call.
 * @param {GdiGraphics} gr
 */
function on_paint(gr) {
    const ww = window.Width;
    const wh = window.Height;
    const pad = 10;
    const btnPad = 6;

    hitTargets = [];
	lfmBtnRect.visible = false;
    searchRect.visible = false;
    discogsBtnRect.visible = false;
    feedBtnRect.visible = false;
    feedMenuRect.visible = false;
    clearBtnRect.visible = false;
    gr.FillSolidRect(0, 0, ww, wh, 0xFF181818);

    // --- Top Now Playing Header ---
    const playing = isMellotronPlaying();
    const hasArt = (playing || fb.IsPlaying) && state.coverImg;
    const headerH = Math.min(HEADER_HEIGHT, wh);
    const artSize = Math.max(0, headerH - pad * 2);

    if (hasArt && artSize > 10) {
        gr.DrawImage(
            state.coverImg,
            pad, pad, artSize, artSize,
            0, 0, state.coverImg.Width, state.coverImg.Height
        );
    } else if (artSize > 10) {
        drawRadioLogo(gr, pad, pad, artSize);
    }

    const canSearchCurrentDiscogs = playing && !isPlaceholderTrack(state.artist, state.title);
    const showBtn = ww > artSize + pad * 2 + btnRect.w + 24;
    const showHeaderDiscogs = showBtn && canSearchCurrentDiscogs && headerH >= (btnRect.h + discogsBtnRect.h + 14);
    const stackH = showHeaderDiscogs ? (btnRect.h + 4 + discogsBtnRect.h) : btnRect.h;

    btnRect.x = showBtn ? (ww - btnPad - btnRect.w) : (ww - btnPad);
    btnRect.y = Math.round((headerH - stackH) / 2);

    if (showHeaderDiscogs) {
        discogsBtnRect.x = btnRect.x;
        discogsBtnRect.y = btnRect.y + btnRect.h + 4;
        discogsBtnRect.visible = true;
    }

    const textX = pad + artSize + pad;
    const rightLimit = showBtn ? (btnRect.x - btnPad) : (ww - pad);
    const textW = Math.max(0, rightLimit - textX);
    const hoveredKey = state.hoveredTarget ? state.hoveredTarget.key : null;

    if (textW > 20) {
        const hasAlbum = state.album.length > 0;
        const hasNotice = state.copiedNotice.length > 0;
        const lineH = 19;
        const linesCount = (hasAlbum ? 3 : 2) + (hasNotice ? 1 : 0);
        const totalTextH = lineH * linesCount;
        let currentY = Math.max(pad, Math.round((headerH - totalTextH) / 2));

        // 1. Artist
        const artistRect = { x: textX, y: currentY, w: textW, h: lineH };
        hitTargets.push({ rect: artistRect, type: "field", key: "field:artist", value: state.artist, label: "Artist" });
        if (hoveredKey === "field:artist") {
            gr.FillSolidRect(textX - 2, currentY, textW + 4, lineH, 0xFF2A2A2A);
        }
        gr.GdiDrawText(
            state.artist,
            fontArtist,
            hoveredKey === "field:artist" ? 0xFF90CAF9 : 0xFFFFFFFF,
            textX, currentY, textW, lineH,
            FLAGS_LEFT_ELLIPSIS
        );
        currentY += lineH;

        // 2. Title
        const titleRect = { x: textX, y: currentY, w: textW, h: lineH };
        hitTargets.push({ rect: titleRect, type: "field", key: "field:title", value: state.title, label: "Title" });
        if (hoveredKey === "field:title") {
            gr.FillSolidRect(textX - 2, currentY, textW + 4, lineH, 0xFF2A2A2A);
        }
        gr.GdiDrawText(
            state.title,
            fontTitle,
            hoveredKey === "field:title" ? 0xFF90CAF9 : 0xFFD0D0D0,
            textX, currentY, textW, lineH,
            FLAGS_LEFT_ELLIPSIS
        );
        currentY += lineH;

        // 3. Album
        if (hasAlbum) {
            const albumRect = { x: textX, y: currentY, w: textW, h: lineH };
            hitTargets.push({ rect: albumRect, type: "field", key: "field:album", value: state.album, label: "Album" });
            if (hoveredKey === "field:album") {
                gr.FillSolidRect(textX - 2, currentY, textW + 4, lineH, 0xFF2A2A2A);
            }
            gr.GdiDrawText(
                state.album,
                fontAlbum,
                hoveredKey === "field:album" ? 0xFF90CAF9 : 0xFF888888,
                textX, currentY, textW, lineH,
                FLAGS_LEFT_ELLIPSIS
            );
            currentY += lineH;
        }

        // 4. Copy / status notification
        if (hasNotice) {
            gr.GdiDrawText(
                state.copiedNotice,
                fontNotice,
                0xFF81C784,
                textX, currentY, textW, lineH,
                FLAGS_LEFT_ELLIPSIS
            );
        }
    }

    if (showBtn) {
        const btnColor = playing ? 0xFF8B2635 : 0xFF2E6F40;
        const label = state.pendingPlay ? "..." : (playing ? "Stop" : "Play");
        gr.FillSolidRect(btnRect.x, btnRect.y, btnRect.w, btnRect.h, btnColor);
        gr.DrawRect(btnRect.x, btnRect.y, btnRect.w, btnRect.h, 1, 0xFF555555);
        gr.GdiDrawText(
            label,
            fontBtn,
            0xFFFFFFFF,
            btnRect.x + 2, btnRect.y, btnRect.w - 4, btnRect.h,
            FLAGS_BTN
        );
    }

    if (showHeaderDiscogs) {
        const headerDiscogsKey = "action:header_discogs";
        hitTargets.push({
            rect: { x: discogsBtnRect.x, y: discogsBtnRect.y, w: discogsBtnRect.w, h: discogsBtnRect.h },
            type: "discogs",
            key: headerDiscogsKey,
            item: { artist: state.artist, title: state.title, album: state.album },
            label: "Discogs"
        });
        const isDiscogsHover = (hoveredKey === headerDiscogsKey);
        gr.FillSolidRect(
            discogsBtnRect.x,
            discogsBtnRect.y,
            discogsBtnRect.w,
            discogsBtnRect.h,
            isDiscogsHover ? 0xFF3A2D1E : 0xFF232323
        );
        gr.DrawRect(
            discogsBtnRect.x,
            discogsBtnRect.y,
            discogsBtnRect.w,
            discogsBtnRect.h,
            1,
            isDiscogsHover ? 0xFF9A6B2F : 0xFF444444
        );
        gr.GdiDrawText(
            "Discogs",
            fontDiscogsBtn,
            isDiscogsHover ? 0xFFFFCC80 : 0xFFD0D0D0,
            discogsBtnRect.x + 1,
            discogsBtnRect.y,
            discogsBtnRect.w - 2,
            discogsBtnRect.h,
            FLAGS_BTN
        );
    }

    // --- Scrollable History Table Below ---
    const tableTop = headerH + 4;
    if (wh > tableTop + 28 && ww > pad * 2) {
        gr.FillSolidRect(pad, tableTop, ww - pad * 2, 1, 0xFF2C2C2C);

        const secY = tableTop + 6;
        const listY = secY + 22;		
		const showFooter = wh > listY + clearBtnRect.h + 10;
		const showClearBtn = showFooter && state.history.length > 0;
		const footerReserve = showFooter ? (clearBtnRect.h + 6) : 0;
        const availH = Math.max(0, wh - listY - pad - footerReserve);
        const maxVisibleRows = Math.max(0, Math.floor(availH / HIST_ROW_H));
        const listW = ww - pad * 2;

        histListRect = {
            x: pad,
            y: listY,
            w: listW,
            h: availH,
            visibleRows: maxVisibleRows
        };

        clampScrollOffset(maxVisibleRows);

        const view = getHistoryView();
        const searching = isSearching();
        const maxOff = getMaxScrollOffset(maxVisibleRows);
        const rangeLabel = (view.length > 0 && maxOff > 0)
            ? ("  [" + (state.scrollOffset + 1) + "-" + Math.min(view.length, state.scrollOffset + Math.max(1, maxVisibleRows)) + "]")
            : "";

        const headerText = (searching
            ? "MATCHES (" + view.length + "/" + state.history.length + ")"
            : "LAST PLAYED (" + state.history.length + "/" + MAX_HISTORY + ")") + rangeLabel;
        const headerTextW = Math.min(listW, measureTextWidth(gr, headerText, fontSecHeader));

        gr.GdiDrawText(
            headerText,
            fontSecHeader,
            0xFF9E9E9E,
            pad, secY, headerTextW, 18,
            FLAGS_LEFT_ELLIPSIS
        );

        // Minimal width feed selector button on right side of section header
        const activeFeed = getSelectedFeedOption();
        const feedBtnLabel = activeFeed.label + (state.feedMenuOpen ? " \u25B2" : " \u25BC");
        const feedDesiredW = measureTextWidth(gr, feedBtnLabel, fontFeedBtn) + 14;
        const feedAvailW = (ww - pad) - (pad + headerTextW + 8);
        if (feedAvailW >= 40) {
            feedBtnRect.w = Math.min(feedDesiredW, feedAvailW);
            feedBtnRect.h = 19;
            feedBtnRect.x = ww - pad - feedBtnRect.w;
            feedBtnRect.y = secY;
            feedBtnRect.visible = true;

            const feedKey = "action:feed_select";
            hitTargets.push({
                rect: { x: feedBtnRect.x, y: feedBtnRect.y, w: feedBtnRect.w, h: feedBtnRect.h },
                type: "action",
                key: feedKey,
                value: "",
                label: "Feed"
            });

            const isFeedHover = (hoveredKey === feedKey);
            gr.FillSolidRect(
                feedBtnRect.x,
                feedBtnRect.y,
                feedBtnRect.w,
                feedBtnRect.h,
                state.feedMenuOpen ? 0xFF2B3540 : (isFeedHover ? 0xFF282828 : 0xFF202020)
            );
            gr.DrawRect(
                feedBtnRect.x,
                feedBtnRect.y,
                feedBtnRect.w,
                feedBtnRect.h,
                1,
                state.feedMenuOpen ? 0xFF64B5F6 : (isFeedHover ? 0xFF555555 : 0xFF3A3A3A)
            );
            gr.GdiDrawText(
                feedBtnLabel,
                fontFeedBtn,
                isFeedHover || state.feedMenuOpen ? 0xFF90CAF9 : 0xFFCCCCCC,
                feedBtnRect.x + 6,
                feedBtnRect.y,
                feedBtnRect.w - 12,
                feedBtnRect.h,
                FLAGS_LEFT_ELLIPSIS
            );
        }

        if (view.length === 0) {
            gr.GdiDrawText(
                searching ? "No matching tracks." : "No tracks recorded yet.",
                fontHistSub,
                0xFF6E6E6E,
                pad, listY + 4, listW, 20,
                FLAGS_LEFT_ELLIPSIS
            );
        } else if (maxVisibleRows > 0) {
            const hasScrollbar = view.length > maxVisibleRows;
            const sbW = hasScrollbar ? 6 : 0;
            const contentW = hasScrollbar ? Math.max(40, listW - sbW - 4) : listW;

            const startIdx = state.scrollOffset;
            const endIdx = Math.min(view.length, startIdx + maxVisibleRows);

            for (let idx = startIdx; idx < endIdx; idx++) {
                const rowSlot = idx - startIdx;
                const item = view[idx];
                const ry = listY + rowSlot * HIST_ROW_H;
                const rowRect = { x: pad, y: ry, w: contentW, h: HIST_ROW_H };

                const bgCol = (idx % 2 === 0 ? 0xFF1E1E1E : 0xFF181818);
                gr.FillSolidRect(rowRect.x, rowRect.y, rowRect.w, rowRect.h, bgCol);

                const idxW = THUMB_SIZE;
                const idxKey = "hist:" + idx + ":discogs";
                const idxRect = { x: rowRect.x + 2, y: ry + Math.floor((HIST_ROW_H - THUMB_SIZE) / 2), w: THUMB_SIZE, h: THUMB_SIZE };
                hitTargets.push({
                    rect: idxRect,
                    type: "discogs",
                    key: idxKey,
                    item: item,
                    label: "Discogs"
                });

                const isIdxHov = (hoveredKey === idxKey);
                const thumb = getThumb(item.cover);
                if (thumb) {
                    gr.DrawImage(thumb, idxRect.x, idxRect.y, idxRect.w, idxRect.h, 0, 0, thumb.Width, thumb.Height);
                } else {
                    // no cover (yet): the radio logo, resized to the thumbnail size
                    const logo = getLogoImage(THUMB_SIZE);
                    if (logo) {
                        gr.DrawImage(logo, idxRect.x, idxRect.y, idxRect.w, idxRect.h, 0, 0, logo.Width, logo.Height);
                    } else {
                        gr.FillSolidRect(idxRect.x, idxRect.y, idxRect.w, idxRect.h, 0xFF262626);
                    }
                }
                if (isIdxHov) {
                    gr.DrawRect(idxRect.x + 1, idxRect.y + 1, idxRect.w - 3, idxRect.h - 3, 2, 0xFFFFCC80);
                }

                const timeX = rowRect.x + 4 + idxW + 2;
                const timeW = 40;
                gr.GdiDrawText(
                    item.timeStr,
                    fontHistSub,
                    0xFF757575,
                    timeX, ry, timeW, HIST_ROW_H,
                    FLAGS_LEFT_ELLIPSIS
                );

                let cursorX = timeX + timeW + 4;
                const rightEdge = rowRect.x + rowRect.w - 4;

                // 1. Artist segment + " - " separator
                if (item.artist && cursorX < rightEdge - 8) {
                    const artistKey = "hist:" + idx + ":artist";
                    const artistTextW = measureTextWidth(gr, item.artist, fontHistMain);
                    const sepText = " - ";
                    const sepW = measureTextWidth(gr, sepText, fontHistSub);
                    const availArtistW = Math.max(0, rightEdge - cursorX - (item.title ? sepW + 12 : 0));
                    const drawArtistW = Math.min(artistTextW, availArtistW);

                    if (drawArtistW > 0) {
                        const segRect = { x: cursorX, y: ry + 2, w: drawArtistW, h: HIST_ROW_H - 4 };
                        hitTargets.push({
                            rect: segRect,
                            type: "history_field",
                            key: artistKey,
                            value: item.artist,
                            label: "Artist"
                        });

                        const isHov = (hoveredKey === artistKey);
                        if (isHov) {
                            gr.FillSolidRect(segRect.x - 1, segRect.y, segRect.w + 2, segRect.h, 0xFF2B3540);
                        }
                        gr.GdiDrawText(
                            item.artist,
                            fontHistMain,
                            isHov ? 0xFF90CAF9 : 0xFFE6E6E6,
                            cursorX, ry, drawArtistW, HIST_ROW_H,
                            FLAGS_LEFT_ELLIPSIS
                        );
                        cursorX += drawArtistW;

                        if (item.title && cursorX + sepW < rightEdge - 6) {
                            gr.GdiDrawText(
                                sepText,
                                fontHistSub,
                                0xFF707070,
                                cursorX, ry, sepW, HIST_ROW_H,
                                FLAGS_LEFT_ELLIPSIS
                            );
                            cursorX += sepW;
                        }
                    }
                }

                // 2. Title segment
                if (item.title && cursorX < rightEdge - 8) {
                    const titleKey = "hist:" + idx + ":title";
                    const titleTextW = measureTextWidth(gr, item.title, fontHistMain);
                    const albumSepText = item.album ? " - " : "";
                    const albumSepW = item.album ? measureTextWidth(gr, albumSepText, fontHistSub) : 0;
                    const reserveForAlbum = item.album ? (albumSepW + Math.min(60, measureTextWidth(gr, item.album, fontHistSub))) : 0;
                    const availTitleW = Math.max(12, rightEdge - cursorX - reserveForAlbum);
                    const drawTitleW = Math.min(titleTextW, availTitleW);

                    const segRect = { x: cursorX, y: ry + 2, w: drawTitleW, h: HIST_ROW_H - 4 };
                    hitTargets.push({
                        rect: segRect,
                        type: "history_field",
                        key: titleKey,
                        value: item.title,
                        label: "Title"
                    });

                    const isHov = (hoveredKey === titleKey);
                    if (isHov) {
                        gr.FillSolidRect(segRect.x - 1, segRect.y, segRect.w + 2, segRect.h, 0xFF2B3540);
                    }
                    gr.GdiDrawText(
                        item.title,
                        fontHistMain,
                        isHov ? 0xFF90CAF9 : 0xFFC8C8C8,
                        cursorX, ry, drawTitleW, HIST_ROW_H,
                        FLAGS_LEFT_ELLIPSIS
                    );
                    cursorX += drawTitleW;

                    if (item.album && cursorX + albumSepW < rightEdge - 6) {
                        gr.GdiDrawText(
                            albumSepText,
                            fontHistSub,
                            0xFF707070,
                            cursorX, ry, albumSepW, HIST_ROW_H,
                            FLAGS_LEFT_ELLIPSIS
                        );
                        cursorX += albumSepW;
                    }
                }

                // 3. Album segment
                if (item.album && cursorX < rightEdge - 6) {
                    const albumKey = "hist:" + idx + ":album";
                    const albumTextW = measureTextWidth(gr, item.album, fontHistSub);
                    const availAlbumW = Math.max(10, rightEdge - cursorX);
                    const drawAlbumW = Math.min(albumTextW, availAlbumW);

                    const segRect = { x: cursorX, y: ry + 2, w: drawAlbumW, h: HIST_ROW_H - 4 };
                    hitTargets.push({
                        rect: segRect,
                        type: "history_field",
                        key: albumKey,
                        value: item.album,
                        label: "Album"
                    });

                    const isHov = (hoveredKey === albumKey);
                    if (isHov) {
                        gr.FillSolidRect(segRect.x - 1, segRect.y, segRect.w + 2, segRect.h, 0xFF2B3540);
                    }
                    gr.GdiDrawText(
                        item.album,
                        fontHistSub,
                        isHov ? 0xFF90CAF9 : 0xFF8C8C8C,
                        cursorX, ry, drawAlbumW, HIST_ROW_H,
                        FLAGS_LEFT_ELLIPSIS
                    );
                }
            }

            if (hasScrollbar) {
                const trackH = maxVisibleRows * HIST_ROW_H;
                const sbX = pad + listW - sbW;
                const sbY = listY;
                gr.FillSolidRect(sbX, sbY, sbW, trackH, 0xFF222222);

                const ratio = maxVisibleRows / view.length;
                const thumbH = Math.max(18, Math.round(trackH * ratio));
                const currentMaxOff = getMaxScrollOffset(maxVisibleRows);
                const scrollFrac = currentMaxOff > 0 ? (state.scrollOffset / currentMaxOff) : 0;
                const thumbY = sbY + Math.round((trackH - thumbH) * scrollFrac);

                gr.FillSolidRect(sbX + 1, thumbY, sbW - 2, thumbH, 0xFF5A5A5A);
            }
        }

        // --- Bottom-Left Clear History Button ---
        if (showClearBtn) {
            clearBtnRect.x = pad;
            clearBtnRect.y = wh - pad - clearBtnRect.h;
            clearBtnRect.visible = true;

            const clearKey = "action:clear_history";
            hitTargets.push({
                rect: { x: clearBtnRect.x, y: clearBtnRect.y, w: clearBtnRect.w, h: clearBtnRect.h },
                type: "action",
                key: clearKey,
                value: "",
                label: "Clear"
            });

            const isClearHover = (hoveredKey === clearKey);
            gr.FillSolidRect(
                clearBtnRect.x,
                clearBtnRect.y,
                clearBtnRect.w,
                clearBtnRect.h,
                isClearHover ? 0xFF3A2428 : 0xFF222222
            );
            gr.DrawRect(
                clearBtnRect.x,
                clearBtnRect.y,
                clearBtnRect.w,
                clearBtnRect.h,
                1,
                isClearHover ? 0xFF8B3A44 : 0xFF3A3A3A
            );
            gr.GdiDrawText(
                "Clear",
                fontClearBtn,
                isClearHover ? 0xFFFF9E9E : 0xFFB0B0B0,
                clearBtnRect.x,
                clearBtnRect.y,
                clearBtnRect.w,
                clearBtnRect.h,
                FLAGS_BTN
            );
        }

        if (showFooter) {
            lfmDrawButton(gr, showClearBtn ? clearBtnRect.x + clearBtnRect.w + 8 : pad, wh - pad - 20, hoveredKey);
            const searchX = lfmBtnRect.x + lfmBtnRect.w + 8;
            drawSearchBox(gr, searchX, wh - pad - 20, ww - pad - searchX, 20);
        }
		
        // --- Open Feed Selector Dropdown Menu (drawn on top) ---
        if (state.feedMenuOpen && feedBtnRect.visible) {
            let maxOptTextW = 0;
            for (let i = 0; i < FEED_OPTIONS.length; i++) {
                const w = measureTextWidth(gr, "\u2713 " + FEED_OPTIONS[i].label, fontFeedBtn);
                if (w > maxOptTextW) maxOptTextW = w;
            }
            const menuW = Math.min(ww - pad * 2, Math.max(feedBtnRect.w, maxOptTextW + 18));
            const itemH = 24;
            const menuH = FEED_OPTIONS.length * itemH;
            feedMenuRect.w = menuW;
            feedMenuRect.h = menuH;
            feedMenuRect.x = Math.max(pad, Math.min(ww - pad - menuW, feedBtnRect.x + feedBtnRect.w - menuW));
            feedMenuRect.y = feedBtnRect.y + feedBtnRect.h + 2;
            feedMenuRect.visible = true;

            gr.FillSolidRect(feedMenuRect.x, feedMenuRect.y, feedMenuRect.w, feedMenuRect.h, 0xFF1F1F1F);
            gr.DrawRect(feedMenuRect.x, feedMenuRect.y, feedMenuRect.w, feedMenuRect.h, 1, 0xFF555555);

            for (let i = 0; i < FEED_OPTIONS.length; i++) {
                const opt = FEED_OPTIONS[i];
                const oy = feedMenuRect.y + i * itemH;
                const optRect = { x: feedMenuRect.x, y: oy, w: feedMenuRect.w, h: itemH };
                const optKey = "action:feed_opt_" + opt.id;
                hitTargets.push({
                    rect: optRect,
                    type: "action",
                    key: optKey,
                    value: "",
                    label: opt.label
                });

                const isSelected = (opt.id === state.selectedFeedId);
                const isOptHover = (hoveredKey === optKey);
                if (isOptHover || isSelected) {
                    gr.FillSolidRect(
                        optRect.x + 1,
                        optRect.y + 1,
                        optRect.w - 2,
                        optRect.h - 2,
                        isOptHover ? 0xFF2B3540 : 0xFF252A30
                    );
                }

                const prefix = isSelected ? "\u2713 " : "  ";
                gr.GdiDrawText(
                    prefix + opt.label,
                    fontFeedBtn,
                    isSelected || isOptHover ? 0xFF90CAF9 : 0xFFD8D8D8,
                    optRect.x + 6,
                    optRect.y,
                    optRect.w - 12,
                    optRect.h,
                    FLAGS_LEFT_ELLIPSIS
                );
            }
        }
    }
}

/**
 * foobar callback: the panel is being closed or reloaded. Cancels timers and saves history and Last.fm state.
 */
function on_script_unload() {	
	lfmReset();
	lfmSave();
	
    clearFallbackPlayTimer();
    if (pollTimer) {
        window.ClearInterval(pollTimer);
        pollTimer = null;
    }
    if (noticeTimer) {
        window.ClearTimeout(noticeTimer);
        noticeTimer = null;
    }
    saveHistory();
    clearCover();
}

state.history = loadHistory();
cleanupThumbs();
requestKeyboardInput();
lfmLoad();
if (isMellotronPlaying()) {
    startPolling();
}
