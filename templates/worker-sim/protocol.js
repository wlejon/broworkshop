// protocol.js — Shared binary buffer layout schemas and message type constants for Worker Sim

// Message Type Constants
export const MSG_INIT = 1;
export const MSG_CONFIG = 2;
export const MSG_MOUSE = 3;
export const MSG_FRAME = 4;
export const MSG_RECYCLE_BUFFER = 5;
export const MSG_PAUSE = 6;
export const MSG_RESUME = 7;
export const MSG_STEP = 8;
export const MSG_RESET = 9;

// Physics Modes
export const MODE_BOIDS = 'boids';
export const MODE_PARTICLES = 'particles';
export const MODE_GRAVITY = 'gravity';

// Binary Buffer Entity Layout (Float32Array)
// Each entity occupies ENT_STRIDE floats (6 * 4 = 24 bytes)
export const ENT_STRIDE = 6;
export const OFFSET_X = 0;
export const OFFSET_Y = 1;
export const OFFSET_VX = 2;
export const OFFSET_VY = 3;
export const OFFSET_MASS = 4;
export const OFFSET_COLOR = 5; // Encoded Hue / Color value [0.0 - 360.0]

export function createEntityBuffer(count) {
    return new Float32Array(count * ENT_STRIDE);
}
