// Baked vertex colors for the leopard (sRGB display space): rich golden-ochre
// dorsal saddle paling into warm apricot-buff flanks and luminous cream-white
// throat, chest, belly, medial legs, whisker pads, and tail underside, plus
// black ear backs and dark digital paw pads so coarse crowd LODs read cleanly
// even when per-pixel coat.bk / face.bk are turned off.

export const DORSAL = [0.70, 0.44, 0.18];
export const GOLD = [0.79, 0.56, 0.28];
export const BUFF = [0.86, 0.69, 0.45];
export const CREAM = [0.95, 0.92, 0.85];
export const WHITE = [0.97, 0.96, 0.93];
export const NOSE_PINK = [0.50, 0.27, 0.24];
export const DARK = [0.05, 0.04, 0.035];
export const PAD = [0.11, 0.095, 0.09];
export const EAR_IN = [0.90, 0.82, 0.74];

export const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
export const sstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

const sum = (share, names) => names.reduce((s, k) => s + share(k), 0);
const LR = (n) => [n + 'L', n + 'R'];

function trunkShade(p, n) {
    let c = mix(BUFF, GOLD, sstep(-0.15, 0.45, n[1]));
    c = mix(c, DORSAL, sstep(0.45, 0.92, n[1]) * sstep(0.09, 0.02, Math.abs(p[0])));
    const belly = sstep(-0.25, -0.75, n[1]) * sstep(0.49, 0.40, p[1]);
    return mix(c, CREAM, belly);
}

function legShade(p, n) {
    let c = mix(BUFF, GOLD, sstep(0.18, 0.50, p[1]));
    const inner = -Math.sign(p[0]) * n[0];
    c = mix(c, CREAM, sstep(0.15, 0.68, inner) * sstep(0.50, 0.08, p[1]));
    return c;
}

function headShade(p, n) {
    let c = mix(BUFF, GOLD, sstep(0.05, 0.75, n[1]));
    // Rich golden-ochre nasal bridge and crown.
    c = mix(c, GOLD, 0.55 * sstep(0.66, 0.70, p[2]) * sstep(0.028, 0.010, Math.abs(p[0])) * sstep(0.625, 0.642, p[1]));
    // Pale cream whisker pads, chin, and sub-ocular cheek highlights.
    c = mix(c, CREAM, 0.82 * sstep(0.705, 0.742, p[2]) * sstep(0.636, 0.608, p[1]));
    c = mix(c, CREAM, 0.88 * sstep(-0.25, -0.75, n[1]) * sstep(0.63, 0.73, p[2]));
    c = mix(c, NOSE_PINK, sstep(0.755, 0.768, p[2]) * sstep(0.620, 0.636, p[1]) * sstep(0.015, 0.006, Math.abs(p[0])));
    return c;
}

function tailShade(p, n) {
    let c = mix(GOLD, DORSAL, sstep(0.2, 0.8, n[1]));
    c = mix(c, CREAM, sstep(-0.1, -0.65, n[1]));
    // Black sub-terminal ring and snowy white underside tip flash.
    const tip = sstep(-1.02, -1.13, p[2]);
    c = mix(c, n[1] < -0.15 ? WHITE : DARK, 0.85 * tip);
    return c;
}

export function coat(p, n, share) {
    let c = trunkShade(p, n);
    const neck = share('neck');
    if (neck > 0) {
        let nc = mix(BUFF, GOLD, sstep(0.1, 0.75, n[1]));
        const throat = sstep(-0.15, -0.70, n[1] - 0.35 * Math.max(0, n[2])) * sstep(0.068, 0.025, Math.abs(p[0]));
        nc = mix(nc, CREAM, throat);
        c = mix(c, nc, neck);
    }
    const headShare = share('head') + share('nose') + share('chin') + sum(share, LR('brow')) + sum(share, LR('cheek')) + sum(share, LR('muzzle'));
    c = mix(c, headShade(p, n), Math.min(1, headShare));
    c = mix(c, legShade(p, n), Math.min(1, sum(share, [...LR('fore'), ...LR('hind')])));
    const pawShare = sum(share, [...LR('fpaw'), ...LR('hpaw'), ...LR('ftoeIn'), ...LR('ftoeOut'), ...LR('htoeIn'), ...LR('htoeOut')]);
    if (pawShare > 0) {
        const sole = sstep(-0.15, -0.65, n[1] + 0.25 * Math.min(0, n[2])) * sstep(0.032, 0.012, p[1]);
        c = mix(c, mix(BUFF, PAD, sole), Math.min(1, pawShare));
    }
    c = mix(c, tailShade(p, n), share('tail'));
    const ear = sum(share, LR('ear'));
    if (ear > 0) {
        const earBack = n[2] < -0.05 ? DARK : EAR_IN;
        c = mix(c, earBack, Math.min(1, ear));
    }
    c = mix(c, DARK, sstep(0.35, 0.65, sum(share, LR('eye'))));
    return c;
}
