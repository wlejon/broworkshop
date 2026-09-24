// sim/worker.js — the simulation thread. Started by the page as
// `workerClient('sim/worker.js', { type: 'module' })`; see protocol.js for
// the messages.
//
// The worker owns the simulation state and steps it on its own timer at
// TICK_HZ. After each tick it copies the state into a free frame buffer from
// its pool and transfers that buffer to the page; the page draws it and
// transfers it back. The state itself never leaves the worker, so a frame the
// page is still drawing can never be stepped under it.

import { serveWorker, emit } from "/lib/kit/worker-rpc.js";
import { createSim } from "./physics.js";
import { STRIDE, POOL_SIZE, TICK_HZ, MAX_COUNT, entityBuffer } from "./protocol.js";

let sim = null;
let running = true;
let pool = [];                           // free frame buffers
let timer = 0;
let tick = 0;
let stepMs = 0;
let tps = 0, tpsTicks = 0, tpsSince = Date.now();

function freshPool() {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) pool.push(entityBuffer(sim.count));
}

function advance() {
    const t0 = Date.now();
    sim.step(1 / TICK_HZ);
    stepMs = Date.now() - t0;
    tick++;
    tpsTicks++;
    const now = Date.now();
    if (now - tpsSince >= 500) {
        tps = Math.round(tpsTicks * 1000 / (now - tpsSince));
        tpsTicks = 0;
        tpsSince = now;
    }
}

function sendFrame() {
    const buf = pool.pop();
    if (!buf) return;                    // page holds every buffer: skip, never allocate
    buf.set(sim.state.subarray(0, sim.count * STRIDE));
    emit('frame', { buffer: buf.buffer, count: sim.count, tick, tps, stepMs }, [buf.buffer]);
}

function loop() {
    if (running && sim) { advance(); sendFrame(); }
    timer = setTimeout(loop, 1000 / TICK_HZ);
}

const clampCount = (n) => Math.max(1, Math.min(MAX_COUNT, n | 0));

serveWorker({
    init(msg) {
        sim = createSim({ width: msg.width, height: msg.height, count: clampCount(msg.count),
                          mode: msg.mode, seed: msg.seed });
        freshPool();
        if (!timer) loop();
        return { type: 'ready', count: sim.count };
    },
    config(msg) {
        if (msg.mode) sim.mode = msg.mode;
        if (msg.speed != null) sim.speed = msg.speed;
        if (msg.count && clampCount(msg.count) !== sim.count) {
            sim.setCount(clampCount(msg.count));
            freshPool();                 // old-size buffers are dropped when they come back
        }
    },
    resize(msg) { sim.resize(msg.width, msg.height); },
    mouse(msg) { Object.assign(sim.mouse, { x: msg.x, y: msg.y, active: msg.active, force: msg.force }); },
    pause() { running = false; },
    resume() { running = true; },
    reset() { sim.seed(); if (!running) sendFrame(); },
    step() {
        advance();
        sendFrame();
        return { type: 'stepped', tick, stepMs };
    },
    recycle(msg) {
        if (msg.buffer.byteLength === sim.count * STRIDE * 4 && pool.length < POOL_SIZE) {
            pool.push(new Float32Array(msg.buffer));
        }
    },
});
