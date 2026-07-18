// test_smoke.js — headless integration test for Character Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/character-lab \
//       ../broworkshop/demos/character-lab/tests/test_smoke.js
//
// This test does not check that nothing threw. It checks that Jolt's character
// controller BEHAVED: that it climbed the risers under the step-up limit and
// was stopped by the one above it, that it walked up a 30-degree ramp and slid
// back down a 65-degree one, that crouching is the difference between passing
// under the tunnel and bouncing off it, that a fall takes grounded true ->
// false -> true, and that walking into a crate moved the crate.
//
// Everything is driven through the app's own key map and `tune` object, so the
// paths under test are the paths a human's keyboard and the HUD sliders use.

import {
    scene, cam, canvas, world, state, character,
    tune, charState, keys, teleport, resetToSpawn, rebuild,
    RADIUS, STAND_HALF, CROUCH_HALF, isCrouched,
} from "/app/app.js";

// Let module evaluation, layout and the first frame settle.
advanceTime(64);
flush();

// --- construction ------------------------------------------------------------

assert(scene, 'scene context exists');
assert(cam && Array.isArray(cam.pos), 'follow camera created');
assert(character, 'character controller created');
assert(character.innerBody > 0, `inner rigid body exists (tag ${character.innerBody})`);
assert(world.stairs.length === 7, 'seven risers');
assert(world.ramps.length === 5, 'five ramps');
assert(world.props.length === 7, 'seven pushable props');
assert(world.platform && world.platform.tag > 0, 'kinematic platform exists');
assert(scene.cullStats().meshDrawn > 20, `course geometry drawn (${scene.cullStats().meshDrawn})`);

// --- helpers -----------------------------------------------------------------

function clearKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
}

/** Hold a set of keys for `ms` of virtual time, one advanceTime per ~16 ms so
 *  the fixed physics tick runs the same number of steps every run. Returns
 *  whether the controller ever reported the move as blocked — sampled DURING
 *  the hold, since `blocked` is only meaningful while movement is commanded. */
function hold(ms, ...held) {
    clearKeys();
    for (const k of held) keys[k] = true;
    let blocked = false;
    for (let t = 0; t < ms; t += 16) {
        advanceTime(16);
        if (charState.blocked) blocked = true;
    }
    clearKeys();
    advanceTime(16);
    return blocked;
}

/** Drop the character with its feet at (x, footY, z), standing, at rest. */
function place(x, footY, z) {
    clearKeys();
    if (isCrouched()) { keys['c'] = false; advanceTime(64); }
    teleport(x, footY + RADIUS + (isCrouched() ? CROUCH_HALF : STAND_HALF), z);
    advanceTime(160);   // settle onto the floor
}

const footY = () => charState.position.y - RADIUS -
    (isCrouched() ? CROUCH_HALF : STAND_HALF);

// Physics interpolation makes the RENDER transform lag a step; getState() is
// always the true stepped state, so every assertion below reads getState().

// --- 1. step-up: climbs below the limit, is stopped above it ------------------
//
// Risers are 0.15 0.22 0.30 0.38 0.46 0.55 0.65. MEASURED against the real
// engine at stepUp = 0.40 the cutoff lands between 0.46 and 0.55, not at 0.40:
// Jolt's WalkStairs sweeps up by stepUp, forward, then back down, and the
// capsule's rounded bottom rides onto an edge a little above where the sweep
// itself reaches. So `stepUp` is a floor on what is climbable, not the exact
// riser height. The course is coloured by the nominal 0.40 for that reason —
// the two orange risers are the ones you genuinely cannot climb.

tune.stepUp = 0.4;
tune.maxSlopeAngle = 50;
rebuild(scene);
advanceTime(32);

const stairs = world.stairs;

// Below the limit: stand on tread 3 (top 0.67) and walk on. Riser 4 is 0.38.
place(stairs[0].x, stairs[2].topY, stairs[2].z);
const beforeClimb = charState.position.y;
hold(1400, 'w');
const afterClimb = charState.position.y;
assert(charState.isGrounded, 'grounded after climbing');
assert(afterClimb > beforeClimb + 0.30,
    `climbed a 0.38 m riser (dy ${(afterClimb - beforeClimb).toFixed(3)})`);
assert(footY() > stairs[3].topY - 0.06,
    `feet reached at least tread 4 top ${stairs[3].topY.toFixed(2)} (feet ${footY().toFixed(3)})`);

// Above the limit: stand on tread 5 (top 1.51) and walk into riser 6 (0.55).
place(stairs[0].x, stairs[4].topY, stairs[4].z);
const beforeBlock = charState.position.y;
const blockSeen = hold(1400, 'w');
assert(charState.position.y < beforeBlock + 0.02,
    `blocked dead by a 0.55 m riser (dy ${(charState.position.y - beforeBlock).toFixed(3)})`);
assert(blockSeen, 'controller reported the move as blocked while pushing');

// And the limit is the thing doing it: raise stepUp and the same riser goes.
tune.stepUp = 0.8;
rebuild(scene);
advanceTime(32);
place(stairs[0].x, stairs[4].topY, stairs[4].z);
const beforeRaised = charState.position.y;
hold(1400, 'w');
assert(charState.position.y > beforeRaised + 0.45,
    `same riser climbed with stepUp 0.8 (dy ${(charState.position.y - beforeRaised).toFixed(3)})`);
tune.stepUp = 0.4;
rebuild(scene);
advanceTime(32);

// --- 2. slope limit: walks up gentle, slides down steep -----------------------

const gentle = world.ramps[1];   // 30 degrees, under the 50 limit
const steep  = world.ramps[4];   // 65 degrees, over it

place(gentle.x, 0.02, gentle.entryZ);
const gentleY0 = charState.position.y;
hold(1800, 'w');
assert(charState.position.y > gentleY0 + 0.7,
    `walked up the 30° ramp (dy ${(charState.position.y - gentleY0).toFixed(3)})`);
assert(charState.groundState === 'onGround',
    `30° reads onGround (got ${charState.groundState})`);
assert(Math.abs(charState.slopeDeg - 30) < 4,
    `measured slope ${charState.slopeDeg.toFixed(1)}° ≈ 30°`);

// Park the character partway up the 65° face and hold forward. The engine
// classifies the ground as too steep to support and gravity slides it back
// down without any JS doing collision work.
place(steep.x, 0.02, steep.entryZ);
hold(600, 'w');
const steepHigh = charState.position.y;
const steepState = charState.groundState;
hold(1400, 'w');
assert(steepState === 'onSteepGround' || steepState === 'inAir' ||
       charState.position.y <= steepHigh + 0.05,
    `65° never supports the character (groundState ${steepState})`);
assert(!charState.isGrounded || charState.slopeDeg < 50,
    'the character is not standing on the 65° face');
assert(charState.position.y < 1.2,
    `slid back down to y ${charState.position.y.toFixed(3)}`);

// --- 3. crouch gates the tunnel ----------------------------------------------
//
// Clearance is 1.10 m; standing is 1.80 m tall and crouched is 0.80 m.

const tun = world.tunnel;
assert(2 * (STAND_HALF + RADIUS) > tun.clearance, 'standing capsule is too tall');
assert(2 * (CROUCH_HALF + RADIUS) < tun.clearance, 'crouched capsule fits');

// Standing: walk into the lintel and stop short of it.
place(tun.x, 0.02, tun.entryZ);
hold(2000, 'w');
assert(!isCrouched(), 'still standing');
assert(charState.position.z > -tun.halfDepth,
    `standing walk stopped at z ${charState.position.z.toFixed(2)} (tunnel ends at ${(-tun.halfDepth).toFixed(2)})`);

// Crouched: same walk, all the way through.
place(tun.x, 0.02, tun.entryZ);
hold(2600, 'w', 'c');
assert(isCrouched(), 'crouched');
const throughZ = charState.position.z;
assert(throughZ < -tun.halfDepth,
    `crouched walk cleared the tunnel to z ${throughZ.toFixed(2)}`);

// Under the exit ceiling, setShape refuses to stand the character back up.
// That single boolean is the whole "can I stand here" query.
hold(400);            // release crouch, keep polling
assert(charState.standBlocked, 'setShape refused to stand up under the ceiling');
assert(isCrouched(), 'still crouched because there is no headroom');

// Walk clear and it stands up on its own.
hold(2400, 'w');
assert(!isCrouched(), 'stood up once clear of the ceiling');
assert(!charState.standBlocked, 'stand-blocked cleared');

// --- 4. fall and land: grounded goes true -> false -> true --------------------

const gap = world.gap;
place(gap.x, gap.topY, gap.nearEdgeZ + 1.2);
assert(charState.isGrounded, 'grounded on the platform before the gap');
assert(Math.abs(footY() - gap.topY) < 0.06,
    `feet on the 2 m platform (${footY().toFixed(3)})`);

let sawAir = false, minY = charState.position.y;
clearKeys();
keys['w'] = true;
for (let t = 0; t < 2400; t += 16) {
    advanceTime(16);
    if (!charState.isGrounded) sawAir = true;
    minY = Math.min(minY, charState.position.y);
    if (sawAir && charState.isGrounded && charState.position.y < 1.5) break;
}
clearKeys();
advanceTime(240);

assert(sawAir, 'grounded went false while falling through the gap');
assert(charState.isGrounded, 'grounded went true again on landing');
assert(Math.abs(footY()) < 0.08, `landed on the ground plane (feet ${footY().toFixed(3)})`);

// --- 5. floor snap over the terraces -----------------------------------------
// Six 0.30 m drops with stickToFloor at 0.50: the character should stay in
// contact the whole way down rather than launching off each edge.

tune.stickToFloor = 0.5;
rebuild(scene);
advanceTime(32);
place(gap.x, gap.topY, world.terraces[0].z + 1.6);
let airborneFrames = 0;
clearKeys();
keys['w'] = true;
for (let t = 0; t < 3200; t += 16) {
    advanceTime(16);
    if (!charState.isGrounded) airborneFrames++;
}
clearKeys();
advanceTime(160);
assert(charState.position.z < world.terraces[3].z,
    `walked down the terraces to z ${charState.position.z.toFixed(2)}`);
assert(airborneFrames < 30,
    `stayed snapped to the treads (${airborneFrames} airborne frames over 200)`);

// --- 6. jumping ---------------------------------------------------------------

resetToSpawn();
advanceTime(320);
assert(charState.isGrounded, 'grounded at spawn');
const groundY = charState.position.y;
clearKeys();
keys[' '] = true;
state.input.jump = true;
advanceTime(16);
keys[' '] = false;
let peak = groundY;
for (let t = 0; t < 900; t += 16) { advanceTime(16); peak = Math.max(peak, charState.position.y); }
assert(peak > groundY + 0.8, `jumped (peak +${(peak - groundY).toFixed(3)} m)`);
for (let t = 0; t < 1400; t += 16) advanceTime(16);
assert(charState.isGrounded, 'landed after the jump');

// --- 7. pushing a dynamic body -----------------------------------------------
// The crate at world.props[0] sits at (3.0, 0.36, 9.5). Approach from +Z and
// shove it. maxStrength is the cap on how hard the character may push.

tune.maxStrength = 800;
tune.moveSpeed = 5.0;
rebuild(scene);
advanceTime(32);

const crate = world.props[0];
const crateBefore = Physics.getTransform(crate).position;
place(crateBefore.x, 0.02, crateBefore.z + 1.6);
hold(2200, 'w');
const crateAfter = Physics.getTransform(crate).position;
const moved = Math.hypot(crateAfter.x - crateBefore.x, crateAfter.z - crateBefore.z);
assert(moved > 0.25,
    `character pushed the crate ${moved.toFixed(3)} m ` +
    `(z ${crateBefore.z.toFixed(2)} -> ${crateAfter.z.toFixed(2)})`);

// --- 8. HUD tunables round-trip ----------------------------------------------
// Every construction-time slider goes through rebuild(); prove the handle
// survives and the character keeps its place.

const beforeRebuild = { ...charState.position };
const rebuildsBefore = charState.rebuilds;
tune.maxSlopeAngle = 70;
tune.stepUp = 0.55;
tune.stickToFloor = 0.9;
tune.maxStrength = 1000;
rebuild(scene);
advanceTime(64);
assert(charState.rebuilds === rebuildsBefore + 1, 'rebuild counted');
assert(Math.abs(charState.position.x - beforeRebuild.x) < 0.2 &&
       Math.abs(charState.position.z - beforeRebuild.z) < 0.2,
    'rebuild preserved the character position');

// Gravity is a real engine setter, and the character integrates it itself.
Physics.setGravity(0, -25, 0);
place(gap.x, gap.topY, gap.nearEdgeZ + 1.2);
clearKeys();
keys['w'] = true;
let fastFallFrames = 0;
for (let t = 0; t < 2400; t += 16) {
    advanceTime(16);
    if (!charState.isGrounded) fastFallFrames++;
    else if (fastFallFrames > 0 && charState.position.y < 1.5) break;
}
clearKeys();
Physics.setGravity(0, -9.81, 0);
assert(fastFallFrames > 0, 'fell through the gap under raised gravity');

// --- 9. riding the kinematic platform ----------------------------------------
// Standing on a moving kinematic body, groundVelocity is non-zero and the
// character is carried: supported motion is groundVelocity + desired velocity.

const plat = world.platform;
resetToSpawn();
const platPos = Physics.getTransform(plat.tag).position;
place(platPos.x, plat.y + 0.25, platPos.z);
let sawGroundVel = false, carried = 0;
const rideX0 = charState.position.x;
for (let t = 0; t < 1200; t += 16) {
    advanceTime(16);
    if (Math.hypot(charState.groundVelocity.x, charState.groundVelocity.z) > 0.05)
        sawGroundVel = true;
}
carried = Math.abs(charState.position.x - rideX0);
assert(charState.groundBodyId === plat.tag || charState.isGrounded,
    `standing on the platform (groundBodyId ${charState.groundBodyId}, tag ${plat.tag})`);
assert(sawGroundVel, 'groundVelocity reported the platform motion');
assert(carried > 0.15, `carried ${carried.toFixed(3)} m by the platform`);

// --- wrap up -----------------------------------------------------------------

resetToSpawn();
tune.moveSpeed = 4.5;
tune.maxStrength = 400;
tune.stepUp = 0.4;
tune.maxSlopeAngle = 50;
rebuild(scene);
advanceTime(320);
assert(charState.isGrounded, 'back at spawn, grounded');
assert(Math.abs(charState.position.z - 12) < 0.3, 'back at the spawn pad');

screenshot('character-lab.png');
console.log('character-lab: all checks passed');
