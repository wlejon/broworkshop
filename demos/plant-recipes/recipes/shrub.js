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
    const leafShape = opts.leafShape || 'oval';

    const rng = F.mulberry32(seed);
    const parts = [];
    const aabb = F.emptyAabb();
    const anchors = [];
    const lobes = [];

    // Lobe centers/radii describe the canopy volume (same layout as
    // before); they no longer render as visible blobs directly — they're
    // shells that the twig cloud below scatters leaf cards over, and
    // anchors bloom/fruit clusters key off.
    for (let i = 0; i < blobCount; i++) {
        const a = TAU * i / blobCount + rng() * 0.5;
        const off = R * (0.2 + rng() * 0.55);
        const c = [Math.cos(a) * off, H * (0.35 + rng() * 0.4), Math.sin(a) * off];
        const r = R * (0.40 + rng() * 0.25);
        lobes.push({ c, r });
        anchors.push(c);
        F.aabbInclude(aabb, c, r * 1.1);
    }

    // A few thin woody stems ground the canopy instead of leaving it
    // floating — most clipped shrubs show little bark, so keep these
    // short and just tall enough to reach into the lowest lobes.
    const stemSegs = [];
    const stemCount = Math.min(lobes.length, Math.max(3, Math.round(blobCount * 0.6)));
    for (let i = 0; i < stemCount; i++) {
        const lobe = lobes[i];
        const baseR = Math.max(0.01, R * 0.05 * (0.8 + rng() * 0.4));
        const mid = [lobe.c[0] * 0.4, lobe.c[1] * 0.5, lobe.c[2] * 0.4];
        const s0 = stemSegs.length;
        stemSegs.push({ parent: -1, from: [0, 0, 0], to: mid, radius: baseR });
        stemSegs.push({ parent: s0, from: mid, to: lobe.c, radius: baseR * 0.55 });
    }
    if (stemSegs.length) {
        const stemMesh = Mesh.meshBranches(stemSegs, 6);
        if (stemMesh) parts.push({
            mesh: stemMesh, color: F.hexToRgb(opts.stemColor || F.PALETTE.bark),
            metallic: 0, roughness: 0.9, twoSided: false,
        });
    }

    // Foliage: a twig cloud synthesized over each lobe's shell, clothed in
    // leaf cards via Mesh.scatterLeaves — replaces the old solid smooth
    // blob (no leaf detail at all, just a tinted potato).
    const leafLen = F.clamp(R * 0.16, 0.03, 0.5);
    const leafW = leafLen * 0.55;
    const leaf = Mesh.leafCard(leafShape, {
        width: leafW, length: leafLen, bend: 0.3, fullUV: true, shapedSilhouette: true,
        widthSegments: 2, lengthSegments: 3,
    });
    F.stripVertexColors(leaf);

    const twigs = [];
    const lrng = F.mulberry32((seed * 977 + 3) >>> 0);
    for (const { c, r } of lobes) {
        const twigCount = Math.max(14, Math.round(40 * (r / Math.max(0.2, R))));
        for (let k = 0; k < twigCount; k++) {
            const u = lrng() * 2 - 1;
            const th = lrng() * TAU;
            const sq = Math.sqrt(Math.max(0, 1 - u * u));
            const dir = [sq * Math.cos(th), u, sq * Math.sin(th)];
            const shell = 0.75 + lrng() * 0.3;
            const outer = [c[0] + dir[0] * r * shell, c[1] + dir[1] * r * shell * 0.85, c[2] + dir[2] * r * shell];
            const inner = [c[0] + dir[0] * r * shell * 0.55, c[1] + dir[1] * r * shell * 0.55 * 0.85, c[2] + dir[2] * r * shell * 0.55];
            twigs.push({ parent: -1, from: inner, to: outer, radius: 0.01 });
        }
    }
    const foliage = Mesh.scatterLeaves(twigs, leaf, {
        maxRadius:     0.05,
        minDepth:      0,
        perUnitLength: 70,
        upBias:        0.25,
        tiltJitter:    0.6,
        rollJitter:    1.0,
        baseScale:     1.0,
        scaleJitter:   0.3,
        seed:          (seed * 211 + 7) >>> 0,
    });
    if (foliage && foliage.triangleCount > 0) {
        parts.push({ mesh: foliage, color: canopyColor, metallic: 0, roughness: 0.85, twoSided: true });
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
