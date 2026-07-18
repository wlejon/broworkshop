// Render Lab — a bench for bro's 3D post-processing stack.
//
// The app is a stage plus a switchboard: `scene_setup.js` builds geometry
// chosen so each effect has something to bite on, and `hud.js` owns every
// call into the post pipeline. app.js only wires the two together, runs the
// camera, and exports the handles later chunks and the smoke test need.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildScene } from "/app/scene_setup.js";
import { buildReflectionRig } from "/app/reflections.js";
import { initDecals } from "/app/decals.js";
import { state, applyPost, bindHud, setFps } from "/app/hud.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// Far plane reaches past the end of the avenue (z = -60) with room to spare,
// so fog and DoF can be pushed to their extremes without geometry popping.
const cam = Camera.createOrbit({
    target: [0, 2.2, -4.0],
    dist: 24,
    fov: 50,
    near: 0.1,
    far: 400,
});

const handles = buildScene(scene);

// Both reflection and decal rigs are scene GEOMETRY plus node state, so they
// must exist before the HUD's first applyPost — bindHud pushes every control
// immediately, and applyPost expects real nodes on the other end.
buildReflectionRig(scene, handles);
initDecals(scene, canvas);

// The HUD seeds itself from index.html's control defaults and immediately
// pushes them, so the first rendered frame already matches the panel.
bindHud(scene);

// CHUNK 3: LOD / custom shaders / asTexture / cullStats attach here too;
// `handles.depthMarkers` already spans the full depth range.

// --- Camera input (right = orbit, middle = pan, wheel = zoom) -----------------
// Left mouse belongs to decals.js, which binds its own mousedown on the canvas.

let rightDown = false, middleDown = false;
function updatePointerLock() {
    const want = rightDown || middleDown;
    const locked = document.pointerLockElement === canvas;
    if (want && !locked) canvas.requestPointerLock();
    else if (!want && locked) document.exitPointerLock();
}
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2)      { rightDown  = true; e.preventDefault(); updatePointerLock(); }
    else if (e.button === 1) { middleDown = true; e.preventDefault(); updatePointerLock(); }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown  = false;
    if (e.button === 1) middleDown = false;
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown)  Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan (cam, e.movementX, e.movementY);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(1.0, cam.dist * Math.exp(e.deltaY * 0.001));
    e.preventDefault();
});

// Space is the fast A/B: the whole point of the demo is seeing the cumulative
// difference, and reaching for the checkbox breaks the comparison.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ') return;
    ev.preventDefault();
    const box = document.getElementById('masterPost');
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
});

// --- Frame loop --------------------------------------------------------------
// Zero scene mutation per frame beyond the camera — post settings only change
// when the HUD says so, which keeps the shadow cache warm while the camera is
// still and makes the FPS readout an honest measure of post-stack cost.

let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();
function frame() {
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    const now = performance.now();
    fpsAccum += now - fpsLast;
    fpsLast = now;
    if (++fpsFrames >= 20) {
        setFps(1000 / (fpsAccum / fpsFrames));
        fpsAccum = 0; fpsFrames = 0;
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { scene, cam, canvas, state, handles, applyPost };

// Re-exported for tests: driving decal placement and probe capture through the
// same entry points the HUD uses keeps the test honest about the real path.
export { placeAt, placeFromRay, placeAtPixel, clearDecals, decalCount } from "/app/decals.js";
export { recaptureProbe, probeActive, probeNode } from "/app/reflections.js";
