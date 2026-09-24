// Tumble run phase — marbles drop from the spout, pieces push them along,
// the first marble in the cup clears the level. Scene + Physics only.
//
// run.mode is "build" (placing pieces), "run" (marbles live) or "complete"
// (cleared; the board is frozen under the complete screen).

import { cellKey } from "/app/board.js";
import { rotY, quatY, boosterDir, rampDownhill } from "/app/pieces.js";

const MARBLE_R = 0.17;
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
        Physics.destroyBody(m.body);
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

    const b = level.bounds;
    for (let i = run.marbles.length - 1; i >= 0; i--) {
        const m = run.marbles[i];
        const tf = Physics.getTransform(m.body);
        if (!tf) { run.marbles.splice(i, 1); continue; }
        const p = tf.position;
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
    spinSpinners(run, dt);
    handleContacts(run);
    return checkFail(run);
}

function spawnMarble(run) {
    const sp = run.level.spawner;
    // Snappy marble: low friction, lively bounce, light damping.
    const body = Physics.createBody({
        shape: "sphere", radius: MARBLE_R,
        position: { x: sp.x, y: sp.y, z: sp.z },
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
    Physics.destroyBody(m.body);
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
        const tf = Physics.getTransform(m.body);
        if (!tf) continue;
        const cx = Math.floor(tf.position.x), cy = Math.floor(tf.position.y), cz = Math.floor(tf.position.z);
        let rec = null;
        for (let dy = 0; dy >= -1 && !rec; dy--) {
            const cand = run.placed.get(cellKey(cx, cy + dy, cz));
            if (cand && (cand.type === "ramp" || cand.type === "booster")) rec = cand;
        }
        if (!rec) continue;
        if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot);
            Physics.addImpulse(m.body, d.x * 0.1 * k, 0.015 * k, d.z * 0.1 * k);
        } else {
            const d = boosterDir(rec.rot);
            Physics.addImpulse(m.body, d.x * 0.22 * k, 0.025 * k, d.z * 0.22 * k);
        }
    }
}

function spinSpinners(run, dt) {
    for (const key of run.spinners) {
        const rec = run.placed.get(key);
        if (!rec) continue;
        rec.anim.phase += dt * 0.004;
        const yaw = rotY(rec.anim.rot) + rec.anim.phase;
        const q = quatY(yaw);
        Physics.setRotation(rec.body, q.x, q.y, q.z, q.w);
        rec.node.rotationY = yaw;
    }
}

/** Contact kicks: boosters shove, spinners fling, bumpers and boosters clink. */
function handleContacts(run) {
    for (const ev of Physics.getContacts()) {
        if (ev.type !== "added") continue;
        let marble, other;
        if (run.marbleBodies.has(ev.body1)) { marble = ev.body1; other = ev.body2; }
        else if (run.marbleBodies.has(ev.body2)) { marble = ev.body2; other = ev.body1; }
        else continue;
        const key = run.bodyToCell.get(other);
        const rec = key && run.placed.get(key);
        if (!rec) continue;
        if (rec.type === "booster") {
            const d = boosterDir(rec.rot);
            Physics.addImpulse(marble, d.x * 0.38, 0.06, d.z * 0.38);
            run.play("clink");
        } else if (rec.type === "spinner") {
            const v = Physics.getVelocity(marble);
            if (v) Physics.addImpulse(marble, v.linear.x * 0.55, 0.12, v.linear.z * 0.55);
            run.play("clink");
        } else if (rec.type === "bumper") {
            run.play("clink");
        } else if (rec.type === "ramp") {
            const d = rampDownhill(rec.rot);
            Physics.addImpulse(marble, d.x * 0.1, 0.03, d.z * 0.1);
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
        const tf = Physics.getTransform(m.body);
        if (tf) out.push({ x: +tf.position.x.toFixed(3), y: +tf.position.y.toFixed(3), z: +tf.position.z.toFixed(3) });
    }
    return out;
}
