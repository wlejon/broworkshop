// Render Lab — a bench for bro's 3D rendering stack.
//
// One courtyard, every renderer feature bro exposes, each on its own switch so
// a human can watch it turn on and off. What it demonstrates, and where:
//
//   scene_setup.js  The stage. Geometry chosen so each effect has something to
//                   bite on: right-angle crevices for SSAO, HDR emissives for
//                   bloom, an avenue receding to z = -60 for fog and DoF, flat
//                   slabs for reflections.
//   hud.js          The switchboard. DOM controls -> `state` -> `applyPost`,
//                   one direction only, which is what makes the A/B master
//                   toggle a one-liner and lets the smoke test drive every
//                   feature through exactly the path the HUD uses.
//   reflections.js  SSR vs a box-projected reflection probe — the accurate,
//                   screen-bound technique against the stable, off-screen one,
//                   independently switchable so you can watch the handoff.
//   decals.js       Projected decals, raycast onto whatever you click.
//   lod.js          setLodMeshes() chains and visibilityRange gating: one node
//                   with several geometries versus a hard detail/imposter
//                   swap, side by side down the same avenue.
//   shaders.js      Three setShader() effects — a fragment dissolve, a vertex
//                   displacement wave, a fresnel rim — spliced into the PBR
//                   uber-shader, with their uniforms on live sliders.
//   monitor.js      A second scene rendered to a texture via asTexture() and
//                   mapped onto a screen in the courtyard, live.
//
// The header's cullStats() row and the culling section close the loop: they
// report what the renderer actually drew last frame, so the LOD switches, the
// visibility gates and the shadow cache are all verifiable in numbers rather
// than by squinting.
//
// app.js only wires the modules together, runs the camera, drives the
// per-frame uniforms and readouts, and exports the handles the smoke test
// needs.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
// Imported first on purpose: monitor.js grabs its sub-scene context at module
// scope, and scenes render in getContext order — so the sub-scene must be
// created before the stage canvas below, or the monitor shows last frame.
import { buildMonitor, tickMonitor } from "/app/monitor.js";
import { buildScene } from "/app/scene_setup.js";
import { buildReflectionRig } from "/app/reflections.js";
import { initDecals } from "/app/decals.js";
import { buildLodField, tickLod } from "/app/lod.js";
import { buildShaderProps, tickShaders } from "/app/shaders.js";
import {
    state, applyPost, bindHud, setFps,
    setLodReadout, setCullReadout, setDissolveReadout,
} from "/app/hud.js";

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

// LOD props, shader subjects and the monitor are all scene geometry, so they
// have to exist before bindHud's first applyPost pushes state at them.
buildLodField(scene, handles);
buildShaderProps(scene, handles);
buildMonitor(scene, handles);

// The HUD seeds itself from index.html's control defaults and immediately
// pushes them, so the first rendered frame already matches the panel.
bindHud(scene);

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
// The only per-frame scene mutation is the camera, the shader time uniforms
// and the sub-scene's animation. Post settings still change only when the HUD
// says so, so the shadow cache stays warm while the camera is still — which
// is exactly the state the culling readout is most interesting in.
//
// Uniform pushes are deliberately not batched into applyPost: setShaderUniform
// is a per-node value write with no compile behind it, whereas applyPost
// reconfigures the whole stack. Mixing the two would make every frame pay for
// a HUD-rate operation.

let fpsAccum = 0, fpsFrames = 0, fpsLast = performance.now();
const t0 = performance.now();

function frame() {
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));

    const now = performance.now();
    const timeSec = (now - t0) / 1000;

    tickMonitor(timeSec);
    const swept = tickShaders(state.shaders, state.masterPost, timeSec);
    if (swept !== null) setDissolveReadout(swept);

    // LOD levels are a render-time result, so this reads back what the
    // renderer chose for the frame we just presented.
    const lod = tickLod();

    fpsAccum += now - fpsLast;
    fpsLast = now;
    if (++fpsFrames >= 20) {
        setFps(1000 / (fpsAccum / fpsFrames));
        fpsAccum = 0; fpsFrames = 0;
    }

    // Readouts refresh at a readable rate rather than every frame — the
    // numbers are for humans, and a 60 Hz counter is unreadable.
    if (fpsFrames % 6 === 0) {
        setLodReadout(lod.levels, lod.counts);
        setCullReadout(scene.cullStats());
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { scene, cam, canvas, state, handles, applyPost };

// Re-exported for tests: the LOD, shader and sub-scene surfaces the smoke test
// asserts against, through the same entry points the HUD drives.
export { lodProps, popPairs, lodDistanceScale, tickLod } from "/app/lod.js";
export { shaderNodes, shaderInstalled, clearAllShaders } from "/app/shaders.js";
export { subScene, monitorNode, monitorLinked, monitorTexture } from "/app/monitor.js";

// Re-exported for tests: driving decal placement and probe capture through the
// same entry points the HUD uses keeps the test honest about the real path.
export { placeAt, placeFromRay, placeAtPixel, clearDecals, decalCount } from "/app/decals.js";
export { recaptureProbe, probeActive, probeNode } from "/app/reflections.js";
