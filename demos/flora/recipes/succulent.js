// Succulent archetype — radial fleshy leaves arranged spirally.

(function (root) {

const F = root.FloraCore;
const L = root.Lifecycle;
const TAU = F.TAU;

function buildSucculentSeed(opts) {
    const r = 0.014;
    const out = F.seedShape({ seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || F.PALETTE.seedTan),
        sx: 1.2, sy: 0.55, sz: 1.0 });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildSucculentSprout(opts, stageT) {
    // First two thick fleshy leaves emerging from the ground.
    const parts = [];
    const color = F.hexToRgb(opts.color || F.PALETTE.succulent);
    const len = 0.04 + 0.04 * stageT;
    for (let i = 0; i < 2; i++) {
        const a = i * Math.PI;
        const path = [
            [Math.cos(a) * 0.005, 0, Math.sin(a) * 0.005],
            [Math.cos(a) * len * 0.6, len * 0.3, Math.sin(a) * len * 0.6],
            [Math.cos(a) * len, len * 0.6, Math.sin(a) * len],
        ];
        const profileScale = path.map((_, k) => {
            const u = k / (path.length - 1);
            return Math.max(0.2, Math.sin(Math.PI * u));
        });
        const m = Mesh.bladeStrip(path, {
            width: 0.022, thickness: 0.012,
            capStart: true, capEnd: true, miterJoints: true, profileScale,
        });
        if (m) parts.push({ mesh: m, color, metallic: 0, roughness: 0.7 });
    }
    return { parts, aabbMin: [-len, 0, -len], aabbMax: [len, len * 0.8, len] };
}

function buildSucculentCore(opts, age01, scaleMul) {
    scaleMul = scaleMul ?? 1;
    const seed = (opts.seed | 0) || 1;
    const leafCount = Math.max(3, opts.leafCount ?? 24);
    const leafLength = (opts.leafLength ?? 0.35) * scaleMul;
    const leafWidth = (opts.leafWidth ?? 0.06) * scaleMul;
    const leafThickness = (opts.leafThickness ?? 0.02) * scaleMul;
    const tilt = opts.tilt ?? 0.6;
    const color = F.hexToRgb(opts.color || F.PALETTE.succulent);

    const rng = F.mulberry32(seed);
    const golden = 2.39996323;
    const sub = [];
    for (let i = 0; i < leafCount; i++) {
        const a = i * golden;
        const t = i / leafCount;
        const lt = tilt * (0.4 + 0.7 * t);
        const len = leafLength * (0.7 + 0.4 * t + rng() * 0.1);
        const outDir = F.vNorm([
            Math.cos(a) * Math.cos(lt),
            Math.sin(lt),
            Math.sin(a) * Math.cos(lt),
        ]);
        const path = [];
        const segs = 8;
        for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const p = F.vScale(outDir, u * len);
            p[1] += u * u * len * 0.25;
            path.push(p);
        }
        const profileScale = path.map((_, s) => {
            const u = s / (path.length - 1);
            const bulge = Math.sin(Math.PI * u);
            return Math.max(0.05, 0.4 + 0.6 * bulge - 0.5 * u);
        });
        const leaf = Mesh.bladeStrip(path, {
            width: leafWidth, thickness: leafThickness,
            capStart: true, capEnd: true, miterJoints: true,
            profileScale,
        });
        if (leaf) sub.push(leaf);
    }

    const merged = sub.length > 1 ? Mesh.merge(sub) : sub[0];
    const aabb = F.emptyAabb();
    F.aabbInclude(aabb, [-leafLength, 0, -leafLength]);
    F.aabbInclude(aabb, [leafLength, leafLength * 0.5, leafLength]);

    const fin = F.finalizeAabb(aabb, { min: [-leafLength, 0, -leafLength], max: [leafLength, leafLength * 0.6, leafLength] });
    return {
        parts: [{ mesh: merged, color, metallic: 0, roughness: 0.7 }],
        aabbMin: fin.aabbMin, aabbMax: fin.aabbMax,
    };
}

function buildSucculentSeedling(opts, stageT) { return buildSucculentCore(opts, stageT, 0.20 + 0.20 * stageT); }
function buildSucculentJuvenile(opts, stageT) { return buildSucculentCore(opts, stageT, 0.45 + 0.35 * stageT); }
function buildSucculentMature(opts, stageT) { return buildSucculentCore(opts, stageT, 1); }
function buildSucculentFlowering(opts, stageT) {
    const r = buildSucculentCore(opts, stageT, 1);
    // Tall flower spike from the center.
    const spikeH = (opts.leafLength ?? 0.35) * 1.6;
    const spike = Mesh.tube([[0, 0, 0], [0, spikeH, 0]], [0.015, 0.008], 5);
    if (spike) r.parts.push({ mesh: spike, color: F.hexToRgb(opts.stemColor || '#7a6a3a'),
        metallic: 0, roughness: 0.85, twoSided: false });
    // Flower head at the tip.
    const head = Mesh.flower({
        petalCount: 8, petalShape: 'oval',
        petalLength: 0.06, petalWidth: 0.03, petalCurl: 0.05, petalBend: 0.4,
        layers: 1, layerTwist: 0.3,
        centerRadius: 0.02, centerHeight: 0.012,
        centerColor: [0.9, 0.7, 0.2],
    });
    if (head) {
        F.stripVertexColors(head);
        head.translate(0, spikeH, 0);
        r.parts.push({ mesh: head,
            color: F.hexToRgb(opts.flowerColor || '#fbcd5a'),
            metallic: 0, roughness: 0.7 });
    }
    r.aabbMax[1] = Math.max(r.aabbMax[1], spikeH + 0.06);
    return r;
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering'];

const BUILDERS = {
    seed: buildSucculentSeed, sprout: buildSucculentSprout, seedling: buildSucculentSeedling,
    juvenile: buildSucculentJuvenile, mature: buildSucculentMature, flowering: buildSucculentFlowering,
};

function succulent(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = root.FloraSpecies.applySpecies('succulent', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

root.Recipes = root.Recipes || {};
root.Recipes.succulent = succulent;

})(this);
