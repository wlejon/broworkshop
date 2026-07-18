// crowd.js — character-vs-character collision.
//
// docs/physics-api.js says it in one sentence: "every character is registered
// with a world-level character-vs-character checker, so two characters walked
// into each other stop and slide instead of ghosting through." That is a big
// claim, because it is the thing hand-rolled capsule controllers almost never
// get right — most games fall back to modelling other actors as rigid bodies or
// as sensor volumes with bespoke push-back code.
//
// This file spends twenty-odd real `Physics.createCharacter` handles to test
// it. Every NPC here is the same class of object as the player: same capsule,
// same controller, same fixed-step update inside Jolt. Nothing in this file
// resolves a collision, computes a separation vector or applies a push. The
// wander steering below only ever picks a DIRECTION; where each NPC actually
// ends up is Jolt's answer.
//
// The payoff is felt, not read: walk the player into a packed crowd and the
// commanded 4.5 m/s becomes about 1 m/s of shouldering through. The smoke test
// measures exactly that — same command, same duration, open ground versus
// crowd.
//
// About the "collision on/off" toggle. There is no API to disable
// character-vs-character checking: the engine adds every character to one
// CharacterVsCharacterCollisionSimple instance at creation and there is no
// per-character or per-layer opt-out (confirmed in the engine source, reported
// in the final notes). So the toggle here does the honest thing instead — it
// switches each NPC between a REAL character controller and a pure visual
// marker moved by the same steering maths with no physics behind it. That is a
// truthful A/B: one column is what the engine does, the other is what you get
// without it, and the ghosts walk straight through the player.

import { charState } from "/app/character.js";
import { nameBody } from "/app/queries.js";

/** Where the crowd lives: open ground east of the gap course. */
export const PLAZA = { x: 28, z: 4, radius: 6.0 };

const MAX_NPCS = 32;
const NPC_RADIUS = 0.3;
const NPC_HALF = 0.55;
const NPC_Y = NPC_RADIUS + NPC_HALF;   // capsule centre height on flat ground

/** Live tunables, bound to the Crowd section of the HUD. */
export const crowd = {
    /** How many NPCs are active. The slider goes to MAX_NPCS. */
    count: 18,
    /** true  = real Physics.createCharacter controllers (they collide)
     *  false = visual markers on the same steering, no physics at all */
    physical: true,
    /** metres per second each NPC wanders at */
    speed: 1.3,
    /** how fast a heading drifts, radians per second */
    turnRate: 1.1,
    /** NPCs steer back toward the plaza centre once past this fraction of the
     *  plaza radius, which is what keeps the group a crowd rather than a
     *  diaspora. */
    leash: 0.75,
};

/** Live readout for the HUD and the smoke test. */
export const crowdState = {
    active: 0,
    physical: true,
    /** mean horizontal speed the NPCs are actually achieving. In a dense
     *  crowd this sits well under `crowd.speed` — that shortfall IS the
     *  character-vs-character collision, measured. */
    meanSpeed: 0,
    /** how many NPCs are within 1.2 m of the player right now */
    touchingPlayer: 0,
    /** Progress the player is making ALONG the direction it asked for, as a
     *  fraction of the commanded speed. This is deliberately not "achieved
     *  speed / commanded speed": a character wedged in a crowd is still moving
     *  at very nearly full speed, it is just being slid sideways along the
     *  capsules it cannot pass. The projection onto the commanded direction is
     *  what a player actually feels as resistance. */
    playerThrough: 1,
};

/** The pool. Each entry keeps its own position so a ghost and a character can
 *  swap places without teleporting. */
export const npcs = [];

let sceneRef = null;

// A seeded generator, because "wandering crowd" and "deterministic headless
// test" have to be the same crowd. xorshift32 — cheap and reproducible.
let rngState = 0x9e3779b9;
function rnd() {
    let x = rngState;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    rngState = x;
    return x / 4294967296;
}

// --- construction ------------------------------------------------------------

/**
 * Build the whole pool up front: capsule meshes for all MAX_NPCS, and
 * controllers for the ones currently active. Creating a Jolt character is not
 * free, so the count slider parks unused ones rather than churning handles on
 * every pixel of a drag.
 */
export function buildCrowd(scene) {
    sceneRef = scene;
    rngState = 0x9e3779b9;
    for (let i = 0; i < MAX_NPCS; ++i) {
        // Golden-angle spiral: an even fill of the plaza disc with no clumping
        // and no rejection sampling, and it is the same layout every run.
        const t = (i + 0.5) / MAX_NPCS;
        const r = PLAZA.radius * 0.82 * Math.sqrt(t);
        const a = i * 2.39996;
        const npc = {
            i,
            ch: null,
            mesh: null,
            x: PLAZA.x + Math.cos(a) * r,
            z: PLAZA.z + Math.sin(a) * r,
            y: NPC_Y,
            heading: rnd() * Math.PI * 2,
            wobble: 0.5 + rnd(),      // per-NPC turn bias, so they don't sync up
            speed: 0,
            active: false,
        };
        npc.mesh = scene.createMesh({
            mesh: 'capsule', radius: NPC_RADIUS, halfHeight: NPC_HALF,
            segments: 14, rings: 8,
            // Warm tone against the player's cold blue, so who-is-who is
            // obvious the instant the player is inside the group.
            color: '#c9705f', metallic: 0.05, roughness: 0.6,
        });
        npc.mesh.visible = false;
        npcs.push(npc);
    }
    applyCount();
    return npcs;
}

/** Create the controller for one NPC at its stored position. */
function spawnController(npc) {
    if (npc.ch) return;
    npc.ch = Physics.createCharacter({
        position: { x: npc.x, y: npc.y, z: npc.z },
        radius: NPC_RADIUS,
        halfHeight: NPC_HALF,
        up: { x: 0, y: 1, z: 0 },
        mass: 70,
        maxSlopeAngle: 50,
        // Low push strength on purpose: an NPC should be shoved aside by the
        // player rather than bulldozing the crates it wanders into.
        maxStrength: 60,
        stepUp: 0.35,
        stickToFloor: 0.5,
        padding: 0.02,
        layer: 'moving',
        // Inner bodies make the crowd visible to the sensing layer: walk into
        // the group with the proximity sensor on and every NPC shows up in the
        // overlap list by name. Without this they would be invisible to every
        // query in queries.js even while blocking the player.
        innerBody: true,
    });
    nameBody(npc.ch.innerBody, `npc ${npc.i + 1}`);
}

function despawnController(npc) {
    if (!npc.ch) return;
    const p = npc.ch.getPosition();
    npc.x = p.x; npc.y = p.y; npc.z = p.z;
    npc.ch.destroy();
    npc.ch = null;
}

/**
 * Reconcile the pool with `crowd.count` and `crowd.physical`. Called by the
 * HUD (via setCrowdSize / setCrowdPhysical) and once at build time.
 */
function applyCount() {
    let active = 0;
    for (const npc of npcs) {
        const want = npc.i < crowd.count;
        npc.active = want;
        npc.mesh.visible = want;
        if (want && crowd.physical) spawnController(npc);
        else despawnController(npc);
        if (want) active++;
    }
    crowdState.active = active;
    crowdState.physical = crowd.physical;
}

export function setCrowdSize(n) {
    crowd.count = Math.max(0, Math.min(MAX_NPCS, Math.round(n)));
    applyCount();
}

export function setCrowdPhysical(on) {
    crowd.physical = !!on;
    applyCount();
}

/** Re-form the crowd on the plaza. Used by the HUD's reset and by the test to
 *  get a known layout without waiting for the wander to settle. */
export function resetCrowd() {
    rngState = 0x9e3779b9;
    for (const npc of npcs) {
        const t = (npc.i + 0.5) / MAX_NPCS;
        const r = PLAZA.radius * 0.82 * Math.sqrt(t);
        const a = npc.i * 2.39996;
        placeNpc(npc.i, PLAZA.x + Math.cos(a) * r, PLAZA.z + Math.sin(a) * r);
        npc.heading = rnd() * Math.PI * 2;
    }
}

/** Put one NPC somewhere exactly. The smoke test uses this to build a known
 *  formation instead of asserting against wander noise. */
export function placeNpc(i, x, z, y) {
    const npc = npcs[i];
    if (!npc) return;
    npc.x = x; npc.z = z; npc.y = y != null ? y : NPC_Y;
    if (npc.ch) {
        npc.ch.setPosition(npc.x, npc.y, npc.z);
        npc.ch.setVelocity(0, 0, 0);
    }
    npc.mesh.x = npc.x; npc.mesh.y = npc.y; npc.mesh.z = npc.z;
}

/** Live position of an NPC, from the controller when there is one. */
export function npcPosition(i) {
    const npc = npcs[i];
    if (!npc) return null;
    if (npc.ch) { const p = npc.ch.getPosition(); return { x: p.x, y: p.y, z: p.z }; }
    return { x: npc.x, y: npc.y, z: npc.z };
}

// --- per-frame ---------------------------------------------------------------

/**
 * Steer, then read back. The steering half is three lines of trigonometry and
 * it is deliberately dumb: drift the heading, turn toward the plaza when the
 * leash tightens, hand the result to setVelocity. It has no idea another NPC
 * exists. Everything that looks like crowd behaviour — the jostling, the
 * shuffling around the player, the way a packed group stops flowing — is
 * emergent from the controllers refusing to overlap.
 */
export function tickCrowd(dt) {
    if (dt <= 0) return crowdState;
    const p = charState.position;
    let speedSum = 0, moving = 0, touching = 0;

    for (const npc of npcs) {
        if (!npc.active) continue;

        // Where am I, really?
        if (npc.ch) {
            const st = npc.ch.getState();
            npc.x = st.position.x; npc.y = st.position.y; npc.z = st.position.z;
            npc.speed = Math.hypot(st.velocity.x, st.velocity.z);
        }

        // Heading drift: a slow random walk, distinct per NPC.
        npc.heading += (rnd() - 0.5) * crowd.turnRate * npc.wobble * dt * 6;

        // Leash: past the soft edge of the plaza, blend the heading toward the
        // centre so the group stays a group.
        const ox = npc.x - PLAZA.x, oz = npc.z - PLAZA.z;
        const dist = Math.hypot(ox, oz);
        if (dist > PLAZA.radius * crowd.leash) {
            const toCentre = Math.atan2(-oz, -ox);
            // Shortest-arc blend, strength ramping to 1 at the plaza edge.
            const k = Math.min(1, (dist - PLAZA.radius * crowd.leash) /
                                  (PLAZA.radius * (1 - crowd.leash)));
            let d = toCentre - npc.heading;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            npc.heading += d * Math.min(1, k * dt * 5);
        }

        const vx = Math.cos(npc.heading) * crowd.speed;
        const vz = Math.sin(npc.heading) * crowd.speed;

        if (npc.ch) {
            // Grounded characters take a zero Y as "stay planted"; airborne
            // ones own their own vertical, so hand theirs straight back.
            const st = npc.ch.getState();
            npc.ch.setVelocity(vx, st.isGrounded ? 0 : st.velocity.y, vz);
        } else {
            // Ghost mode: integrate in JS. No collision of any kind — this is
            // the control arm of the experiment, and it walks through walls,
            // through the crowd, and through the player.
            npc.x += vx * dt;
            npc.z += vz * dt;
            npc.y = NPC_Y;
            npc.speed = crowd.speed;
        }

        // The mesh always follows the stored position, so it is correct in both
        // modes without a branch here.
        npc.mesh.x = npc.x; npc.mesh.y = npc.y; npc.mesh.z = npc.z;

        speedSum += npc.speed;
        moving++;
        if (Math.hypot(npc.x - p.x, npc.z - p.z) < 1.2) touching++;
    }

    crowdState.active = moving;
    crowdState.physical = crowd.physical;
    crowdState.meanSpeed = moving ? speedSum / moving : 0;
    crowdState.touchingPlayer = touching;
    return crowdState;
}

let lastPos = null;
let throughAccum = 0;

/**
 * Update `playerThrough` from this frame's command. `dx`/`dz` is the unit
 * direction the player asked to go and `commanded` the speed it asked for.
 *
 * This measures DISPLACEMENT, not the reported velocity, and that is a
 * deliberate correction rather than a stylistic choice. Measured against the
 * runtime: when a character is stopped by another CHARACTER, getState()
 * .velocity still reports the desired velocity — the character-vs-character
 * resolution happens outside the value that the ordinary wall-collision path
 * writes back. Walking into a crate or a stair riser does reduce the reported
 * velocity; walking into an NPC does not. So the only honest measure of
 * resistance here is where the capsule actually ended up.
 *
 * The result is smoothed over ~0.15 s because a single frame's displacement at
 * 60 Hz is a couple of centimetres and quantization makes it jump.
 */
export function sampleThrough(dx, dz, commanded, dt) {
    const p = charState.position;
    if (!lastPos) { lastPos = { x: p.x, z: p.z }; return crowdState.playerThrough; }
    const jump = Math.hypot(p.x - lastPos.x, p.z - lastPos.z);
    // A teleport is not a walk. Anything faster than the character could
    // possibly have moved under its own power is a `teleport()` or a rebuild,
    // and measuring it as progress would report 400% throughput.
    if (jump > Math.max(0.5, commanded * dt * 4)) {
        lastPos.x = p.x; lastPos.z = p.z;
        return crowdState.playerThrough;
    }
    if (commanded > 0.1 && dt > 1e-4) {
        const progress = ((p.x - lastPos.x) * dx + (p.z - lastPos.z) * dz) / dt;
        const k = Math.min(1, dt / 0.15);
        throughAccum += (progress / commanded - throughAccum) * k;
        crowdState.playerThrough = throughAccum;
    } else {
        throughAccum = crowdState.playerThrough;
    }
    lastPos.x = p.x; lastPos.z = p.z;
    return crowdState.playerThrough;
}

/** Forget the displacement history — after a teleport, the delta across the
 *  jump is not a walk and must not be measured as one. */
export function resetThrough() {
    lastPos = null;
    throughAccum = 1;
    crowdState.playerThrough = 1;
}

/** Body tags of every live NPC inner body — an `ignoreBodies` list for anyone
 *  who wants to query past the crowd. */
export function crowdBodies() {
    const out = [];
    for (const npc of npcs) if (npc.active && npc.ch && npc.ch.innerBody > 0) out.push(npc.ch.innerBody);
    return out;
}

/** True when a body tag belongs to an NPC. */
export function isNpcBody(tag) {
    for (const npc of npcs) if (npc.ch && npc.ch.innerBody === tag) return true;
    return false;
}

export { MAX_NPCS, NPC_RADIUS, NPC_HALF, NPC_Y };
