// The designer driven as a player would: place a module by clicking a hull,
// undo it, hang a new segment, change armour, and run the test stand.
import { check, done, frames, clickOn, shot } from "/lib/kit/test.js";

const F = globalThis.__foundry;
frames(30);
check(F.report.issues.filter((i) => i.level === 'error').length === 0, 'the starter has nothing that stops it');

// Click the pelvis's front face with a tank armed.
const canvas = F.vp.canvas, rect = canvas.getBoundingClientRect();
const clickWorld = (world) => {      // not `click`: that is headless's own, which clickOn calls
    const s = F.vp.toScreen(world);
    const o = { bubbles: true, button: 0, clientX: rect.left + s.x, clientY: rect.top + s.y };
    canvas.dispatchEvent(new MouseEvent('mousemove', o));
    frames(2);
    canvas.dispatchEvent(new MouseEvent('mousedown', o));
    canvas.dispatchEvent(new MouseEvent('mouseup', o));
    frames(3);
};
F.setMode('bays');
const before = F.design.modules.length, mass0 = F.report.mass.total;
F.arm('tank');
const pelvis = F.report.rest.pos[F.report.insts[0].id];
clickWorld([pelvis[0], pelvis[1] + 1.5, pelvis[2]]);
check(F.design.modules.length === before + 1, 'a click on a hull places the armed module');
check(F.sel.mod, 'and selects it');
check(F.report.mass.total > mass0, 'and the machine is heavier for it');
shot('test-placed');
F.flush();
check(F.history.canUndo(), 'the placement can be undone');
F.history.undo(); frames(3);
check(F.design.modules.length === before, 'undo takes it out');
F.history.redo(); frames(3);
check(F.design.modules.length === before + 1, 'redo puts it back');

// Hang a new segment from the torso.
F.setMode('frame');
F.select('torso'); frames(3);
const segs0 = F.design.segments.length;
const hang = [...document.querySelectorAll('#modePanel button')].find((b) => b.textContent === 'Hang from selection');
hang.click(); frames(4);
check(F.design.segments.length === segs0 + 1, 'a segment is hung from the selection');
check(document.querySelectorAll('#tree .f-node').length === F.design.segments.length, 'and is in the tree');

// Thicker armour everywhere is heavier and slower in the air.
F.setMode('armor');
const tw0 = F.report.flight.tw;
[...document.querySelectorAll('#modePanel button')].find((b) => b.textContent === '+25%').click(); frames(3);
check(F.report.flight.tw < tw0, 'more plate, less thrust for the weight');

clickOn('#settle'); frames(3);
check(F.report.issues.filter((i) => i.level === 'error').length === 0, 'sized to load, it still works');

F.setMode('test');
for (const g of ['walk', 'sprint', 'hover', 'burn', 'stand']) { F.setGait(g); frames(8); }
shot('test-stand');
done('foundry designer');
