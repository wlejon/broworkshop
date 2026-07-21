// atlas.js — bake and hold the island's structural control field.
//
// The diffusion model is the art director: one elevation bake (30 m/cell) is the
// island's silhouette and everything downstream derives from it. M1 keeps the
// atlas minimal — elevation plus a smooth border-to-sea falloff so the tile's
// edges always submerge and the island floats in endless ocean (the clipmap
// clamps-to-edge beyond the tile, so a sea border = sea to the horizon).
//
// Regional climate scalars and the derived slope/moisture/biome layers land in
// M2; the shape here is built to grow into them.

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

// Build the resident atlas from a raw worldgen elevation result.
function buildAtlas(r, island) {
    const W = r.width, H = r.height;
    const src = r.data;                       // Float32Array, metres, row-major
    const elev = new Float32Array(W * H);
    const mpc = island.cellSize;

    // Border-to-sea falloff. dEdge is the fractional distance to the nearest of
    // the four edges (0 at the border, →0.5 at centre). Inside `edgeMargin` it
    // ramps the model elevation down to edgeDepth, so the coastline is the
    // model's where the model already meets the sea, and a clean submerging ring
    // everywhere else. The interior (the great majority) is untouched.
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

    // Centre the field on the world origin. Texel (col=x, row=z) sits at world
    // X = originX + x*mpc (W→E), Z = originZ + z*mpc (N→S).
    const originX = -(W - 1) * 0.5 * mpc;
    const originZ = -(H - 1) * 0.5 * mpc;

    function sampleHeight(x, z) {
        // bilinear world-metre sample of the base field (no procedural detail).
        const u = (x - originX) / mpc, v = (z - originZ) / mpc;
        let x0 = Math.floor(u), z0 = Math.floor(v);
        const tx = u - x0, tz = v - z0;
        const cx = (c) => c < 0 ? 0 : c > W - 1 ? W - 1 : c;
        const cz = (c) => c < 0 ? 0 : c > H - 1 ? H - 1 : c;
        const x1 = cx(x0 + 1), z1 = cz(z0 + 1); x0 = cx(x0); z0 = cz(z0);
        const a = elev[z0 * W + x0], b = elev[z0 * W + x1];
        const c = elev[z1 * W + x0], d = elev[z1 * W + x1];
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }

    return {
        elevation: elev, width: W, height: H,
        metresPerCell: mpc, cellSize: mpc,
        originX, originZ, seaLevel: island.seaLevel,
        min: mn, max: mx,
        sampleHeight,
    };
}

// Bake the atlas asynchronously (windowed apps must not block the frame on the
// multi-second model request). Calls cb(err, atlas).
export function bakeAtlasAsync(world, island, cb) {
    const { i0, j0, N } = island;
    world.elevation(i0, j0, i0 + N, j0 + N, {
        onDone:  (r) => { try { cb(null, buildAtlas(r, island)); } catch (e) { cb(e.message || String(e), null); } },
        onError: (m) => cb(m, null),
    });
}

// Blocking bake for headless tests / Workers.
export function bakeAtlasSync(world, island) {
    const r = world.elevationSync(island.i0, island.j0, island.i0 + island.N, island.j0 + island.N, { margin: 8 });
    return buildAtlas(r, island);
}
