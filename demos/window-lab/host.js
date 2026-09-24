// host.js — runtime control of the window this app itself lives in.
//
// bro.window does NOT own size and fullscreen: those are persisted user
// preferences on bro.settings (graphics.width/height/fullscreen). It owns the
// imperative state that is not a preference: borderless, always-on-top,
// resize limits, position, minimize/maximize/restore and display placement.
// Every control here is read straight back out of the engine afterwards.
//
// Page visibility is the hook games actually need: minimizing flips
// document.hidden and fires visibilitychange. The "frames while hidden"
// counter makes it concrete.

import { h, clear, logView, readout } from "/lib/kit/index.js";

export const visibility = {
    hidden: document.hidden === true,
    changes: 0,
    framesWhileHidden: 0,
    framesWhileVisible: 0,
    lastChangeAt: null,
};

let hostRo = null, visRo = null, batRo = null, visLog = null;

/** Called once per rAF from main.js, split by visibility so it is a measurement. */
export function noteFrame() {
    if (document.hidden) visibility.framesWhileHidden++;
    else visibility.framesWhileVisible++;
}

const unconstrained = (s) => (s.width === 0 && s.height === 0 ? '  (unconstrained)' : '');

export function refreshHost() {
    const pos = bro.window.getPosition();
    const min = bro.window.getMinSize();
    const max = bro.window.getMaxSize();
    document.getElementById('hostState').textContent = bro.window.state;
    hostRo.set({
        state: bro.window.state,
        flags: `borderless ${bro.window.borderless}   alwaysOnTop ${bro.window.alwaysOnTop}`,
        position: `${pos.x}, ${pos.y}`,
        client: `${window.innerWidth} x ${window.innerHeight}   dpr ${window.devicePixelRatio}`,
        min: `${min.width} x ${min.height}${unconstrained(min)}`,
        max: `${max.width} x ${max.height}${unconstrained(max)}`,
        screen: `${screen.width} x ${screen.height}   avail ${screen.availWidth} x ${screen.availHeight}   depth ${screen.colorDepth}`,
    });
    visRo.set({
        hidden: document.hidden,
        changes: `${visibility.changes} event(s)`,
        whileHidden: visibility.framesWhileHidden,
        whileVisible: visibility.framesWhileVisible,
    });
}

export function refreshDisplays() {
    const list = bro.window.getDisplays();
    const box = clear(document.getElementById('displays'));
    if (!list.length) {
        box.appendChild(h('div.dim', null, 'No displays reported (headless --no-gpu).'));
        return list;
    }
    for (const d of list) {
        box.appendChild(h('div.display', null,
            h('div.k-grow', null,
                `#${d.id} ${d.name}\n` +
                `   ${d.bounds.width}x${d.bounds.height} @ ${d.bounds.x},${d.bounds.y}  ` +
                `${Math.round(d.refreshRate)}Hz  scale ${d.contentScale}\n` +
                `   work ${d.workArea.width}x${d.workArea.height} @ ${d.workArea.x},${d.workArea.y}`),
            d.isPrimary ? h('span.ok', null, 'primary') : null,
            d.isCurrent ? h('span.warn', null, 'current') : null,
            h('button.small', {
                onclick: () => {
                    visLog.add(`moveToDisplay(${d.id}) -> ${bro.window.moveToDisplay(d.id)}`);
                    refreshHost();
                    refreshDisplays();
                },
            }, 'move here')));
    }
    return list;
}

// Snapshot-on-call over SDL_GetPowerInfo: no change events, so poll. A desktop
// with no battery reports the web convention (charging, level 1).
export async function refreshBattery() {
    if (!navigator.getBattery) { batRo.set('level', 'navigator.getBattery() unavailable'); return null; }
    try {
        const b = await navigator.getBattery();
        const fmt = (s) => (!Number.isFinite(s) ? '—' : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
        const noBattery = b.charging && b.level === 1 && b.chargingTime === 0;
        batRo.set({
            level: Math.round(b.level * 100) + '%' + (noBattery ? '  (no battery: AC power)' : ''),
            charging: b.charging,
            full: fmt(b.chargingTime),
            empty: fmt(b.dischargingTime),
        });
        return b;
    } catch (e) {
        batRo.set('level', 'unavailable: ' + e);
        return null;
    }
}

function num(id, dflt) {
    const v = parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(v) ? v : dflt;
}

function on(id, fn) {
    document.getElementById(id).addEventListener('click', () => { fn(); refreshHost(); });
}

export function bindHostPanel() {
    hostRo = readout('#hostReadout', {
        state: 'state', flags: 'flags', position: 'position', client: 'client size',
        min: 'min size', max: 'max size', screen: 'screen',
    });
    visRo = readout('#visReadout', {
        hidden: 'document.hidden', changes: 'visibilitychange',
        whileHidden: 'frames while hidden', whileVisible: 'frames while visible',
    });
    batRo = readout('#battery', { level: 'level', charging: 'charging', full: 'time to full', empty: 'time to empty' });
    visLog = logView('#visLog', { max: 40 });

    // Flags: write, then read straight back, so a refusal corrects the box.
    for (const key of ['borderless', 'alwaysOnTop']) {
        const box = document.getElementById(key);
        box.checked = bro.window[key];
        box.addEventListener('change', () => {
            bro.window[key] = box.checked;
            box.checked = bro.window[key];
            refreshHost();
        });
    }

    on('minimize', () => bro.window.minimize());
    on('maximize', () => bro.window.maximize());
    on('restore', () => bro.window.restore());
    on('setPos', () => bro.window.setPosition(num('posX', 100), num('posY', 100)));
    on('nudge', () => { const p = bro.window.getPosition(); bro.window.setPosition(p.x + 40, p.y + 40); });
    on('setMin', () => bro.window.setMinSize(num('minW', 0), num('minH', 0)));
    on('clearMin', () => bro.window.setMinSize(0, 0));
    on('setMax', () => bro.window.setMaxSize(num('maxW', 0), num('maxH', 0)));
    on('clearMax', () => bro.window.setMaxSize(0, 0));

    document.addEventListener('visibilitychange', () => {
        visibility.hidden = document.hidden === true;
        visibility.changes++;
        visibility.lastChangeAt = Date.now();
        visLog.add(document.hidden ? 'hidden — a game should pause simulation here' : 'visible — resume');
        refreshHost();
    });

    // There is no move event, so seed the position fields from reality.
    const p = bro.window.getPosition();
    document.getElementById('posX').value = p.x;
    document.getElementById('posY').value = p.y;

    refreshHost();
    refreshDisplays();
    refreshBattery();
    visLog.add('page visibility armed');
}
