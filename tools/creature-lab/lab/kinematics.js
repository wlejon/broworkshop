// Two sheets for finding where in a stride the motion jumps.
//
//   kinematics  per leg, each of its bones' flexion, angular velocity and
//               angular acceleration over the steady cycle (every cycle thin,
//               the mean bold), the leg's measured contact across the top and
//               its lift-off and touchdown carried down through the rows; then
//               the trunk's and the dangling chains' bones the same way. The
//               corners natural.js's smoothness test finds (a spike in a
//               joint's acceleration against its neighbours) are red ticks.
//   spacing     the animator's spacing chart: points sampled at a fixed frame
//               rate (30 fps), so the gap between dots is speed. Each toe and
//               each leg's middle joint, and the tracked points (head,
//               withers, hips, tail tip), drawn along their path over the last
//               steady cycle in the creature's frame (toes in the world's too,
//               where a planted toe sits on one spot), with the frame-to-frame
//               distance under each path. A skip is a frame whose step is
//               SKIP times the step before it or after it, the larger over
//               SKIP_MIN and over SKIP_PEAK of the point's fastest step: a
//               start or a stop with no ease, or a jump mid-path. Skips are
//               red on the path and the strip.
//
// Both write a JSON of what they found beside the image. A run with no steady
// cycle is drawn over its time.

import { beginSheet, saveSheet, text, line, rect, panel, dot, poly, INK, DIM, FAINT, FOOT_COLORS } from "./page.js";
import { axes, curve, rangeOf, meanOver } from "./plot.js";
import { series } from "./analyze.js";
import { smoothness, chains } from "./natural.js";
import { baseOf } from "./charts.js";
import { T, TELE } from "./contract.js";
import { ROWS } from "./skeleton.js";

const DEG = 180 / Math.PI;
export const SKIP = 2.0;        // a step this many times its neighbour's is a skip,
export const SKIP_MIN = 0.006;  //   when the larger is over this (m a frame)
export const SKIP_PEAK = 0.25;  //   and over this share of the point's fastest step (an ease's last small steps are not skips)
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const wrap = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

// Each leg's bones from the top of its chain to its foot.
export function legChains(skel) {
    const { kids } = chains(skel);
    return skel.feet.map((f) => {
        const out = [];
        let b = f.boneIndex;
        while (b >= 0) {
            out.unshift(b);
            const p = skel.bones[b].parentIndex;
            if (p < 0 || kids[p].length > 1) break;
            b = p;
        }
        return out;
    });
}

// Leg i's events (steps where it lifts and lands, by measured contact).
function legEvents(rec, i) {
    const S = series(rec), nf = S.nf, out = [];
    for (let k = 1; k < rec.steps; k++) {
        const a = S.contact[(k - 1) * nf + i], b = S.contact[k * nf + i];
        if (a && !b) out.push({ k, kind: 'lift-off' });
        if (!a && b) out.push({ k, kind: 'touchdown' });
    }
    return out;
}

// The nearest event of leg i to step k, and how far (s); a step between
// events is mid-swing or stance by contact.
function nearestEvent(rec, events, i, k) {
    let best = null;
    for (const e of events) if (!best || Math.abs(e.k - k) < Math.abs(best.k - k)) best = e;
    const S = series(rec);
    const at = best && Math.abs(best.k - k) * rec.dt <= 0.05 ? best.kind : (S.contact[k * S.nf + i] ? 'stance' : 'mid-swing');
    return { where: at, dt: best ? r3((k - best.k) * rec.dt) : null };
}

function unwrapSeries(rec, b) {
    const S = series(rec), n = rec.steps, th = new Float64Array(n);
    for (let k = 0; k < n; k++) th[k] = S.angles[k][b][0] * DEG;
    for (let k = 1; k < n; k++) th[k] = th[k - 1] + wrap(th[k] - th[k - 1]);
    const v = new Float64Array(n), a = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) { v[k] = (th[k + 1] - th[k - 1]) / (2 * rec.dt); a[k] = (th[k + 1] - 2 * th[k] + th[k - 1]) / (rec.dt * rec.dt); }
    v[0] = v[1]; v[n - 1] = v[n - 2]; a[0] = a[1]; a[n - 1] = a[n - 2];
    return { th, v, a };
}

// Tracked point j's coordinate `axis` (1 height, 2 fore-aft) in the
// creature's frame, cm, with its velocity and acceleration.
function trackSeries(rec, j, axis) {
    const S = series(rec), n = rec.steps, th = new Float64Array(n);
    for (let k = 0; k < n; k++) th[k] = relPoint(rec, k, S.tracks[k][j])[axis] * 100;
    const v = new Float64Array(n), a = new Float64Array(n);
    for (let k = 1; k < n - 1; k++) { v[k] = (th[k + 1] - th[k - 1]) / (2 * rec.dt); a[k] = (th[k + 1] - 2 * th[k] + th[k - 1]) / (rec.dt * rec.dt); }
    v[0] = v[1]; v[n - 1] = v[n - 2]; a[0] = a[1]; a[n - 1] = a[n - 2];
    return { th, v, a };
}

// A step's place on the x axis: phase within its cycle, or time.
function xOf(base, rec, k) {
    if (base.mode !== 'phase') return k * rec.dt;
    for (const c of base.cyc) if (k >= c.a && k < c.b) return (k - c.a) / (c.b - c.a);
    return null;
}

// --- kinematics ---------------------------------------------------------------------------------

export function kinematicsSheet(rec, { path } = {}) {
    const t0 = Date.now();
    const skel = rec.creature.skel, base = baseOf(rec);
    const legs = legChains(skel);
    const { free, root } = chains(skel);
    const sm = smoothness(rec);
    const spikesOf = new Map(sm.joints.map((j) => [j.bone, j.spikes]));
    const events = skel.feet.map((_, i) => legEvents(rec, i));
    const blocks = legs.map((bones, i) => ({ name: skel.feet[i].name, bones, leg: i }));
    blocks.push({ name: 'trunk and hanging parts', bones: [root, ...free], leg: -1 });
    // The tracked points' paths (creature frame): their height and fore-aft
    // place, in cm, the way a bone's flexion is drawn.
    const paths = [];
    skel.tracks.forEach((t, j) => {
        for (const [axis, ax] of [['height', 1], ['fore-aft', 2]]) paths.push({ name: `${t.name} ${axis}`, s: trackSeries(rec, j, ax) });
    });
    if (paths.length) blocks.push({ name: 'tracked points (cm, creature frame)', bones: paths, leg: -1 });

    const W = 1800, cw = 300, rowH = 92, top = 64;
    const colsOf = (b) => Math.min(b.bones.length, Math.floor((W - 20) / cw));
    const blockH = (b) => 40 + Math.ceil(b.bones.length / colsOf(b)) * 3 * rowH + 10;
    const H = top + blocks.reduce((s, b) => s + blockH(b) + 12, 0) + 30;
    const S = beginSheet(W, H), g = S.g;
    const xr = base.mode === 'phase' ? [0, 1] : [0, rec.steps * rec.dt];
    const xfmt = base.mode === 'phase' ? (v) => v.toFixed(1) : (v) => v.toFixed(1);
    text(g, `${rec.creature.label} · ${rec.scenario.name} · kinematics`, 10, 26, { size: 18, weight: 700 });
    text(g, (base.mode === 'phase' ? `${base.cyc.length} steady cycles, phase 0 at the ${skel.feet[0].name} touchdown: thin each cycle, bold the mean` : 'no steady cycle: over the run\'s time')
        + ` · flexion (deg), its velocity (deg/s), its acceleration (deg/s²) · red: a corner (natural.js smoothness) · solid line lift-off, dashed touchdown`, 10, 48, { size: 13, color: DIM });

    const found = [];
    let y = top;
    for (const blk of blocks) {
        const cols = colsOf(blk), bw = (W - 20) / cols;
        const inner = panel(g, 10, y, W - 20, blockH(blk), blk.leg >= 0 ? `leg ${blk.name}` : blk.name);
        // The leg's contact (mean over cycles) across the top, and its events.
        const evx = [];
        if (blk.leg >= 0) {
            const Sx = series(rec);
            const cont = meanOver(base, (k) => Sx.contact[k * Sx.nf + blk.leg]);
            const L = inner.x + 46, R = inner.x + inner.w - 8;
            base.xs.forEach((x, j) => { if (cont[j] > 0.5) rect(g, L + ((x - xr[0]) / (xr[1] - xr[0])) * (R - L), inner.y + 2, (R - L) / base.xs.length + 1, 8, FOOT_COLORS[blk.leg]); });
            for (const e of events[blk.leg]) { const x = xOf(base, rec, e.k); if (x != null) evx.push({ x, kind: e.kind }); }
        }
        blk.bones.forEach((b, j) => {
            const track = typeof b === 'object';
            const bone = track ? { name: b.name } : skel.bones[b];
            const s = track ? b.s : unwrapSeries(rec, b);
            const bx = 10 + (j % cols) * bw, by = inner.y + 14 + Math.floor(j / cols) * 3 * rowH;
            const rows = [
                track ? { f: (k) => s.th[k], name: bone.name } : { f: (k) => s.th[k], name: `${bone.name} flexion`, band: [bone.lim[0][0] * DEG, bone.lim[0][1] * DEG] },
                { f: (k) => s.v[k], name: 'velocity' },
                { f: (k) => s.a[k], name: 'acceleration' },
            ];
            rows.forEach((r, ri) => {
                const box = { x: bx + 4, y: by + ri * rowH, w: bw - 12, h: rowH - 4 };
                const per = base.cycles.map((c) => c.map(r.f));
                const mean = meanOver(base, r.f);
                const ax = axes(g, box, { x: xr, y: rangeOf(per, 0.1, ri ? 5 : 2), xfmt, yfmt: (v) => (Math.abs(v) >= 100 ? v.toExponential(0) : v.toFixed(0)), xn: 4, yn: 3, band: r.band });
                text(g, r.name, ax.L + 4, ax.T + 11, { size: 10, color: DIM });
                for (const e of evx) line(g, ax.X(e.x), ax.T, ax.X(e.x), ax.B, '#8a857a', 1, e.kind === 'touchdown' ? [4, 3] : null);
                if (per.length > 1) for (const p of per) curve(g, ax, base.xs, p, '#d9a29a', 1);
                curve(g, ax, base.xs, mean, '#a32d22', 2);
                // Corners, at their place in whichever cycle they fall.
                if (ri === 0) for (const sp of spikesOf.get(bone.name) || []) {
                    const k = Math.round(sp.t / rec.dt), x = xOf(base, rec, k);
                    if (x == null) continue;
                    line(g, ax.X(x), ax.T, ax.X(x), ax.T + 9, '#e00000', 2);
                }
            });
            for (const sp of spikesOf.get(bone.name) || []) {
                const k = Math.round(sp.t / rec.dt), x = xOf(base, rec, k);
                if (x == null) continue;
                const ev = blk.leg >= 0 ? nearestEvent(rec, events[blk.leg], blk.leg, k) : { where: 'body', dt: null };
                found.push({ bone: bone.name, leg: blk.leg >= 0 ? blk.name : null, [base.mode]: r3(x), t: sp.t, size: sp.jump, where: ev.where, fromEvent: ev.dt });
            }
        });
        y += blockH(blk) + 12;
    }
    const out = saveSheet(path);
    const summary = summarize(found, (f) => `${f.bone} ${f.where}`);
    return { ...out, ms: Date.now() - t0, json: { corners: found, byPlace: summary, spikesPerSecond: sm.spikesPerSecond } };
}

function summarize(list, key) {
    const m = new Map();
    for (const f of list) { const k = key(f); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ place: k, count: n }));
}

// --- spacing ------------------------------------------------------------------------------------

// The points the spacing chart follows: each toe, each leg's middle joint,
// and the tracked points; `at(k)` its world position at step k.
function spacingPoints(rec) {
    const skel = rec.creature.skel, S = series(rec), nf = S.nf;
    const pts = [];
    const headOf = (k, b) => { const o = k * rec.poseStride + b * ROWS; return [rec.pose[o + 3], rec.pose[o + 7], rec.pose[o + 11]]; };
    legChains(skel).forEach((bones, i) => {
        const f = skel.feet[i];
        pts.push({ name: `${f.name} toe`, leg: i, toe: true, at: (k) => Array.from(S.sole.subarray(((k * nf + i) * S.ns) * 3, ((k * nf + i) * S.ns) * 3 + 3)) });
        const mid = bones[Math.max(1, bones.length - 2)];
        pts.push({ name: `${f.name} ${skel.bones[mid].name}`, leg: i, toe: false, at: (k) => headOf(k, mid) });
    });
    skel.tracks.forEach((t, j) => pts.push({ name: t.name, leg: -1, toe: false, at: (k) => S.tracks[k][j] }));
    return pts;
}

function relPoint(rec, k, p) {
    const o = k * TELE, yaw = rec.tele[o + T.YAW], c = Math.cos(-yaw), s = Math.sin(-yaw);
    const x = p[0] - rec.tele[o + T.POS], z = p[2] - rec.tele[o + T.POS + 2];
    return [c * x + s * z, p[1], -s * x + c * z];
}

// Skips in a list of frame positions: frame i's step against the one before
// and after.
export function skipsOf(pos) {
    const st = [];
    for (let i = 1; i < pos.length; i++) st.push(Math.hypot(pos[i][0] - pos[i - 1][0], pos[i][1] - pos[i - 1][1], pos[i][2] - pos[i - 1][2]));
    const out = [];
    const floor = Math.max(SKIP_MIN, SKIP_PEAK * Math.max(0, ...st));
    for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i], hi = Math.max(a, b), lo = Math.min(a, b);
        if (hi < floor) continue;
        const ratio = hi / Math.max(lo, SKIP_MIN / SKIP);
        if (ratio >= SKIP) out.push({ frame: b > a ? i + 1 : i, step: i, ratio: r2(ratio), kind: b > a ? (a < SKIP_MIN / 2 ? 'sudden start' : 'jump') : (b < SKIP_MIN / 2 ? 'sudden stop' : 'drop') });
    }
    return { steps: st, skips: out };
}

export function spacingSheet(rec, { path, fps = 30 } = {}) {
    const t0 = Date.now();
    const skel = rec.creature.skel, base = baseOf(rec);
    const c = base.cyc.length ? base.cyc[base.cyc.length - 1] : { a: Math.round(rec.steps * 0.4), b: rec.steps - 1 };
    const every = Math.max(1, Math.round(1 / (fps * rec.dt)));
    const frames = [];
    for (let k = c.a; k <= c.b; k += every) frames.push(k);
    const pts = spacingPoints(rec);
    const events = skel.feet.map((_, i) => legEvents(rec, i).filter((e) => e.k >= c.a && e.k <= c.b));
    const phaseOf = (k) => (base.cyc.length ? (k - c.a) / (c.b - c.a) : k * rec.dt);

    const panels = [];
    for (const p of pts) {
        panels.push({ p, world: false });
        if (p.toe) panels.push({ p, world: true });
    }
    const W = 1800, cols = 4, pw = (W - 20) / cols, ph = 300;
    const H = 70 + Math.ceil(panels.length / cols) * ph + 30;
    const S = beginSheet(W, H), g = S.g;
    text(g, `${rec.creature.label} · ${rec.scenario.name} · spacing`, 10, 26, { size: 18, weight: 700 });
    text(g, `${base.cyc.length ? 'the last steady cycle' : 'the run from 40% in'} at ${fps} fps (a dot a frame: the gap is the speed) · side view in the creature's frame (world frame where marked) · ` +
        `red: a skip, a frame's step ${SKIP}x the step next to it (over ${SKIP_MIN * 100} cm and ${SKIP_PEAK * 100}% of the fastest) · ▲ lift-off ▼ touchdown`, 10, 48, { size: 13, color: DIM });
    const found = [];
    panels.forEach(({ p, world }, j) => {
        const bx = 10 + (j % cols) * pw, by = 64 + Math.floor(j / cols) * ph;
        const inner = panel(g, bx, by, pw - 8, ph - 8, `${p.name}${world ? ' (world)' : ''}`);
        const raw = frames.map((k) => p.at(k));
        const pos = world ? raw : frames.map((k, i) => relPoint(rec, k, raw[i]));
        const { steps, skips } = skipsOf(pos);
        const color = p.leg >= 0 ? FOOT_COLORS[p.leg] : INK;
        // Path: side view (z forward, y up), equal aspect.
        const pathBox = { x: inner.x, y: inner.y, w: inner.w, h: inner.h * 0.62 };
        let zs = pos.map((q) => q[2]), ys = pos.map((q) => q[1]);
        if (world) { const z0 = zs[0]; zs = zs.map((z) => z - z0); }
        const zr = rangeOf([zs], 0.08, 0.05), yr = rangeOf([ys], 0.15, 0.05);
        const sx = (pathBox.w - 20) / (zr[1] - zr[0]), sy = (pathBox.h - 16) / (yr[1] - yr[0]), sc = Math.min(sx, sy);
        const cx = pathBox.x + pathBox.w / 2, cy = pathBox.y + pathBox.h / 2;
        const zm = (zr[0] + zr[1]) / 2, ym = (yr[0] + yr[1]) / 2;
        const P = (i) => [cx + (zs[i] - zm) * sc, cy - (ys[i] - ym) * sc];
        poly(g, pos.map((_, i) => P(i)), FAINT, 1);
        const bad = new Set(skips.map((s) => s.frame));
        pos.forEach((_, i) => { const [x, yy] = P(i); dot(g, x, yy, bad.has(i) ? 3.4 : 2.2, bad.has(i) ? '#e00000' : color); });
        const legEv = p.leg >= 0 ? events[p.leg] : [];
        for (const e of legEv) {
            const i = Math.min(frames.length - 1, Math.max(0, Math.round((e.k - c.a) / every)));
            const [x, yy] = P(i);
            text(g, e.kind === 'lift-off' ? '▲' : '▼', x, yy - 6, { size: 10, color: DIM, align: 'center' });
        }
        // 10 cm bar.
        line(g, pathBox.x + 8, pathBox.y + pathBox.h - 4, pathBox.x + 8 + 0.1 * sc, pathBox.y + pathBox.h - 4, INK, 2);
        text(g, '10 cm', pathBox.x + 12 + 0.1 * sc, pathBox.y + pathBox.h - 1, { size: 9, color: DIM });
        // Strip: each frame's step (cm) over the phase.
        const sb = { x: inner.x, y: inner.y + inner.h * 0.64, w: inner.w, h: inner.h * 0.36 };
        const xs = frames.slice(1).map(phaseOf);
        const cm = steps.map((s) => s * 100);
        const ax = axes(g, sb, { x: base.cyc.length ? [0, 1] : [xs[0], xs[xs.length - 1]], y: [0, Math.max(0.5, ...cm) * 1.1], xfmt: (v) => v.toFixed(1), yfmt: (v) => v.toFixed(1), xn: 4, yn: 2 });
        text(g, 'cm a frame', ax.L + 4, ax.T + 10, { size: 9, color: DIM });
        for (const e of legEv) line(g, ax.X(phaseOf(e.k)), ax.T, ax.X(phaseOf(e.k)), ax.B, '#8a857a', 1, e.kind === 'touchdown' ? [4, 3] : null);
        const bw = Math.max(1, (ax.R - ax.L) / xs.length - 1);
        cm.forEach((v, i) => rect(g, ax.X(xs[i]) - bw / 2, ax.Y(v), bw, ax.B - ax.Y(v), bad.has(i + 1) ? '#e00000' : color));
        for (const s of skips) {
            const k = frames[s.frame];
            const ev = p.leg >= 0 ? nearestEvent(rec, legEvents(rec, p.leg), p.leg, k) : { where: 'body', dt: null };
            found.push({ point: p.name, frame: world ? 'world' : 'creature', phase: r3(phaseOf(k)), t: r3(k * rec.dt), ratio: s.ratio, kind: s.kind, where: ev.where, fromEvent: ev.dt });
        }
    });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0, json: { fps, skip: SKIP, skipMin: SKIP_MIN, skips: found, byPlace: summarize(found, (f) => `${f.point} ${f.kind} ${f.where}`) } };
}
