// app.js — Tile Editor: an editor over the whole scene.createTileWorld
// surface on one map: atlas rendering, autotiled overlays with tint,
// animated water, instanced props, ray -> cell picking, elevation with AO
// cliffs, nav-grid pathfinding, and save / load.
//
//   atlas.js    tile ids + the composited texture atlas
//   map.js      the document: TileWorld, cell edits, undo strokes, props, I/O
//   tools.js    toolbox tools (paint modes, props, pathfind)
//   minimap.js  the corner overview
//
// main.js imports this module; tests import it and drive `editor`.

import "/lib/history.js";
import "/lib/project.js";
import { boot } from "/lib/kit/app.js";
import { $, $$, h } from "/lib/kit/dom.js";
import { segmented, stats } from "/lib/kit/ui.js";
import { params, bindControl } from "/lib/kit/params.js";
import { toolbox, documentCommands } from "/lib/kit/editor.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { GROUND_SWATCHES, OVERLAY_SWATCHES, atlasThumbnail } from "./atlas.js";
import { createTileMap, PROP_NAMES, PROJECT_SCHEMA, DEFAULT_CONFIG } from "./map.js";
import { brushState, createTools } from "./tools.js";
import { createMinimap } from "./minimap.js";

// --- scene -----------------------------------------------------------------------

const vp = sceneViewport('#stage', {
    orbit: { target: [0, 0, 0], dist: 40, fov: 50, rot: orbitRotation(0.35, -0.8) },
    controls: { minDist: 4, maxDist: 120 },
});
const scene = vp.scene;
scene.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });
scene.setAmbient([0.08, 0.09, 0.11]);
scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3], color: [1.0, 0.96, 0.9],
    intensity: 2.0, castsShadow: true });

const map = createTileMap(scene);
map.authorDemo();

/** Frame the whole map (worldBounds is topology-aware, so hex maps fit too). */
function frameMap() {
    const b = map.world.worldBounds();
    const dist = Math.max(10, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.2);
    vp.reframe([(b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2], dist);
}
frameMap();

// --- tools -------------------------------------------------------------------------

const brush = brushState();
const tools = toolbox({
    tools: createTools(map, brush, {
        onPick: (layer, id) => { swatchRows[layer].select(id); app.status.set('picked ' + layer + ' ' + id); },
        onRect: (a, b) => {
            if (a && b) app.status.set('rect ' + (Math.abs(b.x - a.x) + 1) + ' x ' + (Math.abs(b.y - a.y) + 1));
        },
        onPath: (state, path) => {
            const msg = state === 'start' ? 'start set: click a goal'
                : state === 'found' ? 'path: ' + path.length + ' waypoints' : 'no path';
            $('#path-info').textContent = msg;
            app.status.set(msg, state === 'none' ? 'warn' : undefined);
        },
    }),
    initial: 'ground',
    buttons: '#toolbar',
    onChange: (name) => showSections(name),
});

function showSections(name) {
    for (const s of $$('[data-section]')) s.hidden = s.dataset.section !== name;
    $('#sec-brush').hidden = !tools.tool.paints;
}

// --- project + commands ---------------------------------------------------------------

const newMapForm = Object.assign({}, DEFAULT_CONFIG);
const project = new Project({
    app: 'tile-editor',
    schema: PROJECT_SCHEMA,
    migrations: { 1: (d) => Object.assign({ tints: [], props: [] }, d) },
    serialize: () => map.serialize(),
    deserialize: (data) => { tools.cancelAll(); map.deserialize(data); },
    onNew: () => { tools.cancelAll(); map.newMap(readMapForm()); },
    history: map.history,
});

const doc = documentCommands({
    history: map.history, project,
    canRun: () => !tools.busy(),
    undoButton: '#undo', redoButton: '#redo',
    after: () => map.rebuildIfDirty(),
});
const app = boot({ menu: doc.menu });

function afterDocument() {
    syncMapForm();
    frameMap();
    minimap.redraw();
    tools.get('pathfind').reset();
}
project.on('new', afterDocument);
project.on('loaded', afterDocument);
project.on('change', () => {
    $('#project-title').textContent = project.name + (project.isDirty() ? ' *' : '');
});
$('#save').addEventListener('click', () => doc.save());
$('#save-as').addEventListener('click', () => doc.saveAs());
$('#open').addEventListener('click', () => doc.open());
$('#new-map').addEventListener('click', () => {
    if (doc.new()) app.status.ok('new ' + newMapForm.topology + ' map ' + newMapForm.width + ' x ' + newMapForm.height);
});

// --- panels --------------------------------------------------------------------------

/** A row of swatch buttons (atlas thumbnails) for one layer. */
function swatchRow(target, defs, onSelect) {
    const buttons = defs.map((d) => h('button.swatch', {
        dataset: { id: String(d.id) }, title: d.label,
        onclick: () => { row.select(d.id); onSelect(d.id); },
    }, d.cell !== undefined ? atlasThumbnail(map.atlas, d.cell, 28) : null, h('span', null, d.label)));
    for (const b of buttons) $(target).appendChild(b);
    const row = {
        buttons,
        /** Highlight the swatch for `id` (the Erase swatch for an unknown id). */
        select(id) {
            const hit = buttons.find((b) => Number(b.dataset.id) === id) || buttons[buttons.length - 1];
            for (const b of buttons) b.classList.toggle('active', b === hit);
        },
    };
    row.select(defs[0].id);
    return row;
}
const swatchRows = {
    ground: swatchRow('#ground-swatches', GROUND_SWATCHES, (id) => { brush.ground = id; }),
    overlay: swatchRow('#overlay-swatches', OVERLAY_SWATCHES, (id) => { brush.overlay = id; }),
};
brush.ground = GROUND_SWATCHES[0].id;
brush.overlay = OVERLAY_SWATCHES[0].id;

segmented('#elev-dir', [[1, 'Raise'], [-1, 'Lower']], { value: 1, small: false, onChange: (v) => { brush.elevDir = v; } });
segmented('#flag-value', [[1, 'Block'], [0, 'Unblock']], { value: 1, small: false, onChange: (v) => { brush.flag = v === 1; } });
segmented('#prop-kinds', PROP_NAMES, { value: brush.prop, small: false, onChange: (v) => { brush.prop = v; } });
bindControl('#brush-radius', { out: '#brush-radius-val', onChange: (v) => { brush.radius = v; } });

const tintState = { colour: '#ff6644', alpha: 1 };
const hexToRgb = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
const syncTint = () => { brush.tint = hexToRgb(tintState.colour).concat([tintState.alpha]); };
params('#tint-params', tintState, {
    colour: { type: 'color' },
    alpha: { min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2) },
}, { onChange: syncTint });
syncTint();

$('#clear-props').addEventListener('click', () => map.clearProps());
$('#clear-path').addEventListener('click', () => { tools.get('pathfind').reset(); $('#path-info').textContent = ''; });

const mapParams = params('#map-params', newMapForm, {
    width: { type: 'number', min: 4, max: 200 },
    height: { type: 'number', min: 4, max: 200 },
    cellSize: { type: 'number', min: 0.25, max: 4, step: 0.25, label: 'cell size' },
});
const topology = segmented('#topology', ['square', 'hex'], {
    value: newMapForm.topology, onChange: (v) => { newMapForm.topology = v; },
});
function readMapForm() {
    const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number.isFinite(+v) && +v ? +v : d));
    return {
        width: Math.round(clamp(newMapForm.width, 4, 200, 48)),
        height: Math.round(clamp(newMapForm.height, 4, 200, 48)),
        cellSize: clamp(newMapForm.cellSize, 0.25, 4, 1),
        topology: newMapForm.topology,
    };
}
function syncMapForm() {
    const c = map.config;
    for (const k of ['width', 'height', 'cellSize']) mapParams.set(k, c[k], true);
    newMapForm.topology = c.topology;
    topology.value = c.topology;
}

const minimap = createMinimap($('#minimap'), map, {
    onJump: (x, z) => vp.reframe([x, 0, z], vp.cam.dist),
});
map.history.on('change', () => minimap.redraw());

const readouts = stats('#stats', { tool: 'tool', chunks: 'chunks', verts: 'verts', tris: 'tris' });

// --- input -----------------------------------------------------------------------------

const canvas = vp.canvas;
/** The cell under a mouse event, or null. */
function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const ray = vp.ray(e.clientX - r.left, e.clientY - r.top);
    return map.world.raycastCell(ray.origin, ray.dir, 1000);
}

let leftDown = false;
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    leftDown = true;
    const t = tools.tool;
    if (t.down) t.down(cellAt(e), e);
});
document.addEventListener('mousemove', (e) => {
    if (!leftDown || vp.controls.dragging) return;
    const t = tools.tool;
    if (t.move) t.move(cellAt(e));
});
document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !leftDown) return;
    leftDown = false;
    const t = tools.tool;
    if (t.up) t.up();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tools.cancelAll()) app.status.set('cancelled');
});

// --- frame loop ------------------------------------------------------------------------

vp.onFrame((dt) => {
    map.world.advance(dt * 1000);
    map.rebuildIfDirty();
    readouts.set({
        tool: tools.name, chunks: map.world.chunkCount,
        verts: map.world.vertexCount, tris: map.world.triangleCount,
    });
});

showSections(tools.name);
$('#project-title').textContent = project.name;
app.status.set('paint with the left button; Shift / Ctrl / Alt modify the brush');

/** Handles for tests. */
export const editor = {
    vp, scene, map, tools, brush, project, doc, minimap, swatchRows,
    cellAt, frameMap, readMapForm,
    get status() { return app.status; },
};
