// The terrain's shadow and the clouds' light on a grid of points (sun.bk): a
// P x P grid on the gnomonic plane of a cube face, at each point how much of
// the sun's disc the ground sees over the terrain, then what the clouds leave
// of the sun straight through, of it scattered down, and of the sky, in
// `buffer` (a word at y * P + x, 8 bits each from the lowest: GLSL's
// unpackUnorm4x8). Double-buffered: steps() is the grid's production into
// the back buffer, a step a frame beside the frames (stepped.js), and swap()
// shows it once they are done.
import { CLOUD_DETAIL_VAR } from "/app/clouds.js";

export const SUN_STEPS = 28;   // ground.bk SUN_STEPS

// net: the rivers' network (rivers.js), which the ground's height reads.
export function createSunGrid(module, P, net, slices = 1) {
    const stepsKernel = module.kernel('k_sun_steps'), sunKernel = module.kernel('k_sun');
    // (One steps buffer: background jobs run in order.)
    const steps = bro.kernel.createBuffer(P * P * SUN_STEPS * 4);
    const buffers = [bro.kernel.createBuffer(P * P * 4), bro.kernel.createBuffer(P * P * 4)];
    let front = 0;
    return {
        // The grid shown.
        get buffer() { return buffers[front]; },
        // The grid into the back buffer: `slices` steps of the march, then
        // the gather. plane: the face frame's a, e, f (nine numbers); the
        // grid's point 0 at plane (u0, v0), points delta apart.
        steps(plane, u0, v0, delta, toSun, radius, octaves, seed) {
            const args = [...plane, u0, v0, delta, ...toSun, radius, octaves, seed];
            const out = [];
            for (let s = 0; s < slices; s++) {
                const z0 = Math.floor(s * SUN_STEPS / slices), z1 = Math.floor((s + 1) * SUN_STEPS / slices);
                out.push(() => stepsKernel.dispatch([P, P, z1 - z0], steps, ...args, z0, net));
            }
            const back = buffers[1 - front];
            out.push(() => sunKernel.dispatch([P, P], steps, back, ...args, net, CLOUD_DETAIL_VAR));
            return out;
        },
        // Show the back buffer (record's, its job done); the buffer now shown.
        swap() {
            front = 1 - front;
            return buffers[front];
        },
    };
}
