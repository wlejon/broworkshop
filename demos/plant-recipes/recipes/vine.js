// Vine archetype — helical climbing stem with leaf blobs along it.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

function buildVineSeed(opts) {
    const r = 0.018;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#5a3a1a'),
        sx: 1.0, sy: 0.7, sz: 1.0 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildVineSprout(opts, stageT) {
    const stemH = 0.04 + 0.06 * stageT;
    const out = F.cotyledonPair({ stemH, stemR: 0.005,
        leafLen: 0.03 + 0.03 * stageT, leafW: 0.02 + 0.012 * stageT,
        leafColor: F.hexToRgb(opts.leafColor || F.PALETTE.canopyVine) });
    return { parts: out.parts, aabbMin: [-0.04, 0, -0.04], aabbMax: [0.04, out.height, 0.04] };
}

function buildVineCore(opts, age01, scaleMul, fullness) {
    scaleMul = scaleMul ?? 1;
    fullness = fullness ?? 1;
    const seed = (opts.seed | 0) || 1;
    const length = (opts.length ?? 6) * scaleMul;
    const radius = opts.radius ?? 0.04;
    const helixRadius = opts.helixRadius ?? 0.5;
    const turns = opts.turns ?? 3;
    const canopyColor = F.hexToRgb(opts.canopyColor || opts.leafColor || F.PALETTE.canopyVine);
    const stemColor = F.hexToRgb(opts.stemColor || F.PALETTE.barkLight);

    const rng = F.mulberry32(seed);
    const samples = Math.max(8, Math.floor(length * 12));
    const path = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const a = t * turns * TAU;
        path.push([
            Math.cos(a) * helixRadius + (rng() - 0.5) * 0.04,
            t * length,
            Math.sin(a) * helixRadius + (rng() - 0.5) * 0.04,
        ]);
    }
    const stem = Mesh.tube(path, radius, 6);

    const parts = [];
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.9, twoSided: false });

    const leafEvery = Math.max(1, Math.floor(samples / Math.max(8, length * 4)));
    const blobR = Math.max(0.06, helixRadius * 0.45) * scaleMul;
    const anchors = [];
    for (let i = 0; i < path.length; i += leafEvery) {
        if (rng() > fullness) continue;
        const c = path[i];
        const blob = F.buildBlob(c, blobR * (0.85 + rng() * 0.35),
            (seed * 7 + i * 41) ^ 0x4004, { nsub: 1, sy: 0.7 });
        parts.push({ mesh: blob, color: canopyColor, metallic: 0, roughness: 0.88 });
        anchors.push(c);
    }

    const aabb = F.emptyAabb();
    for (const p of path) F.aabbInclude(aabb, p, blobR * 1.5);
    const fin = F.finalizeAabb(aabb, { min: [-helixRadius, 0, -helixRadius], max: [helixRadius, length, helixRadius] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax, anchors };
}

function buildVineSeedling(opts, stageT) { return buildVineCore(opts, stageT, 0.25 + 0.20 * stageT, 0.8); }
function buildVineJuvenile(opts, stageT) { return buildVineCore(opts, stageT, 0.50 + 0.30 * stageT, 0.85); }
function buildVineMature(opts, stageT) { return buildVineCore(opts, stageT, 1, 1); }

function buildVineFlowering(opts, stageT) {
    const r = buildVineCore(opts, stageT, 1, 1);
    if (!opts.bloomColor) return r;
    const bloom = F.bloomCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xB9A0,
        color: F.hexToRgb(opts.bloomColor),
        radius: 0.07, density: (opts.bloomDensity ?? 0.6) * stageT,
        useFlower: true,
        petalShape: opts.bloomShape || 'petal',
        petalCount: opts.petalCount ?? 5,
        layers: 1,
    });
    for (const p of bloom.parts) r.parts.push(p);
    return r;
}

function buildVineFruiting(opts, stageT) {
    const r = buildVineCore(opts, stageT, 1, 1);
    if (!opts.fruitColor) return r;
    const fruit = F.fruitCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xF9A0,
        color: F.hexToRgb(opts.fruitColor),
        radius: opts.fruitRadius ?? 0.04,
        density: 0.65 * stageT, sag: 0.4,
    });
    for (const p of fruit.parts) r.parts.push(p);
    return r;
}

const STAGES_NO_BLOOM = ['seed', 'sprout', 'seedling', 'juvenile', 'mature'];
const STAGES_BLOOM = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting'];

const BUILDERS = {
    seed: buildVineSeed, sprout: buildVineSprout, seedling: buildVineSeedling,
    juvenile: buildVineJuvenile, mature: buildVineMature,
    flowering: buildVineFlowering, fruiting: buildVineFruiting,
};

function vine(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('vine', opts.species, opts);
    const stages = opts.stagesOverride || ((opts.bloomColor || opts.fruitColor) ? STAGES_BLOOM : STAGES_NO_BLOOM);
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.vine = vine;
