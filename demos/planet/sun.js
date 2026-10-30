// The terrain's shadow on a grid of points (sun.bk): a P x P grid on the
// gnomonic plane of a cube face, how much of the sun's disc the ground at
// each point sees over the terrain, in `buffer` (y * P + x). jobs() returns
// its production as dispatches to spread over frames (the steps in slices,
// then the gather), so no frame takes it all.
export const SUN_STEPS = 28;   // ground.bk SUN_STEPS

// net: the rivers' network (rivers.js), which the ground's height reads.
export function createSunGrid(module, P, net, slices = 1) {
    const stepsKernel = module.kernel('k_sun_steps'), sunKernel = module.kernel('k_sun');
    const steps = bro.kernel.createBuffer(P * P * SUN_STEPS * 4);
    const buffer = bro.kernel.createBuffer(P * P * 4);
    return {
        buffer,
        // plane: the face frame's a, e, f (nine numbers); the grid's point 0
        // at plane (u0, v0), points delta apart.
        jobs(plane, u0, v0, delta, toSun, radius, octaves, seed) {
            const args = [...plane, u0, v0, delta, ...toSun, radius, octaves, seed];
            const out = [];
            for (let s = 0; s < slices; s++) {
                const z0 = Math.floor(s * SUN_STEPS / slices), z1 = Math.floor((s + 1) * SUN_STEPS / slices);
                out.push(() => stepsKernel.dispatch([P, P, z1 - z0], steps, ...args, z0, net));
            }
            out.push(() => sunKernel.dispatch([P, P], steps, buffer, ...args, net));
            return out;
        },
    };
}
