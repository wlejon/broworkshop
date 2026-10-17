// forest — a few thousand broadleaf trees on rolling hills, from above the
// canopy down to standing among the trunks: the showcase for bro.scene's
// forest node (scene.createForest) and its levels of detail.
//
// broflora grows a nursery of SPECIMENS once at boot (a couple of dozen
// plants of three habits, spaced so each grows its own crown), and
// world.emitForest() hands them to the forest node as bark, clumps and
// leaves. bro.flora.plantForest() then stands them a few thousand times over
// the hills, turned and scaled, thinning to a glade in the middle. The node
// draws every tree at the detail its size on screen asks for:
//
//   leaves   up close, every leaf, fluttering on its own
//   thinned  a little further, fewer and larger leaves, then 6-vertex cards
//   impostors  further, one card a tree showing its specimen's own leaves,
//              baked from 64 directions and lit as the leaves are
//   (clumps and crowns, the crown's lobes and then one disc a tree, are the
//   far tiers with impostors off: the Clumps and Crowns buttons)
//
// every tier posed by the same sway, so a tree does not swim as it hands
// over. Grass grows in the glade and the open, thin under the crowns, from
// bro.flora.forestCover(). main.js mounts the panel; tests and the capture
// tool import this module (never main.js).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, DAYLIGHT } from "/lib/kit/sky.js";

export const GROUND = 240;         // half-size of the near ground (fine mesh, grass), metres
export const FAR = 900;            // half-size of the far ground
export const FOREST = 400;         // half-size of the planted area
export const PLANT_SCALE = 1.5;    // node scale: broflora grows ~5 m trees, drawn ~7.5 m
export const GLADE = { x: 12, z: 18, r: 26 };

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 60, fov: 50, near: 0.1, far: 2000, rot: orbitRotation(Math.PI * 0.75, -0.3) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 600 },
});
export const { scene } = vp;
// Skies with nothing on the ground in them (the forest is the ground), and a
// haze for a view kilometres deep.
const PRESETS = {
    golden: Object.assign({}, DAYLIGHT.golden, { hdri: 'belfast_sunset_puresky', envIntensity: 0.35,
                                                  fog: { start: 60, end: 1100, color: [0.86, 0.62, 0.46] } }),
    noon: Object.assign({}, DAYLIGHT.noon, { fog: { start: 80, end: 1500, color: [0.66, 0.74, 0.82] } }),
};
export const sky = daylight(scene, { presets: PRESETS, order: ['golden', 'noon'], cascades: 3, atlas: 4096, pcf: 3 });
scene.setMSAA(4);
vp.onFrame((dt) => sky.update(dt));

// --- the ground -------------------------------------------------------------------

const simplex = FastNoise.create('Simplex');
simplex.set('Feature Scale', 1);
const fbm = FastNoise.create('FractalFBm');
fbm.set('Source', simplex);
fbm.set('Octaves', 4);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height (metres) at world x, z: rolling hills, a flatter glade. */
export function groundHeight(x, z) {
    // Broad hills, gentler round the glade where the flight comes down.
    const r = Math.hypot(x - GLADE.x, z - GLADE.z);
    const broad = 9 * fbm.genSingle2D(x * 0.006, z * 0.006, 0x51) * (1 - 0.6 * smooth(140, 50, r));
    // The swells die away toward the near ground's edge, so the far
    // ground's coarse mesh is true to the same function.
    const near = smooth(GROUND, GROUND - 40, Math.max(Math.abs(x), Math.abs(z)));
    const swell = 1.4 * fbm.genSingle2D(x * 0.03, z * 0.03, 0x9a0d) * near;
    const g = smooth(GLADE.r * 2.2, GLADE.r * 0.5, r);
    return broad + swell * (1 - 0.7 * g);
}

/** How sun-dried the grass is at x, z: patches, drier on the rises. */
export function dryness(x, z) {
    const patch = smooth(-0.3, 0.5, fbm.genSingle2D(x * 0.12, z * 0.12, 0x77));
    return Math.min(1, 0.6 * patch + 0.25 * smooth(2, 9, groundHeight(x, z)));
}

// A deer path from the glade west into the trees, which the flight walks:
// no trunk stands on it.
const TRAIL = [[30, 22], [-6, 16], [-20, 13], [-27, 12], [-36, 11]];
function trailDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i + 1 < TRAIL.length; i++) {
        const [ax, az] = TRAIL[i], [bx, bz] = TRAIL[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
    return best;
}

/** Where trees stand: 0 .. 1, nothing in the glade, a ragged edge round it, none on the trail. */
export function treeDensity(x, z) {
    const d = Math.hypot(x - GLADE.x, z - GLADE.z) + 8 * fbm.genSingle2D(x * 0.05, z * 0.05, 0x3);
    return smooth(GLADE.r * 0.8, GLADE.r * 1.25, d) * smooth(2.5, 4.5, trailDistance(x, z)) *
           (0.85 + 0.15 * fbm.genSingle2D(x * 0.02, z * 0.02, 0x8));
}

// Leaf litter and soil: brown under the trees, the grass's own green in the
// glade, so the ground under a far ring of grass reads as grass. `half` the
// mesh's half-size, N its vertices a side, `drop` how far it sits below the
// height function (the far ground, under the near one).
function groundMesh(cover, half, N, drop) {
    const cell = (2 * half) / (N - 1);
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = groundHeight(-half + i * cell, -half + j * cell) - drop;
    const m = Mesh.heightmapGrid(h, N, N, cell);
    const pos = m.positions, c = new Float32Array(m.vertexCount * 4);
    const litter = [0.06, 0.045, 0.03], lush = [0.035, 0.05, 0.016], dry = [0.1, 0.08, 0.04];
    for (let v = 0; v < m.vertexCount; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];
        const g = cover(x, z), d = dryness(x, z);
        // Mottled: drifts of leaves, bare patches, moss.
        const fleck = (0.85 + 0.3 * fbm.genSingle2D(x * 0.7, z * 0.7, 0x5)) *
                      (0.75 + 0.5 * smooth(-0.5, 0.5, fbm.genSingle2D(x * 0.09, z * 0.09, 0x6)));
        for (let k = 0; k < 3; k++) {
            const grass = lush[k] + (dry[k] - lush[k]) * d;
            c[v * 4 + k] = (litter[k] + (grass - litter[k]) * Math.min(1, g * 1.3)) * fleck;
        }
        c[v * 4 + 3] = 1;
    }
    m.colors = c;
    return m;
}

// --- the nursery ------------------------------------------------------------------

const COMMON = {
    pipeExp: 2.0, leafDiameter: 0.028,
    shadeTolerance: 0.35, moduleMatureAge: 0.6, rootVigorMax: 4.0, apicalControl: 0.35,
    apicalControlMature: 0.3, individualVariation: 0.25, maxAge: 400, seedingRadius: 0.0,
};
export const SPECIES = {
    spreading: Object.assign({}, COMMON, { growthScale: 2.5, orthotropy: 0.55, tropismG2: 0.05 }),
    vase: Object.assign({}, COMMON, { growthScale: 2.0, orthotropy: 0.7, tropismG2: 0.03 }),
    tall: Object.assign({}, COMMON, { growthScale: 2.2, orthotropy: 0.8, tropismG2: 0.02, apicalControl: 0.5 }),
};
const HABITS = ['spreading', 'vase', 'tall'];
export const NURSERY = { cols: 6, rows: 4, spacing: 9 };   // 24 specimens, far enough apart to grow their own crowns

function trunkPrototype() {
    const H = 2.0, n = 6, nodes = [], edges = [];
    for (let i = 0; i <= n; i++) {
        nodes.push({ position: [0.03 * Math.sin(i * 1.7), H * i / n, 0.03 * Math.cos(i * 2.3)],
                     ageAtBirth: 0.03 * i, lengthMax: 1, thickening: 1 });
        if (i) edges.push([i - 1, i]);
    }
    for (let k = 0; k < 3; k++) {
        const a = k * 2.094 + 0.4;
        nodes.push({ position: [Math.cos(a) * 0.25, H + 0.15, Math.sin(a) * 0.25], ageAtBirth: 0.2, lengthMax: 0.8, thickening: 1 });
        edges.push([n, nodes.length - 1]);
    }
    return { name: 'trunk', nodes, edges, rootNode: 0, terminalNodes: [n, n + 1, n + 2, n + 3] };
}

export const FOLIAGE = { seed: 0x1eaf, perArea: 90 };
export function leafCard() {
    const m = Mesh.leafCard('oval', {
        width: 0.07, length: 0.12, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: 3, lengthSegments: 5,
    });
    m.colors = new Float32Array(0);
    return m;
}

const SIM_STEP = 0.02, SIM_SECONDS = 50;

/** Grow the nursery: one broflora world, a grid of specimens on flat ground. */
export function growNursery() {
    const { cols, rows, spacing } = NURSERY;
    const W = cols * spacing + 10, D = rows * spacing + 10;
    const world = bro.flora.createWorld({
        rngSeed: 0xf0e57,
        climate: { annualTempBase: 15, annualPrecip: 1100 },
        shadow: { origin: [-W / 2, -2, -D / 2], cellSize: 1, width: W, height: 26, depth: D, fill: 1 },
    });
    const mono = world.addPrototype(bro.flora.prototypes.monopodial(3, 0.7));
    const trunk = world.addPrototype(trunkPrototype());
    world.addVoronoiSite(mono, 0.5, 0.3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const kind = HABITS[(i + 2 * j) % HABITS.length];
        const x = (i - (cols - 1) / 2) * spacing + 1.3 * Math.sin(i * 2.1 + j);
        const z = (j - (rows - 1) / 2) * spacing + 1.3 * Math.cos(i * 1.3 + 2 * j);
        world.addPlant({ origin: [x, 0, z], species: SPECIES[kind], prototypeIndex: trunk });
    }
    const n = Math.round(SIM_SECONDS / SIM_STEP);
    for (let i = 0; i < n; i++) world.step(SIM_STEP);
    return world;
}

// --- the forest -------------------------------------------------------------------

// The grove's leaf with half the vertices (2 x 3 segments, 12): a forest
// shows many more leaves up close than a grove, and keeps the bend and cup.
function forestLeaf() {
    const m = Mesh.leafCard('oval', {
        width: 0.07, length: 0.12, bend: 0.4, fullUV: true, shapedSilhouette: true, cup: 0.55,
        widthSegments: 2, lengthSegments: 3,
    });
    m.colors = new Float32Array(0);
    return m;
}

const BARK = { color: [0.2, 0.17, 0.14], roughness: 0.9 };
const LEAF = { color: [0.2, 0.36, 0.11], roughness: 0.7 };

export const forest = { world: null, emit: null, trees: null, node: null, grass: null, ground: null, stats: {} };

function plant(emit) {
    return bro.flora.plantForest(emit, {
        area: [-FOREST, -FOREST, FOREST, FOREST], spacing: 6.5, jitter: 0.42, seed: 0x7ee5,
        ground: groundHeight, density: treeDensity, scale: [PLANT_SCALE * 0.85, PLANT_SCALE * 1.2], sink: 0.12,
    });
}

function build() {
    const emit = forest.world.emitForest(FOLIAGE);
    const trees = plant(emit);
    forest.emit = emit;
    forest.trees = trees;
    forest.node = scene.createForest(Object.assign({
        forest: emit, instances: trees, leaf: forestLeaf(),
        doubleSided: true, subsurface: 0.5, vertexColorTint: false, castsShadow: true, receivesShadow: true,
        barkColor: BARK.color, barkRoughness: BARK.roughness,
    }, LEAF));
    // Thin grass goes on under the crowns (the canopy is closed only where
    // several overlap), clear at the trunks.
    const cover = bro.flora.forestCover(emit, { instances: trees, floor: 0.25, closed: 4 });
    forest.cover = cover;
    const groundOpts = { color: [1, 1, 1], metallic: 0, roughness: 1.0, receivesShadow: true };
    forest.ground = scene.createMesh(Object.assign({ data: groundMesh(cover, GROUND, 241, 0) }, groundOpts));
    forest.far = scene.createMesh(Object.assign({ data: groundMesh(cover, FAR, 181, 0.8) }, groundOpts));
    forest.grass = scene.createGrass({
        ground: forest.ground,
        area: [-GROUND, -GROUND, GROUND, GROUND],
        cell: 0.6,
        dry: dryness,
        density: cover,
        tall: (x, z) => 1.1 - 0.4 * dryness(x, z),
        // Past 100 m the trunks hide most of it: the ground, coloured as
        // the grass, stands in.
        range: 100,
        castsShadow: true,
    });
    forest.stats = { specimens: emit.specimenCount, trees: trees.length / 8, leaves: emit.leafCount };
}

// --- wind ---------------------------------------------------------------------------

export const WINDS = {
    still: { label: 'Still', wind: { strength: 0, speed: 0, gust: 0 } },
    breeze: { label: 'Breeze', wind: { direction: [1, 0, 0.3], strength: 0.05, frequency: 1.1, speed: 2.5, gust: 1 } },
    gusty: { label: 'Gusty', wind: { direction: [1, 0, 0.3], strength: 0.12, frequency: 1.4, speed: 4.5, gust: 1.6 } },
};
export function setWind(key) {
    forest.wind = key;
    scene.setWind(WINDS[key].wind);
}

// --- the flight ---------------------------------------------------------------------

// From high over the canopy with the low sun behind, down toward the glade,
// skimming the crowns, dropping into the glade, across it and in among the
// trunks past its far edge, turning to look back at the glade through
// them. Keys are [time s, eye x, height above ground, eye z, look x, look
// height, look z].
export const FLIGHT = [
    [0, 240, 150, 130, 12, 0, 18],
    [7, 160, 80, 85, 12, 5, 18],
    [13, 90, 32, 52, 0, 8, 18],
    [18, 54, 15, 32, -5, 5, 20],
    [22, 30, 5, 22, -12, 3, 18],
    [26, -6, 1.8, 16, -40, 2.2, 12],
    [29, -20, 1.7, 13, -24, 2.2, -20],
    [32, -27, 1.7, 12, 10, 2.6, 22],
    [34, -28, 1.7, 12, 10, 2.6, 22],
];
export const FLIGHT_SECONDS = FLIGHT[FLIGHT.length - 1][0];

function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** The flight's eye and look-at point at time t (s). */
export function flightAt(t) {
    const K = FLIGHT, n = K.length;
    t = Math.max(0, Math.min(FLIGHT_SECONDS, t));
    let i = 0;
    while (i < n - 2 && t > K[i + 1][0]) i++;
    const u = (t - K[i][0]) / (K[i + 1][0] - K[i][0]);
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;   // ease a little at the keys
    const at = (c) => catmull(K[Math.max(0, i - 1)][c], K[i][c], K[i + 1][c], K[Math.min(n - 1, i + 2)][c], e);
    const ex = at(1), ez = at(3), lx = at(4), lz = at(6), h = at(2);
    const eg = groundHeight(ex, ez);
    // High up, the look height is over the ground it looks at; near the
    // ground, over the eye's own, so a level look stays level on a slope.
    const lg = groundHeight(lx, lz) + (eg - groundHeight(lx, lz)) * smooth(20, 4, h);
    return { eye: [ex, eg + h, ez], look: [lx, lg + at(5), lz] };
}

export const flight = { on: false, t: 0, speed: 1 };
/** Fly from time t (s); land() hands the view to the orbit camera. */
export function fly(t) {
    flight.on = true;
    flight.t = t || 0;
    flight.speed = 1;
    forest.shot = null;
}
/** Stop the flight where it is, the orbit camera taking over its view. */
export function land() {
    if (!flight.on) return;
    flight.on = false;
    const { eye, look } = flightAt(flight.t);
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    vp.reframe(look, dist, { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / dist) });
}
vp.onFrame((dt) => { if (flight.on) flight.t = Math.min(FLIGHT_SECONDS, flight.t + dt * flight.speed); });
vp.onView((view) => {
    if (!flight.on) return;
    const f = flightAt(flight.t);
    view.position = f.eye;
    view.target = f.look;
    view.up = [0, 1, 0];
});

// --- views --------------------------------------------------------------------------

export const SHOTS = {
    above:   { label: 'Above', t: 0 },
    canopy:  { label: 'Over the canopy', t: 13 },
    skim:    { label: 'Skimming', t: 18 },
    glade:   { label: 'The glade', t: 23 },
    trunks:  { label: 'Among the trunks', t: 34 },
};
export function setShot(key) {
    const s = SHOTS[key];
    forest.shot = key;
    flight.on = true;
    flight.t = s.t;
    flight.speed = 0;
}

// --- boot ---------------------------------------------------------------------------

sky.apply('golden');
setWind('breeze');
setShot('above');
const t0 = performance.now();
forest.world = growNursery();
forest.growMs = performance.now() - t0;
build();
