// innerbody.js — what `innerBody: true` actually buys you.
//
// A CharacterVirtual is not a rigid body. It is a shape that sweeps itself
// through the world every fixed step and never enters the broadphase, which
// means that by default it is invisible to EVERYTHING that asks the world a
// question: raycasts miss it, overlap queries do not return it, contact events
// never mention it, and a dynamic body thrown at it flies straight through.
// The character still collides with the world — the world simply cannot see the
// character.
//
// `innerBody: true` creates a kinematic rigid body that shadows the character's
// shape and follows it every step. That body IS in the broadphase, so all four
// of those things start working. Its tag is `character.innerBody` (-1 when the
// option is off), which is the same tag queries.js has been passing as
// `ignoreBody` since chunk 2.
//
// The switch goes through character.js's rebuild(), because innerBody is a
// construction-time option with no runtime setter. The "visible to
// overlapShape" readout is the proof: with the option on, a sphere overlap
// standing exactly where the character stands returns the character; with it
// off, the same query returns nothing at all, while the character carries on
// walking the course exactly as before.
//
// A MEASURED CORRECTION TO THE DOCS
// ---------------------------------
// docs/physics-api.js lists "CCD bodies and contact events" among the things
// innerBody lets see the character, which reads as though a dynamic body thrown
// at a character without one would pass through it. It does not. Measured
// against this runtime, across a 2x2 of innerBody and maxStrength, the ball's
// final position is IDENTICAL with the inner body and without it:
//
//   innerBody: true,  maxStrength: 400  ->  ball stopped dead at the character
//   innerBody: false, maxStrength: 400  ->  ball stopped dead at the character
//   innerBody: true,  maxStrength: 0    ->  ball passed through at full speed
//   innerBody: false, maxStrength: 0    ->  ball passed through at full speed
//
// The reason is that CharacterVirtual resolves its own contacts with dynamic
// bodies during its sweep, whatever the broadphase can see — so the character
// is already a solid obstacle to a rigid body, and the inner body adds nothing
// to that. What innerBody genuinely changes is QUERIES: raycasts, overlaps and
// sensors. That is what the readout above proves, and it is the only claim
// this file makes about it.
//
// So the ball launcher is kept, pointed at the real mechanism: `maxStrength`,
// the newton cap on how hard the character may act on a dynamic body. It is the
// same slider that shoves the crates, and here it is the difference between a
// ball that stops dead and a ball that sails straight through you. Both
// switches are live and the smoke test asserts both outcomes — including the
// null result for innerBody, so a future engine change that DOES make the inner
// body a collision obstacle will fail this test loudly instead of quietly
// invalidating the comment above.

import { charState, character } from "/app/character.js";

/** The marked spot to stand on for the demo: clear ground south of the crowd
 *  plaza, with 14 m of open run behind the character so a ball that passes
 *  through has somewhere to go. */
export const BALL_LAB = { x: 28, z: -6 };

export const ballLab = {
    /** launch speed, m/s along the launch axis */
    speed: 11,
    radius: 0.28,
    mass: 6,
    /** how far in +Z of the character the ball starts */
    standoff: 4.5,
    /** height of the launch axis relative to the capsule CENTRE. Slightly low
     *  so the ball meets the capsule's barrel rather than clipping the cap. */
    aimHeight: -0.15,
};

/** Live readout. `verdict` is the headline: the word that changes when the
 *  innerBody checkbox changes and nothing else does. */
export const ballState = {
    live: false,
    /** signed distance of the ball past the character along the launch axis;
     *  positive means it got behind the character. */
    past: 0,
    /** closest the ball ever came to the character's axis on this shot */
    minDist: Infinity,
    /** 'in flight' | 'BLOCKED' | 'PASSED THROUGH' | '—' */
    verdict: '—',
    /** does an overlapShape at the character's own position return the
     *  character? This is the query-side statement of the same fact. */
    selfVisible: false,
    /** tag of the inner body, or -1 */
    selfTag: -1,
    shots: 0,
};

let ball = -1;
let ballNode = null;
let sceneRef = null;
let axis = { x: 0, z: -1 };
let anchor = { x: 0, y: 0, z: 0 };
let flightTime = 0;

export function buildBallLab(scene) {
    sceneRef = scene;
    return ballState;
}

/** Remove the ball and its visual. Called before every launch and by reset. */
export function clearBall() {
    if (ball > 0) { Physics.destroyBody(ball); ball = -1; }
    if (ballNode) { ballNode.destroy(); ballNode = null; }
    ballState.live = false;
}

/**
 * Fire one ball at the character along `dir` (defaults to -Z, i.e. the ball
 * comes from +Z). The launch geometry is captured at fire time so the verdict
 * is measured against where the character WAS aimed at, not where it wandered
 * to afterwards.
 */
export function launchBall(dir) {
    if (!sceneRef || !character) return null;
    clearBall();
    const d = dir || { x: 0, z: -1 };
    const len = Math.hypot(d.x, d.z) || 1;
    axis = { x: d.x / len, z: d.z / len };

    const p = charState.position;
    anchor = { x: p.x, y: p.y + ballLab.aimHeight, z: p.z };

    const ox = p.x - axis.x * ballLab.standoff;
    const oz = p.z - axis.z * ballLab.standoff;

    ball = Physics.createBody({
        shape: 'sphere', radius: ballLab.radius,
        position: { x: ox, y: anchor.y, z: oz },
        mass: ballLab.mass,
        friction: 0.3,
        restitution: 0.45,
        // Gravity off: a flat shot keeps the experiment one-dimensional, so the
        // only thing that can change the outcome is whether there is something
        // in the way.
        gravityFactor: 0,
        linearDamping: 0,
        layer: 'moving',
    });
    Physics.setLinearVelocity(ball, axis.x * ballLab.speed, 0, axis.z * ballLab.speed);

    ballNode = sceneRef.createPhysicsNode({ body: ball, pixelsPerUnit: 1 });
    ballNode.add(sceneRef.createMesh({
        mesh: 'sphere', radius: ballLab.radius, segments: 16, rings: 12,
        color: '#f0d27a', emissive: 0.5, emissiveColor: '#f0d27a', roughness: 0.35,
    }));

    ballState.live = true;
    ballState.verdict = 'in flight';
    ballState.minDist = Infinity;
    ballState.past = 0;
    ballState.shots++;
    flightTime = 0;
    return ball;
}

/**
 * Is the character visible to a shape query standing where it stands? This is
 * `overlapShape` with NO ignoreBody filter, so a character with an inner body
 * finds itself and one without finds nothing but the floor it is on.
 *
 * `layers: ['moving']` keeps the ground slab out of the answer, which makes the
 * result a clean boolean rather than a list to search.
 */
export function selfOverlap() {
    if (!character) return { visible: false, ids: [] };
    const p = charState.position;
    const hits = Physics.overlapShape({
        shape: 'sphere', radius: 0.45,
        position: { x: p.x, y: p.y, z: p.z },
        layers: ['moving'],
    });
    const tag = character.innerBody;
    // The result objects carry a BigInt userData, so they are never logged or
    // stringified whole — only the numeric bodyId is read.
    const ids = hits.map((h) => h.bodyId);
    return { visible: tag > 0 && ids.includes(tag), ids, tag };
}

/**
 * Track the ball and decide what happened. The verdict rule is deliberately
 * geometric rather than event-based: measure how far along the launch axis the
 * ball has travelled past the character's launch-time position. Anything that
 * ends up well behind the character went through it.
 */
export function tickBallLab(dt) {
    const so = selfOverlap();
    ballState.selfVisible = so.visible;
    ballState.selfTag = character ? character.innerBody : -1;

    if (!ballState.live || ball <= 0) return ballState;
    flightTime += dt;

    const t = Physics.getTransform(ball);
    if (!t) { clearBall(); return ballState; }
    const bx = t.position.x, bz = t.position.z;

    // Distance from the character's live position, and progress along the axis
    // measured from the aim point captured at launch.
    const p = charState.position;
    ballState.minDist = Math.min(ballState.minDist, Math.hypot(bx - p.x, bz - p.z));
    ballState.past = (bx - anchor.x) * axis.x + (bz - anchor.z) * axis.z;

    const v = Physics.getVelocity(ball);
    const along = v ? v.linear.x * axis.x + v.linear.z * axis.z : 0;

    if (ballState.past > 1.2) {
        // Well behind where the character was aimed at: nothing stopped it.
        ballState.verdict = 'PASSED THROUGH';
    } else if (along < -0.5) {
        // Moving back the way it came.
        ballState.verdict = 'BLOCKED';
    } else if (flightTime > 0.9 && Math.abs(along) < 0.5 && ballState.past < 0.6) {
        // Arrived and stopped. At maxStrength 400 N this is what a 6 kg ball
        // at 11 m/s does against the character: it halts, dead, on contact.
        ballState.verdict = 'BLOCKED';
    }

    // Retire the shot once it is clearly over, so the plaza does not fill up
    // with stray balls and the readout settles on its verdict.
    if (flightTime > 4 || Math.abs(ballState.past) > 14) {
        const final = ballState.verdict === 'in flight' ? 'BLOCKED' : ballState.verdict;
        clearBall();
        ballState.verdict = final;
    }
    return ballState;
}

/** Where the ball is right now, or null. Used by the smoke test to compare two
 *  trajectories rather than two verdict strings. */
export function ballPosition() {
    if (ball <= 0) return null;
    const t = Physics.getTransform(ball);
    return t ? { x: t.position.x, y: t.position.y, z: t.position.z } : null;
}

export function ballBody() { return ball; }
