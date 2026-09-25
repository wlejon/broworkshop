// Shared test helpers. Tests import lab.js / actions.js, where the app lives.

import { character } from "/app/lab.js";

/**
 * Every bone's model-space translation. On this rig every animated joint has
 * children, so a rotating joint always moves some bone's origin — which makes
 * this the right thing to diff when asking "did the pose move".
 */
export function bonePositions() {
    const out = [];
    for (let i = 0; i < character.boneCount; ++i) {
        const m = character.node.getBoneWorldMatrix(i);
        out.push(m ? [m[12], m[13], m[14]] : null);
    }
    return out;
}

export function maxDelta(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; ++i) {
        if (!a[i] || !b[i]) continue;
        for (let k = 0; k < 3; ++k) d = Math.max(d, Math.abs(a[i][k] - b[i][k]));
    }
    return d;
}

/** Chebyshev distance between two points. */
export const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** A bone's model-space translation, by name or index. */
export function boneAt(name) {
    const m = character.node.getBoneWorldMatrix(name);
    return [m[12], m[13], m[14]];
}

export const weightSum = (bs) => bs.clips.reduce((a, c) => a + c.weight, 0);
