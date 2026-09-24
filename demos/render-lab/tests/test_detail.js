// Render Lab: LOD chains, visibility ranges, custom shaders, the live
// sub-scene texture and the culling / shadow-cache switches. Every level and
// count here is read back from a rendered frame. Run: scripts/validate.sh demos/render-lab

import { check, near, test, done } from "/lib/kit/test.js";
import { scene, state } from "/app/lab.js";
import { lodProps, popPairs, lodDistanceScale, tickLod } from "/app/lod.js";
import { shaderNodes, shaderInstalled, clearAllShaders } from "/app/shaders.js";
import { subScene, monitorNode, monitorLinked, monitorTexture } from "/app/monitor.js";
import { step, lookFrom, saveCam, frameDelta } from "/app/tests/helpers.js";

advanceTime(64);
flush();

/** Level histogram after a settled frame at a threshold multiplier. */
function levelsAt(scale) {
    step(() => { state.lod.distanceScale = scale; });
    return tickLod();
}

test('LOD chains sweep through all three levels', () => {
    const props = lodProps();
    check(props.length === 12, `twelve LOD props (${props.length})`);
    check(props[0].lodCount === 3, `three levels per chain (${props[0].lodCount})`);
    const near3 = levelsAt(3.0);
    check(near3.counts[0] === 12, `x3.0 keeps every prop at level 0 (${near3.counts.join('/')})`);
    const far = levelsAt(0.15);
    check(far.counts[2] === 12, `x0.15 drops every prop to level 2 (${far.counts.join('/')})`);
    let sawMid = false;
    const walk = [];
    for (const s of [2.4, 1.8, 1.4, 1.0, 0.8, 0.6, 0.45, 0.3]) {
        const r = levelsAt(s);
        walk.push(`${s}:${r.counts.join('/')}`);
        if (r.counts[1] > 0) sawMid = true;
    }
    check(sawMid, `the sweep passes through level 1: ${walk.join('  ')}`);
    const wide = levelsAt(3.0).levels, tight = levelsAt(0.15).levels;
    check(wide.every((lv, i) => lv !== tight[i]), 'every prop changes level across the sweep');
    const mixed = levelsAt(1.0);
    near(lodDistanceScale(), 1.0, 1e-6, 'multiplier round-trips');
    check(mixed.counts.filter((c) => c > 0).length >= 2, `default view shows several levels (${mixed.counts.join('/')})`);
});

test('the LOD debug tint is a shader chunk installed and removed', () => {
    const props = lodProps();
    step(() => { state.lod.debugColors = true; });
    tickLod();
    check(props.every((n) => n.hasShader), 'tint chunk on every prop');
    step(() => { state.lod.debugColors = false; });
    check(props.every((n) => !n.hasShader), 'and removed again');
});

test('visibility ranges swap detail and imposter', () => {
    const pairs = popPairs();
    check(pairs.length === 8, `eight pairs (${pairs.length})`);
    step(() => { state.pop.cutoff = 90; state.pop.margin = 3; });
    const d = pairs[0].detail.visibilityRange, im = pairs[0].imposter.visibilityRange;
    check(d && d.end === 90 && d.margin === 3, `detail range follows the cutoff (${JSON.stringify(d)})`);
    check(im.begin === 90 && im.end > 1e29, `imposter takes over past it (${JSON.stringify(im)})`);
    const withPop = scene.cullStats().meshDrawn;
    step(() => { state.pop.enabled = false; });
    const noPop = scene.cullStats().meshDrawn;
    step(() => { state.pop.enabled = true; });
    const back = scene.cullStats().meshDrawn;
    check(noPop < withPop && back === withPop, `gating the field drops and restores drawn meshes (${withPop} -> ${noPop} -> ${back})`);
    step(() => { state.pop.margin = 0; });
    check(pairs[3].detail.visibilityRange.margin === 0, 'margin 0 round-trips');
    step(() => { state.pop.cutoff = 46; state.pop.margin = 3; });
});

test('custom shaders install, take uniforms, clear independently', () => {
    const sn = shaderNodes();
    near(sn.wave.cullMargin, 1.6, 1e-5, 'the displacing node pads its cull bounds');
    check(sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader, 'all three installed at boot');
    step(() => {
        Object.assign(state.shaders.dissolve, { amount: 0.8, edge: 0.28, scale: 22 });
        Object.assign(state.shaders.wave, { amp: 1.4, freq: 5.5, speed: 3.6 });
        Object.assign(state.shaders.rim, { power: 7.5, gain: 5.5, scanFreq: 180, scanGain: 1.8 });
    });
    check(sn.wave.hasShader, 'uniform sweep left the programs installed');
    step(() => { state.shaders.dissolve.sweep = true; });
    const a = state.shaders.dissolve.amount;
    for (let i = 0; i < 40; i++) advanceTime(16);
    flush();
    const b = state.shaders.dissolve.amount;
    check(Math.abs(a - b) > 1e-3, `auto-sweep moves the burn front (${a.toFixed(3)} -> ${b.toFixed(3)})`);
    near(+document.getElementById('dissolveAmount').value, b, 0.011, 'the slider follows the sweep');
    step(() => { state.shaders.dissolve.sweep = false; });
    step(() => { state.shaders.dissolve.enabled = false; });
    check(!sn.dissolve.hasShader && sn.wave.hasShader && sn.rim.hasShader, 'dissolve cleared alone');
    step(() => { state.shaders.wave.enabled = false; });
    check(!sn.wave.hasShader && sn.rim.hasShader, 'wave cleared alone');
    step(() => { state.shaders.dissolve.enabled = true; state.shaders.wave.enabled = true; });
    check(sn.dissolve.hasShader && sn.wave.hasShader, 're-install through the program cache');
    clearAllShaders();
    advanceTime(32); flush();
    check(!sn.dissolve.hasShader && !sn.wave.hasShader && !sn.rim.hasShader, 'clearAllShaders returns all three to PBR');
    step(() => { state.shaders.rim.enabled = true; });
    check(shaderInstalled().rim, 'rim reinstalls on the next apply');
});

test('the monitor shows the sub-scene LIVE', () => {
    const sub = subScene();
    check(sub && sub !== scene, 'the sub-scene is a separate graph');
    check(monitorNode() && monitorLinked() && monitorTexture() && monitorTexture().valid, 'live texture link installed');
    const restore = saveCam();
    // Freeze everything else that animates, so the monitor is the only motion.
    step(() => { state.shaders.wave.enabled = state.shaders.rim.enabled = state.shaders.dissolve.enabled = false; });
    lookFrom([-7.5, 4.3, -11.2], 6.0);
    const live = frameDelta(320);
    step(() => { state.monitor.enabled = false; });
    check(!monitorLinked(), 'setBaseColorTexture(null) dropped the link');
    const dead = frameDelta(320);
    step(() => { state.monitor.enabled = true; });
    check(monitorLinked(), 'the link comes back');
    check(live > 0.1, `the monitor image changes over time (delta ${live.toFixed(3)})`);
    check(dead < 0.01, `with the feed pulled the frame holds still (delta ${dead.toFixed(3)})`);
    for (const s of [0.25, 0.5, 2.0, 1.0]) {
        step(() => { state.monitor.renderScale = s; });
        near(sub.renderScale, s, 1e-5, `sub-scene render scale ${s}`);
    }
    near(scene.renderScale, state.renderScale, 1e-5, 'the courtyard render scale is untouched');
    step(() => { state.shaders.wave.enabled = state.shaders.rim.enabled = state.shaders.dissolve.enabled = true; });
    restore();
});

test('frustum culling and the shadow cache move only the counters', () => {
    const restore = saveCam();
    // Close in: from the wide default the frustum holds the whole graph.
    lookFrom([0, 2.0, -4.0], 5.0);
    step(() => { state.debug.frustumCulling = true; });
    advanceTime(64); flush();
    const on = scene.cullStats();
    check(scene.frustumCulling === true && on.meshCulled > 0, `close in, culling rejects meshes (${on.meshCulled})`);
    step(() => { state.debug.frustumCulling = false; });
    advanceTime(64); flush();
    const off = scene.cullStats();
    check(scene.frustumCulling === false && off.meshCulled === 0, 'nothing culled with culling off');
    check(off.meshDrawn === on.meshDrawn + on.meshCulled, `the culled meshes come back (${on.meshDrawn}+${on.meshCulled} vs ${off.meshDrawn})`);
    step(() => { state.debug.frustumCulling = true; });

    step(() => { state.debug.shadowCache = true; });
    for (let i = 0; i < 6; ++i) { advanceTime(32); flush(); }
    const cached = scene.cullStats();
    check(scene.shadowCache === true && cached.shadowTilesTotal > 0, `shadow tiles allocated (${cached.shadowTilesTotal})`);
    check(cached.shadowTilesCached > 0, `a still camera reuses tiles (${cached.shadowTilesCached}/${cached.shadowTilesTotal})`);
    step(() => { state.debug.shadowCache = false; });
    for (let i = 0; i < 6; ++i) { advanceTime(32); flush(); }
    const fresh = scene.cullStats();
    check(fresh.shadowTilesCached === 0 && fresh.shadowTilesRendered === fresh.shadowTilesTotal,
        `with the cache off every tile re-renders (${fresh.shadowTilesRendered}/${fresh.shadowTilesTotal})`);
    step(() => { state.debug.shadowCache = true; });
    restore();
});

done('render-lab detail');
