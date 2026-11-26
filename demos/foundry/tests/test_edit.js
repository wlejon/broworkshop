// Editing by hand, through the mouse and the inspector: drag a joint with the
// gizmo, pull a slider, turn a module's face, and save and open the result.
import { check, done, frames, shot, near, press } from "/lib/kit/test.js";

const fs = require('fs'), path = require('path'), os = require('os');
const F = globalThis.__foundry;
frames(30);
const canvas = F.vp.canvas, rect = canvas.getBoundingClientRect();
const page = (world) => { const s = F.vp.toScreen(world); return [rect.left + s.x, rect.top + s.y]; };
const errors = () => F.report.issues.filter((i) => i.level === 'error').length;

// --- drag the head's joint upward by its green handle --------------------------------
F.setMode('frame');
F.select('head'); frames(4);
const head = F.design.segments.find((s) => s.id === 'head');
const y0 = head.attach[1], h0 = F.report.height;
const [px, py] = page(F.report.rest.pos['head']);
let grab = null;
for (let dy = 12; dy < 160 && !grab; dy += 4) { mouseMove(px, py - dy); frames(1); if (bro.gizmo.hovered === 'y') grab = py - dy; }
check(grab !== null, 'the up handle is under the mouse above the joint');
mouseDown(px, grab); frames(1);
for (let i = 1; i <= 10; i++) { mouseMove(px, grab - i * 6); frames(1); }
check(bro.gizmo.dragging, 'the handle is held');
shot('edit-drag');
mouseUp(px, grab - 60); frames(3);
console.log(`head joint ${y0.toFixed(2)} -> ${head.attach[1].toFixed(2)} m, height ${h0.toFixed(2)} -> ${F.report.height.toFixed(2)} m`);
check(head.attach[1] > y0 + 0.5, 'the joint went up with the handle');
near(head.attach[0], 0, 1e-9, 'and stayed on the centre line');
check(F.report.height > h0 + 0.5, 'and the machine is taller for it');
check(F.history.canUndo(), 'the drag is one step to undo');
press('z', 0x0040 /* ctrl */); frames(3);
near(F.design.segments.find((s) => s.id === 'head').attach[1], y0, 1e-9, 'Ctrl+Z puts the head back');

// --- the inspector: a longer shin ----------------------------------------------------
F.select('shin'); frames(4);
const row = (label) => [...document.querySelectorAll('#inspector .k-field')].find((f) => f.firstChild.textContent === label);
const pull = (label, v) => { const input = row(label).querySelector('input'); input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); frames(3); };
const shin = () => F.design.segments.find((s) => s.id === 'shin');
const len0 = shin().len, leg0 = F.report.move.legLength, mass0 = F.report.mass.total;
pull('length', len0 + 3);
near(shin().len, len0 + 3, 1e-6, 'the slider sets the length');
check(F.report.mass.total > mass0, 'a longer shin is heavier');
check(F.report.move.legLength > leg0 + 2.5, 'and the foot went down with it: the leg is longer');
console.log(`shin ${len0} -> ${shin().len} m: leg ${leg0.toFixed(1)} -> ${F.report.move.legLength.toFixed(1)} m, run ${(F.report.move.sprint * 3.6).toFixed(0)} km/h, problems ${F.report.issues.length}`);
shot('edit-shin');
F.flush(); F.history.undo(); frames(3);
near(shin().len, len0, 1e-9, 'undo takes it back');

// --- a joint with too small an actuator is called out, and one click fixes it -------------
F.select('thigh'); frames(3);
const rating0 = F.design.segments.find((s) => s.id === 'thigh').joint.rating;
pull('rating', 5);
check(F.report.issues.some((i) => i.level === 'error'), 'legs that cannot hold it are a problem that stops it');
check(document.querySelector('#issues .f-issue.err'), 'and the problem is listed');
check(document.querySelector('#headline .err'), 'and the headline shows it');
shot('edit-weak-hips');
[...document.querySelectorAll('#inspector button')].find((b) => b.textContent === 'Rate to load').click(); frames(4);
check(errors() === 0, 'rating the joint to its load clears it');
console.log(`hip rating ${rating0} -> 5 -> ${F.design.segments.find((s) => s.id === 'thigh').joint.rating.toFixed(0)} MN m`);

// --- save, start over, open --------------------------------------------------------------
const name = document.querySelector('#name');
name.value = 'Test article'; name.dispatchEvent(new Event('change', { bubbles: true })); frames(2);
F.flush();
const saved = JSON.stringify(F.design.segments);
const file = path.join(os.tmpdir(), `foundry-test-${Date.now()}.bro`);
check(F.project.saveTo(file), 'it saves');
check(F.project.new(), 'File > New'); frames(3);
check(F.design.name !== 'Test article', 'a new design is the starter');
check(F.project.openPath(file), 'it opens'); frames(3);
fs.rmSync(file, { recursive: true, force: true });
check(F.design.name === 'Test article' && document.querySelector('#name').value === 'Test article', 'what was saved comes back');
check(JSON.stringify(F.design.segments) === saved, 'with every segment as it was');
check(errors() === 0, 'and it still works');
done('foundry editing');
