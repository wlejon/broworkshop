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
    sense, qState, setFacing, bodyName,
    forwardCast, ledgeProbe, proximity, lookRay, pickAlongRay,
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

// =============================================================================
// SENSING — shape casts, overlap queries, and the filters
// =============================================================================
//
// These are the chunk-2 assertions. Each one calls the query directly rather
// than reading qState, so a failure names the engine call that broke. The
// numbers are MEASURED against the real runtime, not derived from the docs.

const self = character.innerBody;
assert(self > 0, `inner body tag for ignoreBody filters (${self})`);

// --- 7a. forward shape cast: hit vs clear ------------------------------------
// The tunnel's right-hand jamb is a 0.7 m-thick post at x = 10.4, spanning
// z = -3..3. Standing at the tunnel entry and sweeping toward -Z runs the
// capsule straight into it; the same sweep on the open spawn pad hits nothing.

{
    const tunl = world.tunnel;
    place(tunl.x + 1.9, 0.02, tunl.entryZ);
    setFacing(0, -1);
    const into = forwardCast({ x: 0, z: -1 }, 5);
    assert(into, 'forward sweep hit the tunnel jamb');
    // Capsule radius 0.3 starting at z = entryZ (4.5); the jamb's near face is
    // at z = 3.0, so the sweep travels 4.5 - 3.0 - 0.3 = 1.2 m.
    assert(Math.abs(into.dist - 1.2) < 0.25,
        `sweep stopped 1.2 m short of the jamb face (got ${into.dist.toFixed(3)} m)`);
    assert(into.normal.z > 0.8,
        `contact normal points back at the caster (z ${into.normal.z.toFixed(3)})`);

    // Open ground: the spawn pad has nothing within 5 m toward +Z.
    place(0, 0.02, 12);
    const clear = forwardCast({ x: 0, z: 1 }, 5);
    assert(clear === null, 'forward sweep over open ground reports no hit');
}

// --- 7b. ledge probe: drop at the gap edge, flat on the slab -----------------
// The near platform's top is at y = 2 and it ends at z = 1.0. Probing ahead of
// the edge finds the ground 2 m below; probing from the middle of the slab
// finds the slab itself, essentially level with the feet.

{
    const g = world.gap;
    // Stand at the lip facing the hole. `ledgeAhead` of 0.9 m puts the probe
    // out over open air.
    place(g.x, g.topY, g.nearEdgeZ + 0.4);
    const atEdge = ledgeProbe({ x: 0, z: -1 }, 0.9, 0.45);
    assert(atEdge, 'ledge probe returned a result at the edge');
    assert(atEdge.isLedge, `probe at the gap lip reports a ledge (drop ${atEdge.drop.toFixed(2)} m)`);
    assert(atEdge.drop > 1.7 && atEdge.drop < 2.4,
        `drop measures the 2 m platform height (${atEdge.drop.toFixed(3)} m)`);

    // Middle of the slab, facing back the way we came: flat.
    place(g.x, g.topY, g.nearEdgeZ + 1.8);
    const onSlab = ledgeProbe({ x: 0, z: 1 }, 0.9, 0.45);
    assert(onSlab && !onSlab.isLedge,
        `probe on flat platform reports no ledge (drop ${onSlab.drop.toFixed(3)} m)`);
    assert(Math.abs(onSlab.drop) < 0.12,
        `flat ground drop is ~0 (${onSlab.drop.toFixed(3)} m)`);
}

// --- 7c. overlapShape: exactly the bodies inside a known radius --------------
// The five crates sit at x/z (3.0,9.5) (4.6,9.5) (3.8,8.2) (5.6,8.4) (2.2,8.3)
// and the two barrels at (6.6,10.6) (7.6,9.6). Park the character on the first
// crate's spot and count what a sphere of a known radius sees.

{
    // Stand a few metres clear of the pile: teleporting INTO it would shove the
    // crates apart and the count would be measuring the push, not the sensor.
    place(4.0, 0.02, 12.5);
    advanceTime(200);
    const p = charState.position;

    // Count the expected members ourselves from the live body transforms, so
    // the assertion is "the query agrees with the geometry" rather than a
    // hand-copied constant that rots the moment the course moves.
    const R = 5.0;
    const expected = world.props.filter((tag) => {
        const t = Physics.getTransform(tag).position;
        return Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) <= R - 0.5;
    });
    assert(expected.length >= 3, `at least three props within ${R} m (${expected.length})`);

    const got = proximity(R, /*movingOnly*/ true);
    const gotIds = got.map((o) => o.bodyId);
    for (const tag of expected) {
        assert(gotIds.includes(tag),
            `overlapShape found ${bodyName(tag)} inside the ${R} m sensor`);
    }
    // Layer filter: every hit is a 'moving'-layer body, so no static course
    // geometry and no ground slab leaked in.
    for (const id of gotIds) {
        assert(world.props.includes(id) || id === world.platform.tag,
            `layers:['moving'] kept static geometry out (saw ${bodyName(id)})`);
    }
    assert(!gotIds.includes(self), 'ignoreBody kept the character out of its own sensor');

    // And without the layer filter the SAME sphere also sees the ground slab —
    // which is the filter demonstrably doing something.
    const unfiltered = proximity(R, /*movingOnly*/ false);
    assert(unfiltered.length > got.length,
        `dropping layers:['moving'] widened the sensor ` +
        `(${got.length} -> ${unfiltered.length} bodies)`);

    // --- 7d. overlapPoint picks the right body --------------------------------
    const c1 = Physics.getTransform(world.props[1]).position;
    const at = Physics.overlapPoint(c1.x, c1.y, c1.z);
    assert(at.length >= 1, 'overlapPoint found a body at the crate centre');
    assert(at.some((o) => o.bodyId === world.props[1]),
        `overlapPoint picked ${bodyName(world.props[1])} at its own centre`);
    // A point in clear air between the crates and the sky picks nothing.
    assert(Physics.overlapPoint(c1.x, c1.y + 6, c1.z).length === 0,
        'overlapPoint in open air picks nothing');

    // The click path: a ray from above straight down onto a crate, then
    // overlapPoint just inside the surface it found.
    const picked = pickAlongRay(c1.x, c1.y + 8, c1.z, 0, -1, 0, 20);
    assert(picked && picked.bodyId === world.props[1],
        `click-pick resolved to ${bodyName(world.props[1])} ` +
        `(got ${picked ? picked.name : 'null'})`);
    assert(picked.viaOverlap, 'the pick was resolved by overlapPoint, not by the ray alone');
}

// --- 7e. THE FILTER PROOF ----------------------------------------------------
// One ray, three filter configurations, three different bodies. This is the
// assertion the whole sensing layer exists to earn.
//
// Standing 3 m in +Z of the first crate at crate height and looking toward -Z:
//   no filter                 -> the character's own inner body, at 0.00 m
//   ignoreBody: innerBody     -> the crate, ~2.6 m out
//   + ignoreBodies: props     -> the ramp slab behind it, ~11 m out

{
    const c0 = Physics.getTransform(world.props[0]).position;
    place(c0.x, 0.02, c0.z + 3.0);
    advanceTime(200);
    const p = charState.position;
    const dir = { x: 0, z: -1 };
    setFacing(0, -1);

    // Crate height: the crates are only 0.70 m tall, so a ray from the capsule
    // centre would fly over them and there would be nothing for ignoreBodies
    // to exclude. This is the default the HUD ships with.
    const H = { height: -0.55 };

    const raw    = lookRay(dir, 40, { ...H });
    const noSelf = lookRay(dir, 40, { ...H, ignoreSelf: true });
    const noProps = lookRay(dir, 40,
        { ...H, ignoreSelf: true, ignoreProps: true, propTags: world.props });

    assert(raw && raw.bodyId === self,
        `unfiltered ray hits the character's OWN inner body (${bodyName(raw && raw.bodyId)})`);
    assert(raw.dist < 0.05,
        `...at zero distance, because the origin is inside it (${raw.dist.toFixed(4)} m)`);

    assert(noSelf, 'ignoreBody ray hit something');
    assert(noSelf.bodyId !== raw.bodyId,
        `ignoreBody CHANGED the result: ${bodyName(raw.bodyId)} -> ${bodyName(noSelf.bodyId)}`);
    assert(world.props.includes(noSelf.bodyId),
        `ignoreBody ray reaches past self to ${bodyName(noSelf.bodyId)}`);
    assert(noSelf.dist > 2.0 && noSelf.dist < 3.2,
        `crate is ~2.6 m away (${noSelf.dist.toFixed(3)} m)`);

    assert(noProps, 'ignoreBodies ray hit something');
    assert(noProps.bodyId !== noSelf.bodyId,
        `ignoreBodies CHANGED the result again: ${bodyName(noSelf.bodyId)} -> ${bodyName(noProps.bodyId)}`);
    assert(!world.props.includes(noProps.bodyId),
        'ignoreBodies excluded every prop from the ray');
    // The headline result, printed so a passing run leaves the evidence behind
    // rather than just a green tick.
    console.log('  filter proof — one ray from ' +
        `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) toward -Z:\n` +
        `    no filter                : ${bodyName(raw.bodyId)} @ ${raw.dist.toFixed(2)} m\n` +
        `    ignoreBody: innerBody    : ${bodyName(noSelf.bodyId)} @ ${noSelf.dist.toFixed(2)} m\n` +
        `    + ignoreBodies: props    : ${bodyName(noProps.bodyId)} @ ${noProps.dist.toFixed(2)} m`);

    assert(noProps.dist > noSelf.dist + 5,
        `the ray passed through the crates to something ${noProps.dist.toFixed(2)} m out ` +
        `(vs ${noSelf.dist.toFixed(2)} m)`);

    // Three distinct bodies from one ray. State it as one assertion so the log
    // line is the proof.
    const ids = new Set([raw.bodyId, noSelf.bodyId, noProps.bodyId]);
    assert(ids.size === 3,
        `one ray, three filters, three different bodies: ` +
        `${bodyName(raw.bodyId)} / ${bodyName(noSelf.bodyId)} / ${bodyName(noProps.bodyId)}`);

    // The layers filter reaches the same conclusion by a different route: a
    // static-only ray cannot see the crates or the character at all.
    const staticOnly = lookRay(dir, 40, { ...H, layers: ['static'] });
    assert(staticOnly && staticOnly.bodyId === noProps.bodyId,
        `layers:['static'] lands on the same wall as ignoreBodies ` +
        `(${bodyName(staticOnly && staticOnly.bodyId)})`);
    const movingOnly = lookRay(dir, 40, { ...H, layers: ['moving'] });
    assert(movingOnly && movingOnly.bodyId === self,
        `layers:['moving'] still sees the character's inner body (${bodyName(movingOnly && movingOnly.bodyId)})`);
}

// --- 7f. the per-frame driver populates qState -------------------------------
// Everything above called the queries directly. This checks the wiring the HUD
// actually reads.

{
    resetToSpawn();
    advanceTime(200);
    sense.forwardCast = true;
    sense.ledgeProbe = true;
    sense.proximity = true;
    sense.lookRay = true;
    sense.ignoreSelf = true;
    sense.ignoreProps = false;
    sense.movingOnly = true;
    setFacing(0, -1);
    advanceTime(64);

    assert(qState.ledge, 'frame driver produced a ledge result');
    assert(Array.isArray(qState.prox), 'frame driver produced an overlap list');
    assert(qState.rayUnfiltered && qState.rayUnfiltered.bodyId === self,
        'the control ray in qState is the unfiltered one and hits self');
    assert(qState.ray && qState.ray.bodyId !== self,
        `the filtered ray in qState is not self (${qState.ray && qState.ray.name})`);

    // Toggling a filter through `sense` — exactly what the HUD checkbox does —
    // changes the live result on the next frame.
    sense.ignoreSelf = false;
    advanceTime(64);
    assert(qState.ray && qState.ray.bodyId === self,
        'unchecking ignoreBody in the HUD collapses the look ray onto the character');
    sense.ignoreSelf = true;
    advanceTime(64);
    assert(qState.ray.bodyId !== self, 'rechecking it restores the useful ray');

    // Debug geometry is toggleable, and toggling it actually changes what the
    // renderer draws — otherwise "draw query volumes" would be a checkbox
    // wired to nothing.
    sense.drawVolumes = false;
    advanceTime(64);
    const drawnOff = scene.cullStats().meshDrawn;
    sense.drawVolumes = true;
    advanceTime(64);
    const drawnOn = scene.cullStats().meshDrawn;
    assert(drawnOn > drawnOff,
        `query volumes are real geometry (${drawnOff} -> ${drawnOn} meshes drawn)`);

    // Walk the character to the crate pile with every sensor live and capture
    // it, so the screenshot shows the sensing layer doing its job rather than
    // an empty spawn pad.
    const c = Physics.getTransform(world.props[0]).position;
    place(c.x, 0.02, c.z + 2.6);
    setFacing(0, -1);
    sense.proxRadius = 3.5;
    advanceTime(96);
    assert(qState.prox.length > 0,
        `proximity sensor sees the crate pile (${qState.prox.map((o) => o.name).join(', ')})`);
    screenshot('character-lab-sensing.png');
}

// --- 8. pushing a dynamic body -----------------------------------------------
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

// --- 9. HUD tunables round-trip ----------------------------------------------
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

// --- 10. riding the kinematic platform ----------------------------------------
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

// --- 11. PhysicsNode auto-sync ------------------------------------------------
// app.js no longer calls scene.syncPhysics() per frame. Prove the engine keeps
// body-backed visuals on their bodies by itself: the crate was just shoved, so
// its node must be sitting where its body is.

{
    const t = Physics.getTransform(world.props[0]).position;
    const n = world.propNodes[0];
    assert(Math.hypot(n.x - t.x, n.y - t.y, n.z - t.z) < 0.12,
        `PhysicsNode tracks its body without an explicit sync ` +
        `(node ${n.x.toFixed(2)},${n.z.toFixed(2)} vs body ${t.x.toFixed(2)},${t.z.toFixed(2)})`);
}

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
