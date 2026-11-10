// The parts sheet: each part of the body close, through a run, and how it
// moves against what carries it.
//
// A whole-body sheet shows where the bones go; a part a tenth of the body's
// size is a few pixels of it. Here every part has a row of its own: the
// skeleton's limbs (each chain out to a leaf: an ear, an arm, a leg, the
// tail) and each bone the body branches at with all it carries (the head
// with its ears, the chest with the head and arms). One side of a mirrored
// pair is drawn.
//
// A row is the part framed tight as the live view draws it at phases of
// the cycle, then two smears: every frame of the cycle laid over the others
//   in the world    the camera going along with the creature. What holds
//                   still in space is sharp; what swings is a blur as wide
//                   as its swing.
//   on its carrier  the pose turned so the bone that carries the part (its
//                   anchor) sits as at rest. A part that only rides its
//                   carrier is sharp here: glued on. One with motion of
//                   its own blurs.
// A steadied head is sharp in the world and blurred on its carrier; a
// toy's head on a spring is the other way about.
//
// Beside each row, the numbers the smears show: how far the part turns and
// its tip travels in the world and on its carrier, the carrier's own turn,
// each of its bones' turn against its parent, and a verdict:
//   glued     it does not move on its carrier
//   wobbles   it carries other parts (a head) and swings further in the
//             world than what carries it
//   steadied  it swings less in the world than what carries it
//   rides     it is thrown about the world and hardly moves on its carrier:
//             a head fixed to a bouncing chest

import { ROWS, bonePoint } from "./skeleton.js";
import { lastCycle, sampleRows, relativePose, rootOf } from "./cycle.js";
import { groundHeights } from "./run.js";
import { setPose, capture, orbitView, showGround } from "./lit.js";
import { beginSheet, saveSheet, text, rect, DIM } from "./page.js";
import { limbsOf } from "./skinsee.js";

export const PARTS = {
    glued: 2.0,       // degrees: a part turning less than this on its carrier is glued on
    gluedTravel: 0.02, // and its tip travelling under this share of its length
    wobble: 1.3,      // a part's turn in the world over its carrier's: over this it wobbles
    wobbleMin: 5,     // degrees it must swing in the world to be said to
    steady: 0.6,      // under this share of its carrier's turn it is steadied
    thrown: 0.25,     // a tip travelling this share of the part's length in the world is thrown about
    rides: 0.35,      // and one travelling under this share of that on its carrier,
    ridesOwn: 0.15,   // and under this share of its own length there, only rides it
};

const DEG = 180 / Math.PI;

// The parts of a skeleton: { name, bones (the first is the part's root),
// tip (bone), anchor (bone index) }.
export function partsOf(skel) {
    const B = skel.bones;
    const kids = B.map(() => []);
    for (const b of B) if (b.parentIndex >= 0 && !b.face) kids[b.parentIndex].push(b.index);
    const twin = (i) => B.find((o) => Math.abs(o.head[0] + B[i].head[0]) < 1e-4 && Math.abs(o.head[1] - B[i].head[1]) < 1e-4 && Math.abs(o.head[2] - B[i].head[2]) < 1e-4 && o.index !== i);
    const branchAbove = (i) => { let p = B[i].parentIndex; while (p >= 0 && B[p].parentIndex >= 0 && kids[p].length < 2) p = B[p].parentIndex; return p; };
    const out = [];
    for (const L of limbsOf(skel)) {
        const r = L.chain[0];
        if (B[r].head[0] < -1e-4 && twin(r)) continue;
        out.push({ name: B[r].name, bones: L.chain, tip: L.chain[L.chain.length - 1], anchor: L.parent });
    }
    for (const b of B) {
        if (b.parentIndex < 0 || kids[b.index].length < 2) continue;
        const all = [];
        const walk = (i) => { all.push(i); kids[i].forEach(walk); };
        walk(b.index);
        out.push({ name: b.name, bones: all, tip: b.index, anchor: branchAbove(b.index), carries: true });
    }
    return out;
}

const rot = (P, b) => { const k = b * ROWS; return [[P[k], P[k + 1], P[k + 2]], [P[k + 4], P[k + 5], P[k + 6]], [P[k + 8], P[k + 9], P[k + 10]]]; };
const pos = (P, b) => { const k = b * ROWS; return [P[k + 3], P[k + 7], P[k + 11]]; };
const mulT = (A, C) => A.map((_, i) => A.map((__, j) => A[0][i] * C[0][j] + A[1][i] * C[1][j] + A[2][i] * C[2][j]));   // A^T C
const angle = (A, C) => { const M = mulT(A, C); return Math.acos(Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2))) * DEG; };

// Pose P with bone `a` put back where it rests: everything as its carrier sees it.
export function onAnchor(skel, P, a) {
    const out = new Float32Array(P.length);
    const R = rot(P, a), p = pos(P, a), h = skel.bones[a].head;
    for (let b = 0; b < skel.count; b++) {
        const k = b * ROWS, M = mulT(R, rot(P, b)), q = pos(P, b);
        const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        for (let i = 0; i < 3; i++) {
            out[k + 4 * i] = M[i][0]; out[k + 4 * i + 1] = M[i][1]; out[k + 4 * i + 2] = M[i][2];
            out[k + 4 * i + 3] = R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2] + h[i];
        }
    }
    return out;
}

// The widest turn between any two of the rotations, and the widest two of the points are apart.
const turnRange = (Rs) => { let m = 0; for (let i = 0; i < Rs.length; i++) for (let j = i + 1; j < Rs.length; j++) m = Math.max(m, angle(Rs[i], Rs[j])); return m; };
const travel = (ps) => { let m = 0; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) m = Math.max(m, Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1], ps[i][2] - ps[j][2])); return m; };

// How a part moves over poses (creature-frame poses of a cycle or a run).
// `striding`: the poses are a stride's (standing, a head that turns is
// looking about, and its legs are still because it stands).
export function partMotion(skel, part, poses, { striding = true } = {}) {
    const B = skel.bones, root = part.bones[0], tipB = B[part.tip];
    const tipOf = (P) => bonePoint(P, 0, part.tip, tipB.head, tipB.tail);
    const on = poses.map((P) => onAnchor(skel, P, part.anchor));
    const length = Math.max(0.01, Math.hypot(...tipB.tail.map((v, i) => v - B[root].head[i])));
    const m = {
        length,
        worldTurn: turnRange(poses.map((P) => rot(P, root))), ownTurn: turnRange(on.map((P) => rot(P, root))),
        carrierTurn: turnRange(poses.map((P) => rot(P, part.anchor))),
        worldTravel: travel(poses.map(tipOf)), ownTravel: travel(on.map(tipOf)),
        // Each of its chain's bones against its parent.
        joints: part.bones.filter((b, i) => i === 0 || B[b].parentIndex === part.bones[i - 1]).map((b) => ({ bone: B[b].name, turn: turnRange(poses.map((P) => mulT(rot(P, B[b].parentIndex), rot(P, b)))) })),
    };
    // (A leg is driven, not carried: it has no verdict but glued.)
    const leg = skel.feet.some((f) => part.bones.includes(f.boneIndex));
    m.verdict = m.ownTurn < PARTS.glued && m.ownTravel < PARTS.gluedTravel * length ? 'glued'
        : leg ? ''
        // (A limb swinging further than its carrier is a limb in use; a part
        // that carries others doing so is a head on a spring.)
        : striding && part.carries && m.worldTurn > PARTS.wobbleMin && m.worldTurn > PARTS.wobble * m.carrierTurn ? 'wobbles'
        : m.carrierTurn > 2 && m.worldTurn < PARTS.steady * m.carrierTurn ? 'steadied'
        : m.worldTravel > PARTS.thrown * length && m.ownTravel < PARTS.rides * m.worldTravel && m.ownTravel < PARTS.ridesOwn * length ? 'rides' : '';
    m.leg = leg;
    m.striding = striding;
    return m;
}

export function partFlags(skel, parts, motions) {
    const flags = [];
    parts.forEach((p, i) => {
        const m = motions[i], on = skel.bones[p.anchor].name;
        if (m.verdict === 'glued') flags.push(`parts: ${p.name} is glued to ${on} (it turns ${m.ownTurn.toFixed(1)}° on it, its tip travels ${(100 * m.ownTravel).toFixed(1)} cm)`);
        if (m.verdict === 'rides') flags.push(`parts: ${p.name} rides ${on} wherever it goes: its tip travels ${(100 * m.worldTravel).toFixed(1)} cm in the world and ${(100 * m.ownTravel).toFixed(1)} cm on ${on} (it turns ${m.worldTurn.toFixed(1)}° in the world, ${on} ${m.carrierTurn.toFixed(1)}°)`);
        if (m.verdict === 'wobbles') flags.push(`parts: ${p.name} wobbles: it swings ${m.worldTurn.toFixed(1)}° in the world on a ${on} that swings ${m.carrierTurn.toFixed(1)}°`);
        const still = m.joints.filter((j) => j.turn < PARTS.glued);
        if (m.verdict !== 'glued' && !(m.leg && !m.striding) && m.joints.length > 1 && still.length) flags.push(`parts: ${p.name}: ${still.map((j) => j.bone).join(', ')} ${still.length > 1 ? 'do' : 'does'} not turn (${m.joints.map((j) => `${j.bone} ${j.turn.toFixed(0)}°`).join(', ')})`);
    });
    return flags;
}

function average(imgs, W, H) {
    const acc = new Float32Array(W * H * 4);
    for (const im of imgs) for (let i = 0; i < acc.length; i++) acc[i] += im.data[i];
    const out = new ImageData(W, H);
    for (let i = 0; i < acc.length; i++) out.data[i] = acc[i] / imgs.length;
    return out;
}

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
}

// The parts sheet of a run. `part`: names of the parts to draw (all by
// default); `frames`: close-ups a row; `smear`: frames laid over each other.
export function partsSheet(rec, { path, part = null, frames = 6, cell = 230, smear = 16 } = {}) {
    const t0 = Date.now();
    const creature = rec.creature, skel = creature.skel, B = skel.bones;
    let parts = partsOf(skel);
    if (part) {
        parts = parts.filter((p) => part.includes(p.name));
        if (!parts.length) throw new Error(`parts: no part ${part.join(', ')} (have ${partsOf(skel).map((p) => p.name).join(', ')})`);
    }
    const cyc = lastCycle(rec);
    const poseAt = (step) => {
        const r = rootOf(rec, step);
        return relativePose(rec, step, groundHeights(rec.env, new Float32Array([r.x, r.z]))[0], new Float32Array(rec.poseStride));
    };
    const shown = sampleRows(rec, frames, cyc);
    const many = sampleRows(rec, smear, cyc).map((s) => poseAt(s.step));
    const dense = sampleRows(rec, 32, cyc).map((s) => poseAt(s.step));
    const motions = parts.map((p) => partMotion(skel, p, dense, { striding: !!cyc }));
    const flags = partFlags(skel, parts, motions);
    const fov = 26;
    // A part's middle and reach in pose P.
    const frame = (p, P) => {
        const pts = p.bones.flatMap((b) => [pos(P, b), bonePoint(P, 0, b, B[b].head, B[b].tail)]);
        const c = [0, 1, 2].map((k) => (Math.min(...pts.map((q) => q[k])) + Math.max(...pts.map((q) => q[k]))) / 2);
        return { c, r: Math.max(0.05, ...pts.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]))) };
    };
    const rows = parts.map((p) => {
        // One camera a row: far enough for the part wherever the run takes it.
        const fs = many.map((P) => frame(p, P));
        const c = [0, 1, 2].map((k) => fs.reduce((s, f) => s + f.c[k], 0) / fs.length);
        const r = Math.max(...fs.map((f) => f.r + Math.hypot(f.c[0] - c[0], f.c[1] - c[1], f.c[2] - c[2])));
        const dist = (1.25 * r) / Math.tan((fov * Math.PI) / 360);
        const yaw = c[0] > 0.02 ? 55 : 40;
        const view = orbitView(c, yaw, 8, dist, fov);
        showGround(true);
        const close = shown.map((s) => { setPose(creature, poseAt(s.step)); return capture(view, cell, cell); });
        const world = average(many.map((P) => { setPose(creature, P); return capture(view, cell, cell); }), cell, cell);
        showGround(false);
        const fa = frame(p, onAnchor(skel, many[0], p.anchor));
        const va = orbitView(fa.c, yaw, 8, (1.45 * fa.r) / Math.tan((fov * Math.PI) / 360), fov);
        const carried = average(many.map((P) => { setPose(creature, onAnchor(skel, P, p.anchor)); return capture(va, cell, cell); }), cell, cell);
        return { close, world, carried };
    });
    showGround(true);
    const LM = 250, TM = 92, FH = 20 * flags.length + (flags.length ? 14 : 0), gap = 6;
    const W = LM + (frames + 2) * (cell + gap) + 18, H = TM + FH + parts.length * (cell + gap) + 10;
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · parts`, 12, 30, { size: 22, weight: 700 });
    text(g, `${rec.scenario.about || ''}${cyc ? ` — cycle ${cyc.period.toFixed(3)} s` : ''}; each part close, then every frame laid over the others: going along with the creature, and with its carrier held still`, 12, 52, { size: 14, color: DIM });
    flags.forEach((f, i) => text(g, f, 12, TM - 12 + 20 * i, { size: 13, color: '#b03a2e' }));
    const y0 = TM + FH;
    shown.forEach((s, c) => text(g, s.label, LM + c * (cell + gap) + cell / 2, y0 - 6, { size: 13, weight: 650, align: 'center' }));
    const xs = LM + frames * (cell + gap) + 12;
    text(g, 'smear: in the world', xs + cell / 2, y0 - 6, { size: 13, weight: 650, align: 'center' });
    text(g, 'smear: on its carrier', xs + cell + gap + cell / 2, y0 - 6, { size: 13, weight: 650, align: 'center' });
    parts.forEach((p, r) => {
        const y = y0 + r * (cell + gap), m = motions[r];
        text(g, p.name, 12, y + 22, { size: 16, weight: 700 });
        text(g, `carried by ${B[p.anchor].name}`, 12, y + 42, { size: 13, color: DIM });
        if (m.verdict) text(g, m.verdict, 12, y + 64, { size: 15, weight: 700, color: m.verdict === 'steadied' ? '#1e8449' : '#b03a2e' });
        const lines = [
            `in the world: turns ${m.worldTurn.toFixed(1)}°, tip ${(100 * m.worldTravel).toFixed(1)} cm`,
            `on its carrier: turns ${m.ownTurn.toFixed(1)}°, tip ${(100 * m.ownTravel).toFixed(1)} cm`,
            `its carrier turns ${m.carrierTurn.toFixed(1)}°`,
            ...m.joints.slice(0, 5).map((j) => `${j.bone} on its parent ${j.turn.toFixed(1)}°`),
        ];
        lines.forEach((l, i) => text(g, l, 12, y + 86 + 17 * i, { size: 12, color: DIM }));
        rows[r].close.forEach((img, c) => g.drawImage(toCanvas(img), LM + c * (cell + gap), y));
        g.drawImage(toCanvas(rows[r].world), xs, y);
        g.drawImage(toCanvas(rows[r].carried), xs + cell + gap, y);
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0,
        json: { flags, parts: parts.map((p, i) => ({ name: p.name, carrier: B[p.anchor].name, ...motions[i] })) } };
}
