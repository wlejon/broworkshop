// A herd's cost: `count` creatures of one species in one batch (one rig
// dispatch, one instanced draw through the skin hook), as the planet would
// run them, going through a scenario's intent on a grid 2.5 m apart, seen
// whole by a camera that follows them, lit as the live view lights them
// (shadows on). Measured by perf.measure: the scene's GPU ms a frame, its
// passes, and the rig's kernel ms; plus the triangles drawn.

import { Batch } from "./batch.js";
import { INTENT } from "./contract.js";
import { groundEnv, intentTrack } from "./scenarios.js";
import { scenarioOf } from "./run.js";

const r2 = (x) => Math.round(x * 100) / 100;

export function herdCost(creature, { count = 50, scenario = 'trot', frames = 240, warm = 60, W = 1280, H = 720 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px`;
    document.body.append(canvas);
    const scene = canvas.getContext('scene');
    scene.setAmbient({ color: [0.85, 0.9, 1.0], intensity: 0.45 });
    scene.createLight({ type: 'directional', direction: [0.4, -0.8, 0.45], intensity: 2.4, castShadow: true });
    const ground = scene.createMesh({ mesh: Mesh.plane(400, 400, 1, 1), color: [0.3, 0.32, 0.28], roughness: 1, castsShadow: false });
    const batch = new Batch(creature, count, { scene, shadows: true });
    const sc = scenarioOf(creature, scenario);
    const dt = 1 / 60, steps = warm + frames + 4;
    batch.setGround(groundEnv(sc.ground));
    const side = Math.ceil(Math.sqrt(count));
    const tracks = [];
    for (let i = 0; i < count; i++) {
        batch.place(i, (i % side - (side - 1) / 2) * 2.5, Math.floor(i / side) * 3.0, 0);
        tracks.push(intentTrack(sc, dt, steps, i + 1));
    }
    let k = 0;
    const step = () => {
        for (let i = 0; i < count; i++) batch.setIntent(i, tracks[i].subarray(Math.min(k, steps - 1) * INTENT, (Math.min(k, steps - 1) + 1) * INTENT));
        batch.step(dt);
        k++;
        // The camera follows the herd's middle from behind and above.
        const z = k * dt * (sc.track.find((x) => x.speed)?.speed || 0);
        scene.setCamera({ fov: 50, near: 0.1, far: 300, position: [side * 2.5, 9, z - 8], target: [0, 0.7, z + side * 1.5], up: [0, 1, 0] });
    };
    for (let i = 0; i < warm; i++) { step(); advanceTime(16); }
    perf.settle({ maxFrames: 200 });
    const m = perf.measure({ frames, warm: 0, step, stepMs: 16 });
    const out = {
        creature: creature.label, count, scenario, frames, triangles: creature.body.triangles, herdTriangles: creature.body.triangles * count,
        vertices: creature.body.vertices ?? creature.body.positions.length / 3,
        gpu: { mean: r2(m.gpu.mean), median: r2(m.gpu.median), p90: r2(m.gpu.p90), max: r2(m.gpu.max) },
        kernels: { mean: r2(m.kernels.mean) }, passes: Object.fromEntries(Object.entries(m.passes || {}).map(([k2, v]) => [k2, r2(v)])),
        kernelsBy: Object.fromEntries(Object.entries(m.kernelsBy || {}).map(([k2, v]) => [k2, r2(v)])),
    };
    batch.destroy();
    ground.destroy?.();
    canvas.remove();
    return out;
}
