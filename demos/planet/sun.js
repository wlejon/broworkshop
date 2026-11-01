// The terrain's shadow and the clouds' light on a grid of points (sun.bk): a
// P x P grid on the gnomonic plane of a cube face, at each point how much of
// the sun's disc the ground sees over the terrain, then what the clouds leave
// of the sun straight through, of it scattered down, and of the sky, in
// `buffer` (a word at y * P + x, 8 bits each from the lowest: GLSL's
// unpackUnorm4x8). Double-buffered: steps() is the grid's production into
// the back buffer, a step a frame beside the frames (stepped.js), and swap()
// shows it once they are done. The grid is anchored at its centre
// (anchors.js), found in the production's first step.
import { CLOUD_DETAIL_VAR } from "/app/clouds.js";
import { createAnchors, planeAnchor } from "/app/anchors.js";

export const SUN_STEPS = 28;   // ground.bk SUN_STEPS

// net: the rivers' network (rivers.js), which the ground's height reads;
// kAnchors: planet.bk k_anchors.
export function createSunGrid(module, P, net, slices, kAnchors, radius) {
    const stepsKernel = module.kernel('k_sun_steps'), sunKernel = module.kernel('k_sun');
    // (One steps buffer and one anchor: background jobs run in order.)
    const steps = bro.kernel.createBuffer(P * P * SUN_STEPS * 4);
    const anchor = createAnchors(kAnchors, 1, radius);
    const buffers = [bro.kernel.createBuffer(P * P * 4), bro.kernel.createBuffer(P * P * 4)];
    let front = 0;
    return {
        // The grid shown.
        get buffer() { return buffers[front]; },
        // The grid into the back buffer: `slices` steps of the march, then
        // the gather. plane: the face frame's a, e, f (nine numbers); the
        // grid's point 0 at plane (u0, v0), points delta apart.
        steps(plane, u0, v0, delta, toSun, octaves, seed) {
            const c = (P - 1) / 2 * delta, at = planeAnchor(plane, u0 + c, v0 + c);
            const args = [anchor.buffer, ...plane.slice(3), -c, -c, delta, ...toSun, radius, octaves, seed];
            const out = [];
            for (let s = 0; s < slices; s++) {
                const z0 = Math.floor(s * SUN_STEPS / slices), z1 = Math.floor((s + 1) * SUN_STEPS / slices);
                out.push(() => {
                    if (s === 0) {
                        anchor.set(0, at.base, at.dir);
                        anchor.write(1);
                    }
                    stepsKernel.dispatch([P, P, z1 - z0], steps, ...args, z0, net);
                });
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
