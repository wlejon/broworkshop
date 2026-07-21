// atlas.js — bake and hold the island's structural control field.

import { classify } from './biome.js';
import { computeHydrology, computeCoastDistance } from './hydrology.js';

// The island location, discovered by surveying seed 17: a dramatic mountainous
// headland (~1180 m peak) with ocean on three sides. i = N→S rows, j = W→E cols;
// N native (30 m) cells per axis. Bakes in ~2-3 s.
export const DEFAULT_ISLAND = {
    seed:      17,
    i0:        -912,      // NW-corner native cell (N→S)
    j0:        -7120,     // NW-corner native cell (W→E)
    N:         640,       // native cells per axis (19.2 km)
    cellSize:  30,        // metres per native cell (30 m checkpoint)
    edgeMargin: 0.16,     // outer fraction of each axis that ramps down to sea
    edgeDepth: -160,      // metres the very border is forced to (guaranteed ocean)
    seaLevel:   0,        // model elevation is metres, sea at 0 m
};

// smoothstep, GLSL semantics.
function smoothstep(a, b, x) {
    if (a === b) return x < a ? 0 : 1;
    let t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
}

// Helper to sample a coarse channel bilinearly
function sampleCoarse(chanData, Wc, Hc, row, col, ci0, cj0) {
    const u = (col - cj0 * 256) / 256;
    const v = (row - ci0 * 256) / 256;

    let x0 = Math.floor(u), y0 = Math.floor(v);
    const tx = u - x0, ty = v - y0;

    const clampX = (x) => x < 0 ? 0 : x > Wc - 1 ? Wc - 1 : x;
    const clampY = (y) => y < 0 ? 0 : y > Hc - 1 ? Hc - 1 : y;

    const x1 = clampX(x0 + 1); x0 = clampX(x0);
    const y1 = clampY(y0 + 1); y0 = clampY(y0);

    const a = chanData[y0 * Wc + x0], b = chanData[y0 * Wc + x1];
    const c = chanData[y1 * Wc + x0], d = chanData[y1 * Wc + x1];

    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// Build the resident atlas from a raw worldgen elevation result.
function buildAtlas(rElev, rCoarse, island) {
    const W = rElev.width, H = rElev.height;
    const src = rElev.data;                       // Float32Array, metres, row-major
    const elev = new Float32Array(W * H);
    const mpc = island.cellSize;

    // Border-to-sea falloff.
    const m = island.edgeMargin, depth = island.edgeDepth;
    let mn = Infinity, mx = -Infinity;
    for (let z = 0; z < H; z++) {
        const fz = Math.min(z, H - 1 - z) / (H - 1);
        for (let x = 0; x < W; x++) {
            const fx = Math.min(x, W - 1 - x) / (W - 1);
            const mask = smoothstep(0, m, Math.min(fx, fz));
            const e = mask * src[z * W + x] + (1 - mask) * depth;
            elev[z * W + x] = e;
            if (e < mn) mn = e; if (e > mx) mx = e;
        }
    }

    // Centre the field on the world origin.
    const originX = -(W - 1) * 0.5 * mpc;
    const originZ = -(H - 1) * 0.5 * mpc;

    // Run Hydrology.
    const flow = computeHydrology(elev, W, H);
    const coastDist = computeCoastDistance(elev, W, H, mpc);

    // Compute slope and aspect.
    const slope = new Float32Array(W * H);
    const aspect = new Float32Array(W * H);
    for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
            const z0 = Math.max(0, z - 1), z1 = Math.min(H - 1, z + 1);
            const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1);
            const dx = (elev[z * W + x1] - elev[z * W + x0]) / ((x1 - x0) * mpc);
            const dz = (elev[z1 * W + x] - elev[z0 * W + x]) / ((z1 - z0) * mpc);
            slope[z * W + x] = Math.sqrt(dx * dx + dz * dz);
            aspect[z * W + x] = Math.atan2(dz, dx);
        }
    }

    // Extract coarse climate channels.
    const Wc = rCoarse.width, Hc = rCoarse.height;
    const iTemp = rCoarse.names.indexOf('temperature');
    const iPrecip = rCoarse.names.indexOf('precipitation');
    const iP5 = rCoarse.names.indexOf('p5');

    const getCoarseChannel = (c) => {
        const arr = new Float32Array(Wc * Hc);
        for (let i = 0; i < Wc * Hc; i++) {
            arr[i] = rCoarse.data[(c * Hc + Math.floor(i / Wc)) * Wc + (i % Wc)];
        }
        return arr;
    };
    const tempData = getCoarseChannel(iTemp);
    const precipData = getCoarseChannel(iPrecip);
    const p5Data = getCoarseChannel(iP5);

    // Sample regional climate scalars at the center of the coarse request.
    const cx = Math.floor(Wc / 2), cy = Math.floor(Hc / 2);
    const regionalTemp = tempData[cy * Wc + cx];
    const regionalPrecip = precipData[cy * Wc + cx];

    // Compute absolute NW coarse cell coordinate.
    const ci0 = Math.floor(island.i0 / 256);
    const cj0 = Math.floor(island.j0 / 256);

    // Interleave channels for the surface layer (R=biome, G=moisture, B=temperature).
    const surfaceData = new Float32Array(W * H * 3);
    const biomes = new Float32Array(W * H);

    for (let i = 0; i < W * H; i++) {
        const z = Math.floor(i / W);
        const x = i % W;

        const row = island.i0 + z;
        const col = island.j0 + x;

        const T_reg = sampleCoarse(tempData, Wc, Hc, row, col, ci0, cj0);
        const P_reg = sampleCoarse(precipData, Wc, Hc, row, col, ci0, cj0);

        // Apply temperature altitude lapse rate (-6.5C per 1000m)
        const localTemp = T_reg - 0.0065 * elev[i];

        // Orographic moisture effect (wind from the West)
        const windDir = Math.PI; // West
        const asp = aspect[i];
        const sl = slope[i];
        const orographicPrecip = P_reg * (1.0 + 0.5 * Math.max(0, -Math.cos(asp - windDir)) * sl);

        // Moisture from precipitation + drainage (log flow accumulation)
        const localFlow = flow[i];
        const localMoisture = orographicPrecip * (1.0 + 0.15 * Math.log(localFlow));

        const bId = classify(elev[i], localTemp, localMoisture);
        biomes[i] = bId;

        // Normalize for texture transfer:
        // Temp: -15..35C -> 0..1
        // Moisture: 0..3000mm/yr -> 0..1
        surfaceData[i * 3 + 0] = bId;
        surfaceData[i * 3 + 1] = Math.max(0, Math.min(1, localMoisture / 3000));
        surfaceData[i * 3 + 2] = Math.max(0, Math.min(1, (localTemp + 15) / 50));
    }

    function sampleHeight(x, z) {
        const u = (x - originX) / mpc, v = (z - originZ) / mpc;
        let x0 = Math.floor(u), z0 = Math.floor(v);
        const tx = u - x0, tz = v - z0;
        const clampX = (c) => c < 0 ? 0 : c > W - 1 ? W - 1 : c;
        const clampZ = (c) => c < 0 ? 0 : c > H - 1 ? H - 1 : c;
        const x1 = clampX(x0 + 1), z1 = clampZ(z0 + 1); x0 = clampX(x0); z0 = clampZ(z0);
        const a = elev[z0 * W + x0], b = elev[z0 * W + x1];
        const c = elev[z1 * W + x0], d = elev[z1 * W + x1];
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }

    return {
        elevation: elev, width: W, height: H,
        metresPerCell: mpc, cellSize: mpc,
        originX, originZ, seaLevel: island.seaLevel,
        min: mn, max: mx,
        flow, slope, aspect, coastDist, biomes,
        surfaceData,
        regionalTemp, regionalPrecip,
        sampleHeight,
    };
}

// Bake the atlas asynchronously.
export function bakeAtlasAsync(world, island, cb) {
    const { i0, j0, N } = island;
    world.elevation(i0, j0, i0 + N, j0 + N, {
        margin: 8,
        onDone: (rElev) => {
            const ci0 = Math.floor(i0 / 256);
            const cj0 = Math.floor(j0 / 256);
            const ci1 = Math.ceil((i0 + N) / 256);
            const cj1 = Math.ceil((j0 + N) / 256);

            world.stage('coarse', ci0, cj0, ci1, cj1, {
                onDone: (rCoarse) => {
                    try {
                        cb(null, buildAtlas(rElev, rCoarse, island));
                    } catch (e) {
                        cb(e.message || String(e), null);
                    }
                },
                onError: (m) => cb("coarse stage load failed: " + m, null),
            });
        },
        onError: (m) => cb("elevation load failed: " + m, null),
    });
}

// Blocking bake for headless tests.
export function bakeAtlasSync(world, island) {
    const { i0, j0, N } = island;
    const rElev = world.elevationSync(i0, j0, i0 + N, j0 + N, { margin: 8 });
    const ci0 = Math.floor(i0 / 256);
    const cj0 = Math.floor(j0 / 256);
    const ci1 = Math.ceil((i0 + N) / 256);
    const cj1 = Math.ceil((j0 + N) / 256);
    const rCoarse = world.stageSync('coarse', ci0, cj0, ci1, cj1);
    return buildAtlas(rElev, rCoarse, island);
}
