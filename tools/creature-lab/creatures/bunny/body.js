// The bunny's body: masses on its bones blended into one furred skin
// (lab/flesh.js), sized as a wild rabbit of 1.6 kg sitting (skeleton.js):
//   trunk        0.37 m from the scut's root to the chest, the back arched to
//                0.19 m over the loins, the belly 2.5 cm off the ground
//   haunches     the widest of it, 0.14 m across: the thighs and shanks
//                folded under the rump, the heels at its back
//   hind feet    9.5 cm long and 2.5 cm wide, flat on the ground
//   fore legs    short and slender, under the chest
//   head         8.5 cm from the back of the skull to the nose, round, the
//                eyes large and high on its sides, the cheeks full under
//                them, the muzzle a blunt pad split by the upper lip
//   ears         10.5 cm, standing in a V from bases 4 cm apart, 3.3 cm
//                across, a shell hollowed on its face (ear.js)
//   scut         a ball of fur 4.5 cm across, carried up against the rump
// The mesh is fine (a 2 mm grid) for an ear's thickness to be a shape.

import { Flesh, SIDES } from "/app/lab/flesh.js";
import { coat } from "./coat.js";
import { earAxis, EAR_KEYS, HOLLOW_KEYS } from "./ear.js";

// A trunk ring by its z, the back's and the belly's heights and half width.
const ring = (z, top, bottom, hw) => ({ c: [0, (top + bottom) / 2, z], r: [hw, (top - bottom) / 2] });

// `detail` overrides the meshing (Flesh's cell, triangles, simplifyError, keep)
// for a coarser level of detail of the same body.
export function body(skel, detail = {}) {
    const B = new Flesh(skel, { color: coat, triangles: 12000, cell: 0.002, ...detail });
    B.limb('trunk', ['pelvis', 'lumbar', 'thorax'], [
        ring(-0.182, 0.156, 0.072, 0.042),
        ring(-0.160, 0.181, 0.046, 0.060),
        ring(-0.125, 0.198, 0.031, 0.068),
        ring(-0.080, 0.204, 0.026, 0.068),
        ring(-0.030, 0.199, 0.026, 0.063),
        ring(0.020, 0.189, 0.030, 0.057),
        ring(0.065, 0.178, 0.040, 0.051),
        ring(0.100, 0.166, 0.056, 0.044),
        ring(0.122, 0.152, 0.078, 0.034),
    ], { blend: 0.012 });
    // The neck: short and thick, the dewlap under it.
    B.limb('neck', ['neck', 'head'], [
        { c: [0, 0.122, 0.100], r: [0.040, 0.044], bone: [['thorax', 0.5], ['neck', 0.5]] },
        { c: [0, 0.140, 0.130], r: [0.034, 0.036], bone: 'neck' },
        { c: [0, 0.152, 0.150], r: [0.029, 0.031] },
    ], { up: [0, 0, 1], blend: 0.012 });
    head(B);
    // The scut, carried up against the rump and standing out of it (its
    // white underside shows as it flicks up).
    B.blob('tail', 'tail', [0, 0.140, -0.212], [0.021, 0.022, 0.019], { blend: 0.004 });
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;
        // The haunch: thigh and shank folded under the rump, from the hip
        // down round the knee to the heel.
        B.limb(`haunch${t}`, [`femur${t}`, `tibia${t}`], [
            { c: [x(0.046), 0.112, -0.088], r: [0.030, 0.042], bone: `femur${t}` },
            { c: [x(0.052), 0.076, -0.044], r: [0.030, 0.040] },
            { c: [x(0.050), 0.048, -0.072], r: [0.024, 0.030], bone: `tibia${t}` },
            { c: [x(0.043), 0.022, -0.110], r: [0.013, 0.015], bone: `tibia${t}` },
        ], { up: [0, 0, 1], blend: 0.012 });
        // The hind foot, flat from the heel to the toes, its sole on the ground.
        B.limb(`foot${t}`, [`mt${t}`, `toe${t}`], [
            { c: [x(0.040), 0.0125, -0.121], r: [0.0105, 0.012], bone: `mt${t}` },
            { c: [x(0.040), 0.0110, -0.095], r: [0.0120, 0.0105] },
            { c: [x(0.040), 0.0095, -0.062], r: [0.0130, 0.0092] },
            { c: [x(0.040), 0.0083, -0.036], r: [0.0122, 0.0080], bone: `toe${t}` },
            { c: [x(0.040), 0.0068, -0.020], r: [0.0085, 0.0062], bone: `toe${t}` },
        ], { blend: 0.005 });
        // The fore leg from the shoulder to the paw.
        B.limb(`fore${t}`, [`humerus${t}`, `radius${t}`, `mc${t}`, `paw${t}`], [
            { c: [x(0.030), 0.104, 0.100], r: [0.019, 0.023], bone: `humerus${t}` },
            { c: [x(0.033), 0.078, 0.090], r: [0.0145, 0.0165] },
            { c: [x(0.033), 0.054, 0.083], r: [0.0105, 0.0110], bone: `radius${t}` },
            { c: [x(0.033), 0.030, 0.095], r: [0.0085, 0.0088] },
            { c: [x(0.033), 0.013, 0.106], r: [0.0085, 0.0090], bone: `mc${t}` },
            { c: [x(0.033), 0.0080, 0.121], r: [0.0098, 0.0080], bone: `paw${t}` },
            { c: [x(0.033), 0.0062, 0.134], r: [0.0072, 0.0062], bone: `paw${t}` },
        ], { up: [0, 0, 1], blend: 0.006 });
    }
    sections(B);
    return B.build();
}

// The head: round over the skull, full in the cheeks, blunt at the muzzle;
// the eyes stand out of its sides, the ears from its crown.
function head(B) {
    B.limb('head', ['head'], [
        { c: [0, 0.167, 0.141], r: [0.031, 0.033] },
        { c: [0, 0.165, 0.160], r: [0.0355, 0.038] },
        { c: [0, 0.157, 0.180], r: [0.0335, 0.0345] },
        { c: [0, 0.146, 0.198], r: [0.027, 0.028] },
    ], { blend: 0.008 });
    // The muzzle and its whisker pads, on the nose (they twitch with it).
    B.limb('muzzle', ['nose'], [
        { c: [0, 0.140, 0.206], r: [0.020, 0.021] },
        { c: [0, 0.134, 0.217], r: [0.0145, 0.0155] },
        { c: [0, 0.131, 0.225], r: [0.0085, 0.0095] },
    ], { blend: 0.005 });
    // The nose's tip, its detail kept (face.bk draws the nostrils on it).
    B.blob('nosetip', 'nose', [0, 0.137, 0.229], [0.0065, 0.0055, 0.004], { blend: 0.0025, keep: true });
    for (const [s, t] of SIDES) {
        const x = (v) => v * s;
        B.blob(`cheek${t}`, 'head', [x(0.019), 0.139, 0.180], [0.019, 0.019, 0.026], { blend: 0.007 });
        B.blob(`pad${t}`, 'nose', [x(0.008), 0.127, 0.219], [0.010, 0.0095, 0.010], { blend: 0.004 });
        // The eye: large, high on the head's side; kept at full detail, and
        // face.bk draws it.
        B.blob(`eye${t}`, 'head', [x(0.0285), 0.164, 0.178], [0.0105, 0.0125, 0.0135], { blend: 0.0025, keep: true });
        ear(B, s, t);
    }
}

// The ear (ear.js): a shell rolled narrow where it leaves the crown, widest
// past halfway, rounded at the tip, its opening forward and out; the hollow
// a mass carved from its face, deepest down its middle and running out at
// the rim, a funnel at the base and shallow at the tip.
function ear(B, side, t) {
    const E = earAxis(side);
    const bone = (u) => (u >= 0.45 ? `ear${t}2` : `ear${t}1`);
    B.limb(`ear${t}`, [`ear${t}1`, `ear${t}2`],
        EAR_KEYS.map(([u, w, h]) => ({ c: E.at(u), r: [w, h], bone: bone(u) })),
        { up: E.face, blend: 0.003, steps: 6, keep: true, joint: 0.0025 });
    B.limb(`hollow${t}`, [`ear${t}1`, `ear${t}2`],
        HOLLOW_KEYS.map(([u, w, o, h]) => ({ c: E.at(u, o), r: [w, h], bone: bone(u) })),
        { up: E.face, blend: 0.003, steps: 6, carve: true, joint: 0.001 });
}

// Where form measures the body: across the trunk, the neck and the head.
function sections(B) {
    const across = (name, bone, at, radius = 0.12) => B.section(name, { at, normal: [0, 0, 1], bone, radius });
    across('haunch', 'pelvis', [0, 0.10, -0.10]);
    across('loins', 'lumbar', [0, 0.11, -0.03]);
    across('chest', 'thorax', [0, 0.11, 0.06]);
    across('neck', 'neck', [0, 0.135, 0.125], 0.06);
    across('eyes', 'head', [0, 0.155, 0.178], 0.06);
    const E = earAxis(1);
    B.section('ear', { at: E.at(0.4), normal: E.t, bone: 'earL1', radius: 0.03 });
}
