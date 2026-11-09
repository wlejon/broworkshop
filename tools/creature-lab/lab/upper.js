// The upper body's motion over a run's time, not a cycle's mean, so a start
// or a stop shows as it happens.
//
//   points  the tracked points (head, withers, hips, ...) and each arm's
//           elbow and hand tip, in the world: the size of each one's
//           acceleration over time, its kinks (natural.js's test on each
//           axis in mm, merged within three steps) as red ticks, its jerk
//           (the acceleration's change, RMS) and its largest acceleration
//   bones   every bone off the legs and the tails (trunk, neck, head, the
//           arms): the size of its turning speed in the world, and the kinks
//           of each axis of its turn summed over the run
//   trunk   each of those bones' own swing against its parent over the steady
//           cycles (natural.js's overlap: amplitude of its own motion, lag,
//           and whether it is locked, moving as one with its parent)
//
// Foot events are thin lines down every row, coloured by foot; changes the
// intent asks (a start, a stop, a turn) dashed, and every kink is tagged with
// the change it follows within UPPER.after s, so a start's jerks read as
// "start +0.12 s". `from` / `to` (s) narrow the window drawn and measured.

import { beginSheet, saveSheet, text, line, rect, INK, DIM, FAINT, FOOT_COLORS } from "./page.js";
import { axes, curve, rangeOf } from "./plot.js";
import { kinks, footEvents, changes, chains, overlap, segmentAngles, steadyCycles } from "./natural.js";
import { legChains } from "./kinematics.js";
import { tailBones } from "./poses.js";
import { boneAt, boneHead, boneRot } from "./skeleton.js";
import { T, TELE } from "./contract.js";

const DEG = 180 / Math.PI;
export const UPPER = { after: 0.8 };
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

// The points measured: the skeleton's tracked points, then each arm's elbow
// (its forearm's head) and hand tip (its last bone's tail): an arm is a chain
// off the trunk that is neither a leg nor a tail nor the head's.
function pointsOf(skel) {
    const out = skel.tracks.map((t) => ({ name: t.name, bone: skel.bones[t.boneIndex], at: t.at }));
    for (const arm of armChains(skel)) {
        if (arm.length < 3) continue;
        const tip = skel.bones[arm[arm.length - 1]], elbow = skel.bones[arm[arm.length - 2]];
        out.push({ name: `elbow ${tip.name}`, bone: elbow, at: 0 });
        if (!out.some((p) => p.bone === tip && p.at === 1)) out.push({ name: `hand ${tip.name}`, bone: tip, at: 1 });
    }
    return out;
}

// The bones measured: all but the legs' and the tails'.
function upperBones(skel) {
    const legs = new Set(legChains(skel).flat()), tails = tailBones(skel);
    return skel.bones.filter((b) => b.parentIndex >= 0 && !legs.has(b.index) && !tails.has(b.index)).map((b) => b.index);
}

// Chains that end in a bone with no children, leave a bone with several
// children, and carry no leg, tail or head: the arms (shoulder to hand).
function armChains(skel) {
    const { kids } = chains(skel);
    const legs = new Set(legChains(skel).flat()), tails = tailBones(skel);
    const head = skel.bones.find((b) => b.name === 'head');
    const above = new Set();
    for (let b = head ? head.index : -1; b >= 0; b = skel.bones[b].parentIndex) above.add(b);
    const out = [];
    for (const b of skel.bones) {
        if (kids[b.index].length || legs.has(b.index) || tails.has(b.index) || above.has(b.index)) continue;
        if (head && b.parentIndex === head.index) continue;
        const ch = [b.index];
        let p = b.parentIndex;
        while (p >= 0 && kids[p].length === 1 && !above.has(p)) { ch.unshift(p); p = skel.bones[p].parentIndex; }
        if (ch.length >= 3) out.push(ch);
    }
    return out;
}

// Kinks of several channels of one thing, merged: a spike within three steps
// of another counts once (the larger).
function mergedKinks(chs, dt, near) {
    const all = [];
    let jerk = 0;
    for (const th of chs) { const e = kinks(th, dt, near); all.push(...e.spikes); jerk += e.jerkRms * e.jerkRms; }
    all.sort((a, b) => b.jump - a.jump);
    const kept = [];
    for (const s of all) if (!kept.some((q) => Math.abs(q.t - s.t) <= 3 * dt + 1e-6)) kept.push(s);
    kept.sort((a, b) => a.t - b.t);
    return { spikes: kept, jerkRms: Math.round(Math.sqrt(jerk)) };
}

export function upperSheet(rec, { path, from = null, to = null } = {}) {
    const t0 = Date.now();
    const skel = rec.creature.skel, n = rec.steps, dt = rec.dt;
    const k0 = Math.max(0, Math.round((from ?? 0) / dt)), k1 = Math.min(n - 1, Math.round((to ?? (n - 1) * dt) / dt));
    const near = footEvents(rec);
    const ch = changes(rec);
    // Which change a step follows within UPPER.after s ('start +0.12 s').
    const after = (t) => {
        let best = null;
        for (const c of ch) if (t >= c.t && t - c.t <= UPPER.after && (!best || c.t > best.t)) best = c;
        if (!best) return '';
        const what = best.what.startsWith('speed 0 ') ? 'start' : / to 0 m\/s$/.test(best.what) ? 'stop' : best.what;
        return `${what} +${(t - best.t).toFixed(2)} s`;
    };
    const win = (a) => a.slice(k0, k1 + 1);
    const nearW = near.slice(k0, k1 + 1);
    const tag = (s) => ({ ...s, t: r2(s.t + k0 * dt), change: after(s.t + k0 * dt) });
    const seconds = (k1 - k0 + 1) * dt;

    // --- points ---
    const pts = pointsOf(skel).map((p) => {
        const xyz = [0, 1, 2].map(() => new Float64Array(n));
        for (let k = 0; k < n; k++) {
            const q = boneAt(rec.pose, k * rec.poseStride, p.bone, p.at);
            for (let c = 0; c < 3; c++) xyz[c][k] = 1000 * q[c];
        }
        const acc = new Float64Array(n);
        for (let k = 1; k < n - 1; k++) {
            let s = 0;
            for (let c = 0; c < 3; c++) { const a = (xyz[c][k + 1] - 2 * xyz[c][k] + xyz[c][k - 1]) / (dt * dt) / 1000; s += a * a; }
            acc[k] = Math.sqrt(s);
        }
        const m = mergedKinks(xyz.map(win), dt, nearW);
        let peak = 0;
        for (let k = Math.max(k0, 1); k <= Math.min(k1, n - 2); k++) peak = Math.max(peak, acc[k]);
        return { name: p.name, acc, spikes: m.spikes.map(tag), perSecond: r2(m.spikes.length / seconds), jerkRms: r1(m.jerkRms / 1000), peakAcc: r1(peak) };
    });

    // --- bones: the world turn's speed, and its kinks per axis ---
    const bones = upperBones(skel).map((b) => {
        const w = [0, 1, 2].map(() => new Float64Array(n)), speed = new Float64Array(n);
        let prev = boneRot(rec.pose, 0, b);
        for (let k = 1; k < n; k++) {
            const R = boneRot(rec.pose, k * rec.poseStride, b);
            // R P^T: the step's turn in the world, as a small rotation vector.
            const M = (i, j) => R[3 * i] * prev[3 * j] + R[3 * i + 1] * prev[3 * j + 1] + R[3 * i + 2] * prev[3 * j + 2];
            const v = [(M(2, 1) - M(1, 2)) / 2, (M(0, 2) - M(2, 0)) / 2, (M(1, 0) - M(0, 1)) / 2];
            for (let c = 0; c < 3; c++) w[c][k] = w[c][k - 1] + v[c] * DEG;
            speed[k] = Math.hypot(...v) * DEG / dt;
            prev = R;
        }
        const m = mergedKinks(w.map(win), dt, nearW);
        return { name: skel.bones[b].name, speed, spikes: m.spikes.map(tag), perSecond: r2(m.spikes.length / seconds), jerkRms: m.jerkRms };
    });

    // --- the trunk's own swing over the steady cycles ---
    const cyc = steadyCycles(rec);
    const names = new Set(bones.map((b) => b.name));
    // (A bone lying across the body, a collarbone, has no pitch in the side
    // plane worth the name: it and its children's against it are left out.)
    const lateral = new Set(skel.bones.filter((b) => {
        const d = [0, 1, 2].map((i) => b.tail[i] - b.head[i]);
        return Math.abs(d[0]) > 0.7 * Math.hypot(...d);
    }).map((b) => b.name));
    const ov = cyc.length ? overlap(rec, segmentAngles(rec), cyc).pairs.filter((p) => names.has(p.bone) && !lateral.has(p.bone) && !lateral.has(p.parent)) : [];
    const trunk = ov.map((p) => ({ bone: p.bone, parent: p.parent, which: p.which, own: p.ownAmp, parent_amp: p.parentAmp, lagMs: p.lagMs, corr: p.corr, locked: p.locked }));

    // --- draw ---
    const rows = [...pts.map((p) => ({ ...p, kind: 'point', y: p.acc, unit: 'm/s2' })), ...bones.map((b) => ({ ...b, kind: 'bone', y: b.speed, unit: 'deg/s' }))];
    const W = 1500, RH = 92, TM = 64, LW = 250;
    const tableH = 22 + 16 * (trunk.length + 2);
    const H = TM + rows.length * RH + tableH + 20;
    const Sh = beginSheet(W, H);
    const g = Sh.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${rec.creature.label} · ${rec.scenario.name} · upper body over time`, 12, 28, { size: 20, weight: 700 });
    text(g, `${(k0 * dt).toFixed(2)}–${(k1 * dt).toFixed(2)} s; points: acceleration in the world (m/s2), bones: turning speed in the world (deg/s); red ticks: kinks; thin lines: foot events; dashed: what the intent changes`, 12, 48, { size: 12, color: DIM });
    const xs = [];
    for (let k = k0; k <= k1; k++) xs.push(k * dt);
    const evs = [];
    for (let k = Math.max(k0, 1); k <= k1; k++) skel.feet.forEach((f, i) => {
        const a = rec.tele[(k - 1) * TELE + T.FOOT + 4 * i] > 0.5, b = rec.tele[k * TELE + T.FOOT + 4 * i] > 0.5;
        if (a !== b) evs.push({ t: k * dt, i });
    });
    rows.forEach((r, j) => {
        const y0 = TM + j * RH;
        text(g, r.name, 12, y0 + 22, { size: 14, weight: 700 });
        text(g, `${r.spikes.length} kinks (${r.perSecond}/s)`, 12, y0 + 40, { size: 12, color: r.spikes.length ? '#c0392b' : DIM });
        text(g, r.kind === 'point' ? `jerk ${r.jerkRms} m/s3 rms · peak ${r.peakAcc} m/s2` : `jerk ${r.jerkRms} rms`, 12, y0 + 56, { size: 12, color: DIM });
        const ys = win(r.y);
        const ax = axes(g, { x: LW, y: y0, w: W - LW - 10, h: RH }, { x: [xs[0], xs[xs.length - 1]], y: rangeOf([ys], 0.05), yn: 2, xfmt: (v) => v.toFixed(1), xlabel: j === rows.length - 1 ? 's' : '' });
        for (const e of evs) line(g, ax.X(e.t), ax.T, ax.X(e.t), ax.B, FOOT_COLORS[e.i % FOOT_COLORS.length] + '55', 1);
        for (const c of ch) if (c.t >= xs[0] && c.t <= xs[xs.length - 1]) line(g, ax.X(c.t), ax.T, ax.X(c.t), ax.B, INK, 1, [4, 3]);
        curve(g, ax, xs, ys, INK, 1.2);
        for (const s of r.spikes) line(g, ax.X(s.t), ax.T, ax.X(s.t), ax.T + 10, '#c0392b', 2);
    });
    const ty = TM + rows.length * RH + 18;
    text(g, cyc.length ? 'the trunk and arms against their parents over the steady cycles (own: deg of its own swing; lag: ms behind its parent; locked: moving as one)' : 'no steady cycle: no swing against the parents', 12, ty, { size: 13, weight: 700 });
    trunk.forEach((p, i) => text(g, `${p.bone} on ${p.parent} (${p.which}): own ${p.own}° of the parent's ${p.parent_amp}°, lag ${p.lagMs} ms, r ${p.corr}${p.locked ? ' · LOCKED' : ''}`, 24, ty + 18 + 16 * i, { size: 12, color: p.locked ? '#c0392b' : INK }));
    const out = saveSheet(path);
    const strip = (r) => ({ name: r.name, kinks: r.spikes.length, perSecond: r.perSecond, jerkRms: r.jerkRms, peakAcc: r.peakAcc, spikes: r.spikes });
    return { path, width: out.width, height: out.height, ms: Date.now() - t0,
        json: { from: r2(k0 * dt), to: r2(k1 * dt), changes: ch, points: pts.map(strip), bones: bones.map(strip), trunk } };
}

// One line a row for the terminal: the worst first.
export function upperLines(json) {
    const lines = [];
    const row = (r, unit) => {
        const worst = [...r.spikes].sort((a, b) => b.jump - a.jump).slice(0, 3)
            .map((s) => `${s.t.toFixed(2)}s ${s.change || s.at}`).join('; ');
        return `${r.name.padEnd(16)} ${String(r.kinks).padStart(3)} kinks ${String(r.perSecond).padStart(5)}/s  jerk ${String(r.jerkRms).padStart(6)}${unit}${r.peakAcc !== undefined ? `  peak ${r.peakAcc} m/s2` : ''}  ${worst}`;
    };
    lines.push('points (world):');
    for (const r of [...json.points].sort((a, b) => b.kinks - a.kinks)) lines.push('  ' + row(r, ' m/s3'));
    lines.push('bones (world turn):');
    for (const r of [...json.bones].sort((a, b) => b.kinks - a.kinks)) lines.push('  ' + row(r, ''));
    if (json.trunk.length) {
        lines.push('own swing against the parent (steady cycles):');
        for (const p of json.trunk) lines.push(`  ${p.bone.padEnd(10)} on ${p.parent.padEnd(10)} own ${String(p.own).padStart(5)}° of ${String(p.parent_amp).padStart(5)}°  lag ${String(p.lagMs).padStart(4)} ms  r ${p.corr}${p.locked ? '  LOCKED' : ''}`);
    }
    return lines;
}
