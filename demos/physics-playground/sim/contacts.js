// sim/contacts.js — the contact manifold, drawn, listed, and then USED.
//
// Physics.getContacts() is the solver's own view of a collision:
//   points       up to four world-space points on body2's surface
//   normal       body1 -> body2
//   penetration  metres of overlap; NEGATIVE = a speculative contact, a touch
//                Jolt predicted but has not solved yet (labelled "spec")
//   impulse      a pre-solve estimate in kg·m/s (exact for an isolated
//                two-body hit, approximate inside a pile)
//
// Drawing that is a debugging tool; `impulse` is a GAMEPLAY input. It scales
// with mass and closing speed, exactly what an impact sound, damage number or
// particle burst wants. So every contact above a threshold also fires sparks,
// a flash of light, camera shake and the panel's impact meter. Turn the
// drawing off and the effects still fire; turn the effects off and the data
// is still drawn. Same stream, read two ways.
//
// getContacts() drains, so this module never calls it: main.js's event hub
// (lib/kit/physics3d.js physicsEvents) drains once a frame and calls consume().

import { quatYTo } from "/lib/kit/math3d.js";
import { ctx } from "./ctx.js";

export const state = {
    enabled: true,      // process the stream at all
    drawAll: false,     // draw every body's contacts, not just the focus
    draw: true,         // draw the quills
    effects: true,      // sparks / flash / shake
    minImpulse: 6.0,    // below this an event is listed but not dramatised
    shakeGain: 0.0016,
    lastCount: 0,       // readouts
    peakImpulse: 0,     // decaying peak: the meter
    totalEvents: 0,
    shake: 0,
};

/** The most recent manifolds worth showing, newest first. */
export const recent = [];
const RECENT_MAX = 8;

let focusTag = null;
/** Which body the viewer follows (the selection); null = whatever drawAll says. */
export function setFocus(tag) { focusTag = tag == null ? null : tag; }
export const getFocus = () => focusTag;

// Pooled visuals: a 200-body rain is hundreds of events a second, and a scene
// node per event would spend the frame allocating.
const QUILL_POOL = 24, SPARK_POOL = 8, FLASH_POOL = 6;
const quills = [], sparks = [], flashes = [];
let sparkNext = 0, flashNext = 0;

export function initContacts() {
    const s = ctx.scene;
    for (let i = 0; i < QUILL_POOL; i++) {
        const dot = s.createMesh({ mesh: 'sphere', radius: 0.07, segments: 8, rings: 6,
            color: '#ffd166', emissive: 3.0, emissiveColor: '#ffd166', roughness: 1 });
        const rod = s.createMesh({ mesh: 'cylinder', radius: 0.022, halfHeight: 0.5, segments: 6,
            color: '#7bed9f', emissive: 2.4, emissiveColor: '#7bed9f', roughness: 1 });
        dot.visible = rod.visible = false;
        quills.push({ dot, rod });
    }
    for (let i = 0; i < SPARK_POOL; i++) {
        sparks.push(s.createParticles3D({
            name: 'impact-sparks-' + i,
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
        flashes.push({ life: 0, peak: 0, light: s.createLight({
            type: 'point', position: [0, -200, 0], color: [1.0, 0.75, 0.35], intensity: 0, range: 6,
            name: 'impact-flash-' + i,
        }) });
    }
}

/**
 * Consume one frame's events. isKnown(tag) only labels the listing.
 * Returns the number of 'added' (non-sensor) events.
 */
export function consume(events, isKnown = () => true) {
    // Decay runs even when disabled, so switching off does not freeze the meter.
    state.peakImpulse *= 0.90;
    state.shake *= 0.86;
    if (state.shake < 1e-4) state.shake = 0;
    if (!state.enabled || !events) { hideQuills(0); return 0; }

    let drawn = 0, count = 0;
    for (const e of events) {
        if (e.type !== 'added' || e.sensor) continue;
        count++;
        state.totalEvents++;
        const impulse = e.impulse || 0;
        const relevant = focusTag == null ? state.drawAll : (e.body1 === focusTag || e.body2 === focusTag);
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
        if (state.draw && relevant && e.points) drawn = drawQuills(e, drawn);
        if (state.effects && impulse >= state.minImpulse && e.points && e.points.length) fireImpact(e, impulse);
        if (impulse > state.peakImpulse) state.peakImpulse = impulse;
        state.shake = Math.min(1.4, state.shake + impulse * state.shakeGain);
    }
    hideQuills(drawn);
    state.lastCount = count;
    return count;
}

/** A pip at each manifold point and a quill along the normal, sized by depth + impulse. */
function drawQuills(e, from) {
    const n = e.normal || { x: 0, y: 1, z: 0 };
    const len = Math.min(1.2, 0.35 + Math.abs(e.penetration || 0) * 6 + Math.min(0.5, (e.impulse || 0) * 0.004));
    let i = from;
    for (const p of e.points) {
        if (i >= QUILL_POOL) break;
        const { dot, rod } = quills[i++];
        dot.x = p.x; dot.y = p.y; dot.z = p.z; dot.visible = true;
        rod.x = p.x + n.x * len / 2; rod.y = p.y + n.y * len / 2; rod.z = p.z + n.z * len / 2;
        rod.quaternion = quatYTo(n.x, n.y, n.z);
        rod.scaleY = len;
        rod.visible = true;
    }
    return i;
}

function hideQuills(from) {
    for (let i = from; i < QUILL_POOL; i++) quills[i].dot.visible = quills[i].rod.visible = false;
}

/**
 * One contact becomes an impact, scaled by `impulse` and nothing else: a
 * gentle touch and a wrecking ball run the same code and look completely
 * different because the number is completely different.
 */
function fireImpact(e, impulse) {
    const p = e.points[0];
    const n = e.normal || { x: 0, y: 1, z: 0 };
    const strength = Math.min(1, impulse / 400);
    const em = sparks[sparkNext = (sparkNext + 1) % SPARK_POOL];
    em.x = p.x; em.y = p.y; em.z = p.z;
    em.quaternion = quatYTo(n.x, n.y, n.z);           // the emitter cone binds +Y
    em.burst(Math.round(6 + strength * 40));
    const f = flashes[flashNext = (flashNext + 1) % FLASH_POOL];
    f.light.x = p.x + n.x * 0.3; f.light.y = p.y + n.y * 0.3; f.light.z = p.z + n.z * 0.3;
    f.peak = 2.5 + strength * 26;
    f.life = 0.16;
    f.light.intensity = f.peak;
}

/** Flash decay, which has to run on frames where nothing collided. */
export function updateContacts(dt) {
    for (const f of flashes) {
        if (f.life <= 0) continue;
        f.life -= dt;
        f.light.intensity = f.life <= 0 ? 0 : f.peak * (f.life / 0.16);
        if (f.life <= 0) f.life = 0;
    }
}

/**
 * Camera shake for this frame, world units, straight off the accumulated
 * impulse: a debris rain rumbles faintly, a wrecking ball jolts once.
 * Returned, not applied: the camera belongs to main.js.
 */
export function shakeOffset(t) {
    if (!state.effects || state.shake <= 0) return [0, 0, 0];
    const a = state.shake * 0.22;
    return [Math.sin(t * 47.0) * a, Math.sin(t * 61.7 + 1.3) * a, Math.sin(t * 53.1 + 2.6) * a];
}

export function clearContacts() {
    recent.length = 0;
    state.peakImpulse = state.shake = state.lastCount = state.totalEvents = 0;
    hideQuills(0);
    for (const f of flashes) { f.life = 0; f.light.intensity = 0; }
    return true;
}
