// Grass tuft archetype — radial blades, optional pampas plume at flowering.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

function buildGrassSeed(opts) {
    const r = 0.012;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#a89060'), sx: 1.6, sy: 0.4, sz: 0.7 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildGrassSprout(opts, stageT) {
    // Two thin sprouting blades.
    const parts = [];
    const baseColor = F.hexToRgb(opts.color || F.PALETTE.grassBlade);
    const len = 0.04 + 0.05 * stageT;
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.3;
        const path = Mesh.bladePath({
            base: [Math.cos(a) * 0.005, 0, Math.sin(a) * 0.005],
            tipDir: [Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2],
            length: len, bend: 0.02, lift: 0.0, segments: 5,
        });
        const profileScale = path.map((_, k) => Math.max(0.1, 1 - k / (path.length - 1)));
        const m = Mesh.bladeStrip(path, {
            width: 0.005, thickness: 0.0008, capStart: false, capEnd: true, miterJoints: true,
            profileScale,
        });
        if (m) parts.push({ mesh: m, color: baseColor, metallic: 0, roughness: 0.95 });
    }
    return { parts, aabbMin: [-0.03, 0, -0.03], aabbMax: [0.03, len, 0.03] };
}

function buildGrassMature(opts, stageT, scaleMul, plumeMul) {
    scaleMul = scaleMul ?? 1;
    plumeMul = plumeMul ?? 0;
    const seed = (opts.seed | 0) || 1;
    const blades = Math.max(1, opts.bladeCount ?? 12);
    const height = (opts.height ?? 0.4) * scaleMul;
    const baseRadius = opts.baseRadius ?? Math.max(0.05, height * 0.18);
    const bladeWidth = opts.bladeWidth ?? 0.012;
    const bend = opts.bend ?? 0.6;
    const color = F.hexToRgb(opts.color || F.PALETTE.grassBlade);

    const rng = F.mulberry32(seed);
    const parts = [];
    const aabb = F.emptyAabb();

    for (let i = 0; i < blades; i++) {
        const ang = TAU * i / blades + rng() * 0.4;
        const br = baseRadius * (0.4 + 0.6 * rng());
        const base = [Math.cos(ang) * br, 0, Math.sin(ang) * br];
        const bladeH = height * (0.7 + 0.6 * rng());
        const tipBend = bend * (0.6 + 0.8 * rng());
        const outDir = [Math.cos(ang), 0, Math.sin(ang)];

        const path = [];
        const segs = 8;
        for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            const lateral = Math.sin(t * tipBend) * bladeH * 0.35;
            const vertical = Math.cos(t * tipBend) * bladeH * t;
            path.push([
                base[0] + outDir[0] * lateral, base[1] + vertical, base[2] + outDir[2] * lateral,
            ]);
        }
        const profileScale = path.map((_, s) => Math.max(0.05, 1 - s / (path.length - 1)));
        const twist = path.map(() => -ang);
        const blade = Mesh.bladeStrip(path, {
            width: bladeWidth, thickness: bladeWidth * 0.15,
            capStart: false, capEnd: true, miterJoints: true,
            profileScale, twist,
        });
        if (blade) parts.push({ mesh: blade, color, metallic: 0, roughness: 0.95 });
        F.aabbInclude(aabb, base, bladeH);
    }

    if (plumeMul > 0 && opts.plumeColor) {
        // A pampas-style feathery plume at the apex of central blades.
        const plumeColor = F.hexToRgb(opts.plumeColor);
        const plumeCount = 5;
        const plumeY = height * 0.95;
        for (let i = 0; i < plumeCount; i++) {
            const a = TAU * i / plumeCount + rng() * 0.3;
            const c = [Math.cos(a) * baseRadius * 0.15, plumeY, Math.sin(a) * baseRadius * 0.15];
            const m = F.buildBlob(c, height * 0.18 * plumeMul,
                (seed * 11 + i * 17) ^ 0xA801,
                { nsub: 1, sx: 0.4, sy: 1.3, sz: 0.4 });
            parts.push({ mesh: m, color: plumeColor, metallic: 0, roughness: 0.85 });
        }
    }

    const fin = F.finalizeAabb(aabb, { min: [-baseRadius, 0, -baseRadius], max: [baseRadius, height, baseRadius] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax };
}

function buildGrassSeedling(opts, stageT) { return buildGrassMature(opts, stageT, 0.35 + 0.30 * stageT, 0); }
function buildGrassJuvenile(opts, stageT) { return buildGrassMature(opts, stageT, 0.65 + 0.25 * stageT, 0); }
function buildGrassMatureStage(opts, stageT) { return buildGrassMature(opts, stageT, 1, 0); }
function buildGrassFlowering(opts, stageT) { return buildGrassMature(opts, stageT, 1, opts.plumeColor ? 0.5 + 0.5 * stageT : 0); }
function buildGrassSenescent(opts, stageT) {
    const tinted = F.autumnTint(F.hexToRgb(opts.color || F.PALETTE.grassBlade), 0.6 * stageT, 0.2);
    return buildGrassMature(Object.assign({}, opts, { color: tinted }), stageT, 1, 0);
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'senescent'];

const BUILDERS = {
    seed: buildGrassSeed, sprout: buildGrassSprout, seedling: buildGrassSeedling,
    juvenile: buildGrassJuvenile, mature: buildGrassMatureStage,
    flowering: buildGrassFlowering, senescent: buildGrassSenescent,
};

function grassTuft(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('grassTuft', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.grassTuft = grassTuft;
