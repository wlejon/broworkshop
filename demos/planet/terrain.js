// The planet's land: its processes (plates and their belts, the continents
// on them, hypsometry, then the rivers that drain them carving the ground
// they cross, and the climate on what is left) over a FastNoise tree of the
// fine relief. world.js makes the land from them.

export const R = 6371000;
export const SEED = 2024;

// --- noise ---------------------------------------------------------------------------

export const N = (type, props = {}) => {
    const n = FastNoise.create(type);
    for (const k in props) n.set(k, props[k]);
    return n;
};
export const add = (a, b) => N('Add', { LHS: a, RHS: b });
export const mul = (a, b) => N('Multiply', { LHS: a, RHS: b });
export const fbm = (scale, octaves, seed, gain = 0.5) =>
    N('FractalFBm', { Source: N('Simplex', { 'Feature Scale': scale, 'Seed Offset': seed }), Octaves: octaves,
                      Lacunarity: 2.03, Gain: gain });

// The relief is laid down band by band, each where a grid can carry it and
// carve it: the broad relief (60 km, 30 km) on the global grid's 12 km
// cells, and each regional level's band (two octaves from eight of its
// cells across down to two: 32 and 16 km on level 3's 4 km cells, 8 and 4
// km on level 2's, 2 and 1 km on level 1's, 500 and 250 m on level 0's 64 m
// cells) on its regions as they are made under the eye, each eroded there.
// The tree carries only what the finest cells cannot: the ground's grain
// under 128 m, scaled by the processes (channel 0's y), about a metre an
// amplitude unit. (Ablations from the command line: `notree` draws the
// grids alone, `noregions` the global grid alone, `drainage` tints the
// surface by the rivers' catchments.)
export const ARGV = (globalThis.bro && bro.app && bro.app.argv) || [];
export const TREE = ARGV.includes('notree') ? mul(fbm(200, 1, 3), 0) : mul(fbm(120, 3, 3), 3);
// The regional levels' bands: feature scale and amplitude (times the tree's scale).
const BANDS = [[500, 30], [2000, 120], [8000, 330], [32000, 520]];
const BAND_NOISE = BANDS.map(([s], i) => fbm(s, 2, 31 + i));

// --- the plates ------------------------------------------------------------------------

const PLATES = 24;
function plates(seed) {
    let s = seed >>> 0;
    const rnd = () => {   // mulberry32
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const unit = () => {
        for (;;) {
            const v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
            const l = Math.hypot(v[0], v[1], v[2]);
            if (l > 0.1 && l <= 1) return v.map((x) => x / l);
        }
    };
    const data = [];
    // Centres, w: 1 a continental plate, 0 an oceanic one (about a third
    // continental, as Earth's land is).
    for (let i = 0; i < PLATES; i++) data.push(...unit(), rnd() < 0.36 ? 1 : 0);
    // Each plate's turn about its pole (radians a unit time).
    for (let i = 0; i < PLATES; i++) {
        const a = unit(), w = 0.4 + rnd();
        data.push(a[0] * w, a[1] * w, a[2] * w, 0);
    }
    return data;
}

export const WARP = fbm(2.2e6, 4, 7);
const CONTINENT = fbm(3.0e6, 6, 9, 0.55);
const RELIEF = fbm(60000, 2, 0);

// The erosion's iterations: routing alone first (the drainage gathered over
// the uncarved ground), then routing and carving together; on the global
// grid, and on each region (whose drainage runs a region across at most).
const ROUTE = 640, ERODE = 1408;
const DBGI = ARGV.find((s) => s.startsWith('rit='));
const REGION_ROUTE = DBGI ? +DBGI.slice(4).split(',')[0] : 320, REGION_ERODE = DBGI ? +DBGI.slice(4).split(',')[1] : 384;
// (The regions' lift: iterations of its spread, regionLift.)
const REGION_LIFT = 128;
export const PROCESSES = {
    resolution: 512, channels: 4, data: plates(SEED),
    passes: [{ fn: 'route', iterations: ROUTE }, { fn: 'erode', iterations: ERODE }, { fn: 'settle' }],
    // The regional grids under the eye: 512 cells a side, level 0's 64 m,
    // each level's four times the last's (to level 3's 4 km), the regions
    // within one of the eye's each way, channels 0 and 1 kept.
    regions: ARGV.includes('noregions') ? undefined : {
        init: 'regionInit', cells: 512, apron: 32, cell: 64, ratio: 4, levels: 4, reach: 1, keep: 2,
        passes: [{ fn: 'regionRoute', iterations: REGION_ROUTE }, { fn: 'regionErode', iterations: REGION_ERODE },
                 { fn: 'regionLift', iterations: REGION_LIFT }, { fn: 'regionSettle' }],
    },
    source: WARP.glsl({ name: 'warpNoise', dims: [3] }) + CONTINENT.glsl({ name: 'continentNoise', dims: [3] }) +
            RELIEF.glsl({ name: 'reliefNoise', dims: [3] }) +
            BAND_NOISE.map((n, i) => n.glsl({ name: 'bandNoise' + i, dims: [3] })).join('') + `
const int PLATES = ${PLATES};
const float R = ${R}.0;

// Channel 0: the land's height over its tree (x added, y the tree's scale,
//            z the woods' share, w how cold).
// Channel 1: x the ground's own height (under the sea too), y how near a
//            range it is (0 .. 1), z the drainage area (km²): a river's
//            catchment, read by the surface, w how wet (0 desert .. 1
//            rainforest).
// Channel 2: the erosion's state: x the ground, y the cells draining
//            through the cell (itself included), z its outflow a unit of
//            weight (the drainage it hands on, over the sum of its weights),
//            w its steepest slope down (the weights' scale).
// Channel 3: on the global grid x the continental field, y how near a
//            range, z the tree's scale, w the water's level while the
//            passes run, the drainage area (km²) once settled; on a region
//            x the coarser field's drainage in the region's cells, w the
//            water's level.
// The regions keep channels 0 and 1; the rest are the global grid's.

vec3 warped(vec3 d) {
    vec3 p = d * R;
    vec3 w = vec3(warpNoise(p, 11), warpNoise(p + vec3(5.2e6, 1.3e6, 0.0), 12), warpNoise(p - vec3(2.1e6, 0.0, 4.4e6), 13));
    return normalize(d + 0.16 * w);
}

void procInit(inout vec4 v[PROC_CHANNELS]) {
    vec3 d = procUp();
    vec3 q = warped(d);
    // The nearest plate and the next: the boundary between them is where
    // their centres are equally near.
    int a = 0, b = 1;
    float da = -2.0, db = -2.0;
    for (int i = 0; i < PLATES; ++i) {
        float t = dot(q, procData(i).xyz);
        if (t > da) { db = da; b = a; da = t; a = i; }
        else if (t > db) { db = t; b = i; }
    }
    float toEdge = 0.5 * (acos(clamp(db, -1.0, 1.0)) - acos(clamp(da, -1.0, 1.0))) * R;   // metres
    vec3 ca = procData(a).xyz, cb = procData(b).xyz;
    // The plates' motion where they meet: closing (> 0) or opening.
    vec3 across = normalize((cb - ca) - q * dot(cb - ca, q));
    vec3 va = cross(procData(PLATES + a).xyz, q), vb = cross(procData(PLATES + b).xyz, q);
    float closing = dot(va - vb, across);
    float ka = procData(a).w, kb = procData(b).w;

    // The continents: a continental plate's ground, an oceanic plate's
    // abyss with islands where the noise is strongest, the two blended over
    // a wide band about their boundary (a boundary is a great circle: a
    // coast along it would run ruler-straight), the margins the continental
    // noise's.
    float n = continentNoise(d * R, 21);
    float kind = mix(0.5 * (ka + kb), ka, smoothstep(0.0, 900000.0, toEdge));
    float land = mix(n * 1.3 - 0.55, n * 1.1 + 0.32, kind);

    // The belts, a Gaussian about the boundary, as the plates meet.
    float belt = exp(-pow(toEdge / 220000.0, 2.0));
    float near = exp(-pow(toEdge / 480000.0, 2.0));
    float rise = 0.0;
    if (closing > 0.0) {
        float c = clamp(closing, 0.0, 1.0);
        if (ka > 0.5 && kb > 0.5) rise = 3000.0 * c * belt + 500.0 * c * near;   // a collision: range and plateau
        else if (ka > 0.5) rise = 2600.0 * c * exp(-pow((toEdge - 180000.0) / 180000.0, 2.0));   // a cordillera inland of a trench
        else if (kb > 0.5) rise = -3000.0 * c * belt;                                           // the trench
        else rise = 1200.0 * c * belt;                                                          // an island arc
    } else {
        float o = clamp(-closing, 0.0, 1.0);
        rise = ka > 0.5 && kb > 0.5 ? -600.0 * o * belt : 1600.0 * o * belt;                    // a rift, a mid-ocean ridge
    }

    // Hypsometry: lowlands most of the land, the abyss most of the sea, the
    // shelf between.
    float ground = land > 0.0 ? 40.0 + 900.0 * pow(land, 1.8) : -140.0 - 4300.0 * smoothstep(0.0, 0.35, -land);
    ground += rise * (land > -0.15 ? 1.0 : 0.6);
    float range = clamp(rise / 2600.0, 0.0, 1.0);

    // The tree's detail rides on the land: little on the plains, the most on
    // a range, fading out down the shelf (the abyss is smooth under the sea).
    // The broad relief (60 km, 30 km) is laid down here at the tree's
    // scale, for the rivers to find their ways through and carve.
    float scale = (0.25 + 0.35 * clamp(land, 0.0, 1.0) + 2.4 * range) * smoothstep(-400.0, -40.0, ground);
    ground += scale * 420.0 * reliefNoise(d * R, 0);
    v[2] = vec4(ground, 1.0, 0.0, 0.0);
    // (The water's level starts high over the land: it drains from the coasts.)
    v[3] = vec4(land, range, scale, ground < 0.0 ? ground : 1e5);
}

// --- the rivers --------------------------------------------------------------------
//
// Each iteration, every cell at once (so what a river carries reaches one
// cell further down it an iteration):
//   - the water's level W (channel 3's w while the passes run): the sea's
//     ground at sea, else the ground or, in a basin with no way out, just
//     over the lowest neighbour's level (Planchon and Darboux: W starts high
//     over the land and drains from the coasts inward a cell an iteration,
//     settling on the ground where the ground drains and on the lake's
//     level, sloping a little to its outlet, where it does not), so every
//     basin drains to the sea;
//   - the drainage through a cell is itself and what its neighbours above
//     hand it, each handing its drainage on to the neighbours below it in
//     shares by slope^FLOW_P (a multiple-flow routing, nearly the steepest
//     neighbour's alone), the slopes the water's level's;
//   - with erode on, ground out of the water is cut toward the steepest
//     neighbour by stream power (implicit, so stable at any rate: the cut a
//     step is e / (1 + e) of the drop, e = K A^M) and crept downhill by
//     diffusion; a lake's floor silts up toward its level.
// The sea takes what reaches it and is not changed.

const ivec2 NB[8] = ivec2[8](ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(1, 0),
                             ivec2(-1, 1), ivec2(0, 1), ivec2(1, 1));
const float ND[8] = float[8](1.41421356, 1.0, 1.41421356, 1.0, 1.0, 1.41421356, 1.0, 1.41421356);
const float FLOW_P = 4.0;     // how sharply the drainage follows the steepest way
const float FILL = 2e-4;      // the slope a filled basin is left with, down to its outlet
const float K = 2.5e-4;       // stream power's rate an iteration, at one cell's drainage
const float M = 0.5;          // its power of the drainage
const float CREEP = 0.0015;   // the hillslopes' diffusion an iteration (over the pass, some 2 cells)
const float SILT = 0.01;      // how fast a lake's floor fills, an iteration

// (seedA: the drainage the cell takes at least, in cells, for the stream
// power: on a region the coarser field's, so a river reaching it from
// outside cuts as the river it is. A region's edge cells are its outlets
// and stay as made, at the coarser field's. ks, where it is not 0: the
// channels' steepness (Flint's law, a river's slope ks A^-0.45 with A its
// catchment in m²): a stream cuts no lower than that slope over the water
// it runs to, so its bed is the concave profile a river keeps where the
// land rises as fast as it is cut, steep at its head and gentle downstream,
// not ground flat to its outlet however long it runs. bed: the lowest the
// cut takes the ground, on a region the coarser field's less the relief its
// band may carve, so a level shapes its own band and leaves the coarser
// field's valleys where they are.)
const float THETA = 0.45;
float flowK = K;          // stream power's rate this pass (a region's is REGION_K times K)
float flowSlide = 1e30;   // the threshold slope past which ground slides (a region's REGION_SLIDE)
void flow(inout vec4 v[PROC_CHANNELS], bool carve, float seedA, float ks, float bed) {
    float h = v[2].x, W = v[3].w;
    float L = procCellSize();
    bool sea = h < 0.0 || procBorder() == 0;
    float A = 1.0, rest = 1e30, mean4 = 0.0;
    float Wn[8];
    for (int k = 0; k < 8; ++k) {
        vec4 n = procRead(2, NB[k]);
        Wn[k] = procRead(3, NB[k]).w;
        float dist = ND[k] * L;
        // What it hands this cell, if its water lies above this one's.
        if (Wn[k] > W && n.w > 0.0) A += n.z * pow((Wn[k] - W) / dist / n.w, FLOW_P);
        rest = min(rest, Wn[k] + FILL * dist);
        if (ND[k] == 1.0) mean4 += 0.25 * n.x;
    }
    if (carve && !sea) {
        if (W - h < 1.0) {
            // Stream power toward the steepest neighbour (never below its
            // water), then the creep, a land cell kept over the sea.
            float drop = 0.0;
            int down = 0;
            for (int k = 0; k < 8; ++k) {
                float s = (h - Wn[k]) / ND[k];
                if (s > drop) { drop = s; down = k; }
            }
            float a = max(A, seedA);
            float e = flowK * pow(a, M);
            float hc = h - drop * e / (1.0 + e);
            if (ks > 0.0 && drop > 0.0) hc = max(hc, min(h, Wn[down] + ND[down] * L * ks * pow(a * L * L, -THETA)));
            hc = max(hc, min(h, bed)) + CREEP * (mean4 - h);
            // (Past the threshold slope the ground slides down to it.)
            for (int k = 0; k < 8; ++k) hc = min(hc, max(Wn[k], 1.0) + flowSlide * ND[k] * L);
            h = max(hc, min(h, 1.0));
        } else {
            h += SILT * (W - h);
        }
    }
    W = sea ? h : max(h, rest);
    // This cell's shares down, for its neighbours' next iteration.
    float smax = 0.0, S = 0.0;
    for (int k = 0; k < 8; ++k) smax = max(smax, (W - Wn[k]) / (ND[k] * L));
    if (!sea && smax > 0.0)
        for (int k = 0; k < 8; ++k) {
            float down = (W - Wn[k]) / (ND[k] * L);
            if (down > 0.0) S += pow(down / smax, FLOW_P);
        }
    v[2] = vec4(h, A, S > 0.0 ? A / S : 0.0, sea ? 0.0 : smax);
    v[3].w = W;
}

void route(inout vec4 v[PROC_CHANNELS]) { flow(v, false, 0.0, 0.0, -1e9); }
void erode(inout vec4 v[PROC_CHANNELS]) { flow(v, true, 0.0, 0.0, -1e9); }

// --- what the land is, once carved ----------------------------------------------------

// The climate the plants stand by (channel 0's z and w: their rules read
// them), as the surface reckons it: warm or cold by latitude and height.
// z the woods' share (thick where the surface is forest, scattered over wet
// grassland, none in the sea), w how cold it is (the conifers' share).
void climate(inout vec4 v[PROC_CHANNELS], vec3 d, float ground, float range, float wet) {
    float lat = asin(clamp(d.y, -1.0, 1.0)), sl = sin(lat);
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * max(ground, 0.0) / 1000.0;
    float warm = smoothstep(-2.0, 6.0, temp);
    float woods = max(smoothstep(0.5, 0.75, wet), 0.2 * smoothstep(0.3, 0.5, wet)) * warm * (1.0 - 0.7 * range);
    v[0].z = ground > 0.0 ? woods : 0.0;
    v[0].w = smoothstep(13.0, 4.0, temp);
}

void settle(inout vec4 v[PROC_CHANNELS]) {
    vec3 d = procUp();
    // (A basin's lake is its sediment's plain, level with its outlet.)
    float ground = v[3].w;
    float land = v[3].x, range = v[3].y, scale = v[3].z;
    float L = procCellSize();
    float area = v[2].y * L * L * 1e-6;
    v[3].w = area;
    v[0].x = ground;
    v[0].y = scale;
    // Wet at the equator and the westerlies' latitudes, dry under the
    // subtropical highs and at the poles, wetter near the sea (the
    // continental field over the coast's level is how far inland); and
    // along a belt its weather's own wandering (a monsoon coast, a rain
    // shadow), the warp's noise a continent across. Channel 1's w: the
    // surface reads it.
    float lat = asin(clamp(d.y, -1.0, 1.0));
    float inland = clamp(land / 0.6, 0.0, 1.0);
    float belts = 0.68 + 0.36 * cos(lat * 6.0) - 0.25 * smoothstep(0.75, 1.2, abs(lat));
    float wander = 0.3 * warpNoise(d * R + vec3(3.3e6, -2.7e6, 1.9e6), 14);
    float wet = clamp((belts + wander) * (1.15 - 0.6 * inland), 0.0, 1.0);
    v[1] = vec4(ground, range, area, wet);
    climate(v, d, ground, range, wet);
}

// --- the regions ----------------------------------------------------------------------
//
// A region starts from the coarser field (procCoarse: the coarser levels'
// regions over the global grid) and adds its level's band of the relief,
// as much as the tree's scale says (a range's most, the plains' little,
// none down the shelf); then its rivers are routed and cut as the global
// grid's are, at its cells, a river from outside cutting as the coarser
// field's drainage says, its edges its outlets.

float band(int L, vec3 p) {
    if (L == 0) return bandNoise0(p, 31);
    if (L == 1) return bandNoise1(p, 32);
    if (L == 2) return bandNoise2(p, 33);
    return bandNoise3(p, 34);
}
const float KS_PLAIN = 60.0, KS_RANGE = 200.0;
const float DIG = 1.0;   // how deep a level may cut under the coarser field, in its band's amplitudes
const float LAND_FLOOR = 15.0;   // the least height a region leaves the coarser field's land (m; over the tree's grain)
// A region's stream power, times the global grid's: its iterations are a
// few hundred over its cells where the global grid's are 1408, and at K the
// streams barely cut the band, which stood as the noise's domes; at 24 times
// they dissect it, the valleys cut either side of a spur meeting at a crest.
// The ground slides where it is steeper than REGION_SLIDE (some 39 degrees)
// over its neighbours' water, so faces stand at the threshold and nothing
// stands as a spike or a plateau over its surroundings (at 0.4 the slides
// rounded the land again, cutting the crests the streams had left).
const float REGION_K = 24.0, REGION_SLIDE = 0.8;
const float BAND_AMP[4] =float[4](${BANDS.map(([, a]) => a.toFixed(1)).join(', ')});

void regionInit(inout vec4 v[PROC_CHANNELS]) {
    vec4 c0 = procCoarse(0), c1 = procCoarse(1);
    int L = clamp(procLevel(), 0, 3);
    float scale = c0.y;
    float ground = c0.x + scale * BAND_AMP[L] * band(L, procPoint());
    // (Land stays land, LAND_FLOOR over the sea or the coarser field's
    // height where that is lower: a band dipping a low coast under the sea
    // made it a sea the region's rivers ran into, and a coarse level's
    // valleys cut to the sea's level inland left ponds of sea there, the
    // tree's grain dipping their floors under it.)
    float least = c0.x > -1.0 ? clamp(c0.x, 2.0, LAND_FLOOR) : -1e9;
    ground = max(ground, least);
    float cell = procCellSize();
    v[0] = vec4(ground, scale, c0.zw);
    v[1] = vec4(ground, c1.yzw);
    v[2] = vec4(ground, 1.0, 0.0, 0.0);
    // (The water's level starts over the ground by more than any pit the band
    // dug, and drains from the edges.)
    float pit = 2.0 * scale * BAND_AMP[L] + 20.0;
    // (Only a river's: what the coarser field drains past a few of its own
    // cells, every cell of which drains at least itself. As a floor under
    // every cell that would cut the whole region down to the sea.)
    float coarse = procCoarseCellSize();
    // y: the bed, the coarser field's ground less what this band may carve.
    float bed = c0.x - DIG * scale * BAND_AMP[L] - 10.0;
    // z: the least it is left.
    v[3] = vec4(max(c1.z * 1e6 - 4.0 * coarse * coarse, 0.0) / (cell * cell), max(bed, least),
                least, ground < 0.0 || procBorder() == 0 ? ground : ground + pit);
}

// (A range's channels steeper: it rises faster.)
void regionRoute(inout vec4 v[PROC_CHANNELS]) { flow(v, false, v[3].x, 0.0, -1e9); }
void regionErode(inout vec4 v[PROC_CHANNELS]) {
    flowK = K * REGION_K;
    flowSlide = REGION_SLIDE;
    flow(v, true, v[3].x, KS_PLAIN + KS_RANGE * v[1].y, v[3].y);
}

// The ground the carving took, lifted back as the crust under it rises
// (isostasy): what each cell lost (channel 1's x, the band's ground, until
// now) spread over the cells about it, LIFT iterations of the mean of a cell
// and its four neighbours (some ten cells, a few of the coarser field's),
// and added back in regionSettle. So a level's valleys are cut and its
// ridges stand higher, but its ground keeps the coarser field's mean: the
// lines the surface draws by height (the snow, the tree line) are where the
// coarser field draws them, in the regions as past them. (Carved and left,
// a range's ground lay some 150 to 250 m under the global grid's, its snow
// a patchwork of the regions' squares from the limb.)
void regionLift(inout vec4 v[PROC_CHANNELS]) {
    if (procIteration() == 0) {
        v[1].x = v[2].x > 0.0 && procBorder() > 0 ? max(v[1].x - v[2].x, 0.0) : 0.0;
        return;
    }
    v[1].x = (v[1].x + procRead(1, ivec2(-1, 0)).x + procRead(1, ivec2(1, 0)).x + procRead(1, ivec2(0, -1)).x +
              procRead(1, ivec2(0, 1)).x) / 5.0;
}

void regionSettle(inout vec4 v[PROC_CHANNELS]) {
    // (The carved ground, not the water's level: a band's hollows the
    // region's iterations did not drain stay hollows; as lake plains they
    // were flat sheets cut square along the cells, kilometres across.)
    float carved = max(v[2].x, v[3].z);   // (the creep may have taken it under its floor)
    float ground = carved > 0.0 ? carved + v[1].x : carved;
    float cell = procCellSize();
    // (Its own drainage: the coarser field's, its seed, is that field's cells
    // smeared over a few of this one's each, a river kilometres wide
    // drawn as wet ground square along a region's edges. And none on a
    // hollow's floor, which is its pool's water spread, the whole pool's.)
    float area = (v[3].w - carved > 1.0 ? 1.0 : v[2].y) * cell * cell * 1e-6;
    v[0].x = ground;
    v[1].x = ground;
    v[1].z = area;
    climate(v, procUp(), ground, v[1].y, v[1].w);
}
`,
};
