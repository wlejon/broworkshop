// tests/test_blend.js — the blend machine on the real ragdoll: the clip
// drives the parts, a cannonball knocks them limp from the limb it hits, the
// heap settles, gets up with the clip its orientation picks, and hands back
// to idle. Plus the panel: clip buttons, sliders, readouts.

import { test, check, done, frames, clickOn, setValue, simUntil, shot } from "/lib/kit/test.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";
import { PART_NAMES, partIndex, poseError } from "/lib/kit/ragdoll.js";
import { vp, blender, cannon, grab, grabAt } from "/app/lab.js";
import { CLIPS } from "/app/anim.js";

frames(10);

const log = (s) => console.log('        ' + s);
const txt = (sel) => document.querySelector(sel).textContent.trim();
const partY = (name) => Physics.getTransform(blender.rd.partBody(partIndex(name))).position.y;

test('layout: side panel beside a sized viewport; readouts filled', () => {
    const view = document.querySelector('.k-viewport').getBoundingClientRect();
    const side = document.querySelector('.k-side').getBoundingClientRect();
    check(view.width > 1000 && view.height > 600, 'viewport sized');
    check(side.right <= view.left + 1, 'side panel beside it');
    frames(12);
    check(txt('#stateBadge') === 'ANIMATED' && /m$/.test(txt('#pelvisVal')), 'badge + pelvis readout');
    check(document.querySelectorAll('#animRow button').length === 3, 'three clip buttons');
});

test('ANIMATED: the kinematic drive holds the figure standing and animates it', () => {
    blender.resetToStand('idle');
    advanceTime(1500);
    log(`head y ${partY('head').toFixed(3)}, pelvis ${blender.pelvisHeight().toFixed(3)}`);
    check(partY('head') > 1.6 && Math.abs(blender.pelvisHeight() - 0.95) < 0.1, 'standing');
    clickOn('#animRow [data-value="walk"]');
    check(blender.clip === 'walk', 'walk selected');
    const legs = [];
    for (let i = 0; i < 30; i++) { advanceTime(16); legs.push(Physics.getTransform(blender.rd.partBody(partIndex('lowerLegR'))).position.z); }
    const swing = Math.max(...legs) - Math.min(...legs);
    log(`lowerLegR swings ${swing.toFixed(3)} m along z while walking`);
    check(swing > 0.1, 'the legs follow the walk clip');
    check(partY('head') > 1.5, 'still upright while walking');
    clickOn('#animRow [data-value="idle"]');
});

test('trigger ragdoll: IMPACT ramps to a limp RAGDOLL that falls', () => {
    blender.resetToStand('idle');
    advanceTime(300);
    clickOn('#btnRagdoll');
    check(blender.state === 'IMPACT', 'impact first');
    advanceTime(200);
    check(blender.state === 'RAGDOLL' && blender.weight === 1, 'limp within 0.2 s');
    advanceTime(2500);
    log(`head fell to ${partY('head').toFixed(3)} m`);
    check(partY('head') < 0.8, 'the figure is on the floor');
});

test('it settles, then gets up with the clip its orientation picks, then idles', () => {
    check(simUntil(() => blender.state === 'SETTLING', 6000), `settled (state ${blender.state}, KE ${blender.kineticEnergy().toFixed(2)} J)`);
    frames(8);
    check(/Prone|Supine/.test(txt('#restVal')), 'rest readout: ' + txt('#restVal'));
    const want = blender.prone ? 'getup_prone' : 'getup_supine';
    clickOn('#btnGetUp');
    check(blender.state === 'GETTING_UP' && blender.clip === want, `${want} chosen`);
    check(simUntil(() => blender.state === 'ANIMATED', 5000), 'back to ANIMATED');
    advanceTime(500);
    log(`after getting up: head y ${partY('head').toFixed(3)}, clip ${blender.clip}`);
    check(blender.clip === 'idle' && partY('head') > 1.5, 'standing, idling');
    frames(8);
    check(document.querySelector('#animRow [data-value="idle"]').classList.contains('active'), 'clip buttons follow');
});

test('get-up is refused while standing', () => {
    blender.resetToStand('idle');
    check(blender.triggerGetUp() === false && blender.state === 'ANIMATED', 'no-op when animated');
});

test('cannonball: a real body, the hit knocks the figure limp from the struck limb', () => {
    blender.resetToStand('idle');
    advanceTime(300);
    const shots0 = cannon.shots, hits0 = cannon.hits;
    clickOn('#btnCannon');
    check(cannon.shots === shots0 + 1 && cannon.balls.size >= 1, 'a ball body in flight');
    check(simUntil(() => cannon.hits > hits0, 2000, 16), 'the ball hit a part');
    check(blender.state === 'IMPACT' || blender.state === 'RAGDOLL', 'knocked into the ragdoll: ' + blender.state);
    advanceTime(2000);
    log(`head at ${partY('head').toFixed(3)} m after the hit`);
    check(partY('head') < 1.2, 'knocked down');
    frames(8);
    check(txt('#shotVal') === `${cannon.shots} / ${cannon.hits}`, 'shots/hits readout');
    advanceTime(4000);
    check(cannon.balls.size === 0, 'balls expire after their life');
});

test('cannon speed slider re-aims the barrel and trajectory', () => {
    const before = cannon.trajectory().map((p) => p.y);
    const inputs = document.querySelectorAll('#tuneParams input[type="range"]');
    setValue(inputs[1], 12);
    check(cannon.speed === 12, 'speed set');
    const after = cannon.trajectory().map((p) => p.y);
    log(`trajectory apex ${Math.max(...before).toFixed(3)} m at 22 m/s, ${Math.max(...after).toFixed(3)} m at 12 m/s`);
    check(Math.max(...after) > Math.max(...before) + 0.03, 'slower shot lobs higher');
    setValue(inputs[1], 22);
    setValue(inputs[0], 20);
    check(blender.stiffness === 20, 'stiffness slider');
    setValue(inputs[0], 12);
});

test('motor stiffness: stiff joints hold the pose through the impact longer', () => {
    // Same shove at 0 Hz and at 30 Hz; 80 ms in, the joints should be
    // closer to the clip's pose when the motors fight back.
    const errAfter = (hz) => {
        blender.setStiffness(hz);
        blender.resetToStand('idle');
        advanceTime(300);
        blender.triggerRagdoll(partIndex('chest'), { x: 40, y: 0, z: 25 });
        advanceTime(80);
        return poseError(blender.rd, CLIPS.idle(blender.time));
    };
    const limp = errAfter(0), stiff = errAfter(30);
    log(`joint error 80 ms after the shove: ${(limp * 57.3).toFixed(2)}° limp vs ${(stiff * 57.3).toFixed(2)}° stiff`);
    check(stiff < limp, 'stiff motors hold the pose through the impact');
    blender.setStiffness(12);
});

test('grabbing a limb triggers the ragdoll and drags it', () => {
    blender.resetToStand('idle');
    advanceTime(500);
    const p = Physics.getTransform(blender.rd.partBody(partIndex('chest'))).position;
    const r = vp.canvas.getBoundingClientRect();
    const s = worldToScreen([p.x, p.y, p.z], globalThis.Camera.orbitViewOpts(vp.cam, vp.canvas), r.width, r.height);
    check(grabAt(s.x, s.y), 'grabbed a part');
    check(blender.state === 'IMPACT' && grab.grabbed != null, 'grab went limp from that limb');
    grab.end();
});

test('reset stand from the floor', () => {
    blender.triggerRagdoll(2, { x: 30, y: 0, z: 0 });
    advanceTime(2000);
    clickOn('#btnReset');
    check(blender.state === 'ANIMATED', 'animated again');
    advanceTime(500);
    check(partY('head') > 1.5, 'standing');
    check(Object.keys(CLIPS).length === 5 && PART_NAMES.length === 12, 'five clips, twelve parts');
});

test('screenshots', () => {
    blender.resetToStand('run');
    advanceTime(600);
    shot('running');
    cannon.fire();
    advanceTime(1200);
    shot('knocked');
});

done('ragdoll-blender');
