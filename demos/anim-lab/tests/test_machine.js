// State machine (parameters, manual travel, auto-advancing one-shots), root
// motion (treadmill vs traverse), camera nodes and the cinematic clip.

import { check, eq, near, test, done } from "/lib/kit/test.js";
import { scene, character, player, machine, cameras, overlay, motion, MARKER_SPACING, MARKER_COUNT } from "/app/lab.js";
import { selectClip, travelTo, trigger, setStateSpeed, setCrouch, setRootMotion, resetJourney,
         selectCamera, setCinematic, setLayerEnabled } from "/app/actions.js";
import { bonePositions, maxDelta } from "/app/tests/helpers.js";

const idx = character.rig.index;
const fired = [];
machine.onChange((from, to) => fired.push(`${from}→${to}`));

test('a manual play() suspends the machine; travel() re-enters it', () => {
    selectClip('walk');
    advanceTime(50);
    check(character.node.state === null, 'suspended: ' + character.node.state);
    advanceTime(200);
    check(character.node.state === null, 'a suspended machine does not travel by itself');
    travelTo('idle');
    advanceTime(100);
    eq(machine.state, 'idle');
});

test('parameters fire transitions: speed and crouch name no state', () => {
    setStateSpeed(2.0);
    advanceTime(120);
    eq(machine.state, 'move', 'idle → move');
    check(fired.includes('idle→move'), 'onStateChanged: ' + fired.join(','));
    let sm = player.blendState();
    check(sm.pos.length === 1, 'move sources a blend space');
    eq(sm.state, 'move', 'blendState reports the state');
    near(sm.pos[0], 2.0, 1e-3, 'speed pushed onto the axis');

    setCrouch(true);
    advanceTime(400);
    eq(machine.state, 'moveCrouch', 'move → moveCrouch');
    check(fired.includes('move→moveCrouch'), 'reported');
    sm = player.blendState();
    check(sm.clips.some((c) => c.name === 'crouchWalk' || c.name === 'crouchIdle'), 'crouch space');

    setCrouch(false);
    advanceTime(400);
    eq(machine.state, 'move', 'back to move');
    setStateSpeed(0.0);
    advanceTime(500);
    eq(machine.state, 'idle', 'move → idle');
    check(fired.includes('move→idle'), 'reported');

    // A crouched STAND is the crouch space at 0, not a fourth state.
    setCrouch(true);
    advanceTime(400);
    eq(machine.state, 'moveCrouch', 'crouching while stopped');
    setCrouch(false);
    advanceTime(400);
});

test('manual travel follows authored edges; the driver reconciles it', () => {
    const n = fired.length;
    travelTo('move');
    eq(machine.state, 'move', 'immediate');
    check(fired.length > n && fired[fired.length - 1] === 'idle→move', 'fired the authored idle → move');
    const m = fired.length;
    travelTo('move');
    eq(fired.length, m, 'travel to the current state is a no-op');
    advanceTime(500);
    eq(machine.state, 'idle', 'the parameters win on the next ticks');
});

test('one-shots auto-advance with no JS: jump, and wave returning where it came from', () => {
    const n = fired.length;
    trigger('jump');
    advanceTime(60);
    eq(machine.state, 'jump');
    check(fired.slice(n).some((t) => t.endsWith('→jump')), 'wildcard into jump');
    advanceTime(600);
    eq(machine.state, 'jump', 'holds while the 1.4 s clip runs');
    advanceTime(1400);
    check(machine.state !== 'jump', 'left by itself');
    check(fired.slice(n).includes('jump→move'), 'autoAdvance jump → move: ' + fired.slice(n).join(','));
    advanceTime(600);
    eq(machine.state, 'idle', 'the driver settles the landing');

    setStateSpeed(2.0);
    advanceTime(400);
    eq(machine.state, 'move', 'moving before the wave');
    trigger('wave');
    advanceTime(60);
    eq(machine.state, 'wave');
    advanceTime(2400);
    eq(machine.state, 'move', 'wave returns to the state it was triggered from');
    setStateSpeed(0.0);
    advanceTime(600);
});

test('root motion OFF: the character walks in place, the node never moves', () => {
    setRootMotion(false);
    resetJourney();
    travelTo('move');
    setStateSpeed(1.6);
    advanceTime(400);
    const start = character.node.position.slice();
    const p0 = bonePositions();
    // 350 ms, not 1 s: the walk cycle is 1.0 s, so a one-period gap reads frozen.
    advanceTime(350);
    check(maxDelta(p0, bonePositions()) > 0.005, 'genuinely walking');
    advanceTime(650);
    const end = character.node.position.slice();
    check(end[0] === start[0] && end[2] === start[2] && end[2] === 0, `node still: ${start} -> ${end}`);
    eq(motion.distance, 0, 'odometer at zero');
});

test('root motion ON: the node travels the authored distance down the run', () => {
    setRootMotion(true);
    resetJourney();
    advanceTime(200);
    check(player.blendState().clips.some((c) => c.name === 'walkRM' || c.name === 'idle'), 'RM space');
    const start = character.node.position.slice();
    advanceTime(2000);          // two seconds at 1.6 m/s ≈ 3.2 m
    const end = character.node.position.slice();
    const travelled = end[2] - start[2];
    check(travelled > 2.4 && travelled < 4.0, 'travelled ' + travelled);
    near(end[0], start[0], 1e-4, 'no sideways drift');
    near(motion.distance, end[2], 1e-3, 'odometer agrees with the node');
    check(motion.markers >= 1, 'passed markers');
    eq(motion.markers, Math.min(MARKER_COUNT, Math.floor(end[2] / MARKER_SPACING)), 'marker count');
    const p0 = bonePositions();
    advanceTime(200);
    check(maxDelta(p0, bonePositions()) > 0.005, 'the pose still animates in place');
});

test('the bone overlay rides the node under root motion', () => {
    overlay.setEnabled(true);
    overlay.update();
    const m = character.node.getBoneWorldMatrix('head');
    const marker = overlay.joints[idx.head];
    near(marker.z, m[14], 1e-4, 'model-space marker');
    const w = marker.localToWorld(0, 0, 0);
    near(w.z, m[14] + character.node.position[2], 1e-3, 'composed into world by the hierarchy');
    overlay.setEnabled(false);
    const parked = character.node.position.slice();
    setStateSpeed(0.0);
    advanceTime(800);
    check(character.node.position[2] > parked[2] - 0.01, 'stopping leaves it where it walked to');
});

test('camera nodes: orbit active at boot, switching sets scene.activeCamera', () => {
    check(cameras.orbit && cameras.follow && cameras.wide, 'three nodes');
    eq(cameras.orbit.type, 'camera');
    eq(cameras.active, 'orbit', 'opens on orbit');
    eq(scene.activeCamera && scene.activeCamera.name, 'orbit');
    selectCamera('wide');
    advanceTime(50);
    eq(scene.activeCamera && scene.activeCamera.name, 'wide');
    eq(cameras.active, 'wide', 'readout follows');
    selectCamera('follow');
    advanceTime(50);
    eq(cameras.active, 'follow');
});

test('the follow camera rides the hierarchy by exactly the character\'s motion', () => {
    const cam0 = cameras.follow.localToWorld(0, 0, 0);
    const ch0 = character.node.position.slice();
    setStateSpeed(2.4);
    advanceTime(1500);
    const cam1 = cameras.follow.localToWorld(0, 0, 0);
    const ch1 = character.node.position.slice();
    const moved = ch1[2] - ch0[2], camMoved = cam1.z - cam0.z;
    check(moved > 0.5 && camMoved > 0.5, `moved ${moved} / ${camMoved}`);
    near(camMoved, moved, 1e-4, 'a child, not a tracker');
    near(cam1.z - ch1[2], -4.0, 1e-3, 'authored offset behind');
    near(cam1.y, 2.05, 1e-3, 'authored height');
});

test('the cinematic clip flies the wide camera and pulls its fov', () => {
    const p0 = cameras.wide.position.slice();
    const fov0 = cameras.wide.fov;
    setCinematic(true);
    eq(cameras.active, 'wide', 'arming it cuts to the wide camera');
    advanceTime(2000);
    check(Math.abs(cameras.wide.position[2] - p0[2]) > 0.1, `z ${p0[2]} -> ${cameras.wide.position[2]}`);
    check(Math.abs(cameras.wide.fov - fov0) > 0.5, `fov ${fov0} -> ${cameras.wide.fov}`);
    check(character.node.isPlaying === true, 'the character kept animating');
    setCinematic(false);
    selectCamera('orbit');
    advanceTime(50);
    eq(cameras.active, 'orbit');
});

test('the showpiece state renders with shadows', () => {
    setRootMotion(true);
    resetJourney();
    travelTo('move');
    setStateSpeed(2.2);
    setLayerEnabled(1, true, 0.2);
    advanceTime(1200);
    const s = scene.cullStats();
    check(s.meshDrawn > 0 && s.shadowDrawn > 0, JSON.stringify(s));
});

done('anim-lab machine');
