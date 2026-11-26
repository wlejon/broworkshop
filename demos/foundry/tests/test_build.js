// Building onto the machine as a player would: hang a pod off each side of
// the torso, fill it with a gun through the face it should fire from, feed
// and power it, see the report change, then take the pod off again.
import { check, done, frames, shot } from "/lib/kit/test.js";
import { faceName, hullBasis, hullToLocal, hullCenter } from "/lib/mech/skeleton.js";
import { add } from "/lib/mech/vec.js";

const F = globalThis.__foundry;
frames(30);
const canvas = F.vp.canvas, rect = canvas.getBoundingClientRect();
const page = (world) => { const s = F.vp.toScreen(world); return [rect.left + s.x, rect.top + s.y]; };
const button = (root, text) => [...document.querySelectorAll(root + ' button')].find((b) => b.textContent.trim() === text);
const seg = (id) => F.design.segments.find((s) => s.id === id);
const centre = (id) => { const s = seg(id); return add(F.report.rest.pos[F.report.insts.find((it) => it.seg.id === id).id], hullToLocal(hullBasis(s), hullCenter(s))); };

// Straight on from the front.
F.vp.reframe([0, 30, 0], 130, { yaw: Math.PI, pitch: -0.05 }); frames(4);

// --- hang a pod from the torso ------------------------------------------------------------
F.setMode('frame');
mouseMove(...page(centre('torso'))); click(...page(centre('torso'))); frames(4);
check(F.sel.seg === 'torso', 'a click on the torso selects it');
const select = document.querySelector('#modePanel select');
select.value = 'pod'; select.dispatchEvent(new Event('change', { bubbles: true }));
const n0 = F.report.insts.length, dps0 = F.report.dps;
button('#modePanel', 'Hang from selection').click(); frames(5);
const pod = F.sel.seg;
check(pod && seg(pod).parent === 'torso', 'the pod hangs from the torso and is selected');
check(F.report.insts.length === n0 + 2, 'one on each side');
check(Math.abs(seg(pod).attach[0]) > seg('torso').hu[0], 'out past the torso, not inside it');
shot('build-pod');

// --- put an autocannon through its front face -----------------------------------------------
F.setMode('bays');
button('#modePanel', 'Autocannon').click(); frames(2);
const at = page(centre(pod));
mouseMove(...at); frames(3);
shot('build-ghost', '#stage');
click(...at); frames(5);
const gun = F.design.modules.find((m) => m.seg === pod && m.type === 'gun.autocannon');
check(gun, 'a click on the pod places the gun in it');
console.log('gun shows through the', faceName(seg(pod), gun.face, 1), 'face; size', gun.size.join('x'));
check(faceName(seg(pod), gun.face, 1) === 'front', 'through the face that was clicked: the front');
check(F.sel.mod === gun.id, 'and it is selected');

// Longer barrel: grow it along the bore from the inspector.
const sizeInputs = [...document.querySelectorAll('#inspector .f-xyz')][0].querySelectorAll('input');
const axis = gun.size.findIndex((v, a) => a === 'uvw'.indexOf(gun.face[1]));
sizeInputs[axis].value = gun.size[axis] + 1; sizeInputs[axis].dispatchEvent(new Event('change', { bubbles: true })); frames(4);
console.log(`fire ${dps0.toFixed(0)} -> ${F.report.dps.toFixed(0)} MW; problems: ${F.report.issues.map((i) => i.text).join(' | ') || 'none'}`);

// A gun with no magazine and no line to feed it is a problem the list names.
check(F.report.issues.some((i) => /feed|ammun|magazine/i.test(i.text)), 'an unfed gun is called out');
button('#modePanel', 'Magazine').click(); frames(2);
mouseMove(at[0], at[1] - 30); click(at[0], at[1] - 30); frames(4);
check(F.design.modules.some((m) => m.seg === pod && m.type === 'ammo'), 'a magazine goes in beside it');
press_escape();
document.querySelector('#settle').click(); frames(5);
console.log('after magazine + size to load:', F.report.issues.map((i) => i.text).join(' | ') || 'no problems');
check(!F.report.issues.some((i) => i.level === 'error'), 'fed and sized, nothing stops it');
console.log(`fire now ${F.report.dps.toFixed(0)} MW`);
check(F.report.dps > dps0, 'two more guns, fed: more fire');
shot('build-armed');
F.setMode('armor'); frames(5); shot('build-armed-armour', '#stage');

// --- one side only, then both again, from the inspector's checkbox ------------------------------
F.setMode('frame'); F.select(pod); frames(3);
const both = () => [...document.querySelectorAll('#inspector .k-field')].find((f) => f.firstChild.textContent === 'both sides').querySelector('input');
const mass2 = F.report.mass.total;
both().click(); frames(4);
check(!seg(pod).mirror && F.report.insts.length === n0 + 1, 'unticked, the pod is on one side only');
check(F.report.mass.total < mass2, 'and the machine is lighter by one pod');
console.log('one pod: balance side-to-side', F.report.com[0].toFixed(2), 'm off centre; problems:', F.report.issues.map((i) => i.text).join(' | ') || 'none');
check(Math.abs(F.report.com[0]) > 0.01, 'its centre of mass is off to that side');
both().click(); frames(4);
check(seg(pod).mirror && F.report.insts.length === n0 + 2, 'ticked, it is back on both');

// --- thicken the plate on the face that was clicked ------------------------------------------
F.setMode('armor');
click(...page(centre('torso'))); frames(4);
check(F.sel.seg === 'torso' && F.sel.face, 'a click in the armour mode picks a face of the torso');
check(faceName(seg('torso'), F.sel.face, 1) === 'front', 'the one facing the camera: the front');
const faceRow = document.querySelector('#inspector .f-face.on');
check(faceRow && faceRow.querySelector('.nm').textContent === 'front', 'and its row is the lit one');
const t0 = seg('torso').armor[F.sel.face].t, am0 = F.report.mass.armor;
const plate = faceRow.querySelector('input[type=range]');
plate.value = 200; plate.dispatchEvent(new Event('input', { bubbles: true })); frames(4);
check(seg('torso').armor[F.sel.face].t === 0.2 && F.report.mass.armor > am0, 'its slider thickens that plate and the armour weighs more');
console.log(`torso front ${(t0 * 1000).toFixed(0)} -> 200 mm: armour ${(am0 / 1e3).toFixed(0)} -> ${(F.report.mass.armor / 1e3).toFixed(0)} t, thrust/weight ${F.report.flight.tw.toFixed(2)}`);
shot('build-thick-front', '#stage');

// --- take the pod off ------------------------------------------------------------------------
F.setMode('frame'); F.select(pod); frames(3);
button('#modePanel', 'Remove segment').click(); frames(5);
check(!seg(pod) && !F.design.modules.some((m) => m.seg === pod), 'the pod and what was in it are gone');
check(F.report.insts.length === n0, 'from both sides');
F.select('thigh'); frames(2);
button('#modePanel', 'Remove segment').click(); frames(3);
check(seg('thigh'), 'a leg cannot be removed');
done('foundry building');

function press_escape() { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); frames(2); }
