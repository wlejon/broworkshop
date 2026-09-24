// startup.js — makes bro.json's window keys explorable at runtime.
//
// borderless / alwaysOnTop / minWidth / minHeight / maxWidth / maxHeight /
// windowX / windowY / display are parsed ONCE, at engine construction. You
// cannot poke them from a console; the only way to see one take effect is to
// edit a file and relaunch. This panel closes that loop from both ends:
//
//   Declared vs live   The app's own bro.json (fetched over /app) beside what
//                      bro.window reports RIGHT NOW. Change something in the
//                      host panel and a row drifts: these keys are defaults,
//                      not bindings.
//   Snippet generator  Arrange the window with the live controls, then get the
//                      bro.json that would launch it that way.
//   Pinned card        A second app (pinned/) whose OWN bro.json declares
//                      borderless, alwaysOnTop and limits, opened with a bare
//                      bro.window.open('pinned'). Whatever it reports back can
//                      only have come from its manifest.

import { h, clear } from "/lib/kit/index.js";
import { logSys } from "/app/windows.js";

/** This app's parsed bro.json, once the fetch lands. */
export const manifest = { loaded: false, keys: null, raw: '' };

/** The pinned card's manifest and the state it reported from its realm. */
export const pinned = { manifest: null, reported: null, win: null, open: false };

const WINDOW_KEYS = [
    'title', 'width', 'height', 'borderless', 'alwaysOnTop',
    'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'windowX', 'windowY', 'display',
];

/**
 * Everything bro.window (plus the DOM) reports now, keyed by the bro.json
 * name of the same thing. The one source for both the table and the snippet.
 */
export function liveWindowKeys() {
    const min = bro.window.getMinSize(), max = bro.window.getMaxSize(), pos = bro.window.getPosition();
    const displays = bro.window.getDisplays();
    // bro.json's "display" is an INDEX into the display list, not an SDL id.
    let idx = displays.findIndex((d) => d.isCurrent);
    if (idx < 0) idx = displays.findIndex((d) => d.isPrimary);
    return {
        title: document.title,
        width: window.innerWidth, height: window.innerHeight,
        borderless: bro.window.borderless, alwaysOnTop: bro.window.alwaysOnTop,
        minWidth: min.width, minHeight: min.height, maxWidth: max.width, maxHeight: max.height,
        windowX: pos.x, windowY: pos.y,
        display: idx < 0 ? 0 : idx,
    };
}

const fmt = (v) => (v === undefined ? '—' : String(v));

function keyTable(target, head, rows) {
    const t = clear(document.getElementById(target));
    t.appendChild(h('div.krow.khead', null, head.map((c) => h('span', null, c))));
    for (const r of rows) {
        t.appendChild(h('div.krow', null, h('span', null, r.key), h('span', null, fmt(r.declared)),
            h('span', null, fmt(r.live)), h('span', { class: r.cls }, r.verdict)));
    }
    return rows;
}

/**
 * Unconstrained limits read back as 0, the same as an omitted key, so those
 * are not drift (otherwise every app without limits shows four false alarms).
 */
function verdict(key, declared, live) {
    if (declared === undefined) {
        return /^(min|max)(Width|Height)$/.test(key) && live === 0 ? ['—', 'dim'] : ['not declared', 'dim'];
    }
    return declared === live ? ['match', 'ok'] : ['drifted', 'warn'];
}

export function refreshStartupTable() {
    if (!manifest.loaded) return null;
    const live = liveWindowKeys();
    return keyTable('startupTable', ['bro.json key', 'declared', 'live now', ''], WINDOW_KEYS.map((key) => {
        const declared = manifest.keys[key];
        const [word, cls] = verdict(key, declared, live[key]);
        return { key, declared, live: live[key], verdict: word, cls };
    }));
}

/**
 * The bro.json this window's CURRENT shape would need at launch. Defaults are
 * omitted (a manifest full of `"maxWidth": 0` is noise); position and display
 * only on request (a hard-coded position is a bad default on another monitor
 * layout); keys this panel does not own are carried through, so the output is
 * a drop-in replacement.
 */
export function buildSnippet(opts) {
    const o = opts || {};
    const live = liveWindowKeys();
    const out = {
        app: manifest.keys && manifest.keys.app ? manifest.keys.app : '.',
        title: live.title, width: live.width, height: live.height,
    };
    if (live.borderless) out.borderless = true;
    if (live.alwaysOnTop) out.alwaysOnTop = true;
    for (const k of ['minWidth', 'minHeight', 'maxWidth', 'maxHeight']) if (live[k] > 0) out[k] = live[k];
    if (o.includePosition) {
        out.windowX = live.windowX;
        out.windowY = live.windowY;
        if (live.display > 0) out.display = live.display;
    }
    if (manifest.keys) {
        for (const k of Object.keys(manifest.keys)) {
            if (!WINDOW_KEYS.includes(k) && k !== 'app') out[k] = manifest.keys[k];
        }
    }
    return out;
}

export function refreshSnippet(opts) {
    const text = JSON.stringify(buildSnippet(opts), null, 4);
    document.getElementById('startupSnippet').textContent = text;
    return text;
}

// --- the pinned card ---------------------------------------------------------

export function openPinned() {
    if (pinned.open) return pinned.win;
    // No options at all: everything about this window must come from pinned/bro.json.
    const win = bro.window.open('pinned');
    pinned.win = win;
    pinned.open = true;
    win.addEventListener('load', () => {
        logSys(`pinned card opened from its own manifest (id ${win.id})`);
        refreshPinnedTable();
    });
    win.addEventListener('message', (ev) => {
        if (ev.data && ev.data.type === 'pinnedState') {
            pinned.reported = ev.data;
            refreshPinnedTable();
        }
    });
    win.addEventListener('close', () => {
        pinned.open = false;
        pinned.reported = null;
        refreshPinnedTable();
    });
    return win;
}

export function closePinned() { if (pinned.win) pinned.win.close(); }

/** Ask the card to re-read its own window state and post it back. */
export function pollPinned() {
    if (pinned.open && pinned.win) pinned.win.postMessage({ type: 'reportState' });
}

export function refreshPinnedTable() {
    const note = document.getElementById('pinnedNote');
    clear(document.getElementById('pinnedTable'));
    if (!pinned.manifest) { note.textContent = 'pinned/bro.json not read yet.'; return null; }
    if (!pinned.reported) {
        note.textContent = pinned.open ? 'Card is open — waiting for its first report.'
            : 'Open the card to compare its manifest against its real window.';
        return null;
    }
    note.textContent = 'Opened with a bare bro.window.open("pinned"): no options passed, so every ' +
        'live value below came from that app\'s own manifest.';
    const rows = [];
    for (const key of WINDOW_KEYS) {
        const declared = pinned.manifest[key];
        if (declared === undefined) continue;
        const live = pinned.reported[key];
        // Documented: a child manifest's placement keys are ignored; where an
        // opened window goes is the opener's call.
        const [word, cls] = key === 'windowX' || key === 'windowY' ? ['ignored by design', 'dim']
            : declared === live ? ['match', 'ok'] : ['differs', 'warn'];
        rows.push({ key, declared, live, verdict: word, cls });
    }
    return keyTable('pinnedTable', ['pinned/bro.json', 'declared', 'live in its realm', ''], rows);
}

// --- wiring ------------------------------------------------------------------

/**
 * Read both manifests off the /app mount. There is no runtime accessor for
 * the parsed manifest, so the file is the only source of the declared side,
 * which is honest anyway: it is the file we are making claims about.
 */
export async function loadManifests() {
    try {
        manifest.raw = await (await fetch('/app/bro.json')).text();
        manifest.keys = JSON.parse(manifest.raw);
        manifest.loaded = true;
        refreshStartupTable();
        refreshSnippet();
    } catch (e) {
        document.getElementById('startupTable').textContent = 'could not read /app/bro.json: ' + e;
    }
    try {
        pinned.manifest = JSON.parse(await (await fetch('/app/pinned/bro.json')).text());
        refreshPinnedTable();
    } catch (e) {
        document.getElementById('pinnedNote').textContent = 'could not read /app/pinned/bro.json: ' + e;
    }
    return manifest;
}

export function bindStartupPanel() {
    const posBox = document.getElementById('snipPos');
    const regen = () => refreshSnippet({ includePosition: posBox.checked });
    document.getElementById('genSnippet').addEventListener('click', () => {
        regen();
        logSys('generated a bro.json from the live window state');
    });
    posBox.addEventListener('change', regen);
    document.getElementById('refreshStartup').addEventListener('click', () => { refreshStartupTable(); regen(); });
    document.getElementById('openPinned').addEventListener('click', openPinned);
    document.getElementById('pollPinned').addEventListener('click', pollPinned);
    document.getElementById('closePinned').addEventListener('click', closePinned);
    loadManifests();
}
