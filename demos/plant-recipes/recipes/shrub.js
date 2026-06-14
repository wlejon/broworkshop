// Shrub archetype — clusters of small blobs forming a low bushy form.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

function buildShrubSeed(opts) {
    const r = 0.04;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || F.PALETTE.seedTan), sx: 1.1, sy: 0.6, sz: 1.1 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildShrubSprout(opts, stageT) {
    const stemH = 0.03 + 0.06 * stageT;
    const out = F.cotyledonPair({ stemH, stemR: 0.005,
        leafLen: 0.035 + 0.025 * stageT, leafW: 0.02 + 0.01 * stageT,
        leafColor: F.hexToRgb(opts.canopyColor || F.PALETTE.canopyShrub) });
    return { parts: out.parts, aabbMin: [-0.06, 0, -0.06], aabbMax: [0.06, out.height, 0.06] };
}

function buildShrubSeedling(opts, stageT) {
    const stemH = 0.10 + 0.15 * stageT;
    const out = F.firstTrueLeaves({ seed: opts.seed | 0, stemH,
        leafCount: 5, leafLen: 0.05 + 0.04 * stageT, leafW: 0.025 + 0.02 * stageT,
        leafShape: opts.leafShape || 'oval',
        leafColor: F.hexToRgb(opts.canopyColor || F.PALETTE.canopyShrub) });
    return { parts: out.parts, aabbMin: [-0.12, 0, -0.12], aabbMax: [0.12, out.height, 0.12] };
}

function buildShrubMature(opts, age01, scaleMul) {
    scaleMul = scaleMul ?? 1;
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 1.5) * scaleMul;
    const R = (opts.radius ?? 1.2) * scaleMul;
    const blobCount = Math.max(2, opts.blobCount ?? 5);
    const canopyColor = F.hexToRgb(opts.canopyColor || F.PALETTE.canopyShrub);

    const rng = F.mulberry32(seed);
    const parts = [];
    const aabb = F.emptyAabb();
    const anchors = [];

    for (let i = 0; i < blobCount; i++) {
        const a = TAU * i / blobCount + rng() * 0.5;
        const off = R * (0.2 + rng() * 0.55);
        const c = [Math.cos(a) * off, H * (0.35 + rng() * 0.4), Math.sin(a) * off];
        const r = R * (0.40 + rng() * 0.25);
        const blob = F.buildBlob(c, r, (seed * 13 + i * 29) ^ 0x3003,
            { nsub: 2, sy: 0.85 });
        parts.push({ mesh: blob, color: canopyColor, metallic: 0, roughness: 0.88 });
        anchors.push(c);
        F.aabbInclude(aabb, c, r * 1.1);
    }

    const fin = F.finalizeAabb(aabb, { min: [-R, 0, -R], max: [R, H, R] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax, anchors };
}

function buildShrubJuvenile(opts, stageT) {
    return buildShrubMature(opts, stageT, 0.25 + 0.30 * stageT);
}

function buildShrubMatureStage(opts, stageT) {
    return buildShrubMature(opts, stageT, 1);
}

function buildShrubFlowering(opts, stageT) {
    const r = buildShrubMature(opts, stageT, 1);
    if (!opts.bloomColor) return r;
    const bloom = F.bloomCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xB1A0,
        color: F.hexToRgb(opts.bloomColor),
        radius: opts.bloomRadius ?? 0.12,
        density: (opts.bloomDensity ?? 0.85) * (0.5 + 0.5 * stageT),
        useFlower: (opts.bloomRadius ?? 0.12) >= 0.07,
        petalShape: opts.bloomShape || 'petal',
        petalCount: opts.petalCount ?? 6,
        layers: opts.bloomLayers ?? 1,
    });
    for (const p of bloom.parts) r.parts.push(p);
    return r;
}

function buildShrubFruiting(opts, stageT) {
    const r = buildShrubMature(opts, stageT, 1);
    if (!opts.fruitColor) return r;
    const fruit = F.fruitCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xF1A0,
        color: F.hexToRgb(opts.fruitColor),
        radius: opts.fruitRadius ?? 0.04,
        density: 0.6 + 0.3 * stageT, sag: 0.3,
    });
    for (const p of fruit.parts) r.parts.push(p);
    return r;
}

function buildShrubSenescent(opts, stageT) {
    const baseColor = F.hexToRgb(opts.canopyColor || F.PALETTE.canopyShrub);
    const tinted = F.autumnTint(baseColor, 0.5 * (0.4 + 0.6 * stageT), 0.4);
    return buildShrubMature(Object.assign({}, opts, { canopyColor: tinted }), stageT, 1);
}

const STAGES_NO_BLOOM = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'senescent'];
const STAGES_FULL = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting', 'senescent'];

const BUILDERS = {
    seed: buildShrubSeed,
    sprout: buildShrubSprout,
    seedling: buildShrubSeedling,
    juvenile: buildShrubJuvenile,
    mature: buildShrubMatureStage,
    flowering: buildShrubFlowering,
    fruiting: buildShrubFruiting,
    senescent: buildShrubSenescent,
};

function shrub(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('shrub', opts.species, opts);
    const stages = opts.stagesOverride || ((opts.bloomColor || opts.fruitColor) ? STAGES_FULL : STAGES_NO_BLOOM);
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.shrub = shrub;
