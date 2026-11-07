// The film sheet: motion seen the way an eye judges it, for one run over a
// window of time.
//
//   filmstrip    consecutive frames side by side (side view, the creature's
//                frame), a fixed time apart.
//   paths        a side view of the window along the run's first heading:
//                the creature drawn faintly at a few moments where it really
//                was, and the tracked points' paths (head, withers, hips,
//                tail tip) over them, a tick every 0.1 s.
//   slit-scans   for each of head, withers and tail tip, a vertical slit
//                through that point in the creature's frame, one column per
//                frame: what of the skeleton crosses the slit, by height, so
//                a bob, a nod or a swish reads as a wave and a jerk as a
//                step in it.
// Obstacles in the ground record (a log to leap) are drawn in the paths.

import { beginSheet, saveSheet, panel, text, line, rect, dot, poly, INK, DIM, FAINT, SERIES } from "./page.js";
import { cellCamera, placement, placementM, drawCells, groundUnder } from "./cells.js";
import { rootOf } from "./cycle.js";
import { boneHead, boneTail } from "./skeleton.js";
import { series } from "./analyze.js";
import { restExtent } from "./turnaround.js";
import { obstaclesOf } from "./run.js";

const TRACK_COLORS = { head: '#c0392b', withers: '#2471a3', hips: '#17a589', 'tail tip': '#d68910' };

// A world point in the window's frame: along the first heading (z), up (y).
function windowFrame(rec, k0) {
    const r = rootOf(rec, k0);
    const c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
    return { r, at: (p) => { const x = p[0] - r.x, z = p[2] - r.z; return [c * x + s * z, p[1], -s * x + c * z]; } };
}

// A point in the creature's own frame at step k (as natural.js's arcs).
function creatureFrame(rec, k, p) {
    const r = rootOf(rec, k), c = Math.cos(-r.yaw), s = Math.sin(-r.yaw);
    const x = p[0] - r.x, z = p[2] - r.z;
    return [c * x + s * z, p[1], -s * x + c * z];
}

export function filmSheet(rec, { path, from = null, to = null, frames = 14, title = '' } = {}) {
    const t0 = Date.now();
    const skel = rec.creature.skel, dt = rec.dt, n = rec.steps;
    const T0 = from ?? Math.max(0, rec.scenario.duration * 0.5 - 0.75);
    const T1 = Math.min(to ?? T0 + 1.5, (n - 1) * dt);
    const k0 = Math.round(T0 / dt), k1 = Math.round(T1 / dt);
    const ext = restExtent(skel);
    const S0 = series(rec);

    // Layout.
    const W = 1800, M = 16;
    const cw = Math.floor((W - 2 * M) / frames), ch = Math.round(cw * 1.1);
    const kFilm = Math.min((cw - 8) / (ext.len * 1.3), (ch - 30) / (ext.top * 1.35));
    const pathH = 420, slitH = 170;
    const yFilm = 70, yPath = yFilm + ch + 40, ySlit = yPath + pathH + 40;
    const H = ySlit + 3 * (slitH + 46) + 20;
    const S = beginSheet(W, H, { scene: true });
    const cam = cellCamera(S.scene, W, H, kFilm, 0);
    const g = S.g;

    // --- filmstrip ---
    panel(S.under, M - 6, yFilm - 22, W - 2 * M + 12, ch + 30, `filmstrip: ${frames} frames ${(((k1 - k0) / (frames - 1)) * dt * 1000).toFixed(0)} ms apart (side view, the creature's frame)`);
    const film = [];
    for (let i = 0; i < frames; i++) {
        const k = Math.round(k0 + ((k1 - k0) * i) / (frames - 1));
        const bx = M + i * cw + cw / 2, by = yFilm + ch - 18;
        film.push({ rec, step: k, ground: groundUnder(rec, k), place: placement(cam.unproject(bx, by), 0, [0, 0, ext.mid]) });
        line(g, M + i * cw + 4, by, M + (i + 1) * cw - 4, by, FAINT, 1);
        text(g, `${(k * dt).toFixed(2)} s`, bx, yFilm + ch - 2, { align: 'center', size: 11, color: DIM });
    }
    S.add(drawCells(S.scene, rec.creature, film).node);

    // --- paths over a side view ---
    const WF = windowFrame(rec, k0);
    let zlo = Infinity, zhi = -Infinity, yhi = 0;
    for (let k = k0; k <= k1; k++) for (const p of S0.tracks[k]) { const q = WF.at(p); zlo = Math.min(zlo, q[2]); zhi = Math.max(zhi, q[2]); yhi = Math.max(yhi, q[1]); }
    zlo -= ext.len * 0.6; zhi += ext.len * 0.6;
    const kp = Math.min((W - 2 * M - 20) / (zhi - zlo), (pathH - 40) / (yhi * 1.15 + 0.2));
    const f = kp / kFilm;
    const px0 = M + 10 - zlo * kp, py0 = yPath + pathH - 24;
    const sp = (q) => [px0 + q[2] * kp, py0 - q[1] * kp];
    panel(S.under, M - 6, yPath - 22, W - 2 * M + 12, pathH + 8, `paths: ${T0.toFixed(2)}–${T1.toFixed(2)} s along the first heading, ticks every 0.1 s (head, withers, hips, tail tip)`);
    const ghosts = [];
    const nGhost = 5;
    for (let i = 0; i < nGhost; i++) {
        const k = Math.round(k0 + ((k1 - k0) * i) / (nGhost - 1));
        const r = rootOf(rec, k), ground = groundUnder(rec, k);
        const q = WF.at([r.x, ground, r.z]);
        const yaw = r.yaw - WF.r.yaw, c = Math.cos(yaw) * f, s = Math.sin(yaw) * f;
        const M3 = [c, 0, s, 0, f, 0, -s, 0, c];
        const A = cam.unproject(...sp(q));
        ghosts.push({ rec, step: k, ground, place: placementM(A, M3), tint: [0.85, 0.85, 0.85, 1] });
    }
    S.add(drawCells(S.scene, rec.creature, ghosts).node);
    // The ground along the window, and any obstacles.
    const gpts = [];
    for (let k = k0; k <= k1; k += 2) { const r = rootOf(rec, k); gpts.push(sp(WF.at([r.x, groundUnder(rec, k), r.z]))); }
    poly(g, gpts, DIM, 1.5);
    // A log is seen end on, as it lies across the path: a circle.
    for (const ob of obstaclesOf(rec.env)) {
        const c = sp(WF.at([ob.x, ob.y0 + ob.h / 2, ob.z]));
        dot(g, c[0], c[1], (ob.h / 2) * kp, 'rgba(122,90,60,0.45)', '#5a4030');
    }
    skel.tracks.forEach((t, i) => {
        const col = TRACK_COLORS[t.name] || SERIES[i % SERIES.length];
        const pts = [];
        for (let k = k0; k <= k1; k++) pts.push(sp(WF.at(S0.tracks[k][i])));
        poly(g, pts, col, 2);
        const every = Math.max(1, Math.round(0.1 / dt));
        for (let k = k0; k <= k1; k += every) { const s = sp(WF.at(S0.tracks[k][i])); dot(g, s[0], s[1], 2.6, col); }
        text(g, t.name, M + 20 + i * 110, yPath + 6, { size: 12, color: col, weight: 650 });
    });
    const bx = W - M - 20 - kp;
    line(g, bx, yPath + 2, bx + kp, yPath + 2, INK, 3);
    text(g, '1 m', bx + kp / 2, yPath - 4, { align: 'center', size: 11 });

    // --- slit-scans ---
    const nk = k1 - k0 + 1, colW = (W - 2 * M - 60) / nk;
    const yMax = ext.top * 1.3;
    skel.tracks.filter((t) => t.name !== 'hips').forEach((t, si) => {
        const ti = skel.tracks.indexOf(t);
        const y0 = ySlit + si * (slitH + 46);
        panel(S.under, M - 6, y0 - 22, W - 2 * M + 12, slitH + 10, `slit-scan through the ${t.name}: one column a frame (${(dt * 1000).toFixed(1)} ms), height 0–${yMax.toFixed(2)} m; bones crossing the slit, by height`);
        const sx = (k) => M + 50 + (k - k0) * colW, sy = (y) => y0 + slitH - 6 - (y / yMax) * (slitH - 12);
        for (const h of [0.5, 1.0, 1.5]) if (h < yMax) { line(g, M + 50, sy(h), W - M - 10, sy(h), FAINT, 1, [4, 4]); text(g, `${h} m`, M + 44, sy(h) + 4, { align: 'right', size: 10, color: DIM }); }
        const band = 0.03;
        for (let k = k0; k <= k1; k++) {
            const o = k * rec.poseStride;
            const zc = creatureFrame(rec, k, S0.tracks[k][ti])[2];
            const ground = groundUnder(rec, k);
            for (const b of skel.bones) {
                const a = creatureFrame(rec, k, boneHead(rec.pose, o, b.index)), c = creatureFrame(rec, k, boneTail(rec.pose, o, b));
                const za = a[2], zb = c[2];
                const lo = Math.max(Math.min(za, zb), zc - band), hi = Math.min(Math.max(za, zb), zc + band);
                if (lo > hi) continue;
                const dz = zb - za;
                const yAt = (z) => (Math.abs(dz) < 1e-6 ? a[1] : a[1] + ((z - za) / dz) * (c[1] - a[1])) - ground;
                const ya = Math.abs(dz) < 1e-6 ? Math.min(a[1], c[1]) - ground : yAt(lo), yb = Math.abs(dz) < 1e-6 ? Math.max(a[1], c[1]) - ground : yAt(hi);
                const shade = b.name.startsWith(t.name.split(' ')[0]) ? (TRACK_COLORS[t.name] || INK) : '#555048';
                rect(g, sx(k), Math.min(sy(ya), sy(yb)) - 1.5, Math.max(colW, 1), Math.abs(sy(ya) - sy(yb)) + 3, shade);
            }
            // The tracked point itself.
            const p = S0.tracks[k][ti];
            rect(g, sx(k), sy(p[1] - ground) - 1, Math.max(colW, 1), 2, TRACK_COLORS[t.name] || INK);
        }
        for (let tt = Math.ceil(T0 * 10) / 10; tt <= T1 + 1e-6; tt += 0.1) {
            const x = sx(Math.round(tt / dt));
            line(g, x, y0 + slitH - 4, x, y0 + slitH + 2, DIM, 1);
            if (Math.abs(tt * 2 - Math.round(tt * 2)) < 1e-6) text(g, `${tt.toFixed(1)} s`, x, y0 + slitH + 14, { align: 'center', size: 10, color: DIM });
        }
    });

    text(g, title || `${rec.creature.label} · ${rec.scenario.name} · film`, M, 26, { size: 18, weight: 700 });
    text(g, `${rec.scenario.about || ''} — ${T0.toFixed(2)} to ${T1.toFixed(2)} s`, M, 46, { size: 13, color: DIM });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0, from: T0, to: T1 };
}
