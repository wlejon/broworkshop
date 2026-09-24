// Clipmap Terrain: a procedural ridge-mountain height field for the clipmap's
// height pyramid (sums of rectified sinusoids; cheap and seamless).

/**
 * Heights in metres for a width x height grid whose texel 0 sits at world
 * (originX, originZ), metresPerCell apart: the same convention as
 * clipmap.setHeightLayer, so the returned array can be handed straight to it.
 * The seed phase-shifts every octave, so different seeds give different ranges.
 */
export function ridgeHeights({ width, height, metresPerCell, originX, originZ, seed = 42 }) {
    const data = new Float32Array(width * height);
    const phase = seed * 1.37;
    for (let z = 0; z < height; z++) {
        const nz = (originZ + z * metresPerCell) * 0.00035;
        for (let x = 0; x < width; x++) {
            const nx = (originX + x * metresPerCell) * 0.00035;
            let elevation = 0, amp = 1, freq = 1;
            for (let oct = 0; oct < 4; oct++) {
                const sx = nx * freq + oct * 12.34 + phase;
                const sz = nz * freq + oct * 56.78 - phase;
                const n = Math.abs(Math.sin(sx * 2.1) * Math.cos(sz * 2.1) + Math.cos(sx * 1.3 - sz * 1.7) * 0.5);
                const ridge = 1 - n;
                elevation += ridge * ridge * amp;
                amp *= 0.5;
                freq *= 2;
            }
            // Carve valley floors below sea level, sharpen the peaks.
            data[z * width + x] = Math.pow(elevation, 1.35) * 1600 - 200;
        }
    }
    return data;
}
