// Cactus archetype — 4 species (barrel / pricklyPear / saguaro / hedgehog).

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

function buildCactusSeed(opts) {
    const r = 0.012;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#3a2a18'),
        sx: 1.2, sy: 0.45, sz: 0.9 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildCactusSprout(opts, stageT) {
    // A tiny green nub coming out of the ground.
    const r = 0.025 + 0.025 * stageT;
    const c = [0, r * 0.9, 0];
    const m = F.buildBlob(c, r, (opts.seed | 0) ^ 0xC101,
        { nsub: 1, sx: 0.85, sy: 1.4, sz: 0.85 });
    const parts = [{ mesh: m, color: F.hexToRgb(opts.color || F.PALETTE.cactusGreen),
        metallic: 0, roughness: 0.78 }];
    return { parts, aabbMin: [-r, 0, -r], aabbMax: [r, r * 2.2, r] };
}

// ─── Body builders per shape ──────────────────────────────────────────────

function buildBarrel(opts, scaleMul, anchorsOut) {
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 1.2) * scaleMul;
    const R = (opts.radius ?? 0.45) * scaleMul;
    const ribs = Math.max(6, opts.ribs ?? 14);
    const color = F.hexToRgb(opts.color || F.PALETTE.cactusGreen);

    const parts = [];
    const cy = H * 0.5;
    // Main body — vertically scaled blob with rib jitter.
    const body = F.buildBlob([0, cy, 0], R, seed ^ 0xCC10,
        { nsub: 3, sx: 1.0, sy: H / (2 * R), sz: 1.0 });
    parts.push({ mesh: body, color, metallic: 0, roughness: 0.7 });

    // Add subtle vertical rib bumps via small tubes along the surface.
    for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * TAU;
        const path = [
            [Math.cos(a) * R * 0.97, 0.02, Math.sin(a) * R * 0.97],
            [Math.cos(a) * R * 0.97, H - 0.02, Math.sin(a) * R * 0.97],
        ];
        const m = Mesh.tube(path, R * 0.04, 4);
        if (m) parts.push({ mesh: m, color: F.tint(color, [0, 0, 0], 0.15), metallic: 0, roughness: 0.7, twoSided: false });
    }

    // Spines.
    const spines = F.spineCluster({
        seed: seed ^ 0xCC20,
        center: [0, cy, 0], surfaceRadius: R, surfaceHeight: H,
        count: Math.round(120 * scaleMul * scaleMul), length: 0.025 * scaleMul,
        yMin: 0.05, yMax: H - 0.05,
    });
    for (const p of spines.parts) parts.push(p);

    if (anchorsOut) anchorsOut.push([0, H * 0.92, 0]);
    return { parts, aabbMin: [-R, 0, -R], aabbMax: [R, H, R] };
}

function buildPricklyPear(opts, scaleMul, anchorsOut) {
    const seed = (opts.seed | 0) || 1;
    const padW = (opts.padW ?? 0.6) * scaleMul;
    const padH = (opts.padH ?? 0.7) * scaleMul;
    const padThick = padW * 0.18;
    const padCount = Math.max(1, opts.pads ?? 4);
    const color = F.hexToRgb(opts.color || F.PALETTE.cactusGreen);

    const rng = F.mulberry32(seed);
    const parts = [];
    const aabb = F.emptyAabb();

    // Iteratively stack pads on top/edges of previous pads.
    const pads = [];
    function placePad(c, ang, level) {
        const sx = padW;
        const sy = padH;
        const sz = padThick;
        // Tilt pad to face outward.
        const m = F.buildBlob(c, 1, seed ^ 0xCC30 + level,
            { nsub: 3, sx, sy, sz });
        // Rotate around Y by ang so pads fan out.
        m.rotate(0, 1, 0, ang);
        parts.push({ mesh: m, color, metallic: 0, roughness: 0.7 });
        pads.push({ c, ang, level });
        F.aabbInclude(aabb, c, Math.max(sx, sy, sz));
        if (anchorsOut) anchorsOut.push([c[0], c[1] + sy * 0.9, c[2]]);
    }

    placePad([0, padH * 0.85, 0], 0, 0);
    for (let i = 1; i < padCount; i++) {
        const parent = pads[Math.floor(rng() * pads.length)];
        const a = parent.ang + (rng() - 0.5) * Math.PI * 0.7;
        const dy = padH * 1.1;
        const dx = Math.cos(a) * padW * 0.9;
        const dz = Math.sin(a) * padW * 0.9;
        placePad([parent.c[0] + dx, parent.c[1] + dy * 0.55, parent.c[2] + dz], a, i);
    }

    // Spines along pad surfaces — light sprinkle.
    for (const p of pads) {
        const sp = F.spineCluster({
            seed: seed ^ (0xCD00 + p.level),
            center: p.c, surfaceRadius: padW * 0.85, surfaceHeight: padH * 1.6,
            count: 18, length: 0.018 * scaleMul,
        });
        for (const ppp of sp.parts) parts.push(ppp);
    }

    const fin = F.finalizeAabb(aabb, { min: [-padW * 1.5, 0, -padW * 1.5], max: [padW * 1.5, padH * padCount, padW * 1.5] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax };
}

function buildSaguaro(opts, scaleMul, anchorsOut) {
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 4.0) * scaleMul;
    const R = (opts.radius ?? 0.35) * scaleMul;
    const arms = Math.max(0, opts.arms ?? 2);
    const color = F.hexToRgb(opts.color || F.PALETTE.cactusGreen);
    const parts = [];

    // Main column.
    const col = F.buildBlob([0, H * 0.5, 0], R, seed ^ 0xCC40,
        { nsub: 3, sx: 1.0, sy: H / (2 * R), sz: 1.0 });
    parts.push({ mesh: col, color, metallic: 0, roughness: 0.7 });

    if (anchorsOut) anchorsOut.push([0, H * 0.95, 0]);

    // Arms — curved bezier sweep going out then up.
    const rng = F.mulberry32(seed * 7);
    const profile = F.circleProfile(8, 1);
    for (let i = 0; i < arms; i++) {
        const ang = (i / arms) * TAU + rng() * 0.4;
        const armBaseY = H * (0.35 + rng() * 0.30);
        const armR = R * 0.75;
        const armLen = H * (0.55 + rng() * 0.20);
        const ctrl = [
            [Math.cos(ang) * R * 0.75, armBaseY, Math.sin(ang) * R * 0.75],
            [Math.cos(ang) * (R + armLen * 0.5), armBaseY + armLen * 0.10, Math.sin(ang) * (R + armLen * 0.5)],
            [Math.cos(ang) * (R + armLen * 0.7), armBaseY + armLen * 0.55, Math.sin(ang) * (R + armLen * 0.7)],
            [Math.cos(ang) * (R + armLen * 0.7), armBaseY + armLen, Math.sin(ang) * (R + armLen * 0.7)],
        ];
        const samples = 16;
        const armScale = new Array(samples);
        for (let k = 0; k < samples; k++) {
            const t = k / (samples - 1);
            armScale[k] = armR * (0.85 + 0.15 * Math.sin(Math.PI * t));
        }
        const arm = Mesh.bezierSweep(ctrl, profile, {
            samples, capStart: false, capEnd: true, closeProfile: true,
            miterJoints: true, profileScale: armScale,
        });
        if (arm) parts.push({ mesh: arm, color, metallic: 0, roughness: 0.7 });
        if (anchorsOut) anchorsOut.push(ctrl[3]);
    }

    // Spines along main column.
    const spines = F.spineCluster({
        seed: seed ^ 0xCC50,
        center: [0, H * 0.5, 0], surfaceRadius: R, surfaceHeight: H,
        count: Math.round(180 * scaleMul), length: 0.022 * scaleMul,
        yMin: 0.05, yMax: H - 0.05,
    });
    for (const p of spines.parts) parts.push(p);

    return { parts, aabbMin: [-R * 2, 0, -R * 2], aabbMax: [R * 2, H, R * 2] };
}

function buildHedgehog(opts, scaleMul, anchorsOut) {
    const seed = (opts.seed | 0) || 1;
    const H = (opts.height ?? 0.32) * scaleMul;
    const R = (opts.radius ?? 0.30) * scaleMul;
    const color = F.hexToRgb(opts.color || F.PALETTE.cactusGreen);

    const parts = [];
    const body = F.buildBlob([0, H * 0.5, 0], R, seed ^ 0xCC60,
        { nsub: 3, sx: 1.0, sy: H / (2 * R), sz: 1.0 });
    parts.push({ mesh: body, color, metallic: 0, roughness: 0.7 });

    if (anchorsOut) anchorsOut.push([0, H * 0.95, 0]);

    // Dense radial spines.
    const spines = F.spineCluster({
        seed: seed ^ 0xCC70,
        center: [0, H * 0.5, 0], surfaceRadius: R, surfaceHeight: H,
        count: Math.round(220 * scaleMul * scaleMul), length: 0.025 * scaleMul,
    });
    for (const p of spines.parts) parts.push(p);

    return { parts, aabbMin: [-R, 0, -R], aabbMax: [R, H, R] };
}

const SHAPE_BUILDERS = {
    barrel: buildBarrel,
    pricklyPear: buildPricklyPear,
    saguaro: buildSaguaro,
    hedgehog: buildHedgehog,
};

function buildBody(opts, scaleMul, anchorsOut) {
    const shape = opts.shape || 'barrel';
    const fn = SHAPE_BUILDERS[shape] || buildBarrel;
    return fn(opts, scaleMul, anchorsOut);
}

function buildCactusSeedling(opts, stageT) {
    const anchors = [];
    return buildBody(opts, 0.20 + 0.15 * stageT, anchors);
}
function buildCactusJuvenile(opts, stageT) {
    const anchors = [];
    return buildBody(opts, 0.40 + 0.30 * stageT, anchors);
}
function buildCactusMature(opts, stageT) {
    const anchors = [];
    return buildBody(opts, 1, anchors);
}
function buildCactusFlowering(opts, stageT) {
    const anchors = [];
    const r = buildBody(opts, 1, anchors);
    const flowerColor = F.hexToRgb(opts.flowerColor || F.PALETTE.cactusFlower);
    const blooms = F.bloomCluster({
        anchors, seed: (opts.seed | 0) ^ 0xCBC0,
        color: flowerColor,
        radius: 0.06,
        density: 0.7 + 0.3 * stageT,
        useFlower: true,
        petalShape: 'petal',
        petalCount: 8, layers: 1,
        petalBend: 0.45, petalCurl: 0.05,
    });
    for (const p of blooms.parts) r.parts.push(p);
    return r;
}
function buildCactusFruiting(opts, stageT) {
    const anchors = [];
    const r = buildBody(opts, 1, anchors);
    const fruitColor = F.hexToRgb(opts.fruitColor || '#c45a4e');
    const fruit = F.fruitCluster({
        anchors, seed: (opts.seed | 0) ^ 0xCFC0,
        color: fruitColor,
        radius: 0.04,
        density: 0.85,
        sag: 0.0,
    });
    for (const p of fruit.parts) r.parts.push(p);
    return r;
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting'];

const BUILDERS = {
    seed: buildCactusSeed, sprout: buildCactusSprout,
    seedling: buildCactusSeedling, juvenile: buildCactusJuvenile,
    mature: buildCactusMature, flowering: buildCactusFlowering, fruiting: buildCactusFruiting,
};

function cactus(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('cactus', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.cactus = cactus;
