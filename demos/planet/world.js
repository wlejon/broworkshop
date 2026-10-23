// The planet world: an Earth-sized body whose land is made by its processes
// (plates and their belts, the continents on them, how far each place is
// from the sea) over a FastNoise tree of the fine relief, and whose surface
// is what that climate grows. The views and the capture script share it.
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { SUN_LUX, AIR } from "/lib/kit/sky.js";
import { herbModule } from "/lib/herbs/index.js";
import { swardModule } from "/lib/sward/index.js";
import { treeModule, treeSpecies } from "/lib/trees/index.js";
import { TEMPERATE, BROADLEAF, BIRCH, CONIFER, SHRUB, OAK, LIME } from "/lib/trees/temperate.js";

export const R = 6371000;

export const vp = sceneViewport('#stage', {
    // (Yaw about the view's own up: the globe turns under a drag from any side.)
    orbit: { target: [0, 0, 0], dist: 3e7, fov: 40, near: 1e4, far: 1e8, rot: orbitRotation(0, -1.2), yawAxis: 'view' },
    // (The wheel is the planet's own, below.)
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 6e7, zoomRate: 0 },
});
export const { scene } = vp;

// --- noise ---------------------------------------------------------------------------

const SEED = 2024;
const N = (type, props = {}) => {
    const n = FastNoise.create(type);
    for (const k in props) n.set(k, props[k]);
    return n;
};
const add = (a, b) => N('Add', { LHS: a, RHS: b });
const mul = (a, b) => N('Multiply', { LHS: a, RHS: b });
const fbm = (scale, octaves, seed, gain = 0.5) =>
    N('FractalFBm', { Source: N('Simplex', { 'Feature Scale': scale, 'Seed Offset': seed }), Octaves: octaves,
                      Lacunarity: 2.03, Gain: gain });
const ridged = (scale, octaves, seed) =>
    N('FractalRidged', { Source: N('Simplex', { 'Feature Scale': scale, 'Seed Offset': seed }), Octaves: octaves,
                         Lacunarity: 2.07, Gain: 0.5 });

// The fine relief, scaled by the processes (channel 0's y): rolling hills
// and the ridges a range carries, about a metre an amplitude unit. The
// ridges are only the coarse octaves' (down to 2 km): a ridged octave's
// every crest is a crease, and fine ones lay a hillside in crests tens of
// metres apart, its light in contour lines; below them the relief is fbm's.
const TREE = add(add(mul(fbm(60000, 9, 0), 420), mul(ridged(18000, 4, 1), 520)),
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

const WARP = fbm(2.2e6, 4, 7);
const CONTINENT = fbm(3.0e6, 6, 9, 0.55);

const PROCESSES = {
    resolution: 512, channels: 2, data: plates(SEED),
    source: WARP.glsl({ name: 'warpNoise', dims: [3] }) + CONTINENT.glsl({ name: 'continentNoise', dims: [3] }) + `
const int PLATES = ${PLATES};
const float R = ${R}.0;

// Channel 0: the land's height over its tree (x added, y the tree's scale).
// Channel 1: x the ground's own height (under the sea too), y how near a
// range it is (0 .. 1), z how far inland (0 the coast .. 1 a continent's
// heart), w how wet (0 desert .. 1 rainforest).

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
    v[0].x = ground;
    v[0].y = (0.25 + 0.35 * clamp(land, 0.0, 1.0) + 2.4 * range) * smoothstep(-400.0, -40.0, ground);
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

// --- the surface ----------------------------------------------------------------------

// What grows where, by the climate: warm or cold by latitude and height,
// wet or dry by the belts of the air's circulation and the sea's reach.
const SURFACE = `
LandSurface landSurface(LandPoint q) {
    vec4 g = landGrid(1, q.at);
    float lat = asin(clamp(q.up.y, -1.0, 1.0));
    float h = q.height;
    if (h < 0.0) {
        // The seabed (the land's sea over it): the shelf's sand, the deep's mud.
        return landSurfaceOf(mix(vec3(0.16, 0.14, 0.10), vec3(0.05, 0.05, 0.045), smoothstep(5.0, 120.0, -h)));
    }
    float sl = sin(lat);
    // The air's temperature cools with the height of the broad ground, the
    // processes': the relief's few hundred metres over it moved every line
    // drawn from it (tree line, tundra, snow) degrees either way, blob by
    // blob, a far land mottled from edge to edge. A range keeps its own
    // heights: snow on its crests and a tree line up its flanks.
    float share = mix(0.3, 1.0, smoothstep(0.1, 0.5, g.y));
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * mix(max(g.x, 0.0), h, share) / 1000.0;
    // The relief a texel this wide hides (the tree's octaves finer than it,
    // at their mean in its height), as each line's spread over it: a far
    // range's crests are a share of snow, not snow or rock texel by texel.
    float fp = q.footprint;
    float hidden = landGrid(0, q.at).y * (420.0 * min(fp / 60000.0, 1.0) + 520.0 * min(fp / 18000.0, 1.0) +
                                          25.0 * min(fp / 1500.0, 1.0));
    float spread = 6.5 * share * hidden / 1000.0;
    #define COLD(warm, cold) smoothstep((warm) + spread, (cold) - spread, temp)
    #define WARM(cold, warm) smoothstep((cold) - spread, (warm) + spread, temp)
    float wet = g.w;   // the processes' (the plants' woods read the same)
    float steep = 1.0 - q.normal.y;

    vec3 desert = vec3(0.34, 0.23, 0.12), steppe = vec3(0.22, 0.19, 0.09), grass = vec3(0.10, 0.14, 0.04);
    vec3 forest = vec3(0.03, 0.06, 0.025), tundra = vec3(0.12, 0.11, 0.08), rock = vec3(0.14, 0.13, 0.12);
    vec3 snow = vec3(0.80, 0.82, 0.86);
    vec3 c = mix(desert, steppe, smoothstep(0.12, 0.3, wet));
    c = mix(c, grass, smoothstep(0.3, 0.5, wet));
    c = mix(c, forest, smoothstep(0.5, 0.75, wet) * WARM(-2.0, 6.0));
    c = mix(c, tundra, COLD(2.0, -6.0));
    // Bare rock where it is steep and high (a range, or above the trees):
    // a lowland's steep hillsides are wooded or grassed over, not a net of
    // grey crests across every hill.
    float alpine = max(smoothstep(0.15, 0.5, g.y), COLD(4.0, -2.0));
    c = mix(c, rock, smoothstep(0.3, 0.55, steep) * alpine);
    // Snow where the year is cold through: an ice sheet buries its relief,
    // bare only on the near-sheer faces (a crest's every crease flecked
    // dark where it gave way at the rock's own slope).
    c = mix(c, snow, COLD(-8.0, -14.0) * (1.0 - smoothstep(0.65, 0.9, steep)));
    LandSurface s = landSurfaceOf(c);
    float grows = smoothstep(0.15, 0.45, wet) * WARM(-4.0, 4.0) * (1.0 - smoothstep(0.3, 0.55, steep));
    s.cover = vec4(grows, 1.0 - smoothstep(0.15, 0.5, wet), 0.6 + 0.6 * wet, smoothstep(0.55, 0.8, wet) * grows);
    s.herbs = 0.3 * grows;
    return s;
}
`;

// --- the body, the land and the light --------------------------------------------

// Where the place starts: a point on the body (its frame), a temperate
// lowland at 39° N with a range in sight.
export const START = (() => {
    const d = [0.2848, 0.6286, -0.7237], l = Math.hypot(d[0], d[1], d[2]);
    return d.map((x) => (x / l) * R);
})();
scene.setBody({ radius: R, at: START });

export const land = scene.createLand({ height: TREE, seed: SEED, surface: SURFACE, processes: PROCESSES, sea: { level: 0, absorb: [0.6, 0.18, 0.12] } });

// --- the plants -------------------------------------------------------------------------

// The temperate wood's trees where the climate says (the processes' z),
// in stands and clearings a few hundred metres across; conifers as it
// grows cold (w), the broadleaves' kinds where it is warm. Shrubs in the
// woods' thickets and their edges. The plants stand on the land's own
// height (its tree, the processes' base under it).
const clamp01 = (a) => N('Min', { LHS: N('Max', { LHS: a, RHS: 0 }), RHS: 1 });
const affine = (a, s, o) => add(mul(a, s), o);
const warmShare = (k) => ({ own: 'w', scale: -k, offset: k });
const stands = clamp01(affine(fbm(700, 3, 21), 2.4, 0.62));
const thicket = clamp01(affine(fbm(120, 2, 22), 3.0, -0.2));
export const plants = scene.createPlants({
    module: treeModule(), species: TEMPERATE.map(treeSpecies), receivesShadow: true, range: 12000, land,
    rules: {
        ground: TREE, seed: SEED, range: 6000,
        layers: [
            { spacing: 6, jitter: 0.9, sink: 0.1, seed: 11, chance: { own: 'z', times: stands },
              species: [{ species: CONIFER, weight: { own: 'w' } }, { species: BROADLEAF, weight: warmShare(0.45) },
                        { species: OAK, weight: warmShare(0.25) }, { species: BIRCH, weight: warmShare(0.2) },
                        { species: LIME, weight: warmShare(0.1) }],
              scale: affine(fbm(400, 2, 23), 0.2, 0.95), scaleVariety: 0.25,
              tint: affine(fbm(300, 2, 24), 1.4, 0), tintVariety: 0.4 },
            { spacing: 3, jitter: 1.0, sink: 0.05, seed: 12, chance: { own: 'z', scale: 0.35, offset: 0.02, times: thicket },
              species: [SHRUB], scaleVariety: 0.4, tintVariety: 1.0 },
        ],
    },
});
plants.castsShadow = true;

// The grass and herbs where the surface's cover grows them (its turf the
// land's look out past the blades).
export const grass = scene.createGrass({
    ground: land, turf: true,
    sward: swardModule({ lush: [0.08, 0.15, 0.035], dry: [0.26, 0.21, 0.08] }),
    herbs: herbModule({ species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'] }),
});

// The sun: a direction in the body's frame (the light's, from the sun),
// turned into the place frame whenever the place moves.
export const sunBody = (() => { const d = [-0.3, -0.75, 0.6], l = Math.hypot(d[0], d[1], d[2]); return d.map((x) => x / l); })();
export const sun = scene.createLight({ type: 'directional', direction: [0, -1, 0], castsShadow: true, intensity: SUN_LUX });
function placeSun() {
    const b = scene.place.basis;   // row-major, column j is place axis j in the body's frame
    sun.direction = [0, 1, 2].map((j) => b[j] * sunBody[0] + b[3 + j] * sunBody[1] + b[6 + j] * sunBody[2]);
}
placeSun();
scene.addEventListener('reanchor', placeSun);
scene.setAtmosphere(Object.assign({ enabled: true }, AIR));
// (Metered on the sun's light: a planet of dark sea and forest stays dark
// and its snow white, from orbit to the grass.)
scene.setExposure({ mode: 'auto', meter: 'incident' });

// --- the clouds ---------------------------------------------------------------------

// The weather's lows: where the air turns about a low, its clouds wind
// into it (the westerlies' cyclones, a continent wide, and a few tropical
// ones, tighter and faster), counter-clockwise in the north and clockwise
// in the south. Two vec4s a low: its centre and turn (radians at its
// heart), then its size (radians) and how overcast its heart is.
const LOWS = (() => {
    let s = (SEED * 7919) >>> 0;
    const rnd = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const data = [];
    const low = (lat, lon, turn, size, heart, eye) => {
        const c = Math.cos(lat);
        const hemi = lat >= 0 ? 1 : -1;
        data.push(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon), hemi * turn, size, heart, eye, 0);
    };
    for (let i = 0; i < 22; i++) {
        const lat = (rnd() < 0.5 ? -1 : 1) * (0.62 + 0.42 * rnd());
        low(lat, rnd() * Math.PI * 2, 1.0 + 1.0 * rnd(), 0.12 + 0.08 * rnd(), 0.3 + 0.3 * rnd(), 0);
    }
    for (let i = 0; i < 3; i++) {
        const lat = (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.2 * rnd());
        low(lat, rnd() * Math.PI * 2, 3.5 + 1.5 * rnd(), 0.04 + 0.015 * rnd(), 0.9, 1);
    }
    return data;
})();
const WEATHER = fbm(1.4e6, 5, 41, 0.55), SHOWERS = fbm(2.6e5, 4, 42);

// The deck from 2.5 km to 10.5 km (its bases over the hills and the low
// view's eye). Its cover by the general circulation and
// the climate the land's processes reckon (channel 1's w, how wet; x the
// ground, under the sea too): the rain belt over the equator, its towers
// and anvils; the subtropics' highs clear over the deserts, with sheets of
// stratocumulus in cells over the sea; the westerlies' storm tracks, each
// low wound into a comma with its cold front trailing a long band
// equatorward and west and its warm front's shield to the east; fair
// weather's cumulus over moist land; thin cloud over the poles' ice.
// Its base at a point: the cover, gathered into the decks' closed cells
// and the fields' clusters (a mesoscale noise 160 km a tile), from a base
// a few hundred metres over the deck's bottom to tops as high as the cover
// says, rounding toward them where the air is convective and cut square
// where it is not. The engine cuts it into billows (its Perlin-Worley,
// 12 km a tile) and erodes their edges (cauliflower above, wisps at the
// bases); from afar, the share of the sky they cover.
//
//   cover  x the share of the sky the clouds cover, y how convective they
//          are (0 a front's or a deck's slab .. 1 heaped cumulus), z how
//          high their tops reach (of the deck), w how much they lie in
//          closed cells (marine stratocumulus)
export const CLOUD_BOTTOM = 2500, CLOUD_TOP = 10500;
// (How many metres the clouds' base takes to rise across their surfaces:
// the engine's billows and detail move the surface by a fifth of it, some
// 150 m each way.)
const CLOUD_EDGE = 1500;
const CLOUDS = WEATHER.glsl({ name: 'cloudWeather', dims: [3] }) + SHOWERS.glsl({ name: 'cloudShowers', dims: [3] }) + `
const int LOWS = ${LOWS.length / 8};
const float R = ${R}.0;

vec3 turnAbout(vec3 d, vec3 c, float k) {
    float ck = cos(k), sk = sin(k);
    return d * ck + cross(c, d) * sk + c * dot(c, d) * (1.0 - ck);
}

// The direction the weather's noise is read at: each low turns the air
// about it, most at its heart, so what crosses it winds into a spiral.
vec3 swirled(vec3 d, out float heart) {
    heart = 0.0;
    for (int i = 0; i < LOWS; ++i) {
        vec4 a = cloudData(2 * i), b = cloudData(2 * i + 1);
        float s = acos(clamp(dot(d, a.xyz), -1.0, 1.0)) / b.x;
        d = turnAbout(d, a.xyz, a.w * exp(-s * s));
        // (A tropical cyclone's eye is clear, a few tens of kilometres.)
        heart = max(heart, b.y * exp(-0.5 * s * s) * mix(1.0, smoothstep(0.06, 0.16, s), b.z));
    }
    return d;
}

// The fronts of the westerlies' lows (the extratropical ones, no eye): in
// each low's frame (x east, y poleward, in its sizes), the cold front a
// band trailing equatorward and bending west some two and a half sizes,
// narrowing away from the low, and the warm front's broad shield east of
// it, poleward of its line. Their cover, the strongest of any low's.
float lowFronts(vec3 d) {
    float best = 0.0;
    for (int i = 0; i < LOWS; ++i) {
        vec4 a = cloudData(2 * i), b = cloudData(2 * i + 1);
        if (b.z > 0.5) continue;
        vec3 c = a.xyz;
        float cd = dot(d, c);
        if (cd < 0.5) continue;
        float hemi = sign(a.w);
        vec3 north = normalize(vec3(0.0, 1.0, 0.0) - c * c.y);
        vec3 east = cross(north, c);
        vec3 v = (d - c * cd) / cd;   // (on the plane tangent at the low)
        float x = dot(v, east) / b.x, y = dot(v, north) * hemi / b.x;
        // The cold front: x(s) = -0.15 s - 0.22 s^2 at y = -s.
        float s = clamp(-y, 0.0, 2.6);
        float slope = -0.15 - 0.44 * s;
        float dist = abs(x - (-0.15 * s - 0.22 * s * s)) / sqrt(1.0 + slope * slope);
        float width = mix(0.3, 0.12, s / 2.6);
        float cold = smoothstep(width, 0.3 * width, dist) * smoothstep(2.6, 1.8, -y) * smoothstep(0.15, -0.05, y);
        // The warm front: its line east and a little equatorward, its
        // shield the cloud poleward of the line (some 300 km of it).
        float yl = -0.35 * x;
        float warm = smoothstep(-0.1, 0.05, x) * smoothstep(1.4, 0.8, x) * smoothstep(-0.12, 0.05, y - yl) *
                     smoothstep(0.55, 0.3, y - yl);
        best = max(best, max(cold, 0.9 * warm));
    }
    return best;
}

vec4 cloudCover(vec3 up) {
    vec4 g = cloudLandGrid(1, up);
    float lat = asin(clamp(up.y, -1.0, 1.0)), al = abs(lat);
    float heart;
    vec3 w = swirled(up, heart);
    vec3 p = w * R;
    // The westerlies draw the weather out east and west.
    float storm = smoothstep(0.62, 0.8, al) * (1.0 - smoothstep(1.05, 1.22, al));
    float n = cloudWeather(p * vec3(1.0, 1.0 + 0.8 * storm, 1.0), 31) * 0.5 + 0.5;
    float f = cloudShowers(p, 32) * 0.5 + 0.5;
    float sea = smoothstep(10.0, -40.0, g.x);
    float wet = max(g.w, 0.6 * sea);
    // The general circulation by latitude: the rain belt (wandering a few
    // degrees with the noise), the subtropics' highs, the storm tracks,
    // the poles.
    float itcz = exp(-pow((lat - 0.06 * (n - 0.5)) / 0.11, 2.0));
    float subtrop = exp(-pow((al - 0.47) / 0.15, 2.0));
    float polar = smoothstep(1.2, 1.38, al);
    float cloudy = 0.02 + 0.55 * itcz + 0.3 * storm - 0.5 * subtrop - 0.35 * polar;
    cloudy *= mix(0.35, 1.1, wet);
    // The broken weather: where the noise lifts it, and every low's heart;
    // most of the world either clear or overcast, broken between (a
    // region's cover half and half is a grey veil from afar).
    float cover = smoothstep(0.3, 0.75, cloudy + (n - 0.5) * 1.3 + (f - 0.5) * 0.35 + 0.65 * heart);
    // The fronts: overcast bands, a thousand kilometres and more.
    float front = lowFronts(up) * (0.85 + 0.3 * (f - 0.5));
    cover = max(cover, front);
    // The subtropics' marine stratocumulus: a low deck in closed cells over
    // the cool sea under the highs.
    float sc = sea * subtrop * (1.0 - smoothstep(0.7, 0.95, al)) * smoothstep(0.42, 0.62, f);
    cover = max(cover, 0.9 * sc);
    // Fair weather's cumulus over temperate land that is not dry: the
    // summer afternoon's fields of them, the sky between.
    float fair = (1.0 - sea) * smoothstep(0.25, 0.6, g.w) * smoothstep(0.3, 0.5, al) * (1.0 - smoothstep(0.95, 1.15, al));
    cover = max(cover, 0.52 * fair * (0.7 + 0.8 * (f - 0.5)));
    // Heaped where the air is convective (warm, the rain belt, the trades,
    // fair weather), in slabs in the fronts, the lows' hearts and the decks.
    float convect = clamp(1.2 * (1.0 - smoothstep(0.35, 0.7, al)) + fair - 1.2 * heart - 1.5 * front - 1.5 * sc + 0.3 * (f - 0.5), 0.0, 1.0);
    // How high the tops reach: the rain belt's towers, the trades' and
    // fair weather's low cumulus, a front's thick nimbostratus, the
    // stratocumulus' thin deck.
    float towers = clamp(itcz * wet * 1.4 + 0.4 * (f - 0.5), 0.0, 1.0);
    float tops = mix(0.35 + 0.3 * max(heart, front), mix(0.18, 0.95, towers), convect);
    tops = mix(tops, 0.12, sc * (1.0 - front));
    return vec4(cover, convect, tops, sc * (1.0 - front));
}

vec3 heapHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}

// How far (m) a point v (m, from the ellipsoid's centre: horizontal x,
// vertical y) is inside an ellipsoid of half-axes r across and hgt up,
// at most (negative: outside); it changes no faster than the distance does.
float ellipsoidIn(vec2 v, float r, float hgt) {
    return (1.0 - length(v / max(vec2(r, hgt), 1.0))) * max(min(r, hgt), 1.0);
}

// The heaps: a cumulus about each point of a lattice HEAP_CELL metres a
// side that lies near the deck's bottom (so every view of a place sees
// the same ones), and a second one about it where the cover is fuller,
// each where the cover says there is one: half an ellipsoid on a flat base
// with two towers on it, as wide as the cover is full and as tall as the
// tops reach (each its own; towers only where the tops are high), the heap
// shrinking to nothing as the cover thins (none cut off). How far (m) a
// point at direction \`dir\` and \`z\` metres up the deck is inside the
// nearest, at most (negative: outside), its base BASE_SHARP times as
// steep (the bases flat: the engine's skin moves them little).
const float CLOUD_EDGE = ${CLOUD_EDGE}.0;
const float HEAP_CELL = 2500.0;
const float HEAP_SHELL = 0.35;   // the lattice's points within this many cells of the deck's bottom
const float BASE_SHARP = 3.0;
const float BASE_SPREAD = 80.0;  // how much the heaps' bases differ (m), about the field's
float heaps(vec3 dir, float z, float base, float tops, float cover) {
    const float rb = R + ${CLOUD_BOTTOM}.0, rc = rb / HEAP_CELL;
    vec3 g = dir * rc;
    vec3 c0 = floor(g);
    float zr = z - base;
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    // (A heap about a point beyond the cells searched is a cell off at
    // least, less its reach; and none reaches over its towers' tops.)
    float best = -max(0.35 * HEAP_CELL, zr - 1.2 * min(tops - base, 0.55 * HEAP_CELL * mix(0.8, 2.6, tall)));
    for (int i = 0; i < 54; ++i) {
        int j = i % 27, second = i / 27;
        vec3 cell = c0 + vec3(j % 3, (j / 3) % 3, j / 9) - 1.0;
        vec3 a = heapHash(cell + 31.7 * float(second));
        float present = second == 0 ? smoothstep(0.0, 0.6, cover) : smoothstep(0.4, 0.9, cover);
        float grow = smoothstep(a.x, a.x + 0.15, present);
        if (grow <= 0.0) continue;
        vec3 b = heapHash(cell + 17.31 + 31.7 * float(second));
        vec3 at = cell + 0.15 + 0.7 * b;
        float la = length(at);
        if (abs(la - rc) > HEAP_SHELL) continue;
        vec3 au = at / la;
        // (The point from the heap's foot, on the plane tangent there.)
        vec3 v = (dir - au) * rb;
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), au) + 1e-5);
        vec3 north = cross(au, east);
        vec2 hz = vec2(dot(v, east), dot(v, north));
        // (No wider than twice its height and a little: a low heap a small
        // dome, never a pancake whose rim thins to a sliver.)
        float r = HEAP_CELL * mix(0.42, 0.55, cover) * mix(0.8, 1.0, a.y);
        float hgt = min((tops - base) * mix(0.5, 1.0, a.z), r * mix(0.8, 2.6, tall));
        r = min(r, 2.0 * hgt + 200.0) * grow;
        hgt *= grow;
        // Its base: the field's condensation level, a few tens of metres
        // off it, cut flat; the dome's middle under it, so its walls rise
        // steep from the base's rim and the whole heap stands over every
        // point of the base (no thin rim the sun lights through).
        float zh = zr - BASE_SPREAD * (heapHash(cell + 5.13 + 31.7 * float(second)).x - 0.5);
        float d = ellipsoidIn(vec2(length(hz), zh + 0.4 * hgt), r, 1.4 * hgt);
        // The towers: over the body, a little off its middle each way.
        float ang = 6.2832 * b.z;
        vec2 o = vec2(cos(ang), sin(ang)) * 0.4 * r;
        d = max(d, ellipsoidIn(vec2(length(hz - o), zh - 0.45 * hgt), 0.55 * r, 0.75 * hgt));
        d = max(d, ellipsoidIn(vec2(length(hz + 0.8 * o.yx * vec2(-1.0, 1.0)), zh - 0.3 * hgt), 0.45 * r, 0.6 * hgt));
        best = max(best, min(d, zh * BASE_SHARP));
    }
    return min(best, (zr + 0.5 * BASE_SPREAD) * BASE_SHARP);
}

// The share of the air the heaps fill at \`z\` metres up the deck, on the
// mean (what the far deck reads: as heaps() makes them), rising over the
// first 300 m from their bases; under 0 below and above them, by how far.
float heapsShare(float z, float base, float tops, float cover) {
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    float r = HEAP_CELL * mix(0.42, 0.55, cover) * 0.9;
    float hgt = max(min((tops - base) * 0.75, r * mix(0.8, 2.6, tall)) * 1.1, 300.0);
    float n = 2.0 * HEAP_SHELL * (smoothstep(0.0, 0.6, cover) + smoothstep(0.4, 0.9, cover));
    float area = 3.1416 * r * r / (HEAP_CELL * HEAP_CELL) * 1.15;
    float s0 = 1.0 - exp(-n * area);
    float zr = z - base, hr = zr / hgt;
    if (zr < 0.0) return zr * BASE_SHARP / CLOUD_EDGE;
    if (hr > 1.0) return (hgt - zr) / CLOUD_EDGE;
    return min(s0 * zr / 300.0, s0 * (1.0 - hr * hr));
}

// The base: where the footprint is finer than the clouds, their shapes
// (the heaps, or a front's or a deck's slab with its own relief), rising
// from none to all over CLOUD_EDGE metres across their surfaces; where it
// is wider, the share of the air they fill there.
float cloudDensity(CloudPoint q) {
    float c = q.cover.x;
    if (c < 0.01) return 0.0;
    float convect = q.cover.y, cells = q.cover.w, h = q.height;
    const float DECK = ${CLOUD_TOP - CLOUD_BOTTOM}.0;
    // (Carried by the wind, as the engine's forms are.)
    vec3 p = cloudDrift(q.p);
    // The mesoscale, 160 km a tile: the decks' closed cells (40 km, their
    // rims clear) and the bases' slow rise and fall from place to place.
    const float TM = 160000.0;
    vec4 meso = cloudNoise(p / TM, q.footprint / TM);
    // The base: a few hundred metres over the deck's bottom, higher or
    // lower region by region (so a far field's bases are no ruled line).
    float base = 0.01 + 0.08 * meso.z;
    float top = base + max(q.cover.z, 0.06) * (1.0 - base);
    // The decks' closed cells; the fields' clusters (where the noise's
    // cells crowd them, the sky clear between).
    c *= mix(1.0, smoothstep(0.25, 0.55, meso.y), cells);
    c *= mix(1.0, 0.75 + 0.5 * meso.x, convect * (1.0 - cells));
    c = min(c, 1.0);
    // Heaped where the air is convective; in slabs (a front's, a low's
    // heart, a deck) where it is not.
    float wHeap = smoothstep(0.1, 0.35, convect);
    float z = h * DECK, zb = base * DECK, zt = top * DECK;
    // From afar: the share of the air the clouds fill (a slab cut nearly
    // square, its top a little ragged on the mean), under 0 below and over
    // them, by how far.
    float slabFar = smoothstep(0.42, 0.58, c) * min(min((z - zb) / 500.0, (zt - z) / 600.0), 1.0);
    float far = max(heapsShare(z, zb, zt, c) * wHeap, slabFar * (1.0 - wHeap));
    float fn = smoothstep(0.15 * HEAP_CELL, 0.6 * HEAP_CELL, q.footprint);
    if (fn >= 1.0) return far;
    // Near: the shapes. The slab's top heaves a few hundred metres over
    // some kilometres, its base less; where the cover is broken it parts
    // (the decks' cells, the fronts' edges).
    vec4 relief = cloudNoise(p / 9000.0, q.footprint / 9000.0);
    float st = zt - 700.0 * relief.x - 250.0 * relief.z;
    float sb = zb + 150.0 * relief.y;
    float slab = min(min((z - sb) * BASE_SHARP, st - z), (c - 0.5) * 6000.0);
    float heap = wHeap > 0.0 ? heaps(normalize(p), z, zb, zt, c) : -1e5;
    float sd = max(heap - 3000.0 * (1.0 - wHeap), slab - 3000.0 * wHeap);
    // (Under 0 in the clear air, by how far the nearest cloud is, which the
    // engine's march steps by.)
    return mix(min(0.5 + sd / CLOUD_EDGE, 1.0), far, fn);
}
`;
// (The clouds drift east, and a little north, at some 10 m/s.)
scene.setClouds({ module: CLOUDS, bottom: CLOUD_BOTTOM, top: CLOUD_TOP, data: LOWS, land,
                  forms: { extinction: 0.06, billowScale: 2400, detailScale: 1200, edge: CLOUD_EDGE },
                  wind: [9, 0, -3],
                  enabled: !((bro.app && bro.app.argv) || []).includes('noclouds') });

// --- views ---------------------------------------------------------------------------

// A place point `up` over the ground at place (x, z).
const over = (x, z, up) => [x, land.landHeight(x, z) + up, z];
// The body's centre in the place frame.
const centre = () => scene.toPlace([0, 0, 0]);
// The way to the highest ground within 60 km of the place's origin (unit, xz).
function towardRange() {
    let best = -Infinity, way = [0, -1];
    for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        for (const r of [20000, 40000, 60000]) {
            const x = r * c, z = r * s;
            // (The ground's height over the datum: the place's y less the curve's drop.)
            const h = land.landHeight(x, z) + (x * x + z * z) / (2 * R);
            if (h > best) { best = h; way = [c, s]; }
        }
    }
    return way;
}
const along = (w, d, up) => over(w[0] * d, w[1] * d, up);
export const SHOTS = {
    orbit:  { label: 'Orbit', near: 1e5, far: 6e7, eye: () => [0, 1.8e7, 0], look: centre, up: [0, 0, -1] },
    limb:   { label: 'Limb', near: 1e3, far: 2e7, eye: () => [0, 1.2e6, 0], look: () => [0, -2.4e5, -1.6e6] },
    region: { label: 'Region', near: 50, far: 4e6, eye: () => [0, 9e4, 0], look: () => [0, 0, -2.4e5] },
    low:    { label: 'Low', near: 1, far: 1e6, eye: () => over(0, 0, 1500), look: () => along(towardRange(), 30000, 0) },
    ground: { label: 'Ground', near: 0.1, far: 4e5, eye: () => over(0, 0, 1.8), look: () => along(towardRange(), 2000, 60) },
    sky:    { label: 'Sky', near: 0.1, far: 4e5, eye: () => over(0, 0, 1.8), look: () => along(towardRange(), 2000, 900) },
};

export const still = { view: null };
export function holdView(eye, look, near, far, up = [0, 1, 0]) { still.view = { eye, look, near, far, up }; }
// A shot is the place at START's: back there first, wherever a drag took
// the place since.
export function setShot(name) {
    const s = SHOTS[name];
    if (!s) return;
    scene.reanchorAt(START);
    holdView(s.eye(), s.look(), s.near, s.far, s.up);
}
// Let go of a held shot: the orbit camera takes over where it is, turning
// about what it looked at.
export function letGo() {
    const v = still.view;
    if (!v) return;
    still.view = null;
    Camera.orbitFromView(vp.cam, { position: v.eye, target: v.look, up: v.up, near: v.near, far: v.far });
}
// The orbit camera moves with the place when it re-anchors.
scene.addEventListener('reanchor', (e) => Camera.orbitMove(vp.cam, e));
// The eye's height over the ground (or the sea) under it.
function eyeHeight(pos) {
    const ground = Math.max(land.landHeight(pos[0], pos[2]) + (pos[0] ** 2 + pos[2] ** 2) / (2 * R), 0);
    const b = scene.toBody(pos);
    return Math.hypot(b[0], b[1], b[2]) - R - ground;
}
// The wheel zooms by the eye's height, a notch a quarter of it: from orbit
// to the grass at one pace, in some 60 notches.
vp.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (still.view) letGo();
    const cam = vp.cam, h = Math.max(eyeHeight(cam.pos), 2);
    cam.dist = Math.min(Math.max(cam.dist - h * (1 - Math.exp(e.deltaY * 0.006)), 2), 6e7);
});
vp.onView((view) => {
    if (!still.view) {
        // Free: never under the ground, and the near and far planes from the
        // eye's height (a planet from 20,000 km and a meadow from 2 m).
        const cam = vp.cam;
        const alt = eyeHeight(cam.pos);
        if (alt < 2) {
            const up = scene.upAt(cam.pos);
            for (let i = 0; i < 3; i++) {
                cam.pos[i] += up[i] * (2 - alt);
                view.target[i] += up[i] * (2 - alt);
            }
            view.position = cam.pos.slice();
        }
        const h = Math.max(alt, 2);
        view.near = Math.min(Math.max(0.05 * h, 0.1), 1e5);
        view.far = Math.max(4e5, 3 * h + 2 * Math.sqrt(2 * R * h));
        return;
    }
    view.position = still.view.eye;
    view.target = still.view.look;
    view.up = still.view.up;
    view.near = still.view.near;
    view.far = still.view.far;
});
setShot('orbit');
