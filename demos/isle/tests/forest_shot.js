// forest_shot.js — verify the L0 terrain forest tint reads as forest from above.
//
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/forest_shot.js
//
// Boots the real island, then screenshots: (1) a high overview of the whole
// island (forest biomes should read as darker canopy-green vs grass/rock/sand),
// (2) a mid aerial over the densest forest. Flora impostors are HIDDEN in the
// overview so we judge the terrain tint alone; shown in the aerial.

import { ready, getTerrain, getFlora, getAtlas } from '/app/app.js';

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const boot   = document.getElementById('boot');

let ok = false;
for (let i = 0; i < 1500; i++) {
    if (typeof wallSleep === 'function') wallSleep(60);
    advanceTime(16);
    if (typeof flush === 'function') flush();
    if (ready()) { ok = true; break; }
}
if (!ok) { console.log('NOT READY'); throw new Error('not ready'); }

const terrain = getTerrain();
const flora   = getFlora();
const atlas   = getAtlas();
if (boot) boot.classList.add('hidden');
window.requestAnimationFrame = function () { return 0; };

const W = atlas.width, H = atlas.height, mpc = atlas.metresPerCell;
const CAP_W = (canvas.clientWidth  | 0) || 1920;
const CAP_H = (canvas.clientHeight | 0) || 1080;
const aspect = CAP_W / CAP_H;

// island centre in world + a high vantage
const midX = atlas.originX + (W * 0.5) * mpc;
const midZ = atlas.originZ + (H * 0.5) * mpc;
const span = W * mpc;

const floraNodes = flora.nodes || [];
function setFlora(v) { floraNodes.forEach(n => { if (n) n.visible = v; }); }

function shoot(name, cam, showFlora) {
    setFlora(showFlora);
    for (let i = 0; i < 40; i++) { terrain.update(cam.position[0], cam.position[1], cam.position[2]); scene.setCamera(cam); flush(); }
    scene.setCamera(cam);
    flush();
    screenshot(name);
    console.log('[forest] SHOT ' + name + '  camY=' + cam.position[1].toFixed(0));
}

// (1) high overview looking down at a slight angle across the whole island
shoot('forest_overview.png', {
    mode: 'perspective', fov: 55, aspect, near: 1, far: 200000,
    position: [midX - span * 0.35, span * 0.55, midZ - span * 0.35],
    target: [midX, 0, midZ], up: [0, 1, 0],
}, false);

// (2) find densest forest for a mid aerial
const isForest = (idx) => {
    if (atlas.elevation[idx] <= 2.0 || atlas.slope[idx] > 0.35) return false;
    const b = atlas.biomes[idx];
    return (b === 4 || b === 7 || b === 10 || b === 11);
};
let best = -1, bx = 0, bz = 0;
for (let z = 6; z < H - 6; z += 2)
    for (let x = 6; x < W - 6; x += 2) {
        const idx = z * W + x;
        if (atlas.elevation[idx] < 20 || atlas.elevation[idx] > 200) continue;
        if (!isForest(idx)) continue;
        let s = 0;
        for (let dz = -6; dz <= 6; dz += 2) for (let dx = -6; dx <= 6; dx += 2) if (isForest((z+dz)*W+(x+dx))) s++;
        if (s > best) { best = s; bx = x; bz = z; }
    }
const fx = atlas.originX + bx * mpc, fz = atlas.originZ + bz * mpc;
const fy = terrain.elevationAt(fx, fz);
shoot('forest_aerial.png', {
    mode: 'perspective', fov: 58, aspect, near: 1, far: 120000,
    position: [fx - 400, fy + 350, fz - 400],
    target: [fx, fy, fz], up: [0, 1, 0],
}, true);

console.log('[forest] done');
