// Whether motion reads as natural or mechanical, measured from what the rig
// put out, with no reference: general principles of animal locomotion and of
// animation, for any skeleton the lab loads. Each measure has a threshold
// (NATURAL) and its flags say where a run falls short.
//
//   overlap     each free chain's child (spine, neck, head, tail, ears: every
//               bone not in a leg) against its parent through a steady cycle:
//               the phase by which its swing follows the parent's. A child
//               locked to its parent (no lag, the same curve) is mechanical.
//               Legs are the chain above each foot, up to the bone the leg
//               hangs from; their lags are reported, not judged (the gait
//               sets them).
//   secondary   after a change of speed or heading, whether each free bone
//               swings on past where it ends up and settles (carries its
//               momentum), only follows its parent, or does not move at all.
//               And the share of the skin weighted wholly to one bone: skin
//               that cannot move but rigidly.
//   mass        the centre of mass against what the feet can do: in flight
//               it must fall freely (a = g), and its energy cannot grow; on
//               the ground the feet can only push (a_y >= -g) within friction
//               (|a_h| <= mu (a_y + g)).
//   smoothness  each joint's angular acceleration: steps where it jumps
//               against its neighbours (an abrupt change of velocity), and
//               its jerk.
//   variety     a steady gait's cycles against each other: how much a joint's
//               curve differs from cycle to cycle in its slow shape (variety)
//               and in fast wobble (jitter). The same curve every cycle is
//               mechanical; jitter is noise, not life.
//   head        the head's orientation in space against the trunk's: an
//               animal holds its gaze steady while its body pitches and
//               rolls, its neck countering the trunk.
//   arcs        points (feet in swing, tracked points) along their paths in
//               the creature's frame: corners where a path turns sharply, and
//               the share of a path that runs straight.

import { T, TELE, I, INTENT } from "./contract.js";
import { ROWS } from "./skeleton.js";
import { series } from "./analyze.js";
import { cycles } from "./cycle.js";

export const NATURAL = {
    lock: 0.02,           // cycles: a free child within this phase of its parent is locked
    minAmp: 0.5,          // degrees: swings smaller than this are not compared
    rigid: 1.0,           // degrees: a free bone moving less than this after a change is rigid
    overshoot: 0.08,      // share of its change a bone must swing past its end to carry momentum
    flightTol: 2.5,       // m/s^2 off free fall in flight
    groundTol: 2.5,       // m/s^2 past what the feet can do on the ground
    mu: 1.0,              // friction
    energy: 0.15,         // J/kg gained in one flight
    spike: 10000,         // deg/s^2 off the line through its neighbours: the velocity kinking by ~80 deg/s in a step
    spikeLeg: 0.85,       // m of leg that is sized for: a shorter-legged creature's joints are allowed more (turnSpike)
    spikeRel: 8,          // ... or this many times the joint's median jump, the larger
    settle: 0.5,          // s at a run's start that kinks are not counted in
    push: 2.5,           // the peak of a stance's push over its mean (a half sine is 1.6): the root's height may turn that hard
    variety: [0.01, 0.12],// variety as a share of the joint's range: below repeats, above wanders
    jitter: 0.015,        // jitter as a share of range
    headRatio: 0.8,       // head pitch range over the trunk's: above, the head rides the trunk
    frozenHead: 0.5,      // degrees: a head pitching less than this is pinned, not held
    corner: 35,           // degrees a path turns within 1% of its length either side
    straight: 0.35,       // share of a free path running straight
};

const DEG = 180 / Math.PI;
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const wrap = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

// --- the skeleton's chains -----------------------------------------------------

// Bones of the legs: from each foot up through its parents while the parent
// carries only that chain, and the bone the leg hangs from's child.
export function chains(skel) {
    const kids = skel.bones.map(() => []);
    for (const b of skel.bones) if (b.parentIndex >= 0) kids[b.parentIndex].push(b.index);
    const limb = new Set();
    for (const f of skel.feet) {
        let b = f.boneIndex;
        while (b >= 0) {
            limb.add(b);
            const p = skel.bones[b].parentIndex;
            if (p < 0 || kids[p].length > 1) break;
            b = p;
        }
    }
    const root = skel.bones.find((b) => b.parentIndex < 0).index;
    const free = skel.bones.filter((b) => !limb.has(b.index) && b.index !== root).map((b) => b.index);
    return { limb, free, root, kids };
}

// --- angles in the heading frame ------------------------------------------------

// Each bone's world direction's sagittal (pitch in the heading's y-z plane)
// and lateral (out of it) angles from rest, degrees, per step.
export function segmentAngles(rec) {
    const skel = rec.creature.skel, n = rec.steps, nb = skel.count;
    const sag = new Float32Array(n * nb), lat = new Float32Array(n * nb);
    const rest = skel.bones.map((b) => {
        const d = [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]];
        const l = Math.hypot(...d) || 1;
        return { d: d.map((v) => v / l), th: Math.atan2(d[1], d[2]) * DEG, la: Math.asin(d[0] / l) * DEG };
    });
    for (let k = 0; k < n; k++) {
        const yaw = rec.tele[k * TELE + T.YAW], c = Math.cos(-yaw), s = Math.sin(-yaw);
        const o = k * rec.poseStride;
        for (let b = 0; b < nb; b++) {
            const P = rec.pose, q = o + b * ROWS, d = rest[b].d;
            const wx = P[q] * d[0] + P[q + 1] * d[1] + P[q + 2] * d[2];
            const wy = P[q + 4] * d[0] + P[q + 5] * d[1] + P[q + 6] * d[2];
            const wz = P[q + 8] * d[0] + P[q + 9] * d[1] + P[q + 10] * d[2];
            const x = c * wx + s * wz, z = -s * wx + c * wz;
            let th = wrap(Math.atan2(wy, z) * DEG - rest[b].th);
            if (k > 0) th = sag[(k - 1) * nb + b] + wrap(th - sag[(k - 1) * nb + b]);
            sag[k * nb + b] = th;
            lat[k * nb + b] = Math.asin(Math.max(-1, Math.min(1, x))) * DEG - rest[b].la;
        }
    }
    return { sag, lat, nb };
}

// The steady cycles of a run (left touchdown to the next, from 40% in), or none.
export function steadyCycles(rec) { return cycles(rec, rec.scenario.duration * 0.4); }

// A per-step series averaged over cycles at `m` even phases.
function cycleMean(arr, stride, idx, cyc, m = 64) {
    const out = new Float64Array(m);
    for (const c of cyc) for (let i = 0; i < m; i++) {
        const k = Math.min(c.b, Math.round(c.a + (i / m) * (c.b - c.a)));
        out[i] += arr[k * stride + idx] / cyc.length;
    }
    return out;
}

function demean(a) { let s = 0; for (const v of a) s += v; s /= a.length; return a.map((v) => v - s); }
const amp = (a) => (Math.max(...a) - Math.min(...a)) / 2;

// The lag (share of a cycle) at which b best follows a (b(phi) ~ a(phi - lag)),
// and the correlation there, over circular curves.
function circularLag(a, b) {
    const m = a.length, A = demean(a), B = demean(b);
    const na = Math.hypot(...A) || 1, nb = Math.hypot(...B) || 1;
    let best = -Infinity, at = 0;
    for (let s = 0; s < m; s++) {
        let c = 0;
        for (let i = 0; i < m; i++) c += A[i] * B[(i + s) % m];
        if (c > best) { best = c; at = s; }
    }
    let lag = at / m;
    if (lag > 0.5) lag -= 1;
    return { lag, corr: best / (na * nb) };
}

// --- overlap -------------------------------------------------------------------

export function overlap(rec, A, cyc) {
    const skel = rec.creature.skel, ch = chains(skel);
    if (!cyc.length) return { steady: false, pairs: [] };
    const period = cyc.reduce((s, c) => s + c.period, 0) / cyc.length;
    const pairs = [];
    for (const b of skel.bones) {
        if (b.parentIndex < 0) continue;
        const comps = ['sag', 'lat'].map((which) => {
            const pa = cycleMean(A[which], A.nb, b.parentIndex, cyc), ca = cycleMean(A[which], A.nb, b.index, cyc);
            const rel = ca.map((v, i) => v - pa[i]);
            const l = circularLag(pa, ca);
            return { which, parentAmp: amp(pa), childAmp: amp(ca), ownAmp: amp(rel), ...l, curves: { parent: [...pa].map(r2), child: [...ca].map(r2) } };
        }).filter((c) => c.parentAmp >= NATURAL.minAmp && c.childAmp >= NATURAL.minAmp);
        if (!comps.length) continue;
        const c = comps.sort((x, y) => y.parentAmp - x.parentAmp)[0];
        const limb = ch.limb.has(b.index);
        const locked = !limb && Math.abs(c.lag) < NATURAL.lock && c.corr > 0.9;
        pairs.push({
            bone: b.name, parent: skel.bones[b.parentIndex].name, limb, which: c.which,
            lagCycles: r3(c.lag), lagDeg: Math.round(c.lag * 360), lagMs: Math.round(c.lag * period * 1000), corr: r2(c.corr),
            parentAmp: r1(c.parentAmp), childAmp: r1(c.childAmp), ownAmp: r1(c.ownAmp), locked, curves: c.curves,
        });
    }
    return { steady: true, period: r3(period), pairs };
}

// --- secondary motion ------------------------------------------------------------

// Changes asked of the body: steps where the intent's wanted velocity jumps
// (a start, a stop, a new speed or heading), a turn starts or ends, or the
// action changes; at least 0.6 s apart and 1 s before the run's end.
export function changes(rec) {
    const n = rec.steps, dt = rec.dt, W = INTENT;
    const at = (k, f) => rec.intents[k * W + f];
    const out = [];
    let lastTurn = 0;
    for (let k = 1; k < n; k++) {
        const vx = at(k, I.VEL_X), vz = at(k, I.VEL_Z), px = at(k - 1, I.VEL_X), pz = at(k - 1, I.VEL_Z);
        const dv = Math.hypot(vx - px, vz - pz);
        // A turn: the velocity's direction turning (a held turn rate turns it every step).
        const turning = Math.hypot(vx, vz) > 0.05 && Math.abs(wrap((Math.atan2(vx, vz) - Math.atan2(px, pz)) * DEG)) > 1e-3 ? 1 : 0;
        const what = dv > 0.05 ? `speed ${r2(Math.hypot(px, pz))} to ${r2(Math.hypot(vx, vz))} m/s`
            : turning !== lastTurn ? (turning ? 'a turn starts' : 'a turn ends')
            : at(k, I.ACTION) !== at(k - 1, I.ACTION) || at(k, I.HEADING_MODE) !== at(k - 1, I.HEADING_MODE)
              || Math.abs(at(k, I.HEADING) - at(k - 1, I.HEADING)) > 1e-3 ? 'the action or facing changes' : null;
        lastTurn = turning;
        if (!what || k * dt > rec.scenario.duration - 1.0) continue;
        if (out.length && k - out[out.length - 1].k < 0.6 / dt) continue;
        out.push({ k, t: r2(k * dt), what });
    }
    return out;
}

// Each free bone's angle relative to its parent through 1.2 s after each change.
export function secondary(rec) {
    const skel = rec.creature.skel, S = series(rec), ch = chains(skel), dt = rec.dt;
    const ev = changes(rec);
    const bones = [];
    for (const b of ch.free) {
        const per = ev.map((e) => {
            const k0 = Math.max(0, e.k - Math.round(0.1 / dt)), k1 = Math.min(rec.steps - 1, e.k + Math.round(1.2 / dt));
            // The relative angle component that moves most.
            let best = null;
            for (let c = 0; c < 3; c++) {
                const r = [];
                for (let k = k0; k <= k1; k++) r.push(S.angles[k][b][c] * DEG);
                const ex = Math.max(...r) - Math.min(...r);
                if (!best || ex > best.ex) best = { c, r, ex };
            }
            const r = best.r, start = r[0], tail = r.slice(-Math.round(0.2 / dt));
            const end = tail.reduce((s, v) => s + v, 0) / tail.length;
            const change = end - start;
            // How far it swings past its end, against the change (or the excursion when it ends where it began).
            const ref = Math.max(Math.abs(change), 0.25 * best.ex, 1e-6);
            let past = 0;
            for (const v of r) past = Math.max(past, change >= 0 ? v - end : end - v);
            let rev = 0, dir = 0;
            for (let i = 1; i < r.length; i++) {
                const d = r[i] - r[i - 1];
                if (Math.abs(d) < 1e-4) continue;
                const s = Math.sign(d);
                if (dir && s !== dir) rev++;
                dir = s;
            }
            let settle = 0;
            for (let i = r.length - 1; i >= 0; i--) if (Math.abs(r[i] - end) > 0.1 * Math.max(best.ex, 1e-6)) { settle = i * dt; break; }
            const kind = best.ex < NATURAL.rigid ? 'rigid' : past / ref >= NATURAL.overshoot && rev >= 1 ? 'momentum' : 'follows';
            return { t: e.t, excursion: r1(best.ex), overshoot: r2(past / ref), reversals: rev, settle: r2(settle), kind,
                     trace: r.filter((_, i) => i % 3 === 0).map(r2) };
        });
        bones.push({ bone: skel.bones[b].name, events: per });
    }
    return { changes: ev, bones, rigidSkin: rigidSkin(rec.creature) };
}

// The share of the skin's vertices weighted (95% or more) to one bone.
export function rigidSkin(creature) {
    const w = creature.body.weights;
    let n = 0;
    for (const ws of w) if (ws[0].w >= 0.95) n++;
    return r3(n / w.length);
}

// --- mass --------------------------------------------------------------------------

export function massPhysics(rec) {
    const S = series(rec), n = rec.steps, dt = rec.dt, nf = rec.creature.skel.feet.length, g = 9.81;
    const h = 3, H = h * dt;
    // On the ground: a foot down, or lying (its root well under where it
    // stood at the start), when the body carries it and no foot need.
    const skel = rec.creature.skel, root = skel.bones.find((b) => b.parentIndex < 0).index;
    // (Or kneeling its way there, brisket down and rump still up: any of
    // the joints it carries high, down to nearly half its standing height.)
    let tall = 0;
    for (let b = 0; b < skel.count; b++) tall = Math.max(tall, S.jointH[b]);
    const high = skel.bones.filter((b) => S.jointH[b.index] > 0.6 * tall).map((b) => b.index);
    const lying = (k) => {
        if (S.jointH[k * skel.count + root] < 0.6 * S.jointH[root]) return true;
        for (const b of high) if (S.jointH[k * skel.count + b] < 0.55 * S.jointH[b]) return true;
        return false;
    };
    const down = (k) => { if (lying(k)) return true; for (let i = 0; i < nf; i++) if (S.contact[k * nf + i]) return true; return false; };
    const acc = [], vel = [], flight = new Uint8Array(n), viol = [];
    let nFlight = 0, nGround = 0, badFlight = 0, pull = 0, slide = 0, worstF = { a: 0, t: 0 }, worstG = { a: 0, t: 0 }, worstP = { a: 0, t: 0 };
    for (let k = 0; k < n; k++) {
        if (k < h || k >= n - h) { acc.push(null); vel.push(null); continue; }
        const a = [0, 1, 2].map((i) => (S.com[k + h][i] - 2 * S.com[k][i] + S.com[k - h][i]) / (H * H));
        const v = [0, 1, 2].map((i) => (S.com[k + h][i] - S.com[k - h][i]) / (2 * H));
        acc.push(a); vel.push(v);
        let air = true;
        for (let j = k - h; j <= k + h; j++) if (down(j)) { air = false; break; }
        if (air) {
            flight[k] = 1; nFlight++;
            const off = Math.hypot(a[0], a[1] + g, a[2]);
            if (off > worstF.a) worstF = { a: off, t: k * dt };
            if (off > NATURAL.flightTol) { badFlight++; viol.push({ k, kind: 'flight', a: r1(off) }); }
        } else if (down(k)) {
            nGround++;
            const ah = Math.hypot(a[0], a[2]), lim = NATURAL.mu * Math.max(0, a[1] + g);
            const p = -g - a[1], s = ah - lim;
            if (p > NATURAL.groundTol) { pull++; viol.push({ k, kind: 'pull', a: r1(p) }); }
            else if (s > NATURAL.groundTol) { slide++; viol.push({ k, kind: 'friction', a: r1(s) }); }
            if (p > worstP.a) worstP = { a: p, t: k * dt };
            // (The worst push says which way the mass went: along its
            // travel, across it, and what the feet bore then. A moment the
            // mass is pulled down is that fault, not this one.)
            if (p <= NATURAL.groundTol && s > worstG.a) {
                const worst = s;
                const vh = Math.hypot(v[0], v[2]) || 1;
                const along = (a[0] * v[0] + a[2] * v[2]) / vh;
                worstG = { a: worst, t: k * dt, along, across: Math.sqrt(Math.max(0, ah * ah - along * along)), bore: a[1] + g };
            }
        }
    }
    // What carried the mass down at its worst pull: each bone's share of
    // the mass's fall past gravity then (its own mass times how its joint
    // fell), the largest first.
    let pullBy = [];
    if (worstP.a > NATURAL.groundTol) {
        const k = Math.round(worstP.t / dt), nb = skel.count;
        const jy = (j, b) => S.jointH[j * nb + b];
        pullBy = skel.bones.filter((b) => b.mass).map((b) => ({
            bone: b.name,
            a: r1(-(b.mass / skel.mass) * ((jy(k + h, b.index) - 2 * jy(k, b.index) + jy(k - h, b.index)) / (H * H) + g)),
        })).sort((x, y) => y.a - x.a).slice(0, 5);
    }
    // And what kept it from falling freely at its worst in flight: each
    // bone's share of the mass's rise against free fall (negative: of its
    // fall past it), the largest either way first.
    let flightBy = [];
    if (worstF.a > NATURAL.flightTol) {
        const k = Math.round(worstF.t / dt), nb = skel.count;
        const jy = (j, b) => S.jointH[j * nb + b];
        flightBy = skel.bones.filter((b) => b.mass).map((b) => ({
            bone: b.name,
            a: r1((b.mass / skel.mass) * ((jy(k + h, b.index) - 2 * jy(k, b.index) + jy(k - h, b.index)) / (H * H) + g)),
        })).sort((x, y) => Math.abs(y.a) - Math.abs(x.a)).slice(0, 5);
    }
    // Energy (per kg) over each flight.
    const flights = [];
    for (let k = 0; k < n; k++) {
        if (!flight[k] || (k > 0 && flight[k - 1])) continue;
        let e = k;
        while (e + 1 < n && flight[e + 1]) e++;
        const E = (j) => 0.5 * (vel[j][0] ** 2 + vel[j][1] ** 2 + vel[j][2] ** 2) + g * S.com[j][1];
        if (e > k) flights.push({ t: r2(k * dt), ms: Math.round((e - k) * dt * 1000), gain: r3(E(e) - E(k)) });
        k = e;
    }
    const gained = flights.filter((f) => f.gain > NATURAL.energy);
    return {
        flightSteps: nFlight, groundSteps: nGround,
        flightOff: r3(badFlight / Math.max(1, nFlight)), worstFlight: { a: r1(worstF.a), t: r2(worstF.t), by: flightBy },
        pullShare: r3(pull / Math.max(1, nGround)), frictionShare: r3(slide / Math.max(1, nGround)),
        worstPull: { a: r1(worstP.a), t: r2(worstP.t), by: pullBy },
        worstGround: { a: r1(worstG.a), t: r2(worstG.t), along: r1(worstG.along ?? 0), across: r1(worstG.across ?? 0), bore: r1(worstG.bore ?? 0) },
        flights, energyFromNowhere: gained.length, maxGain: r3(Math.max(0, ...flights.map((f) => f.gain))),
        series: {
            height: S.com.filter((_, k) => k % 2 === 0).map((c) => r3(c[1])),
            ay: acc.filter((_, k) => k % 2 === 0).map((a) => (a ? r1(a[1]) : null)),
            flight: [...flight].filter((_, k) => k % 2 === 0),
        },
        violations: viol.filter((_, i) => i % 2 === 0).slice(0, 400).map((v) => ({ ...v, t: r2(v.k * dt) })),
    };
}

// --- smoothness ------------------------------------------------------------------------

function median(a) { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; }

// Per step, the foot event nearest it within `win` steps ('LF down', 'RH
// lift'), or null: where a kink falls in the step it belongs to.
export function footEvents(rec, win = 3) {
    const n = rec.steps, feet = rec.creature.skel.feet;
    const ev = [];
    for (let k = 1; k < n; k++) feet.forEach((f, i) => {
        const a = rec.tele[(k - 1) * TELE + T.FOOT + 4 * i] > 0.5, b = rec.tele[k * TELE + T.FOOT + 4 * i] > 0.5;
        if (a !== b) ev.push({ k, name: `${f.name} ${b ? 'down' : 'lift'}` });
    });
    const at = new Array(n).fill(null), dist = new Array(n).fill(win + 1);
    for (const e of ev) for (let k = Math.max(0, e.k - win); k <= Math.min(n - 1, e.k + win); k++) {
        if (Math.abs(k - e.k) < dist[k]) { dist[k] = Math.abs(k - e.k); at[k] = e.name; }
    }
    return at;
}

// The kinks in one channel th (deg, or mm for a place) sampled every dt:
// each acceleration against the line through its neighbours two steps off
// (a smooth swing, however fast, leaves almost nothing, its fourth
// derivative over 17 ms; a corner in the velocity leaves a spike), each
// spike tagged with the foot event nearest it (`near`).
// The spike a joint of `skel` may turn with: NATURAL.spike for legs of
// NATURAL.spikeLeg, and more for shorter ones. Moving alike at their own
// sizes (the same strides of their own legs, the same share of a stride in
// the air), a creature's times go as the root of its leg length and its
// joints' angular accelerations as g over it: a finch on 5 cm legs turns
// its joints seventeen times as hard as a deer on 85 cm ones doing the
// same thing. (A place's spike, in m/s^2, is the same at every size.)
export function turnSpike(skel) {
    const legs = skel.parts.legs;
    if (!legs.length) return NATURAL.spike;
    const mean = legs.reduce((s, l) => s + l.length, 0) / legs.length;
    return NATURAL.spike * Math.max(1, NATURAL.spikeLeg / Math.max(mean, 0.01));
}

// (`more`: a limit of its own at each step, where it is the larger.)
export function kinks(th, dt, near, spike = NATURAL.spike, more = null) { return kinksOf(th, dt, near, spike, more); }
function kinksOf(th, dt, near, spike, more) {
    const n = th.length;
    const al = new Float64Array(n), jk = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) al[k] = (th[k + 1] - 2 * th[k] + th[k - 1]) / (dt * dt);
    for (let k = 2; k < n - 1; k++) jk[k] = (al[k] - al[k - 1]) / dt;
    const res = new Float64Array(n);
    // (Off both neighbours, not off their mean: a corner in the speed is an
    // acceleration that stands out from the steps either side of it. One
    // that goes from the one's value to the other's is a force coming on or
    // off, a hoof landing or a push beginning, which leaves the speed whole;
    // against the mean, half of every such step counted as a kink.)
    // (The motion's own scale, which the limit is relative to, stays the
    // median off the mean: how hard it turns at all.)
    const off = new Float64Array(n);
    for (let k = 3; k < n - 3; k++) {
        off[k] = Math.abs(al[k] - (al[k - 2] + al[k + 2]) / 2);
        res[k] = Math.max(0, al[k] - Math.max(al[k - 2], al[k + 2]), Math.min(al[k - 2], al[k + 2]) - al[k]);
    }
    // (That scale is the second it is in or the one either side, whichever
    // turns hardest: over a whole run of standing and hopping, or of a walk
    // and a gallop, the median is the quiet part's, and the same stride that
    // passes in a steady run counted there.)
    const med = median(off.subarray(3, n - 3));
    const B = Math.max(8, Math.round(1 / dt)), nb = Math.ceil(n / B), bm = new Float64Array(nb);
    for (let b = 0; b < nb; b++) bm[b] = median(off.subarray(b * B, Math.min(n, (b + 1) * B)));
    const local = (k) => { const b = Math.floor(k / B); return Math.max(bm[b], b > 0 ? bm[b - 1] : 0, b < nb - 1 ? bm[b + 1] : 0); };
    const lim = Math.max(spike, NATURAL.spikeRel * med);
    const spikes = [];
    // One kink leaves half of itself two steps either side: the peak within three steps counts.
    for (let k = 3; k < n - 3; k++) {
        const limK = Math.max(spike, NATURAL.spikeRel * local(k), more ? more[k] : 0);
        if (res[k] <= limK) continue;
        let peak = true;
        for (let j = Math.max(3, k - 3); j <= Math.min(n - 4, k + 3) && peak; j++) if (j !== k && (res[j] > res[k] || (res[j] === res[k] && j < k))) peak = false;
        if (peak) spikes.push({ t: r2(k * dt), jump: Math.round(res[k]), limit: Math.round(limK), at: near[k] || 'between' });
    }
    let js = 0;
    for (let k = 2; k < n - 1; k++) js += jk[k] * jk[k];
    return { range: r1(Math.max(...th) - Math.min(...th)), spikes, jerkRms: Math.round(Math.sqrt(js / Math.max(1, n - 3))), medAcc: Math.round(med), limit: Math.round(lim) };
}

function mostAt(spikes) {
    const by = new Map();
    for (const s of spikes) by.set(s.at, (by.get(s.at) || 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1])[0][0];
}

const worse = (e, w) => !w || e.spikes.length > w.spikes.length || (e.spikes.length === w.spikes.length && e.jerkRms > w.jerkRms);

export function smoothness(rec) {
    const S = series(rec), skel = rec.creature.skel, n = rec.steps, dt = rec.dt;
    const near = footEvents(rec);
    const turn = turnSpike(skel);
    // (Not the first NATURAL.settle seconds: a run sets the creature down
    // already at its pace, its springs at rest, and what it does settling
    // from that is the scenario's, not its gait's.)
    const kinks = (th, d, nr, spike = NATURAL.spike, more = null) => { const e = kinksOf(th, d, nr, spike, more); e.spikes = e.spikes.filter((s) => s.t >= NATURAL.settle); return e; };
    const joints = [];
    for (const b of skel.bones) {
        if (b.parentIndex < 0) continue;
        let worst = null;
        for (let c = 0; c < 3; c++) {
            const th = new Float64Array(n);
            for (let k = 0; k < n; k++) th[k] = S.angles[k][b.index][c] * DEG;
            for (let k = 1; k < n; k++) th[k] = th[k - 1] + wrap(th[k] - th[k - 1]);
            const e = { axis: 'xyz'[c], ...kinks(th, dt, near, turn) };
            if (e.range > 0.5 && worse(e, worst)) worst = e;
        }
        if (worst) joints.push({ bone: b.name, ...worst, perSecond: r2(worst.spikes.length / (n * dt)) });
    }
    joints.sort((x, y) => y.spikes.length - x.spikes.length || y.jerkRms - x.jerkRms);
    const total = joints.reduce((s, j) => s + j.spikes.length, 0);
    // The root, which carries every joint: its place (mm, a kink of 80 mm/s
    // in a step counting as a joint's 80 deg/s) and its turn in the world. A
    // kink there shows in every leg on the ground at once.
    const root = [];
    const r0 = skel.bones.find((b) => b.parentIndex < 0).index;
    // (Its height while it leaves the ground: what gravity takes in the air
    // the feet give back on it, so standing on them a share d of the time
    // it is pushed up at g (1/d - 1) on average and NATURAL.push times that
    // at the peak. That much is the gait, and only more is a kink: a hopper
    // a quarter of its time on the ground turns round at 3 g and more
    // however softly it lands.)
    // (Carried is read off the body, not the feet: it is on them while it
    // falls slower than half of g. A toe reaching for the ground is near it
    // before it bears anything.)
    const on = new Uint8Array(n).fill(1), ry = (k) => rec.pose[k * rec.poseStride + r0 * ROWS + 7];
    for (let k = 1; k < n - 1; k++) if ((ry(k + 1) - 2 * ry(k) + ry(k - 1)) / (dt * dt) < -0.5 * 9.81) on[k] = 0;
    // (The share in the air is taken over the 0.4 s either side, the gait
    // it is in then: a run through walk, trot and gallop is not one gait.)
    const airs = new Float64Array(n + 1), lift = new Float64Array(n), w = Math.round(0.4 / dt);
    for (let k = 0; k < n; k++) airs[k + 1] = airs[k] + 1 - on[k];
    for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - w), b = Math.min(n, k + w + 1);
        const d = Math.min(0.85, (airs[b] - airs[a]) / (b - a));
        lift[k] = NATURAL.push * 9810 * d / (1 - d);
    }
    // (Its turn is each step's small rotation, about its own axes, summed:
    // angles of the whole turn flip where the heading passes a quarter
    // turn, and a creature turning round kinked by 30 degrees in a step
    // that it did not.)
    const spin = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    const m = (k, i, j) => rec.pose[k * rec.poseStride + r0 * ROWS + 4 * i + j];
    for (let k = 0; k < n - 1; k++) {
        const d = (i, j) => m(k + 1, i, 0) * m(k, j, 0) + m(k + 1, i, 1) * m(k, j, 1) + m(k + 1, i, 2) * m(k, j, 2);
        const v = [0.5 * (d(2, 1) - d(1, 2)), 0.5 * (d(0, 2) - d(2, 0)), 0.5 * (d(1, 0) - d(0, 1))];
        for (let c = 0; c < 3; c++) spin[c][k + 1] = spin[c][k] + (m(k, 0, c) * v[0] + m(k, 1, c) * v[1] + m(k, 2, c) * v[2]) * DEG;
    }
    for (let c = 0; c < 3; c++) {
        const p = new Float64Array(n), a = spin[c];
        for (let k = 0; k < n; k++) p[k] = 1000 * rec.pose[k * rec.poseStride + r0 * ROWS + 4 * c + 3];
        root.push({ channel: `place ${'xyz'[c]}`, ...kinks(p, dt, near, NATURAL.spike, c === 1 ? lift : null) }, { channel: `turn ${'xyz'[c]}`, ...kinks(a, dt, near, turn) });
    }
    root.sort((x, y) => y.spikes.length - x.spikes.length);
    // Where they fall: the foot events the spikes gather at, most first.
    const by = new Map();
    for (const j of joints) for (const s of j.spikes) by.set(s.at, (by.get(s.at) || 0) + 1);
    const at = [...by].sort((a, b) => b[1] - a[1]).map(([event, count]) => ({ event, count }));
    return { spikesPerSecond: r2(total / (n * dt)), at, joints, root };
}

// --- variety ----------------------------------------------------------------------------

// The low harmonics (0..4) of a circular curve.
function lowpass(a, keep = 4) {
    const m = a.length, out = new Float64Array(m);
    for (let h = 0; h <= keep; h++) {
        let re = 0, im = 0;
        for (let i = 0; i < m; i++) { re += a[i] * Math.cos((2 * Math.PI * h * i) / m); im += a[i] * Math.sin((2 * Math.PI * h * i) / m); }
        const f = h === 0 ? 1 / m : 2 / m;
        for (let i = 0; i < m; i++) out[i] += f * (re * Math.cos((2 * Math.PI * h * i) / m) + im * Math.sin((2 * Math.PI * h * i) / m));
    }
    return out;
}

export function variety(rec, cyc) {
    if (cyc.length < 3) return { cycles: cyc.length, joints: [] };
    const S = series(rec), skel = rec.creature.skel, m = 64;
    const periods = cyc.map((c) => c.period), pm = periods.reduce((s, v) => s + v, 0) / periods.length;
    const periodCv = Math.sqrt(periods.reduce((s, v) => s + (v - pm) ** 2, 0) / periods.length) / pm;
    const joints = [];
    for (const b of skel.bones) {
        if (b.parentIndex < 0) continue;
        const curves = cyc.map((c) => {
            const out = new Float64Array(m);
            // Between steps by interpolation: a short cycle (a small creature's,
            // 30 steps) sampled at the nearest step would differ between
            // cycles by up to half a step of its fastest joints, read as jitter.
            for (let i = 0; i < m; i++) {
                const at = c.a + (i / m) * (c.b - c.a), k0 = Math.min(c.b, Math.floor(at)), k1 = Math.min(c.b, k0 + 1), f = at - k0;
                out[i] = (S.angles[k0][b.index][0] * (1 - f) + S.angles[k1][b.index][0] * f) * DEG;
            }
            return out;
        });
        const mean = new Float64Array(m);
        for (const c of curves) for (let i = 0; i < m; i++) mean[i] += c[i] / curves.length;
        const range = Math.max(...mean) - Math.min(...mean);
        if (range < 2) continue;
        let lo = 0, hi = 0;
        for (const c of curves) {
            const d = c.map((v, i) => v - mean[i]);
            const l = lowpass(d);
            for (let i = 0; i < m; i++) { lo += l[i] ** 2; hi += (d[i] - l[i]) ** 2; }
        }
        const N = curves.length * m;
        const v = Math.sqrt(lo / N) / range, j = Math.sqrt(hi / N) / range;
        joints.push({ bone: b.name, range: r1(range), variety: r3(v), jitter: r3(j),
                      verdict: v < NATURAL.variety[0] ? 'repeats' : v > NATURAL.variety[1] ? 'wanders' : j > NATURAL.jitter ? 'jitters' : 'varies',
                      curves: curves.map((c) => [...c].map(r1)) });
    }
    return { cycles: cyc.length, periodCv: r3(periodCv), joints };
}

// --- head ----------------------------------------------------------------------------------

export function headStability(rec, A, cyc) {
    const skel = rec.creature.skel;
    const ti = (name) => skel.tracks.find((t) => t.name === name);
    const head = ti('head'), trunk = ti('withers');
    if (!head || !trunk) return null;
    const hb = head.boneIndex, tb = trunk.boneIndex, n = rec.steps, nb = A.nb;
    const span = cyc.length ? [cyc[0].a, cyc[cyc.length - 1].b] : [Math.round(n * 0.2), n - 1];
    const pick = (arr, b) => { const o = []; for (let k = span[0]; k <= span[1]; k++) o.push(arr[k * nb + b]); return o; };
    const rng = (a) => Math.max(...a) - Math.min(...a);
    const corr = (a, b) => {
        const A2 = demean(a), B2 = demean(b);
        let s = 0; for (let i = 0; i < A2.length; i++) s += A2[i] * B2[i];
        return s / ((Math.hypot(...A2) * Math.hypot(...B2)) || 1);
    };
    // Slow drift (a head lowered to graze) is not what stabilisation is about: 0.5 s high-pass.
    const hp = (a) => {
        const w = Math.round(0.25 / rec.dt);
        return a.map((v, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j < Math.min(a.length, i + w + 1); j++) { s += a[j]; c++; } return v - s / c; });
    };
    const hs = hp(pick(A.sag, hb)), ts = hp(pick(A.sag, tb)), hl = hp(pick(A.lat, hb)), tl = hp(pick(A.lat, tb));
    const pitchRatio = rng(hs) / Math.max(0.2, rng(ts)), yawRatio = rng(hl) / Math.max(0.2, rng(tl));
    const rides = corr(hs, ts);
    return {
        head: skel.bones[hb].name, trunk: skel.bones[tb].name,
        headPitchRange: r1(rng(hs)), trunkPitchRange: r1(rng(ts)), pitchRatio: r2(pitchRatio),
        headYawRange: r1(rng(hl)), trunkYawRange: r1(rng(tl)), yawRatio: r2(yawRatio),
        corrPitch: r2(rides), corrYaw: r2(corr(hl, tl)),
        rides: pitchRatio > NATURAL.headRatio && rides > 0.5,
        // Steadier than a neck can hold it: under half a degree while the trunk pitches over 2.
        frozen: rng(hs) < NATURAL.frozenHead && rng(ts) > 2,
        series: { head: hs.filter((_, i) => i % 2 === 0).map(r2), trunk: ts.filter((_, i) => i % 2 === 0).map(r2) },
    };
}

// --- arcs ----------------------------------------------------------------------------------------

// Paths in the creature's frame (side view: z forward, y up; x kept).
export function arcs(rec, cyc) {
    const S = series(rec), skel = rec.creature.skel, n = rec.steps, nf = skel.feet.length;
    const span = cyc.length ? [cyc[cyc.length - 1].a, cyc[cyc.length - 1].b] : [0, n - 1];
    const rel = (k, p) => {
        const o = k * TELE, yaw = rec.tele[o + T.YAW], c = Math.cos(-yaw), s = Math.sin(-yaw);
        const x = p[0] - rec.tele[o + T.POS], z = p[2] - rec.tele[o + T.POS + 2];
        return [c * x + s * z, p[1], -s * x + c * z];
    };
    const pts = [];
    skel.feet.forEach((f, i) => pts.push({ name: `${f.name} toe`, at: (k) => S.sole.subarray(((k * nf + i) * S.ns) * 3, ((k * nf + i) * S.ns) * 3 + 3), foot: i }));
    skel.tracks.forEach((t, i) => pts.push({ name: t.name, at: (k) => S.tracks[k][i], foot: -1 }));
    return pts.map((p) => {
        const segs = [];
        let cur = [];
        for (let k = span[0]; k <= span[1]; k++) {
            const free = p.foot < 0 || !S.contact[k * nf + p.foot];
            if (free) cur.push(rel(k, p.at(k)));
            else if (cur.length) { segs.push(cur); cur = []; }
        }
        if (cur.length) segs.push(cur);
        let corners = [], straight = 0, total = 0;
        for (const s of segs) {
            const r = resample(s, 200);
            if (!r) continue;
            total += r.len;
            const m = 2, w = 5;
            for (let i = m; i < r.pts.length - m; i++) {
                const t = turn(r.pts[i - m], r.pts[i], r.pts[i + m]);
                if (t > NATURAL.corner && t >= turn(r.pts[i - m - 1] || r.pts[i - m], r.pts[i - 1], r.pts[i + m - 1]) && t >= turn(r.pts[i - m + 1], r.pts[i + 1], r.pts[i + m + 1] || r.pts[i + m])) {
                    corners.push({ at: r.pts[i].map(r3), turn: Math.round(t) });
                }
            }
            for (let i = w; i < r.pts.length - w; i++) if (turn(r.pts[i - w], r.pts[i], r.pts[i + w]) < 2) straight += r.len / (r.pts.length - 1);
        }
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const s of segs) for (const q of s) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); }
        const extent = segs.length ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
        // A path under a centimetre is not judged; a turn of 150 degrees or more is the path going back on itself.
        if (extent < 0.01) { corners = []; straight = 0; }
        return { point: p.name, foot: p.foot >= 0, length: r3(total), extent: r3(extent), corners: corners.filter((c) => c.turn < 150),
                 reversals: corners.filter((c) => c.turn >= 150).length, straightShare: r2(total ? straight / total : 0),
                 path: segs.map((s) => s.filter((_, i) => i % 2 === 0).map((q) => [r3(q[2]), r3(q[1])])) };
    });
}

function resample(pts, N) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const len = cum[cum.length - 1];
    if (len < 0.01 || pts.length < 4) return null;
    const out = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
        const s = (i / (N - 1)) * len;
        while (j + 1 < cum.length - 1 && cum[j + 1] < s) j++;
        const f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
        out.push([0, 1, 2].map((q) => pts[j][q] + (pts[j + 1][q] - pts[j][q]) * f));
    }
    return { pts: out, len };
}

function turn(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (lu < 1e-9 || lv < 1e-9) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))) * DEG;
}

// --- all of it, with flags -------------------------------------------------------------------------

export function naturalness(rec) {
    const cyc = steadyCycles(rec);
    const A = segmentAngles(rec);
    const out = {
        scenario: rec.scenario.name, steadyCycles: cyc.length,
        overlap: overlap(rec, A, cyc), secondary: secondary(rec), mass: massPhysics(rec),
        smoothness: smoothness(rec), variety: variety(rec, cyc), head: headStability(rec, A, cyc), arcs: arcs(rec, cyc),
    };
    const f = [];
    const lockedPairs = out.overlap.pairs.filter((p) => p.locked);
    if (lockedPairs.length) f.push(`overlap: ${lockedPairs.map((p) => `${p.bone} locked to ${p.parent} (${p.lagDeg}°, r ${p.corr})`).join(', ')}`);
    const freePairs = out.overlap.pairs.filter((p) => !p.limb);
    if (out.overlap.steady && freePairs.length && freePairs.every((p) => Math.abs(p.lagCycles) < 2 * NATURAL.lock)) f.push('overlap: no free chain lags its parent by more than 0.04 of a cycle');
    for (const b of out.secondary.bones) {
        const kinds = b.events.map((e) => e.kind);
        if (kinds.length && !kinds.includes('momentum')) f.push(`secondary: ${b.bone} ${kinds.every((k) => k === 'rigid') ? 'does not move' : 'only follows'} after ${kinds.length} change(s) of speed or heading`);
    }
    if (out.secondary.rigidSkin > 0.5) f.push(`secondary: ${Math.round(100 * out.secondary.rigidSkin)}% of the skin is weighted to one bone alone: no soft mass moves on its own`);
    const M = out.mass;
    if (M.flightOff > 0.1) f.push(`mass: off free fall in ${Math.round(100 * M.flightOff)}% of flight (worst ${M.worstFlight.a} m/s2 at ${M.worstFlight.t} s; held up by ${M.worstFlight.by.map((p) => `${p.bone} ${p.a}`).join(', ')})`);
    if (M.pullShare > 0.02) f.push(`mass: pulled down faster than gravity with feet on the ground ${Math.round(100 * M.pullShare)}% of the time (worst ${M.worstPull.a} m/s2 past it at ${M.worstPull.t} s; carried down by ${M.worstPull.by.map((p) => `${p.bone} ${p.a}`).join(', ')})`);
    if (M.frictionShare > 0.02) f.push(`mass: pushed sideways past friction ${Math.round(100 * M.frictionShare)}% of the time on the ground (worst ${M.worstGround.a} m/s2 over at ${M.worstGround.t} s: ${M.worstGround.along} along its travel, ${M.worstGround.across} across, the feet bearing ${M.worstGround.bore})`);
    if (M.energyFromNowhere) f.push(`mass: gains energy in ${M.energyFromNowhere} of ${M.flights.length} flights (most ${M.maxGain} J/kg)`);
    if (out.smoothness.spikesPerSecond > 1) f.push(`smoothness: ${out.smoothness.spikesPerSecond} abrupt velocity changes a second (most in ${out.smoothness.joints.slice(0, 3).map((j) => `${j.bone} ${j.spikes.length}`).join(', ')}; at ${out.smoothness.at.slice(0, 4).map((a) => `${a.event} ${a.count}`).join(', ')})`);
    const rk = out.smoothness.root.filter((r) => r.spikes.length);
    if (rk.length) f.push(`smoothness: the root kinks (${rk.slice(0, 3).map((r) => `${r.channel} ${r.spikes.length}, most at ${mostAt(r.spikes)}`).join('; ')})`);
    const V = out.variety;
    if (V.joints.length) {
        const rep = V.joints.filter((j) => j.verdict === 'repeats'), jit = V.joints.filter((j) => j.verdict === 'jitters');
        if (rep.length > V.joints.length / 2) f.push(`variety: ${rep.length} of ${V.joints.length} joints repeat the same curve every cycle (stride period CV ${(100 * V.periodCv).toFixed(1)}%)`);
        if (jit.length) f.push(`variety: ${jit.map((j) => j.bone).join(', ')} jitter from cycle to cycle`);
    }
    if (out.head && out.head.rides) f.push(`head: rides the trunk (pitch ${out.head.headPitchRange}° against the trunk's ${out.head.trunkPitchRange}°, r ${out.head.corrPitch})`);
    if (out.head && out.head.frozen) f.push(`head: pinned in space (pitch ${out.head.headPitchRange}°, yaw ${out.head.headYawRange}° while the trunk pitches ${out.head.trunkPitchRange}°): held by a gaze lock, not carried by a neck`);
    for (const a of out.arcs) {
        if (a.corners.length) f.push(`arcs: ${a.point} turns a corner ${a.corners.length} time(s) (sharpest ${Math.max(...a.corners.map((c) => c.turn))}°)`);
        if (!a.foot && a.straightShare > NATURAL.straight) {
            f.push(`arcs: ${a.point} runs straight ${Math.round(100 * a.straightShare)}% of its path${a.reversals ? `, going back along a line ${a.reversals} time(s) a cycle instead of round a loop` : ''} (${(100 * a.extent).toFixed(1)} cm)`);
        }
    }
    out.flags = f;
    return out;
}
