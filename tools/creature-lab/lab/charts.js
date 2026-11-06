// The chart sheet of a run (or of two, A and B overlaid: A solid, B dashed):
//
//   footfalls   the Hildebrand diagram: each foot's measured contact over two
//               strides (bars), the rig's claim (a line under each bar), and
//               the reference touchdown and duty (a hollow bar) when given
//   joints      each chart joint's flexion over the stride, every steady
//               cycle thin and their mean bold, over its range (the band)
//               with the rest angle dashed
//   body        hip and withers height, pitch and roll, head height
//
// A run without a steady cycle (an action) is charted over its time.

import { beginSheet, saveSheet, text, line, rect, panel, INK, DIM, FAINT, FOOT_COLORS, SERIES } from "./page.js";
import { axes, curve, rangeOf, timeBase, meanOver } from "./plot.js";
import { series, steadyCycles, contactTouchdowns } from "./analyze.js";
import { T, TELE } from "./contract.js";

const DEG = 180 / Math.PI;
const DASH = [null, [6, 4]];

// A run's time base: by phase when it has steady cycles of an even period.
export function baseOf(rec) {
    const cyc = steadyCycles(rec);
    if (cyc.length >= 2) {
        const ps = cyc.map((c) => c.period), m = ps.reduce((s, x) => s + x, 0) / ps.length;
        if (Math.max(...ps.map((p) => Math.abs(p - m))) < 0.12 * m) return { ...timeBase(rec, cyc), cyc };
    }
    return { ...timeBase(rec, null), cyc: [] };
}

function footfallPanel(g, box, runs) {
    const nf = runs[0].rec.creature.skel.feet.length;
    const L = box.x + 46, R = box.x + box.w - 10, rowH = Math.min(30, (box.h - 30) / (nf * runs.length));
    const X = (p) => L + (p / 2) * (R - L);
    for (let p = 0; p <= 2.0001; p += 0.25) {
        line(g, X(p), box.y, X(p), box.y + nf * runs.length * rowH, p % 1 === 0 ? FAINT : '#ebe8e2', 1);
        text(g, p.toFixed(2), X(p), box.y + nf * runs.length * rowH + 14, { size: 10, color: DIM, align: 'center' });
    }
    text(g, 'stride (from the first foot\'s touchdown)', R, box.y + nf * runs.length * rowH + 28, { size: 10, color: DIM, align: 'right' });
    runs.forEach((run, ri) => {
        const { rec, base, ref } = run;
        const S = series(rec);
        const c = base.cyc[base.cyc.length - 1];
        if (!c) return;
        const span = c.b - c.a;
        rec.creature.skel.feet.forEach((f, i) => {
            const y = box.y + (i * runs.length + ri) * rowH;
            text(g, `${f.name}${runs.length > 1 ? (ri ? ' B' : ' A') : ''}`, box.x + 4, y + rowH * 0.62, { size: 11, weight: 650 });
            // Two strides from the last steady cycle's start (or the one before it).
            const a0 = Math.max(0, base.cyc.length >= 2 ? base.cyc[base.cyc.length - 2].a : c.a);
            const s0 = a0, s1 = Math.min(rec.steps, a0 + 2 * span);
            let k = s0;
            while (k < s1) {
                const on = S.contact[k * S.nf + i];
                let e = k;
                while (e < s1 && S.contact[e * S.nf + i] === on) e++;
                if (on) rect(g, X((k - s0) / span), y + 3, Math.max(1, X((e - s0) / span) - X((k - s0) / span)), rowH - 10, FOOT_COLORS[i]);
                k = e;
            }
            // The rig's claim, as a line under the bar.
            k = s0;
            while (k < s1) {
                const on = rec.tele[k * TELE + T.FOOT + 4 * i] > 0.5;
                let e = k;
                while (e < s1 && (rec.tele[e * TELE + T.FOOT + 4 * i] > 0.5) === on) e++;
                if (on) line(g, X((k - s0) / span), y + rowH - 4, X((e - s0) / span), y + rowH - 4, INK, 2, DASH[ri]);
                k = e;
            }
            if (ref && ref.offsets && ref.offsets[f.name] != null) {
                for (let p = ref.offsets[f.name]; p < 2; p += 1) {
                    const w = Math.min(ref.duty, 2 - p);
                    g.strokeStyle = INK; g.lineWidth = 1.2; g.setLineDash([3, 3]);
                    g.strokeRect(X(p), y + 2, X(p + w) - X(p), rowH - 8);
                    g.setLineDash([]);
                }
            }
        });
    });
}

export function chartsSheet(recs, { path, title = '', labels = null } = {}) {
    const t0 = Date.now();
    const runs = recs.map((rec) => {
        const cycles = rec.creature.def.cycles || {};
        const gait = Object.keys(cycles).find((gk) => cycles[gk].scenario === rec.scenario.name);
        return { rec, base: baseOf(rec), ref: gait ? cycles[gait].reference : null };
    });
    const r0 = runs[0].rec, skel = r0.creature.skel;
    const joints = (skel.chartJoints || []).map((i) => skel.bones[i]);
    const W = 1680, cols = 4, jw = (W - 20) / cols, jh = 190;
    const jrows = Math.ceil(joints.length / cols);
    const nf = skel.feet.length;
    const fh = 70 + nf * runs.length * 30;
    const bh = 230;
    const H = 70 + fh + 14 + jrows * jh + 14 + bh * 2 + 30;
    const S = beginSheet(W, H);
    const g = S.g;
    const mode = runs[0].base.mode;
    const xr = mode === 'phase' ? [0, 1] : [0, r0.steps * r0.dt];
    const xfmt = mode === 'phase' ? (v) => v.toFixed(2) : (v) => v.toFixed(1);

    text(g, title || `${runs.map((r) => r.rec.creature.label).join(' vs ')} · ${r0.scenario.name} · charts`, 10, 26, { size: 18, weight: 700 });
    const sub = mode === 'phase'
        ? `${runs[0].base.cyc.length} steady cycles of ${(runs[0].base.cyc.reduce((s, c) => s + c.period, 0) / runs[0].base.cyc.length).toFixed(3)} s, phase 0 at the ${skel.feet[0].name} touchdown (measured): thin lines each cycle, bold their mean`
        : `no steady cycle: over the run's time`;
    text(g, sub + (runs.length > 1 ? ` · A solid (${runs[0].rec.creature.label}), B dashed (${runs[1].rec.creature.label})` : ''), 10, 48, { size: 13, color: DIM });

    // Footfalls.
    let y = 64;
    const fb = panel(g, 10, y, W - 20, fh, 'footfalls (Hildebrand): bars measured contact · line under: the rig\'s planted claim · dotted box: reference');
    if (mode === 'phase') footfallPanel(g, fb, runs);
    else {
        // Over time: contact strips across the run.
        const L = fb.x + 46, R = fb.x + fb.w - 10, rowH = Math.min(30, (fb.h - 30) / (nf * runs.length));
        runs.forEach(({ rec }, ri) => {
            const Sx = series(rec);
            skel.feet.forEach((f, i) => {
                const yy = fb.y + (i * runs.length + ri) * rowH;
                text(g, `${f.name}${runs.length > 1 ? (ri ? ' B' : ' A') : ''}`, fb.x + 4, yy + rowH * 0.62, { size: 11, weight: 650 });
                let k = 0;
                while (k < rec.steps) {
                    const on = Sx.contact[k * Sx.nf + i];
                    let e = k;
                    while (e < rec.steps && Sx.contact[e * Sx.nf + i] === on) e++;
                    if (on) rect(g, L + (k / rec.steps) * (R - L), yy + 3, Math.max(1, ((e - k) / rec.steps) * (R - L)), rowH - 10, FOOT_COLORS[i]);
                    k = e;
                }
            });
        });
        for (const v of [0, 0.25, 0.5, 0.75, 1]) text(g, (v * r0.steps * r0.dt).toFixed(1) + ' s', L + v * (R - L), fb.y + nf * runs.length * rowH + 14, { size: 10, color: DIM, align: 'center' });
    }
    y += fh + 14;

    // Joint angles.
    joints.forEach((b, j) => {
        const bx = 10 + (j % cols) * jw, by = y + Math.floor(j / cols) * jh;
        const inner = panel(g, bx, by, jw - 8, jh - 8, `${b.name} flexion (deg)`);
        const series_ = runs.map(({ rec, base }) => {
            const Sx = series(rec);
            const per = base.cycles.map((c) => c.map((k) => Sx.angles[k][b.index][0] * DEG));
            return { per, mean: meanOver(base, (k) => Sx.angles[k][b.index][0] * DEG) };
        });
        const lo = b.lim[0][0] * DEG, hi = b.lim[0][1] * DEG;
        const yr = rangeOf([...series_.flatMap((s) => s.per), [0]], 0.12, 10);
        // The data and the rest angle, and a limit's edge when it is near.
        const ylo = lo > yr[0] - 25 ? Math.min(yr[0], lo - 4) : yr[0];
        const yhi = hi < yr[1] + 25 ? Math.max(yr[1], hi + 4) : yr[1];
        const ax = axes(g, inner, { x: xr, y: [ylo, yhi], xfmt, yfmt: (v) => v.toFixed(0), band: [lo, hi] });
        line(g, ax.L, ax.Y(0), ax.R, ax.Y(0), DIM, 1, [3, 3]);
        series_.forEach((s, ri) => {
            const xs = runs[ri].base.xs;
            if (s.per.length > 1) for (const p of s.per) curve(g, ax, xs, p, ri ? '#7fa7c9' : '#d9a29a', 1, DASH[ri]);
            curve(g, ax, xs, s.mean, ri ? '#1f5f99' : '#a32d22', 2.2, DASH[ri]);
        });
        // Out of range: marked along the top or bottom edge.
        series_.forEach((s) => s.per.forEach((p) => p.forEach((v, i) => {
            if (v > hi + 0.5 || v < lo - 0.5) line(g, ax.X(runs[0].base.xs[i]), v > hi ? ax.T : ax.B - 4, ax.X(runs[0].base.xs[i]), v > hi ? ax.T + 4 : ax.B, '#e00000', 2);
        })));
        text(g, `range ${lo.toFixed(0)}..${hi.toFixed(0)}`, inner.x + inner.w - 4, by + 17, { size: 10, color: DIM, align: 'right' });
    });
    y += jrows * jh + 14;

    // Body: heights and angles.
    const bodyCurves = [
        { name: 'hip height (m over the ground)', f: (rec, k) => rec.tele[k * TELE + T.HEIGHT] },
        { name: 'withers height (m over the ground)', f: (rec, k) => trackY(rec, k, 'withers') },
        { name: 'head height (m over the ground)', f: (rec, k) => trackY(rec, k, 'head') },
        { name: 'pitch (deg, nose up +)', f: (rec, k) => rec.tele[k * TELE + T.PITCH] * DEG },
        { name: 'roll (deg)', f: (rec, k) => rec.tele[k * TELE + T.ROLL] * DEG },
        { name: 'speed (m/s)', f: (rec, k) => rec.tele[k * TELE + T.SPEED] },
    ];
    const bw = (W - 20) / 3;
    bodyCurves.forEach((bc, j) => {
        const bx = 10 + (j % 3) * bw, by = y + Math.floor(j / 3) * bh;
        const inner = panel(g, bx, by, bw - 8, bh - 8, bc.name);
        const ss = runs.map(({ rec, base }) => ({
            per: base.cycles.map((c) => c.map((k) => bc.f(rec, k))),
            mean: meanOver(base, (k) => bc.f(rec, k)),
        }));
        const ax = axes(g, inner, { x: xr, y: rangeOf(ss.flatMap((s) => s.per), 0.12, bc.name.startsWith('pitch') || bc.name.startsWith('roll') ? 2 : 0.02), xfmt, yfmt: (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)) });
        ss.forEach((s, ri) => {
            const xs = runs[ri].base.xs;
            if (s.per.length > 1) for (const p of s.per) curve(g, ax, xs, p, ri ? '#7fa7c9' : '#d9a29a', 1, DASH[ri]);
            curve(g, ax, xs, s.mean, SERIES[ri ? 1 : 0], 2.2, DASH[ri]);
        });
    });
    text(g, 'band: the joint\'s range · dashed: its rest angle · red ticks: past the range', 10, H - 10, { size: 12, color: DIM });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0 };
}

const trackCache = new WeakMap();
function trackY(rec, k, name) {
    let idx = trackCache.get(rec);
    if (!idx) { idx = {}; trackCache.set(rec, idx); }
    if (idx[name] === undefined) idx[name] = rec.creature.skel.tracks.findIndex((t) => t.name === name);
    const S = series(rec);
    const i = idx[name];
    if (i < 0) return NaN;
    return S.tracks[k][i][1] - groundAt(rec, k);
}

function groundAt(rec, k) {
    // The root's height less the rig's hip height over the ground is the ground under the root.
    return rec.tele[k * TELE + T.POS + 1] - rec.tele[k * TELE + T.HEIGHT];
}

export { contactTouchdowns };
