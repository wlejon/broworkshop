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
