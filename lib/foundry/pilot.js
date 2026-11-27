// lib/foundry/pilot.js — machines in a site (site.js) doing work on their own.
//
// A pilot drives a machine the way an operator would, through its controls and
// nothing else: the deck's levers and dials and the hook's hoist. What it works
// out it works out from the contract: where the tip goes as the controls turn
// (poseOf), so where to put them to bring the tip over a point. The world says
// whether it got there.
//
//   reach(m, at)        the control settings that put m's hook line over [x, z]
//                       with the tip as high as it goes, and how close they come
//   pilotOf(site, m)    a machine's pilot: a queue of moves (reach, hoist to a
//                       height, take the crate, set it down, let go, park) run a
//                       tick at a time; each move ends when the world says so
//   planDelivery(site, crate, pad)
//                       which machines carry a crate to a pad: one that reaches
//                       both, else a chain of them handing it over at spots on
//                       the ground that both of a pair reach
//   crew(site)          runs the site's open deliveries with its machines, each
//                       leg queued on its machine's pilot, a hand-over waiting
//                       for the leg before it and for the one before it to stand clear

import { poseOf, frameApply, frameMul, tipOf } from "./operate.js";
import { RANGE } from "./site.js";

const TAU = Math.PI * 2;

/** Where m's tip is in the world with its controls at `x` (one value per moving control). */
export function tipAt(m, vars, x) {
    const c = m.contract, ang = new Float64Array(c.joints.length);
    vars.forEach((ct, i) => { for (const j of ct.joints) ang[j] = x[i]; });
    const M = poseOf(c, ang), t = tipOf(c);
    return frameApply(frameMul(m.place, t.carrier != null ? M[t.carrier] : { q: [0, 0, 0, 1], t: [0, 0, 0] }), t.pos);
}

/** The controls that move m's joints (one variable each: its joints turn together). */
export function varsOf(m) { return m.controls.filter((ct) => ct.joints.length && !ct.dark); }

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
        take(crate) { return p.push({ kind: 'take', crate, label: `taking ${crate.name}` }); },
        /** Let the line down until the crate stands, then let it go. */
        setDown() { return p.push({ kind: 'set', label: 'setting down' }); },
        /** Back to where it was built. */
        park() { return p.push({ kind: 'park', label: 'parking' }); },
        /** Turn its tip away from [x, z], to the far side of where it stands. */
        clearOf(at) { return p.push({ kind: 'park', away: at, label: 'standing clear' }); },
        /** Wait until `fn()` holds. */
        wait(fn, label) { return p.push({ kind: 'wait', fn, label: label || 'waiting', timeout: 1e9 }); },
        /** Run `fn()` once. */
        then(fn) { return p.push({ kind: 'call', fn, label: '' }); },
        push(mv) { queue.push(mv); return p; },
        stop() { queue.length = 0; cur = null; for (const ct of m.controls) ct.u = 0; m.hoist(0); },
        /** Run the current move for `dt` s of site time. */
        tick(dt) {
            if (!cur) { cur = queue.shift() || null; t = 0; if (cur) start(cur); }
            if (!cur) return;
            t += dt;
            const done = run(cur, dt);
            if (done === 'fail') { p.failed = `${m.name}: ${cur.label} failed`; p.stop(); return; }
            if (done) { for (const ct of m.controls) ct.u = 0; m.hoist(0); cur = null; }
            else if (t > (cur.timeout || 120)) { p.failed = `${m.name}: ${cur.label} took too long`; p.stop(); }
        },
    };
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
            const r = reach(m, mv.at);
            mv.goal = r && r.x; mv.err = r ? r.err : Infinity;
            // Where the tip can get to over the ground: the point itself, or as near as it goes.
            mv.target = r && [r.tip[0], r.tip[2]];
        } else if (mv.kind === 'park' && mv.away) {
            const c = m.mid, d = [c[0] - mv.away[0], c[1] - mv.away[1]], l = Math.hypot(...d) || 1;
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
    // operator damps the swing: the tip's speed is the way to the goal plus the way to the load.
    function steerTip(goal, xs) {
        const x = vars.map((ct) => m.angles[ct.joints[0]]);
        const tip = m.tipWorld();
        let e = [0, 0], ks = 0;
        if (m.hook.crate) {
            const h = m.hookWorld();
            e = [h[0] - tip[0], h[2] - tip[2]];
            ks = Math.sqrt(9.81 / Math.max(0.05, m.hook.line + m.hook.crate.size / 2));
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
                return steerTip(mv.target, mv.goal);
            }
            case 'park': return steer(mv.goal) && !swinging();
            case 'line': return lineTo(carry());
            case 'take': {
                const cr = mv.crate, P = site.world.pose(cr.body), top = P[1] + cr.size / 2;
                // Taken: the line in until it hangs short under the tip.
                if (m.hook.crate === cr) { const d = lineTo(carry()); const t = m.tipWorld(); return steerTip([t[0], t[2]], null) && d; }
                if (m.reachable() === cr && m.hookWorld()[1] - top < m.hook.reach * 0.5) { m.hoist(0); m.grab(); return false; }
                // Down onto it.
                m.hoist(-Math.max(0.15, Math.min(1, (m.hookWorld()[1] - top) / Math.max(0.05, m.hook.speed * 0.3))));
                return m.hook.line >= m.size * 3 - 1e-6 ? 'fail' : false;
            }
            case 'set': {
                if (!m.hook.crate) return true;
                const tip = m.tipWorld(), slack = m.hook.line > Math.hypot(...m.hookWorld().map((v, i) => v - tip[i])) + m.hook.reach * 0.2;
                if ((!m.carrying() || slack) && !swinging()) { m.hoist(0); m.release(); return false; }
                m.hoist(-0.5);
                return false;
            }
            case 'wait': return !!mv.fn();
            case 'call': mv.fn(); return true;
        }
        return true;
    }
    return p;
}

/**
 * Who carries `crate` to `pad`: [{ machine, from: [x, z], to: [x, z] }], one leg per
 * machine, each from where it takes the crate to where it sets it down; null if no
 * chain of the site's machines reaches.
 */
export function planDelivery(site, crate, pad, taken = []) {
    const P = site.world.pose(crate.body), from = [P[0], P[2]], to = [pad.at[0], pad.at[2]];
    const tol = Math.min(crate.size * 0.3, pad.half[0] - crate.size * 0.3 > 0 ? pad.half[0] - crate.size * 0.3 : crate.size * 0.2);
    const ok = (m, at) => reaches(m, at, Math.max(0.02, tol));
    const ms = site.machines.filter((m) => tipOf(m.contract));
    const starts = ms.filter((m) => ok(m, from));
    // Breadth first over hand-overs: a spot on the ground both of a pair reach.
    const seen = new Map(starts.map((m) => [m, null]));
    const q = [...starts];
    while (q.length) {
        const a = q.shift();
        if (ok(a, to)) {
            const legs = [];
            let m = a, end = to;
            while (m) {
                const prev = seen.get(m);
                legs.unshift({ machine: m, from: prev ? prev.spot : from, to: end });
                end = prev ? prev.spot : null;
                m = prev ? prev.from : null;
            }
            return legs;
        }
        for (const b of ms) {
            if (seen.has(b)) continue;
            const spot = handover(site, a, b, crate, ok, taken);
            if (spot) { seen.set(b, { from: a, spot }); q.push(b); }
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
function queueLeg(p, crate, leg, after) {
    // Out of the way of the spot it is handed the crate at while the one before brings it.
    if (after) p.lineIn().clearOf(leg.from).wait(after, 'waiting for the hand-over');
    p.lineIn()
        .reach(leg.from, `over ${crate.name}`)
        .take(crate)
        .reach(leg.to, `carrying ${crate.name}`)
        .setDown()
        .lineIn()
        .clearOf(leg.to)
        .then(() => { leg.done = true; });
}

/**
 * The site's crew: runs its open deliveries with its machines. Each delivery is
 * planned (planDelivery) and its legs queued on their machines' pilots; a leg
 * after a hand-over waits until the crate stands on the hand-over spot and the
 * machine that brought it is standing clear.
 */
export function crew(site) {
    const pilots = new Map(site.machines.map((m) => [m, pilotOf(site, m)]));
    const jobs = [], taken = [];
    const c = {
        pilots, jobs,
        get failed() { for (const p of pilots.values()) if (p.failed) return p.failed; return jobs.find((j) => j.failed)?.failed || null; },
        get busy() { return [...pilots.values()].some((p) => p.busy); },
        /** Plan and queue every open delivery. */
        assign() {
            site.marks.length = 0;
            for (const t of site.tasks) {
                if (t.done || jobs.some((j) => j.task === t)) continue;
                const legs = planDelivery(site, t.crate, t.pad, taken);
                if (legs) for (const l of legs.slice(1)) {
                    taken.push(l.from);
                    const s = t.crate.size * 0.8;
                    site.marks.push({ id: `spot${site.marks.length}:${l.from.join(",")}`, kind: "spot", at: [l.from[0], site.ground + 0.002, l.from[1]], half: [s, 0.004, s] });
                }
                const job = { task: t, legs, failed: legs ? null : `nothing here reaches from ${t.crate.name} to ${t.pad.name}` };
                jobs.push(job);
                if (!legs) continue;
                let prev = null;
                for (const leg of legs) {
                    const p = pilots.get(leg.machine), before = prev;
                    let handed = false;
                    const after = before ? () => handed || (handed = before.done && restsAt(site, t.crate, leg.from)) : null;
                    queueLeg(p, t.crate, leg, after);
                    prev = leg;
                }
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
    return Math.hypot(P[0] - x, P[2] - z) < crate.size && Math.hypot(v[0], v[1], v[2]) < 0.05 && !site.machines.some((m) => m.hook.crate === crate);
}
