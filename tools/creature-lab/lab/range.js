// The range sheet: every joint at its lower limit, at rest and at its upper
// limit (the rest of the body at rest), drawn zoomed on the joint's part of
// the body with the moving bone traced in red, beside a dial of its range:
// the band of the limits, rest at 0, the span the run used (thick), and red
// where the run went past a limit. Flexion (x) for every joint from the side;
// the turn (y) from above for joints that turn far. A pair of legs is shown
// by its left one, with both sides' use in the dial.

import { beginSheet, saveSheet, text, line, dot, rect, INK, DIM, FAINT } from "./page.js";
import { cellCamera, placementM, drawCells } from "./cells.js";
import { ROWS } from "./skeleton.js";
import { restExtent } from "./turnaround.js";

const DEG = 180 / Math.PI;

function matMul(A, B) {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[3 * r + c] = A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
    return C;
}
const mv = (M, v) => [0, 1, 2].map((r) => M[3 * r] * v[0] + M[3 * r + 1] * v[1] + M[3 * r + 2] * v[2]);
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];

// The rest pose with joint j turned by angle a about axis (0 x, 1 y), its
// children carried with it: { pose (ROWS per bone), pts: bone -> [head, tail] }.
export function poseWithJoint(skel, j, axis, a) {
    const R = [], P = [];
    const pose = new Float32Array(skel.count * ROWS);
    for (const b of skel.bones) {
        const local = b.index === j ? (axis === 0 ? rotX(a) : rotY(a)) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
        if (b.parentIndex < 0) { R[b.index] = local; P[b.index] = b.head.slice(); }
        else {
            const pr = R[b.parentIndex], pb = skel.bones[b.parentIndex];
            R[b.index] = matMul(pr, local);
            const d = mv(pr, [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]]);
            P[b.index] = [P[b.parentIndex][0] + d[0], P[b.parentIndex][1] + d[1], P[b.parentIndex][2] + d[2]];
        }
        const M = R[b.index], p = P[b.index];
        pose.set([M[0], M[1], M[2], p[0], M[3], M[4], M[5], p[1], M[6], M[7], M[8], p[2]], b.index * ROWS);
    }
    const tail = (b) => { const d = mv(R[b.index], [b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]]); return [P[b.index][0] + d[0], P[b.index][1] + d[1], P[b.index][2] + d[2]]; };
    return { pose, head: (i) => P[i], tail: (i) => tail(skel.bones[i]) };
}

// The bones turned by joint j (it and its descendants).
function subtree(skel, j) {
    const out = [j];
    for (const b of skel.bones) if (out.includes(b.parentIndex)) out.push(b.index);
    return out;
}

// Which joints, about which axis: flexion of every joint but the root and the
// right side's twins; the turn of those that turn by 20 degrees or more.
export function rangeJoints(skel) {
    const out = [];
    const left = (b) => !/R$/.test(b.name);
    for (const b of skel.bones) if (b.parentIndex >= 0 && left(b)) out.push({ bone: b, axis: 0 });
    for (const b of skel.bones) if (b.parentIndex >= 0 && left(b) && (b.lim[1][1] - b.lim[1][0]) * DEG >= 40) out.push({ bone: b, axis: 1 });
    return out;
}

function dial(g, cx, cy, r, lo, hi, used, hits, axis) {
    // Angles drawn as they turn the bone seen from the side (flexion swings the
    // tail back: clockwise on the page) from straight down.
    const ang = (d) => Math.PI / 2 + (axis === 0 ? 1 : -1) * d / DEG;
    const arc = (a0, a1, rr, color, w) => {
        g.beginPath(); g.strokeStyle = color; g.lineWidth = w;
        g.arc(cx, cy, rr, Math.min(ang(a0), ang(a1)), Math.max(ang(a0), ang(a1)));
        g.stroke();
    };
    g.beginPath(); g.fillStyle = '#e6efe0'; g.moveTo(cx, cy);
    g.arc(cx, cy, r, Math.min(ang(lo), ang(hi)), Math.max(ang(lo), ang(hi))); g.closePath(); g.fill();
    for (const d of [lo, hi]) line(g, cx, cy, cx + r * Math.cos(ang(d)), cy + r * Math.sin(ang(d)), '#8fae7f', 1.2);
    line(g, cx, cy, cx + (r + 6) * Math.cos(ang(0)), cy + (r + 6) * Math.sin(ang(0)), INK, 1.2, [3, 2]);
    for (const u of used) {
        if (!u) continue;
        arc(Math.max(u.min, lo), Math.min(u.max, hi), r * u.ring, u.color, 5);
        if (u.min < lo - 0.5) arc(u.min, lo, r * u.ring, '#e00000', 5);
        if (u.max > hi + 0.5) arc(hi, u.max, r * u.ring, '#e00000', 5);
    }
    dot(g, cx, cy, 2.5, INK);
    if (hits) { dot(g, cx + r + 2, cy - r + 6, 7, '#e00000'); text(g, '!', cx + r + 2, cy - r + 10, { size: 11, weight: 800, color: '#fff', align: 'center' }); }
}

export function rangeSheet(rec, report, { path, title = '' } = {}) {
    const t0 = Date.now();
    const skel = rec.creature.skel;
    const list = rangeJoints(skel);
    const cols = 3, cw = 170, chh = 150, dw = 240, bw = 3 * cw + dw, bh = chh + 34;
    const M = 10, W = M * 2 + cols * bw + (cols - 1) * 12, rowsN = Math.ceil(list.length / cols);
    const H = 78 + rowsN * bh + 30;
    const S = beginSheet(W, H, { scene: true });
    const g = S.g;
    const ext = restExtent(skel);
    const k = Math.min((cw - 16) / (ext.len * 1.2), (chh - 20) / (ext.top * 1.1));
    const cam = cellCamera(S.scene, W, H, k, 0);
    const cells = [];
    const SIDE = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const TOP = [0, -1, 0, 1, 0, 0, 0, 0, 1];   // its up toward the camera, its left up the page
    // The zoomed copies spill past their cells: the overlay is paper except
    // over the cells, so each shows only through its own window.
    g.fillStyle = '#ecebe6';
    g.fillRect(0, 0, W, H);
    list.forEach((_, n) => {
        const bx = M + (n % cols) * (bw + 12), by = 70 + Math.floor(n / cols) * bh;
        for (let c = 0; c < 3; c++) g.clearRect(bx + c * cw + 2, by + 24, cw - 4, chh);
    });

    list.forEach((jt, n) => {
        const b = jt.bone, bx = M + (n % cols) * (bw + 12), by = 70 + Math.floor(n / cols) * bh;
        const lo = b.lim[jt.axis][0], hi = b.lim[jt.axis][1];
        const poses = [lo, 0, hi].map((a) => poseWithJoint(skel, b.index, jt.axis, a));
        // The part to frame: the joint's parent bone and everything it turns, in all three poses.
        const view = jt.axis === 0 ? SIDE : TOP;
        const sub = subtree(skel, b.index);
        const pts = [];
        for (const P of poses) {
            for (const i of sub) pts.push(P.head(i), P.tail(i));
            if (b.parentIndex >= 0) pts.push(P.head(b.parentIndex));
        }
        const pv = pts.map((p) => mv(view, p));
        let z0 = Infinity, z1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of pv) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
        const zoom = Math.max(1, Math.min(5, Math.min((cw - 20) / ((z1 - z0) * k + 1e-6), (chh - 24) / ((v1 - v0) * k + 1e-6))));
        // Pivot: the framed part's centre in the creature's frame (the view
        // turn undone by its transpose; depth along the camera is free).
        const cz = (z0 + z1) / 2, cv = (v0 + v1) / 2;
        const Vt = [view[0], view[3], view[6], view[1], view[4], view[7], view[2], view[5], view[8]];
        const pivot = mv(Vt, [0, cv, cz]);
        const Ms = view.map((x) => x * zoom);
        poses.forEach((P, c) => {
            const x0 = bx + c * cw, y0 = by + 24;
            rect(g, x0 + 2, y0, cw - 4, chh, null, FAINT);
            const A = cam.unproject(x0 + cw / 2, y0 + chh / 2);
            const place = placementM(A, Ms, pivot);
            cells.push({ pose: P.pose, place });
            // The moving bone, traced.
            const h = cam.project(place.apply(P.head(b.index))), t = cam.project(place.apply(P.tail(b.index)));
            line(g, h[0], h[1], t[0], t[1], '#e00000', 2.2);
            dot(g, h[0], h[1], 3.5, '#ffffff', '#e00000');
            text(g, ['min', 'rest', 'max'][c] + ` ${(([lo, 0, hi][c]) * DEG).toFixed(0)}°`, x0 + 8, y0 + 14, { size: 11, color: DIM });
        });
        // The dial and the numbers.
        const axn = ['x', 'y', 'z'][jt.axis];
        const twin = skel.bones.find((o) => o.name === b.name.replace(/L$/, 'R') && o !== b);
        const stat = (bone) => bone && report.joints[bone.name] && report.joints[bone.name][axn];
        const sL = stat(b), sR = stat(twin);
        const used = [sL && { min: sL.min, max: sL.max, ring: 0.78, color: '#a32d22' }, sR && { min: sR.min, max: sR.max, ring: 0.58, color: '#1f5f99' }];
        const hits = (sL && sL.over) || (sR && sR.over);
        const dx = bx + 3 * cw + 10;
        dial(g, dx + 62, by + 24 + chh / 2 - 6, 52, lo * DEG, hi * DEG, used, hits, jt.axis);
        text(g, `${b.name}${twin ? '/R' : ''} · ${jt.axis === 0 ? 'flexion (x), side' : 'turn (y), from above'}`, bx + 4, by + 16, { size: 13, weight: 650 });
        let ty = by + 40;
        const tx = dx + 128;
        text(g, `range ${(lo * DEG).toFixed(0)}..${(hi * DEG).toFixed(0)}`, tx, ty, { size: 11 }); ty += 16;
        for (const [lab, s, col] of [[twin ? 'L' : 'used', sL, '#a32d22'], ['R', sR, '#1f5f99']]) {
            if (!s) continue;
            text(g, `${lab} ${s.min.toFixed(0)}..${s.max.toFixed(0)}`, tx, ty, { size: 11, color: col }); ty += 15;
            if (s.over) { text(g, `past by ${s.excess.toFixed(1)}°`, tx, ty, { size: 11, color: '#e00000', weight: 700 }); ty += 15; }
            if (s.at) { text(g, `at limit ${(100 * s.at / rec.steps).toFixed(0)}%`, tx, ty, { size: 10, color: DIM }); ty += 14; }
        }
    });
    S.add(drawCells(S.scene, rec.creature, cells).node);
    text(g, title || `${rec.creature.label} · ${rec.scenario.name} · joint ranges`, M, 26, { size: 18, weight: 700 });
    text(g, `each joint at its limits and at rest (red: the bone it turns) · dial: the range (green), rest dashed, what the run used (red L, blue R), past a limit in red with a red mark`, M, 48, { size: 13, color: DIM });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0 };
}
