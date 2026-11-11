// Sculpted ursine body for `ursa`:
//   - Snout-to-rump length ~1.65 m (z -0.64 to +1.01 m)
//   - Prominent muscular interscapular shoulder hump peaking at y ~0.965 m
//   - Deep furry barrel ribcage, massive rounded hindquarters, thick neck ruff
//   - Wide rounded skull with clear frontal stop into sturdy tapered muzzle,
//     parted hinged jaw (closed cleanly at rest by rig.bk so jaw skins in its
//     own clean loop), rounded cupped ears with `carve: true` inner pinna hollows
//   - Dedicated limb pieces (`legFL`, `legFR`, `legHL`, `legHR`) with 2+ stations
//     per bone, broad cushioned plantigrade soles, and 5 curved dark claws per paw.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { coat } from "./coat.js";

const ring = (z, top, bottom, hw, extra = {}) => ({
    c: [0, 0.5 * (top + bottom), z],
    r: [hw, 0.5 * (top - bottom)],
    ...extra,
});

const legRing = (x, y, zf, zb, hw, extra = {}) => ({
    c: [x, y, 0.5 * (zf + zb)],
    r: [hw, 0.5 * (zf - zb)],
    ...extra,
});

export function body(skel, detail = {}) {
    const baseTris = 26000;
    const scale = detail.triangles ? Math.max(0.03, detail.triangles / baseTris) : 1;
    const limbBudget = Math.max(120, Math.round(3000 * scale));
    const B = new Flesh(skel, {
        color: coat,
        triangles: baseTris,
        pieces: {
            legFL: limbBudget,
            legFR: limbBudget,
            legHL: limbBudget,
            legHR: limbBudget,
        },
        ...detail,
    });

    // --- Heavy barrel trunk & rounded hindquarters, rising into the shoulder hump ---
    B.limb('trunk', ['pelvis', 'lumbar', 'thorax'], [
        ring(-0.575, 0.805, 0.685, 0.065, { bone: 'pelvis' }),
        ring(-0.525, 0.842, 0.545, 0.154, { bone: 'pelvis' }),
        ring(-0.440, 0.858, 0.475, 0.200, { bone: 'pelvis' }),
        ring(-0.320, 0.856, 0.452, 0.212, { bone: 'pelvis' }),
        ring(-0.180, 0.854, 0.436, 0.214, { bone: [['pelvis', 0.45], ['lumbar', 0.55]] }),
        ring(-0.020, 0.864, 0.425, 0.224, { bone: 'lumbar' }),
        ring(0.140, 0.900, 0.422, 0.232, { bone: [['lumbar', 0.35], ['thorax', 0.65]] }),
        ring(0.270, 0.950, 0.432, 0.226, { bone: 'thorax' }),
        ring(0.375, 0.944, 0.462, 0.206, { bone: 'thorax' }),
        ring(0.465, 0.902, 0.515, 0.176, { bone: 'thorax' }),
        ring(0.535, 0.852, 0.588, 0.132, { bone: [['thorax', 0.7], ['neck', 0.3]] }),
    ], { blend: 0.030, soft: 0.90 });

    // Prominent muscular interscapular shoulder hump crowning the anterior thorax.
    B.blob('hump', 'thorax', [0, 0.905, 0.285], [0.145, 0.064, 0.165], {
        dir: [0, 0.08, 1], up: [0, 1, 0], blend: 0.032, soft: 1.0,
    });

    // Trunk-side shoulder and haunch fur fairings so the pillar limbs meet a lush bear contour.
    for (const [s, t] of SIDES) {
        B.blob(`hipFairing${t}`, [['pelvis', 0.7], [`femur${t}`, 0.3]],
            [0.145 * s, 0.680, -0.405], [0.078, 0.145, 0.165],
            { dir: [0, -0.95, 0.25], up: [0, 0, 1], blend: 0.028, soft: 0.90 });
        B.blob(`shoulderFairing${t}`, [['thorax', 0.65], [`scapula${t}`, 0.35]],
            [0.148 * s, 0.745, 0.315], [0.082, 0.158, 0.168],
            { dir: [0.03 * s, -0.92, 0.24], up: [0, 0, 1], blend: 0.032, soft: 0.90 });
    }

    // --- Thick muscular neck & furry cheek/throat ruff ---
    B.limb('neck', ['thorax', 'neck', 'head'], [
        { c: [0, 0.780, 0.435], r: [0.156, 0.165], bone: [['thorax', 0.45], ['neck', 0.55]] },
        { c: [0, 0.798, 0.525], r: [0.144, 0.148], bone: 'neck' },
        { c: [0, 0.810, 0.615], r: [0.130, 0.130], bone: 'neck' },
        { c: [0, 0.812, 0.685], r: [0.114, 0.106], bone: [['neck', 0.45], ['head', 0.55]] },
    ], { up: [0, 1, 0], blend: 0.032, soft: 1.15 });

    B.blob('ruff', [['neck', 0.70], ['head', 0.30]], [0, 0.790, 0.648], [0.132, 0.112, 0.078], {
        blend: 0.024, soft: 1.1,
    });

    // --- Bear head: broad rounded cranium, distinct frontal stop, sturdy muzzle & hinged jaw ---
    head(B);

    // --- Short furry ursine stub tail ---
    B.limb('tail', ['tail'], [
        { c: [0, 0.790, -0.588], r: [0.044, 0.040], bone: [['pelvis', 0.20], ['tail', 0.80]] },
        { c: [0, 0.772, -0.646], r: [0.044, 0.040], bone: 'tail' },
        { c: [0, 0.756, -0.698], r: [0.038, 0.035], bone: 'tail' },
        { c: [0, 0.742, -0.748], r: [0.027, 0.025], bone: 'tail' },
    ], { up: [0, 1, 0], blend: 0.018, soft: 1.05 });

    // --- Four isolated plantigrade limbs in dedicated pieces ---
    limbs(B);
    sections(B);
    return B.build();
}

function head(B) {
    // Broad rounded bear cranium up to the frontal stop (z ~ 0.842); crown roof at y ~ 0.892
    // so the dorsolateral cupped ears emerge cleanly in their own skin loops.
    B.limb('head', ['head'], [
        { c: [0, 0.808, 0.680], r: [0.112, 0.086], bone: 'head' },
        { c: [0, 0.810, 0.736], r: [0.116, 0.085], bone: 'head' },
        { c: [0, 0.812, 0.790], r: [0.104, 0.078], bone: 'head' },
        { c: [0, 0.810, 0.838], r: [0.080, 0.060], bone: 'head' },
    ], { up: [0, 1, 0], blend: 0.020, soft: 1.0 });

    // Stout, blocky ursine upper muzzle ahead of the frontal stop; underside kept >= y = 0.750
    // so the parted rest jaw (top <= 0.724 at t >= 0.5) meshes in its own isolated mandible loop.
    B.limb('muzzle', ['head'], [
        { c: [0, 0.796, 0.838], r: [0.068, 0.046], bone: 'head' },
        { c: [0, 0.792, 0.884], r: [0.061, 0.042], bone: 'head' },
        { c: [0, 0.788, 0.928], r: [0.055, 0.038], bone: 'head' },
        { c: [0, 0.784, 0.966], r: [0.048, 0.034], bone: 'head' },
    ], { up: [0, 1, 0], blend: 0.013, soft: 1.0 });

    // Broad leathery nose pad on the tip of the snout (`keep: true` for sharp geometry).
    B.blob('nose', 'head', [0, 0.788, 0.978], [0.036, 0.027, 0.019], {
        blend: 0.005, soft: 1.0, keep: true,
    });

    // Hinged lower jaw (`jaw`), cleanly separated below the upper palate at rest and closed in rig.bk.
    B.limb('jaw', ['jaw'], [
        { c: [0, 0.738, 0.790], r: [0.056, 0.024], bone: 'jaw' },
        { c: [0, 0.706, 0.844], r: [0.050, 0.022], bone: 'jaw' },
        { c: [0, 0.680, 0.898], r: [0.044, 0.020], bone: 'jaw' },
        { c: [0, 0.660, 0.946], r: [0.037, 0.018], bone: 'jaw' },
    ], { up: [0, 1, 0], blend: 0.008, soft: 1.0 });

    for (const [s, t] of SIDES) {
        // Subtle furred superciliary brow ridge above each eye.
        B.blob(`brow${t}`, 'head', [0.068 * s, 0.858, 0.810], [0.025, 0.014, 0.029], {
            blend: 0.010, soft: 1.0,
        });
        // Forward-set bear eyes (`keep: true` so face.bk draws crisp amber irises and lids).
        B.blob(`eye${t}`, 'head', [0.072 * s, 0.835, 0.816], [0.0155, 0.0145, 0.0175], {
            blend: 0.003, soft: 1.0, keep: true,
        });

        // Rounded, high-set cupped ursine ears emerging cleanly above the cranium.
        B.limb(`ear${t}`, [`ear${t}`], [
            { c: [0.088 * s, 0.872, 0.730], r: [0.025, 0.016], bone: `ear${t}` },
            { c: [0.114 * s, 0.908, 0.725], r: [0.042, 0.018], bone: `ear${t}` },
            { c: [0.138 * s, 0.940, 0.721], r: [0.039, 0.016], bone: `ear${t}` },
            { c: [0.152 * s, 0.958, 0.718], r: [0.025, 0.013], bone: `ear${t}` },
        ], { up: [0, 0, 1], blend: 0.008, soft: 1.0 });

        // Carved inner pinna cup (`carve: true`) on the anterior face of each rounded ear,
        // leaving a thick furry back wall so it never perforates.
        B.limb(`earHollow${t}`, [`ear${t}`], [
            { c: [0.116 * s, 0.910, 0.737], r: [0.022, 0.0085], bone: `ear${t}` },
            { c: [0.136 * s, 0.938, 0.732], r: [0.021, 0.0080], bone: `ear${t}` },
            { c: [0.146 * s, 0.950, 0.729], r: [0.012, 0.0055], bone: `ear${t}` },
        ], { up: [0, 0, 1], carve: true, blend: 0.006, keep: 0.006 });
    }
}

function limbs(B) {
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;
        const fPiece = `legF${t}`;
        const hPiece = `legH${t}`;

        // --- Forelimb: heavy pillar-like shoulder, flexed humerus/elbow, forearm, low wrist, broad paw ---
        B.limb(`foreUpper${t}`, [`scapula${t}`, `humerus${t}`, `forearm${t}`, `wrist${t}`], [
            // 2+ stations on scapula (tucked cleanly inside shoulder fairing so no dorsal knob pokes out)
            legRing(x(0.126), 0.815, 0.355, 0.215, 0.054, { bone: `scapula${t}` }),
            legRing(x(0.158), 0.718, 0.445, 0.245, 0.076, { bone: `scapula${t}` }),
            // 2+ stations on humerus
            legRing(x(0.178), 0.615, 0.495, 0.255, 0.088, { bone: `humerus${t}` }),
            legRing(x(0.180), 0.495, 0.435, 0.195, 0.082, { bone: `humerus${t}` }),
            legRing(x(0.180), 0.385, 0.365, 0.165, 0.076, { bone: [['humerus' + t, 0.55], ['forearm' + t, 0.45]] }),
            // 2+ stations on forearm
            legRing(x(0.180), 0.295, 0.390, 0.210, 0.072, { bone: `forearm${t}` }),
            legRing(x(0.180), 0.215, 0.410, 0.255, 0.066, { bone: `forearm${t}` }),
            // 2+ stations on wrist
            legRing(x(0.180), 0.145, 0.420, 0.290, 0.062, { bone: `wrist${t}` }),
            legRing(x(0.180), 0.088, 0.425, 0.305, 0.064, { bone: `wrist${t}` }),
        ], { up: [0, 0, 1], blend: 0.022, piece: fPiece });

        // Broad plantigrade forepaw: 2+ stations on `hand` and `fToe`
        B.limb(`forePaw${t}`, [`wrist${t}`, `hand${t}`, `fToe${t}`], [
            { c: [x(0.180), 0.058, 0.360], r: [0.064, 0.044], bone: [['wrist' + t, 0.4], ['hand' + t, 0.6]] },
            { c: [x(0.180), 0.042, 0.402], r: [0.070, 0.035], bone: `hand${t}` },
            { c: [x(0.180), 0.032, 0.444], r: [0.074, 0.029], bone: [['hand' + t, 0.45], ['fToe' + t, 0.55]] },
            { c: [x(0.180), 0.026, 0.478], r: [0.072, 0.025], bone: `fToe${t}` },
            { c: [x(0.180), 0.020, 0.508], r: [0.064, 0.020], bone: `fToe${t}` },
        ], { up: [0, 1, 0], blend: 0.016, steps: 3, piece: fPiece });

        // 5 distinct curved long ursine foreclaws (`fToe`)
        claws(B, `fClaw`, t, s, `fToe${t}`, 0.180, 0.502, 0.056, 0.046, fPiece);

        // --- Hindlimb: massive femur thigh, flexed stifle, thick gaskin/tibia, low ankle, flat sole ---
        B.limb(`hindUpper${t}`, [`femur${t}`, `tibia${t}`, `ankle${t}`], [
            // 2+ stations on femur
            legRing(x(0.168), 0.700, -0.275, -0.525, 0.082, { bone: `femur${t}` }),
            legRing(x(0.178), 0.560, -0.185, -0.485, 0.090, { bone: `femur${t}` }),
            legRing(x(0.180), 0.420, -0.145, -0.435, 0.082, { bone: [['femur' + t, 0.55], ['tibia' + t, 0.45]] }),
            // 2+ stations on tibia
            legRing(x(0.180), 0.320, -0.235, -0.475, 0.074, { bone: `tibia${t}` }),
            legRing(x(0.180), 0.225, -0.325, -0.508, 0.066, { bone: `tibia${t}` }),
            // 2+ stations on ankle
            legRing(x(0.180), 0.150, -0.378, -0.525, 0.060, { bone: `ankle${t}` }),
            legRing(x(0.180), 0.088, -0.392, -0.528, 0.060, { bone: `ankle${t}` }),
        ], { up: [0, 0, 1], blend: 0.022, piece: hPiece });

        // Long flat plantigrade hind sole (`foot` + `hToe`)
        B.limb(`hindPaw${t}`, [`ankle${t}`, `foot${t}`, `hToe${t}`], [
            { c: [x(0.180), 0.056, -0.470], r: [0.058, 0.042], bone: [['ankle' + t, 0.4], ['foot' + t, 0.6]] },
            { c: [x(0.180), 0.040, -0.418], r: [0.062, 0.033], bone: `foot${t}` },
            { c: [x(0.180), 0.032, -0.365], r: [0.066, 0.028], bone: [['foot' + t, 0.45], ['hToe' + t, 0.55]] },
            { c: [x(0.180), 0.025, -0.328], r: [0.064, 0.024], bone: `hToe${t}` },
            { c: [x(0.180), 0.020, -0.298], r: [0.058, 0.019], bone: `hToe${t}` },
        ], { up: [0, 1, 0], blend: 0.016, steps: 3, piece: hPiece });

        // 5 distinct curved dark hindclaws (`hToe`)
        claws(B, `hClaw`, t, s, `hToe${t}`, 0.180, -0.302, 0.050, 0.038, hPiece);
    }
}

function claws(B, prefix, tag, side, bone, cx, zBase, halfSpan, clawLen, piece) {
    for (let i = 0; i < 5; i++) {
        const u = (i - 2) / 2; // -1 .. +1 across the 5 digits
        const dx = u * halfSpan;
        const arcZ = zBase + 0.008 * (1 - u * u);
        const x = (cx + dx) * side;
        const flare = 0.006 * u * side;
        B.limb(`${prefix}${i}${tag}`, [bone], [
            { c: [x, 0.022, arcZ], r: [0.0075, 0.0095], bone },
            { c: [x + 0.5 * flare, 0.018, arcZ + 0.52 * clawLen], r: [0.0058, 0.0075], bone },
            { c: [x + flare, 0.008, arcZ + clawLen], r: [0.0036, 0.0045], bone },
        ], { up: [0, 1, 0], blend: 0.003, steps: 2, keep: 0.004, piece });
    }
}

function sections(B) {
    const across = (name, bone, at) => B.section(name, { at, normal: [0, 0, 1], bone, radius: 0.42 });
    across('rump', 'pelvis', [0, 0.72, -0.50]);
    across('hip', 'pelvis', [0, 0.70, -0.40]);
    across('waist', 'lumbar', [0, 0.68, -0.10]);
    across('girth', 'thorax', [0, 0.70, 0.16]);
    across('shoulder', 'thorax', [0, 0.74, 0.30]);
    across('neck', 'neck', [0, 0.80, 0.58]);
    across('head', 'head', [0, 0.80, 0.76]);
    const flat = (name, bone, at) => B.section(name, { at, normal: [0, 1, 0], bone, radius: 0.22 });
    flat('arm', 'humerusL', [0.18, 0.50, 0.33]);
    flat('forearm', 'forearmL', [0.18, 0.27, 0.30]);
    flat('thigh', 'femurL', [0.18, 0.56, -0.32]);
}
