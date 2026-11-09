// The look sheet: the creature as the live view draws it (lab/lit.js: its
// sky light, sun and shadows on the checkered ground), close, through a
// cycle. Rows are phases of the run's last steady cycle (or times across an
// action's run), columns the cameras: three-quarter front, side and
// three-quarter back, each about two and a half body lengths out and a
// little above, framed on the body at rest. Where the turnaround and the
// film judge where the bones go, this is how it looks.

import { lastCycle, sampleRows, relativePose, rootOf } from "./cycle.js";
import { groundHeights } from "./run.js";
import { restExtent } from "./turnaround.js";
import { setPose, capture, orbitView, showGround } from "./lit.js";
import { beginSheet, saveSheet, text, rect, DIM } from "./page.js";
import { debugPlanes } from "./shots.js";
import { boneAt } from "./skeleton.js";

export const LOOK_VIEWS = [
    { name: 'front-left', yaw: 40, pitch: 12 },
    { name: 'left', yaw: 90, pitch: 6 },
    { name: 'back-left', yaw: 140, pitch: 14 },
    { name: 'front', yaw: 0, pitch: 8 },
    { name: 'right', yaw: -90, pitch: 6 },
    { name: 'back', yaw: 180, pitch: 12 },
];

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
}

// A distinct colour per piece (golden-angle hues, two lightnesses).
function pieceColour(i) {
    const h = (i * 137.508) % 360, l = i % 2 ? 0.42 : 0.6, s = 0.75;
    const f = (n) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
}

// `pieces`: the lit picture recoloured by the piece each pixel is on (the
// skin hook's piece view, lab/shots.js), shaded by the lit one, each piece
// named at its middle in view: where a ragged patch on the lit sheet shows,
// this says which piece is through which.
function pieceShot(creature, view, cw, ch) {
    const lit = capture(view, cw, ch);
    // A body of one piece (a lab/flesh.js body) is coloured by the bone
    // each vertex mostly follows instead: the piece view's ids, swapped for
    // the capture, so a fold shows whose skin it is.
    const byBone = creature.body.pieces.length < 2 && creature.pieceBuf;
    if (byBone) {
        if (!creature._boneIds) creature._boneIds = Float32Array.from(creature.body.weights, (w) => w[0].index);
        creature.pieceBuf.write(creature._boneIds);
    }
    let id;
    try { id = debugPlanes(view, cw, ch).piece; } finally { if (byBone) creature.pieceBuf.write(creature.body.piece); }
    const nameOf = (p) => (byBone ? creature.skel.bones[p].name : creature.body.pieces[p].name);
    const out = new ImageData(cw, ch);
    const sum = new Map();
    for (let i = 0; i < cw * ch; i++) {
        const o = 4 * i, p = id[i];
        const lum = (0.3 * lit.data[o] + 0.59 * lit.data[o + 1] + 0.11 * lit.data[o + 2]) / 255;
        if (p < 0) { const g = 150 + 80 * lum; out.data[o] = out.data[o + 1] = out.data[o + 2] = g; out.data[o + 3] = 255; continue; }
        const c = pieceColour(p), k = 0.45 + 0.9 * lum;
        for (let q = 0; q < 3; q++) out.data[o + q] = Math.min(255, 255 * c[q] * k);
        out.data[o + 3] = 255;
        const s = sum.get(p) || [0, 0, 0];
        s[0] += i % cw; s[1] += Math.floor(i / cw); s[2]++;
        sum.set(p, s);
    }
    const labels = [...sum].filter(([, s]) => s[2] > 60).map(([p, s]) => ({ name: nameOf(p), x: s[0] / s[2], y: s[1] / s[2] }));
    return { img: out, labels };
}

// `focus`: a bone's name; each shot is then aimed at its middle as it is in
// that row's pose (a close-up of a head or a foot follows it), not at the
// body at rest.
export function lookSheet(rec, { path, rows = 6, phases = null, views = null, cell = 360, dist = 2.6, pieces = false, focus = null } = {}) {
    const t0 = Date.now();
    const creature = rec.creature;
    const cyc = lastCycle(rec);
    if (phases) rows = phases.length;
    const samples = sampleRows(rec, rows, cyc, phases);
    const V = views ? LOOK_VIEWS.filter((v) => views.includes(v.name)) : LOOK_VIEWS.slice(0, 3);
    const ext = restExtent(creature.skel);
    const rest = [0, ext.top * 0.5, ext.mid];
    const d = ext.len * dist;
    const fb = focus ? creature.skel.bones[creature.skel.index(focus)] : null;
    if (focus && !fb) throw new Error(`look: no bone '${focus}' to focus on`);
    const LM = 112, TM = 86, cw = cell, ch = Math.round(cell * 0.75);
    const W = LM + V.length * (cw + 6) + 6, H = TM + rows * (ch + 6) + 10;
    // The lit captures first (the lit scene is its own canvas), then the sheet.
    const shots = samples.map((smp) => {
        const r = rootOf(rec, smp.step);
        const g0 = groundHeights(rec.env, new Float32Array([r.x, r.z]))[0];
        const P = relativePose(rec, smp.step, g0, new Float32Array(rec.poseStride));
        setPose(creature, P);
        showGround(true);
        const target = fb ? boneAt(P, 0, fb, 0.5) : rest;
        return V.map((v) => {
            const view = orbitView(target, v.yaw, v.pitch, d, 30);
            return pieces ? pieceShot(creature, view, cw, ch) : { img: capture(view, cw, ch), labels: [] };
        });
    });
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · look`, 12, 30, { size: 22, weight: 700 });
    text(g, `${rec.scenario.about || ''}${cyc ? ` — cycle ${cyc.period.toFixed(3)} s, rows by phase from LH touchdown` : ' — rows by time'}; ${pieces ? 'coloured by piece, shaded by' : ''} the live view's light, ${d.toFixed(2)} m out`, 12, 52, { size: 14, color: DIM });
    V.forEach((v, c) => text(g, v.name, LM + c * (cw + 6) + cw / 2, TM - 6, { size: 14, weight: 650, align: 'center' }));
    samples.forEach((smp, r) => {
        const y = TM + r * (ch + 6);
        text(g, smp.label, 10, y + 22, { size: 15, weight: 700 });
        text(g, `t ${smp.t.toFixed(2)} s`, 10, y + 42, { size: 13, color: DIM });
        shots[r].forEach((s, c) => {
            const x0 = LM + c * (cw + 6);
            g.drawImage(toCanvas(s.img), x0, y);
            for (const l of s.labels) text(g, l.name, x0 + l.x, y + l.y + 4, { size: 11, weight: 700, align: 'center', color: '#111' });
        });
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0 };
}
