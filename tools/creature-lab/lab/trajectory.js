// The trajectory sheet: the paths of the feet, hips, withers, head and tail
// tip in the creature's own frame (its root's ground point at the origin,
// facing +Z, so a planted hoof runs backward and swings forward), from the
// side, the front and the top, each point in its own row of panels, each
// panel at one scale on both axes (a bar gives it; the feet's side and front
// views include the ground), with phase ticks every 0.1 (labelled each quarter).
// Every steady cycle is drawn thin, the last bold; with two runs, B dashed.

import { beginSheet, saveSheet, text, line, dot, poly, panel, INK, DIM, FOOT_COLORS, SERIES } from "./page.js";
import { series } from "./analyze.js";
import { baseOf } from "./charts.js";
import { toRelative } from "./cycle.js";
import { boneTail } from "./skeleton.js";
import { T, TELE } from "./contract.js";

const VIEWS = [
    { name: 'side (from its right)', h: (p) => p[2], v: (p) => p[1], hl: 'forward →', vl: 'y' },
    { name: 'front', h: (p) => p[0], v: (p) => p[1], hl: 'its left →', vl: 'y' },
    { name: 'top', h: (p) => p[2], v: (p) => p[0], hl: 'forward → (its left up)', vl: 'x left' },
];

function groundOf(rec, k) { return rec.tele[k * TELE + T.POS + 1] - rec.tele[k * TELE + T.HEIGHT]; }

// A tracked point's path in the creature's frame, sampled on the run's base.
function paths(rec, base, pick) {
    return base.cycles.map((steps) => steps.map((k) => toRelative(rec, k, groundOf(rec, k), pick(k))));
}

export function trajectorySheet(recs, { path, title = '' } = {}) {
    const t0 = Date.now();
    const runs = recs.map((rec) => ({ rec, base: baseOf(rec) }));
    const r0 = runs[0].rec, skel = r0.creature.skel;
    const rows = [
        { name: 'feet', points: skel.feet.map((f, i) => ({ name: f.name, color: FOOT_COLORS[i], pick: (rec, k) => boneTail(rec.pose, k * rec.poseStride, skel.bones[f.boneIndex]) })) },
        ...skel.tracks.map((t, ti) => ({ name: t.name, points: [{ name: t.name, color: SERIES[(ti + 1) % SERIES.length], pick: (rec, k) => series(rec).tracks[k][ti] }] })),
    ];
    const W = 1680, ph = 250, M = 10, pw = (W - 2 * M) / 3;
    const H = 70 + rows.length * ph + 30;
    const S = beginSheet(W, H);
    const g = S.g;
    const mode = runs[0].base.mode;
    text(g, title || `${runs.map((r) => r.rec.creature.label).join(' vs ')} · ${r0.scenario.name} · trajectories`, M, 26, { size: 18, weight: 700 });
    text(g, (mode === 'phase' ? `in the creature's frame over ${runs[0].base.cyc.length} steady cycles; ticks every 0.1 of the stride, labelled each quarter, phase 0 at the ${skel.feet[0].name} touchdown`
        : `in the creature's frame across the run; ticks every 0.5 s`) + (runs.length > 1 ? ` · A solid, B dashed` : ''), M, 48, { size: 13, color: DIM });

    rows.forEach((row, ri) => {
        // Every path of the row, per run and point.
        const data = runs.map(({ rec, base }) => row.points.map((pt) => paths(rec, base, (k) => pt.pick(rec, k))));
        VIEWS.forEach((view, vi) => {
            const box = panel(g, M + vi * pw, 64 + ri * ph, pw - 8, ph - 8, `${row.name} · ${view.name}`);
            let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity;
            for (const run of data) for (const pt of run) for (const cyc of pt) for (const p of cyc) {
                const h = view.h(p), v = view.v(p);
                h0 = Math.min(h0, h); h1 = Math.max(h1, h); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
            }
            const feet = ri === 0;
            if (feet && vi < 2) v0 = Math.min(v0, 0);   // the feet's side and front views keep the ground
            // Equal scale on both axes, at least 4 cm of span each way.
            const sh = Math.max(h1 - h0, 0.04), sv = Math.max(v1 - v0, 0.04);
            const hc = (h0 + h1) / 2, vc = (v0 + v1) / 2;
            h0 = hc - sh / 2; h1 = hc + sh / 2; v0 = vc - sv / 2; v1 = vc + sv / 2;
            const k = Math.min((box.w - 60) / sh, (box.h - 40) / sv);
            const cx = box.x + 46 + (box.w - 60 - sh * k) / 2, cy = box.y + 8 + (box.h - 40 + sv * k) / 2;
            const X = (h) => cx + (h - h0) * k, Y = (v) => cy - (v - v0) * k;
            // Ground line (feet), the height or offset at the left, and a scale bar.
            if (feet && vi < 2) line(g, box.x, Y(0), box.x + box.w, Y(0), '#b9b4aa', 1, [5, 4]);
            for (const v of [v0, v1]) text(g, `${(v * 100).toFixed(0)} cm`, box.x + 40, Y(v) + 4, { size: 9, color: DIM, align: 'right' });
            const bar = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find((b) => b * k > 40) || 1;
            line(g, box.x + box.w - 10 - bar * k, box.y + box.h - 6, box.x + box.w - 10, box.y + box.h - 6, INK, 2);
            text(g, `${bar < 1 ? +(bar * 100).toFixed(1) + ' cm' : bar + ' m'}`, box.x + box.w - 14 - bar * k, box.y + box.h - 2, { size: 10, color: DIM, align: 'right' });
            text(g, view.hl, box.x + 40, box.y + box.h - 2, { size: 10, color: DIM });
            data.forEach((run, ri2) => run.forEach((pt, pi) => {
                const col = row.points[pi].color;
                pt.forEach((cyc, ci) => {
                    const last = ci === pt.length - 1;
                    poly(g, cyc.map((p) => [X(view.h(p)), Y(view.v(p))]), last ? col : col + '55', last ? 2 : 1, ri2 ? [6, 4] : null);
                });
                // Phase ticks on the last cycle.
                const cyc = pt[pt.length - 1];
                const xs = runs[ri2].base.xs;
                const every = mode === 'phase' ? 0.1 : 0.5;
                let next = 0;
                for (let i = 0; i < cyc.length; i++) {
                    if (xs[i] + 1e-9 < next) continue;
                    const p = cyc[i];
                    const q = [X(view.h(p)), Y(view.v(p))];
                    const quarter = mode === 'phase' && Math.abs(next * 4 - Math.round(next * 4)) < 1e-6;
                    dot(g, q[0], q[1], quarter ? 3.4 : 2.2, quarter ? INK : '#ffffff', INK);
                    if (quarter && ri2 === 0 && next < 0.99) text(g, next.toFixed(2), q[0] + 5, q[1] - 4, { size: 9, color: DIM });
                    next += every;
                }
            }));
            if (row.points.length > 1 && vi === 0) row.points.forEach((pt, pi) => {
                dot(g, box.x + 46 + pi * 46, box.y + 6, 4, pt.color);
                text(g, pt.name, box.x + 54 + pi * 46, box.y + 10, { size: 10 });
            });
        });
    });
    text(g, 'dashed grey: the ground under the root · thin: earlier cycles · dots: phase ticks (black each quarter)', M, H - 10, { size: 12, color: DIM });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0 };
}
