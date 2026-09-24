// steering.js — the steering kernels and the aim solver, as themselves.
//
// `bro.ai.game.steer.*` is five stateless functions: plain numbers in, a
// desired-velocity direction {fx, fz} out. They own no agent, path or clock,
// so the caller integrates (multiplies by speed and dt) — done here in the
// open, with each kernel's returned vector drawn out of its agent:
//
//   seek     straight at the target, full magnitude
//   arrive   seek, but the vector SHRINKS inside slowingRadius (no overshoot)
//   flee     straight away
//   pursue   at where the target is going to be
//   evade    away from where the threat is going to be
//
// Containment (app policy, not kernel behaviour): flee and evade are
// unbounded, so past 6 m from the pad a recentring seek blends in, full at 9 m.
//
// computeLeadAim: the engine solves the intercept quadratic ("where will the
// target be when a projectile at S arrives") and reports `valid` when no real
// intercept exists. A turret proves it by missing without it: fire at a
// crossing target with and without lead and measure each shot's closest
// approach.

import { rod } from "/lib/kit/physics3d.js";
import { marker, capsule } from "/lib/kit/nav3d.js";

// South-west hall: clear of the crate lane (z -8), the funnel lane (z 0) and
// the faction junction (-10, -8).
export const PAD = { x: -12, z: -18 };
export const ORBIT_R = 3.5;
export const TURRET = { x: 2, y: 1.2, z: -18 };
export const TRACK = { x: 10, y: 1.2, z: -18, span: 6.0, speed: 5.0 };
export const PROJECTILE_SPEED = 14;
export const ARRIVE_SLOWING = 3.0;
export const HIT_RADIUS = 0.5;

export const KERNELS = [
    { kind: 'seek',   color: '#ffd166', speed: 3.2, label: 'seek: full force, always' },
    { kind: 'arrive', color: '#7bed9f', speed: 3.2, label: 'arrive: decelerates inside 3 m' },
    { kind: 'flee',   color: '#5ad2f4', speed: 3.0, label: 'flee: straight away' },
    { kind: 'pursue', color: '#a58bff', speed: 3.4, label: 'pursue: cuts the corner' },
    { kind: 'evade',  color: '#ff8f5a', speed: 3.2, label: 'evade: dodges the intercept' },
];

export const steerState = {
    enabled: false,
    time: 0,
    agents: [],          // { kind, color, speed, node, arrow, x, z, vx, vz, force }
    target: null,
    targetP: { x: 0, z: 0, vx: 0, vz: 0 },
    leadOn: true,
    base: null, barrel: null, trackNode: null,
    shots: [],           // live projectiles
    fired: 0, hits: 0, misses: 0,
    lastClosest: 0,
    cooldown: 0,
};

let sceneRef = null;

export function buildSteering(scene) {
    sceneRef = scene;
    clearSteering();
    steerState.target = marker(scene, '#ff6b6b', 0.42, 2.2);
    steerState.target.y = 0.6;
    KERNELS.forEach((k, i) => {
        const a = 2 * Math.PI * i / KERNELS.length;
        const x = PAD.x + Math.cos(a) * 2.2, z = PAD.z + Math.sin(a) * 2.2;
        const node = capsule(scene, { x, y: 0, z }, { name: `steer.${k.kind}`, color: k.color, radius: 0.3, halfHeight: 0.38, emissive: 0.9 });
        const arrow = rod(scene, k.color, { radius: 0.055, emissive: 2.4 });
        arrow.mesh.castsShadow = false;
        arrow.visible = false;
        steerState.agents.push({ ...k, node, arrow, x, z, vx: 0, vz: 0, force: { fx: 0, fz: 0 } });
    });
    steerState.base = scene.createMesh({ name: 'turret.base', mesh: 'cylinder', radius: 0.6, halfHeight: 0.6,
        x: TURRET.x, y: 0.6, z: TURRET.z, color: '#8a939e', metallic: 0.4, roughness: 0.4 });
    steerState.barrel = rod(scene, '#ffd166', { radius: 0.13, emissive: 1.4 });
    steerState.trackNode = marker(scene, '#5ad2f4', 0.45, 2.2);
    Object.assign(steerState.trackNode, { x: TRACK.x, y: TRACK.y, z: TRACK.z });
    setSteeringVisible(steerState.enabled);
    return steerState.agents.length;
}

export function clearSteering() {
    for (const a of steerState.agents) { a.node.destroy(); a.arrow.destroy(); }
    steerState.agents.length = 0;
    for (const s of steerState.shots) s.node.destroy();
    steerState.shots.length = 0;
    for (const n of [steerState.target, steerState.base, steerState.trackNode]) if (n) n.destroy();
    if (steerState.barrel) steerState.barrel.destroy();
    steerState.target = steerState.base = steerState.barrel = steerState.trackNode = null;
}

export function setSteeringVisible(on) {
    steerState.enabled = !!on;
    for (const a of steerState.agents) {
        a.node.visible = steerState.enabled;
        if (!steerState.enabled) a.arrow.visible = false;
    }
    for (const n of [steerState.target, steerState.base, steerState.trackNode]) if (n) n.visible = steerState.enabled;
    if (steerState.barrel) steerState.barrel.visible = steerState.enabled;
    for (const s of steerState.shots) s.node.visible = steerState.enabled;
}

// --- the crossing target, as pure maths ---------------------------------------------
// A triangle wave, not a sine: the lead solver assumes CONSTANT velocity, and a
// piecewise-constant track tests that assumption honestly.

export function trackAt(t) {
    const period = 4 * TRACK.span / TRACK.speed;
    const q = (((t % period) + period) % period) / period;
    const up = q < 0.5;
    const z = up ? -TRACK.span + 4 * TRACK.span * q : 3 * TRACK.span - 4 * TRACK.span * q;
    return { x: TRACK.x, y: TRACK.y, z: TRACK.z + z, vx: 0, vy: 0, vz: up ? TRACK.speed : -TRACK.speed };
}

/** yaw/pitch to a unit direction (-Z forward; positive yaw turns toward +X). */
export function aimDir(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

function solveAim(tgt, lead) {
    return lead
        ? bro.ai.game.computeLeadAim(TURRET.x, TURRET.y, TURRET.z, tgt.x, tgt.y, tgt.z, tgt.vx, tgt.vy, tgt.vz, PROJECTILE_SPEED)
        : bro.ai.game.computeAim(TURRET.x, TURRET.y, TURRET.z, tgt.x, tgt.y, tgt.z);
}

/**
 * Fire one shot at time t with lead on or off and report its closest approach.
 * Pure (no scene, no state): the HUD and the tests get the same answer.
 */
export function simulateShot(t, lead) {
    const aim = solveAim(trackAt(t), lead);
    const d = aimDir(aim.yaw, aim.pitch), dt = 1 / 240;
    let px = TURRET.x, py = TURRET.y, pz = TURRET.z, closest = Infinity, closestAt = 0;
    for (let step = 0; step < 240 * 4; step++) {
        px += d.x * PROJECTILE_SPEED * dt; py += d.y * PROJECTILE_SPEED * dt; pz += d.z * PROJECTILE_SPEED * dt;
        const now = trackAt(t + (step + 1) * dt);
        const dist = Math.hypot(px - now.x, py - now.y, pz - now.z);
        if (dist < closest) { closest = dist; closestAt = (step + 1) * dt; }
        if (px > TRACK.x + 1.0) break;   // past the track plane: only getting further
    }
    return { closest, timeOfClosest: closestAt, valid: lead ? !!aim.valid : true, yaw: aim.yaw, pitch: aim.pitch };
}

// --- tick ----------------------------------------------------------------------------

export function tickSteering(dt) {
    if (!steerState.enabled) return;
    const t = (steerState.time += dt), w = 0.7;
    const tx = PAD.x + Math.cos(t * w) * ORBIT_R, tz = PAD.z + Math.sin(t * w) * ORBIT_R;
    const tvx = -Math.sin(t * w) * ORBIT_R * w, tvz = Math.cos(t * w) * ORBIT_R * w;
    steerState.targetP = { x: tx, z: tz, vx: tvx, vz: tvz };
    steerState.target.x = tx; steerState.target.z = tz;

    const S = bro.ai.game.steer;
    for (const a of steerState.agents) {
        const f = a.kind === 'seek' ? S.seek(a.x, a.z, tx, tz)
                : a.kind === 'arrive' ? S.arrive(a.x, a.z, tx, tz, ARRIVE_SLOWING)
                : a.kind === 'flee' ? S.flee(a.x, a.z, tx, tz)
                : a.kind === 'pursue' ? S.pursue(a.x, a.z, tx, tz, tvx, tvz, a.speed)
                : S.evade(a.x, a.z, tx, tz, tvx, tvz, a.speed);
        let fx = f.fx, fz = f.fz;
        const r = Math.hypot(a.x - PAD.x, a.z - PAD.z);
        if (r > 6) {
            const k = Math.min(1, (r - 6) / 3), back = S.seek(a.x, a.z, PAD.x, PAD.z);
            fx = fx * (1 - k) + back.fx * k;
            fz = fz * (1 - k) + back.fz * k;
        }
        a.force = { fx, fz };
        // Unit-length for four kernels, shrinking for arrive; speed is ours.
        a.vx = fx * a.speed; a.vz = fz * a.speed;
        a.x += a.vx * dt; a.z += a.vz * dt;
        a.node.x = a.x; a.node.z = a.z;
        // The arrow is the kernel's vector itself, 2.2 m per unit (arrive's shrinks).
        if (Math.hypot(fx, fz) > 1e-3) a.arrow.set({ x: a.x, y: 0.68, z: a.z }, { x: a.x + fx * 2.2, y: 0.68, z: a.z + fz * 2.2 });
        else a.arrow.visible = false;
    }
    tickTurret(dt);
}

function tickTurret(dt) {
    const t = steerState.time, tgt = trackAt(t);
    steerState.trackNode.z = tgt.z;
    const aim = solveAim(tgt, steerState.leadOn), d = aimDir(aim.yaw, aim.pitch);
    steerState.barrel.set(TURRET, { x: TURRET.x + d.x * 1.4, y: TURRET.y + d.y * 1.4, z: TURRET.z + d.z * 1.4 });

    steerState.cooldown -= dt;
    if (steerState.cooldown <= 0 && (!steerState.leadOn || aim.valid)) {
        steerState.cooldown = 0.55;
        const sim = simulateShot(t, steerState.leadOn);
        steerState.lastClosest = sim.closest;
        steerState.fired++;
        if (sim.closest <= HIT_RADIUS) steerState.hits++; else steerState.misses++;
        const node = marker(sceneRef, steerState.leadOn ? '#7bed9f' : '#ff6b6b', 0.12, 2.6);
        Object.assign(node, { x: TURRET.x, y: TURRET.y, z: TURRET.z });
        steerState.shots.push({ node, x: TURRET.x, y: TURRET.y, z: TURRET.z, d, life: 2.0 });
    }
    for (let i = steerState.shots.length - 1; i >= 0; i--) {
        const s = steerState.shots[i];
        s.x += s.d.x * PROJECTILE_SPEED * dt; s.y += s.d.y * PROJECTILE_SPEED * dt; s.z += s.d.z * PROJECTILE_SPEED * dt;
        s.node.x = s.x; s.node.y = s.y; s.node.z = s.z;
        if ((s.life -= dt) <= 0 || s.x > TRACK.x + 2) {
            s.node.destroy();
            steerState.shots.splice(i, 1);
        }
    }
}

export function setLead(on) {
    steerState.leadOn = !!on;
    steerState.fired = steerState.hits = steerState.misses = 0;
}

export function agentOf(kind) { return steerState.agents.find((r) => r.kind === kind) || null; }

/** Speed of a kernel's agent this tick. */
export function agentSpeed(kind) {
    const a = agentOf(kind);
    return a ? Math.hypot(a.vx, a.vz) : 0;
}

export function distanceToTarget(kind) {
    const a = agentOf(kind);
    return a ? Math.hypot(a.x - steerState.targetP.x, a.z - steerState.targetP.z) : Infinity;
}
