// Render Lab — a bench for bro's 3D rendering stack.
//
// One courtyard, every renderer feature bro exposes, each on its own switch so
// a human can watch it turn on and off:
//
//   scene_setup.js  the stage: right-angle crevices for SSAO, HDR emissives for
//                   bloom, an avenue receding to z = -60 for fog and DoF, flat
//                   slabs for reflections
//   hud.js          the switchboard: controls -> `state` -> applyPost, one
//                   direction only, so the A/B master toggle is a single flag
//   reflections.js  SSR vs a box-projected reflection probe, independently
//                   switchable so the handoff is visible
//   decals.js       projected decals, raycast onto whatever you click
//   lod.js          setLodMeshes() chains vs visibilityRange detail/imposter
//                   pairs, side by side down the same avenue
//   shaders.js      three setShader() effects (fragment dissolve, vertex wave,
//                   fresnel rim) spliced into the PBR uber-shader
//   monitor.js      a second scene rendered to a texture via asTexture() and
//                   mapped onto a screen in the courtyard, live
//
// The cullStats() row closes the loop: it reports what the renderer drew last
// frame, so LOD switches, visibility gates and the shadow cache are verifiable
// in numbers.
//
// Tests import this module (main.js is only the page entry).

// First on purpose: monitor.js grabs its sub-scene context at module scope, and
// scenes render in getContext order, so the sub-scene must exist before the
// stage context below or the monitor shows last frame.
import { buildMonitor, tickMonitor, subScene } from "./monitor.js";
import { boot } from "/lib/kit/app.js";
import { sceneViewport } from "/lib/kit/viewport3d.js";
import { buildScene } from "./scene_setup.js";
import { buildReflectionRig } from "./reflections.js";
import { initDecals } from "./decals.js";
import { buildLodField, tickLod } from "./lod.js";
import { buildShaderProps, tickShaders } from "./shaders.js";
import { state, applyPost, bindHud, toggleMaster, setFps, setLodReadout, setCullReadout, setDissolveReadout } from "./hud.js";

boot();

// Far plane well past the end of the avenue, so fog and DoF can be pushed to
// their extremes without geometry popping. Left mouse belongs to decals.js.
export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 2.2, -4.0], dist: 24, fov: 50, near: 0.1, far: 400 },
    controls: { minDist: 1.0 },
});
export const { scene, cam, canvas } = vp;

// Everything that is scene GEOMETRY must exist before bindHud: it pushes every
// control once, and applyPost expects real nodes on the other end.
export const handles = buildScene(scene);
buildReflectionRig(scene, handles);
initDecals(vp);
buildLodField(scene, handles);
buildShaderProps(scene, handles);
buildMonitor(scene, handles);
bindHud(scene);

// Space is the fast A/B: reaching for the checkbox breaks the comparison.
document.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ') return;
    ev.preventDefault();
    toggleMaster();
});

// --- frame loop ----------------------------------------------------------------
// The only per-frame scene work is the shader time uniforms, the sub-scene's
// animation and the readouts. Post settings change only when the HUD says so,
// which keeps the shadow cache warm while the camera is still.

let fpsAccum = 0, fpsFrames = 0;

vp.onFrame((dt, t) => {
    tickMonitor(t);
    const swept = tickShaders(state.shaders, state.masterPost, t);
    if (swept !== null) setDissolveReadout(swept);

    // A render-time result: what the renderer chose for the frame just shown.
    const lod = tickLod();

    fpsAccum += dt; fpsFrames++;
    if (fpsFrames >= 20) {
        if (fpsAccum > 0) setFps(fpsFrames / fpsAccum);
        setLodReadout(lod.levels, lod.counts);
        setCullReadout(scene.cullStats());
        fpsAccum = 0; fpsFrames = 0;
    }
});

export { state, applyPost, subScene };
