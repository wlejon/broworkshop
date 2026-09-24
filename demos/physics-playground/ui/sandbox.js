// ui/sandbox.js — the Sandbox tab: step rate + interpolation, spawning, the
// selected-body editor, area fields, the layer matrix and the lane legend.
//
// One direction: control -> state -> a Physics.* call. The single exception is
// the selected-body editor, which seeds itself from Physics.getBodyProperties
// so it shows the body's real state. Every control's path is an exported
// function, so the tests drive exactly the line a human does.

import { $, h, clear } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { segmented } from "/lib/kit/ui.js";
import { LAYER_NAMES, SPAWN_LAYERS, LAYER_COLORS, getMatrix, setPair, resetLayers } from "../sim/layers.js";
import { AREA_DEFS, areas, setAreaEnabled, setAreaParam } from "../sim/areas.js";
import { stage, MATERIALS } from "../sim/stage.js";
import { bodies, bodyCount, spawn, rain, materialRace, clearAll, despawn, SHAPE_KINDS } from "../sim/spawn.js";
import { setFocus } from "../sim/contacts.js";

export const state = {
    stepHz: 60,
    interpolation: false,
    spawnShape: 'box',
    spawnLayer: 'player',
    spawnFriction: 0.5,
    spawnRestitution: 0.35,
    selected: null,              // body tag or null
    frictionCombine: 'default',
    restitutionCombine: 'default',
};

export const COMBINE_MODES = ['default', 'average', 'min', 'multiply', 'max'];

let simPanel = null, selPanel = null, fricSeg = null, restSeg = null;
const sel = { mass: 1, friction: 0.5, restitution: 0.3, linearDamping: 0.05, angularDamping: 0.05, gravityFactor: 1 };

// --- simulation rate + interpolation --------------------------------------------
//
// The engine steps the world at this fixed rate while rendering runs free, so
// at 15 Hz a body's true pose updates four times per ~60 rendered frames: the
// staircase interpolation smooths over.

export function setStepRate(hz) {
    state.stepHz = hz;
    Physics.setTimeStep(1 / hz);
    if (simPanel) simPanel.set('stepHz', hz, true);
    $('#stStep').textContent = hz + ' Hz';
}

export function setInterpolation(on) {
    state.interpolation = !!on;
    Physics.setInterpolation(!!on);
    if (simPanel) simPanel.set('interpolation', !!on, true);
    $('#stInterp').textContent = on ? 'on' : 'off';
}

// --- spawning --------------------------------------------------------------------

export function spawnCurrent(pos, extra = {}) {
    return spawn(state.spawnShape, pos, {
        layer: state.spawnLayer, friction: state.spawnFriction, restitution: state.spawnRestitution, ...extra,
    });
}

/** Drop one of the current shape above the middle of the stage. */
export function dropOne() {
    return spawnCurrent({ x: -2 + Math.random() * 4, y: 9, z: -2 + Math.random() * 4 });
}

// --- selection ------------------------------------------------------------------------

export function select(tag) {
    state.selected = bodies.has(tag) ? tag : null;
    setFocus(state.selected);          // the contact viewer follows the selection
    refreshSelection();
    return state.selected;
}

export function refreshSelection() {
    const info = $('#selInfo'), panel = $('#selControls');
    const tag = state.selected;
    const props = tag != null ? Physics.getBodyProperties(tag) : null;
    const entry = tag != null ? bodies.get(tag) : null;
    if (!props || !entry) {
        state.selected = null;
        info.textContent = 'nothing selected — click a body';
        panel.classList.add('disabled');
        return;
    }
    panel.classList.remove('disabled');
    clear(info).appendChild(h('span', null,
        h('span', { style: { color: LAYER_COLORS[entry.layer] } }, '■ '),
        h('b', null, '#' + tag), ` ${entry.kind} on `, h('b', null, entry.layer), h('br'),
        `mass ${props.mass.toFixed(2)} kg · fric ${props.friction.toFixed(2)} · rest ${props.restitution.toFixed(2)}`, h('br'),
        `damp ${props.linearDamping.toFixed(2)}/${props.angularDamping.toFixed(2)} · grav x${props.gravityFactor.toFixed(2)}`));
    for (const k of Object.keys(sel)) selPanel.set(k, props[k], true);
}

const SETTERS = {
    mass: 'setMass', friction: 'setFriction', restitution: 'setRestitution',
    linearDamping: 'setLinearDamping', angularDamping: 'setAngularDamping', gravityFactor: 'setGravityFactor',
};

/** Set one property on the selected body, then re-read it (the readout stays honest about clamping). */
export function setSelectedProp(name, value) {
    const tag = state.selected;
    if (tag == null || !SETTERS[name]) return false;
    Physics[SETTERS[name]](tag, value);
    Physics.activate(tag);
    refreshSelection();
    return true;
}

export function setCombine(which, mode) {
    const tag = state.selected;
    if (which === 'friction') {
        state.frictionCombine = mode;
        if (fricSeg) fricSeg.value = mode;
        if (tag != null) Physics.setFrictionCombine(tag, mode);
    } else {
        state.restitutionCombine = mode;
        if (restSeg) restSeg.value = mode;
        if (tag != null) Physics.setRestitutionCombine(tag, mode);
    }
    if (tag != null) Physics.activate(tag);
    return true;
}

/** Impulse the selected body up and sideways, scaled by its mass. */
export function pokeSelected() {
    if (state.selected == null) return false;
    const p = Physics.getBodyProperties(state.selected);
    const k = Math.max(1, p ? p.mass : 1) * 6;
    Physics.addImpulse(state.selected, k * 0.6, k, 0);
    return true;
}

export function deleteSelected() {
    if (state.selected == null) return false;
    despawn(state.selected);
    select(null);
    return true;
}

// --- layer matrix ---------------------------------------------------------------------

function buildLayerMatrix() {
    const host = $('#layerMatrix');
    clear(host);
    host.appendChild(h('div.mrow', null, h('span.mr'),
        LAYER_NAMES.map((name) => h('span.mh', { title: name }, name.slice(0, 4)))));
    LAYER_NAMES.forEach((rowName, i) => {
        host.appendChild(h('div.mrow', null, h('span.mr', null, rowName),
            LAYER_NAMES.map((_, j) => h(i === j ? 'span.cell.diag' : 'span.cell', null,
                h('input', { type: 'checkbox', dataset: { i: String(i), j: String(j) },
                    onchange: (e) => { setPair(i, j, e.target.checked); syncLayerMatrix(); } })))));
    });
    syncLayerMatrix();
}

/** Re-read the matrix into the boxes: setPair writes both cells of a pair. */
export function syncLayerMatrix() {
    const m = getMatrix(), n = LAYER_NAMES.length;
    for (const cb of $('#layerMatrix').querySelectorAll('input')) cb.checked = m[(+cb.dataset.i) * n + (+cb.dataset.j)];
}

// --- area cards -------------------------------------------------------------------------

function buildAreaPanel() {
    const host = $('#areaList');
    for (const def of AREA_DEFS) {
        const a = areas.get(def.key);
        const c = def.color.slice(0, 3).map((x) => Math.round(x * 255));
        const card = h('div.card', { style: { borderLeftColor: `rgb(${c.join(',')})` } });
        const on = { enabled: a.enabled };
        params(card, on, { enabled: { label: def.label } }, {
            onChange: (_, v) => { setAreaEnabled(def.key, v); card.classList.toggle('off', !v); },
        });
        card.appendChild(h('div.hint', null, def.hint));
        params(card, a.params, def.controls, { onChange: (k, v) => setAreaParam(def.key, k, v) });
        host.appendChild(card);
    }
}

// --- wiring --------------------------------------------------------------------------------

export function bindSandbox() {
    simPanel = params('#simParams', state, {
        stepHz: { label: 'step rate', min: 15, max: 120, step: 1, fmt: (v) => v + ' Hz' },
        interpolation: { label: 'render interpolation' },
    }, { onChange: (k, v) => (k === 'stepHz' ? setStepRate(v) : setInterpolation(v)) });

    segmented('#shapeRow', SHAPE_KINDS.map((k) => [k, k === 'torus' ? 'torus (mesh)' : k]), {
        value: state.spawnShape, onChange: (v) => { state.spawnShape = v; },
    });
    const layers = segmented('#layerRow', SPAWN_LAYERS, { value: state.spawnLayer, onChange: (v) => { state.spawnLayer = v; } });
    for (const b of layers.buttons) b.style.borderLeftColor = LAYER_COLORS[b.dataset.value];
    params('#spawnParams', state, {
        spawnFriction: { label: 'friction', min: 0, max: 2, step: 0.01 },
        spawnRestitution: { label: 'restitution', min: 0, max: 1, step: 0.01 },
    });

    $('#btnDrop').onclick = () => dropOne();
    $('#btnRace').onclick = () => materialRace(stage);
    $('#btnRain').onclick = () => rain(40);
    $('#btnRain200').onclick = () => rain(200);
    $('#btnClear').onclick = () => { clearAll(); select(null); };

    selPanel = params('#selParams', sel, {
        mass: { min: 0.2, max: 400, step: 0.1 },
        friction: { min: 0, max: 2, step: 0.01 },
        restitution: { min: 0, max: 1, step: 0.01 },
        linearDamping: { label: 'lin damp', min: 0, max: 10, step: 0.05 },
        angularDamping: { label: 'ang damp', min: 0, max: 10, step: 0.05 },
        gravityFactor: { label: 'gravity x', min: -2, max: 3, step: 0.05 },
    }, { onChange: (k, v) => setSelectedProp(k, v) });
    fricSeg = segmented('#fricCombineRow', COMBINE_MODES, { value: state.frictionCombine, onChange: (m) => setCombine('friction', m) });
    restSeg = segmented('#restCombineRow', COMBINE_MODES, { value: state.restitutionCombine, onChange: (m) => setCombine('restitution', m) });
    $('#btnPokeBody').onclick = () => pokeSelected();
    $('#btnDelete').onclick = () => deleteSelected();

    buildAreaPanel();
    buildLayerMatrix();
    $('#btnResetLayers').onclick = () => { resetLayers(); syncLayerMatrix(); };

    const legend = $('#laneLegend');
    for (const m of MATERIALS) {
        legend.appendChild(h('div.lane', null,
            h('span.sw', { style: { background: m.color } }), h('span.ln', null, m.label),
            h('span.lv', null, `μ ${m.friction.toFixed(2)} · e ${m.restitution.toFixed(2)} — ${m.note}`)));
    }

    // Push the panel's defaults before the first step.
    setStepRate(state.stepHz);
    setInterpolation(state.interpolation);
    refreshSelection();
}

export function refreshSandbox() {
    $('#stBodies').textContent = String(bodyCount());
    if (state.selected != null && !bodies.has(state.selected)) refreshSelection();
}
