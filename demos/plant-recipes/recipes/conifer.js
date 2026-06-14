// Conifer archetype — stylized stacked-cone Christmas tree with life cycle.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;

function buildConiferSeed(opts) {
    const r = 0.04;
    const out = F.seedShape({
        seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#4a3018'),
        sx: 1.3, sy: 0.6, sz: 0.9,
    });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildConiferSprout(opts, stageT) {
    const stemH = 0.04 + 0.10 * stageT;
    const parts = [];
    const stem = Mesh.tube([[0, 0, 0], [0, stemH, 0]], [0.005, 0.003], 5);
    if (stem) parts.push({ mesh: stem, color: F.hexToRgb(opts.canopyColor || '#3a6f33'),
        metallic: 0, roughness: 0.85, twoSided: false });
    // Two thin needle pairs at the tip.
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * F.TAU;
        const needle = Mesh.leafCard('needle', {
            width: 0.005, length: 0.025 + 0.02 * stageT, bend: 0.05, fullUV: true,
        });
        F.stripVertexColors(needle);
        needle.rotate(0, 1, 0, F.TAU * 0.25);
        needle.rotate(0, 0, 1, F.TAU * 0.20);
        needle.rotate(0, 1, 0, a);
        needle.translate(0, stemH * 0.95, 0);
        parts.push({ mesh: needle, color: F.hexToRgb(opts.canopyColor || '#3a6f33'),
            metallic: 0, roughness: 0.85 });
    }
    return { parts, aabbMin: [-0.04, 0, -0.04], aabbMax: [0.04, stemH + 0.04, 0.04] };
}

function buildConiferSeedling(opts, stageT) {
    // Tiny version of the mature conifer at 8-15% scale.
    const scale = 0.08 + 0.07 * stageT;
    return buildMature(opts, stageT, scale);
}

function buildConiferJuvenile(opts, stageT) {
    const scale = 0.20 + 0.30 * stageT;
    return buildMature(opts, stageT, scale);
}

function buildConiferMatureStage(opts, stageT) {
    return buildMature(opts, stageT, 1);
}

function buildConiferFlowering(opts, stageT) {
    // Small brown male cones along upper branches.
    const r = buildMature(opts, stageT, 1);
    // Synthesize anchors at cone tips for cone-flower decoration.
    const H = (opts.height ?? 8);
    const seed = (opts.seed | 0) ^ 0xC1A0;
    const rng = F.mulberry32(seed);
    const baseR = opts.baseCanopyRadius ?? 2.5;
    const anchors = [];
    const layers = opts.layers ?? 7;
    for (let i = Math.floor(layers / 2); i < layers; i++) {
        const t = i / Math.max(1, layers - 1);
        const ringR = baseR * (1 - t * 0.85) * 0.95;
        const y = H * 0.18 + t * H * 0.84;
        const n = 3 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
            const a = (k / n) * F.TAU + rng() * 0.4;
            anchors.push([Math.cos(a) * ringR, y, Math.sin(a) * ringR]);
        }
    }
    const cones = F.fruitCluster({
        anchors, seed, color: F.hexToRgb(opts.maleConeColor || '#7a5a30'),
        radius: Math.max(0.025, baseR * 0.025), density: 0.7, sag: 0.1,
    });
    for (const p of cones.parts) r.parts.push(p);
    return r;
}

function buildConiferFruiting(opts, stageT) {
    const r = buildMature(opts, stageT, 1);
    const H = (opts.height ?? 8);
    const seed = (opts.seed | 0) ^ 0xF1A0;
    const rng = F.mulberry32(seed);
    const baseR = opts.baseCanopyRadius ?? 2.5;
    const layers = opts.layers ?? 7;
    const anchors = [];
    for (let i = 1; i < layers - 1; i++) {
        const t = i / Math.max(1, layers - 1);
        const ringR = baseR * (1 - t * 0.85) * 0.92;
        const y = H * 0.18 + t * H * 0.82;
        const n = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
            const a = (k / n) * F.TAU + rng() * 0.4;
            anchors.push([Math.cos(a) * ringR, y, Math.sin(a) * ringR]);
        }
    }
    const cones = F.fruitCluster({
        anchors, seed, color: F.hexToRgb(opts.coneColor || '#7a5630'),
        radius: Math.max(0.045, baseR * 0.05), density: 0.8, sag: 0.4,
    });
    for (const p of cones.parts) r.parts.push(p);
    return r;
}

// ─── Core mature builder (shared with seedling/juvenile via scale) ───────

function buildMature(opts, age01, scaleMul) {
    scaleMul = scaleMul ?? 1;
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 8) * scaleMul;
    const trunkRadius = (opts.trunkRadius ?? 0.15) * scaleMul;
    const layers = Math.max(3, opts.layers ?? 7);
    const baseCanopyRadius = (opts.baseCanopyRadius ?? 2.5) * scaleMul;
    const canopyColor = F.hexToRgb(opts.canopyColor || '#2e6633');
    const trunkColor = F.hexToRgb(opts.trunkColor || F.PALETTE.bark);
    const coneShape = opts.coneShape || 'soft';

    const Heff = H;
    const parts = [];
    const aabb = F.emptyAabb();

    const baseY = Heff * 0.18;
    const topY = Heff * 1.02;
    const span = topY - baseY;
    const layerH = (span / layers) * (coneShape === 'sharp' ? 1.55 : coneShape === 'tight' ? 1.30 : coneShape === 'columnar' ? 1.15 : 1.45);
    const tipR = baseCanopyRadius * 0.10;
    let canopyTopY = baseY;
    const widthMul = coneShape === 'columnar' ? 0.55 : coneShape === 'spreading' ? 1.20 : 1.0;

    const coneParts = [];
    for (let i = 0; i < layers; i++) {
        const t = i / Math.max(1, layers - 1);
        const y = baseY + t * span;
        const layerR = (baseCanopyRadius * (1 - t * 0.85) + tipR * t) * widthMul;
        const layerHeight = layerH * (0.7 + 0.3 * (1 - t));

        const cone = F.buildCone(layerR, layerHeight, 14, 2);
        cone.translate(0, y, 0);
        coneParts.push({ mesh: cone, color: canopyColor, metallic: 0, roughness: 0.9 });
        F.aabbInclude(aabb, [-layerR, y, -layerR]);
        F.aabbInclude(aabb, [layerR, y + layerHeight, layerR]);
        const top = y + layerHeight;
        if (top > canopyTopY) canopyTopY = top;
    }

    const trunkH = Math.max(Heff * 0.18, canopyTopY * 0.95);
    const trunkMesh = F.buildCone(trunkRadius, trunkH, 12, 1);
    parts.push({ mesh: trunkMesh, color: trunkColor, metallic: 0, roughness: 0.95, twoSided: false });
    F.aabbInclude(aabb, [-trunkRadius, 0, -trunkRadius]);
    F.aabbInclude(aabb, [trunkRadius, trunkH, trunkRadius]);

    for (const c of coneParts) parts.push(c);

    const fin = F.finalizeAabb(aabb, { min: [-baseCanopyRadius, 0, -baseCanopyRadius], max: [baseCanopyRadius, H, baseCanopyRadius] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax };
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting'];

const BUILDERS = {
    seed:       buildConiferSeed,
    sprout:     buildConiferSprout,
    seedling:   buildConiferSeedling,
    juvenile:   buildConiferJuvenile,
    mature:     buildConiferMatureStage,
    flowering:  buildConiferFlowering,
    fruiting:   buildConiferFruiting,
};

function conifer(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('conifer', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.conifer = conifer;
