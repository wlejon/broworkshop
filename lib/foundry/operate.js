// lib/foundry/operate.js — a compiled design run as a machine, in a physical world.
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
//   world      a bro.dynamics world built from the contract and nothing else.
//              Each set of parts one joint carries (down through nested
//              designs) is one rigid body, its boxes the parts' solids and its
//              mass theirs; the parts on the base are bolted to the ground.
//              Each joint is a hinge at its pin about its axis whose motor is
//              the drive behind it: it turns toward its command times the
//              drive's free speed with what torque the drive has at the speed
//              it is turning (the stall torque falling to nothing at free
//              speed), holds while powered with the stall torque, and holds
//              unpowered with what a self-locking stage locks at. Each joint
//              lets go past its boom's bending strength at the root. The load
//              hangs from the tip on a rope; the yard's crates are bodies too.
//              Nothing here is tuned: every number is the compiler's.
//
// Poses are worked in the design's frame; `standOf` turns it into the world's
// (up +Y), as the view stands it.

import { rotApply } from "./rot.js";

const KEYS = [['q', 'a'], ['w', 's'], ['e', 'd'], ['r', 'f'], ['t', 'g'], ['y', 'h'], ['u', 'j'], ['i', 'k'], ['o', 'l']];
const STEP = 1 / 60;            // the world's step (s)
const SUBSTEPS = 8;
const MAX_STEPS = 40;           // per call of step(): the most a frame catches up
const RANGE = 1.75;             // rad either way a lifting joint turns before its stop
const EASE = 0.3;               // rad before a stop over which a joint's controller slows it to rest
const STEEL = 7850;

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
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** A rigid transform { q, t }: x → q·x + t. */
export const frameApply = (m, x) => (m ? add(qRot(m.q, x), m.t) : x);
export const frameMul = (a, b) => ({ q: qMul(a.q, b.q), t: add(qRot(a.q, b.t), a.t) });
export const frameInv = (a) => { const q = qConj(a.q); return { q, t: scale(qRot(q, a.t), -1) }; };
const IDENT = { q: [0, 0, 0, 1], t: [0, 0, 0] };

// The rotation taking +z to a principal axis (a unit vector along x, y or z).
function quatZTo(a) {
    const s = Math.SQRT1_2, i = [0, 1, 2].reduce((m, k) => (Math.abs(a[k]) > Math.abs(a[m]) ? k : m), 0), neg = a[i] < 0;
    return [[neg ? [0, -s, 0, s] : [0, s, 0, s]], [neg ? [s, 0, 0, s] : [-s, 0, 0, s]], [neg ? [0, 1, 0, 0] : [0, 0, 0, 1]]][i][0];
}

/** Which way is up in contract `c`'s frame: against its base when it carries a turntable, else +Y. */
export function upOf(c) {
    const base = c.base && c.joints.some((J) => J.upright) && c.ports.find((p) => p.id === c.base);
    return base ? base.axis.map((v) => -v) : [0, 1, 0];
}

/** The rotation standing contract `c` in the world: its up to +Y (none when its up is +Y). */
export function standOf(c) {
    const base = c.base && c.joints.some((J) => J.upright) && c.ports.find((p) => p.id === c.base);
    return base ? qMul(quatZTo([0, -1, 0]), qConj(quatZTo(base.axis))) : [0, 0, 0, 1];
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

const cornersOf = (b) => {
    const out = [];
    for (let k = 0; k < 8; k++) out.push([0, 1, 2].reduce((p, i) => add(p, scale(b.axes[i], (k >> i) & 1 ? 1 : -1)), b.center));
    return out;
};

// A box's rotation from its axes (each a principal direction, the compiler's placements being quarter turns).
function boxRotation(axes) {
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
    const byKey = new Map();
    joints.forEach((_, j) => {
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
            label: J0.upright ? 'Slew' : `${names.length === 1 && !/^Power/.test(names[0]) ? names[0].replace(/ power$/i, '') : what}${k.joints.length > 1 ? ` ×${k.joints.length}` : ''}`,
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
    return { up, joints, controls, layout: { kids: roots }, ctrlOfJoint };
}

/** The machine an operator runs from contract `c`: its controls, and the world it moves in. */
export function machineOf(c) {
    const { up, joints, controls, layout, ctrlOfJoint } = controlsOf(c);
    const S = standOf(c), Sf = { q: S, t: [0, 0, 0] };
    const solids = solidsOf(c);
    const height = (p) => qRot(S, p)[1];
    const corners = solids.map(cornersOf);
    const floorY = Math.min(...corners.flat().map(height));
    // How far the machine reaches round its base: the yard is laid out beyond it.
    const xs = corners.flat().map((p) => qRot(S, p));
    const lo = [0, 2].map((i) => Math.min(...xs.map((p) => p[i]))), hi = [0, 2].map((i) => Math.max(...xs.map((p) => p[i])));
    const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 0.5);
    const tipAt = c.mounts && c.mounts[0] ? (() => { const p = c.ports.find((x) => x.id === c.mounts[0].port); return p ? locate(c, p.at) : null; })() : null;

    const ang = new Float64Array(joints.length);
    const rate = new Float64Array(joints.length);
    const status = joints.map(() => 'still');
    const torque = new Float64Array(joints.length);
    const cap = new Float64Array(joints.length);

    let world = null, bodyOf = null, hinge = null, groups = null, props = [], load = null, acc = 0;

    // The body each joint's parts make, and the parts no joint carries: bolted to the ground.
    function build() {
        if (world) world.destroy();
        world = bro.dynamics.createWorld({ gravity: [0, -9.81, 0] });
        world.addBox({ position: [mid[0], floorY - 1, mid[1]], half: [size * 30 + 50, 1, size * 30 + 50], mass: 0, friction: 0.9 });
        groups = new Map();
        for (const b of solids) {
            const key = b.carrier == null ? -1 : b.carrier;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(b);
        }
        bodyOf = new Map();
        for (const [key, list] of groups) {
            const parts = list.map((b) => ({ center: b.center, rotation: boxRotation(b.axes), half: b.axes.map((a) => Math.hypot(...a)), mass: key === -1 ? 0 : Math.max(1e-3, b.m) }));
            bodyOf.set(key, world.addCompound({ position: [0, 0, 0], rotation: S, parts, friction: 0.7 }));
        }
        // A joint with no parts of its own moves with the one that carries it.
        const body = (j) => { while (j != null && !bodyOf.has(j)) j = c.joints[j].parent; return bodyOf.get(j == null ? -1 : j); };
        hinge = joints.map((J, j) => {
            const CJ = c.joints[j];
            if (!CJ.pin || !CJ.axis || !bodyOf.has(j)) return null;
            const a = body(CJ.parent), b = bodyOf.get(j);
            if (a === undefined || a === b) return null;
            const o = {
                kind: 'hinge', a, b, anchor: qRot(S, CJ.pin), axis: qRot(S, unit(CJ.axis)),
                motorSpeed: 0, maxMotor: Math.min(holdOf(J, true), limitOf(J)), enableMotor: true,
            };
            if (!J.upright) { o.lower = -RANGE; o.upper = RANGE; }
            if (J.bend > 0 && isFinite(J.bend)) o.breakTorque = J.bend;
            return world.addJoint(o);
        });
        // Bodies that touch where they were built (and are not joined) do not collide.
        const keys = [...groups.keys()], boxOf = new Map();
        for (const k of keys) {
            const ps = groups.get(k).flatMap(cornersOf);
            boxOf.set(k, [0, 1, 2].map((i) => [Math.min(...ps.map((p) => p[i])), Math.max(...ps.map((p) => p[i]))]));
        }
        const joined = new Set(joints.map((_, j) => { const CJ = c.joints[j]; return hinge[j] != null ? `${CJ.parent == null ? -1 : CJ.parent}:${j}` : null; }));
        for (let x = 0; x < keys.length; x++) for (let y = x + 1; y < keys.length; y++) {
            const A = boxOf.get(keys[x]), B = boxOf.get(keys[y]);
            if (joined.has(`${keys[x]}:${keys[y]}`) || joined.has(`${keys[y]}:${keys[x]}`)) continue;
            if (A.every((r, i) => r[0] <= B[i][1] + 1e-3 && B[i][0] <= r[1] + 1e-3)) world.addJoint({ kind: 'filter', a: bodyOf.get(keys[x]), b: bodyOf.get(keys[y]) });
        }
        // The yard: crates about it, beyond what it reaches, and someone to judge it by.
        props = [];
        const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) * 1.5 + 0.3;
        for (let k = 0; k < 5; k++) {
            const s = Math.max(0.3, size * (0.05 + 0.03 * (k % 3)));
            const a = k * 1.3 + 2.4, r = reach + s + size * 0.15 * k;
            const half = [s / 2, s / 2, s / 2], mass = 500 * s * s * s;
            props.push({ kind: 'crate', half, body: world.addBox({ position: [mid[0] + Math.cos(a) * r, floorY + s / 2, mid[1] + Math.sin(a) * r], half, mass, friction: 0.8 }) });
        }
        props.push({ kind: 'person', radius: 0.2, height: 1.78, body: world.addCapsule({ position: [lo[0] - 0.8, floorY + 0.89, lo[1] - 0.8], radius: 0.2, halfHeight: 0.69, mass: 0 }) });
        load = null;
        if (m.payloadKg > 0) hang(m.payloadKg);
        acc = 0;
        ang.fill(0); rate.fill(0); torque.fill(0);
    }

    // What a joint holds still with: its drive's stall torque while powered, and whatever
    // a self-locking stage (a worm, a lead screw) holds by itself, powered or not.
    function holdOf(J, powered) { return Math.max(powered ? J.stall : 0, J.lock ?? 0); }
    // What the controller lets a joint's drive put out: nine tenths of what its boom bears.
    function limitOf(J) { return J.bend > 0 && isFinite(J.bend) ? J.bend * 0.9 : Infinity; }
    // (J.limit is the same, with the stall torque: what the deck shows a joint can put out.)

    // Where every solid of the machine is now (world boxes as min/max), for keeping clear of it.
    function machineBoxes() {
        const F = m.frames(), out = [];
        for (const b of solids) {
            const T = b.carrier != null ? F[b.carrier] : IDENT;
            const ps = cornersOf(b).map((p) => qRot(S, frameApply(T, p)));
            out.push([0, 1, 2].map((i) => [Math.min(...ps.map((p) => p[i])), Math.max(...ps.map((p) => p[i]))]));
        }
        return out;
    }

    // The load: a steel block on a rope from the tip, as long as the block is wide. It hangs
    // under the tip when there is room; where the tip is down among the machine, it waits on
    // the ground just clear of it, and the rope goes taut as the tip lifts.
    function hang(kg) {
        if (load) { world.removeBody(load.body); load = null; }
        if (!(kg > 0) || !tipAt) return;
        const side = Math.cbrt(kg / STEEL), len = Math.max(0.05, side * 0.8), h = side / 2;
        const tb = bodyOf.get(tipAt.carrier == null ? -1 : tipAt.carrier) ?? bodyOf.get(-1);
        const P = world.pose(tb), at = add(qRot([P[3], P[4], P[5], P[6]], tipAt.pos), [P[0], P[1], P[2]]);
        const boxes = machineBoxes(), gap = Math.max(0.01, side * 0.05);
        const clear = (c) => boxes.every((B) => !(B[0][0] < c[0] + h + gap && c[0] - h - gap < B[0][1] && B[1][0] < c[1] + h + gap && c[1] - h - gap < B[1][1] && B[2][0] < c[2] + h + gap && c[2] - h - gap < B[2][1]));
        let c = [at[0], Math.max(at[1] - len - h, floorY + h + 1e-3), at[2]];
        if (!clear(c)) {
            // Out along the ground, away from the machine's middle, until nothing of it is there.
            const out = unit([at[0] - mid[0], 0, at[2] - mid[1]].map((v, i) => (i === 1 ? 0 : v)).map((v, i, a) => (Math.hypot(a[0], a[2]) < 1e-6 && i === 0 ? 1 : v)));
            c = [at[0], floorY + h + 1e-3, at[2]];
            for (let k = 0; k < 400 && !clear(c); k++) c = add(c, scale(out, Math.max(gap, side * 0.25)));
        }
        const top = [c[0], c[1] + h, c[2]];
        const body = world.addBox({ position: c, half: [h, h, h], mass: kg, friction: 0.8 });
        // A steel wire rope sized for the load (five times its weight to break, at 1770 MPa) stretches
        // as one: EA/L, and pulls without pushing. Hung from the tip it is its own length; waiting on
        // the ground it is a little longer than the way to the tip, slack until the tip lifts.
        const L = Math.max(len, Math.hypot(...sub(at, top)) * 1.02);
        const area = 5 * kg * 9.81 / 1.77e9, k = 1e11 * area / L;
        const rope = world.addJoint({
            kind: 'distance', a: tb, b: body, anchor: at, anchorB: top,
            target: L, lower: 0, upper: L * 1.5, enableSpring: true, hertz: Math.sqrt(k / kg) / (2 * Math.PI), damping: 0.3, maxPush: 0,
        });
        load = { body, rope, side, kg, L };
    }

    const m = {
        contract: c, joints, controls, layout, up, angles: ang, rates: rate, status, torque, cap,
        payloadKg: 0, powered: true, timeScale: 1,
        get world() { return world; },
        /** Per joint, the rigid move of what it carries from where it was built, in the design's frame. */
        frames() {
            return joints.map((_, j) => {
                let k = j;
                while (k != null && !bodyOf.has(k)) k = c.joints[k].parent;
                if (k == null) return IDENT;
                const P = world.pose(bodyOf.get(k));
                return frameMul(frameInv(Sf), { q: [P[3], P[4], P[5], P[6]], t: [P[0], P[1], P[2]] });
            });
        },
        /** Where the tip is now (its mount output) in the design's frame, or null. */
        tip() {
            if (!tipAt) return null;
            const F = m.frames();
            return frameApply(tipAt.carrier != null ? F[tipAt.carrier] : null, tipAt.pos);
        },
        /** The yard's bodies and the load, for drawing: { kind, half|radius, pose } (world). */
        props() {
            const out = props.map((p) => ({ ...p, pose: world.pose(p.body) }));
            if (load) {
                const tb = bodyOf.get(tipAt.carrier == null ? -1 : tipAt.carrier) ?? bodyOf.get(-1);
                const P = world.pose(tb), at = add(qRot([P[3], P[4], P[5], P[6]], tipAt.pos), [P[0], P[1], P[2]]);
                out.push({ kind: 'load', half: [load.side / 2, load.side / 2, load.side / 2], pose: world.pose(load.body), from: at });
            }
            return out;
        },
        floorY,
        set(id, u) { const ct = controls.find((x) => x.id === id); if (ct) ct.u = Math.max(-1, Math.min(1, u)); },
        /** Hang `kg` on the tip (0 for nothing). */
        setPayload(kg) { if (Math.abs(kg - m.payloadKg) < 1e-9) return; m.payloadKg = kg; hang(kg); },
        /** Advance by `dt` seconds of the operator's time. */
        step(dt) {
            acc += dt * m.timeScale;
            let n = 0;
            while (acc >= STEP && n < MAX_STEPS) { drive(); world.step(STEP, SUBSTEPS); acc -= STEP; n++; }
            if (n === MAX_STEPS) acc = 0;
            read();
            for (const ct of controls) if (ct.output) ct.flow = m.powered && !ct.dark ? ct.u * ct.noLoad : 0;
        },
        reset() { for (const ct of controls) ct.u = 0; build(); },
        destroy() { if (world) world.destroy(); world = null; },
    };

    // Each joint's motor from its control: toward the command at what torque the drive has.
    function drive() {
        for (let j = 0; j < joints.length; j++) {
            const h = hinge[j];
            if (h == null || !world.hasJoint(h)) continue;
            const J = joints[j], ct = ctrlOfJoint.get(j);
            const live = m.powered && !(ct && ct.dark);
            const u = live && ct ? ct.u * J.raise : 0;
            let speed = 0, effort;
            if (u !== 0) {
                // A motor's torque falls from stall at rest to nothing at free speed.
                const st = world.jointState(h), w = st.speed * Math.sign(u);
                speed = u * J.speed;
                // Its controller eases it into a stop rather than letting what it carries slam there.
                if (!J.upright) {
                    const left = Math.sign(u) > 0 ? RANGE - st.position : st.position + RANGE;
                    speed *= Math.max(0, Math.min(1, left / EASE));
                }
                effort = Math.max(J.stall * Math.min(1, Math.max(0.05, 1 - w / J.speed)), J.lock ?? 0);
            } else effort = holdOf(J, live);
            // Its controller limits the load moment: a powered drive never asks for more than the
            // boom it turns bears at the root, so a load too heavy is let down and the boom stands.
            if (live) effort = Math.min(effort, limitOf(J));
            cap[j] = effort;
            world.setJointMotor(h, speed, effort, true);
        }
    }

    function read() {
        for (let j = 0; j < joints.length; j++) {
            const h = hinge[j];
            if (h == null) { status[j] = 'still'; continue; }
            if (!world.hasJoint(h)) { status[j] = 'broken'; rate[j] = 0; torque[j] = 0; continue; }
            const s = world.jointState(h), J = joints[j], ct = ctrlOfJoint.get(j);
            ang[j] = s.position; rate[j] = s.speed; torque[j] = s.motorEffort;
            const commanded = ct && !ct.dark && m.powered && ct.u !== 0;
            const working = Math.abs(s.motorEffort) >= cap[j] * 0.98 && cap[j] > 0;
            const slow = Math.abs(s.speed) < J.speed * 0.03;
            const atStop = !J.upright && Math.abs(Math.abs(s.position) - RANGE) < 0.01;
            // Held to what its boom bears and that is not enough: the limit is letting it down.
            const limited = working && cap[j] >= limitOf(J) * 0.999 && (!slow || commanded);
            if (limited && (!commanded || Math.sign(s.speed) !== Math.sign(ct.u * J.raise) || slow)) status[j] = 'at its limit';
            else if (commanded) {
                const wanted = Math.sign(ct.u * J.raise);
                if (atStop && Math.sign(s.position) === wanted) status[j] = 'at its stop';
                else if (Math.sign(s.speed) === -wanted && !slow) status[j] = 'stalled';
                else if (slow && working) status[j] = 'stalled';
                else status[j] = working ? 'straining' : 'moving';
            } else if (!slow) status[j] = 'falling';
            else status[j] = m.powered && !(ct && ct.dark) ? 'holding' : 'locked';
        }
    }

    build();
    return m;
}
