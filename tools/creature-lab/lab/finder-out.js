// The hard-line finder's output: every scanned scenario's moments ranked by
// the line a viewer sees (each site at a frame scored from the camera that
// sees it worst), and for the worst, a close-up of the creature lit as the
// live view lights it, from that camera's side, 1.1 m from the site:
//   left    the close-up as a viewer sees it
//   middle  the same with the lines found marked (red the site, amber others)
//   right   the whole creature from the scan camera, the site ringed
// Then an index sheet of the worst close-ups, a chart per scenario of each
// site's score over the run, and finder.json: the ranking, each scenario's
// sites, and the body's shape (pieces crossing at rest, volume, bone pull).

import { runScenario } from "./run.js";
import { relativePose } from "./cycle.js";
import { skinPositions } from "./form.js";
import { setPose, capture, viewToward, showGround } from "./lit.js";
import { imageLines } from "./shots.js";
import { scanView, restShape } from "./finder.js";
import { beginSheet, saveSheet, text, rect, line, dot, INK, DIM, SERIES } from "./page.js";
import { axes, curve } from "./plot.js";

const r1 = (x) => Math.round(x * 10) / 10;
const CLOSE = 900, CTX_W = 960, CTX_H = 640;

// Every moment of the scans: a site at a frame, from the camera that sees it worst.
export function moments(scans) {
    const out = [];
    for (const sc of scans) for (const look of sc.looks) {
        const best = new Map();
        for (const [vname, v] of Object.entries(look.views)) for (const s of v.sites) {
            const b = best.get(s.key);
            if (!b || s.score > b.score) best.set(s.key, { ...s, view: vname });
        }
        const frame = sc.frames.find((f) => f.k === look.k);
        for (const s of best.values()) {
            const mesh = frame && frame.sites.find((m) => m.key === s.key);
            out.push({ scenario: sc.scenario, k: look.k, t: look.t, ...s, mesh: mesh ? { score: mesh.score, cm: r1(100 * mesh.length), meanAngle: mesh.meanAngle } : null });
        }
    }
    return out.sort((a, b) => b.score - a.score);
}

// The worst moments: each site at its worst, one moment a site (`perSite`
// more lets a site show in more than one scenario).
export function worstMoments(all, top = 10, perSite = 1) {
    const chosen = [], perKey = new Map();
    for (const m of all) {
        if (chosen.length >= top) break;
        if ((perKey.get(m.key) || 0) >= perSite) continue;
        if (chosen.some((c) => c.key === m.key && c.scenario === m.scenario)) continue;
        chosen.push(m);
        perKey.set(m.key, (perKey.get(m.key) || 0) + 1);
    }
    return chosen;
}

// Each scenario's sites: the worst and mean visible score over the frames looked at.
export function siteTable(scans) {
    const out = {};
    for (const sc of scans) {
        const by = new Map();
        for (const look of sc.looks) {
            const frameBest = new Map();
            for (const v of Object.values(look.views)) for (const s of v.sites) frameBest.set(s.key, Math.max(frameBest.get(s.key) || 0, s.score));
            for (const [k, v] of frameBest) {
                const e = by.get(k) || { max: 0, sum: 0, maxT: 0 };
                if (v > e.max) { e.max = v; e.maxT = look.t; }
                e.sum += v;
                by.set(k, e);
            }
        }
        const meshMax = new Map();
        for (const f of sc.frames) for (const s of f.sites) meshMax.set(s.key, Math.max(meshMax.get(s.key) || 0, s.score));
        out[sc.scenario] = [...by].map(([key, e]) => ({ key, visibleMax: r1(e.max), visibleMean: r1(e.sum / sc.looks.length), at: e.maxT, meshMax: meshMax.get(key) ?? null }))
            .sort((a, b) => b.visibleMax - a.visibleMax).slice(0, 12);
    }
    return out;
}

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
    return c;
}

// The close-up camera: 1.1 m from the site, on the scan camera's side,
// turned from that line by up to 30 degrees about the site (or raised or
// lowered) to whichever shows the most of the site's line: part of a site
// the scan saw past another part (the neck, a leg) may be hidden from
// closer in.
function bestCloseView(creature, X, key, centre, from) {
    const d = from.map((v, i) => v - centre[i]);
    const yaw0 = Math.atan2(d[0], d[2]), el0 = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    let best = null;
    for (const [dy, de] of [[0, 0], [-30, 0], [30, 0], [0, 25], [0, -12], [-30, 20], [30, 20]]) {
        const y = yaw0 + (dy * Math.PI) / 180, e = Math.max(-0.35, Math.min(1.2, el0 + (de * Math.PI) / 180));
        const pos = [centre[0] + Math.sin(y) * Math.cos(e), centre[1] + Math.sin(e), centre[2] + Math.cos(y) * Math.cos(e)];
        const v = viewToward(centre, pos, 1.1, 40);
        if (v.position[1] < 0.05) continue;
        const s = imageLines(creature, X, v, 320, 320).sites.get(key);
        const cm = s ? s.cm : 0;
        if (!best || cm > best.cm * 1.1) best = { v, cm };
    }
    return best.v;
}

// The close-up of one moment, written to `path`.
export function drawMoment(creature, m, rank, path, recCache) {
    const rec = recCache.get(m.scenario) || runScenario(creature, m.scenario);
    recCache.set(m.scenario, rec);
    const P = relativePose(rec, m.k, 0, new Float32Array(rec.poseStride));
    const X = skinPositions(creature, P);
    setPose(creature, P);
    showGround(true);
    const sv = scanView({ name: m.view, yaw: { left: 90, 'front-left': 35, 'back-left': 145, right: -90 }[m.view] ?? 90 });
    const centre = m.centre || sv.target;
    const close = bestCloseView(creature, X, m.key, centre, sv.position);
    const lit = capture(close, CLOSE, CLOSE);
    const lines = imageLines(creature, X, close, CLOSE, CLOSE);
    const marked = new ImageData(new Uint8ClampedArray(lit.data), CLOSE, CLOSE);
    const want = lines.keys.indexOf(m.key);
    let mine = 0;
    for (let i = 0; i < CLOSE * CLOSE; i++) {
        const s = lines.mark[i];
        if (s < 0) continue;
        const d = marked.data;
        if (s === want) { d[4 * i] = 255; d[4 * i + 1] = 30; d[4 * i + 2] = 30; mine++; } else { d[4 * i] = 255; d[4 * i + 1] = 190; d[4 * i + 2] = 0; }
    }
    const ctx = capture(sv, CTX_W, CTX_H);
    const here = lines.sites.get(m.key);
    const HT = 122, W = 2 * CLOSE + CTX_W + 40, H = HT + CLOSE + 10;
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    g.drawImage(toCanvas(lit), 10, HT);
    g.drawImage(toCanvas(marked), 20 + CLOSE, HT);
    g.drawImage(toCanvas(ctx), 30 + 2 * CLOSE, HT);
    const cx = 30 + 2 * CLOSE + m.x, cy = HT + m.y;
    dot(g, cx, cy, 34, null, '#ff2020');
    dot(g, cx, cy, 35, null, '#ff2020');
    text(g, `#${rank}  ${m.key}`, 12, 32, { size: 24, weight: 700 });
    text(g, `${creature.label} · ${m.scenario} · t ${m.t.toFixed(2)} s (step ${m.k}) · seen from the ${m.view} at 3 m · close-up 1.1 m from the site, the live view's light`, 12, 58, { size: 16, color: DIM });
    const meshTxt = m.mesh ? ` · on the mesh: ${m.mesh.cm} cm of ${m.kind === 'cross' ? 'crossing' : 'line'} at a mean ${m.mesh.meanAngle}°` : '';
    text(g, `visible: ${m.cm} cm of line, sharpest ${m.angleMax}°, score ${m.score} (cm x angle / 90)${meshTxt}` +
        `${here ? ` · in the close-up ${r1(here.cm)} cm, sharpest ${Math.round(here.angleMax)}°` : ''}`, 12, 84, { size: 16, color: INK });
    text(g, 'as seen, close up', 10, HT - 8, { size: 15, weight: 650 });
    text(g, `the lines found (red: this site, ${mine} px; amber: other sites)`, 20 + CLOSE, HT - 8, { size: 15, weight: 650 });
    text(g, `the ${m.view} scan camera, the site ringed`, 30 + 2 * CLOSE, HT - 8, { size: 15, weight: 650 });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, lit, closeCanvas: toCanvas(lit) };
}

// The index: the worst moments' close-ups in a grid, each captioned.
export function drawIndex(creature, worst, drawn, path) {
    const cols = 4, cw = 450, chh = 450 + 64, rows = Math.ceil(drawn.length / cols);
    const W = cols * cw + (cols + 1) * 10, H = 70 + rows * (chh + 10);
    const S = beginSheet(W, H);
    const g = S.g;
    text(g, `${creature.label} · the hard-line finder's worst moments`, 12, 30, { size: 22, weight: 700 });
    text(g, 'each a site (cross: two pieces meeting; crease: a piece kinking; kink: a notch in the outline) at the frame and camera where its visible line scores worst (cm x angle / 90)', 12, 54, { size: 14, color: DIM });
    drawn.forEach((d, i) => {
        const x = 10 + (i % cols) * (cw + 10), y = 70 + Math.floor(i / cols) * (chh + 10);
        g.drawImage(d.closeCanvas, x, y, cw, cw);
        const m = worst[i];
        text(g, `#${i + 1} ${m.key}`, x, y + cw + 20, { size: 14, weight: 650 });
        text(g, `${m.scenario} t ${m.t.toFixed(2)} s · ${m.view} · ${m.cm} cm, ${m.angleMax}° · score ${m.score}`, x, y + cw + 40, { size: 13, color: DIM });
    });
    return saveSheet(path);
}

// A scenario's chart: each of its worst sites' mesh score over the run, and
// the visible score at the frames looked at (dots).
export function drawScanChart(scan, path) {
    const W = 1500, H = 760;
    const S = beginSheet(W, H);
    const g = S.g;
    const meshMax = new Map();
    for (const f of scan.frames) for (const s of f.sites) meshMax.set(s.key, Math.max(meshMax.get(s.key) || 0, s.score));
    const visMax = new Map();
    for (const l of scan.looks) for (const v of Object.values(l.views)) for (const s of v.sites) visMax.set(s.key, Math.max(visMax.get(s.key) || 0, s.score));
    const keys = [...new Set([...[...visMax].sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]), ...[...meshMax].sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0])])];
    text(g, `${scan.creature} · ${scan.scenario} · hard lines over the run`, 12, 28, { size: 20, weight: 700 });
    text(g, 'top: each site on the mesh every frame scanned (line cm x angle / 90, front and back of the body); bottom: as seen, the worst of the scan cameras, at the frames looked at', 12, 50, { size: 13, color: DIM });
    const T = (scan.steps - 1) * scan.dt;
    const panel = (y, h, series, title) => {
        let hi = 1;
        for (const s of series) for (const v of s.ys) if (Number.isFinite(v)) hi = Math.max(hi, v);
        const ax = axes(g, { x: 12, y, w: W - 360, h }, { x: [0, T], y: [0, hi * 1.08], xlabel: 's', ylabel: title });
        series.forEach((s, i) => {
            if (s.dots) s.xs.forEach((x, j) => Number.isFinite(s.ys[j]) && dot(g, ax.X(x), ax.Y(s.ys[j]), 3.5, SERIES[i % SERIES.length]));
            else curve(g, ax, s.xs, s.ys, SERIES[i % SERIES.length], 1.6);
        });
    };
    const fx = scan.frames.map((f) => f.t);
    panel(64, 330, keys.map((k) => ({ xs: fx, ys: scan.frames.map((f) => (f.sites.find((s) => s.key === k) || { score: NaN }).score) })), 'mesh score');
    const lx = scan.looks.map((l) => l.t);
    panel(404, 330, keys.map((k) => ({ dots: true, xs: lx, ys: scan.looks.map((l) => Math.max(...Object.values(l.views).map((v) => (v.sites.find((s) => s.key === k) || { score: NaN }).score).filter(Number.isFinite), NaN)) })), 'visible score');
    keys.forEach((k, i) => {
        const y = 80 + i * 22;
        line(g, W - 336, y - 5, W - 312, y - 5, SERIES[i % SERIES.length], 3);
        text(g, k, W - 306, y, { size: 12 });
    });
    return saveSheet(path);
}

// Rank `scans`, draw the worst `top`, write finder.json in `dir`.
export function finderReport(creature, scans, dir, { top = 10 } = {}) {
    const all = moments(scans);
    const worst = worstMoments(all, top);
    const recs = new Map();
    const drawn = worst.map((m, i) => drawMoment(creature, m, i + 1, `${dir}/worst-${String(i + 1).padStart(2, '0')}.png`, recs));
    const index = drawIndex(creature, worst, drawn, `${dir}/worst.png`);
    const charts = scans.map((s) => drawScanChart(s, `${dir}/${s.scenario}-seams.png`).path);
    const rest = restShape(creature);
    const pull = {};
    for (const s of scans) for (const [label, p] of Object.entries(s.pull)) {
        const e = pull[label] || (pull[label] = { min: Infinity, max: -Infinity });
        if (p.min < e.min) { e.min = p.min; e.minAt = `${s.scenario} ${p.minT} s`; }
        if (p.max > e.max) { e.max = p.max; e.maxAt = `${s.scenario} ${p.maxT} s`; }
    }
    const pullWorst = Object.entries(pull).map(([k, e]) => ({ label: k, ...e, off: Math.max(e.max - 1, 1 - e.min) }))
        .sort((a, b) => b.off - a.off).slice(0, 10);
    const report = {
        creature: creature.label, scanned: scans.map((s) => s.scenario),
        worst: worst.map((m, i) => ({ rank: i + 1, ...m, image: drawn[i].path })),
        index: index.path || `${dir}/worst.png`, charts,
        sites: siteTable(scans),
        shape: {
            pieces: rest.pieces.length, restCrossings: rest.crossings, restFolds: rest.folds,
            volume: Object.fromEntries(scans.map((s) => [s.scenario, s.volume])), bonePull: pullWorst,
        },
    };
    writeFile(`${dir}/finder.json`, JSON.stringify(report, null, 2) + '\n');
    return report;
}
