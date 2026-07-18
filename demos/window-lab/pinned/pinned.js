// pinned.js — a satellite that exists purely to prove bro.json's window keys
// actually land.
//
// This app's bro.json declares borderless, alwaysOnTop, a size and min/max
// resize limits. The host opens it with a bare `bro.window.open('pinned')` —
// no options at all — so every window property this document reports back can
// only have come from the manifest. Reading them out of THIS realm's
// bro.window (which is scoped to this window) rather than trusting the file is
// what makes it a measurement.
//
// It also demonstrates the documented exception: windowX/windowY in a child
// app's manifest are IGNORED, because placement of a window the app opened
// belongs to the opener, not to the openee. The declared-vs-actual table in
// the host panel shows that one as an expected mismatch.

const stateEl = document.getElementById('state');

function readout() {
    const min = bro.window.getMinSize();
    const max = bro.window.getMaxSize();
    const pos = bro.window.getPosition();
    return {
        title: document.title || 'Pinned Card',
        width: window.innerWidth,
        height: window.innerHeight,
        borderless: bro.window.borderless,
        alwaysOnTop: bro.window.alwaysOnTop,
        minWidth: min.width, minHeight: min.height,
        maxWidth: max.width, maxHeight: max.height,
        windowX: pos.x, windowY: pos.y,
        state: bro.window.state,
    };
}

function paint() {
    const r = readout();
    stateEl.textContent =
        `size         ${r.width} x ${r.height}\n` +
        `borderless   ${r.borderless}\n` +
        `alwaysOnTop  ${r.alwaysOnTop}\n` +
        `min          ${r.minWidth} x ${r.minHeight}\n` +
        `max          ${r.maxWidth} x ${r.maxHeight}\n` +
        `position     ${r.windowX}, ${r.windowY}\n` +
        `state        ${r.state}`;
}

function report() {
    if (bro.window.parent)
        bro.window.parent.postMessage({ type: 'pinnedState', ...readout() });
    paint();
}

document.getElementById('report').addEventListener('click', report);
document.getElementById('bye').addEventListener('click', () => window.close());

window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'reportState') report();
});

window.addEventListener('resize', paint);

paint();
// Report unprompted once the document is up, so the host's table fills in
// without the user having to press anything.
report();
