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
//                       It raises an arm before swinging it, and lets a load down
//                       slowly over the last of the way, holding it from swinging
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
//                       clear, a piece waiting for the tasks it stands on

import { poseOf, frameApply, frameMul, tipOf, solidsOf, cornersOf, qRot } from "./operate.js";
import { RANGE } from "./site.js";

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
        /** Let the line down until the crate stands, then let it go. */
        setDown() { return p.push({ kind: 'set', label: 'setting down' }); },
        /** Back to where it was built. */
        park() { return p.push({ kind: 'park', label: 'parking' }); },
        /** Turn its tip away from [x, z], to the far side of where it stands. */
        clearOf(at) { return p.push({ kind: 'park', away: at, label: 'standing clear' }); },
        /** Drive (a machine on wheels) to stand at [x, z], facing `heading` ([x, z]) when given. */
        driveTo(at, heading, label) { return p.push({ kind: 'drive', at, heading, label: label || 'driving' }); },
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
    function steerTip(goal, xs) {
        const x = vars.map((ct) => m.angles[ct.joints[0]]);
        const tip = m.tipWorld();
        let e = [0, 0], ks = 0;
        if (m.hook.crate) {
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
                return steerTip(mv.target, mv.goal);
            }
            case 'park': return steer(mv.goal) && !swinging();
            case 'line': return lineTo(carry());
            case 'take': {
                const cr = mv.crate, P = site.world.pose(cr.body), top = site.liftPoint(cr)[1];
                // Taken: the line in until it hangs short under the tip.
                if (m.hook.crate === cr) {
                    if (!mv.lift) return true;
                    const d = lineTo(carry()); const t = m.tipWorld(); return steerTip([t[0], t[2]], null) && d;
                }
                if (m.reachable() === cr && m.hookWorld()[1] - top < m.hook.reach) { m.hoist(0); m.grab(); return false; }
                // Down onto it.
                m.hoist(-Math.max(0.15, Math.min(1, (m.hookWorld()[1] - top) / Math.max(0.05, m.hook.speed * 0.3))));
                return m.hook.line >= m.hook.maxLine - 1e-6 ? 'fail' : false;
            }
            case 'set': {
                if (!m.hook.crate) return true;
                const cr = m.hook.crate, tip = m.tipWorld(), slack = m.hook.line > Math.hypot(...m.hookWorld().map((v, i) => v - tip[i])) + m.hook.reach * 0.2;
                if (!mv.at) mv.at = [tip[0], tip[2]];
                if ((!m.carrying() || slack) && !swinging()) { m.hoist(0); m.release(); return false; }
                // Hold the tip over the spot, following the load to damp its swing, and let it
                // down: briskly while it is well clear of what it goes on, slowly over the last of
                // the way, and not at all while it swings there.
                steerTip(mv.at, null);
                const gap = site.world.pose(cr.body)[1] - cr.half[1] - site.support(cr).y;
                const near = gap < Math.max(0.15, cr.size * 0.5);
                m.hoist(near && swinging() ? 0 : near ? -0.12 : -0.5);
                return false;
            }
            case 'drive': return driveTo(mv);
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
    function driveTo(mv) {
        const at = typeof mv.at === 'function' ? mv.at() : mv.at;
        const h = m.heading(), pos = m.mid, d = [at[0] - pos[0], at[1] - pos[1]], dist = Math.hypot(...d);
        const ang = (f) => Math.atan2(-f[0] * h[1] + f[1] * h[0], f[0] * h[0] + f[1] * h[1]);   // + to the right
        const tol = Math.max(0.08, m.size * 0.04), V = m.controls.find((ct) => ct.kind === 'drive');
        const speed = Math.abs(m.groundSpeed());
        if (!mv.arrived && dist > tol) {
            const e = ang(d);
            const turnOnly = Math.abs(e) > 0.6 && dist > tol * 2;
            const u = turnOnly ? 0 : Math.min(1, dist / 2.5) * Math.max(0.2, Math.cos(e));
            m.drive(Math.max(0.12, u) * (turnOnly ? 0 : 1), Math.max(-1, Math.min(1, e * 1.6)));
            return false;
        }
        mv.arrived = true;
        if (mv.heading) {
            // Its deck is the same either way round: square to whichever of the two is nearer.
            let e = ang(mv.heading);
            if (Math.abs(e) > Math.PI / 2) e -= Math.sign(e) * Math.PI;
            if (Math.abs(e) > 0.03) { m.drive(0, Math.max(-0.5, Math.min(0.5, e * 1.5)) || 0); return false; }
        }
        m.drive(0, 0);
        return speed < 0.02 && Math.abs(V ? m.rates[V.joints[0]] : 0) < 0.05;
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
    const carriers = site.machines.filter((m) => !m.hook && m.contract.vehicle);
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
                const load = parkBy(site, a, v, b.mid, ok), unload = load && parkBy(site, b, v, a.mid, ok);
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
// crates and pads, on the side of the crane nearest `toward`. { at: [x, z], heading: [x, z] }.
function parkBy(site, m, v, toward, ok) {
    const B = v.contract.vehicle.bed, half = [B.half[0] + 0.15, B.half[1] + 0.25];
    // Clear of its base, and of what swings round with it low enough to hit the deck or a load on it.
    const c = m.mid, a0 = Math.atan2(toward[1] - c[1], toward[0] - c[0]);
    const r0 = Math.max(baseRadius(m) + half[1] + 0.3, sweepRadius(m, v.bedWorld().center[1] + 1) + B.half[1] + 0.1);
    const clear = (S, hd) => {
        const along = (p) => Math.abs((p[0] - S[0]) * hd[0] + (p[1] - S[1]) * hd[1]), across = (p) => Math.abs(-(p[0] - S[0]) * hd[1] + (p[1] - S[1]) * hd[0]);
        const inside = (p, g) => along(p) < half[0] + g && across(p) < half[1] + g;
        return site.machines.every((o) => o === v || o === m || Math.hypot(o.mid[0] - S[0], o.mid[1] - S[1]) > baseRadius(o) + half[0] + 0.3)
            && site.crates.every((cr) => { const P = site.world.pose(cr.body); return !inside([P[0], P[2]], cr.size); })
            && site.pads.every((p) => !inside([p.at[0], p.at[2]], p.half[0]));
    };
    for (let r = r0; r < r0 + 4; r += 0.1) {
        for (let k = 0; k < 36; k++) {
            const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
            const S = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], hd = [-Math.sin(a), Math.cos(a)];
            if (ok(m, S) && clear(S, hd)) return { at: S, heading: hd };
        }
    }
    return null;
}

// A clear spot on the ground that both `a` and `b` reach, nearest the middle between them.
function handover(site, a, b, crate, ok, taken) {
    const ma = a.mid, mb = b.mid, c = [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2];
    const span = Math.max(a.size, b.size) * 1.5;
    const clear = (s) => site.crates.every((cr) => {
        if (cr === crate) return true;
        const P = site.world.pose(cr.body);
        return Math.hypot(P[0] - s[0], P[2] - s[1]) > (cr.size + crate.size) * 0.8;
    }) && taken.every((t) => Math.hypot(t[0] - s[0], t[1] - s[1]) > crate.size * 2) && site.machines.every((m) => Math.hypot(m.mid[0] - s[0], m.mid[1] - s[1]) > crate.size + m.size * 0.2);
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
    p.setDown()
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
export function crew(site) {
    const pilots = new Map(site.machines.map((m) => [m, pilotOf(site, m)]));
    const jobs = [], taken = [], zones = new Map();
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
    const c = {
        pilots, jobs,
        get failed() { for (const p of pilots.values()) if (p.failed) return p.failed; return jobs.find((j) => j.failed)?.failed || null; },
        get busy() { return [...pilots.values()].some((p) => p.busy); },
        /** Plan and queue every open delivery. */
        assign() {
            site.marks.length = 0;
            for (const t of site.tasks) {
                if (t.done || jobs.some((j) => j.task === t)) continue;
                const dest = destOf(t), where = t.kind === 'place' ? 'where it goes' : t.pad.name;
                // What it waits on: the tasks it stands on.
                const deps = (t.after || []).length ? () => t.after.every((d) => d.done) : null;
                const depsLabel = deps ? `waiting for ${t.after.map((d) => d.crate.name).join(' and ')}` : '';
                // Too heavy for any one crane: two take an end each.
                if (!site.machines.some((m) => m.hook && liftOf(m) >= t.crate.kg)) {
                    const tp = planTandem(site, t.crate, dest);
                    const job = { task: t, tandem: tp, legs: tp ? [{ machine: tp.a }, { machine: tp.b }] : null,
                        failed: tp ? null : `${t.crate.name} (${Math.round(t.crate.kg)} kg) is too heavy for one crane, and no two here reach it and ${where} together` };
                    jobs.push(job);
                    if (tp) queueTandem(job, deps, depsLabel);
                    continue;
                }
                const legs = planDelivery(site, t.crate, dest, taken);
                // Mark the spots on the ground: the hand-overs, and where a carrier stands.
                const mark = (at, s) => site.marks.push({ id: `spot${site.marks.length}:${at.join(",")}`, kind: "spot", at: [at[0], site.ground + 0.002, at[1]], half: [s, 0.004, s] });
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
                const deckAt = (v) => () => { const B = v.bedWorld(); return [B.center[0], B.center[2]]; };
                const onDeck = (v) => { const P = site.poseOf(t.crate), u = site.under(P[0], P[2], P[1], t.crate), w = site.world.velocity(t.crate.body); return u.machine === v && Math.hypot(w[0], w[1], w[2]) < 0.05 && !site.machines.some((o) => o.hook && o.hook.crate === t.crate); };
                // Crane legs to and from a deck reach for where the deck is; the haul between
                // them drives to its loading spot, waits to be loaded, drives to the unloading spot.
                for (const l of legs) for (const k of ['from', 'to']) if (l[k] && l[k].deck) { l[k + 'Deck'] = l[k].deck; l[k] = deckAt(l[k].deck); }
                legs.forEach((leg, i) => {
                    const p = pilots.get(leg.machine), before = legs[i - 1], next = legs[i + 1];
                    if (leg.haul) {
                        p.driveTo(leg.from.at, leg.from.heading, 'driving to be loaded')
                            .then(() => { leg.parked = true; })
                            .wait(() => before.done && onDeck(leg.machine), `waiting for ${t.crate.name}`)
                            .then(() => { leg.parked = false; })
                            .driveTo(leg.to.at, leg.to.heading, `carrying ${t.crate.name}`)
                            .then(() => { leg.done = true; })
                            .wait(() => !onDeck(leg.machine) && (!next || next.took), 'being unloaded');
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
        },
    };
    return c;
}

function restsAt(site, crate, [x, z]) {
    const P = site.world.pose(crate.body), v = site.world.velocity(crate.body);
    return Math.hypot(P[0] - x, P[2] - z) < crate.size && Math.hypot(v[0], v[1], v[2]) < 0.05 && !site.machines.some((m) => m.hook && m.hook.crate === crate);
}
