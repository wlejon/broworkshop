// course.js — the obstacle course.
//
// Every piece of geometry here exists to make one decision inside Jolt's
// CharacterVirtual visible from outside:
//
//   stairs    Risers climb 0.15 -> 0.65 m. The controller walks up every riser
//             at or under `stepUp` and stops dead at the first one over it, so
//             the exact cutoff is a place on the staircase you can point at.
//             Move the Step-up slider and the cutoff moves.
//   ramps     Five slabs at 15/30/42/52/65 degrees. At or under `maxSlopeAngle`
//             the ground reports "onGround" and the character walks; over it
//             the ground reports "onSteepGround" and gravity slides it back
//             down with no JS involvement at all.
//   tunnel    A lintel with 1.10 m of clearance. Standing capsule is 1.80 m
//             tall, crouched is 0.80 m — so it is a hard gate on stance, and
//             the far side is where setShape() refuses to stand you back up.
//   gap       A 2.5 m hole in a 2 m-high platform: fall, then land. Grounded
//             goes true -> false -> true, which is the cleanest possible
//             assertion about ground detection.
//   terraces  Six 0.30 m drops off the back of the platform. Under
//             `stickToFloor` the character stays glued to each tread instead
//             of launching into a ballistic arc; over it, it hops.
//   props     Crates and barrels light enough for `maxStrength` newtons to
//             shove. This is the one place the character reaches back into the
//             rigid-body world.
//   platform  A kinematic slab sliding along X. Standing on it, the character
//             moves at groundVelocity + its own desired velocity, so it rides
//             for free — the readout's "platform vel" row is that term.
//
// Visual and collision are never authored separately: `solid()` creates the
// body first and hangs the mesh off a PhysicsNode bound to that body, so the
// mesh transform IS the body transform. There is no way for them to drift.

const COL = {
    ground:  '#2e343d',
    stair:   '#7f95b8',
    stairHi: '#c2665a',   // riser above the DEFAULT step-up limit
    ramp:    '#b8925a',
    rampHi:  '#8d5a4a',   // slope above the DEFAULT max-slope limit
    tunnel:  '#7fb8a4',
    gap:     '#a07fb8',
    prop:    '#c07a5a',
    barrel:  '#9a6a48',
    plat:    '#d2b45a',
    post:    '#454c58',
};

// Default controller limits, duplicated here purely to tint the geometry at
// build time. The live limits live in character.js; the colours are a static
// "here is where the factory settings cut off" annotation.
const DEFAULT_STEP_UP = 0.4;
const DEFAULT_MAX_SLOPE = 50;

/** Quaternion for a rotation of `deg` about world +X. */
function quatX(deg) {
    const h = (deg * Math.PI / 180) / 2;
    return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
}

/**
 * One static box, authored once. Returns { tag, node, mesh }.
 * The mesh is a child of a PhysicsNode bound to the body, so it inherits the
 * body's transform every frame — visual and collision cannot desync.
 *
 * pixelsPerUnit is passed explicitly: the doc claims a default of 100, the
 * engine actually defaults to 1, and a silent 100x would be catastrophic here.
 */
function solid(scene, o) {
    const tag = Physics.createBody({
        shape: 'box',
        position: { x: o.x, y: o.y, z: o.z },
        rotation: o.rotation || { x: 0, y: 0, z: 0, w: 1 },
        halfExtents: { x: o.hx, y: o.hy, z: o.hz },
        static: true,
        friction: o.friction != null ? o.friction : 0.8,
    });
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    const mesh = scene.createMesh({
        mesh: 'box',
        halfW: o.hx, halfH: o.hy, halfD: o.hz,
        color: o.color || COL.ground,
        metallic: 0,
        roughness: o.roughness != null ? o.roughness : 0.85,
    });
    node.add(mesh);
    return { tag, node, mesh };
}

export function buildCourse(scene) {
    const course = {
        stairs: [],      // { riser, topY, z, x }
        ramps: [],       // { deg, x, entryZ }
        props: [],       // dynamic body tags
        propNodes: [],   // the PhysicsNode bound to each of those tags
        labels: [],      // { at:[x,y,z], text, cls }
        tunnel: null,
        platform: null,
        terraces: [],
    };

    const label = (x, y, z, text, cls) =>
        course.labels.push({ at: [x, y, z], text, cls: cls || '' });

    // --- Ground -------------------------------------------------------------
    // One slab, top face exactly at y = 0 so every height in this file is a
    // literal world height and the numbers on the labels mean what they say.
    //
    // It stops at z = -20. Everything beyond that seam is the heightfield in
    // terrain.js, and the two meet at exactly y = 0 because the terrain's
    // height function is tapered to zero at this line. Extending the slab past
    // the seam would bury the near hills, so the flat world genuinely ends
    // here rather than merely being hidden.
    const GROUND_FAR_Z = -20;
    solid(scene, { x: 0, y: -1, z: (46 + GROUND_FAR_Z) / 2,
                   hx: 46, hy: 1, hz: (46 - GROUND_FAR_Z) / 2,
                   color: COL.ground, roughness: 0.95 });
    course.groundFarZ = GROUND_FAR_Z;

    // --- Stairs (x = -17) ---------------------------------------------------
    // Risers grow monotonically. Whichever one first exceeds `stepUp` is where
    // the character stops; everything below it is walked up without a single
    // line of JS knowing a step was there.
    const RISERS = [0.15, 0.22, 0.30, 0.38, 0.46, 0.55, 0.65];
    const STAIR_X = -17, TREAD = 1.4, STAIR_Z0 = 7;
    let topY = 0;
    for (let i = 0; i < RISERS.length; ++i) {
        topY += RISERS[i];
        const z = STAIR_Z0 - i * TREAD - TREAD / 2;
        solid(scene, {
            x: STAIR_X, y: topY / 2, z, hx: 2.6, hy: topY / 2, hz: TREAD / 2,
            color: RISERS[i] > DEFAULT_STEP_UP ? COL.stairHi : COL.stair,
        });
        course.stairs.push({ riser: RISERS[i], topY, z, x: STAIR_X });
        label(STAIR_X + 2.9, topY + 0.18, z, RISERS[i].toFixed(2) + ' m',
              RISERS[i] > DEFAULT_STEP_UP ? 'warn' : 'ok');
    }
    // Landing behind the last riser, so a character that DOES clear everything
    // (step-up cranked up) has somewhere to arrive.
    solid(scene, { x: STAIR_X, y: topY / 2, z: STAIR_Z0 - RISERS.length * TREAD - 1.6,
                   hx: 2.6, hy: topY / 2, hz: 1.6, color: COL.stair });
    label(STAIR_X, 3.4, STAIR_Z0 + 1.5, 'STAIRS · step-up', 'zone');

    // --- Ramps (x = -11.5 .. 2.5) ------------------------------------------
    // A box rotated +deg about world X: local -Z ends up high, local +Z low, so
    // walking toward -Z is walking uphill. Half-depth 3.5 gives every ramp the
    // same run and a rise that grows with the angle.
    const ANGLES = [15, 30, 42, 52, 65];
    const RAMP_HD = 3.5, RAMP_HT = 0.15;
    for (let i = 0; i < ANGLES.length; ++i) {
        const deg = ANGLES[i];
        const rad = deg * Math.PI / 180;
        const x = -11.5 + i * 3.5;
        // Drop the slab so the downhill (+Z) end's top face grazes y = 0.
        const cy = RAMP_HD * Math.sin(rad) + RAMP_HT * Math.cos(rad);
        solid(scene, {
            x, y: cy, z: 0, hx: 1.5, hy: RAMP_HT, hz: RAMP_HD,
            rotation: quatX(deg),
            color: deg > DEFAULT_MAX_SLOPE ? COL.rampHi : COL.ramp,
        });
        const entryZ = RAMP_HD * Math.cos(rad) + 1.6;
        course.ramps.push({ deg, x, entryZ, topY: 2 * RAMP_HD * Math.sin(rad) });
        label(x, 0.5, entryZ + 0.4, deg + '°',
              deg > DEFAULT_MAX_SLOPE ? 'warn' : 'ok');
    }
    label(-4.5, 4.6, 6.6, 'RAMPS · slope limit', 'zone');

    // --- Tunnel (x = 8.5) ---------------------------------------------------
    // Two jambs and a lintel. Clearance is the gap under the lintel: 1.10 m,
    // which is between the crouched height (0.80) and the standing one (1.80).
    const TUN_X = 8.5, CLEAR = 1.10, TUN_HD = 3.0;
    for (const s of [-1, 1]) {
        solid(scene, { x: TUN_X + s * 1.9, y: 1.4, z: 0,
                       hx: 0.35, hy: 1.4, hz: TUN_HD, color: COL.tunnel });
    }
    const lintelHalf = 0.75;
    solid(scene, { x: TUN_X, y: CLEAR + lintelHalf, z: 0,
                   hx: 1.9, hy: lintelHalf, hz: TUN_HD, color: COL.tunnel });
    course.tunnel = { x: TUN_X, clearance: CLEAR, halfDepth: TUN_HD,
                      entryZ: TUN_HD + 1.5, exitZ: -TUN_HD - 1.5 };
    label(TUN_X, CLEAR + 0.35, TUN_HD + 0.1, CLEAR.toFixed(2) + ' m clearance', 'warn');
    label(TUN_X, 3.6, TUN_HD + 1.6, 'TUNNEL · crouch', 'zone');
    // A ceiling slab past the exit: crouch-walk out and you are still pinned,
    // which is what makes the "can't stand up here" check worth having.
    solid(scene, { x: TUN_X, y: CLEAR + lintelHalf, z: -TUN_HD - 2.0,
                   hx: 1.9, hy: lintelHalf, hz: 2.0, color: COL.tunnel });

    // --- Gap and terraces (x = 18) ------------------------------------------
    // Two platform slabs 2 m up with a 2.5 m hole between them, reached by a
    // 25-degree ramp. Walk off the near slab and you fall to the ground; the
    // terraces off the back are the floor-snap test.
    const G_X = 18;
    const APPROACH_HD = 2.37, APPROACH_DEG = 25;
    const aRad = APPROACH_DEG * Math.PI / 180;
    solid(scene, {
        x: G_X, y: 2 - APPROACH_HD * Math.sin(aRad) + RAMP_HT * Math.cos(aRad),
        z: 6 + APPROACH_HD * Math.cos(aRad),
        hx: 2.2, hy: RAMP_HT, hz: APPROACH_HD,
        rotation: quatX(APPROACH_DEG), color: COL.gap,
    });
    solid(scene, { x: G_X, y: 1.0, z: 3.5, hx: 3, hy: 1.0, hz: 2.5, color: COL.gap });
    solid(scene, { x: G_X, y: 1.0, z: -4.0, hx: 3, hy: 1.0, hz: 2.5, color: COL.gap });
    course.gap = { x: G_X, topY: 2.0, nearEdgeZ: 1.0, farEdgeZ: -1.5, width: 2.5,
                   approachZ: 9.5 };
    label(G_X, 2.5, -0.25, '2.5 m gap', 'warn');
    label(G_X, 4.8, 8.4, 'GAP · fall & land', 'zone');

    // Six 0.30 m drops. Default stickToFloor is 0.50, so all six are snapped;
    // drag the slider under 0.30 and the character starts hopping off each one.
    const DROP = 0.30;
    for (let i = 1; i <= 6; ++i) {
        const top = 2.0 - i * DROP;
        solid(scene, { x: G_X, y: top / 2, z: -6.5 - (i - 1) * 1.3 - 0.65,
                       hx: 3, hy: top / 2, hz: 0.65, color: COL.gap });
        course.terraces.push({ topY: top, z: -6.5 - (i - 1) * 1.3 - 0.65 });
    }
    label(G_X + 3.4, 1.4, -9.0, '6 × 0.30 m drops', '');

    // --- Dynamic props (x = 4, z = 9) --------------------------------------
    // Deliberately light. The default maxStrength of 100 N barely nudges a
    // 30 kg crate; the slider's 400 N default shoves it convincingly, and at
    // 0 N the character walks into the crate and stops like it is a wall.
    const crateSpots = [[3.0, 9.5], [4.6, 9.5], [3.8, 8.2], [5.6, 8.4], [2.2, 8.3]];
    for (const [x, z] of crateSpots) {
        const tag = Physics.createBody({
            shape: 'box', halfExtents: { x: 0.35, y: 0.35, z: 0.35 },
            position: { x, y: 0.36, z }, mass: 12, friction: 0.5, restitution: 0.05,
            layer: 'moving',
        });
        const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
        node.add(scene.createMesh({ mesh: 'box', halfW: 0.35, halfH: 0.35, halfD: 0.35,
                                    color: COL.prop, roughness: 0.7 }));
        course.props.push(tag);
        course.propNodes.push(node);
    }
    for (const [x, z] of [[6.6, 10.6], [7.6, 9.6]]) {
        const tag = Physics.createBody({
            shape: 'cylinder', radius: 0.4, halfHeight: 0.55,
            position: { x, y: 0.56, z }, mass: 18, friction: 0.4,
            layer: 'moving',
        });
        const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
        node.add(scene.createMesh({ mesh: 'cylinder', radius: 0.4, halfHeight: 0.55,
                                    segments: 20, color: COL.barrel, roughness: 0.6 }));
        course.props.push(tag);
        course.propNodes.push(node);
    }
    label(4.4, 1.5, 11.2, 'PUSH · dynamic bodies', 'zone');

    // --- Kinematic platform (x sweeps, z = -14) -----------------------------
    // Created dynamic then converted, because a body created static can never
    // gain a motion state. moveKinematic is velocity-driven, which is exactly
    // what makes it show up in the character's groundVelocity.
    const platTag = Physics.createBody({
        shape: 'box', halfExtents: { x: 2.2, y: 0.25, z: 2.2 },
        position: { x: 0, y: 1.0, z: -14 }, friction: 1.0, layer: 'moving',
    });
    Physics.setKinematic(platTag);
    const platNode = scene.createPhysicsNode({ body: platTag, pixelsPerUnit: 1 });
    platNode.add(scene.createMesh({ mesh: 'box', halfW: 2.2, halfH: 0.25, halfD: 2.2,
                                    color: COL.plat, roughness: 0.5 }));
    course.platform = { tag: platTag, node: platNode, centerX: 0, amplitude: 6,
                        y: 1.0, z: -14, speed: 0.5, phase: 0 };
    // A boarding step, so reaching the platform is not itself a jump puzzle.
    solid(scene, { x: 0, y: 0.375, z: -10.6, hx: 2.2, hy: 0.375, hz: 0.8,
                   color: COL.post });
    label(0, 2.2, -14, 'KINEMATIC PLATFORM · ride', 'zone');

    // --- Spawn marker -------------------------------------------------------
    solid(scene, { x: 0, y: 0.05, z: 12, hx: 1.2, hy: 0.05, hz: 1.2,
                   color: '#3d4a5c', roughness: 0.6 });
    label(0, 0.6, 12, 'SPAWN', '');

    // --- Lighting -----------------------------------------------------------
    // A single shadow-casting sun. Contact shadows are what make a 0.22 m riser
    // readable as a step rather than a paint stripe, so shadows are not
    // decoration here — they are part of the instrument.
    const sun = scene.createLight({
        type: 'directional',
        position: [14, 22, 16],
        direction: [-0.45, -1.0, -0.30],
        color: [1.0, 0.96, 0.90],
        intensity: 3.2,
        name: 'sun',
    });
    sun.castsShadow = true;
    sun.cascadeCount = 4;
    sun.cascadeSplitLambda = 0.7;
    course.sun = sun;

    course.fill = scene.createLight({
        type: 'point', position: [0, 9, 4],
        color: [0.55, 0.68, 0.9], intensity: 30, range: 40, name: 'fill',
    });

    // The sensing layer (queries.js) reads this course rather than adding to
    // it: the gap's near edge is the ledge probe's test case, the tunnel jambs
    // are what the forward sweep stops against, and `props` above is both the
    // proximity sensor's population and the `ignoreBodies` array that proves
    // the ray filter filters.
    //
    // The three zones added last live outside this file but are labelled from
    // here, because app.js builds the DOM label layer once from course.labels
    // and anything appended later would never get an element.
    label(28, 3.4, 10.5, 'CROWD · character vs character', 'zone');
    label(28, 2.6, -6.0, 'BALL LAB · innerBody', 'zone');
    label(0, 5.0, -22.0, 'TERRAIN · heightfield', 'zone');

    return course;
}

/** Advance the kinematic platform. Called once per frame with the frame delta. */
export function tickCourse(course, dt) {
    const p = course.platform;
    if (!p || dt <= 0) return;
    p.phase += dt * p.speed;
    const x = p.centerX + Math.sin(p.phase) * p.amplitude;
    Physics.moveKinematic(p.tag, x, p.y, p.z, dt);
}

export { COL };
