// orbit.js — CHUNK 2 standalone verification for the impostor billboard layer.
//   ../bro/build/Release/bro-headless.exe demos/isle demos/isle/tests/orbit.js
//
// The isle app auto-boots and owns the fullscreen scene canvas (#c) plus a
// per-frame camera loop. Rather than fight that (a separately appended scene
// canvas does not composite over #c), this test REUSES the app's scene + #c:
// it adds a small controlled cluster (flat ground + a handful of impostor
// billboards) near the origin, hides the boot overlay, and orbits the camera
// by setting it directly right before each screenshot. The island bake runs in
// the background but we shoot before it lands, so the frame shows just sky +
// ground + our billboards.

import { bakeDecidImpostor } from "/app/lib/impostor.js";
import { createImpostorLayer } from "/app/lib/impostorLayer.js";

const canvas = document.getElementById('c');
const scene  = canvas.getContext('scene');
const boot   = document.getElementById('boot');
if (boot) boot.classList.add('hidden');

// Kill the app's per-frame camera loop: its already-queued frame() will run
// once more then reschedule through this no-op and stop, so after one pump the
// app never touches scene.setCamera again and our orbit camera sticks.
window.requestAnimationFrame = function () { return 0; };

function pump(frames, ms) {
    for (let i = 0; i < frames; i++) {
        if (typeof wallSleep === 'function') wallSleep(ms || 8);
        advanceTime(16);
        if (typeof flush === 'function') flush();
    }
}

// --- bake the impostor atlas (headless, no worldgen model) ------------------
console.log('[orbit] baking decid impostor...');
const t0 = Date.now();
const impostor = bakeDecidImpostor({ cols: 8, rows: 8, cell: 128 });
console.log('[orbit] baked ' + impostor.cols + 'x' + impostor.rows +
            ' atlas ' + impostor.width + 'x' + impostor.height +
            ' in ' + (Date.now() - t0) + 'ms  radius=' +
            impostor.bounds.radius.toFixed(2) + '  centerY=' +
            impostor.bounds.center[1].toFixed(2));

// --- controlled cluster placed near the origin ------------------------------
// Flat ground + neutral fill light so the billboards read clearly. (The app's
// HDRI environment also lights them.)
scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [1, 1, 0.96], intensity: 2.0 });
scene.createMesh({ mesh: Mesh.plane(40, 40, 1, 1), x: 0, y: 0, z: 0, color: [0.30, 0.34, 0.22], roughness: 1.0 });

const spots = [
    [0, 0, 0], [5, 0, 1], [-5, 0, -1], [3, 0, -5], [-4, 0, 5],
    [7, 0, -3], [-7, 0, 3], [1, 0, 6], [-1, 0, -7],
];
const xf = [];
let sd = 7;
const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
for (const [x, y, z] of spots) {
    const scale = 0.9 + rnd() * 0.5;
    xf.push(x, y, z, 0, 0, 0, 1, scale, 0);
}
const layer = createImpostorLayer(scene, impostor, xf);
console.log('[orbit] impostor layer: ' + layer.quadCount + ' billboard quads');

// --- orbit + shoot ----------------------------------------------------------
const target = [0, impostor.bounds.center[1] * 1.0, 0];
const dist = 26;

function shoot(azDeg, elevDeg, name) {
    const az = azDeg * Math.PI / 180;
    const el = elevDeg * Math.PI / 180;
    const cx = target[0] + dist * Math.cos(el) * Math.sin(az);
    const cy = target[1] + dist * Math.sin(el);
    const cz = target[2] + dist * Math.cos(el) * Math.cos(az);
    // Set OUR orbit camera last, then render without ticking another rAF.
    scene.setCamera({
        mode: 'perspective', fov: 45, aspect: canvas.width / canvas.height,
        near: 0.1, far: 2000, position: [cx, cy, cz], target, up: [0, 1, 0],
    });
    if (typeof flush === 'function') flush();
    screenshot(name);
    console.log('[orbit] SHOT ' + name + '  az=' + azDeg + ' el=' + elevDeg);
}

pump(6, 8);
shoot(0,   12, 'orbit_az000.png');
shoot(90,  12, 'orbit_az090.png');
shoot(180, 12, 'orbit_az180.png');
shoot(270, 12, 'orbit_az270.png');
shoot(45,  12, 'orbit_az045.png');
shoot(45,  40, 'orbit_el40.png');
shoot(45,  75, 'orbit_el75.png');
// Near-ground, eye-level side view (on-foot look).
shoot(90,  10, 'orbit_el10.png');
console.log('[orbit] done');
