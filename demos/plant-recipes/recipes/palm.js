// Palm archetype — curved trunk + radial frond crown + optional fruit.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

function buildPalmSeed(opts) {
    const r = 0.06;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#5a3818'),
        sx: 1.4, sy: 0.85, sz: 1.0 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildPalmSprout(opts, stageT) {
    // A tiny stalk with one or two emerging fronds.
    const stemH = 0.08 + 0.10 * stageT;
    const parts = [];
    const stemColor = F.hexToRgb(opts.trunkColor || '#7a5a3c');
    const stem = Mesh.tube([[0, 0, 0], [0, stemH, 0]], [0.012, 0.010], 5);
    if (stem) parts.push({ mesh: stem, color: stemColor, metallic: 0, roughness: 0.85, twoSided: false });
    const frondColor = F.hexToRgb(opts.frondColor || '#3a6a2a');
    for (let i = 0; i < 2; i++) {
        const a = i * Math.PI;
        const f = Mesh.leafCard('frond', {
            width: 0.03, length: 0.10 + 0.06 * stageT,
            bend: 0.3, fullUV: true,
        });
        F.stripVertexColors(f);
        f.rotate(0, 1, 0, Math.PI * 0.5);
        f.rotate(0, 0, 1, Math.PI * 0.55);
        f.rotate(0, 1, 0, a);
        f.translate(0, stemH, 0);
        parts.push({ mesh: f, color: frondColor, metallic: 0, roughness: 0.85 });
    }
    return { parts, aabbMin: [-0.10, 0, -0.10], aabbMax: [0.10, stemH + 0.10, 0.10] };
}

// One feathered (pinnate) palm frond, in local space: springs from the origin
// along +X, arching and drooping in -Y, with paired leaflets fanning out in
// ±Z. Returns its sub-meshes so the caller can rotate copies into the crown.
// A single flat leaf card reads as a crude paddle; real palm fronds are a
// midrib carrying dozens of thin leaflets.
function buildPalmFrond(length, width, bend, seed) {
    const rng = F.mulberry32((seed >>> 0) || 1);
    const segs = 12;
    const rachis = [];
    for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        rachis.push([t * length, -bend * length * t * t, 0]);
    }
    const sub = [];
    const rScale = rachis.map((_, k) => {
        const t = k / (rachis.length - 1);
        return width * 0.06 * Math.max(0.15, 1 - t);
    });
    const rmesh = Mesh.tube(rachis, rScale, 5);
    if (rmesh) sub.push(rmesh);

    // The rachis lives in the X-Y plane, so leaflets go out along the plane
    // normal (±Z), swept toward the tip and pitched up out of the sheet.
    const planeNormal = [0, 0, 1];
    const pairs = 22;
    for (let i = 1; i <= pairs; i++) {
        const t = i / (pairs + 1);
        const ri = t * (rachis.length - 1);
        const idx = Math.min(rachis.length - 1, Math.max(1, Math.round(ri)));
        const p = rachis[idx];
        const tangent = F.vNormOr(F.vSub(rachis[idx], rachis[idx - 1]), [1, 0, 0]);
        const taper = Math.sin(Math.PI * t);
        const ll = width * (0.5 + 0.5 * taper);
        const frondUp = F.vNormOr(F.vCross(tangent, planeNormal), [0, 1, 0]);
        for (const sign of [1, -1]) {
            const sideDir = F.vNorm([
                planeNormal[0] * sign + tangent[0] * 0.15 + frondUp[0] * 0.1,
                planeNormal[1] * sign + tangent[1] * 0.15 + frondUp[1] * 0.1,
                planeNormal[2] * sign + tangent[2] * 0.15 + frondUp[2] * 0.1,
            ]);
            const lsegs = 5;
            const leafPath = [];
            for (let k = 0; k <= lsegs; k++) {
                const u = k / lsegs;
                const base = F.vAdd(p, F.vScale(sideDir, u * ll));
                leafPath.push(F.vAdd(base, F.vScale(frondUp, -0.28 * u * u * ll)));
            }
            const lw = width * 0.17 * Math.max(0.3, taper);
            const lscale = leafPath.map((_, k) => Math.max(0.06, 1 - k / (leafPath.length - 1)));
            const lm = Mesh.bladeStrip(leafPath, {
                width: lw, thickness: lw * 0.12,
                capStart: false, capEnd: true, miterJoints: false,
                profileScale: lscale,
            });
            if (lm) sub.push(lm);
        }
        void rng;
    }
    return sub;
}

function buildPalmCore(opts, age01, scaleMul, includeFruits) {
    scaleMul = scaleMul ?? 1;
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 7) * scaleMul;
    const trunkRadius = (opts.trunkRadius ?? 0.18) * scaleMul;
    const fronds = Math.max(4, opts.fronds ?? 12);
    const frondLength = (opts.frondLength ?? Math.min(2.2, H * 0.32));
    const frondColor = F.hexToRgb(opts.frondColor || '#3a6a2a');
    const trunkColor = F.hexToRgb(opts.trunkColor || '#7a5a3c');

    const parts = [];
    const aabb = F.emptyAabb();

    // Curved trunk via bezierSweep — leans slightly off vertical so palm
    // doesn't look like a telephone pole.
    const rng = F.mulberry32(seed * 13);
    const lean = (rng() - 0.5) * H * 0.08;
    const ctrl = [
        [0, 0, 0],
        [lean * 0.3, H * 0.35, lean * 0.4],
        [lean * 0.7, H * 0.70, lean * 0.7],
        [lean,       H,        lean],
    ];
    const samples = 24;
    const trunkScale = new Array(samples);
    for (let i = 0; i < samples; i++) {
        const t = samples === 1 ? 0 : i / (samples - 1);
        // Slight base flare common in palms.
        trunkScale[i] = trunkRadius * (1.0 + 0.25 * Math.exp(-t * 4) - 0.10 * t);
    }
    const trunk = Mesh.bezierSweep(ctrl, F.circleProfile(8, 1), {
        samples, capStart: false, capEnd: true, closeProfile: true,
        miterJoints: true, profileScale: trunkScale,
    });
    if (trunk) parts.push({ mesh: trunk, color: trunkColor, metallic: 0, roughness: 0.92, twoSided: false });
    F.aabbInclude(aabb, [0, 0, 0], trunkRadius * 1.5);
    F.aabbInclude(aabb, ctrl[3], trunkRadius * 1.5);

    // Crown of fronds at the top.
    const tip = ctrl[3];
    for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * TAU + rng() * 0.2;
        const tilt = -(0.20 + rng() * 0.35); // angle below horizontal
        const flen = frondLength * (0.85 + rng() * 0.30);
        const fwidth = frondLength * 0.28;
        const fbend = 0.45 + rng() * 0.25;
        const frond = buildPalmFrond(flen, fwidth, fbend, (seed * 131 + i * 17) >>> 0);
        for (const m of frond) {
            m.rotate(0, 0, 1, tilt);   // droop the whole frond below horizontal
            m.rotate(0, 1, 0, a);      // fan around the crown
            m.translate(tip[0], tip[1], tip[2]);
            parts.push({ mesh: m, color: frondColor, metallic: 0, roughness: 0.85, twoSided: true });
        }
        F.aabbInclude(aabb, tip, frondLength * 1.2);
    }

    if (includeFruits && opts.fruitColor) {
        const fruitColor = F.hexToRgb(opts.fruitColor);
        const fruitR = opts.fruitRadius ?? 0.16;
        const cluster = 6;
        for (let i = 0; i < cluster; i++) {
            const a = (i / cluster) * TAU;
            const c = [tip[0] + Math.cos(a) * trunkRadius * 1.6,
                       tip[1] - trunkRadius * 1.3,
                       tip[2] + Math.sin(a) * trunkRadius * 1.6];
            const m = F.buildBlob(c, fruitR, (seed * 31 + i * 7) ^ 0xF777, { nsub: 1, sy: 1.1 });
            parts.push({ mesh: m, color: fruitColor, metallic: 0, roughness: 0.6 });
        }
    }

    const fin = F.finalizeAabb(aabb, { min: [-frondLength, 0, -frondLength], max: [frondLength, H + frondLength * 0.3, frondLength] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax };
}

function buildPalmSeedling(opts, stageT) { return buildPalmCore(opts, stageT, 0.15 + 0.15 * stageT, false); }
function buildPalmJuvenile(opts, stageT) { return buildPalmCore(opts, stageT, 0.35 + 0.30 * stageT, false); }
function buildPalmMature(opts, stageT) { return buildPalmCore(opts, stageT, 1, false); }
function buildPalmFlowering(opts, stageT) { return buildPalmCore(opts, stageT, 1, false); }
function buildPalmFruiting(opts, stageT) { return buildPalmCore(opts, stageT, 1, true); }

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting'];

const BUILDERS = {
    seed: buildPalmSeed, sprout: buildPalmSprout, seedling: buildPalmSeedling,
    juvenile: buildPalmJuvenile, mature: buildPalmMature,
    flowering: buildPalmFlowering, fruiting: buildPalmFruiting,
};

function palm(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('palm', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.palm = palm;
