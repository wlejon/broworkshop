// The biomes world: a rolling ground and the plants on it, the sky, and the
// views the capture script and the panel share. The plants are bro.scene's
// plants node: species described here, every plant built on the GPU.
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight, SKY } from "/lib/kit/sky.js";

export const HALF = 700;          // half-size of the world (m)
const CELL = 4;                   // ground cell (m)

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 60, fov: 50, near: 0.1, far: 6000, rot: orbitRotation(Math.PI * 0.75, -0.3) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 3000 },
});
export const { scene } = vp;

// The atmosphere's sky, the real sun and a metered exposure: one model from
// the glade to the flyover.
const PRESETS = { afternoon: SKY.afternoon, golden: SKY.golden };
export const sky = daylight(scene, { presets: PRESETS, order: ['afternoon', 'golden'], cascades: 3, atlas: 4096,
    pcf: 3, ground: [0.10, 0.13, 0.05] });

// --- the land ------------------------------------------------------------------------

function hash(x, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
function fbm(x, z, oct) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f); f *= 2.03; amp *= 0.5; }
    return s;
}

// The glade the walk starts in, and a meadow down the slope from it.
export const GLADE = { x: 20, z: 30, r: 28 };
export const MEADOW = { x: -160, z: -120, r: 110 };

export function groundHeight(x, z) {
    const hills = (fbm(x * 0.0024, z * 0.0024, 4) - 0.5) * 90;
    const ridges = (fbm(x * 0.009 + 7.3, z * 0.009 - 2.1, 3) - 0.5) * 14;
    return hills + ridges;
}

// 0 open .. 1 forest: groves with clearings, the glade and meadow kept open.
export function forestCover(x, z) {
    let c = fbm(x * 0.006 + 3.1, z * 0.006 + 8.7, 3);
    c = Math.min(1, Math.max(0, (c - 0.36) * 3.2));
    const gd = Math.hypot(x - GLADE.x, z - GLADE.z) / GLADE.r;
    const md = Math.hypot(x - MEADOW.x, z - MEADOW.z) / MEADOW.r;
    c *= Math.min(1, Math.max(0, (gd - 0.85) * 2.5));
    c *= Math.min(1, Math.max(0, (md - 0.8) * 1.6));
    return c;
}

function buildGround() {
    const n = Math.round((2 * HALF) / CELL) + 1;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) h[j * n + i] = groundHeight(-HALF + i * CELL, -HALF + j * CELL);
    const mesh = Mesh.heightmapGrid(h, n, n, CELL);
    const pos = mesh.positions;
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let v = 0; v < pos.length / 3; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];   // (the grid is centred on the origin)
        const cover = forestCover(x, z);
        const dry = fbm(x * 0.02 + 4.4, z * 0.02 - 1.7, 2);
        // Meadow green to golden, forest floor to dark loam under the trees.
        const r = 0.10 + 0.10 * dry, g = 0.15 + 0.06 * dry, b = 0.035;
        colors[v * 4] = r * (1 - 0.55 * cover) + 0.05 * cover;
        colors[v * 4 + 1] = g * (1 - 0.55 * cover) + 0.05 * cover;
        colors[v * 4 + 2] = b * (1 - 0.3 * cover) + 0.025 * cover;
        colors[v * 4 + 3] = 1;
    }
    mesh.colors = colors;
    const node = scene.createMesh({ data: mesh, roughness: 0.95 });
    node.receivesShadow = true;
    return node;
}

// --- the plants ---------------------------------------------------------------------

export const SPECIES = [
    // 0 a broadleaf: a big round crown of deep green lobes.
    { height: 15, base: 0.2, radius: 5.2, shape: 0.05, lobes: 16, lobeSize: 0.52, leafLength: 0.34, leafWidth: 0.55,
      elements: 8000, trunk: 0.32, spread: 0.85, droop: 0.15,
      light: [0.19, 0.32, 0.07], dark: [0.02, 0.05, 0.025], hueVariety: 0.4, glow: 0.9, glowColor: [1.0, 0.9, 0.35],
      bark: [0.12, 0.10, 0.08], density: 0.9 },
    // 1 a birch-like tree: tall, light, airy, pale bark.
    { height: 14, base: 0.4, radius: 3.0, shape: 0.15, lobes: 11, lobeSize: 0.5, leafLength: 0.24, leafWidth: 0.6,
      elements: 4800, trunk: 0.16, spread: 0.7, droop: 0.45,
      light: [0.30, 0.42, 0.09], dark: [0.05, 0.09, 0.03], hueVariety: 0.3, glow: 1.1, glowColor: [1.0, 0.95, 0.45],
      bark: [0.55, 0.52, 0.47], density: 0.6 },
    // 2 a conifer: a dark cone of drooping needle tiers.
    { height: 18, base: 0.1, radius: 4.4, shape: 0.95, lobes: 34, lobeSize: 0.36, leafLength: 0.32, leafWidth: 0.42,
      elements: 6500, trunk: 0.28, spread: 0.95, droop: 0.5, needle: 1,
      light: [0.10, 0.20, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.18, glow: 0.35, glowColor: [0.8, 0.9, 0.4],
      bark: [0.16, 0.10, 0.07], density: 0.8 },
    // 3 a shrub.
    { height: 1.8, base: 0.05, radius: 1.3, shape: 0.0, lobes: 7, lobeSize: 0.55, leafLength: 0.18, leafWidth: 0.55,
      elements: 1600, trunk: 0.04, spread: 0.6, droop: 0.1,
      light: [0.27, 0.40, 0.08], dark: [0.04, 0.08, 0.025], hueVariety: 0.35, glow: 0.8, glowColor: [1.0, 0.9, 0.35],
      bark: [0.12, 0.09, 0.07], density: 0.7 },
    // 4 an oak-like tree: broad and low, its crown a few big dark lobes,
    // bluer than the broadleaf.
    { height: 13, base: 0.22, radius: 6.2, shape: 0.0, lobes: 12, lobeSize: 0.6, leafLength: 0.3, leafWidth: 0.6,
      elements: 8000, trunk: 0.42, spread: 1.0, droop: 0.1,
      light: [0.13, 0.25, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.3, glow: 0.7, glowColor: [0.9, 0.95, 0.4],
      bark: [0.10, 0.09, 0.08], density: 1.0 },
    // 5 a lime-like tree: tall and rounded, a fresh yellow green.
    { height: 17, base: 0.25, radius: 4.6, shape: 0.1, lobes: 15, lobeSize: 0.5, leafLength: 0.32, leafWidth: 0.7,
      elements: 7000, trunk: 0.3, spread: 0.8, droop: 0.25,
      light: [0.30, 0.40, 0.07], dark: [0.04, 0.08, 0.02], hueVariety: 0.3, glow: 1.0, glowColor: [1.0, 0.95, 0.4],
      bark: [0.14, 0.12, 0.10], density: 0.8 },
];

function plantAll() {
    const plants = [];
    const step = 5.5;
    let seed = 1;
    for (let z = -HALF + 4; z < HALF - 4; z += step) {
        for (let x = -HALF + 4; x < HALF - 4; x += step) {
            const jx = x + (hash(x * 13, z * 7) - 0.5) * step * 0.9;
            const jz = z + (hash(x * 5, z * 17) - 0.5) * step * 0.9;
            const cover = forestCover(jx, jz);
            if (hash(jx * 31, jz * 29) > cover * 0.95) continue;
            const pine = fbm(jx * 0.004 - 5.0, jz * 0.004 + 2.0, 2);
            const birch = fbm(jx * 0.011 + 9.0, jz * 0.011 - 4.0, 2);
            const r = hash(jx * 3, jz * 11);
            // The broadleaves in stands of a kind, mixed at their margins:
            // oak in one, lime in the next, the common broadleaf between.
            const kind = fbm(jx * 0.008 + 2.7, jz * 0.008 - 6.4, 2) + (hash(jx * 19, jz * 23) - 0.5) * 0.12;
            const broad = kind < 0.42 ? 4 : (kind > 0.58 ? 5 : 0);
            const species = r < (pine - 0.35) * 2.2 ? 2 : (birch > 0.62 && r < 0.6 ? 1 : broad);
            // Stands of an age (noise) with every tree its own: old giants,
            // young ones in their gaps, the edge's lower than the core's.
            const age = fbm(jx * 0.02 + 1.3, jz * 0.02 + 6.1, 2);
            const own = hash(jx * 7, jz * 3);
            const scale = (0.5 + 0.75 * age + 0.45 * own * own) * (0.75 + 0.25 * cover);
            // A stand's tone (its soil, its age) shared, each tree a little its own.
            const stand = (fbm(jx * 0.015 - 8.2, jz * 0.015 + 3.3, 2) - 0.5) * 1.6;
            plants.push({ x: jx, y: groundHeight(jx, jz) - 0.1, z: jz, yaw: hash(jx, jz) * 6.283,
                          scale, species, seed: seed++, tint: stand + (hash(jx * 2, jz * 9) - 0.5) * 0.4 });
        }
    }
    // Shrubs in thickets along the forest's edges and a few in its
    // understorey; out in the open only where a thicket has crept out.
    for (let z = -HALF + 2; z < HALF - 2; z += 2.4) {
        for (let x = -HALF + 2; x < HALF - 2; x += 2.4) {
            const jx = x + (hash(x * 3, z * 19) - 0.5) * 2.4, jz = z + (hash(x * 23, z * 5) - 0.5) * 2.4;
            const cover = forestCover(jx, jz);
            const edge = cover * (1 - cover) * 4;
            const thicket = Math.max(0, (fbm(jx * 0.05 + 1.9, jz * 0.05 - 7.7, 2) - 0.45) * 3.5);
            const p = thicket * (0.05 + 0.75 * edge + 0.15 * cover);
            if (hash(jx * 17, jz * 13) > p) continue;
            plants.push({ x: jx, y: groundHeight(jx, jz) - 0.05, z: jz, yaw: hash(jz, jx) * 6.283,
                          scale: 0.6 + 0.8 * hash(jx, jz * 2), species: 3, seed: seed++, tint: (hash(jx, jz * 5) - 0.5) });
        }
    }
    return plants;
}

export const ground = buildGround();
const dryness = (x, z) => fbm(x * 0.02 + 4.4, z * 0.02 - 1.7, 2);
export const grass = scene.createGrass({
    ground, turf: true, cell: 2,
    density: (x, z) => 1 - 0.75 * forestCover(x, z),
    dry: (x, z) => Math.max(0, dryness(x, z) - 0.35) * 1.4,
    tall: (x, z) => 0.8 + 0.6 * (1 - dryness(x, z)),
    floor: (x, z) => forestCover(x, z),
    herbs: {
        species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'],
        density: (x, z, y, canopy) => 0.25 + 0.6 * vnoise(x * 0.05, z * 0.05),
    },
});
const t0 = performance.now();
export const plantList = plantAll();
export const plants = scene.createPlants({ species: SPECIES, plants: plantList, receivesShadow: true });
plants.castsShadow = true;
console.log(`biomes: ${plantList.length} plants placed in ${(performance.now() - t0).toFixed(0)} ms`);

// --- views --------------------------------------------------------------------------

const at = (x, z, up) => [x, groundHeight(x, z) + up, z];
export const SHOTS = {
    glade:  { label: 'Glade', eye: () => at(GLADE.x - 6, GLADE.z - 8, 1.7), look: () => at(GLADE.x + 30, GLADE.z + 40, 6) },
    edge:   { label: 'Forest edge', eye: () => at(MEADOW.x + 40, MEADOW.z + 30, 1.7), look: () => at(MEADOW.x + 120, MEADOW.z + 110, 8) },
    meadow: { label: 'Meadow', eye: () => at(MEADOW.x - 30, MEADOW.z - 40, 2.0), look: () => at(MEADOW.x + 80, MEADOW.z + 60, 4) },
    canopy: { label: 'Canopy', eye: () => at(GLADE.x, GLADE.z, 34), look: () => at(GLADE.x + 120, GLADE.z + 140, 0) },
    above:  { label: 'Above', eye: () => at(0, 0, 160), look: () => at(220, 260, 0) },
    flyover: { label: 'Flyover', eye: () => at(-300, -300, 420), look: () => at(150, 150, 0) },
};

export const still = { view: null };
export function holdView(eye, look) { still.view = { eye, look }; }
export function setShot(name) {
    const s = SHOTS[name];
    if (s) holdView(s.eye(), s.look());
}
export function land() {
    if (!still.view) return;
    const { eye, look } = still.view;
    still.view = null;
    const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    vp.reframe(look, dist, { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(d[1] / dist) });
}
vp.onView((view) => {
    if (!still.view) return;
    view.position = still.view.eye;
    view.target = still.view.look;
    view.up = [0, 1, 0];
});

scene.setWind({ direction: [0.8, 0, 0.6], speed: 3, gust: 1.2 });
scene.setDither(true);
sky.apply('afternoon');
setShot('glade');
