// lib/foundry/pilot.js — machines in a site (site.js) doing work on their own.
//
// A pilot drives a machine the way an operator would, through its controls and
// nothing else: the deck's levers and dials (the winch's Hoist among them) and the hook. What it works
// out it works out from the contract: where the tip goes as the controls turn
// (poseOf), so where to put them to bring the tip over a point. The world says
// whether it got there.
//
//   reach(m, at)        the control settings that put m's hook line over [x, z]
//                       with the tip as high as it goes, and how close they come
//   pilotOf(site, m)    a machine's pilot: a queue of moves (reach, hoist to a
//                       height, take a piece, set it down, let go, park, drive,
//                       carry one end of a load lifted with another crane) run a
//                       tick at a time; each move ends when the world says so.
//                       It raises an arm before swinging it; inches a load off the
//                       ground before taking it in at speed, drawing in toward the
//                       mast a load its low tip cannot lift clear; lets a load down
//                       slowly over the last of the way, holding it from swinging,
//                       guiding it onto its mark; lays a slender piece down on a
//                       deck, foot first, its top let down round its foot. On
//                       wheels it goes round what stands between (routeOf), keeps
//                       to the way, backs onto its spot, and with a load on the deck
//                       speeds up, brakes and turns no harder than tips or throws it.
//                       On feet it walks toward whichever end faces the way more nearly
//                       (back as well as forward), kneels at each crane to be loaded
//                       and unloaded, its load set in the middle of its deck, and is
//                       parked only where a crane's tip stands high enough to bring
//                       the load in over its kneeling deck
//   routeOf(site, v, from, to)
//                       the way for machine v on wheels round cranes' sweeps,
//                       pieces, people and where pieces are to go, and up only the
//                       slopes it climbs with what it carries and its load rides
//                       (groundCost, deckHold)
//   liftOf(m)           what a crane lifts anywhere it reaches
//   planDelivery(site, crate, dest)
//                       which machines carry a piece to where a task wants it
//                       (destOf): a crane that lifts it and reaches both, else a
//                       chain of them handing it over at spots on the ground both
//                       of a pair reach, or by a carrier driven between them
//   planTandem(site, piece, dest)
//                       two cranes to lift a piece too heavy for one, an end each,
//                       both reaching their end all the way
//   crew(site)          runs the site's open tasks with its machines in order, each
//                       leg queued on its machine's pilot, a hand-over waiting
//                       for the leg before it and for the one before it to stand
//                       clear, a piece waiting for the tasks it stands on.
//                       crew(site, { player: m }): m is driven by hand; the crew
//                       plans with it, its legs are goals (goal(): what to do now
//                       and where, marked on the ground) read off the world, and
//                       the crew's machines wait on the player as on each other

import { poseOf, frameApply, frameMul, tipOf, solidsOf, cornersOf, qRot } from "./operate.js";
import { RANGE } from "./site.js";
import { gradeOf } from "./compile.js";
import { rideOf, STEP_M, KNEEL_M } from "./gait.js";

const TAU = Math.PI * 2;

/** Where m's tip is in the world with its controls at `x` (one value per moving control). */
export function tipAt(m, vars, x) {
    const c = m.contract, ang = new Float64Array(c.joints.length);
    vars.forEach((ct, i) => { for (const j of ct.joints) ang[j] = x[i]; });
    const M = poseOf(c, ang), t = tipOf(c);
    return frameApply(frameMul(m.place, t.carrier != null ? M[t.carrier] : { q: [0, 0, 0, 1], t: [0, 0, 0] }), t.pos);
}

/** The controls that move m's joints (one variable each: its joints turn together); the drive moves the machine, not its tip. */
export function varsOf(m) { return m.controls.filter((ct) => ct.joints.length && !ct.dark && ct.kind !== 'drive'); }

/**
 * The control settings (joint angles, one per moving control) that put m's tip
 * over [x, z], as high as it goes there: { x, err (m off over the ground), tip }.
 */
export function reach(m, [px, pz], { from = null } = {}) {
    const vars = varsOf(m);
    if (!vars.length || !tipOf(m.contract)) return null;
    const lim = (i) => (m.joints[vars[i].joints[0]].upright ? Infinity : RANGE - 0.08);
    // How far the tip is off over the ground, and below the least height it keeps over the ground.
    const floor = m.ground + m.size * 0.08;
    const cost = (x) => {
        const t = tipAt(m, vars, x), e = Math.hypot(t[0] - px, t[2] - pz), low = Math.max(0, floor - t[1]);
        return e * e + 10 * low * low;
    };
    const descend = (x0) => {
        let x = x0.slice(), bc = cost(x), step = 0.4;
        for (let it = 0; it < 300 && step > 1e-5; it++) {
            let moved = false;
            for (let i = 0; i < x.length; i++) for (const d of [step, -step]) {
                const y = x.slice(); y[i] = Math.max(-lim(i), Math.min(lim(i), y[i] + d));
                const v = cost(y);
                if (v < bc - 1e-14) { bc = v; x = y; moved = true; }
            }
            if (!moved) step /= 2;
        }
        return { x, c: bc };
    };
    // From where it is and from a spread of settings: the closest, and of those as close, the highest.
    const here = from || vars.map((ct) => m.angles[ct.joints[0]]);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const starts = [here];
    for (let k = 0; k < 40; k++) starts.push(vars.map((_, i) => (lim(i) === Infinity ? rnd() * TAU - Math.PI : (rnd() * 2 - 1) * lim(i))));
    starts.sort((a, b) => cost(a) - cost(b));
    const sols = starts.slice(0, 8).map(descend);
    const bestC = Math.min(...sols.map((s) => s.c)), tol = (Math.sqrt(bestC) + 0.002 * m.size) ** 2;
    let x = sols.filter((s) => s.c <= tol).map((s) => s.x).sort((a, b) => tipAt(m, vars, b)[1] - tipAt(m, vars, a)[1])[0];
    // A dial goes the short way round from where it is.
    x = x.map((v, i) => (lim(i) === Infinity ? here[i] + (((v - here[i]) % TAU) + TAU + Math.PI) % TAU - Math.PI : v));
    const tip = tipAt(m, vars, x);
    return { x, tip, err: Math.hypot(tip[0] - px, tip[2] - pz) };
}

/** Whether m can put its hook on [x, z] (within `tol` m). */
export function reaches(m, at, tol) {
    const r = reach(m, at);
    return !!r && r.err <= tol;
}

/** A machine's pilot: moves queued and run a tick at a time through its controls. */
export function pilotOf(site, m) {
    const vars = varsOf(m);
    const queue = [];
    let cur = null, t = 0;
    const p = {
        machine: m, queue, failed: null,
        get busy() { return !!cur || queue.length > 0; },
        get doing() { return cur ? cur.label : 'idle'; },
        /** The move it is on, or null. */
        get current() { return cur; },
        /** Put the hook line over [x, z]. */
        reach(at, label) { return p.push({ kind: 'reach', at, label: label || 'reaching' }); },
        /** Take the line in short, to carry by. */
        lineIn() { return p.push({ kind: 'line', label: 'taking the line in' }); },
        /** Let the line down onto the crate under it and take it. */
        take(crate, { lift = true } = {}) { return p.push({ kind: 'take', crate, lift, label: `taking ${crate.name}` }); },
        /**
         * Carry end `i` of a load two cranes lift together along `T.way(s, i)` ([x, z] for s
         * from 0 to 1): its line at `T.line(i)`, the way's s moving on while both are on it.
         */
        track(T, i, label) { return p.push({ kind: 'track', T, i, label: label || 'lifting together', timeout: 600 }); },
        /**
         * Let the line down until the crate stands, then let it go. With `lay` (a function giving
         * {way: [x, z], at}) a piece hung tall from its eye is laid down that way, across `at`
         * (else the spot): its foot set short of it, the tip carried on past it as the line runs
         * out, so it comes to lie across the spot with its eye on that side. With `guide` ([x, z],
         * where its middle goes) it is guided onto that mark over the last of the way.
         */
        setDown({ lay = null, guide = null } = {}) { return p.push({ kind: 'set', lay, guide, label: lay ? 'laying down' : 'setting down' }); },
        /** Back to where it was built. */
        park() { return p.push({ kind: 'park', label: 'parking' }); },
        /** Turn its tip away from [x, z], to the far side of where it stands. */
        clearOf(at) { return p.push({ kind: 'park', away: at, label: 'standing clear' }); },
        /** Drive (a machine on wheels) to stand at [x, z], facing `heading` ([x, z], or a function giving it as it gets there) either way round, or exactly that way with `exact`. */
        driveTo(at, heading, label, { exact = false } = {}) {
            // As long as it takes at its pace, several times over (a walker's is slow), and never less than five minutes.
            const R = rideOf(m.contract), far = Math.hypot(at[0] - m.mid[0], at[1] - m.mid[1]);
            const timeout = Math.max(300, R && R.speed > 0 ? 120 + (6 * far) / R.speed : 0);
            return p.push({ kind: 'drive', at, heading, exact, label: label || 'driving', timeout });
        },
        /** Wait until `fn()` holds. */
        wait(fn, label) { return p.push({ kind: 'wait', fn, label: label || 'waiting', timeout: 1e9 }); },
        /** Run `fn()` once. */
        then(fn) { return p.push({ kind: 'call', fn, label: '' }); },
        push(mv) { queue.push(mv); return p; },
        stop() { queue.length = 0; cur = null; halt(); },
        /** Run the current move for `dt` s of site time. */
        tick(dt) {
            if (!cur) { cur = queue.shift() || null; t = 0; if (cur) start(cur); }
            if (!cur) return;
            t += dt;
            const done = run(cur, dt);
            if (done === 'fail') { p.failed = `${m.name}: ${cur.label} failed`; p.stop(); return; }
            if (done) { halt(); cur = null; }
            else if (t > (cur.timeout || 120)) { p.failed = `${m.name}: ${cur.label} took too long`; p.stop(); }
        },
    };
    function halt() { for (const ct of m.controls) { ct.u = 0; if (ct.kind === 'drive') ct.v = 0; } m.hoist(0); }
    // How far control i has to turn by `d`: a dial (which reads within ±π) the short way round.
    const turn = (i, d) => (m.joints[vars[i].joints[0]].upright ? ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI : d);
    // The line it carries on: short, just clear of the tip.
    const carry = () => m.hook.reach * 1.5;
    function lineTo(L) {
        const e = m.hook.line - L;
        m.hoist(Math.abs(e) < 0.003 ? 0 : Math.max(-1, Math.min(1, e / Math.max(0.05, m.hook.speed * 0.3))));
        return Math.abs(e) < 0.01;
    }
    function start(mv) {
        if (mv.kind === 'reach') {
            // A spot, or where something that moves is when the move begins (a carrier's deck).
            const r = reach(m, typeof mv.at === 'function' ? mv.at() : mv.at);
            mv.goal = r && r.x; mv.err = r ? r.err : Infinity;
            // Where the tip can get to over the ground: the point itself, or as near as it goes.
            mv.target = r && [r.tip[0], r.tip[2]];
            // An arm low over the ground sweeps through whatever stands there as it swings: raise
            // it where it is first, as an operator does, then swing.
            // Raised: the highest it goes on the bearing it is on, folding in if that is higher.
            const t = m.tipWorld(), b = [t[0] - m.mid[0], t[2] - m.mid[1]], r0 = Math.hypot(...b) || 1;
            let up = null;
            for (const k of [1, 0.85, 0.7, 0.55]) {
                const r = reach(m, [m.mid[0] + (b[0] * k), m.mid[1] + (b[1] * k)]);
                if (r && r.err < 0.05 * r0 && (!up || r.tip[1] > up.tip[1] + 0.02)) up = r;
            }
            if (up && up.tip[1] - t[1] > 0.05 * m.size) mv.raise = up.x;
        } else if (mv.kind === 'park' && mv.away) {
            // Away from the spot and from every other machine about it: where none of them works.
            const c = m.mid, away = (p) => { const v = [c[0] - p[0], c[1] - p[1]], l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l]; };
            let d = away(typeof mv.away === 'function' ? mv.away() : mv.away);
            for (const o of site.machines) if (o !== m && Math.hypot(o.mid[0] - c[0], o.mid[1] - c[1]) < (o.size + m.size) * 1.5) { const a = away(o.mid); d = [d[0] + a[0], d[1] + a[1]]; }
            const l = Math.hypot(...d) || 1;
            const r = reach(m, [c[0] + (d[0] / l) * m.size * 0.6, c[1] + (d[1] / l) * m.size * 0.6]);
            mv.goal = r ? r.x : vars.map(() => 0);
        } else if (mv.kind === 'park') {
            mv.goal = vars.map(() => 0);
        }
    }
    // Drive each control toward its goal angle: full speed far off, easing in.
    function steer(goal) {
        let off = 0;
        vars.forEach((ct, i) => {
            const j = ct.joints[0], J = m.joints[j], e = turn(i, goal[i] - m.angles[j]);
            const u = Math.max(-1, Math.min(1, e / Math.max(1e-6, J.speed * 0.5)));
            ct.u = Math.abs(e) < 2e-3 ? 0 : u * J.raise;
            off = Math.max(off, Math.abs(e));
        });
        const still = vars.every((ct) => Math.abs(m.rates[ct.joints[0]]) < 0.02);
        return off < 0.01 && still;
    }
    function swinging() {
        const cr = m.hook.crate;
        if (!cr) return false;
        const v = site.world.velocity(cr.body);
        return Math.hypot(v[0], v[2]) > 0.03 * Math.max(1, cr.size);
    }
    // Move the tip over the ground toward `goal` [x, z], the joints toward `xs` where that leaves
    // them free. What hangs on the hook swings as a pendulum; the tip follows it, which is how an
    // operator damps the swing: the tip's speed is the way to the goal plus the way to the load,
    // at half the pendulum's own rate, gentle enough not to rock a long arm that gives sideways.
    // Not with `follow: false`, for a load that stands on something and does not swing.
    function steerTip(goal, xs, { follow = true } = {}) {
        const x = vars.map((ct) => m.angles[ct.joints[0]]);
        const tip = m.tipWorld();
        let e = [0, 0], ks = 0;
        if (m.hook.crate && follow) {
            const h = m.hookWorld();
            e = [h[0] - tip[0], h[2] - tip[2]];
            ks = 0.5 * Math.sqrt(9.81 / Math.max(0.05, m.hook.line + Math.hypot(...m.hook.at)));
        }
        const off = [goal[0] - tip[0], goal[1] - tip[2]];
        const v = [1.5 * off[0] + ks * e[0], 1.5 * off[1] + ks * e[1]];
        // The tip's motion over the ground for a small turn of each joint (2 × n), from the contract.
        const t0 = tipAt(m, vars, x), Jc = [[], []];
        for (let i = 0; i < x.length; i++) {
            const y = x.slice(); y[i] += 1e-4;
            const t1 = tipAt(m, vars, y);
            Jc[0].push((t1[0] - t0[0]) / 1e-4); Jc[1].push((t1[2] - t0[2]) / 1e-4);
        }
        // Damped least squares: dq = Jᵀ (J Jᵀ + λ²)⁻¹ v, and toward xs in what that leaves free.
        const lam = (0.05 * m.size) ** 2;
        const a = Jc[0].reduce((s, g) => s + g * g, 0) + lam, b = Jc[0].reduce((s, g, i) => s + g * Jc[1][i], 0), d = Jc[1].reduce((s, g) => s + g * g, 0) + lam;
        const det = a * d - b * b;
        const solve = (w) => { const p = (d * w[0] - b * w[1]) / det, q = (a * w[1] - b * w[0]) / det; return x.map((_, i) => Jc[0][i] * p + Jc[1][i] * q); };
        const dq = solve(v);
        if (xs) {
            const n = x.map((xi, i) => 0.8 * turn(i, xs[i] - xi));
            const Jn = [Jc[0].reduce((s, g, i) => s + g * n[i], 0), Jc[1].reduce((s, g, i) => s + g * n[i], 0)];
            const back = solve(Jn);
            n.forEach((ni, i) => { dq[i] += ni - back[i]; });
        }
        // As fast as the slowest drive allows, all in proportion so the tip keeps its line.
        const sp = vars.map((ct) => m.joints[ct.joints[0]].speed);
        const over = Math.max(1, ...dq.map((q, i) => Math.abs(q) / sp[i]));
        vars.forEach((ct, i) => { ct.u = (dq[i] / over / sp[i]) * m.joints[ct.joints[0]].raise; });
        const sway = Math.hypot(...e);
        return Math.hypot(...off) < 0.004 * m.size + 0.005 && sway < 0.01 * m.size && !swinging();
    }
    function run(mv, dt) {
        switch (mv.kind) {
            case 'reach': {
                if (!mv.goal) return 'fail';
                if (mv.raise) { if (steer(mv.raise)) mv.raise = null; return false; }
                // What it carries already down on what it goes on, near enough over the spot: there;
                // setting it down does the rest.
                const t = m.tipWorld();
                if (m.hook.crate && !m.carrying() && Math.hypot(t[0] - mv.target[0], t[2] - mv.target[1]) < 0.1) return true;
                return steerTip(mv.target, mv.goal);
            }
            case 'park': return steer(mv.goal) && !swinging();
            case 'line': return lineTo(carry());
            case 'take': {
                const cr = mv.crate, P = site.world.pose(cr.body), top = site.liftPoint(cr)[1];
                // Taken: the line in until it hangs short under the tip.
                if (m.hook.crate === cr) {
                    if (!mv.lift) return true;
                    // The line in short: inched until the load comes off the ground (taken in fast
                    // from rest it is snatched up and swings), then at speed. The tip held where it
                    // is, or, while the line is in and the load still does not hang (its eye too low
                    // under a tip that is low out where it is), drawn in toward the mast, which
                    // lifts the tip, until it does.
                    const t = m.tipWorld();
                    if (m.carrying()) mv.off = true;
                    let d;
                    if (mv.off) d = lineTo(carry());
                    else { d = m.hook.line <= carry() + 0.01; m.hoist(d ? 0 : 0.12); }
                    if (!mv.hold) mv.hold = [t[0], t[2]];
                    if (d && !m.carrying()) {
                        const c = m.mid, r = Math.hypot(mv.hold[0] - c[0], mv.hold[1] - c[1]), r1 = Math.max(baseRadius(m) + 0.3, r - dt * 0.25);
                        if (r > 1e-6) mv.hold = [c[0] + ((mv.hold[0] - c[0]) * r1) / r, c[1] + ((mv.hold[1] - c[1]) * r1) / r];
                    }
                    return steerTip(mv.hold, null) && d && m.carrying();
                }
                if (m.reachable() === cr && m.hookWorld()[1] - top < m.hook.reach) { m.hoist(0); m.grab(); return false; }
                // Down onto it.
                m.hoist(-Math.max(0.15, Math.min(1, (m.hookWorld()[1] - top) / Math.max(0.05, m.hook.speed * 0.3))));
                return m.hook.line >= m.hook.maxLine - 1e-6 ? 'fail' : false;
            }
            case 'set': {
                if (!m.hook.crate) return true;
                const cr = m.hook.crate, tip = m.tipWorld();
                if (!mv.at) {
                    mv.at = [tip[0], tip[2]];
                    // Laid: only what hangs tall and slender (twice as tall as it is across), which
                    // would fall some way of its own; across where `lay()` says (its `at`, else the
                    // spot), its foot short of the middle and its eye past it, `way`.
                    const L = 2 * cr.half[1], w = Math.min(cr.half[0], cr.half[2]);
                    if (mv.lay && cr.half[1] > 2 * Math.min(cr.half[0], cr.half[2])) {
                        const g = mv.lay(), d = g.way, c = g.at || [tip[0], tip[2]], n = Math.hypot(...d) || 1, k = (L / 2 - w) / n;
                        mv.eyeAt = [c[0] + d[0] * k, c[1] + d[1] * k];
                        mv.at = [c[0] - d[0] * k, c[1] - d[1] * k];
                    } else mv.lay = null;
                }
                if (mv.lay) {
                    // Its foot down: the tip on over where its eye is to lie, the line out as it
                    // goes over, until it lies; then let go.
                    const up = Math.abs(qRot(site.world.pose(cr.body).slice(3, 7), [0, 1, 0])[1]);
                    if (mv.tipping) {
                        const v = site.world.velocity(cr.body);
                        if (up < 0.15 && Math.hypot(v[0], v[1], v[2]) < 0.05) { m.hoist(0); m.release(); return false; }
                        // The tip a little ahead of where the eye has got to, along the way it is laid.
                        const T = mv.tipping, t = m.tipWorld(), R = T.L - T.w, E = site.liftPoint(cr);
                        // From where its foot is now (it may slide): the far end from its eye.
                        const C = site.poseOf(cr), foot = [2 * C[0] - E[0], 2 * C[2] - E[2]];
                        const s = Math.max(0, Math.min(R, (E[0] - foot[0]) * T.d[0] + (E[2] - foot[1]) * T.d[1]));
                        // Further ahead the longer it hangs back: a harder pull over.
                        T.lead = s > (T.s || 0) + 0.01 ? Math.max(0.15, (T.lead || 0.15) - dt * 0.1) : Math.min(0.6, (T.lead || 0.15) + dt * 0.05);
                        if (s > (T.s || 0) + 0.01) T.s = s;
                        const g = Math.min(R, s + T.lead);
                        steerTip([foot[0] + T.d[0] * g, foot[1] + T.d[1] * g], null, { follow: false });
                        // The line as long as from the tip to where the eye falls to a little further
                        // over (round its foot, as the top of what tips goes): it lets the top down
                        // the way it tips and pulls it on that way.
                        const s1 = Math.min(R, s + 0.1), fy = site.support(cr).y, Q = [foot[0] + T.d[0] * s1, fy + T.w + Math.sqrt(Math.max(0, R * R - s1 * s1)), foot[1] + T.d[1] * s1];
                        lineTo(Math.hypot(t[0] - Q[0], t[1] - Q[1], t[2] - Q[2]) - 0.03);
                        return false;
                    }
                    const gap = site.world.pose(cr.body)[1] - cr.half[1] - site.support(cr).y;
                    // Down, and still: a foot set down swinging slides on.
                    if (gap < 0.01 && swinging()) { m.hoist(0); steerTip(mv.at, null); return false; }
                    // Standing on its foot before it is pulled over: the line out until the rope bears
                    // little of it, or it slides where it is pulled instead of tipping.
                    if (gap < 0.01 && !mv.tipping && m.borne() > 0.2) { m.hoist(-0.1); steerTip(mv.at, null); return false; }
                    if (gap < 0.01) {
                        // Over from where its foot stands, toward the middle it is to lie across.
                        const P = site.poseOf(cr), foot = [P[0], P[2]], g = mv.lay(), w0 = g.way, n = Math.hypot(...w0) || 1;
                        let d = [w0[0] / n, w0[1] / n];
                        if (g.at && (g.at[0] - foot[0]) * d[0] + (g.at[1] - foot[1]) * d[1] < 0) d = [-d[0], -d[1]];
                        const L = 2 * cr.half[1], w = Math.min(cr.half[0], cr.half[2]);
                        mv.tipping = { foot, d, L, w};
                    }
                }
                // Down: the ropes have not borne it for a moment (they go slack for an instant too,
                // as the line starts out under a load), and it is still.
                else if ((mv.down = m.carrying() ? 0 : (mv.down || 0) + dt) > 0.3 && !swinging()) { m.hoist(0); m.release(); return false; }
                // Hold the tip over the spot, following the load to damp its swing, and let it
                // down: briskly while it is well clear of what it goes on, slowly over the last of
                // the way, and not at all while it swings there.
                steerTip(mv.at, null);
                const gap = site.world.pose(cr.body)[1] - cr.half[1] - site.support(cr).y;
                const near = gap < Math.max(0.15, cr.size * 0.5);
                // Guided onto its mark: over the last of the way, the tip nudged by how far the piece
                // is off it, and held just clear until it is over it.
                if (mv.guide && near && !swinging()) {
                    const P = site.poseOf(cr), ex = mv.guide[0] - P[0], ez = mv.guide[1] - P[2];
                    mv.at = [mv.at[0] + ex * dt, mv.at[1] + ez * dt];
                    if (gap < 0.04 && Math.hypot(ex, ez) > Math.max(0.01, Math.min(cr.half[0], cr.half[2]) * 0.3)) { m.hoist(0); return false; }
                }
                m.hoist(near && swinging() ? 0 : near ? -0.12 : -0.5);
                return false;
            }
            case 'drive': return driveTo(mv, dt);
            case 'track': {
                // Its end of the load where the shared way is now, its line as the pair's lines
                // want it; the way moves on only while both ends are on it.
                const T = mv.T, i = mv.i, goal = T.way(T.s, i);
                const lined = lineTo(T.line(i, m));
                const t = m.tipWorld(), off = Math.hypot(goal[0] - t[0], goal[1] - t[2]);
                steerTip(goal, null);
                T.on[i] = lined && off < T.slack;
                if (i === 0 && T.on[0] && T.on[1]) T.s = Math.min(1, T.s + dt * T.rate);
                return T.s >= 1 && off < 0.02 && lined && !swinging();
            }
            case 'wait': return !!mv.fn();
            case 'call': mv.fn(); return true;
        }
        return true;
    }
    // Drive to a spot as an operator does on a skid-steer: turn toward it on the spot when it
    // is well off to one side, else drive at it steering in, slowing as it comes up; there,
    // stop and turn on the spot to face the way it is to stand. Done when it is there, square
    // and still.
    // Drive as a driver does with a load standing on the deck: speeding up, braking and turning
    // no harder than tips what stands tallest on its footing (with something to spare), or
    // slides it; empty, as hard as it goes.
    function gently(mv, dt, u, v) {
        if (mv.a == null) {
            const a = 9.81 * deckHold(site, m);
            const V = m.controls.find((ct) => ct.kind === 'drive');
            mv.a = a; mv.cu = V ? V.u : 0; mv.cv = V ? V.v : 0; mv.top = rideOf(m.contract).speed;
        }
        if (!isFinite(mv.a)) { m.drive(u, v); return; }
        const k = (mv.a * dt) / mv.top, to = (x, y) => x + Math.max(-k, Math.min(k, y - x));
        mv.cu = to(mv.cu, u);
        // Turning swings what is on the deck round: as fast as keeps it from being thrown, on the
        // spot (anywhere on the deck) and on the move (sideways as it goes round).
        const B = rideOf(m.contract).bed, track = acrossOf(m) * 1.6, reachOut = Math.hypot(...B.half);
        const w = Math.min(Math.sqrt(mv.a / reachOut), mv.a / (Math.abs(mv.cu) * mv.top + 1e-3));
        const vmax = Math.min(1, (w * track) / (2 * mv.top));
        mv.cv = to(mv.cv, Math.max(-vmax, Math.min(vmax, v)));
        m.drive(mv.cu, mv.cv);
    }
    function driveTo(mv, dt) {
        const go = (u, v) => gently(mv, dt, u, v);
        const end = typeof mv.at === 'function' ? mv.at() : mv.at;
        // Standing where something reaches (beside a crane, by its jib): out straight the way it
        // faces, forward or back, whichever leaves sooner, before turning, as a driver pulls
        // out; turning there swings its ends into what it stands by.
        if (!mv.cost) {
            mv.cost = groundCost(site, m);
            const h = m.heading(), p = m.mid, c = (k) => mv.cost(p[0] + k * h[0], p[1] + k * h[1]);
            // (On feet it turns where it stands, its legs stepping round: no need to pull out.)
            if (mv.cost(...p) > 0 && !m.gait) mv.out = { sign: c(1.5) <= c(-1.5) ? 1 : -1, from: p.slice() };
        }
        if (mv.out) {
            const p = m.mid, gone = Math.hypot(p[0] - mv.out.from[0], p[1] - mv.out.from[1]);
            if (mv.cost(...p) > 0 && gone < 3) { go(0.4 * mv.out.sign, 0); return false; }
            mv.out = null;
        }
        // The way round what stands between, worked out as it sets off; on through each turn.
        // Facing a way at the end: it comes in straight along it, from a little way back, so it
        // stands there square without turning on the spot (which would swing its ends round).
        if (!mv.path) {
            if (mv.heading && !mv.hd) {
                let hd = typeof mv.heading === 'function' ? mv.heading() : mv.heading;
                if (!mv.exact && hd[0] * (end[0] - m.mid[0]) + hd[1] * (end[1] - m.mid[1]) < 0) hd = [-hd[0], -hd[1]];
                mv.hd = hd;
            }
            const back = mv.hd && Math.hypot(end[0] - m.mid[0], end[1] - m.mid[1]) > 3 ? [end[0] - mv.hd[0] * 2.2, end[1] - mv.hd[1] * 2.2] : null;
            mv.path = [m.mid.slice(), ...(back ? [...routeOver(mv.cost, m.mid, back), end] : routeOver(mv.cost, m.mid, end))];
            mv.seg = 0;
        }
        // Along the way, not at its turns: from the nearest point on it, at a point a little
        // further on (as a driver looks down the road), so it keeps to the line the way was
        // worked out on, clear of what it goes round, and is not drawn across a corner.
        const pos = m.mid, P = mv.path;
        P[P.length - 1] = end;
        const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const tOn = (a, b) => { const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2; return l2 ? Math.max(0, Math.min(1, ((pos[0] - a[0]) * ab[0] + (pos[1] - a[1]) * ab[1]) / l2)) : 1; };
        while (mv.seg < P.length - 2 && tOn(P[mv.seg], P[mv.seg + 1]) >= 1) mv.seg++;
        // Or on to a later stretch it has come nearer to.
        if (mv.seg < P.length - 2) {
            const dTo = (i) => { const q = lerp(P[i], P[i + 1], tOn(P[i], P[i + 1])); return Math.hypot(q[0] - pos[0], q[1] - pos[1]); };
            if (dTo(mv.seg + 1) < dTo(mv.seg)) mv.seg++;
        }
        let q = lerp(P[mv.seg], P[mv.seg + 1], tOn(P[mv.seg], P[mv.seg + 1])), rem = 1.2, i = mv.seg, toEnd = 0;
        for (let k = mv.seg; k < P.length - 1; k++) toEnd += Math.hypot(P[k + 1][0] - (k === mv.seg ? q[0] : P[k][0]), P[k + 1][1] - (k === mv.seg ? q[1] : P[k][1]));
        for (;;) {
            const b = P[i + 1], l = Math.hypot(b[0] - q[0], b[1] - q[1]);
            if (l >= rem) { q = lerp(q, b, rem / l); break; }
            rem -= l; q = b;
            if (++i >= P.length - 1) break;
        }
        const last = toEnd < 1.2, at = last ? end : q;
        const h = m.heading(), d = [at[0] - pos[0], at[1] - pos[1]], dist = last ? Math.hypot(...d) : toEnd;
        const ang = (f) => Math.atan2(-f[0] * h[1] + f[1] * h[0], f[0] * h[0] + f[1] * h[1]);   // + to the right
        const tol = Math.max(0.08, m.size * 0.04), V = m.controls.find((ct) => ct.kind === 'drive');
        const speed = Math.abs(m.groundSpeed());
        if (!mv.arrived && (dist > tol || !last)) {
            // The last of the way, the spot straight ahead or behind: on or back onto it, not
            // round in a circle to come at it again.
            if (last && dist < 1) {
                const al = d[0] * h[0] + d[1] * h[1], ac = -d[0] * h[1] + d[1] * h[0];
                if (Math.abs(ac) < Math.max(tol, 0.1)) { go(Math.sign(al) * Math.max(0.12, Math.min(1, Math.abs(al) / 1.2)), 0); return false; }
            }
            let e = ang(d);
            // On feet it walks back as well as forward: toward whichever end faces the way more
            // nearly, so it turns round as little as it can (it changes ends only well past even).
            if (m.gait) {
                const eb = Math.atan2(Math.sin(e - Math.PI), Math.cos(e - Math.PI));
                if (mv.back ? Math.abs(e) + 0.4 < Math.abs(eb) : Math.abs(eb) + 0.4 < Math.abs(e)) mv.back = !mv.back;
                if (mv.back) e = eb;
            }
            const turnOnly = Math.abs(e) > 0.6 && Math.hypot(...d) > tol * 2;
            // Slowing only for the end of the way; through a turn, as fast as its heading allows.
            let u = (turnOnly ? 0 : Math.min(1, dist / 2.5) * Math.max(0.2, Math.cos(e))) * (mv.back ? -1 : 1);
            // Coming up to a sharp turn: slow, so it goes round on the way and not wide of it.
            if (mv.seg < P.length - 2) {
                const a = P[mv.seg], b = P[mv.seg + 1], c = P[mv.seg + 2];
                const u1 = [b[0] - a[0], b[1] - a[1]], u2 = [c[0] - b[0], c[1] - b[1]];
                const cs = (u1[0] * u2[0] + u1[1] * u2[1]) / ((Math.hypot(...u1) * Math.hypot(...u2)) || 1);
                const cap = 0.3 + 0.7 * Math.max(0, cs) + Math.hypot(b[0] - pos[0], b[1] - pos[1]) / 3;
                u = Math.sign(u) * Math.min(Math.abs(u), cap);
            }
            go((mv.back ? -1 : 1) * Math.max(0.12, Math.abs(u)) * (turnOnly ? 0 : 1), Math.max(-1, Math.min(1, e * 1.6)));
            return false;
        }
        mv.arrived = true;
        if (mv.heading) {
            if (!mv.hd) mv.hd = typeof mv.heading === 'function' ? mv.heading() : mv.heading;
            // Its deck is the same either way round: square to whichever of the two is nearer (or the one asked for).
            let e = ang(mv.hd);
            if (!mv.exact && Math.abs(e) > Math.PI / 2) e -= Math.sign(e) * Math.PI;
            if (Math.abs(e) > 0.03) { go(0, Math.max(-0.5, Math.min(0.5, e * 1.5)) || 0); return false; }
        }
        go(0, 0);
        // Still: its wheels stopped, or its feet all down.
        return speed < 0.02 && Math.abs(V && V.joints.length ? m.rates[V.joints[0]] : 0) < 0.05 && (!m.gait || m.gait.doing === 'standing');
    }
    return p;
}

/**
 * Who carries `crate` to `pad`: [{ machine, from: [x, z], to: [x, z] }], one leg per
 * machine, each from where it takes the crate to where it sets it down; null if no
 * chain of the site's machines reaches.
 */
export function planDelivery(site, crate, dest, taken = []) {
    const E = site.liftPoint(crate), from = [E[0], E[2]], to = [dest.at[0], dest.at[2]];
    const tol = dest.tol;
    const ok = (m, at) => reaches(m, at, Math.max(0.02, tol));
    // The cranes that lift it on their own.
    const ms = site.machines.filter((m) => m.hook && liftOf(m) >= crate.kg);
    // Machines on wheels with no hook of their own: carriers, to take a crate between two
    // cranes too far apart to share a spot on the ground.
    const carriers = site.machines.filter((m) => !m.hook && rideOf(m.contract));
    const starts = ms.filter((m) => ok(m, from));
    // Breadth first over hand-overs: a spot on the ground both of a pair reach, or failing
    // that a carrier loaded where the one reaches and driven to where the other does.
    const seen = new Map(starts.map((m) => [m, null]));
    const q = [...starts];
    while (q.length) {
        const a = q.shift();
        if (ok(a, to)) {
            // The chain back to the start; each crane's leg from where it takes the crate (the
            // crate, a spot, a carrier's deck) to where it sets it down, a haul between cranes.
            const chain = [];
            for (let m = a; m; m = seen.get(m) ? seen.get(m).from : null) chain.unshift({ m, link: seen.get(m) });
            const end = (link) => (link.spot ? link.spot : { deck: link.haul.machine });
            const legs = [];
            chain.forEach(({ m, link }, i) => {
                const next = chain[i + 1] && chain[i + 1].link;
                if (link && link.haul) legs.push({ machine: link.haul.machine, haul: true, from: link.haul.load, to: link.haul.unload });
                legs.push({ machine: m, from: link ? end(link) : from, to: next ? end(next) : to });
            });
            return legs;
        }
        for (const b of ms) {
            if (seen.has(b)) continue;
            const spot = handover(site, a, b, crate, ok, taken);
            if (spot) { seen.set(b, { from: a, spot }); q.push(b); continue; }
            for (const v of carriers) {
                const load = parkBy(site, a, v, b.mid, ok, crate), unload = load && parkBy(site, b, v, a.mid, ok, crate);
                if (load && unload) { seen.set(b, { from: a, haul: { machine: v, load, unload } }); q.push(b); break; }
            }
        }
    }
    return null;
}

/**
 * What crane `m` lifts (kg) anywhere it reaches: what its joints lift at its tip at full
 * reach (the compiler's), and no more than its winch pulls.
 */
export function liftOf(m) {
    if (!m.hook) return 0;
    const ms = m.contract.mounts || [];
    const arm = ms.length ? Math.min(...ms.map((x) => x.payloadKg)) : Infinity;
    return Math.min(arm, m.hook.pull / 9.81);
}

/** Where a task wants its crate: { at [x, y, z], tol (m over the ground), yaw? }. */
export function destOf(t) {
    if (t.kind === 'place') return { at: t.at, tol: t.tol, yaw: t.yaw };
    const s = t.crate.size, h = t.pad.half[0];
    return { at: t.pad.at, tol: Math.min(s * 0.3, h - s * 0.3 > 0 ? h - s * 0.3 : s * 0.2) };
}

/**
 * Two cranes to lift `piece` together (too heavy for one), each taking one end, and carry it
 * to `dest` turned to dest.yaw: { a, b, pick: [[x, z], [x, z]], put: [[x, z], [x, z]] }
 * (pick[0], put[0] are a's), or null. Each end is in from the piece's end by a tenth of its
 * length, so each crane carries half; both reach their end where it lies, where it goes, and
 * on the way between.
 */
export function planTandem(site, piece, dest) {
    const P = site.world.pose(piece.body), q = [P[3], P[4], P[5], P[6]];
    const long = piece.half[0] >= piece.half[2] ? 0 : 2, e = piece.half[long] * 0.8;
    const ax = (yaw) => (long === 0 ? [Math.cos(yaw), -Math.sin(yaw)] : [Math.sin(yaw), Math.cos(yaw)]);
    const f = (() => { const v = [0, 0, 0]; v[long] = 1; const w = qRot(q, v); return [w[0], w[2]]; })();
    const y0 = Math.atan2(-f[1], f[0]) - (long === 0 ? 0 : -Math.PI / 2);
    const tol = Math.max(0.02, dest.tol);
    const share = piece.kg / 2;
    const cranes = site.machines.filter((m) => m.hook && liftOf(m) >= share);
    // The way: the middle straight from where it lies to where it goes, turning the short way round.
    let dy = (((dest.yaw - y0) % Math.PI) + Math.PI) % Math.PI; if (dy > Math.PI / 2) dy -= Math.PI;
    const way = (s, k) => {
        const c = [P[0] + (dest.at[0] - P[0]) * s, P[2] + (dest.at[2] - P[2]) * s], a = ax(y0 + dy * s);
        return [c[0] + k * e * a[0], c[1] + k * e * a[1]];
    };
    let best = null;
    for (const a of cranes) for (const b of cranes) {
        if (a === b) continue;
        // a takes the +end; the pair works if each reaches its end all the way.
        const fine = [0, 0.25, 0.5, 0.75, 1].every((s) => reaches(a, way(s, 1), tol) && reaches(b, way(s, -1), tol));
        if (!fine) continue;
        // Of the pairs that do, the one whose cranes stand nearest their ends.
        const cost = Math.hypot(a.mid[0] - way(0.5, 1)[0], a.mid[1] - way(0.5, 1)[1]) + Math.hypot(b.mid[0] - way(0.5, -1)[0], b.mid[1] - way(0.5, -1)[1]);
        if (!best || cost < best.cost) best = { a, b, cost, way, pick: [way(0, 1), way(0, -1)], put: [way(1, 1), way(1, -1)] };
    }
    return best;
}

// How far out from where crane `m` stands its base goes over the ground (what never swings).
function baseRadius(m) {
    let r = 0;
    for (const b of solidsOf(m.contract)) {
        if (b.carrier != null) continue;
        for (const p of cornersOf(b)) { const w = frameApply(m.place, p); r = Math.max(r, Math.hypot(w[0] - m.mid[0], w[2] - m.mid[1])); }
    }
    return r;
}

/**
 * A way over the ground for machine `v` on wheels from `from` to `to` ([x, z] each) around
 * what stands there: other machines (a crane with what swings round it low enough to hit
 * its deck or a load on it), pieces not on its own deck, people. A grid of quarter metres
 * searched for the cheapest way, where ground within reach of something costs dear, then
 * pulled straight between the turns it needs: waypoints [[x, z], ...] ending at `to`.
 */
export function routeOf(site, v, from, to) {
    const cost = groundCost(site, v);
    return routeOver(cost, from, to);
}

/**
 * What ground costs machine `v` on wheels to stand on, [x, z] → 0 where it is clear of
 * everything, more the further it is into the reach of something (a crane's low sweep, a
 * piece, a person): what routeOf goes round.
 */
export function groundCost(site, v) {
    const w = acrossOf(v) + 0.15, deckY = v.bedWorld().center[1];
    const rings = [];
    for (const o of site.machines) {
        if (o === v) continue;
        const r = o.hook ? Math.max(baseRadius(o), sweepRadius(o, deckY + 1)) : rideOf(o.contract) ? Math.hypot(...rideOf(o.contract).half) : baseRadius(o);
        rings.push([o.mid[0], o.mid[1], r + w]);
    }
    for (const cr of site.crates) {
        const P = site.poseOf(cr);
        if (site.under(P[0], P[2], P[1], cr).machine === v || site.machines.some((o) => o.hook && o.hook.crate === cr)) continue;
        rings.push([P[0], P[2], cr.size * 0.75 + w]);
    }
    for (const p of site.people) { const P = site.poseOf(p); rings.push([P[0], P[2], p.radius + w]); }
    // Where pieces are to go, there or not yet.
    for (const t of site.tasks) if (t.kind === 'place') rings.push([t.at[0], t.at[2], t.crate.size * 0.75 + w]);
    // Dear inside a ring; a little dear in a band round it, so a way keeps off its edge.
    const band = 0.6;
    // Ground steeper than it takes with what it carries now (its contract's grade with a margin,
    // and what its load holds to: deckHold) is as dear as a ring; up to that, steeper is dearer,
    // so a way keeps to the gentle.
    const R = rideOf(v.contract), V = v.contract.vehicle, kg = site.crates.filter((cr) => { const P = site.poseOf(cr); return site.under(P[0], P[2], P[1], cr).machine === v; }).reduce((s, cr) => s + cr.kg, 0);
    const climbs = V ? Math.min(Math.tan(Math.max(0.02, gradeOf(V, V.massKg + kg))) * 0.75, deckHold(site, v)) : Infinity, e = 0.3;
    // How steep: the most of the slope right there and of the ground across all of it (the rise
    // under its width, and a little, over that), so a way along the top of a bank keeps a wheel off it.
    const ring8 = [...Array(8)].map((_, k) => [Math.cos(k * Math.PI / 4) * (w + 0.4), Math.sin(k * Math.PI / 4) * (w + 0.4)]);
    const steep = (x, z) => {
        const y = ring8.map(([a, b]) => site.groundAt(x + a, z + b)), local = Math.hypot(site.groundAt(x + e, z) - site.groundAt(x - e, z), site.groundAt(x, z + e) - site.groundAt(x, z - e)) / (2 * e);
        return Math.max(local, (Math.max(...y) - Math.min(...y)) / (2 * (w + 0.4)));
    };
    // On feet, it steps up and down what it stands on (round where its feet go), level, as far
    // as its feet clear.
    const ringF = R.walker ? [...Array(8)].map((_, k) => [Math.cos(k * Math.PI / 4) * R.feet, Math.sin(k * Math.PI / 4) * R.feet]) : null;
    const rise = (x, z) => { const y = ringF.map(([a, b]) => site.groundAt(x + a, z + b)); y.push(site.groundAt(x, z)); return Math.max(...y) - Math.min(...y); };
    const grade = (x, z) => { const s = R.walker ? rise(x, z) / STEP_M : steep(x, z) / climbs; return s > 1 ? 40 * s : 4 * s * s; };
    return (x, z) => grade(x, z) + rings.reduce((s, [cx, cz, r]) => { const d = Math.hypot(x - cx, z - cz); return d < r ? s + 40 * (1 + (r - d) / r) : d < r + band ? s + 2 * (r + band - d) / band : s; }, 0);
}

function routeOver(cost, from, to) {
    // The grid: round both ends and everything there, with room to go round.
    const H = 0.25;
    // As far again round as most of the way is long: a way round a wall may go well aside.
    const M = Math.max(6, 0.75 * Math.hypot(to[0] - from[0], to[1] - from[1]));
    const x0 = Math.min(from[0], to[0]) - M, x1 = Math.max(from[0], to[0]) + M, z0 = Math.min(from[1], to[1]) - M, z1 = Math.max(from[1], to[1]) + M;
    const nx = Math.ceil((x1 - x0) / H) + 1, nz = Math.ceil((z1 - z0) / H) + 1;
    const at = (i, k) => [x0 + i * H, z0 + k * H], idx = (i, k) => k * nx + i;
    const cellOf = (p) => [Math.round((p[0] - x0) / H), Math.round((p[1] - z0) / H)];
    const pen = new Float32Array(nx * nz);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pen[idx(i, k)] = cost(...at(i, k));
    const [si, sk] = cellOf(from), [gi, gk] = cellOf(to), goal = idx(gi, gk);
    const g = new Float32Array(nx * nz).fill(Infinity), prev = new Int32Array(nx * nz).fill(-1), shut = new Uint8Array(nx * nz);
    const open = [[0, idx(si, sk)]]; g[idx(si, sk)] = 0;
    const hz = (c) => Math.hypot((c % nx) - gi, Math.floor(c / nx) - gk) * H;
    const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
        // The cheapest open cell (a short list: the grid is small).
        let b = 0; for (let j = 1; j < open.length; j++) if (open[j][0] < open[b][0]) b = j;
        const [, c] = open[b]; open[b] = open[open.length - 1]; open.pop();
        if (shut[c]) continue;
        shut[c] = 1;
        if (c === goal) break;
        const ci = c % nx, ck = Math.floor(c / nx);
        for (const [di, dk] of N8) {
            const i = ci + di, k = ck + dk;
            if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
            const n = idx(i, k), step = Math.hypot(di, dk) * H, ng = g[c] + step * (1 + pen[n]);
            if (ng < g[n]) { g[n] = ng; prev[n] = c; open.push([ng + hz(n), n]); }
        }
    }
    if (prev[goal] < 0 && goal !== idx(si, sk)) return [to];
    const cells = [];
    for (let c = goal; c >= 0; c = prev[c]) cells.unshift(at(c % nx, Math.floor(c / nx)));
    // Pulled straight: from each turn, on to the furthest point of the way it sees over ground no
    // dearer than the way between goes over.
    const along = (j, k) => { let m = 0; for (let i = j; i <= k; i++) m = Math.max(m, cost(...cells[i])); return m; };
    const worst = (a, b) => { let m = 0; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (H * 0.5)); for (let s = 0; s <= n; s++) m = Math.max(m, cost(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n)); return m; };
    const way = [];
    let a = from, j = 0;
    while (j < cells.length - 1) {
        let k = cells.length - 1;
        while (k > j + 1 && worst(a, cells[k]) > along(j, k) + 1e-6) k--;
        way.push(cells[k]); a = cells[k]; j = k;
    }
    way[way.length - 1] = to;
    return way.length ? way : [to];
}

// How far machine `v` on wheels or feet reaches out to either side of its middle, wheels or legs and all.
export function acrossOf(v) { return rideOf(v.contract).across; }

// How far out from where crane `m` stands what turns with it and does not lift (a jib on its
// slewing ring) sweeps below height `y`: round it a carrier's deck and its load stand clear.
export function sweepRadius(m, y) {
    const root = m.contract.joints.findIndex((J) => J.upright && J.parent == null);
    if (root < 0) return 0;
    const S = solidsOf(m.contract), boxes = m._boxes();
    let r = 0;
    S.forEach((b, i) => {
        if (b.carrier !== root) return;
        const B = boxes[i], low = B.c[1] - B.axes.reduce((s, a) => s + Math.abs(a[1]), 0);
        if (low >= y) return;
        const out = B.axes.reduce((s, a) => s + Math.hypot(a[0], a[2]), 0);
        r = Math.max(r, Math.hypot(B.c[0] - m.mid[0], B.c[2] - m.mid[1]) + out);
    });
    return r;
}

// Where carrier `v` stands to be loaded or unloaded by crane `m`: side-on to it, its deck's
// middle where the crane reaches, clear of the crane's base, of the other machines, of the
// crates and pads, on the side of the crane nearest `toward`; a walker only where the crane's
// tip stands high enough over its deck, let down kneeling, to bring `crate` in over the legs
// round it.
// { at: [x, z], heading: [x, z] }.
function parkBy(site, m, v, toward, ok, crate) {
    const deckY = v.bedWorld().center[1] - (v.gait ? KNEEL_M : 0), overY = deckY + 2 * crate.half[1] + 0.5;
    const over = (p) => { const r = reach(m, p); return !!r && r.tip[1] >= overY; };
    const R = rideOf(v.contract), half = [R.half[0] + 0.15, R.half[1] + 0.25];
    // Side-on to the crane, as a flatbed stands; nose-in when it is wider than it is long (a
    // walker, its legs out to the side), so its legs keep out of what the crane swings.
    const nose = R.half[1] > R.half[0];
    // Clear of its base, and of what swings round with it low enough to hit the deck or a load on it.
    const c = m.mid, a0 = Math.atan2(toward[1] - c[1], toward[0] - c[0]);
    const toCrane = nose ? half[0] : half[1], out = nose ? R.half[0] : acrossOf(v), deckIn = nose ? R.bed.half[0] : R.bed.half[1];
    const r0 = Math.max(baseRadius(m) + toCrane + 0.3, sweepRadius(m, v.bedWorld().center[1] + 1) + out + 0.15);
    const clear = (S, hd) => {
        const along = (p) => Math.abs((p[0] - S[0]) * hd[0] + (p[1] - S[1]) * hd[1]), across = (p) => Math.abs(-(p[0] - S[0]) * hd[1] + (p[1] - S[1]) * hd[0]);
        const inside = (p, g) => along(p) < half[0] + g && across(p) < half[1] + g;
        return site.machines.every((o) => o === v || o === m || Math.hypot(o.mid[0] - S[0], o.mid[1] - S[1]) > baseRadius(o) + half[0] + 0.3)
            && site.crates.every((cr) => { const P = site.world.pose(cr.body); return !inside([P[0], P[2]], cr.size); })
            && site.pads.every((p) => !inside([p.at[0], p.at[2]], p.half[0]))
            // Nor where a piece is to go.
            && site.tasks.every((t) => t.kind !== 'place' || !inside([t.at[0], t.at[2]], t.crate.size))
            // On level ground: not with a wheel down a bank.
            && level(site, [-1, 1].flatMap((i) => [-1, 1].map((j) => [S[0] + hd[0] * half[0] * i - hd[1] * half[1] * j, S[1] + hd[1] * half[0] * i + hd[0] * half[1] * j])));
    };
    for (let r = r0; r < r0 + 4; r += 0.1) {
        for (let k = 0; k < 36; k++) {
            const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
            const S = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], hd = nose ? [-Math.cos(a), -Math.sin(a)] : [-Math.sin(a), Math.cos(a)];
            // The load goes on the near half of its deck, where the crane reaches; on a walker, on
            // its middle, so it comes to either crane with either end toward it, turning round for neither.
            const inset = R.walker ? 0 : Math.max(0, deckIn - 0.3);
            const inner = [S[0] - Math.cos(a) * inset, S[1] - Math.sin(a) * inset];
            if (ok(m, inner) && clear(S, hd) && (!v.gait || over(inner))) return { at: S, heading: hd };
        }
    }
    return null;
}

/**
 * What the loads on machine v's deck hold to, as a fraction of g: no more than tips what
 * stands tallest on its footing (with something to spare), or slides it; Infinity when the
 * deck is empty. How hard it speeds up, brakes and turns, and how steep a slope it takes
 * (a slope pulls a load down it by as much), are kept within it.
 */
export function deckHold(site, v) {
    let a = Infinity;
    for (const cr of site.crates) {
        const P = site.poseOf(cr);
        if (site.under(P[0], P[2], P[1], cr).machine !== v) continue;
        const q = [P[3], P[4], P[5], P[6]];
        const foot = Math.min(...[0, 1, 2].filter((i) => { const e = [0, 0, 0]; e[i] = 1; return Math.abs(qRot(q, e)[1]) < 0.7; }).map((i) => cr.half[i]));
        a = Math.min(a, 0.4 * Math.min(foot / site.reachY(cr), 0.5));
    }
    return a;
}

// Whether the ground is level under the points [x, z] (within 3 cm).
function level(site, pts) {
    const y = pts.map((p) => site.groundAt(p[0], p[1]));
    return Math.max(...y) - Math.min(...y) < 0.03;
}

// A clear spot on the ground that both `a` and `b` reach, nearest the middle between them.
function handover(site, a, b, crate, ok, taken) {
    const ma = a.mid, mb = b.mid, c = [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2];
    const span = Math.max(a.size, b.size) * 1.5;
    const clear = (s) => site.crates.every((cr) => {
        if (cr === crate) return true;
        const P = site.world.pose(cr.body);
        return Math.hypot(P[0] - s[0], P[2] - s[1]) > (cr.size + crate.size) * 0.8;
    }) && taken.every((t) => Math.hypot(t[0] - s[0], t[1] - s[1]) > crate.size * 2) && site.machines.every((m) => Math.hypot(m.mid[0] - s[0], m.mid[1] - s[1]) > crate.size + m.size * 0.2)
        && level(site, [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => [s[0] + i * crate.size * 0.6, s[1] + j * crate.size * 0.6]));
    const cands = [];
    for (let r = 0; r <= span; r += crate.size * 0.75) {
        const n = Math.max(1, Math.round((TAU * r) / (crate.size * 0.75)));
        for (let k = 0; k < n; k++) cands.push([c[0] + r * Math.cos((k / n) * TAU), c[1] + r * Math.sin((k / n) * TAU)]);
    }
    for (const s of cands) if (clear(s) && ok(a, s) && ok(b, s)) return s;
    return null;
}

/** Queue one machine's leg: take the crate where it is, set it down at `to`, stand clear. */
// The ground between two machines that hand crates over there is one work zone: one
// machine works in it at a time (zones: key → the machine in it), as a crew does, so
// two booms never swing through it together. A machine takes the zone it is handed
// from before it reaches in, and the zone it hands on to before it carries the crate
// in, and lets each go once it is clear of it. Zones are taken in the order crates
// travel, so no two machines ever wait on one another.
function queueLeg(p, crate, leg, after, zones, zoneFrom, zoneTo, ready, crateAt, deps, depsLabel) {
    const m = p.machine;
    const take = (key) => p.wait(() => { const h = zones.get(key); if (h && h !== m) return false; zones.set(key, m); return true; }, 'waiting for room at the hand-over');
    const free = (key) => p.then(() => { if (zones.get(key) === m) zones.delete(key); });
    // Out of the way of the spot it is handed the crate at while the one before brings it.
    if (after) p.lineIn().clearOf(leg.from).wait(after, typeof leg.from === 'function' ? 'waiting for the carrier' : 'waiting for the hand-over');
    // What it goes on has to be there first.
    if (deps) p.lineIn().wait(deps, depsLabel);
    if (zoneFrom) take(zoneFrom);
    p.lineIn()
        .reach(typeof leg.from === 'function' ? crateAt : leg.from, `over ${crate.name}`)
        .take(crate);
    if (zoneTo) take(zoneTo);
    // A carrier's deck: wait for it to stand there before reaching over it.
    if (ready) p.wait(ready, 'waiting for the carrier');
    p.reach(leg.to, `carrying ${crate.name}`);
    if (zoneFrom) free(zoneFrom);
    // On a deck: what would fall over of its own is laid along it, on the strip the crane
    // reaches (the side toward it), where the next crane reaches it too.
    const deck = leg.toDeck;
    p.setDown(deck ? { lay: () => { const a = deck.bedWorld().axes[0]; return { way: [a[0], a[2]] }; } } : { guide: Array.isArray(leg.to) ? leg.to : null })
        .lineIn()
        .clearOf(leg.to)
        .then(() => { leg.done = true; });
    if (zoneTo) free(zoneTo);
}

/**
 * The site's crew: runs its open deliveries with its machines. Each delivery is
 * planned (planDelivery) and its legs queued on their machines' pilots; a leg
 * after a hand-over waits until the crate stands on the hand-over spot and the
 * machine that brought it is standing clear.
 */
export function crew(site, { player = null } = {}) {
    // The machine the player drives has no pilot: its legs are the player's to do, told
    // them as goals (goal()), and the crew sees each done from what stands where.
    const pilots = new Map(site.machines.filter((m) => m !== player).map((m) => [m, pilotOf(site, m)]));
    const jobs = [], taken = [], zones = new Map(), mine = [];
    const goalMark = { id: 'goal', kind: 'goal', at: [0, -10, 0], half: [0.3, 0.006, 0.3] };
    // The edge of a box the load is to be on: the side toward the crane.
    const sideMark = { id: 'goalSide', kind: 'goalSide', at: [0, -10, 0], half: [0.3, 0.008, 0.05] };
    // From the player's machine toward a goal out of the way: the way to go.
    const wayMarks = ['', 'L', 'R'].map((s) => ({ id: 'goalWay' + s, kind: 'goalWay', at: [0, -10, 0], half: s ? [0.4, 0.008, 0.06] : [1.2, 0.008, 0.06] }));
    // Two cranes lift one piece together: each lets its hook down on its end and holds it;
    // once both hold, they lift it and carry it along one way, the way moving on only while
    // both ends are on it, their hooks kept level so it rides level; there, both let it down
    // together and let go once it stands.
    function queueTandem(job, deps, depsLabel) {
        const tp = job.tandem, cr = job.task.crate, ms = [tp.a, tp.b];
        const len = Math.hypot(tp.put[0][0] - tp.pick[0][0], tp.put[0][1] - tp.pick[0][1]) + 0.5;
        const T = {
            s: 0, on: [false, false], hooked: [false, false], there: [false, false], slack: 0.08, rate: 0.25 / len,
            way: (s, i) => tp.way(s, i === 0 ? 1 : -1),
            line(i, m) { const y = ms.map((o) => o.tipWorld()[1]); return m.hook.reach * 1.5 + (y[i] - Math.min(...y)); },
        };
        job.together = T;
        ms.forEach((m, i) => {
            const p = pilots.get(m), other = ms[1 - i];
            p.lineIn();
            if (deps) p.wait(deps, depsLabel);
            p.reach(tp.pick[i], `over ${cr.name}'s end`)
                .take(cr, { lift: false })
                .then(() => { T.hooked[i] = true; })
                .wait(() => T.hooked[0] && T.hooked[1], `holding ${cr.name} for ${other.name}`)
                .track(T, i, `lifting ${cr.name} with ${other.name}`)
                .then(() => { T.there[i] = true; })
                .wait(() => T.there[0] && T.there[1], `waiting on ${other.name}`)
                .setDown()
                .lineIn()
                .clearOf(tp.put[i])
                .then(() => { job.legs[i].done = true; });
        });
    }
    // A leg of the player's: what it is to do now, read off the world each step ({ text, at }
    // or null once it is done), and the flags the crew's machines wait on, set as it is done.
    function playerLeg(t, leg, before, next, onDeck, deps, depsLabel, keys = []) {
        const v = leg.machine, cr = t.crate, n = cr.name;
        const still = () => Math.abs(v.groundSpeed ? v.groundSpeed() : 0) < 0.05;
        const xz = (p) => [p[0], p[2]], lift = () => xz(site.liftPoint(cr));
        const held = () => !!(v.hook && v.hook.crate === cr);
        // Standing on a spot to be loaded or unloaded: there, side-on, still, the crane reaching.
        const inBox = (S) => Math.hypot(v.mid[0] - S.at[0], v.mid[1] - S.at[1]) < 0.7 && still()
            && Math.abs(v.heading()[0] * S.heading[0] + v.heading()[1] * S.heading[1]) > Math.cos(0.45);
        const reaches = (m, at) => { const r = reach(m, at()); return r && r.err < 0.12; };
        const standsBy = (S, m, at) => inBox(S) && reaches(m, at);
        // Still in the box but where the crane does not reach: which way to ease, and how far.
        const ease = (m, at) => {
            const P = at(), r = reach(m, P), hd = v.heading();
            const way = (m.mid[0] - P[0]) * hd[0] + (m.mid[1] - P[1]) * hd[1] >= 0 ? 'forward' : 'back';
            return `${m.name} does not reach ${n} from there: ease ${way} about ${Math.max(0.1, r ? r.err : 0.3).toFixed(1)} m.`;
        };
        if (leg.haul) {
            const loader = before.machine, unloader = next.machine, box = rideOf(v.contract).bed.half;
            // On feet, the player kneels in the box (Space) for a crane to reach over its legs, and
            // stands up again to walk on; its load rides in the middle of its deck, either end toward a crane.
            const G = v.gait, down = () => !G || (G.kneeling && G.settled);
            const outHd = () => (G ? leg.to.heading : unloadHeading(site, v, cr, leg.to.heading));
            const walk = G ? 'Walk' : 'Drive';
            return { leg, update() {
                if (leg.finished) return null;
                if (leg.done) {
                    if (next.took && !onDeck(v)) {
                        if (G && G.kneeling) return { text: `${unloader.name} has taken ${n}: stand up (Space).`, at: null };
                        leg.finished = true; return null;
                    }
                    return { text: `Hold still: ${unloader.name} is taking ${n} off your deck.`, at: leg.to.at, heading: outHd(), size: box, toward: unloader.mid };
                }
                if (leg.loaded || (before.done && onDeck(v))) {
                    leg.loaded = true;
                    leg.parked = false;
                    if (G && G.kneeling && !inBox(leg.to)) return { text: `${n} is on your deck: stand up (Space) and walk it over to ${unloader.name}.`, at: leg.to.at, heading: outHd(), size: box, toward: unloader.mid };
                    if (standsBy(leg.to, unloader, lift) && down()) { leg.done = true; return this.update(); }
                    if (standsBy(leg.to, unloader, lift)) return { text: `Kneel (Space) for ${unloader.name} to take ${n} off your deck.`, at: leg.to.at, heading: outHd(), size: box, toward: unloader.mid };
                    return { text: inBox(leg.to) ? ease(unloader, lift) : `${walk} ${n} into the marked box by ${unloader.name}${G ? '' : ', the load on the side toward it'}.`, at: leg.to.at, heading: outHd(), size: box, toward: unloader.mid };
                }
                // Where the loading crane sets the load: the strip of the deck nearest it.
                const by = standsBy(leg.from, loader, before.to);
                leg.parked = by && down();
                if (by && !leg.parked) return { text: `Kneel (Space) for ${loader.name} to load ${n} on your deck.`, at: leg.from.at, heading: leg.from.heading, size: box, toward: loader.mid };
                return leg.parked ? { text: `Hold still: ${loader.name} is loading ${n} on your deck.`, at: leg.from.at, heading: leg.from.heading, size: box, toward: loader.mid }
                    : { text: inBox(leg.from) ? ease(loader, before.to) : `${walk} into the marked box by ${loader.name} to be loaded with ${n}.`, at: leg.from.at, heading: leg.from.heading, size: box, toward: loader.mid };
            } };
        }
        const where = (to, deck) => deck ? `on the ${deck.name}'s deck` : !next ? (t.kind === 'place' ? `where it goes (the blue mark)` : `on ${t.pad.name}`) : 'on the marked spot';
        const from = leg.fromDeck ? `off the ${leg.fromDeck.name}'s deck` : before ? 'from the marked spot' : 'where it is';
        const at = (to) => typeof to === 'function' ? to() : to;
        let handed = !before;
        return { leg, update() {
            if (leg.finished) return null;
            if (!handed) handed = before.haul ? before.done && onDeck(before.machine) : before.done && restsAt(site, cr, leg.from);
            if (!handed) return { text: `Wait for ${n}: ${before.machine.name} is bringing it.`, at: null };
            // The hand-over ground it works in, one machine at a time, as the crew does.
            const busy = keys.map((k) => zones.get(k)).find((o) => o && o !== v);
            if (busy) return { text: `Wait: ${busy.name} is working in the hand-over.`, at: null };
            for (const k of keys) zones.set(k, v);
            if (held()) {
                if (before && before.haul) leg.took = true;
                if (next && next.haul && !next.parked) return { text: `Hold ${n}: the ${next.machine.name} is coming to be loaded.`, at: null };
                if (!next && deps && !deps()) return { text: `Hold ${n}: ${depsLabel.replace('waiting for', 'it goes on')}.`, at: null };
                return { text: `Set ${n} down ${where(leg.to, leg.toDeck)}, then let it go (Space).`, at: at(leg.to) };
            }
            const there = next ? (next.haul ? onDeck(next.machine) : restsAt(site, cr, leg.to)) : t.done;
            if (there && !v.hook.crate) {
                // Set down where another takes it: the boom swung off it first, as the crew does.
                if (next) {
                    const S = at(leg.to), T = v.tipWorld();
                    if (Math.hypot(T[0] - S[0], T[2] - S[1]) < cr.size * 0.75 + 0.8) return { text: `Swing clear of ${n}: ${next.machine.name} takes it from there.`, at: null };
                }
                leg.done = true; leg.finished = true;
                for (const k of keys) if (zones.get(k) === v) zones.delete(k);
                return null;
            }
            return { text: `Let the hook down onto ${n} ${from} and take it (Space).`, at: lift() };
        } };
    }
    const c = {
        pilots, jobs, player,
        get failed() { for (const p of pilots.values()) if (p.failed) return p.failed; return jobs.find((j) => j.failed)?.failed || null; },
        get busy() { return [...pilots.values()].some((p) => p.busy) || mine.some((g) => !g.leg.finished); },
        /** What the player's machine is to do now: { text, at: [x, z] | null }, or null when it has nothing left. */
        goal() {
            for (const g of mine) { const r = g.update(); if (r) return r; }
            return null;
        },
        /** Plan and queue every open delivery. */
        assign() {
            site.marks.length = 0;
            if (player) site.marks.push(goalMark, sideMark, ...wayMarks);
            for (const t of site.tasks) {
                if (t.done || jobs.some((j) => j.task === t)) continue;
                const dest = destOf(t), where = t.kind === 'place' ? 'where it goes' : t.pad.name;
                // What it waits on: the tasks it stands on.
                const deps = (t.after || []).length ? () => t.after.every((d) => d.done) : null;
                const depsLabel = deps ? `waiting for ${t.after.map((d) => d.crate.name).join(' and ')}` : '';
                // Too heavy for any one crane: two take an end each.
                if (!site.machines.some((m) => m.hook && liftOf(m) >= t.crate.kg)) {
                    const tp = planTandem(site, t.crate, dest);
                    // Lifting together keeps two hooks to one way, step for step: the crew's cranes only.
                    const yours = tp && (tp.a === player || tp.b === player);
                    const job = { task: t, tandem: yours ? null : tp, legs: tp && !yours ? [{ machine: tp.a }, { machine: tp.b }] : null,
                        failed: yours ? `${t.crate.name} is lifted by ${tp.a.name} and ${tp.b.name} together, step for step: leave ${player.name} to the crew for it`
                            : tp ? null : `${t.crate.name} (${Math.round(t.crate.kg)} kg) is too heavy for one crane, and no two here reach it and ${where} together` };
                    if (yours) { jobs.push(job); continue; }
                    jobs.push(job);
                    if (tp) queueTandem(job, deps, depsLabel);
                    continue;
                }
                const legs = planDelivery(site, t.crate, dest, taken);
                // Mark the spots on the ground: the hand-overs, and where a carrier stands.
                const mark = (at, s) => site.marks.push({ id: `spot${site.marks.length}:${at.join(",")}`, kind: "spot", at: [at[0], site.groundAt(at[0], at[1]) + 0.002, at[1]], half: [s, 0.004, s] });
                if (legs) for (const l of legs.slice(1)) {
                    if (l.haul) { mark(l.from.at, 0.12); mark(l.to.at, 0.12); continue; }
                    if (!Array.isArray(l.from)) continue;
                    taken.push(l.from);
                    mark(l.from, t.crate.size * 0.8);
                }
                const job = { task: t, legs, failed: legs ? null : `nothing here lifts ${t.crate.name} and reaches from it to ${where}` };
                jobs.push(job);
                if (!legs) continue;
                const zoneOf = (a, b) => [a.name, b.name].sort().join(' · ');
                // Where a carrier's deck is now, over the ground; whether the crate stands on it.
                // Where on a carrier's deck a crane sets a load: the place on it nearest the crane, in
                // from its edges (alongside a truck, its near side; nose-in, its near end).
                const deckAt = (v, m) => () => {
                    const B = v.bedWorld(), d = [m.mid[0] - B.center[0], m.mid[1] - B.center[2]];
                    let p = [B.center[0], B.center[2]];
                    for (const k of [0, 1]) {
                        // (on a walker, the middle of its deck along it)
                        const a = B.axes[k], h = v.gait && k === 0 ? 0 : Math.max(0, B.half[k] - 0.3), o = Math.max(-h, Math.min(h, d[0] * a[0] + d[1] * a[2]));
                        p = [p[0] + a[0] * o, p[1] + a[2] * o];
                    }
                    return p;
                };
                const onDeck = (v) => { const P = site.poseOf(t.crate), u = site.under(P[0], P[2], P[1], t.crate), w = site.world.velocity(t.crate.body); return u.machine === v && Math.hypot(w[0], w[1], w[2]) < 0.05 && !site.machines.some((o) => o.hook && o.hook.crate === t.crate); };
                // Crane legs to and from a deck reach for where the deck is; the haul between
                // them drives to its loading spot, waits to be loaded, drives to the unloading spot.
                for (const l of legs) for (const k of ['from', 'to']) if (l[k] && l[k].deck) { l[k + 'Deck'] = l[k].deck; l[k] = deckAt(l[k].deck, l.machine); }
                legs.forEach((leg, i) => {
                    const p = pilots.get(leg.machine), before = legs[i - 1], next = legs[i + 1];
                    if (leg.machine === player) { const ground = (o) => o && !o.haul && Array.isArray(o.to);
                        mine.push(playerLeg(t, leg, before, next, onDeck, deps, depsLabel, [ground(before) ? zoneOf(before.machine, leg.machine) : null, next && !next.haul ? zoneOf(leg.machine, next.machine) : null].filter(Boolean))); return; }
                    if (leg.haul) {
                        // A walker kneels at each end, its deck let down to where the cranes reach over it,
                        // and stands up again to walk on.
                        const G = leg.machine.gait, kneel = (on, label) => G ? p.then(() => G.kneel(on)).wait(() => G.settled, label) : p;
                        p.driveTo(leg.from.at, leg.from.heading, 'driving to be loaded');
                        kneel(true, 'kneeling to be loaded')
                            .then(() => { leg.parked = true; })
                            .wait(() => before.done && onDeck(leg.machine), `waiting for ${t.crate.name}`)
                            .then(() => { leg.parked = false; });
                        kneel(false, 'standing up')
                            // To be unloaded with the side its load is lifted from toward the crane (its right faces
                            // the crane along the heading planned); a walker's load stands in the middle, either end toward it.
                            .driveTo(leg.to.at, () => (G ? leg.to.heading : unloadHeading(site, leg.machine, t.crate, leg.to.heading)), `carrying ${t.crate.name}`, { exact: !G });
                        kneel(true, 'kneeling to be unloaded')
                            .then(() => { leg.done = true; })
                            .wait(() => !onDeck(leg.machine) && (!next || next.took), 'being unloaded');
                        if (G) kneel(false, 'standing up');
                        return;
                    }
                    let after = null, ready = null;
                    if (before && before.haul) after = () => before.done && onDeck(before.machine);
                    else if (before) { let handed = false; after = () => handed || (handed = before.done && restsAt(site, t.crate, leg.from)); }
                    if (next && next.haul) ready = () => next.parked;
                    const ground = (o) => o && !o.haul && Array.isArray(o.to);
                    const from = p.queue.length;
                    queueLeg(p, t.crate, leg, after, zones, ground(before) ? zoneOf(before.machine, leg.machine) : null, next && !next.haul ? zoneOf(leg.machine, next.machine) : null, ready,
                        () => { const E = site.liftPoint(t.crate); return [E[0], E[2]]; }, !next ? deps : null, depsLabel);
                    // Taken off a deck: the carrier may go.
                    if (before && before.haul) p.queue.splice(p.queue.findIndex((mv, k) => k >= from && mv.kind === 'take') + 1, 0, { kind: 'call', fn: () => { leg.took = true; }, label: '' });
                });
            }
            return c;
        },
        /** Advance the site by `dt`, the pilots first. */
        step(dt) {
            const n = Math.max(1, Math.round(dt * site.timeScale * 60));
            for (let k = 0; k < n; k++) {
                for (const p of pilots.values()) p.tick(1 / 60);
                site.step(1 / 60 / site.timeScale);
            }
            // The player's legs read off the world (the flags the crew waits on with them); the
            // mark on the ground where its machine is to go next.
            if (player) {
                const g = c.goal();
                goalMark.at = g && g.at ? [g.at[0], site.groundAt(g.at[0], g.at[1]) + 0.003, g.at[1]] : [0, -10, 0];
                // A box to stand a machine on wheels in, turned the way it is to stand; else a spot.
                const half = g && g.size ? [g.size[0], 0.006, g.size[1]] : [0.3, 0.006, 0.3];
                goalMark.yaw = g && g.heading ? Math.atan2(-g.heading[1], g.heading[0]) : 0;
                goalMark.half = half;
                goalMark.id = `goal:${half[0]}:${half[2]}`;
                sideMark.at = [0, -10, 0]; for (const w of wayMarks) w.at = [0, -10, 0];
                if (g && g.at) {
                    const d = [g.at[0] - player.mid[0], g.at[1] - player.mid[1]], l = Math.hypot(...d), r = player.size * 0.5 + 0.6;
                    if (l > r + 2.6) {
                        // A shaft and a head, on the ground beside the machine, pointing the way.
                        const u = [d[0] / l, d[1] / l], c = [player.mid[0] + u[0] * (r + 1.2), player.mid[1] + u[1] * (r + 1.2)], tip = [c[0] + u[0] * 1.2, c[1] + u[1] * 1.2], y = Math.max(site.groundAt(...c), site.groundAt(...tip), site.groundAt(c[0] - u[0] * 1.2, c[1] - u[1] * 1.2)) + 0.006;
                        wayMarks[0].at = [c[0], y, c[1]]; wayMarks[0].yaw = Math.atan2(-u[1], u[0]);
                        [0.6, -0.6].forEach((a, i) => {
                            const b = Math.atan2(-u[1], u[0]) + Math.PI + a, w = [Math.cos(b), -Math.sin(b)];
                            wayMarks[i + 1].at = [tip[0] + w[0] * 0.36, y + 0.001, tip[1] + w[1] * 0.36]; wayMarks[i + 1].yaw = b;
                        });
                    }
                }
                if (g && g.at && g.toward && g.heading) {
                    const p = [-g.heading[1], g.heading[0]], s = Math.sign((g.toward[0] - g.at[0]) * p[0] + (g.toward[1] - g.at[1]) * p[1]) || 1, o = s * (half[2] - 0.05);
                    sideMark.at = [g.at[0] + p[0] * o, site.groundAt(g.at[0] + p[0] * o, g.at[1] + p[1] * o) + 0.005, g.at[1] + p[1] * o];
                    sideMark.yaw = goalMark.yaw; sideMark.half = [half[0], 0.008, 0.05]; sideMark.id = `goalSide:${half[0]}`;
                }
            }
        },
    };
    return c;
}

/** The way carrier v is to stand to be unloaded: the planned heading `hd` (its right
 *  toward the crane), or turned about if the crate's lift point is on its other side. */
function unloadHeading(site, v, crate, hd) {
    const B = v.bedWorld(), P = site.liftPoint(crate), a = B.axes[1];
    return (P[0] - B.center[0]) * a[0] + (P[2] - B.center[2]) * a[2] >= 0 ? hd : [-hd[0], -hd[1]];
}

function restsAt(site, crate, [x, z]) {
    const P = site.world.pose(crate.body), v = site.world.velocity(crate.body);
    return Math.hypot(P[0] - x, P[2] - z) < crate.size && Math.hypot(v[0], v[1], v[2]) < 0.05 && !site.machines.some((m) => m.hook && m.hook.crate === crate);
}
