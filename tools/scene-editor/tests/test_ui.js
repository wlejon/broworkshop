// The editor through its UI: toolbar, outliner, inspector, undo buttons,
// keyboard shortcuts, the VCB panel, and a push/pull driven by real mouse
// input on the canvas.
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot } from "/lib/kit/test.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";

const CTRL = 0x0040;
frames(6);
const E = window.__editor, ed = E.ed, reg = E.registry;
const rows = () => document.querySelectorAll('#outliner-list .ol-row').length;
const canvasRect = () => q('#canvas').getBoundingClientRect();

// Page coordinates of a world point on the canvas.
function screenOf(world) {
    const r = canvasRect();
    const s = worldToScreen(world, ed.viewport.view(), r.width, r.height);
    return { x: r.left + s.x, y: r.top + s.y };
}

test('boots with one box, select tool, empty history', () => {
    eq(rows(), 1, 'outliner rows');
    eq(reg.primitives[0].name, 'Box');
    eq(text('#tool-name'), 'select');
    check(q('[data-tool=select]').classList.contains('active'), 'select button active');
    check(q('#undo').disabled && q('#redo').disabled, 'undo/redo disabled');
    eq(text('#history-info'), 'history: empty');
});

test('toolbar switches tools', () => {
    clickOn('[data-tool=line]');
    eq(E.currentTool, 'line');
    eq(text('#tool-name'), 'line');
    check(q('[data-tool=line]').classList.contains('active'), 'line active');
    check(!q('[data-tool=select]').classList.contains('active'), 'select inactive');
    clickOn('[data-tool=select]');
    eq(E.currentTool, 'select');
});

test('outliner add, undo and redo buttons', () => {
    clickOn('#outliner-add [data-type=sphere]');
    eq(rows(), 2, 'sphere row added');
    check(/Sphere 2/.test(text('#outliner-list')), 'named Sphere 2');
    check(!q('#undo').disabled, 'undo enabled');
    check(/Add Sphere 2/.test(text('#history-info')), 'history line names the add');
    clickOn('#undo');
    eq(rows(), 1, 'undo removes it');
    check(!q('#redo').disabled, 'redo enabled');
    clickOn('#redo');
    eq(rows(), 2, 'redo restores it');
});

test('outliner row selects; inspector edits the transform', () => {
    clickOn('#outliner-list .ol-row[data-id="1"] .ol-name');
    eq(reg.active.name, 'Box', 'box selected');
    check(/Box/.test(text('#inspector .insp-title')), 'inspector shows the box');
    setValue('#inspector input[data-field=translation1]', 2.5);
    near(reg.active.translation[1], 2.5, 1e-9, 'y moved');
    check(/Transform/.test(text('#history-info')), 'recorded as Transform');
    setValue('#inspector input[data-field=rotation1]', 90);
    near(reg.active.worldCentroid()[1], 2.5, 1e-6, 'rotation keeps the centroid');
    press('z', CTRL);
    press('z', CTRL);
    near(reg.active.translation[1], 0, 1e-9, 'Ctrl+Z twice undoes both edits');
    eq(q('#inspector input[data-field=translation1]').value, '0', 'inspector follows undo');
});

test('visibility toggle and delete from the outliner', () => {
    const sphere = reg.primitives.find(p => p.name === 'Sphere 2');
    clickOn(`#outliner-list .ol-row[data-id="${sphere.id}"] .ol-vis`);
    eq(sphere.visible, false, 'hidden');
    clickOn(`#outliner-list .ol-row[data-id="${sphere.id}"] .ol-del`);
    eq(reg.getById(sphere.id), null, 'deleted');
    eq(rows(), 1);
});

test('rectangle with typed dimensions through the VCB', () => {
    clickOn('[data-tool=rectangle]');
    const before = reg.primitives.length;
    E.beginRectangle([3, 0, 3]);
    check(!q('#measure-box').hidden, 'VCB shown');
    check(/Dimensions/.test(text('#measure-box')), 'pair mode label');
    for (const k of ['2', ',', '3']) press(k);
    check(/2,3/.test(text('#measure-box')), 'VCB echoes the buffer');
    press('Enter');
    eq(reg.primitives.length, before + 1, 'rectangle created');
    check(q('#measure-box').hidden, 'VCB hidden after commit');
    check(/added Rectangle/.test(text('#pick-info')), 'status reports it');
    press('z', CTRL);
    eq(reg.primitives.length, before, 'undo removes it');
});

test('push/pull by mouse on the canvas', () => {
    clickOn('[data-tool=pushpull]');
    const box = reg.primitives[0];
    reg.setActive(box.id);
    const trisBefore = box.indices.length / 3;
    const top = screenOf([0.3, 1, 0.3]);
    mouseDown(top.x, top.y, 0);
    flush();
    check(E.pushpull.active, 'drag started');
    near(E.pushpull.axis[1], 1, 1e-6, 'on the top face');
    check(!q('#measure-box').hidden, 'VCB shown during the drag');
    for (let i = 1; i <= 6; i++) { mouseMove(top.x, top.y - 15 * i); flush(); }
    check(E.pushpull.distance > 0.1, `pulled up (distance ${E.pushpull.distance})`);
    mouseUp(top.x, top.y - 90, 0);
    flush();
    check(!E.pushpull.active, 'committed on release');
    eq(box.indices.length / 3, trisBefore, 'closed solid keeps its topology');
    check(box.worldCentroid()[1] > 0.05, 'box grew upward');
    check(/Push\/pull/.test(text('#history-info')), 'history names the push/pull');
    check(/re-extrude/.test(text('#measure-box')), 'VCB offers to re-apply');
    shot('ui-pushpull');
    press('Escape');
    check(q('#measure-box').hidden, 'Esc dismisses the offer');
    press('z', CTRL);
    near(box.worldCentroid()[1], 0, 1e-5, 'undo restores the box');
});

test('hovering a corner shows the endpoint snap marker', () => {
    clickOn('[data-tool=select]');
    const c = screenOf([1, 1, 1]);
    mouseMove(c.x + 2, c.y + 2);
    flush();
    eq(q('#snap-marker').style.display, 'block', 'marker shown');
    check(/endpoint/i.test(text('#snap-info')), 'labelled endpoint: ' + text('#snap-info'));
    mouseMove(canvasRect().left + 30, canvasRect().top + 30);
    flush();
    eq(q('#snap-marker').style.display, 'none', 'marker hidden off the model');
});

test('line by mouse; right-click keeps the open chain as edges', () => {
    clickOn('[data-tool=line]');
    const a = screenOf([2.2, 0, -1]), b = screenOf([2.2, 0, 0.5]);
    click(a.x, a.y); flush();
    check(E.lineToolState.active, 'first click starts the chain');
    click(b.x, b.y); flush();
    eq(E.lineToolState.points.length, 2, 'second click adds a point');
    mouseDown(b.x, b.y, 2); mouseUp(b.x, b.y, 2); flush();
    check(!E.lineToolState.active, 'right-click ended the chain');
    check(!ed.viewport.controls.dragging, 'and did not start an orbit');
    const edges = reg.root.children.filter(o => o.kind === 'edge-primitive');
    eq(edges.length, 1, 'one edge primitive');
    check(/Polyline/.test(edges[0].name), 'named Polyline');
    press('z', CTRL);
    eq(reg.root.children.filter(o => o.kind === 'edge-primitive').length, 0, 'undo removes it');
});

test('Esc cancels a drawing gesture, then leaves a group', () => {
    clickOn('[data-tool=line]');
    E.beginLine([0, 0, 3]);
    check(E.lineToolState.active, 'line started');
    press('Escape');
    check(!E.lineToolState.active, 'Esc cancelled the line');
    clickOn('[data-tool=select]');
    reg.setActive(reg.primitives[0].id);
    clickOn('[data-action=group]');
    const g = reg.active;
    eq(g.kind, 'group', 'grouped');
    reg.enterContext(g);
    check(!q('#context-breadcrumb').hidden, 'breadcrumb shown inside the group');
    press('Escape');
    check(reg.editContext === reg.root, 'Esc left the group');
    check(q('#context-breadcrumb').hidden, 'breadcrumb hidden');
});

shot('ui-final');
done('scene-editor ui');
