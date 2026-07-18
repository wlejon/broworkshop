// Window Lab — a bench for bro's window and time surfaces.
//
// bro can host real secondary OS windows (each a full app in its own realm,
// DOM, timer set and input route), control the window it lives in at runtime,
// enumerate displays, and scale or freeze one global gameplay clock that every
// document shares. None of it had an app exercising it, so this is that app —
// four panels, each one driving a surface and reading the result straight back:
//
//   windows.js  Secondary windows. Open several at once, retitle/resize/move/
//               focus/close each, and capture() their framebuffers into
//               thumbnails. postMessage both ways with a colour-coded log on
//               both sides and a wall-clock round-trip latency readout.
//   host.js     The host window: borderless, always-on-top, minimize/maximize/
//               restore, position, min/max resize limits, getDisplays() with
//               move-to-display, plus page visibility (the hook a game should
//               pause on) and the battery snapshot.
//   time.js     bro.time. A bouncing-ball field integrated from the rAF
//               timestamp — i.e. from the scaled clock — beside a readout that
//               MEASURES scaled elapsed against wall elapsed. The ratio is the
//               timescale, derived rather than echoed.
//
// app.js owns the single rAF loop and the slow poll, and re-exports the handles
// the smoke test drives.

import { installSystemMenu } from "/lib/system-menu.js";

import {
    children, msgStats, openChild, closeAll, post, broadcast, pingAll,
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

installSystemMenu({
    file: [
        { id: 'file.open', label: 'Open satellite window', accel: 'Ctrl+N' },
        { id: 'file.closeAll', label: 'Close all satellites' },
    ],
    view: [
        { id: 'view.pause', label: 'Pause time', accel: 'Space' },
    ],
    handlers: {
        'file.open': () => openChild(),
        'file.closeAll': () => closeAll(),
        'view.pause': () => setPaused(!bro.time.paused),
    },
});

bindWindowPanel();
bindHostPanel();
bindTimePanel();

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
    children, msgStats, openChild, closeAll, post, broadcast, pingAll,
    captureChild, captureAll, refreshRows,
    visibility, refreshHost, refreshDisplays, refreshBattery,
    clocks, refreshTimeReadout, setScale, setPaused, rebase,
};
