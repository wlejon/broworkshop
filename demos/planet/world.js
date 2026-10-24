// The planet world: an Earth-sized body whose land is made by its processes
// (terrain.js: plates and their belts, the continents on them, the rivers
// that drain and carve them, the climate) over a FastNoise tree of the fine
// relief, and whose surface is what that climate grows. The views and the
// capture script share it.
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { SUN_LUX, AIR } from "/lib/kit/sky.js";
import { herbModule } from "/lib/herbs/index.js";
import { swardModule } from "/lib/sward/index.js";
import { treeModule, treeSpecies } from "/lib/trees/index.js";
import { TEMPERATE, BROADLEAF, BIRCH, CONIFER, SHRUB, OAK, LIME } from "/lib/trees/temperate.js";
import { R, SEED, N, add, mul, fbm, TREE, PROCESSES, ARGV } from "/app/terrain.js";

export { R };

export const vp = sceneViewport('#stage', {
    // (Yaw about the view's own up: the globe turns under a drag from any side.)
    orbit: { target: [0, 0, 0], dist: 3e7, fov: 40, near: 1e4, far: 1e8, rot: orbitRotation(0, -1.2), yawAxis: 'view' },
    // (The wheel is the planet's own, below.)
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 6e7, zoomRate: 0 },
});
export const { scene } = vp;

// --- the surface ----------------------------------------------------------------------

// What grows where, by the climate: warm or cold by latitude and height,
// wet or dry by the belts of the air's circulation and the sea's reach.
const SURFACE = `
// How far past the ice line the broad climate is at a point (degrees: the
// line a land this wet holds to, less the year's mean of its broad ground);
// landSurface's ice reads its gradient for how wide its edge is.
float iceClimate(vec3 at, vec3 up) {
    float sl = up.y;
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * max(landGrid(0, at).x, 0.0) / 1000.0;
    return mix(-22.0, -7.0, smoothstep(0.15, 0.65, landGrid(1, at).w)) - temp;
}

LandSurface landSurface(LandPoint q) {
    vec4 g = landGrid(1, q.at);
    float ground = landGrid(0, q.at).x;   // (the processes' ground; g.x is the catchment's log)
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
    // heights: snow on its crests and a tree line up its flanks. A plain's
    // hills keep none: a few hundred metres there are a degree or two, yet
    // where the year sits near a line they flecked a polar plain with snow
    // and tundra blob by blob from orbit.
    float share = smoothstep(0.3, 0.7, g.y);
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * mix(max(ground, 0.0), h, share) / 1000.0;
    // The relief the height here lacks, as each line's spread over it: the
    // tree's grain a texel this wide holds at its mean, and each regional
    // level's band (terrain.js) as far as the level is not in here (past
    // the regions about the eye, or read by a texel wider than its cells),
    // so a far range's crests are a share of snow, not snow or rock texel
    // by texel, and the land past the regions is the same share as the land
    // in them seen from as far.
    float fp = q.footprint;
    #define LACKS(level, amp) ((amp) * (1.0 - landGridCover(level, q.at)))
    // (The tree's grain only where the temperature reads h, a range; the
    // bands wherever: the regions' ground carries them too.)
    float hidden = landGrid(0, q.at).y * (3.0 * share * min(fp / 120.0, 1.0) + LACKS(0, 30.0) + LACKS(1, 120.0) +
                                          LACKS(2, 330.0) + LACKS(3, 520.0));
    float spread = 6.5 * hidden / 1000.0;
    #define COLD(warm, cold) smoothstep((warm) + spread, (cold) - spread, temp)
    #define WARM(cold, warm) smoothstep((cold) - spread, (warm) + spread, temp)
    // The processes' (the plants' woods read the same), and wetter down the
    // valleys where the drainage gathers (from a few km² of catchment; g.x
    // is its log10).
    // (A big river runs green through dry country: its banks watered from
    // upstream however dry the air over them.)
    float wet = clamp(g.w + 0.25 * smoothstep(0.5, 3.0, g.x) + 0.35 * (1.0 - g.w) * smoothstep(3.7, 5.2, g.x), 0.0, 1.0);
    float steep = 1.0 - q.normal.y;
    // How open the country reads from far up: the interfluves (the least
    // catchment, the log's smooth field) drier and paler than the valleys
    // that gather the water, so the drainage reads as dark threads in
    // lighter ground and the relief as value, not as one green.
    float open = 1.0 - smoothstep(-1.0, 2.5, g.x);

    // Bare ground by how dry (ochre sand to tan steppe), what grows over it
    // by how wet and how warm: a warm wet lowland's deep broadleaf green, a
    // cold one's darker conifer, a dry or cool one's lighter yellow-green.
    // (Linear albedos as Earth's from orbit: a forest's 0.04 to 0.06, its
    // conifers darkest; grassland's some 0.11; steppe's 0.2; sand's 0.35.)
    vec3 desert = vec3(0.50, 0.35, 0.19), steppe = vec3(0.27, 0.21, 0.11);
    vec3 grassWarm = vec3(0.085, 0.13, 0.035), grassCool = vec3(0.09, 0.115, 0.05);
    vec3 forestWarm = vec3(0.024, 0.058, 0.016), forestCold = vec3(0.022, 0.042, 0.022);
    vec3 tundra = vec3(0.13, 0.13, 0.07), rock = vec3(0.20, 0.18, 0.15);
    vec3 snow = vec3(0.82, 0.84, 0.87);
    float warmth = WARM(4.0, 20.0);
    vec3 grass = mix(grassCool, grassWarm, warmth), forest = mix(forestCold, forestWarm, warmth);
    vec3 c = mix(desert, steppe, smoothstep(0.08, 0.24, wet));
    c = mix(c, grass, smoothstep(0.24, 0.38, wet));
    c = mix(c, forest, smoothstep(0.36, 0.54, wet) * WARM(-2.0, 6.0));
    // (The open uplands between the valleys a shade drier: grass and
    // steppe showing through the woods there.)
    c = mix(c, mix(steppe, grass, smoothstep(0.2, 0.4, wet)), 0.2 * open * (1.0 - smoothstep(0.25, 0.45, wet)));
    c = mix(c, tundra, COLD(2.0, -6.0));
    // Bare rock where it is steep and high (a range, or above the trees):
    // a lowland's steep hillsides are wooded or grassed over, not a net of
    // grey crests across every hill.
    // (A range's flanks wooded where the air is still mild up them, bare
    // as it cools toward the tree line.)
    float alpine = max(smoothstep(0.15, 0.5, g.y) * mix(0.4, 1.0, COLD(9.0, 3.0)), COLD(4.0, -2.0));
    c = mix(c, rock, smoothstep(0.3, 0.55, steep) * alpine);
    // Above the trees the ground thins to scree and rock whatever its
    // slope, so the rock hands over to the snow, not tundra to snow.
    c = mix(c, rock, 0.5 * COLD(-3.0, -8.0) * alpine);
    // Ice where the year is cold and the snow falls deep enough to outlast
    // the summers: the wetter the air, the warmer the line it holds to
    // (a maritime icefield's mean near -7 here, a dry land's none above
    // -22: a cold desert is tundra and bare rock, not ice). (This climate's
    // means run some 5 degrees under Earth's at 45 to 65 degrees, so its
    // lines sit as far under Earth's.) The margin follows the ground: the
    // ice flows down the valleys that gather it (outlet glaciers), the
    // low coasts melt it back (dark strips), and the relief that stands
    // over its neighbours (ridges, nunataks) stands clear of it near its
    // edge; deep inside the sheet all of it is buried.
    float relief = h - ground;
    float valley = smoothstep(0.5, 3.5, g.x);
    float iceLine = mix(-22.0, -7.0, smoothstep(0.15, 0.65, g.w));
    float m = iceLine - temp + 3.0 * valley - 4.0 * (1.0 - smoothstep(0.0, 500.0, ground)) * (1.0 - valley)
            - 6.0 * relief / 1000.0;
    // The edge as sharp as the view: the broad climate's change over two
    // texels (or 1.5 km, so the grid's bilinear cells do not draw their
    // kinks), and on a range the relief a texel hides. (A margin drawn
    // with a fixed width of degrees lay a hundred km soft over a plateau,
    // whose climate changes a degree in as far: a bank of fog.)
    vec3 t1 = normalize(cross(q.up, abs(q.up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(q.up, t1);
    const float D = 2000.0;
    vec2 grad = vec2(iceClimate(q.at + t1 * D, normalize(q.up + t1 * (D / ${R}.0))) - iceClimate(q.at - t1 * D, normalize(q.up - t1 * (D / ${R}.0))),
                     iceClimate(q.at + t2 * D, normalize(q.up + t2 * (D / ${R}.0))) - iceClimate(q.at - t2 * D, normalize(q.up - t2 * (D / ${R}.0)))) / (2.0 * D);
    float w = max(length(grad) * max(2.0 * fp, 1500.0), 0.02) + 0.5 * spread * share;
    float ice = smoothstep(-w, w, m) * (1.0 - smoothstep(0.45, 0.75, steep));
    // (Its accumulation zone a snow's white; down toward the margin the
    // bare ice of its ablation zone, greyer and bluer.)
    // (By the broad climate alone: the ground's grain would mottle it.)
    vec3 iceC = mix(vec3(0.45, 0.53, 0.62), vec3(0.76, 0.80, 0.86), smoothstep(0.0, 5.0, iceLine - temp + 3.0 * valley));
    // The year's late snow past the ice: patches on the ridges and high
    // ground where it is cold enough, the valleys and steep faces clear.
    float lie = (iceLine + 4.0) - temp + 8.0 * relief / 1000.0 - 3.0 * valley;
    float patches = 0.8 * smoothstep(-w, w, lie) * (1.0 - smoothstep(0.35, 0.6, steep));
    c = mix(c, snow, patches * (1.0 - ice));
    c = mix(c, iceC, ice);
#ifdef DRAINAGE
    // (The rivers' catchments: blue from 10 km² to a million.)
    c = mix(vec3(0.3, 0.28, 0.25), vec3(0.0, 0.05, 0.5), smoothstep(1.0, 6.0, g.x));
#endif
#ifdef WETNESS
    // (How wet: red dry, through yellow, to blue wet.)
    c = mix(mix(vec3(0.5, 0.05, 0.02), vec3(0.45, 0.4, 0.05), smoothstep(0.0, 0.5, g.w)), vec3(0.02, 0.08, 0.5), smoothstep(0.5, 1.0, g.w));
#endif
#ifdef TEMPERATURE
    // (The year's mean: blue under -20 C, white at -10, green at 0, red
    // over 20; a dark band every 5 degrees of it, a line every 10 degrees
    // of latitude.)
    c = temp < -10.0 ? mix(vec3(0.02, 0.05, 0.5), vec3(0.6), smoothstep(-20.0, -10.0, temp))
      : temp < 0.0 ? mix(vec3(0.6), vec3(0.05, 0.4, 0.05), smoothstep(-10.0, 0.0, temp))
      : mix(vec3(0.05, 0.4, 0.05), vec3(0.6, 0.05, 0.02), smoothstep(0.0, 20.0, temp));
    c *= mix(0.4, 1.0, smoothstep(0.0, 0.08, abs(fract(temp / 5.0 + 0.5) - 0.5)));
    // (30 degrees black, 40 red, 50 yellow, 60 cyan, 70 magenta.)
    float tens = floor(abs(degrees(lat)) / 10.0 + 0.5);
    vec3 lineC = tens < 3.5 ? vec3(0.0) : tens < 4.5 ? vec3(1.0, 0.0, 0.0) : tens < 5.5 ? vec3(1.0, 1.0, 0.0) : tens < 6.5 ? vec3(0.0, 1.0, 1.0) : vec3(1.0, 0.0, 1.0);
    c = mix(c, lineC, 1.0 - smoothstep(0.0, 0.008, abs(fract(degrees(lat) / 10.0 + 0.5) - 0.5)));
#endif
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

export const land = scene.createLand({ height: TREE, seed: SEED, surface: (ARGV.includes('drainage') ? '#define DRAINAGE\n' : '') + (ARGV.includes('wetness') ? '#define WETNESS\n' : '') + (ARGV.includes('temperature') ? '#define TEMPERATURE\n' : '') + SURFACE, processes: PROCESSES, sea: { level: 0, absorb: [0.6, 0.18, 0.12] } });

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
// (Drawn as far as they are placed: the land is their canopy from the
// node's range on, so a range past the rules' left a band with neither.)
export const plants = scene.createPlants({
    module: treeModule(), species: TEMPERATE.map(treeSpecies), receivesShadow: true, range: 6000, land,
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
    // Where the place lies in the frame lowCommas reads a low at `lat`,
    // `lon` of `size` in (x east, y poleward, in its sizes): Infinity on
    // the far side.
    const placeDir = START.map((x) => x / R);
    const reach = (lat, lon, size) => {
        const c = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
        const cd = c[0] * placeDir[0] + c[1] * placeDir[1] + c[2] * placeDir[2];
        if (cd < 0.4) return Infinity;
        const nl = Math.hypot(-c[0] * c[1], 1 - c[1] * c[1], -c[2] * c[1]);
        const north = [-c[0] * c[1] / nl, (1 - c[1] * c[1]) / nl, -c[2] * c[1] / nl];
        const v = placeDir.map((x, k) => (x - c[k] * cd) / cd);
        const east = [c[1] * north[2] - c[2] * north[1], c[2] * north[0] - c[0] * north[2], c[0] * north[1] - c[1] * north[0]];
        const qx = (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]) / size;
        const qy = (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]) * Math.sign(lat) / size;
        return [qx, qy];
    };
    // Whether a low's cloud (lowCommas': its head and bands, its cold
    // front, its warm front's shield) reaches the place, with a margin.
    const reaches = (lat, lon, size) => {
        const q = reach(lat, lon, size);
        if (q === Infinity) return false;
        const [x, y] = q;
        if (Math.hypot(x, y) < 2.7) return true;
        const s = Math.min(Math.max(-y - 0.3, 0), 3.6);
        if (-y - 0.3 > -0.5 && -y - 0.3 < 4.0 && Math.abs(x - (0.45 - 0.1 * s - 0.2 * s * s)) < 0.9) return true;
        const yr = y - (-0.3 - 0.3 * (x - 0.45));
        return x > 0.0 && x < 2.3 && yr > -0.4 && yr < 1.4;
    };
    // (Each hemisphere's storm track holds eight, their longitudes spread
    // about the world with a little wander, as the westerlies' lows are;
    // none whose weather reaches the place, whose sky is a fair day's, so
    // one that would is moved on east.)
    for (let i = 0; i < 16; i++) {
        const lat = (i % 2 ? -1 : 1) * (0.68 + 0.32 * rnd());
        let lon = ((i >> 1) + (i % 2) * 0.5 + 0.5 * (rnd() - 0.5)) / 8 * Math.PI * 2;
        const size = 0.17 + 0.08 * rnd();
        for (let k = 0; k < 8 && reaches(lat, lon, size); k++) lon += Math.PI / 16;
        low(lat, lon, 1.0 + 1.0 * rnd(), size, 0.3 + 0.3 * rnd(), 0);
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
// the climate the land's processes reckon (channel 1's w, how wet; channel
// 0's x the ground, under the sea too): the rain belt a narrow broken line north of
// the equator, clusters of towers and anvils; the subtropics' highs clear,
// but for the trades' cumulus over the sea and sheets of stratocumulus in
// cells off the western coasts (land to the east); the westerlies' storm
// tracks, eight lows a hemisphere, each a broad swirling system 1500 to
// 3000 km across: its head a shield wound into spiral bands of varying
// width and brightness with gaps between and a dry slot wrapping in, its
// cold front a broken band 200 to 400 km wide trailing equatorward some
// thousands of kilometres and fraying toward its tail, its warm front's
// shield to the east, and behind it over the sea the cold air's open cells
// (a honeycomb veil from afar), as over the storm tracks' seas between
// them; the tropical cyclones' dense discs, clear eyes and spiral bands;
// fair weather's cumulus over moist land; thin cloud over the
// poles' ice. Every shape read through a bent direction (cloudBent), so no
// edge is ruled, and every share a mean over the footprint, so from orbit
// a field of heaps is a veil at its cover.
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
        // (A westerly low's heart is its comma's: lowCommas. A tropical
        // cyclone's is a dense disc, its eye clear and a few tens of
        // kilometres across, and spiral bands winding in to it from some
        // three of its sizes out, gaps between them.)
        float h = 0.4 * exp(-0.5 * s * s);
        if (b.z > 0.0) {
            vec3 t1 = normalize(cross(a.xyz, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
            float ang = atan(dot(d, cross(a.xyz, t1)), dot(d, t1));
            float psi = ang + sign(a.w) * 4.5 * log(max(s, 0.1));
            float arms = smoothstep(0.35, 0.85, cos(3.0 * psi)) * smoothstep(3.4, 0.8, s);
            float disc = smoothstep(0.9, 0.45, s);
            h = mix(h, max(disc, 0.6 * arms) * smoothstep(0.06, 0.16, s), b.z);
        }
        heart = max(heart, b.y * h);
    }
    return d;
}

// A soft band: 1 within half of \`w\` of its line, 0 from \`w\` on.
float bandOf(float d, float w) { return smoothstep(w, 0.25 * w, d); }

// The westerlies' lows (the extratropical ones, no eye), each a broad
// swirling system, in its frame (x east, y poleward, in its sizes, some
// 1000 to 1600 km; so the south's mirror the north's and turn the other
// way). The head a shield some two and a half sizes across about the
// centre, poleward and west of it, in spiral bands of the air winding in
// (logarithmic, three arms, their width and brightness varied by the
// texture \`t\`), thinner between them, the bands going on thinner past the
// shield; the dry slot a clear arm wrapping in from the south-west to the
// centre. The cold front from the triple point (east and a little
// equatorward of the centre) a band trailing equatorward and west some
// three and a half sizes, a few thousand kilometres, 200 to 400 km wide
// and widening, broken by the texture and fraying toward its tail; the
// warm front's shield poleward of its line, east of the triple point.
// Behind the cold front and under the head the cold air's open cells. x
// the overcast (slabs), y the open cells' share (heaps), z how much of
// either is a low's. \`p\` the point the texture is read at (m), \`f\` the
// showers' noise there (0 .. 1, its mean a half), what breaks the front.
vec3 lowCommas(vec3 d, vec3 p, float f) {
    vec3 best = vec3(0.0);
    float t = cloudNoise(p / 7.0e5, 1.0 / 64.0).x;                       // (some 90 km)
    float t2 = cloudNoise(vec3(p.z, p.y, p.x) / 2.6e5, 1.0 / 64.0).x;    // (some 30 km)
    float tex = 0.65 * t + 0.35 * t2;
    for (int i = 0; i < LOWS; ++i) {
        vec4 a = cloudData(2 * i), b = cloudData(2 * i + 1);
        if (b.z > 0.5) continue;
        vec3 c = a.xyz;
        float cd = dot(d, c);
        if (cd < 0.4) continue;
        float hemi = sign(a.w);
        vec3 north = normalize(vec3(0.0, 1.0, 0.0) - c * c.y);
        vec3 east = cross(c, north);
        vec3 v = (d - c * cd) / cd;   // (on the plane tangent at the low)
        vec2 q = vec2(dot(v, east), dot(v, north) * hemi) / b.x;
        float r = length(q);
        if (r > 4.5) continue;
        float ang = atan(q.y, q.x);
        // The spiral's phase: constant along an arm winding in the way the
        // air turns, its radius falling by e in some 0.6 of a turn.
        float psi = ang + 2.4 * log(max(r, 0.22)) + 5.0 * (t - 0.5);
        float arms = cos(2.0 * psi + 2.5 * (t2 - 0.5));
        float shieldAt = length(q - vec2(-0.15, 0.15));
        float shield = smoothstep(1.45, 0.75, shieldAt);
        float head = shield * mix(0.55, 1.0, smoothstep(-0.4, 0.5, arms)) * mix(0.8, 1.05, tex);
        head = max(head, 0.75 * smoothstep(2.4, 1.2, r) * smoothstep(0.35, 0.85, arms) * smoothstep(0.3, 0.6, tex));
        // The dry slot: the arm through the south-west a size out.
        float dpsi = mod(psi - (-2.1) + 3.1416, 6.2832) - 3.1416;
        float dry = smoothstep(0.75, 0.25, abs(dpsi)) * smoothstep(1.6, 1.0, r) * smoothstep(0.08, 0.25, r);
        head *= 1.0 - 0.95 * dry;
        // The cold front: x(s) = 0.45 - 0.1 s - 0.2 s^2 at y = -0.3 - s.
        float s = clamp(-q.y - 0.3, 0.0, 3.6);
        float slope = -0.1 - 0.4 * s;
        float xf = 0.45 - 0.1 * s - 0.2 * s * s;
        float dist = abs(q.x - xf) / sqrt(1.0 + slope * slope);
        float fray = s / 3.6;
        float w = mix(2.0e5, 4.0e5, fray) / (b.x * R);
        float cold = bandOf(dist, w) * smoothstep(3.6, 2.6, s) * smoothstep(0.2, -0.05, q.y + 0.3);
        // (Broken: cells of cloud a few tens of kilometres across with
        // gaps between, more of them gaps toward the tail and its edges.)
        float brk = 0.55 + 2.2 * (f - 0.5) + 0.35 * (1.0 - dist / w) - 0.45 * fray;
        cold *= mix(0.3, 1.0, smoothstep(0.25, 0.75, brk));
        // The warm front's shield: poleward of its line from the triple
        // point east and a little equatorward, some size deep.
        float yl = -0.3 - 0.3 * (q.x - 0.45);
        float yr = q.y - yl;
        float warm = smoothstep(-0.1, 0.08, yr) * smoothstep(1.1, 0.5, yr) * smoothstep(0.2, 0.5, q.x) *
                     smoothstep(2.0, 1.3, q.x) * mix(0.7, 1.0, tex);
        float over = max(max(cold, head), 0.85 * warm);
        // The cold air behind the front and under the head's tail.
        float behind = smoothstep(0.05, 0.5, xf - q.x) * smoothstep(-0.4, 0.3, -q.y) * smoothstep(4.4, 3.0, r);
        best = max(best, vec3(over, 0.6 * max(behind, 0.6 * dry), smoothstep(4.5, 3.0, r)));
    }
    return best;
}

// The direction the weather's shapes are read at: bent by the engine's
// noise (two turned tiles, some 1500 and 400 km) a few hundred kilometres
// and less, so no front or deck has a ruled edge.
vec3 cloudBent(vec3 d) {
    vec3 p = d * R;
    vec4 a = cloudNoise(p / 1.5e6, 1.0 / 16.0);
    vec4 b = cloudNoise(vec3(p.z, p.x, p.y) / 4.1e5, 1.0 / 16.0);
    vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), d) + 1e-5);
    vec3 n = cross(d, e);
    vec2 m = 0.035 * (a.yz - 0.5) + 0.012 * (b.yz - 0.5);
    return normalize(d + e * m.x + n * m.y);
}

// How much land lies east of \`up\` within some 25 degrees, the nearer
// weighing the more, and a little north and south of the line east: where
// a subtropical ocean's cold eastern side lies. Smooth (a mean, not the
// nearest coast's line), so a deck fades out westward.
float landEast(vec3 up) {
    vec3 e = normalize(cross(up, vec3(0.0, 1.0, 0.0)) + 1e-5);
    vec3 nn = cross(e, up);
    float sum = 0.0, wsum = 0.0;
    for (int k = 1; k <= 16; ++k) {
        float t = 0.027 * float(k), wk = 1.0 - 0.045 * float(k);
        for (int j = -1; j <= 1; ++j) {
            vec3 dk = normalize(up * cos(t) + e * sin(t) + nn * (0.04 * float(j)));
            // (Land and the shelf sloping off it: the sea's depth is smooth
            // where the coast's line is the grid's texels.)
            sum += wk * smoothstep(-3000.0, 0.0, cloudLandGrid(1, dk).x);
            wsum += wk;
        }
    }
    return smoothstep(0.03, 0.5, sum / wsum);
}

vec4 cloudCover(vec3 up) {
    vec4 g = cloudLandGrid(1, up);
    float lat = asin(clamp(up.y, -1.0, 1.0)), al = abs(lat);
    float heart;
    vec3 bent = cloudBent(up);
    vec3 w = swirled(bent, heart);
    vec3 p = w * R;
    // The westerlies draw the weather out east and west.
    float storm = smoothstep(0.62, 0.8, al) * (1.0 - smoothstep(1.05, 1.22, al));
    float n = cloudWeather(p * vec3(1.0, 1.0 + 0.8 * storm, 1.0), 31) * 0.5 + 0.5;
    float f = cloudShowers(p, 32) * 0.5 + 0.5;
    float sea = smoothstep(10.0, -40.0, cloudLandGrid(0, up).x);
    float wet = max(g.w, 0.6 * sea);
    // Where the weather's systems are broken up (the rain belt's clusters,
    // the decks' extent): the engine's soft billows, some 1200 and 2400 km
    // a tile, so what they pick out is hundreds of kilometres across with
    // soft edges, never the showers' finer octaves' speckle.
    vec4 m1 = cloudNoise(p / 1.2e6, 1.0 / 16.0);
    vec4 m2 = cloudNoise(vec3(p.y, p.z, p.x) / 2.4e6, 1.0 / 16.0);
    // The rain belt: a narrow line a few degrees north of the equator,
    // wandering, broken into clusters of towers and their anvils.
    float itczLat = 0.08 + 0.07 * (n - 0.5);
    float itcz = exp(-pow((lat - itczLat) / 0.05, 2.0));
    vec4 mc = cloudNoise(p / 1.1e6, 1.0 / 64.0);   // (its cells some 280 km)
    float clusters = smoothstep(0.3, 0.75, mc.y + 0.25 * (m1.x - 0.5));
    float rain = itcz * mix(0.25, 1.0, clusters) * mix(0.6, 1.0, wet);
    // The subtropics' highs: clear, but for the trades' cumulus over the
    // sea and the decks of stratocumulus on the oceans' cold eastern sides
    // (land to the east), thinning westward into the trades.
    float subtrop = exp(-pow((al - 0.47) / 0.17, 2.0));
    float tropics = 1.0 - smoothstep(0.45, 0.62, al);
    float trades = sea * tropics * (0.24 + 0.16 * (m1.x - 0.5) + 0.05 * (f - 0.5)) * (1.0 - 0.6 * itcz);
    float sc = sea * smoothstep(0.17, 0.3, al) * (1.0 - smoothstep(0.62, 0.78, al)) * landEast(up) *
               smoothstep(0.3, 0.55, m2.x + 0.3 * (n - 0.5));
    // The storm tracks: the lows' commas, and between them broken weather
    // where the noise lifts it.
    vec3 lows = lowCommas(bent, p, f);
    float track = storm * (1.0 - 0.7 * lows.z);
    float broken = track * smoothstep(0.5 - 0.12 * sea, 1.0, n + 0.3 * (m1.x - 0.5)) * 0.9;
    float polar = smoothstep(1.2, 1.38, al) * smoothstep(0.35, 0.65, n) * 0.8;
    // The tropical cyclones' and the lows' hearts.
    float hearts = smoothstep(0.25, 0.7, heart);
    // (Each thinned and parted here and there, a few hundred kilometres
    // and less: an overcast's texture from afar, its breaks near. The lows
    // carry their own.)
    float grain = clamp(0.82 + 0.6 * (f - 0.5) + 0.3 * (m1.x - 0.5), 0.0, 1.0);
    float over = max(lows.x, max(broken, max(polar, hearts)) * grain);
    // The cold air over the storm tracks' seas, about and behind the lows:
    // open cells, cumulus on the rims of cells some 50 km across with clear
    // air in their middles, a honeycomb veil from afar.
    float honey = smoothstep(0.3, 0.75, 1.0 - cloudNoise(p / 2.2e5, 1.0 / 128.0).y);
    float coldAir = max(lows.y * sea, storm * sea * (0.55 + 0.3 * (m1.x - 0.5)));
    coldAir = min(coldAir * mix(0.45, 1.35, honey), 0.85);
    // Fair weather's cumulus over temperate land that is not dry: the
    // summer afternoon's fields of them, the sky between.
    float fair = (1.0 - sea) * smoothstep(0.25, 0.6, g.w) * smoothstep(0.3, 0.5, al) * (1.0 - smoothstep(0.95, 1.15, al));
    float heaps = max(max(trades, coldAir), max(0.52 * fair * (0.7 + 0.8 * (f - 0.5)), 0.6 * rain));
    // The slabs: the fronts, the hearts, the broken weather, the decks and
    // the rain belt's anvils; the heaps in the sky they leave.
    float slabs = max(max(over, 0.9 * sc), rain * clusters * 0.95);
    float cover = slabs + heaps * (1.0 - slabs);
    // Heaped where the air is convective (the rain belt, the trades, fair
    // weather, the cold air's cells): the share of the cover the heaps are
    // (so a deck's edge into the trades blends, never switches), and the
    // rain belt's towers.
    float convect = clamp(heaps * (1.0 - slabs) / max(cover, 1e-3) + rain * 0.4, 0.0, 1.0);
    // How high the tops reach: the rain belt's towers, the trades' and
    // fair weather's low cumulus, a front's thick nimbostratus, the
    // stratocumulus' thin deck.
    float towers = clamp(rain * 1.3 + 0.2 * (f - 0.5), 0.0, 1.0);
    float tops = mix(0.4 + 0.3 * max(hearts, lows.x), mix(0.2, 0.95, towers), convect);
    float cells = sc * (1.0 - over);
    tops = mix(tops, 0.12, cells);
    return vec4(cover, convect, tops, cells);
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
// the same ones), and a fragment beside it where the cover is fuller,
// each where the cover says there is one (and the heaps clump): half an
// ellipsoid on a flat base with two towers on it, as wide as the cover is
// full (and its own size, most small and a few large) and as tall as the
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
const float HEAP_SMALL = 0.4, HEAP_BIG = 1.3, HEAP_SKEW = 1.3;   // a heap's size (of the cover's), u^HEAP_SKEW between
const float HEAP_SIZE2 = 0.70;   // the mean of its square
const float HEAP_CLUMP_MOST = 1.7;   // how much more of the heaps a clump holds at most
const float HEAP_REACH = 0.8;   // the furthest (cells) a heap reaches from its foot: a tower, 1.1 r of the largest, or a fragment
float heaps(vec3 dir, float z, float base, float tops, float cover) {
    const float rb = R + ${CLOUD_BOTTOM}.0, rc = rb / HEAP_CELL;
    vec3 g = dir * rc;
    vec3 c0 = floor(g);
    float zr = z - base;
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    // (A heap about a point beyond the cells searched is as far off as the
    // searched block's nearest wall, a cell and more, less its reach:
    // HEAP_REACH, a large heap's tower or a fragment off its side; and none
    // reaches over its towers' tops. The wall's own distance, not the
    // least of it: in clear air between heaps that is the step a view takes.)
    vec3 fr = g - c0;
    vec3 wall = 1.0 + min(fr, 1.0 - fr);
    float off = (min(min(wall.x, wall.y), wall.z) - HEAP_REACH) * HEAP_CELL;
    float best = -max(off, zr - 1.2 * min(tops - base, 0.55 * HEAP_CELL * HEAP_BIG * mix(0.8, 2.6, tall)));
    float present = smoothstep(0.0, 0.6, cover);
    float fragments = smoothstep(0.15, 0.7, cover), fragBig = smoothstep(0.4, 0.9, cover);
    for (int i = 0; i < 27; ++i) {
        vec3 cell = c0 + vec3(i % 3, (i / 3) % 3, i / 9) - 1.0;
        vec3 a = heapHash(cell);
        if (a.x > present * HEAP_CLUMP_MOST) continue;
        vec3 b = heapHash(cell + 17.31);
        // (Anywhere in its cell: the shell takes the points a thin slab of
        // the lattice holds, so with feet kept off the cells' walls whole
        // rows of cells along a lattice axis lying nearly level are in or
        // out together, rows of heaps and of gaps. A foot anywhere in its
        // cell is in the shell by the share of the cell the shell holds,
        // the same everywhere, and the heaps lie as irregularly as their
        // feet: some close, some far apart.)
        vec3 at = cell + b;
        float la = length(at);
        if (abs(la - rc) > HEAP_SHELL) continue;
        vec3 au = at / la;
        // The heaps clump: a noise some 14 km a tile (its lumps a few
        // kilometres) raises and lowers how many stand, so they gather in
        // groups with wide gaps of clear sky between, not a lattice's even
        // spread. (Its mean leaves the share as the cover says.)
        float clump = clamp(1.0 + 2.2 * (cloudNoise(au * (rb / 14000.0), 1.0 / 64.0).x - 0.62), 0.25, HEAP_CLUMP_MOST);
        float grow = smoothstep(a.x, a.x + 0.15, present * clump);
        if (grow <= 0.0) continue;
        // (The point from the heap's foot, on the plane tangent there.)
        vec3 v = (dir - au) * rb;
        vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), au) + 1e-5);
        vec3 north = cross(au, east);
        vec2 hz = vec2(dot(v, east), dot(v, north));
        // Its size: most heaps small, a few large (HEAP_SMALL .. HEAP_BIG of
        // the cover's, skewed to the small); the small ones flat (humilis),
        // the large taller than wide where the tops reach (mediocris).
        float sz = mix(HEAP_SMALL, HEAP_BIG, pow(a.y, HEAP_SKEW));
        float szn = clamp(sz / HEAP_BIG, 0.0, 1.0);
        float r = HEAP_CELL * mix(0.42, 0.55, cover) * sz;
        // (No wider than twice its height and a little: a low heap a small
        // dome, never a pancake whose rim thins to a sliver.)
        float hgt = min((tops - base) * mix(0.5, 1.0, a.z) * mix(0.45, 1.0, szn), r * mix(0.8, 2.6, tall) * mix(0.6, 1.0, szn));
        r = min(r, 2.0 * hgt + 120.0) * grow;
        hgt *= grow;
        // Its base: the field's condensation level, a few tens of metres
        // off it, cut flat; the dome's middle under it, so its walls rise
        // steep from the base's rim and the whole heap stands over every
        // point of the base (no thin rim the sun lights through).
        vec3 f = heapHash(cell + 5.13);
        float zh = zr - BASE_SPREAD * (f.x - 0.5);
        float d = ellipsoidIn(vec2(length(hz), zh + 0.4 * hgt), r, 1.4 * hgt);
        // The towers: two over the body, each its own way off its middle,
        // its own size and height, so no two heaps share a silhouette (the
        // engine's turrets crown them).
        for (int k = 0; k < 2; ++k) {
            vec3 t = fract(b.zxy * vec3(7.13, 3.71, 5.37) * float(k + 1) + a.zxy);
            float ang = 6.2832 * t.x;
            vec2 o = vec2(cos(ang), sin(ang)) * mix(0.1, 0.5, t.y) * r;
            d = max(d, ellipsoidIn(vec2(length(hz - o), zh - mix(0.2, 0.55, t.z) * hgt), mix(0.35, 0.6, t.z) * r,
                                   mix(0.5, 0.8, t.y) * hgt));
        }
        best = max(best, min(d, zh * BASE_SHARP));
        // A fragment beside it where the cover is fuller (as the heaps
        // clump): a small flat heap off its side, close or a little apart,
        // as large as a second heap where the cover is full; on its own
        // base, a few tens of metres off the heap's. (Within the heap's
        // reach of its foot, so the cells searched find it.)
        float fg = smoothstep(f.y, f.y + 0.15, fragments * clump);
        if (fg > 0.0) {
            float rs = HEAP_CELL * mix(0.42, 0.55, cover) * mix(0.3, 0.6, f.z) * mix(1.0, 1.9, fragBig) * fg;
            float hs = min(rs * mix(0.6, 1.2, tall), (tops - base) * 0.6) * fg;
            float ang = 6.2832 * fract(13.7 * f.z + b.z);
            vec2 o = vec2(cos(ang), sin(ang)) * min(r + rs * mix(0.2, 1.4, fract(7.3 * f.y)), 1800.0 - rs);
            float zs = zr - BASE_SPREAD * (fract(5.1 * f.x) - 0.5);
            best = max(best, min(ellipsoidIn(vec2(length(hz - o), zs + 0.4 * hs), rs, 1.4 * hs), zs * BASE_SHARP));
        }
    }
    return min(best, (zr + 0.5 * BASE_SPREAD) * BASE_SHARP);
}

// The share of the air the heaps fill at \`z\` metres up the deck, on the
// mean (what the far deck reads: as heaps() makes them), rising over the
// first 300 m from their bases; under 0 below and above them, by how far.
float heapsShare(float z, float base, float tops, float cover) {
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    float r = HEAP_CELL * mix(0.42, 0.55, cover) * sqrt(HEAP_SIZE2);
    float hgt = max(min((tops - base) * 0.75 * 0.8, r * mix(0.8, 2.6, tall) * 0.85) * 1.1, 300.0);
    float n = 2.0 * HEAP_SHELL * smoothstep(0.0, 0.6, cover);
    // (A fragment's mean square, of the cover's size, 0.21 and up to 1.9^2
    // as much where the cover is full: as a share of a heap's.)
    float frag = 0.21 * pow(mix(1.0, 1.9, smoothstep(0.4, 0.9, cover)), 2.0) * smoothstep(0.15, 0.7, cover) / HEAP_SIZE2;
    float area = 3.1416 * r * r / (HEAP_CELL * HEAP_CELL) * 1.15 * (1.0 + frag);
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
    // (Over a footprint as wide as the cells, their mean: a sheet as grey
    // as they cover, never cut square by the mip's mean of them.)
    float wide = smoothstep(2000.0, 12000.0, q.footprint);
    c *= mix(1.0, mix(smoothstep(0.25, 0.55, meso.y), 0.7, wide), cells);
    c *= mix(1.0, 0.75 + 0.5 * meso.x, convect * (1.0 - cells));
    c = min(c, 1.0);
    // Heaped where the air is convective; in slabs (a front's, a low's
    // heart, a deck) where it is not.
    float wHeap = smoothstep(0.1, 0.35, convect);
    float z = h * DECK, zb = base * DECK, zt = top * DECK;
    // From afar: the share of the air the clouds fill (a slab cut nearly
    // square, its top a little ragged on the mean), under 0 below and over
    // them, by how far; its edge softening as the footprint widens to tens
    // of kilometres (the share of it the slab covers, never a hard cut).
    float sw = mix(0.08, 0.3, wide);
    float slabFar = smoothstep(0.5 - sw, 0.5 + sw, c) * min(min((z - zb) / 500.0, (zt - z) / 600.0), 1.0);
    float far = max(heapsShare(z, zb, zt, c) * wHeap, slabFar * (1.0 - wHeap));
    float fn = smoothstep(0.15 * HEAP_CELL, 0.6 * HEAP_CELL, q.footprint);
    if (fn >= 1.0) return far;
    // Near: the shapes. The slab's top heaves in lumps a few kilometres
    // across and over a kilometre high (the engine's noise sixteen edges a
    // tile, 0.8 edges high: so the engine lights an overcast's top seen
    // from afar as it is shaped, clouds.frag's clTopShade), its base less;
    // where the cover is broken it parts (the decks' cells, the fronts'
    // edges).
    vec4 relief = cloudNoise(p / (16.0 * CLOUD_EDGE), q.footprint / (16.0 * CLOUD_EDGE));
    float st = zt - 0.8 * CLOUD_EDGE * relief.x - 250.0 * relief.z;
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
// The orbit camera and a held view move with the place when it re-anchors
// (the view is pushed again every frame, a re-anchor's frame included).
scene.addEventListener('reanchor', (e) => {
    Camera.orbitMove(vp.cam, e);
    const v = still.view;
    if (v) v.eye = e.apply(v.eye), v.look = e.apply(v.look), v.up = e.turn(v.up);
});
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
