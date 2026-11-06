// The measures of a run, from the pose the rig wrote (what is drawn), not
// from what the rig says it did. The rig's telemetry is used only to say
// when it claims a hoof is planted, so a claim the pose breaks is caught.
//
//   slip         a hoof the rig has planted moving over the ground
//   penetration  a sole point, or any joint, under the ground
//   limits       joints outside their range (and at its edge)
//   support      the centre of mass against the polygon of hooves down
//   head         how still the head is held against the withers' bob
//   footfalls    duty factor and touchdown offsets per leg over the steady
//                cycles, against the creature's reference when it has one
//
// `flags` lists what is past a threshold, in words.

import { T, TELE } from "./contract.js";
import { boneTail, bonePoint, boneHead, boneAt, jointAngles, centreOfMass } from "./skeleton.js";
import { groundHeights } from "./run.js";

export const LIMITS = {
    contact: 0.012,      // m: a sole point this close to the ground is down
    slip: 0.015,         // m: a planted hoof sliding further than this is a fault
    sink: 0.008,         // m: a sole point deeper than this is a fault
    jointSink: 0.02,     // m: a joint centre deeper than this
    limitTol: 0.5,       // degrees past a joint's range before it counts
    atLimit: 1.0,        // degrees from the range's end that count as "at" it
    spread: 0.04,        // cycles: touchdown offsets wandering more than this
};

const DEG = 180 / Math.PI;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

function circMean(xs) {
    let s = 0, c = 0;
    for (const x of xs) { s += Math.sin(2 * Math.PI * x); c += Math.cos(2 * Math.PI * x); }
    let m = Math.atan2(s, c) / (2 * Math.PI);
    if (m < 0) m += 1;
    const R = Math.hypot(s, c) / Math.max(1, xs.length);
    return { mean: m, spread: Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-9)))) / (2 * Math.PI) };
}
const circDiff = (a, b) => { let d = (b - a) % 1; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return d; };

const SOLE_NAMES = ['toe', 'heel'];
// Sole points of a foot in its bone's rest frame: the toe, and a heel under the fetlock.
function solePoints(bone) {
    return [bone.tail, [bone.head[0], bone.tail[1] + 0.006, bone.head[2] + 0.35 * (bone.tail[2] - bone.head[2])]];
}

// Signed distance from p to a convex polygon (positive inside); for one or
// two points, minus the distance to the point or segment.
function supportMargin(p, pts) {
    if (pts.length === 0) return null;
    if (pts.length === 1) return -Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    const hull = convexHull(pts);
    if (hull.length < 3) {
        const [a, b] = [hull[0], hull[hull.length - 1]];
        const ab = [b[0] - a[0], b[1] - a[1]], L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1e-9;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2));
        return -Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
    }
    let inside = true, best = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1e-9;
        const cr = (ex * (p[1] - a[1]) - ez * (p[0] - a[0])) / L;   // > 0: left of edge (inside for CCW)
        if (cr < 0) inside = false;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (L * L)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t));
    }
    return inside ? best : -best;
}

function convexHull(pts) {
    const P = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    hi.pop(); lo.pop();
    return lo.concat(hi);
}

// Per-step series every sheet and measure reads: sole points, their ground,
// contact, joint angles, the centre of mass, tracked points.
export function series(rec) {
    if (rec._series) return rec._series;
    const skel = rec.creature.skel, n = rec.steps, nf = skel.feet.length;
    const soles = skel.feet.map((f) => solePoints(skel.bones[f.boneIndex]));
    const ns = soles[0].length;
    const sole = new Float32Array(n * nf * ns * 3);
    const xz = new Float32Array(n * (nf * ns + skel.count) * 2);
    let q = 0;
    for (let k = 0; k < n; k++) {
        const o = k * rec.poseStride;
        skel.feet.forEach((f, i) => soles[i].forEach((pt, j) => {
            const p = bonePoint(rec.pose, o, f.boneIndex, skel.bones[f.boneIndex].head, pt);
            sole.set(p, ((k * nf + i) * ns + j) * 3);
            xz[q++] = p[0]; xz[q++] = p[2];
        }));
        for (let b = 0; b < skel.count; b++) { const p = boneHead(rec.pose, o, b); xz[q++] = p[0]; xz[q++] = p[2]; }
    }
    const gh = groundHeights(rec.env, xz);
    const per = nf * ns + skel.count;
    const soleH = new Float32Array(n * nf * ns), jointH = new Float32Array(n * skel.count);
    const contact = new Uint8Array(n * nf);
    for (let k = 0; k < n; k++) {
        for (let i = 0; i < nf; i++) {
            let down = false;
            for (let j = 0; j < ns; j++) {
                const s = (k * nf + i) * ns + j;
                soleH[s] = sole[s * 3 + 1] - gh[k * per + i * ns + j];
                if (j === 0 && soleH[s] < LIMITS.contact) down = true;
            }
            contact[k * nf + i] = down ? 1 : 0;
        }
        for (let b = 0; b < skel.count; b++) {
            const o = k * rec.poseStride;
            jointH[k * skel.count + b] = rec.pose[o + b * 12 + 7] - gh[k * per + nf * ns + b];
        }
    }
    const angles = [], com = [], tracks = [];
    for (let k = 0; k < n; k++) {
        const o = k * rec.poseStride;
        angles.push(jointAngles(rec.pose, o, skel));
        com.push(centreOfMass(rec.pose, o, skel));
        tracks.push(skel.tracks.map((t) => boneAt(rec.pose, o, skel.bones[t.boneIndex], t.at)));
    }
    rec._series = { sole, soleH, ns, nf, contact, jointH, angles, com, tracks };
    return rec._series;
}

const claimed = (rec, k, i) => rec.tele[k * TELE + T.FOOT + 4 * i] > 0.5;

// (No timings in the report: it is bit-identical across reruns.)
export function analyze(rec, opts = {}) {
    const skel = rec.creature.skel, n = rec.steps, nf = skel.feet.length;
    const S = series(rec);
    const flags = [];
    const steadyFrom = Math.round((opts.steadyFrom ?? rec.scenario.duration * 0.4) / rec.dt);

    // --- slip: stances the rig claims, and how far the toe moves in them ---
    const feet = {};
    skel.feet.forEach((f, i) => {
        const stances = [];
        let start = -1;
        for (let k = 0; k <= n; k++) {
            const on = k < n && claimed(rec, k, i);
            if (on && start < 0) start = k;
            if (!on && start >= 0) {
                if (k - start >= 3) {
                    const p0 = S.sole.subarray(((start * nf + i) * S.ns) * 3, ((start * nf + i) * S.ns) * 3 + 3);
                    let slide = 0, path = 0, miss = 0, prev = p0;
                    for (let m = start + 1; m < k; m++) {
                        const p = S.sole.subarray(((m * nf + i) * S.ns) * 3, ((m * nf + i) * S.ns) * 3 + 3);
                        slide = Math.max(slide, Math.hypot(p[0] - p0[0], p[2] - p0[2]));
                        path += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
                        const o = m * TELE + T.FOOT + 4 * i;
                        miss = Math.max(miss, Math.hypot(p[0] - rec.tele[o + 1], p[1] - rec.tele[o + 2], p[2] - rec.tele[o + 3]));
                        prev = p;
                    }
                    stances.push({ from: start, to: k, slide, path, miss });
                }
                start = -1;
            }
        }
        let maxSink = 0, sinkSteps = 0, minSole = Infinity, sinkAt = 0, sinkPt = 0;
        for (let k = 0; k < n; k++) {
            let deep = false;
            for (let j = 0; j < S.ns; j++) {
                const h = S.soleH[(k * nf + i) * S.ns + j];
                minSole = Math.min(minSole, h);
                if (-h > maxSink) { maxSink = -h; sinkAt = k; sinkPt = j; }
                if (-h > LIMITS.sink) deep = true;
            }
            if (deep) sinkSteps++;
        }
        const worst = stances.reduce((a, s) => (s.slide > (a ? a.slide : -1) ? s : a), null);
        const slips = stances.filter((s) => s.slide > LIMITS.slip);
        feet[f.name] = {
            stances: stances.length,
            slipMax: r3(worst ? worst.slide : 0),
            slipMaxAt: worst ? r3(worst.from * rec.dt) : null,
            slipMean: r3(stances.reduce((s, x) => s + x.slide, 0) / Math.max(1, stances.length)),
            slipping: slips.length,
            ikMissMax: r3(stances.reduce((s, x) => Math.max(s, x.miss), 0)),
            sinkMax: r3(maxSink),
            sinkShare: r3(sinkSteps / n),
            lowestSole: r3(minSole),
        };
        if (slips.length) flags.push(`slip: ${f.name} slid ${(worst.slide * 100).toFixed(1)} cm in a stance at ${(worst.from * rec.dt).toFixed(2)} s (${slips.length} of ${stances.length} stances over ${LIMITS.slip * 100} cm)`);
        feet[f.name].sinkAt = r3(sinkAt * rec.dt);
        feet[f.name].sinkPoint = SOLE_NAMES[sinkPt];
        if (maxSink > LIMITS.sink) flags.push(`penetration: ${f.name} ${SOLE_NAMES[sinkPt]} ${(maxSink * 100).toFixed(1)} cm under the ground at ${(sinkAt * rec.dt).toFixed(2)} s (${(100 * sinkSteps / n).toFixed(1)}% of the run)`);
    });

    // Joints under the ground.
    let jointSink = { depth: 0, bone: null, t: 0 };
    for (let k = 0; k < n; k++) for (let b = 0; b < skel.count; b++) {
        const d = -S.jointH[k * skel.count + b];
        if (d > jointSink.depth) jointSink = { depth: d, bone: skel.bones[b].name, t: k * rec.dt };
    }
    if (jointSink.depth > LIMITS.jointSink) flags.push(`penetration: joint ${jointSink.bone} ${(jointSink.depth * 100).toFixed(1)} cm under the ground at ${jointSink.t.toFixed(2)} s`);

    // --- joint limits -------------------------------------------------------
    const joints = {};
    for (const b of skel.bones) {
        if (b.parentIndex < 0) continue;
        const ax = ['x', 'y', 'z'].map((name, a) => {
            const [lo, hi] = b.lim[a];
            let mn = Infinity, mx = -Infinity, over = 0, at = 0, excess = 0, firstOver = null;
            for (let k = 0; k < n; k++) {
                const v = S.angles[k][b.index][a];
                mn = Math.min(mn, v); mx = Math.max(mx, v);
                const ex = Math.max(lo - v, v - hi) * DEG;
                if (ex > LIMITS.limitTol) { over++; excess = Math.max(excess, ex); if (firstOver == null) firstOver = k * rec.dt; }
                else if (ex > -LIMITS.atLimit) at++;
            }
            return { name, min: r1(mn * DEG), max: r1(mx * DEG), lo: r1(lo * DEG), hi: r1(hi * DEG), over, at, excess: r1(excess), firstOver };
        });
        joints[b.name] = Object.fromEntries(ax.map((a) => [a.name, a]));
        for (const a of ax) {
            if (a.over) flags.push(`limit: ${b.name}.${a.name} past its range by ${a.excess.toFixed(1)} deg for ${(100 * a.over / n).toFixed(0)}% of the run (first at ${a.firstOver.toFixed(2)} s; range ${a.lo}..${a.hi})`);
        }
    }

    // --- support ---------------------------------------------------------------
    let supported = 0, outside = 0, minMargin = Infinity, airborne = 0;
    const margin = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const down = [];
        for (let i = 0; i < nf; i++) if (S.contact[k * nf + i]) {
            const p = S.sole.subarray(((k * nf + i) * S.ns) * 3);
            down.push([p[0], p[2]]);
        }
        const c = S.com[k];
        const m = supportMargin([c[0], c[2]], down);
        margin[k] = m == null ? NaN : m;
        if (!down.length) { airborne++; continue; }
        if (down.length >= 3) {
            supported++;
            if (m < 0) outside++;
            minMargin = Math.min(minMargin, m);
        }
    }
    const still = rec.tele[(n - 1) * TELE + T.SPEED] < 0.05 && rec.tele[T.SPEED] < 0.05 && rec.scenario.track.every((key) => !key.speed);
    const support = {
        stepsOnThree: supported, outsideShare: r3(outside / Math.max(1, supported)),
        minMargin: r3(Number.isFinite(minMargin) ? minMargin : 0), airborneShare: r3(airborne / n),
    };
    if (still && outside > 0.02 * Math.max(1, supported)) flags.push(`support: standing, the centre of mass is outside the hooves ${(100 * outside / supported).toFixed(0)}% of the time (worst ${(minMargin * 100).toFixed(1)} cm)`);

    // --- head ----------------------------------------------------------------
    const ti = (name) => skel.tracks.findIndex((t) => t.name === name);
    const hi = ti('head'), wi = ti('withers');
    let head = null;
    if (hi >= 0) {
        const bobOf = (idx) => {
            const ys = [];
            for (let k = steadyFrom; k < n; k++) ys.push(S.tracks[k][idx][1]);
            if (!ys.length) return 0;
            const w = Math.max(1, Math.round(0.5 / rec.dt));
            let sq = 0;
            for (let i = 0; i < ys.length; i++) {
                let s = 0, c = 0;
                for (let j = Math.max(0, i - w); j < Math.min(ys.length, i + w + 1); j++) { s += ys[j]; c++; }
                sq += (ys[i] - s / c) ** 2;
            }
            return Math.sqrt(sq / ys.length);
        };
        const hb = skel.bones[skel.tracks[hi].boneIndex];
        let rot = 0, cnt = 0;
        for (let k = Math.max(steadyFrom, 1); k < n; k++) {
            const a = S.angles[k], b = S.angles[k - 1];
            // World turn rate of the head from its rotation rows.
            const o1 = k * rec.poseStride + hb.index * 12, o0 = (k - 1) * rec.poseStride + hb.index * 12;
            const P = rec.pose;
            let tr = 0;
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += P[o1 + r * 4 + c] * P[o0 + r * 4 + c];
            rot += (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) / rec.dt) ** 2;
            cnt++;
            void a; void b;
        }
        const headBob = bobOf(hi), withersBob = wi >= 0 ? bobOf(wi) : 0;
        head = { bobRms: r3(headBob), withersBobRms: r3(withersBob), ratio: r3(withersBob > 1e-4 ? headBob / withersBob : 0),
                 turnRms: r1(Math.sqrt(rot / Math.max(1, cnt)) * DEG) };
    }

    // --- footfalls -------------------------------------------------------------
    // A steady gait's footfalls are held to its pattern (and to the reference);
    // a run that changes what it does only reports them.
    const footfalls = footfallStats(rec, S, steadyFrom, opts.reference, !!opts.steady);
    for (const f of footfalls.flags) flags.push(f);

    // --- the run as a whole -----------------------------------------------------
    let dist = 0;
    for (let k = 1; k < n; k++) dist += Math.hypot(rec.tele[k * TELE] - rec.tele[(k - 1) * TELE], rec.tele[k * TELE + 2] - rec.tele[(k - 1) * TELE + 2]);
    const hs = [], ps = [];
    for (let k = steadyFrom; k < n; k++) { hs.push(rec.tele[k * TELE + T.HEIGHT]); ps.push(rec.tele[k * TELE + T.PITCH] * DEG); }
    const rng = (a) => (a.length ? [r3(Math.min(...a)), r3(Math.max(...a))] : [0, 0]);
    return {
        creature: rec.creature.label, scenario: rec.scenario.name, steps: n, dt: rec.dt, duration: r3(n * rec.dt),
        distance: r3(dist), meanSpeed: r3(dist / (n * rec.dt)),
        body: { heightRange: rng(hs), pitchRangeDeg: rng(ps) },
        feet, jointSink: { depth: r3(jointSink.depth), bone: jointSink.bone, t: r3(jointSink.t) },
        joints, support, head, footfalls, flags, thresholds: LIMITS,
    };
}

// Duty factor and touchdown offsets per leg over every steady cycle (by
// measured contact), with the creature's reference when given.
// Touchdowns by measured contact (a run of 3 steps down, so a grazing swing
// doesn't count), per foot.
export function contactTouchdowns(rec) {
    const S = series(rec), nf = rec.creature.skel.feet.length, n = rec.steps;
    const down = (k, i) => S.contact[k * nf + i] === 1;
    return rec.creature.skel.feet.map((_, i) => {
        const t = [];
        for (let k = 1; k + 2 < n; k++) if (!down(k - 1, i) && down(k, i) && down(k + 1, i) && down(k + 2, i)) t.push(k);
        return t;
    });
}

// The run's steady cycles: first-foot touchdown to the next, by measured
// contact, from `fromT` s (default 40% into the run).
export function steadyCycles(rec, fromT) {
    const from = Math.round((fromT ?? rec.scenario.duration * 0.4) / rec.dt);
    const t0 = contactTouchdowns(rec)[0].filter((k) => k >= from);
    const cyc = [];
    for (let i = 0; i + 1 < t0.length; i++) cyc.push({ a: t0[i], b: t0[i + 1], period: (t0[i + 1] - t0[i]) * rec.dt });
    return cyc;
}

export function footfallStats(rec, S, steadyFrom, reference, steady = true) {
    const skel = rec.creature.skel, nf = skel.feet.length;
    const down = (k, i) => S.contact[k * nf + i] === 1;
    const tds = contactTouchdowns(rec);
    const cyc = steadyCycles(rec, steadyFrom * rec.dt);
    const perLeg = {};
    const flags = [];
    if (!cyc.length) return { cycles: 0, legs: perLeg, flags };
    skel.feet.forEach((f, i) => {
        const duties = [], offs = [];
        for (const c of cyc) {
            let on = 0;
            for (let k = c.a; k < c.b; k++) if (down(k, i)) on++;
            duties.push(on / (c.b - c.a));
            const td = tds[i].find((k) => k >= c.a && k < c.b);
            if (td != null) offs.push((td - c.a) / (c.b - c.a));
        }
        const cm = circMean(offs);
        const duty = duties.reduce((s, x) => s + x, 0) / duties.length;
        const dutySpread = Math.sqrt(duties.reduce((s, x) => s + (x - duty) ** 2, 0) / duties.length);
        perLeg[f.name] = { duty: r3(duty), dutySpread: r3(dutySpread), offset: r3(cm.mean), offsetSpread: r3(cm.spread), touchdowns: offs.length };
        if (steady && cm.spread > LIMITS.spread) flags.push(`footfall: ${f.name}'s touchdown wanders ${(cm.spread * 100).toFixed(1)}% of the stride between cycles`);
        if (reference) {
            const tol = reference.tolerance || { duty: 0.06, offset: 0.05 };
            const rd = reference.duty, ro = reference.offsets && reference.offsets[f.name];
            const dd = rd != null ? duty - rd : null, od = ro != null ? circDiff(ro, cm.mean) : null;
            perLeg[f.name].reference = { duty: rd, offset: ro, dutyDelta: dd != null ? r3(dd) : null, offsetDelta: od != null ? r3(od) : null };
            if (dd != null && Math.abs(dd) > tol.duty) flags.push(`footfall: ${f.name} duty ${duty.toFixed(2)} against ${rd} (tolerance ${tol.duty})`);
            if (od != null && Math.abs(od) > tol.offset) flags.push(`footfall: ${f.name} touches down at ${cm.mean.toFixed(2)} of the stride against ${ro} (tolerance ${tol.offset})`);
        }
    });
    const period = cyc.reduce((s, c) => s + c.period, 0) / cyc.length;
    let dist = 0;
    for (const c of cyc) dist += Math.hypot(rec.tele[c.b * TELE] - rec.tele[c.a * TELE], rec.tele[c.b * TELE + 2] - rec.tele[c.a * TELE + 2]);
    return { cycles: cyc.length, period: r3(period), frequency: r3(1 / period), strideLength: r3(dist / cyc.length), legs: perLeg, flags };
}
