// anim.js — procedural animation clips for the kit ragdoll rig.
//
// A clip is a function of time returning a POSE in the lib/kit/ragdoll.js
// sense: part name -> local rotation delta on top of the bind (standing)
// pose. The same map feeds buildPose() for the kinematic drive and
// driveToPose() for the motors, so "the animation" and "what the joints are
// told to hold" can never disagree.

import { q } from "/lib/kit/math3d.js";

const DEG = Math.PI / 180;
const X = (a) => q.axis(1, 0, 0, a * DEG);
const Y = (a) => q.axis(0, 1, 0, a * DEG);
const Z = (a) => q.axis(0, 0, 1, a * DEG);

/** Length of both get-up clips, seconds. */
export const GETUP_TIME = 1.8;

const smooth = (t) => { const p = Math.min(1, Math.max(0, t / GETUP_TIME)); return p * p * (3 - 2 * p); };

// Legs swing about X (forward is +Z). The arms bind straight out along +/-X
// (a T-pose), so every clip first drops them with a local Z rotation (+/-90
// would be straight down) and then swings them about the part's local X.
function gait(t, freq, lean, legAmp, kneeAmp, armDrop, armAmp, elbow, twist) {
    const s = Math.sin(t * freq), c = Math.cos(t * freq);
    return {
        pelvis: Y(s * 5),
        spine: X(lean),
        chest: Y(-s * twist),
        upperLegR: X(-s * legAmp), lowerLegR: X(Math.max(0, -s) * kneeAmp),
        upperLegL: X(s * legAmp), lowerLegL: X(Math.max(0, s) * kneeAmp),
        upperArmR: q.mul(Z(-armDrop), X(c * armAmp)), lowerArmR: X(elbow == null ? Math.max(0, c) * 25 : elbow),
        upperArmL: q.mul(Z(armDrop), X(-c * armAmp)), lowerArmL: X(elbow == null ? Math.max(0, -c) * 25 : elbow),
    };
}

export const CLIPS = {
    idle: (t) => {
        const breath = Math.sin(t * 2.0), sway = Math.sin(t * 1.0);
        return {
            chest: X(breath * 3), spine: Y(sway * 2), head: X(-breath * 2),
            upperArmR: Z(breath * 2 - 75), upperArmL: Z(-breath * 2 + 75),     // arms down at the sides
        };
    },
    walk: (t) => gait(t, 4.2, 6, 32, 45, 75, 28, null, 6),
    run: (t) => gait(t, 6.8, 14, 50, 75, 70, 48, 45, 10),
    // Push-up from the stomach: arms braced, knees tucked, unfolding to stand.
    getup_prone: (t) => {
        const k = 1 - smooth(t);
        return {
            spine: X(k * 35),
            upperArmR: Z(-75 + k * 145), upperArmL: Z(75 - k * 145),
            upperLegR: X(k * -45), lowerLegR: X(k * 60),
            upperLegL: X(k * -45), lowerLegL: X(k * 60),
        };
    },
    // Sit-up from the back: trunk curls forward over drawn-up knees.
    getup_supine: (t) => {
        const k = 1 - smooth(t);
        return {
            spine: X(k * -40), chest: X(k * -20),
            upperArmR: Z(-75), upperArmL: Z(75),
            upperLegR: X(k * -80), lowerLegR: X(k * 80),
            upperLegL: X(k * -80), lowerLegL: X(k * 80),
        };
    },
};

export const LOOPS = ['idle', 'walk', 'run'];
