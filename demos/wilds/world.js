// wilds — a finite world kilometres across (4 km by default; `km=N` after
// the app dir, or WILDS_KM), ringed by mountains, its valleys and slopes
// planted with the forest demo's whole nursery (broadleaves, conifers,
// shrubs), meadows in the clearings, grass and herbs over all of it. It is
// the frame-rate test bed for bro.scene's flora at the scale of a real
// world: flown over on fixed routes at fixed heights and speeds, from
// standing on the ground to high over the ridges (bench.js measures them).
//
// Everything is worked out a grid at a time (FastNoise's SIMD grids, the
// grass field's and the forest cover's `grid` forms), so a 16 km^2 world
// boots in seconds:
//   a data grid every STEP m over the world (height, slope, meadows, the
//   treeline, where conifers grow), read bilinearly by the planting and
//   the flight;
//   the ground as TILE m tiles at STEP m, drawn near the eye, over one
//   coarse mesh of the whole world sunk a metre under them, and past the
//   world's edge a coarser land rising to the mountains round it;
//   the grass field over the whole world at FIELD_CELL m.
// main.js mounts the panel; bench.js and the tests import this module.

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, DAYLIGHT } from "/lib/kit/sky.js";
import * as nursery from "/lib/flora/nursery.js";

// `key=value` after the app dir, else WILDS_<KEY> in the environment.
function param(key, dflt) {
    const a = (bro.app.argv || []).find((s) => typeof s === 'string' && s.startsWith(key + '='));
    if (a) return a.slice(key.length + 1);
    const env = globalThis.process && process.env ? process.env['WILDS_' + key.toUpperCase()] : undefined;
    return env !== undefined && env !== '' ? env : dflt;
}

export const KM = Math.max(1, +param('km', 4));
export const HALF = KM * 500;                      // the world's half-size, metres
export const STEP = 2;                             // the data grid and the near ground, metres
export const N = Math.round(2 * HALF / STEP) + 1;  // data grid points a side
export const FIELD_CELL = Math.max(1, KM / 4);     // the grass field's texel (4001^2 at 4 km)
export const TILE = 250;                           // a near-ground tile, metres
export const FINE_REACH = 700;                     // near tiles drawn within this of the eye
const COARSE = 8;                                  // the whole world's ground under them
const BEYOND = 16000, BSTEP = 64;                  // the land round the world: half-size, spacing
export const PLANT_SCALE = 1.5;
export const GRASS_RANGE = 150;
export const HERB_RANGE = 24;
export const TREELINE = 260;                       // metres up: the trees thin out over it
export const SHADOW_DISTANCE = 1500;               // the sun's shadow reaches this far

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 60, 0], dist: 900, fov: 50, near: 0.1, far: 30000, rot: orbitRotation(Math.PI * 0.75, -0.35) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 12000 },
});
export const { scene } = vp;
// The forest demo's skies, with haze for a view tens of kilometres deep.
const PRESETS = {
    golden: Object.assign({}, DAYLIGHT.golden, { hdri: 'belfast_sunset_puresky', envIntensity: 0.35,
                                                  fog: { start: 1500, end: 16000, color: [0.86, 0.62, 0.46] } }),
    noon: Object.assign({}, DAYLIGHT.noon, { fog: { start: 2500, end: 24000, color: [0.66, 0.74, 0.82] } }),
};
export const sky = daylight(scene, { presets: PRESETS, order: ['golden', 'noon'], cascades: 3, atlas: 4096, pcf: 3,
    ground: [0.09, 0.12, 0.05] });
sky.sun.shadowDistance = SHADOW_DISTANCE;
scene.setMSAA(4);
vp.onFrame((dt) => sky.update(dt));

// --- noise, a grid at a time ----------------------------------------------------

const simplex = FastNoise.create('Simplex');
simplex.set('Feature Scale', 1);
const fractal = (type, octaves) => {
    const f = FastNoise.create(type);
    f.set('Source', simplex);
    f.set('Octaves', octaves);
    return f;
};
const fbm3 = fractal('FractalFBm', 3), fbm4 = fractal('FractalFBm', 4);
const ridged = fractal('FractalRidged', 3);
// noise at cols x rows points (x0 + i * step, z0 + j * step), `wave` metres a feature.
const noise = (n, wave, seed, x0, z0, step, cols, rows) =>
    n.genUniformGrid2D(x0 / wave, z0 / wave, cols, rows, step / wave, seed);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height (m) at cols x rows points (x0 + i * step, z0 + j * step):
 *  broad swells, hills, ridged mountains where a mask allows, a metre of
 *  swell underfoot, and past the world's edge the ground rising into the
 *  mountains round it. */
export function heights(x0, z0, step, cols, rows) {
    const cont = noise(fbm3, 2600, 11, x0, z0, step, cols, rows);
    const mask = noise(fbm3, 3200, 12, x0, z0, step, cols, rows);
    const ridge = noise(ridged, 1900, 13, x0, z0, step, cols, rows);
    const hill = noise(fbm4, 380, 14, x0, z0, step, cols, rows);
    const swell = noise(fbm4, 45, 15, x0, z0, step, cols, rows);
    const out = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
        const z = z0 + j * step, az = z < 0 ? -z : z;
        for (let i = 0; i < cols; i++) {
            const k = j * cols + i, x = x0 + i * step, ax = x < 0 ? -x : x;
            let t = (mask[k] + 0.05) / 0.5;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const m = t * t * (3 - 2 * t);
            let r = ridge[k] * 0.5 + 0.5;
            r = r < 0 ? 0 : r > 1 ? 1 : r;
            const peak = Math.pow(r, 1.7);
            let h = 55 * cont[k] + 260 * m * peak + 24 * hill[k] * (1 - 0.5 * m) + 1.4 * swell[k];
            // Past the edge: up into a range of mountains.
            const edge = (ax > az ? ax : az) - HALF;
            if (edge > 0) {
                t = edge / 4000;
                t = t > 1 ? 1 : t;
                h += t * t * (3 - 2 * t) * (250 + 120 * cont[k] + 350 * peak);
            }
            out[k] = h;
        }
    }
    return out;
}

// Bilinear reads of the data grid (N x N every STEP m from -HALF).
function sampler(A) {
    const top = N - 1.0001;
    return (x, z) => {
        let u = (x + HALF) / STEP, v = (z + HALF) / STEP;
        u = u < 0 ? 0 : u > top ? top : u;
        v = v < 0 ? 0 : v > top ? top : v;
        const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * N + i;
        const a = A[k] + (A[k + 1] - A[k]) * fu, b = A[k + N] + (A[k + N + 1] - A[k + N]) * fu;
        return a + (b - a) * fv;
    };
}
/** A data grid read at cols x rows points (x0 + i * cell, z0 + j * cell). */
function resample(A, x0, z0, cell, cols, rows) {
    const out = new Float32Array(cols * rows), top = N - 1.0001;
    const iu = new Int32Array(cols), fu = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
        let u = (x0 + i * cell + HALF) / STEP;
        u = u < 0 ? 0 : u > top ? top : u;
        iu[i] = u | 0;
        fu[i] = u - iu[i];
    }
    for (let j = 0; j < rows; j++) {
        let v = (z0 + j * cell + HALF) / STEP;
        v = v < 0 ? 0 : v > top ? top : v;
        const jv = v | 0, fv = v - jv, r0 = jv * N, r1 = r0 + N, o = j * cols;
        for (let i = 0; i < cols; i++) {
            const k = iu[i], f = fu[i];
            const a = A[r0 + k] + (A[r0 + k + 1] - A[r0 + k]) * f;
            const b = A[r1 + k] + (A[r1 + k + 1] - A[r1 + k]) * f;
            out[o + i] = a + (b - a) * fv;
        }
    }
    return out;
}

// --- the land: what grows where, every STEP m -----------------------------------

// world.data: H heights, ny the ground normal's y, meadow (1 deep in a
// meadow), trees (the chance a tree stands), conifer (the share of them
// that are conifers), rock (bare: steep or high), dry (sun-dried), shrubs.
export const world = { data: null, at: {}, parts: [], tiles: [], coarse: null, beyond: null, grass: null, cover: null,
                       bootMs: {}, stats: {} };

function terrain() {
    const x0 = -HALF, n = N;
    const H = heights(x0, x0, STEP, n, n);
    const clearing = noise(fbm3, 700, 21, x0, x0, STEP, n, n);
    const ragged = noise(fbm4, 80, 22, x0, x0, STEP, n, n);
    const patch = noise(fbm3, 900, 23, x0, x0, STEP, n, n);
    const fine = noise(fbm3, 60, 24, x0, x0, STEP, n, n);
    const ny = new Float32Array(n * n), meadow = new Float32Array(n * n), trees = new Float32Array(n * n);
    const conifer = new Float32Array(n * n), rock = new Float32Array(n * n), dry = new Float32Array(n * n);
    const shrubs = new Float32Array(n * n);
    const sm = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
    for (let j = 0; j < n; j++) {
        const ja = j > 0 ? j - 1 : j, jb = j < n - 1 ? j + 1 : j;
        for (let i = 0; i < n; i++) {
            const k = j * n + i, ia = i > 0 ? i - 1 : i, ib = i < n - 1 ? i + 1 : i;
            const gx = (H[j * n + ib] - H[j * n + ia]) / ((ib - ia) * STEP);
            const gz = (H[jb * n + i] - H[ja * n + i]) / ((jb - ja) * STEP);
            const y = 1 / Math.sqrt(1 + gx * gx + gz * gz), h = H[k];
            ny[k] = y;
            // Meadows: clearings with ragged edges, more of them low down.
            const md = sm(0.18, 0.34, clearing[k] + 0.12 * ragged[k] - 0.15 * sm(40, 160, h));
            meadow[k] = md;
            const bare = Math.max(sm(0.8, 0.66, y), sm(TREELINE + 90, TREELINE + 170, h));
            rock[k] = bare;
            const up = sm(TREELINE + 40, TREELINE - 40, h) * sm(0.7, 0.8, y);
            trees[k] = (1 - md) * up * (0.82 + 0.18 * fine[k]);
            conifer[k] = Math.min(0.95, Math.max(0, 0.08 + 0.8 * sm(30, 200, h) + 0.7 * patch[k]));
            dry[k] = Math.min(1, 0.3 * sm(120, 360, h) + 0.6 * (1 - y) + 0.15 * sm(0.2, 0.6, fine[k])) * (1 - 0.4 * md);
            // Shrubs: along the forest's edges, in patches under it, a few
            // out in the meadows.
            const t = trees[k];
            shrubs[k] = Math.min(1, 1.6 * t * (1 - t) + t * 0.12 * sm(0.1, 0.5, patch[k]) + 0.02 * md) * (1 - bare);
        }
    }
    world.data = { H, ny, meadow, trees, conifer, rock, dry, shrubs };
    for (const key of Object.keys(world.data)) world.at[key] = sampler(world.data[key]);
}

/** Ground height (m) at world x, z (bilinear in the data grid; the ground
 *  the meshes draw). `groundHeight.grid` the same over a grid at once. */
export function groundHeight(x, z) { return world.at.H(x, z); }
groundHeight.grid = (x0, z0, cell, cols, rows) => resample(world.data.H, x0, z0, cell, cols, rows);

// --- the ground ------------------------------------------------------------------

const GROUND = { color: [1, 1, 1], metallic: 0, roughness: 1.0, receivesShadow: true };

// A ground mesh of n x n points every `step` m centred on (cx, cz), from
// heights h (row-major); its vertex colour the grass's data where the
// field does not reach (grass density, dryness, canopy, herb density) from
// `colour(x, z, out4)`.
function groundNode(h, n, step, cx, cz, colour) {
    const m = Mesh.heightmapGrid(h, n, n, step);
    const pos = m.positions, c = new Float32Array(m.vertexCount * 4), q = [0, 0, 0, 0];
    for (let v = 0; v < m.vertexCount; v++) {
        colour(pos[v * 3] + cx, pos[v * 3 + 2] + cz, q);
        c[v * 4] = q[0]; c[v * 4 + 1] = q[1]; c[v * 4 + 2] = q[2]; c[v * 4 + 3] = q[3];
    }
    m.colors = c;
    return scene.createMesh(Object.assign({ data: m, position: [cx, 0, cz] }, GROUND));
}

function ground(coverS, canopyS) {
    const D = world.data, n = N;
    // The grid point nearest (x, z): the tiles' and the coarse mesh's
    // vertices lie on it.
    const colour = (x, z, q) => {
        const i = Math.round((x + HALF) / STEP), j = Math.round((z + HALF) / STEP);
        const k = (j < 0 ? 0 : j >= n ? n - 1 : j) * n + (i < 0 ? 0 : i >= n ? n - 1 : i);
        q[0] = coverS[k] * (1 - D.rock[k]); q[1] = D.dry[k]; q[2] = canopyS[k]; q[3] = 0.6 * (1 - D.rock[k]);
    };
    const T = Math.round(2 * HALF / TILE), tn = Math.round(TILE / STEP) + 1;
    for (let tj = 0; tj < T; tj++) for (let ti = 0; ti < T; ti++) {
        const h = new Float32Array(tn * tn), oi = ti * (tn - 1), oj = tj * (tn - 1);
        let lo = Infinity;
        for (let j = 0; j < tn; j++) for (let i = 0; i < tn; i++) {
            const y = D.H[(oj + j) * n + oi + i];
            h[j * tn + i] = y;
            if (y < lo) lo = y;
        }
        const cx = -HALF + (ti + 0.5) * TILE, cz = -HALF + (tj + 0.5) * TILE;
        world.tiles.push({ node: groundNode(h, tn, STEP, cx, cz, colour), x0: cx - TILE / 2, z0: cz - TILE / 2,
                           x1: cx + TILE / 2, z1: cz + TILE / 2, lo, on: true });
    }
    // The whole world under them, a metre down.
    const s = COARSE / STEP, cn = Math.round(2 * HALF / COARSE) + 1, ch = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) ch[j * cn + i] = D.H[j * s * n + i * s] - 1.0;
    world.coarse = groundNode(ch, cn, COARSE, 0, 0, colour);
    // Round it, out to the mountains: the same heights, sunk out of sight
    // inside the world (it meets the world's ground at the edge).
    const bn = Math.round(2 * BEYOND / BSTEP) + 1, bh = heights(-BEYOND, -BEYOND, BSTEP, bn, bn);
    for (let j = 0; j < bn; j++) for (let i = 0; i < bn; i++) {
        const x = -BEYOND + i * BSTEP, z = -BEYOND + j * BSTEP;
        if (Math.max(Math.abs(x), Math.abs(z)) < HALF - BSTEP) bh[j * bn + i] -= 40;
        else bh[j * bn + i] -= 3;
    }
    world.beyond = groundNode(bh, bn, BSTEP, 0, 0, (x, z, q) => {
        const y = groundHeight(x, z);
        q[0] = 0.9; q[1] = Math.min(1, 0.15 + 0.4 * smooth(300, 900, y)); q[2] = 0; q[3] = 0.4;
    });
}

/** Near tiles on within FINE_REACH of the eye (the coarse ground everywhere). */
export function updateTiles(eye) {
    const r2 = FINE_REACH * FINE_REACH;
    for (const t of world.tiles) {
        const dx = eye[0] < t.x0 ? t.x0 - eye[0] : eye[0] > t.x1 ? eye[0] - t.x1 : 0;
        const dz = eye[2] < t.z0 ? t.z0 - eye[2] : eye[2] > t.z1 ? eye[2] - t.z1 : 0;
        const dy = Math.max(0, eye[1] - t.lo - 400);
        const on = dx * dx + dz * dz + dy * dy < r2;
        if (on !== t.on) { t.on = on; t.node.visible = on; }
    }
}

// --- the forest and the grass ----------------------------------------------------

// The herbs: broflora's presets, as the forest demo's.
export const HERBS = ['bracken', 'ladyfern', 'woodsorrel', 'bluebell', 'foxglove', 'nettle',
                      'daisy', 'poppy', 'yarrow', 'clover', 'plantain'];

function plant(emits) {
    const at = world.at, area = [-HALF, -HALF, HALF, HALF];
    const trees = bro.flora.plantForest(emits.slice(0, 3), {
        area, spacing: 6.5, jitter: 0.42, seed: 0x7ee5,
        ground: groundHeight, density: at.trees, sink: 0.12,
        scale: [[PLANT_SCALE * 0.85, PLANT_SCALE * 1.2], [0.7, 0.95], [0.75, 1.0]],
        mix: (x, z) => { const c = at.conifer(x, z); return [1 - c, 0.82 * c, 0.18 * c]; },
    });
    const shrubs = bro.flora.plantForest(emits[3], {
        area, spacing: 4.5, jitter: 0.45, seed: 0x5b0b,
        ground: groundHeight, density: at.shrubs, scale: [0.9, 1.3], sink: 0.05,
    });
    return [...trees, shrubs];
}

// The grass's inputs over its field, a grid at a time (and a point at a
// time, for anything that asks so).
function grassInputs(cover) {
    const at = world.at, D = world.data;
    let last = null;   // the field's dryness, shared by tall and the herbs
    const dryGrid = (x0, z0, cell, cols, rows) => {
        const patch = noise(fbm3, 9, 31, x0, z0, cell, cols, rows), base = resample(D.dry, x0, z0, cell, cols, rows);
        for (let k = 0; k < patch.length; k++) {
            let t = (patch[k] + 0.3) / 0.8;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const v = 0.45 * t * t * (3 - 2 * t) + base[k];
            patch[k] = v > 1 ? 1 : v;
        }
        last = { x0, z0, cell, cols, rows, dry: patch };
        return patch;
    };
    const dryOf = (x0, z0, cell, cols, rows) =>
        last && last.x0 === x0 && last.z0 === z0 && last.cell === cell && last.cols === cols && last.rows === rows
            ? last.dry : dryGrid(x0, z0, cell, cols, rows);
    let rock = null;   // the field's bare ground, shared by the grass and the herbs
    const rockOf = (x0, z0, cell, cols, rows) => {
        if (!(rock && rock.x0 === x0 && rock.z0 === z0 && rock.cell === cell && rock.cols === cols && rock.rows === rows))
            rock = { x0, z0, cell, cols, rows, v: resample(D.rock, x0, z0, cell, cols, rows) };
        return rock.v;
    };
    const dry = (x, z) => Math.min(1, 0.45 * smooth(-0.3, 0.5, fbm3.genSingle2D(x / 9, z / 9, 31)) + at.dry(x, z));
    dry.grid = dryGrid;
    const density = (x, z) => cover(x, z) * (1 - at.rock(x, z));
    density.grid = (x0, z0, cell, cols, rows) => {
        const c = cover.grid(x0, z0, cell, cols, rows), r = rockOf(x0, z0, cell, cols, rows);
        for (let k = 0; k < c.length; k++) c[k] *= 1 - r[k];
        return c;
    };
    const tall = (x, z) => 1.1 - 0.4 * dry(x, z);
    tall.grid = (x0, z0, cell, cols, rows) => {
        const d = dryOf(x0, z0, cell, cols, rows), out = new Float32Array(d.length);
        for (let k = 0; k < d.length; k++) out[k] = 1.1 - 0.4 * d[k];
        return out;
    };
    const herbs = (x, z, y, canopy) =>
        0.8 * (0.75 + 0.25 * fbm3.genSingle2D(x / 25, z / 25, 32)) * (1 - 0.5 * dry(x, z)) * (1 - 0.3 * canopy * canopy) *
        (1 - at.rock(x, z));
    herbs.grid = (x0, z0, cell, cols, rows, ys, canopy) => {
        const p = noise(fbm3, 25, 32, x0, z0, cell, cols, rows), d = dryOf(x0, z0, cell, cols, rows);
        const r = rockOf(x0, z0, cell, cols, rows);
        for (let k = 0; k < p.length; k++) {
            const c = canopy ? canopy[k] : 0;
            p[k] = 0.8 * (0.75 + 0.25 * p[k]) * (1 - 0.5 * d[k]) * (1 - 0.3 * c * c) * (1 - r[k]);
        }
        return p;
    };
    return { dry, density, tall, herbs };
}

/** Every forest node: the tier, the level of detail; the stats summed. */
export function setTier(t) { for (const p of world.parts) p.node.setForestTier(t); }
export function setLod(lod) { for (const p of world.parts) p.node.setForestLod(lod); }
export function forestStats() {
    let sum = null;
    for (const p of world.parts) {
        const s = p.node.forestStats();
        if (!s) continue;
        if (!sum) { sum = JSON.parse(JSON.stringify(s)); continue; }
        for (const k of ['leaves', 'clumps', 'crowns']) sum.trees[k] += s.trees[k];
        for (const k of ['culled', 'leaves', 'vertices', 'shadowVertices', 'entries', 'draws', 'treeCount', 'specimenCount',
                         'unforced', 'shadowUnforced'])
            sum[k] += s[k];
    }
    return sum;
}

// Wall-clock ms: headless's performance.now rides the virtual clock.
export const wallNow = () => (globalThis.perf && perf.now ? perf.now() : performance.now());

function build() {
    const ms = world.bootMs;
    let t = wallNow();
    const lap = (k) => { const n = wallNow(); ms[k] = n - t; t = n; };
    const { world: flora, grow } = nursery.growNursery();
    world.flora = flora;
    world.grow = grow;
    lap('grow');
    terrain();
    lap('terrain');
    const emits = nursery.emitParts(flora);
    lap('emit');
    const trees = plant(emits);
    lap('plant');
    world.parts = emits.map((emit, k) => ({
        name: nursery.PARTS[k], emit, trees: trees[k],
        node: scene.createForest(nursery.forestNodeOptions(k, emit, trees[k])),
    }));
    lap('forest');
    const cover = bro.flora.forestCover(emits, { instances: trees, floor: 0.25, closed: 4 });
    world.cover = cover;
    const coverS = cover.grid(-HALF, -HALF, STEP, N, N), canopyS = cover.canopy.grid(-HALF, -HALF, STEP, N, N);
    lap('cover');
    ground(coverS, canopyS);
    lap('ground');
    const g = grassInputs(cover);
    world.grassOpts = {
        ground: groundHeight,
        area: [-HALF, -HALF, HALF, HALF],
        cell: FIELD_CELL,
        dry: g.dry,
        density: g.density,
        floor: cover.canopy,
        herbs: { species: HERBS, density: g.herbs, range: HERB_RANGE },
        tall: g.tall,
        range: GRASS_RANGE,
        turf: [...world.tiles.map((x) => x.node), world.coarse, world.beyond],
        castsShadow: true,
    };
    world.grass = scene.createGrass(world.grassOpts);
    lap('grass');
    world.stats = { trees: trees.reduce((a, x) => a + x.length / 8, 0),
                    byPart: Object.fromEntries(world.parts.map((p) => [p.name, p.trees.length / 8])),
                    tiles: world.tiles.length };
}

// --- wind ---------------------------------------------------------------------------

export const WINDS = {
    still: { label: 'Still', wind: { strength: 0, speed: 0, gust: 0 } },
    breeze: { label: 'Breeze', wind: { direction: [1, 0, 0.3], strength: 0.05, frequency: 1.1, speed: 2.5, gust: 1 } },
    gusty: { label: 'Gusty', wind: { direction: [1, 0, 0.3], strength: 0.12, frequency: 1.4, speed: 4.5, gust: 1.6 } },
};
export function setWind(key) {
    world.wind = key;
    scene.setWind(WINDS[key].wind);
}

// --- the routes -----------------------------------------------------------------------

// Every route flies one loop, a figure of eight over the world (through its
// valleys, over ridges and meadows), from its own starting point, at a
// height over the ground and a speed of its own; `vista` stands on the
// world's highest point and turns. `agl` is the height over the highest
// ground near the path (so a high route clears the ridges as it nears
// them), `speed` m/s, `pitch` the look below level (radians).
export const ROUTES = {
    orbit:   { label: 'High (600 m)', agl: 600, speed: 90, pitch: -0.4, u0: 0.0 },
    cruise:  { label: 'Cruise (180 m)', agl: 180, speed: 55, pitch: -0.2, u0: 1.1 },
    treetop: { label: 'Treetops (45 m)', agl: 45, speed: 30, pitch: -0.1, u0: 2.3 },
    skim:    { label: 'Skimming (25 m)', agl: 25, speed: 18, pitch: -0.05, u0: 3.6 },
    walk:    { label: 'On foot', agl: 1.7, speed: 4, pitch: -0.03, u0: 4.9 },
    vista:   { label: 'Mountain view', vista: true, turn: 0.12, pitch: -0.08 },
};
export const SPEEDS = { 0.25: 'x0.25', 1: 'x1', 2: 'x2', 4: 'x4' };

const LOOP = (u) => [0.62 * HALF * Math.sin(u), 0.5 * HALF * Math.sin(2 * u + 0.5)];
const PATH_STEP = 5;
// The loop by distance along it: points every PATH_STEP m, and under them
// the ground's highest within `reach` m (built per route height).
const path = { pts: null, len: 0, ground: new Map() };
function buildPath() {
    const pts = [];
    let p = LOOP(0), len = 0;
    pts.push(p);
    // Fine steps in u, a point each PATH_STEP m.
    const du = 1e-5 * 2000 / HALF;
    let carry = 0;
    for (let u = du; u <= Math.PI * 2; u += du) {
        const q = LOOP(u), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        carry += d;
        len += d;
        p = q;
        if (carry >= PATH_STEP) { pts.push(q); carry -= PATH_STEP; }
    }
    path.pts = pts;
    path.len = pts.length * PATH_STEP;
}
// The ground under the path at a height `agl`: the highest within a reach
// that grows with the height, smoothed so the flight eases over it.
function pathGround(agl) {
    const key = agl;
    if (path.ground.has(key)) return path.ground.get(key);
    const pts = path.pts, n = pts.length, g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = groundHeight(pts[i][0], pts[i][1]);
    if (agl < 5) { path.ground.set(key, g); return g; }
    const w = Math.max(2, Math.round(Math.max(40, 3 * agl) / PATH_STEP));
    const hi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let m = -1e9;
        for (let d = -w; d <= w; d++) m = Math.max(m, g[(i + d + n) % n]);
        hi[i] = m;
    }
    // Two box passes of the same width: a smooth rise and fall.
    let a = hi;
    for (let pass = 0; pass < 2; pass++) {
        const b = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let s = 0;
            for (let d = -w; d <= w; d++) s += a[(i + d + n) % n];
            b[i] = s / (2 * w + 1);
        }
        a = b;
    }
    // Never under the ground itself plus the height's least share.
    for (let i = 0; i < n; i++) a[i] = Math.max(a[i], g[i] + 0.5 * agl);
    path.ground.set(key, a);
    return a;
}
const lerpAt = (arr, s) => {
    const n = arr.length, f = s / PATH_STEP, i = Math.floor(f), t = f - i;
    const a = arr[((i % n) + n) % n], b = arr[(((i + 1) % n) + n) % n];
    return Array.isArray(a) ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : a + (b - a) * t;
};

let peak = null;
function highestPoint() {
    if (peak) return peak;
    const D = world.data;
    let best = -1e9, bk = 0;
    for (let k = 0; k < D.H.length; k++) if (D.H[k] > best) { best = D.H[k]; bk = k; }
    peak = [-HALF + (bk % N) * STEP, best, -HALF + Math.floor(bk / N) * STEP];
    return peak;
}

/** Route `key`'s eye and look-at point `t` seconds in (at its own speed). */
export function routeAt(key, t) {
    const r = ROUTES[key];
    if (r.vista) {
        const [px, py, pz] = highestPoint(), yaw = r.turn * t;
        const eye = [px, py + 3, pz];
        return { eye, look: [px + Math.cos(yaw) * 100, py + 3 + Math.tan(r.pitch) * 100, pz + Math.sin(yaw) * 100] };
    }
    const g = pathGround(r.agl);
    const s = (r.u0 / (Math.PI * 2)) * path.len + r.speed * t;
    const p = lerpAt(path.pts, s), q = lerpAt(path.pts, s + 30);
    const y = lerpAt(g, s) + r.agl;
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
    const ahead = 100;
    return { eye: [p[0], y, p[1]], look: [p[0] + dx / l * ahead, y + Math.tan(r.pitch) * ahead, p[1] + dz / l * ahead] };
}

export const flight = { on: true, route: 'cruise', t: 0, speed: 1 };
/** Fly route `key` from time t (s). */
export function fly(key, t) {
    flight.on = true;
    flight.route = key;
    flight.t = t || 0;
}
/** Stop flying, the orbit camera taking over the view. */
export function land() {
    if (!flight.on) return;
    const { eye, look } = routeAt(flight.route, flight.t);
    flight.on = false;
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    vp.reframe(look, dist, { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / dist) });
}
vp.onFrame((dt) => { if (flight.on) flight.t += dt * flight.speed; });
vp.onView((view) => {
    if (flight.on) {
        const f = routeAt(flight.route, flight.t);
        view.position = f.eye;
        view.target = f.look;
        view.up = [0, 1, 0];
    }
    if (view.position) updateTiles(view.position);
});

// --- boot -----------------------------------------------------------------------------

sky.apply('golden');
setWind('breeze');
const t0 = wallNow();
build();
buildPath();
world.bootMs.total = wallNow() - t0;
console.log(`wilds: ${KM} km, ${world.stats.trees.toLocaleString()} trees (` +
            Object.entries(world.stats.byPart).map(([k, v]) => `${k} ${v}`).join(', ') + `); boot ms: ` +
            Object.entries(world.bootMs).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
