// Window Lab — a bench for bro's window and time surfaces: real secondary OS
// windows (each a full app in its own realm, DOM, timers and input route),
// runtime control of the host window, displays, zero-copy buffer handoff, and
// one global gameplay clock that every document shares. Every panel drives a
// surface and reads the result back out of the engine; nothing echoes its
// own inputs.
//
//   windows.js   secondary windows: open / retitle / resize / move / focus /
//                close, capture() thumbnails, postMessage both ways with a
//                wall-clock round-trip readout, window state driven by proxy
//                through the child realm's own bro.window
//   host.js      the host window: flags, state, position, limits, displays,
//                page visibility, battery
//   time.js      bro.time: a ball field on the scaled clock beside a measured
//                scaled/wall ratio
//   game.js      a lunar lander with NO pause flag, frozen and slowed purely
//                by bro.time, plus an eased slow-mo powerup
//   startup.js   bro.json window keys: declared vs live, a bro.json generator,
//                and pinned/, a second app shaped only by its own manifest
//   transfer.js  postMessage transfer lists (detachment as the proof) and the
//                window.open(url) shell handoff
//
// This file is the thin boot: menu, panels, the one rAF loop. Tests import the
// modules above, never this entry.

import { boot, stats } from "/lib/kit/index.js";
import { openChild, closeAll, refreshRows, captureAll, children, bindWindowPanel, logSys } from "/app/windows.js";
import { noteFrame, refreshHost, refreshDisplays, refreshBattery, bindHostPanel } from "/app/host.js";
import { tickTime, setPaused, bindTimePanel } from "/app/time.js";
import { tickGame, triggerSlowmo, bindGamePanel } from "/app/game.js";
import { openPinned, refreshStartupTable, bindStartupPanel } from "/app/startup.js";
import { bindTransferPanel } from "/app/transfer.js";

const app = boot({
    menu: {
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
    },
});

bindWindowPanel();
bindHostPanel();
bindTimePanel();
bindGamePanel();
bindStartupPanel();
bindTransferPanel();

// --- the one frame loop -------------------------------------------------------
// It STOPS while bro.time.paused (rAF is skipped entirely), which is precisely
// what the time panel shows; the host panel's frame counters record it too.

const live = stats('#live');
let fpsFrames = 0, fpsMark = Date.now(), lastPoll = 0;

function frame(t) {
    requestAnimationFrame(frame);
    noteFrame();
    tickTime(t);
    tickGame(t);        // same scaled rAF timestamp: why the lander needs no pause code

    // FPS on the WALL clock: the engine still renders at full rate at 0.5x.
    fpsFrames++;
    const now = Date.now();
    if (now - fpsMark >= 500) {
        live.set('fps', Math.round(fpsFrames * 1000 / (now - fpsMark)));
        fpsFrames = 0;
        fpsMark = now;
    }
    // Geometry has no move event and capture() costs a re-record: poll coarsely.
    if (now - lastPoll >= 500) {
        lastPoll = now;
        refreshRows();
        refreshHost();
        refreshStartupTable();
        if (children.length) captureAll();
    }
}
requestAnimationFrame(frame);

// Displays and battery change rarely and are real syscalls. setInterval is on
// the scaled clock, which is fine at this cadence.
setInterval(() => { refreshDisplays(); refreshBattery(); }, 8000);

// Space toggles the pause, as in every game (not while typing in a field).
document.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    setPaused(!bro.time.paused);
});

logSys(`host window ${window.innerWidth}x${window.innerHeight} on ${bro.window.getDisplays().length} display(s)`);
app.status.ok('ready');
