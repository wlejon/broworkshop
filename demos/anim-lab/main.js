// Animation Lab — bro's skeletal animation tower, on one character.
//
// The entry module stays thin on purpose: lab.js builds the scene and the
// animation tower, actions.js is every operation, hud.js / hud-blend.js are
// the panel. Tests import lab.js and actions.js directly.

import { boot, fpsMeter } from "/lib/kit/index.js";
import { orbitControls } from "/lib/kit/viewport3d.js";
import { canvas, cam, tick } from "/app/lab.js";
import { togglePlay, trigger, selectCamera } from "/app/actions.js";
import { bindHud, updateReadout } from "/app/hud.js";

boot();
bindHud();

// The orbit rig drives the orbit camera NODE (cameras.syncOrbit), so the app
// never calls scene.setCamera — that would deactivate the selected node.
orbitControls(canvas, cam, { minDist: 0.8 });

// Shortcuts for what you reach for while watching rather than reading.
document.addEventListener('keydown', (ev) => {
    switch (ev.key) {
        case ' ': ev.preventDefault(); togglePlay(); break;
        case 'j': case 'J': trigger('jump'); break;
        case 'v': case 'V': trigger('wave'); break;
        case '1': selectCamera('orbit'); break;
        case '2': selectCamera('follow'); break;
        case '3': selectCamera('wide'); break;
    }
});

// bro.time.now is the SCALED clock (ms): it stops when the engine is paused,
// which is the clock a state machine should age on. The pose itself is never
// touched here — the engine advances, blends and skins on its own tick.
const fps = fpsMeter();
let lastClock = bro.time.now;
let n = 0;
function frame() {
    const clock = bro.time.now;
    tick(Math.max(0, (clock - lastClock) / 1000));
    lastClock = clock;
    fps.tick();
    if (++n % 5 === 0) updateReadout(fps.fps);     // a 60 Hz readout is unreadable
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
