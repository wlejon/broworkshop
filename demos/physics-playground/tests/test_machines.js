// tests/test_machines.js — the machine yard: SixDOF axes (locked / limited /
// free), position and velocity motors, collideConnected, and the gear,
// rack-and-pinion and pulley constraints on the bench.

import { test, check, done, frames, clickOn, shot } from "/lib/kit/test.js";
import * as view from "/app/view.js";
import { clearAll } from "/app/sim/spawn.js";
import {
    machines, machineOffset, driveMotor, setMotor, loadPiston, craneLoad, clearMachineDebris, machineDebris,
    resetMachines, modeOf,
} from "/app/sim/machines.js";
import {
    mechanisms, setCollideConnected, collideSeparation, resetGears, setGearRatio, setGearDrive,
    resetRack, setRackDrive, rackOffset, resetPulley,
} from "/app/sim/bench.js";
import * as ui from "/app/ui/machines.js";

advanceTime(200);

const log = (s) => console.log('        ' + s);
function reset() { clearAll(); advanceTime(120); }

test('sixdof: a position motor drives its free axis; locked axes hold exactly', () => {
    reset();
    const off = (a) => machineOffset('piston', a);
    driveMotor('piston', 'translationY', 3.0, { maxForce: 120000, frequency: 5, damping: 1 });
    advanceTime(2500);
    const y = off('translationY');
    log(`translationY ${y.toFixed(4)} m (target 3); tX ${off('translationX')} tZ ${off('translationZ')}`);
    check(Math.abs(y - 3.0) < 0.12, 'reached the target');
    check(off('translationX') === 0 && off('translationZ') === 0, 'locked axes did not move at all');
    loadPiston(3);
    advanceTime(2500);
    log(`loaded: ${off('translationY').toFixed(4)} m with 3 x 40 kg crates`);
    check(Math.abs(off('translationY') - 3.0) < 0.2, 'holds the target under load');

    // Freeing a locked axis has to change the outcome, or "locked" meant nothing.
    ui.setAxis('piston', 'translationX', 'free');
    Physics.addImpulse(machines.get('piston').body, 900, 0, 0);
    advanceTime(1000);
    const freed = off('translationX');
    log(`freed translationX travelled ${freed.toFixed(3)} m`);
    check(Math.abs(freed) > 0.4, 'freed axis moves');

    // Re-locking pins it where it is (a rebuilt constraint takes the current
    // frames): frozen, not recentred. A solved lock gives a few mm to a shove.
    ui.setAxis('piston', 'translationX', 'locked');
    advanceTime(200);
    const pinned = off('translationX');
    Physics.addImpulse(machines.get('piston').body, 900, 0, 0);
    advanceTime(900);
    const drift = off('translationX') - pinned;
    log(`re-locked drift ${(drift * 1000).toFixed(3)} mm`);
    check(Math.abs(drift) < Math.abs(freed) * 0.02, 're-locking freezes the axis');
    driveMotor('piston', 'translationY', 0.0);
    clearMachineDebris();
});

test('sixdof: a velocity motor turns the crane; reversing reverses; locking stops it', () => {
    reset();
    const yaw = () => machineOffset('crane', 'rotationY');
    const spin = (v) => {
        setMotor('crane', 'rotationY', { type: 'velocity', target: v, maxTorque: 40000 });
        advanceTime(400);
        const a = yaw();
        advanceTime(600);
        return yaw() - a;
    };
    const fwd = spin(0.8), back = spin(-0.8);
    log(`+${fwd.toFixed(3)} rad forward, ${back.toFixed(3)} rad reversed`);
    check(fwd > 0.2 && back < -0.2, 'turns both ways');
    ui.setAxis('crane', 'rotationY', 'locked');
    const b0 = yaw();
    advanceTime(800);
    log(`locked: moved ${(yaw() - b0).toFixed(5)} rad in 0.8 s`);
    check(Math.abs(yaw() - b0) < 0.02, 'locking the driven axis stops it (rebuild path)');
    ui.setAxis('crane', 'rotationY', 'free');
    setMotor('crane', 'rotationY', { type: 'velocity', target: 0, maxTorque: 40000 });
});

test('axis grid mirrors and drives the axis modes', () => {
    clickOn('#tabs [data-tab="machines"]');
    const cards = document.querySelectorAll('#axisGrid .card');
    check(cards.length === machines.size, `${cards.length} cards for ${machines.size} machines`);
    check(cards[0].querySelectorAll('.axisrow').length === 6, 'six axis rows per machine');
    // The piston card is the third; its tX row is the first.
    const keys = [...machines.keys()];
    const card = cards[keys.indexOf('piston')];
    const btn = card.querySelectorAll('.axisrow')[0].querySelector('[data-value="free"]');
    btn.scrollIntoView({ block: 'center' });
    frames(2);
    clickOn(btn);
    check(modeOf(machines.get('piston').axes.translationX) === 'free', 'clicking free frees tX');
    check(btn.classList.contains('active'), 'button shows active');
    document.querySelector('#btnResetMachines').scrollIntoView({ block: 'center' });
    frames(2);
    clickOn('#btnResetMachines');
    check(card.querySelectorAll('.axisrow')[0].querySelector('[data-value="locked"]').classList.contains('active'),
          'reset restores the authored mode in the grid');
    frames(25);
    check(/m$/.test(document.querySelector('#mPiston').textContent), 'piston readout: ' + document.querySelector('#mPiston').textContent);
    clickOn('#tabs [data-tab="sandbox"]');
});

test('collideConnected decides whether the rope or the contact wins', () => {
    reset();
    setCollideConnected(false);
    advanceTime(1500);
    const off = collideSeparation();
    setCollideConnected(true);
    advanceTime(1500);
    const on = collideSeparation();
    log(`${off.toFixed(4)} m off vs ${on.toFixed(4)} m on`);
    check(Math.abs(off - 0.4) < 0.02, 'OFF: the pair interpenetrates to the rope cap');
    check(on - off > 0.15, 'ON: contact pushes them past the rope limit');
    frames(25);
    check(/^ON/.test(document.querySelector('#ccHint').textContent), 'hint follows the flag');
    setCollideConnected(false);
});

test('gear constraint couples two hinges at the exact ratio', () => {
    reset();
    const g = mechanisms.get('gears');
    // Angular velocity about the +Z axle, averaged after the spin-up ringing
    // dies: an unsigned quaternion angle cannot tell turning from ringing.
    const rates = (ratio) => {
        resetGears();              // dead stop: a gear locks the hinge angles at creation
        advanceTime(100);
        setGearRatio(ratio);
        setGearDrive(1.0);
        advanceTime(2500);
        let wa = 0, wb = 0;
        for (let i = 0; i < 20; i++) {
            advanceTime(50);
            wa += Physics.getVelocity(g.driver.tag).angular.z;
            wb += Physics.getVelocity(g.driven.tag).angular.z;
        }
        return [wa / 20, wb / 20];
    };
    const [a1, b1] = rates(1.0);
    log(`1:1 driver ${a1.toFixed(4)}, driven ${b1.toFixed(4)} rad/s`);
    check(Math.abs(a1) > 0.5 && Math.abs(Math.abs(a1) - Math.abs(b1)) < 0.02, 'couples 1:1');
    const [a2, b2] = rates(2.0);
    log(`ratio 2 measured ${Math.abs(a2 / b2).toFixed(4)}`);
    check(Math.abs(Math.abs(a2 / b2) - 2.0) < 0.02, 'ratio 2');
    const [a3, b3] = rates(0.5);
    log(`ratio 0.5 measured ${Math.abs(a3 / b3).toFixed(4)}`);
    check(Math.abs(Math.abs(a3 / b3) - 0.5) < 0.02, 'ratio 0.5');
    resetGears();
    setGearRatio(2.0);
    setGearDrive(0);
});

test('rackAndPinion turns pinion rotation into rack travel', () => {
    resetRack();
    advanceTime(200);
    setRackDrive(2.0);
    const r0 = rackOffset();
    advanceTime(900);
    const r1 = rackOffset();
    setRackDrive(-2.0);
    advanceTime(1400);
    const r2 = rackOffset();
    log(`rack ${r0.toFixed(3)} -> ${r1.toFixed(3)} -> ${r2.toFixed(3)} m`);
    check(Math.abs(r1 - r0) > 0.4 && Math.abs(r2 - r1) > 0.4 && Math.sign(r2 - r1) === -Math.sign(r1 - r0),
          'driven, and reversing the pinion reverses the rack');
    setRackDrive(0);
});

test('pulley hauls the light side up as the heavy side descends', () => {
    resetPulley();
    const p = mechanisms.get('pulley');
    const hy = () => Physics.getTransform(p.heavy.tag).position.y, ly = () => Physics.getTransform(p.light.tag).position.y;
    const h0 = hy(), l0 = ly();
    advanceTime(2000);
    log(`heavy ${h0.toFixed(2)} -> ${hy().toFixed(2)} m, light ${l0.toFixed(2)} -> ${ly().toFixed(2)} m`);
    check(hy() < h0 - 0.5 && ly() > l0 + 0.5, 'rope carries the load');
});

test('machine debris is swept by clear all; machines are fixtures', () => {
    craneLoad();
    loadPiston(2);
    check(machineDebris.size >= 3, `${machineDebris.size} debris bodies`);
    clearAll();
    check(machineDebris.size === 0, 'debris swept');
    check(machines.size === 4 && mechanisms.size === 3 && Physics.getBodyProperties(machines.get('piston').body) !== undefined,
          `${machines.size} machines, ${mechanisms.size} bench mechanisms survive`);
});

test('screenshots: machine yard + bench', () => {
    resetMachines();
    advanceTime(800);
    view.focusView('machines');
    check(document.querySelector('#views [data-value="machines"]').classList.contains('active'), 'view button follows');
    craneLoad();
    loadPiston(2);
    advanceTime(1500);
    shot('machines');
    clickOn('#views [data-value="bench"]');
    advanceTime(600);
    shot('bench');
    view.focusView('sandbox');
});

done('physics-playground machines');
