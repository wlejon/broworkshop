// lib/machine/interval.js — Bounded interval arithmetic & branch-and-bound
// extremizer for certifying mechanism kinematics and load envelopes across [lo, hi].

export function iv(lo, hi = lo) {
    return lo <= hi ? [lo, hi] : [hi, lo];
}

export function ivAdd(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
}

export function ivSub(a, b) {
    return [a[0] - b[1], a[1] - b[0]];
}

export function ivMul(a, b) {
    const p1 = a[0] * b[0], p2 = a[0] * b[1], p3 = a[1] * b[0], p4 = a[1] * b[1];
    return [Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4)];
}

export function ivDiv(a, b) {
    if (b[0] <= 0 && b[1] >= 0) return [-1e12, 1e12];
    return ivMul(a, [1 / b[1], 1 / b[0]]);
}

export function ivAbs(a) {
    if (a[0] >= 0) return [a[0], a[1]];
    if (a[1] <= 0) return [-a[1], -a[0]];
    return [0, Math.max(-a[0], a[1])];
}

export function ivSqrt(a) {
    return [Math.sqrt(Math.max(0, a[0])), Math.sqrt(Math.max(0, a[1]))];
}

export function ivMin(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
}

export function ivMax(a, b) {
    return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function ivClamp(a, lo, hi) {
    return [Math.max(lo, Math.min(hi, a[0])), Math.max(lo, Math.min(hi, a[1]))];
}

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

export function ivSin(a) {
    if (a[1] - a[0] >= TWO_PI) return [-1, 1];
    const s0 = Math.sin(a[0]), s1 = Math.sin(a[1]);
    let lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const kMin = Math.ceil((a[0] + HALF_PI) / TWO_PI);
    const kMax = Math.floor((a[1] + HALF_PI) / TWO_PI);
    if (kMin <= kMax) lo = -1;
    const jMin = Math.ceil((a[0] - HALF_PI) / TWO_PI);
    const jMax = Math.floor((a[1] - HALF_PI) / TWO_PI);
    if (jMin <= jMax) hi = 1;
    return [lo, hi];
}

export function ivCos(a) {
    return ivSin([a[0] + HALF_PI, a[1] + HALF_PI]);
}

/**
 * Branch-and-bound extremizer over [lo, hi]:
 * `fn(interval)` must return `{ lo, hi }` or `[lo, hi]` conservatively enclosing `f(q)`.
 * Returns certified `{ min, max, argMin, argMax, splits }` within `tol`.
 */
export function boundOverRange(fn, lo, hi, tol = 1e-3, maxIters = 48) {
    if (!(hi > lo)) {
        const pt = fn([lo, lo]);
        const r = Array.isArray(pt) ? pt : [pt.lo, pt.hi];
        return { min: r[0], max: r[1], argMin: lo, argMax: lo, splits: 0 };
    }
    const evalBox = (a, b) => {
        const res = fn([a, b]);
        const arr = Array.isArray(res) ? res : [res.lo, res.hi];
        const mid = 0.5 * (a + b);
        const mRes = fn([mid, mid]);
        const mArr = Array.isArray(mRes) ? mRes : [mRes.lo, mRes.hi];
        return { a, b, lo: arr[0], hi: arr[1], mid, mVal: 0.5 * (mArr[0] + mArr[1]) };
    };

    const boxes = [evalBox(lo, hi)];
    let bestUpperMin = Infinity, argMin = lo;
    let bestLowerMax = -Infinity, argMax = lo;
    let splits = 0;

    const samplePoint = (box) => {
        if (box.mVal < bestUpperMin) { bestUpperMin = box.mVal; argMin = box.mid; }
        if (box.mVal > bestLowerMax) { bestLowerMax = box.mVal; argMax = box.mid; }
    };
    samplePoint(boxes[0]);

    while (splits < maxIters && boxes.length > 0) {
        let pick = -1, maxScore = -1;
        for (let i = 0; i < boxes.length; i++) {
            const bx = boxes[i];
            const width = bx.b - bx.a;
            const gapMin = bestUpperMin - bx.lo;
            const gapMax = bx.hi - bestLowerMax;
            const score = Math.max(gapMin, gapMax);
            if (width > tol && score > tol && score > maxScore) {
                maxScore = score;
                pick = i;
            }
        }
        if (pick < 0) break;
        const cur = boxes.splice(pick, 1)[0];
        const m = 0.5 * (cur.a + cur.b);
        const left = evalBox(cur.a, m);
        const right = evalBox(m, cur.b);
        samplePoint(left);
        samplePoint(right);
        boxes.push(left, right);
        splits++;
    }

    let globalMin = bestUpperMin, globalMax = bestLowerMax;
    for (const bx of boxes) {
        if (bx.lo < globalMin) globalMin = bx.lo;
        if (bx.hi > globalMax) globalMax = bx.hi;
    }
    return { min: globalMin, max: globalMax, argMin, argMax, splits };
}
