// sim/protocol.js — what the page and the worker agree on.
//
// Messages go through lib/kit/worker-rpc.js:
//   page -> worker requests (awaited):  init {width, height, count, mode} -> ready {count}
//                                       step (one tick while paused)       -> stepped {stepMs}
//   page -> worker posts (no reply):    config {mode?, count?, speed?}, resize {width, height},
//                                       mouse {x, y, active, force}, pause, resume, reset,
//                                       recycle {buffer} (hands a frame buffer back)
//   worker -> page events:              frame {buffer, count, tick, tps, stepMs}
//
// A frame is a Float32Array of STRIDE floats per entity, transferred (not
// copied) to the page, drawn, and transferred back with `recycle`. The worker
// keeps POOL_SIZE such buffers; when the page holds them all it skips a frame
// instead of allocating, so a slow page never makes the worker churn memory.

export const MODES = {
    boids: 'Boids flocking',
    particles: 'Elastic particles',
    gravity: 'N-body gravity',
};

/** Mouse forces: what the left / right / middle (or shift) button does. */
export const FORCES = { attract: 0, repel: 1, vortex: 2 };

export const STRIDE = 6;                 // floats per entity
export const X = 0, Y = 1, VX = 2, VY = 3, MASS = 4, HUE = 5;

export const POOL_SIZE = 3;              // frame buffers in circulation
export const TICK_HZ = 60;               // worker simulation rate
export const MAX_COUNT = 20000;

export function entityBuffer(count) {
    return new Float32Array(count * STRIDE);
}
