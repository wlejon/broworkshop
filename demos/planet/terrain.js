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
export const ridged = (scale, octaves, seed) =>
    N('FractalRidged', { Source: N('Simplex', { 'Feature Scale': scale, 'Seed Offset': seed }), Octaves: octaves,
                         Lacunarity: 2.07, Gain: 0.5 });

// The fine relief, scaled by the processes (channel 0's y): rolling hills
// and the ridges a range carries, about a metre an amplitude unit. The
// broad relief (60 km and 30 km) is the processes' own, eroded with the
// rest of the ground; the tree carries what the grid's 12 km cells cannot.
// The ridges are only the coarse octaves' (down to 2 km): a ridged octave's
// every crest is a crease, and fine ones lay a hillside in crests tens of
// metres apart, its light in contour lines; below them the relief is fbm's.
// (Ablations from the command line: `notree` draws the processes' grid
// alone, `drainage` tints the surface by the rivers' catchments.)
export const ARGV = (globalThis.bro && bro.app && bro.app.argv) || [];
export const TREE = ARGV.includes('notree') ? mul(fbm(200, 1, 3), 0) : add(add(mul(fbm(15000, 7, 0), 160), mul(ridged(18000, 4, 1), 520)),
                        add(mul(fbm(1500, 5, 2), 25), mul(fbm(200, 4, 3), 2.5)));

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
// the uncarved ground), then routing and carving together.
const ROUTE = 640, ERODE = 1408;

export const PROCESSES = {
    resolution: 512, channels: 4, data: plates(SEED),
    passes: [{ fn: 'route', iterations: ROUTE }, { fn: 'erode', iterations: ERODE }, { fn: 'settle' }],
    source: WARP.glsl({ name: 'warpNoise', dims: [3] }) + CONTINENT.glsl({ name: 'continentNoise', dims: [3] }) +
            RELIEF.glsl({ name: 'reliefNoise', dims: [3] }) + `
const int PLATES = ${PLATES};
const float R = ${R}.0;

// Channel 0: the land's height over its tree (x added, y the tree's scale,
//            z the woods' share, w how cold).
// Channel 1: x the ground's own height (under the sea too), y how near a
//            range it is (0 .. 1), z how far inland (0 the coast .. 1 a
//            continent's heart), w how wet (0 desert .. 1 rainforest).
// Channel 2: the erosion's state: x the ground, y the cells draining
//            through the cell (itself included), z its outflow a unit of
//            weight (the drainage it hands on, over the sum of its weights),
//            w its steepest slope down (the weights' scale).
// Channel 3: x the continental field, y how near a range, z the tree's
//            scale, w the drainage area (km²) once settled: a river's
//            catchment, read by the surface.

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

void flow(inout vec4 v[PROC_CHANNELS], bool carve) {
    float h = v[2].x, W = v[3].w;
    float L = procCellSize();
    bool sea = h < 0.0;
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
            for (int k = 0; k < 8; ++k) drop = max(drop, (h - Wn[k]) / ND[k]);
            float e = K * pow(A, M);
            float hc = h - max(drop, 0.0) * e / (1.0 + e) + CREEP * (mean4 - h);
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

void route(inout vec4 v[PROC_CHANNELS]) { flow(v, false); }
void erode(inout vec4 v[PROC_CHANNELS]) { flow(v, true); }

// --- what the land is, once carved ----------------------------------------------------

void settle(inout vec4 v[PROC_CHANNELS]) {
    vec3 d = procUp();
    // (A basin's lake is its sediment's plain, level with its outlet.)
    float ground = v[3].w;
    float land = v[3].x, range = v[3].y, scale = v[3].z;
    float L = procCellSize();
    v[3].w = v[2].y * L * L * 1e-6;
    v[0].x = ground;
    v[0].y = scale;
    // How far inland: the continental field over the coast's level.
    v[1] = vec4(ground, range, clamp(land / 0.6, 0.0, 1.0), 0.0);

    // The climate the plants stand by (channel 0's z and w: their rules
    // read them), as the surface reckons it: warm or cold by latitude and
    // height, wet or dry by the air's belts and the sea's reach. z the
    // woods' share (thick where the surface is forest, scattered over wet
    // grassland, none in the sea), w how cold it is (the conifers' share).
    float lat = asin(clamp(d.y, -1.0, 1.0)), sl = sin(lat);
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * max(ground, 0.0) / 1000.0;
    // Wet at the equator and the westerlies' latitudes, dry under the
    // subtropical highs and at the poles, wetter near the sea; and along a
    // belt its weather's own wandering (a monsoon coast, a rain shadow), the
    // warp's noise a continent across. Channel 1's w: the surface reads it.
    float belts = 0.68 + 0.36 * cos(lat * 6.0) - 0.25 * smoothstep(0.75, 1.2, abs(lat));
    float wander = 0.3 * warpNoise(d * R + vec3(3.3e6, -2.7e6, 1.9e6), 14);
    float wet = clamp((belts + wander) * (1.15 - 0.6 * v[1].z), 0.0, 1.0);
    v[1].w = wet;
    float warm = smoothstep(-2.0, 6.0, temp);
    float woods = max(smoothstep(0.5, 0.75, wet), 0.2 * smoothstep(0.3, 0.5, wet)) * warm * (1.0 - 0.7 * range);
    v[0].z = ground > 0.0 ? woods : 0.0;
    v[0].w = smoothstep(13.0, 4.0, temp);
}
`,
};
