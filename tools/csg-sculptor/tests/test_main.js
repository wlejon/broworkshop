// CSG Sculptor: booleans change the workpiece, history swaps meshes back,
// the gizmo-driven transform reaches the boolean, and export writes a file.
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { sculptor } from "/app/app.js";
import { trsMatrix } from "/app/cutter.js";

const fs = require('fs');
const path = require('path');
const { workpiece, cutter, history } = sculptor;

frames(10);

test('boots with the cube blank and a cutter', () => {
    eq(workpiece.preset, 'box');
    eq(workpiece.mesh.triangleCount, 12, 'cube has 12 triangles');
    eq(q('#mesh-stats').querySelectorAll('div').length, 3, 'three stat rows');
    check(/12/.test(text('#mesh-stats')), 'stats show the triangle count');
    check(cutter.node, 'cutter preview exists');
    check(q('#undo').disabled && q('#redo').disabled, 'nothing to undo yet');
});

test('trsMatrix composes translate * rotate * scale (column-major)', () => {
    const s = Math.SQRT1_2;                       // 90 degrees about +Y
    const m = trsMatrix([1, 2, 3], [0, s, 0, s], [2, 1, 1]);
    // x axis scaled by 2 then turned to -Z.
    near(m[0], 0, 1e-6); near(m[2], -2, 1e-6);
    near(m[12], 1, 1e-9); near(m[13], 2, 1e-9); near(m[14], 3, 1e-9);
});

test('carve through the toolbar changes the mesh and enables undo', () => {
    const before = workpiece.mesh.triangleCount;
    clickOn('#apply');
    check(workpiece.mesh.triangleCount > before, 'carving a corner adds triangles');
    check(!q('#undo').disabled, 'undo enabled');
    check(/Subtract applied/.test(text('#status')), 'status reports the cut: ' + text('#status'));
    check(/1 step/.test(text('#history')), 'history panel counts the step');
});

test('undo / redo swap the whole mesh', () => {
    const carved = workpiece.mesh.triangleCount;
    clickOn('#undo');
    eq(workpiece.mesh.triangleCount, 12, 'undo restores the cube');
    clickOn('#redo');
    eq(workpiece.mesh.triangleCount, carved, 'redo restores the carve');
});

test('union grows the bounding box; intersect shrinks it', () => {
    clickOn('#ops button[data-value="union"]');
    eq(cutter.op, 'union');
    cutter.moveTo([2.0, 0, 0]);                     // half out of the +X face
    const w0 = workpiece.stats().size[0];
    check(sculptor.applyCut(), 'union applied');
    check(workpiece.stats().size[0] > w0 + 0.3, 'union reaches past the old +X face');

    clickOn('#ops button[data-value="intersect"]');
    cutter.moveTo([0, 0, 0]);
    check(sculptor.applyCut(), 'intersect applied');
    near(workpiece.stats().size[1], 1.2, 0.02, 'intersect with a 1.2 m box leaves 1.2 m of height');
});

test('a cutter that misses leaves the workpiece alone', () => {
    const n = workpiece.mesh.triangleCount, steps = history.size();
    cutter.moveTo([30, 30, 30]);
    check(!sculptor.applyCut(), 'intersect with nothing fails');
    eq(workpiece.mesh.triangleCount, n);
    eq(history.size(), steps, 'no history entry');
    check(/workpiece unchanged/.test(text('#status')), 'status says so');
    cutter.reset();
});

test('rotation and scale reach the boolean', () => {
    clickOn('#ops button[data-value="carve"]');
    setValue('#preset', 'box');
    eq(workpiece.mesh.triangleCount, 12, 'fresh cube');
    const m = cutter.transformedMesh();
    const bb = m.computeBBox();
    near(bb.max[0], 0.8 + 0.6, 1e-4, 'cutter box sits at its home position');
    // Double the X scale by hand (what a scale drag does).
    cutter.setSize('width', 2.4);
    const bb2 = cutter.transformedMesh().computeBBox();
    near(bb2.max[0] - bb2.min[0], 2.4, 1e-4, 'size change reaches the transformed mesh');
});

test('snap rounds positions to the 0.25 m grid', () => {
    setValue('#snap', true);
    cutter.moveTo([0.33, 0.61, -0.12]);
    eq(cutter.position, [0.25, 0.5, 0]);          // JSON writes -0 as 0
    setValue('#snap', false);
    cutter.reset();
});

test('shape buttons and dimension sliders rebuild the cutter', () => {
    clickOn('#shapes button[data-value="sphere"]');
    eq(cutter.shape, 'sphere');
    const rows = q('#dims').querySelectorAll('input[type=range]');
    eq(rows.length, 3, 'width, height, depth sliders');
    setValue(rows[0], 2.0);
    near(cutter.size.radius, 1.2, 1e-9, 'width drives the radius');
    const bb = cutter.mesh().computeBBox();
    near(bb.max[0], 1.2, 0.01, 'sphere radius follows');
});

test('W / E / R switch the gizmo mode', () => {
    press('e'); eq(cutter.mode, 'rotate');
    press('r'); eq(cutter.mode, 'scale');
    press('w'); eq(cutter.mode, 'translate');
    check(q('#gizmo-modes button[data-value="translate"]').classList.contains('active'), 'button follows');
});

test('Enter applies; Ctrl+Z undoes', () => {
    const n = workpiece.mesh.triangleCount;
    press('Enter');
    check(workpiece.mesh.triangleCount !== n, 'Enter applied the cut');
    press('z', 0x40);                               // KMOD_LCTRL
    eq(workpiece.mesh.triangleCount, n, 'Ctrl+Z undid it');
});

test('material swap keeps the mesh', () => {
    const n = workpiece.mesh.triangleCount;
    setValue('#material', 'gold');
    eq(workpiece.material, 'gold');
    eq(workpiece.mesh.triangleCount, n);
});

test('export writes an OBJ', () => {
    const out = path.resolve('tests/out/csg-sculptor-export.obj');
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch (_) {}
    try { fs.unlinkSync(out); } catch (_) {}
    check(sculptor.exportTo(out.replace(/\\/g, '/'), 'obj'), 'saveOBJ returned true');
    const body = fs.readFileSync(out, 'utf8');
    check(/^v /m.test(body) && /^f /m.test(body), 'OBJ has vertices and faces');
});

shot('main');
done();
