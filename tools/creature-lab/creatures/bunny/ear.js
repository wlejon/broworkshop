// The bunny's ear at rest, for the skeleton (its two bones), the body (its
// shell and the hollow carved in it) and the coat (the hollow's pale lining):
// from a narrow rolled base on the crown, the two set 4 cm apart, to a
// rounded tip 10.5 cm up, leaning out so the pair stands in a V; its opening
// faces forward and out. Left ear; `side` -1 mirrors it.

const BASE = [0.020, 0.186, 0.164];
const TIP = [0.042, 0.288, 0.146];
const FACE = [0.55, 0, 1];   // the opening's way, before it is made square to the ear

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function earAxis(side) {
    const m = (p) => [p[0] * side, p[1], p[2]];
    const base = m(BASE), tip = m(TIP);
    const d = tip.map((x, k) => x - base[k]);
    const len = Math.hypot(...d), t = norm(d);
    const f0 = m(FACE);
    const face = norm(f0.map((x, k) => x - dot(f0, t) * t[k]));
    // u from 0 at the base to 1 at the tip; `out` m along the face.
    const at = (u, out = 0) => base.map((x, k) => x + d[k] * u + face[k] * out);
    // Across the ear, square to its length and its face.
    const across = [t[1] * face[2] - t[2] * face[1], t[2] * face[0] - t[0] * face[2], t[0] * face[1] - t[1] * face[0]];
    // Where p lies: along (0..1), in front of the ear's mid plane and off
    // its middle line (m).
    const where = (p) => {
        const q = p.map((x, k) => x - base[k]);
        return { u: dot(q, t) / len, front: dot(q, face), off: Math.abs(dot(q, across)) };
    };
    return { base, tip, len, t, face, at, where };
}

// The shell: u along the ear, its half width and half thickness.
export const EAR_KEYS = [
    [0.00, 0.0065, 0.0060], [0.15, 0.0085, 0.0058], [0.35, 0.0140, 0.0055],
    [0.58, 0.0165, 0.0052], [0.78, 0.0140, 0.0048], [0.92, 0.0085, 0.0042], [1.00, 0.0035, 0.0035],
];
// The hollow carved in its face: u, its half width, its centre in front of
// the mid plane, its depth radius.
export const HOLLOW_KEYS = [
    [0.16, 0.0030, 0.0090, 0.0080], [0.30, 0.0085, 0.0110, 0.0125], [0.58, 0.0115, 0.0115, 0.0130],
    [0.80, 0.0090, 0.0110, 0.0122], [0.93, 0.0035, 0.0105, 0.0105],
];

// The hollow's half width at u (0 outside it).
export function hollowWidth(u) {
    const K = HOLLOW_KEYS;
    if (u <= K[0][0] || u >= K[K.length - 1][0]) return 0;
    let i = 0;
    while (u > K[i + 1][0]) i++;
    const s = (u - K[i][0]) / (K[i + 1][0] - K[i][0]);
    return K[i][1] + (K[i + 1][1] - K[i][1]) * s;
}
