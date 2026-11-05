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

export const SUN_STEPS = 28;   // sun.bk SUN_STEPS
const SUN_REACH = 1800;        // metres: the farthest step (sun.bk sun_step_dist)
// The field drainage's grids (dendry_field.bk FIELD, FPOT, DRAIN_LEVELS).
const FIELD = 193, FPOT = 195, DRAIN_LEVELS = 4;

// net: the rivers' network (rivers.js), which the ground's height reads;
// kAnchors: planet.bk k_anchors.
export function createSunGrid(module, P, net, slices, kAnchors, radius) {
    const stepsKernel = module.kernel('k_sun_steps'), sunKernel = module.kernel('k_sun');
    const reachKernel = module.kernel('k_field_reaches'), pointKernel = module.kernel('k_field_points');
    const linkKernel = module.kernel('k_field_links'), partsKernel = module.kernel('k_sun_parts');
    // (One steps buffer, one anchor and one drainage field: background jobs
    // run in order.)
    const steps = bro.kernel.createBuffer(P * P * SUN_STEPS * 4);
    const anchor = createAnchors(kAnchors, 1, radius);
    const buffers = [bro.kernel.createBuffer(P * P * 4), bro.kernel.createBuffer(P * P * 4)];
    // The drainage under the grid and its steps (sun.bk k_field_*): level
    // 0's reaches, levels 1 on's segments, one level's potentials.
    const drain = {
        reaches: bro.kernel.createBuffer(FIELD * FIELD * 48),
        segs: bro.kernel.createBuffer(DRAIN_LEVELS * FIELD * FIELD * 32),
        pots: bro.kernel.createBuffer(FPOT * FPOT * 32),
    };
    // A slice's steps' drainage levels (sun.bk k_sun_parts), a vec4 each.
    const parts = bro.kernel.createBuffer(P * P * Math.ceil(SUN_STEPS / slices) * (DRAIN_LEVELS + 1) * 16);
    let front = 0;
    return {
        // The grid shown.
        get buffer() { return buffers[front]; },
        // The drainage of the grid produced last (its first step finds it),
        // which a field over the same anchor reads (trees.bk).
        drain,
        // The grid into the back buffer: `slices` steps of the march, then
        // the gather. plane: the face frame's a, e, f (nine numbers); the
        // grid's point 0 at plane (u0, v0), points delta apart.
        steps(plane, u0, v0, delta, toSun, octaves, seed) {
            const c = (P - 1) / 2 * delta, at = planeAnchor(plane, u0 + c, v0 + c);
            const args = [anchor.buffer, ...plane.slice(3), -c, -c, delta, ...toSun, radius, octaves, seed];
            // The drainage's square: the grid's farthest corner from its
            // centre, and the steps' reach past it.
            let far = 0;
            for (const [su, sv] of [[-c, -c], [c, -c], [-c, c], [c, c]]) {
                const p = [0, 1, 2].map((k) => at.base[k] + plane[3 + k] * su + plane[6 + k] * sv);
                const l = Math.hypot(...p), b = Math.hypot(...at.base);
                const cos = (p[0] * at.base[0] + p[1] * at.base[1] + p[2] * at.base[2]) / (l * b);
                far = Math.max(far, Math.acos(Math.min(1, cos)) * radius);
            }
            const half = far + SUN_REACH;
            const out = [];
            for (let s = 0; s < slices; s++) {
                const z0 = Math.floor(s * SUN_STEPS / slices), z1 = Math.floor((s + 1) * SUN_STEPS / slices);
                out.push(() => {
                    if (s === 0) {
                        anchor.set(0, at.base, at.dir);
                        anchor.write(1);
                        reachKernel.dispatch([FIELD, FIELD], drain.reaches, anchor.buffer, half, radius, net);
                        for (let level = 1; level <= DRAIN_LEVELS; level++) {
                            pointKernel.dispatch([FPOT, FPOT], drain.pots, drain.segs, drain.reaches, anchor.buffer, half,
                                                 radius, level, seed);
                            linkKernel.dispatch([FIELD, FIELD], drain.segs, drain.pots, anchor.buffer, half, radius, level, seed);
                        }
                    }
                    partsKernel.dispatch([P, P, (z1 - z0) * (DRAIN_LEVELS + 1)], parts, ...args, z0, drain.reaches, drain.segs);
                    stepsKernel.dispatch([P, P, z1 - z0], steps, ...args, z0, net, parts);
                });
            }
            const back = buffers[1 - front];
            out.push(() => sunKernel.dispatch([P, P], steps, back, ...args, net, drain.reaches, drain.segs, CLOUD_DETAIL_VAR));
            return out;
        },
        // Show the back buffer (record's, its job done); the buffer now shown.
        swap() {
            front = 1 - front;
            return buffers[front];
        },
    };
}
