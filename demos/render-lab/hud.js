// hud.js — the control surface. One direction only:
//
//   HUD control -> `state` (by the BINDINGS table) -> applyPost(scene)
//
// applyPost is the ONLY thing that talks to the post stack, which makes the
// A/B master toggle one flag (apply an all-off stack without touching a single
// control) and lets tests drive every effect by mutating `state` and calling
// applyPost, the same path the HUD takes.
//
// Signatures that are easy to guess wrong (docs/scene-api.js):
//   setSSAO({enabled, radius, intensity, bias})
//   setDepthOfField({enabled, focusDistance, focusRange, maxBlur})
//   setBloom({enabled, threshold, intensity, strength})
//   setColorLUT({path, size, amount}) -> boolean; null clears
//   setFXAA(bool) · setMSAA(samples: 0/1 off, 2/4/8) · setRenderScale(0.25..2)
//   setFog({start, end, color, density, heightFalloff, startDistance})
//       every call resets BOTH modes; setFog({}) = off
//   setToneMap({mode, exposure, gamma}) · setAmbient([r, g, b])
//   setSSR({enabled, maxDistance, steps, thickness, intensity, edgeFade})
//
// Probes, decals, LOD, shaders and the monitor are scene NODES, so they live in
// their own modules; this file owns their HUD state and calls their appliers.

import { $ } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { foldPanels } from "/lib/kit/ui.js";
import { applySSR, applyProbe, recaptureProbe } from "./reflections.js";
import { applyDecals, clearDecals } from "./decals.js";
import { setLodDebugColors, setLodDistanceScale, setVisibilityCutoff, setPopFieldEnabled, lodProps } from "./lod.js";
import { applyShaders, clearAllShaders } from "./shaders.js";
import { setMonitorLinked, setSubRenderScale, monitorLinked } from "./monitor.js";

// --- state -------------------------------------------------------------------
// Seeded from the markup by bindHud (the HTML defaults are the single source
// of truth); the literals here only document the shape.

export const state = {
    masterPost: true,

    ssao:   { enabled: true, radius: 0.7, intensity: 1.3, bias: 0.025 },
    dof:    { enabled: false, focusDistance: 14, focusRange: 4, maxBlur: 5 },
    bloom:  { enabled: true, threshold: 1.1, intensity: 0.7, strength: 2.0 },
    lut:    { name: '', amount: 1.0 },
    fxaa:   true,
    msaa:   4,
    renderScale: 1.0,

    fog: {
        mode: 'off',                                           // 'off' | 'linear' | 'exp2'
        color: [0.55, 0.60, 0.70],
        start: 8, end: 60,                                     // linear ramp
        density: 0.028, heightFalloff: 0.22, startDistance: 6, // exp2 + height
    },

    tonemap: { mode: 'aces', exposure: 1.0 },
    ambient: 0.035,

    // A longer maxDistance than the documented default: the courtyard is ~24
    // units deep, and 30 units of ray barely reaches the back wall.
    ssr: { enabled: true, maxDistance: 45, steps: 64, thickness: 0.35, intensity: 1.0, edgeFade: 0.10 },

    // `resolution` is the only field that costs a recapture to change.
    probes: { enabled: true, intensity: 1.0, interior: 1.5, resolution: 256, boxProjection: true, showBounds: false },

    decals: { enabled: true, kind: 'impact', opacity: 1.0, sizeScale: 1.0 },

    // OUTSIDE the A/B gate: LOD, visibility gating, frustum culling and the
    // shadow cache are performance mechanisms, and folding them into a
    // "post on/off" picture comparison would misrepresent them.
    lod: { debugColors: false, distanceScale: 1.0 },
    pop: { enabled: true, cutoff: 46, margin: 3 },

    // Custom shaders and the monitor feed DO join the A/B: they are looks.
    shaders: {
        dissolve: { enabled: true, amount: 0.35, edge: 0.07, scale: 9, sweep: false },
        wave:     { enabled: true, amp: 0.42, freq: 2.1, speed: 1.4 },
        rim:      { enabled: true, power: 3.2, gain: 2.2, scanFreq: 64, scanGain: 0.9 },
    },
    monitor: { enabled: true, renderScale: 1.0 },

    debug: { frustumCulling: true, shadowCache: true },
};

// control id -> [state path, parse]. Ranges and checkboxes arrive typed from
// bindControl; selects arrive as strings and parse here.
const int = (v) => parseInt(v, 10);
const float = (v) => parseFloat(v);
const rgb = (v) => String(v).split(',').map(Number);

const BINDINGS = {
    masterPost: ['masterPost'],
    ssaoOn: ['ssao.enabled'], ssaoRadius: ['ssao.radius'], ssaoIntensity: ['ssao.intensity'], ssaoBias: ['ssao.bias'],
    dofOn: ['dof.enabled'], dofDistance: ['dof.focusDistance'], dofRange: ['dof.focusRange'], dofBlur: ['dof.maxBlur'],
    bloomOn: ['bloom.enabled'], bloomThreshold: ['bloom.threshold'], bloomIntensity: ['bloom.intensity'],
    bloomStrength: ['bloom.strength'],
    lutName: ['lut.name'], lutAmount: ['lut.amount'],
    fxaaOn: ['fxaa'], msaa: ['msaa', int], renderScale: ['renderScale'],
    fogMode: ['fog.mode'], fogColor: ['fog.color', rgb], fogStart: ['fog.start'], fogEnd: ['fog.end'],
    fogDensity: ['fog.density'], fogHeight: ['fog.heightFalloff'], fogStartDist: ['fog.startDistance'],
    tmMode: ['tonemap.mode'], tmExposure: ['tonemap.exposure'], ambient: ['ambient'],
    ssrOn: ['ssr.enabled'], ssrDistance: ['ssr.maxDistance'], ssrSteps: ['ssr.steps'],
    ssrThickness: ['ssr.thickness'], ssrIntensity: ['ssr.intensity'], ssrEdgeFade: ['ssr.edgeFade'],
    probeOn: ['probes.enabled'], probeIntensity: ['probes.intensity'], probeInterior: ['probes.interior'],
    probeRes: ['probes.resolution', int], probeBoxProj: ['probes.boxProjection'], probeBounds: ['probes.showBounds'],
    decalsOn: ['decals.enabled'], decalKind: ['decals.kind'], decalOpacity: ['decals.opacity'],
    decalSize: ['decals.sizeScale'],
    lodDebug: ['lod.debugColors'], lodScale: ['lod.distanceScale'],
    popOn: ['pop.enabled'], popCutoff: ['pop.cutoff'], popMargin: ['pop.margin'],
    dissolveOn: ['shaders.dissolve.enabled'], dissolveAmount: ['shaders.dissolve.amount'],
    dissolveEdge: ['shaders.dissolve.edge'], dissolveScale: ['shaders.dissolve.scale'],
    dissolveSweep: ['shaders.dissolve.sweep'],
    waveOn: ['shaders.wave.enabled'], waveAmp: ['shaders.wave.amp'], waveFreq: ['shaders.wave.freq'],
    waveSpeed: ['shaders.wave.speed'],
    rimOn: ['shaders.rim.enabled'], rimPower: ['shaders.rim.power'], rimGain: ['shaders.rim.gain'],
    rimScanFreq: ['shaders.rim.scanFreq'], rimScanGain: ['shaders.rim.scanGain'],
    monitorOn: ['monitor.enabled'], subScale: ['monitor.renderScale', float],
    frustumOn: ['debug.frustumCulling'], shadowCacheOn: ['debug.shadowCache'],
};

function setPath(path, value) {
    const keys = path.split('.');
    let o = state;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
}

// LUT strips are baked by tools/gen_luts.js: setColorLUT takes a file path,
// not pixels. 16-cube => a 256x16 strip.
const LUT_SIZE = 16;
export const lutPath = (name) => `luts/${name}.bmp`;

// --- apply -------------------------------------------------------------------

/**
 * Push `state` (or, with the master A/B off, an all-effects-off stack) onto
 * the scene. Tonemap and ambient are NOT part of the A/B: they are how HDR
 * reaches the display at all, so switching them off would show a blown-out
 * image rather than "no post".
 */
export function applyPost(scene) {
    const on = state.masterPost;
    const s = state;

    scene.setSSAO(on && s.ssao.enabled ? { ...s.ssao, enabled: true } : { enabled: false });
    scene.setDepthOfField(on && s.dof.enabled ? { ...s.dof, enabled: true } : { enabled: false });
    scene.setBloom(on && s.bloom.enabled ? { ...s.bloom, enabled: true } : { enabled: false });

    // setColorLUT returns false when the strip fails to decode or is not a
    // size² x size image: say so rather than silently rendering ungraded.
    let lutOk = true;
    if (on && s.lut.name) lutOk = scene.setColorLUT({ path: lutPath(s.lut.name), size: LUT_SIZE, amount: s.lut.amount });
    else scene.setColorLUT(null);
    const lut = $('#lutStatus');
    lut.textContent = !s.lut.name ? '' : lutOk ? 'loaded' : 'LOAD FAILED (run tools/gen_luts.js)';
    lut.className = 'k-val ' + (lutOk ? 'ok' : 'warn');

    scene.setFXAA(on && s.fxaa);
    scene.setMSAA(on ? s.msaa : 0);
    scene.setRenderScale(on ? s.renderScale : 1.0);

    // One call configures both fog modes and resets the other's parameters,
    // so each branch passes a complete description.
    const f = s.fog;
    if (!on || f.mode === 'off') scene.setFog({});
    else if (f.mode === 'linear') scene.setFog({ start: f.start, end: f.end, color: f.color });
    else scene.setFog({ color: f.color, density: f.density, heightFalloff: f.heightFalloff, startDistance: f.startDistance });

    scene.setToneMap({ mode: s.tonemap.mode, exposure: s.tonemap.exposure, gamma: 2.2 });
    scene.setAmbient([s.ambient, s.ambient, s.ambient * 1.08]);

    // Reflections and decals join the A/B. The probe is its most dramatic
    // member: with the stack off the metals lose their only specular ambient
    // source and go near-black, which is what "no post" honestly looks like in
    // a scene with no IBL environment.
    applySSR(scene, s.ssr, on);
    applyProbe(scene, s.probes, on);
    applyDecals(s.decals, on);

    applyShaders(s.shaders, on);
    setMonitorLinked(on && s.monitor.enabled);
    setSubRenderScale(s.monitor.renderScale);
    $('#monitorStatus').textContent = monitorLinked() ? 'live' : 'unlinked';

    setLodDebugColors(s.lod.debugColors);
    setLodDistanceScale(s.lod.distanceScale);
    setPopFieldEnabled(s.pop.enabled);
    setVisibilityCutoff(s.pop.cutoff, s.pop.margin);

    scene.setFrustumCulling(s.debug.frustumCulling);
    scene.setShadowCache({ enabled: s.debug.shadowCache });
}

// --- DOM binding -------------------------------------------------------------

const controls = {};
let _scene = null;

function refresh() {
    applyPost(_scene);
    // Only the active fog mode's sliders are meaningful.
    $('#fogLinear').hidden = state.fog.mode !== 'linear';
    $('#fogExp2').hidden = state.fog.mode !== 'exp2';
    $('#masterHint').textContent = state.masterPost
        ? 'on: your settings · off: raw forward render'
        : 'OFF: post / SSR / probe / decals / custom shaders / monitor feed bypassed';
}

/**
 * Set a control and its state together, the way a user would, and re-apply.
 * `id` is the control's id (a BINDINGS key).
 */
export function setControl(id, value) {
    const [path, parse] = BINDINGS[id];
    controls[id].value = value;
    setPath(path, parse ? parse(controls[id].value) : controls[id].value);
    refresh();
}

/** Flip the A/B master switch (the Space key). */
export function toggleMaster() {
    setControl('masterPost', !state.masterPost);
    return state.masterPost;
}

/** Mirror the auto-swept dissolve value onto its slider (no event). */
export function setDissolveReadout(v) {
    controls.dissolveAmount.value = v;
}

/** Wire every control, seed `state` from the markup and apply it once. */
export function bindHud(scene) {
    _scene = scene;
    for (const [id, [path, parse]] of Object.entries(BINDINGS)) {
        const input = $('#' + id);
        const out = document.getElementById(id + 'V');
        controls[id] = bindControl(input, {
            out,
            onChange: (v) => {
                // The auto-sweep owns the dissolve amount while it runs;
                // otherwise the slider and the frame loop fight every frame.
                if (id === 'dissolveAmount' && state.shaders.dissolve.sweep) return;
                setPath(path, parse ? parse(v) : v);
                refresh();
            },
        });
        setPath(path, parse ? parse(controls[id].value) : controls[id].value);
    }

    // Events, not values: a recapture, clearing decals, stripping shaders.
    $('#probeRecapture').addEventListener('click', () => {
        if (recaptureProbe()) $('#probeStatus').textContent = 're-captured';
    });
    $('#decalClear').addEventListener('click', () => { clearDecals(); refresh(); });
    // "Back to standard PBR": clears all three programs and unticks the boxes,
    // so the panel does not claim an effect that is no longer installed.
    $('#shaderClear').addEventListener('click', () => {
        clearAllShaders();
        for (const id of ['dissolveOn', 'waveOn', 'rimOn']) { controls[id].value = false; setPath(BINDINGS[id][0], false); }
        refresh();
    });

    buildLodGrid();
    foldPanels('#hud');
    refresh();
}

// --- live readouts -----------------------------------------------------------

const lodCells = [];

function buildLodGrid() {
    const grid = $('#lodGrid');
    for (let i = 0; i < lodProps().length; ++i) {
        const cell = document.createElement('i');
        cell.textContent = '-';
        grid.appendChild(cell);
        lodCells.push(cell);
    }
}

/**
 * Per-frame LOD readback into the panel. `levels`/`counts` come straight from
 * `node.lodLevel`, what the renderer drew last frame: the HUD never predicts a
 * switch, it reports one.
 */
export function setLodReadout(levels, counts) {
    for (let i = 0; i < lodCells.length && i < levels.length; ++i) {
        const lv = Math.max(0, Math.min(2, levels[i]));
        const cell = lodCells[i];
        if (cell.dataset.lv === String(lv)) continue;
        cell.dataset.lv = String(lv);
        cell.textContent = String(lv);
        cell.className = 'l' + lv;
    }
    $('#lodCounts').textContent = `${counts[0]}/${counts[1]}/${counts[2]}`;
}

/**
 * The cullStats() row, all from the last RENDERED frame: frustum culling off
 * makes `drawn` jump to the full graph; a still camera makes the shadow
 * cache's cached-tile count climb while `rendered` falls away.
 */
export function setCullReadout(s) {
    if (!s) return;
    $('#stMesh').textContent = `${s.meshDrawn} / ${s.meshDrawn + s.meshCulled}`;
    $('#stDecal').textContent = `${s.decalsDrawn} / ${s.decalsDrawn + s.decalsCulled}`;
    $('#stTiles').textContent = `${s.shadowTilesRendered}r ${s.shadowTilesCached}c / ${s.shadowTilesTotal}`;
}

export function setFps(v) {
    $('#fps').textContent = v.toFixed(0) + ' fps';
}
