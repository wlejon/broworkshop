// A flock's cost and how it behaves: `count` creatures driven by the GPU
// brain (lab/flock.js) on their field and drawn as a crowd (lab/crowd.js),
// seen whole from above and to the side (view 'field') or from a person's
// eye at the herd's edge ('ground') or close by one of them ('close'), lit
// as the live view lights them. The report
// has how many each level drew and the triangles that makes.
// perf.measure gives the scene's
// GPU ms a frame, its passes and the kernels' ms; the telemetry read at the
// end says what the group is doing (gaits, speeds, the nearest-neighbour
// spacing and how many have a neighbour within 80 cm, how many are off the
// field); a screenshot shows it.

import { Flock } from "./flock.js";
import { TELE, T, GAIT_NAMES } from "./contract.js";
import { groundEnv } from "./scenarios.js";

const r2 = (x) => Math.round(x * 100) / 100;

export function flockCost(creature, { count = 200, behaviour = 'graze', frames = 240, warm = 600, shadows = true, view = 'field', cull = true, W = 1280, H = 720, shot = null } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px`;
    document.body.append(canvas);
    const scene = canvas.getContext('scene');
    scene.setAmbient({ color: [0.85, 0.9, 1.0], intensity: 0.45 });
    scene.createLight({ type: 'directional', direction: [0.4, -0.8, 0.45], intensity: 2.4, castShadow: shadows });
    const flock = new Flock(creature, count, { scene, shadows, behaviour, cull });
    flock.setGround(groundEnv({ kind: 'flat' }));
    const R = flock.radius;
    const ground = scene.createMesh({ mesh: Mesh.plane(R * 4, R * 4, 1, 1), color: [0.3, 0.32, 0.28], roughness: 1, castsShadow: false });
    // 'field': the whole field from above and to the side; 'ground': a
    // person's eye at the herd's edge (where mill's ring runs), looking
    // across the field.
    // 'close': 2.5 m from one creature at its head's height (for a deer's
    // size; nearer and lower for a smaller one), three quarters to its
    // front, once the flock has warmed (its full level and face).
    const cam = view === 'ground'
        ? { fov: 50, near: 0.1, far: R * 8, position: [R * 0.1, 1.6, -R * 0.6], target: [0, 0.8, 0], up: [0, 1, 0] }
        : { fov: 50, near: 0.1, far: R * 8, position: [R * 0.9, R * 0.75, -R * 1.25], target: [0, 0, 0], up: [0, 1, 0] };
    scene.setCamera(cam);
    const dt = 1 / 60;
    const step = () => { flock.step(dt / 2); flock.step(dt / 2); flock.draw(cam, H, W / H); };
    for (let i = 0; i < warm; i++) step();
    if (view === 'close') {
        // (Sized to the creature: a deer's 0.95 m height at 2.5 m.)
        const k = ((creature.def.scale && creature.def.scale.height) || 0.95) / 0.95;
        const t = flock.readTele(), x = t[T.POS], z = t[T.POS + 2], yaw = t[T.YAW] + 0.8;
        cam.near = 0.1 * Math.min(k, 1);
        cam.position = [x + Math.sin(yaw) * 2.5 * k, 1.3 * k, z + Math.cos(yaw) * 2.5 * k];
        cam.target = [x + Math.sin(yaw - 0.8) * 0.5 * k, 1.1 * k, z + Math.cos(yaw - 0.8) * 0.5 * k];
        scene.setCamera(cam);
    }
    advanceTime(16);
    perf.settle({ maxFrames: 200 });
    const m = perf.measure({ frames, warm: 0, step, stepMs: 16 });
    if (shot) screenshot(shot);

    const levels = flock.crowd.readCounts();
    const tele = flock.readTele();
    const gaits = {}, speeds = [];
    let off = 0, nearest = Infinity, nearSum = 0, close = 0;
    for (let i = 0; i < count; i++) {
        const o = i * TELE;
        const g = GAIT_NAMES[tele[o + T.GAIT]] || String(tele[o + T.GAIT]);
        gaits[g] = (gaits[g] || 0) + 1;
        speeds.push(tele[o + T.SPEED]);
        const x = tele[o + T.POS], z = tele[o + T.POS + 2];
        if (Math.hypot(x - flock.center[0], z - flock.center[1]) > R + 2) off++;
        let best = Infinity;
        for (let j = 0; j < count; j++) {
            if (j === i) continue;
            const d = Math.hypot(tele[j * TELE + T.POS] - x, tele[j * TELE + T.POS + 2] - z);
            if (d < best) best = d;
        }
        if (best < nearest) nearest = best;
        if (best < 0.8) close++;
        nearSum += best;
    }
    speeds.sort((a, b) => a - b);
    const out = {
        creature: creature.label, count, behaviour, view, frames, shadows, field: r2(R),
        levels: { drawn: levels, triangles: flock.crowd.levelTriangles, caps: flock.crowd.caps },
        triangles: levels.reduce((s, n, l) => s + n * flock.crowd.levelTriangles[l], 0),
        gpu: { mean: r2(m.gpu.mean), median: r2(m.gpu.median), p90: r2(m.gpu.p90), max: r2(m.gpu.max) },
        shadow: (({ shadowViews, shadowPagesDynamic, shadowDrawn }) => ({ shadowViews, shadowPagesDynamic, shadowDrawn }))(scene.cullStats() || {}),
        passes: Object.fromEntries(Object.entries(m.passes || {}).map(([k, v]) => [k, r2(v)])),
        kernelsBy: Object.fromEntries(Object.entries(m.kernelsBy || {}).map(([k, v]) => [k, r2(v)])),
        group: {
            gaits, speedMedian: r2(speeds[count >> 1]), speedMax: r2(speeds[count - 1]), offField: off,
            nearestMin: r2(nearest), nearestMean: r2(nearSum / count), within80cm: close,
        },
    };
    flock.destroy();
    ground.destroy?.();
    canvas.remove();
    return out;
}

// What a flock does over time, a row every `every` s (not drawn, not
// timed): its gaits, its speed (median and fastest), its height over the
// ground, and, while a threat is on, how far the threat is from the nearest
// creature and `away`: the mean, over those within 15 m of it, of the share
// of each one's speed that carries it straight away from the threat (1: all
// flee directly from it; 0: across; under 0: toward it).
export function flockTimeline(creature, { count = 200, behaviour = 'flee', seconds = 12, every = 0.5 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    document.body.append(canvas);
    const scene = canvas.getContext('scene');
    const flock = new Flock(creature, count, { scene, shadows: false, behaviour, cull: true });
    flock.setGround(groundEnv({ kind: 'flat' }));
    const dt = 1 / 120, rows = [];
    const n = Math.round(every / dt);
    for (let k = 0; k * dt < seconds; k++) {
        flock.step(dt);
        if ((k + 1) % n) continue;
        const tele = flock.readTele(), th = flock.threat;
        const gaits = {}, speeds = [];
        let hsum = 0, near = Infinity, away = 0, heard = 0;
        for (let i = 0; i < count; i++) {
            const o = i * TELE, sp = tele[o + T.SPEED], yaw = tele[o + T.YAW];
            const g = GAIT_NAMES[tele[o + T.GAIT]] || String(tele[o + T.GAIT]);
            gaits[g] = (gaits[g] || 0) + 1;
            speeds.push(sp);
            hsum += tele[o + T.HEIGHT];
            if (!th) continue;
            const dx = tele[o + T.POS] - th.x, dz = tele[o + T.POS + 2] - th.z, d = Math.hypot(dx, dz) || 1e-6;
            near = Math.min(near, d);
            if (d < 15 && sp > 0.05) { away += (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d; heard++; }
        }
        speeds.sort((a, b) => a - b);
        rows.push({ t: r2((k + 1) * dt), gaits, speedMedian: r2(speeds[count >> 1]), speedMax: r2(speeds[count - 1]), height: r2(hsum / count),
            threat: th ? r2(near) : null, away: th && heard ? r2(away / heard) : null });
    }
    flock.destroy();
    canvas.remove();
    return rows;
}
