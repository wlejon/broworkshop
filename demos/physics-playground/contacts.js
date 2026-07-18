// contacts.js — the contact manifold, drawn, listed, and then USED.
//
// Physics.getContacts() is the only place bro hands JS the solver's own view of
// a collision, and it is far richer than "these two touched":
//
//   points       up to four world-space points on body2's surface
//   normal       the direction body2 leaves the collision in — body1 -> body2
//   penetration  metres of overlap; NEGATIVE means a speculative contact, i.e.
//                Jolt saw the pair closing fast enough to predict a touch it
//                has not resolved yet. A resting stack reports small negative
//                penetrations almost every time, which is confusing until you
//                know that, so the HUD labels those "spec".
//   impulse      a PRE-SOLVE estimate of the collision impulse in kg·m/s from
//                Jolt's EstimateCollisionResponse. Accurate for an isolated
//                two-body hit, approximate inside a pile.
//
// Half of this module draws that data — quills at each point along the normal,
// a listing in the HUD. The other half is the part that makes it worth having.
// A diagnostic overlay is a debugging tool; `impulse` is a GAMEPLAY input. It
// scales with mass and closing speed, which is precisely the number you want
// behind an impact sound, a damage number, a dent decal or a particle burst. So
// every contact above a threshold also fires:
//
//   sparks       a one-shot particle burst at the contact point, oriented along
//                the contact normal, its count and speed scaled by impulse
//   flash        a short-lived point light at the same place
//   shake        camera shake, accumulated from the frame's impulses
//   meter        a peak-decaying "impact force" bar in the HUD
//
// Turn the effects off and the same data is still drawn; turn the drawing off
// and the effects still fire. They are the same stream read two ways, which is
// the point being made.
//
// One API note that shapes everything below: getContacts() DRAINS. Exactly one
// caller may hold the drain — app.js's frame loop — and it feeds the events
// here. Two consumers each calling it would each see half the stream.

let scene = null;

export const state = {
    enabled: true,          // process the stream at all
    drawAll: false,         // draw every body's contacts, not just the selection
    draw: true,             // draw the quills
    effects: true,          // sparks / flash / shake
    minImpulse: 6.0,        // below this an event is listed but not dramatised
    shakeGain: 0.0016,
    // Live readouts.
    lastCount: 0,
    peakImpulse: 0,         // decaying peak, the HUD meter
    totalEvents: 0,
    shake: 0,
};

/** The most recent manifolds worth showing, newest first. */
export const recent = [];
const RECENT_MAX = 8;

/** Which body the viewer is focused on; null = whatever `drawAll` says. */
let focusTag = null;
export function setFocus(tag) { focusTag = tag == null ? null : tag; }
export const getFocus = () => focusTag;

// --- Visual pools ------------------------------------------------------------
//
// Every visual here is pooled rather than created per event. A contact stream
// under a 200-body rain is hundreds of events a second, and creating a scene
// node per event would spend the frame in allocation. Pools also make the
// steady state honest: the viewer can never fall behind by more than its pool.

const QUILL_POOL = 24;
const SPARK_POOL = 8;
const FLASH_POOL = 6;

let quills = [];        // { dot, rod } — a pip at the point, a rod along the normal
let sparks = [];        // particle emitters
let flashes = [];       // point lights
let sparkNext = 0, flashNext = 0;

/** Same thin-cylinder trick machines.js uses; the scene has no line primitive. */
function quatYTo(dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const x = dx / len, y = dy / len, z = dz / len;
    if (y > 0.999999) return [0, 0, 0, 1];
    if (y < -0.999999) return [1, 0, 0, 0];
    const ax = z, az = -x;
    const al = Math.hypot(ax, az) || 1;
    const half = Math.acos(Math.max(-1, Math.min(1, y))) / 2;
    const s = Math.sin(half);
    return [(ax / al) * s, 0, (az / al) * s, Math.cos(half)];
}

export function initContacts(sc) {
    scene = sc;

    for (let i = 0; i < QUILL_POOL; i++) {
        const dot = scene.createMesh({
            mesh: 'sphere', radius: 0.07, segments: 8, rings: 6,
            color: '#ffd166', emissive: 3.0, emissiveColor: '#ffd166', roughness: 1,
        });
        const rod = scene.createMesh({
            mesh: 'cylinder', radius: 0.022, halfHeight: 0.5, segments: 6,
            color: '#7bed9f', emissive: 2.4, emissiveColor: '#7bed9f', roughness: 1,
        });
        dot.visible = false; rod.visible = false;
        quills.push({ dot, rod });
    }

    for (let i = 0; i < SPARK_POOL; i++) {
        sparks.push(scene.createParticles3D({
            name: `impact-sparks-${i}`,
            shape: { type: 'cone', radius: 0.04, angle: 38 },
            rate: 0, maxParticles: 90, seed: 1000 + i,
            lifetime: { min: 0.14, max: 0.42 },
            velocity: { direction: [0, 1, 0], spread: 30, speed: 5.5, speedSpread: 3.5 },
            gravity: [0, -14, 0],
            size: { start: 0.10, end: 0.012 },
            color: ['#fff6d8', '#ffb03a', 'rgba(180,50,10,0)'],
            blend: 'additive',
        }));
    }

    for (let i = 0; i < FLASH_POOL; i++) {
        const l = scene.createLight({
            type: 'point', position: [0, -200, 0],
            color: [1.0, 0.75, 0.35], intensity: 0, range: 6,
            name: `impact-flash-${i}`,
        });
        flashes.push({ light: l, life: 0, peak: 0 });
    }
}

// --- The stream --------------------------------------------------------------

/**
 * Consume one frame's contact events.
 *
 * @param {Array} events   - the array app.js drained from Physics.getContacts()
 * @param {Function} isKnown - tag -> boolean, "is this a body the app owns";
 *                   used only to label the listing, never to filter the stream.
 */
export function consume(events, isKnown = () => true) {
    // Peak decay runs whether or not the stream is enabled, so switching the
    // viewer off does not freeze the meter at whatever it last saw.
    state.peakImpulse *= 0.90;
    state.shake *= 0.86;
    if (state.shake < 1e-4) state.shake = 0;

    if (!state.enabled || !events) { hideQuills(0); return 0; }

    let drawn = 0;
    let count = 0;

    for (const e of events) {
        if (e.type !== 'added' || e.sensor) continue;
        count++;
        state.totalEvents++;

        const impulse = e.impulse || 0;
        const relevant = focusTag == null
            ? state.drawAll
            : (e.body1 === focusTag || e.body2 === focusTag);

        // Record for the HUD listing regardless of whether it is drawn — the
        // list is the "what does this data look like" half of the feature.
        if (relevant || impulse >= state.minImpulse) {
            recent.unshift({
                body1: e.body1, body2: e.body2,
                n: e.points ? e.points.length : 0,
                normal: e.normal ? { x: e.normal.x, y: e.normal.y, z: e.normal.z } : null,
                penetration: e.penetration ?? 0,
                impulse,
                known: isKnown(e.body1) || isKnown(e.body2),
                focused: relevant,
            });
            if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
        }

        if (state.draw && relevant && e.points) {
            drawn = drawQuills(e, drawn);
        }

        if (state.effects && impulse >= state.minImpulse && e.points && e.points.length) {
            fireImpact(e, impulse);
        }

        if (impulse > state.peakImpulse) state.peakImpulse = impulse;
        state.shake = Math.min(1.4, state.shake + impulse * state.shakeGain);
    }

    hideQuills(drawn);
    state.lastCount = count;
    return count;
}

/** Lay this event's manifold onto the quill pool; returns the new fill level. */
function drawQuills(e, from) {
    const n = e.normal || { x: 0, y: 1, z: 0 };
    // Penetration scales the quill so a deep overlap reads as a deep overlap.
    const len = Math.min(1.2, 0.35 + Math.abs(e.penetration || 0) * 6 + Math.min(0.5, (e.impulse || 0) * 0.004));
    let i = from;
    for (const p of e.points) {
        if (i >= QUILL_POOL) break;
        const q = quills[i++];
        q.dot.x = p.x; q.dot.y = p.y; q.dot.z = p.z;
        q.dot.visible = true;
        q.rod.x = p.x + n.x * len / 2;
        q.rod.y = p.y + n.y * len / 2;
        q.rod.z = p.z + n.z * len / 2;
        q.rod.quaternion = quatYTo(n.x, n.y, n.z);
        q.rod.scaleY = len;
        q.rod.visible = true;
    }
    return i;
}

function hideQuills(from) {
    for (let i = from; i < QUILL_POOL; i++) {
        quills[i].dot.visible = false;
        quills[i].rod.visible = false;
    }
}

/**
 * The payoff: turn one contact into an impact.
 *
 * Everything here is scaled by `impulse` and nothing else, which is the honest
 * demonstration — a gentle touch and a wrecking ball run the identical code and
 * look completely different because the number is completely different.
 */
function fireImpact(e, impulse) {
    const p = e.points[0];
    const n = e.normal || { x: 0, y: 1, z: 0 };
    // Sparks fly back out along the normal, away from the surface they hit.
    const strength = Math.min(1, impulse / 400);

    const em = sparks[sparkNext = (sparkNext + 1) % SPARK_POOL];
    em.x = p.x; em.y = p.y; em.z = p.z;
    em.quaternion = quatYTo(n.x, n.y, n.z);      // emitter cone binds +Y
    em.burst(Math.round(6 + strength * 40));

    const f = flashes[flashNext = (flashNext + 1) % FLASH_POOL];
    f.light.x = p.x + n.x * 0.3;
    f.light.y = p.y + n.y * 0.3;
    f.light.z = p.z + n.z * 0.3;
    f.peak = 2.5 + strength * 26;
    f.life = 0.16;
    f.light.intensity = f.peak;
}

/**
 * Per-frame decay of the flash lights. Separate from consume() because the
 * flashes have to fade on frames where nothing collided at all.
 */
export function updateContacts(dt) {
    for (const f of flashes) {
        if (f.life <= 0) continue;
        f.life -= dt;
        if (f.life <= 0) { f.light.intensity = 0; f.life = 0; continue; }
        f.light.intensity = f.peak * (f.life / 0.16);
    }
}

/**
 * Camera shake offset for this frame, in world units.
 *
 * Driven straight off the accumulated contact impulse, so a rain of light
 * debris produces a constant faint rumble and a wrecking ball produces one
 * hard jolt. Returned rather than applied, because the camera belongs to
 * app.js and a module that reaches into it would be a layering violation.
 */
export function shakeOffset(t) {
    if (!state.effects || state.shake <= 0) return [0, 0, 0];
    const a = state.shake * 0.22;
    return [
        Math.sin(t * 47.0) * a,
        Math.sin(t * 61.7 + 1.3) * a,
        Math.sin(t * 53.1 + 2.6) * a,
    ];
}

export function clearContacts() {
    recent.length = 0;
    state.peakImpulse = 0;
    state.shake = 0;
    state.lastCount = 0;
    state.totalEvents = 0;
    hideQuills(0);
    for (const f of flashes) { f.life = 0; f.light.intensity = 0; }
    return true;
}
