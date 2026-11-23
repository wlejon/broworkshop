// lib/city/car_mesh.js — procedural vehicles: a body lofted along its length
// from a side silhouette (bumper, hood, windshield, roof, rear glass, deck)
// and a rounded cross-section with tumblehome, smooth shaded; glass where the
// cabin is, four wheels just proud of the sides, lamps and a grille. Local
// frame: +x forward, +y up, +z right; the origin on the ground under the
// middle of the wheelbase. car.bk adds what the local position decides
// (wheel arches, door seams).
//
// carMesh(type) -> bro.mesh.Mesh with colours coding the part (car.bk):
//   r = 1 body (takes the instance's paint), 0.1 glass, 0.2 tyre, 0.3 trim
//   (bumpers, sills, black plastic), 0.4 headlamp, 0.5 tail lamp, 0.6 wheel.
// CAR_TYPES: { name: { L, W, ... } }

export const PART = { body: 1.0, glass: 0.1, tyre: 0.2, trim: 0.3, head: 0.4, tail: 0.5, wheel: 0.6 };

// Side silhouettes: the top line's points [x, y] (x a fraction of the length
// from the rear, y metres) and the span of the cabin (its glass).
export const CAR_TYPES = {
    sedan: {
        L: 4.7, W: 1.82, clear: 0.17, belt: 0.92, wheelR: 0.33, wheelBase: 0.60, tumble: 0.22,
        top: [[0, 0.60], [0.025, 0.88], [0.20, 0.98], [0.33, 1.42], [0.60, 1.45], [0.77, 1.00], [0.96, 0.84], [1, 0.58]],
        cabin: [0.20, 0.77], weight: 0.34,
    },
    hatch: {
        L: 4.05, W: 1.76, clear: 0.16, belt: 0.93, wheelR: 0.31, wheelBase: 0.64, tumble: 0.20,
        top: [[0, 0.62], [0.02, 1.00], [0.08, 1.40], [0.58, 1.46], [0.76, 1.02], [0.96, 0.85], [1, 0.58]],
        cabin: [0.06, 0.76], weight: 0.26,
    },
    suv: {
        L: 4.75, W: 1.92, clear: 0.24, belt: 1.10, wheelR: 0.38, wheelBase: 0.60, tumble: 0.15,
        top: [[0, 0.75], [0.02, 1.25], [0.05, 1.70], [0.66, 1.75], [0.80, 1.22], [0.97, 1.06], [1, 0.75]],
        cabin: [0.04, 0.80], weight: 0.22,
    },
    van: {
        L: 5.3, W: 2.0, clear: 0.20, belt: 1.12, wheelR: 0.36, wheelBase: 0.62, tumble: 0.06,
        top: [[0, 0.80], [0.012, 2.02], [0.79, 2.08], [0.91, 1.42], [0.985, 1.06], [1, 0.80]],
        cabin: [0.77, 0.92], weight: 0.08,
    },
    pickup: {
        L: 5.4, W: 2.0, clear: 0.28, belt: 1.18, wheelR: 0.40, wheelBase: 0.62, tumble: 0.10,
        top: [[0, 1.12], [0.36, 1.16], [0.375, 1.86], [0.63, 1.88], [0.75, 1.30], [0.97, 1.20], [1, 0.82]],
        cabin: [0.375, 0.75], weight: 0.10,
    },
    // A low-floor tram: one long body glazed bay by bay, never spawned at random (weight 0).
    tram: {
        L: 30, W: 2.65, clear: 0.32, belt: 1.05, wheelR: 0.33, wheelBase: 0.76, tumble: 0.05,
        top: [[0, 0.85], [0.006, 2.6], [0.012, 3.3], [0.988, 3.3], [0.994, 2.6], [1, 0.85]],
        cabin: [0.004, 0.996], bay: 1.9, weight: 0,
    },
};

/** Linear interpolation of a polyline [[x, y], ...] at x. */
function at(line, x) {
    for (let i = 1; i < line.length; i++) {
        if (x <= line[i][0]) {
            const [x0, y0] = line[i - 1], [x1, y1] = line[i];
            return y0 + (y1 - y0) * ((x - x0) / Math.max(1e-6, x1 - x0));
        }
    }
    return line[line.length - 1][1];
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function carMesh(name) {
    const T = CAR_TYPES[name];
    const P = [], N = [], C = [], I = [];
    const vert = (p, n, part) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); C.push(part, part, part, 1); return P.length / 3 - 1; };
    // A quad with its own vertices (parts never blend), normals given per
    // corner (smooth) or the face's; turned to face away from `ref`.
    let ref = [0, 0.6, 0];
    const quad = (a, b, c, d, part, ns) => {
        let n = norm(cross(sub(c, a), sub(d, b)));
        const m = sub([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], ref);
        const flip = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0;
        if (flip) n = [-n[0], -n[1], -n[2]];
        const nn = ns ?? [n, n, n, n];
        const i0 = vert(a, nn[0], part), i1 = vert(b, nn[1], part), i2 = vert(c, nn[2], part), i3 = vert(d, nn[3], part);
        if (flip) I.push(i0, i2, i1, i0, i3, i2); else I.push(i0, i1, i2, i0, i2, i3);
    };

    const L = T.L, hw = T.W / 2;
    const [c0, c1] = T.cabin;
    // Stations along the length: dense at the rounded ends and the glass's breaks.
    const xs = new Set([0, 0.008, 0.02, 0.04, 0.07, 1, 0.992, 0.98, 0.96, 0.93, c0, c1]);
    for (const [x] of T.top) xs.add(x);
    for (let k = 1; k < 20; k++) xs.add(k / 20);
    // Window bays: a pillar at each bay's start.
    if (T.bay) for (let x = T.bay; x < L; x += T.bay) { xs.add(x / L); xs.add((x + 0.22) / L); }
    const st = [...xs].filter((x) => x >= 0 && x <= 1).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-4);
    // The right half of the cross-section at fraction f, bottom centre to roof centre.
    const section = (f) => {
        const X = (f - 0.5) * L;
        const top = at(T.top, f);
        const e = Math.min(f, 1 - f);
        const round = Math.sqrt(Math.min(1, e / 0.07));          // the ends round in plan
        const side = hw * (0.80 + 0.20 * round);
        const bottom = T.clear + (1 - round) * 0.12;             // bumpers lift at the ends
        const belt = Math.min(T.belt, top - 0.02);
        const cabin = f >= c0 && f <= c1 && top > belt + 0.2;
        const green = cabin ? Math.min(1, (top - belt) / 0.45) : 0;
        const roofW = side - 0.05 - T.tumble * green;
        const yS = bottom + 0.22;
        return {
            X, top, cabin,
            pts: [
                [X, bottom, 0],
                [X, bottom, side - 0.18],
                [X, bottom + 0.06, side - 0.05],
                [X, yS, side],
                [X, (yS + belt) * 0.5, side + 0.012],
                [X, belt, side],
                [X, Math.min(top, belt + 0.05), side - 0.05],
                [X, top - 0.12 * green - 0.02, roofW + 0.02],
                [X, top - 0.02, roofW - 0.10],
                [X, top, roofW - 0.30],
                [X, top, 0],
            ],
        };
    };
    const S = st.map(section);
    const R = S.length, K = S[0].pts.length;
    // Smooth normals on the grid (each corner the sum of its faces' normals).
    const gn = Array.from({ length: R * K }, () => [0, 0, 0]);
    ref = [0, (T.clear + T.belt) * 0.5, 0];
    for (let s = 0; s + 1 < R; s++) for (let k = 0; k + 1 < K; k++) {
        const a = S[s].pts[k], b = S[s + 1].pts[k], c = S[s + 1].pts[k + 1], d = S[s].pts[k + 1];
        let n = norm(cross(sub(c, a), sub(d, b)));
        const m = sub([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], ref);
        if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
        for (const [i, j] of [[s, k], [s + 1, k], [s + 1, k + 1], [s, k + 1]]) {
            const g = gn[i * K + j]; g[0] += n[0]; g[1] += n[1]; g[2] += n[2];
        }
    }
    // The roof's centre line and the floor's are flat across.
    for (let s = 0; s < R; s++) { gn[s * K][2] = 0; gn[s * K + K - 1][2] = 0; }
    const G = gn.map(norm);
    const mirror = (p) => [p[0], p[1], -p[2]];
    const mirN = (n) => [n[0], n[1], -n[2]];
    for (let s = 0; s + 1 < R; s++) {
        const fm = (st[s] + st[s + 1]) / 2;
        const cabin = S[s].cabin && S[s + 1].cabin;
        const pillar = cabin && (T.bay
            ? ((fm * L) % T.bay) < 0.22
            : (fm - c0 < 0.035 || c1 - fm < 0.03 || Math.abs(fm - (c0 + c1) * 0.53) < 0.018));
        const slope = Math.abs(S[s + 1].top - S[s].top) / ((st[s + 1] - st[s]) * L);
        for (let k = 0; k + 1 < K; k++) {
            let part = PART.body;
            if (k === 0 || k === 1) part = PART.trim;                                  // underside, lower sill
            if ((k === 2 || k === 3) && (fm < 0.035 || fm > 0.965)) part = PART.trim;   // bumpers
            if (k === 6 && cabin && !pillar) part = PART.glass;                         // side windows
            if ((k === 7 || k === 8 || k === 9) && cabin && slope > 0.55 && !pillar) part = PART.glass;   // windshield, rear glass
            const a = S[s].pts[k], b = S[s + 1].pts[k], c = S[s + 1].pts[k + 1], d = S[s].pts[k + 1];
            const na = G[s * K + k], nb = G[(s + 1) * K + k], nc = G[(s + 1) * K + k + 1], nd = G[s * K + k + 1];
            quad(a, b, c, d, part, [na, nb, nc, nd]);
            quad(mirror(a), mirror(b), mirror(c), mirror(d), part, [mirN(na), mirN(nb), mirN(nc), mirN(nd)]);
        }
    }
    // End caps (flat, small: the ends are rounded down to them).
    for (const [sec, sg] of [[S[0], -1], [S[R - 1], 1]]) {
        const pts = sec.pts, n = [sg, 0, 0];
        ref = [-sg * L, 0.6, 0];
        for (let k = 0; k + 1 < K; k++) {
            const a = pts[k], b = pts[k + 1];
            const part = k <= 2 ? PART.trim : PART.body;
            quad([a[0], a[1], 0], a, b, [b[0], b[1], 0], part, [n, n, n, n]);
            quad([a[0], a[1], 0], mirror(a), mirror(b), [b[0], b[1], 0], part, [n, n, n, n]);
        }
    }
    // Lamps and grille: plates just proud of the ends.
    const plate = (X, sg, part, y0, y1, z0, z1) => {
        const x = X + sg * 0.01, n = [sg, 0, 0];
        ref = [X - sg, (y0 + y1) / 2, 0];
        for (const m of [1, -1]) quad([x, y0, z0 * m], [x, y0, z1 * m], [x, y1, z1 * m], [x, y1, z0 * m], part, [n, n, n, n]);
    };
    const endW = hw * 0.80;
    const fy = Math.min(T.belt, at(T.top, 1)) - 0.04, ry = Math.min(T.belt, at(T.top, 0)) - 0.04;
    plate(L / 2, 1, PART.head, fy - 0.13, fy, endW * 0.58, endW * 0.95);
    plate(L / 2, 1, PART.trim, fy - 0.24, fy - 0.03, 0.0, endW * 0.52);
    plate(-L / 2, -1, PART.tail, ry - 0.15, ry, endW * 0.55, endW * 0.97);

    // Wheels: 16-sided tyres with a rim face, just proud of the sides.
    const Rw = T.wheelR, tw = 0.23, seg = 16;
    const axle = (T.wheelBase / 2) * L;
    for (const ax of [axle, -axle]) {
        for (const sz of [1, -1]) {
            const zo = sz * (hw + 0.02), zi = sz * (hw + 0.02 - tw);
            const ring = (z, r) => Array.from({ length: seg }, (_, i) => {
                const t = (i / seg) * Math.PI * 2;
                return [ax + Math.cos(t) * r, Rw + Math.sin(t) * r, z];
            });
            const o = ring(zo, Rw), n = ring(zi, Rw), rim = ring(zo + sz * 0.005, Rw * 0.62);
            ref = [ax, Rw, zo - sz * tw * 0.5];
            for (let i = 0; i < seg; i++) {
                const j = (i + 1) % seg;
                const ni = norm([o[i][0] - ax, o[i][1] - Rw, 0]), nj = norm([o[j][0] - ax, o[j][1] - Rw, 0]);
                quad(n[i], n[j], o[j], o[i], PART.tyre, [ni, nj, nj, ni]);
            }
            // The sidewall (tyre) to the rim, then the rim (wheel) to the hub.
            ref = [ax, Rw, 0];
            const hub = [ax, Rw, zo + sz * 0.01];
            for (let i = 0; i < seg; i++) {
                const j = (i + 1) % seg;
                quad(o[i], o[j], rim[j], rim[i], PART.tyre);
                quad(rim[i], rim[j], hub, hub, PART.wheel);
            }
        }
    }
    const { Mesh } = bro.mesh;
    return new Mesh({ positions: new Float32Array(P), normals: new Float32Array(N), colors: new Float32Array(C), indices: new Uint32Array(I) });
}

/** car.bk's uniforms for a body type: axles, wheel radius, half width, door seams. */
export function carUniforms(name, night = 0) {
    const T = CAR_TYPES[name];
    const [c0, c1] = T.cabin;
    const x = (f) => (f - 0.5) * T.L;
    // Doors under the cabin: a seam at its front, one at the B pillar, one behind (four-door bodies).
    const seams = name === 'tram' ? [-0.3 * T.L, -0.1 * T.L, 0.1 * T.L, 0.3 * T.L]
        : name === 'van' ? [x(c0 + 0.02), 0, 0, 0] : [x(c1 - 0.04), x((c0 + c1) * 0.53), x(c0 + 0.05), 0];
    return { night, axle: (T.wheelBase / 2) * T.L, wheel_r: T.wheelR, half_w: T.W / 2, seams, cabin: [name === 'tram' ? 3 : 0, T.belt + 0.05, 0, 0] };
}
