// pinned.js — a satellite that exists to prove bro.json's window keys land.
//
// pinned/bro.json declares borderless, alwaysOnTop, a size and min/max resize
// limits. The host opens it with a bare bro.window.open('pinned'), so every
// window property reported here can only have come from the manifest. They
// are read out of THIS realm's bro.window rather than trusted from the file.
//
// windowX/windowY in a child manifest are ignored by design: where an opened
// window goes belongs to the opener. The host's table shows that as expected.

import { readout } from "/lib/kit/ui.js";

const ro = readout('#state', {
    size: 'size', borderless: 'borderless', alwaysOnTop: 'alwaysOnTop',
    min: 'min', max: 'max', position: 'position', state: 'state',
});

function measure() {
    const min = bro.window.getMinSize(), max = bro.window.getMaxSize(), pos = bro.window.getPosition();
    return {
        title: document.title || 'Pinned Card',
        width: window.innerWidth, height: window.innerHeight,
        borderless: bro.window.borderless, alwaysOnTop: bro.window.alwaysOnTop,
        minWidth: min.width, minHeight: min.height, maxWidth: max.width, maxHeight: max.height,
        windowX: pos.x, windowY: pos.y,
        state: bro.window.state,
    };
}

function paint(r) {
    ro.set({
        size: `${r.width} x ${r.height}`, borderless: r.borderless, alwaysOnTop: r.alwaysOnTop,
        min: `${r.minWidth} x ${r.minHeight}`, max: `${r.maxWidth} x ${r.maxHeight}`,
        position: `${r.windowX}, ${r.windowY}`, state: r.state,
    });
}

function report() {
    const r = measure();
    if (bro.window.parent) bro.window.parent.postMessage({ type: 'pinnedState', ...r });
    paint(r);
}

document.getElementById('report').addEventListener('click', report);
document.getElementById('bye').addEventListener('click', () => window.close());
window.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'reportState') report(); });
window.addEventListener('resize', () => paint(measure()));

// Report unprompted once up, so the host's table fills without a click.
report();
