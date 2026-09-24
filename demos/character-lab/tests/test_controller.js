// The controller BEHAVES: it climbs risers under the step-up limit and is
// stopped by the one above, walks up 30° and slides off 65°, crouching is the
// difference between passing the tunnel and bouncing off it, a fall takes
// grounded true -> false -> true, it stays snapped down terraces, jumps,
// pushes a crate, survives rebuilds, and rides the kinematic platform.

import { check, test, done } from "/lib/kit/test.js";
import { scene, cam, world, character, tune, charState, input, keys, rebuild, resetToSpawn,
         isCrouched, RADIUS, STAND_HALF, CROUCH_HALF } from "/app/lab.js";
import { clearKeys, hold, place, footY, run } from "/app/tests/helpers.js";

advanceTime(64);
flush();

const fmt = (v) => v.toFixed(3);
const rebuildWith = (o) => { Object.assign(tune, o); rebuild(scene); advanceTime(32); };

test('construction: scene, camera, character, course', () => {
    check(scene && cam && Array.isArray(cam.pos), 'scene and follow camera');
    check(character && character.innerBody > 0, `inner rigid body (tag ${character.innerBody})`);
    check(world.stairs.length === 7 && world.ramps.length === 5, 'seven risers, five ramps');
    check(world.props.length === 7, 'seven pushable props');
    check(world.platform && world.platform.tag > 0, 'kinematic platform');
    check(scene.cullStats().meshDrawn > 20, `course geometry drawn (${scene.cullStats().meshDrawn})`);
});

// Risers 0.15 0.22 0.30 0.38 0.46 0.55 0.65. MEASURED at stepUp 0.40 the
// cutoff lands between 0.46 and 0.55: Jolt's WalkStairs sweeps up by stepUp,
// forward, then down, and the rounded capsule rides onto an edge a little
// higher. `stepUp` is a floor on what is climbable, not the exact height.
test('step-up: climbs a 0.38 m riser, stopped dead by 0.55 m, which 0.8 clears', () => {
    rebuildWith({ stepUp: 0.4, maxSlopeAngle: 50 });
    const st = world.stairs;
    place(st[0].x, st[2].topY, st[2].z);
    const y0 = charState.position.y;
    hold(1400, 'w');
    check(charState.isGrounded, 'grounded after climbing');
    check(charState.position.y > y0 + 0.30, `climbed (dy ${fmt(charState.position.y - y0)})`);
    check(footY() > st[3].topY - 0.06, `feet reached tread 4 (${fmt(footY())})`);

    place(st[0].x, st[4].topY, st[4].z);
    const y1 = charState.position.y;
    const blocked = hold(1400, 'w');
    check(charState.position.y < y1 + 0.02, `blocked by 0.55 m (dy ${fmt(charState.position.y - y1)})`);
    check(blocked, 'reported blocked while pushing');

    rebuildWith({ stepUp: 0.8 });
    place(st[0].x, st[4].topY, st[4].z);
    const y2 = charState.position.y;
    hold(1400, 'w');
    check(charState.position.y > y2 + 0.45, `stepUp 0.8 climbs it (dy ${fmt(charState.position.y - y2)})`);
    rebuildWith({ stepUp: 0.4 });
});

test('slope limit: walks up 30°, never supported on 65°', () => {
    const gentle = world.ramps[1], steep = world.ramps[4];
    place(gentle.x, 0.02, gentle.entryZ);
    const y0 = charState.position.y;
    hold(1800, 'w');
    check(charState.position.y > y0 + 0.7, `walked up (dy ${fmt(charState.position.y - y0)})`);
    check(charState.groundState === 'onGround', `30° reads onGround (${charState.groundState})`);
    check(Math.abs(charState.slopeDeg - 30) < 4, `measured ${charState.slopeDeg.toFixed(1)}° ≈ 30°`);

    place(steep.x, 0.02, steep.entryZ);
    hold(600, 'w');
    const high = charState.position.y, gs = charState.groundState;
    hold(1400, 'w');
    check(gs === 'onSteepGround' || gs === 'inAir' || charState.position.y <= high + 0.05,
        `65° never supports (groundState ${gs})`);
    check(!charState.isGrounded || charState.slopeDeg < 50, 'not standing on the 65° face');
    check(charState.position.y < 1.2, `slid back down to y ${fmt(charState.position.y)}`);
});

// Clearance 1.10 m; standing is 1.80 m, crouched 0.80 m.
test('crouch gates the tunnel; setShape refuses to stand under the exit ceiling', () => {
    const tun = world.tunnel;
    check(2 * (STAND_HALF + RADIUS) > tun.clearance && 2 * (CROUCH_HALF + RADIUS) < tun.clearance, 'capsule sizes');
    place(tun.x, 0.02, tun.entryZ);
    hold(2000, 'w');
    check(!isCrouched() && charState.position.z > -tun.halfDepth, `standing stopped at z ${charState.position.z.toFixed(2)}`);

    place(tun.x, 0.02, tun.entryZ);
    hold(2600, 'w', 'c');
    check(isCrouched(), 'crouched');
    check(charState.position.z < -tun.halfDepth, `crouched walk cleared it (z ${charState.position.z.toFixed(2)})`);
    hold(400);                         // release crouch, keep polling
    check(charState.standBlocked && isCrouched(), 'no headroom: still crouched, stand blocked');
    hold(2400, 'w');
    check(!isCrouched() && !charState.standBlocked, 'stood up once clear');
});

test('fall and land: grounded true -> false -> true', () => {
    const gap = world.gap;
    place(gap.x, gap.topY, gap.nearEdgeZ + 1.2);
    check(charState.isGrounded && Math.abs(footY() - gap.topY) < 0.06, `on the 2 m platform (${fmt(footY())})`);
    let sawAir = false;
    clearKeys();
    keys.w = true;
    run(2400, () => {
        if (!charState.isGrounded) sawAir = true;
        return !(sawAir && charState.isGrounded && charState.position.y < 1.5);
    });
    clearKeys();
    advanceTime(240);
    check(sawAir, 'grounded went false in the gap');
    check(charState.isGrounded && Math.abs(footY()) < 0.08, `landed on the ground (${fmt(footY())})`);
});

test('floor snap: stays glued down six 0.30 m terraces', () => {
    rebuildWith({ stickToFloor: 0.5 });
    place(world.gap.x, world.gap.topY, world.terraces[0].z + 1.6);
    let air = 0;
    clearKeys();
    keys.w = true;
    run(3200, () => { if (!charState.isGrounded) air++; });
    clearKeys();
    advanceTime(160);
    check(charState.position.z < world.terraces[3].z, `walked down to z ${charState.position.z.toFixed(2)}`);
    check(air < 30, `snapped to the treads (${air} airborne frames of 200)`);
});

test('jump: leaves the ground and lands', () => {
    resetToSpawn();
    advanceTime(320);
    check(charState.isGrounded, 'grounded at spawn');
    const g = charState.position.y;
    clearKeys();
    input.jump = true;
    advanceTime(16);
    let peak = g;
    run(900, () => { peak = Math.max(peak, charState.position.y); });
    check(peak > g + 0.8, `peak +${fmt(peak - g)} m`);
    run(1400);
    check(charState.isGrounded, 'landed');
});

test('pushes a dynamic crate', () => {
    rebuildWith({ maxStrength: 800, moveSpeed: 5.0 });
    const crate = world.props[0];
    const a = Physics.getTransform(crate).position;
    place(a.x, 0.02, a.z + 1.6);
    hold(2200, 'w');
    const b = Physics.getTransform(crate).position;
    const moved = Math.hypot(b.x - a.x, b.z - a.z);
    check(moved > 0.25, `pushed ${fmt(moved)} m (z ${a.z.toFixed(2)} -> ${b.z.toFixed(2)})`);
});

test('construction tunables round-trip through rebuild; gravity is live', () => {
    const p0 = { ...charState.position }, n0 = charState.rebuilds;
    rebuildWith({ maxSlopeAngle: 70, stepUp: 0.55, stickToFloor: 0.9, maxStrength: 1000 });
    advanceTime(32);
    check(charState.rebuilds === n0 + 1, 'rebuild counted');
    check(Math.abs(charState.position.x - p0.x) < 0.2 && Math.abs(charState.position.z - p0.z) < 0.2, 'kept its place');

    Physics.setGravity(0, -25, 0);
    place(world.gap.x, world.gap.topY, world.gap.nearEdgeZ + 1.2);
    clearKeys();
    keys.w = true;
    let air = 0;
    run(2400, () => {
        if (!charState.isGrounded) air++;
        else if (air > 0 && charState.position.y < 1.5) return false;
    });
    clearKeys();
    Physics.setGravity(0, -9.81, 0);
    check(air > 0, 'fell through the gap under raised gravity');
});

test('rides the kinematic platform at its groundVelocity', () => {
    const plat = world.platform;
    resetToSpawn();
    const pp = Physics.getTransform(plat.tag).position;
    place(pp.x, plat.y + 0.25, pp.z);
    let sawVel = false;
    const x0 = charState.position.x;
    run(1200, () => { if (Math.hypot(charState.groundVelocity.x, charState.groundVelocity.z) > 0.05) sawVel = true; });
    const carried = Math.abs(charState.position.x - x0);
    check(charState.groundBodyId === plat.tag || charState.isGrounded, `on the platform (${charState.groundBodyId})`);
    check(sawVel, 'groundVelocity reported the platform motion');
    check(carried > 0.15, `carried ${fmt(carried)} m`);
});

test('back at spawn with factory settings', () => {
    rebuildWith({ moveSpeed: 4.5, maxStrength: 400, stepUp: 0.4, maxSlopeAngle: 50, stickToFloor: 0.5 });
    resetToSpawn();
    advanceTime(320);
    check(charState.isGrounded && Math.abs(charState.position.z - 12) < 0.3, 'grounded on the spawn pad');
});

done('character-lab controller');
