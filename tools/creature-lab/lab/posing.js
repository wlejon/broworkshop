// Keys: the poses a species draws, and the cycles made of them.
//
// A creature's `keys` (its poses.js) is { poses, cycles }. A pose says where
// the body is, not how each leg bends:
//
//   stand:   { },                                   // the rest pose
//   contact: {
//       base: 'stand',                              // starts from another pose
//       root: [0, -0.03, 0.01],                     // the root from its rest place (m; x left, y up, z ahead)
//       turn: [6, -8, 0],                           // the root's turn (deg; x pitch forward, y to its left, z roll)
//       bones: { chest: [4, 10, 0], upperarmL: [25, 0, 0] },   // each bone from its parent (deg, the skeleton's axes)
//       feet: { L: { at: [0, 0, 0.24], heel: -10, toe: -25 },  // the ball from its rest place (y over the ground),
//               R: { at: [0, 0, -0.2], heel: 40 } },           //   the heel's lift, the toes' pitch, the foot's yaw (deg)
//   },
//
// A leg is solved from its hip to the ball (creature::keyed leg_solve), so
// a pose is drawn by placing the feet. A cycle is poses at phases of a
// stride, with each leg's stance:
//
//   walk: { keys: [[0, 'contact'], [0.12, 'down'], [0.25, 'pass'], [0.38, 'up']],
//           mirror: true,                           // the second half is the first, mirrored
//           stance: { L: [0, 0.6] } }               // touchdown and lift-off phases (the other side half a cycle on)
//
// resolveKeys writes them out as the brokernel module creature::keys, which
// creature::keyed (lab/keyed.bk) reads. The model sheet draws every pose
// and every cycle as the keys alone have them (no rig, no motion layers):
// what a species looks like in each pose, before any of it moves.

import { ROWS, centreOfMass, boneTail, boneHead } from "./skeleton.js";
import { restExtent } from "./turnaround.js";
import { setPose, capture, orbitView, showGround } from "./lit.js";
import { beginSheet, saveSheet, text, rect, DIM } from "./page.js";

const DEG = Math.PI / 180;
const f = (x) => { const s = String(Math.fround(x)); return /[.eE]/.test(s) ? s : s + '.0'; };

const qmul = (a, b) => [
    a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
// R = Rx(x) Ry(y) Rz(z), degrees: the lab's joint-angle order (common.bk q_xyz).
function qxyz([x, y, z]) {
    const h = (a) => [Math.sin(0.5 * a * DEG), Math.cos(0.5 * a * DEG)];
    const [sx, cx] = h(x), [sy, cy] = h(y), [sz, cz] = h(z);
    return qmul(qmul([sx, 0, 0, cx], [0, sy, 0, cy]), [0, 0, sz, cz]);
}

// Each bone's mirror across the creature's middle (by its rest head and tail).
function mirrorMap(skel) {
    const near = (a, b) => Math.abs(a[0] + b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
    return skel.bones.map((b) => {
        const m = skel.bones.find((o) => near(o.head, b.head) && near(o.tail, b.tail));
        if (!m) throw new Error(`keys: ${b.name} has no mirror bone`);
        return m.index;
    });
}

// A pose's spec with its base's under it.
function flatten(poses, name, seen = []) {
    const p = poses[name];
    if (!p) throw new Error(`keys: no pose '${name}'`);
    if (seen.includes(name)) throw new Error(`keys: pose '${name}' is its own base`);
    const b = p.base ? flatten(poses, p.base, [...seen, name]) : { root: [0, 0, 0], turn: [0, 0, 0], bones: {}, feet: {} };
    const feet = { ...b.feet };
    for (const [k, v] of Object.entries(p.feet || {})) feet[k] = { ...(b.feet[k] || {}), ...v };
    return { root: p.root || b.root, turn: p.turn || b.turn, bones: { ...b.bones, ...(p.bones || {}) }, feet };
}

export function resolveKeys(skel, keys) {
    const legs = skel.parts.legs;
    for (const l of legs) {
        const c = l.chain;
        if (c.length !== 4 || c.some((b, i) => b !== c[0] + i)) throw new Error('keys: a leg must be four bones in a row (thigh, shin, foot, toe)');
    }
    const mir = mirrorMap(skel);
    const legMir = legs.map((l) => legs.findIndex((o) => o.top === mir[l.top]));
    const inLeg = new Set(legs.flatMap((l) => l.chain));
    const root = skel.parts.root;
    const names = [], list = [];
    const resolve = (name) => {
        const p = flatten(keys.poses, name);
        const q = skel.bones.map(() => [0, 0, 0, 1]);
        q[root] = qxyz(p.turn);
        for (const [bn, a] of Object.entries(p.bones)) {
            const b = skel.index(bn);
            if (inLeg.has(b)) throw new Error(`keys: pose '${name}' turns ${bn}, a leg's bone (place the foot instead)`);
            if (b === root) throw new Error(`keys: pose '${name}' turns the root by 'bones' (use 'turn')`);
            q[b] = qxyz(a);
        }
        const foot = legs.map(() => [0, 0, 0]), fa = legs.map(() => [0, 0, 0]);
        for (const [fn, v] of Object.entries(p.feet)) {
            const ft = skel.feet.find((x) => x.name === fn);
            if (!ft) throw new Error(`keys: pose '${name}' has no foot '${fn}'`);
            if (v.at) foot[ft.index] = v.at.slice();
            fa[ft.index] = [(v.heel || 0) * DEG, (v.toe || 0) * DEG, (v.yaw || 0) * DEG];
        }
        return { root: p.root.slice(), q, foot, fa };
    };
    const mirrored = (K) => {
        const q = K.q.map(() => null);
        K.q.forEach((v, b) => { q[mir[b]] = [v[0], -v[1], -v[2], v[3]]; });
        const foot = K.foot.map(() => null), fa = K.fa.map(() => null);
        K.foot.forEach((v, l) => { foot[legMir[l]] = [-v[0], v[1], v[2]]; fa[legMir[l]] = [K.fa[l][0], K.fa[l][1], -K.fa[l][2]]; });
        return { root: [-K.root[0], K.root[1], K.root[2]], q, foot, fa };
    };
    const index = {};
    for (const name of Object.keys(keys.poses)) { index[name] = list.length; names.push(name); list.push(resolve(name)); }
    const mirrorOf = (name) => {
        const m = name + '~';
        if (index[m] === undefined) { index[m] = list.length; names.push(m); list.push(mirrored(list[index[name]])); }
        return index[m];
    };
    // Cycles.
    const cycles = [];
    for (const [cname, c] of Object.entries(keys.cycles || {})) {
        let ks = c.keys.map(([ph, n]) => ({ ph, key: index[n] ?? (() => { throw new Error(`keys: cycle '${cname}' names no pose '${n}'`); })(), name: n }));
        if (c.mirror) {
            if (ks.some((k) => k.ph >= 0.5)) throw new Error(`keys: cycle '${cname}' is mirrored, so its keys are its first half (phases under 0.5)`);
            ks = [...ks, ...ks.map((k) => ({ ph: 0.5 + k.ph, key: mirrorOf(k.name), name: k.name + '~' }))];
        }
        if (ks[0].ph !== 0) throw new Error(`keys: cycle '${cname}' must begin at phase 0`);
        for (let i = 1; i < ks.length; i++) if (!(ks[i].ph > ks[i - 1].ph && ks[i].ph < 1)) throw new Error(`keys: cycle '${cname}' phases must rise within [0, 1)`);
        // Each leg's stance: the ones named, the mirror leg's half a cycle on.
        const stance = legs.map(() => null);
        for (const [fn, st] of Object.entries(c.stance || {})) stance[skel.feet.find((x) => x.name === fn).index] = st.slice();
        stance.forEach((st, l) => { if (!st && stance[legMir[l]]) stance[l] = stance[legMir[l]].map((x) => (x + 0.5) % 1); });
        stance.forEach((st, l) => { if (!st) throw new Error(`keys: cycle '${cname}' gives leg ${l} no stance`); });
        const cyc = { name: cname, keys: ks, stance };
        // The ground a stance foot covers under the body, by the keys.
        const l0 = stance.findIndex((s) => s);
        cyc.span = cycleFoot(list, cyc, l0, stance[l0][0])[2] - cycleFoot(list, cyc, l0, stance[l0][1])[2];
        cycles.push(cyc);
    }
    const nb = skel.count, nl = legs.length, nk = list.length;
    const v3 = (a) => `vec3<f32>(${a.map(f).join(', ')})`, v4 = (a) => `vec4<f32>(${a.map(f).join(', ')})`;
    const arr = (t, xs) => `array<${t}, ${xs.length}> = [${xs.join(', ')}]`;
    let s = 'module creature::keys;\n';
    s += `pub const NKEY: i32 = ${nk};\n`;
    s += `pub const KEY_ROOT: ${arr('vec3<f32>', list.map((K) => v3(K.root)))};\n`;
    s += `pub const KEY_Q: ${arr('vec4<f32>', list.flatMap((K) => K.q.map(v4)))};\n`;
    s += `pub const KEY_FOOT: ${arr('vec3<f32>', list.flatMap((K) => K.foot.map(v3)))};\n`;
    s += `pub const KEY_FA: ${arr('vec3<f32>', list.flatMap((K) => K.fa.map(v3)))};\n`;
    const id = (n) => n.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    names.forEach((n, i) => { if (!n.endsWith('~')) s += `pub const K_${id(n)}: i32 = ${i};\n`; });
    const cy = cycles.length ? cycles : [{ name: null, keys: [{ ph: 0, key: 0 }], stance: legs.map(() => [0, 1]), span: 0 }];
    let at = 0;
    const ats = cy.map((c) => { const a = at; at += c.keys.length; return a; });
    s += `pub const NCYC: i32 = ${cy.length};\n`;
    s += `pub const CYC_N: ${arr('i32', cy.map((c) => c.keys.length))};\n`;
    s += `pub const CYC_AT: ${arr('i32', ats)};\n`;
    s += `pub const CYC_KEY: ${arr('i32', cy.flatMap((c) => c.keys.map((k) => k.key)))};\n`;
    s += `pub const CYC_PH: ${arr('f32', cy.flatMap((c) => c.keys.map((k) => f(k.ph))))};\n`;
    s += `pub const CYC_STANCE: ${arr('vec2<f32>', cy.flatMap((c) => c.stance.map((st) => `vec2<f32>(${f(st[0])}, ${f(st[1])})`)))};\n`;
    s += `pub const CYC_SPAN: ${arr('f32', cy.map((c) => f(c.span)))};\n`;
    cycles.forEach((c, i) => { s += `pub const C_${id(c.name)}: i32 = ${i};\n`; });
    return { module: s, names, index, cycles, count: nk, poses: Object.keys(keys.poses) };
}

// The weights cycle_at (lab/keyed.bk) gives a cycle's keys at `phase`.
function cycleWeights(cyc, phase) {
    const ks = cyc.keys, n = ks.length, ph = phase - Math.floor(phase);
    let i = n - 1;
    for (let k = 0; k + 1 < n; k++) if (ph >= ks[k].ph && ph < ks[k + 1].ph) i = k;
    const im = (i + n - 1) % n, ip = (i + 1) % n, iq = (i + 2) % n;
    const p1 = ks[i].ph, p0 = ks[im].ph - (im >= i ? 1 : 0), p2 = ks[ip].ph + (ip <= i ? 1 : 0);
    let p3 = ks[iq].ph;
    if (p3 <= p2) p3 += 1;
    const h = Math.max(p2 - p1, 1e-5), t = Math.max(0, Math.min(1, (ph - p1) / h)), t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const a = h10 * h / Math.max(p2 - p0, 1e-5), b = h11 * h / Math.max(p3 - p1, 1e-5);
    return [[ks[im].key, -a], [ks[i].key, h00 - b], [ks[ip].key, h01 + a], [ks[iq].key, b]];
}

function cycleFoot(list, cyc, leg, phase) {
    const out = [0, 0, 0];
    for (const [k, w] of cycleWeights(cyc, phase)) for (let i = 0; i < 3; i++) out[i] += w * list[k].foot[leg][i];
    return out;
}

// --- the model sheet -----------------------------------------------------------

const MODEL_SRC = `
import creature::common::*;
import creature::skeleton::*;
import creature::pose::*;
import creature::keyed::*;
@kernel @grid(1)
fn k_model(g: grid<1>, sel: read_store<f32, 1>, pose: write_store<vec4<f32>, 1>) {
    let c = g.x();
    let cyc = sel[2 * c] as i32;
    var K: Key;
    if (cyc < 0) { K = key_get(sel[2 * c + 1] as i32); } else { K = cycle_at(cyc, sel[2 * c + 1]); }
    put(pose, c, key_pose(K, vec3<f32>(0.0), q_id()));
}`;

// The poses the keys alone give: `sel` a list of [cycle index or -1, key
// index or phase]; one Float32Array pose each.
export function keyPoses(creature, sel) {
    if (!creature.keys) throw new Error(`${creature.name} has no keys (its creature.js names none)`);
    if (!creature.modelKernel) creature.modelKernel = bro.kernel.compile(MODEL_SRC, { file: 'model.bk', modules: creature.modules }).kernel('k_model');
    const n = sel.length, stride = creature.skel.count * ROWS;
    const selBuf = bro.kernel.createBuffer(new Float32Array(sel.flat()));
    const poseBuf = bro.kernel.createBuffer(n * stride * 4);
    creature.modelKernel.dispatch(n, selBuf, poseBuf);
    const all = poseBuf.read(new Float32Array(n * stride));
    selBuf.destroy(); poseBuf.destroy();
    return sel.map((_, i) => all.slice(i * stride, (i + 1) * stride));
}

// Where a pose's centre of mass stands against its feet: along the body,
// from the rearmost ball on the ground to the foremost toe tip, and across
// it, between the outermost feet (cm past the span's ends; 0 within it).
export function balanceOf(skel, P) {
    const com = centreOfMass(P, 0, skel);
    let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity, down = 0;
    for (const ft of skel.feet) {
        const toe = skel.bones[ft.boneIndex];
        const ball = boneHead(P, 0, toe.index), tip = boneTail(P, 0, toe);
        if (Math.min(ball[1], tip[1]) > 0.03) continue;
        down++;
        z0 = Math.min(z0, ball[2], tip[2]); z1 = Math.max(z1, ball[2], tip[2]);
        x0 = Math.min(x0, ball[0], tip[0]); x1 = Math.max(x1, ball[0], tip[0]);
    }
    if (!down) return { com, down, fore: 0, side: 0, text: 'in the air' };
    const past = (v, lo, hi) => (v < lo ? v - lo : v > hi ? v - hi : 0);
    const fore = past(com[2], z0, z1), side = past(com[0], x0 - 0.03, x1 + 0.03);
    const cm = (v) => `${(100 * Math.abs(v)).toFixed(1)} cm`;
    const parts = [];
    if (fore) parts.push(`${cm(fore)} ${fore > 0 ? 'ahead of' : 'behind'} its feet`);
    if (side) parts.push(`${cm(side)} to the ${side > 0 ? 'left' : 'right'} of them`);
    return { com, down, fore, side, text: parts.length ? `centre of mass ${parts.join(', ')}` : `balanced (${down} ${down > 1 ? 'feet' : 'foot'} down)` };
}

const VIEWS = [
    { name: 'front-left', yaw: 40, pitch: 10 },
    { name: 'left', yaw: 90, pitch: 4 },
    { name: 'front', yaw: 0, pitch: 6 },
    { name: 'back-left', yaw: 140, pitch: 12 },
];

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
}

// The model sheet: every pose (a row: four views, its balance under its
// name) and every cycle (its phases from the side and from the front), as
// the keys have them. `poses` / `cycles`: only those; `frames`: phases a
// cycle is drawn at.
export function modelSheet(creature, { path, poses = null, cycles = null, cell = 1, frames = 8, dist = 2.1 } = {}) {
    const t0 = Date.now();
    const K = creature.keys;
    const pn = (poses || K.poses).filter((n) => K.index[n] !== undefined);
    const cy = K.cycles.map((c, i) => ({ ...c, i })).filter((c) => !cycles || cycles.includes(c.name));
    const sel = [...pn.map((n) => [-1, K.index[n]]), ...cy.flatMap((c) => Array.from({ length: frames }, (_, k) => [c.i, k / frames]))];
    const P = keyPoses(creature, sel);
    const ext = restExtent(creature.skel);
    const target = [0, ext.top * 0.48, ext.mid * 0.35];
    const d = Math.max(ext.len * 0.8, ext.top) * dist;
    const cw = Math.round(400 * cell), ch = Math.round(430 * cell);
    const LM = 150, TM = 84, GAP = 6;
    const cyW = Math.round(cw * 0.5), cyH = Math.round(ch * 0.5);
    const W = Math.max(LM + VIEWS.length * (cw + GAP), 20 + frames * (cyW + GAP)) + 10;
    const H = TM + pn.length * (ch + GAP) + cy.length * (2 * (cyH + GAP) + 44) + 10;
    showGround(true);
    const shot = (pose, v, w, h) => { setPose(creature, pose); return capture(orbitView(target, v.yaw, v.pitch, d, 30), w, h); };
    const poseShots = pn.map((_, r) => VIEWS.map((v) => shot(P[r], v, cw, ch)));
    const cycShots = cy.map((c, ci) => [VIEWS[1], VIEWS[2]].map((v) => Array.from({ length: frames }, (_, k) => shot(P[pn.length + ci * frames + k], v, cyW, cyH))));
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · model`, 12, 30, { size: 22, weight: 700 });
    text(g, `its poses and cycles as the keys have them (no rig); the live view's light, ${d.toFixed(2)} m out`, 12, 52, { size: 14, color: DIM });
    VIEWS.forEach((v, c) => text(g, v.name, LM + c * (cw + GAP) + cw / 2, TM - 6, { size: 14, weight: 650, align: 'center' }));
    const flags = [];
    pn.forEach((n, r) => {
        const y = TM + r * (ch + GAP);
        text(g, n, 10, y + 22, { size: 15, weight: 700 });
        const bal = balanceOf(creature.skel, P[r]);
        const words = bal.text.split(' ');
        let line = '', ly = y + 42;
        for (const w of words) {
            if ((line + ' ' + w).length > 20) { text(g, line, 10, ly, { size: 12, color: bal.fore || bal.side ? '#b03a2e' : DIM }); ly += 15; line = w; } else line = line ? line + ' ' + w : w;
        }
        text(g, line, 10, ly, { size: 12, color: bal.fore || bal.side ? '#b03a2e' : DIM });
        if (bal.fore || bal.side) flags.push(`${n}: ${bal.text}`);
        poseShots[r].forEach((img, c) => g.drawImage(toCanvas(img), LM + c * (cw + GAP), y));
    });
    let y = TM + pn.length * (ch + GAP);
    cy.forEach((c, ci) => {
        text(g, `${c.name}: ${c.keys.map((k) => `${k.name} ${k.ph.toFixed(2)}`).join(' · ')}`, 12, y + 20, { size: 14, weight: 700 });
        text(g, `stance ${c.stance.map((s, l) => `${creature.skel.feet[l].name} ${s[0].toFixed(2)}-${s[1].toFixed(2)}`).join(', ')}; a stance covers ${(100 * c.span).toFixed(0)} cm`, 12, y + 38, { size: 12, color: DIM });
        y += 44;
        cycShots[ci].forEach((row) => {
            row.forEach((img, k) => {
                g.drawImage(toCanvas(img), 10 + k * (cyW + GAP), y);
                text(g, (k / frames).toFixed(2), 14 + k * (cyW + GAP), y + 14, { size: 11, color: DIM });
            });
            y += cyH + GAP;
        });
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0, flags };
}
