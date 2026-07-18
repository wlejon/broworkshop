// test_smoke.js — headless integration test for Render Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/render-lab \
//       ../broworkshop/demos/render-lab/tests/test_smoke.js
//
// Asserts the stage actually built, then drives every post-processing control
// through its full range. The bar is "no [js error] lines and no throw" — the
// visual result is a human's job, but a signature drift in the scene API shows
// up here immediately.

import {
    scene, cam, canvas, state, handles, applyPost,
    placeAt, placeFromRay, placeAtPixel, clearDecals, decalCount,
    recaptureProbe, probeActive, probeNode,
} from "/app/app.js";

// Let module evaluation, layout and the first render settle.
advanceTime(64);
flush();

// --- the stage ---------------------------------------------------------------

assert(scene, 'scene context exists');
assert(cam && Array.isArray(cam.pos), 'orbit camera created');
assert(handles.spheres.length === 9, 'roughness sweep has 9 spheres');
assert(handles.metals.length === 3, 'three metal props');
assert(handles.emissives.length >= 7, 'emissive props present for bloom');
assert(handles.lights.sun && handles.lights.sun.castsShadow, 'sun casts shadows');
assert(handles.lights.spot.castsShadow, 'key spot casts shadows');

// Roughness really does sweep across the row (SSR/probes in chunk 2 depend on
// the smooth end being smooth).
assert(handles.spheres[0].roughness < 0.1, 'first sphere is near-mirror');
assert(handles.spheres[8].roughness > 0.9, 'last sphere is fully rough');

// The scene graph reports drawn meshes, which is the real proof geometry made
// it into a frame rather than merely into the graph.
const stats = scene.cullStats();
assert(stats.meshDrawn > 40, `meshes drawn (${stats.meshDrawn})`);

// --- post stack: exercise each effect ----------------------------------------
// Every case mutates `state` and re-applies, exactly the path the HUD takes.

function step(label, mutate) {
    mutate();
    applyPost(scene);
    advanceTime(32);
    flush();
    console.log(`  ok: ${label}`);
}

step('ssao on',       () => { state.ssao.enabled = true; });
step('ssao extremes', () => { state.ssao.radius = 3.0; state.ssao.intensity = 2.5;
                              state.ssao.bias = 0.15; });
step('ssao off',      () => { state.ssao.enabled = false; });

step('dof on',        () => { state.dof.enabled = true; });
step('dof near focus',() => { state.dof.focusDistance = 2; state.dof.focusRange = 0.5;
                              state.dof.maxBlur = 12; });
step('dof far focus', () => { state.dof.focusDistance = 70; state.dof.focusRange = 25; });
step('dof off',       () => { state.dof.enabled = false; });

step('bloom hot',     () => { state.bloom.enabled = true; state.bloom.threshold = 0.1;
                              state.bloom.intensity = 2.0; state.bloom.strength = 6; });
step('bloom off',     () => { state.bloom.enabled = false; });

// Each baked LUT must decode — applyPost reports a failure through the HUD,
// but a missing luts/*.bmp should fail the test loudly, not quietly grade
// nothing.
for (const name of ['neutral', 'warm', 'cool', 'noir']) {
    step(`lut ${name}`, () => { state.lut.name = name; state.lut.amount = 1.0; });
    assert(scene.setColorLUT({ path: `luts/${name}.bmp`, size: 16, amount: 1 }),
           `LUT ${name} decodes (run tools/gen_luts.js if this fails)`);
}
step('lut off',       () => { state.lut.name = ''; });

step('fxaa on',       () => { state.fxaa = true; });
step('fxaa off',      () => { state.fxaa = false; });

for (const s of [0, 2, 4, 8]) step(`msaa ${s}`, () => { state.msaa = s; });
state.msaa = 4;

for (const rs of [0.5, 1.0, 2.0, 1.0]) step(`renderScale ${rs}`,
    () => { state.renderScale = rs; });

step('fog linear',    () => { state.fog.mode = 'linear'; state.fog.start = 4;
                              state.fog.end = 45; });
step('fog exp2+height', () => { state.fog.mode = 'exp2'; state.fog.density = 0.06;
                                state.fog.heightFalloff = 0.5;
                                state.fog.startDistance = 3; });
step('fog off',       () => { state.fog.mode = 'off'; });

for (const m of ['reinhard', 'linear', 'aces']) step(`tonemap ${m}`,
    () => { state.tonemap.mode = m; state.tonemap.exposure = 1.4; });
step('ambient up',    () => { state.ambient = 0.2; });

// --- reflections: SSR --------------------------------------------------------
// The mirror strip is the surface SSR is meant to bite on; if it ever loses
// its low roughness the feature stops being demonstrable.

assert(handles.mirrorStrip, 'polished mirror strip exists for SSR');
assert(handles.mirrorStrip.roughness < 0.06, 'mirror strip is near-mirror smooth');
assert(handles.mirrorStrip.metallic > 0.9, 'mirror strip is metallic');

step('ssr on',        () => { state.ssr.enabled = true; });
step('ssr min',       () => { state.ssr.maxDistance = 1; state.ssr.steps = 4;
                              state.ssr.thickness = 0.02; state.ssr.intensity = 0;
                              state.ssr.edgeFade = 0; });
step('ssr max',       () => { state.ssr.maxDistance = 80; state.ssr.steps = 256;
                              state.ssr.thickness = 2.0; state.ssr.intensity = 2.0;
                              state.ssr.edgeFade = 0.5; });
step('ssr off',       () => { state.ssr.enabled = false; });
step('ssr default',   () => { state.ssr.enabled = true; state.ssr.maxDistance = 45;
                              state.ssr.steps = 64; state.ssr.thickness = 0.35;
                              state.ssr.intensity = 1.0; state.ssr.edgeFade = 0.10; });

// --- reflections: probe ------------------------------------------------------
// The probe is the reason the chrome sphere is not black. Creation, capture,
// live property edits and destroy/recreate all have to survive.

assert(probeActive(), 'probe created by the initial applyPost');
assert(probeNode().type === 'reflectionProbe', 'probe node type');

step('probe recapture', () => {});
assert(recaptureProbe(), 'capture() accepted while the probe exists');
advanceTime(32); flush();

step('probe intensity up', () => { state.probes.intensity = 2.5; });
assert(Math.abs(probeNode().intensity - 2.5) < 1e-5, 'probe intensity is live');

step('probe no box projection', () => { state.probes.boxProjection = false; });
assert(probeNode().boxProjection === false, 'boxProjection is live');
step('probe box projection', () => { state.probes.boxProjection = true; });

step('probe interior fade', () => { state.probes.interior = 4.0; });
step('probe resolution 64', () => { state.probes.resolution = 64; });
step('probe resolution 256', () => { state.probes.resolution = 256; });

step('probe bounds gizmo on',  () => { state.probes.showBounds = true; });
step('probe bounds gizmo off', () => { state.probes.showBounds = false; });

step('probe off', () => { state.probes.enabled = false; });
assert(!probeActive(), 'probe destroyed when switched off');
step('probe on',  () => { state.probes.enabled = true; state.probes.intensity = 1.0;
                          state.probes.interior = 1.5; });
assert(probeActive(), 'probe recreated when switched back on');

// --- decals ------------------------------------------------------------------
// Placement must raise the count, clearing must reset it, and both the ray and
// the pixel entry points have to land a hit.

const preplaced = decalCount();
assert(preplaced >= 10, `startup decals pre-placed (${preplaced})`);

// Straight down onto the floor slab from above — a guaranteed hit.
const byRay = placeFromRay([2.0, 12, -2.0], [0, -1, 0], 'grime');
assert(byRay, 'placeFromRay hit the floor');
assert(decalCount() === preplaced + 1, 'ray placement raised the count');

// Explicit surface + normal, the path the pre-placed wall decals take.
placeAt([-11.6, 3.8, -7.0], [1, 0, 0], 'impact');
assert(decalCount() === preplaced + 2, 'explicit placement raised the count');

// The click path: unproject the middle of the canvas and place there. The
// camera looks into the courtyard, so this should land on geometry.
advanceTime(32); flush();
// unprojectLocal wants canvas-local CSS pixels, so the canvas box is the
// authority here (`scene` has no width/height — those are ShapeNode props).
const cx = Math.round(canvas.clientWidth / 2);
const cy = Math.round(canvas.clientHeight / 2);
assert(cx > 0 && cy > 0, `canvas has a laid-out box (${cx * 2}x${cy * 2})`);
const byPixel = placeAtPixel(cx, cy, 'impact');
assert(byPixel, `placeAtPixel hit geometry at canvas centre (${cx}, ${cy})`);
assert(decalCount() === preplaced + 3, 'pixel placement raised the count');

step('decal opacity down', () => { state.decals.opacity = 0.15; });
step('decal size up',      () => { state.decals.sizeScale = 2.5; });
step('decal size down',    () => { state.decals.sizeScale = 0.3; });
step('decals off',         () => { state.decals.enabled = false; });
step('decals on',          () => { state.decals.enabled = true;
                                   state.decals.opacity = 1.0;
                                   state.decals.sizeScale = 1.0; });

// Decals reach the frame, not just the graph.
const dstats = scene.cullStats();
assert(dstats.decalsDrawn + dstats.decalsCulled === decalCount(),
       `cullStats accounts for every decal (${dstats.decalsDrawn} drawn, ` +
       `${dstats.decalsCulled} culled, ${decalCount()} placed)`);

clearDecals();
applyPost(scene);
advanceTime(32); flush();
assert(decalCount() === 0, 'clearDecals removed every decal');

// Put a presentable set back for the screenshot.
placeAt([-3.1, 0.10, 2.4], [0, 1, 0], 'impact', 0);
placeAt([-5.4, 0.10, -1.2], [0, 1, 0], 'grime', 15);
placeAt([-4.5, 0.10, -6.5], [0, 1, 0], 'blob', 0);
placeAt([ 4.5, 0.10, -6.5], [0, 1, 0], 'blob', 0);
placeAt([-11.6, 3.4, -2.5], [1, 0, 0], 'impact');
applyPost(scene);
assert(decalCount() === 5, 'decals re-placed after the clear');

// --- the A/B master toggle ---------------------------------------------------
// Turn everything on at once, then flip the stack off and back on. This is the
// path most likely to break when a later chunk adds an effect and forgets to
// gate it on `masterPost`.

step('everything on', () => {
    state.ssao.enabled = true;
    state.dof.enabled = true;
    state.bloom.enabled = true;
    state.lut.name = 'warm';
    state.fxaa = true;
    state.msaa = 4;
    state.renderScale = 1.25;
    state.fog.mode = 'exp2';
    state.ssr.enabled = true;
    state.probes.enabled = true;
    state.decals.enabled = true;
});
step('A/B off',       () => { state.masterPost = false; });
assert(scene.msaa === 0, 'A/B off bypasses MSAA');
assert(scene.renderScale === 1.0, 'A/B off resets render scale');
// Chunk 2's effects have to join the A/B, not sit outside it.
assert(!probeActive(), 'A/B off drops the reflection probe');
step('A/B on',        () => { state.masterPost = true; });
assert(probeActive(), 'A/B on restores the reflection probe');
assert(scene.msaa === 4, 'A/B on restores MSAA');
assert(Math.abs(scene.renderScale - 1.25) < 1e-5, 'A/B on restores render scale');

// Back to a presentable default and capture proof.
step('final look', () => {
    state.renderScale = 1.0;
    state.dof.enabled = false;
    state.ssao.enabled = true;        // back to the app's shipped defaults
    state.ssao.radius = 0.7; state.ssao.intensity = 1.3; state.ssao.bias = 0.025;
    state.fxaa = true;
    state.bloom.threshold = 1.1;      // undo the 'bloom hot' stress values
    state.bloom.intensity = 0.7;
    state.bloom.strength = 2.0;
    state.lut.name = '';
    state.fog.mode = 'linear';
    state.fog.start = 12; state.fog.end = 90;
    state.tonemap.exposure = 1.0;
    state.ambient = 0.035;
});
advanceTime(64);
screenshot('render-lab-smoke.png');

console.log('render-lab smoke test PASSED');
