// steering.js — the steering kernels, and the aim solver, as themselves.
//
// `bro.ai.game.steer.*` is five stateless functions. Each takes plain numbers
// and returns a desired-velocity direction `{fx, fz}` — it does not own an
// agent, a path, or a clock. That makes them the right tool inside a custom
// think() or a scripted set-piece, and it also makes them easy to get wrong by
// assuming they integrate themselves. They do not: the caller multiplies by
// speed and dt.
//
// So this module integrates them by hand, in the open, and draws the force each
// kernel returns as a vector out of the agent. Five agents chase, decelerate
// into, run from, cut off, and dodge one orbiting target, and the difference
// between them is one function call.
//
//   seek     straight at the target, always full magnitude
//   arrive   seek, but the returned vector SHRINKS inside slowingRadius, which
//            is what stops an agent overshooting its final waypoint
//   flee     straight away
//   pursue   at where the target is going to be
//   evade    away from where the threat is going to be
//
// Containment: flee and evade are unbounded by definition and would leave the
// level. Past 6 m from the pad centre a recentring seek is blended in, ramping
// to full at 9 m. That is app policy, not kernel behaviour, and it is the only
// thing here that is not a raw kernel result.
//
// ─── computeLeadAim ──────────────────────────────────────────────────────────
//
// broworkshop's own lib/bot_aim.js hand-rolls intercept maths — the quadratic
// for "where will the target be when a projectile travelling at S gets there".
// The engine already ships it: `bro.ai.game.computeLeadAim` solves the same
// quadratic natively and hands back yaw/pitch plus a `valid` flag for the case
// where no real intercept exists (a target outrunning the projectile).
//
// A turret proves it the only way worth proving: fire at a crossing target with
// lead enabled and with lead disabled, and measure the closest approach of each
// shot. Direct aim misses by metres. Lead aim hits. The two numbers are in the
// HUD and asserted in the smoke test.

// --- Layout ------------------------------------------------------------------
//
// Tucked into the south-west of the hall, clear of the crate lane at z = -8,
// the funnel lane at z = 0 and the faction junction at (-10, -8), so nothing
// here can be confused with the crowd work.

export const PAD = { x: -12, z: -18 };
export const ORBIT_R = 3.5;
export const TURRET = { x: 2, y: 1.2, z: -18 };
export const TRACK = { x: 10, y: 1.2, z: -18, span: 6.0, speed: 5.0 };
export const PROJECTILE_SPEED = 14;

export const steerState = {
    enabled: false,
    time: 0,
    agents: [],          // { kind, node, arrow, x, z, vx, vz, speed, color }
    target: null,        // orbiting sphere node
    targetP: { x: 0, z: 0, vx: 0, vz: 0 },

    // Turret
    leadOn: true,
    turretNode: null,
    trackNode: null,
    barrel: null,
    shots: [],           // live projectiles
    fired: 0, hits: 0, misses: 0,
    lastClosest: 0,
    cooldown: 0,
};

const KERNELS = [
    { kind: 'seek',   color: '#ffd166', speed: 3.2, label: 'seek — full force, always' },
    { kind: 'arrive', color: '#7bed9f', speed: 3.2, label: 'arrive — decelerates inside 3 m' },
    { kind: 'flee',   color: '#5ad2f4', speed: 3.0, label: 'flee — straight away' },
    { kind: 'pursue', color: '#a58bff', speed: 3.4, label: 'pursue — cuts the corner' },
    { kind: 'evade',  color: '#ff8f5a', speed: 3.2, label: 'evade — dodges the intercept' },
];

export const kernelInfo = KERNELS;
export const ARRIVE_SLOWING = 3.0;

// --- Vector arrows -----------------------------------------------------------
//
// The scene has no line primitive, so a force vector is a thin cylinder scaled
// along its own axis and rotated from +Y onto the direction. `node.quaternion`
// is the atomic rotation setter, which matters here: writing rotationX/Y/Z
// separately would show a half-applied orientation for a frame.

function pointCylinder(node, from, dx, dy, dz, len) {
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-5 || len < 1e-4) { node.visible = false; return; }
    node.visible = true;
    const ux = dx / L, uy = dy / L, uz = dz / L;
    // Shortest-arc quaternion taking +Y onto (ux, uy, uz).
    let qx = uz, qy = 0, qz = -ux, qw = 1 + uy;
    if (qw < 1e-6) { qx = 1; qy = 0; qz = 0; qw = 0; }   // exactly antiparallel
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    node.quaternion = [qx / n, qy / n, qz / n, qw / n];
    node.scaleY = len;              // the base cylinder is 1 m tall
    node.x = from.x + ux * len * 0.5;
    node.y = from.y + uy * len * 0.5;
    node.z = from.z + uz * len * 0.5;
}

// --- Build -------------------------------------------------------------------

export function buildSteering(scene) {
    clearSteering(scene);

    steerState.target = scene.createMesh({
        name: 'steer.target', mesh: 'sphere', radius: 0.42,
        x: PAD.x + ORBIT_R, y: 0.6, z: PAD.z,
        color: '#ff6b6b', emissive: 2.2, emissiveColor: '#ff6b6b', roughness: 1.0,
    });
    steerState.target.castsShadow = false;

    KERNELS.forEach((k, i) => {
        const a = 2 * Math.PI * i / KERNELS.length;
        const x = PAD.x + Math.cos(a) * 2.2, z = PAD.z + Math.sin(a) * 2.2;
        const node = scene.createMesh({
            name: `steer.${k.kind}`, mesh: 'capsule',
            radius: 0.3, halfHeight: 0.38,
            x, y: 0.68, z,
            color: k.color, metallic: 0.05, roughness: 0.5,
            emissive: 0.9, emissiveColor: k.color,
        });
        const arrow = scene.createMesh({
            name: `steer.${k.kind}.force`, mesh: 'cylinder',
            radius: 0.055, halfHeight: 0.5,
            color: k.color, emissive: 2.4, emissiveColor: k.color, roughness: 1.0,
        });
        arrow.castsShadow = false;
        arrow.visible = false;
        steerState.agents.push({ ...k, node, arrow, x, z, vx: 0, vz: 0, force: { fx: 0, fz: 0 } });
    });

    // Turret: a squat base with a barrel that points where the solver says.
    steerState.turretNode = scene.createMesh({
        name: 'turret.base', mesh: 'cylinder', radius: 0.6, halfHeight: 0.6,
        x: TURRET.x, y: 0.6, z: TURRET.z,
        color: '#8a939e', metallic: 0.4, roughness: 0.4,
    });
    steerState.barrel = scene.createMesh({
        name: 'turret.barrel', mesh: 'cylinder', radius: 0.13, halfHeight: 0.5,
        x: TURRET.x, y: TURRET.y, z: TURRET.z,
        color: '#ffd166', emissive: 1.4, emissiveColor: '#ffd166', roughness: 0.5,
    });
    steerState.barrel.castsShadow = false;
    steerState.trackNode = scene.createMesh({
        name: 'turret.mark', mesh: 'sphere', radius: 0.45,
        x: TRACK.x, y: TRACK.y, z: TRACK.z,
        color: '#5ad2f4', emissive: 2.2, emissiveColor: '#5ad2f4', roughness: 1.0,
    });
    steerState.trackNode.castsShadow = false;

    setSteeringVisible(steerState.enabled);
    return steerState.agents.length;
}

export function clearSteering(scene) {
    for (const a of steerState.agents) { scene.destroyNode(a.node); scene.destroyNode(a.arrow); }
    steerState.agents.length = 0;
    for (const s of steerState.shots) scene.destroyNode(s.node);
    steerState.shots.length = 0;
    for (const n of [steerState.target, steerState.turretNode,
                     steerState.barrel, steerState.trackNode]) {
        if (n) scene.destroyNode(n);
    }
    steerState.target = steerState.turretNode = steerState.barrel = steerState.trackNode = null;
}

export function setSteeringVisible(on) {
    steerState.enabled = !!on;
    for (const a of steerState.agents) {
        a.node.visible = steerState.enabled;
        if (!steerState.enabled) a.arrow.visible = false;
    }
    for (const n of [steerState.target, steerState.turretNode,
                     steerState.barrel, steerState.trackNode]) {
        if (n) n.visible = steerState.enabled;
    }
    for (const s of steerState.shots) s.node.visible = steerState.enabled;
}

// --- The crossing target, as pure maths --------------------------------------
//
// A triangle wave, not a sine: the lead solver assumes CONSTANT target
// velocity, and a piecewise-constant track is the honest way to test that
// assumption rather than one that curves out from under it.

export function trackAt(t) {
    const period = 4 * TRACK.span / TRACK.speed;
    const phase = ((t % period) + period) % period;
    const q = phase / period;             // 0..1
    let z, vz;
    if (q < 0.5) { z = -TRACK.span + 4 * TRACK.span * q; vz = TRACK.speed; }
    else         { z =  3 * TRACK.span - 4 * TRACK.span * q; vz = -TRACK.speed; }
    return { x: TRACK.x, y: TRACK.y, z: TRACK.z + z, vx: 0, vy: 0, vz };
}

// yaw/pitch → unit direction, in the engine's -Z-forward convention
// (yaw 0 faces -Z, positive yaw turns toward +X).
export function aimDir(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// Fire one shot at time `t` with lead on or off and report how close it got.
// Pure: no scene, no state, so the smoke test can call it and get the same
// answer the HUD shows.
export function simulateShot(t, lead) {
    const tgt = trackAt(t);
    const aim = lead
        ? bro.ai.game.computeLeadAim(TURRET.x, TURRET.y, TURRET.z,
                                     tgt.x, tgt.y, tgt.z,
                                     tgt.vx, tgt.vy, tgt.vz, PROJECTILE_SPEED)
        : bro.ai.game.computeAim(TURRET.x, TURRET.y, TURRET.z, tgt.x, tgt.y, tgt.z);
    const d = aimDir(aim.yaw, aim.pitch);

    let px = TURRET.x, py = TURRET.y, pz = TURRET.z;
    let closest = Infinity, closestAt = 0;
    const dt = 1 / 240;
    for (let step = 0; step < 240 * 4; step++) {
        px += d.x * PROJECTILE_SPEED * dt;
        py += d.y * PROJECTILE_SPEED * dt;
        pz += d.z * PROJECTILE_SPEED * dt;
        const now = trackAt(t + (step + 1) * dt);
        const dist = Math.hypot(px - now.x, py - now.y, pz - now.z);
        if (dist < closest) { closest = dist; closestAt = (step + 1) * dt; }
        // Once the shot is past the target's track plane it is only getting
        // further away; stop rather than integrating into the far wall.
        if (px > TRACK.x + 1.0) break;
    }
    return { closest, timeOfClosest: closestAt, valid: lead ? !!aim.valid : true,
             yaw: aim.yaw, pitch: aim.pitch };
}

export const HIT_RADIUS = 0.5;

// --- Tick --------------------------------------------------------------------

export function tickSteering(dt) {
    if (!steerState.enabled) return;
    steerState.time += dt;
    const t = steerState.time;

    // The orbiting target the five kernels chase.
    const w = 0.7;
    const tx = PAD.x + Math.cos(t * w) * ORBIT_R;
    const tz = PAD.z + Math.sin(t * w) * ORBIT_R;
    const tvx = -Math.sin(t * w) * ORBIT_R * w;
    const tvz = Math.cos(t * w) * ORBIT_R * w;
    steerState.targetP = { x: tx, z: tz, vx: tvx, vz: tvz };
    steerState.target.x = tx; steerState.target.z = tz;

    const S = bro.ai.game.steer;
    for (const a of steerState.agents) {
        let f;
        switch (a.kind) {
            case 'seek':   f = S.seek(a.x, a.z, tx, tz); break;
            case 'arrive': f = S.arrive(a.x, a.z, tx, tz, ARRIVE_SLOWING); break;
            case 'flee':   f = S.flee(a.x, a.z, tx, tz); break;
            case 'pursue': f = S.pursue(a.x, a.z, tx, tz, tvx, tvz, a.speed); break;
            case 'evade':  f = S.evade(a.x, a.z, tx, tz, tvx, tvz, a.speed); break;
        }
        let fx = f.fx, fz = f.fz;

        // Containment (app policy, see the header): blend a recentring seek in
        // past 6 m so flee and evade stay in the level.
        const r = Math.hypot(a.x - PAD.x, a.z - PAD.z);
        if (r > 6) {
            const k = Math.min(1, (r - 6) / 3);
            const back = S.seek(a.x, a.z, PAD.x, PAD.z);
            fx = fx * (1 - k) + back.fx * k;
            fz = fz * (1 - k) + back.fz * k;
        }

        a.force = { fx, fz };
        // The kernel returns a DIRECTION whose magnitude is meaningful for
        // arrive (it shrinks near the target) and unit-length for the rest.
        // Multiplying by speed is the caller's job, which is exactly the point.
        a.vx = fx * a.speed;
        a.vz = fz * a.speed;
        a.x += a.vx * dt;
        a.z += a.vz * dt;

        a.node.x = a.x; a.node.z = a.z;
        a.node.rotationY = Math.atan2(a.vx, -a.vz) * 180 / Math.PI;
        pointCylinder(a.arrow, { x: a.x, y: 0.68, z: a.z },
                      fx, 0, fz, Math.hypot(fx, fz) * 2.2);
    }

    tickTurret(dt);
}

// --- Turret ------------------------------------------------------------------

function tickTurret(dt) {
    const t = steerState.time;
    const tgt = trackAt(t);
    steerState.trackNode.z = tgt.z;

    const aim = steerState.leadOn
        ? bro.ai.game.computeLeadAim(TURRET.x, TURRET.y, TURRET.z,
                                     tgt.x, tgt.y, tgt.z,
                                     tgt.vx, tgt.vy, tgt.vz, PROJECTILE_SPEED)
        : bro.ai.game.computeAim(TURRET.x, TURRET.y, TURRET.z, tgt.x, tgt.y, tgt.z);
    const d = aimDir(aim.yaw, aim.pitch);
    pointCylinder(steerState.barrel, TURRET, d.x, d.y, d.z, 1.4);

    steerState.cooldown -= dt;
    if (steerState.cooldown <= 0 && (!steerState.leadOn || aim.valid)) {
        steerState.cooldown = 0.55;
        const sim = simulateShot(t, steerState.leadOn);
        steerState.lastClosest = sim.closest;
        steerState.fired++;
        if (sim.closest <= HIT_RADIUS) steerState.hits++; else steerState.misses++;

        const node = sceneOfBarrel().createMesh({
            name: `shot.${steerState.fired}`, mesh: 'sphere', radius: 0.12,
            x: TURRET.x, y: TURRET.y, z: TURRET.z,
            color: steerState.leadOn ? '#7bed9f' : '#ff6b6b',
            emissive: 2.6, emissiveColor: steerState.leadOn ? '#7bed9f' : '#ff6b6b',
            roughness: 1.0,
        });
        node.castsShadow = false;
        steerState.shots.push({ node, x: TURRET.x, y: TURRET.y, z: TURRET.z,
                                dx: d.x, dy: d.y, dz: d.z, life: 2.0 });
    }

    for (let i = steerState.shots.length - 1; i >= 0; i--) {
        const s = steerState.shots[i];
        s.x += s.dx * PROJECTILE_SPEED * dt;
        s.y += s.dy * PROJECTILE_SPEED * dt;
        s.z += s.dz * PROJECTILE_SPEED * dt;
        s.node.x = s.x; s.node.y = s.y; s.node.z = s.z;
        s.life -= dt;
        if (s.life <= 0 || s.x > TRACK.x + 2) {
            sceneOfBarrel().destroyNode(s.node);
            steerState.shots.splice(i, 1);
        }
    }
}

// The scene handle, captured at build time — tickTurret spawns projectile nodes
// and should not need the caller to thread a scene through every frame.
let sceneRef = null;
function sceneOfBarrel() { return sceneRef; }
export function bindScene(scene) { sceneRef = scene; }

export function setLead(on) {
    steerState.leadOn = !!on;
    steerState.fired = steerState.hits = steerState.misses = 0;
}

export function resetTurretStats() {
    steerState.fired = steerState.hits = steerState.misses = 0;
}

// Speed of a named kernel agent this frame, for the HUD and the smoke test.
export function agentSpeed(kind) {
    const a = steerState.agents.find(r => r.kind === kind);
    return a ? Math.hypot(a.vx, a.vz) : 0;
}

export function agentOf(kind) {
    return steerState.agents.find(r => r.kind === kind) || null;
}

export function distanceToTarget(kind) {
    const a = agentOf(kind);
    if (!a) return Infinity;
    return Math.hypot(a.x - steerState.targetP.x, a.z - steerState.targetP.z);
}
