// lib/mech/gait.js — the machine moving as its report says it can: standing,
// walking and running at the speeds and stride evaluate() derived, and held
// in the air on the throttle settings its trim found. Kinematic: legs are
// placed by two-bone IK onto footfalls on flat ground. What it returns is a
// pose for skeleton.poseWorld.

import { add, sub, mul, len, norm, dot, qaxis, qmul, qconj, qrot, qfromTo, mirrorV, QI, RAD } from "./vec.js";
import { poseWorld } from "./skeleton.js";

export const GAITS = ['stand', 'walk', 'sprint', 'hover', 'burn'];

/**
 * @param {string} gait  one of GAITS
 * @param {number} t     seconds
 * @returns {{pose: Object, speed: number, jets: Object<string, number>, air: boolean}}
 *   pose: instance id -> { pos, rot }; speed: m/s over the ground (the ground
 *   moves under it, the machine stays put); jets: jet key -> throttle
 */
export function poseAt(design, report, gait, t) {
    const insts = report.insts, rest = report.rest, root = insts[0];
    const rootRest = rest.pos[root.id];
    const joints = {};
    const jets = {};
    const mv = report.move, legs = report.legs;
    const L = legs.R || legs.L;
    const air = gait === 'hover' || gait === 'burn';
    let speed = 0;
    let rootPos = rootRest.slice(), rootRot = QI;

    report.flight.jets.forEach((j, i) => { jets[j.key] = gait === 'burn' ? 1 : gait === 'hover' ? (report.flight.hover.each[i] ?? 0) : 0; });

    const armSwing = (phase, amp) => {
        for (const it of insts) {
            if (it.seg.role === 'arm' && it.seg.joint.type !== 'fixed') joints[it.id] = qaxis([1, 0, 0], amp * Math.sin(phase + (it.side > 0 ? 0 : Math.PI)));
            if (it.seg.role === 'torso' && it.seg.joint.type !== 'fixed') joints[it.id] = qaxis([0, 1, 0], -0.35 * amp * Math.sin(phase));
        }
    };

    if (air || !L) {
        const lift = air ? 7 + 0.5 * Math.sin(t * 1.3) : 0;
        rootPos = add(rootRest, [0, lift, 0]);
        rootRot = qaxis([1, 0, 0], gait === 'burn' ? -14 * RAD : -3 * RAD + 1 * RAD * Math.sin(t * 0.9));
        for (const it of insts) {
            const bend = it.seg.joint.bend || 1;
            if (it.seg.role === 'thigh') joints[it.id] = qaxis([1, 0, 0], (gait === 'burn' ? -6 : 18) * RAD * bend);
            if (it.seg.role === 'shin') joints[it.id] = qaxis([1, 0, 0], (gait === 'burn' ? -22 : -34) * RAD * bend);
            if (it.seg.role === 'foot') joints[it.id] = qaxis([1, 0, 0], (gait === 'burn' ? -30 : -14) * RAD);
        }
        armSwing(t * 0.8, 0.06);
        return { pose: poseWorld(design, insts, rootPos, rootRot, joints), speed: 0, jets, air: true };
    }

    // On the ground: feet are planted, the hips ride above them.
    const legLen = mv.legLength;
    const run = gait === 'sprint', moving = gait !== 'stand' && mv.stands;
    speed = !moving ? 0 : run ? mv.sprint : mv.walk;
    const cycle = moving ? (run ? mv.stride : 1.25 * legLen) : 1;          // metres a full cycle covers
    const period = moving ? cycle / Math.max(0.1, speed) : 1;
    const phase = moving ? (t / period) % 1 : 0;
    const duty = run ? 0.42 : 0.62;
    const drop = (moving ? (run ? 0.10 : 0.05) : 0.025) * legLen;
    const bob = moving ? (run ? 0.035 : 0.015) * legLen * Math.cos(4 * Math.PI * phase) : 0;
    const hipX = Math.abs(rest.pos[L.thigh.id][0]);
    const sway = moving && !run ? 0.18 * hipX * Math.sin(2 * Math.PI * phase) : 0;
    rootPos = add(rootRest, [sway, -drop + bob, 0]);
    rootRot = qaxis([1, 0, 0], (run ? -11 : moving ? -3 : 0) * RAD);

    for (const tag of ['R', 'L']) {
        const leg = legs[tag];
        if (!leg) continue;
        const side = leg.thigh.side;
        const hipAt = side < 0 ? mirrorV(leg.thigh.seg.attach) : leg.thigh.seg.attach;
        const kneeAt = side < 0 ? mirrorV(leg.shin.seg.attach) : leg.shin.seg.attach;
        const ankleAt = side < 0 ? mirrorV(leg.foot.seg.attach) : leg.foot.seg.attach;
        const l1 = len(kneeAt), l2 = len(ankleAt);
        const hip = add(rootPos, qrot(rootRot, hipAt));
        const ankleRest = rest.pos[leg.foot.id];
        let ankle = ankleRest.slice(), footPitch = 0;
        if (moving) {
            const p = (phase + (tag === 'L' ? 0.5 : 0)) % 1;
            const step = cycle * duty;                // how far the ground passes under a planted foot
            if (p < duty) {
                const s = p / duty;
                ankle = add(ankleRest, [0, 0, (s - 0.5) * step]);
                footPitch = run ? (s > 0.7 ? -(s - 0.7) / 0.3 * 28 : 0) : (s > 0.8 ? -(s - 0.8) / 0.2 * 16 : 0);
            } else {
                const s = (p - duty) / (1 - duty), e = s * s * (3 - 2 * s);
                ankle = add(ankleRest, [0, (run ? 0.22 : 0.10) * legLen * Math.sin(Math.PI * s), (0.5 - e) * step]);
                footPitch = (run ? -28 : -16) * (1 - s) + (run ? 10 : 8) * s * (1 - s) * 4;
            }
        }
        // Two bones from the hip to the ankle, the knee folding the way the joint is built to.
        let d = sub(ankle, hip), D = len(d);
        const reach = (l1 + l2) * 0.999;
        if (D > reach) { d = mul(d, reach / D); D = reach; }
        const along = mul(d, 1 / D);
        const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        const fwd = qrot(rootRot, [0, 0, -(leg.shin.seg.joint.bend || 1)]);
        const perp = norm(sub(fwd, mul(along, dot(fwd, along))), [0, 0, -1]);
        const knee = add(hip, add(mul(along, a), mul(perp, h)));
        const ankleAtReach = add(hip, d);
        const qThigh = qfromTo(norm(kneeAt), norm(sub(knee, hip)));
        const qShin = qfromTo(norm(ankleAt), norm(sub(ankleAtReach, knee)));
        const qFoot = qaxis([1, 0, 0], footPitch * RAD);
        // A thigh hangs from the root, so its joint turns it from the root's own attitude.
        joints[leg.thigh.id] = qmul(qconj(rootRot), qThigh);
        joints[leg.shin.id] = qmul(qconj(qThigh), qShin);
        joints[leg.foot.id] = qmul(qconj(qShin), qFoot);
    }
    if (moving) armSwing(2 * Math.PI * phase, run ? 0.5 : 0.22);
    return { pose: poseWorld(design, insts, rootPos, rootRot, joints), speed, jets, air: false, phase };
}
