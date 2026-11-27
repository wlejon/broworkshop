// lib/foundry/operate.js — what an operator has of a compiled design: its controls,
// their deck, its solids, and its kinematics. site.js runs it in a physical world.
//
//   controlsOf  one control per independent drive the design gives out: the
//               power lines (or the battery inside) behind a joint, or a source
//               behind an exposed output. Every joint and stage a drive moves is
//               moved by its control and nothing else, at the ratio and sense the
//               chain fixes: a pinion's drives on a ring are one control, an arm
//               segment's joint deep in a chain is reached only through the line
//               its design exposes, and nothing inside can be told to turn
//               against what drives it. With them, the deck's layout: a tree
//               shaped like the machine, a control under the one whose joint
//               carries its joint, siblings side by side.
//   solidsOf    every solid of the design, down through nested designs, and the
//               joint that carries it: what site.js makes bodies of.
//   poseOf      forward kinematics: where every joint's load is at given angles,
//               for working out the angles that put the tip somewhere.
//
// Poses are worked in the design's frame; `standOf` turns it into the world's
// (up +Y), as the view stands it.

import { rotApply } from "./rot.js";

const KEYS = [['q', 'a'], ['w', 's'], ['e', 'd'], ['r', 'f'], ['t', 'g'], ['y', 'h'], ['u', 'j'], ['i', 'k'], ['o', 'l']];

// --- small rotation helpers (quaternions [x, y, z, w]) ---------------------------
export const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export function qRot(q, v) {
    const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
}
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qAxis = (a, t) => { const s = Math.sin(t / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(t / 2)]; };
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** A rigid transform { q, t }: x → q·x + t. */
export const IDENT = { q: [0, 0, 0, 1], t: [0, 0, 0] };
export const frameApply = (m, x) => (m ? add(qRot(m.q, x), m.t) : x);
export const frameMul = (a, b) => ({ q: qMul(a.q, b.q), t: add(qRot(a.q, b.t), a.t) });
export const frameInv = (a) => { const q = qConj(a.q); return { q, t: scale(qRot(q, a.t), -1) }; };

// The rotation taking +z to a principal axis (a unit vector along x, y or z).
function quatZTo(a) {
    const s = Math.SQRT1_2, i = [0, 1, 2].reduce((m, k) => (Math.abs(a[k]) > Math.abs(a[m]) ? k : m), 0), neg = a[i] < 0;
    return [[neg ? [0, -s, 0, s] : [0, s, 0, s]], [neg ? [s, 0, 0, s] : [-s, 0, 0, s]], [neg ? [0, 1, 0, 0] : [0, 0, 0, 1]]][i][0];
}

/** Which way contract `c` stands on the ground: against its base when it carries a turntable, down through its frame when it is on wheels; else null. */
function downOf(c) {
    if (c.vehicle) return c.vehicle.down;
    const base = c.base && c.joints.some((J) => J.upright) && c.ports.find((p) => p.id === c.base);
    return base ? base.axis : null;
}

/** Which way is up in contract `c`'s frame: against what it stands on, else +Y. */
export function upOf(c) {
    const d = downOf(c);
    return d ? d.map((v) => -v) : [0, 1, 0];
}

/** The rotation standing contract `c` in the world: its up to +Y (none when its up is +Y). */
export function standOf(c) {
    const d = downOf(c);
    return d ? qMul(quatZTo([0, -1, 0]), qConj(quatZTo(d))) : [0, 0, 0, 1];
}

/**
 * Every solid of contract `c`, down through nested designs, as a box in `c`'s
 * frame ({ center, axes (three half-extent vectors), m }), carried by the joint
 * of `c` that carries it (a nested design's own joints are joints of `c` too).
 */
export function solidsOf(c) {
    const out = [];
    for (const ch of c.children) {
        const place = (x) => add(rotApply(ch.rot, x), ch.pos);
        const turn = (v) => rotApply(ch.rot, v);
        if (ch.el.kind !== 'contract') {
            const shapes = ch.el.shapes && ch.el.shapes.length ? ch.el.shapes : [ch.el.box];
            const vol = shapes.map((s) => [0, 1, 2].reduce((p, i) => p * Math.max(1e-6, s.max[i] - s.min[i]), 1));
            const total = vol.reduce((a, b) => a + b, 0);
            shapes.forEach((s, k) => {
                const half = [0, 1, 2].map((i) => Math.max(5e-4, (s.max[i] - s.min[i]) / 2));
                out.push({
                    center: place([0, 1, 2].map((i) => (s.max[i] + s.min[i]) / 2)),
                    axes: [[half[0], 0, 0], [0, half[1], 0], [0, 0, half[2]]].map(turn),
                    m: ch.el.massKg * vol[k] / total, carrier: ch.carrier,
                });
            });
            continue;
        }
        const top = new Map();
        c.joints.forEach((J, k) => { if (J.nested && J.nested.child === ch.id) top.set(J.nested.index, k); });
        for (const b of solidsOf(ch.el)) {
            out.push({ center: place(b.center), axes: b.axes.map(turn), m: b.m, carrier: b.carrier != null && top.has(b.carrier) ? top.get(b.carrier) : ch.carrier });
        }
    }
    return out;
}

/** The eight corners of a solid. */
export const cornersOf = (b) => {
    const out = [];
    for (let k = 0; k < 8; k++) out.push([0, 1, 2].reduce((p, i) => add(p, scale(b.axes[i], (k >> i) & 1 ? 1 : -1)), b.center));
    return out;
};

/** A box's rotation from its axes (each a principal direction, the compiler's placements being quarter turns). */
export function boxRotation(axes) {
    const u = axes.map(unit);
    const m00 = u[0][0], m11 = u[1][1], m22 = u[2][2], tr = m00 + m11 + m22;
    // Columns are the box's x, y, z in the frame.
    const m = (r, col) => u[col][r];
    let x, y, z, w;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m(2, 1) - m(1, 2)) / s; y = (m(0, 2) - m(2, 0)) / s; z = (m(1, 0) - m(0, 1)) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m(2, 1) - m(1, 2)) / s; x = s / 4; y = (m(0, 1) + m(1, 0)) / s; z = (m(0, 2) + m(2, 0)) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m(0, 2) - m(2, 0)) / s; x = (m(0, 1) + m(1, 0)) / s; y = s / 4; z = (m(1, 2) + m(2, 1)) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m(1, 0) - m(0, 1)) / s; x = (m(0, 2) + m(2, 0)) / s; y = (m(1, 2) + m(2, 1)) / s; z = s / 4; }
    return [x, y, z, w];
}

/**
 * Where port `at` ('child.port') of contract `c` is at rest, in `c`'s frame,
 * and the joint of `c` that carries it, followed down through nested designs
 * to the part it is on: { pos, carrier }.
 */
export function locate(c, at) {
    const k = at.lastIndexOf('.'), ch = c.children.find((x) => x.id === at.slice(0, k));
    if (!ch) return null;
    const p = ch.el.ports.find((x) => x.id === at.slice(k + 1));
    if (!p) return null;
    const place = (x) => add(rotApply(ch.rot, x), ch.pos);
    if (ch.el.kind === 'contract' && p.at) {
        const inner = locate(ch.el, p.at);
        if (inner) {
            let carrier = ch.carrier;
            c.joints.forEach((J, i) => { if (J.nested && J.nested.child === ch.id && J.nested.index === inner.carrier) carrier = i; });
            return { pos: place(inner.pos), carrier };
        }
    }
    return { pos: place(p.pos), carrier: ch.carrier };
}

/** The part port `at` ('child.port') of contract `c` is on, followed down through nested designs. */
export function partAt(c, at) {
    const k = at.lastIndexOf('.'), ch = c.children.find((x) => x.id === at.slice(0, k));
    if (!ch) return null;
    if (ch.el.kind !== 'contract') return ch.el;
    const p = ch.el.ports.find((x) => x.id === at.slice(k + 1));
    return p && p.at ? partAt(ch.el, p.at) : null;
}

/** Where contract `c`'s tip (its first mount output) is at rest, and the joint that carries it, or null. */
export function tipOf(c) {
    const mt = c.mounts && c.mounts[0];
    const p = mt && c.ports.find((x) => x.id === mt.port);
    return p ? locate(c, p.at) : null;
}

/**
 * Forward kinematics of contract `c` at joint angles `ang`: per joint the
 * rigid move ({ q, t }, `c`'s frame) of what it carries from where it was
 * built, parents before children.
 */
export function poseOf(c, ang) {
    const M = [];
    for (let j = 0; j < c.joints.length; j++) {
        const J = c.joints[j];
        const P = J.parent != null ? M[J.parent] : IDENT;
        if (!J.pin || !J.axis) { M.push(P); continue; }
        const r = qAxis(unit(J.axis), ang[j] || 0);
        // About the pin: x → r(x − pin) + pin, then the parent's.
        M.push(frameMul(P, { q: r, t: sub(J.pin, qRot(r, J.pin)) }));
    }
    return M;
}

/** The controls an operator has for contract `c`, and the deck's layout of them. */
export function controlsOf(c) {
    const up = upOf(c);
    const joints = c.joints.map((J, j) => {
        const axis = J.axis ? unit(J.axis) : [0, 0, 1];
        // Raising turns the load upward: + when the axis crossed with the way it hangs points up.
        const raise = J.dir ? (dot(cross(axis, J.dir), up) >= 0 ? 1 : -1) : 1;
        const free = J.speed != null && isFinite(J.speed) && J.speed > 0 ? J.speed : 0.5;
        const out = {
            j, label: J.label, child: J.child, axis, raise, upright: !!J.upright,
            speed: free, stall: J.stall != null ? J.stall : J.cont, cont: J.cont, lock: J.lock, bend: J.bend,
        };
        // What its controller lets the drive put out: its stall, up to nine tenths of what its boom bears.
        out.limit = Math.min(out.stall, J.bend > 0 && isFinite(J.bend) ? J.bend * 0.9 : Infinity);
        return out;
    });
    // Wheels: which side each is on, and which way it spins to roll the machine forward
    // (the chassis's +x): a wheel turning about `a` rolls along a × up.
    const V = c.vehicle;
    if (V) for (const w of V.wheels) {
        const J = c.joints[w], o = joints[w], fwd = V.bed.axes[0], right = V.bed.axes[1];
        o.wheel = J.wheel;
        o.side = dot(sub(J.pin, V.bed.center), right) >= 0 ? 1 : -1;
        o.roll = dot(cross(o.axis, up), fwd) >= 0 ? 1 : -1;
    }
    const byKey = new Map();
    joints.forEach((_, j) => {
        const J = c.joints[j];
        if (J.wheel) return;
        const lines = (J.powers || []).map((p) => p.port).sort();
        const key = lines.length ? `lines:${lines.join(',')}` : `joint:${j}`;
        if (!byKey.has(key)) byKey.set(key, { key, joints: [], lines, dark: false });
        const k = byKey.get(key);
        k.joints.push(j);
        if (!(J.cont > 0)) k.dark = true;
    });
    const portLabel = (id) => (c.ports.find((p) => p.id === id) || {}).label || id;
    const controls = [...byKey.values()].map((k, i) => {
        const J0 = joints[k.joints[0]];
        const names = [...new Set(k.lines.map((l) => portLabel(l).replace(/ \(\w+\)$/, '')))];
        const what = J0.label.split(' › ')[0].replace(/ \(\w+\)$/, '');
        return {
            id: `c${i}`, kind: J0.upright ? 'dial' : 'lever', joints: k.joints,
            label: J0.upright ? 'Slew' : `${names.length === 1 && !/^Power/.test(names[0]) ? names[0].replace(/ power$/i, '') : what}${k.joints.length > 1 ? ` ×${k.joints.length}` : ''}`,
            lines: k.lines.map(portLabel), dark: k.dark,
            why: k.dark ? 'no power reaches its drive' : k.lines.length ? `${k.lines.length} power line${k.lines.length > 1 ? 's' : ''}` : 'its own battery',
            u: 0,
        };
    });
    // Outputs driven by a source the design holds: run them at a throttle. A winch's line is
    // a hoist, held to take in or pay out like a lever, and moves with what carries the winch.
    for (const s of c.sources) {
        const p = c.ports.find((x) => x.id === s.port);
        if (!p || p.domain === 'mnt') continue;
        const el = partAt(c, p.at), winch = el && el.winch ? el.winch : null;
        const at = winch ? locate(c, p.at) : null;
        controls.push({
            id: `c${controls.length}`, kind: winch ? 'lever' : p.domain === 'lin' ? 'slider' : 'throttle', output: s.port, joints: [],
            label: p.label, lines: s.draw ? [portLabel(s.draw.port)] : [], dark: !!s.unpowered, why: s.unpowered ? 'no power reaches it' : 'runs its output',
            u: 0, noLoad: s.noLoad, stall: s.stall, domain: p.domain, winch, carrier: at ? at.carrier : null,
        });
    }
    controls.forEach((ct, i) => { ct.keys = KEYS[i] || null; });
    // A machine on wheels drives on the arrow keys: up and down run it forward and back,
    // left and right turn it by running one side faster than the other.
    if (V && V.wheels.length) {
        const dark = V.wheels.every((w) => !(c.joints[w].cont > 0));
        controls.push({
            id: `c${controls.length}`, kind: 'drive', joints: V.wheels.slice(), label: 'Drive', lines: [], dark,
            why: dark ? 'no power reaches its wheels' : `${V.wheels.length} wheels`, u: 0, v: 0,
            keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'], speed: V.speed,
        });
    }
    const ctrlOfJoint = new Map();
    for (const ct of controls) for (const j of ct.joints) ctrlOfJoint.set(j, ct);
    const nodes = new Map(controls.map((ct) => [ct.id, { control: ct, kids: [] }]));
    const roots = [];
    for (const ct of controls) {
        let parent = null;
        if (ct.joints.length) {
            // Up the carriers until a joint with another control.
            let p = c.joints[ct.joints[0]].parent;
            while (p != null && ctrlOfJoint.get(p) === ct) p = c.joints[p].parent;
            parent = p != null ? ctrlOfJoint.get(p) : null;
        } else if (ct.carrier != null) {
            let p = ct.carrier;
            while (p != null && !ctrlOfJoint.get(p)) p = c.joints[p].parent;
            parent = p != null ? ctrlOfJoint.get(p) : null;
        }
        (parent ? nodes.get(parent.id).kids : roots).push(nodes.get(ct.id));
    }
    return { up, joints, controls, layout: { kids: roots }, ctrlOfJoint };
}
