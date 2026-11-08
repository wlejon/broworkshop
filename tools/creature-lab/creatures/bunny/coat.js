// The bunny's coat: a wild rabbit's agouti, grey-brown above with a warmer
// rufous nape and a darker line down the back, cream to white underneath,
// the scut white beneath and dark above, the ears' backs edged dark at the
// tips and their insides pale pink, pale rings about the eyes, the paws
// pale. Colours are display (sRGB) values; each region is found by its
// masses' share of the skin (lab/flesh.js), and face.bk draws the eyes,
// nose and lip sharp per pixel over the head.

export const COAT = [0.53, 0.44, 0.33];
export const BACK = [0.40, 0.32, 0.24];
export const NAPE = [0.66, 0.45, 0.27];
export const CREAM = [0.86, 0.81, 0.72];
export const WHITE = [0.95, 0.94, 0.91];
export const EAR_IN = [0.86, 0.70, 0.66];
export const EAR_TIP = [0.18, 0.15, 0.13];
export const PAW = [0.78, 0.72, 0.62];
export const DARK = [0.05, 0.04, 0.04];

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const sum = (share, names) => names.reduce((s, k) => s + share(k), 0);
const LR = (n) => [n + 'L', n + 'R'];

// The trunk by its normal: darker along the top, cream where it faces down.
function bodyShade(p, n) {
    let c = mix(COAT, BACK, 0.7 * sstep(0.6, 0.95, n[1]) * sstep(0.03, 0.0, Math.abs(p[0])));
    c = mix(c, BACK, 0.35 * sstep(0.3, 0.9, n[1]));
    return mix(c, CREAM, sstep(-0.3, -0.75, n[1]));
}

export function coat(p, n, share) {
    let c = bodyShade(p, n);
    // The nape behind the ears, rufous.
    c = mix(c, NAPE, sstep(0.08, 0.14, p[2]) * sstep(0.17, 0.12, p[2]) * sstep(0.12, 0.15, p[1]) * sstep(0.2, 0.7, n[1]));
    // The throat and chest cream.
    c = mix(c, CREAM, sstep(0.3, 0.8, n[2]) * sstep(0.12, 0.08, p[1]) * sstep(0.05, 0.09, p[2]));
    // The head: grey-brown, the cheeks paler, the chin and the underside of
    // the muzzle white, a pale ring about each eye.
    const head = share('head') + sum(share, LR('cheek')) + share('muzzle') + sum(share, LR('pad')) + share('nosetip');
    if (head > 0) {
        let h = mix(COAT, CREAM, 0.35 * sum(share, LR('cheek')));
        h = mix(h, WHITE, sstep(-0.2, -0.7, n[1]) * sstep(0.17, 0.2, p[2]));
        h = mix(h, CREAM, 0.6 * (share('muzzle') + sum(share, LR('pad'))) * sstep(0.0, -0.5, n[1]));
        const ex = Math.abs(p[0]) - 0.0285, ey = p[1] - 0.164, ez = p[2] - 0.178;
        h = mix(h, CREAM, 0.3 * sstep(0.016, 0.013, Math.hypot(ey, ez)) * sstep(-0.012, -0.004, ex));
        c = mix(c, h, head);
    }
    // The ears: the backs as the coat, edged dark at the tip; the insides pink.
    const ears = sum(share, LR('ear'));
    if (ears > 0) {
        const inner = Math.max(0, n[2]) - 0.3 * Math.abs(n[0]);
        let e = mix(COAT, EAR_IN, sstep(0.15, 0.55, inner) * sstep(0.27, 0.24, p[1]) * sstep(0.19, 0.205, p[1]));
        e = mix(e, EAR_TIP, sstep(0.255, 0.275, p[1]) * sstep(0.1, -0.3, inner));
        c = mix(c, e, ears);
    }
    // The haunches: the coat, cream inside and on the hind feet's soles;
    // the fore legs and paws pale.
    c = mix(c, mix(c, CREAM, sstep(0.2, 0.7, -Math.sign(p[0]) * n[0])), sum(share, LR('haunch')));
    c = mix(c, mix(PAW, CREAM, sstep(0.0, -0.6, n[1])), sum(share, LR('foot')));
    c = mix(c, mix(PAW, COAT, sstep(0.06, 0.10, p[1])), sum(share, LR('fore')));
    // The scut: white beneath and behind, dark grey-brown on top.
    c = mix(c, mix(WHITE, BACK, sstep(0.3, 0.8, n[1]) * sstep(-0.5, 0.0, n[2])), share('tail'));
    c = mix(c, DARK, sstep(0.35, 0.6, sum(share, LR('eye'))));
    return c;
}
