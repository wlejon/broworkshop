// Pegbounce scoring rules — pure functions, no world, no DOM.

export const PEG_POINTS = { blue: 10, green: 10, orange: 100, purple: 500 };
export const FEVER_BONUS = 25000;        // clearing the last orange mid-shot
export const ORANGES_PER_BONUS_BALL = 10;
export const LAUNCH_SPEED = 820;
export const MUZZLE = 30;                // cannon barrel length, px
export const AIM_MIN = 0.08;             // radians off horizontal
export const AIM_RATE = Math.PI * 0.9;   // keyboard aim, rad/s

/**
 * Shot multiplier: the better of the orange-count and hit-count tiers.
 * Purple doubles it on top (see shotMult).
 */
export function comboMult(orangeHits, hits) {
    const fromOrange =
        orangeHits >= 15 ? 10 :
        orangeHits >= 10 ? 5 :
        orangeHits >= 6 ? 3 :
        orangeHits >= 3 ? 2 : 1;
    const fromCombo =
        hits >= 30 ? 10 :
        hits >= 20 ? 5 :
        hits >= 12 ? 3 :
        hits >= 6 ? 2 : 1;
    return Math.max(fromOrange, fromCombo);
}

export function shotMult(orangeHits, hits, purple) {
    return comboMult(orangeHits, hits) * (purple ? 2 : 1);
}

/** Stars earned for `score` against [bronze, silver, gold] thresholds. */
export function starCount(score, thresholds) {
    let n = 0;
    for (const t of thresholds) if (score >= t) n++;
    return n;
}

export function starString(n) {
    return "★".repeat(n) + "☆".repeat(3 - n);
}

export function clampAim(a) {
    return Math.max(AIM_MIN, Math.min(Math.PI - AIM_MIN, a));
}

/** Semitone ladder from middle C: peg hit pitch rises with the combo. */
export function ladder(step) {
    const i = Math.min(35, Math.max(0, step | 0));
    return 261.63 * Math.pow(2, i / 12);
}
