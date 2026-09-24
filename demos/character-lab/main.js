// Character Lab entry: the panel, the keyboard and the mouse pick. The scene,
// the controller and the frame tick live in lab.js (which tests import; an
// entry module imported by a test is evaluated twice, see ENGINE-ISSUES.md).

import { boot, fpsMeter } from "/lib/kit/index.js";
import { vp, canvas, keys, input, resetToSpawn, resetCrowd, launchBall, pickAtScreen } from "/app/lab.js";
import { bindHud, updateReadout } from "/app/hud.js";

boot();
bindHud();

const MOVE = { w: 1, a: 1, s: 1, d: 1, c: 1, control: 1 };
document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    // Keys typed into a panel control stay there.
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' &&
        e.target.type !== 'range') return;
    keys[k] = true;
    if (k === ' ') { input.jump = true; e.preventDefault(); }
    if (k === 'r') { resetToSpawn(); resetCrowd(); }
    if (k === 'b') launchBall();
    if (MOVE[k]) e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// Left click picks via overlapPoint; right-drag orbit and wheel zoom are the
// kit's orbitControls.
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    pickAtScreen(e.clientX - r.left, e.clientY - r.top);
});

const fps = fpsMeter();
let n = 0;
vp.onFrame(() => {
    fps.tick();
    if (++n % 4 === 0) updateReadout(fps.fps);
});
