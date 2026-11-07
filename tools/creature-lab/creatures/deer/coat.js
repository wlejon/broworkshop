// The deer's coat: tawny above, darker along the back, cream underneath and
// inside the legs, a white throat patch, rump patch and tail underside, dark
// eyes, muzzle and hooves. Colours are display (sRGB) values. The body is one
// surface, so each region is found by its masses' share of the skin there
// (lab/flesh.js), and a colour ends where its mass blends away.

export const COAT = [0.55, 0.37, 0.22];
export const BACK = [0.45, 0.30, 0.18];
export const CREAM = [0.88, 0.82, 0.72];
export const WHITE = [0.95, 0.94, 0.90];
export const MUZZLE = [0.20, 0.15, 0.12];
export const DARK = [0.05, 0.05, 0.05];
export const HOOF = [0.12, 0.11, 0.10];
export const LEGS = [0.50, 0.36, 0.25];
export const EAR_IN = [0.85, 0.72, 0.65];

export const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
export const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// The body's skin by its normal: darker where it faces up, cream where it faces down.
function bodyShade(n) {
    const c = mix(COAT, BACK, sstep(0.3, 0.9, n[1]));
    return mix(c, CREAM, sstep(-0.45, -0.8, n[1]));
}

// A leg: tawny on the outside, cream on the inner face; the hind leg's back
// cream from the gaskin to the hock.
function legColor(p, n, front) {
    let c = mix(LEGS, COAT, sstep(0.35, 0.6, p[1]));
    const inner = -Math.sign(p[0]) * n[0];
    c = mix(c, CREAM, sstep(0.2, 0.7, inner) * sstep(0.7, 0.4, p[1]));
    if (!front) c = mix(c, CREAM, sstep(0.5, 0.9, -n[2]) * sstep(0.62, 0.5, p[1]) * sstep(0.38, 0.45, p[1]));
    return c;
}

function headColor(p, n) {
    let c = mix(COAT, MUZZLE, sstep(0.9, 0.96, p[2]));
    c = mix(c, DARK, sstep(0.965, 0.985, p[2]));
    return mix(c, WHITE, sstep(-0.5, -0.8, n[1]) * sstep(0.88, 0.94, p[2]));
}

const sum = (share, names) => names.reduce((s, k) => s + share(k), 0);
const LR = (n) => [n + 'L', n + 'R'];

export function coat(p, n, share) {
    let c = bodyShade(n);
    // White under the tail and down the inside of the buttocks.
    const rump = sstep(-0.60, -0.655, p[2]) * sstep(0.88, 0.80, p[1]) * sstep(0.07, 0.02, Math.abs(p[0]));
    c = mix(c, WHITE, rump);
    // The neck: a darker crest, a white throat patch under the jaw.
    const neck = share('neck');
    if (neck > 0) {
        let k = mix(c, BACK, 0.6 * sstep(0.2, 0.8, -n[2]) * sstep(0.85, 1.0, p[1]));
        k = mix(k, WHITE, sstep(0.4, 0.8, n[2] > 0 ? n[2] : 0) * sstep(1.12, 1.2, p[1]) * sstep(1.27, 1.22, p[1]));
        c = mix(c, k, neck);
    }
    c = mix(c, headColor(p, n), share('head') + sum(share, ['jawL', 'jawR']));
    c = mix(c, legColor(p, n, true), sum(share, [...LR('fore'), ...LR('arm')]));
    c = mix(c, legColor(p, n, false), sum(share, [...LR('hind'), ...LR('gaskin')]));
    c = mix(c, mix(BACK, WHITE, sstep(0.0, -0.4, n[1])), share('tail'));
    c = mix(c, n[2] > 0.3 ? EAR_IN : COAT, sum(share, LR('ear')));
    c = mix(c, DARK, sstep(0.35, 0.6, sum(share, LR('eye'))));
    c = mix(c, HOOF, sstep(0.35, 0.6, sum(share, [...LR('fhoof'), ...LR('hhoof')])));
    return c;
}
