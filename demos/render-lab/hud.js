// hud.js — the post-processing control surface.
//
// The HUD is deliberately the ONLY thing that talks to the post stack. It
// works in one direction: DOM controls -> `state` -> `applyPost(scene)`. That
// makes the A/B master toggle trivial (apply a zeroed stack instead of
// `state`, without touching a single control) and makes the headless smoke
// test able to drive every effect by mutating `state` and calling applyPost.
//
// Signatures used here are the ones documented in docs/scene-api.js; the
// notable ones, because they are easy to guess wrong:
//
//   setSSAO({enabled, radius, intensity, bias})
//   setDepthOfField({enabled, focusDistance, focusRange, maxBlur})
//   setBloom({enabled, threshold, intensity, strength})
//   setColorLUT({path, size, amount}) -> boolean, or null to clear
//   setFXAA(boolean | {enabled})
//   setMSAA(samples)            0/1 = off, 2/4/8 typical
//   setRenderScale(s)           clamped 0.25 .. 2.0
//   setFog({start, end, color, density, heightFalloff, startDistance})
//                               every call resets BOTH modes; setFog({}) = off
//   setToneMap({mode, exposure, gamma})
//   setAmbient([r, g, b])
//   setSSR({enabled, maxDistance, steps, thickness, intensity, edgeFade})
//
// Reflection probes and decals are scene NODES rather than render state, so
// they live in their own modules; this file only owns their HUD state and
// calls the appliers those modules export. The dependency runs one way
// (hud -> reflections/decals) on purpose — neither module reads `state`.

import { applySSR, applyProbe, recaptureProbe } from "/app/reflections.js";
import { applyDecals, clearDecals, decalCount } from "/app/decals.js";
import {
    setLodDebugColors, setLodDistanceScale, setVisibilityCutoff,
    setPopFieldEnabled, lodProps,
} from "/app/lod.js";
import { applyShaders, clearAllShaders } from "/app/shaders.js";
import { setMonitorLinked, setSubRenderScale, monitorLinked } from "/app/monitor.js";

const el = (id) => document.getElementById(id);
const num = (id) => parseFloat(el(id).value);

// --- state -------------------------------------------------------------------
// Mirrors the HUD exactly. Exported so tests and later chunks can read/drive it.

export const state = {
    masterPost: true,

    ssao:   { enabled: true, radius: 0.7, intensity: 1.3, bias: 0.025 },
    dof:    { enabled: false, focusDistance: 14, focusRange: 4, maxBlur: 5 },
    bloom:  { enabled: true,  threshold: 1.1, intensity: 0.7, strength: 2.0 },
    lut:    { name: '', amount: 1.0 },
    fxaa:   true,
    msaa:   4,
    renderScale: 1.0,

    fog: {
        mode: 'off',                       // 'off' | 'linear' | 'exp2'
        color: [0.55, 0.60, 0.70],
        start: 8, end: 60,                 // linear ramp
        density: 0.028, heightFalloff: 0.22, startDistance: 6,   // exp2 + height
    },

    tonemap: { mode: 'aces', exposure: 1.0 },
    ambient: 0.035,

    // Screen-space reflections. Defaults are the documented ones except for a
    // longer maxDistance: the courtyard is ~24 units deep, and 30 units of ray
    // is barely enough to reach the back wall from the mirror strip.
    ssr: {
        enabled: true,
        maxDistance: 45, steps: 64, thickness: 0.35,
        intensity: 1.0, edgeFade: 0.10,
    },

    // Local reflection probe over the courtyard interior. `resolution` is the
    // only field that costs a recapture to change.
    probes: {
        enabled: true,
        intensity: 1.0, interior: 1.5, resolution: 256,
        boxProjection: true, showBounds: false,
    },

    decals: { enabled: true, kind: 'impact', opacity: 1.0, sizeScale: 1.0 },

    // --- geometry detail ------------------------------------------------------
    // Deliberately OUTSIDE the A/B gate. LOD, visibility gating, frustum
    // culling and the shadow cache are performance mechanisms whose whole
    // contract is that they do not change the picture (LOD changes it by
    // design, but only at a distance you chose); folding them into a
    // "post on/off" comparison would be dishonest about what the A/B shows.
    lod: { debugColors: false, distanceScale: 1.0 },
    pop: { enabled: true, cutoff: 46, margin: 3 },

    // --- custom shaders -------------------------------------------------------
    // These DO join the A/B: a custom chunk is a look, and switching the stack
    // off should show what the same three props are without it.
    shaders: {
        dissolve: { enabled: true, amount: 0.35, edge: 0.07, scale: 9, sweep: false },
        wave:     { enabled: true, amp: 0.42, freq: 2.1, speed: 1.4 },
        rim:      { enabled: true, power: 3.2, gain: 2.2, scanFreq: 64, scanGain: 0.9 },
    },

    // The sub-scene feed joins the A/B too — with the stack off the monitor
    // drops its texture and shows a blank panel.
    monitor: { enabled: true, renderScale: 1.0 },

    // Debug switches. Not part of the A/B (see above).
    debug: { frustumCulling: true, shadowCache: true },
};

// LUT strips are baked by tools/gen_luts.js — setColorLUT takes a file path,
// not pixel data, so they cannot be generated in-process. 16-cube => 256x16.
const LUT_SIZE = 16;
const lutPath = (name) => `luts/${name}.bmp`;

// --- apply -------------------------------------------------------------------

/**
 * Push `state` (or, when the master A/B toggle is off, an all-effects-off
 * stack) onto the scene. Tonemap and ambient are NOT part of the A/B: they
 * are how HDR reaches the display at all, so switching them off would show a
 * blown-out image rather than "no post".
 */
export function applyPost(scene) {
    const on = state.masterPost;

    if (on && state.ssao.enabled) {
        scene.setSSAO({
            enabled: true,
            radius: state.ssao.radius,
            intensity: state.ssao.intensity,
            bias: state.ssao.bias,
        });
    } else {
        scene.setSSAO({ enabled: false });
    }

    if (on && state.dof.enabled) {
        scene.setDepthOfField({
            enabled: true,
            focusDistance: state.dof.focusDistance,
            focusRange: state.dof.focusRange,
            maxBlur: state.dof.maxBlur,
        });
    } else {
        scene.setDepthOfField({ enabled: false });
    }

    if (on && state.bloom.enabled) {
        scene.setBloom({
            enabled: true,
            threshold: state.bloom.threshold,
            intensity: state.bloom.intensity,
            strength: state.bloom.strength,
        });
    } else {
        scene.setBloom({ enabled: false });
    }

    // setColorLUT returns false when the strip fails to decode or isn't a
    // size²xsize image — surface that instead of silently rendering ungraded.
    let lutOk = true;
    if (on && state.lut.name) {
        lutOk = scene.setColorLUT({
            path: lutPath(state.lut.name),
            size: LUT_SIZE,
            amount: state.lut.amount,
        });
    } else {
        scene.setColorLUT(null);
    }
    const status = el('lutStatus');
    if (status) {
        status.textContent = !state.lut.name ? ''
            : lutOk ? 'loaded' : 'LOAD FAILED — run tools/gen_luts.js';
        status.style.color = lutOk ? '#7bed9f' : '#ff9f6a';
    }

    scene.setFXAA(on && state.fxaa);
    scene.setMSAA(on ? state.msaa : 0);
    scene.setRenderScale(on ? state.renderScale : 1.0);

    // Fog: one call configures both modes and every call resets the other's
    // parameters, so each branch passes a complete description.
    const f = state.fog;
    if (!on || f.mode === 'off') {
        scene.setFog({});
    } else if (f.mode === 'linear') {
        scene.setFog({ start: f.start, end: f.end, color: f.color });
    } else {
        scene.setFog({
            color: f.color,
            density: f.density,
            heightFalloff: f.heightFalloff,
            startDistance: f.startDistance,
        });
    }

    scene.setToneMap({
        mode: state.tonemap.mode,
        exposure: state.tonemap.exposure,
        gamma: 2.2,
    });
    scene.setAmbient([state.ambient, state.ambient, state.ambient * 1.08]);

    // Reflections and decals join the same A/B gate. The probe one is the
    // most dramatic member of the stack: with `on` false the metals lose
    // their only specular ambient source and go near-black, which is exactly
    // what "no post" honestly looks like in a scene with no IBL environment.
    applySSR(scene, state.ssr, on);
    applyProbe(scene, state.probes, on);
    applyDecals(state.decals, on);

    // Custom shaders and the sub-scene feed are looks, so they follow the A/B.
    applyShaders(state.shaders, on);
    setMonitorLinked(on && state.monitor.enabled);
    setSubRenderScale(state.monitor.renderScale);
    const mon = el('monitorStatus');
    if (mon) mon.textContent = monitorLinked() ? 'live' : 'unlinked';

    // Geometry detail and the culling switches do NOT — they are performance
    // mechanisms, and the A/B is a picture comparison.
    setLodDebugColors(state.lod.debugColors);
    setLodDistanceScale(state.lod.distanceScale);
    setPopFieldEnabled(state.pop.enabled);
    setVisibilityCutoff(state.pop.cutoff, state.pop.margin);

    scene.setFrustumCulling(state.debug.frustumCulling);
    scene.setShadowCache({ enabled: state.debug.shadowCache });
}

// --- DOM binding -------------------------------------------------------------

// Every range input has a matching "<id>V" span for its live value; `DECIMALS`
// only records how many digits each one deserves.
const DECIMALS = {
    ssaoRadius: 2, ssaoIntensity: 2, ssaoBias: 3,
    dofDistance: 1, dofRange: 1, dofBlur: 2,
    bloomThreshold: 2, bloomIntensity: 2, bloomStrength: 1,
    lutAmount: 2,
    renderScale: 2,
    fogStart: 1, fogEnd: 0, fogDensity: 3, fogHeight: 2, fogStartDist: 1,
    tmExposure: 2, ambient: 3,
    ssrDistance: 0, ssrSteps: 0, ssrThickness: 2, ssrIntensity: 2, ssrEdgeFade: 2,
    probeIntensity: 2, probeInterior: 1,
    decalOpacity: 2, decalSize: 2,
    lodScale: 2, popCutoff: 0, popMargin: 2,
    dissolveAmount: 2, dissolveEdge: 3, dissolveScale: 1,
    waveAmp: 2, waveFreq: 2, waveSpeed: 2,
    rimPower: 1, rimGain: 2, rimScanFreq: 0, rimScanGain: 2,
};

function readControls() {
    state.masterPost = el('masterPost').checked;

    state.ssao.enabled   = el('ssaoOn').checked;
    state.ssao.radius    = num('ssaoRadius');
    state.ssao.intensity = num('ssaoIntensity');
    state.ssao.bias      = num('ssaoBias');

    state.dof.enabled       = el('dofOn').checked;
    state.dof.focusDistance = num('dofDistance');
    state.dof.focusRange    = num('dofRange');
    state.dof.maxBlur       = num('dofBlur');

    state.bloom.enabled   = el('bloomOn').checked;
    state.bloom.threshold = num('bloomThreshold');
    state.bloom.intensity = num('bloomIntensity');
    state.bloom.strength  = num('bloomStrength');

    state.lut.name   = el('lutName').value;
    state.lut.amount = num('lutAmount');

    state.fxaa = el('fxaaOn').checked;
    state.msaa = parseInt(el('msaa').value, 10);
    state.renderScale = num('renderScale');

    state.fog.mode  = el('fogMode').value;
    state.fog.color = el('fogColor').value.split(',').map(Number);
    state.fog.start = num('fogStart');
    state.fog.end   = num('fogEnd');
    state.fog.density       = num('fogDensity');
    state.fog.heightFalloff = num('fogHeight');
    state.fog.startDistance = num('fogStartDist');

    state.tonemap.mode     = el('tmMode').value;
    state.tonemap.exposure = num('tmExposure');
    state.ambient = num('ambient');

    state.ssr.enabled     = el('ssrOn').checked;
    state.ssr.maxDistance = num('ssrDistance');
    state.ssr.steps       = parseInt(el('ssrSteps').value, 10);
    state.ssr.thickness   = num('ssrThickness');
    state.ssr.intensity   = num('ssrIntensity');
    state.ssr.edgeFade    = num('ssrEdgeFade');

    state.probes.enabled       = el('probeOn').checked;
    state.probes.intensity     = num('probeIntensity');
    state.probes.interior      = num('probeInterior');
    state.probes.resolution    = parseInt(el('probeRes').value, 10);
    state.probes.boxProjection = el('probeBoxProj').checked;
    state.probes.showBounds    = el('probeBounds').checked;

    state.decals.enabled   = el('decalsOn').checked;
    state.decals.kind      = el('decalKind').value;
    state.decals.opacity   = num('decalOpacity');
    state.decals.sizeScale = num('decalSize');

    state.lod.debugColors   = el('lodDebug').checked;
    state.lod.distanceScale = num('lodScale');

    state.pop.enabled = el('popOn').checked;
    state.pop.cutoff  = num('popCutoff');
    state.pop.margin  = num('popMargin');

    const sh = state.shaders;
    sh.dissolve.enabled = el('dissolveOn').checked;
    sh.dissolve.edge    = num('dissolveEdge');
    sh.dissolve.scale   = num('dissolveScale');
    sh.dissolve.sweep   = el('dissolveSweep').checked;
    // The auto-sweep writes `amount` from the frame loop, so the slider only
    // owns it while the sweep is parked — otherwise the two fight every frame.
    if (!sh.dissolve.sweep) sh.dissolve.amount = num('dissolveAmount');

    sh.wave.enabled = el('waveOn').checked;
    sh.wave.amp     = num('waveAmp');
    sh.wave.freq    = num('waveFreq');
    sh.wave.speed   = num('waveSpeed');

    sh.rim.enabled  = el('rimOn').checked;
    sh.rim.power    = num('rimPower');
    sh.rim.gain     = num('rimGain');
    sh.rim.scanFreq = num('rimScanFreq');
    sh.rim.scanGain = num('rimScanGain');

    state.monitor.enabled     = el('monitorOn').checked;
    state.monitor.renderScale = parseFloat(el('subScale').value);

    state.debug.frustumCulling = el('frustumOn').checked;
    state.debug.shadowCache    = el('shadowCacheOn').checked;
}

function refreshLabels() {
    for (const [id, d] of Object.entries(DECIMALS)) {
        const span = el(id + 'V');
        if (span) span.textContent = num(id).toFixed(d);
    }
    // Only the active fog mode's parameters are meaningful — hide the other's
    // so nobody drags a slider that the current mode ignores.
    const mode = el('fogMode').value;
    el('fogLinear').className = 'sub' + (mode === 'linear' ? '' : ' off');
    el('fogExp2').className   = 'sub' + (mode === 'exp2'   ? '' : ' off');

    el('masterHint').textContent = el('masterPost').checked
        ? 'on: your settings · off: raw forward render'
        : 'OFF — post/SSR/probe/decals/custom shaders/monitor feed bypassed';
}

/**
 * Mirror the auto-swept dissolve value back onto its slider, so the control
 * never disagrees with what the shader is actually doing.
 */
export function setDissolveReadout(v) {
    const s = el('dissolveAmount');
    if (s) s.value = String(v);
    const span = el('dissolveAmountV');
    if (span) span.textContent = v.toFixed(2);
}

/** Wire every control to `readControls -> applyPost -> refreshLabels`. */
export function bindHud(scene) {
    const ids = [
        'masterPost',
        'ssaoOn', 'ssaoRadius', 'ssaoIntensity', 'ssaoBias',
        'dofOn', 'dofDistance', 'dofRange', 'dofBlur',
        'bloomOn', 'bloomThreshold', 'bloomIntensity', 'bloomStrength',
        'lutName', 'lutAmount',
        'fxaaOn', 'msaa', 'renderScale',
        'fogMode', 'fogColor', 'fogStart', 'fogEnd',
        'fogDensity', 'fogHeight', 'fogStartDist',
        'tmMode', 'tmExposure', 'ambient',
        'ssrOn', 'ssrDistance', 'ssrSteps', 'ssrThickness', 'ssrIntensity', 'ssrEdgeFade',
        'probeOn', 'probeIntensity', 'probeInterior', 'probeRes',
        'probeBoxProj', 'probeBounds',
        'decalsOn', 'decalKind', 'decalOpacity', 'decalSize',
        'lodDebug', 'lodScale',
        'popOn', 'popCutoff', 'popMargin',
        'dissolveOn', 'dissolveAmount', 'dissolveEdge', 'dissolveScale', 'dissolveSweep',
        'waveOn', 'waveAmp', 'waveFreq', 'waveSpeed',
        'rimOn', 'rimPower', 'rimGain', 'rimScanFreq', 'rimScanGain',
        'monitorOn', 'subScale',
        'frustumOn', 'shadowCacheOn',
    ];
    const onChange = () => { readControls(); applyPost(scene); refreshLabels(); };
    for (const id of ids) {
        const node = el(id);
        if (!node) continue;
        node.addEventListener('input', onChange);
        node.addEventListener('change', onChange);
    }

    // Two buttons rather than sliders: a recapture is an event, not a value,
    // and clearing decals destroys nodes.
    el('probeRecapture').addEventListener('click', () => {
        recaptureProbe();
        const n = el('probeStatus');
        if (n) n.textContent = 're-captured';
    });
    el('decalClear').addEventListener('click', () => {
        clearDecals();
        onChange();
    });

    // "Back to standard PBR" — clears all three programs and unticks the
    // boxes, so the panel does not claim an effect that is no longer installed.
    el('shaderClear').addEventListener('click', () => {
        clearAllShaders();
        for (const id of ['dissolveOn', 'waveOn', 'rimOn']) el(id).checked = false;
        onChange();
    });

    buildLodGrid();
    bindFolding();

    // Seed state FROM the markup so the HTML defaults are the single source of
    // truth for the initial look.
    onChange();
}

// --- folding -----------------------------------------------------------------

/**
 * Fold a section by clicking its heading. Clicks that land on an actual
 * control inside the heading (the several `<h2><label><input>` toggles) must
 * still toggle the control and NOT the fold, or the SSAO checkbox becomes
 * unusable.
 */
function bindFolding() {
    for (const h of document.querySelectorAll('#hud section > h2')) {
        h.addEventListener('click', (ev) => {
            if (ev.target.closest('label, input, select, button')) return;
            h.parentElement.classList.toggle('folded');
        });
    }
}

// --- live readouts -----------------------------------------------------------

let _lodCells = [];

/** One cell per LOD prop, filled in by refreshLodReadout each frame. */
function buildLodGrid() {
    const grid = el('lodGrid');
    if (!grid) return;
    _lodCells = [];
    for (let i = 0; i < lodProps().length; ++i) {
        const cell = document.createElement('i');
        cell.textContent = '-';
        grid.appendChild(cell);
        _lodCells.push(cell);
    }
}

/**
 * Push the per-frame LOD readback into the panel. `levels`/`counts` come
 * straight from `node.lodLevel`, i.e. from what the renderer picked last
 * frame — the HUD never predicts a switch, it reports one.
 */
export function setLodReadout(levels, counts) {
    for (let i = 0; i < _lodCells.length && i < levels.length; ++i) {
        const lv = Math.max(0, Math.min(2, levels[i]));
        const cell = _lodCells[i];
        if (cell._lv === lv) continue;
        cell._lv = lv;
        cell.textContent = String(lv);
        cell.className = 'l' + lv;
    }
    const n = el('lodCounts');
    if (n) n.textContent = `${counts[0]}/${counts[1]}/${counts[2]}`;
}

/**
 * The cullStats() block. Everything here is from the last RENDERED frame, so
 * flipping frustum culling off makes `drawn` jump to the full graph, and
 * holding the camera still makes the shadow cache's `cached` tile count climb
 * while `rendered` falls away.
 */
export function setCullReadout(s) {
    const set = (id, text) => { const n = el(id); if (n) n.textContent = text; };
    set('stMesh',  `${s.meshDrawn} / ${s.meshDrawn + s.meshCulled}`);
    set('stDecal', `${s.decalsDrawn} / ${s.decalsDrawn + s.decalsCulled}`);
    set('stTiles', `${s.shadowTilesRendered}r ${s.shadowTilesCached}c ` +
                   `/ ${s.shadowTilesTotal}`);
}

/** Update the little FPS readout in the HUD header. */
export function setFps(v) {
    const n = el('fps');
    if (n) n.textContent = v.toFixed(0) + ' fps';
}
