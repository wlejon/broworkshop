// Serpcoil path — a Catmull-Rom spline through control points, sampled into
// an arc-length table so an orb stores one number, its distance d along the
// path, and pointAt(d) / tangentAt(d) turn it into screen space.

function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const axis = (k) => 0.5 * (
        2 * p1[k] +
        (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    return { x: axis("x"), y: axis("y") };
}

/** controlPts: [{x, y}, ...] in screen space. */
export function createPath(controlPts, samplesPerSeg = 32) {
    // Duplicate the ends so the spline has neighbours at both ends.
    const pts = [controlPts[0], ...controlPts, controlPts[controlPts.length - 1]];
    const samples = [];
    let total = 0;
    let prev = null;
    const add = (p) => {
        if (prev) total += Math.hypot(p.x - prev.x, p.y - prev.y);
        samples.push({ x: p.x, y: p.y, d: total });
        prev = p;
    };
    for (let i = 0; i < pts.length - 3; i++) {
        for (let s = 0; s < samplesPerSeg; s++) add(catmull(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s / samplesPerSeg));
    }
    add(controlPts[controlPts.length - 1]);

    function pointAt(d) {
        if (d <= 0) return { x: samples[0].x, y: samples[0].y };
        if (d >= total) {
            const e = samples[samples.length - 1];
            return { x: e.x, y: e.y };
        }
        let lo = 0, hi = samples.length - 1;
        while (lo + 1 < hi) {
            const m = (lo + hi) >> 1;
            if (samples[m].d <= d) lo = m; else hi = m;
        }
        const a = samples[lo], b = samples[hi];
        const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    function tangentAt(d) {
        const p1 = pointAt(Math.max(0, d - 4));
        const p2 = pointAt(Math.min(total, d + 4));
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        return { x: (p2.x - p1.x) / len, y: (p2.y - p1.y) / len };
    }

    return {
        samples,
        length: () => total,
        pointAt,
        tangentAt,
    };
}
