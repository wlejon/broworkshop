// lib/foundry/gait.js — how a machine on feet walks.
//
// A walker's gait is its onboard controller, as the mixing of throttle and steer is a
// machine on wheels': asked to go forward (or back) and turn, it moves its legs to do it,
// through its joints' drives and nothing else. It walks a creep: it stands on three feet
// while it steps the fourth, its body first shifted over the triangle of the three so it
// cannot tip, each foot set down where the ground is.
//
//   gaitOf(site, m)     the gait of walker m: walk(u, v) sets where it is asked to go
//                       (u forward, −1 back; v turning to the right, −1 left), tick(dt)
//                       moves its joints a step. Asked nothing, it leaves its joints be.
//
// It drives its joints at rates, not to angles: each tick it decides how its body moves
// (toward where the step wants it), and every leg on the ground turns its joints at just
// the rates that keep its sole where it is in the world as the body makes that move (the
// leg's Jacobian, from the contract's kinematics); the stepping leg's at the rates that
// carry its sole toward where it goes. All four ask the body for the one same motion, so
// none of them fights the others; the rates are scaled down together to what the slowest
// drive turns, and to how well the planted legs' drives kept up the tick before (one slowed
// under its load holds the others back with it).
//
// A foot is set down only on ground level across its pad, never on the lip of a step, and
// clear of the other legs; a leg turned past what it is planned to turn holds the body and
// steps next. kneel(on) lets the body down onto its legs to be loaded, and stands it up again.

import { qMul, qRot, qAxis, qConj, add, sub, dot, scale, unit, frameApply, frameInv, footAt, legTo, legHolds, poseOf, stanceOf, solidsOf, cornersOf } from "./operate.js";

const LIFT = 0.16;      // m a stepping foot clears the ground by
const STRIDE = 0.7;     // m a foot steps at most, along the way it goes
const TURN = 0.45;      // rad a cycle of four steps turns the body at most
const MARGIN = 0.15;    // m the middle of its mass is kept inside the triangle it stands on
const BODY_V = 0.35;    // m/s the body moves at most
const BODY_W = 0.1;     // rad/s it turns at most
const FOOT_V = 0.8;     // m/s a stepping foot moves at most
const TORQUE = 1;       // of its drives' stall a planted leg is planned to push at most (past it a worm-driven joint stops and holds, it does not give)
const SWING = 0.9;      // rad a leg's yaw is planned to swing round at most from how it stands
const KNEEL = 0.6;      // m it lets its body down by, kneeling to be loaded
const SPAN = 1.1;      // rad a leg's hip or knee is planned to turn at most from how it stands
const REACH = 2.2;     // rad a joint is planned to turn at most either way: short of where its drive eases off at its stop
const ORDER = [2, 0, 3, 1];     // which leg steps next: hind left, front left, hind right, front right

export function gaitOf(site, m) {
    const c = m.contract, legs = c.walker.legs;
    const ctOf = new Map(m.controls.filter((ct) => ct.joints && ct.joints.length === 1).map((ct) => [ct.joints[0], ct]));
    // Where each sole stands under the body as it was stood up (design frame), and how high.
    const home = legs.map((leg) => footAt(c, leg, m.angles)), home0 = Float64Array.from(m.angles);
    const base = frameApply(frameInv(m.place), [m.mid[0], m.place.t[1], m.mid[1]]);
    const fwd = c.walker.bed.axes[0];
    const q0 = m.place.q.slice(), yaw0 = (() => { const f = qRot(q0, fwd); return Math.atan2(-f[2], f[0]); })();
    const standY = frameApply(m.place, base)[1] - Math.min(...home.map((p) => frameApply(m.place, p)[1]));
    let u = 0, v = 0, phase = null, k = 0, low = 0, last = -1, pinned = null, keep = 1;
    const sent = new Map();   // each joint's rate as sent last tick
    // How high its body stands over the feet under it now, and how high it stands up.
    const heightNow = () => midOf(m.place)[1];
    const heightOver = () => legs.reduce((s, _, x) => s + soleOf(x)[1], 0) / legs.length + standY;
    let target = null;      // where the body is to be: { mid [x, y, z], yaw }
    // The way it goes: where its body would be with no sway over the feet it stands on. Steps
    // are planned from it, so the sway of one step never carries into where the next foot goes.
    let path = null;
    const groundAt = (p) => site.groundAt(p[0], p[2]);
    // What it carries: the crates standing on it.
    const loadKg = () => site.crates.reduce((s, cr) => { const P = site.poseOf(cr); return site.under(P[0], P[2], P[1], cr).machine === m ? s + cr.kg : s; }, 0);
    const xz = (p) => [p[0], p[2]];
    const yawOf = (F) => { const f = qRot(F.q, fwd); return Math.atan2(-f[2], f[0]); };
    const midOf = (F) => frameApply(F, base);
    // Frame F moved so its middle goes by `d` (world) and turned by `a` about up there.
    function moved(F, d, a) {
        const mid = midOf(F), q = qMul(qAxis([0, 1, 0], a), F.q);
        return { q, t: sub(add(mid, d), qRot(q, base)) };
    }
    // The body level, its middle at `mid`, facing `yaw`.
    function frameAt(mid, yaw) {
        const q = qMul(qAxis([0, 1, 0], yaw - yaw0), q0);
        return { q, t: sub(mid, qRot(q, base)) };
    }
    // How far P is inside the triangle (negative: outside).
    function inside(P, tri) {
        let d = Infinity;
        for (let e = 0; e < 3; e++) {
            const A = tri[e], B = tri[(e + 1) % 3], C = tri[(e + 2) % 3];
            const n = [-(B[1] - A[1]), B[0] - A[0]], l = Math.hypot(...n) || 1, s = Math.sign((C[0] - A[0]) * n[0] + (C[1] - A[1]) * n[1]) || 1;
            d = Math.min(d, (s * ((P[0] - A[0]) * n[0] + (P[1] - A[1]) * n[1])) / l);
        }
        return d;
    }
    const soleOf = (i) => frameApply(m.place, footAt(c, legs[i], m.angles));
    const solids = solidsOf(c);
    // How high the lowest corner of a foot stands over the ground under it (a sole tilts as its
    // leg stretches, so its middle reads high when its edge stands on the ground); a few
    // centimetres over it, the foot is off the ground.
    const padsOf = legs.map((leg) => { const j = leg.joints[leg.joints.length - 1]; return solids.filter((b) => b.carrier === j); });
    const overOf = (x) => {
        const M = poseOf(c, m.angles), j = legs[x].joints[legs[x].joints.length - 1];
        let lo = Infinity;
        for (const b of padsOf[x]) for (const p0 of cornersOf(b)) { const p = frameApply(m.place, frameApply(M[j], p0)); lo = Math.min(lo, p[1] - groundAt(p)); }
        return lo === Infinity ? soleOf(x)[1] - groundAt(soleOf(x)) : lo;
    };
    const hangs = (x) => overOf(x) > 0.06;
    // How far apart leg x's solids stand from every other leg's with its joints at `ang` (below
    // zero: they overlap), as far as a separating axis between two boxes shows it: a step that
    // brings one leg's thigh down onto its neighbour's is a foot that never reaches the ground.
    const legOfJ = new Map();
    legs.forEach((leg, x) => leg.joints.forEach((j) => legOfJ.set(j, x)));
    const legSolids = legs.map((_, x) => solids.filter((b) => legOfJ.get(b.carrier) === x));
    const boxesOf = (x, M) => legSolids[x].map((b) => ({ c: frameApply(M[b.carrier], b.center), axes: b.axes.map((a) => qRot(M[b.carrier].q, a)) }));
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const apart = (A, B) => {
        const d = sub(B.c, A.c), ns = [...A.axes, ...B.axes];
        for (const a of A.axes) for (const b of B.axes) ns.push(cross(a, b));
        let most = -Infinity;
        for (const n of ns) {
            const l = Math.hypot(...n);
            if (l < 1e-9) continue;
            const u = scale(n, 1 / l), r = A.axes.reduce((s, a) => s + Math.abs(dot(a, u)), 0) + B.axes.reduce((s, b) => s + Math.abs(dot(b, u)), 0);
            most = Math.max(most, Math.abs(dot(d, u)) - r);
        }
        return most;
    };
    const clearance = (x, ang) => {
        const M = poseOf(c, ang), A = boxesOf(x, M);
        let lo = Infinity;
        legs.forEach((_, y) => { if (y !== x) for (const B of boxesOf(y, M)) for (const a of A) lo = Math.min(lo, apart(a, B)); });
        return lo;
    };
    const CLEAR = 0.04;
    // How far joint j works either way from how it stands.
    const spanOf = (j) => (c.joints[j].upright ? SWING : SPAN);
    // The middle of its mass, its joints at `ang` and its frame at F: its legs are most of
    // it, so it moves less than the body does (the planted legs' mass stays where they stand).
    const comOf = (ang, F) => {
        const M = poseOf(c, ang);
        let s = [0, 0, 0], w = 0;
        for (const b of solids) { const p = b.carrier != null && b.carrier >= 0 ? frameApply(M[b.carrier], b.center) : b.center; s = add(s, scale(p, b.m)); w += b.m; }
        return frameApply(F, scale(s, 1 / w));
    };
    // The joint steps that move leg i's sole by `dp` (design frame): its Jacobian, damped.
    function legStep(i, dp) {
        const leg = legs[i], js = leg.joints, a = Float64Array.from(m.angles), p = footAt(c, leg, a), h = 1e-4;
        const J = js.map((j) => { const b = Float64Array.from(a); b[j] += h; return scale(sub(footAt(c, leg, b), p), 1 / h); });
        // Solve (JᵀJ + λI) x = Jᵀ dp.
        const A = J.map((r) => J.map((s) => dot(r, s))), rhs = J.map((r) => dot(r, dp));
        for (let r = 0; r < 3; r++) A[r][r] += 1e-4;
        return solve3(A, rhs);
    }

    const g = {
        /** Ask it to go: `u` forward (−1 back), `v` turning to the right (−1 left). */
        walk(a, b) { u = Math.max(-1, Math.min(1, a)); v = Math.max(-1, Math.min(1, b)); },
        get doing() { return phase ? phase.kind : low ? 'kneeling' : 'standing'; },
        /** Kneel (its deck let down KNEEL m, to be loaded from a crane that lifts no higher), or stand up again. */
        kneel(on) { low = on ? KNEEL : 0; },
        /** Whether it is asked to kneel. */
        get kneeling() { return low > 0; },
        /** Whether it stands at the height asked (kneeling or up), its body still. */
        get settled() { return !phase && Math.abs(heightNow() - (heightOver() - low)) < 0.04; },
        /** The step under way: { kind, leg, to [x, y, z] where the foot goes, found (a level place it
         *  reaches, else where its leg stands at home), need (how far inside the three the middle of its
         *  mass must stand to lift) }, or null. */
        get step() { return phase && phase.kind !== 'settle' ? { kind: phase.kind, leg: phase.leg, to: phase.to, found: phase.found, need: phase.need } : null; },
        /** Where it is moving its body: { mid [x, y, z], yaw }, or null before it has been asked to go. */
        get target() { return target; },
        /** Which leg is in the air (or null). */
        get stepping() { return phase && phase.kind !== 'shift' && phase.kind !== 'settle' ? phase.leg : null; },
        tick(dt) {
            if (!phase) {
                // Asked nothing, it leaves its joints to hold (or to the levers).
                if (u === 0 && v === 0) {
                    // Asked to kneel or stand up: its body let down (or raised) where it is, on all four.
                    const want = heightOver() - low;
                    if (Math.abs(heightNow() - want) > 0.04) {
                        const mid = midOf(m.place); mid[1] = want;
                        target = { mid, yaw: yawOf(m.place) };
                        phase = { kind: 'settle', leg: -1, t: 0, best: Infinity, since: 0, tri: null };
                    } else {
                        // Let go between steps: its joints stop where they are, and hold.
                        if (path) for (const ct of ctOf.values()) ct.u = 0;
                        path = null; return;
                    }
                }
            }
            if (!phase) {
                // The next step, from where it stands now: the leg, where the body goes first
                // (on along the way, and over the other three), and where the foot goes.
                const F = m.place;
                // Taken up again (or lost: the body far off it) from the middle of its four feet,
                // not where the body sways to over three of them.
                if (!path || Math.hypot(...sub(midOf(path), midOf(F))) > 1.2) {
                    const q = qMul(qAxis([0, 1, 0], yawOf(F) - yaw0), q0), ft = legs.map((_, x) => soleOf(x));
                    // (where its middle stands from its feet' middle as it was stood up)
                    const hc = scale(home.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / home.length), o = qRot(q, sub(base, hc));
                    const at = [ft.reduce((s, p) => s + p[0], 0) / 4 + o[0], midOf(F)[1], ft.reduce((s, p) => s + p[2], 0) / 4 + o[2]];
                    path = { q, t: sub(at, qRot(q, base)) };
                }
                const feet = legs.map((_, x) => soleOf(x));
                // The way turns no further ahead of the feet than a step turns them: the heading the
                // four stand at (as they stood at home, turned whichever way fits them better).
                {
                    const fit = (yaw) => { const G = frameAt(midOf(path), yaw), c0 = scale(feet.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / 4), h = home.map((p) => frameApply(G, p)), c1 = scale(h.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / 4); return feet.reduce((s, p, x) => { const a = sub(p, c0), b = sub(h[x], c1); return s + (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2; }, 0); };
                    let fy = yawOf(path), best = fit(fy);
                    for (let a = -1.2; a <= 1.2001; a += 0.05) { const e = fit(yawOf(path) + a); if (e < best) { best = e; fy = yawOf(path) + a; } }
                    let d = yawOf(path) - fy; d = Math.atan2(Math.sin(d), Math.cos(d));
                    if (Math.abs(d) > 0.3) path = frameAt(midOf(path), fy + Math.sign(d) * 0.3);
                }
                const f = qRot(path.q, fwd), dir = unit([f[0], 0, f[2]]);
                // How hard leg x works holding its foot where it is with the body at G: the most
                // of its joints' turn over what they are planned to turn, and of its share of
                // the weight it bears over what its drives push there (over 1: past it;
                // Infinity: it does not reach). `share`: the fraction of the weight on it.
                const weight = (c.massKg + loadKg()) * 9.81, why = [];
                // Where leg x's joints stand to hold its foot where it is with the body at G.
                const poseAt = (x, G) => legTo(c, legs[x], frameApply(frameInv(G), feet[x]), m.angles, { iters: 20, range: REACH + 0.4 });
                const strain = (x, G, share = 1 / 3, r = poseAt(x, G)) => {
                    if (!(r.err < 0.02)) return Infinity;
                    const turn = Math.max(...legs[x].joints.map((j) => Math.abs(r.ang[j] - home0[j]) / spanOf(j)));
                    const load = (share * weight) / (TORQUE * legHolds(c, r.ang, { stall: true })[x]);
                    why[x] = { turn, load };
                    return Math.max(turn, load);
                };
                // On three feet, each bears the weight as the middle of its mass (P) stands
                // between them: the nearer it, the more.
                const shares = (P, tri) => {
                    const [A, B, C] = tri;
                    const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
                    const l0 = ((B[1] - C[1]) * (P[0] - C[0]) + (C[0] - B[0]) * (P[1] - C[1])) / det;
                    const l1 = ((C[1] - A[1]) * (P[0] - C[0]) + (A[0] - C[0]) * (P[1] - C[1])) / det;
                    return [l0, l1, 1 - l0 - l1].map((l) => Math.max(0.02, l));
                };
                // Which leg steps: the one turned furthest from how it stands where the body goes
                // next (how much weight it bears a step does not change), the creep's turn breaking
                // a tie, the leg just stepped last; one whose three others hold the body there, over them.
                // Failing that, the step is made shorter; failing all, the least strained.
                // A foot off the ground (the body tilted off it) steps next, whatever else: a step planned
                // on three feet when one of them bears nothing is a step on two.
                const pref = ORDER[k % 4], hung = [0, 1, 2, 3].filter(hangs).sort((a, b) => overOf(b) - overOf(a))[0] ?? pinned;
                pinned = null;
                let plan = null, alt = null;
                for (const sc of [1, 0.5, 0.25]) {
                    const next = moved(path, scale(dir, (u * STRIDE * sc) / 4), (-v * TURN * sc) / 4);
                    const order = hung != null ? [{ x: hung }] : [0, 1, 2, 3].map((x) => ({ x, s: (strain(x, next) === Infinity ? Infinity : why[x].turn) + (x === pref ? 0.25 : 0) - (x === last ? 0.3 : 0) })).sort((a, b) => b.s - a.s);                    for (const { x: i } of order) {
                        const others = [0, 1, 2, 3].filter((x) => x !== i), tri = others.map((x) => xz(feet[x]));
                        const cen = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
                        // Where over them: from where the way takes it toward their middle (and on
                        // past it: the middle of its mass follows the body only part of the way),
                        // the first place where that stands well inside them and none of the three
                        // works past what it holds.
                        const y = others.reduce((s, x) => s + feet[x][1], 0) / 3 + standY - low;
                        const m0 = midOf(next);
                        for (let s = 0; s <= 1.801; s += 0.2) {
                            // As high over the ground its three feet stand on as it was stood up.
                            const mid = [m0[0] + (cen[0] - m0[0]) * s, y, m0[2] + (cen[1] - m0[2]) * s];
                            const G = frameAt(mid, yawOf(next));
                            const rs = others.map((x) => poseAt(x, G));
                            if (rs.some((r) => !(r.err < 0.02))) continue;
                            const ang = Float64Array.from(m.angles);
                            others.forEach((x, n) => { for (const j of legs[x].joints) ang[j] = rs[n].ang[j]; });
                            const com = xz(comOf(ang, G)), inn = inside(com, tri);
                            const sh = shares(com, tri);
                            const worst = Math.max(...others.map((x, n) => strain(x, G, sh[n], rs[n])));
                            // Short of the margin: kept in case no step makes it, if inside at all.
                            if (inn < MARGIN) {
                                if (inn > 0.03 && (!alt || inn > alt.inn)) alt = { i, tri, cen, mid, G, others, next, worst, sc, inn, why: others.map((x) => ({ x, ...why[x] })) };
                                continue;
                            }
                            if (!plan || worst < plan.worst) plan = { i, tri, cen, mid, G, others, next, worst, sc, why: others.map((x) => ({ x, ...why[x] })) };
                            if (worst <= 1) break;
                        }
                        if (plan && plan.worst <= 1) break;
                    }
                    if (plan && plan.worst <= 1) break;
                }
                if (!plan) plan = alt;
                if (!plan) { path = null; return; }
                const { i, tri, cen, mid, G, others, next, sc } = plan;
                const far = moved(next, scale(dir, (u * STRIDE * sc) / 2), (-v * TURN * sc) / 2);
                path = next;
                // Its new place: home under where the body will be, drawn back toward where it
                // is until the leg reaches it, from the body as it is after the shift, raised
                // over it, and set down.
                // It must stand clear of the other legs where it lands, with the body over the three
                // and with it on where the way goes (the others turn about their feet as it goes).
                const angAt = (H) => { const a = Float64Array.from(m.angles); for (const x of others) { const r = poseAt(x, H); if (r.err < 0.02) for (const j of legs[x].joints) a[j] = r.ang[j]; } return a; };
                const angG = angAt(G), angF = angAt(far);
                const reach = (p, H, around) => {
                    const r = legTo(c, legs[i], frameApply(frameInv(H), p), m.angles, { iters: 30, range: REACH });
                    if (!(r.err < 0.01)) return false;
                    if (!around) return true;
                    const a = Float64Array.from(around);
                    for (const j of legs[i].joints) a[j] = r.ang[j];
                    return clearance(i, a) > CLEAR;
                };
                const clearAt = (p, H, around) => { const r = legTo(c, legs[i], frameApply(frameInv(H), p), m.angles, { iters: 30, range: REACH }); if (!(r.err < 0.01)) return true; const a = Float64Array.from(around); for (const j of legs[i].joints) a[j] = r.ang[j]; return clearance(i, a) > CLEAR; };
                // A foot is set down on ground level across its sole and a little beyond, never
                // on the lip of a step, where it slides off under the weight: failing that
                // place, a little ahead or behind it.
                // (out to its pad's corners and a hand's width past them)
                const sole = (legs[i].foot.size || 0.26) * Math.SQRT1_2 + 0.1;
                const level = (p) => {
                    const h = groundAt(p);
                    for (let k = 0; k < 8; k++) {
                        const a = (k * Math.PI) / 4;
                        if (Math.abs(groundAt([p[0] + sole * Math.cos(a), 0, p[2] + sole * Math.sin(a)]) - h) > 0.04) return false;
                    }
                    return true;
                };
                let to = null;
                for (const off of [0, 0.2, -0.2, 0.4, -0.4]) {
                    for (let s = 1; s >= 0; s -= 0.125) {
                        const p = add(add(scale(frameApply(far, home[i]), s), scale(frameApply(G, home[i]), 1 - s)), scale(dir, off)); p[1] = groundAt(p);
                        if (!level(p)) continue;
                        const up = [p[0], Math.max(groundAt(feet[i]), p[1]) + LIFT, p[2]];
                        if (reach(p, G, angG) && reach(up, G) && clearAt(p, far, angF)) { to = p; break; }
                    }
                    if (to) break;
                }
                const found = !!to;
                if (!to) { to = frameApply(G, home[i]); to[1] = groundAt(to); }
                target = { mid, yaw: yawOf(G) };
                // Where a sole reads standing on the ground: as the planted three do now.
                const rest = others.reduce((s, x) => s + feet[x][1] - groundAt(feet[x]), 0) / 3;
                to[1] += rest;
                // The stepping leg is a fifth of its mass: how it stands lifted and set down where it
                // goes (from the body after the shift) is what the middle of its mass is judged with.
                last = i;
                const poses = [[feet[i][0], feet[i][1] + LIFT, feet[i][2]], to].map((p) => legTo(c, legs[i], frameApply(frameInv(G), p), m.angles, { iters: 20, range: REACH + 0.4 }).ang);
                // How far inside the three it must stand to lift: short of the margin when no step
                // makes the margin (a foot left out of place), as far in as the best of them does.
                const need = plan.inn != null ? Math.max(0.05, Math.min(MARGIN * 0.8, plan.inn - 0.02)) : MARGIN * 0.8;
                phase = { kind: 'shift', leg: i, from: feet[i], to, found, t: 0, best: Infinity, since: 0, tri, cen, poses, need, worst: plan.worst, why: plan.why, sc: plan.sc };
            }
            const P = phase, F = m.place;
            P.t += dt;
            // The body's move this tick: toward its target, no faster than it goes.
            const e = sub(target.mid, midOf(F)), el = Math.hypot(...e);
            let ey = target.yaw - yawOf(F); ey = Math.atan2(Math.sin(ey), Math.cos(ey));
            // The stepping foot's aim: up, over, down.
            let aim = null;
            if (P.kind !== 'shift' && P.kind !== 'settle') {
                const top = Math.max(groundAt(P.from), groundAt(P.to)) + LIFT;
                aim = P.kind === 'lift' ? [P.from[0], top, P.from[2]] : P.kind === 'swing' ? [P.to[0], top, P.to[2]] : [P.to[0], P.to[1] - 0.015, P.to[2]];
            }
            // Each leg's joint rates for the body's move (`hold` 0: it stays where it is).
            const ratesFor = (hold) => {
                const d = el > 1e-6 ? scale(e, (hold * Math.min(el, BODY_V * dt, el * 6 * dt)) / el) : [0, 0, 0];
                const a = hold * Math.sign(-ey) * Math.min(Math.abs(ey), BODY_W * dt, Math.abs(ey) * 6 * dt);
                // Turned by `a`, and righted toward level as fast as it turns: a body the legs let
                // tilt is stood level again (its frame as stood up, turned to its heading).
                const F1 = moved(F, d, -a), lev = qMul(qAxis([0, 1, 0], yawOf(F1) - yaw0), q0);
                const F2 = { q: hold ? toward(F1.q, lev, BODY_W * dt) : F1.q, t: null };
                F2.t = sub(midOf(F1), qRot(F2.q, base));
                const inv2 = frameInv(F2), rate = new Map();
                legs.forEach((leg, i) => {
                    const now = footAt(c, leg, m.angles), sole = frameApply(F, now);
                    let want;
                    if (aim && i === P.leg) {
                        const dv = sub(aim, sole), l = Math.hypot(...dv), s = Math.min(1, (FOOT_V * dt) / (l || 1), 8 * dt);
                        want = frameApply(inv2, add(sole, scale(dv, s)));
                    } else {
                        // A planted foot stays where it stands, and is pressed back down onto the
                        // ground if it comes up off it: a leg bearing nothing that the body's
                        // righting draws in lifts its foot rather than lowering the body.
                        const off = Math.min(Math.max(0, overOf(i) - 0.005), FOOT_V * dt * 0.5);
                        want = frameApply(inv2, [sole[0], sole[1] - off, sole[2]]);
                    }
                    const dq = legStep(i, sub(want, now));
                    leg.joints.forEach((j, x) => {
                        // A knee is never driven straight: there the leg locks out and no longer steers.
                        // Nor any joint out past its working range from how it stands.
                        const knee = x === leg.joints.length - 1, side = Math.sign(home0[j]) || -1;
                        // (the leg about to step may go on past it while the body shifts off it: it is lifted next)
                        const off = m.angles[j] - home0[j], past = Math.abs(off) > spanOf(j) + (P.kind === 'shift' && i === P.leg ? 0.3 : 0) && Math.sign(dq[x]) === Math.sign(off);
                        if (past && !(aim && i === P.leg)) rate.past = i;
                        rate.set(j, past || (knee && side * m.angles[j] < 0.4 && side * dq[x] < 0) ? 0 : dq[x] / dt);
                    });
                });
                return rate;
            };
            // A planted leg turned past what it is planned to turn holds the body where it is, if
            // the move would turn it further: driven on, its joint comes up against its stop and
            // that corner sinks. A move that turns it back is let go on.
            // With a foot up, the middle of its mass is watched over the three it stands on: short of
            // the margin, the body is held where it is (it moves no further out); near the edge, the
            // foot is put straight down where it is, to stand on four again (a catch).
            const up = P.kind === 'lift' || P.kind === 'swing';
            const inn = up ? inside(xz(comOf(m.angles, F)), P.tri) : Infinity;
            if (up && inn < 0.04) {
                const p = soleOf(P.leg);
                P.kind = 'down'; P.to = [p[0], groundAt(p) + (P.to[1] - groundAt(P.to)), p[2]]; P.best = Infinity; P.since = 0;
                return;
            }
            let rate = ratesFor(up && inn < P.need ? 0 : 1);
            // Held so long on the way over (a shift that needs a planted leg past its range), that
            // leg steps next instead.
            const pastLeg = rate.past, further = pastLeg != null;
            if (further) rate = ratesFor(0);
            P.held = further ? (P.held || 0) + dt : 0;
            if (P.kind === 'shift' && P.held > 2) { phase = null; path = null; pinned = pastLeg; return; }
            // Scaled down together to what the slowest drive turns, and to how well the planted legs
            // kept up last tick: a drive slowed under its load (well before it stalls) holds the
            // others back with it, so four feet on the ground move the body as one, not against each other.
            let s = 1;
            for (const [j, w] of rate) s = Math.min(s, (m.joints[j].speed * 0.9) / (Math.abs(w) || 1e-9));
            let kept = 1;
            for (const [j, w] of sent) {
                if (aim && legOfJ.get(j) === P.leg) continue;
                if (Math.abs(w) > m.joints[j].speed * 0.05) kept = Math.min(kept, Math.max(0, m.rates[j] / w));
            }
            keep = Math.min(1, Math.max(0.15, keep * 0.5 + kept * 0.5 + 0.1));
            s *= keep;
            sent.clear();
            for (const [j, w] of rate) sent.set(j, w * s);
            for (const [j, ct] of ctOf) {
                const J = m.joints[j], w = (rate.get(j) || 0) * s;
                ct.u = Math.max(-1, Math.min(1, w / (J.raise * J.speed)));
            }
            // On to the next part of the step once there, or once it gets no closer (a place
            // just past what the leg reaches is as near as it comes).
            const miss = aim ? Math.hypot(...sub(aim, soleOf(P.leg))) : el + Math.abs(ey);
            if (!(miss > P.best - 0.002)) { P.best = miss; P.since = 0; } else P.since += dt;
            const stuck = P.since > 0.6;
            const next = (kind) => { P.kind = kind; P.best = Infinity; P.since = 0; };
            // A shift that gets nowhere is given up: the next step is planned again from where it stands.
            if (P.kind === 'shift' && P.t > 8) { phase = null; path = null; k++; return; }
            if (P.kind === 'shift') {
                // It may lift once the body is well over the other three (the body goes on to
                // where the step wants it while the foot swings); stalled short of that, the body
                // is sent further in toward their middle.
                const inn = Math.min(...P.poses.map((pose) => {
                    const a = Float64Array.from(m.angles);
                    for (const j of legs[P.leg].joints) a[j] = pose[j];
                    return inside(xz(comOf(a, F)), P.tri);
                }), inside(xz(comOf(m.angles, F)), P.tri)), over = inn >= P.need;
                // Held from going on by a planted leg at the end of its range, it lifts from where it
                // stands if that is inside the three at all: the step is what frees that leg.
                if ((over && ((el < 0.06 && Math.abs(ey) < 0.05) || inn >= MARGIN * 1.5 || stuck)) || (P.held > 1 && inn >= 0.05)) next('lift');
                else if (stuck) { target.mid = add(target.mid, scale([P.cen[0] - target.mid[0], 0, P.cen[1] - target.mid[2]], 0.3)); P.best = Infinity; P.since = 0; }
            }
            // Up: high enough (it swings on as it comes up the rest). Over: above where it goes.
            else if (P.kind === 'settle') { if (el < 0.02 || stuck) { phase = null; for (const ct of ctOf.values()) ct.u = 0; } }
            else if (P.kind === 'lift') { if (soleOf(P.leg)[1] > aim[1] - 0.05 || stuck) next('swing'); }
            else if (P.kind === 'swing') { const p = soleOf(P.leg); if (Math.hypot(p[0] - aim[0], p[2] - aim[2]) < 0.04 || stuck) next('down'); }
            // Down: until it stands on the ground (its pad's lowest corner on it), reaching on down past
            // where it was sent if it has not got there; a foot that reaches no further, the body is
            // let down toward, a little, until it does.
            else if (overOf(P.leg) < 0.015) { phase = null; k++; if (u === 0 && v === 0) for (const ct of ctOf.values()) ct.u = 0; }
            else if (stuck) {
                P.deeper = (P.deeper || 0) + 1;
                if (P.deeper <= 6) P.to = [P.to[0], P.to[1] - 0.04, P.to[2]];
                else if (P.deeper <= 10) target.mid = [target.mid[0], target.mid[1] - 0.04, target.mid[2]];
                else { phase = null; k++; }
                P.best = Infinity; P.since = 0;
            }
        },
    };
    return g;
}

/** How high a step up or down a walker takes: what its foot clears, with a little to spare. */
export const STEP_M = LIFT * 2.2;

/** How far a walker lets its deck down, kneeling to be loaded or unloaded. */
export const KNEEL_M = KNEEL;

const RIDES = new WeakMap();
/**
 * What machine contract `c` carries a load on, on wheels or on feet, or null: { bed (its
 * deck, design frame), half [along, across] (what it stands over: a vehicle's deck, a
 * walker's legs as it stands, about the deck's middle), across (how far out to either side
 * it reaches, wheels or feet and all), speed (m/s, flat out), walker (on feet), feet (how far
 * out from its middle its feet stand, on feet) }. A
 * walker's speed is its creep's: a stride for every four steps, each a shift, a lift, a
 * swing and a set-down.
 */
export function rideOf(c) {
    if (RIDES.has(c)) return RIDES.get(c);
    const V = c.vehicle || c.walker;
    let r = null;
    if (V) {
        const B = V.bed, M = c.walker ? poseOf(c, stanceOf(c)) : null, half = [0, 0];
        for (const b of solidsOf(c)) for (const p0 of cornersOf(b)) {
            const p = sub(M && b.carrier != null && b.carrier >= 0 ? frameApply(M[b.carrier], p0) : p0, B.center);
            half[0] = Math.max(half[0], Math.abs(dot(p, B.axes[0]))); half[1] = Math.max(half[1], Math.abs(dot(p, B.axes[1])));
        }
        const step = 2 * LIFT / FOOT_V + STRIDE / 2 / FOOT_V + 0.25 / BODY_V + 0.3;
        r = c.vehicle ? { bed: B, half: B.half, across: half[1], speed: V.speed, walker: false }
            : { bed: B, half, across: half[1], speed: STRIDE / (4 * step), walker: true,
                feet: Math.max(...c.walker.legs.map((l) => { const p = sub(footAt(c, l, stanceOf(c), M), B.center); return Math.hypot(dot(p, B.axes[0]), dot(p, B.axes[1])); })) };
    }
    RIDES.set(c, r);
    return r;
}

// Rotation q turned toward r by at most `max` rad.
function toward(q, r, max) {
    let d = qMul(r, qConj(q));
    if (d[3] < 0) d = d.map((x) => -x);
    const ang = 2 * Math.acos(Math.min(1, d[3])), s = Math.hypot(d[0], d[1], d[2]);
    if (ang <= max || s < 1e-9) return ang <= max ? r.slice() : q.slice();
    return qMul(qAxis([d[0] / s, d[1] / s, d[2] / s], max), q);
}

function solve3(A, b) {
    const M = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < 3; i++) {
        let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        [M[i], M[p]] = [M[p], M[i]];
        if (Math.abs(M[i][i]) < 1e-12) continue;
        for (let r = i + 1; r < 3; r++) { const f = M[r][i] / M[i][i]; for (let q = i; q <= 3; q++) M[r][q] -= f * M[i][q]; }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { if (Math.abs(M[i][i]) < 1e-12) continue; let s = M[i][3]; for (let q = i + 1; q < 3; q++) s -= M[i][q] * x[q]; x[i] = s / M[i][i]; }
    return x;
}
