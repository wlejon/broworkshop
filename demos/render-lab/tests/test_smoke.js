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
    lodProps, popPairs, lodDistanceScale, tickLod,
    shaderNodes, shaderInstalled, clearAllShaders,
    subScene, monitorNode, monitorLinked, monitorTexture,
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

// --- LOD chains ---------------------------------------------------------------
// `lodLevel` is a RENDER-time result, so every assertion here has to run after
// a real frame. The distance multiplier is the lever: it rescales both
// thresholds, which lets the test sweep the whole chain without moving the
// camera and losing the rest of the scene's state.

const props = lodProps();
assert(props.length === 12, `twelve LOD props (${props.length})`);
assert(props[0].lodCount === 3, `three levels per chain (${props[0].lodCount})`);

/** Level histogram after a settled frame at the given threshold multiplier. */
function levelsAt(scale) {
    state.lod.distanceScale = scale;
    applyPost(scene);
    advanceTime(32); flush();
    return tickLod();
}

// Far thresholds: everything is inside level 0's range, so nothing has
// switched down yet.
const near = levelsAt(3.0);
assert(near.counts[0] === 12,
       `x3.0 keeps every prop at level 0 (${near.counts.join('/')})`);

// Tight thresholds: every prop is past the last threshold, so the coarsest
// level draws — the documented "beyond the last maxDist the last level keeps
// drawing" behaviour, which is what stops props vanishing at range.
const far = levelsAt(0.15);
assert(far.counts[2] === 12,
       `x0.15 drops every prop to level 2 (${far.counts.join('/')})`);

// And the middle of the sweep must actually pass through level 1 rather than
// jumping the chain — a two-level chain masquerading as three would pass the
// two assertions above.
let sawMid = false;
const walk = [];
for (const s of [2.4, 1.8, 1.4, 1.0, 0.8, 0.6, 0.45, 0.3]) {
    const r = levelsAt(s);
    walk.push(`${s}:${r.counts.join('/')}`);
    if (r.counts[1] > 0) sawMid = true;
}
assert(sawMid, `the sweep passes through level 1 — ${walk.join('  ')}`);
console.log(`  lod sweep: ${walk.join('  ')}`);

// Individual props must MOVE, not just the aggregate. The nearest prop
// (z = -8) and the furthest (z = -58) sit ~50 units apart, so they cannot
// share a level across the whole sweep.
const wide = levelsAt(3.0).levels;
const tight = levelsAt(0.15).levels;
let changed = 0;
for (let i = 0; i < props.length; ++i) if (wide[i] !== tight[i]) changed++;
assert(changed === 12, `every prop changed level across the sweep (${changed}/12)`);

// Back to the shipped default, and confirm the field shows more than one level
// at once — that mixed state is what makes the debug colouring worth looking at.
const mixed = levelsAt(1.0);
assert(Math.abs(lodDistanceScale() - 1.0) < 1e-6, 'multiplier round-trips');
const distinct = mixed.counts.filter((c) => c > 0).length;
assert(distinct >= 2,
       `default view shows several levels at once (${mixed.counts.join('/')})`);

// The debug view is a tint chunk, not a colour write — a MeshNode's `color` is
// fixed at creation (the property is LightNode-only), so `hasShader` is what
// proves the view is installed.
step('lod debug colours on',  () => { state.lod.debugColors = true; });
tickLod();
assert(props.every((n) => n.hasShader), 'debug tint chunk installed on every prop');
step('lod debug colours off', () => { state.lod.debugColors = false; });
assert(props.every((n) => !n.hasShader), 'and removed again');

// --- visibilityRange ----------------------------------------------------------
// A hard gate, not a blend: the pair swaps which node draws, and the gate never
// touches `visible`, so the only honest proof it fired is the drawn count.

const pairs = popPairs();
assert(pairs.length === 8, `eight detail/imposter pairs (${pairs.length})`);

step('pop cutoff far', () => { state.pop.cutoff = 90; state.pop.margin = 3; });
const rFar = pairs[0].detail.visibilityRange;
assert(rFar && rFar.end === 90 && rFar.margin === 3,
       `detail range follows the cutoff (${JSON.stringify(rFar)})`);
const iFar = pairs[0].imposter.visibilityRange;
assert(iFar.begin === 90 && iFar.end > 1e29,
       `imposter takes over past the cutoff (${JSON.stringify(iFar)})`);

// Exactly one half of every pair can be inside its window at a time, so
// toggling the whole field off must remove drawn meshes — and put back the
// same number when it returns.
const withPop = scene.cullStats().meshDrawn;
step('pop field off', () => { state.pop.enabled = false; });
const noPop = scene.cullStats().meshDrawn;
step('pop field on',  () => { state.pop.enabled = true; });
const backPop = scene.cullStats().meshDrawn;
assert(noPop < withPop, `gating the pop field off drops drawn meshes ` +
                        `(${withPop} -> ${noPop})`);
assert(backPop === withPop, `and restores them (${backPop})`);
console.log(`  ok: visibility gate moved ${withPop - noPop} meshes`);

// Zero margin is legal and means a hard switch — the app offers it precisely
// so the strobing it causes is observable.
step('pop margin 0',  () => { state.pop.margin = 0; });
assert(pairs[3].detail.visibilityRange.margin === 0, 'margin 0 round-trips');
step('pop defaults',  () => { state.pop.cutoff = 46; state.pop.margin = 3; });

// --- custom shaders -----------------------------------------------------------
// setShader COMPILES at set time and throws SyntaxError with the driver log on
// bad GLSL, so reaching this line at all means all three chunks built every
// program variant their nodes can render with.

const sn = shaderNodes();
assert(sn.dissolve && sn.wave && sn.rim, 'three shader subjects exist');
assert(Math.abs(sn.wave.cullMargin - 1.6) < 1e-5,
       `the displacing node pads its cull bounds (${sn.wave.cullMargin})`);

step('all shaders on', () => {
    state.shaders.dissolve.enabled = true;
    state.shaders.wave.enabled = true;
    state.shaders.rim.enabled = true;
});
assert(sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader,
       'hasShader true on all three');

// Uniform writes are per-node values, not recompiles — they must survive a
// frame without throwing and without disturbing the installed program.
step('shader uniforms swept', () => {
    state.shaders.dissolve.amount = 0.8;
    state.shaders.dissolve.edge = 0.28;
    state.shaders.dissolve.scale = 22;
    state.shaders.wave.amp = 1.4;
    state.shaders.wave.freq = 5.5;
    state.shaders.wave.speed = 3.6;
    state.shaders.rim.power = 7.5;
    state.shaders.rim.gain = 5.5;
    state.shaders.rim.scanFreq = 180;
    state.shaders.rim.scanGain = 1.8;
});
assert(sn.wave.hasShader, 'uniform sweep left the program installed');

// The auto-sweep drives u_diss from the frame loop; it must actually move.
step('dissolve auto-sweep', () => { state.shaders.dissolve.sweep = true; });
const sweepA = state.shaders.dissolve.amount;
advanceTime(700); flush();
const sweepB = state.shaders.dissolve.amount;
assert(Math.abs(sweepA - sweepB) > 1e-3,
       `auto-sweep animates the burn front (${sweepA.toFixed(3)} -> ` +
       `${sweepB.toFixed(3)})`);
step('dissolve sweep off', () => { state.shaders.dissolve.sweep = false; });

// Each effect clears independently — a shared program cache must not make one
// clearShader() take its neighbours with it.
step('dissolve off', () => { state.shaders.dissolve.enabled = false; });
assert(!sn.dissolve.hasShader, 'dissolve cleared');
assert(sn.wave.hasShader && sn.rim.hasShader, 'the other two survived');
step('wave off', () => { state.shaders.wave.enabled = false; });
assert(!sn.wave.hasShader && sn.rim.hasShader, 'wave cleared alone');

// Re-install: identical chunk source hits the scene's program cache, so this
// is also the "recompilation is not required" path.
step('all shaders back on', () => {
    state.shaders.dissolve.enabled = true;
    state.shaders.wave.enabled = true;
});
assert(sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader,
       're-install round-trips through the program cache');

// The HUD's "back to standard PBR" button.
clearAllShaders();
advanceTime(32); flush();
assert(!sn.dissolve.hasShader && !sn.wave.hasShader && !sn.rim.hasShader,
       'clearShader() on all three returns them to the default pipeline');
step('shaders restored', () => {
    state.shaders.dissolve.enabled = true;
    state.shaders.dissolve.amount = 0.35;
    state.shaders.dissolve.edge = 0.07;
    state.shaders.dissolve.scale = 9;
    state.shaders.wave.enabled = true;
    state.shaders.wave.amp = 0.42;
    state.shaders.wave.freq = 2.1;
    state.shaders.wave.speed = 1.4;
    state.shaders.rim.enabled = true;
    state.shaders.rim.power = 3.2;
    state.shaders.rim.gain = 2.2;
    state.shaders.rim.scanFreq = 64;
    state.shaders.rim.scanGain = 0.9;
});
assert(shaderInstalled().rim, 'rim reinstalled for the final look');

// --- scene-as-texture ---------------------------------------------------------
// The claim under test is "LIVE", not "textured". Proving it needs pixels: park
// the camera on the monitor, freeze everything else in the courtyard, and diff
// two captures separated by real time. If the feed is live the monitor's own
// animation is the ONLY thing that can move, so any difference is the link.

const sub = subScene();
assert(sub && sub !== scene, 'the sub-scene is a separate graph');
assert(monitorNode(), 'the monitor mesh exists');
assert(monitorLinked() && monitorTexture(), 'the live texture link is installed');
assert(monitorTexture().valid, 'SceneTexture reports its source alive');

// The orbit camera in lib/camera.js is driven through `pivot`/`pos`/`rot`, and
// orbitViewOpts reads `pos` directly — `dist` alone moves nothing. Rebuilding
// through createOrbit is therefore the only way to reposition it from a test
// without hand-rolling a quaternion.
const camSave = { pivot: cam.pivot.slice(), pos: cam.pos.slice(),
                  rot: cam.rot.slice(), dist: cam.dist };

function lookFrom(pivot, dist) {
    const c = Camera.createOrbit({ pivot, dist, fov: cam.fov,
                                   near: cam.near, far: cam.far });
    cam.pivot = c.pivot; cam.pos = c.pos; cam.rot = c.rot; cam.dist = c.dist;
    advanceTime(96); flush();
}

function restoreCam() {
    cam.pivot = camSave.pivot.slice();
    cam.pos = camSave.pos.slice();
    cam.rot = camSave.rot.slice();
    cam.dist = camSave.dist;
    advanceTime(64); flush();
}

/** Mean absolute RGB difference between two captures, `ms` apart. */
function frameDelta(ms) {
    advanceTime(64); flush();
    const a = scene.captureFrame(320, 200);
    advanceTime(ms); flush();
    const b = scene.captureFrame(320, 200);
    let sum = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        sum += Math.abs(a.data[i] - b.data[i])
             + Math.abs(a.data[i + 1] - b.data[i + 1])
             + Math.abs(a.data[i + 2] - b.data[i + 2]);
    }
    return sum / (a.data.length / 4 * 3);
}

// Everything else in the courtyard has to hold still, or the measurement is
// meaningless — the wave and rim shaders animate every frame by design.
step('freeze the animated shaders', () => {
    state.shaders.wave.enabled = false;
    state.shaders.rim.enabled = false;
    state.shaders.dissolve.enabled = false;
});
lookFrom([-7.5, 4.3, -11.2], 6.0);

const liveDelta = frameDelta(320);
step('monitor unlinked', () => { state.monitor.enabled = false; });
assert(!monitorLinked(), 'setBaseColorTexture(null) dropped the link');
const deadDelta = frameDelta(320);
step('monitor relinked',  () => { state.monitor.enabled = true; });
assert(monitorLinked(), 'the link comes back');

console.log(`  monitor pixel delta: live ${liveDelta.toFixed(3)} vs ` +
            `unlinked ${deadDelta.toFixed(3)}`);
// The deltas are means over the WHOLE 320x200 capture, and the monitor is only
// a slice of it, so a few tenths of a level is a large signal here — especially
// against an unlinked baseline that comes out at exactly zero.
assert(liveDelta > 0.1,
       `the monitor image changes over time (delta ${liveDelta.toFixed(3)})`);
assert(deadDelta < 0.01,
       `with the feed pulled the frame is pixel-identical over the same ` +
       `interval (delta ${deadDelta.toFixed(3)}) — so the courtyard is still ` +
       `and the motion above can only be the live texture`);

// Sub-scene resolution is its own render target, so it moves independently of
// the courtyard's render scale.
for (const s of [0.25, 0.5, 2.0, 1.0]) {
    step(`sub render scale ${s}`, () => { state.monitor.renderScale = s; });
    assert(Math.abs(sub.renderScale - s) < 1e-5,
           `sub-scene render scale is ${s} (${sub.renderScale})`);
}
assert(Math.abs(scene.renderScale - state.renderScale) < 1e-5,
       'the courtyard render scale was untouched by the sub-scene control');

step('unfreeze the shaders', () => {
    state.shaders.wave.enabled = true;
    state.shaders.rim.enabled = true;
    state.shaders.dissolve.enabled = true;
});

// --- culling and the shadow cache ---------------------------------------------
// Both are strictly conservative, so the ONLY observable is cullStats(). Close
// in first: from the default wide shot the frustum contains the whole graph and
// there is nothing to cull, which would make the toggle look broken.

lookFrom([0, 2.0, -4.0], 5.0);

step('frustum culling on',  () => { state.debug.frustumCulling = true; });
advanceTime(64); flush();
const culled = scene.cullStats();
assert(scene.frustumCulling === true, 'frustumCulling property reflects the toggle');
assert(culled.meshCulled > 0,
       `close in, culling actually rejects meshes (${culled.meshCulled})`);

step('frustum culling off', () => { state.debug.frustumCulling = false; });
advanceTime(64); flush();
const uncalled = scene.cullStats();
assert(scene.frustumCulling === false, 'the property follows the toggle off');
assert(uncalled.meshCulled === 0, 'nothing is culled with culling off');
assert(uncalled.meshDrawn > culled.meshDrawn,
       `drawn count jumps with culling off ` +
       `(${culled.meshDrawn} -> ${uncalled.meshDrawn})`);
assert(uncalled.meshDrawn === culled.meshDrawn + culled.meshCulled,
       'the culled meshes are exactly the ones that come back');
console.log(`  ok: frustum culling ${culled.meshDrawn} drawn / ` +
            `${culled.meshCulled} culled -> ${uncalled.meshDrawn} drawn`);

step('frustum culling back on', () => { state.debug.frustumCulling = true; });

// The shadow cache only pays off while the projection and caster set hold
// still, so the camera must not move across these frames.
step('shadow cache on', () => { state.debug.shadowCache = true; });
for (let i = 0; i < 6; ++i) { advanceTime(32); flush(); }
const cachedStats = scene.cullStats();
assert(scene.shadowCache === true, 'shadowCache property reflects the toggle');
assert(cachedStats.shadowTilesTotal > 0,
       `shadow tiles are allocated (${cachedStats.shadowTilesTotal})`);
assert(cachedStats.shadowTilesCached > 0,
       `a still camera reuses shadow tiles (${cachedStats.shadowTilesCached} ` +
       `of ${cachedStats.shadowTilesTotal})`);

step('shadow cache off', () => { state.debug.shadowCache = false; });
for (let i = 0; i < 6; ++i) { advanceTime(32); flush(); }
const uncached = scene.cullStats();
assert(scene.shadowCache === false, 'the property follows the toggle off');
assert(uncached.shadowTilesCached === 0,
       `no tile is reused with the cache off (${uncached.shadowTilesCached})`);
assert(uncached.shadowTilesRendered === uncached.shadowTilesTotal,
       `every tile re-renders instead ` +
       `(${uncached.shadowTilesRendered}/${uncached.shadowTilesTotal})`);
console.log(`  ok: shadow cache ${cachedStats.shadowTilesCached} cached -> ` +
            `${uncached.shadowTilesCached} with the cache off`);

step('shadow cache back on', () => { state.debug.shadowCache = true; });

restoreCam();

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
const abLodBefore = props.map((n) => n.lodCount);
step('A/B off',       () => { state.masterPost = false; });
assert(scene.msaa === 0, 'A/B off bypasses MSAA');
assert(scene.renderScale === 1.0, 'A/B off resets render scale');
// Reflections have to join the A/B, not sit outside it.
assert(!probeActive(), 'A/B off drops the reflection probe');
// So do the custom shaders and the sub-scene feed — they are looks.
assert(!sn.dissolve.hasShader && !sn.wave.hasShader && !sn.rim.hasShader,
       'A/B off strips every custom shader back to standard PBR');
assert(!monitorLinked(), 'A/B off pulls the monitor feed');
// Geometry detail and culling must NOT: they are performance mechanisms, and
// folding them into a picture comparison would misrepresent both.
assert(props.every((n, i) => n.lodCount === abLodBefore[i]),
       'A/B off leaves the LOD chains alone');
assert(scene.frustumCulling === state.debug.frustumCulling,
       'A/B off leaves frustum culling alone');
assert(scene.shadowCache === state.debug.shadowCache,
       'A/B off leaves the shadow cache alone');

step('A/B on',        () => { state.masterPost = true; });
assert(probeActive(), 'A/B on restores the reflection probe');
assert(sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader,
       'A/B on reinstalls the custom shaders');
assert(monitorLinked(), 'A/B on restores the monitor feed');
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
