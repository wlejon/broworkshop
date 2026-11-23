// lib/city/car_mesh.js — procedural vehicles: a body lofted along its length
// from a side silhouette (bumper, hood, windshield, roof, rear glass, deck)
// and a cross-section with tumblehome, glass where the cabin is, four wheels,
// and lamps. Local frame: +x forward, +y up, +z right; the origin on the
// ground under the middle of the wheelbase.
//
// carMesh(type) -> bro.mesh.Mesh with colours coding the part (car.bk):
//   r = 1 body (takes the instance's paint), 0.1 glass, 0.2 tyre, 0.3 trim
//   (bumpers, sills, black plastic), 0.4 headlamp, 0.5 tail lamp, 0.6 wheel.
// CAR_TYPES: { name: { L, W, H, ... } }

export const PART = { body: 1.0, glass: 0.1, tyre: 0.2, trim: 0.3, head: 0.4, tail: 0.5, wheel: 0.6 };

// Side silhouettes as fractions of the length (x from rear 0 to front 1) and
// heights in metres: the top line's points [x, y], and where the cabin
// (glass) runs.
export const CAR_TYPES = {
    sedan: {
        L: 4.7, W: 1.82, clear: 0.16, belt: 0.95, wheelR: 0.33, wheelBase: 0.60, tumble: 0.20,
        top: [[0, 0.62], [0.03, 0.92], [0.20, 1.00], [0.30, 1.43], [0.62, 1.45], [0.76, 1.02], [0.97, 0.86], [1, 0.62]],
        cabin: [0.20, 0.76], weight: 0.34,
    },
    hatch: {
        L: 4.05, W: 1.76, clear: 0.15, belt: 0.95, wheelR: 0.31, wheelBase: 0.64, tumble: 0.18,
        top: [[0, 0.60], [0.02, 1.05], [0.07, 1.42], [0.60, 1.47], [0.76, 1.03], [0.97, 0.86], [1, 0.60]],
        cabin: [0.05, 0.76], weight: 0.26,
    },
    suv: {
        L: 4.75, W: 1.92, clear: 0.22, belt: 1.12, wheelR: 0.38, wheelBase: 0.60, tumble: 0.14,
        top: [[0, 0.72], [0.02, 1.25], [0.06, 1.72], [0.66, 1.76], [0.80, 1.20], [0.97, 1.05], [1, 0.72]],
        cabin: [0.04, 0.80], weight: 0.22,
    },
    van: {
        L: 5.3, W: 2.0, clear: 0.20, belt: 1.15, wheelR: 0.36, wheelBase: 0.62, tumble: 0.06,
        top: [[0, 0.75], [0.01, 2.05], [0.80, 2.10], [0.92, 1.40], [0.99, 1.05], [1, 0.75]],
        cabin: [0.78, 0.92], weight: 0.08,
    },
    pickup: {
        L: 5.4, W: 2.0, clear: 0.26, belt: 1.18, wheelR: 0.40, wheelBase: 0.62, tumble: 0.10,
        top: [[0, 1.10], [0.36, 1.14], [0.37, 1.86], [0.64, 1.88], [0.75, 1.30], [0.97, 1.20], [1, 0.80]],
        cabin: [0.37, 0.75], weight: 0.10,
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

export function carMesh(name) {
    const T = CAR_TYPES[name];
    const P = [], N = [], C = [], I = [];
    const vert = (p, n, part) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); C.push(part, part, part, 1); return P.length / 3 - 1; };
    // A flat-shaded quad, turned to face away from `ref` (a point inside the
    // part: the body's axis, a wheel's centre line), so no winding to track.
    let ref = [0, 0.8, 0];
    const quad = (a, b, c, d, part) => {
        const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-9) return;
        n = [n[0] / l, n[1] / l, n[2] / l];
        const m = [(a[0] + b[0] + c[0] + d[0]) / 4 - ref[0], (a[1] + b[1] + c[1] + d[1]) / 4 - ref[1], (a[2] + b[2] + c[2] + d[2]) / 4 - ref[2]];
        const flip = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0;
        if (flip) n = [-n[0], -n[1], -n[2]];
        const i0 = vert(a, n, part), i1 = vert(b, n, part), i2 = vert(c, n, part), i3 = vert(d, n, part);
        if (flip) I.push(i0, i2, i1, i0, i3, i2); else I.push(i0, i1, i2, i0, i2, i3);
    };

    const L = T.L, W = T.W, hw = W / 2;
    // Stations along the length, denser at the ends and the glass breaks.
    const xs = new Set([0, 0.015, 0.04, 0.985, 0.96, 1]);
    for (const [x] of T.top) xs.add(x);
    for (let k = 1; k < 16; k++) xs.add(k / 16);
    const st = [...xs].filter((x) => x >= 0 && x <= 1).sort((a, b) => a - b);
    const [c0, c1] = T.cabin;
    // The cross-section at x (fraction): a loop of points on the right half,
    // bottom centre to roof centre; mirrored for the left.
    const section = (f) => {
        const X = (f - 0.5) * L;
        const top = at(T.top, f);
        // Ends round in plan: pull the sides in near the bumpers.
        const endK = Math.min(1, Math.min(f, 1 - f) / 0.06);
        const side = hw * (0.86 + 0.14 * Math.sqrt(endK));
        const belt = Math.min(T.belt, top);
        const inCabin = f > c0 && f < c1 && top > belt + 0.15;
        const roofW = inCabin ? side - T.tumble * Math.min(1, (top - belt) / 0.5) : side - 0.06;
        return {
            X, inCabin, top,
            pts: [
                [X, T.clear, 0],
                [X, T.clear, side - 0.12],
                [X, T.clear + 0.12, side],
                [X, belt - 0.02, side],
                [X, belt + 0.04, side - 0.04],
                [X, top - 0.06, roofW],
                [X, top, roofW - 0.12],
                [X, top, 0],
            ],
        };
    };
    const S = st.map(section);
    const mirror = (p) => [p[0], p[1], -p[2]];
    ref = [0, (T.clear + T.belt) * 0.5, 0];
    for (let s = 0; s + 1 < S.length; s++) {
        const a = S[s], b = S[s + 1];
        const fm = (st[s] + st[s + 1]) / 2;
        const cabin = a.inCabin && b.inCabin;
        // The pillars: the cabin's glass broken at its ends and at a B pillar.
        const pillar = cabin && (Math.abs(fm - c0) < 0.03 || Math.abs(fm - c1) < 0.03 || Math.abs(fm - (c0 + c1) * 0.52) < 0.02);
        for (let k = 0; k + 1 < a.pts.length; k++) {
            let part = PART.body;
            if (k === 0) part = PART.trim;                                        // underside
            if (k === 1 || k === 2) part = (fm < 0.04 || fm > 0.96) ? PART.trim : PART.body;   // sills, bumpers
            if (k === 4 && cabin && !pillar) part = PART.glass;                   // side windows
            if (k === 6 || k === 5) {
                // Windshield and rear glass: the steep parts of the top line within the cabin.
                const slope = Math.abs(b.top - a.top) / ((st[s + 1] - st[s]) * L);
                if (a.inCabin && b.inCabin && slope > 0.6 && !pillar) part = PART.glass;
            }
            const p0 = a.pts[k], p1 = a.pts[k + 1], q0 = b.pts[k], q1 = b.pts[k + 1];
            // Right side: outward is +z / up; walk a -> b along +x.
            quad(p0, q0, q1, p1, part);
            quad(mirror(p0), mirror(p1), mirror(q1), mirror(q0), part);
        }
    }
    // End caps (rear at f = 0 faces -x, front at f = 1 faces +x), as fans.
    for (const [sec, sg] of [[S[0], -1], [S[S.length - 1], 1]]) {
        const pts = sec.pts;
        for (let k = 0; k + 1 < pts.length; k++) {
            const a = pts[k], b = pts[k + 1];
            const ca = [a[0], a[1], 0], cb = [b[0], b[1], 0];
            const part = k <= 2 ? PART.trim : PART.body;
            if (sg > 0) { quad(ca, a, b, cb, part); quad(cb, mirror(b), mirror(a), ca, part); }
            else { quad(cb, b, a, ca, part); quad(ca, mirror(a), mirror(b), cb, part); }
        }
    }
    // Lamps: thin plates just proud of the ends, at the outer corners.
    const lamp = (X, sg, part, y0, y1, z0, z1) => {
        const x = X + sg * 0.012;
        for (const m of [1, -1]) {
            const a = [x, y0, z0 * m], b = [x, y0, z1 * m], c = [x, y1, z1 * m], d = [x, y1, z0 * m];
            if ((sg > 0) === (m > 0)) quad(a, b, c, d, part); else quad(a, d, c, b, part);
        }
    };
    const frontTop = at(T.top, 1), rearTop = at(T.top, 0);
    const fy = Math.min(T.belt, frontTop) - 0.08, ry = Math.min(T.belt, rearTop) - 0.06;
    lamp(L / 2, 1, PART.head, fy - 0.14, fy, hw * 0.55, hw * 0.84);
    lamp(-L / 2, -1, PART.tail, ry - 0.16, ry, hw * 0.58, hw * 0.86);
    // A grille between the headlamps.
    lamp(L / 2, 1, PART.trim, fy - 0.22, fy - 0.02, 0.0, hw * 0.5);

    ref = [0, (T.clear + T.belt) * 0.5, 0];
    // Wheels: 12-sided tyres with a hub face, outboard of the body's sills.
    const R = T.wheelR, tw = 0.24, seg = 12;
    const axle = (T.wheelBase / 2) * L;
    for (const ax of [axle, -axle]) {
        for (const sz of [1, -1]) {
            const zo = sz * (hw - 0.02), zi = sz * (hw - 0.02 - tw);
            const ring = (z) => Array.from({ length: seg }, (_, i) => {
                const t = (i / seg) * Math.PI * 2;
                return [ax + Math.cos(t) * R, R + Math.sin(t) * R, z];
            });
            const o = ring(zo), n = ring(zi);
            ref = [ax, R, 0];
            for (let i = 0; i < seg; i++) {
                const j = (i + 1) % seg;
                if (sz > 0) quad(n[i], n[j], o[j], o[i], PART.tyre); else quad(o[i], o[j], n[j], n[i], PART.tyre);
            }
            // The hub face: a fan of quads to the centre.
            const c = [ax, R, zo];
            ref = [ax, R, 0];
            for (let i = 0; i < seg; i += 2) {
                const a = o[i], b = o[(i + 1) % seg], d = o[(i + 2) % seg];
                const part = PART.wheel;
                if (sz > 0) quad(c, d, b, a, part); else quad(c, a, b, d, part);
            }
        }
    }
    const { Mesh } = bro.mesh;
    return new Mesh({ positions: new Float32Array(P), normals: new Float32Array(N), colors: new Float32Array(C), indices: new Uint32Array(I) });
}
