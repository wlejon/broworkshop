// Planet: an Earth-radius world drawn from a bro.tiles cube-sphere cache.
//
// The ground is one height function (ground.bk) evaluated per tile on the
// GPU in f64. Each tile's cells are written relative to the tile's center,
// and every tile is drawn camera-relative: the scene's camera sits at the
// origin and each tile instance is placed at (tile center - camera), both in
// doubles on the CPU, so nothing ever holds a planet-sized f32.
import { boot } from "/lib/kit/app.js";
import { bindControl, logMap } from "/lib/kit/params.js";
import { GROUND_LIGHT, createClouds } from "/app/clouds.js";
import { createGrass, grassFloorBk } from "/app/grass.js";
import { createTrees, treeShadowBk } from "/app/trees.js";
import { createRivers } from "/app/rivers.js";

boot();

const fs = require('fs');
const RADIUS = 6371000;
const TILE = 32;            // cells along a tile's drawn edge
const BORDER = 2;           // cells beyond it: the skirts' bottoms, and the detail layer's gradients at the edge
const CELLS = TILE + 2 * BORDER;
const DETAIL = 2;           // detail texels along a cell's edge (planet.bk's detail layer)
const TEXELS = CELLS * DETAIL;
const HZ = CELLS / 2;        // horizon points along a tile's edge, every other cell (planet.bk's horizon layer)
const HZ_GRID = TILE + 2 * 16 - 1;   // the heights a tile's horizons march through, along an edge (planet.bk HZ_MARGIN 16)
const CAPACITY = 4096;
const SEED = 7;
const BASE_WAVELENGTH = 2400000;   // ground.bk's first octave
const DETAIL_PERIOD = 64;          // metres; the ground shader's fine detail repeats over it
const SWELL_PERIOD = 1024;         // metres; and its long waves
const WAVE_CLOCK = 1024;           // seconds the sea's waves repeat over

// The sea's waves, a wind sea at about 7 m/s: from 256 m to half a metre,
// six a halving (each somewhere in its sixth: whole ratios between them
// would tile into a lattice), each a sinusoid of the shader's periodic
// coordinates (a whole number of waves along each axis of the period) in a
// random direction, and its frequency the deep-water ω^2 = g k made a whole number
// over WAVE_CLOCK. Their slopes share Cox and Munk's mean square slope for
// that wind (0.003 + 0.00512 U), equally a halving above the peak (the
// saturation range: elevation ~ k^-3) and falling off past it as
// Pierson-Moskowitz does; what is shorter than the last is WAVE_RESIDUAL.
const WAVES = (() => {
    const total = 0.003 + 0.00512 * 7, residual = 0.3 * total, peak = 60;
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const list = [];
    for (let i = 0; i < 54; i++) {
        const lambda = 256 * 2 ** (-(i + rnd()) / 6);
        const period = lambda > 12 ? SWELL_PERIOD : DETAIL_PERIOD;
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
        const n = [r * Math.cos(a), r * Math.sin(a), z].map((c) => Math.round(c * period / lambda));
        const k = 2 * Math.PI * Math.hypot(...n) / period;
        if (k === 0) continue;
        const omega = Math.round(Math.sqrt(9.81 * k) * WAVE_CLOCK / (2 * Math.PI)) * 2 * Math.PI / WAVE_CLOCK;
        list.push({ n, period, k, omega, shape: Math.exp(-1.25 * (2 * Math.PI / k / peak) ** 2) });
    }
    const sum = list.reduce((s, w) => s + w.shape, 0);
    // A sinusoid of slope amplitude s has mean square slope s^2 / 2.
    for (const w of list) w.slope = Math.sqrt(2 * (total - residual) * w.shape / sum);
    let tail = 0;
    for (let i = list.length - 1; i >= 0; i--) { tail += list[i].slope ** 2 / 2; list[i].tail = tail; }
    // Rivers and lakes are sheltered: no fetch for waves longer than a few
    // metres, and a breeze's ripples (Cox and Munk at 2 m/s, a mean square
    // slope of 0.0132) where the sea has its wind sea. They take the waves
    // from `fresh` on, 4 m and shorter, scaled with the residual to that.
    const fresh = list.findIndex((w) => 2 * Math.PI / w.k <= 4);
    const freshScale = Math.sqrt((0.003 + 0.00512 * 2) / (list[fresh].tail + residual));
    return { list, residual, swell: list.filter((w) => w.period === SWELL_PERIOD).length, fresh, freshScale };
})();
const glslFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const MODULES = { 'planet::ground': readApp('ground.bk'), 'planet::rivers': readApp('rivers.bk'),
                  'planet::clouds': readApp('clouds.bk'), tiles: bro.tiles.module };
const mod = bro.kernel.compile(readApp('planet.bk'), { file: 'planet.bk', modules: MODULES });
const rivers = createRivers(bro.kernel.compile(readApp('riverbuild.bk'), { file: 'riverbuild.bk', modules: MODULES }), RADIUS, SEED);
const kTile = mod.kernel('k_tile');
const kHeight = mod.kernel('k_height');
const kRange = mod.kernel('k_range');
const kDetailHeight = mod.kernel('k_detail_height');
const kDetail = mod.kernel('k_detail');
const kHorizonHeights = mod.kernel('k_horizon_heights');
const kHorizon = mod.kernel('k_horizon');

// The octaves a tile's cells can carry: down to a wavelength of 2.5 cells
// (the tile kernels take theirs from ground.bk octaves_for, the same).
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
const MAX_LEVEL = 22;
// The finest octaves anything draws: a colour is the mean over them.
const TRUTH = octavesFor(RADIUS * Math.PI / 2 / 2 ** MAX_LEVEL);

const MAX_HEIGHT = 9000;
// The most tiles a batch holds; the engine paces batches by the frames
// (they run beside them), the nearest error first, so motion keeps its
// frame rate and the ground nearest the eye still sharpens first.
const PRODUCE_PER_UPDATE = 24;
// k_tile's per-tile height gather for k_range (planet.bk), zeroed between
// batches by k_range itself.
const span = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 2 * 4);
span.write(new Int32Array(PRODUCE_PER_UPDATE * 2));
// The batch's texel mean heights, k_detail_height to k_detail.
const texelHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * TEXELS * TEXELS * 4);
// The batch's horizon heights, k_horizon_heights to k_horizon.
const horizonHeights = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * HZ_GRID * HZ_GRID * 4);

const canvas = document.querySelector('#stage');
const scene = canvas.getContext('scene');
scene.setToneMap({ mode: 'aces' });
// The sun above the air, in lux; the atmosphere dims and reddens it, lights
// the sky and the haze, and the exposure meters the light at the eye.
// The sun turns about the planet's axis (y) with the hour: noon is the
// direction it starts in.
const NOON = [-0.55, -0.35, -0.75];
const sun = scene.createLight({ type: 'directional', direction: NOON, color: [1, 1, 1], intensity: 128000 });
let sunHour = 12;
function setHour(hour) {
    sunHour = hour;
    const a = (hour - 12) / 24 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    sun.direction = [NOON[0] * c + NOON[2] * s, NOON[1], -NOON[0] * s + NOON[2] * c];
}
scene.setExposure({ mode: 'auto', meter: 'incident' });
// Water mirrors its banks: screen-space reflections out to 600 m (the
// engine weighs them by Fresnel at the angle the water is seen at and skips
// rough ground).
scene.setSSR({ enabled: true, maxDistance: 600, steps: 64, thickness: 20 });
// The planet's center moves with the camera (the scene is camera-relative):
// frame() sets it. A clear day's haze; the ground's average albedo lights
// the air from below.
const atmosphere = { planetRadius: RADIUS, turbidity: 10, groundAlbedo: [0.08, 0.1, 0.1], planetCenter: [0, -RADIUS, 0] };

// ── The tile cache ──────────────────────────────────────────────────────────

let cache = null;
// `pixelsPerTexel`: how large a detail texel may project, what the ground
// shades at; a tile's vertices are DETAIL texels apart.
function makeCache(pixelsPerTexel) {
    const pixelsPerCell = pixelsPerTexel * DETAIL;
    cache = bro.tiles.createCache({
        domain: { type: 'cubeSphere', radius: RADIUS, center: [0, 0, 0] },
        tileSize: TILE, border: BORDER, capacity: CAPACITY, maxLevel: MAX_LEVEL,
        minHeight: 0, maxHeight: MAX_HEIGHT, pixelsPerCell, producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, detail: DETAIL * DETAIL * 8, horizon: 16 },
        ranges: true,
        // The whole batch in five dispatches: the GPU fills up on the
        // batch's cells together, where a tile's own were a few warps.
        produce(batch) {
            const grid = [CELLS, CELLS, batch.count], pos = this.layer('position');
            kTile.dispatch(grid, batch.table, pos, span, RADIUS, BORDER, 1 / TILE, TRUTH, SEED, rivers.net);
            kHorizonHeights.dispatch([HZ_GRID, HZ_GRID, batch.count], batch.table, horizonHeights, RADIUS, 1 / TILE, SEED, rivers.net);
            kHorizon.dispatch([HZ, HZ, batch.count], batch.table, horizonHeights, this.layer('horizon'), HZ_GRID, RADIUS, BORDER, 1 / TILE);
            const texels = [TEXELS, TEXELS, batch.count];
            kDetailHeight.dispatch(texels, batch.table, texelHeights, RADIUS, BORDER, 1 / TILE, DETAIL, SEED, rivers.net);
            kDetail.dispatch(texels, batch.table, texelHeights, this.layer('detail'), RADIUS, BORDER, 1 / TILE, DETAIL, TRUTH, SEED, rivers.net);
            kRange.dispatch([batch.count], batch.table, span, this.ranges, 1 / TILE, MAX_HEIGHT);
        },
    });
    if (ground) {
        ground.setShaderTexture('pos', { buffer: cache.layer('position'), width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'float32' });
        ground.setShaderBuffer('det', cache.layer('detail'));
        ground.setShaderBuffer('hz', cache.layer('horizon'));
        ground.setShaderBuffer('tiles', cache.drawList);
    }
}

// ── The drawn tiles: one instanced patch ────────────────────────────────────

// A (TILE+1)^2 vertex grid, x/z = the cell it reads, plus a skirt along the
// four edges (y = 1) that drops below the surface, out under the neighbour,
// to hide cracks between tiles.
function patchMesh() {
    const N = TILE + 1, pos = [], idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.push(i, 0, j);
    for (let j = 0; j < TILE; j++)
        for (let i = 0; i < TILE; i++) {
            const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
            idx.push(a, b, d, a, d, c);
        }
    const edges = [[], [], [], []];
    for (let k = 0; k < N; k++) {
        edges[0].push([k, 0]); edges[1].push([TILE, k]); edges[2].push([TILE - k, TILE]); edges[3].push([0, TILE - k]);
    }
    for (const e of edges) {
        const base = pos.length / 3;
        for (const [i, j] of e) pos.push(i, 1, j);
        for (let k = 0; k + 1 < e.length; k++) {
            const t0 = e[k][1] * N + e[k][0], t1 = e[k + 1][1] * N + e[k + 1][0];
            idx.push(t0, base + k, t1, t1, base + k, base + k + 1);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

// The light the ground sees at a vertex (the ground's vertex shader; the
// fragment interpolates it): what it sees changes over metres to kilometres
// and its vertices stand a few pixels apart (a tile's cells, DETAIL px), so
// at the vertices it costs a sixteenth of what every pixel did, the same to
// the eye. light: x the sun's share seen (its disc over the horizons, under
// the clouds and the drawn trees), y the sky's (GTAO over the horizons,
// under the clouds), z the clouds' shadow, which the slopes around share, w
// the sun the clouds scatter down shadowless (clouds.bk cloud_light's y);
// bent: how the sky's mean direction turns from the normal n.
//
// The horizons, read bilinearly at the horizon grid's point hz of tile
// `slot` (planet.bk's horizon layer, a point every other cell), with the
// grid's axes tu, tv. The sun: the share of its disc (0.53 degrees) above
// the horizon toward it. The sky: GTAO's cosine-weighted visibility
// (Jimenez et al. 2016) over four slices through the up axis, each bounded
// by the horizons on its two sides and taken about the normal's projection
// on it, and the mean direction of the sky seen. The clouds' shadow
// (clouds.js) at a footprint of w metres, and the sky they hide overhead:
// under a deck the blue sky is gone and the light is the grey the deck
// scatters down. Among drawn trees, their shadows (trees.js treeShadowGlsl).
const groundHookBk = `module hook;
import scene;
import mesh;
import custom;
import tiles;

struct Params {
    cam_hi: vec3<f32>,
    cam_lo: vec3<f32>,
    to_sun: vec3<f32>,
    time: f32,
    trees_far: f32,
    cloud_w0: f32,
    grass_a: vec3<f32>,
    grass_e: vec3<f32>,
    grass_f: vec3<f32>,
    grass_uv: vec3<f32>,
    tree_o_hi: vec3<f32>,
    tree_o_lo: vec3<f32>,
    tree_lattice: vec3<f32>,
    tree_a: vec3<f32>,
    tree_e: vec3<f32>,
    tree_f: vec3<f32>,
    tree_uv: vec3<f32>,
}
@binding(4, 0) var params: uniform<Params>;
@binding(4, 1) var pos: texture2d_array<vec4<f32>>;
@binding(4, 2) var cloud_ground: texture2d_array<vec4<f32>>;
@binding(4, 14) var tiles: read_buffer<vec4<i32>>;
@binding(4, 15) var det: read_buffer<u32>;
@binding(4, 16) var hz: read_buffer<vec4<u32>>;
@binding(4, 17) var grass_field: read_buffer<f32>;
@binding(4, 18) var tree_field: read_buffer<f32>;
@binding(4, 19) var cloud_lookup: read_buffer<vec4<i32>>;

const GROUND_PI: f32 = 3.14159265;
const TREE_CROWNS: f32 = 0.55;
const TREE_TINT: vec3<f32> = vec3<f32>(0.22, 0.24, 0.33);
const VARY_LUM: f32 = 0.11;      // ground.bk VARY_LUM
const PERLIN_VAR: f32 = 0.0728;  // ground.bk PERLIN_VAR
const RELIEF: f32 = 0.08;        // slope per octave, per unit of the noise's gradient
const ROCK_LUM: f32 = 1.8;
const ROCK_RELIEF: f32 = 3.0;
const WAVE_RESIDUAL: f32 = ${glslFloat(WAVES.residual)};
const WAVE_FRESH_SCALE: f32 = ${glslFloat(WAVES.freshScale)};

const WAVE_K: array<vec4<f32>, ${WAVES.list.length}> = [
    ${WAVES.list.map((w) =>
        `vec4<f32>(${w.n.map((c) => glslFloat(c * 2 * Math.PI / w.period)).join(', ')}, ${glslFloat(Math.PI / 2 / w.k)})`).join(',\n    ')}
];
const WAVE_F: array<vec4<f32>, ${WAVES.list.length}> = [
    ${WAVES.list.map((w) =>
        `vec4<f32>(${[w.omega, w.tail, w.slope / w.k, w.slope * w.slope / 2].map(glslFloat).join(', ')})`).join(',\n    ')}
];

// What the clouds leave of the light at the ground point g (about the
// planet's centre) over a footprint of w metres, from clouds.js's ground
// light cache (clouds.bk k_cloud_ground): the sun straight through (x),
// scattered down (y), and the sky's (z). Between the two tile levels whose
// cells bracket w, as mips blend, each the finest ready tile holding g at
// that level or coarser; clear sky before any is ready.
fn cloud_ground_at(t: tiles::Tile, p: tiles::Point) -> vec3<f32> {
    return cloud_ground.sample_lod(custom::linear,
        tiles::atlas_uvw(t, p, ${GROUND_LIGHT.tile}, ${GROUND_LIGHT.border}, ${GROUND_LIGHT.atlas}), 0.0).xyz;
}
fn cloud_light_at(g: vec3<f32>, w: f32) -> vec3<f32> {
    let p = tiles::cube_point(normalize(g));
    let uv = vec2<f32>(p.u, p.v) * 2.0 - 1.0;
    let stretch = sqrt(1.0 + max(uv.x * uv.x, uv.y * uv.y)) / (1.0 + dot(uv, uv));
    let l = tiles::level_for(w, params.cloud_w0 * stretch, ${GROUND_LIGHT.levels});
    let k = min(l as i32, ${GROUND_LIGHT.levels - 1});
    let fine = tiles::locate(cloud_lookup, p, k + 1);
    if (fine.slot < 0) {
        return vec3<f32>(1.0, 0.0, 1.0);
    }
    var c: vec3<f32> = cloud_ground_at(fine, p);
    if (fine.level == k + 1) {
        var coarse: tiles::Tile = tiles::parent_of(fine);
        if (coarse.slot < 0) {
            coarse = tiles::locate(cloud_lookup, p, k);
        }
        if (coarse.slot >= 0) {
            c = mix(cloud_ground_at(coarse, p), c, l - (k as f32));
        }
    }
    return c;
}
${treeShadowBk}
${grassFloorBk}

fn vec4_at(v: vec4<f32>, i: i32) -> f32 {
    return i == 0 ? v.x : (i == 1 ? v.y : (i == 2 ? v.z : v.w));
}

fn pos_at(slot: i32, x: i32, y: i32) -> vec4<f32> {
    let cell = slot & 3;
    return pos.fetch(vec3<i32>((cell & 1) * ${CELLS} + x, (cell >> 1) * ${CELLS} + y, slot >> 2), 0);
}

// Point p of tile slot's horizon grid: the sines of its horizon's
// elevation along the grid's 8 directions. Directions 0-3 in lo, 4-7 in
// hi: its four words are one 16-byte load.
struct Horizon {
    lo: vec4<f32>,
    hi: vec4<f32>,
}
fn horizon_point(slot: i32, p_in: vec2<i32>) -> Horizon {
    let p = clamp(p_in, vec2<i32>(0), vec2<i32>(${HZ - 1}));
    let w = hz[((slot * ${HZ} + p.y) * ${HZ} + p.x) * 4];
    let lo = vec4<f32>(unpack_unorm2x16(w.x), unpack_unorm2x16(w.y)) * 2.0 - vec4<f32>(1.0);
    let hi = vec4<f32>(unpack_unorm2x16(w.z), unpack_unorm2x16(w.w)) * 2.0 - vec4<f32>(1.0);
    return Horizon { lo: lo, hi: hi };
}
fn horizon_at(h: Horizon, k: i32) -> f32 {
    return k < 4 ? vec4_at(h.lo, k) : vec4_at(h.hi, k - 4);
}

// acos to 7e-5 rad (Abramowitz and Stegun 4.4.45).
fn fast_acos(x: f32) -> f32 {
    let a = abs(x);
    let r = sqrt(max(1.0 - a, 0.0)) * (1.5707288 + a * (-0.2121144 + a * (0.0742610 - 0.0187293 * a)));
    return x < 0.0 ? GROUND_PI - r : r;
}

struct GroundLight {
    light: vec4<f32>,
    bent: vec3<f32>,
}
fn ground_light(slot: i32, hz_coord: vec2<f32>, tu: vec3<f32>, tv: vec3<f32>, up: vec3<f32>,
                n: vec3<f32>, rel: vec3<f32>, w: f32) -> GroundLight {
    let to_sun = params.to_sun;
    let fl = floor(hz_coord);
    let f = hz_coord - fl;
    let p = vec2<i32>(fl.x as i32, fl.y as i32);
    let ha = horizon_point(slot, p);
    let hb = horizon_point(slot, p + vec2<i32>(1, 0));
    let hc = horizon_point(slot, p + vec2<i32>(0, 1));
    let hd = horizon_point(slot, p + vec2<i32>(1, 1));
    let sl = clamp(mix(mix(ha.lo, hb.lo, f.x), mix(hc.lo, hd.lo, f.x), f.y), vec4<f32>(-1.0), vec4<f32>(1.0));
    let sh = clamp(mix(mix(ha.hi, hb.hi, f.x), mix(hc.hi, hd.hi, f.x), f.y), vec4<f32>(-1.0), vec4<f32>(1.0));
    // The grid's axes on the tangent plane: direction k is
    // cos * gu + sin * gv. The sun's azimuth is taken in those axes.
    let gu = tu - up * dot(tu, up);
    let gv = tv - up * dot(tv, up);
    let uu = dot(gu, gu);
    let uv = dot(gu, gv);
    let vv = dot(gv, gv);
    let su = dot(to_sun, gu);
    let sv = dot(to_sun, gv);
    let fk = mod(atan2(uu * sv - uv * su, vv * su - uv * sv) / (GROUND_PI * 0.25), 8.0);
    let k0 = (fk as i32) & 7;
    // Each point's share of the disc, blended: across a ridge's horizon
    // jump, blended horizons would step from point to point.
    let k1 = (k0 + 1) & 7;
    let fa = fk - floor(fk);
    // In sines, not angles: across the disc an elevation's step is its
    // sine's over the cosine.
    let sun = clamp(dot(to_sun, up), -1.0, 1.0);
    let corner = vec4<f32>(
        mix(horizon_at(ha, k0), horizon_at(ha, k1), fa),
        mix(horizon_at(hb, k0), horizon_at(hb, k1), fa),
        mix(horizon_at(hc, k0), horizon_at(hc, k1), fa),
        mix(horizon_at(hd, k0), horizon_at(hd, k1), fa),
    );
    let lit = clamp((vec4<f32>(sun) - corner) / (0.0093 * max(sqrt(1.0 - sun * sun), 0.02)) + vec4<f32>(0.5), vec4<f32>(0.0), vec4<f32>(1.0));
    var sun_seen = mix(mix(lit.x, lit.y, f.x), mix(lit.z, lit.w, f.x), f.y);

    var visible: f32 = 0.0;
    var mean = vec3<f32>(0.0);
    // Without trigonometry: the horizons are kept as the cosines of their
    // zenith angles (the sines of their elevations, as stored), clamped
    // to the normal's hemisphere there as a max of cosines, and each
    // angle's double-angle terms are taken from its cosine and sine.
    for (var s: i32 = 0; s < 4; s += 1) {
        let az = s == 0 ? vec2<f32>(1.0, 0.0) : (s == 1 ? vec2<f32>(0.70710678, 0.70710678) : (s == 2 ? vec2<f32>(0.0, 1.0) : vec2<f32>(-0.70710678, 0.70710678)));
        let t = normalize(gu * az.x + gv * az.y);
        let across = cross(up, t);
        let np = n - across * dot(n, across);
        let len = length(np);
        let il = 1.0 / max(len, 1e-6);
        let cg = dot(np, up) * il;
        let sg = dot(np, t) * il;   // cos, sin of the normal's angle gamma
        // The horizons' zenith angles toward +t (h2) and -t (h1), no
        // further than 90 degrees from the normal: cosines c2, c1.
        let c2 = max(vec4_at(sl, s), -sg);
        let c1 = max(vec4_at(sh, s), sg);
        let h2 = fast_acos(c2);
        let h1 = -fast_acos(c1);
        let s2 = sqrt(max(1.0 - c2 * c2, 0.0));
        let s1 = -sqrt(max(1.0 - c1 * c1, 0.0));
        // cos(2h - gamma) = cos 2h cos gamma + sin 2h sin gamma.
        let k2 = (2.0 * c2 * c2 - 1.0) * cg + 2.0 * s2 * c2 * sg;
        let k1 = (2.0 * c1 * c1 - 1.0) * cg + 2.0 * s1 * c1 * sg;
        let slice = 0.25 * (-k1 + cg + 2.0 * h1 * sg) + 0.25 * (-k2 + cg + 2.0 * h2 * sg);
        visible += len * slice;
        // The direction halfway between the horizons: the perpendicular
        // of their difference, which holds when they are over 180 apart.
        let b = vec2<f32>(c1 - c2, s2 - s1);
        let bl2 = dot(b, b);
        if (bl2 > 1e-12) {
            mean += (t * b.x + up * b.y) * (len * slice * inversesqrt(bl2));
        }
    }
    let bent = dot(mean, mean) > 1e-12 ? normalize(mean) - n : vec3<f32>(0.0);

    let sky = cloud_light_at((params.cam_hi + params.cam_lo) + rel, w);
    sun_seen *= sky.x;
    if (params.trees_far > 0.0 && length(rel) < params.trees_far) {
        let eye = (params.cam_hi - params.tree_o_hi) + (params.cam_lo - params.tree_o_lo);
        sun_seen *= tree_shadow(eye + rel, eye, up, to_sun);
    }
    return GroundLight { light: vec4<f32>(sun_seen, visible * 0.25 * sky.z, sky.x, sky.y), bent: bent };
}

pub fn vertex(v_in: mesh::Vertex) -> mesh::Vertex {
    var v = v_in;
    let inst = v.instance_index;
    let ids = tiles[inst * 4];   // slot, parentSlot, root, level
    let hi = bitcast<vec4<f32>>(tiles[inst * 4 + 2]);
    let lo = bitcast<vec4<f32>>(tiles[inst * 4 + 3]);
    let i = (v.pos.x + 0.5) as i32;
    let j = (v.pos.z + 0.5) as i32;
    let slot = ids.x;
    let cx = i + ${BORDER};
    let cy = j + ${BORDER};
    let c0 = pos_at(slot, cx, cy);
    var c_xyz = c0.xyz;
    let c_w = c0.w;
    // The vertex in the detail layer's texels (planet.bk): texel t is
    // centred at cell (t + 0.5) / D - 0.5.
    let v_tex = (vec2<f32>(cx as f32, cy as f32) + vec2<f32>(0.5)) * ${DETAIL}.0 - vec2<f32>(0.5);
    let v_skirt = v.pos.y;
    // The tile grid's axes, which the horizons' directions are measured
    // along, and the surface's normal across them.
    let tu = pos_at(slot, cx + 1, cy).xyz - pos_at(slot, cx - 1, cy).xyz;
    let tv = pos_at(slot, cx, cy + 1).xyz - pos_at(slot, cx, cy - 1).xyz;
    // A skirt's bottom sits under the border cell beyond the edge, so the
    // skirts of neighbouring tiles cross beneath their seam instead of
    // sharing a plane: f32 rounding differs tile to tile, and coplanar
    // skirts leave pinholes along the seam and at corners.
    if (v.pos.y > 0.5) {
        let si = i == 0 ? -1 : (i == ${TILE} ? 1 : 0);
        let sj = j == 0 ? -1 : (j == ${TILE} ? 1 : 0);
        c_xyz = pos_at(slot, cx + si, cy + sj).xyz;
    }
    // Up at this vertex: away from the planet's center at the origin.
    let up = normalize(c_xyz + hi.xyz);
    // Skirts hang a sixteenth of the tile's edge below the surface.
    let extent = ${(RADIUS * Math.PI / 2).toFixed(1)} / ((1 << ids.w) as f32);
    let rel = (hi.xyz - params.cam_hi) + (lo.xyz - params.cam_lo);
    v.pos = rel + c_xyz - up * (v.pos.y * extent * 0.0625);
    v.normal = up;   // the fragment shades with the detail layer's normal
    // The ground's fine detail is periodic over ${DETAIL_PERIOD} m: the tile's
    // center modulo that (exact in f32, the period a power of two) plus
    // the cell's offset from it is a coordinate good to micrometres near
    // the camera, and the same modulo the period on every tile.
    let v_q = mod(hi.xyz, ${DETAIL_PERIOD}.0) + mod(lo.xyz, ${DETAIL_PERIOD}.0) + c_xyz;
    let v_swell = mod(hi.xyz, ${SWELL_PERIOD}.0) + mod(lo.xyz, ${SWELL_PERIOD}.0) + c_xyz;
    // The light it sees, on the horizon layer's grid (a point every
    // other cell), at a cell's footprint.
    var n = normalize(cross(tu, tv));
    if (dot(n, up) < 0.0) { n = -n; }
    let gl = ground_light(slot, vec2<f32>(cx as f32, cy as f32) * 0.5, tu, tv, up, n, v.pos, 0.5 * length(tu));
    v.v0 = vec4<f32>(v_tex, v_skirt, c_w);
    v.v1 = vec4<f32>(up, 0.0);
    v.v2 = vec4<f32>(v_q, 0.0);
    v.v3 = vec4<f32>(v_swell, 0.0);
    v.v4 = gl.light;
    v.v5 = vec4<f32>(gl.bent, 0.0);
    v.vi = vec4<i32>(slot, ids.w, 0, 0);
    return v;
}

// Texel (x, y) of this tile: colour (rgb, water), the octahedral normal
// unfolded and the forest's cover.
struct DetailTexel {
    col: vec4<f32>,
    nrm: vec3<f32>,
    cover: f32,
}
fn detail_texel(slot: i32, t_in: vec2<i32>) -> DetailTexel {
    let t = clamp(t_in, vec2<i32>(0), vec2<i32>(${TEXELS - 1}));
    let k = ((slot * ${TEXELS} + t.y) * ${TEXELS} + t.x) * 2;
    let col = unpack_unorm4x8(det[k]);
    let w = det[k + 1];
    let ox = ((w & 4095u) as f32) * (2.0 / 4095.0) - 1.0;
    let oy = (((w >> 12u) & 4095u) as f32) * (2.0 / 4095.0) - 1.0;
    let cover = ((w >> 24u) as f32) / 255.0;
    let nz = 1.0 - abs(ox) - abs(oy);
    let nx = nz < 0.0 ? (1.0 - abs(oy)) * (ox >= 0.0 ? 1.0 : -1.0) : ox;
    let ny = nz < 0.0 ? (1.0 - abs(ox)) * (oy >= 0.0 ? 1.0 : -1.0) : oy;
    return DetailTexel { col: col, nrm: normalize(vec3<f32>(nx, ny, nz)), cover: cover };
}
// Texel t's share of water alone.
fn detail_water(slot: i32, t_in: vec2<i32>) -> f32 {
    let t = clamp(t_in, vec2<i32>(0), vec2<i32>(${TEXELS - 1}));
    return ((det[((slot * ${TEXELS} + t.y) * ${TEXELS} + t.x) * 2] >> 24u) as f32) / 255.0;
}
// A uniform cubic B-spline's four weights at fraction f past the second.
fn bspline(f: f32) -> vec4<f32> {
    let g = 1.0 - f;
    let f2 = f * f;
    let f3 = f2 * f;
    return vec4<f32>(g * g * g, 3.0 * f3 - 6.0 * f2 + 4.0, -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0, f3) / 6.0;
}

// One of the 12 cube-edge gradients at lattice point c, the lattice
// periodic over \`cells\` (a power of two).
fn lattice_gradient(c: vec3<i32>, cells: i32, seed: i32) -> vec3<f32> {
    let m = c & vec3<i32>(cells - 1);
    let px = m.x as u32;
    let py = m.y as u32;
    let pz = m.z as u32;
    var h = (px * 0x8da6b343u ^ py * 0xd8163841u ^ pz * 0xcb1ab31fu ^ (seed as u32)) * 0x27d4eb2du;
    h = h ^ (h >> 15u);
    let e = h % 12u;
    let s1 = (e & 1u) != 0u ? -1.0 : 1.0;
    let s2 = (e & 2u) != 0u ? -1.0 : 1.0;
    let axis = e >> 2u;
    return axis == 0u ? vec3<f32>(0.0, s1, s2) : (axis == 1u ? vec3<f32>(s1, 0.0, s2) : vec3<f32>(s1, s2, 0.0));
}

// Perlin noise at x (lattice units) and its gradient: x value, yzw gradient.
fn perlin_grad(x: vec3<f32>, cells: i32, seed: i32) -> vec4<f32> {
    let fl = floor(x);
    let i = vec3<i32>(fl.x as i32, fl.y as i32, fl.z as i32);
    let f = fract(x);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    let ga = lattice_gradient(i, cells, seed);
    let gb = lattice_gradient(i + vec3<i32>(1, 0, 0), cells, seed);
    let gc = lattice_gradient(i + vec3<i32>(0, 1, 0), cells, seed);
    let gd = lattice_gradient(i + vec3<i32>(1, 1, 0), cells, seed);
    let ge = lattice_gradient(i + vec3<i32>(0, 0, 1), cells, seed);
    let gf = lattice_gradient(i + vec3<i32>(1, 0, 1), cells, seed);
    let gg = lattice_gradient(i + vec3<i32>(0, 1, 1), cells, seed);
    let gh = lattice_gradient(i + vec3<i32>(1, 1, 1), cells, seed);
    let va = dot(ga, f);
    let vb = dot(gb, f - vec3<f32>(1.0, 0.0, 0.0));
    let vc = dot(gc, f - vec3<f32>(0.0, 1.0, 0.0));
    let vd = dot(gd, f - vec3<f32>(1.0, 1.0, 0.0));
    let ve = dot(ge, f - vec3<f32>(0.0, 0.0, 1.0));
    let vf = dot(gf, f - vec3<f32>(1.0, 0.0, 1.0));
    let vg = dot(gg, f - vec3<f32>(0.0, 1.0, 1.0));
    let vh = dot(gh, f - vec3<f32>(1.0, 1.0, 1.0));
    let k1 = vb - va;
    let k2 = vc - va;
    let k3 = ve - va;
    let k4 = va - vb - vc + vd;
    let k5 = va - vc - ve + vg;
    let k6 = va - vb - ve + vf;
    let k7 = -va + vb + vc - vd + ve - vf - vg + vh;
    let value = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
    let grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
             + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf)
             + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
             + du * (vec3<f32>(k1, k2, k3) + u.yzx * vec3<f32>(k4, k5, k6) + u.zxy * vec3<f32>(k6, k4, k5) + u.yzx * u.zxy * k7);
    return vec4<f32>(value, grad);
}

struct SeaResult {
    slope: vec3<f32>,
    variance: f32,
}
fn sea_slope(footprint: f32, up: vec3<f32>, v_swell: vec3<f32>, v_q: vec3<f32>, first: i32) -> SeaResult {
    var slope = vec3<f32>(0.0);
    var variance: f32 = WAVE_RESIDUAL;
    for (var i: i32 = first; i < ${WAVES.list.length}; i += 1) {
        let k = WAVE_K[i];
        let f = WAVE_F[i];
        let w = clamp(k.w / footprint - 1.0, 0.0, 1.0);
        if (w <= 0.0) {
            variance += f.y;
            break;
        }
        let q = i < ${WAVES.swell} ? v_swell : v_q;
        slope += k.xyz * (f.z * w * cos(dot(k.xyz, q) - f.x * params.time));
        variance += f.w * (1.0 - w);
    }
    return SeaResult { slope: slope - up * dot(slope, up), variance: variance };
}

pub fn fragment(v: mesh::Vertex, s_in: mesh::Surface) -> mesh::Surface {
    var s = s_in;
    let v_tex = v.v0.xy;
    let v_skirt = v.v0.z;
    let v_height = v.v0.w;
    let v_up = v.v1.xyz;
    let v_q = v.v2.xyz;
    let v_swell = v.v3.xyz;
    let v_light = v.v4;
    let v_bent = v.v5.xyz;
    let v_slot = v.vi.x;
    let v_level = v.vi.y;

    // Bilinear over the four texels about this point. The layer's normals
    // face up, so a skirt seen from behind shades as the ground does.
    let fl_tex = floor(v_tex);
    let f = v_tex - fl_tex;
    let t0 = vec2<i32>(fl_tex.x as i32, fl_tex.y as i32);
    let d00 = detail_texel(v_slot, t0);
    let d10 = detail_texel(v_slot, t0 + vec2<i32>(1, 0));
    let d01 = detail_texel(v_slot, t0 + vec2<i32>(0, 1));
    let d11 = detail_texel(v_slot, t0 + vec2<i32>(1, 1));
    let col = mix(mix(d00.col, d10.col, f.x), mix(d01.col, d11.col, f.x), f.y);
    let forest = mix(mix(d00.cover, d10.cover, f.x), mix(d01.cover, d11.cover, f.x), f.y);
    var n = normalize(mix(mix(d00.nrm, d10.nrm, f.x), mix(d01.nrm, d11.nrm, f.x), f.y));
    var water = col.w;
    // The water's share, where there is any about, by a cubic B-spline
    // over the 4 x 4 texels around.
    if (max(max(d00.col.w, d10.col.w), max(d01.col.w, d11.col.w)) > 0.0) {
        let bx = bspline(f.x);
        let by = bspline(f.y);
        water = 0.0;
        for (var j: i32 = 0; j < 4; j += 1) {
            var row: f32 = 0.0;
            for (var i: i32 = 0; i < 4; i += 1) {
                row += vec4_at(bx, i) * detail_water(v_slot, t0 + vec2<i32>(i - 1, j - 1));
            }
            water += vec4_at(by, j) * row;
        }
    }

    // The octaves a pixel resolves: full weight from 4 pixels a
    // wavelength, none at 2.
    let footprint = max(length(dpdx(v_q)), length(dpdy(v_q)));
    var lum: f32 = 0.0;
    var lum_var: f32 = 0.0;
    var wavelength: f32 = 0.125;
    var slope = vec3<f32>(0.0);
    let hi_c = max(col.x, max(col.y, col.z));
    let lo_c = min(col.x, min(col.y, col.z));
    let rock = (1.0 - smoothstep(0.15, 0.45, (hi_c - lo_c) / max(hi_c, 1e-3))) * (1.0 - smoothstep(0.35, 0.6, hi_c));
    let lum_gain = mix(1.0, ROCK_LUM, rock);
    let relief_gain = mix(1.0, ROCK_RELIEF, rock);
    let texel = footprint / max(max(length(dpdx(v_tex)), length(dpdy(v_tex))), 1e-6);
    var coarse = min(exp2(ceil(log2(2.0 * texel))), 32.0);
    for (var k: i32 = 0; k < 8 && coarse > wavelength; k += 1) {
        let w = clamp(coarse / footprint * 0.5 - 1.0, 0.0, 1.0) - clamp(coarse / texel * 0.5 - 1.0, 0.0, 1.0);
        if (w > 0.0) {
            let far = coarse >= 1.0;
            let x = (far ? v_swell : v_q) / coarse;
            let g = perlin_grad(x, ((far ? ${SWELL_PERIOD}.0 : ${DETAIL_PERIOD}.0) / coarse) as i32, 41 + k).x;
            let a = VARY_LUM * lum_gain * w;
            lum += g * a;
            lum_var += a * a * PERLIN_VAR;
        }
        coarse *= 0.5;
    }
    var cells = (${DETAIL_PERIOD}.0 / wavelength) as i32;
    for (var k: i32 = 0; k < 6; k += 1) {
        let w = clamp(wavelength / footprint * 0.5 - 1.0, 0.0, 1.0);
        if (w <= 0.0) { break; }
        let x = v_q / wavelength;
        // One noise for both: the relief's crests are the lighter ground.
        let g = perlin_grad(x, cells, 11 + k);
        let a = VARY_LUM * lum_gain * w;
        lum += g.x * a;
        lum_var += a * a * PERLIN_VAR;
        slope += g.yzw * (RELIEF * relief_gain * w);
        wavelength *= 0.5;
        cells *= 2;
    }
    let land = 1.0 - water;
    s.base_color = col.xyz * mix(1.0, exp(lum - 0.5 * lum_var), land);
    let eye = -normalize(v.world_pos);
    let drawn = params.trees_far <= 0.0 ? 0.0 : smoothstep(params.trees_far, params.trees_far * ${(5 / 6).toFixed(4)}, length(v.world_pos));
    let crowns = 1.0 - pow(1.0 - TREE_CROWNS * forest, 1.0 / max(dot(eye, normalize(v_up)), 0.05));
    // Where blades stand, the ground between them, in their shade.
    s.base_color *= grass_floor((params.cam_hi + params.cam_lo) + v.world_pos, length(v.world_pos));
    s.base_color *= mix(vec3<f32>(1.0), TREE_TINT, crowns * (1.0 - drawn * drawn));
    let g_floor = TREE_CROWNS * forest * drawn * drawn;
    // The relief's gradient along the surface tilts the normal against it.
    n = normalize(n - (slope - dot(slope, n) * n) * land);
    var sea_variance: f32 = 0.0;
    let up = normalize(v_up);
    let fresh = smoothstep(0.0, 1.0, v_height);
    var sea = up;
    if (water > 0.001) {
        let calm = mix(1.0, WAVE_FRESH_SCALE, fresh);
        let sr = sea_slope(footprint * mix(1.0, 4.0, fresh), up, v_swell, v_q, fresh > 0.5 ? ${WAVES.fresh} : 0);
        sea = normalize(up - sr.slope * calm);
        sea_variance = sr.variance * calm * calm;
    }
    s.normal = normalize(mix(n, sea, water));
    s.roughness = mix(0.9, sqrt(sqrt(sea_variance)), water);
    s.metallic = 0.0;

    s.sun_visibility *= v_light.x;
    s.sky_visibility *= v_light.y * (1.0 - 0.8 * g_floor);
    s.occluder_sun *= v_light.z;
    s.sun_diffuse = v_light.w;
    s.sky_normal = normalize(s.normal + v_bent);

    if (SCENE_DEBUG(water)) { s = mesh::debug(s, vec3<f32>(water)); }
    if (SCENE_DEBUG(level)) {
        let hue = ((v_level % 6) as f32) / 6.0;
        s = mesh::debug(s, clamp(abs(mod(vec3<f32>(hue * 6.0) + vec3<f32>(0.0, 4.0, 2.0), 6.0) - vec3<f32>(3.0)) - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)) * 0.5);
    }
    if (SCENE_DEBUG(albedo)) { s = mesh::debug(s, s.base_color); }
    if (SCENE_DEBUG(texels)) { s = mesh::debug(s, col.xyz); }
    if (SCENE_DEBUG(octaves)) { s = mesh::debug(s, vec3<f32>(0.5 * exp(lum - 0.5 * lum_var))); }
    if (SCENE_DEBUG(light)) { s = mesh::debug(s, v_light.xyz); }
    if (SCENE_DEBUG(normal)) { s = mesh::debug(s, s.normal * 0.5 + vec3<f32>(0.5)); }
    if (SCENE_DEBUG(skirt)) { s = mesh::debug(s, v_skirt > 0.0 ? vec3<f32>(1.0, 0.0, 0.0) : s.base_color); }
    if (SCENE_DEBUG(tile)) {
        let at = (v_tex + vec2<f32>(0.5)) / ${DETAIL}.0 - vec2<f32>(${BORDER}.0);
        let e = abs(fract(v_tex + vec2<f32>(0.5)) - vec2<f32>(0.5));
        s = mesh::debug(s, mix(vec3<f32>(at / ${TILE}.0, 0.0), s.base_color, 0.5) * (max(e.x, e.y) > 0.45 ? 0.3 : 1.0));
    }
    return s;
}`;

let ground = null;
ground = scene.createInstancedMesh({
    mesh: patchMesh(), color: [1, 1, 1],
    castsShadow: false, receivesShadow: false, doubleSided: true,
    module: groundHookBk, file: 'ground_mesh.bk', modules: { tiles: bro.tiles.module },
});
ground.cullMargin = 4 * RADIUS;   // the shader places tiles; the cache culls them
makeCache(4);
const cloudMod = bro.kernel.compile(readApp('clouds.bk'), { file: 'clouds.bk', modules: MODULES });
const sunMod = bro.kernel.compile(readApp('sun.bk'), { file: 'sun.bk', modules: MODULES });
const grassMod = bro.kernel.compile(readApp('grass.bk'), { file: 'grass.bk', modules: MODULES });
const grass = createGrass(scene, RADIUS, grassMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const treeMod = bro.kernel.compile(readApp('trees.bk'), { file: 'trees.bk', modules: MODULES });
const trees = createTrees(scene, RADIUS, treeMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const clouds = createClouds(scene, RADIUS, cloudMod, [ground], SEED,
                            { source: readApp('clouds_volume.bk'), modules: MODULES }, MAX_HEIGHT);

// ── Camera: doubles about the planet's center ───────────────────────────────

const cam = { lat: 0.45, lon: 0.3, alt: 1.8e7, heading: 0, pitch: -90 };
const FOV = 55;
const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const groundHeight = (dir) => kHeight.run(1, dir[0], dir[1], dir[2], RADIUS, 18, SEED, rivers.cpu)[0];

function cameraFrame() {
    const up = [Math.cos(cam.lat) * Math.sin(cam.lon), Math.sin(cam.lat), Math.cos(cam.lat) * Math.cos(cam.lon)];
    const east = v3.norm(v3.cross([0, 1, 0], up));
    const north = v3.cross(up, east);
    const hd = cam.heading * Math.PI / 180, pt = cam.pitch * Math.PI / 180;
    const level = v3.add(v3.scale(north, Math.cos(hd)), v3.scale(east, Math.sin(hd)));
    const right = v3.sub(v3.scale(east, Math.cos(hd)), v3.scale(north, Math.sin(hd)));
    const fwd = v3.add(v3.scale(level, Math.cos(pt)), v3.scale(up, Math.sin(pt)));
    const camUp = v3.cross(right, fwd);
    // The altitude is over the ground, or over the sea where the ground is below it.
    const surface = RADIUS + Math.max(groundHeight(up), 0);
    return { up, east, north, fwd, camUp, right, pos: v3.scale(up, surface + cam.alt), surface };
}

// ── Per frame ───────────────────────────────────────────────────────────────

const camHi = [0, 0, 0], camLo = [0, 0, 0];
const lastStats = { selected: 0, visible: 0 };
let lastView = null;

function frame() {
    const f = cameraFrame();
    // The scene renders at the canvas's layout size (not its width/height
    // attributes), in device pixels: what a tile's cells project onto.
    const height = (canvas.clientHeight || 1080) * devicePixelRatio;
    const aspect = (canvas.clientWidth || 1920) * devicePixelRatio / height;
    const near = Math.min(1e5, Math.max(0.2, cam.alt * 0.05));
    const horizon = Math.sqrt(Math.max(0, (f.surface + cam.alt) ** 2 - RADIUS * RADIUS)) + 2e5;
    scene.setCamera({ eye: [0, 0, 0], target: f.fwd, up: f.camUp, fov: FOV, near, far: horizon + 1e5 });

    // The cache culls to the frustum and the horizon: what it draws is seen.
    lastView = { position: f.pos, forward: f.fwd, up: f.camUp, fov: FOV,
                 viewportWidth: height * aspect, viewportHeight: height };
    cache.update(lastView);

    // The draw list on the GPU is what the shader reads: one instance per
    // record, and the camera split hi + lo as the records' centers are.
    const n = cache.drawCount;
    if (n !== ground.instanceCount) ground.setInstanceCount(n);
    for (let k = 0; k < 3; k++) {
        camHi[k] = Math.fround(f.pos[k]);
        camLo[k] = f.pos[k] - camHi[k];
    }
    ground.setShaderUniform('cam_hi', camHi);
    ground.setShaderUniform('cam_lo', camLo);
    ground.setShaderUniform('time', performance.now() / 1000 % WAVE_CLOCK);
    ground.setShaderUniform('trees_far', trees.far);
    const d = sun.direction, dl = Math.hypot(d[0], d[1], d[2]);
    clouds.update(f.pos, f.surface + cam.alt - RADIUS, [-d[0] / dl, -d[1] / dl, -d[2] / dl], lastView);
    const cone = Math.atan(Math.tan(FOV * Math.PI / 360) * Math.hypot(1, aspect));
    ground.setShaderUniform('to_sun', [-d[0] / dl, -d[1] / dl, -d[2] / dl]);
    grass.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK);
    trees.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK);
    for (let k = 0; k < 3; k++) atmosphere.planetCenter[k] = -f.pos[k];
    scene.setAtmosphere(atmosphere);
    lastStats.selected = cache.wanted;
    lastStats.visible = n;
    // Text changes cost the page a layout and raster: a few times a second,
    // or every 60 frames where the frame clock barely moves (headless frames
    // run as fast as they render). (performance.now() is the frame clock: it
    // moves between frames.)
    const now = performance.now();
    if (now - lastPaint > 250 || ++framesSincePaint >= 60) {
        lastPaint = now;
        framesSincePaint = 0;
        paintStats();
    }
}
let lastPaint = -1e9, framesSincePaint = 0;

// ── Controls ────────────────────────────────────────────────────────────────

const altCtl = bindControl('#alt', {
    out: '#altVal', map: logMap(2, 3e7),
    fmt: (v) => v >= 1000 ? (v / 1000).toFixed(v >= 1e5 ? 0 : 1) + ' km' : v.toFixed(0) + ' m',
    onChange: (v) => { cam.alt = v; },
});
altCtl.value = cam.alt;
const pitchCtl = bindControl('#pitch', { out: '#pitchVal', fmt: (v) => v.toFixed(0) + '°', onChange: (v) => { cam.pitch = v; } });
bindControl('#detail', { out: '#detailVal', fmt: (v) => v.toFixed(1) + ' px/texel', onChange: (v) => makeCache(v) });
const sunCtl = bindControl('#sun', { out: '#sunVal', fmt: (v) => String(Math.floor(v)).padStart(2, '0') + ':' + String(Math.floor(v % 1 * 60)).padStart(2, '0'), onChange: (v) => setHour(v) });

// The stats, and the controls the camera moves without them (the wheel, a
// right-drag, a script).
function paintStats() {
    if (altCtl.value !== cam.alt) altCtl.value = cam.alt;
    if (pitchCtl.value !== cam.pitch) pitchCtl.value = cam.pitch;
    if (sunCtl.value !== sunHour) sunCtl.value = sunHour;
    const s = cache.stats;
    document.querySelector('#stats').textContent =
        `tiles  ${lastStats.visible} drawn / ${lastStats.selected} selected\n` +
        `cache  ${cache.resident} resident, ${cache.pending} pending\n` +
        `       ${s.produced} produced, ${s.evicted} evicted`;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.button === 2) {
        cam.heading = (cam.heading + dx * 0.2) % 360;
        cam.pitch = Math.max(-90, Math.min(0, cam.pitch - dy * 0.2));
        return;
    }
    // Move the ground point under the cursor with it: metres per pixel at
    // the camera's altitude, turned into an angle across the sphere.
    const mpp = 2 * cam.alt * Math.tan(FOV * Math.PI / 360) / (canvas.clientHeight || 1080);
    const hd = cam.heading * Math.PI / 180;
    const north = (dy * Math.cos(hd) + dx * Math.sin(hd)) * mpp, east = (dy * Math.sin(hd) * -1 + dx * Math.cos(hd)) * -mpp;
    cam.lat = Math.max(-1.55, Math.min(1.55, cam.lat + north / RADIUS));
    cam.lon += east / (RADIUS * Math.max(0.05, Math.cos(cam.lat)));
});
canvas.addEventListener('wheel', (e) => {
    cam.alt = Math.max(2, Math.min(3e7, cam.alt * Math.pow(1.0015, e.deltaY)));
    altCtl.value = cam.alt;
    e.preventDefault();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function loop() {
    frame();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// For tests and tools.
globalThis.planet = { cam, setHour, ground, get cache() { return cache; }, clouds, grass, trees, rivers, groundHeight, get stats() { return lastStats; }, get lastView() { return lastView; }, frame };
