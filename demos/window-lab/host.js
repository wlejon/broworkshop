// host.js — runtime control of the window this app itself lives in.
//
// bro.window deliberately does NOT own size and fullscreen: those are persisted
// user preferences and live on bro.settings (graphics.width/height/fullscreen).
// What bro.window owns is the imperative state that is not a preference —
// borderless, always-on-top, resize limits, position, minimize/maximize/restore
// and display placement. This panel drives all of it and reads it straight back
// out, so a stale readout would be immediately visible.
//
// The page-visibility section exists because it is the hook games actually
// need: minimizing flips document.hidden and fires visibilitychange, which is
// the standard web signal to stop simulating. The "frames while hidden" counter
// makes it concrete — watch it stay put while the window is down.

const readoutEl = document.getElementById('hostReadout');
const visReadoutEl = document.getElementById('visReadout');
const visLogEl = document.getElementById('visLog');
const displaysEl = document.getElementById('displays');
const batteryEl = document.getElementById('battery');
const hostStateEl = document.getElementById('hostState');

export const visibility = {
    hidden: document.hidden === true,
    changes: 0,
    framesWhileHidden: 0,
    framesWhileVisible: 0,
    lastChangeAt: null,
};

const visLines = [];
function visLog(s) {
    visLines.push(`${new Date().toLocaleTimeString()}  ${s}`);
    if (visLines.length > 40) visLines.shift();
    visLogEl.textContent = visLines.join('\n');
    visLogEl.scrollTop = visLogEl.scrollHeight;
}

/** Called once per rAF from app.js. Split by visibility so the counter is a
 *  real measurement of what the engine did, not an assumption. */
export function noteFrame() {
    if (document.hidden) visibility.framesWhileHidden++;
    else visibility.framesWhileVisible++;
}

// --- readouts ----------------------------------------------------------------

function num(id, dflt) {
    const v = parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(v) ? v : dflt;
}

export function refreshHost() {
    const pos = bro.window.getPosition();
    const min = bro.window.getMinSize();
    const max = bro.window.getMaxSize();

    hostStateEl.textContent = bro.window.state;

    readoutEl.textContent =
        `state        ${bro.window.state}\n` +
        `borderless   ${bro.window.borderless}      alwaysOnTop ${bro.window.alwaysOnTop}\n` +
        `position     ${pos.x}, ${pos.y}\n` +
        `client size  ${window.innerWidth} x ${window.innerHeight}   dpr ${window.devicePixelRatio}\n` +
        `min size     ${min.width} x ${min.height}` +
            `${min.width === 0 && min.height === 0 ? '  (unconstrained)' : ''}\n` +
        `max size     ${max.width} x ${max.height}` +
            `${max.width === 0 && max.height === 0 ? '  (unconstrained)' : ''}\n` +
        `screen       ${screen.width} x ${screen.height}   ` +
            `avail ${screen.availWidth} x ${screen.availHeight}   ` +
            `depth ${screen.colorDepth}`;

    visReadoutEl.textContent =
        `document.hidden      ${document.hidden}\n` +
        `visibilitychange     ${visibility.changes} event(s)\n` +
        `frames while hidden  ${visibility.framesWhileHidden}\n` +
        `frames while visible ${visibility.framesWhileVisible}`;
}

export function refreshDisplays() {
    const list = bro.window.getDisplays();
    displaysEl.textContent = '';

    if (!list.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'No displays reported (headless --no-gpu).';
        displaysEl.appendChild(d);
        return list;
    }

    for (const d of list) {
        const row = document.createElement('div');
        row.className = 'item';

        const info = document.createElement('div');
        info.className = 'body disp';
        const left = document.createElement('div');
        left.textContent =
            `#${d.id} ${d.name}\n` +
            `   ${d.bounds.width}x${d.bounds.height} @ ${d.bounds.x},${d.bounds.y}  ` +
            `${Math.round(d.refreshRate)}Hz  scale ${d.contentScale}\n` +
            `   work ${d.workArea.width}x${d.workArea.height} @ ${d.workArea.x},${d.workArea.y}`;
        left.style.whiteSpace = 'pre-line';
        info.appendChild(left);

        const right = document.createElement('div');
        if (d.isPrimary) {
            const t = document.createElement('span');
            t.className = 'primary-tag'; t.textContent = 'primary ';
            right.appendChild(t);
        }
        if (d.isCurrent) {
            const t = document.createElement('span');
            t.className = 'current-tag'; t.textContent = 'current ';
            right.appendChild(t);
        }
        const btn = document.createElement('button');
        btn.className = 'tiny';
        btn.textContent = 'move here';
        btn.addEventListener('click', () => {
            const ok = bro.window.moveToDisplay(d.id);
            visLog(`moveToDisplay(${d.id}) -> ${ok}`);
            refreshHost();
            refreshDisplays();
        });
        right.appendChild(btn);
        info.appendChild(right);

        row.appendChild(info);
        displaysEl.appendChild(row);
    }
    return list;
}

// --- battery -----------------------------------------------------------------

// Snapshot-on-call over SDL_GetPowerInfo: there are no change events, so poll.
// On a desktop with no battery the web convention is charging:true, level:1 —
// report that honestly rather than pretending the API is missing.
export async function refreshBattery() {
    if (!navigator.getBattery) {
        batteryEl.textContent = 'navigator.getBattery() unavailable on this build.';
        return null;
    }
    try {
        const b = await navigator.getBattery();
        const pct = Math.round(b.level * 100);
        const fmt = (s) => (s === Infinity || !Number.isFinite(s)) ? '—'
            : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
        const noBattery = b.charging && b.level === 1 && b.chargingTime === 0;
        batteryEl.textContent =
            `level          ${pct}%\n` +
            `charging       ${b.charging}\n` +
            `time to full   ${fmt(b.chargingTime)}\n` +
            `time to empty  ${fmt(b.dischargingTime)}` +
            (noBattery ? '\n(no battery detected — desktop / AC power)' : '');
        return b;
    } catch (e) {
        batteryEl.textContent = 'battery unavailable: ' + e;
        return null;
    }
}

// --- wiring ------------------------------------------------------------------

export function bindHostPanel() {
    const borderless = document.getElementById('borderless');
    borderless.checked = bro.window.borderless;
    borderless.addEventListener('change', () => {
        bro.window.borderless = borderless.checked;
        // Read straight back: if the engine refused, the checkbox corrects
        // itself rather than lying about the window.
        borderless.checked = bro.window.borderless;
        refreshHost();
    });

    const aot = document.getElementById('alwaysOnTop');
    aot.checked = bro.window.alwaysOnTop;
    aot.addEventListener('change', () => {
        bro.window.alwaysOnTop = aot.checked;
        aot.checked = bro.window.alwaysOnTop;
        refreshHost();
    });

    document.getElementById('minimize').addEventListener('click', () => {
        bro.window.minimize(); refreshHost();
    });
    document.getElementById('maximize').addEventListener('click', () => {
        bro.window.maximize(); refreshHost();
    });
    document.getElementById('restore').addEventListener('click', () => {
        bro.window.restore(); refreshHost();
    });

    document.getElementById('setPos').addEventListener('click', () => {
        bro.window.setPosition(num('posX', 100), num('posY', 100));
        refreshHost();
    });
    document.getElementById('nudge').addEventListener('click', () => {
        const p = bro.window.getPosition();
        bro.window.setPosition(p.x + 40, p.y + 40);
        refreshHost();
    });

    document.getElementById('setMin').addEventListener('click', () => {
        bro.window.setMinSize(num('minW', 0), num('minH', 0)); refreshHost();
    });
    document.getElementById('clearMin').addEventListener('click', () => {
        bro.window.setMinSize(0, 0); refreshHost();
    });
    document.getElementById('setMax').addEventListener('click', () => {
        bro.window.setMaxSize(num('maxW', 0), num('maxH', 0)); refreshHost();
    });
    document.getElementById('clearMax').addEventListener('click', () => {
        bro.window.setMaxSize(0, 0); refreshHost();
    });

    document.addEventListener('visibilitychange', () => {
        visibility.hidden = document.hidden === true;
        visibility.changes++;
        visibility.lastChangeAt = Date.now();
        visLog(document.hidden
            ? 'hidden — a game should pause simulation here'
            : 'visible — resume');
        refreshHost();
    });

    // The window's real position follows the mouse when the user drags the
    // title bar, and there is no move event, so seed the spinners once from
    // reality instead of leaving them at a made-up 100,100.
    const p = bro.window.getPosition();
    document.getElementById('posX').value = p.x;
    document.getElementById('posY').value = p.y;

    refreshHost();
    refreshDisplays();
    refreshBattery();
    visLog('page visibility armed');
}
