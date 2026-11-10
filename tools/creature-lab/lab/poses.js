// The poses sheet: how a gait's key poses look and whether they read as
// the gait they are, and how the body reads as a shape. Where the natural
// measures (lab/natural.js) judge motion's defects (corners, lockstep, a
// mass the feet could not move), this judges the poses themselves, with no
// reference:
//
//   key poses   the first foot's cycle at contact, its lowest and highest
//               hips over its stance, mid-stance, lift-off and mid-swing,
//               drawn large from the side (lit), the legs traced over the
//               skin (planted thick), and under each the hips' height, each
//               leg's bend (the angle between its two upper bones) and
//               extension (hip to the second bone's end over their length),
//               and the trunk's lean
//   gait        a walk (duty >= 0.5) is an inverted pendulum: the stance
//               leg a strut, the hips vaulting over it. Its middle 60% of
//               stance is held to POSES.walkBend degrees of bend, and the
//               hips' rise from contact to their highest against the rise a
//               rigid leg of the measured length would give from the
//               contact's reach (`vault`, 1 for a strut, 0 for hips carried
//               level on bending knees) to POSES.walkVault. A run is a
//               spring: the leg gives through stance and extends to push
//               off, its extension at lift-off held to POSES.pushOff.
//   silhouette  the rest pose's skin rasterized from the front and the side,
//               and the mid-stance pose's from the front. Where the legs
//               part (the crotch) against the hip joints' height, the share
//               of the trunk's height where the arms stand clear of it, and
//               the front width profile's pinches (neck, waist, the joints
//               of a leg): each against the bulges either side of it. A
//               profile with no pinch between shoulders and legs is a tube;
//               a head no wider than its neck is a stalk. The first leg's
//               own skin side on: the thigh's greatest depth against the
//               shank's (POSES.thighCalf), as a calf deeper than the thigh
//               makes a leg top-light.

import { cycles, relativePose, planted, rootOf } from "./cycle.js";
import { groundHeights } from "./run.js";
import { setPose, capture, orbitView, showGround, project } from "./lit.js";
import { beginSheet, saveSheet, text, line, rect, poly, INK, DIM, FOOT_COLORS } from "./page.js";
import { boneHead, boneTail } from "./skeleton.js";
import { skinPositions } from "./form.js";

const DEG = 180 / Math.PI;
export const POSES = { walkBend: 20, walkVault: 0.4, pushOff: 0.95, crotch: 0.75, armGap: 0.5, pinch: 1.15, headNeck: 1.3, thighCalf: 1.3 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Leg f's two upper bones in pose P: the hip, knee and the second bone's
// end, its bend (degrees between the bones) and extension.
function legOf(skel, P, f) {
    const [a, b] = skel.parts.legs[f].chain;
    const A = skel.bones[a], B = skel.bones[b];
    const hip = boneHead(P, 0, a), knee = boneHead(P, 0, b), end = boneTail(P, 0, B);
    const u = sub(knee, hip), v = sub(end, knee);
    const c = Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v))));
    return { hip, knee, end, bend: Math.acos(c) * DEG, ext: len(sub(end, hip)) / (A.length + B.length) };
}

function frameOf(rec, k) {
    const r = rootOf(rec, k);
    const g = groundHeights(rec.env, new Float32Array([r.x, r.z]))[0];
    const P = relativePose(rec, k, g, new Float32Array(rec.poseStride));
    const skel = rec.creature.skel;
    const legs = skel.feet.map((f) => legOf(skel, P, f.index));
    // The trunk's lean: from the root to the top of the trunk (the head's
    // nearest ancestor that branches: the bone the neck and the arms hang
    // from), forward positive.
    const root = boneHead(P, 0, skel.parts.root);
    const kids = skel.bones.map((b) => skel.bones.filter((c) => c.parentIndex === b.index && !c.face).length);
    let top = skel.bones.find((b) => b.name === 'head');
    while (top && top.parentIndex >= 0 && kids[top.index] < 2) top = skel.bones[top.parentIndex];
    let lean = 0;
    if (top) { const d = sub(boneTail(P, 0, top), root); lean = Math.atan2(d[2], d[1]) * DEG; }
    return { k, P, legs, rootY: root[1], lean, down: skel.feet.map((f) => planted(rec, k, f.index)) };
}

// --- silhouettes ------------------------------------------------------------------------

// Mesh X's triangles filled into a grid of `cell` m seen along z (front:
// x across, y up) or x (side: z across).
// The bones of tails: the root's children that carry neither a leg nor the
// head (what hangs behind and would fill the gap between the legs).
export function tailBones(skel) {
    const kids = skel.bones.map((b) => skel.bones.filter((c) => c.parentIndex === b.index).map((c) => c.index));
    const below = (b, out = []) => { out.push(b); for (const c of kids[b]) below(c, out); return out; };
    const legTops = new Set(skel.parts.legs.map((l) => l.top));
    const out = new Set();
    for (const c of kids[skel.parts.root]) {
        const sub = below(c);
        if (sub.some((b) => legTops.has(b) || skel.bones[b].name === 'head')) continue;
        for (const b of sub) out.add(b);
    }
    return out;
}

// `only`, a set of bones, keeps just the triangles all of whose corners those
// bones carry most.
function silhouette(creature, X, side, cell = 0.004, only = null) {
    const n = X.length / 3;
    const tails = tailBones(creature.skel), W0 = creature.body.weights;
    const all = creature.body.indices, keep = [];
    for (let t = 0; t < all.length; t += 3) {
        const own = [0, 1, 2].map((j) => W0[all[t + j]][0].index);
        if (only ? !own.every((b) => only.has(b)) : (!side && own.every((b) => tails.has(b)))) continue;
        keep.push(all[t], all[t + 1], all[t + 2]);
    }
    const idx = keep;
    const ax = side ? 2 : 0;
    let u0 = Infinity, u1 = -Infinity, y1 = 0;
    for (let v = 0; v < n; v++) { u0 = Math.min(u0, X[3 * v + ax]); u1 = Math.max(u1, X[3 * v + ax]); y1 = Math.max(y1, X[3 * v + 1]); }
    u0 -= 0.02; u1 += 0.02;
    const W = Math.ceil((u1 - u0) / cell) + 1, H = Math.ceil((y1 + 0.02) / cell) + 1;
    const m = new Uint8Array(W * H);
    const P = (v) => [(X[3 * v + ax] - u0) / cell, (y1 + 0.02 - X[3 * v + 1]) / cell];
    for (let t = 0; t < idx.length; t += 3) {
        const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]);
        const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(d) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1b = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        for (let y = y0; y <= y1b; y++) for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / d;
            const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / d;
            if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) m[y * W + x] = 1;
        }
    }
    // Row r's height (m) and column c's place.
    return { m, W, H, cell, yOf: (r) => y1 + 0.02 - (r + 0.5) * cell, uOf: (c) => u0 + (c + 0.5) * cell, cOf: (u) => Math.round((u - u0) / cell - 0.5), top: y1 };
}

function runsOf(S, r) {
    const out = [];
    let s = -1;
    for (let c = 0; c <= S.W; c++) {
        const on = c < S.W && S.m[r * S.W + c];
        if (on && s < 0) s = c;
        if (!on && s >= 0) { out.push([S.uOf(s), S.uOf(c - 1) + S.cell]); s = -1; }
    }
    return out;
}

// The front silhouette's measures: the crotch's height, the share of the
// trunk's rows with the arms clear of it, and the width profile (the run
// about the middle, or below the crotch the first leg's) with its pinches.
function frontForm(skel, S) {
    const hips = skel.parts.legs.map((l) => skel.bones[l.top].head);
    const hipY = hips.reduce((s, h) => s + h[1], 0) / Math.max(hips.length, 1);
    const legX = hips.length ? hips[0][0] : 0;
    const c0 = S.cOf(0);
    let crotch = 0;
    for (let r = S.H - 1; r >= 0; r--) { if (S.m[r * S.W + c0]) { crotch = S.yOf(r); break; } }
    const prof = [];
    let clear = 0, rows = 0;
    for (let r = 0; r < S.H; r++) {
        const y = S.yOf(r), runs = runsOf(S, r);
        if (!runs.length) continue;
        let run = runs.find((q) => q[0] <= 0 && q[1] >= 0);
        if (!run) run = runs.reduce((best, q) => (Math.abs((q[0] + q[1]) / 2 - legX) < Math.abs((best[0] + best[1]) / 2 - legX) ? q : best));
        prof.push({ y, w: run[1] - run[0] });
    }
    // The shoulders: up from the crotch, the last row with the arms beside
    // the trunk before 15 cm of rows without (ears and the like are above).
    let shoulder = crotch, miss = 0;
    for (let r = S.H - 1; r >= 0 && miss * S.cell < 0.15; r--) {
        if (S.yOf(r) <= crotch) continue;
        if (runsOf(S, r).length >= 3) { shoulder = S.yOf(r); miss = 0; } else miss++;
    }
    for (let r = 0; r < S.H; r++) {
        const y = S.yOf(r);
        if (y <= crotch || y >= shoulder) continue;
        rows++;
        if (runsOf(S, r).length >= 3) clear++;
    }
    // Pinches: local minima of the profile smoothed over 2 cm, each against
    // the smaller of the largest widths within 12 cm above and below.
    const w = prof.map((p, i) => {
        let s = 0, m = 0;
        for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < prof.length) { s += prof[j].w; m++; }
        return s / m;
    });
    const span = Math.round(0.12 / S.cell);
    const pinches = [];
    for (let i = 1; i + 1 < w.length; i++) {
        if (!(w[i] <= w[i - 1] && w[i] < w[i + 1])) continue;
        let up = 0, dn = 0;
        for (let j = Math.max(0, i - span); j < i; j++) up = Math.max(up, w[j]);
        for (let j = i + 1; j <= Math.min(w.length - 1, i + span); j++) dn = Math.max(dn, w[j]);
        const contrast = Math.min(up, dn) / Math.max(w[i], 1e-3);
        if (contrast > 1.04) pinches.push({ y: prof[i].y, w: w[i], contrast });
    }
    return { crotch, hipY, crotchShare: crotch / hipY, armClear: rows ? clear / rows : 0, shoulder, profile: prof, pinches };
}

// The first leg's two upper bones seen from the side alone: its greatest
// depth (front to back) over the thigh's middle (the buttock above it is
// not the thigh) and over the shank between its joints' ends.
function legForm(creature) {
    const skel = creature.skel, leg = skel.parts.legs[0];
    if (!leg) return null;
    const th = skel.bones[leg.top];
    const shin = skel.bones.find((b) => b.parentIndex === th.index);
    if (!shin) return null;
    const S = silhouette(creature, creature.body.positions, true, 0.003, new Set([th.index, shin.index]));
    const hipY = th.head[1], kneeY = th.tail[1], ankleY = shin.tail[1];
    let thigh = 0, shank = 0, thighY = 0, shankY = 0;
    for (let r = 0; r < S.H; r++) {
        const y = S.yOf(r), runs = runsOf(S, r);
        if (!runs.length) continue;
        const d = Math.max(...runs.map((q) => q[1] - q[0]));
        const ut = (y - kneeY) / (hipY - kneeY), us = (y - ankleY) / (kneeY - ankleY);
        if (ut > 0.3 && ut < 0.6 && d > thigh) { thigh = d; thighY = y; }
        if (us > 0.15 && us < 0.85 && d > shank) { shank = d; shankY = y; }
    }
    return { thigh, shank, thighY, shankY, ratio: thigh / Math.max(shank, 1e-3) };
}

function drawSil(g, S, x0, y0, w, h, color) {
    const k = Math.min(w / (S.W * S.cell), h / (S.H * S.cell));
    const img = new ImageData(S.W, S.H);
    for (let i = 0; i < S.W * S.H; i++) {
        const o = 4 * i;
        if (S.m[i]) { img.data[o] = color[0]; img.data[o + 1] = color[1]; img.data[o + 2] = color[2]; img.data[o + 3] = 255; }
    }
    const c = document.createElement('canvas');
    c.width = S.W; c.height = S.H;
    c.getContext('2d').putImageData(img, 0, 0);
    const dw = S.W * S.cell * k, dh = S.H * S.cell * k;
    const ox = x0 + (w - dw) / 2, oy = y0 + h - dh;
    g.drawImage(c, ox, oy, dw, dh);
    // y (m) to the panel's px.
    return { yPx: (y) => oy + (S.top + 0.02 - y) * k, uPx: (u) => ox + (S.cOf(u) + 0.5) * S.cell * k, k };
}

// --- the sheet ----------------------------------------------------------------------------

export function posesSheet(rec, { path } = {}) {
    const t0 = Date.now();
    const creature = rec.creature, skel = creature.skel;
    const cyc = cycles(rec, rec.scenario.duration * 0.4);
    if (!cyc.length || skel.feet.length < 1) throw new Error(`poses: ${rec.scenario.name} has no steady cycle`);
    const { a, b } = cyc[cyc.length - 1];
    let lift = a + 1;
    while (lift < b && planted(rec, lift, 0)) lift++;
    const S = lift - a, duty = S / (b - a);
    const F = [];
    for (let k = a; k <= b; k++) F.push(frameOf(rec, k));
    const at = (k) => F[k - a];
    let lo = a, hi = a;
    for (let k = a; k < lift; k++) {
        if (k < a + 0.5 * S && at(k).rootY < at(lo).rootY) lo = k;
        if (at(k).rootY > at(hi).rootY) hi = k;
    }
    const mid = a + Math.round(0.5 * S), swing = lift + Math.round(0.5 * (b - lift));
    const keys = [['contact', a], ['hips lowest', lo], ['mid-stance', mid], ['hips highest', hi], ['lift-off', lift], ['mid-swing', swing]]
        .sort((p, q) => p[1] - q[1]);

    // The gait's measures, on the first leg.
    const gait = { duty, run: duty < 0.5 };
    const flags = [];
    if (!gait.run) {
        let s = 0, n = 0, mx = 0;
        for (let k = a + Math.round(0.2 * S); k <= a + Math.round(0.7 * S); k++) { const bd = at(k).legs[0].bend; s += bd; n++; mx = Math.max(mx, bd); }
        gait.stanceBend = s / n;
        gait.stanceBendMax = mx;
        const c = at(a).legs[0], m = at(mid).legs[0];
        const reach = Math.abs(c.end[2] - c.hip[2]), Ls = len(sub(m.hip, m.end));
        const rigid = Ls - Math.sqrt(Math.max(Ls * Ls - reach * reach, 0));
        gait.rise = at(hi).rootY - at(a).rootY;
        gait.rigidRise = rigid;
        gait.vault = rigid > 1e-4 ? gait.rise / rigid : 0;
        gait.peakAt = (hi - a) / S;
        if (gait.stanceBend > POSES.walkBend) flags.push(`walk: the stance leg is bent ${gait.stanceBend.toFixed(0)} deg through mid-stance (a strut wants <= ${POSES.walkBend})`);
        if (gait.vault < POSES.walkVault) flags.push(`walk: the hips rise ${(100 * gait.rise).toFixed(1)} cm over the stance leg, ${(100 * gait.vault).toFixed(0)}% of a rigid leg's ${(100 * rigid).toFixed(1)} cm (want >= ${(100 * POSES.walkVault).toFixed(0)}%)`);
    } else {
        gait.contactBend = at(a).legs[0].bend;
        gait.midBend = at(mid).legs[0].bend;
        gait.liftExt = at(lift - 1).legs[0].ext;
        if (gait.liftExt < POSES.pushOff) flags.push(`run: the leg leaves the ground at ${(100 * gait.liftExt).toFixed(0)}% extension (a push-off wants >= ${(100 * POSES.pushOff).toFixed(0)}%)`);
        if (gait.midBend < gait.contactBend + 3) flags.push(`run: the leg does not give through stance (${gait.contactBend.toFixed(0)} deg at contact, ${gait.midBend.toFixed(0)} mid-stance)`);
    }

    // Silhouettes: the rest pose from the front and the side, mid-stance from the front.
    const X0 = creature.body.positions;
    const front = silhouette(creature, X0, false), side = silhouette(creature, X0, true);
    const midFront = silhouette(creature, skinPositions(creature, at(mid).P), false);
    const form = frontForm(skel, front), formMid = frontForm(skel, midFront);
    const trunkPinch = form.pinches.filter((p) => p.y > form.crotch + 0.03 && p.y < form.shoulder);
    const neck = form.pinches.filter((p) => p.y >= form.shoulder).sort((p, q) => p.w - q.w)[0];
    if (form.crotchShare < POSES.crotch) flags.push(`silhouette: the legs part ${(100 * form.crotch).toFixed(0)} cm up, ${(100 * form.crotchShare).toFixed(0)}% of the hips' height (want >= ${(100 * POSES.crotch).toFixed(0)}%)`);
    // (Running, the swing knee comes through in front of the stance leg.)
    if (!gait.run && formMid.crotchShare < POSES.crotch) flags.push(`silhouette: at mid-stance the legs part ${(100 * formMid.crotch).toFixed(0)} cm up (${(100 * formMid.crotchShare).toFixed(0)}% of the hips' height)`);
    if (form.armClear < POSES.armGap) flags.push(`silhouette: the arms stand clear of the trunk over ${(100 * form.armClear).toFixed(0)}% of its height (want >= ${(100 * POSES.armGap).toFixed(0)}%)`);
    if (!trunkPinch.some((p) => p.contrast >= POSES.pinch)) flags.push(`silhouette: no waist: the trunk narrows nowhere by ${(100 * (POSES.pinch - 1)).toFixed(0)}% between its bulges (a tube)`);
    const leg = legForm(creature);
    if (leg && leg.ratio < POSES.thighCalf) flags.push(`silhouette: the thigh (${(100 * leg.thigh).toFixed(1)} cm deep) is only ${leg.ratio.toFixed(2)}x the shank's ${(100 * leg.shank).toFixed(1)} cm, side on (want >= ${POSES.thighCalf})`);
    if (neck && neck.contrast < POSES.headNeck) flags.push(`silhouette: the neck (${(100 * neck.w).toFixed(1)} cm) is only ${neck.contrast.toFixed(2)}x narrower than what is about it (want >= ${POSES.headNeck})`);

    // --- draw ---
    const cw = 270, ch = 430, LM = 16, TM = 74, GAP = 8;
    const SH = 330;
    const W = LM + keys.length * (cw + GAP) + 8, H = TM + ch + 110 + SH + 40 + 18 * flags.length + 20;
    const top = Math.max(...skel.bones.map((bn) => Math.max(bn.head[1], bn.tail[1])));
    const target = [0, top * 0.5, 0];
    const view = orbitView(target, 90, 4, top * 2.25, 30);
    const shots = keys.map(([, k]) => { setPose(creature, at(k).P); showGround(true); return capture(view, cw, ch); });
    const Sh = beginSheet(W, H);
    const g = Sh.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · poses`, 12, 30, { size: 22, weight: 700 });
    text(g, `the first foot's cycle (${((b - a) * rec.dt).toFixed(3)} s, duty ${duty.toFixed(2)}) from the left; legs traced (${skel.feet.map((f) => f.name).join(' red, ')} orange; thick: planted), bend = degrees between the two upper bones, ext = hip to their end over their length`, 12, 52, { size: 13, color: DIM });
    keys.forEach(([name, k], i) => {
        const x0 = LM + i * (cw + GAP), fr = at(k);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').putImageData(shots[i], 0, 0);
        g.drawImage(c, x0, TM);
        fr.legs.forEach((L, f) => {
            const pts = [L.hip, L.knee, L.end].map((p) => project(view, cw, ch, p)).map((p) => [x0 + p.x, TM + p.y]);
            poly(g, pts, FOOT_COLORS[f], fr.down[f] ? 3.5 : 1.5);
        });
        text(g, name, x0 + 6, TM + 18, { size: 15, weight: 700 });
        text(g, `phase ${((k - a) / (b - a)).toFixed(2)}`, x0 + 6, TM + 36, { size: 12, color: DIM });
        const y = TM + ch + 20;
        text(g, `hips ${(100 * fr.rootY).toFixed(1)} cm · lean ${fr.lean.toFixed(0)} deg`, x0 + 4, y, { size: 13 });
        fr.legs.forEach((L, f) => text(g, `${skel.feet[f].name}: bend ${L.bend.toFixed(0)} · ext ${(100 * L.ext).toFixed(0)}%${fr.down[f] ? ' · down' : ''}`, x0 + 4, y + 20 + 18 * f, { size: 13, color: FOOT_COLORS[f] }));
    });
    const gy = TM + ch + 86;
    const gl = gait.run
        ? `run: bend at contact ${gait.contactBend.toFixed(0)} deg, mid-stance ${gait.midBend.toFixed(0)}, extension at lift-off ${(100 * gait.liftExt).toFixed(0)}%`
        : `walk: stance bend ${gait.stanceBend.toFixed(0)} deg (max ${gait.stanceBendMax.toFixed(0)}) through mid-stance; hips rise ${(100 * gait.rise).toFixed(1)} cm from contact, a rigid leg ${(100 * gait.rigidRise).toFixed(1)} (vault ${(100 * gait.vault).toFixed(0)}%), highest at ${(100 * gait.peakAt).toFixed(0)}% of stance`;
    text(g, gl, LM, gy, { size: 14, weight: 650 });

    // Silhouettes with the front profile's pinches marked.
    const sy = gy + 24;
    const panels = [['rest, front', front, form], ['rest, side', side, null], ['mid-stance, front', midFront, formMid]];
    panels.forEach(([name, Sx, fm], i) => {
        const x0 = LM + i * 300, pw = 280;
        text(g, name, x0, sy + 14, { size: 14, weight: 650 });
        const m = drawSil(g, Sx, x0, sy + 22, pw, SH - 30, [70, 62, 52]);
        if (!fm) return;
        line(g, x0, m.yPx(fm.hipY), x0 + pw, m.yPx(fm.hipY), '#2471a3', 1, [4, 3]);
        line(g, x0, m.yPx(fm.crotch), x0 + pw, m.yPx(fm.crotch), '#c0392b', 1.5);
        for (const p of fm.pinches) {
            const col = p.contrast >= POSES.pinch ? '#17a589' : '#d68910';
            line(g, m.uPx(-p.w / 2), m.yPx(p.y), m.uPx(p.w / 2), m.yPx(p.y), col, 2);
            text(g, `${p.contrast.toFixed(2)}`, m.uPx(p.w / 2) + 4, m.yPx(p.y) + 4, { size: 11, color: col });
        }
    });
    const tx = LM + 3 * 300 + 10;
    const lines = [
        `crotch ${(100 * form.crotch).toFixed(0)} cm = ${(100 * form.crotchShare).toFixed(0)}% of the hip joints' ${(100 * form.hipY).toFixed(0)} (mid-stance ${(100 * formMid.crotchShare).toFixed(0)}%)`,
        `arms clear of the trunk over ${(100 * form.armClear).toFixed(0)}% of its height`,
        ...(leg ? [`leg, side on: thigh ${(100 * leg.thigh).toFixed(1)} cm deep, shank ${(100 * leg.shank).toFixed(1)} (${leg.ratio.toFixed(2)}x)`] : []),
        `pinches (width, contrast), top down:`,
        ...form.pinches.map((p) => `  ${(100 * p.y).toFixed(0)} cm: ${(100 * p.w).toFixed(1)} cm wide, ${p.contrast.toFixed(2)}x`),
    ];
    lines.forEach((s, i) => text(g, s, tx, sy + 14 + 18 * i, { size: 13 }));
    const fy = sy + SH + 24;
    text(g, flags.length ? `${flags.length} flag(s):` : 'no flags', LM, fy, { size: 14, weight: 700, color: flags.length ? '#c0392b' : '#17a589' });
    flags.forEach((f, i) => text(g, f, LM + 10, fy + 20 + 18 * i, { size: 13 }));
    const out = saveSheet(path);
    const r = (x) => Math.round(x * 1e4) / 1e4;
    const keyJson = keys.map(([name, k]) => ({ name, phase: r((k - a) / (b - a)), hips: r(at(k).rootY), lean: r(at(k).lean),
        legs: at(k).legs.map((L, f) => ({ foot: skel.feet[f].name, bend: r(L.bend), ext: r(L.ext), down: at(k).down[f] })) }));
    const strip = (fm) => ({ crotch: r(fm.crotch), crotchShare: r(fm.crotchShare), armClear: r(fm.armClear), pinches: fm.pinches.map((p) => ({ y: r(p.y), w: r(p.w), contrast: r(p.contrast) })) });
    return { path, width: out.width, height: out.height, ms: Date.now() - t0,
        json: { gait: Object.fromEntries(Object.entries(gait).map(([k, v]) => [k, typeof v === 'number' ? r(v) : v])), keys: keyJson, rest: strip(form), midStance: strip(formMid), leg: leg && { thigh: r(leg.thigh), shank: r(leg.shank), ratio: r(leg.ratio) }, flags } };
}
