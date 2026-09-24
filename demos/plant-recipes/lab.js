// Plant Recipes — the viewer: scene, lighting, state, regeneration and the
// panel. main.js boots it; tests import this module (never main.js).
//
// Two modes. Single: one plant at the origin, every recipe parameter on the
// panel, a species preset loading its values into it. Forest: many plants of
// one archetype laid out by forest.js, species mixed per instance.

import { h, clear, segmented, toggleButton, params, foldPanels } from "/lib/kit/index.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";
import { ARCHETYPES, STAGES, resolveStage, Species, speciesList } from "/app/recipes/index.js";
import { ageForStage } from "/app/recipes/lifecycle.js";
import { ARCHETYPE_SCHEMA, FOREST_SCHEMA, GROUPS, schemaFor, toSpec } from "/app/schema.js";
import { layoutForest } from "/app/forest.js";

// --- scene --------------------------------------------------------------------

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 1, 0], dist: 6, fov: 50, near: 0.1, far: 2000, rot: orbitRotation(Math.PI * 0.25, -0.62) },
    // Nothing to pick, so the left button orbits and the right one pans.
    controls: { orbitButton: 0, panButton: 2, minDist: 0.3, maxDist: 500 },
});
export const { scene } = vp;

// Studio plus the time-of-day presets; setScale() keeps fog and the night
// fireflies proportional to a forest.
export const sky = daylight(scene, { order: ['studio', 'dawn', 'noon', 'golden', 'night'], cascades: 4, atlas: 4096, pcf: 3 });
sky.apply('studio');
vp.onFrame((dt) => sky.update(dt));

let ground = null;
function groundFor(half) {
    if (ground) ground.destroy();
    ground = scene.createMesh({
        mesh: 'plane', halfW: half, halfD: half, y: 0,
        color: '#9aa18f', metallic: 0, roughness: 0.95, receivesShadow: true,
    });
    sky.setScale(Math.max(1, half / 8));
}
groundFor(10);

// --- state ----------------------------------------------------------------------

/** Mode + the panel's values. Read live through these objects. */
export const view = { mode: 'single', stats: '', parts: 0, tris: 0 };
export const state = {};

const schema = () => schemaFor(view.mode, state.archetype || 'tree');

// Defaults for every row, then (single mode) the species preset for the keys
// the panel shows. A null preset colour means "none" (no bloom stage).
function loadDefaults(keep) {
    const kept = {};
    for (const k of keep || []) if (state[k] !== undefined) kept[k] = state[k];
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, { archetype: 'tree' }, kept);
    for (const r of schema()) if (state[r.key] === undefined) state[r.key] = r.default;
    const list = speciesList(state.archetype);
    if (!state.species || !list.includes(state.species)) state.species = list[0] || '';
    if (view.mode === 'single') loadSpecies();
}

function loadSpecies() {
    const preset = (Species[state.archetype] || {})[state.species] || {};
    for (const r of ARCHETYPE_SCHEMA[state.archetype] || []) {
        state[r.key] = preset[r.key] !== undefined ? preset[r.key] : r.default;
    }
}

// Recipe options for the single plant: the panel values (nulls left to the
// species preset) plus the species for the keys the panel does not show.
export function plantOpts() {
    const opts = { seed: state.seed | 0, age01: state.age, species: state.species || undefined };
    for (const r of ARCHETYPE_SCHEMA[state.archetype] || []) {
        if (state[r.key] != null) opts[r.key] = state[r.key];
    }
    return opts;
}

// --- regeneration ---------------------------------------------------------------

let nodes = [];
function spawn(part, x, z) {
    if (!part.mesh) return;
    nodes.push(scene.createMesh({
        data: part.mesh, x, y: 0, z,
        color: part.color || [0.6, 0.6, 0.6],
        metallic: part.metallic ?? 0, roughness: part.roughness ?? 0.9,
        twoSided: part.twoSided ?? true, castsShadow: true, receivesShadow: true,
    }));
    view.parts++;
    view.tris += part.mesh.triangleCount || 0;
}

function grow(box, min, max, x, z) {
    box.min = [Math.min(box.min[0], x + min[0]), Math.min(box.min[1], min[1]), Math.min(box.min[2], z + min[2])];
    box.max = [Math.max(box.max[0], x + max[0]), Math.max(box.max[1], max[1]), Math.max(box.max[2], z + max[2])];
}

/** Rebuild the plant(s); `refit` reframes the camera on them. Returns the bounds or null. */
export function regenerate(refit) {
    for (const n of nodes) n.destroy();
    nodes = [];
    view.parts = view.tris = 0;
    const arch = state.archetype, build = ARCHETYPES[arch];
    const t0 = performance.now();
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const plants = view.mode === 'single' ? [{ x: 0, z: 0, opts: plantOpts() }] : layoutForest(arch, state);
    for (const p of plants) {
        let result;
        try { result = build(p.opts); } catch (e) {
            console.error('plant-recipes: ' + arch + ' recipe failed', e);
            view.stats = 'error: ' + e.message;
            onStats(view.stats, 'err');
            continue;
        }
        if (!result || !result.parts) continue;
        for (const part of result.parts) spawn(part, p.x, p.z);
        if (result.aabbMin && result.aabbMax) grow(box, result.aabbMin, result.aabbMax, p.x, p.z);
    }
    const ms = performance.now() - t0;
    if (!isFinite(box.min[0])) {
        const half = view.mode === 'forest' ? state.patchSize * 0.5 : 1;
        box.min = [-half, 0, -half]; box.max = [half, view.mode === 'forest' ? state.baseHeight : 1, half];
    }
    if (view.mode === 'single') {
        const foot = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]), Math.abs(box.min[2]), Math.abs(box.max[2]));
        groundFor(Math.max(2, foot * 3));
        view.stats = arch + (state.species ? ' · ' + state.species : '') + ' · ' + ms.toFixed(1) + ' ms · ' +
            view.parts + ' parts · ' + view.tris + ' tris';
    } else {
        groundFor(Math.max(10, state.patchSize * 0.7));
        view.stats = 'forest · ' + plants.length + ' ' + arch + (plants.length === 1 ? '' : 's') + ' · ' +
            ms.toFixed(0) + ' ms · ' + view.parts + ' parts · ' + view.tris + ' tris';
    }
    onStats(view.stats);
    if (refit) fit(box);
    paintStageBar();
    return box;
}

function fit(box) {
    const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) * 0.5);
    const ext = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    vp.reframe(c, Math.max(0.4, ext * 2.0));
}

// Slider drags coalesce into one rebuild per frame.
let pending = false;
function scheduleRegen() { pending = true; }

// Lifecycle cycle: age sweeps 0 -> 1 every 12 s, rebuilding each frame.
const CYCLE_S = 12;
export const cycle = { on: false };
vp.onFrame((dt) => {
    if (cycle.on) {
        state.age = (state.age + dt / CYCLE_S) % 1;
        panel.set('age', state.age, true);
        pending = true;
    }
    if (pending) { pending = false; regenerate(false); }
});

// --- panel ------------------------------------------------------------------------

let onStats = () => {};
let panel = { set() {} };
let stageBar = null;

// Pills for all eight stages; the archetype's supported ones are live and
// jump the age to the centre of their slice.
function paintStageBar() {
    if (!stageBar) return;
    clear(stageBar);
    const supported = supportedStages();
    const active = resolveStage(supported, state.age ?? 1).stage;
    for (const s of STAGES) {
        const on = supported.includes(s);
        stageBar.appendChild(h('button.small.stage' + (s === active ? '.active' : ''), {
            dataset: { stage: s }, disabled: !on,
            onclick: () => { if (on) setAge(ageForStage(supported, s)); },
        }, s));
    }
}

/** The stages the current plant supports (species applied, as the builder sees it). */
export function supportedStages() {
    const opts = view.mode === 'single' ? plantOpts() : { species: state.species || undefined };
    return ARCHETYPES[state.archetype].stages(opts);
}

function setAge(a) {
    state.age = a;
    panel.set('age', a, true);
    regenerate(false);
}

// Build the rows for the current mode/archetype: the top rows loose, the
// rest in foldable group panels.
function buildPanel(root) {
    clear(root);
    const rows = schema();
    const setters = [];
    // state[key] is already set when this runs.
    const onChange = (key, v) => {
        if (key === 'archetype') { loadDefaults(['archetype', 'age', 'seed', ...FOREST_KEYS]); rebuild(true); return; }
        if (key === 'species' && view.mode === 'single') { loadSpecies(); rebuild(false); return; }
        if (typeof v === 'number' && !Number.isFinite(v)) state[key] = rows.find((r) => r.key === key).default;
        if (key === 'age' || key === 'species') paintStageBar();
        scheduleRegen();
    };
    const group = (name) => rows.filter((r) => r.group === name);
    const add = (container, list) => {
        if (!list.length) return;
        // Controls edit a copy: a null colour shows the default swatch but stays null in state.
        const shown = {};
        const spec = {};
        for (const r of list) {
            shown[r.key] = state[r.key] == null ? r.default : state[r.key];
            spec[r.key] = toSpec(r);
            if (r.key === 'species') spec[r.key].options = [['', '(none)'], ...speciesList(state.archetype).map((s) => [s, s])];
        }
        const p = params(container, shown, spec, { onChange: (k, v) => { state[k] = v; onChange(k, v); } });
        for (const r of list) {
            if (r.type === 'color' && state[r.key] == null) p.rows[r.key].querySelector('.k-val').textContent = 'none';
        }
        setters.push(p);
    };
    add(root, group('top'));
    for (const [name, caption, open] of GROUPS) {
        const list = group(name);
        if (!list.length) continue;
        const box = h('div.k-panel.fold' + (open ? '' : '.folded'), { dataset: { group: name } }, h('h2', null, caption));
        root.appendChild(box);
        add(box, list);
    }
    foldPanels(root);
    panel = {
        set(k, v, silent) { for (const p of setters) if (p.rows[k]) p.set(k, v, silent); },
    };
}

// Kept across an archetype switch.
const FOREST_KEYS = FOREST_SCHEMA.map((r) => r.key);

let paramsRoot = null;
function rebuild(refit) {
    buildPanel(paramsRoot);
    regenerate(refit);
}

/** Switch 'single' | 'forest'; resets the panel to defaults. */
export function setMode(mode) {
    if (mode === view.mode) return;
    view.mode = mode;
    loadDefaults(['archetype']);
    if (modeSwitch) modeSwitch.value = mode;
    rebuild(true);
}

/** Merge values into the state (a new archetype resets the rest first) and rebuild. */
export function setState(patch) {
    if (patch.archetype && patch.archetype !== state.archetype) {
        state.archetype = patch.archetype;
        loadDefaults(['archetype']);
    }
    const speciesChanged = patch.species !== undefined && patch.species !== state.species;
    if (speciesChanged) { state.species = patch.species; if (view.mode === 'single') loadSpecies(); }
    Object.assign(state, patch);
    rebuild(true);
}

export function reset() { loadDefaults(); rebuild(true); }
export function reseed() { setState({ seed: (Math.random() * 99999) | 0 }); }

let modeSwitch = null;

/**
 * Wire the page: #mode (segmented), #stage-bar, #params, #tod and the
 * #regen / #fit / #reseed / #reset / #anim buttons. `report(text, kind)`
 * receives the stats line.
 */
export function mountPanel(report) {
    onStats = report;
    paramsRoot = document.getElementById('params');
    stageBar = document.getElementById('stage-bar');
    modeSwitch = segmented('#mode', { single: 'Single', forest: 'Forest' }, { value: view.mode, small: false, onChange: setMode });
    segmented('#tod', Object.fromEntries(sky.order.map((k) => [k, sky.presets[k].label])),
        { value: sky.current, onChange: (k) => sky.apply(k) });
    document.getElementById('regen').addEventListener('click', () => regenerate(true));
    document.getElementById('fit').addEventListener('click', () => regenerate(true));
    document.getElementById('reseed').addEventListener('click', reseed);
    document.getElementById('reset').addEventListener('click', reset);
    toggleButton('#anim', { labels: ['Cycle', 'Stop cycle'], onChange: (on) => { cycle.on = on; } });
    loadDefaults();
    rebuild(true);
}
