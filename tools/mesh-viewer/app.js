// app.js — Mesh Viewer: open a folder or file of meshes, inspect them, run
// bromesh analysis and edits (in a worker), play skinned glTF clips, export.
//
//   loader.js     file -> scene nodes (materials, textures, skin, clips)
//   files.js      the file panel (remembered folder, single files, drops)
//   workbench.js  checks, colour modes, overlays, modify ops, LOD chain
//   rig.js        CPU skinning, clip blending, bone markers
//   export.js     UV inset drawing and mesh export
//   mesh-worker.js / mesh-data.js   the worker side
//
// main.js imports this module; tests import it and drive `viewer`.

import { boot } from "/lib/kit/app.js";
import { $, $$, h } from "/lib/kit/dom.js";
import { readout, toggleButton } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { pickFolder, pickFile, pickSaveFile } from "/lib/kit/ml.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { LOAD_EXTS, fileExt, fileName, loadIntoScene, disposeLoaded } from "./loader.js";
import { createFileBrowser } from "./files.js";
import { createWorkbench, COLOR_MODES, MODIFY } from "./workbench.js";
import { createRig } from "./rig.js";
import { drawUVs, exportDoc, EXPORT_FORMATS } from "./export.js";

// --- scene -----------------------------------------------------------------------
// Three-point studio rig (warm shadowed key, cool fill, top rim) under ACES,
// plus a ground plane under the model that only catches its shadow.

const vp = sceneViewport('#stage', {
    orbit: { target: [0, 0, 0], dist: 6, fov: 45, rot: orbitRotation(0.6, -0.35) },
    controls: { minDist: 0.01, maxDist: 5000 },
});
const scene = vp.scene;
scene.setToneMap({ mode: 'aces', exposure: 1.0, gamma: 2.2 });
scene.setAmbient([0.08, 0.08, 0.10]);
const keyLight = scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3],
    color: [1.0, 0.96, 0.88], intensity: 3.5, castsShadow: true });
scene.createLight({ type: 'directional', direction: [0.6, -0.4, 0.5], color: [0.7, 0.82, 1.0], intensity: 1.2 });
scene.createLight({ type: 'directional', direction: [0.0, 0.8, -0.6], color: [1, 1, 1], intensity: 0.8 });
let ground = null;

/** Put the shadow catcher just under the model, sized to it. */
function placeGround(b) {
    if (ground) ground.destroy();
    ground = scene.createMesh({ mesh: 'plane', halfW: b.size * 4, halfD: b.size * 4,
        color: [0.25, 0.25, 0.27, 1], roughness: 0.95, metallic: 0, castsShadow: false,
        position: [b.center[0], b.min[1] - b.size * 0.002, b.center[2]] });
}
placeGround({ size: 2, center: [0, 0, 0], min: [0, -1.2, 0] });

// --- state + modules -----------------------------------------------------------------

const view = { uv: false, shadows: true, texture: true, emissive: 0 };
let doc = null;

const app = boot({ menu: buildMenu() });
const wb = createWorkbench(scene, {
    status: app.status,
    onBusy: () => syncControls(),
    onChange: () => { renderStats(false); syncControls(); if (view.uv) drawUVs($('#uv-canvas'), doc && doc.items); },
});
const rig = createRig(scene);
const files = createFileBrowser({
    list: $('#file-list'), status: $('#dir-status'),
    canPick: () => { if (wb.busy) app.status.warn('busy: wait for the current op'); return !wb.busy; },
    onPick: (p) => load(p),
});

/** Load `path`, replacing the current document. Returns true on success. */
function load(path) {
    unload();
    app.status.busy('loading ' + fileName(path));
    try {
        doc = loadIntoScene(scene, path, { texture: view.texture });
    } catch (e) {
        app.status.error('load failed: ' + e.message);
        return false;
    }
    wb.attach(doc);
    rig.attach(doc);
    vp.reframe(doc.bounds.center, Math.max(doc.bounds.size * 2.2, 0.05));
    placeGround(doc.bounds);

    // The emissive slider starts at what the file declares (its max over meshes).
    view.emissive = doc.items.reduce((m, it) => Math.max(m, it.loadedEmissive), 0);
    emissive.value = view.emissive;
    viewMode.value = 'original';
    simplify.value = 1;
    hull.on = false; selfx.on = false;
    if (bones.on) rig.setBones(true, boneSize());

    $('#rig-panel').hidden = !(doc.hasAnim || doc.hasSkel);
    renderRig();
    renderStats(true);
    syncControls();
    $('#doc-name').textContent = doc.name;
    $('#empty-hint').hidden = true;
    app.status.ok(doc.name + ' · ' + doc.items.length + ' mesh' + (doc.items.length === 1 ? '' : 'es'));
    return true;
}

function unload() {
    if (!doc) return;
    disposeLoaded(doc);
    rig.detach();
    wb.detach();
    doc = null;
    syncControls();
}

const boneSize = () => (doc ? doc.bounds.size : 1) * 0.012;

// --- stats ---------------------------------------------------------------------------

const stats = readout('#stats', {
    meshes: 'meshes', verts: 'verts', tris: 'tris', bbox: 'bbox', uvs: 'UVs', colors: 'colors',
    manifold: 'manifold', volume: 'volume', selfx: 'self-int',
});

function markRow(k, good) {
    stats.row(k).classList.toggle('on', good === true);
    stats.row(k).classList.toggle('bad', good === false);
}

/** Geometry totals; `resetChecks` clears the on-demand check rows. */
function renderStats(resetChecks) {
    const s = wb.summary();
    if (!s) {
        stats.set({ meshes: 0, verts: 0, tris: 0, bbox: '—', uvs: '—', colors: '—' });
        resetChecks = true;
    } else {
        stats.set({
            meshes: s.meshes, verts: s.verts.toLocaleString(), tris: s.tris.toLocaleString(),
            bbox: s.size.map((v) => v.toFixed(2)).join(' x '),
            uvs: s.uvs ? 'yes' : 'no', colors: s.colors ? 'yes' : 'no',
        });
    }
    if (resetChecks) {
        const multi = s && s.meshes !== 1;
        stats.set({ manifold: multi ? '(' + s.meshes + ' meshes)' : '—', volume: '—', selfx: '—' });
        markRow('manifold', null); markRow('selfx', null);
    }
}

async function runChecks() {
    stats.set({ manifold: '…', volume: '…', selfx: '…' });
    const r = await wb.checks((part) => {
        stats.set({ manifold: part.manifold ? 'yes' : 'no',
            volume: part.volume != null ? part.volume.toFixed(3) : 'n/a', selfx: 'computing…' });
        markRow('manifold', part.manifold);
    });
    if (!r) { renderStats(true); return null; }
    stats.set('selfx', r.pairs ? r.pairs + ' pair' + (r.pairs === 1 ? '' : 's') : 'none');
    markRow('selfx', r.pairs === 0);
    return r;
}
$('#stats-run').addEventListener('click', runChecks);

// --- view ----------------------------------------------------------------------------

const viewMode = $('#view-mode');
for (const k in COLOR_MODES) viewMode.appendChild(h('option', { value: k }, COLOR_MODES[k]));
viewMode.addEventListener('change', () => wb.setColorMode(viewMode.value));

const hull = toggleButton('#view-hull', { onChange: (on) => wb.setHull(on) });
const selfx = toggleButton('#view-selfx', {
    onChange: async (on) => {
        const n = await wb.setSelfx(on);
        if (on && doc) app.status.set(n ? n + ' intersecting pair' + (n === 1 ? '' : 's') : 'no self-intersections');
    },
});
const uv = toggleButton('#view-uv', { onChange: (on) => setUV(on) });
const bones = toggleButton('#view-bones', { onChange: (on) => rig.setBones(on, boneSize()) });
const shadows = toggleButton('#view-shadows', { on: true, onChange: (on) => { view.shadows = on; keyLight.castsShadow = on; } });
const texture = toggleButton('#view-texture', {
    on: true,
    onChange: (on) => {
        view.texture = on;
        if (doc) for (const it of doc.items) it.node.setBaseColorTexture(on ? it.baseTexture : null);
    },
});
const emissive = bindControl('#view-emissive', {
    out: '#view-emissive-val', fmt: (v) => v.toFixed(2),
    onChange: (v) => { view.emissive = v; if (doc) for (const it of doc.items) it.node.emissive = v; },
});

function setUV(on) {
    view.uv = on;
    uv.on = on;
    $('#uv-inset').hidden = !on;
    if (on) drawUVs($('#uv-canvas'), doc && doc.items);
}

// --- modify + LOD ----------------------------------------------------------------------

for (const b of $$('[data-op]')) {
    b.addEventListener('click', () => { const [label, op, p] = MODIFY[b.dataset.op]; wb.modify(label, op, p); });
}
$('#remesh').addEventListener('click', () => {
    const len = parseFloat($('#remesh-len').value) || 0.05;
    wb.modify('Remesh @' + len, 'remesh', { edgeLen: len, iters: 3 });
});
const simplify = bindControl('#simplify', { out: '#simplify-val', fmt: (v) => Math.round(v * 100) + '%' });
// Simplify runs on release, not on every step of the drag.
simplify.input.addEventListener('change', () => {
    const r = simplify.value;
    if (r < 0.999) wb.modify('Simplify ' + Math.round(r * 100) + '%', 'simplify', { ratio: r, error: 0.01 });
});
$('#mod-reset').addEventListener('click', () => wb.reset());

const lod = bindControl('#lod', {
    out: '#lod-val', fmt: (v) => (wb.lod.built ? Math.round(v * 100) + '%' : '—'),
    onChange: (v) => wb.setLOD(v),
});
$('#lod-build').addEventListener('click', async () => { if (await wb.buildLOD()) lod.value = 1; });
$('#lod-clear').addEventListener('click', () => { wb.clearLOD(); lod.value = 1; });

// --- rig -------------------------------------------------------------------------------

const pause = toggleButton('#rig-pause', { labels: ['Pause', 'Play'], onChange: (on) => { rig.paused = on; } });
const bindPose = toggleButton('#rig-bind', { onChange: (on) => { rig.bindPose = on; } });
bindControl('#blend', { out: '#blend-val', fmt: (v) => v.toFixed(2), onChange: (v) => { rig.blendW = v; } });

function renderRig() {
    rig.renderList($('#anim-list'), () => { $('#blend-row').hidden = rig.blend < 0; });
    $('#blend-row').hidden = rig.blend < 0;
}
function togglePause() { pause.toggle(); }

vp.onFrame((dt) => rig.update(dt, wb.dirty || wb.lod.built));

// --- controls state ----------------------------------------------------------------------

function syncControls() {
    const busy = wb.busy, single = !!doc && doc.items.length === 1;
    $('#stats-run').disabled = busy || !single;
    for (const b of $$('[data-op], #remesh')) b.disabled = busy || !doc;
    simplify.input.disabled = busy || !doc;
    $('#mod-reset').disabled = busy || !(wb.dirty || wb.lod.built);
    $('#lod-build').disabled = busy || wb.lod.built || !single;
    $('#lod-clear').disabled = !wb.lod.built;
    lod.input.disabled = !wb.lod.built;
    if (!wb.lod.built) lod.value = 1;
    for (const b of $$('#export button')) b.disabled = !doc;
    hull.on = wb.view.hull;
    selfx.on = wb.view.selfx;
    if (globalThis.bro && bro.menu && bro.menu.updateItem) {
        for (const f of EXPORT_FORMATS) bro.menu.updateItem('file.export.' + f, { enabled: !!doc });
    }
}

// --- files, export, menu -------------------------------------------------------------------

function openFolder() {
    const d = pickFolder(files.dir || null);
    if (d) files.setDirectory(d.replace(/\\/g, '/'));
}
function openFile() {
    const f = pickFile('Mesh|glb;gltf;obj;ply;stl');
    if (f) files.setSingle(f.replace(/\\/g, '/'));
}
$('#open-folder').addEventListener('click', openFolder);
$('#open-file').addEventListener('click', openFile);

/** Save the document to `path` (skinned glTF keeps its rig when unmodified). */
function exportTo(path, format) {
    if (!doc) { app.status.warn('nothing loaded'); return false; }
    try {
        const ok = exportDoc(doc, format, path, { skinned: !wb.dirty && !wb.lod.built });
        if (ok) app.status.ok('saved ' + fileName(path)); else app.status.error('save returned false');
        return ok;
    } catch (e) {
        app.status.error('save failed: ' + e.message);
        return false;
    }
}
function exportDialog(format) {
    if (!doc) { app.status.warn('nothing loaded'); return; }
    const p = pickSaveFile(format.toUpperCase() + '|' + format, doc.name.replace(/\.[^.]+$/, '') + '.' + format);
    if (p) exportTo(p.replace(/\\/g, '/'), format);
}
for (const f of EXPORT_FORMATS) {
    $('#export').appendChild(h('button.small', { dataset: { format: f }, onclick: () => exportDialog(f) }, f.toUpperCase()));
}

function togglePanel() {
    const panel = $('#ops-panel');
    panel.hidden = !panel.hidden;
    if (globalThis.bro && bro.menu && bro.menu.updateItem) {
        bro.menu.updateItem('view.togglePanel', { label: panel.hidden ? 'Show Ops Panel' : 'Hide Ops Panel' });
    }
}

function buildMenu() {
    const handlers = {
        'file.openFolder': () => openFolder(),
        'file.openFile': () => openFile(),
        'view.togglePanel': () => togglePanel(),
    };
    const exportItems = EXPORT_FORMATS.map((f) => {
        handlers['file.export.' + f] = () => exportDialog(f);
        return { id: 'file.export.' + f, label: 'Save As ' + f.toUpperCase() + '...', enabled: false };
    });
    return {
        file: [
            { id: 'file.openFolder', label: 'Open Folder...', accel: 'Ctrl+O' },
            { id: 'file.openFile', label: 'Open File...' },
            { separator: true },
            ...exportItems,
        ],
        view: [{ id: 'view.togglePanel', label: 'Hide Ops Panel', accel: 'H' }],
        handlers,
    };
}

// --- input ------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'h' || e.key === 'H') togglePanel();
    else if (e.key === ' ') { togglePause(); e.preventDefault(); }
});

const canvas = vp.canvas, drop = $('#drop-overlay');
canvas.addEventListener('dragenter', (e) => { e.preventDefault(); drop.classList.add('show'); });
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('dragleave', (e) => { e.preventDefault(); drop.classList.remove('show'); });
canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('show');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f ? (f.path || f.name || '').replace(/\\/g, '/') : '';
    if (!p) { app.status.warn('the drop carried no path'); return; }
    if (!LOAD_EXTS.includes(fileExt(p))) { app.status.warn('unsupported type: ' + fileName(p)); return; }
    files.setSingle(p);
});

// --- go ----------------------------------------------------------------------------------

renderStats(true);
renderRig();
syncControls();
files.restore();
app.status.set('Ready');

/** Handles for tests. */
export const viewer = {
    vp, scene, files, wb, rig, stats, view, load, unload, exportTo, runChecks, setUV, togglePanel,
    toggles: { hull, selfx, uv, bones, shadows, texture, pause, bindPose },
    get doc() { return doc; },
    get ground() { return ground; },
    get status() { return app.status; },
};
