// Window Lab — headless integration test. Run: scripts/validate.sh demos/window-lab
//
// Secondary windows are exercisable headless: they open hidden, flush() runs
// the drain that materializes them and delivers messages, their timers run on
// virtual time, capture() returns real pixels, and every input-injection seam
// takes a trailing windowId. So these are measurements, not no-throw smoke.
//
// Headless caveats (documented): setPosition / moveToDisplay / focus and
// minimize / maximize / restore no-op, so a test never disturbs the window the
// pipeline renders through.

import { check, eq, near, test, done, frames, q, text, clickOn, setValue, shot } from "/lib/kit/test.js";
import { children, msgStats, openChild, closeAll, post, broadcast, pingAll, winctl,
         captureChild, captureAll } from "/app/windows.js";
import { visibility, refreshHost, refreshDisplays } from "/app/host.js";
import { setScale, setPaused, refreshTimeReadout } from "/app/time.js";
import { game, slowmo, snapshot, resetShip, triggerSlowmo, cancelSlowmo } from "/app/game.js";
import { manifest, pinned, liveWindowKeys, buildSnippet, refreshSnippet, refreshStartupTable,
         refreshPinnedTable, openPinned, closePinned, pollPinned } from "/app/startup.js";
import { transferState, shellState, sendBlob, shellOpen } from "/app/transfer.js";

// The deck is taller than a screen; grow the viewport so every panel is
// hit-testable (injection coordinates are viewport-relative).
resize(1440, 2600);
frames(4);

test('boot: panels bound, status ready, no uncaught errors', () => {
    eq(text('#status'), 'ready');
    eq(document.querySelectorAll('.k-deck > .k-panel').length, 7, 'seven panels');
    check(q('#hostReadout').childElementCount === 7, 'host readout rows built');
    check(/sys/.test(q('#msgLog').lastElementChild.className), 'boot logged to the message log');
});

// ── host window surface ────────────────────────────────────────────────────────

test('host flags and limits round-trip', () => {
    check(['normal', 'minimized', 'maximized', 'fullscreen'].includes(bro.window.state), 'known state ' + bro.window.state);
    bro.window.borderless = true;  eq(bro.window.borderless, true, 'borderless set');
    bro.window.borderless = false; eq(bro.window.borderless, false, 'borderless cleared');
    bro.window.alwaysOnTop = true; eq(bro.window.alwaysOnTop, true, 'alwaysOnTop set');
    bro.window.alwaysOnTop = false;
    bro.window.setMinSize(640, 480);
    eq(bro.window.getMinSize(), { width: 640, height: 480 }, 'min size');
    bro.window.setMaxSize(1600, 1000);
    eq(bro.window.getMaxSize(), { width: 1600, height: 1000 }, 'max size');
    bro.window.setMinSize(0, 0);
    bro.window.setMaxSize(0, 0);
    eq(bro.window.getMinSize().width, 0, 'min clears');
    const p = bro.window.getPosition();
    check(Number.isFinite(p.x) && Number.isFinite(p.y), 'finite position');
});

test('host panel controls drive the window and read back', () => {
    clickOn('#borderless');
    check(bro.window.borderless === true && q('#borderless').checked, 'checkbox set borderless');
    clickOn('#borderless');
    check(bro.window.borderless === false, 'and cleared it');
    q('#minW').value = '700'; q('#minH').value = '500';
    clickOn('#setMin');
    eq(bro.window.getMinSize(), { width: 700, height: 500 }, 'Apply min size');
    check(/700 x 500/.test(text('#hostReadout')), 'readout shows the limit');
    clickOn('#clearMin');
    check(/unconstrained/.test(text('#hostReadout')), 'Clear shows unconstrained');
});

test('displays enumerate and render', () => {
    const displays = refreshDisplays();
    check(displays.length >= 1, 'at least one display');
    const d0 = displays[0];
    check(typeof d0.id === 'number' && d0.name.length > 0, 'id + name');
    check(d0.bounds.width > 0 && d0.workArea.width <= d0.bounds.width, 'sane bounds');
    check(d0.contentScale > 0, 'contentScale');
    check(displays.some((d) => d.isPrimary), 'one primary');
    eq(document.querySelectorAll('#displays .display').length, displays.length, 'one row per display');
    check(screen.width > 0 && screen.availWidth > 0 && screen.colorDepth === 24, 'window.screen');
});

// ── a secondary window ─────────────────────────────────────────────────────────

const rec = openChild({ width: 360, height: 420 });

test('open(): handle, panel row, header count', () => {
    check(rec.win.id > 0 && rec.win.closed === false, 'fresh handle');
    eq(children.length, 1);
    eq(text('#winCount'), '1');
    check(q('#winEmpty').hidden, 'empty note hidden');
    flush();
    check(rec.loaded, "child's load fired");
    eq(rec.win.getSize(), { width: 360, height: 420 }, 'requested size');
});

test('parent -> child: proven by the content of the acks', () => {
    flush();
    check(rec.acks >= 1 && rec.lastAck.of === 'accent', 'accent acked');
    eq(rec.lastAck.color, rec.accent, 'exact accent payload');
    post(rec, { type: 'label', text: 'Probe-42' });
    flush();
    eq([rec.lastAck.of, rec.lastAck.text], ['label', 'Probe-42'], 'label payload');
    post(rec, { type: 'spin', value: 2.5 });
    flush();
    eq(rec.lastAck.value, 2.5, 'numeric payload intact');
});

test('panel controls post to the child', () => {
    q('#labelInput').value = 'FromPanel';
    clickOn('#sendLabel');
    flush();
    eq(rec.lastAck.text, 'FromPanel', 'Send button reached the child');
    setValue('#spin', 250);
    flush();
    eq(rec.lastAck.value, 2.5, 'spin slider broadcast');
    eq(text('#spinV'), '2.50×');
    clickOn('#swatches > button:nth-child(3)');
    flush();
    eq(rec.lastAck.color, '#22c55e', 'swatch accent reached the child');
});

test('ping / pong round trip on the wall clock', () => {
    const before = msgStats.received;
    pingAll();
    flush();
    check(msgStats.received > before, 'pong came back');
    check(msgStats.lastPingMs >= 0, 'latency measured');
    check(/latency \d+ ms/.test(text('#pingV')), 'latency shown');
});

test('child -> parent: a click injected into the CHILD window', () => {
    check(rec.lastClick === undefined, 'no clicks yet');
    click(180, 120, 0, rec.win.id);
    flush();
    eq(rec.clicks, 1, 'one click reported');
    check(rec.lastClick.x >= 0 && rec.lastClick.x <= 240, 'child-computed canvas coords');
    click(180, 120, 0);                     // main window
    flush();
    eq(rec.clicks, 1, 'a main-window click never reaches the child');
});

test("the child's own timer runs and reports", () => {
    advanceTime(5200);
    flush();
    check(rec.ticks >= 5, 'ticks ' + rec.ticks);
});

test('capture(): real pixels from the child framebuffer', () => {
    const s = captureChild(rec);
    eq([s.width, s.height, s.data.length], [360, 420, 360 * 420 * 4], 'full RGBA frame');
    const seen = new Set();
    for (let i = 0; i < s.data.length; i += 4 * 997) seen.add((s.data[i] << 16) | (s.data[i + 1] << 8) | s.data[i + 2]);
    check(seen.size > 3, 'non-uniform content (' + seen.size + ' colours)');
    eq(rec.lastCapture.bytes, s.data.length, 'panel recorded the capture');
    // The child styles itself with /lib/kit/kit.css: its body background is the kit's --k-bg.
    eq(Array.from(s.data.slice((5 * 360 + 5) * 4, (5 * 360 + 5) * 4 + 3)), [0x0c, 0x0e, 0x12], 'kit --k-bg in the child');
});

test('geometry setters round-trip', () => {
    rec.win.setTitle('Retitled');
    rec.win.setSize(420, 300);
    flush();
    eq(rec.win.getSize(), { width: 420, height: 300 }, 'setSize');
    const p = rec.win.getPosition();
    check(Number.isFinite(p.x), 'finite child position');
    rec.win.setPosition(200, 150);          // no-op while hidden; must not throw
    rec.win.focus();
});

const b = openChild({ width: 300, height: 320 });
const c = openChild({ width: 300, height: 320 });

test('several windows at once; broadcast reaches all', () => {
    flush();
    eq(children.length, 3);
    check(b.win.id !== c.win.id && b.win.id !== rec.win.id, 'distinct ids');
    check(b.loaded && c.loaded, 'all loaded');
    eq(captureAll(), 3, 'captured all three');
    eq(document.querySelectorAll('#winList .win-row').length, 3, 'three rows');
    const acks = msgStats.acks;
    broadcast({ type: 'accent', color: '#ff00ff' });
    flush();
    eq(msgStats.acks, acks + 3, 'three acks');
    check(b.lastAck.color === '#ff00ff' && c.lastAck.color === '#ff00ff', 'verbatim payload');
});

test('closing: event once, row and count follow, double close is a no-op', () => {
    let fired = 0;
    c.win.addEventListener('close', () => fired++);
    c.win.close();
    flush();
    eq(fired, 1);
    check(c.win.closed && children.indexOf(c) === -1, 'closed and unlisted');
    eq(text('#winCount'), '2');
    eq(document.querySelectorAll('#winList .win-row').length, 2, 'row removed');
    c.win.close();
    flush();
    eq(fired, 1, 'no re-fire');
    eq(c.win.capture(), null, 'capture on a closed window');
    clickOn('#closeAll');
    flush();
    eq(children.length, 0);
    check(!q('#winEmpty').hidden, 'empty note back');
});

// ── bro.time ───────────────────────────────────────────────────────────────────

test('paused freezes the scaled clock; scale multiplies it', () => {
    setScale(1);
    setPaused(false);
    let t = bro.time.now; advanceTime(500);
    near(bro.time.now - t, 500, 1, 'scale 1');
    setPaused(true);
    t = bro.time.now; advanceTime(1000);
    eq(bro.time.now - t, 0, 'paused');
    eq(text('#pause'), 'Resume');
    check(q('#pause').classList.contains('active'), 'pause button lit');
    setPaused(false);
    t = bro.time.now; advanceTime(200);
    near(bro.time.now - t, 200, 1, 'resumed');
    setScale(2);
    t = bro.time.now; advanceTime(500);
    near(bro.time.now - t, 1000, 1, 'scale 2');
    setScale(0.25);
    t = bro.time.now; advanceTime(800);
    near(bro.time.now - t, 200, 1, 'scale 0.25');
    setScale(1);
    refreshTimeReadout();
    bro.time.scale = -5;  check(bro.time.scale >= 0, 'negative clamped');
    bro.time.scale = 1000; check(bro.time.scale <= 100, 'huge clamped');
    setScale(1);
});

test('time panel presets and header readout', () => {
    clickOn('#timePresets [data-scale="0.25"]');
    eq(bro.time.scale, 0.25);
    eq(text('#timeMode'), '0.25×');
    eq(text('#scaleV'), '0.25×');
    clickOn('#timePresets [data-scale="1"]');
    eq(bro.time.scale, 1);
});

test('visibility and battery', () => {
    check(typeof document.hidden === 'boolean', 'document.hidden');
    advanceTime(64);
    check(visibility.framesWhileVisible > 0, 'frames counted while visible');
    refreshHost();
    check(typeof navigator.getBattery === 'function', 'getBattery');
    let bat = null;
    navigator.getBattery().then((x) => { bat = x; });
    frames(2);
    check(bat && typeof bat.charging === 'boolean' && bat.level >= 0 && bat.level <= 1, 'battery snapshot');
    check(/%/.test(text('#battery')), 'battery panel filled');
});

// ── the pause-aware lander ─────────────────────────────────────────────────────
// game.js has no pause flag and no scale-aware line: everything below measures
// the ENGINE's behaviour, not the game's.

test('lander advances at scale 1', () => {
    setScale(1); setPaused(false); resetShip(true); advanceTime(64);
    const s0 = snapshot(), sim0 = game.simMs, f0 = game.frames;
    advanceTime(1000);
    check(snapshot() !== s0 && game.frames > f0, 'state advanced');
    near(game.simMs - sim0, 1000, 60, 'integrated ~1000 scaled ms');
});

test('PAUSED: lander state is character-identical across 8 s of advanceTime', () => {
    setPaused(true);
    const frozen = snapshot(), scaled = bro.time.now, beacon = game.beacon;
    advanceTime(4000); flush(); advanceTime(4000); flush();
    eq(snapshot(), frozen, 'identical serialization');
    eq(bro.time.now, scaled, 'scaled clock frozen');
    eq(game.beacon, beacon, "the game's setInterval did not tick");
    setPaused(false);
    advanceTime(64);
    check(snapshot() !== frozen, 'resuming moves it again');
});

test('0.25x runs the lander at a quarter rate; rAF cadence unchanged', () => {
    setScale(1); advanceTime(200);
    let s = game.simMs; advanceTime(2000); const full = game.simMs - s;
    setScale(0.25); advanceTime(200);
    s = game.simMs; advanceTime(2000); const quarter = game.simMs - s;
    check(quarter > 0 && full / quarter > 3.5 && full / quarter < 4.5, `ratio ${(full / quarter).toFixed(2)}`);
    setScale(1);
    let f = game.frames; advanceTime(1000); const fFull = game.frames - f;
    setScale(0.25);
    f = game.frames; advanceTime(1000);
    eq(game.frames - f, fFull, 'same number of rAF callbacks');
    setScale(1);
});

test('slow-mo powerup eases the timescale down and back', () => {
    check(!slowmo.active && bro.time.scale === 1, 'idle at 1');
    check(triggerSlowmo() === true && slowmo.active, 'triggered');
    check(triggerSlowmo() === false, 'second trigger refused');
    const samples = [];
    for (let i = 0; i < 14; i++) { advanceTime(280); samples.push(+bro.time.scale.toFixed(3)); }
    const min = Math.min(...samples);
    check(min <= 0.31, 'reached 0.30x (min ' + min + ')');
    check(samples.some((v) => v > min + 0.02 && v < 0.999), 'passed through intermediate values');
    check(new Set(samples).size >= 4, 'at least four distinct values');
    advanceTime(4000);
    check(!slowmo.active && Math.abs(bro.time.scale - 1) < 1e-9, 'released back to exactly 1');
    eq(slowmo.uses, 1);
});

test('slow-mo cancels, and a pause freezes the ramp', () => {
    triggerSlowmo(); advanceTime(400);
    check(bro.time.scale < 1, 'under way');
    check(cancelSlowmo() === true && bro.time.scale === 1, 'cancel restored 1');
    check(cancelSlowmo() === false, 'idle cancel is a no-op');
    triggerSlowmo(); advanceTime(200);
    const mid = bro.time.scale, left = slowmo.framesLeft;
    setPaused(true); advanceTime(3000);
    check(bro.time.scale === mid && slowmo.framesLeft === left, 'ramp frozen while paused');
    setPaused(false); cancelSlowmo(); setScale(1); resetShip(true);
});

test('lander panel: buttons and HUD', () => {
    clickOn('#gameSlowmo');
    check(slowmo.active, 'Slow-mo button triggered it');
    cancelSlowmo();
    advanceTime(500);
    clickOn('#gameReset');
    eq([game.attempts, game.landings, game.crashes], [1, 0, 0], 'Reset run');
    frames(2);
    check(/px/.test(text('#gameHud')) && text('#gameStatus').length > 0, 'HUD filled');
    setScale(1);
});

// ── transfer list: zero-copy proven by detachment ──────────────────────────────

const xr = openChild({ width: 320, height: 260 });

test('copy control: the sender keeps its buffer', () => {
    flush();
    check(xr.loaded, 'target loaded');
    const r = sendBlob(xr, 8192, false);
    eq([r.before, r.after, r.detached], [8192, 8192, false]);
    flush();
    check(transferState.intact === true, 'checksum matched');
});

test('transfer: sender DETACHED, child checksum matches', () => {
    const r = sendBlob(xr, 65536, true);
    eq([r.before, r.after, r.detached], [65536, 0, true]);
    eq(transferState.lastMode, 'transfer');
    flush();
    eq(transferState.lastAck.bytes, 65536, 'all bytes arrived');
    eq(transferState.lastAck.checksum, transferState.lastChecksum, 'checksum');
    eq(transferState.lastAck.last, (65535 * 31 + 255 * 7) & 0xff, 'real edge byte');
    check(/DETACHED/.test(text('#xferReadout')), 'readout says detached');
    const probe = new Uint8Array(64), buf = probe.buffer;
    xr.win.postMessage({ type: 'blob', tag: 999, buf }, [buf]);
    check(buf.byteLength === 0 && probe.length === 0, 'raw handle postMessage detaches buffer and view');
    flush();
});

test('transfer: a view whose buffer is in the transfer list arrives intact', () => {
    const acks = transferState.acks;
    const v = new Uint8Array(32);
    v[31] = 7;
    xr.win.postMessage({ type: 'blob', tag: 998, buf: v }, [v.buffer]);
    flush();
    eq(transferState.acks, acks + 1, 'the child acknowledged it');
    eq(transferState.lastAck.last, 7, 'last byte');
});

test('transfer panel buttons', () => {
    const sends = transferState.sends;
    clickOn('#xferSend');
    flush();
    eq(transferState.sends, sends + 1, 'Transfer button sent one');
    eq(transferState.lastMode, 'transfer');
    clickOn('#xferCopy');
    flush();
    eq(transferState.lastMode, 'copy');
    check(transferState.intact === true, 'copy intact');
});

// ── per-child window state, driven through the child realm ─────────────────────
// Resize limits live on the child realm's own bro.window; the child answers
// with what it read back.

test('per-child limits and flags read back from the child realm', () => {
    check(typeof xr.win.setMinSize === 'undefined', 'the parent handle has no limit setters');
    winctl(xr, 'minSize', { width: 280, height: 240 });
    flush();
    eq(xr.winState.min, [280, 240], 'min');
    winctl(xr, 'maxSize', { width: 900, height: 720 });
    flush();
    eq(xr.winState.max, [900, 720], 'max');
    winctl(xr, 'borderless', { value: true }); flush();
    eq(xr.winState.borderless, true, 'borderless');
    winctl(xr, 'borderless', { value: false }); flush();
    winctl(xr, 'alwaysOnTop', { value: true }); flush();
    eq(xr.winState.alwaysOnTop, true, 'alwaysOnTop');
    winctl(xr, 'alwaysOnTop', { value: false });
    winctl(xr, 'minSize', { width: 0, height: 0 });
    winctl(xr, 'maxSize', { width: 0, height: 0 });
    flush();
    eq([xr.winState.min[0], xr.winState.max[0]], [0, 0], 'cleared');
});

// A child realm's bro.window drives its own window, not the host's.
test('per-child limits leave the host window alone', () => {
    bro.window.setMinSize(0, 0);
    winctl(xr, 'minSize', { width: 280, height: 240 });
    flush();
    eq(bro.window.getMinSize(), { width: 0, height: 0 }, 'host min size after a child set its own');
    winctl(xr, 'minSize', { width: 0, height: 0 });
    flush();
    bro.window.setMinSize(0, 0);
});

xr.win.close();
flush();

// ── bro.json startup keys ──────────────────────────────────────────────────────

test('declared vs live: drift and match', () => {
    for (let i = 0; i < 8 && !manifest.loaded; i++) frames(3);
    check(manifest.loaded, '/app/bro.json read');
    eq(manifest.keys.title, 'Window Lab');
    eq([manifest.keys.minWidth, manifest.keys.minHeight], [900, 600]);
    bro.window.setMinSize(0, 0);
    let rows = refreshStartupTable();
    let row = rows.find((r) => r.key === 'minWidth');
    eq([row.declared, row.live, row.verdict], [900, 0, 'drifted']);
    bro.window.setMinSize(900, 600);
    rows = refreshStartupTable();
    row = rows.find((r) => r.key === 'minWidth');
    eq([row.live, row.verdict], [900, 'match']);
    const bl = rows.find((r) => r.key === 'borderless');
    eq([bl.declared, bl.verdict], [undefined, 'not declared']);
    eq(document.querySelectorAll('#startupTable .krow').length, rows.length + 1, 'table rows rendered');
    const live = liveWindowKeys();
    eq([live.minWidth, live.minHeight], [900, 600]);
    eq(live.title, document.title);
    check(live.display >= 0, 'display is an index');
});

test('generated bro.json snippet', () => {
    bro.window.setMinSize(640, 480);
    bro.window.setMaxSize(0, 0);
    bro.window.alwaysOnTop = true;
    const s = buildSnippet();
    eq([s.minWidth, s.minHeight, s.alwaysOnTop], [640, 480, true]);
    check(!('maxWidth' in s) && !('borderless' in s) && !('windowX' in s), 'defaults and position omitted');
    eq([s.lib, s.app], [manifest.keys.lib, '.'], 'foreign keys carried through');
    const p = buildSnippet({ includePosition: true });
    check(Number.isFinite(p.windowX) && Number.isFinite(p.windowY), 'position on request');
    const txt = refreshSnippet();
    eq(JSON.parse(txt).title, document.title);
    eq(q('#startupSnippet').textContent, txt, 'panel shows it');
    clickOn('#snipPos');
    check('windowX' in JSON.parse(text('#startupSnippet')), 'pin-position checkbox regenerates');
    clickOn('#snipPos');
    bro.window.alwaysOnTop = false;
    bro.window.setMinSize(900, 600);
});

test('the pinned card takes its size from its own manifest', () => {
    check(pinned.manifest && pinned.manifest.borderless === true && pinned.manifest.alwaysOnTop === true, 'manifest read');
    const w = openPinned();
    flush();
    check(pinned.open, 'opened');
    eq(w.getSize(), { width: pinned.manifest.width, height: pinned.manifest.height }, 'bare open() sized by bro.json');
    flush();
    check(pinned.reported !== null, 'the card reported back');
    const rows = refreshPinnedTable();
    check(rows.length > 0, 'pinned table rendered');
    eq(rows.find((r) => r.key === 'windowX').verdict, 'ignored by design');
    pollPinned();
    flush();
    check(pinned.reported !== null, 're-poll');
});

test("the pinned card's manifest flags and limits reached its window", () => {
    const r = pinned.reported, m = pinned.manifest;
    eq([r.borderless, r.alwaysOnTop], [true, true], 'borderless + alwaysOnTop');
    eq([r.minWidth, r.minHeight, r.maxWidth, r.maxHeight], [m.minWidth, m.minHeight, m.maxWidth, m.maxHeight], 'limits');
});

test('pinned card closes', () => {
    clickOn('#closePinned');
    flush();
    check(!pinned.open, 'closed');
});

// ── window.open(url): the shell handoff (headless never shells out) ────────────

test('window.open(url) returns null; the go button is armed in two steps', () => {
    eq(shellOpen('mailto:nobody@example.invalid'), null);
    eq([shellState.calls, shellState.lastUrl], [1, 'mailto:nobody@example.invalid']);
    check(q('#shellGo').disabled, 'disarmed by default');
    clickOn('#shellPresets [data-url^=mailto]');
    eq(q('#shellUrl').value, 'mailto:someone@example.com', 'preset fills the url');
    clickOn('#shellArm');
    check(!q('#shellGo').disabled, 'armed');
    clickOn('#shellGo');
    eq(shellState.calls, 2, 'fired once');
    check(q('#shellGo').disabled && !q('#shellArm').checked, 'firing disarms');
});

closeAll();
flush();
setScale(1);
setPaused(false);
frames(4);
shot('main');
done('window-lab');
