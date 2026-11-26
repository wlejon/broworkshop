// Tumble run phase — marbles drop from the spout, pieces push them along,
// the first marble in the cup clears the level. Scene + run.world (a
// bro.dynamics World, stepped here at STEP seconds a step) only.
//
// run.mode is "build" (placing pieces), "run" (marbles live) or "complete"
// (cleared; the board is frozen under the complete screen).

import { cellKey } from "/app/board.js";
import { rotY, quatY, boosterDir, rampDownhill } from "/app/pieces.js";

const MARBLE_R = 0.17;
const MARBLE_MASS = 1000 * 4 / 3 * Math.PI * MARBLE_R * MARBLE_R * MARBLE_R;   // solid, 1000 kg/m³
const STEP = 1 / 60;
const EMPTY_FAIL_MS = 400;   // every marble gone: short grace, then fail

/** Back to building: clear live marbles and run clocks. */
export function enterBuild(run) {
    clearMarbles(run);
    run.mode = "build";
    resetClock(run);
}

/** Start dropping marbles. */
export function enterRun(run) {
    clearMarbles(run);
    run.mode = "run";
    resetClock(run);
}

/** Freeze the board after a clear: no marbles simulating under the overlay. */
export function freeze(run) {
    clearMarbles(run);
    run.mode = "complete";
}

function resetClock(run) {
    run.stepAcc = 0;
    run.runtime = 0;
    run.resultMs = null;
    run.nextSpawnAt = 0;
    run.marblesSpawned = 0;
    run.marblesRemoved = 0;
    run.graceFailAt = null;
    run.emptyFailAt = null;
}

function clearMarbles(run) {
    for (const m of run.marbles) {
        run.world.removeBody(m.body);
        run.scene.destroyNode(m.node);
    }
    run.marbles.length = 0;
    run.marbleBodies.clear();
}

/**
 * Advance the run by dt ms. Returns "complete" on the first marble in the
 * cup, "fail" when the run can no longer score, else null.
 */
export function stepRun(run, dt) {
    if (run.mode !== "run") return null;
    const level = run.level;
    run.runtime += dt;

    if (run.marblesSpawned < level.maxMarbles && run.runtime >= run.nextSpawnAt) {
        spawnMarble(run);
        run.play("drop");
        run.nextSpawnAt = run.runtime + level.spawnInterval;
    }

    // The world, in whole steps; each one's new touches are kept for handleContacts.
    const touches = [];
    run.stepAcc += dt / 1000;
    for (let n = 0; run.stepAcc >= STEP - 1e-9 && n < 4; n++) {
        run.stepAcc -= STEP;
        spinSpinners(run, STEP);
        run.world.step(STEP, 4);
        const t = run.world.touched();
        for (let i = 0; i < t.length; i++) touches.push(t[i]);
    }
    if (run.stepAcc > STEP) run.stepAcc = 0;

    const b = level.bounds;
    for (let i = run.marbles.length - 1; i >= 0; i--) {
        const m = run.marbles[i];
        const pose = run.world.pose(m.body);
        const p = { x: pose[0], y: pose[1], z: pose[2] };
        m.node.x = p.x;
        m.node.y = p.y;
        m.node.z = p.z;
        if (inGoal(level, p)) {
            run.resultMs = run.runtime;
            return "complete";
        }
        // Cull marbles that fell off or drifted well outside the board, so a
        // failed run cannot soft-lock with marbles resting on the floor.
        if (p.y < -4 || p.x < b.x[0] - 3 || p.x > b.x[1] + 3 || p.z < b.z[0] - 3 || p.z > b.z[1] + 3) {
            removeMarble(run, i);
        }
    }

    assistMarbles(run, dt);
    handleContacts(run, touches);
    return checkFail(run);
}

function spawnMarble(run) {
    const sp = run.level.spawner;
    // Snappy marble: low friction, lively bounce, light damping.
    const body = run.world.addSphere({
        radius: MARBLE_R, mass: MARBLE_MASS,
        position: [sp.x, sp.y, sp.z],
        friction: 0.05, restitution: 0.48, linearDamping: 0.02, angularDamping: 0.04,
    });
    const node = run.scene.createMesh({
        mesh: "sphere", radius: MARBLE_R, segments: 20, rings: 14,
        x: sp.x, y: sp.y, z: sp.z,
        color: "#f5f0ff", metallic: 1.0, roughness: 0.15,
        emissive: 0.2, emissiveColor: [0.6, 0.75, 1.0],
    });
    run.marbles.push({ body, node });
    run.marbleBodies.add(body);
    run.marblesSpawned += 1;
}

function removeMarble(run, i) {
    const m = run.marbles[i];
    run.marbleBodies.delete(m.body);
    run.world.removeBody(m.body);
    run.scene.destroyNode(m.node);
    run.marbles.splice(i, 1);
    run.marblesRemoved += 1;
}

function inGoal(level, p) {
    const g = level.goal;
    return p.x >= g.min[0] && p.x <= g.max[0] && p.y >= g.min[1] && p.y <= g.max[1] &&
        p.z >= g.min[2] && p.z <= g.max[2];
}

/**
 * While a marble sits on or just above a ramp or booster, keep shoving it
 * along the piece's facing so paths feel fair instead of parking mid-slope.
 */
function assistMarbles(run, dt) {
    const k = Math.min(1.2, (dt || 16) / 16);
    for (const m of run.marbles) {
        const p = run.world.pose(m.body);
        const cx = Math.floor(p[0]), cy = Math.floor(p[1]), cz = Math.floor(p[2]);
        let rec = null;
        for (let dy = 0; dy >= -1 && !rec; dy--) {
            const cand = run.placed.get(cellKey(cx, cy + dy, cz));
            if (cand && (cand.type === "ramp" || cand.type === "booster")) rec = cand;
        }
        if (!rec) continue;
        if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot);
            push(run, m.body, d.x * 0.1 * k, 0.015 * k, d.z * 0.1 * k);
        } else {
            const d = boosterDir(rec.rot);
            push(run, m.body, d.x * 0.22 * k, 0.025 * k, d.z * 0.22 * k);
        }
    }
}

/** An impulse through a body's centre. */
function push(run, body, x, y, z) {
    const p = run.world.pose(body);
    run.world.applyImpulse(body, [x, y, z], [p[0], p[1], p[2]]);
}

/** Send each spinner to where the step about to run should leave it (4 rad/s). */
function spinSpinners(run, step) {
    for (const key of run.spinners) {
        const rec = run.placed.get(key);
        if (!rec) continue;
        rec.anim.phase += step * 4;
        const yaw = rotY(rec.anim.rot) + rec.anim.phase;
        const q = quatY(yaw);
        const at = rec.anim.at;
        run.world.moveTo(rec.body, [at[0], at[1], at[2], q[0], q[1], q[2], q[3]], step);
        rec.node.rotationY = yaw;
    }
}

/** Contact kicks: boosters shove, spinners fling, bumpers and boosters clink. */
function handleContacts(run, touches) {
    for (let i = 0; i < touches.length; i += 2) {
        let marble, other;
        if (run.marbleBodies.has(touches[i])) { marble = touches[i]; other = touches[i + 1]; }
        else if (run.marbleBodies.has(touches[i + 1])) { marble = touches[i + 1]; other = touches[i]; }
        else continue;
        if (!run.world.hasBody(marble)) continue;   // culled since the step that touched it
        const key = run.bodyToCell.get(other);
        const rec = key && run.placed.get(key);
        if (!rec) continue;
        if (rec.type === "booster") {
            const d = boosterDir(rec.rot);
            push(run, marble, d.x * 0.38, 0.06, d.z * 0.38);
            run.play("clink");
        } else if (rec.type === "spinner") {
            const v = run.world.velocity(marble);
            push(run, marble, v[0] * 0.55, 0.12, v[2] * 0.55);
            run.play("clink");
        } else if (rec.type === "bumper") {
            run.play("clink");
        } else if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot);
            push(run, marble, d.x * 0.1, 0.03, d.z * 0.1);
        }
    }
}

/**
 * Once every marble has dropped, the run fails when they are all gone (after
 * a short beat) or when the level's grace window runs out without a score.
 */
function checkFail(run) {
    if (run.marblesSpawned < run.level.maxMarbles) return null;
    if (run.marbles.length === 0) {
        if (run.emptyFailAt == null) run.emptyFailAt = run.runtime + EMPTY_FAIL_MS;
        return run.runtime >= run.emptyFailAt ? "fail" : null;
    }
    if (run.graceFailAt == null) run.graceFailAt = run.runtime + run.level.failGraceMs;
    return run.runtime >= run.graceFailAt ? "fail" : null;
}

/** Live marble positions (rounded) for test snapshots. */
export function marblePositions(run) {
    const out = [];
    for (const m of run.marbles) {
        const p = run.world.pose(m.body);
        out.push({ x: +p[0].toFixed(3), y: +p[1].toFixed(3), z: +p[2].toFixed(3) });
    }
    return out;
}
