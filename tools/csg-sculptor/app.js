// app.js — CSG Sculptor: a workpiece (workpiece.js) carved by a gizmo-driven
// cutter (cutter.js) in a kit 3D viewport. main.js imports this module; tests
// import it too and drive the exported `sculptor`.

import "/lib/history.js";
import { boot } from "/lib/kit/app.js";
import { $, h } from "/lib/kit/dom.js";
import { readout, segmented } from "/lib/kit/ui.js";
import { params } from "/lib/kit/params.js";
import { pickSaveFile } from "/lib/kit/ml.js";
import { documentCommands } from "/lib/kit/editor.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { createWorkpiece, OPS } from "./workpiece.js";
import { createCutter, SHAPES, GIZMO_MODES, GIZMO_KEYS } from "./cutter.js";

// --- scene ---------------------------------------------------------------------

const vp = sceneViewport('#stage', {
    orbit: { target: [0, 0, 0], dist: 8.5, fov: 45, near: 0.1, far: 150, rot: orbitRotation(-0.45, -0.32) },
    controls: { minDist: 2, maxDist: 60 },
});
const scene = vp.scene;
scene.setAmbient([0.1, 0.12, 0.16]);
scene.setToneMap({ mode: 'aces', exposure: 1.15 });
scene.createLight({ type: 'directional', direction: [-0.4, -0.9, -0.4], color: [1.0, 0.98, 0.94],
    intensity: 2.8, castsShadow: true, name: 'key' });
scene.createLight({ type: 'directional', direction: [0.6, -0.4, 0.6], color: [0.4, 0.65, 0.95],
    intensity: 1.2, name: 'fill' });
scene.createLight({ type: 'directional', direction: [0.0, 0.8, -0.8], color: [0.8, 0.5, 0.4],
    intensity: 0.6, name: 'rim' });
// Turntable: a dark disc with a glowing rim.
scene.createMesh({ mesh: Mesh.cylinder(12.0, 0.05, 32), color: '#0e121a', roughness: 0.8, metallic: 0.2, y: -2.0 });
scene.createMesh({ mesh: Mesh.torus(12.0, 0.06, 64, 16), color: '#1e293b', emissive: 0.2,
    emissiveColor: '#00f2fe', y: -1.95 });

// --- document --------------------------------------------------------------------

const history = new History({ limit: 30 });
const meshStats = readout('#mesh-stats', { verts: 'vertices', tris: 'triangles', size: 'size (m)' });
const workpiece = createWorkpiece(scene, { history, onChange: () => refresh() });
const cutter = createCutter(scene);

function refresh() {
    const s = workpiece.stats();
    meshStats.set({
        verts: s.verts.toLocaleString(), tris: s.tris.toLocaleString(),
        size: s.size.map((v) => v.toFixed(2)).join(' x '),
    });
    renderHistory();
}

history.on('change', () => renderHistory());
function renderHistory() {
    const el = $('#history');
    const n = history.size();
    el.textContent = n ? n + ' step' + (n === 1 ? '' : 's') + ' · last: ' + history.entries()[n - 1].label
                       : 'nothing to undo';
}

// --- commands ----------------------------------------------------------------------

const doc = documentCommands({
    history,
    canRun: () => !(globalThis.bro && bro.gizmo && bro.gizmo.dragging),
    undoButton: '#undo', redoButton: '#redo',
    after: (cmd, ok) => { if (ok) app.status.set(cmd === 'undo' ? 'undone' : 'redone'); refresh(); },
});

const exportMenu = [
    { id: 'file.exportObj', label: 'Export OBJ...' },
    { id: 'file.exportStl', label: 'Export STL...' },
    { id: 'file.exportPly', label: 'Export PLY...' },
];
const app = boot({
    menu: {
        file: exportMenu,
        handlers: {
            'file.exportObj': () => exportDialog('obj'),
            'file.exportStl': () => exportDialog('stl'),
            'file.exportPly': () => exportDialog('ply'),
        },
    },
});

/** Apply the cutter with its current operation; returns whether it changed the workpiece. */
function applyCut() {
    const ok = !!workpiece.apply(cutter.transformedMesh(), cutter.op);
    if (ok) app.status.ok(OPS[cutter.op].label + ' applied');
    else app.status.warn(OPS[cutter.op].label + ' left nothing (or failed); workpiece unchanged');
    return ok;
}

const SAVERS = { obj: 'saveOBJ', stl: 'saveSTL', ply: 'savePLY' };

/** Write the workpiece to `path` as `format` (obj / stl / ply). */
function exportTo(path, format) {
    const ok = workpiece.mesh[SAVERS[format]](path);
    if (ok) app.status.ok('exported ' + path);
    else app.status.error('export failed: ' + path);
    return ok;
}

function exportDialog(format) {
    const path = pickSaveFile(format.toUpperCase() + '|' + format, 'sculpture.' + format);
    if (path) exportTo(path.replace(/\\/g, '/'), format);
}

// --- panels --------------------------------------------------------------------------

const ops = segmented('#ops', Object.keys(OPS).map((k) => [k, OPS[k].label]), {
    value: cutter.op, small: false,
    onChange: (v) => { cutter.setOp(v); app.status.set('operation: ' + OPS[v].label); },
});
const shapes = segmented('#shapes', SHAPES, {
    value: cutter.shape,
    onChange: (v) => { cutter.setShape(v); app.status.set('cutter: ' + v); },
});
const gizmoModes = segmented('#gizmo-modes', Object.keys(GIZMO_MODES).map((k) => [k, GIZMO_MODES[k]]), {
    value: cutter.mode, title: (v) => GIZMO_MODES[v] + " (" + GIZMO_KEYS[v] + ")",
    onChange: (v) => cutter.setGizmoMode(v),
});
const setGizmoMode = (m) => { cutter.setGizmoMode(m); gizmoModes.value = m; };

// Width drives the box width and the round shapes' radius (0.6 x width).
const dims = { width: cutter.size.width, height: cutter.size.height, depth: cutter.size.depth };
params('#dims', dims, {
    width:  { min: 0.2, max: 3.0, step: 0.05, label: 'width / radius', fmt: (v) => v.toFixed(2) + ' m' },
    height: { min: 0.2, max: 4.0, step: 0.05, fmt: (v) => v.toFixed(2) + ' m' },
    depth:  { min: 0.2, max: 3.0, step: 0.05, fmt: (v) => v.toFixed(2) + ' m' },
}, {
    onChange: (key, v) => {
        cutter.setSize(key, v);
        if (key === 'width') cutter.setSize('radius', v * 0.6);
    },
});

$('#snap').addEventListener('change', (e) => { cutter.snap = e.target.checked; });
$('#reset-cutter').addEventListener('click', () => cutter.reset());
$('#apply').addEventListener('click', applyCut);
$('#export-obj').addEventListener('click', () => exportDialog('obj'));
$('#export-stl').addEventListener('click', () => exportDialog('stl'));
$('#preset').addEventListener('change', (e) => {
    workpiece.load(e.target.value);
    cutter.reset();
    app.status.set('loaded ' + e.target.value + ' blank');
});
$('#material').addEventListener('change', (e) => workpiece.setMaterial(e.target.value));

const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
document.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
    const k = (e.key || '').toLowerCase();
    if (e.key === 'Enter') { applyCut(); e.preventDefault(); }
    else if (k === 'w') setGizmoMode('translate');
    else if (k === 'e') setGizmoMode('rotate');
    else if (k === 'r') setGizmoMode('scale');
});

workpiece.load('box');
refresh();
app.status.set('ready: position the cutter with the gizmo, then Apply (Enter)');

/** Handles for tests. */
export const sculptor = {
    vp, scene, workpiece, cutter, history, doc, ops, shapes, gizmoModes,
    applyCut, exportTo, setGizmoMode, refresh,
    get status() { return app.status; },
};
