// hud.js — the switchboard.
//
// One direction only: DOM control -> `state` -> a Physics.* call. Nothing
// reads back out of the engine to drive a control, with the single deliberate
// exception of the selected-body panel, which seeds its sliders from
// Physics.getBodyProperties so what you see is the body's real state rather
// than whatever the sliders last happened to say.
//
// That one-way discipline is what lets tests/test_smoke.js drive the app
// through exactly the code path a human uses — call setStepRate(15) and the
// test has provably exercised the same line the slider does.

import {
    LAYER_NAMES, SPAWN_LAYERS, LAYER_COLORS,
    getMatrix, setPair, resetLayers, collides,
} from '/app/layers.js';
import { AREA_DEFS, areas, setAreaEnabled, setAreaParam } from '/app/areas.js';
import { bodies, bodyCount, spawn, rain, materialRace, clearAll, despawn } from '/app/spawn.js';

const $ = (id) => document.getElementById(id);

export const state = {
    stepHz: 60,
    interpolation: false,
    spawnShape: 'box',
    spawnLayer: 'player',
    spawnFriction: 0.5,
    spawnRestitution: 0.35,
    selected: null,          // body tag or null
    frictionCombine: 'default',
    restitutionCombine: 'default',
};

let stageRef = null;

// --- Simulation rate + interpolation ----------------------------------------
//
// setTimeStep is the demo's most important control. The engine steps the world
// at this fixed rate while rendering runs free, so at 15 Hz a body's true pose
// updates four times for every ~60 rendered frames — which is exactly the
// staircase that interpolation smooths over.

export function setStepRate(hz) {
    state.stepHz = hz;
    Physics.setTimeStep(1 / hz);
    if ($('stepHz')) $('stepHz').value = String(hz);
    if ($('stepHzVal')) $('stepHzVal').textContent = `${hz} Hz`;
    if ($('stStep')) $('stStep').textContent = `${hz} Hz`;
}

export function setInterpolation(on) {
    state.interpolation = !!on;
    Physics.setInterpolation(!!on);
    if ($('interp')) $('interp').checked = !!on;
    if ($('stInterp')) $('stInterp').textContent = on ? 'on' : 'off';
}

// --- Spawning ---------------------------------------------------------------

export function spawnCurrent(pos, extra = {}) {
    return spawn(state.spawnShape, pos, {
        layer: state.spawnLayer,
        friction: state.spawnFriction,
        restitution: state.spawnRestitution,
        ...extra,
    });
}

/** Drop one object above the middle of the stage. */
export function dropOne() {
    return spawnCurrent({ x: -2 + Math.random() * 4, y: 9, z: -2 + Math.random() * 4 });
}

// --- Selection --------------------------------------------------------------
//
// Selecting reads the body's ACTUAL properties back through
// getBodyProperties and pushes them into the sliders, so the panel is a live
// view of one body rather than a set of write-only knobs. Everything after
// that is a one-line setter.

export function select(tag) {
    state.selected = bodies.has(tag) ? tag : null;
    refreshSelection();
    return state.selected;
}

export function refreshSelection() {
    const info = $('selInfo');
    const panel = $('selControls');
    if (!info || !panel) return;

    const tag = state.selected;
    if (tag == null) {
        info.textContent = 'nothing selected — click a body';
        panel.classList.add('disabled');
        return;
    }
    const props = Physics.getBodyProperties(tag);
    const entry = bodies.get(tag);
    if (!props || !entry) {
        state.selected = null;
        info.textContent = 'nothing selected — click a body';
        panel.classList.add('disabled');
        return;
    }
    panel.classList.remove('disabled');

    const sw = `<span style="color:${LAYER_COLORS[entry.layer]}">■</span>`;
    info.innerHTML =
        `${sw} <b>#${tag}</b> ${entry.kind} on <b>${entry.layer}</b><br>` +
        `mass ${props.mass.toFixed(2)} kg · fric ${props.friction.toFixed(2)} · ` +
        `rest ${props.restitution.toFixed(2)}<br>` +
        `damp ${props.linearDamping.toFixed(2)}/${props.angularDamping.toFixed(2)} · ` +
        `grav x${props.gravityFactor.toFixed(2)}`;

    const put = (id, v, digits = 2) => {
        const el = $(id); if (el) el.value = String(v);
        const lbl = $(id + 'Val'); if (lbl) lbl.textContent = v.toFixed(digits);
    };
    put('pMass', props.mass);
    put('pFriction', props.friction);
    put('pRestitution', props.restitution);
    put('pLinDamp', props.linearDamping);
    put('pAngDamp', props.angularDamping);
    put('pGravFactor', props.gravityFactor);
}

/** Mutate one property on the selected body and re-read the result. */
export function setSelectedProp(name, value) {
    const tag = state.selected;
    if (tag == null) return false;
    switch (name) {
        case 'mass':           Physics.setMass(tag, value); break;
        case 'friction':       Physics.setFriction(tag, value); break;
        case 'restitution':    Physics.setRestitution(tag, value); break;
        case 'linearDamping':  Physics.setLinearDamping(tag, value); break;
        case 'angularDamping': Physics.setAngularDamping(tag, value); break;
        case 'gravityFactor':  Physics.setGravityFactor(tag, value); break;
        default: return false;
    }
    Physics.activate(tag);
    refreshSelection();
    return true;
}

const COMBINE_MODES = ['default', 'average', 'min', 'multiply', 'max'];

export function setCombine(which, mode) {
    const tag = state.selected;
    if (which === 'friction') {
        state.frictionCombine = mode;
        if (tag != null) Physics.setFrictionCombine(tag, mode);
    } else {
        state.restitutionCombine = mode;
        if (tag != null) Physics.setRestitutionCombine(tag, mode);
    }
    if (tag != null) Physics.activate(tag);
    syncCombineButtons();
    return true;
}

function syncCombineButtons() {
    for (const [rowId, cur] of [['fricCombineRow', state.frictionCombine],
                                ['restCombineRow', state.restitutionCombine]]) {
        const row = $(rowId);
        if (!row) continue;
        for (const b of row.querySelectorAll('button')) {
            b.classList.toggle('sel', b.dataset.mode === cur);
        }
    }
}

// --- Readouts ---------------------------------------------------------------

export function setFps(v) { if ($('fps')) $('fps').textContent = `${v.toFixed(0)} fps`; }
export function refreshCount() { if ($('stBodies')) $('stBodies').textContent = String(bodyCount()); }

// --- Panel construction -----------------------------------------------------

function buildAreaPanel() {
    const host = $('areaList');
    if (!host) return;
    host.innerHTML = '';
    for (const def of AREA_DEFS) {
        const a = areas.get(def.key);
        const box = document.createElement('div');
        box.className = 'area' + (a.enabled ? '' : ' off');
        const c = def.color;
        box.style.borderLeftColor =
            `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

        const head = document.createElement('label');
        head.className = 'check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = a.enabled;
        cb.addEventListener('change', () => {
            setAreaEnabled(def.key, cb.checked);
            box.classList.toggle('off', !cb.checked);
        });
        const nm = document.createElement('span');
        nm.textContent = def.label;
        head.appendChild(cb); head.appendChild(nm);
        box.appendChild(head);

        const hint = document.createElement('div');
        hint.className = 'area-hint';
        hint.textContent = def.hint;
        box.appendChild(hint);

        for (const ctl of def.controls) {
            const row = document.createElement('label');
            row.className = 'row';
            const lbl = document.createElement('span');
            lbl.textContent = ctl.label;
            const inp = document.createElement('input');
            inp.type = 'range';
            inp.min = String(ctl.min); inp.max = String(ctl.max); inp.step = String(ctl.step);
            inp.value = String(a.params[ctl.key]);
            const val = document.createElement('b');
            val.textContent = Number(a.params[ctl.key]).toFixed(2);
            inp.addEventListener('input', () => {
                const v = parseFloat(inp.value);
                setAreaParam(def.key, ctl.key, v);
                val.textContent = v.toFixed(2);
            });
            row.appendChild(lbl); row.appendChild(inp); row.appendChild(val);
            box.appendChild(row);
        }
        host.appendChild(box);
    }
}

function buildLayerMatrix() {
    const host = $('layerMatrix');
    if (!host) return;
    host.innerHTML = '';
    const n = LAYER_NAMES.length;

    host.appendChild(document.createElement('div'));   // empty top-left corner
    for (const name of LAYER_NAMES) {
        const h = document.createElement('div');
        h.className = 'mh';
        h.textContent = name.slice(0, 4);
        h.title = name;
        host.appendChild(h);
    }
    for (let i = 0; i < n; i++) {
        const r = document.createElement('div');
        r.className = 'mr';
        r.textContent = LAYER_NAMES[i];
        host.appendChild(r);
        for (let j = 0; j < n; j++) {
            const cell = document.createElement('div');
            if (i === j) cell.className = 'diag';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = collides(i, j);
            cb.dataset.i = String(i);
            cb.dataset.j = String(j);
            cb.addEventListener('change', () => {
                setPair(i, j, cb.checked);
                syncLayerMatrix();
            });
            cell.appendChild(cb);
            host.appendChild(cell);
        }
    }
}

/** Re-read the matrix into the checkboxes — needed because setPair writes
 *  BOTH cells of a symmetric pair, so flipping one moves two boxes. */
function syncLayerMatrix() {
    const host = $('layerMatrix');
    if (!host) return;
    const m = getMatrix();
    const n = LAYER_NAMES.length;
    for (const cb of host.querySelectorAll('input')) {
        cb.checked = m[(+cb.dataset.i) * n + (+cb.dataset.j)];
    }
}

function buildLayerButtons() {
    const row = $('layerRow');
    if (!row) return;
    row.innerHTML = '';
    for (const name of SPAWN_LAYERS) {
        const b = document.createElement('button');
        b.className = 'layer' + (name === state.spawnLayer ? ' sel' : '');
        b.style.borderLeftColor = LAYER_COLORS[name];
        b.textContent = name;
        b.dataset.layer = name;
        b.addEventListener('click', () => {
            state.spawnLayer = name;
            for (const o of row.querySelectorAll('button')) o.classList.toggle('sel', o === b);
        });
        row.appendChild(b);
    }
}

function buildCombineButtons() {
    for (const [rowId, which] of [['fricCombineRow', 'friction'], ['restCombineRow', 'restitution']]) {
        const row = $(rowId);
        if (!row) continue;
        row.innerHTML = '';
        const tag = document.createElement('span');
        tag.style.cssText = 'flex:0 0 100%;color:#7f8b99;font-size:10px';
        tag.textContent = which === 'friction' ? 'friction combine' : 'restitution combine';
        row.appendChild(tag);
        for (const mode of COMBINE_MODES) {
            const b = document.createElement('button');
            b.textContent = mode;
            b.dataset.mode = mode;
            b.addEventListener('click', () => setCombine(which, mode));
            row.appendChild(b);
        }
    }
    syncCombineButtons();
}

function buildLaneLegend() {
    const host = $('laneLegend');
    if (!host || !stageRef) return;
    host.innerHTML = '';
    for (const m of stageRef.MATERIALS) {
        const d = document.createElement('div');
        d.className = 'lane';
        d.innerHTML =
            `<span class="sw" style="background:${m.color}"></span>` +
            `<span class="ln">${m.label}</span>` +
            `<span class="lv">μ ${m.friction.toFixed(2)} · e ${m.restitution.toFixed(2)} — ${m.note}</span>`;
        host.appendChild(d);
    }
}

// --- Wiring -----------------------------------------------------------------

/**
 * Bind every control and push the initial state at the engine, so the first
 * simulated step already matches what the panel says.
 */
export function bindHud(stage) {
    stageRef = stage;

    buildLayerButtons();
    buildAreaPanel();
    buildLayerMatrix();
    buildCombineButtons();
    buildLaneLegend();

    $('stepHz').addEventListener('input', (e) => setStepRate(parseInt(e.target.value, 10)));
    $('interp').addEventListener('change', (e) => setInterpolation(e.target.checked));

    const shapeRow = $('shapeRow');
    for (const b of shapeRow.querySelectorAll('button')) {
        b.addEventListener('click', () => {
            state.spawnShape = b.dataset.shape;
            for (const o of shapeRow.querySelectorAll('button')) o.classList.toggle('sel', o === b);
        });
    }

    const bindSpawnSlider = (id, key, digits = 2) => {
        const el = $(id);
        el.addEventListener('input', () => {
            state[key] = parseFloat(el.value);
            $(id + 'Val').textContent = state[key].toFixed(digits);
        });
    };
    bindSpawnSlider('spawnFriction', 'spawnFriction');
    bindSpawnSlider('spawnRestitution', 'spawnRestitution');

    $('btnDrop').addEventListener('click', () => { dropOne(); refreshCount(); });
    $('btnRace').addEventListener('click', () => { materialRace(stageRef); refreshCount(); });
    $('btnRain').addEventListener('click', () => { rain(40); refreshCount(); });
    $('btnRain200').addEventListener('click', () => { rain(200); refreshCount(); });
    $('btnClear').addEventListener('click', () => { clearAll(); select(null); refreshCount(); });

    // Selected-body property sliders. Each is one setter plus a re-read, and
    // the re-read is what keeps the text readout honest about clamping —
    // setMass ignores values <= 0, for instance.
    const bindProp = (id, prop, digits = 2) => {
        const el = $(id);
        el.addEventListener('input', () => {
            const v = parseFloat(el.value);
            $(id + 'Val').textContent = v.toFixed(digits);
            setSelectedProp(prop, v);
        });
    };
    bindProp('pMass', 'mass');
    bindProp('pFriction', 'friction');
    bindProp('pRestitution', 'restitution');
    bindProp('pLinDamp', 'linearDamping');
    bindProp('pAngDamp', 'angularDamping');
    bindProp('pGravFactor', 'gravityFactor');

    $('btnPoke').addEventListener('click', () => {
        if (state.selected == null) return;
        const p = Physics.getBodyProperties(state.selected);
        const k = Math.max(1, p ? p.mass : 1) * 6;
        Physics.addImpulse(state.selected, k * 0.6, k, 0);
    });
    $('btnDelete').addEventListener('click', () => {
        if (state.selected == null) return;
        despawn(state.selected);
        select(null);
        refreshCount();
    });

    $('btnResetLayers').addEventListener('click', () => { resetLayers(); syncLayerMatrix(); });

    // Push the panel's defaults at the engine before the first step.
    setStepRate(state.stepHz);
    setInterpolation(state.interpolation);
    refreshSelection();
    refreshCount();
}

export { COMBINE_MODES, syncLayerMatrix };
