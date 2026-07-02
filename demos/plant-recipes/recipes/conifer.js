// Conifer archetype — trunk + whorled boughs with needle-scatter foliage,
// and life cycle.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

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
    // Small brown male cones along the upper half of the boughs.
    const r = buildMature(opts, stageT, 1);
    const seed = (opts.seed | 0) ^ 0xC1A0;
    const rng = F.mulberry32(seed);
    const baseR = opts.baseCanopyRadius ?? 2.5;
    const upperAnchors = r.anchors.filter((a) => a[1] > r.midY);
    const anchors = [];
    for (const a of upperAnchors) {
        const n = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
            const j = 0.06 * baseR;
            anchors.push([a[0] + (rng() - 0.5) * j, a[1] + (rng() - 0.5) * j * 0.5, a[2] + (rng() - 0.5) * j]);
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
    const seed = (opts.seed | 0) ^ 0xF1A0;
    const rng = F.mulberry32(seed);
    const baseR = opts.baseCanopyRadius ?? 2.5;
    // Cones hang from mid-to-upper boughs, skipping the very tip whorl.
    const midAnchors = r.anchors.filter((a) => a[1] > r.baseY && a[1] < r.topY - r.span * 0.08);
    const anchors = [];
    for (const a of midAnchors) {
        if (rng() > 0.6) continue;
        anchors.push(a);
    }
    const cones = F.fruitCluster({
        anchors, seed, color: F.hexToRgb(opts.coneColor || '#7a5630'),
        radius: Math.max(0.045, baseR * 0.05), density: 0.8, sag: 0.4,
    });
    for (const p of cones.parts) r.parts.push(p);
    return r;
}

// ─── Core mature builder (shared with seedling/juvenile via scale) ───────
//
// Real trunk + whorled boughs (built as a proper branch-segment skeleton,
// swept with Mesh.meshBranches) clothed in a dense needle scatter via
// Mesh.scatterLeaves. Needles are gated off the trunk by `maxRadius`: the
// trunk never tapers below ~0.45x its base radius, while every bough is
// authored much thinner than that from its own base — so the same
// mechanism that keeps flora-lab's leaves off broflora's trunks works
// here by construction instead of by a runtime signal.
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
    const rng = F.mulberry32(seed);

    const widthMul  = coneShape === 'columnar' ? 0.55 : coneShape === 'spreading' ? 1.25 : 1.0;
    const taperPow  = coneShape === 'sharp' ? 1.7 : coneShape === 'tight' ? 1.35 : coneShape === 'spreading' ? 0.85 : 1.0;
    const layerBias = coneShape === 'tight' ? 0.7 : 1.0;   // <1 packs whorls toward the top

    const baseY = H * 0.18;
    const topY  = H * 1.0;
    const span  = topY - baseY;
    const tipY  = topY + Math.max(0.12, baseCanopyRadius * 0.05);

    const parts = [];
    const aabb = F.emptyAabb();
    const segs = [];
    const anchors = [];

    // Trunk: one continuous tapering chain through every whorl height, so
    // each bough attaches to an exact trunk-surface node (no gaps, no
    // guesswork about where the parent segment actually ended).
    const layerYs = [];
    for (let i = 0; i < layers; i++) {
        const tRaw = i / Math.max(1, layers - 1);
        const t = Math.pow(tRaw, layerBias);
        layerYs.push(baseY + t * span);
    }
    const trunkHeights = [0, ...layerYs, tipY];
    const trunkNodeAt = [];
    let prevIdx = -1;
    let prevPos = [0, 0, 0];
    for (let j = 1; j < trunkHeights.length; j++) {
        const y0 = trunkHeights[j - 1], y1 = trunkHeights[j];
        const substeps = j === trunkHeights.length - 1 ? 3 : 2;
        for (let s = 1; s <= substeps; s++) {
            const y = y0 + (y1 - y0) * (s / substeps);
            const tGlobal = F.clamp(y / topY, 0, 1);
            const r = Math.max(trunkRadius * 0.12, trunkRadius * (1 - tGlobal * 0.55));
            const pos = [0, y, 0];
            segs.push({ parent: prevIdx, from: prevPos, to: pos, radius: r });
            prevIdx = segs.length - 1;
            prevPos = pos;
        }
        trunkNodeAt.push(prevIdx);
    }

    // Boughs: a whorl of tapering two-segment branches at each layer height,
    // drooping downward near the base (heavy old growth) and lifting
    // upward near the crown (young growth) — the classic conifer profile.
    const branchBaseR = Math.max(0.01 * scaleMul, trunkRadius * 0.22);
    const branchTipR  = Math.max(0.004 * scaleMul, trunkRadius * 0.04);
    let midY = baseY;
    for (let i = 0; i < layers; i++) {
        const t = i / Math.max(1, layers - 1);
        const y = layerYs[i];
        midY = baseY + span * 0.5;
        const layerR = (baseCanopyRadius * (Math.pow(1 - t, taperPow) * 0.88 + 0.05)) * widthMul;
        const branchCount = 5 + Math.floor(rng() * 3);
        const rot0 = rng() * TAU;
        const parentIdx = trunkNodeAt[i + 1];   // trunkHeights[i+1] === layerYs[i]
        const droop = F.lerp(0.42, -0.22, t);   // + droops down, - lifts up
        for (let k = 0; k < branchCount; k++) {
            const a = rot0 + TAU * k / branchCount + (rng() - 0.5) * 0.25;
            const dir = [Math.cos(a), 0, Math.sin(a)];
            const midR = layerR * 0.55;
            const mid = [dir[0] * midR, y - droop * midR * 0.45, dir[2] * midR];
            const tip = [dir[0] * layerR, y - droop * layerR * 0.8, dir[2] * layerR];
            const s1 = segs.length;
            segs.push({ parent: parentIdx, from: [0, y, 0], to: mid, radius: branchBaseR });
            segs.push({ parent: s1, from: mid, to: tip, radius: branchTipR });
            anchors.push(tip);
            F.aabbInclude(aabb, tip, layerR * 0.1);
        }
    }

    if (segs.length > 0) {
        const trunkMesh = Mesh.meshBranches(segs, 8);
        if (trunkMesh) parts.push({
            mesh: trunkMesh, color: trunkColor, metallic: 0, roughness: 0.95, twoSided: false,
        });
        for (const s of segs) {
            F.aabbInclude(aabb, s.from, s.radius);
            F.aabbInclude(aabb, s.to, s.radius);
        }
    }

    // Needles: scattered along every bough segment, gated off the trunk by
    // maxRadius (boughs are authored much thinner than the trunk everywhere
    // along their length — see the doc comment above). Sized relative to
    // the canopy (not a fixed constant) and built with a minimal grid —
    // a needle is a thin flat wedge, not a card that needs to bend/curl —
    // so the scatter can run dense enough to read as a filled bough
    // instead of a few wisps without an unreasonable triangle budget.
    const needleLen = F.clamp(baseCanopyRadius * 0.24, 0.05, 0.8);
    const needleW   = needleLen * 0.16;
    const needle = Mesh.leafCard('needle', {
        width: needleW, length: needleLen, bend: 0.1, fullUV: true,
        widthSegments: 1, lengthSegments: 2,
    });
    F.stripVertexColors(needle);
    const boughSegs = segs.filter((s) => s.radius <= branchBaseR * 1.01);
    const needles = Mesh.scatterLeaves(boughSegs, needle, {
        maxRadius:     branchBaseR * 1.05,
        minDepth:      0,
        perUnitLength: 220,
        upBias:        0.15,
        tiltJitter:    0.5,
        rollJitter:    1.0,
        baseScale:     1.0,
        scaleJitter:   0.25,
        seed:          (seed * 733 + 11) >>> 0,
    });
    if (needles && needles.triangleCount > 0) {
        parts.push({ mesh: needles, color: canopyColor, metallic: 0, roughness: 0.88, twoSided: true });
    }

    const fin = F.finalizeAabb(aabb, { min: [-baseCanopyRadius, 0, -baseCanopyRadius], max: [baseCanopyRadius, H, baseCanopyRadius] });
    return {
        parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax,
        anchors, baseY, topY, midY, span,
    };
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
