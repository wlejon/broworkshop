// Mesh Viewer: loads generated OBJ / STL / PLY / GLB fixtures through the
// file panel and drives stats, checks, view layers, worker edits, LOD, the
// rig and export. Worker results arrive on real threads, so each async op is
// pumped with waitFor (settle) rather than awaited.
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot, waitFor } from "/lib/kit/test.js";
import { viewer } from "/app/app.js";
import { edgeIndices } from "/app/workbench.js";
import { scanDir } from "/app/files.js";

const fs = require('fs');
const path = require('path');

const OUT = path.resolve('tests/out/mesh-viewer').replace(/\\/g, '/');
const FIX = OUT + '/fixtures';
fs.mkdirSync(FIX, { recursive: true });
const savedPrefs = viewer.files.prefs.snapshot();

/** Pump until `p` settles; returns its value or throws its error. */
function settle(p, what, ms) {
    let finished = false, value, error;
    Promise.resolve(p).then((v) => { finished = true; value = v; }, (e) => { finished = true; error = e; });
    waitFor(() => finished, what, ms || 30000);
    if (error) throw error;
    return value;
}

// --- fixtures ---------------------------------------------------------------------

Mesh.box(0.5, 0.5, 0.5).saveOBJ(FIX + '/a-box.obj');
Mesh.sphere(0.6, 24, 16).saveSTL(FIX + '/b-sphere.stl');
// Two overlapping boxes merged into one mesh: self-intersecting, not one shell.
const other = Mesh.box(0.5, 0.5, 0.5);
other.transform(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 0.3, 0.2, 1]));
Mesh.merge([Mesh.box(0.5, 0.5, 0.5), other]).savePLY(FIX + '/c-overlap.ply');
fs.writeFileSync(FIX + '/notes.txt', 'not a mesh');

/** A 2-bone column (bone 1 above bone 0) with one clip bending bone 1. */
function writeRiggedGlb(file) {
    const column = Mesh.box(0.2, 1.0, 0.2);
    column.transform(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]));   // y in [0, 2]
    const n = column.vertexCount, pos = column.positions;
    const weights = new Float32Array(n * 4), indices = new Uint32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const upper = pos[i * 3 + 1] > 1;
        indices[i * 4] = upper ? 1 : 0;
        weights[i * 4] = 1;
    }
    const inv = (ty) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -ty, 0, 1]);
    const skeleton = new Skeleton({ bones: [
        { name: 'root', parent: -1, localT: [0, 0, 0], localR: [0, 0, 0, 1], localS: [1, 1, 1], inverseBind: inv(0) },
        { name: 'top', parent: 0, localT: [0, 1, 0], localR: [0, 0, 0, 1], localS: [1, 1, 1], inverseBind: inv(1) },
    ] });
    const skin = new SkinData({ boneWeights: weights, boneIndices: indices,
        inverseBindMatrices: new Float32Array([...inv(0), ...inv(1)]) });
    const s = Math.sin(Math.PI / 4), c = Math.cos(Math.PI / 4);    // 90 degrees about Z at t = 1
    const bend = new AnimationClip({ name: 'bend', duration: 2, channels: [{
        boneIndex: 1, path: 'rotation', interp: 'linear',
        times: new Float32Array([0, 1, 2]), values: new Float32Array([0, 0, 0, 1, 0, 0, s, c, 0, 0, 0, 1]),
    }] });
    const still = new AnimationClip({ name: 'still', duration: 1, channels: [{
        boneIndex: 1, path: 'rotation', interp: 'linear',
        times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
    }] });
    return column.saveGLTF(file, { skin, skeleton, animations: [bend, still] });
}
const haveGlb = (() => { try { return writeRiggedGlb(FIX + '/d-rigged.glb'); } catch (e) { console.log('  (rigged fixture: ' + e.message + ')'); return false; } })();

frames(5);

// --- tests ------------------------------------------------------------------------

test('boots empty with the kit layout', () => {
    check(!viewer.doc, 'nothing loaded');
    eq(q('#stats').querySelectorAll('div').length, 9, 'nine stat rows');
    eq(viewer.stats.get('meshes'), '0');
    eq(q('#view-mode').value, 'original');
    eq(q('#view-mode').options.length, 5, 'five colour modes');
    check(q('#stats-run').disabled && q('#lod-build').disabled, 'checks and LOD need a file');
    eq(q('#export').querySelectorAll('button').length, 4, 'four export formats');
    check(q('#view-shadows').classList.contains('active') && q('#view-texture').classList.contains('active'),
        'shadows and texture start on');
});

test('edgeIndices lists each triangle edge once', () => {
    eq(edgeIndices(new Uint32Array([0, 1, 2, 2, 1, 3])).length, 10, 'two triangles sharing an edge: 5 edges');
});

test('scanDir lists only mesh files, sorted', () => {
    const r = scanDir(FIX);
    check(r.ok);
    eq(r.files.map((f) => path.basename(f)).join(','),
        ['a-box.obj', 'b-sphere.stl', 'c-overlap.ply'].concat(haveGlb ? ['d-rigged.glb'] : []).join(','));
    check(!scanDir(FIX + '/missing').ok, 'a missing dir reports failure');
});

test('open a folder: file list, remembered dir, click loads', () => {
    check(viewer.files.setDirectory(FIX), 'directory opened');
    eq(viewer.files.prefs.data.dir, FIX, 'folder remembered');
    eq(q('#file-list').querySelectorAll('.file-item').length, haveGlb ? 4 : 3);
    check(/file/.test(text('#dir-status')), 'dir status shows the count');
    clickOn('#file-list .file-item');
    frames(2);
    check(viewer.doc, 'first file loaded');
    eq(viewer.doc.name, 'a-box.obj');
    check(q('#file-list .file-item').classList.contains('selected'), 'row selected');
    eq(text('#doc-name'), 'a-box.obj');
    check(q('#empty-hint').hidden, 'empty hint hidden');
});

test('stats describe the box', () => {
    eq(viewer.stats.get('meshes'), '1');
    eq(viewer.stats.get('tris'), '12');
    eq(viewer.stats.get('bbox'), '1.00 x 1.00 x 1.00');
    check(!q('#stats-run').disabled, 'checks available for one mesh');
    // The ground sits just under the model.
    check(viewer.ground.y < -0.5 && viewer.ground.y > -0.6, 'ground under the box: ' + viewer.ground.y);
});

test('run checks: a closed box is manifold with volume 1', () => {
    clickOn('#stats-run');
    waitFor(() => !viewer.wb.busy && viewer.stats.get('selfx') !== '…' && viewer.stats.get('selfx') !== 'computing…', 'checks');
    eq(viewer.stats.get('manifold'), 'yes');
    near(parseFloat(viewer.stats.get('volume')), 1, 0.01, 'unit cube volume');
    eq(viewer.stats.get('selfx'), 'none');
    check(viewer.stats.row('manifold').classList.contains('on'), 'manifold row marked good');
});

test('colour modes: normals paints vertex colours, original clears them', () => {
    setValue('#view-mode', 'normals');
    const w = viewer.doc.items[0].work;
    check(w.hasColors, 'normals view writes colours');
    near(w.colors[3], 1, 1e-6, 'alpha 1');
    setValue('#view-mode', 'original');
    check(!viewer.doc.items[0].work.hasColors, 'original view drops them again');
});

test('curvature bake runs in the worker', () => {
    settle(viewer.wb.setColorMode('curvature'), 'curvature bake');
    check(viewer.doc.items[0].work.hasColors, 'baked colours applied');
    settle(viewer.wb.setColorMode('original'), 'back to original');
});

test('convex hull overlay is drawn as edges', () => {
    clickOn('#view-hull');
    waitFor(() => !viewer.wb.busy && viewer.doc.items[0].hullNode, 'hull');
    check(viewer.toggles.hull.on, 'toggle on');
    check(viewer.doc.items[0].hullNode.visible, 'hull visible');
    clickOn('#view-hull');
    check(!viewer.doc.items[0].hullNode.visible && !viewer.toggles.hull.on, 'toggled off');
});

test('subdivide in the worker marks the geometry modified', () => {
    clickOn('[data-op="subLoop"]');
    waitFor(() => !viewer.wb.busy && viewer.wb.dirty, 'subdivide');
    eq(viewer.stats.get('tris'), '48', 'loop subdivision quadruples the triangles');
    check(!q('#mod-reset').disabled, 'reset enabled');
    check(/Subdivide Loop/.test(text('#status')), 'status: ' + text('#status'));
});

test('simplify on release, then reset to the file', () => {
    viewer.wb.dirty = false;
    settle(viewer.wb.modify('Subdivide Midpoint', 'subdivideMid', { iters: 2 }), 'subdivide more');
    const before = viewer.doc.items[0].work.triangleCount;
    setValue('#simplify', 0.3);
    waitFor(() => !viewer.wb.busy && viewer.doc.items[0].work.triangleCount < before, 'simplify');
    eq(text('#simplify-val'), '30%');
    clickOn('#mod-reset');
    waitFor(() => !viewer.wb.busy && !viewer.wb.dirty, 'reset');
    eq(viewer.stats.get('tris'), '12', 'back to the file mesh');
    check(q('#mod-reset').disabled, 'reset disabled again');
});

test('UV unwrap gives the box UVs and the inset draws them', () => {
    clickOn('[data-op="unwrap"]');
    waitFor(() => !viewer.wb.busy && viewer.doc.items[0].work.hasUVs, 'unwrap');
    eq(viewer.stats.get('uvs'), 'yes');
    clickOn('#view-uv');
    check(!q('#uv-inset').hidden && viewer.view.uv, 'inset shown');
    clickOn('#view-uv');
    check(q('#uv-inset').hidden, 'inset hidden');
    settle(viewer.wb.reset(), 'reset');
});

test('LOD chain: build, drag to a lower level, clear', () => {
    viewer.load(FIX + '/b-sphere.stl');
    frames(2);
    const full = viewer.doc.items[0].work.triangleCount;
    clickOn('#lod-build');
    waitFor(() => !viewer.wb.busy && viewer.wb.lod.built, 'lod build');
    check(!q('#lod').disabled && q('#lod-build').disabled, 'slider live, build disabled');
    setValue('#lod', 0.25);
    waitFor(() => viewer.wb.lod.shownTris && viewer.wb.lod.shownTris < full, 'lod level');
    check(viewer.wb.lod.shownTris < full * 0.5, 'a quarter level shows far fewer triangles: ' + viewer.wb.lod.shownTris);
    eq(text('#lod-val'), '25%');
    clickOn('#lod-clear');
    check(!viewer.wb.lod.built && q('#lod').disabled, 'chain cleared');
});

test('self-intersection check and overlay on overlapping boxes', () => {
    clickOn('#file-list .file-item:nth-child(3)');
    frames(2);
    eq(viewer.doc.name, 'c-overlap.ply');
    const r = settle(viewer.runChecks(), 'checks');
    check(r.pairs > 0, 'pairs found: ' + r.pairs);
    check(viewer.stats.row('selfx').classList.contains('bad'), 'self-int row marked bad');
    clickOn('#view-selfx');
    waitFor(() => !viewer.wb.busy && viewer.doc.items[0].selfxNode, 'selfx overlay');
    check(/intersecting pair/.test(text('#status')), 'status: ' + text('#status'));
    clickOn('#view-selfx');
    check(!viewer.doc.items[0].selfxNode, 'overlay removed');
});

test('export writes OBJ / STL / PLY / GLB', () => {
    for (const f of ['obj', 'stl', 'ply', 'glb']) {
        const out = OUT + '/export.' + f;
        try { fs.unlinkSync(out); } catch (_) {}
        check(viewer.exportTo(out, f), f + ' saved');
        check(fs.existsSync(out) && fs.statSync(out).size > 0, f + ' file written');
    }
    eq(Mesh.loadOBJ(OUT + '/export.obj').triangleCount, viewer.doc.items[0].work.triangleCount, 'OBJ round-trips');
});

test('view toggles: shadows, texture, emissive, H hides the panel', () => {
    clickOn('#view-shadows');
    check(!viewer.view.shadows, 'shadows off');
    clickOn('#view-shadows');
    clickOn('#view-texture');
    check(!viewer.view.texture, 'texture off');
    clickOn('#view-texture');
    setValue('#view-emissive', 0.5);
    near(viewer.doc.items[0].node.emissive, 0.5, 1e-6, 'emissive applied');
    eq(text('#view-emissive-val'), '0.50');
    press('h');
    check(q('#ops-panel').hidden, 'H hides the panel');
    press('h');
    check(!q('#ops-panel').hidden, 'H shows it again');
});

if (haveGlb) {
    test('rigged glTF: clips list, skinning bends the column, blend and bind pose', () => {
        check(viewer.load(FIX + '/d-rigged.glb'), 'loaded');
        const d = viewer.doc;
        check(d.hasSkin && d.hasSkel && d.hasAnim, 'skin, skeleton and clips');
        check(!q('#rig-panel').hidden, 'rig panel shown');
        eq(q('#anim-list').querySelectorAll('.anim-item').length, 2);
        check(q('#anim-list .anim-item').classList.contains('active'), 'first clip plays');

        // At t = 1 bone 1 is turned 90 degrees about the joint at y = 1:
        // the column top swings out to |x| = 1. Inverse binds applied twice
        // would leave it near the axis at |x| 0.2.
        viewer.rig.time = 0;
        viewer.rig.update(1, false);
        const p = d.items[0].work.positions;
        let maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < p.length; i += 3) { maxX = Math.max(maxX, Math.abs(p[i])); maxY = Math.max(maxY, p[i + 1]); }
        check(maxX > 0.9, 'top swung sideways: |x| ' + maxX.toFixed(2));
        check(maxY < 1.3, 'nothing above the joint band: y ' + maxY.toFixed(2));

        clickOn('#view-bones');
        eq(viewer.rig.boneCount, 2, 'a marker per bone');
        clickOn('#view-bones');
        eq(viewer.rig.boneCount, 0);

        viewer.rig.choose(1, true);     // shift-click: blend with 'still'
        viewer.rig.renderList(q('#anim-list'));
        check(q('#anim-list .anim-item:nth-child(2)').classList.contains('blend'), 'second clip blends');

        clickOn('#rig-bind');
        viewer.rig.update(0, false);
        let top = -Infinity;
        for (let i = 1; i < p.length; i += 3) top = Math.max(top, d.items[0].work.positions[i]);
        near(top, 2, 1e-3, 'bind pose restores the straight column');
        clickOn('#rig-bind');
        press(' ');
        check(viewer.rig.paused && /Play/.test(text('#rig-pause')), 'Space pauses');
        press(' ');
    });
}

test('a missing file reports instead of throwing', () => {
    check(!viewer.load(FIX + '/missing.obj'), 'load fails');
    check(!viewer.doc, 'nothing loaded');
    check(/load failed/.test(text('#status')), 'status: ' + text('#status'));
});

viewer.load(FIX + '/c-overlap.ply');
frames(20);
shot('main');

viewer.files.prefs.restore(savedPrefs);
done('mesh-viewer');
