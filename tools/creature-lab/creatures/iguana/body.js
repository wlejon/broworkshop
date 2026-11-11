// Green spiny iguana (Iguana iguana) sculpted body: ~0.27 m dorsal crest height,
// ~1.35 m snout-to-tail-tip length.
//
// Meshed via Flesh (lab/flesh.js) with 26,000 triangles on the axial body +
// dorsal crest + diapsid head/jaw, dedicated pieces for the four sprawling
// plantigrade 5-toed limbs (`legFL`, `legFR`, `legHL`, `legHR`), and a dedicated
// piece for the thin pleated gular `dewlap` fan under the throat.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { coat } from "./coat.js";

const ring = (z, top, bottom, hw, bone) => ({
    c: [0, 0.5 * (top + bottom), z],
    r: [hw, 0.5 * (top - bottom)],
    ...(bone ? { bone } : {}),
});

export function body(skel, detail = {}) {
    const baseTris = 26000;
    const lodScale = Math.min(1, (detail.triangles ?? baseTris) / baseTris);
    const pieceTris = (n) => Math.max(80, Math.round(n * lodScale));

    const B = new Flesh(skel, {
        cell: 0.003,
        triangles: baseTris,
        pieces: {
            legFL: pieceTris(2600),
            legFR: pieceTris(2600),
            legHL: pieceTris(2800),
            legHR: pieceTris(2800),
            dewlap: pieceTris(700),
        },
        color: coat,
        ...detail,
    });

    buildTrunkAndTail(B);
    buildHeadAndJaw(B);
    buildDorsalCrest(B);
    buildDewlap(B);
    buildSprawlingLimbs(B);
    buildSections(B);

    return B.build();
}

function buildTrunkAndTail(B) {
    // Muscular reptilian trunk: pelvic base, full herbivorous belly, pectoral
    // ribcage, trim muscular neck (narrower than both chest and puffed jowls).
    B.limb('trunk', ['pelvis', 'lumbar', 'thorax', 'neck', 'head'], [
        ring(-0.105, 0.210, 0.144, 0.036, [['tail1', 0.45], ['pelvis', 0.55]]),
        ring(-0.075, 0.222, 0.132, 0.046, 'pelvis'),
        ring(-0.020, 0.230, 0.120, 0.056, 'pelvis'),
        ring(0.045, 0.235, 0.112, 0.063, 'lumbar'),
        ring(0.115, 0.237, 0.110, 0.065, 'lumbar'),
        ring(0.185, 0.236, 0.116, 0.061, 'thorax'),
        ring(0.248, 0.232, 0.128, 0.056, 'thorax'),
        ring(0.288, 0.224, 0.150, 0.041, [['thorax', 0.55], ['neck', 0.45]]),
        ring(0.318, 0.228, 0.174, 0.028, 'neck'),
        ring(0.340, 0.240, 0.184, 0.029, 'neck'),
        ring(0.355, 0.252, 0.194, 0.035, [['neck', 0.35], ['head', 0.65]]),
    ], { blend: 0.014 });

    // Long laterally-compressed 4-bone whip tail tapering cleanly to z = -0.915 m.
    B.limb('tail', ['tail1', 'tail2', 'tail3', 'tail4'], [
        { c: [0, 0.178, -0.088], r: [0.035, 0.041], bone: [['pelvis', 0.40], ['tail1', 0.60]] },
        { c: [0, 0.164, -0.180], r: [0.029, 0.035], bone: 'tail1' },
        { c: [0, 0.148, -0.285], r: [0.023, 0.028], bone: [['tail1', 0.50], ['tail2', 0.50]] },
        { c: [0, 0.132, -0.390], r: [0.0185, 0.022], bone: 'tail2' },
        { c: [0, 0.116, -0.495], r: [0.0145, 0.017], bone: [['tail2', 0.50], ['tail3', 0.50]] },
        { c: [0, 0.101, -0.605], r: [0.0115, 0.0135], bone: 'tail3' },
        { c: [0, 0.088, -0.710], r: [0.0090, 0.0105], bone: [['tail3', 0.50], ['tail4', 0.50]] },
        { c: [0, 0.078, -0.815], r: [0.0068, 0.0076], bone: 'tail4' },
        { c: [0, 0.068, -0.915], r: [0.0046, 0.0050], bone: 'tail4' },
    ], { blend: 0.008 });
}

function buildHeadAndJaw(B) {
    // Angular diapsid cranium and bluntly arched iguana snout.
    B.limb('skull', ['head'], [
        { c: [0, 0.243, 0.348], r: [0.036, 0.025], bone: 'head' },
        { c: [0, 0.245, 0.366], r: [0.040, 0.027], bone: 'head' },
        { c: [0, 0.244, 0.386], r: [0.034, 0.024], bone: 'head' },
        { c: [0, 0.240, 0.406], r: [0.026, 0.020], bone: 'head' },
        { c: [0, 0.234, 0.423], r: [0.019, 0.016], bone: 'head' },
        { c: [0, 0.227, 0.436], r: [0.013, 0.012], bone: 'head' },
    ], { blend: 0.009, keep: 0.004 });

    // Parietal casque crest on top of the posterior skull.
    B.blob('casque', 'head', [0, 0.258, 0.358], [0.014, 0.009, 0.019], {
        dir: [0, 0.22, 0.97], blend: 0.005, keep: 0.003,
    });

    // Hinged lower mandible along the jaw bone ([0, 0.215, 0.360] -> [0, 0.210, 0.428]).
    B.limb('mandible', ['jaw'], [
        { c: [0, 0.215, 0.356], r: [0.033, 0.013], bone: [['head', 0.35], ['jaw', 0.65]] },
        { c: [0, 0.213, 0.376], r: [0.030, 0.013], bone: 'jaw' },
        { c: [0, 0.211, 0.398], r: [0.023, 0.011], bone: 'jaw' },
        { c: [0, 0.211, 0.418], r: [0.017, 0.0095], bone: 'jaw' },
        { c: [0, 0.213, 0.431], r: [0.012, 0.0080], bone: 'jaw' },
    ], { blend: 0.006, keep: 0.003 });

    for (const [s, t] of SIDES) {
        // Puffed iguana cheek jowl & large subtympanic shield scale boss.
        B.blob(`jowl${t}`, [['head', 0.78], ['jaw', 0.22]],
            [0.034 * s, 0.217, 0.363], [0.013, 0.015, 0.018],
            { blend: 0.006, keep: true });

        // Prominent lateral diapsid eyeball and fierce supraorbital brow ridge.
        B.blob(`eye${t}`, 'head', [0.031 * s, 0.244, 0.384], [0.0085, 0.0092, 0.0112],
            { blend: 0.0028, keep: true });
        B.blob(`brow${t}`, 'head', [0.028 * s, 0.255, 0.385], [0.0072, 0.0045, 0.0155],
            { dir: [0.10 * s, -0.08, 0.99], blend: 0.003, keep: 0.003 });

        // Raised fleshy nasal boss near the snout tip.
        B.blob(`nostril${t}`, 'head', [0.0125 * s, 0.234, 0.423], [0.0048, 0.0048, 0.0065],
            { blend: 0.0025, keep: true });
    }
}

// Dorsal surface height & underlying spine/tail bone along z for the crest spine row.
function dorsalAnchor(z) {
    if (z >= 0.342) return { y: 0.249, bone: 'head' };
    if (z >= 0.292) return { y: 0.224 + 0.42 * (z - 0.292), bone: 'neck' };
    if (z >= 0.165) return { y: 0.232 + 0.004 * Math.sin(((z - 0.165) / 0.127) * Math.PI), bone: 'thorax' };
    if (z >= 0.040) return { y: 0.234 + 0.003 * Math.sin(((z - 0.040) / 0.125) * Math.PI), bone: 'lumbar' };
    if (z >= -0.090) return { y: 0.216 + 0.14 * (z + 0.090), bone: 'pelvis' };
    if (z >= -0.285) {
        const u = (-0.090 - z) / 0.195;
        return { y: 0.204 - 0.032 * u, bone: 'tail1' };
    }
    const u = Math.min(1, (-0.285 - z) / 0.210);
    return { y: 0.172 - 0.038 * u, bone: 'tail2' };
}

function buildDorsalCrest(B) {
    // 25 distinct swept-back falcate crest blades from nape along dorsum to proximal tail:
    // tall dramatic nuchal crest, brief cervical dip over shoulder inlet, sweeping dorsal
    // crest over thorax/lumbar, and sawtooth caudal crest tapering onto tail2.
    const stations = [
        [0.348, 0.026], [0.335, 0.036], [0.321, 0.038], [0.307, 0.033], [0.293, 0.022],
        [0.274, 0.026], [0.248, 0.033], [0.220, 0.036], [0.190, 0.038], [0.158, 0.038],
        [0.126, 0.037], [0.094, 0.036], [0.062, 0.035], [0.030, 0.033], [-0.002, 0.031],
        [-0.034, 0.029], [-0.066, 0.027], [-0.102, 0.024], [-0.142, 0.022], [-0.184, 0.020],
        [-0.228, 0.018], [-0.274, 0.016], [-0.322, 0.014], [-0.372, 0.012], [-0.422, 0.010],
    ];
    stations.forEach(([z, h], i) => {
        const { y, bone } = dorsalAnchor(z);
        const sweep = 0.48 * h;
        B.limb(`crest${i}`, [bone], [
            { c: [0, y - 0.006, z + 0.003], r: [0.0044, 0.0082], bone },
            { c: [0, y + 0.52 * h, z - 0.42 * sweep], r: [0.0035, 0.0060], bone },
            { c: [0, y + h, z - sweep], r: [0.0022, 0.0032], bone },
        ], { up: [0, 0, 1], blend: 0.0024, joint: 0.002, keep: 0.002 });
    });
}

function buildDewlap(B) {
    // Thin laterally-compressed pendulous gular dewlap fan (`piece: 'dewlap'`)
    // hanging cleanly below the mandible ([0, 0.190, 0.348] down to [0, 0.118, 0.372]),
    // with anterior denticle spikes along its leading margin.
    const opts = { piece: 'dewlap', up: [0, 0, 1], blend: 0.0045, joint: 0.004 };
    const topW = [['dewlap', 0.82], ['neck', 0.18]];

    // Central core of the dewlap surrounding the `dewlap` bone segment cleanly below `jaw`.
    B.limb('dewlapFan', ['dewlap'], [
        { c: [0, 0.188, 0.348], r: [0.0058, 0.013], bone: topW },
        { c: [0, 0.163, 0.356], r: [0.0056, 0.020], bone: 'dewlap' },
        { c: [0, 0.138, 0.365], r: [0.0052, 0.018], bone: 'dewlap' },
        { c: [0, 0.118, 0.372], r: [0.0046, 0.012], bone: 'dewlap' },
    ], opts);

    // Sweeping crescentic leading/trailing gular web from sub-chin to ventral lobe to throat.
    B.limb('dewlapRim', ['dewlap'], [
        { c: [0, 0.191, 0.404], r: [0.0048, 0.008], bone: topW },
        { c: [0, 0.168, 0.395], r: [0.0050, 0.014], bone: 'dewlap' },
        { c: [0, 0.138, 0.383], r: [0.0048, 0.014], bone: 'dewlap' },
        { c: [0, 0.118, 0.370], r: [0.0046, 0.012], bone: 'dewlap' },
        { c: [0, 0.146, 0.342], r: [0.0050, 0.014], bone: 'dewlap' },
        { c: [0, 0.180, 0.326], r: [0.0054, 0.011], bone: topW },
    ], opts);

    // Characteristic green-iguana anterior gular fringe spikes along the dewlap edge.
    const spikes = [
        [0.183, 0.402, 0.010], [0.168, 0.398, 0.012], [0.153, 0.392, 0.013],
        [0.138, 0.385, 0.012], [0.125, 0.377, 0.010],
    ];
    spikes.forEach(([y, z, len], i) => {
        B.limb(`dewSpike${i}`, ['dewlap'], [
            { c: [0, y + 0.002, z - 0.004], r: [0.0035, 0.0042], bone: 'dewlap' },
            { c: [0, y - 0.45 * len, z + 0.88 * len], r: [0.0021, 0.0024], bone: 'dewlap' },
        ], { piece: 'dewlap', up: [0, 1, 0], blend: 0.002, joint: 0.002 });
    });
}

function buildSprawlingLimbs(B) {
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;
        const pFore = `legF${t}`;
        const pHind = `legH${t}`;

        // --- Forelimb piece: shoulder fairing -> humerus -> forearm -> wrist/hand/fToe ---
        B.blob(`deltoid${t}`, `scapula${t}`, [x(0.052), 0.180, 0.258], [0.024, 0.028, 0.032],
            { piece: pFore, blend: 0.012 });

        B.limb(`foreArm${t}`, [`scapula${t}`, `humerus${t}`, `forearm${t}`, `wrist${t}`, `hand${t}`, `fToe${t}`], [
            { c: [x(0.044), 0.194, 0.255], r: [0.022, 0.026], bone: `scapula${t}` },
            { c: [x(0.054), 0.174, 0.260], r: [0.023, 0.026], bone: `scapula${t}` },
            { c: [x(0.064), 0.156, 0.266], r: [0.023, 0.025], bone: [[`scapula${t}`, 0.45], [`humerus${t}`, 0.55]] },
            { c: [x(0.115), 0.144, 0.252], r: [0.022, 0.024], bone: `humerus${t}` },
            { c: [x(0.166), 0.132, 0.238], r: [0.018, 0.020], bone: [[`humerus${t}`, 0.5], [`forearm${t}`, 0.5]] },
            { c: [x(0.161), 0.082, 0.260], r: [0.017, 0.019], bone: `forearm${t}` },
            { c: [x(0.156), 0.024, 0.286], r: [0.014, 0.013], bone: [[`forearm${t}`, 0.45], [`wrist${t}`, 0.55]] },
            { c: [x(0.157), 0.017, 0.298], r: [0.017, 0.010], bone: `wrist${t}` },
            { c: [x(0.158), 0.011, 0.308], r: [0.020, 0.0085], bone: [[`wrist${t}`, 0.4], [`hand${t}`, 0.6]] },
            { c: [x(0.159), 0.008, 0.321], r: [0.021, 0.0075], bone: `hand${t}` },
            { c: [x(0.160), 0.006, 0.334], r: [0.016, 0.0068], bone: [[`hand${t}`, 0.4], [`fToe${t}`, 0.6]] },
            { c: [x(0.161), 0.0055, 0.350], r: [0.0085, 0.0058], bone: `fToe${t}` },
            { c: [x(0.162), 0.0050, 0.366], r: [0.0060, 0.0052], bone: `fToe${t}` },
        ], { piece: pFore, blend: 0.008 });

        // 5 splayed reptilian fingers + curved claws on the manus.
        const fDigits = [
            { ang: -0.72, len: 0.026, ox: -0.011 },
            { ang: -0.34, len: 0.034, ox: -0.005 },
            { ang: 0.03, len: 0.040, ox: 0.000 },
            { ang: 0.36, len: 0.038, ox: 0.005 },
            { ang: 0.74, len: 0.027, ox: 0.010 },
        ];
        fDigits.forEach((dg, d) => {
            const a = dg.ang * s;
            const sx = Math.sin(a), cz = Math.cos(a);
            const bx = x(0.159) + dg.ox * s, bz = 0.322;
            const mx = bx + sx * dg.len * 0.55, mz = bz + cz * dg.len * 0.55;
            const tx = bx + sx * dg.len, tz = bz + cz * dg.len;
            const wBone = d === 0 || d === 4 ? [[`hand${t}`, 0.55], [`fToe${t}`, 0.45]] : `fToe${t}`;
            B.limb(`fDigit${t}${d}`, [`hand${t}`, `fToe${t}`], [
                { c: [bx, 0.0075, bz], r: [0.0055, 0.0052], bone: `hand${t}` },
                { c: [mx, 0.0060, mz], r: [0.0046, 0.0046], bone: wBone },
                { c: [tx, 0.0048, tz], r: [0.0038, 0.0040], bone: wBone },
            ], { piece: pFore, blend: 0.003, joint: 0.003 });
            B.limb(`fClaw${t}${d}`, [`fToe${t}`], [
                { c: [tx, 0.0052, tz], r: [0.0030, 0.0035], bone: wBone },
                { c: [tx + sx * 0.009, 0.0024, tz + cz * 0.009], r: [0.0018, 0.0022], bone: wBone },
            ], { piece: pFore, blend: 0.002, joint: 0.002, keep: 0.002 });
        });

        // --- Hindlimb piece: pelvic/caudofemoral fairing -> femur -> tibia -> ankle/foot/hToe ---
        B.blob(`glute${t}`, `femur${t}`, [x(0.056), 0.168, -0.066], [0.028, 0.033, 0.038],
            { piece: pHind, blend: 0.013 });

        B.limb(`hindLeg${t}`, [`femur${t}`, `tibia${t}`, `ankle${t}`, `foot${t}`, `hToe${t}`], [
            { c: [x(0.044), 0.174, -0.068], r: [0.028, 0.034], bone: `femur${t}` },
            { c: [x(0.074), 0.167, -0.061], r: [0.030, 0.035], bone: `femur${t}` },
            { c: [x(0.126), 0.158, -0.049], r: [0.027, 0.031], bone: `femur${t}` },
            { c: [x(0.178), 0.148, -0.036], r: [0.021, 0.023], bone: [[`femur${t}`, 0.5], [`tibia${t}`, 0.5]] },
            { c: [x(0.171), 0.090, -0.073], r: [0.021, 0.023], bone: `tibia${t}` },
            { c: [x(0.164), 0.026, -0.114], r: [0.016, 0.015], bone: [[`tibia${t}`, 0.45], [`ankle${t}`, 0.55]] },
            { c: [x(0.166), 0.019, -0.100], r: [0.018, 0.011], bone: `ankle${t}` },
            { c: [x(0.168), 0.012, -0.086], r: [0.021, 0.009], bone: [[`ankle${t}`, 0.4], [`foot${t}`, 0.6]] },
            { c: [x(0.170), 0.009, -0.069], r: [0.022, 0.008], bone: `foot${t}` },
            { c: [x(0.172), 0.0065, -0.052], r: [0.018, 0.007], bone: [[`foot${t}`, 0.4], [`hToe${t}`, 0.6]] },
            { c: [x(0.174), 0.0058, -0.032], r: [0.0090, 0.0060], bone: `hToe${t}` },
            { c: [x(0.176), 0.0052, -0.012], r: [0.0062, 0.0054], bone: `hToe${t}` },
        ], { piece: pHind, blend: 0.008 });

        // 5 splayed reptilian pedal digits (with signature elongated 4th hind toe) + claws.
        const hDigits = [
            { ang: -0.78, len: 0.028, ox: -0.012 },
            { ang: -0.38, len: 0.038, ox: -0.006 },
            { ang: -0.04, len: 0.048, ox: 0.000 },
            { ang: 0.26, len: 0.058, ox: 0.006 },
            { ang: 0.72, len: 0.033, ox: 0.012 },
        ];
        hDigits.forEach((dg, d) => {
            const a = dg.ang * s;
            const sx = Math.sin(a), cz = Math.cos(a);
            const bx = x(0.171) + dg.ox * s, bz = -0.064;
            const mx = bx + sx * dg.len * 0.55, mz = bz + cz * dg.len * 0.55;
            const tx = bx + sx * dg.len, tz = bz + cz * dg.len;
            const wBone = d === 0 || d === 4 ? [[`foot${t}`, 0.55], [`hToe${t}`, 0.45]] : `hToe${t}`;
            B.limb(`hDigit${t}${d}`, [`foot${t}`, `hToe${t}`], [
                { c: [bx, 0.0080, bz], r: [0.0058, 0.0055], bone: `foot${t}` },
                { c: [mx, 0.0062, mz], r: [0.0048, 0.0048], bone: wBone },
                { c: [tx, 0.0048, tz], r: [0.0038, 0.0040], bone: wBone },
            ], { piece: pHind, blend: 0.003, joint: 0.003 });
            B.limb(`hClaw${t}${d}`, [`hToe${t}`], [
                { c: [tx, 0.0052, tz], r: [0.0032, 0.0036], bone: wBone },
                { c: [tx + sx * 0.010, 0.0024, tz + cz * 0.010], r: [0.0019, 0.0022], bone: wBone },
            ], { piece: pHind, blend: 0.002, joint: 0.002, keep: 0.002 });
        });
    }
}

function buildSections(B) {
    const across = (name, bone, at, radius = 0.16) => B.section(name, { at, normal: [0, 0, 1], bone, radius });
    across('tailbase', 'tail1', [0, 0.164, -0.180], 0.10);
    across('pelvis', 'pelvis', [0, 0.175, -0.045], 0.14);
    across('belly', 'lumbar', [0, 0.174, 0.115], 0.16);
    across('chest', 'thorax', [0, 0.180, 0.248], 0.15);
    across('neckmid', 'neck', [0, 0.206, 0.325], 0.10);
    across('jowls', 'head', [0, 0.230, 0.365], 0.10);
    across('eyes', 'head', [0, 0.242, 0.385], 0.09);
    B.section('thigh', { at: [0.112, 0.160, -0.054], normal: [1, -0.18, 0.22], bone: 'femurL', radius: 0.09 });
    B.section('shin', { at: [0.170, 0.092, -0.074], normal: [0, 1, 0.55], bone: 'tibiaL', radius: 0.08 });
    B.section('arm', { at: [0.114, 0.143, 0.255], normal: [1, -0.22, -0.25], bone: 'humerusL', radius: 0.08 });
    B.section('forearm', { at: [0.160, 0.084, 0.262], normal: [0, 1, -0.38], bone: 'forearmL', radius: 0.07 });
}
