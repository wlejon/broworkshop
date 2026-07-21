// diag.js — isolate where GPU frame time actually goes.
//
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/diag.js
//
// fps.js's "synced" number pays an ~8 MB glReadPixels EVERY frame that a real
// swapped frame never pays, so it's dominated by a constant readback tax and
// can't see render-cost changes. Here we exploit that: the readback is IDENTICAL
// no matter what's drawn, so the DELTA between "full scene" and "flora hidden"
// (etc.) is the real GPU render cost of that layer. We toggle node.visible and
// measure captureFrame() medians at the same resolution.

import { ready, stats, getTerrain, getFlora, getAtlas } from '/app/app.js';

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

const s = stats();
console.log('READY loadMs=' + s.loadMs.toFixed(0) + ' bakeMs=' + s.bakeMs.toFixed(0) +
            ' atlas=' + s.atlas.w + 'x' + s.atlas.h);

const terrain = getTerrain();
const flora   = getFlora();
const atlas   = getAtlas();
if (boot) boot.classList.add('hidden');
window.requestAnimationFrame = function () { return 0; };

const W = atlas.width, H = atlas.height, mpc = atlas.metresPerCell;
const isForest = (idx) => {
    if (atlas.elevation[idx] <= 2.0) return false;
    if (atlas.slope[idx] > 0.35) return false;
    const b = atlas.biomes[idx];
    return (b === 3 || b === 4 || b === 7 || b === 10 || b === 11 || b === 6 || b === 9);
};
let bestScore = -1, bestX = 0, bestZ = 0;
const RAD = 6;
for (let z = RAD; z < H - RAD; z += 2) {
    for (let x = RAD; x < W - RAD; x += 2) {
        const idx = z * W + x;
        const e = atlas.elevation[idx];
        if (e < 20 || e > 140) continue;
        if (!isForest(idx)) continue;
        let score = 0;
        for (let dz = -RAD; dz <= RAD; dz += 2)
            for (let dx = -RAD; dx <= RAD; dx += 2)
                if (isForest((z + dz) * W + (x + dx))) score++;
        if (score > bestScore) { bestScore = score; bestX = x; bestZ = z; }
    }
}
const cx = atlas.originX + bestX * mpc;
const cz = atlas.originZ + bestZ * mpc;
const gy = terrain.elevationAt(cx, cz);

const CAP_W = (canvas.clientWidth  | 0) || 1920;
const CAP_H = (canvas.clientHeight | 0) || 1080;
const aspect = CAP_W / CAP_H;

const terrainNode = terrain.node;
const floraNodes  = flora.nodes || [];
console.log('[diag] flora nodes=' + floraNodes.length + '  cam target world(' +
            cx.toFixed(0) + ',' + gy.toFixed(1) + ',' + cz.toFixed(0) + ')  @' +
            CAP_W + 'x' + CAP_H);

function setFlora(v)   { floraNodes.forEach(n => { if (n) n.visible = v; }); }
function setTerrain(v) { if (terrainNode) terrainNode.visible = v; }

function med(camOpts, frames) {
    scene.setCamera(camOpts);
    scene.captureFrame(CAP_W, CAP_H); // warm
    const a = new Array(frames);
    for (let i = 0; i < frames; i++) { const t0 = perf.now(); scene.captureFrame(CAP_W, CAP_H); a[i] = perf.now() - t0; }
    a.sort((x, y) => x - y);
    return a[Math.floor(frames / 2)];
}

function makeCam(camY, tx, ty, tz) {
    return { mode: 'perspective', fov: 58, aspect, near: 1, far: 120000,
             position: [cx, camY, cz], target: [tx, ty, tz], up: [0, 1, 0] };
}

function probe(name, cam) {
    // settle clipmap streaming around this camera
    for (let i = 0; i < 30; i++) { terrain.update(cx, cam.position[1], cz); scene.setCamera(cam); flush(); }
    const F = 60;
    setTerrain(true);  setFlora(true);  const full     = med(cam, F);
    setTerrain(true);  setFlora(false); const terrOnly = med(cam, F);
    setTerrain(false); setFlora(true);  const floraOnly= med(cam, F);
    setTerrain(false); setFlora(false); const empty    = med(cam, F);
    setTerrain(true);  setFlora(true);
    const rTerr = terrOnly - empty, rFlora = floraOnly - empty;
    console.log('[diag] ' + name);
    console.log('[diag]   full=' + full.toFixed(2) + 'ms  empty(readback+sky+water)=' + empty.toFixed(2) +
                'ms  => scene render=' + (full - empty).toFixed(2) + 'ms');
    console.log('[diag]   terrain render=' + rTerr.toFixed(2) + 'ms   flora(impostor) render=' + rFlora.toFixed(2) + 'ms');
}

probe('LOWPASS ~30m (worst case, among trees)', makeCam(gy + 30, cx + 300, gy + 18, cz + 300));
probe('AERIAL ~150m',                            makeCam(gy + 150, cx + 150, gy, cz + 150));
probe('HIGH ~1500m',                             makeCam(gy + 1500, cx + 400, gy, cz + 400));
console.log('[diag] done');
