// descent.js — CHUNK 3 standalone verification for the L1 canopy shell + the
// pop-free L1<->L2 dither crossfade.
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/descent.js
//
// Reuses the orbit-test harness tricks: the isle app auto-boots and owns the
// fullscreen scene canvas (#c) plus a per-frame camera loop; rather than fight
// that we REUSE the app's scene + #c, hide the boot overlay, and no-op
// requestAnimationFrame so the app stops driving the camera after one pump. We
// then build a standalone forest patch (flat ground + a few hundred impostors +
// the canopy shell over the same patch) and fly a continuous top-down -> ground
// descent, screenshotting at 5 altitudes spanning the crossfade band.

import { bakeDecidImpostor } from '/app/lib/impostor.js';
import { createImpostorLayer } from '/app/lib/impostorLayer.js';
import { createCanopyShell, buildCanopyField, CROSSFADE_DEFAULTS } from '/app/lib/canopyShell.js';

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const boot   = document.getElementById('boot');
if (boot) boot.classList.add('hidden');

// Kill the app's per-frame camera loop (see orbit.js).
window.requestAnimationFrame = function () { return 0; };

function pump(frames, ms) {
    for (let i = 0; i < frames; i++) {
        if (typeof wallSleep === 'function') wallSleep(ms || 8);
        advanceTime(16);
        if (typeof flush === 'function') flush();
    }
}

// --- bake the impostor atlas (headless, no worldgen model) ------------------
console.log('[descent] baking decid impostor...');
let t0 = Date.now();
const impostor = bakeDecidImpostor({ cols: 8, rows: 8, cell: 128 });
console.log('[descent] baked ' + impostor.cols + 'x' + impostor.rows + ' atlas in ' +
            (Date.now() - t0) + 'ms  tintRGB=[' + impostor.tintRGB.join(',') + ']');
const bmin = impostor.bounds.min, bmax = impostor.bounds.max;
console.log('[descent] tree bounds min=[' + bmin.map(v => v.toFixed(2)).join(',') +
            '] max=[' + bmax.map(v => v.toFixed(2)).join(',') + ']');

// Tree geometry: base at y~min.y, top at y~max.y (unscaled), grown upward.
const treeTop  = bmax[1];                                   // unscaled canopy top (m)
const crownRad = Math.max(bmax[0] - bmin[0], bmax[2] - bmin[2]) * 0.5;  // horizontal radius

// --- lighting so non-emissive ground reads; disable fog so the high-altitude
//     roof isn't hazed by aerial perspective at 100m+ ------------------------
scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [1, 1, 0.96], intensity: 2.2 });
if (scene.setFog) scene.setFog(null);

// --- ground: a large flat-ish patch of earthy green -------------------------
const PATCH_HALF = 100;          // 200 m patch
scene.createMesh({ mesh: Mesh.plane(160, 160, 1, 1), x: 0, y: 0, z: 0, color: [0.26, 0.30, 0.19], roughness: 1.0 });

// --- scatter MANY impostors over the patch (seeded) --------------------------
const N = 420;
let sd = 1337;
const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
const xf = [];
for (let i = 0; i < N; i++) {
    const x = (rnd() * 2 - 1) * (PATCH_HALF - 8);
    const z = (rnd() * 2 - 1) * (PATCH_HALF - 8);
    const scale = 0.85 + rnd() * 0.7;      // 0.85 .. 1.55
    xf.push(x, 0, z, 0, 0, 0, 1, scale, 0);
}
console.log('[descent] scattered ' + N + ' impostors over a ' + (PATCH_HALF * 2) + ' m patch');

// --- canopy-height field from the scattered instances -----------------------
const field = buildCanopyField(xf, {
    centerX: 0, centerZ: 0, half: PATCH_HALF,
    res: 224,
    crownWorldY: (py, scale) => py + treeTop * scale,   // ground(py=0) + scaled top
    crownRadius: crownRad,
    lift: 1.5,                                          // shell sits just over the tops
});
const canopyTopY = field.refTopY;
console.log('[descent] canopy field ' + field.width + '^2  topY min/med/max=' +
            field.minTopY.toFixed(1) + '/' + canopyTopY.toFixed(1) + '/' + field.maxTopY.toFixed(1));

// --- the crossfade band (shared IDENTICALLY by both layers) -----------------
const crossfade = {
    canopyTopY,
    fadeLow:  CROSSFADE_DEFAULTS.fadeLow,
    fadeHigh: CROSSFADE_DEFAULTS.fadeHigh,
};

// --- L2 impostor billboards (crossfade ON) ----------------------------------
const layer = createImpostorLayer(scene, impostor, xf, { crossfade });
console.log('[descent] L2 impostor layer: ' + layer.quadCount + ' quads (crossfade on)');

// --- L1 canopy shell over the same patch ------------------------------------
const shell = createCanopyShell(scene, {
    centerX: 0, centerZ: 0, half: PATCH_HALF,
    field,
    canopyTopY,
    tintRGB: impostor.tintRGB,
    subdiv: 128,
    groundY: 0,
    fadeLow:  crossfade.fadeLow,
    fadeHigh: crossfade.fadeHigh,
    noiseTiles: 40,
});
console.log('[descent] L1 canopy shell built @ canopyTopY=' + canopyTopY.toFixed(1) +
            '  band camAbove [' + crossfade.fadeLow + '..' + crossfade.fadeHigh + ']');

// --- descent: top-down -> ground, slight orbit ------------------------------
// camAbove = camY - canopyTopY; t = 1 - smoothstep(fadeLow, fadeHigh, camAbove).
// Altitudes chosen to span: well-above-roof, just-above, mid-band, mostly-trees,
// near-ground-through-trunks.
function shootDown(camAbove, azDeg, name) {
    const camY = canopyTopY + camAbove;
    const az = azDeg * Math.PI / 180;
    // Slight horizontal offset so the top-down view isn't a degenerate straight
    // -down look (keeps a stable up vector); larger offset lower down.
    const horiz = Math.max(8, camY * 0.30);
    const cx = horiz * Math.sin(az);
    const cz = horiz * Math.cos(az);
    const target = [0, canopyTopY * 0.5, 0];
    scene.setCamera({
        mode: 'perspective', fov: 50, aspect: canvas.width / canvas.height,
        near: 0.1, far: 3000, position: [cx, camY, cz], target, up: [0, 1, 0],
    });
    if (typeof flush === 'function') flush();
    screenshot(name);
    console.log('[descent] SHOT ' + name + '  camY=' + camY.toFixed(1) +
                '  camAbove=' + camAbove.toFixed(1));
}

// Near-ground eye-level look (through the trunks / up into the underside).
function shootGround(name) {
    const camY = 2.5;
    const target = [18, canopyTopY * 0.9, 22];   // look forward + slightly up
    scene.setCamera({
        mode: 'perspective', fov: 60, aspect: canvas.width / canvas.height,
        near: 0.05, far: 3000, position: [-14, camY, -18], target, up: [0, 1, 0],
    });
    if (typeof flush === 'function') flush();
    screenshot(name);
    console.log('[descent] SHOT ' + name + '  camY=' + camY.toFixed(1) + ' (ground)');
}

pump(6, 8);
shootDown(120, 20, 'descent_alt0.png');  // well above canopy -> roof
shootDown(40,  20, 'descent_alt1.png');  // just above canopy top
shootDown(27,  20, 'descent_alt2.png');  // inside the transition band (~half/half)
shootDown(10,  20, 'descent_alt3.png');  // just below canopy -> mostly trees
shootGround('descent_alt4.png');         // near ground, through trunks / underside
console.log('[descent] done');
