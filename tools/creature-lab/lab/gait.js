// One stride of a two-legged gait, whole: what a walk or a run is judged by.
//
//   frames  the last steady cycle at eight even phases (0: the left foot's
//           touchdown) from the side and from the front, lit as the live
//           view draws it, one still camera a row
//   paths   the left side's joints over the cycle in the creature's own
//           frame from the side (head, shoulder, elbow, wrist, hip, knee,
//           ankle, toe), a dot every eighth, the body as sticks at phase 0
//           and half a cycle on
//   curves  over the cycle's phase, the mean of the steady cycles, left leg
//           and arm red and right blue: the thigh from plumb, the knee's
//           and ankle's flexion, the foot against the ground, the toe tip's
//           height; the hip line's yaw and roll, the shoulder line's yaw and
//           its turn against the hips; the upper arm from plumb, the elbow;
//           the hips' and head's heights about their means and the hips'
//           sway. Each foot's stance is a bar under every chart.
//   table   cadence, stride over height, duty, double support or flight,
//           the hips' rise and sway, the hip and shoulder lines' turns, the
//           trunk's lean, the head's bob, each hand's swing and when it is
//           furthest forward against the other side's foot landing, the
//           elbows, the knee at landing / deepest in stance / deepest in
//           swing, the foot's angle landing and leaving, the step's width,
//           the toe's clearance
//
// For a creature that stands on its whole sole (its feet name a `heel`) the
// curves carry what a person's do walking at an easy pace, grey and dashed,
// and the table what people's measures span walking or running: a measure
// outside is red. These are a person's, from gait measurement at large, not
// a reference creature; other bipeds are drawn without them.

import { beginSheet, saveSheet, text, line, poly, rect, dot, INK, DIM, FAINT } from "./page.js";
import { axes, curve, rangeOf } from "./plot.js";
import { steadyCycles } from "./natural.js";
import { legChains } from "./kinematics.js";
import { armChains } from "./upper.js";
import { series } from "./analyze.js";
import { boneAt, boneHead, boneTail } from "./skeleton.js";
import { rootOf, relativePose } from "./cycle.js";
import { groundHeights } from "./run.js";
import { setPose, capture, orbitView, showGround } from "./lit.js";
import { T, TELE, GAIT } from "./contract.js";

const DEG = 180 / Math.PI;
const LC = '#c0392b', RC = '#2471a3', GUIDE = '#8f8a7e', BAD = '#c0392b';
const N = 97;   // samples of a cycle
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const between = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1)))) * DEG;
// A hanging segment's angle from plumb in the side plane, forward positive.
const plumb = (d) => Math.atan2(d[2], -d[1]) * DEG;
// A forward-lying segment's angle over level in the side plane, tip up positive.
const rise = (d) => Math.atan2(d[1], d[2]) * DEG;

// What a person's left leg and arm do over a walking stride (phase, degrees),
// drawn through as the dashed guide.
const WALK_GUIDE = {
    thigh: [[0, 22], [0.1, 17], [0.3, 0], [0.5, -17], [0.56, -19], [0.63, -11], [0.75, 12], [0.87, 25], [0.95, 24], [1, 22]],
    knee: [[0, 4], [0.07, 12], [0.13, 18], [0.25, 10], [0.4, 4], [0.5, 10], [0.6, 38], [0.72, 62], [0.8, 50], [0.9, 15], [0.97, 3], [1, 4]],
    ankle: [[0, 0], [0.07, -6], [0.2, 3], [0.4, 9], [0.48, 10], [0.55, 0], [0.62, -18], [0.7, -8], [0.8, 0], [0.9, 2], [1, 0]],
    arm: [[0, -19], [0.125, -14], [0.25, -3], [0.375, 8], [0.5, 13], [0.625, 8], [0.75, -3], [0.875, -14], [1, -19]],
    elbow: [[0, 18], [0.25, 26], [0.5, 38], [0.75, 28], [1, 18]],
};

// What people's measures span, walking at an easy pace and running.
export const PEOPLE = {
    walk: {
        cadence: [95, 125], strideH: [0.7, 0.92], duty: [0.57, 0.66], rise: [2.5, 6.5], sway: [2, 7], hipYaw: [5, 14], hipRoll: [3, 12],
        against: [6, 20], lean: [-2, 8], headBob: [2.5, 6.5], hand: [22, 55], handLag: [-0.1, 0.1], elbow: [8, 40],
        kneeLand: [0, 10], kneeStance: [8, 24], kneeSwing: [52, 72], thigh: [34, 50], footLand: [8, 28], footLeave: [-75, -40], width: [4, 14], clear: [0.8, 4.5],
    },
    run: {
        cadence: [150, 190], strideH: [0.8, 2.0], duty: [0.25, 0.42], rise: [5, 11], sway: [0.5, 5], hipYaw: [8, 26], hipRoll: [4, 16],
        against: [10, 45], lean: [3, 14], headBob: [5, 11], hand: [25, 65], handLag: [-0.12, 0.12], elbow: [10, 60],
        kneeLand: [8, 28], kneeStance: [30, 52], kneeSwing: [75, 130], thigh: [50, 85], footLand: [-8, 22], footLeave: [-85, -45], width: [0, 10], clear: [3, 30],
    },
};

function guideAt(pts, ph) {
    for (let i = 0; i + 1 < pts.length; i++) if (ph <= pts[i + 1][0]) {
        const t = (ph - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        const s = t * t * (3 - 2 * t);
        return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (0.5 * t + 0.5 * s);
    }
    return pts[pts.length - 1][1];
}

// A leg's and an arm's joints in a pose (bones as they stand at offset o).
function limbsOf(skel) {
    const legs = legChains(skel).map((c) => ({ thigh: c[0], shin: c[1], foot: c[2], tip: skel.bones[c[c.length - 1]] }));
    const arms = armChains(skel).map((a) => ({ upper: a[a.length - 3], fore: a[a.length - 2], hand: skel.bones[a[a.length - 1]] }));
    const track = (n) => skel.tracks.find((t) => t.name === n);
    return { legs, arms, head: track('head'), hips: track('hips'), withers: track('withers') };
}

// One step measured in the creature's frame (heading +Z, its root's ground
// point the origin).
function measure(skel, Lm, P, rest) {
    const hd = (b) => boneHead(P, 0, b);
    const tr = (t) => boneAt(P, 0, skel.bones[t.boneIndex], t.at);
    const legs = Lm.legs.map((l, i) => {
        const hip = hd(l.thigh), knee = hd(l.shin), ankle = l.foot !== undefined ? hd(l.foot) : boneTail(P, 0, skel.bones[l.shin]);
        const tip = boneTail(P, 0, l.tip);
        const ball = l.foot !== undefined && skel.bones[l.foot].index !== l.tip.index ? boneTail(P, 0, skel.bones[l.foot]) : tip;
        const th = sub(knee, hip), sh = sub(ankle, knee), ft = sub(ball, ankle);
        return { hip, knee, ankle, ball, tip, thigh: plumb(th), kneeFlex: between(th, sh), ankleFlex: between(sh, ft) - (rest ? rest.legs[i].ankleRaw : 0), ankleRaw: between(sh, ft),
            sole: rise(ft) - (rest ? rest.legs[i].soleRaw : 0), soleRaw: rise(ft) };
    });
    const arms = Lm.arms.map((a) => {
        const sh = hd(a.upper), el = hd(a.fore), wr = hd(a.hand.index), tip = boneTail(P, 0, a.hand);
        const u = sub(el, sh), f = sub(wr, el);
        return { sh, el, wr, tip, upper: plumb(u), elbow: between(u, f) };
    });
    const lineOf = (a, b) => { const d = sub(a, b); return { yaw: Math.atan2(d[2], d[0]) * DEG, roll: Math.atan2(d[1], Math.hypot(d[0], d[2])) * DEG }; };
    const hipLine = legs.length > 1 ? lineOf(legs[0].hip, legs[1].hip) : { yaw: 0, roll: 0 };
    const shLine = arms.length > 1 ? lineOf(arms[0].sh, arms[1].sh) : { yaw: 0, roll: 0 };
    const hips = Lm.hips ? tr(Lm.hips) : legs[0].hip, withers = Lm.withers ? tr(Lm.withers) : hips, head = Lm.head ? tr(Lm.head) : withers;
    const up = sub(withers, hips);
    return { legs, arms, hipLine, shLine, hips, withers, head, lean: Math.atan2(up[2], up[1]) * DEG };
}

export function gaitSheet(rec, { path } = {}) {
    const t0 = Date.now();
    const creature = rec.creature, skel = creature.skel;
    const Lm = limbsOf(skel);
    if (Lm.legs.length !== 2) throw new Error(`gait: ${creature.label} stands on ${Lm.legs.length} feet; this sheet is a two-legged stride's`);
    const cyc = steadyCycles(rec);
    if (!cyc.length) throw new Error(`gait: ${rec.scenario.name} has no steady cycle (a steady walk or run is wanted)`);
    const rest = measure(skel, Lm, (() => {
        const P = new Float32Array(skel.count * 12);
        skel.bones.forEach((b, i) => { P[i * 12] = 1; P[i * 12 + 5] = 1; P[i * 12 + 10] = 1; P[i * 12 + 3] = b.head[0]; P[i * 12 + 7] = b.head[1]; P[i * 12 + 11] = b.head[2]; });
        return P;
    })(), null);
    const bare = rec.env[8] > 0 ? Float32Array.from(rec.env, (v, i) => (i === 8 ? 0 : v)) : rec.env;
    const poseAt = (step) => {
        const r = rootOf(rec, step);
        return relativePose(rec, step, groundHeights(bare, new Float32Array([r.x, r.z]))[0], new Float32Array(rec.poseStride));
    };
    const stepOf = (c, ph) => Math.min(rec.steps - 1, Math.round(c.a + ph * (c.b - c.a)));
    const phases = Array.from({ length: N }, (_, i) => i / (N - 1));
    // Every steady cycle measured at each phase; M[i] the list over cycles.
    const M = phases.map((ph) => cyc.map((c) => measure(skel, Lm, poseAt(stepOf(c, ph)), rest)));
    // (The curves read between the steps: a short cycle has fewer steps
    // than the curve has samples, and the nearest step's value is a stair.)
    const seen = new Map();
    const at = (k) => { if (!seen.has(k)) seen.set(k, measure(skel, Lm, poseAt(Math.min(rec.steps - 1, k)), rest)); return seen.get(k); };
    const mean = (f) => phases.map((ph) => cyc.reduce((s, c) => {
        const x = c.a + ph * (c.b - c.a), k = Math.floor(x), t = x - k;
        return s + (1 - t) * f(at(k)) + t * f(at(k + 1));
    }, 0) / cyc.length);
    const S = series(rec);
    const down = (f) => phases.map((ph) => cyc.reduce((s, c) => s + S.contact[stepOf(c, ph) * S.nf + f], 0) / cyc.length > 0.5);
    const stance = [down(0), down(1)];
    const share = (a) => a.filter(Boolean).length / a.length;
    const rng = (a) => Math.max(...a) - Math.min(...a);
    const arg = (a, pick) => a.indexOf(pick(...a)) / (N - 1);

    const period = cyc.reduce((s, c) => s + c.period, 0) / cyc.length;
    const speed = cyc.reduce((s, c) => { const a = rootOf(rec, c.a), b = rootOf(rec, c.b); return s + Math.hypot(b.x - a.x, b.z - a.z) / c.period; }, 0) / cyc.length;
    const height = Math.max(...skel.bones.map((b) => Math.max(b.head[1], b.tail[1])));
    const duty = [share(stance[0]), share(stance[1])];
    const both = share(stance[0].map((v, i) => v && stance[1][i])), none = share(stance[0].map((v, i) => !v && !stance[1][i]));
    // The other foot's landing: where its stance begins.
    const land1 = (() => { for (let i = 1; i < N; i++) if (stance[1][i] && !stance[1][i - 1]) return phases[i]; return 0.5; })();
    const lift0 = (() => { for (let i = 1; i < N; i++) if (!stance[0][i] && stance[0][i - 1]) return i; return N - 1; })();

    const C = {
        thigh: [0, 1].map((i) => mean((m) => m.legs[i].thigh)),
        knee: [0, 1].map((i) => mean((m) => m.legs[i].kneeFlex)),
        ankle: [0, 1].map((i) => mean((m) => m.legs[i].ankleFlex)),
        sole: [0, 1].map((i) => mean((m) => m.legs[i].sole)),
        tip: [0, 1].map((i) => mean((m) => 100 * m.legs[i].tip[1])),
        hipYaw: mean((m) => m.hipLine.yaw), hipRoll: mean((m) => m.hipLine.roll),
        shYaw: mean((m) => m.shLine.yaw), against: mean((m) => m.shLine.yaw - m.hipLine.yaw),
        arm: Lm.arms.map((_, i) => mean((m) => m.arms[i].upper)),
        elbow: Lm.arms.map((_, i) => mean((m) => m.arms[i].elbow)),
        hand: Lm.arms.map((_, i) => mean((m) => 100 * (m.arms[i].tip[2] - m.hips[2]))),
        hipsY: mean((m) => 100 * m.hips[1]), headY: mean((m) => 100 * m.head[1]), hipsX: mean((m) => 100 * m.hips[0]),
        lean: mean((m) => m.lean),
    };
    const about = (a) => { const mu = a.reduce((s, v) => s + v, 0) / a.length; return a.map((v) => v - mu); };
    // (A run by what the rig says it is doing: a foot that loses the ground
    // for a moment in its stance is a fault to show, not a flight.)
    const gaitOf = rec.tele[stepOf(cyc[cyc.length - 1], 0.5) * TELE + T.GAIT];
    const run = gaitOf === GAIT.RUN || duty[0] < 0.45;
    const people = skel.feet.every((f) => f.heel) ? PEOPLE[run ? 'run' : 'walk'] : null;

    // --- the table ---
    const swing0 = C.knee[0].map((v, i) => (stance[0][i] ? -Infinity : v)), early = C.knee[0].slice(0, Math.max(2, Math.round(0.6 * lift0)));
    // (Mid-swing: the toe's least height between its two peaks is what
    // clears the ground; here its least over the middle half of the swing.)
    const sw = C.tip[0].filter((_, i) => !stance[0][i]);
    const clear = sw.length > 8 ? Math.min(...sw.slice(Math.round(sw.length * 0.25), Math.round(sw.length * 0.75))) : 0;
    const width = 100 * Math.abs((() => {
        // Each foot's ball, mid-stance, across the body.
        const mid = (f) => { const idx = stance[f].map((v, i) => (v ? i : -1)).filter((i) => i >= 0); const i = idx[Math.floor(idx.length / 2)] ?? 0; return M[i].reduce((s, m) => s + m.legs[f].ball[0], 0) / M[i].length; };
        return mid(0) - mid(1);
    })());
    const wrapHalf = (p) => p - Math.round(p);
    const rows = [];
    const row = (key, name, v, fmt) => rows.push({ key, name, v, s: fmt(v), norm: people && people[key] ? people[key] : null });
    const u = (unit, d = 1) => (v) => `${d ? r1(v) : Math.round(v)}${unit}`;
    row('cadence', 'cadence', 120 / period, u(' steps/min', 0));
    row('strideH', 'stride / height', (speed * period) / height, (v) => `${r2(v)} (${r2(speed * period)} m)`);
    row('duty', 'stance share', duty[0], (v) => `${r2(v)}${Math.abs(duty[1] - duty[0]) > 0.03 ? ` / ${r2(duty[1])}` : ''}`);
    rows.push({ key: 'support', name: run ? 'flight' : 'on both feet', v: run ? none : both, s: `${Math.round(100 * (run ? none : both))}% of the stride`, norm: null });
    row('rise', 'hips rise', rng(C.hipsY), u(' cm'));
    row('sway', 'hips sway', rng(C.hipsX), u(' cm'));
    row('hipYaw', 'hip line turns', rng(C.hipYaw), u('°'));
    row('hipRoll', 'hip line rolls', rng(C.hipRoll), u('°'));
    if (Lm.arms.length > 1) row('against', 'shoulders v. hips', rng(C.against), u('°'));
    row('lean', 'trunk leans', C.lean.reduce((s, v) => s + v, 0) / N, u('° fwd'));
    row('headBob', 'head bobs', rng(C.headY), u(' cm'));
    Lm.arms.forEach((_, i) => {
        if (i > 1) return;
        row('hand', `hand ${'LR'[i]} swings`, rng(C.hand[i]), u(' cm'));
        // Furthest forward as the other side's foot lands (0: together).
        const other = i === 0 ? land1 : 0;
        row('handLag', `hand ${'LR'[i]} fore v. foot ${'RL'[i]}`, wrapHalf(arg(C.hand[i], Math.max) - other), (v) => `${v >= 0 ? '+' : ''}${r2(v)} cycle`);
        row('elbow', `elbow ${'LR'[i]} bends`, rng(C.elbow[i]), (v) => `${Math.round(Math.min(...C.elbow[i]))}–${Math.round(Math.max(...C.elbow[i]))}°`);
    });
    row('thigh', 'thigh swings', rng(C.thigh[0]), (v) => `${Math.round(Math.min(...C.thigh[0]))} to ${Math.round(Math.max(...C.thigh[0]))}°`);
    row('kneeLand', 'knee landing', C.knee[0][0], u('°'));
    row('kneeStance', 'knee deepest, stance', Math.max(...early), u('°'));
    row('kneeSwing', 'knee deepest, swing', Math.max(...swing0), u('°'));
    row('footLand', 'foot landing', C.sole[0][0], (v) => `${r1(Math.abs(v))}° toes ${v >= 0 ? 'up' : 'down'}`);
    row('footLeave', 'foot leaving', C.sole[0][Math.min(N - 1, lift0)], (v) => `${r1(Math.abs(v))}° heel ${v <= 0 ? 'up' : 'down'}`);
    row('width', 'step width', width, u(' cm'));
    row('clear', 'toe clears', clear, u(' cm'));
    for (const r of rows) r.out = !!r.norm && (r.v < r.norm[0] || r.v > r.norm[1]);

    // --- the frames ---
    const last = cyc[cyc.length - 1];
    const NF = 8;
    const shown = Array.from({ length: NF }, (_, i) => ({ ph: i / NF, step: stepOf(last, i / NF) }));
    const poses = shown.map((f) => poseAt(f.step));
    const lo = [Infinity, 0, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const P of poses) for (const b of skel.bones) for (const p of [boneHead(P, 0, b.index), boneTail(P, 0, b)]) for (let k = 0; k < 3; k++) { if (k !== 1) lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const pad = 0.06 * hi[1];
    lo[0] -= pad; hi[0] += pad; lo[2] -= pad; hi[2] += pad; hi[1] += pad;
    const mid = [(lo[0] + hi[0]) / 2, hi[1] / 2, (lo[2] + hi[2]) / 2];
    const W = 1560, GAP = 4, TM = 58, LAB = 24, CHMAX = 350, fov = 18;
    const up = hi[1] / 2;
    const fit = (across, cwMax) => {
        const shape = Math.max(0.3, Math.min(2.2, across / up));
        let cw = cwMax, ch = Math.round(cw / shape);
        if (ch > CHMAX) { ch = CHMAX; cw = Math.min(cwMax, Math.max(Math.round(ch * shape), 60)); }
        const dist = (1.04 * Math.max(up, across / (cw / ch))) / Math.tan((fov * Math.PI) / 360);
        return { cw, ch, dist };
    };
    const side = fit((hi[2] - lo[2]) / 2, Math.floor((W - 12 - (NF - 1) * GAP) / NF));
    const front = fit((hi[0] - lo[0]) / 2, 150);
    const camS = orbitView(mid, 90, 3, side.dist, fov), camF = orbitView(mid, 0, 3, front.dist, fov);
    showGround(true);
    const shots = { side: [], front: [] };
    for (const P of poses) {
        setPose(creature, P);
        shots.side.push(capture(camS, side.cw, side.ch));
        shots.front.push(capture(camF, front.cw, front.ch));
    }

    // --- draw ---
    const y1 = TM, y2 = y1 + side.ch + LAB, y3 = y2 + front.ch + LAB + 6;
    const CH = 196, PW = 330, H = y3 + 2 * CH + 12;
    const Sh = beginSheet(W, H);
    const g = Sh.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · one stride`, 12, 28, { size: 21, weight: 700 });
    text(g, `${run ? 'a run' : 'a walk'} at ${speed.toFixed(2)} m/s, a stride every ${period.toFixed(3)} s; phase 0 is the left foot landing; ${cyc.length} steady cycle${cyc.length > 1 ? 's' : ''} averaged in the curves; left red, right blue${people ? `; grey: what people ${run ? 'run' : 'walk'} like` : ''}`, 12, 47, { size: 13, color: DIM });
    const put = (img, x, y) => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0);
        g.drawImage(c, x, y);
    };
    const feetAt = (i) => [0, 1].map((f) => `${'LR'[f]}${S.contact[shown[i].step * S.nf + f] ? '▼' : '△'}`).join(' ');
    shown.forEach((f, i) => {
        const xs = 6 + i * (side.cw + GAP), xf = 6 + i * (front.cw + GAP);
        put(shots.side[i], xs, y1);
        put(shots.front[i], xf, y2);
        text(g, `phase ${f.ph.toFixed(3).replace(/0$/, '')}`, xs + 3, y1 + side.ch + 16, { size: 13, weight: 700 });
        text(g, feetAt(i), xs + side.cw - 3, y1 + side.ch + 16, { size: 12, color: DIM, align: 'right' });
        text(g, f.ph.toFixed(3).replace(/0$/, ''), xf + 3, y2 + front.ch + 16, { size: 12, weight: 700 });
    });
    // The table, right of the front row.
    const tx = 6 + NF * (front.cw + GAP) + 14, tw = W - tx - 8;
    const lh = Math.min(15.5, (front.ch + LAB - 18) / rows.length);
    text(g, people ? `over the stride (people ${run ? 'running' : 'walking'})` : 'over the stride', tx, y2 + 12, { size: 13, weight: 700 });
    rows.forEach((r, i) => {
        const y = y2 + 30 + i * lh, col = r.out ? BAD : INK;
        text(g, r.name, tx, y, { size: 12, color: DIM });
        text(g, r.s, tx + Math.min(150, tw * 0.46), y, { size: 12, weight: 600, color: col });
        if (r.norm) text(g, `${r.norm[0]}–${r.norm[1]}`, tx + tw, y, { size: 11, color: r.out ? BAD : DIM, align: 'right' });
    });

    // The paths, from the side.
    {
        const bx = 6, by = y3, bw = PW, bh = 2 * CH - 4;
        rect(g, bx, by, bw, bh, '#fbfaf8', FAINT);
        text(g, 'the left side over the stride, from its left (it faces left)', bx + 6, by + 15, { size: 12, weight: 650 });
        const pts = (m) => ({ head: m.head, shoulder: m.arms[0] ? m.arms[0].sh : m.withers, elbow: m.arms[0] && m.arms[0].el, wrist: m.arms[0] && m.arms[0].wr, hand: m.arms[0] && m.arms[0].tip,
            hip: m.legs[0].hip, knee: m.legs[0].knee, ankle: m.legs[0].ankle, ball: m.legs[0].ball, toe: m.legs[0].tip });
        const one = M.map((ms) => pts(ms[ms.length - 1]));
        let z0 = Infinity, z1 = -Infinity, yh = 0;
        for (const p of one) for (const q of Object.values(p)) if (q) { z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); yh = Math.max(yh, q[1]); }
        const sc = Math.min((bw - 24) / (z1 - z0), (bh - 40) / (yh * 1.04));
        const zc = (z0 + z1) / 2;
        const X = (z) => bx + bw / 2 - (z - zc) * sc, Y = (y) => by + bh - 12 - y * sc;
        line(g, bx + 4, Y(0), bx + bw - 4, Y(0), DIM, 1);
        const stick = (p, color) => {
            for (const chn of [['head', 'shoulder', 'hip', 'knee', 'ankle', 'ball', 'toe'], ['shoulder', 'elbow', 'wrist', 'hand']]) {
                poly(g, chn.filter((n) => p[n]).map((n) => [X(p[n][2]), Y(p[n][1])]), color, 2);
            }
        };
        stick(one[0], '#b9b4a8');
        stick(one[Math.round((N - 1) / 2)], '#d6d2c8');
        const cols = { head: '#34495e', shoulder: '#8e44ad', elbow: '#d68910', wrist: '#17a589', hip: '#5d6d7e', knee: '#2471a3', ankle: '#c0392b', toe: '#a04000' };
        for (const [n, col] of Object.entries(cols)) {
            if (!one[0][n]) continue;
            poly(g, one.map((p) => [X(p[n][2]), Y(p[n][1])]), col, 1.6);
            for (let e = 0; e < 8; e++) { const p = one[Math.round((e / 8) * (N - 1))][n]; dot(g, X(p[2]), Y(p[1]), e === 0 ? 4 : 2.4, e === 0 ? col : '#fbfaf8', col); }
            text(g, n, X(one[0][n][2]) + 6, Y(one[0][n][1]) - 5, { size: 10, color: col });
        }
        text(g, 'large dot: phase 0, then every eighth; dark sticks: phase 0, pale: half a cycle on', bx + 6, by + 29, { size: 10, color: DIM });
    }

    // The curves.
    const guide = (key) => (people && !run && WALK_GUIDE[key] ? phases.map((ph) => guideAt(WALK_GUIDE[key], ph)) : null);
    const charts = [
        { title: 'thigh from plumb (° forward)', ys: C.thigh, guide: guide('thigh') },
        { title: 'knee flexion (°)', ys: C.knee, guide: guide('knee') },
        { title: 'ankle (° toes toward the shin)', ys: C.ankle, guide: guide('ankle') },
        { title: 'foot to the ground (° toes up)', ys: C.sole },
        { title: 'toe tip height (cm)', ys: C.tip },
        { title: 'hip line: yaw (solid), roll (dashed) (°)', ys: [C.hipYaw], dashed: [C.hipRoll], colors: [INK] },
        { title: 'shoulder line yaw (solid), against the hips (dashed) (°)', ys: [C.shYaw], dashed: [C.against], colors: [INK] },
        { title: 'upper arm from plumb (° forward)', ys: C.arm.slice(0, 2), guide: guide('arm') },
        { title: 'elbow flexion (°)', ys: C.elbow.slice(0, 2), guide: guide('elbow') },
        { title: 'hips (solid), head (dashed) height; hips sway (dotted) (cm)', ys: [about(C.hipsY)], dashed: [about(C.headY)], dotted: [about(C.hipsX)], colors: [INK] },
    ];
    const cw = Math.floor((W - PW - 16) / 5);
    charts.forEach((c, i) => {
        const box = { x: PW + 10 + (i % 5) * cw, y: y3 + Math.floor(i / 5) * CH, w: cw, h: CH };
        text(g, c.title, box.x + 46, box.y + 11, { size: 11, weight: 650 });
        const all = [...c.ys, ...(c.dashed || []), ...(c.dotted || []), ...(c.guide ? [c.guide] : [])];
        const ax = axes(g, { x: box.x, y: box.y + 12, w: box.w, h: box.h - 12 }, { x: [0, 1], y: rangeOf(all, 0.1, 4), xn: 4, yn: 4, xfmt: (v) => String(v) });
        // Each foot's stance, a bar along the bottom.
        [0, 1].forEach((f) => {
            let a = -1;
            for (let k = 0; k <= N; k++) {
                const on = k < N && stance[f][k];
                if (on && a < 0) a = k;
                if (!on && a >= 0) { rect(g, ax.X(phases[a]), ax.B - 4 - 4 * f, ax.X(phases[k - 1]) - ax.X(phases[a]), 3, f ? RC : LC); a = -1; }
            }
        });
        if (c.guide) curve(g, ax, phases, c.guide, GUIDE, 1.4, [5, 4]);
        c.ys.forEach((y, j) => curve(g, ax, phases, y, (c.colors || [LC, RC])[j], 1.7));
        (c.dashed || []).forEach((y) => curve(g, ax, phases, y, INK, 1.3, [6, 3]));
        (c.dotted || []).forEach((y) => curve(g, ax, phases, y, INK, 1.2, [2, 3]));
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0,
        json: { gait: run ? 'run' : 'walk', speed: r2(speed), period: r2(period * 1000) / 1000, people: !!people,
            rows: rows.map((r) => ({ name: r.name, value: r.s, people: r.norm, outside: r.out })) } };
}

// The table for the terminal.
export function gaitLines(json) {
    const lines = [`${json.gait} at ${json.speed} m/s, a stride every ${json.period} s`];
    for (const r of json.rows) lines.push(`${r.outside ? '!' : ' '} ${r.name.padEnd(24)} ${r.value.padEnd(22)}${r.people ? ` people ${r.people[0]}–${r.people[1]}` : ''}`);
    return lines;
}
