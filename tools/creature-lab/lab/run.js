// Running a scenario: one creature stepped at a fixed time step on the GPU
// (the rig as the planet runs it), every step's pose and telemetry copied
// into a history on the GPU and read back once at the end. Deterministic:
// the same creature and scenario give the same bits.

import { Batch } from "./batch.js";
import { INTENT, TELE } from "./contract.js";
import { ROWS } from "./skeleton.js";
import { groundEnv, intentTrack, scenariosFor } from "./scenarios.js";
import { readApp } from "./creature.js";

export const DT = 1 / 120;

let recorder = null;
function recordKernels() {
    if (!recorder) {
        const m = bro.kernel.compile(readApp('lab/record.bk'), { file: 'lab/record.bk' });
        recorder = { pose: m.kernel('k_record_pose'), tele: m.kernel('k_record_tele') };
    }
    return recorder;
}

let groundMod = null;
// Ground heights on the CPU from the same creature::ground the rig calls.
export function groundHeights(env, xz) {
    if (!groundMod) {
        groundMod = bro.kernel.compile(`
            from creature::ground import height;
            @kernel @grid(1)
            fn k_heights(g: grid<1>, env: read_store<f32, 1>, xz: read_store<f32, 1>, out: write_store<f32, 1>) {
                let i = g.x();
                out[i] = height(env, xz[2 * i], xz[2 * i + 1]);
            }`, { file: 'heights.bk', modules: { 'creature::ground': readApp('lab/ground.bk') } }).kernel('k_heights');
    }
    const n = xz.length / 2, out = new Float32Array(n);
    if (n) groundMod.run(n, env, xz instanceof Float32Array ? xz : new Float32Array(xz), out);
    return out;
}

// The terrain's heights without the obstacles on it (what a body rides over).
export function terrainHeights(env, xz) {
    const e = Float32Array.from(env);
    e[8] = 0;
    return groundHeights(e, xz);
}

// The obstacles in a ground record, as boxes in the world: a log's two
// ends (x0, z0) and (x1, z1) on the terrain at y0, and its height h.
export function obstaclesOf(env) {
    if (!env || env.length < 13 || !(env[8] > 0)) return [];
    const h = env[8], ax = [Math.sin(env[11]), Math.cos(env[11])], half = env[12] / 2;
    const y0 = terrainHeights(env, new Float32Array([env[9], env[10]]))[0];
    return [{ kind: 'log', h, y0, x: env[9], z: env[10], yaw: env[11], length: env[12],
        x0: env[9] - ax[0] * half, z0: env[10] - ax[1] * half, x1: env[9] + ax[0] * half, z1: env[10] + ax[1] * half }];
}

export function scenarioOf(creature, name) {
    const all = scenariosFor(creature);
    const sc = all[name];
    if (!sc) throw new Error(`no scenario '${name}' (have ${Object.keys(all).join(', ')})`);
    return { name, ...sc };
}

// Run `scenario` (a name or object) for `creature`: a recording of every step.
export function runScenario(creature, scenario, opts = {}) {
    const t0 = Date.now();
    const sc = typeof scenario === 'string' ? scenarioOf(creature, scenario) : scenario;
    const dt = opts.dt || DT;
    const steps = Math.round(sc.duration / dt);
    const nb = creature.skel.count;
    const batch = new Batch(creature, 1);
    const env = groundEnv(sc.ground);
    batch.setGround(env);
    const start = sc.start || {};
    const sp = start.pos || [0, 0];
    batch.place(0, sp[0], sp[1], ((start.yaw || 0) * Math.PI) / 180);
    const intents = intentTrack(sc, dt, steps, opts.seed || 1);
    const nPose = nb * 3, nTele = TELE;
    const histPose = bro.kernel.createBuffer(steps * nPose * 16);
    const histTele = bro.kernel.createBuffer(steps * nTele * 4);
    const rec = recordKernels();
    for (let k = 0; k < steps; k++) {
        batch.setIntent(0, intents.subarray(k * INTENT, (k + 1) * INTENT));
        batch.step(dt);
        rec.pose.dispatch(nPose, batch.poseBuf, histPose, k, nPose);
        rec.tele.dispatch(nTele, batch.teleBuf, histTele, k, nTele);
    }
    const pose = histPose.read(new Float32Array(steps * nb * ROWS));
    const tele = histTele.read(new Float32Array(steps * TELE));
    histPose.destroy(); histTele.destroy();
    batch.destroy();
    return {
        creature, scenario: sc, dt, steps, env, intents, pose, tele,
        poseStride: nb * ROWS, wallMs: Date.now() - t0,
    };
}
