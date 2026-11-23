// lib/city/traffic_render.js — the city's traffic: simulated in a worker
// (traffic_worker.js), drawn here as one pair of instanced nodes a body type
// (car_mesh.js): the cars within NEAR metres cast shadows, the rest to
// `range` do not. One frame request is in flight at a time; each answer
// replaces the instances.

import { carMesh, CAR_TYPES } from "./car_mesh.js";
import { trafficGraph, edgeDensity } from "./traffic.js";

const NEAR = 120;

export async function createTrafficRenderer(scene, graph, density, src, opts = {}) {
    const range = opts.range ?? 1500;
    const names = Object.keys(CAR_TYPES);
    const worker = new Worker(new URL('./traffic_worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => console.error('traffic worker: ' + (e.message ?? e));
    const ready = new Promise((resolve) => {
        worker.onmessage = (ev) => { if (ev.data.ready) resolve(ev.data.ready); };
    });
    worker.postMessage({ init: { graph: trafficGraph(graph), count: opts.count ?? 12000, seed: opts.seed ?? 7, edgeDensity: edgeDensity(graph, density), names } });
    const info = await ready;

    const nodes = [];
    for (const [ti, n] of names.entries()) {
        const mesh = carMesh(n);
        for (const near of [true, false]) {
            const node = scene.createInstancedMesh({
                name: `city_cars_${n}_${near ? 'near' : 'far'}`, mesh, capacity: Math.max(1, info.typeCounts[ti]),
                instances: new Float32Array(0), color: [1, 1, 1], vertexColorTint: true,
                castsShadow: near, receivesShadow: true,
            });
            node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
            await node.setShaderAsync({ module: src, file: 'lib/city/car.bk', uniforms: { night: 0, pad0: 0, pad1: 0, pad2: 0 } });
            nodes.push(node);
        }
    }

    let busy = false, acc = 0, drawn = 0, wantStats = false;
    const stats = { time: 0, stepMs: 0, poseMs: 0, moving: 0 };
    worker.onmessage = (ev) => {
        const m = ev.data;
        if (!m.bufs) return;
        busy = false;
        drawn = 0;
        m.bufs.forEach((b, i) => { nodes[i].setInstances(b); drawn += b.length / 16; });
        Object.assign(stats, m.stats);
    };
    return {
        nodes, stats,
        get drawn() { return drawn; },
        cars: info.cars,
        /** Advance by dt and ask for the cars about `eye`; the answer lands when the worker sends it. */
        update(dt, eye, fwd) {
            acc += dt;
            if (busy || !Number.isFinite(eye[0] + eye[1] + eye[2])) return;
            busy = true;
            worker.postMessage({ frame: { dt: acc, eye: [eye[0], eye[1], eye[2]], fwd: [fwd[0], fwd[1], fwd[2]], range, nearR: NEAR, stats: wantStats } });
            acc = 0;
        },
        set wantStats(v) { wantStats = v; },
        setNight(v) { for (const nd of nodes) nd.setShaderUniform('night', v); },
        terminate() { worker.terminate(); },
    };
}
