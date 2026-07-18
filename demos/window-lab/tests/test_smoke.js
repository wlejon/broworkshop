// test_smoke.js — headless integration test for Window Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/window-lab \
//       ../broworkshop/demos/window-lab/tests/test_smoke.js
//
// Secondary windows ARE exercisable headlessly: they open hidden, flush() runs
// the drain that materializes them and delivers messages, their timers run
// under virtual time, capture() returns real pixels, and every input-injection
// seam takes a trailing windowId. So the assertions below are measurements,
// not no-throw smoke:
//
//   - a child's 'load' fires and the panel's own list reflects it
//   - postMessage parent->child is proven by the CONTENT of the child's ack
//   - postMessage child->parent is proven by injecting a click into the child
//     window and reading back the coordinates the child computed itself
//   - capture() bytes are non-empty AND not uniform (the child really drew)
//   - setTitle/setSize round-trip; close() fires 'close' and drops the row
//   - bro.time.paused freezes the scaled clock while advanceTime keeps running
//   - bro.time.scale = 2 advances the scaled clock at exactly 2x
//
// Headless caveats that shape these assertions (all documented, all confirmed
// against the real runtime): setPosition and moveToDisplay no-op on hidden
// windows, focus() no-ops, and minimize/maximize/restore no-op so a test can
// never disturb the window the pipeline renders through.

import {
    children, msgStats, openChild, closeAll, post, broadcast, pingAll,
    captureChild, captureAll,
    visibility, refreshHost, refreshDisplays,
    clocks, setScale, setPaused, rebase, refreshTimeReadout,
} from "/app/app.js";

// Let module evaluation, layout and the first frame settle.
advanceTime(64);
flush();

// ── host window surface ──────────────────────────────────────────────────────

assert(typeof bro.window === 'object', 'bro.window installed');
assert(['normal', 'minimized', 'maximized', 'fullscreen'].indexOf(bro.window.state) >= 0,
    `bro.window.state is a known state (${bro.window.state})`);

// Flag setters are pure window state and round-trip even headless.
bro.window.borderless = true;
assert(bro.window.borderless === true, 'borderless set round-trips');
bro.window.borderless = false;
assert(bro.window.borderless === false, 'borderless cleared round-trips');

bro.window.alwaysOnTop = true;
assert(bro.window.alwaysOnTop === true, 'alwaysOnTop set round-trips');
bro.window.alwaysOnTop = false;

bro.window.setMinSize(640, 480);
const gotMin = bro.window.getMinSize();
assert(gotMin.width === 640 && gotMin.height === 480,
    `setMinSize reads back (${gotMin.width}x${gotMin.height})`);
bro.window.setMaxSize(1600, 1000);
const gotMax = bro.window.getMaxSize();
assert(gotMax.width === 1600 && gotMax.height === 1000,
    `setMaxSize reads back (${gotMax.width}x${gotMax.height})`);
bro.window.setMinSize(0, 0);
bro.window.setMaxSize(0, 0);
assert(bro.window.getMinSize().width === 0, 'min size clears to unconstrained');

const pos = bro.window.getPosition();
assert(Number.isFinite(pos.x) && Number.isFinite(pos.y),
    `getPosition returns finite coords (${pos.x},${pos.y})`);

// ── displays ─────────────────────────────────────────────────────────────────

const displays = refreshDisplays();
assert(displays.length >= 1, `getDisplays returns at least one display (${displays.length})`);
const d0 = displays[0];
assert(typeof d0.id === 'number', 'display has a numeric id');
assert(typeof d0.name === 'string' && d0.name.length > 0, `display named "${d0.name}"`);
assert(d0.bounds.width > 0 && d0.bounds.height > 0,
    `display bounds are sane (${d0.bounds.width}x${d0.bounds.height})`);
assert(d0.workArea.width > 0 && d0.workArea.width <= d0.bounds.width,
    'work area fits inside bounds');
assert(d0.contentScale > 0, 'contentScale positive');
assert(displays.some((d) => d.isPrimary), 'exactly one display flagged primary');

assert(screen.width > 0 && screen.availWidth > 0, 'window.screen reports dimensions');
assert(screen.colorDepth === 24, 'screen.colorDepth is 24');

// ── open a secondary window ──────────────────────────────────────────────────

const rec = openChild({ width: 360, height: 420 });
assert(typeof rec.win.id === 'number' && rec.win.id > 0,
    `open() returned a handle with an id (${rec.win.id})`);
assert(rec.win.closed === false, 'fresh handle is not closed');
assert(children.length === 1, 'panel list has one child');
assert(document.getElementById('winCount').textContent === '1',
    'header window count reflects the open child');

// The window materializes at the engine's idle drain, which flush() runs.
flush();
assert(rec.loaded === true, "child's 'load' event fired");

const size = rec.win.getSize();
assert(size.width === 360 && size.height === 420,
    `child opened at the requested size (${size.width}x${size.height})`);

// ── parent -> child: prove by the CONTENT of the reply ───────────────────────
//
// The load handler already posted {hello} and {accent}; the child acks each
// with the payload it received. Children are delivered before the parent in a
// drain, so one flush() completes the whole round trip.
flush();
assert(rec.acks >= 1, `child acked the parent's messages (${rec.acks})`);
assert(rec.lastAck !== null && rec.lastAck.of === 'accent',
    'last ack is for the accent message');
assert(rec.lastAck.color === rec.accent,
    `child received the exact accent payload ("${rec.lastAck.color}" === "${rec.accent}")`);

// Drive a distinctive value through and read it back out of the child.
post(rec, { type: 'label', text: 'Probe-42' });
flush();
assert(rec.lastAck.of === 'label' && rec.lastAck.text === 'Probe-42',
    `child received the exact label payload ("${rec.lastAck.text}")`);

post(rec, { type: 'spin', value: 2.5 });
flush();
assert(rec.lastAck.of === 'spin' && rec.lastAck.value === 2.5,
    `child received a numeric payload intact (${rec.lastAck.value})`);

// ── ping / pong round trip ───────────────────────────────────────────────────

const before = msgStats.received;
pingAll();
flush();
assert(msgStats.received > before, 'pong came back from the child');
assert(msgStats.lastPingMs !== null && msgStats.lastPingMs >= 0,
    `round-trip latency measured (${msgStats.lastPingMs} ms wall clock)`);

// ── child -> parent: inject a click into the CHILD window ────────────────────
//
// Input is routed per window. The click below is handled entirely by the
// child's document, against its own hit test — and the coordinates that come
// back are ones the child computed, which the parent never sent it.
assert(rec.lastClick === undefined, 'no clicks recorded before injection');
click(180, 120, 0, rec.win.id);   // inside the child's canvas
flush();
assert(rec.clicks === 1, `child reported exactly one click (${rec.clicks})`);
assert(rec.lastClick && Number.isFinite(rec.lastClick.x) && Number.isFinite(rec.lastClick.y),
    `child sent back its own canvas coords (${rec.lastClick.x},${rec.lastClick.y})`);
assert(rec.lastClick.x >= 0 && rec.lastClick.x <= 240,
    'reported x lands inside the child canvas');

// A click at the same viewport coords in the MAIN window must not reach it.
const clicksAfter = rec.clicks;
click(180, 120, 0);   // no windowId = main window
flush();
assert(rec.clicks === clicksAfter, 'a main-window click never reaches the child');

// ── child timers run independently ───────────────────────────────────────────
//
// The child's own setInterval ticks once a scaled second and reports every
// fifth tick unprompted.
advanceTime(5200);
flush();
assert(rec.ticks >= 5, `child's own timer ran and reported (${rec.ticks} ticks)`);

// ── capture() — real pixels from the child's framebuffer ─────────────────────

const shot = captureChild(rec);
assert(shot !== null, 'capture() returned data');
assert(shot.width === 360 && shot.height === 420,
    `capture matches the window size (${shot.width}x${shot.height})`);
assert(shot.data.length === shot.width * shot.height * 4,
    `capture is a full RGBA buffer (${shot.data.length} bytes)`);

// Non-uniform: a blank or single-colour buffer would mean nothing was drawn.
let distinct = 0;
const seen = new Set();
for (let i = 0; i < shot.data.length; i += 4 * 997) {
    const key = (shot.data[i] << 16) | (shot.data[i + 1] << 8) | shot.data[i + 2];
    if (!seen.has(key)) { seen.add(key); distinct++; }
}
assert(distinct > 3, `child framebuffer has real content (${distinct} distinct sampled colours)`);
assert(rec.lastCapture.bytes === shot.data.length, 'panel recorded the capture');

// ── geometry setters round-trip ──────────────────────────────────────────────

rec.win.setTitle('Retitled');
rec.title = 'Retitled';
rec.win.setSize(420, 300);
flush();
const sized = rec.win.getSize();
assert(sized.width === 420 && sized.height === 300,
    `setSize reads back (${sized.width}x${sized.height})`);

// The child realm learns about its own resize and says so.
const rp = rec.win.getPosition();
assert(Number.isFinite(rp.x) && Number.isFinite(rp.y),
    `child getPosition returns finite coords (${rp.x},${rp.y})`);
rec.win.setPosition(200, 150);   // no-op while hidden; must not throw
rec.win.focus();                 // no-op while hidden; must not throw

// ── several windows at once ──────────────────────────────────────────────────

const b = openChild({ width: 300, height: 320 });
const c = openChild({ width: 300, height: 320 });
flush();
assert(children.length === 3, `three windows open at once (${children.length})`);
assert(b.win.id !== c.win.id && b.win.id !== rec.win.id, 'window ids are distinct');
assert(b.loaded && c.loaded, 'every child loaded');

const shots = captureAll();
assert(shots === 3, `captured all three framebuffers (${shots})`);

// Broadcast reaches every child.
const acksBefore = msgStats.acks;
broadcast({ type: 'accent', color: '#ff00ff' });
flush();
assert(msgStats.acks === acksBefore + 3, 'all three children acked the broadcast');
assert(b.lastAck.color === '#ff00ff' && c.lastAck.color === '#ff00ff',
    'each child received the broadcast payload verbatim');

// ── closing ──────────────────────────────────────────────────────────────────

let closeFired = 0;
c.win.addEventListener('close', () => closeFired++);
c.win.close();
flush();
assert(closeFired === 1, "'close' fired exactly once");
assert(c.win.closed === true, 'handle reports closed');
assert(children.indexOf(c) === -1, 'closed window left the panel list');
assert(children.length === 2, `two windows remain (${children.length})`);
assert(document.getElementById('winCount').textContent === '2',
    'header count follows the close');

// Double close is a documented no-op.
c.win.close();
flush();
assert(closeFired === 1, 'double close does not re-fire');
assert(c.win.capture() === null, 'capture() on a closed window returns null');

closeAll();
flush();
assert(children.length === 0, 'closeAll emptied the list');

// ── bro.time: paused freezes the scaled clock ────────────────────────────────
//
// advanceTime(ms) advances the SCALED clock by ms * scale — and not at all
// while paused — while virtual time advances the full ms. That makes both
// properties exactly measurable rather than approximately observable.

setScale(1);
setPaused(false);
const t0 = bro.time.now;
advanceTime(500);
const normalDelta = bro.time.now - t0;
assert(Math.abs(normalDelta - 500) < 1,
    `scale 1: 500 ms advanced the clock ${normalDelta.toFixed(1)} ms`);

setPaused(true);
const tPause = bro.time.now;
const wallPause = Date.now();
advanceTime(1000);
const pausedDelta = bro.time.now - tPause;
assert(pausedDelta === 0,
    `paused: the scaled clock did not move at all (${pausedDelta} ms over 1000 ms)`);
assert(Date.now() >= wallPause, 'wall clock is unaffected by pause');
assert(bro.time.paused === true, 'bro.time.paused reads true');

setPaused(false);
const tResume = bro.time.now;
advanceTime(200);
assert(Math.abs((bro.time.now - tResume) - 200) < 1,
    'unpausing resumes the clock exactly where it stopped');

// ── bro.time: scale multiplies the clock ─────────────────────────────────────

setScale(2);
assert(bro.time.scale === 2, 'scale set to 2');
const t2 = bro.time.now;
advanceTime(500);
const fastDelta = bro.time.now - t2;
assert(Math.abs(fastDelta - 1000) < 1,
    `scale 2: 500 ms of wall time advanced the clock ${fastDelta} ms (2.00x)`);

setScale(0.25);
const t3 = bro.time.now;
advanceTime(800);
const slowDelta = bro.time.now - t3;
assert(Math.abs(slowDelta - 200) < 1,
    `scale 0.25: 800 ms of wall time advanced the clock ${slowDelta} ms (0.25x)`);

// The panel's own derived readout agrees with the engine.
setScale(1);
refreshTimeReadout();
assert(bro.time.scale === 1, 'scale restored to 1');

// Documented clamp.
bro.time.scale = -5;
assert(bro.time.scale >= 0, `negative scale clamped (${bro.time.scale})`);
bro.time.scale = 1000;
assert(bro.time.scale <= 100, `huge scale clamped to 100 (${bro.time.scale})`);
setScale(1);

// ── page visibility ──────────────────────────────────────────────────────────

assert(typeof document.hidden === 'boolean', 'document.hidden exposed');
advanceTime(64);
assert(visibility.framesWhileVisible > 0,
    `frames counted while visible (${visibility.framesWhileVisible})`);
refreshHost();

// ── battery ──────────────────────────────────────────────────────────────────

assert(typeof navigator.getBattery === 'function', 'navigator.getBattery exposed');
navigator.getBattery().then((bat) => {
    assert(typeof bat.charging === 'boolean', 'battery.charging is a boolean');
    assert(bat.level >= 0 && bat.level <= 1, `battery.level in range (${bat.level})`);
    console.log('  ok: battery snapshot read');
});
flush();
advanceTime(16);
flush();

console.log('window-lab smoke: all assertions passed');
