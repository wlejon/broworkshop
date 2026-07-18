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

import { scene, cam, state, handles, applyPost } from "/app/app.js";

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
});
step('A/B off',       () => { state.masterPost = false; });
assert(scene.msaa === 0, 'A/B off bypasses MSAA');
assert(scene.renderScale === 1.0, 'A/B off resets render scale');
step('A/B on',        () => { state.masterPost = true; });
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
