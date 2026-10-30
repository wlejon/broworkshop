// Planet: an Earth-radius world drawn from a bro.tiles cube-sphere cache.
//
// The ground is one height function (ground.bk) evaluated per tile on the
// GPU in f64. Each tile's cells are written relative to the tile's center,
// and every tile is drawn camera-relative: the scene's camera sits at the
// origin and each tile instance is placed at (tile center - camera), both in
// doubles on the CPU, so nothing ever holds a planet-sized f32.
import { boot } from "/lib/kit/app.js";
import { bindControl, logMap } from "/lib/kit/params.js";
import { cloudGlsl, createClouds } from "/app/clouds.js";
import { createGrass, grassFloorGlsl } from "/app/grass.js";
import { createTrees, treeShadowGlsl } from "/app/trees.js";
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
                  'planet::clouds': readApp('clouds.bk') };
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
const PRODUCE_PER_UPDATE = 24;
// The GPU ms a frame's production may take: the batch is sized to it,
// the nearest error first, so motion keeps its frame rate and the ground
// nearest the eye still sharpens first.
const PRODUCE_BUDGET_MS = 0.6;
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
function setHour(hour) {
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
        minHeight: 0, maxHeight: MAX_HEIGHT, pixelsPerCell, producePerUpdate: PRODUCE_PER_UPDATE, produceBudgetMs: PRODUCE_BUDGET_MS,
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
        ground.setShaderBuffer('u_pos', cache.layer('position'));
        ground.setShaderBuffer('u_det', cache.layer('detail'));
        ground.setShaderBuffer('u_hz', cache.layer('horizon'));
        ground.setShaderBuffer('u_tiles', cache.drawList);
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
// the sun the clouds scatter down shadowless (clouds.js cloudLight's y);
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
const groundLightGlsl = `buffer uvec4 u_hz[];
    uniform vec3 u_toSun;
    uniform float u_treesFar;   // trees.js: how far off the trees are drawn, 0 none
    ${cloudGlsl(RADIUS)}
    ${treeShadowGlsl}
    const float GROUND_PI = 3.14159265;

    // Point p of tile slot's horizon grid: the sines of its horizon's
    // elevation along the grid's 8 directions. Directions 0-3 in lo, 4-7 in
    // hi: its four words are one 16-byte load.
    void horizonPoint(int slot, ivec2 p, out vec4 lo, out vec4 hi) {
        const int N = ${HZ};
        p = clamp(p, ivec2(0), ivec2(N - 1));
        uvec4 w = u_hz[((slot * N + p.y) * N + p.x) * 4];
        lo = vec4(unpackUnorm2x16(w.x), unpackUnorm2x16(w.y)) * 2.0 - 1.0;
        hi = vec4(unpackUnorm2x16(w.z), unpackUnorm2x16(w.w)) * 2.0 - 1.0;
    }
    float horizonAt(vec4 lo, vec4 hi, int k) { return k < 4 ? lo[k] : hi[k - 4]; }

    // acos to 7e-5 rad (Abramowitz and Stegun 4.4.45).
    float fastAcos(float x) {
        float a = abs(x);
        float r = sqrt(max(1.0 - a, 0.0)) * (1.5707288 + a * (-0.2121144 + a * (0.0742610 - 0.0187293 * a)));
        return x < 0.0 ? GROUND_PI - r : r;
    }

    void groundLight(int slot, vec2 hz, vec3 tu, vec3 tv, vec3 up, vec3 n, vec3 rel, float w,
                     out vec4 light, out vec3 bent) {
        vec3 toSun = u_toSun;
        vec2 f = hz - floor(hz);
        ivec2 p = ivec2(floor(hz));
        vec4 al, ah, bl, bh, cl, ch, dl, dh;
        horizonPoint(slot, p, al, ah);
        horizonPoint(slot, p + ivec2(1, 0), bl, bh);
        horizonPoint(slot, p + ivec2(0, 1), cl, ch);
        horizonPoint(slot, p + ivec2(1, 1), dl, dh);
        vec4 sl = clamp(mix(mix(al, bl, f.x), mix(cl, dl, f.x), f.y), -1.0, 1.0);
        vec4 sh = clamp(mix(mix(ah, bh, f.x), mix(ch, dh, f.x), f.y), -1.0, 1.0);
        // The grid's axes on the tangent plane: direction k is
        // cos * gu + sin * gv. The sun's azimuth is taken in those axes.
        vec3 gu = tu - up * dot(tu, up);
        vec3 gv = tv - up * dot(tv, up);
        float uu = dot(gu, gu), uv = dot(gu, gv), vv = dot(gv, gv);
        float su = dot(toSun, gu), sv = dot(toSun, gv);
        float fk = mod(atan(uu * sv - uv * su, vv * su - uv * sv) / (GROUND_PI * 0.25), 8.0);
        int k0 = int(fk) & 7;
        // Each point's share of the disc, blended: across a ridge's horizon
        // jump, blended horizons would step from point to point.
        int k1 = (k0 + 1) & 7;
        float fa = fk - floor(fk);
        // In sines, not angles: across the disc an elevation's step is its
        // sine's over the cosine.
        float sun = clamp(dot(toSun, up), -1.0, 1.0);
        vec4 corner = vec4(
            mix(horizonAt(al, ah, k0), horizonAt(al, ah, k1), fa), mix(horizonAt(bl, bh, k0), horizonAt(bl, bh, k1), fa),
            mix(horizonAt(cl, ch, k0), horizonAt(cl, ch, k1), fa), mix(horizonAt(dl, dh, k0), horizonAt(dl, dh, k1), fa));
        vec4 lit = clamp((sun - corner) / (0.0093 * max(sqrt(1.0 - sun * sun), 0.02)) + 0.5, 0.0, 1.0);
        float sunSeen = mix(mix(lit.x, lit.y, f.x), mix(lit.z, lit.w, f.x), f.y);

        float visible = 0.0;
        vec3 mean = vec3(0.0);
        // Without trigonometry: the horizons are kept as the cosines of their
        // zenith angles (the sines of their elevations, as stored), clamped
        // to the normal's hemisphere there as a max of cosines, and each
        // angle's double-angle terms are taken from its cosine and sine.
        const vec2 AZ[4] = vec2[4](vec2(1.0, 0.0), vec2(0.70710678, 0.70710678), vec2(0.0, 1.0), vec2(-0.70710678, 0.70710678));
        for (int s = 0; s < 4; s++) {
            vec3 t = normalize(gu * AZ[s].x + gv * AZ[s].y);
            vec3 across = cross(up, t);
            vec3 np = n - across * dot(n, across);
            float len = length(np);
            float il = 1.0 / max(len, 1e-6);
            float cg = dot(np, up) * il, sg = dot(np, t) * il;   // cos, sin of the normal's angle gamma
            // The horizons' zenith angles toward +t (h2) and -t (h1), no
            // further than 90 degrees from the normal: cosines c2, c1.
            float c2 = max(sl[s], -sg), c1 = max(sh[s], sg);
            float h2 = fastAcos(c2), h1 = -fastAcos(c1);
            float s2 = sqrt(max(1.0 - c2 * c2, 0.0)), s1 = -sqrt(max(1.0 - c1 * c1, 0.0));
            // cos(2h - gamma) = cos 2h cos gamma + sin 2h sin gamma.
            float k2 = (2.0 * c2 * c2 - 1.0) * cg + 2.0 * s2 * c2 * sg;
            float k1 = (2.0 * c1 * c1 - 1.0) * cg + 2.0 * s1 * c1 * sg;
            float slice = 0.25 * (-k1 + cg + 2.0 * h1 * sg) + 0.25 * (-k2 + cg + 2.0 * h2 * sg);
            visible += len * slice;
            // The direction halfway between the horizons: the perpendicular
            // of their difference, which holds when they are over 180 apart.
            vec2 b = vec2(c1 - c2, s2 - s1);
            float bl2 = dot(b, b);
            if (bl2 > 1e-12) mean += (t * b.x + up * b.y) * (len * slice * inversesqrt(bl2));
        }
        bent = dot(mean, mean) > 1e-12 ? normalize(mean) - n : vec3(0.0);

        vec3 sky = cloudLight((u_camHi + u_camLo) + rel, w);
        sunSeen *= sky.x;
        if (u_treesFar > 0.0 && length(rel) < u_treesFar) {
            vec3 eye = (u_camHi - u_treeOHi) + (u_camLo - u_treeOLo);
            sunSeen *= treeShadow(eye + rel, eye, up, toSun);
        }
        light = vec4(sunSeen, visible * 0.25 * sky.z, sky.x, sky.y);
    }`;

// Instance i draws the cache's draw-list record i (tiles-api.js): its slot,
// level, and center as hi + lo floats, from which the camera (split the same
// way) is subtracted for a camera-relative placement good to f64.
const vertex = `buffer vec4 u_pos[];
    buffer ivec4 u_tiles[];
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    out vec2 v_tex;
    flat out int v_slot;
    flat out int v_level;   // the tile's (the debug view 'level')
    out float v_skirt;      // 0 on the surface, 1 at a skirt's bottom (the debug view 'skirt')
    out vec3 v_up;
    out vec3 v_q;
    out vec3 v_swell;
    out float v_height;   // the ground's, or a lake's level (m)
    out vec4 v_light;     // groundLight's sun and sky seen, and the occluders' sun
    out vec3 v_bent;      // and the sky's mean direction
    ${groundLightGlsl}
    void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
        ivec4 ids = u_tiles[gl_InstanceIndex * 4];   // slot, parentSlot, root, level
        vec4 hi = intBitsToFloat(u_tiles[gl_InstanceIndex * 4 + 2]);
        vec4 lo = intBitsToFloat(u_tiles[gl_InstanceIndex * 4 + 3]);
        const int C = ${CELLS}, B = ${BORDER};
        int i = int(pos.x + 0.5), j = int(pos.z + 0.5);
        int k = ids.x * C * C + (j + B) * C + (i + B);
        vec4 c = u_pos[k];
        // The vertex in the detail layer's texels (planet.bk): texel t is
        // centred at cell (t + 0.5) / D - 0.5.
        v_tex = (vec2(i + B, j + B) + 0.5) * ${DETAIL}.0 - 0.5;
        v_slot = ids.x;
        v_level = ids.w;
        v_skirt = pos.y;
        // The tile grid's axes, which the horizons' directions are measured
        // along, and the surface's normal across them.
        vec3 tu = u_pos[k + 1].xyz - u_pos[k - 1].xyz;
        vec3 tv = u_pos[k + C].xyz - u_pos[k - C].xyz;
        // A skirt's bottom sits under the border cell beyond the edge, so the
        // skirts of neighbouring tiles cross beneath their seam instead of
        // sharing a plane: f32 rounding differs tile to tile, and coplanar
        // skirts leave pinholes along the seam and at corners.
        if (pos.y > 0.5) {
            int si = i == 0 ? -1 : (i == ${TILE} ? 1 : 0);
            int sj = j == 0 ? -1 : (j == ${TILE} ? 1 : 0);
            c.xyz = u_pos[k + sj * C + si].xyz;
        }
        // Up at this vertex: away from the planet's center at the origin.
        vec3 up = normalize(c.xyz + hi.xyz);
        // Skirts hang a sixteenth of the tile's edge below the surface.
        float extent = ${RADIUS * Math.PI / 2} / float(1 << ids.w);
        vec3 rel = (hi.xyz - u_camHi) + (lo.xyz - u_camLo);
        pos = rel + c.xyz - up * (pos.y * extent * 0.0625);
        normal = up;   // the fragment shades with the detail layer's normal
        v_up = up;
        v_height = c.w;
        // The ground's fine detail is periodic over ${DETAIL_PERIOD} m: the tile's
        // center modulo that (exact in f32, the period a power of two) plus
        // the cell's offset from it is a coordinate good to micrometres near
        // the camera, and the same modulo the period on every tile.
        v_q = mod(hi.xyz, ${DETAIL_PERIOD}.0) + mod(lo.xyz, ${DETAIL_PERIOD}.0) + c.xyz;
        v_swell = mod(hi.xyz, ${SWELL_PERIOD}.0) + mod(lo.xyz, ${SWELL_PERIOD}.0) + c.xyz;
        // The light it sees, on the horizon layer's grid (a point every
        // other cell), at a cell's footprint.
        vec3 n = normalize(cross(tu, tv));
        if (dot(n, up) < 0.0) n = -n;
        groundLight(ids.x, vec2(i + B, j + B) * 0.5, tu, tv, up, n, pos, 0.5 * length(tu), v_light, v_bent);
    }`;

// The detail layer (planet.bk) holds, finer than the vertices, the mean of
// the ground under each texel: albedo, how much of it is water, and the
// normal of its mean surface, read here bilinearly. Per pixel, the land
// carries on past the finest tile's texels: octaves of wavelength 1/8 m down
// to 2 mm, of albedo variation (ground.bk variation, the same contrast per
// octave) and of relief (the same slope per octave), each faded out as its
// wavelength nears a pixel; and coarser, where a far texel spans several
// pixels, the albedo's octaves between the texel and the pixel. All are
// zero-mean, so what a pixel averages to is the texel's.
const fragment = `buffer uint u_det[];
    in vec2 v_tex;
    flat in int v_slot;
    flat in int v_level;
    in float v_skirt;
    in vec3 v_up;
    in vec3 v_q;
    in vec3 v_swell;
    in float v_height;
    in vec4 v_light;
    in vec3 v_bent;
    uniform float u_time;
    uniform vec3 u_camHi;
    uniform vec3 u_camLo;
    uniform float u_treesFar;   // trees.js: how far off the trees are drawn, 0 none
    // The trees' crowns (trees.js), as the share of a forest's ground they
    // hide from straight above and their lit colour over the forest floor's.
    const float TREE_CROWNS = 0.55;
    const vec3 TREE_TINT = vec3(0.22, 0.24, 0.33);
    // userFragment to userLight: the crowns' share above the floor where the
    // trees are drawn (TREE_CROWNS times the cover), whose shade it is in.
    float g_floor = 0.0;
    ${grassFloorGlsl}

    // The light the ground sees, as its vertices found it (groundLight), and
    // the sky through the gaps in the crowns overhead among drawn trees. The
    // sky's direction turns from this pixel's normal as the vertices' turned
    // from theirs.
    void userLight(vec3 toSun, inout float sunVisibility, inout float skyVisibility, inout vec3 skyNormal,
                   inout float occluderSun, inout float sunDiffuse) {
        sunVisibility *= v_light.x;
        skyVisibility *= v_light.y * (1.0 - 0.8 * g_floor);
        occluderSun *= v_light.z;
        sunDiffuse = v_light.w;
        skyNormal = normalize(skyNormal + v_bent);
    }

    // Texel (x, y) of this tile: colour (rgb, water), the octahedral normal
    // unfolded and the forest's cover.
    void detailTexel(ivec2 t, out vec4 col, out vec3 nrm, out float cover) {
        const int W = ${TEXELS};
        t = clamp(t, ivec2(0), ivec2(W - 1));
        int k = ((v_slot * W + t.y) * W + t.x) * 2;
        col = unpackUnorm4x8(u_det[k]);
        uint w = u_det[k + 1];
        vec2 o = vec2(float(w & 4095u), float((w >> 12) & 4095u)) * (2.0 / 4095.0) - 1.0;
        cover = float(w >> 24) / 255.0;
        vec3 n = vec3(o, 1.0 - abs(o.x) - abs(o.y));
        if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
        nrm = normalize(n);
    }
    // Texel t's share of water alone.
    float detailWater(ivec2 t) {
        const int W = ${TEXELS};
        t = clamp(t, ivec2(0), ivec2(W - 1));
        return float(u_det[((v_slot * W + t.y) * W + t.x) * 2] >> 24) / 255.0;
    }
    // A uniform cubic B-spline's four weights at fraction f past the second.
    vec4 bspline(float f) {
        float g = 1.0 - f, f2 = f * f, f3 = f2 * f;
        return vec4(g * g * g, 3.0 * f3 - 6.0 * f2 + 4.0, -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0, f3) / 6.0;
    }
    const float VARY_LUM = 0.11;      // ground.bk VARY_LUM
    const float PERLIN_VAR = 0.0728;  // ground.bk PERLIN_VAR
    const float RELIEF = 0.08;        // slope per octave, per unit of the noise's gradient
    // Bare rock is rougher and more contrasted than a sward at every scale a
    // pixel resolves: its faces and cracks, lit and shaded. Rock is the grey
    // ground (little chroma, short of snow's white), and its octaves take
    // ROCK_LUM and ROCK_RELIEF times a sward's, still zero-mean, so its
    // average is the texel's as it is everywhere.
    const float ROCK_LUM = 1.8;
    const float ROCK_RELIEF = 3.0;

    // One of the 12 cube-edge gradients at lattice point c, the lattice
    // periodic over \`cells\` (a power of two).
    vec3 latticeGradient(ivec3 c, int cells, int seed) {
        uvec3 p = uvec3(c & (cells - 1));
        uint h = (p.x * 0x8da6b343u ^ p.y * 0xd8163841u ^ p.z * 0xcb1ab31fu ^ uint(seed)) * 0x27d4eb2du;
        h ^= h >> 15;
        uint e = h % 12u;
        float s1 = (e & 1u) != 0u ? -1.0 : 1.0, s2 = (e & 2u) != 0u ? -1.0 : 1.0;
        uint axis = e >> 2;
        return axis == 0u ? vec3(0.0, s1, s2) : (axis == 1u ? vec3(s1, 0.0, s2) : vec3(s1, s2, 0.0));
    }

    // Perlin noise at x (lattice units) and its gradient: x value, yzw gradient.
    vec4 perlinGrad(vec3 x, int cells, int seed) {
        ivec3 i = ivec3(floor(x));
        vec3 f = fract(x);
        vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
        vec3 ga = latticeGradient(i, cells, seed), gb = latticeGradient(i + ivec3(1, 0, 0), cells, seed);
        vec3 gc = latticeGradient(i + ivec3(0, 1, 0), cells, seed), gd = latticeGradient(i + ivec3(1, 1, 0), cells, seed);
        vec3 ge = latticeGradient(i + ivec3(0, 0, 1), cells, seed), gf = latticeGradient(i + ivec3(1, 0, 1), cells, seed);
        vec3 gg = latticeGradient(i + ivec3(0, 1, 1), cells, seed), gh = latticeGradient(i + ivec3(1, 1, 1), cells, seed);
        float va = dot(ga, f), vb = dot(gb, f - vec3(1, 0, 0)), vc = dot(gc, f - vec3(0, 1, 0)), vd = dot(gd, f - vec3(1, 1, 0));
        float ve = dot(ge, f - vec3(0, 0, 1)), vf = dot(gf, f - vec3(1, 0, 1)), vg = dot(gg, f - vec3(0, 1, 1)), vh = dot(gh, f - vec3(1, 1, 1));
        float k1 = vb - va, k2 = vc - va, k3 = ve - va, k4 = va - vb - vc + vd;
        float k5 = va - vc - ve + vg, k6 = va - vb - ve + vf, k7 = -va + vb + vc - vd + ve - vf - vg + vh;
        float value = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
        vec3 grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
                  + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf)
                  + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
                  + du * (vec3(k1, k2, k3) + u.yzx * vec3(k4, k5, k6) + u.zxy * vec3(k6, k4, k5) + u.yzx * u.zxy * k7);
        return vec4(value, grad);
    }

    // The sea's waves (WAVES): wave vector (rad/m) and a quarter of its
    // wavelength; the angular frequency, the mean square slope of the wave and
    // every shorter one, the slope amplitude over |k| and its mean square
    // slope. The first WAVE_SWELL are periodic over v_swell, the rest over v_q.
    const int WAVE_COUNT = ${WAVES.list.length}, WAVE_SWELL = ${WAVES.swell}, WAVE_FRESH = ${WAVES.fresh};
    const float WAVE_RESIDUAL = ${glslFloat(WAVES.residual)}, WAVE_FRESH_SCALE = ${glslFloat(WAVES.freshScale)};
    const vec4 WAVE_K[WAVE_COUNT] = vec4[](${WAVES.list.map((w) =>
        `vec4(${w.n.map((c) => glslFloat(c * 2 * Math.PI / w.period)).join(', ')}, ${glslFloat(Math.PI / 2 / w.k)})`).join(', ')});
    const vec4 WAVE_F[WAVE_COUNT] = vec4[](${WAVES.list.map((w) =>
        `vec4(${[w.omega, w.tail, w.slope / w.k, w.slope * w.slope / 2].map(glslFloat).join(', ')})`).join(', ')});

    // The sea's slope along the surface from the waves this pixel resolves
    // (full from 8 pixels a wavelength, none at 4: a sinusoid nearer a pixel
    // beats against the pixels in moire), and the mean square slope of those
    // it does not: the waves become the sea's roughness as they shrink below
    // a pixel, so far off the sun's glint spreads as the waves it is made of
    // would spread it (Bruneton, Neyret and Holzschuch 2010). From wave
    // first on: fresh water's are WAVE_FRESH on.
    vec3 seaSlope(float footprint, vec3 up, int first, out float variance) {
        vec3 slope = vec3(0.0);
        variance = WAVE_RESIDUAL;
        for (int i = first; i < WAVE_COUNT; i++) {
            vec4 k = WAVE_K[i], f = WAVE_F[i];
            float w = clamp(k.w / footprint - 1.0, 0.0, 1.0);
            if (w <= 0.0) { variance += f.y; break; }
            vec3 q = i < WAVE_SWELL ? v_swell : v_q;
            slope += k.xyz * (f.z * w * cos(dot(k.xyz, q) - f.x * u_time));
            variance += f.w * (1.0 - w);
        }
        return slope - up * dot(slope, up);
    }

    void userFragment(inout vec3 baseColor, inout vec3 normal,
                      inout float metallic, inout float roughness,
                      inout vec3 emissive, inout float alpha) {
        // Bilinear over the four texels about this point. The layer's normals
        // face up, so a skirt seen from behind shades as the ground does.
        vec2 f = v_tex - floor(v_tex);
        ivec2 t0 = ivec2(floor(v_tex));
        vec4 c00, c10, c01, c11;
        vec3 n00, n10, n01, n11;
        vec4 cover;
        detailTexel(t0, c00, n00, cover.x);
        detailTexel(t0 + ivec2(1, 0), c10, n10, cover.y);
        detailTexel(t0 + ivec2(0, 1), c01, n01, cover.z);
        detailTexel(t0 + ivec2(1, 1), c11, n11, cover.w);
        vec4 col = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
        float forest = mix(mix(cover.x, cover.y, f.x), mix(cover.z, cover.w, f.x), f.y);
        vec3 n = normalize(mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y));
        float water = col.a;
        // The water's share, where there is any about, by a cubic B-spline
        // over the 4 x 4 texels around: the share sets the roughness, whose
        // reflection is far from linear in it, so the water's edge is one of
        // the share's contours, and a bilinear share's contours are cut
        // texel by texel into a saw along every diagonal bank.
        if (max(max(c00.a, c10.a), max(c01.a, c11.a)) > 0.0) {
            vec4 bx = bspline(f.x), by = bspline(f.y);
            water = 0.0;
            for (int j = 0; j < 4; j++) {
                float row = 0.0;
                for (int i = 0; i < 4; i++) row += bx[i] * detailWater(t0 + ivec2(i - 1, j - 1));
                water += by[j] * row;
            }
        }

        // The octaves a pixel resolves: full weight from 4 pixels a
        // wavelength, none at 2.
        float footprint = max(length(dFdx(v_q)), length(dFdy(v_q)));
        float lum = 0.0, lumVar = 0.0, wavelength = 0.125;
        vec3 slope = vec3(0.0);
        float hiC = max(col.r, max(col.g, col.b)), loC = min(col.r, min(col.g, col.b));
        float rock = (1.0 - smoothstep(0.15, 0.45, (hiC - loC) / max(hiC, 1e-3))) * (1.0 - smoothstep(0.35, 0.6, hiC));
        float lumGain = mix(1.0, ROCK_LUM, rock), reliefGain = mix(1.0, ROCK_RELIEF, rock);
        // Coarser, the albedo's octaves the pixel resolves and its texel
        // does not (each at the pixel's weight less the texel's, by the same
        // rule, so what the texel holds is not counted twice): a texel spans
        // up to a few pixels far off, and its variation would end there.
        // Octaves of a metre and up repeat over v_swell's 1024 m.
        float texel = footprint / max(max(length(dFdx(v_tex)), length(dFdy(v_tex))), 1e-6);
        float coarse = min(exp2(ceil(log2(2.0 * texel))), 32.0);
        for (int k = 0; k < 8 && coarse > wavelength; k++) {
            float w = clamp(coarse / footprint * 0.5 - 1.0, 0.0, 1.0) - clamp(coarse / texel * 0.5 - 1.0, 0.0, 1.0);
            if (w > 0.0) {
                bool far = coarse >= 1.0;
                vec3 x = (far ? v_swell : v_q) / coarse;
                float g = perlinGrad(x, int((far ? ${SWELL_PERIOD}.0 : ${DETAIL_PERIOD}.0) / coarse), 41 + k).x;
                float a = VARY_LUM * lumGain * w;
                lum += g * a;
                lumVar += a * a * PERLIN_VAR;
            }
            coarse *= 0.5;
        }
        int cells = int(${DETAIL_PERIOD}.0 / wavelength);
        for (int k = 0; k < 6; k++) {
            float w = clamp(wavelength / footprint * 0.5 - 1.0, 0.0, 1.0);
            if (w <= 0.0) break;
            vec3 x = v_q / wavelength;
            // One noise for both: the relief's crests are the lighter ground.
            vec4 g = perlinGrad(x, cells, 11 + k);
            float a = VARY_LUM * lumGain * w;
            lum += g.x * a;
            lumVar += a * a * PERLIN_VAR;
            slope += g.yzw * (RELIEF * reliefGain * w);
            wavelength *= 0.5;
            cells *= 2;
        }
        float land = 1.0 - water;
        baseColor = col.rgb * mix(1.0, exp(lum - 0.5 * lumVar), land);
        // Where the trees are not drawn (or only shrunk, over their last
        // sixth), their crowns over the floor: the share of the view they
        // hide is the gap probability of a Poisson canopy, 1 - (1 - c)^(1 /
        // cos) of the share c hidden looking straight down (Nilson 1971),
        // so a forest seen across is all crowns, as the drawn trees are.
        vec3 eye = -normalize(vWorldPos);
        float drawn = u_treesFar <= 0.0 ? 0.0 : smoothstep(u_treesFar, u_treesFar * ${(5 / 6).toFixed(4)}, length(vWorldPos));
        float crowns = 1.0 - pow(1.0 - TREE_CROWNS * forest, 1.0 / max(dot(eye, normalize(v_up)), 0.05));
        // Where blades stand, the ground between them, in their shade.
        baseColor *= grassFloor((u_camHi + u_camLo) + vWorldPos, length(vWorldPos));
        baseColor *= mix(vec3(1.0), TREE_TINT, crowns * (1.0 - drawn * drawn));
        g_floor = TREE_CROWNS * forest * drawn * drawn;
        // The relief's gradient along the surface tilts the normal against it.
        n = normalize(n - (slope - dot(slope, n) * n) * land);
        float seaVariance = 0.0;
        vec3 up = normalize(v_up);
        // Rivers and lakes stand above the sea: their water is sheltered,
        // a breeze's ripples on it (the waves of 4 m and shorter, scaled to
        // Cox and Munk's mean square slope at 2 m/s: WAVES.fresh) rather
        // than the sea's swell and waves. A ripple tilts the normal only
        // from 32 pixels a wavelength (the sea's from 8): a few wave trains
        // over a narrow water read as a woven grid, where the eye takes a
        // breeze's ripples seen from off as gloss.
        float fresh = smoothstep(0.0, 1.0, v_height);
        vec3 sea = up;
        // (Land near sea level carries a trace of water, the chance its
        // unresolved heights dip under the sea: too little to show.)
        if (water > 0.001) {
            float calm = mix(1.0, WAVE_FRESH_SCALE, fresh);
            sea = normalize(up - seaSlope(footprint * mix(1.0, 4.0, fresh), up, fresh > 0.5 ? WAVE_FRESH : 0, seaVariance) * calm);
            seaVariance *= calm * calm;
        }
        normal = normalize(mix(n, sea, water));
        // GGX's alpha is the root mean square slope; the engine's roughness
        // its square root.
        roughness = mix(0.9, sqrt(sqrt(seaVariance)), water);
        metallic = 0.0;

        // Debug views (scene.setDebugView): the share under water, the
        // tile's level (a hue each of six), the base colour unlit, the light
        // groundLight found (sun seen, sky seen, the clouds' share of the
        // sun), and the shading normal.
        if (SCENE_DEBUG(water)) sceneDebugOut(vec3(water));
        if (SCENE_DEBUG(level)) {
            float hue = float(v_level % 6) / 6.0;
            sceneDebugOut(clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0) * 0.5);
        }
        if (SCENE_DEBUG(albedo)) sceneDebugOut(baseColor);
        // The albedo's two factors: the detail layer's texels, bilinear, and
        // the octaves' luminance over them (a half for 1).
        if (SCENE_DEBUG(texels)) sceneDebugOut(col.rgb);
        if (SCENE_DEBUG(octaves)) sceneDebugOut(vec3(0.5 * exp(lum - 0.5 * lumVar)));
        if (SCENE_DEBUG(light)) sceneDebugOut(v_light.xyz);
        if (SCENE_DEBUG(normal)) sceneDebugOut(normal * 0.5 + 0.5);
        if (SCENE_DEBUG(skirt)) sceneDebugOut(v_skirt > 0.0 ? vec3(1.0, 0.0, 0.0) : baseColor);
        // Where in its tile a pixel lies (0 to 1 across), its texel's edges
        // dark over the base colour.
        if (SCENE_DEBUG(tile)) {
            vec2 at = (v_tex + 0.5) / ${DETAIL}.0 - ${BORDER}.0;
            vec2 e = abs(fract(v_tex + 0.5) - 0.5);
            sceneDebugOut(mix(vec3(at / ${TILE}.0, 0.0), baseColor, 0.5) * (max(e.x, e.y) > 0.45 ? 0.3 : 1.0));
        }
    }`;

let ground = null;
ground = scene.createInstancedMesh({ mesh: patchMesh(), color: [1, 1, 1], castsShadow: false, receivesShadow: false, doubleSided: true });
ground.setShader({ vertex, fragment });
ground.cullMargin = 4 * RADIUS;   // the shader places tiles; the cache culls them
makeCache(4);
const cloudMod = bro.kernel.compile(readApp('clouds.bk'), { file: 'clouds.bk', modules: MODULES });
const sunMod = bro.kernel.compile(readApp('sun.bk'), { file: 'sun.bk', modules: MODULES });
const grassMod = bro.kernel.compile(readApp('grass.bk'), { file: 'grass.bk', modules: MODULES });
const grass = createGrass(scene, RADIUS, grassMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const treeMod = bro.kernel.compile(readApp('trees.bk'), { file: 'trees.bk', modules: MODULES });
const trees = createTrees(scene, RADIUS, treeMod, sunMod, TRUTH, SEED, rivers.net, [ground]);
const clouds = createClouds(scene, RADIUS, cloudMod, [ground], SEED);

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
    ground.setShaderUniform('u_camHi', camHi);
    ground.setShaderUniform('u_camLo', camLo);
    ground.setShaderUniform('u_time', performance.now() / 1000 % WAVE_CLOCK);
    ground.setShaderUniform('u_treesFar', trees.far);
    const d = sun.direction, dl = Math.hypot(d[0], d[1], d[2]);
    clouds.update(f.pos, f.surface + cam.alt - RADIUS, [-d[0] / dl, -d[1] / dl, -d[2] / dl]);
    const cone = Math.atan(Math.tan(FOV * Math.PI / 360) * Math.hypot(1, aspect));
    ground.setShaderUniform('u_toSun', [-d[0] / dl, -d[1] / dl, -d[2] / dl]);
    grass.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK);
    trees.update(f.pos, cam.alt, [-d[0] / dl, -d[1] / dl, -d[2] / dl], camHi, camLo, f.fwd, cone, performance.now() / 1000 % WAVE_CLOCK,
                 grass.fieldMade);
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
bindControl('#sun', { out: '#sunVal', fmt: (v) => String(Math.floor(v)).padStart(2, '0') + ':' + String(Math.floor(v % 1 * 60)).padStart(2, '0'), onChange: (v) => setHour(v) });

// The stats, and the controls the camera moves without them (the wheel, a
// right-drag, a script).
function paintStats() {
    if (altCtl.value !== cam.alt) altCtl.value = cam.alt;
    if (pitchCtl.value !== cam.pitch) pitchCtl.value = cam.pitch;
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
