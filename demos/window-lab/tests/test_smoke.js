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

//
// Chunk 2 adds the measurements the app was really built to make:
//
//   - the lander's serialized state is CHARACTER-IDENTICAL across a paused
//     advanceTime(4000) — not "close enough", not "barely moved", identical.
//     That is the clean proof that a game with no pause flag is fully frozen
//   - the same state advances at scale 1 and roughly a quarter as fast at 0.25
//   - the slow-mo powerup measurably drives bro.time.scale down and back
//   - an ArrayBuffer sent with a transfer list leaves the sender DETACHED
//     (byteLength 0) and arrives with a matching checksum in the child
//   - per-child resize limits set through the child realm read back
//   - bro.json's launch-only keys line up with live window state, and a second
//     app opened with no options at all takes its shape from its own manifest

import {
    children, msgStats, openChild, closeAll, post, broadcast, pingAll, winctl,
    captureChild, captureAll,
    visibility, refreshHost, refreshDisplays,
    clocks, setScale, setPaused, rebase, refreshTimeReadout,
    game, slowmo, snapshot, resetShip, triggerSlowmo, cancelSlowmo,
    manifest, pinned, liveWindowKeys, buildSnippet, refreshSnippet,
    refreshStartupTable, refreshPinnedTable, openPinned, closePinned, pollPinned,
    transferState, shellState, sendBlob, shellOpen,
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

// ═══════════════════════════════════════════════════════════════════════════
// ── the pause-aware lander ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// game.js contains no pause flag and no scale-aware line. Everything below is
// therefore a measurement of the ENGINE's behaviour, not of the game's.

setScale(1);
setPaused(false);
resetShip(true);
advanceTime(64);

// --- it advances at scale 1 -------------------------------------------------

const gBefore = snapshot();
const simBefore = game.simMs;
const framesBefore = game.frames;
advanceTime(1000);
assert(snapshot() !== gBefore, 'lander state advanced under advanceTime at scale 1');
assert(game.frames > framesBefore,
    `sim frames advanced (${framesBefore} -> ${game.frames})`);

const simAt1 = game.simMs - simBefore;
assert(Math.abs(simAt1 - 1000) < 60,
    `scale 1: 1000 ms of advanceTime integrated ${simAt1.toFixed(1)} scaled ms`);

// --- paused: BIT-IDENTICAL --------------------------------------------------
//
// rAF callbacks are skipped entirely while paused, so tickGame is never called
// — not called with dt 0, not called and early-returned. Nothing in the game
// can drift, including the counters its own scaled setTimeout and setInterval
// would otherwise move. Character equality of the full serialization is the
// strongest statement available and it holds exactly.

setPaused(true);
const frozen = snapshot();
const frozenScaled = bro.time.now;
const frozenFrames = game.frames;
const frozenBeacon = game.beacon;
const frozenSim = game.simMs;
advanceTime(4000);
flush();
advanceTime(4000);
flush();

assert(snapshot() === frozen,
    'PAUSED: lander state is character-identical after 8000 ms of advanceTime');
assert(game.frames === frozenFrames,
    `PAUSED: not one simulation frame ran (${game.frames})`);
assert(game.simMs === frozenSim,
    'PAUSED: not one microsecond of sim time accrued');
assert(bro.time.now === frozenScaled,
    'PAUSED: the scaled clock itself did not move');

// The scaled setInterval driving the pad beacon is frozen too — it would have
// fired 16 times over 8 seconds if the clock had been running.
assert(game.beacon === frozenBeacon,
    `PAUSED: the game's setInterval beacon did not tick (${game.beacon})`);

setPaused(false);
advanceTime(64);
assert(snapshot() !== frozen, 'resuming moves the lander again');

// --- scale 0.25 advances proportionally less --------------------------------

setScale(1);
advanceTime(200);
const s1a = game.simMs;
advanceTime(2000);
const fullRate = game.simMs - s1a;

setScale(0.25);
advanceTime(200);
const s2a = game.simMs;
advanceTime(2000);
const quarterRate = game.simMs - s2a;

assert(quarterRate > 0, 'the lander still simulates at 0.25x, just slower');
assert(quarterRate < fullRate,
    `0.25x integrated less sim time than 1x (${quarterRate.toFixed(0)} < ${fullRate.toFixed(0)} ms)`);
const ratio = fullRate / quarterRate;
assert(ratio > 3.5 && ratio < 4.5,
    `0.25x ran the lander at 1/${ratio.toFixed(2)} speed (expected ~1/4)`);

// The FRAME cadence is unaffected — timescale changes the timestamp a callback
// receives, never how often it fires. This is why the powerup ramp below can be
// clocked off frames and stay a fixed wall duration.
setScale(1);
const fA = game.frames; advanceTime(1000); const fFull = game.frames - fA;
setScale(0.25);
const fB = game.frames; advanceTime(1000); const fQuarter = game.frames - fB;
assert(fFull === fQuarter,
    `rAF fired the same number of times at 1x and 0.25x (${fFull} === ${fQuarter})`);
setScale(1);

// --- the slow-mo powerup ramps the timescale --------------------------------

setScale(1);
assert(slowmo.active === false, 'powerup idle to begin with');
assert(bro.time.scale === 1, 'timescale at 1 before the powerup');

const fired = triggerSlowmo();
assert(fired === true, 'powerup triggered');
assert(slowmo.active === true, 'powerup reports active');
assert(triggerSlowmo() === false, 'a second trigger while active is refused');

// Sample the ramp rather than trusting one endpoint: the point of the feature
// is that the dial moves smoothly, so record the trajectory.
const samples = [];
let minScale = 1;
for (let i = 0; i < 14; i++) {
    advanceTime(280);
    samples.push(+bro.time.scale.toFixed(3));
    minScale = Math.min(minScale, bro.time.scale);
}

assert(minScale < 0.999,
    `the powerup drove bro.time.scale below 1 (min ${minScale.toFixed(3)})`);
assert(minScale <= 0.31,
    `the ramp reached its 0.30x target (min ${minScale.toFixed(3)})`);
assert(samples.some((s) => s > minScale + 0.02 && s < 0.999),
    'the ramp passed through intermediate values — it eased, it did not snap');
assert(new Set(samples).size >= 4,
    `the timescale took at least four distinct values during the ramp ` +
    `(${new Set(samples).size} of ${samples.length} samples)`);

// It comes back on its own.
advanceTime(4000);
assert(slowmo.active === false, 'the powerup finished and released the timescale');
assert(Math.abs(bro.time.scale - 1) < 1e-9,
    `timescale restored exactly to 1 (${bro.time.scale})`);
assert(slowmo.uses === 1, 'one use recorded');

// And it can be cancelled mid-ramp, restoring the scale it captured.
triggerSlowmo();
advanceTime(400);
assert(bro.time.scale < 1, 'ramp under way before the cancel');
assert(cancelSlowmo() === true, 'cancel accepted');
assert(bro.time.scale === 1, 'cancel restored the pre-powerup timescale exactly');
assert(cancelSlowmo() === false, 'cancelling an idle powerup is a no-op');

// A powerup running when the pause lands stops with everything else.
triggerSlowmo();
advanceTime(200);
const midScale = bro.time.scale;
const midLeft = slowmo.framesLeft;
setPaused(true);
advanceTime(3000);
assert(bro.time.scale === midScale, 'PAUSED: the ramp stopped moving the timescale');
assert(slowmo.framesLeft === midLeft, 'PAUSED: the ramp did not consume frames');
setPaused(false);
cancelSlowmo();
setScale(1);
resetShip(true);

// ═══════════════════════════════════════════════════════════════════════════
// ── transfer list: zero-copy proven by detachment ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const xr = openChild({ width: 320, height: 260 });
flush();
assert(xr.loaded === true, 'transfer target window loaded');

// A copy first, as the control: our buffer must survive.
const copyRes = sendBlob(xr, 8192, false);
assert(copyRes.before === 8192, 'copy: payload built at the requested size');
assert(copyRes.after === 8192, 'copy: the sender still owns its buffer afterwards');
assert(copyRes.detached === false, 'copy: nothing was detached');
flush();
assert(transferState.lastAck !== null, 'copy: the child acknowledged the bytes');
assert(transferState.intact === true,
    `copy: the child's checksum matched (${transferState.lastAck.checksum})`);

// Now the real thing.
const res = sendBlob(xr, 65536, true);
assert(res.before === 65536, `transfer: 65536-byte payload before sending`);
assert(res.after === 0,
    `transfer: THE SENDER'S BUFFER IS DETACHED (byteLength ${res.after})`);
assert(res.detached === true, 'transfer: panel recorded the detachment');
assert(transferState.senderByteLengthBefore === 65536 &&
       transferState.senderByteLengthAfter === 0,
    'transfer: before/after byteLengths recorded as 65536 -> 0');
assert(transferState.lastMode === 'transfer', 'transfer: mode recorded');

flush();
assert(transferState.lastAck.bytes === 65536,
    `transfer: the child received all 65536 bytes (${transferState.lastAck.bytes})`);
assert(transferState.lastAck.checksum === transferState.lastChecksum,
    `transfer: the child's checksum matches the one taken before sending ` +
    `(${transferState.lastAck.checksum})`);
assert(transferState.intact === true,
    'transfer: bytes arrived intact AND the sender was emptied — zero-copy');

// The first byte of the deterministic pattern is 0 and the last of a 65536-byte
// run is (65535*31 + 255*7) & 0xff; assert the child saw the real edges rather
// than a zero-filled buffer of the right length.
assert(transferState.lastAck.last === ((65535 * 31 + 255 * 7) & 0xff),
    `transfer: the child's last byte is the expected pattern value ` +
    `(${transferState.lastAck.last})`);

// Detachment is observable on the view too, not just the buffer — the usual
// way this bites real code.
const probe = new Uint8Array(64);
const probeBuf = probe.buffer;
xr.win.postMessage({ type: 'blob', tag: 999, buf: probeBuf }, [probeBuf]);
assert(probeBuf.byteLength === 0, 'transfer: raw handle postMessage detaches too');
assert(probe.length === 0,
    `transfer: the Uint8Array VIEW is detached as well (length ${probe.length})`);
flush();

// ═══════════════════════════════════════════════════════════════════════════
// ── per-child window limits, driven through the child realm ─────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// The parent handle has no setMinSize/setMaxSize (confirmed: they are
// undefined on it). Resize limits live on the child realm's own bro.window, so
// the parent drives them by proxy and the child answers with what it read back.

assert(typeof xr.win.setMinSize === 'undefined',
    'the parent handle deliberately exposes no resize-limit setters');

winctl(xr, 'minSize', { width: 280, height: 240 });
flush();
assert(xr.winState, 'the child reported its window state back');
assert(xr.winState.min[0] === 280 && xr.winState.min[1] === 240,
    `per-child min size reads back from the child realm ` +
    `(${xr.winState.min[0]}x${xr.winState.min[1]})`);

winctl(xr, 'maxSize', { width: 900, height: 720 });
flush();
assert(xr.winState.max[0] === 900 && xr.winState.max[1] === 720,
    `per-child max size reads back (${xr.winState.max[0]}x${xr.winState.max[1]})`);

winctl(xr, 'borderless', { value: true });
flush();
assert(xr.winState.borderless === true, 'per-child borderless round-trips');
winctl(xr, 'borderless', { value: false });
flush();
assert(xr.winState.borderless === false, 'per-child borderless clears');

winctl(xr, 'alwaysOnTop', { value: true });
flush();
assert(xr.winState.alwaysOnTop === true, 'per-child alwaysOnTop round-trips');
winctl(xr, 'alwaysOnTop', { value: false });
flush();

winctl(xr, 'minSize', { width: 0, height: 0 });
winctl(xr, 'maxSize', { width: 0, height: 0 });
flush();
assert(xr.winState.min[0] === 0 && xr.winState.max[0] === 0,
    'per-child limits clear to unconstrained');

xr.win.close();
flush();

// ═══════════════════════════════════════════════════════════════════════════
// ── bro.json startup keys: declared vs live ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// The manifests are fetched over the /app mount; pump until they land.
for (let i = 0; i < 8 && !manifest.loaded; i++) { flush(); advanceTime(40); flush(); }
assert(manifest.loaded === true, "this app's bro.json was read over the /app mount");
assert(manifest.keys.title === 'Window Lab',
    `manifest title parsed ("${manifest.keys.title}")`);
assert(manifest.keys.minWidth === 900 && manifest.keys.minHeight === 600,
    'manifest declares minWidth 900 / minHeight 600');

// Live side. Apply the declared limits and the row must go from drifted to
// match — which is the whole demonstration: these keys are launch-time
// defaults, and bro.window is the runtime truth.
bro.window.setMinSize(0, 0);
let rows = refreshStartupTable();
assert(rows !== null && rows.length > 0, `declared-vs-live table rendered (${rows.length} rows)`);
let minRow = rows.find((r) => r.key === 'minWidth');
assert(minRow.declared === 900, 'minWidth row shows the declared 900');
assert(minRow.live === 0 && minRow.verdict === 'drifted',
    'with limits cleared at runtime, the minWidth row reports drift');

bro.window.setMinSize(900, 600);
rows = refreshStartupTable();
minRow = rows.find((r) => r.key === 'minWidth');
assert(minRow.live === 900 && minRow.verdict === 'match',
    'restoring the declared limit flips the row back to match');

const blRow = rows.find((r) => r.key === 'borderless');
assert(blRow.declared === undefined && blRow.verdict === 'not declared',
    'a key this app never declared is reported as such, not as false');

// liveWindowKeys is the single source both the table and the snippet read.
const live = liveWindowKeys();
assert(live.minWidth === 900 && live.minHeight === 600,
    'liveWindowKeys reports the limits bro.window actually holds');
assert(live.title === document.title, 'liveWindowKeys reports the live title');
assert(Number.isFinite(live.display) && live.display >= 0,
    `display resolved to an index (${live.display}), not an SDL id`);

// --- the generated snippet --------------------------------------------------

bro.window.setMinSize(640, 480);
bro.window.setMaxSize(0, 0);
bro.window.alwaysOnTop = true;
const snip = buildSnippet();
assert(snip.minWidth === 640 && snip.minHeight === 480,
    'the snippet picked up the live min size');
assert(snip.alwaysOnTop === true, 'the snippet picked up alwaysOnTop');
assert(!('maxWidth' in snip),
    'an unconstrained max size is omitted from the snippet rather than emitted as 0');
assert(!('borderless' in snip), 'a false borderless is omitted, not emitted');
assert(!('windowX' in snip), 'position is omitted unless explicitly asked for');
assert(snip.lib === manifest.keys.lib,
    `keys the panel does not own are carried through ("${snip.lib}")`);
assert(snip.app === '.', 'the app key is preserved');

const withPos = buildSnippet({ includePosition: true });
assert(Number.isFinite(withPos.windowX) && Number.isFinite(withPos.windowY),
    `position included on request (${withPos.windowX},${withPos.windowY})`);

const snipText = refreshSnippet();
assert(snipText.length > 20 && JSON.parse(snipText).title === document.title,
    'the rendered snippet is valid JSON describing this window');
assert(document.getElementById('startupSnippet').textContent === snipText,
    'the snippet is what the panel shows');

bro.window.alwaysOnTop = false;
bro.window.setMinSize(900, 600);

// --- the pinned card takes its shape from its own manifest ------------------

assert(pinned.manifest !== null, 'pinned/bro.json was read');
assert(pinned.manifest.borderless === true && pinned.manifest.alwaysOnTop === true,
    'the pinned card declares borderless + alwaysOnTop in its manifest');

const pwin = openPinned();
flush();
assert(pinned.open === true, 'pinned card opened');

// Opened with NO options at all, so its size can only come from its manifest.
const psize = pwin.getSize();
assert(psize.width === pinned.manifest.width && psize.height === pinned.manifest.height,
    `bare open() took its size from the child's bro.json ` +
    `(${psize.width}x${psize.height})`);

flush();
assert(pinned.reported !== null, 'the card reported its own window state back');
assert(pinned.reported.borderless === true,
    'bro.json "borderless": true reached the real window');
assert(pinned.reported.alwaysOnTop === true,
    'bro.json "alwaysOnTop": true reached the real window');
assert(pinned.reported.minWidth === pinned.manifest.minWidth &&
       pinned.reported.minHeight === pinned.manifest.minHeight,
    `bro.json min limits reached the real window ` +
    `(${pinned.reported.minWidth}x${pinned.reported.minHeight})`);
assert(pinned.reported.maxWidth === pinned.manifest.maxWidth,
    `bro.json max limits reached the real window (${pinned.reported.maxWidth})`);

const prows = refreshPinnedTable();
assert(prows !== null && prows.length > 0, `pinned table rendered (${prows.length} rows)`);
assert(prows.filter((r) => r.verdict === 'match').length >= 6,
    'most declared keys match what the card reports');
// Documented: a child manifest's placement keys are the opener's business.
const pxRow = prows.find((r) => r.key === 'windowX');
assert(pxRow && pxRow.verdict === 'ignored by design',
    'windowX in a child manifest is flagged as ignored, per the docs');

pollPinned();
flush();
assert(pinned.reported !== null, 're-polling the card returns fresh state');

closePinned();
flush();
assert(pinned.open === false, 'pinned card closed');

// ═══════════════════════════════════════════════════════════════════════════
// ── window.open(url): the shell handoff ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// Safe to call: headless never shells out — it logs and returns null. Nothing
// here can launch a browser.

assert(typeof window.open === 'function', 'window.open is installed');
const shellRes = shellOpen('mailto:nobody@example.invalid');
assert(shellRes === null,
    'window.open always returns null — there is no popup Window object');
assert(shellState.calls === 1 && shellState.lastUrl === 'mailto:nobody@example.invalid',
    'the panel recorded the handoff');
assert(document.getElementById('shellGo').disabled === true,
    'the leave-the-app button is disarmed by default');

// ── final state ──────────────────────────────────────────────────────────────

closeAll();
flush();
assert(children.length === 0, 'every window closed at the end of the run');
setScale(1);
setPaused(false);

console.log('window-lab smoke: all assertions passed');
