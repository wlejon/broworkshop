// Flower archetype — single bloom on a curved stem with leaves.
// Species presets give wildly different forms (daisy/sunflower/tulip/lily/poppy).

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;

function buildFlowerSeed(opts) {
    const r = 0.025;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || F.PALETTE.seedTan),
        sx: 1.4, sy: 0.5, sz: 0.8 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildFlowerSprout(opts, stageT) {
    const stemH = 0.025 + 0.05 * stageT;
    const out = F.cotyledonPair({ stemH, stemR: 0.004,
        leafLen: 0.025 + 0.025 * stageT, leafW: 0.018 + 0.012 * stageT });
    return { parts: out.parts, aabbMin: [-0.05, 0, -0.05], aabbMax: [0.05, out.height, 0.05] };
}

function buildFlowerSeedling(opts, stageT) {
    const stemH = 0.06 + 0.10 * stageT;
    const out = F.firstTrueLeaves({ seed: opts.seed | 0, stemH,
        leafCount: 4, leafLen: 0.04 + 0.04 * stageT, leafW: 0.02 + 0.015 * stageT,
        leafShape: 'oval', leafColor: F.hexToRgb(opts.stemColor || '#3d6e22') });
    return { parts: out.parts, aabbMin: [-0.08, 0, -0.08], aabbMax: [0.08, out.height, 0.08] };
}

function buildFlowerBud(opts, stageT) {
    // Juvenile stage: full stem + two leaves but bud only (closed flower).
    const r = buildFlowerCore(opts, stageT, { budOnly: true, stemScale: 0.6 + 0.3 * stageT });
    return r;
}

function buildFlowerMature(opts, stageT) {
    return buildFlowerCore(opts, stageT, { stemScale: 0.85 + 0.15 * stageT });
}

function buildFlowerFlowering(opts, stageT) {
    return buildFlowerCore(opts, stageT, { open: true, stemScale: 1.0 });
}

function buildFlowerFruiting(opts, stageT) {
    // Petals fall off, seed pod remains.
    return buildFlowerCore(opts, stageT, { seedPod: true, stemScale: 1.0 });
}

function buildFlowerSenescent(opts, stageT) {
    return buildFlowerCore(opts, stageT, { withered: true, stemScale: 1.0 });
}

// Shared core. Mode flags via cfg.
function buildFlowerCore(opts, stageT, cfg) {
    cfg = cfg || {};
    const seed = (opts.seed | 0) || 1;
    const stemHeightMul = opts.stemHeightMul ?? 1.0;
    const headSizeMul = opts.headSizeMul ?? 1.0;
    const stemLength = (opts.stemLength ?? 0.9) * stemHeightMul * (cfg.stemScale ?? 1);
    const stemRadius = opts.stemRadius ?? 0.012;
    const headSize   = (opts.headSize ?? 0.18) * headSizeMul;
    const petalCount = Math.max(3, opts.petalCount ?? 8);
    const layers     = Math.max(1, opts.layers ?? 1);
    const petalShape = opts.petalShape || 'petal';
    const petalColor = F.hexToRgb(opts.petalColor || '#ea527a');
    const centerColor = F.hexToRgb(opts.centerColor || '#ffd233');
    const stemColor   = F.hexToRgb(opts.stemColor || '#3d6e22');
    const petalBend = opts.petalBend ?? 0.6;
    const petalCurl = opts.petalCurl ?? 0.10;

    const rng = F.mulberry32(seed);
    const parts = [];
    const aabb = F.emptyAabb();

    // Curved bezier stem.
    const lean = (rng() - 0.5) * stemLength * 0.12;
    const stemCtrl = [
        [0, 0, 0],
        [lean*0.3, stemLength * 0.35, lean*0.4],
        [lean*0.7, stemLength * 0.70, lean*0.7],
        [lean,     stemLength,        lean],
    ];
    const stemProfile = F.circleProfile(6, 1);
    const stemTip = stemCtrl[3];
    const stemSamples = 24;
    const stemScale = new Array(stemSamples);
    for (let i = 0; i < stemSamples; i++) {
        const t = stemSamples === 1 ? 0 : i / (stemSamples - 1);
        stemScale[i] = stemRadius * (1 - 0.3 * t);
    }
    const stem = Mesh.bezierSweep(stemCtrl, stemProfile, {
        samples: stemSamples, capStart: true, capEnd: true, closeProfile: true,
        miterJoints: true, profileScale: stemScale,
    });
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.9, twoSided: false });
    F.aabbInclude(aabb, [-stemRadius, 0, -stemRadius]);
    F.aabbInclude(aabb, [stemRadius, stemLength, stemRadius]);

    // Leaves on the stem.
    if (stemLength > 0.25) {
        const leafY = stemLength * 0.4;
        const leafLen = Math.min(0.25, stemLength * 0.4);
        const leafW   = leafLen * 0.5;
        for (let i = 0; i < 2; i++) {
            const leaf = Mesh.leafCard('oval', {
                width: leafW, length: leafLen, bend: 0.5, fullUV: true,
            });
            F.stripVertexColors(leaf);
            leaf.rotate(0, 1, 0, Math.PI * 0.5);
            leaf.rotate(0, 0, 1, Math.PI * 0.15);
            leaf.rotate(0, 1, 0, i === 0 ? 0 : Math.PI);
            leaf.translate(0, leafY, 0);
            parts.push({ mesh: leaf, color: stemColor, metallic: 0, roughness: 0.85 });
        }
    }

    // Head: bud / open / withered / seedpod variations.
    if (cfg.budOnly) {
        // Closed bud — small green ovoid + tiny tip of color showing.
        const bud = F.buildBlob(stemTip, headSize * 0.45,
            (seed * 7) ^ 0xB100, { nsub: 1, sy: 1.2 });
        parts.push({ mesh: bud, color: stemColor, metallic: 0, roughness: 0.9 });
        // Tiny petal tip color peeking out.
        const tip = F.buildBlob([stemTip[0], stemTip[1] + headSize * 0.3, stemTip[2]],
            headSize * 0.2, (seed * 13) ^ 0xB200, { nsub: 1, sy: 0.7 });
        parts.push({ mesh: tip, color: petalColor, metallic: 0, roughness: 0.7 });
        F.aabbInclude(aabb, stemTip, headSize * 0.6);
    } else if (cfg.seedPod) {
        // Seed pod — green/brown bulb where the head was, sometimes splits.
        const pod = F.buildBlob(stemTip, headSize * 0.6,
            (seed * 31) ^ 0xF100, { nsub: 2, sy: 1.4, sx: 0.85, sz: 0.85 });
        parts.push({ mesh: pod, color: F.tint(stemColor, [0.5, 0.4, 0.2], 0.5),
            metallic: 0, roughness: 0.85 });
        F.aabbInclude(aabb, stemTip, headSize * 0.8);
    } else if (cfg.withered) {
        // Withered head — small drooping brown blob.
        const w = F.buildBlob([stemTip[0], stemTip[1] - headSize * 0.2, stemTip[2]],
            headSize * 0.45, (seed * 41) ^ 0xE100, { nsub: 1, sy: 0.85 });
        parts.push({ mesh: w, color: F.autumnTint(petalColor, 0.85, 0.85),
            metallic: 0, roughness: 0.85 });
        F.aabbInclude(aabb, stemTip, headSize * 0.6);
    } else {
        // Open (mature / flowering). Mesh.flower merges petals + center dome
        // into one mesh with one vertex-color stream; petals bake leafCard's
        // windBend into the R channel (see F.stripVertexColors), so the merged
        // mesh is rendered stripped with a single material (petalColor) — that
        // washes out the dome's baked centerColor too. Keep the built-in dome
        // negligibly small and paint the center with its own blob part instead,
        // so it actually shows centerColor rather than petalColor.
        const centerR = headSize * 0.25;
        const centerH = headSize * 0.15;
        const head = Mesh.flower({
            petalCount, petalShape,
            petalLength: headSize, petalWidth: headSize * 0.55,
            petalCurl, petalBend, layers, layerTwist: 0.45,
            centerRadius: 0.001, centerHeight: 0.001,
            centerColor,
        });
        if (head) {
            F.stripVertexColors(head);
            head.translate(stemTip[0], stemTip[1], stemTip[2]);
            parts.push({ mesh: head, color: petalColor, metallic: 0, roughness: 0.7, twoSided: true });
            const center = F.buildBlob(
                [stemTip[0], stemTip[1] + centerH * 0.5, stemTip[2]],
                centerR, (seed * 17) ^ 0xC100, { nsub: 1, sy: centerH / centerR });
            parts.push({ mesh: center, color: centerColor, metallic: 0, roughness: 0.6 });
            F.aabbInclude(aabb, stemTip, headSize * 1.2);
        }
    }

    const fin = F.finalizeAabb(aabb, { min: [-headSize, 0, -headSize], max: [headSize, stemLength + headSize, headSize] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax };
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting', 'senescent'];

const BUILDERS = {
    seed: buildFlowerSeed,
    sprout: buildFlowerSprout,
    seedling: buildFlowerSeedling,
    juvenile: buildFlowerBud,
    mature: buildFlowerMature,
    flowering: buildFlowerFlowering,
    fruiting: buildFlowerFruiting,
    senescent: buildFlowerSenescent,
};

function flower(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('flower', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.flowering;
    return b(opts, r.stageT);
}

Recipes.flower = flower;
