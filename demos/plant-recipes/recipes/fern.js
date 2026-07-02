// Fern archetype — curved rachis with paired leaflets (no flowers; spores).

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;

function buildFernSeed(opts) {
    // Tiny brown spore on the ground.
    const r = 0.012;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#5a4030'),
        sx: 1.0, sy: 0.6, sz: 1.0 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildFernSprout(opts, stageT) {
    // Fiddlehead — tightly coiled crozier on a tiny stem.
    const stemH = 0.04 + 0.06 * stageT;
    const parts = [];
    const stemColor = F.hexToRgb(opts.stemColor || '#3a5a26');
    const stem = Mesh.tube([[0, 0, 0], [0, stemH, 0]], [0.005, 0.004], 5);
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.85, twoSided: false });

    // The coil — circular arc of small blob bumps spiraling at the tip.
    const coilCount = 6;
    const coilColor = F.hexToRgb(opts.leafColor || F.PALETTE.fernLeaf);
    const coilR = 0.018 + 0.012 * stageT;
    const cy = stemH;
    for (let i = 0; i < coilCount; i++) {
        const t = i / coilCount;
        const a = t * Math.PI * 2.2;
        const r = coilR * (1 - t * 0.5);
        const c = [Math.cos(a) * r, cy + r * 0.5 + Math.sin(a) * r * 0.4, 0];
        const m = F.buildBlob(c, 0.005 + 0.004 * (1 - t), (opts.seed | 0) * 7 + i,
            { nsub: 1, sx: 1.2, sy: 0.6, sz: 1.0 });
        parts.push({ mesh: m, color: coilColor, metallic: 0, roughness: 0.85 });
    }
    return { parts, aabbMin: [-0.04, 0, -0.04], aabbMax: [0.04, cy + coilR * 1.5, 0.04] };
}

// One frond (rachis + paired pinnae), built in local space: base at the
// origin, arching toward +Z in the Y-Z plane. Returns its sub-meshes so the
// caller can rotate copies of it into a radial crown.
function buildOneFrond(p) {
    const { pairs, length, stemRadius, leafletLength, curvature, scaleMul } = p;
    const fCount = pairs;
    const step = length / fCount;
    const bendPerStep = curvature / fCount;
    let dir = [0, 1, 0];
    let cur = [0, 0, 0];
    const rachis = [cur];
    for (let i = 0; i < fCount; i++) {
        const c = Math.cos(bendPerStep), s = Math.sin(bendPerStep);
        dir = F.vNorm([dir[0], c*dir[1] - s*dir[2], s*dir[1] + c*dir[2]]);
        cur = F.vAdd(cur, F.vScale(dir, step));
        rachis.push(cur);
    }

    const sub = [];
    const stemScale = rachis.map((_, i) => {
        const t = i / (rachis.length - 1);
        return stemRadius * Math.max(0.15, 1 - t);
    });
    const rachisMesh = Mesh.tube(rachis, stemScale, 6);
    if (rachisMesh) sub.push(rachisMesh);

    // The rachis is built entirely in the Y-Z plane, so the frond's plane
    // normal is a constant world X. Push pinnae out along ±X directly — the
    // old cross(tangent, ±axis) flipped *into* the plane on the arched upper
    // half (|cross| → 0 there), which collapsed the upper leaflets onto the
    // rachis and z-fought. `frondUp` is the frond-sheet normal; a little of
    // it gives the pinnae an upward dihedral (V-shaped feather) and a gentle
    // tip droop, so the frond reads as 3D instead of a flat sliver.
    const planeNormal = [1, 0, 0];
    for (let i = 1; i < rachis.length; i++) {
        const pt = rachis[i];
        const tangent = F.vNormOr(F.vSub(rachis[i], rachis[i - 1]), [0, 1, 0]);
        const t = i / (rachis.length - 1);
        const taper = Math.sin(Math.PI * t);
        const ll = leafletLength * Math.max(0.15, taper);

        const frondUp = F.vNormOr(F.vCross(tangent, planeNormal), [0, 0, 1]);

        for (const sign of [1, -1]) {
            // Out to the side, swept toward the tip, lifted a touch out of plane.
            const sideDir = F.vNorm([
                planeNormal[0] * sign + tangent[0] * 0.4 + frondUp[0] * 0.18,
                planeNormal[1] * sign + tangent[1] * 0.4 + frondUp[1] * 0.18,
                planeNormal[2] * sign + tangent[2] * 0.4 + frondUp[2] * 0.18,
            ]);
            const leafPath = [];
            const lsegs = 6;
            for (let k = 0; k <= lsegs; k++) {
                const u = k / lsegs;
                const base = F.vAdd(pt, F.vScale(sideDir, u * ll));
                // Curl the pinna tip gently back down out of the flat sheet.
                leafPath.push(F.vAdd(base, F.vScale(frondUp, -0.12 * u * u * ll)));
            }
            const leafW = 0.05 * Math.max(0.2, taper) * scaleMul;
            const leafScale = leafPath.map((_, k) => Math.max(0.08, 1 - k / (leafPath.length - 1)));
            const lm = Mesh.bladeStrip(leafPath, {
                width: leafW, thickness: leafW * 0.15,
                capStart: false, capEnd: true, miterJoints: false,
                profileScale: leafScale,
            });
            if (lm) sub.push(lm);
        }
    }
    return { sub, rachis };
}

function buildFernCore(opts, age01, scaleMul) {
    scaleMul = scaleMul ?? 1;
    const pairs = Math.max(2, opts.leafletPairs ?? 20);
    const length = (opts.length ?? 1.5) * scaleMul;
    const stemRadius = (opts.stemRadius ?? 0.012) * scaleMul;
    const leafletLength = (opts.leafletLength ?? 0.32) * scaleMul;
    const curvature = opts.curvature ?? 1.4;
    const leafColor = F.hexToRgb(opts.leafColor || F.PALETTE.fernLeaf);

    // A fern is a crown of fronds sprung from a single base, not one blade.
    // Scale the count with age so seedlings are sparse and mature ferns full.
    const frondMax = Math.max(1, Math.round(opts.fronds ?? 7));
    const frondCount = Math.max(1, Math.round(frondMax * (0.35 + 0.65 * (age01 ?? 1))));
    const rng = F.mulberry32(((opts.seed | 0) || 1) ^ 0x5e12);

    const allSub = [];
    let aabbLen = length;
    for (let fi = 0; fi < frondCount; fi++) {
        // Even radial spread with a little jitter; vary length/curvature so the
        // crown reads organic rather than stamped.
        const az = (fi / frondCount) * F.TAU + (rng() - 0.5) * 0.5;
        const lenMul = 0.82 + rng() * 0.36;
        const curveMul = 0.85 + rng() * 0.35;
        const fr = buildOneFrond({
            pairs, length: length * lenMul, stemRadius,
            leafletLength, curvature: curvature * curveMul, scaleMul,
        });
        aabbLen = Math.max(aabbLen, length * lenMul);
        for (const m of fr.sub) {
            m.rotate(0, 1, 0, az);
            allSub.push(m);
        }
    }

    const merged = allSub.length > 1 ? Mesh.merge(allSub) : allSub[0];
    const reach = aabbLen + leafletLength;
    return {
        parts: [{ mesh: merged, color: leafColor, metallic: 0, roughness: 0.9 }],
        aabbMin: [-reach, 0, -reach], aabbMax: [reach, aabbLen, reach],
    };
}

function buildFernSeedling(opts, stageT) { return buildFernCore(opts, stageT, 0.25 + 0.20 * stageT); }
function buildFernJuvenile(opts, stageT) { return buildFernCore(opts, stageT, 0.50 + 0.30 * stageT); }
function buildFernMature(opts, stageT) { return buildFernCore(opts, stageT, 1); }
function buildFernSenescent(opts, stageT) {
    const tinted = F.autumnTint(F.hexToRgb(opts.leafColor || F.PALETTE.fernLeaf), 0.6 * stageT, 0.4);
    return buildFernCore(Object.assign({}, opts, { leafColor: tinted }), stageT, 1);
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'senescent'];

const BUILDERS = {
    seed: buildFernSeed, sprout: buildFernSprout, seedling: buildFernSeedling,
    juvenile: buildFernJuvenile, mature: buildFernMature, senescent: buildFernSenescent,
};

function fern(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('fern', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.fern = fern;
