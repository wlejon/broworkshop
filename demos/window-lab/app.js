// Window Lab — a bench for bro's window and time surfaces.
//
// bro can host real secondary OS windows (each a full app in its own realm,
// DOM, timer set and input route), control the window it lives in at runtime,
// enumerate displays, hand buffers between realms without copying, and scale or
// freeze one global gameplay clock that every document shares. None of it had
// an app exercising it, so this is that app.
//
// Every panel drives a surface and then reads the result straight back out of
// the engine, so a readout that lied would be visible immediately. Nothing here
// echoes its own inputs.
//
// ── What each module demonstrates ───────────────────────────────────────────
//
//   windows.js   Secondary windows. Open several at once; retitle / resize /
//                move / focus / close each; capture() their framebuffers into
//                live thumbnails (the parent never draws that animation — the
//                child does, in its own realm, on its own timers). postMessage
//                both directions with a colour-coded log on both sides and a
//                wall-clock round-trip latency readout. A second control row
//                per child drives the surface that is NOT on the parent handle
//                — resize limits, borderless, always-on-top, maximize/restore —
//                by proxy through the child realm's own bro.window, which
//                answers with what SDL reports rather than an echo.
//
//   host.js      The window this app lives in: borderless, always-on-top,
//                minimize / maximize / restore, position, min/max resize
//                limits, getDisplays() with move-to-display, plus page
//                visibility (the hook a game should pause on) and the battery
//                snapshot.
//
//   time.js      bro.time. A bouncing-ball field integrated from the rAF
//                timestamp — i.e. from the scaled clock — beside a readout that
//                MEASURES scaled elapsed against wall elapsed. The ratio is the
//                timescale, derived rather than echoed.
//
//   game.js      A playable lunar lander with NO PAUSE FLAG IN IT. This is the
//                thesis made concrete: flight integration, fuel burn, the
//                respawn setTimeout and the pad-beacon setInterval all run on
//                the scaled clock, so `bro.time.paused = true` freezes all four
//                together and `bro.time.scale = 0.3` gives bullet time — with
//                no scale-aware line anywhere in the game. Plus a slow-mo
//                powerup that eases the timescale down and back, showing the
//                dial is continuous rather than a toggle. The smoke test proves
//                the freeze is total by asserting the game's serialized state
//                is character-identical across a paused advanceTime(4000).
//
//   startup.js   bro.json's window keys are parsed once at engine construction
//                and never again, which makes them the least testable surface
//                in the API. This panel puts the declared values beside live
//                bro.window state, generates a bro.json from the current window
//                ("save my setup as startup defaults"), and opens pinned/ — a
//                second app whose OWN manifest sets borderless / alwaysOnTop /
//                limits — with a bare open() so the values it reports back can
//                only have come from that file.
//
//   transfer.js  postMessage's transfer list. An ArrayBuffer handed over rather
//                than copied leaves the sender DETACHED at byteLength 0 while
//                the child's checksum of the arrived bytes matches the one we
//                took before sending — zero-copy and lossless, each proven by a
//                separate measurement. Also window.open(url), the shell handoff
//                that leaves the app, behind a two-step arm.
//
//   child/       The satellite document, and pinned/ the manifest-driven card.
//
// app.js owns the single rAF loop and the slow poll, and re-exports the handles
// the smoke test drives.

import { installSystemMenu } from "/lib/system-menu.js";

import {
    children, msgStats, openChild, closeAll, post, broadcast, pingAll, winctl,
    captureChild, captureAll, refreshRows, bindWindowPanel, logSys,
} from "/app/windows.js";

import {
    visibility, noteFrame, refreshHost, refreshDisplays, refreshBattery,
    bindHostPanel,
} from "/app/host.js";

import {
    clocks, tickTime, refreshTimeReadout, setScale, setPaused, rebase,
    bindTimePanel,
} from "/app/time.js";

import {
    game, slowmo, snapshot, resetShip, tickGame, triggerSlowmo, cancelSlowmo,
    refreshGameHud, bindGamePanel,
} from "/app/game.js";

import {
    manifest, pinned, liveWindowKeys, buildSnippet, refreshSnippet,
    refreshStartupTable, refreshPinnedTable, openPinned, closePinned,
    pollPinned, loadManifests, bindStartupPanel,
} from "/app/startup.js";

import {
    transferState, shellState, sendBlob, sendToAll, shellOpen,
    bindTransferPanel,
} from "/app/transfer.js";

installSystemMenu({
    file: [
        { id: 'file.open', label: 'Open satellite window', accel: 'Ctrl+N' },
        { id: 'file.closeAll', label: 'Close all satellites' },
    ],
    view: [
        { id: 'view.pause', label: 'Pause time', accel: 'Space' },
        { id: 'view.slowmo', label: 'Slow-mo powerup', accel: 'Q' },
        { id: 'view.pinned', label: 'Open pinned card' },
    ],
    handlers: {
        'file.open': () => openChild(),
        'file.closeAll': () => closeAll(),
        'view.pause': () => setPaused(!bro.time.paused),
        'view.slowmo': () => triggerSlowmo(),
        'view.pinned': () => openPinned(),
    },
});

bindWindowPanel();
bindHostPanel();
bindTimePanel();
bindGamePanel();
bindStartupPanel();
bindTransferPanel();

// --- frame loop --------------------------------------------------------------
//
// One rAF for the whole app. Note that this loop STOPS while bro.time.paused —
// rAF callbacks are skipped entirely, which is precisely the behaviour the time
// panel is there to show. The host panel's per-frame counters therefore also
// record the pause, not just the minimize.

const fpsEl = document.getElementById('fps');
let fpsFrames = 0;
let fpsWallMark = Date.now();

// Geometry has no change event for a user-dragged move, and capture() costs a
// re-record, so both are polled on a coarse wall-clock cadence rather than
// every frame.
let lastPollWall = 0;

function frame(t) {
    requestAnimationFrame(frame);
    noteFrame();
    tickTime(t);
    // The lander runs off the same rAF timestamp, which is the same scaled
    // clock. That single fact is why it needs no pause handling of its own.
    tickGame(t);

    // FPS on the WALL clock: an fps number that halved at 0.5x timescale would
    // be measuring the wrong thing — the engine still renders at full rate.
    fpsFrames++;
    const nowWall = Date.now();
    if (nowWall - fpsWallMark >= 500) {
        fpsEl.textContent = Math.round(fpsFrames * 1000 / (nowWall - fpsWallMark));
        fpsFrames = 0;
        fpsWallMark = nowWall;
    }

    if (nowWall - lastPollWall >= 500) {
        lastPollWall = nowWall;
        refreshRows();
        refreshHost();
        // The declared-vs-live table is only interesting if "live" is actually
        // live, so it rides the same coarse poll as the geometry readouts.
        refreshStartupTable();
        if (children.length) captureAll();
    }
}
requestAnimationFrame(frame);

// Displays and battery change rarely and both are real syscalls; a slow wall
// timer via Date.now() inside the frame loop would freeze with the pause, so
// use setInterval and accept that it is scaled — 8 scaled seconds is fine.
setInterval(() => { refreshDisplays(); refreshBattery(); }, 8000);

// Space is the fast pause toggle, the way it is in every game. Skip it when a
// text field has focus so typing a label does not freeze the app.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    setPaused(!bro.time.paused);
});

logSys(`host window ${window.innerWidth}x${window.innerHeight} on ` +
       `${bro.window.getDisplays().length} display(s)`);

export {
    children, msgStats, openChild, closeAll, post, broadcast, pingAll, winctl,
    captureChild, captureAll, refreshRows,
    visibility, refreshHost, refreshDisplays, refreshBattery,
    clocks, refreshTimeReadout, setScale, setPaused, rebase,
    game, slowmo, snapshot, resetShip, triggerSlowmo, cancelSlowmo, refreshGameHud,
    manifest, pinned, liveWindowKeys, buildSnippet, refreshSnippet,
    refreshStartupTable, refreshPinnedTable, openPinned, closePinned,
    pollPinned, loadManifests,
    transferState, shellState, sendBlob, sendToAll, shellOpen,
};
