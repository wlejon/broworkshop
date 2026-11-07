// The natural command's output: per scenario, lab/natural.js's measures as
// <scenario>-natural.json and one sheet of charts (<scenario>-natural.png),
// each measure in its panel with its threshold drawn, and its flags; then a
// summary across the scenarios (natural.json). Steady gaits are run for 20 s,
// so their cycles can be held against each other.

import { runScenario, scenarioOf } from "./run.js";
import { naturalness, NATURAL } from "./natural.js";
import { beginSheet, saveSheet, panel, text, line, rect, dot, poly, INK, DIM, FAINT, SERIES } from "./page.js";
import { axes, curve, rangeOf } from "./plot.js";

const PW = 790, PH = 540, GAP = 10;

function wrapText(g, s, x, y, w, opts = {}) {
    const size = opts.size || 13;
    g.font = `${opts.weight || 500} ${size}px system-ui`;
    const words = s.split(' ');
    let lineS = '', yy = y;
    for (const wd of words) {
        const t = lineS ? lineS + ' ' + wd : wd;
        if (g.measureText(t).width > w && lineS) { text(g, lineS, x, yy, opts); lineS = wd; yy += size + 4; } else lineS = t;
    }
    if (lineS) { text(g, lineS, x, yy, opts); yy += size + 4; }
    return yy;
}

function note(g, b, s) { wrapText(g, s, b.x + 8, b.y + 24, b.w - 16, { size: 14, color: DIM }); }

function overlapPanel(g, b, N) {
    const O = N.overlap;
    if (!O.steady) return note(g, b, 'no steady cycle in this run: overlap is measured over the cycles of a steady gait');
    const pairs = O.pairs;
    const ax = axes(g, { x: b.x, y: b.y, w: b.w, h: b.h - 20 }, { x: [-0.5, 0.5], y: [0, pairs.length], xlabel: 'lag, cycles (child after parent +)', ylabel: '', yn: 1,
        xfmt: (v) => v.toFixed(2), yfmt: () => '' });
    rect(g, ax.X(-NATURAL.lock), ax.T, ax.X(NATURAL.lock) - ax.X(-NATURAL.lock), ax.B - ax.T, '#f6dcdc', null);
    pairs.forEach((p, i) => {
        const y = ax.Y(pairs.length - i - 0.5);
        const c = p.limb ? '#a9a59c' : p.locked ? '#c0392b' : '#2471a3';
        line(g, ax.X(0), y, ax.X(p.lagCycles), y, c, 7);
        text(g, `${p.bone} < ${p.parent} (${p.which}, r ${p.corr})`, ax.L + 4, y + 4, { size: 10, color: INK });
    });
    text(g, 'red band: locked (|lag| < 0.02 cycle); blue: free chains, grey: legs', ax.L, b.y + b.h - 2, { size: 11, color: DIM });
}

function overlapCurves(g, b, N) {
    const O = N.overlap;
    const free = O.steady ? O.pairs.filter((p) => !p.limb).sort((x, y) => y.parentAmp - x.parentAmp).slice(0, 5) : [];
    if (!free.length) return note(g, b, 'no free chain swings in a steady cycle here');
    const xs = free[0].curves.parent.map((_, i, a) => i / a.length);
    const rows = free.length, h = (b.h - 10) / rows;
    free.forEach((p, i) => {
        const ys = [p.curves.parent, p.curves.child];
        const ax = axes(g, { x: b.x, y: b.y + i * h, w: b.w, h }, { x: [0, 1], y: rangeOf(ys), yn: 2, xn: 4, xfmt: (v) => v.toFixed(2), yfmt: (v) => v.toFixed(0), ylabel: `${p.bone} vs ${p.parent}, ${p.which} deg` });
        curve(g, ax, xs, p.curves.parent, '#77736a', 1.6, [4, 3]);
        curve(g, ax, xs, p.curves.child, p.locked ? '#c0392b' : '#2471a3', 2);
        text(g, `lag ${p.lagDeg}° (${p.lagMs} ms)`, ax.R - 4, ax.T + 12, { size: 11, align: 'right', color: DIM });
    });
}

function secondaryPanel(g, b, N) {
    const S = N.secondary;
    if (!S.changes.length) return note(g, b, `no change of speed or heading in this run. ${Math.round(100 * S.rigidSkin)}% of the skin is weighted to one bone alone.`);
    const ev = 0;
    const tr = S.bones.map((x) => ({ bone: x.bone, e: x.events[ev] })).filter((x) => x.e);
    const dt = 3 / 120;
    const all = tr.map((x) => x.e.trace.map((v) => v - x.e.trace[0]));
    const xs = all[0].map((_, i) => i * dt - 0.1);
    const ax = axes(g, { x: b.x, y: b.y, w: b.w, h: b.h - 40 }, { x: [xs[0], xs[xs.length - 1]], y: rangeOf(all), xlabel: `s after ${S.changes[ev].what} at ${S.changes[ev].t} s`, ylabel: 'angle to its parent, change, deg' });
    tr.forEach((x, i) => {
        const col = x.e.kind === 'momentum' ? '#17a589' : x.e.kind === 'rigid' ? '#a9a59c' : SERIES[i % SERIES.length];
        curve(g, ax, xs, all[i], col, x.e.kind === 'momentum' ? 2.2 : 1.4);
    });
    let y = b.y + b.h - 24;
    const tags = tr.map((x) => `${x.bone} ${x.e.kind}`).join(' · ');
    wrapText(g, `${tags}. Skin on one bone: ${Math.round(100 * S.rigidSkin)}%`, b.x + 8, y, b.w - 16, { size: 11, color: DIM });
}

function massPanel(g, b, N) {
    const M = N.mass.series;
    const dt = 2 / 120;
    const xs = M.height.map((_, i) => i * dt);
    const h1 = b.h * 0.42;
    const ax1 = axes(g, { x: b.x, y: b.y, w: b.w, h: h1 }, { x: [0, xs[xs.length - 1]], y: rangeOf([M.height]), ylabel: 'centre of mass height, m', yfmt: (v) => v.toFixed(2) });
    const ay = M.ay.map((v) => (v == null ? NaN : v));
    const ax2 = axes(g, { x: b.x, y: b.y + h1, w: b.w, h: b.h - h1 - 20 }, { x: [0, xs[xs.length - 1]], y: rangeOf([ay, [-12, 5]]), ylabel: 'vertical acceleration, m/s2', xlabel: 's' });
    for (const ax of [ax1, ax2]) M.flight.forEach((f, i) => { if (f) rect(g, ax.X(xs[i]), ax.T, Math.max(1, ax.X(dt) - ax.X(0)), ax.B - ax.T, '#dfe9f3', null); });
    curve(g, ax1, xs, M.height, INK, 1.6);
    curve(g, ax2, xs, ay, INK, 1.2);
    line(g, ax2.L, ax2.Y(-9.81), ax2.R, ax2.Y(-9.81), '#2471a3', 1.2, [5, 4]);
    for (const v of N.mass.violations) dot(g, ax2.X(v.t), ax2.Y(Math.max(ax2.Y ? -12 : 0, Math.min(5, ay[Math.round(v.t / dt)] ?? 0))), 2.5, v.kind === 'flight' ? '#c0392b' : '#d68910');
    text(g, 'blue: flight; dashed: -g; red: flight off free fall; amber: past what feet can do', ax2.L, b.y + b.h - 2, { size: 11, color: DIM });
}

function smoothPanel(g, b, N) {
    const J = N.smoothness.joints.slice(0, 12);
    const hi = Math.max(1, ...J.map((j) => j.perSecond));
    const ax = axes(g, { x: b.x, y: b.y, w: b.w, h: b.h - 20 }, { x: [0, hi * 1.15], y: [0, J.length], yn: 1, xlabel: 'abrupt velocity changes a second', yfmt: () => '' });
    J.forEach((j, i) => {
        const y = ax.Y(J.length - i - 0.5);
        line(g, ax.X(0), y, ax.X(j.perSecond), y, j.perSecond > 1 ? '#c0392b' : '#2471a3', 8);
        text(g, `${j.bone} ${j.axis}: jerk ${j.jerkRms} deg/s3, range ${j.range}°`, ax.L + 4, y + 4, { size: 10 });
    });
    line(g, ax.X(1), ax.T, ax.X(1), ax.B, '#c0392b', 1, [4, 3]);
    text(g, `${N.smoothness.spikesPerSecond} a second over all joints; a kink: acceleration > ${NATURAL.spike} deg/s2 off the line through its neighbours 2 steps away (dashed: 1 a second)`, ax.L, b.y + b.h - 2, { size: 11, color: DIM });
}

function varietyPanel(g, b, N) {
    const V = N.variety;
    if (!V.joints.length) return note(g, b, `${V.cycles} steady cycle(s): variety needs three or more`);
    const J = [...V.joints].sort((x, y) => y.range - x.range).slice(0, 4);
    const h = (b.h - 24) / J.length;
    J.forEach((j, i) => {
        const xs = j.curves[0].map((_, q, a) => q / a.length);
        const ax = axes(g, { x: b.x, y: b.y + i * h, w: b.w, h }, { x: [0, 1], y: rangeOf(j.curves), yn: 2, xn: 4, xfmt: (v) => v.toFixed(2), yfmt: (v) => v.toFixed(0), ylabel: `${j.bone} x, deg` });
        j.curves.forEach((c, q) => curve(g, ax, xs, c, SERIES[q % SERIES.length], 1));
        text(g, `${j.verdict}: variety ${(100 * j.variety).toFixed(1)}%, jitter ${(100 * j.jitter).toFixed(1)}% of range`, ax.R - 4, ax.T + 12, { size: 11, align: 'right', color: j.verdict === 'varies' ? DIM : '#c0392b' });
    });
    const rep = V.joints.filter((j) => j.verdict === 'repeats').length;
    text(g, `${V.cycles} cycles, period CV ${(100 * V.periodCv).toFixed(1)}%; ${rep} of ${V.joints.length} joints repeat (variety < ${100 * NATURAL.variety[0]}%)`, b.x + 8, b.y + b.h - 2, { size: 11, color: DIM });
}

function headPanel(g, b, N) {
    const H = N.head;
    if (!H) return note(g, b, "no 'head' and 'withers' tracks on this skeleton");
    const xs = H.series.head.map((_, i) => (i * 2) / 120);
    const ax = axes(g, { x: b.x, y: b.y, w: b.w, h: b.h - 40 }, { x: [0, xs[xs.length - 1] || 1], y: rangeOf([H.series.head, H.series.trunk]), xlabel: 's', ylabel: 'pitch in space (0.5 s high-pass), deg' });
    curve(g, ax, xs, H.series.trunk, '#77736a', 1.4, [4, 3]);
    curve(g, ax, xs, H.series.head, H.rides ? '#c0392b' : '#2471a3', 2);
    wrapText(g, `${H.head} pitch range ${H.headPitchRange}° against ${H.trunk}'s ${H.trunkPitchRange}° (x${H.pitchRatio}, r ${H.corrPitch}); yaw ${H.headYawRange}° vs ${H.trunkYawRange}° (r ${H.corrYaw}). Dashed: trunk. Above x${NATURAL.headRatio} with r > 0.5 the head rides the trunk.`,
        b.x + 8, b.y + b.h - 26, b.w - 16, { size: 11, color: DIM });
}

function arcsPanel(g, b, N) {
    const A = N.arcs;
    const all = A.flatMap((a) => a.path.flat());
    if (!all.length) return note(g, b, 'no paths');
    const zs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((b.w - 30) / (z1 - z0 || 1), (b.h - 50) / (y1 - y0 || 1));
    const X = (z) => b.x + 15 + (z - z0) * k, Y = (y) => b.y + b.h - 30 - (y - y0) * k;
    rect(g, b.x, b.y, b.w, b.h - 20, '#fbfaf8', null);
    A.forEach((a, i) => {
        for (const s of a.path) poly(g, s.map((p) => [X(p[0]), Y(p[1])]), SERIES[i % SERIES.length], 1.6);
        for (const c of a.corners) dot(g, X(c.at[2]), Y(c.at[1]), 6, null, '#c0392b');
    });
    const lab = A.map((a) => `${a.point}: ${a.corners.length} corner(s), ${Math.round(100 * a.straightShare)}% straight`).join(' · ');
    wrapText(g, `side view, creature frame, last cycle; feet in swing. ${lab}`, b.x + 8, b.y + b.h - 6, b.w - 16, { size: 10, color: DIM });
}

function flagsPanel(g, b, N) {
    let y = b.y + 18;
    if (!N.flags.length) { text(g, 'no flags', b.x + 8, y, { size: 14 }); return; }
    for (const f of N.flags) { y = wrapText(g, `- ${f}`, b.x + 8, y, b.w - 16, { size: 13 }); if (y > b.y + b.h - 10) break; }
}

export function naturalSheet(creature, N, path) {
    const W = 3 * PW + 4 * GAP, H = 70 + 3 * (PH + GAP);
    const S = beginSheet(W, H);
    const g = S.g;
    text(g, `${creature.label} · ${N.scenario} · natural motion, without a reference`, 12, 30, { size: 22, weight: 700 });
    text(g, `${N.steadyCycles} steady cycle(s) · ${N.flags.length} flag(s)`, 12, 54, { size: 14, color: DIM });
    const cells = [
        ['overlap: each child after its parent', overlapPanel], ['overlap: free chains through a cycle (dashed: parent)', overlapCurves],
        ['secondary motion: after the first change of speed or heading', secondaryPanel], ['the mass against what the feet can do', massPanel],
        ['smoothness: abrupt changes of joint velocity', smoothPanel], ['variety: each cycle of the widest joints', varietyPanel],
        ['head: held in space against the trunk', headPanel], ['arcs: paths and their corners (red rings)', arcsPanel], ['flags', flagsPanel],
    ];
    cells.forEach(([title, fn], i) => {
        const x = GAP + (i % 3) * (PW + GAP), y = 70 + Math.floor(i / 3) * (PH + GAP);
        const inner = panel(g, x, y, PW, PH, title);
        fn(g, inner, N);
    });
    return saveSheet(path);
}

// Run and measure each scenario; write the JSON, the sheets and the summary.
export function naturalReport(creature, scenarios, dir, { seed = 1 } = {}) {
    const steady = new Set(Object.values(creature.def.cycles || {}).map((c) => c.scenario));
    const written = [], lines = [], summary = {};
    for (const name of scenarios) {
        const sc = scenarioOf(creature, name);
        const rec = runScenario(creature, steady.has(name) ? { ...sc, duration: Math.max(sc.duration, 20) } : sc, { seed });
        const N = naturalness(rec);
        const jp = `${dir}/${name}-natural.json`;
        writeFile(jp, JSON.stringify(N) + '\n');
        const s = naturalSheet(creature, N, `${dir}/${name}-natural.png`);
        written.push(jp, s.path);
        const free = N.overlap.pairs.filter((p) => !p.limb);
        summary[name] = {
            flags: N.flags,
            overlap: N.overlap.steady ? { freePairs: free.length, locked: free.filter((p) => p.locked).length, meanAbsLagCycles: free.length ? +(free.reduce((a, p) => a + Math.abs(p.lagCycles), 0) / free.length).toFixed(3) : null } : null,
            secondary: { changes: N.secondary.changes.length, kinds: N.secondary.bones.map((b) => `${b.bone}:${b.events.map((e) => e.kind).join('/') || '-'}`), rigidSkin: N.secondary.rigidSkin },
            mass: { flightOff: N.mass.flightOff, pullShare: N.mass.pullShare, frictionShare: N.mass.frictionShare, energyFromNowhere: N.mass.energyFromNowhere, flights: N.mass.flights.length },
            smoothness: { spikesPerSecond: N.smoothness.spikesPerSecond, worst: N.smoothness.joints.slice(0, 3).map((j) => `${j.bone} ${j.perSecond}/s`) },
            variety: N.variety.joints.length ? { cycles: N.variety.cycles, periodCv: N.variety.periodCv, repeats: N.variety.joints.filter((j) => j.verdict === 'repeats').length, joints: N.variety.joints.length } : null,
            head: N.head ? { pitchRatio: N.head.pitchRatio, corrPitch: N.head.corrPitch, rides: N.head.rides } : null,
            arcs: Object.fromEntries(N.arcs.map((a) => [a.point, { corners: a.corners.length, straight: a.straightShare }])),
        };
        lines.push(`${name}: ${N.flags.length ? N.flags.length + ' flag(s)' : 'clean'} -> ${s.path}`);
        for (const f of N.flags) lines.push(`  - ${f}`);
    }
    writeFile(`${dir}/natural.json`, JSON.stringify({ creature: creature.label, thresholds: NATURAL, scenarios: summary }, null, 2) + '\n');
    written.push(`${dir}/natural.json`);
    return { written, lines, summary };
}
