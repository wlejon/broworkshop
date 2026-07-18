// startup.js — makes bro.json's window keys explorable at runtime.
//
// The manifest keys borderless / alwaysOnTop / minWidth / minHeight / maxWidth /
// maxHeight / windowX / windowY / display are parsed ONCE, at engine
// construction, and then never looked at again. That makes them the least
// testable surface in the whole window API: you cannot poke them from a
// console, and the only way to see one take effect is to edit a file and
// relaunch.
//
// This panel closes that loop from both ends.
//
//   Declared vs live   The app's own bro.json is fetched over the /app mount
//                      and put side by side with what bro.window reports RIGHT
//                      NOW. Every row is therefore a real comparison between a
//                      launch-time declaration and runtime truth, and drift
//                      shows up the moment you change something in the host
//                      panel — which is exactly the mental model these keys
//                      need, because they are defaults, not bindings.
//
//   Snippet generator  The reverse direction: arrange the window the way you
//                      want it with the live controls, press one button, and
//                      get the bro.json that would launch it that way. "Save my
//                      current window setup as startup defaults", which is what
//                      anyone actually wants from these keys.
//
//   Pinned card        A second app (pinned/) whose OWN bro.json declares
//                      borderless, alwaysOnTop and resize limits, opened with a
//                      bare bro.window.open('pinned') — no options. Whatever it
//                      reports back can only have come from its manifest.

import { logSys } from "/app/windows.js";

const tableEl = document.getElementById('startupTable');
const snippetEl = document.getElementById('startupSnippet');
const pinnedEl = document.getElementById('pinnedTable');
const pinnedNoteEl = document.getElementById('pinnedNote');

/** The parsed contents of this app's bro.json, once the fetch lands. */
export const manifest = { loaded: false, keys: null, raw: '' };

/** The pinned card's manifest and the state it reported back from its realm. */
export const pinned = { manifest: null, reported: null, win: null, open: false };

// Only the keys this panel is about. Order is the order they are rendered in.
const WINDOW_KEYS = [
    'title', 'width', 'height',
    'borderless', 'alwaysOnTop',
    'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
    'windowX', 'windowY', 'display',
];

// --- live state --------------------------------------------------------------

/**
 * Everything bro.window (plus the DOM) can tell us right now, keyed by the
 * bro.json name of the same thing. This is the object the snippet is generated
 * from and the right-hand column of the table is rendered from — one source, so
 * the two can never disagree.
 */
export function liveWindowKeys() {
    const min = bro.window.getMinSize();
    const max = bro.window.getMaxSize();
    const pos = bro.window.getPosition();
    const displays = bro.window.getDisplays();
    // bro.json's "display" is an INDEX into the display list, not an SDL id, so
    // resolve the current display back to its index rather than reporting d.id.
    let idx = displays.findIndex((d) => d.isCurrent);
    if (idx < 0) idx = displays.findIndex((d) => d.isPrimary);

    return {
        title: document.title,
        width: window.innerWidth,
        height: window.innerHeight,
        borderless: bro.window.borderless,
        alwaysOnTop: bro.window.alwaysOnTop,
        minWidth: min.width, minHeight: min.height,
        maxWidth: max.width, maxHeight: max.height,
        windowX: pos.x, windowY: pos.y,
        display: idx < 0 ? 0 : idx,
    };
}

// --- declared vs live --------------------------------------------------------

function fmt(v) {
    if (v === undefined) return '—';
    if (typeof v === 'boolean') return String(v);
    return String(v);
}

/**
 * A key "matches" when the declaration and the live value agree. Unconstrained
 * limits read back as 0, which is the same thing as an omitted key, so treat
 * those as equivalent rather than as drift — otherwise every app that declares
 * no limits shows four false mismatches.
 */
function verdict(key, declared, live) {
    const limitKey = /^(min|max)(Width|Height)$/.test(key);
    if (declared === undefined)
        return (limitKey && live === 0) ? ['—', 'muted'] : ['not declared', 'muted'];
    if (declared === live) return ['match', 'good'];
    return ['drifted', 'warn'];
}

export function refreshStartupTable() {
    if (!manifest.loaded) return null;
    const live = liveWindowKeys();
    const rows = [];

    tableEl.textContent = '';
    tableEl.appendChild(headerRow('bro.json key', 'declared', 'live now', ''));

    for (const key of WINDOW_KEYS) {
        const declared = manifest.keys[key];
        const now = live[key];
        const [word, cls] = verdict(key, declared, now);
        rows.push({ key, declared, live: now, verdict: word });
        tableEl.appendChild(dataRow(key, fmt(declared), fmt(now), word, cls));
    }
    return rows;
}

function headerRow(a, b, c, d) {
    const r = document.createElement('div');
    r.className = 'krow khead';
    for (const t of [a, b, c, d]) {
        const s = document.createElement('span');
        s.textContent = t;
        r.appendChild(s);
    }
    return r;
}

function dataRow(a, b, c, d, cls) {
    const r = document.createElement('div');
    r.className = 'krow';
    const cells = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
        const s = document.createElement('span');
        s.textContent = cells[i];
        if (i === 3 && cls) s.className = cls;
        r.appendChild(s);
    }
    return r;
}

// --- snippet generator -------------------------------------------------------

/**
 * Build the bro.json this window's CURRENT shape would need at launch.
 *
 * Deliberately omits anything at its default: a generated manifest full of
 * `"borderless": false` and `"maxWidth": 0` is noise, and the whole value of
 * the output is that it can be pasted over an existing file. `display` is only
 * emitted when the window is not on the primary display, and windowX/windowY
 * only when asked for, because a hard-coded position is a bad default on a
 * machine with a different monitor layout.
 */
export function buildSnippet(opts) {
    opts = opts || {};
    const live = liveWindowKeys();
    const out = {};

    out.app = manifest.keys && manifest.keys.app ? manifest.keys.app : '.';
    out.title = live.title;
    out.width = live.width;
    out.height = live.height;

    if (live.borderless) out.borderless = true;
    if (live.alwaysOnTop) out.alwaysOnTop = true;
    if (live.minWidth > 0) out.minWidth = live.minWidth;
    if (live.minHeight > 0) out.minHeight = live.minHeight;
    if (live.maxWidth > 0) out.maxWidth = live.maxWidth;
    if (live.maxHeight > 0) out.maxHeight = live.maxHeight;
    if (opts.includePosition) { out.windowX = live.windowX; out.windowY = live.windowY; }
    if (opts.includePosition && live.display > 0) out.display = live.display;

    // Preserve keys this panel does not own (lib mounts, custom app config) so
    // the snippet is a drop-in replacement rather than a lossy summary.
    if (manifest.keys) {
        for (const k of Object.keys(manifest.keys)) {
            if (WINDOW_KEYS.indexOf(k) >= 0 || k === 'app') continue;
            out[k] = manifest.keys[k];
        }
    }
    return out;
}

export function refreshSnippet(opts) {
    const obj = buildSnippet(opts);
    const text = JSON.stringify(obj, null, 4);
    snippetEl.textContent = text;
    return text;
}

// --- the pinned card ---------------------------------------------------------

export function openPinned() {
    if (pinned.open) return pinned.win;

    // No options whatsoever — everything about this window has to come from
    // pinned/bro.json, which is the point of the exercise.
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

export function closePinned() {
    if (pinned.win) pinned.win.close();
}

/** Ask the card to re-read its own window state and post it back. */
export function pollPinned() {
    if (pinned.open && pinned.win) pinned.win.postMessage({ type: 'reportState' });
}

export function refreshPinnedTable() {
    pinnedEl.textContent = '';

    if (!pinned.manifest) {
        pinnedNoteEl.textContent = 'pinned/bro.json not read yet.';
        return null;
    }
    if (!pinned.reported) {
        pinnedNoteEl.textContent = pinned.open
            ? 'Card is open — waiting for its first report.'
            : 'Open the card to compare its manifest against its real window.';
        return null;
    }

    pinnedNoteEl.textContent =
        'Opened with a bare bro.window.open("pinned") — no options passed, so ' +
        'every live value below came from that app\'s own manifest.';

    const rows = [];
    pinnedEl.appendChild(headerRow('pinned/bro.json', 'declared', 'live in its realm', ''));
    for (const key of WINDOW_KEYS) {
        const declared = pinned.manifest[key];
        if (declared === undefined) continue;
        const now = pinned.reported[key];
        let word, cls;
        if (key === 'windowX' || key === 'windowY') {
            // Documented: a child manifest's placement keys are ignored, because
            // where an app's own window goes is the opener's call.
            word = 'ignored by design'; cls = 'muted';
        } else if (declared === now) {
            word = 'match'; cls = 'good';
        } else {
            word = 'differs'; cls = 'warn';
        }
        rows.push({ key, declared, live: now, verdict: word });
        pinnedEl.appendChild(dataRow(key, fmt(declared), fmt(now), word, cls));
    }
    return rows;
}

// --- wiring ------------------------------------------------------------------

/**
 * Read both manifests off the /app mount. There is no runtime accessor for the
 * parsed manifest (bro.app / bro.manifest do not exist), so the file itself is
 * the only source of the declared side — which is honest anyway: it is the file
 * we are claiming things about.
 */
export async function loadManifests() {
    try {
        const r = await fetch('/app/bro.json');
        manifest.raw = await r.text();
        manifest.keys = JSON.parse(manifest.raw);
        manifest.loaded = true;
        refreshStartupTable();
        refreshSnippet();
    } catch (e) {
        tableEl.textContent = 'could not read /app/bro.json: ' + e;
    }
    try {
        const r2 = await fetch('/app/pinned/bro.json');
        pinned.manifest = JSON.parse(await r2.text());
        refreshPinnedTable();
    } catch (e) {
        pinnedNoteEl.textContent = 'could not read /app/pinned/bro.json: ' + e;
    }
    return manifest;
}

export function bindStartupPanel() {
    const posBox = document.getElementById('snipPos');

    document.getElementById('genSnippet').addEventListener('click', () => {
        refreshSnippet({ includePosition: posBox.checked });
        logSys('generated a bro.json from the live window state');
    });
    posBox.addEventListener('change', () => {
        refreshSnippet({ includePosition: posBox.checked });
    });
    document.getElementById('refreshStartup').addEventListener('click', () => {
        refreshStartupTable();
        refreshSnippet({ includePosition: posBox.checked });
    });

    document.getElementById('openPinned').addEventListener('click', openPinned);
    document.getElementById('pollPinned').addEventListener('click', pollPinned);
    document.getElementById('closePinned').addEventListener('click', closePinned);

    loadManifests();
}
