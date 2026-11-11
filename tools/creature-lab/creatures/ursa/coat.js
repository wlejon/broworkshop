// Vertex-level coat palette for `ursa` (sRGB), providing coarse crowd LODs with
// the same deep espresso-umber coat, warm cinnamon-bronze grizzled shoulder hump,
// cream-gold chest V-crescent, tan muzzle, and dark lower paws/claws that
// coat.bk and face.bk refine per pixel at close range.

export const UMBER = [0.21, 0.135, 0.092];
export const MAHOGANY = [0.27, 0.172, 0.112];
export const GRIZZLE = [0.46, 0.325, 0.205];
export const BELLY = [0.155, 0.102, 0.074];
export const PAW_DARK = [0.105, 0.075, 0.058];
export const CLAW_COL = [0.075, 0.065, 0.058];
export const CRESCENT = [0.89, 0.80, 0.61];
export const MUZZLE_TAN = [0.56, 0.405, 0.268];
export const EAR_TAN = [0.52, 0.38, 0.27];
export const NOSE_DARK = [0.055, 0.050, 0.048];

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};
const sum = (share, names) => names.reduce((s, k) => s + share(k), 0);
const LR = (n) => [n + 'L', n + 'R'];

function trunkCoat(p, n) {
    const ax = Math.abs(p[0]);
    let c = mix(UMBER, MAHOGANY, sstep(-0.2, 0.55, n[1]));
    // Warm cinnamon-bronze grizzled guard-hair sheen over shoulder hump, ruff, and upper back.
    const hump = sstep(0.76, 0.94, p[1]) * sstep(-0.25, 0.18, p[2]) * sstep(0.50, 0.34, p[2]);
    const back = sstep(0.78, 0.86, p[1]) * sstep(-0.55, 0.42, p[2]) * sstep(0.18, 0.06, ax);
    c = mix(c, GRIZZLE, Math.min(1, 0.68 * hump + 0.35 * back));
    // Darker espresso underside along the heavy barrel ribcage.
    c = mix(c, BELLY, 0.55 * sstep(-0.25, -0.78, n[1]));
    // Iconic warm cream-gold V-crescent chest blaze across anterior thorax.
    if (p[2] > 0.36 && p[2] < 0.60 && p[1] > 0.52 && p[1] < 0.78 && ax < 0.16) {
        const vCurve = 0.595 + 1.05 * ax;
        const band = 1.0 - sstep(0.018, 0.046, Math.abs(p[2] - 0.48) + Math.abs(p[1] - vCurve));
        const tipFade = 1.0 - sstep(0.105, 0.148, ax);
        const frontFace = sstep(0.15, 0.55, n[2]);
        c = mix(c, CRESCENT, 0.88 * band * tipFade * frontFace);
    }
    return c;
}

function legCoat(p) {
    let c = mix(PAW_DARK, UMBER, sstep(0.16, 0.48, p[1]));
    c = mix(c, MAHOGANY, 0.35 * sstep(0.45, 0.74, p[1]));
    return c;
}

function headCoat(p, n) {
    let c = mix(UMBER, MAHOGANY, 0.4 * sstep(0.1, 0.75, n[1]));
    // Warm tan-cinnamon bear muzzle mask ahead of the frontal stop.
    const mask = sstep(0.81, 0.885, p[2]) * sstep(0.10, 0.045, Math.abs(p[0]));
    c = mix(c, MUZZLE_TAN, 0.82 * mask);
    c = mix(c, NOSE_DARK, sstep(0.972, 0.992, p[2]) * sstep(0.72, 0.76, p[1]));
    return c;
}

export function coat(p, n, share) {
    let c = trunkCoat(p, n);
    const neck = share('neck') + share('ruff');
    if (neck > 0) {
        let nc = mix(UMBER, GRIZZLE, 0.52 * sstep(0.75, 0.92, p[1]));
        c = mix(c, nc, Math.min(1, neck));
    }
    const headS = share('head') + share('muzzle') + share('jaw') + share('nose');
    if (headS > 0) c = mix(c, headCoat(p, n), Math.min(1, headS));

    const legsS = sum(share, [
        ...LR('foreUpper'), ...LR('forePaw'),
        ...LR('hindUpper'), ...LR('hindPaw'),
    ]);
    if (legsS > 0) c = mix(c, legCoat(p), Math.min(1, legsS));

    const claws = sum(share, [
        ...[0, 1, 2, 3, 4].flatMap((i) => LR(`fClaw${i}`)),
        ...[0, 1, 2, 3, 4].flatMap((i) => LR(`hClaw${i}`)),
    ]);
    if (claws > 0) c = mix(c, CLAW_COL, sstep(0.25, 0.65, claws));

    const earS = sum(share, LR('ear'));
    if (earS > 0) c = mix(c, n[2] > 0.25 ? EAR_TAN : UMBER, Math.min(1, earS));

    const eyeS = sum(share, LR('eye'));
    if (eyeS > 0) c = mix(c, NOSE_DARK, sstep(0.3, 0.6, eyeS));

    if (share('nose') > 0) c = mix(c, NOSE_DARK, sstep(0.3, 0.65, share('nose')));
    return c;
}
