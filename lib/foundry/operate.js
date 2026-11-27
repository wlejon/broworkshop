// lib/foundry/operate.js — a compiled design run as a machine.
//
// machineOf(contract) turns a contract into what an operator has in hand:
//
//   controls   one per independent drive the design gives out: the power
//              lines (or the battery inside) behind a joint, or a source
//              behind an exposed output. Every joint and stage a drive moves
//              is moved by its control and nothing else, at the ratio and
//              sense the chain fixes: a pinion's drives on a ring are one
//              control, an arm segment's joint deep in a chain is reached only
//              through the line its design exposes, and nothing inside can be
//              told to turn against what drives it.
//   layout     the controls as a tree shaped like the machine: a control
//              under the one whose joint carries its joint, siblings side by
//              side, so the deck of a crane is a dial over a lever and the deck
//              of a two-armed thing has two columns.
//   step(dt)   moves the joints: each turns at its command times its drive's
//              free speed, slowed by the torque gravity (and the load on the
//              tip) puts on it in the pose it is in, stalled when that is more
//              than the drive's stall torque, held when stopped if the drive
//              holds it (powered, or self-locking with the power off), and
//              falling back otherwise.
//
// Poses are worked in the design's frame: `up` is the way the view stands
// it (against the base when it carries a turntable, else +Y).

import { rotApply } from "./rot.js";

const G = 9.81;
const KEYS = [['q', 'a'], ['w', 's'], ['e', 'd'], ['r', 'f'], ['t', 'g'], ['y', 'h'], ['u', 'j'], ['i', 'k'], ['o', 'l']];

// --- small rotation helpers (quaternions [x, y, z, w]) ---------------------------
const qAxis = (a, t) => { const s = Math.sin(t / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(t / 2)]; };
const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export function qRot(q, v) {
    const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
}
export { qMul };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

/** Which way is up in contract `c`'s frame: as the view stands it. */
export function upOf(c) {
    const base = c.base && c.joints.some((J) => J.upright) && c.ports.find((p) => p.id === c.base);
    return base ? base.axis.map((v) => -v) : [0, 1, 0];
}

/**
 * Forward kinematics of contract `c`'s joints at angles `ang`: per joint the
 * rotation and translation taking a point at rest to where it is now
 * ({ q, t }: x' = q·x + t), parents before children.
 */
export function poseOf(c, ang) {
    const M = [];
    for (let j = 0; j < c.joints.length; j++) {
        const J = c.joints[j];
        const P = J.parent != null ? M[J.parent] : { q: [0, 0, 0, 1], t: [0, 0, 0] };
        if (!J.pin || !J.axis) { M.push(P); continue; }
        const r = qAxis(unit(J.axis), ang[j] || 0);
        // About the pin: x → r(x − pin) + pin, then the parent's.
        const local = sub(J.pin, qRot(r, J.pin));
        M.push({ q: qMul(P.q, r), t: add(qRot(P.q, local), P.t) });
    }
    return M;
}

const apply = (m, x) => (m ? add(qRot(m.q, x), m.t) : x);

/**
 * Every part of contract `c`, down through nested designs, as a mass at its
 * centre in `c`'s frame, carried by the joint of `c` that carries it (a
 * nested design's own joints are joints of `c` too), so gravity's torque on
 * each joint is worked from where everything outboard of it actually is.
 */
export function massesOf(c) {
    const out = [];
    for (const ch of c.children) {
        const place = (x) => add(rotApply(ch.rot, x), ch.pos);
        if (ch.el.kind !== 'contract') {
            const b = ch.el.box, corners = [];
            for (let k = 0; k < 8; k++) corners.push(place([0, 1, 2].map((i) => ((k >> i) & 1 ? b.max[i] : b.min[i]))));
            out.push({ m: ch.el.massKg, com: place(ch.el.com || [0, 0, 0]), carrier: ch.carrier, corners });
            continue;
        }
        // A nested design's joint i is the joint of `c` that records it.
        const top = new Map();
        c.joints.forEach((J, k) => { if (J.nested && J.nested.child === ch.id) top.set(J.nested.index, k); });
        for (const b of massesOf(ch.el)) out.push({ m: b.m, com: place(b.com), corners: b.corners.map(place), carrier: b.carrier != null && top.has(b.carrier) ? top.get(b.carrier) : ch.carrier });
    }
    return out;
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

/** The machine an operator runs from contract `c`. */
export function machineOf(c) {
    const up = upOf(c);
    const joints = c.joints.map((J, j) => {
        const axis = J.axis ? unit(J.axis) : [0, 0, 1];
        // Raising turns the load upward: + when the axis crossed with the way it hangs points up.
        const raise = J.dir ? (dot(cross(axis, J.dir), up) >= 0 ? 1 : -1) : 1;
        const free = J.speed != null && isFinite(J.speed) ? J.speed : 0.5;
        return {
            j, label: J.label, child: J.child, axis, raise, upright: !!J.upright,
            speed: free, stall: J.stall != null ? J.stall : J.cont, cont: J.cont, lock: J.lock, bend: J.bend,
            // Swung round level it turns all the way; lifted, it stops short of folding onto itself.
            range: J.upright ? [-Infinity, Infinity] : [-1.75, 1.75],
        };
    });
    // --- controls: one per independent drive -------------------------------------
    const byKey = new Map();
    joints.forEach((M, j) => {
        const J = c.joints[j];
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
            label: J0.upright ? "Slew" : `${names.length === 1 && !/^Power/.test(names[0]) ? names[0].replace(/ power$/i, '') : what}${k.joints.length > 1 ? ` ×${k.joints.length}` : ''}`,
            lines: k.lines.map(portLabel), dark: k.dark,
            why: k.dark ? 'no power reaches its drive' : k.lines.length ? `${k.lines.length} power line${k.lines.length > 1 ? 's' : ''}` : 'its own battery',
            u: 0,
        };
    });
    // Outputs driven by a source the design holds: run them at a throttle.
    for (const s of c.sources) {
        const p = c.ports.find((x) => x.id === s.port);
        if (!p || p.domain === 'mnt') continue;
        controls.push({ id: `c${controls.length}`, kind: p.domain === 'lin' ? 'slider' : 'throttle', output: s.port, joints: [], label: p.label, lines: s.draw ? [portLabel(s.draw.port)] : [], dark: !!s.unpowered, why: s.unpowered ? 'no power reaches it' : 'runs its output', u: 0, noLoad: s.noLoad, domain: p.domain });
    }
    controls.forEach((ct, i) => { ct.keys = KEYS[i] || null; });
    // --- layout: shaped like the machine ---------------------------------------------
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
        }
        (parent ? nodes.get(parent.id).kids : roots).push(nodes.get(ct.id));
    }
    const layout = { kids: roots };

    // --- state and motion ---------------------------------------------------------------
    const ang = new Float64Array(joints.length);
    const rate = new Float64Array(joints.length);
    const status = joints.map(() => 'still');
    const torque = new Float64Array(joints.length);
    const tipMount = c.mounts && c.mounts[0];
    const tipPort = tipMount && c.ports.find((p) => p.id === tipMount.port);
    const tipAt = tipPort ? locate(c, tipPort.at) : null;
    // Every child's mass at its centre, carried by its carrier.
    const masses = massesOf(c);
    const chainOf = (j) => { const s = new Set(); while (j != null) { s.add(j); j = c.joints[j].parent; } return s; };
    const carries = joints.map((_, j) => masses.filter((b) => b.carrier != null && chainOf(b.carrier).has(j)));
    const tipChain = tipAt ? chainOf(tipAt.carrier) : new Set();
    // The ground: under the lowest corner of the machine as it was built. Nothing a joint
    // carries goes below it; the joint stops there instead.
    const height = (p) => dot(p, up);
    const ground = Math.min(...masses.flatMap((b) => b.corners.map(height))) - 1e-3;
    const lowest = (j, M) => {
        let lo = Infinity;
        for (const b of carries[j]) { const T = M[b.carrier]; for (const p of b.corners) lo = Math.min(lo, height(apply(T, p))); }
        return lo;
    };

    const m = {
        contract: c, joints, controls, layout, up, angles: ang, rates: rate, status, torque,
        payloadKg: 0, powered: true, timeScale: 1,
        /** Where the tip is now (its mount output), or null. */
        tip() { if (!tipAt) return null; const M = poseOf(c, ang); return apply(tipAt.carrier != null ? M[tipAt.carrier] : null, tipAt.pos); },
        /** The pose: per joint { q, t } (see poseOf). */
        pose() { return poseOf(c, ang); },
        set(id, u) { const ct = controls.find((x) => x.id === id); if (ct) ct.u = Math.max(-1, Math.min(1, u)); },
        /** Advance by `dt` seconds of machine time. */
        step(dt) {
            dt *= m.timeScale;
            const M = poseOf(c, ang);
            const tip = m.tip();
            for (let j = 0; j < joints.length; j++) {
                const J = joints[j], CJ = c.joints[j];
                const P = CJ.parent != null ? M[CJ.parent] : null;
                const pin = apply(P, CJ.pin || [0, 0, 0]), axis = P ? qRot(P.q, J.axis) : J.axis;
                // Gravity's torque about the axis, positive turning the joint +.
                let tg = 0;
                const about = (x, kg) => { tg += dot(axis, cross(sub(x, pin), up.map((v) => -v * kg * G))); };
                for (const b of carries[j]) about(apply(M[b.carrier], b.com), b.m);
                if (tip && tipChain.has(j) && m.payloadKg > 0) about(tip, m.payloadKg);
                torque[j] = tg;
                const ct = ctrlOfJoint.get(j);
                const u = ct && !ct.dark && m.powered ? ct.u * J.raise : 0;
                const w0 = J.speed, stall = m.powered && !(ct && ct.dark) ? J.stall : 0;
                // Stopped, it holds what its drive stalls at while powered, and whatever a
                // self-locking stage (a worm, a lead screw) holds by itself, powered or not.
                const hold = Math.max(m.powered && !(ct && ct.dark) ? J.stall : 0, J.lock ?? 0);
                let w;
                const g = Math.abs(tg);
                if (u !== 0) {
                    const against = Math.sign(u) !== Math.sign(tg) && g > 0;
                    if (!against) { w = u * w0; status[j] = 'moving'; }
                    else if (g < stall) { w = u * w0 * (1 - g / stall); status[j] = g > stall * 0.85 ? 'straining' : 'moving'; }
                    else { w = g > hold ? Math.sign(tg) * w0 * Math.min(1, (g - hold) / Math.max(g, 1e-9)) : 0; status[j] = 'stalled'; }
                } else if (g <= hold) { w = 0; status[j] = m.powered && !(ct && ct.dark) ? 'holding' : 'locked'; }
                else { w = Math.sign(tg) * w0 * Math.min(1, (g - hold) / Math.max(g, 1e-9)); status[j] = 'falling'; }
                if (J.bend != null && g > J.bend) status[j] = 'overloaded';
                let a = ang[j] + w * dt;
                if (a < J.range[0]) { a = J.range[0]; w = 0; } else if (a > J.range[1]) { a = J.range[1]; w = 0; }
                if (w === 0 && status[j] === 'moving') status[j] = 'at its stop';
                if (w !== 0 && !J.upright) {
                    // Into the ground: only if it is not going lower than it already is.
                    const was = ang[j];
                    ang[j] = a;
                    const now = lowest(j, poseOf(c, ang));
                    if (now < ground) {
                        ang[j] = was;
                        if (now < lowest(j, poseOf(c, ang)) - 1e-6) { a = was; w = 0; status[j] = 'on the ground'; }
                    }
                }
                ang[j] = a; rate[j] = w;
            }
            for (const ct of controls) if (ct.output) ct.flow = m.powered && !ct.dark ? ct.u * ct.noLoad : 0;
        },
        reset() { ang.fill(0); rate.fill(0); for (const ct of controls) ct.u = 0; },
    };
    return m;
}

