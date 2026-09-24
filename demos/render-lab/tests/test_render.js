// Render Lab: the stage, every post effect through its range, reflections,
// decals and the A/B master toggle, all driven through `state` + applyPost
// (the path the HUD takes). Run: scripts/validate.sh demos/render-lab

import { check, near, test, done, shot } from "/lib/kit/test.js";
import { scene, canvas, state, handles, applyPost } from "/app/lab.js";
import { lutPath } from "/app/hud.js";
import { placeAt, placeFromRay, placeAtPixel, clearDecals, decalCount } from "/app/decals.js";
import { recaptureProbe, probeActive, probeNode } from "/app/reflections.js";
import { lodProps } from "/app/lod.js";
import { shaderNodes } from "/app/shaders.js";
import { monitorLinked } from "/app/monitor.js";
import { step } from "/app/tests/helpers.js";

advanceTime(64);
flush();

test('the stage is built', () => {
    check(handles.spheres.length === 9, 'roughness sweep has 9 spheres');
    check(handles.metals.length === 3, 'three metal props');
    check(handles.emissives.length >= 7, 'emissive props for bloom');
    check(handles.lights.sun.castsShadow && handles.lights.spot.castsShadow, 'sun and key spot cast shadows');
    check(handles.spheres[0].roughness < 0.1 && handles.spheres[8].roughness > 0.9, 'roughness sweeps smooth to rough');
    const stats = scene.cullStats();
    check(stats.meshDrawn > 40, `meshes reach a frame (${stats.meshDrawn})`);
});

test('SSAO, DoF and bloom run through their ranges', () => {
    step(() => { state.ssao.enabled = true; state.ssao.radius = 3.0; state.ssao.intensity = 2.5; state.ssao.bias = 0.15; });
    step(() => { state.ssao.enabled = false; });
    step(() => { state.dof.enabled = true; state.dof.focusDistance = 2; state.dof.focusRange = 0.5; state.dof.maxBlur = 12; });
    step(() => { state.dof.focusDistance = 70; state.dof.focusRange = 25; });
    step(() => { state.dof.enabled = false; });
    step(() => { state.bloom.enabled = true; state.bloom.threshold = 0.1; state.bloom.intensity = 2.0; state.bloom.strength = 6; });
    step(() => { state.bloom.enabled = false; });
});

test('every baked LUT decodes', () => {
    for (const name of ['neutral', 'warm', 'cool', 'noir']) {
        step(() => { state.lut.name = name; state.lut.amount = 1.0; });
        check(scene.setColorLUT({ path: lutPath(name), size: 16, amount: 1 }), `LUT ${name} decodes (tools/gen_luts.js)`);
        check(document.getElementById('lutStatus').textContent === 'loaded', `HUD reports ${name} loaded`);
    }
    step(() => { state.lut.name = ''; });
});

test('AA, render scale, fog and tonemap apply', () => {
    step(() => { state.fxaa = false; });
    step(() => { state.fxaa = true; });
    for (const s of [0, 2, 4, 8]) { step(() => { state.msaa = s; }); check(scene.msaa === s, `msaa ${s} (${scene.msaa})`); }
    for (const rs of [0.5, 2.0, 1.0]) { step(() => { state.renderScale = rs; }); near(scene.renderScale, rs, 1e-5, 'render scale'); }
    step(() => { state.fog.mode = 'linear'; state.fog.start = 4; state.fog.end = 45; });
    step(() => { state.fog.mode = 'exp2'; state.fog.density = 0.06; state.fog.heightFalloff = 0.5; state.fog.startDistance = 3; });
    step(() => { state.fog.mode = 'off'; });
    for (const m of ['reinhard', 'linear', 'aces']) step(() => { state.tonemap.mode = m; state.tonemap.exposure = 1.4; });
    step(() => { state.ambient = 0.2; });
});

test('SSR bites on a real mirror and survives its extremes', () => {
    check(handles.mirrorStrip.roughness < 0.06 && handles.mirrorStrip.metallic > 0.9, 'mirror strip is a mirror');
    step(() => Object.assign(state.ssr, { enabled: true, maxDistance: 1, steps: 4, thickness: 0.02, intensity: 0, edgeFade: 0 }));
    step(() => Object.assign(state.ssr, { maxDistance: 80, steps: 256, thickness: 2.0, intensity: 2.0, edgeFade: 0.5 }));
    step(() => { state.ssr.enabled = false; });
    step(() => Object.assign(state.ssr, { enabled: true, maxDistance: 45, steps: 64, thickness: 0.35, intensity: 1.0, edgeFade: 0.10 }));
});

test('the probe captures, edits live, and is destroyed and recreated', () => {
    check(probeActive() && probeNode().type === 'reflectionProbe', 'probe created by the first applyPost');
    check(recaptureProbe(), 'capture() accepted');
    advanceTime(32); flush();
    step(() => { state.probes.boxProjection = false; });
    check(probeNode().boxProjection === false, 'boxProjection is live');
    step(() => { state.probes.boxProjection = true; });
    step(() => { state.probes.interior = 4.0; });
    near(probeNode().interior, 4.0, 1e-5, 'interior is live');
    step(() => { state.probes.resolution = 64; });
    check(probeNode().resolution === 64, 'resolution change reaches the probe');
    step(() => { state.probes.resolution = 256; });
    step(() => { state.probes.showBounds = true; });
    step(() => { state.probes.showBounds = false; });
    step(() => { state.probes.enabled = false; });
    check(!probeActive(), 'probe destroyed when switched off');
    step(() => { state.probes.enabled = true; state.probes.interior = 1.5; });
    check(probeActive(), 'probe recreated');
});

test('decals place by ray, by surface and by pixel, and clear', () => {
    const pre = decalCount();
    check(pre >= 10, `startup decals pre-placed (${pre})`);
    check(placeFromRay([2.0, 12, -2.0], [0, -1, 0], 'grime'), 'placeFromRay hits the floor');
    check(decalCount() === pre + 1, 'ray placement raised the count');
    placeAt([-11.6, 3.8, -7.0], [1, 0, 0], 'impact');
    check(decalCount() === pre + 2, 'explicit placement raised the count');
    const cx = Math.round(canvas.clientWidth / 2), cy = Math.round(canvas.clientHeight / 2);
    check(placeAtPixel(cx, cy, 'impact'), `placeAtPixel hits geometry at the canvas centre (${cx}, ${cy})`);
    check(decalCount() === pre + 3, 'pixel placement raised the count');
    step(() => { state.decals.opacity = 0.15; state.decals.sizeScale = 2.5; });
    step(() => { state.decals.enabled = false; });
    step(() => Object.assign(state.decals, { enabled: true, opacity: 1.0, sizeScale: 1.0 }));
    const s = scene.cullStats();
    check(s.decalsDrawn + s.decalsCulled === decalCount(),
        `cullStats accounts for every decal (${s.decalsDrawn} + ${s.decalsCulled} vs ${decalCount()})`);
    clearDecals();
    step(() => {});
    check(decalCount() === 0, 'clearDecals removed every decal');
    placeAt([-3.1, 0.10, 2.4], [0, 1, 0], 'impact', 0);
    placeAt([-4.5, 0.10, -6.5], [0, 1, 0], 'blob', 0);
    placeAt([-11.6, 3.4, -2.5], [1, 0, 0], 'impact');
    step(() => {});
    check(document.getElementById('decalCount').textContent === '3 placed', 'the HUD counts them');
});

test('the A/B master toggle bypasses looks and leaves performance switches alone', () => {
    step(() => {
        Object.assign(state, { fxaa: true, msaa: 4, renderScale: 1.25 });
        state.ssao.enabled = state.dof.enabled = state.bloom.enabled = true;
        state.lut.name = 'warm'; state.fog.mode = 'exp2';
        state.ssr.enabled = state.probes.enabled = state.decals.enabled = true;
    });
    const props = lodProps(), sn = shaderNodes();
    const lodBefore = props.map((n) => n.lodCount);
    step(() => { state.masterPost = false; });
    check(scene.msaa === 0 && scene.renderScale === 1.0, 'A/B off bypasses MSAA and render scale');
    check(!probeActive(), 'A/B off drops the probe');
    check(!sn.dissolve.hasShader && !sn.wave.hasShader && !sn.rim.hasShader, 'A/B off strips the custom shaders');
    check(!monitorLinked(), 'A/B off pulls the monitor feed');
    check(props.every((n, i) => n.lodCount === lodBefore[i]), 'A/B off leaves LOD chains alone');
    check(scene.frustumCulling === state.debug.frustumCulling && scene.shadowCache === state.debug.shadowCache,
        'A/B off leaves culling and the shadow cache alone');
    step(() => { state.masterPost = true; });
    check(probeActive() && monitorLinked(), 'A/B on restores probe and monitor');
    check(sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader, 'A/B on reinstalls the shaders');
    check(scene.msaa === 4, 'A/B on restores MSAA');
    near(scene.renderScale, 1.25, 1e-5, 'A/B on restores render scale');
});

step(() => {
    state.renderScale = 1.0; state.dof.enabled = false; state.lut.name = '';
    Object.assign(state.ssao, { enabled: true, radius: 0.7, intensity: 1.3, bias: 0.025 });
    Object.assign(state.bloom, { threshold: 1.1, intensity: 0.7, strength: 2.0 });
    Object.assign(state.fog, { mode: 'linear', start: 12, end: 90 });
    state.tonemap.exposure = 1.0; state.ambient = 0.035;
});
advanceTime(64);
shot('render');
done('render-lab render');
