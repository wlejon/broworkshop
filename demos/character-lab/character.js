// character.js — the controller under test.
//
// The point of this file is how LITTLE of it there is. There is no collision
// response, no ground raycast, no step-up sweep, no slide projection, no
// coyote-time hack — all of that is inside Jolt's CharacterVirtual, driven by
// the engine's fixed physics tick. What is left over is: pick a desired
// velocity, hand it to setVelocity, read getState back. Everything the app
// displays is a field the engine already computed.
//
// Two things are worth knowing before reading on.
//
// 1. There is no per-frame move() call. `setVelocity` sets a desire that
//    PERSISTS; the engine consumes it every fixed step until it is changed.
//    When the character is supported it moves at groundVelocity + desire (so
//    a positive Y is a jump launch, and moving platforms carry you for free);
//    when it is not supported the engine integrates gravity into the vertical
//    component itself and only the horizontal part of the desire steers. That
//    is why the airborne branch below simply passes the measured vertical
//    velocity straight back — it is the engine's number, not ours.
//
// 2. The construction options (maxSlopeAngle, stepUp, stickToFloor,
//    maxStrength, radius, halfHeight) have NO runtime setters in the JS
//    binding. To make them feel-able from the HUD, `rebuild()` destroys and
//    recreates the character with the new options, restoring position,
//    velocity and stance. See the note in the final report — this is an
//    engine gap, not a design choice.

const RADIUS = 0.3;
const STAND_HALF = 0.6;    // total standing height = 2*(0.6+0.3) = 1.80 m
const CROUCH_HALF = 0.1;   // total crouched height = 2*(0.1+0.3) = 0.80 m

export const SPAWN = { x: 0, y: RADIUS + STAND_HALF, z: 12 };

/** Live tunables. The HUD writes these; `rebuild()` reads the construction
 *  ones, `tick()` reads the movement ones. */
export const tune = {
    // construction-time (require a rebuild)
    maxSlopeAngle: 50,
    stepUp: 0.4,
    stickToFloor: 0.5,
    maxStrength: 400,
    /** Create the inner rigid body? Construction-time, like the rest of this
     *  block, so the HUD's checkbox rebuilds. See innerbody.js — with this off
     *  the character stops existing as far as every query and every dynamic
     *  body in the world is concerned. */
    innerBody: true,
    // per-frame (free)
    moveSpeed: 4.5,
    jumpSpeed: 6.0,
    gravity: 9.81,
};

/** Everything the HUD and the tests read. Refreshed once per frame from
 *  character.getState(); nothing here is derived by guesswork. */
export const charState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    horizontalSpeed: 0,
    groundState: 'inAir',
    isGrounded: false,
    groundNormal: { x: 0, y: 1, z: 0 },
    groundVelocity: { x: 0, y: 0, z: 0 },
    groundBodyId: -1,
    slopeDeg: 0,
    stance: 'standing',
    /** true when the character is pushing into something and going nowhere. */
    blocked: false,
    /** true when setShape() refused to stand the character back up. */
    standBlocked: false,
    rebuilds: 0,
};

/** Desired horizontal direction in world space, unit-ish. Set by app.js from
 *  camera-relative WASD, or directly by the smoke test. */
export const input = { x: 0, z: 0, jump: false, crouch: false };

export let character = null;
let visual = null;          // parent node the capsule meshes hang off
let standMesh = null;
let crouchMesh = null;
let crouched = false;

function capsuleDesc(half) {
    return { shape: 'capsule', radius: RADIUS, halfHeight: half };
}

/** Build the character and its visual. Safe to call again — `rebuild()` does. */
export function createCharacter(scene, restore) {
    character = Physics.createCharacter({
        position: restore ? restore.position : { ...SPAWN },
        radius: RADIUS,
        halfHeight: restore && restore.crouched ? CROUCH_HALF : STAND_HALF,
        up: { x: 0, y: 1, z: 0 },
        mass: 70,
        maxSlopeAngle: tune.maxSlopeAngle,
        maxStrength: tune.maxStrength,
        stepUp: tune.stepUp,
        stickToFloor: tune.stickToFloor,
        padding: 0.02,
        layer: 'moving',
        // The inner body is what makes the character visible to the rest of the
        // physics world. Chunk 2's shape casts need it as an ignoreBody, and
        // innerbody.js turns it into the demo, so it is on from the start —
        // but it is a tunable, and turning it off is a real experiment rather
        // than a config change.
        innerBody: tune.innerBody,
    });
    crouched = !!(restore && restore.crouched);
    if (restore) character.setVelocity(restore.velocity.x, restore.velocity.y, restore.velocity.z);

    if (!visual) {
        visual = scene.createNode('character');
        standMesh = scene.createMesh({
            mesh: 'capsule', radius: RADIUS, halfHeight: STAND_HALF,
            segments: 20, rings: 12,
            color: '#4fa8d8', metallic: 0.1, roughness: 0.45,
        });
        crouchMesh = scene.createMesh({
            mesh: 'capsule', radius: RADIUS, halfHeight: CROUCH_HALF,
            segments: 20, rings: 12,
            color: '#d8a24f', metallic: 0.1, roughness: 0.45,
            visible: false,
        });
        visual.add(standMesh);
        visual.add(crouchMesh);
    }
    applyStanceVisual();
    return character;
}

function applyStanceVisual() {
    if (!standMesh) return;
    standMesh.visible = !crouched;
    crouchMesh.visible = crouched;
    charState.stance = crouched ? 'crouching' : 'standing';
}

/**
 * Recreate the character with the current construction-time tunables, keeping
 * position, velocity and stance. This is what every slider in the Controller
 * section of the HUD ends up calling.
 */
export function rebuild(scene) {
    const st = character ? character.getState() : null;
    const restore = st ? {
        position: { ...st.position },
        velocity: { ...st.velocity },
        crouched,
    } : null;
    if (character) character.destroy();
    character = null;
    createCharacter(scene, restore);
    charState.rebuilds++;
    return character;
}

/** Teleport back to the spawn pad, standing and at rest. */
export function resetToSpawn() {
    if (!character) return;
    if (crouched) {
        // Stand first: setShape is feet-planted, so doing it after the teleport
        // could fail against whatever is above the spawn pad. Nothing is, but
        // the ordering is the habit worth keeping.
        if (character.setShape(capsuleDesc(STAND_HALF))) {
            crouched = false;
            applyStanceVisual();
        }
    }
    character.setPosition(SPAWN.x, SPAWN.y, SPAWN.z);
    character.setVelocity(0, 0, 0);
    input.x = 0; input.z = 0; input.jump = false; input.crouch = false;
    charState.standBlocked = false;
}

/** Teleport anywhere — used by the smoke test to drop the character at the
 *  foot of each obstacle without walking the whole course. */
export function teleport(x, y, z) {
    if (!character) return;
    character.setPosition(x, y, z);
    character.setVelocity(0, 0, 0);
}

/**
 * One frame of control. Order matters: stance is resolved BEFORE velocity,
 * because a failed stand-up has to leave the crouched capsule's velocity
 * intact rather than briefly commanding a standing walk.
 */
export function tickCharacter() {
    if (!character) return charState;

    // --- stance -------------------------------------------------------------
    // setShape collision-checks the target shape and returns false when it
    // does not fit. That single boolean is the entire "can I stand up here"
    // query — the demo under the tunnel's exit ceiling is it working.
    if (input.crouch && !crouched) {
        if (character.setShape(capsuleDesc(CROUCH_HALF))) {
            crouched = true;
            charState.standBlocked = false;
            applyStanceVisual();
        }
    } else if (!input.crouch && crouched) {
        if (character.setShape(capsuleDesc(STAND_HALF))) {
            crouched = false;
            charState.standBlocked = false;
            applyStanceVisual();
        } else {
            // No headroom. Stay crouched and keep polling — the moment the
            // character walks clear of the ceiling this flips back.
            charState.standBlocked = true;
        }
    }

    // --- desired velocity ---------------------------------------------------
    const st = character.getState();
    let dx = input.x, dz = input.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = 0; dz = 0; }
    const vx = dx * tune.moveSpeed;
    const vz = dz * tune.moveSpeed;

    let vy;
    if (st.isGrounded) {
        // Supported: our Y is a launch impulse, not an acceleration. A single
        // positive value is a jump; zero is "stay planted", which is what lets
        // the engine's stick-to-floor keep the character on descending stairs.
        vy = input.jump ? tune.jumpSpeed : 0;
    } else {
        // Unsupported: the engine owns the vertical axis. Feeding its own
        // measured velocity back is a no-op that keeps this branch honest.
        vy = st.velocity.y;
    }
    input.jump = false;
    character.setVelocity(vx, vy, vz);

    // --- readout ------------------------------------------------------------
    charState.position = st.position;
    charState.velocity = st.velocity;
    charState.speed = Math.hypot(st.velocity.x, st.velocity.y, st.velocity.z);
    charState.horizontalSpeed = Math.hypot(st.velocity.x, st.velocity.z);
    charState.groundState = st.groundState;
    charState.isGrounded = st.isGrounded;
    charState.groundNormal = st.groundNormal;
    charState.groundVelocity = st.groundVelocity;
    charState.groundBodyId = st.groundBodyId;
    // The ground normal is unit-length, so its Y component IS the cosine of
    // the slope. Compare this against the Max slope slider: the moment the
    // number crosses it, groundState flips to "onSteepGround".
    charState.slopeDeg = Math.acos(Math.max(-1, Math.min(1, st.groundNormal.y)))
        * 180 / Math.PI;

    // "Blocked" = commanded to move, standing on something, and achieving less
    // than a third of the commanded speed. That is what walking into a riser
    // taller than stepUp looks like from the outside.
    const commanded = Math.hypot(vx, vz);
    charState.blocked = commanded > 0.1 && st.isGrounded &&
        charState.horizontalSpeed < commanded * 0.33;

    // Keep the capsule mesh on the capsule. getState().position is the shape
    // CENTER, and so is a scene node's translation, so this is a direct copy.
    if (visual) {
        visual.x = st.position.x;
        visual.y = st.position.y;
        visual.z = st.position.z;
    }
    return charState;
}

export function isCrouched() { return crouched; }
export function characterVisual() { return visual; }
export { RADIUS, STAND_HALF, CROUCH_HALF };
