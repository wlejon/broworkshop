// lib/foundry/site.js — a yard in a bro.dynamics world where compiled machines work.
//
// createSite() makes the world: the ground, and whatever is put in it (crates,
// pads to deliver them to, people to judge scale by). addMachine(contract, at)
// stands a machine in it from its contract and nothing else:
//
//   Each set of parts one joint carries (down through nested designs) is one
//   rigid body, its boxes the parts' solids and its mass theirs; the parts on
//   the base are bolted to the ground. Each joint is a hinge at its pin about
//   its axis whose motor is the drive behind it: it turns toward its command
//   times the drive's free speed with what torque the drive has at the speed it
//   is turning (the stall torque falling to nothing at free speed), holds while
//   powered with the stall torque, and holds unpowered with what a self-locking
//   stage locks at. A controller limits each drive to nine tenths of what its
//   boom bears at the root and eases joints into their stops; past the boom's
//   bending strength a joint lets go. Nothing here is tuned: every number is
//   the compiler's.
//
// A machine whose design carries a winch at its tip has a hook on its line. The hook takes the
// piece it is let down onto (by its lifting eye, else on its top where it comes down; two
// hooks may hold one piece) and lets it go again; a test load (setPayload) is a steel block
// on a rope of its own. Ropes are steel wire sized for five times what they carry: springs
// of EA/L that pull and never push. A machine on wheels has a deck pieces are set on.
//
// Pieces are boxes of wood, concrete or steel, standing or lying (a crate is a piece).
// Tasks are what the yard asks for, checked by the world: deliver(crate, pad) is done
// when the crate stands still on the pad with nothing holding it; place(piece, at, {yaw,
// after}) when the piece stands still where it goes, upright, held by nothing.

import {
    qMul, qRot, qAxis, add, sub, dot, cross, scale, unit, IDENT, frameApply, frameMul, frameInv,
    standOf, solidsOf, cornersOf, boxRotation, tipOf, controlsOf,
} from "./operate.js";

const STEP = 1 / 60;            // the world's step (s)
const SUBSTEPS = 8;
const MAX_STEPS = 40;           // per call of step(): the most a frame catches up
export const RANGE = 1.75;      // rad either way a lifting joint turns before its stop
const EASE = 0.3;               // rad before a stop over which a joint's controller slows it to rest
const STEEL = 7850;
const WOOD = 500;
const DENSITY = { wood: WOOD, concrete: 2400, steel: STEEL };
// A crate hangs on a sling whose legs and hook rub as it rocks: what damps its turning (1/s).
const SLING = 1.5;
// And what damps its swing, the rope working over its sheave and the air (1/s): a load let
// hang settles in a few swings, as a slung load does, instead of swinging on.
const SWAY = 0.8;

/**
 * A steel wire rope from `a` at `at` to `b` at `atB`, `L` long, carrying `kg`, of metal
 * area `area` (m²; by default one sized to break at five times the load): a distance
 * spring that only pulls.
 */
// Whether any solid of one machine overlaps one of another's by more than a millimetre:
// oriented boxes ({c, axes}: a center and three half-axes) separated on none of the
// fifteen axes. Says which pair, or null.
function touching(as, bs) {
    const proj = (B, n) => B.axes.reduce((s, a) => s + Math.abs(dot(a, n)), 0);
    for (let i = 0; i < as.length; i++) for (let j = 0; j < bs.length; j++) {
        const A = as[i], B = bs[j], d = sub(B.c, A.c);
        const ns = [...A.axes, ...B.axes];
        for (const a of A.axes) for (const b of B.axes) ns.push(cross(a, b));
        const apart = ns.some((n) => {
            const l = Math.hypot(...n);
            if (l < 1e-9) return false;
            const u = scale(n, 1 / l);
            return Math.abs(dot(d, u)) > proj(A, u) + proj(B, u) - 1e-3;
        });
        if (!apart) return `solid ${i} into solid ${j}`;
    }
    return null;
}

function rope(world, a, b, at, atB, L, kg, area) {
    return world.addJoint({
        kind: 'distance', a, b, anchor: at, anchorB: atB,
        target: L, lower: 0, upper: L * 1.5, enableSpring: true, hertz: ropeHertz(kg, L, area), damping: 0.3, maxPush: 0,
    });
}
// How fast `kg` bounces on such a rope `L` long: its stiffness EA/L over its mass.
function ropeHertz(kg, L, area) {
    const A = area ?? 5 * Math.max(kg, 1) * 9.81 / 1.77e9, k = 1e11 * A / Math.max(L, 1e-3);
    return Math.min(30, Math.sqrt(k / Math.max(kg, 1)) / (2 * Math.PI));
}
// The metal area of a wire rope `mm` across: its wires fill 55% of the circle.
const ropeArea = (mm) => 0.55 * (Math.PI / 4) * (mm / 1000) ** 2;

const poseFrame = (P) => ({ q: [P[3], P[4], P[5], P[6]], t: [P[0], P[1], P[2]] });
// The shortest turn taking unit vector a onto unit vector b.
function qFromTo(a, b) {
    const d = dot(a, b);
    if (d < -0.999999) { const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]; return qAxis(unit(cross(a, p)), Math.PI); }
    const c = cross(a, b), w = 1 + d, n = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / n, c[1] / n, c[2] / n, w / n];
}

/** A yard: a world with ground at height `ground`, and what is put in it. */
export function createSite({ ground = 0, extent = 60 } = {}) {
    const world = bro.dynamics.createWorld({ gravity: [0, -9.81, 0] });
    world.addBox({ position: [0, ground - 1, 0], half: [extent, 1, extent], mass: 0, friction: 0.9 });
    let acc = 0, ids = 0;

    const site = {
        world, ground, machines: [], crates: [], pads: [], people: [], tasks: [], marks: [],
        timeScale: 1, time: 0,

        /** Stand contract `c` at `pos` (its base's foot on the ground there), turned `yaw` about up. */
        addMachine(c, { pos = null, yaw = 0, name = null, ops = null } = {}) {
            const m = machineIn(site, c, { pos, yaw, ops, name: name || c.name || `machine ${site.machines.length + 1}` });
            // Two machines stood into one another start jammed: a yard that does it is wrong.
            for (const o of site.machines) {
                const hit = touching(m._boxes(), o._boxes());
                if (hit) { m.destroy(); throw new Error(`${m.name} stands into ${o.name}: move or turn one (${hit})`); }
            }
            site.machines.push(m);
            return m;
        },
        /** A wooden crate `size` m on a side standing at [x, z]. */
        addCrate([x, z], size, { name = null, kg = null } = {}) {
            return site.addPiece([x, z], [size / 2, size / 2, size / 2], { name: name || `Crate ${site.crates.length + 1}`, kg: kg ?? WOOD * size * size * size });
        },
        /**
         * A piece to lift: a box of half-extents `half` [along, up, across], of `material`
         * (or `kg`), standing at [x, z] turned `yaw` about up (on whatever is there, else the
         * ground). A crate is a piece; so is a footing, a column, a beam. `lying`: laid on its
         * side, its up along the ground the way `yaw` faces. `eye`: a lifting eye cast in the
         * middle of its top face, where a hook takes it however it lies (a column lying down is
         * taken by its top end, and hangs upright from it); else a hook takes it on its top,
         * wherever it comes down there.
         */
        addPiece([x, z], half, { name = null, kg = null, material = 'wood', yaw = 0, y = null, lying = false, eye = false } = {}) {
            const vol = 8 * half[0] * half[1] * half[2], mass = kg ?? (DENSITY[material] ?? WOOD) * vol;
            const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
            // Laid down: its up turned onto its along (a quarter turn about its across).
            const q = lying ? qMul(qy, qAxis([0, 0, 1], -Math.PI / 2)) : qy;
            const piece = { id: `crate${++ids}`, name: name || `Piece ${site.crates.length + 1}`, kind: 'crate', material, half, kg: mass, size: 2 * Math.max(...half),
                eye: eye ? [0, half[1], 0] : null,
                body: world.addBox({ position: [x, (y ?? ground) + (lying ? half[0] : half[1]) + 1e-3, z], rotation: q, half, mass, friction: 0.8, angularDamping: SLING, linearDamping: SWAY }) };
            site.crates.push(piece);
            return piece;
        },
        /** How far `piece` reaches above and below its middle as it lies now (m). */
        reachY(piece) {
            const P = world.pose(piece.body), q = [P[3], P[4], P[5], P[6]];
            return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].reduce((s, e, i) => s + Math.abs(qRot(q, e)[1]) * piece.half[i], 0);
        },
        /** Where a hook takes `piece` as it lies now (world): its eye, else the middle of its top. */
        liftPoint(piece) {
            const P = world.pose(piece.body);
            return piece.eye ? frameApply(poseFrame(P), piece.eye) : [P[0], P[1] + site.reachY(piece), P[2]];
        },
        /** A pad marked on the ground at [x, z], `size` m square: where crates go. */
        addPad([x, z], size, { name = null } = {}) {
            const pad = { id: `pad${++ids}`, name: name || `Pad ${site.pads.length + 1}`, kind: 'pad', at: [x, ground, z], half: [size / 2, 0.01, size / 2] };
            site.pads.push(pad);
            return pad;
        },
        /** Someone standing at [x, z], to judge the machines by. */
        addPerson([x, z]) {
            const p = { kind: 'person', radius: 0.2, height: 1.78, body: world.addCapsule({ position: [x, ground + 0.89, z], radius: 0.2, halfHeight: 0.69, mass: 0 }) };
            site.people.push(p);
            return p;
        },
        /** Ask for `crate` to be brought to `pad`. */
        deliver(crate, pad) {
            const t = { id: `task${++ids}`, kind: 'deliver', crate, pad, done: false, label: `${crate.name} to ${pad.name}` };
            site.tasks.push(t);
            return t;
        },
        /** Where `crate` is: its pose [x, y, z, qx, qy, qz, qw]. */
        poseOf(thing) { return world.pose(thing.body); },
        /**
         * What stands under [x, z] below height y: { y, crate } with the top of the highest
         * crate whose footprint covers it (one not hanging on a hook), else the ground.
         */
        under(x, z, y = Infinity, skip = null) {
            let out = { y: site.ground, crate: null, machine: null };
            // A machine's deck (one on wheels), where it is now.
            for (const m of site.machines) {
                const B = m.bedWorld && m.bedWorld();
                if (!B) continue;
                const d = [x - B.center[0], 0, z - B.center[2]];
                const a = Math.abs(dot(d, B.axes[0])), b = Math.abs(dot(d, B.axes[1]));
                if (a <= B.half[0] && b <= B.half[1] && B.center[1] < y && B.center[1] > out.y) out = { y: B.center[1], crate: null, machine: m };
            }
            for (const cr of site.crates) {
                if (cr === skip) continue;
                if (site.machines.some((o) => o.hook && o.hook.crate === cr)) continue;
                // However it lies: inside it along each of its sides that lies along the ground, its
                // top as high as its sides reach up.
                const P = world.pose(cr.body), q = [P[3], P[4], P[5], P[6]], dx = x - P[0], dz = z - P[2];
                let inside = true, ext = 0;
                for (let i = 0; i < 3; i++) {
                    const e = [0, 0, 0]; e[i] = 1;
                    const a = qRot(q, e);
                    ext += Math.abs(a[1]) * cr.half[i];
                    if (Math.abs(a[1]) < 0.7 && Math.abs(dx * a[0] + dz * a[2]) > cr.half[i]) inside = false;
                }
                const top = P[1] + ext;
                if (inside && top < y && top > out.y) out = { y: top, crate: cr, machine: null };
            }
            return out;
        },
        /**
         * What `piece` stands on: the highest of what is under its footprint (its middle, its
         * corners and the middles of its sides) below its bottom: { y, crate, machine }.
         */
        support(piece) {
            const P = world.pose(piece.body), F = poseFrame(P), bot = P[1] - site.reachY(piece);
            let best = { y: -Infinity };
            for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
                const w = frameApply(F, [sx * piece.half[0] * 0.9, sy * piece.half[1] * 0.9, sz * piece.half[2] * 0.9]);
                const u = site.under(w[0], w[2], bot + piece.size * 0.05, piece);
                if (u.y > best.y) best = u;
            }
            return best;
        },
        /** Whether `piece` stands still, held by nothing. */
        resting(piece) {
            const v = world.velocity(piece.body);
            return Math.hypot(v[0], v[1], v[2]) < 0.05 * Math.max(1, piece.size) && !site.machines.some((m) => m.hook && m.hook.crate === piece);
        },
        /** Whether `crate` stands still on `pad`, held by nothing. */
        onPad(crate, pad) {
            const P = world.pose(crate.body);
            const inside = Math.abs(P[0] - pad.at[0]) <= pad.half[0] && Math.abs(P[2] - pad.at[2]) <= pad.half[2];
            const down = P[1] - site.reachY(crate) < ground + crate.size * 0.1;
            return site.resting(crate) && inside && down;
        },
        /**
         * Ask for `piece` to be set at `at` [x, y, z] (where its middle goes) turned `yaw`, once
         * the tasks `after` are done: done while it stands still there, held by nothing, within
         * `tol` m and square to the yaw (its sides either way round; a yaw of null: any way round).
         */
        place(piece, at, { yaw = 0, after = [], tol = null, label = null } = {}) {
            const t = { id: `task${++ids}`, kind: 'place', crate: piece, at, yaw, after, done: false,
                tol: tol ?? Math.max(0.02, Math.min(piece.half[0], piece.half[2]) * 0.5),
                label: label || `${piece.name} in place` };
            site.tasks.push(t);
            return t;
        },
        /** Whether `piece` stands where task `t` sets it: { at (m off), up (m off), turn (rad off), ok }. */
        placed(t) {
            const P = world.pose(t.crate.body), q = [P[3], P[4], P[5], P[6]];
            const f = qRot(q, [1, 0, 0]), yaw = Math.atan2(-f[2], f[0]);
            const sym = Math.abs(t.crate.half[0] - t.crate.half[2]) < 1e-6 ? Math.PI / 2 : Math.PI;
            let d = 0;
            if (t.yaw != null) { d = (((yaw - t.yaw) % sym) + sym) % sym; if (d > sym / 2) d = sym - d; }
            const at = Math.hypot(P[0] - t.at[0], P[2] - t.at[2]), up = Math.abs(P[1] - t.at[1]);
            return { at, up, turn: d, ok: at <= t.tol && up <= Math.max(0.02, t.tol * 0.5) && d < 0.1 && qRot(q, [0, 1, 0])[1] > 0.99 };
        },
        /** Advance by `dt` seconds (times timeScale). */
        step(dt) {
            acc += dt * site.timeScale;
            let n = 0;
            while (acc >= STEP && n < MAX_STEPS) {
                for (const m of site.machines) m._drive(STEP);
                world.step(STEP, SUBSTEPS);
                acc -= STEP; n++; site.time += STEP;
            }
            if (n === MAX_STEPS) acc = 0;
            for (const m of site.machines) m._read();
            for (const t of site.tasks) t.done = t.kind === 'deliver' ? site.onPad(t.crate, t.pad) : site.resting(t.crate) && site.placed(t).ok;
        },
        /** Everything to draw that is not a machine: { kind, half|radius, pose, from? } (world). */
        props() {
            const out = [];
            for (const p of site.people) out.push({ ...p, pose: world.pose(p.body) });
            for (const c of site.crates) out.push({ ...c, pose: world.pose(c.body), held: site.machines.some((m) => m.hook && m.hook.crate === c) });
            for (const p of site.pads) out.push({ ...p, pose: [...p.at, 0, 0, 0, 1], done: site.tasks.some((t) => t.pad === p && t.done) });
            for (const p of site.marks) out.push({ ...p, pose: [...p.at, 0, 0, 0, 1] });
            // Where each piece is to go: its footprint at its bottom there, lit once it stands in it.
            for (const t of site.tasks) if (t.kind === 'place') {
                const [hx, hy, hz] = t.crate.half;
                out.push({ id: `target:${t.id}`, kind: 'target', half: [hx * 1.08, 0.004, hz * 1.08], done: t.done,
                    pose: [t.at[0], t.at[1] - hy + 0.004, t.at[2], 0, Math.sin((t.yaw ?? 0) / 2), 0, Math.cos((t.yaw ?? 0) / 2)] });
            }
            for (const m of site.machines) out.push(...m._props());
            return out;
        },
        destroy() { world.destroy(); },
    };
    return site;
}

/** Contract `c` standing in `site`. */
function machineIn(site, c, { pos, yaw, name, ops }) {
    const world = site.world;
    const { up, joints, controls, layout, ctrlOfJoint } = ops || controlsOf(c);
    const S = standOf(c);
    const solids = solidsOf(c);
    const corners = solids.map(cornersOf);
    // Its foot: the lowest of it once stood up; placed with that on the ground.
    const stood = corners.flat().map((p) => qRot(S, p));
    const foot = Math.min(...stood.map((p) => p[1]));
    const Q = qMul(qAxis([0, 1, 0], yaw), S);
    // Where it stands: the axis it slews about, else the middle of what is bolted down.
    const root = c.joints.find((J) => J.upright && J.parent == null && J.pin);
    const fixed = solids.filter((b) => b.carrier == null).flatMap(cornersOf);
    const base = root ? root.pin : fixed.length ? [0, 1, 2].map((i) => (Math.min(...fixed.map((p) => p[i])) + Math.max(...fixed.map((p) => p[i]))) / 2) : [0, 0, 0];
    const b0 = qRot(Q, base);
    const W = { q: Q, t: pos ? [pos[0] - b0[0], site.ground - foot, pos[1] - b0[2]] : [0, 0, 0] };
    const toWorld = (p) => frameApply(W, p);
    const ws = corners.flat().map(toWorld);
    const lo = [0, 2].map((i) => Math.min(...ws.map((p) => p[i]))), hi = [0, 2].map((i) => Math.max(...ws.map((p) => p[i])));
    const center = (() => { const p = toWorld(base); return [p[0], p[2]]; })();
    const mid = center;
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 0.5);
    const tipAt = tipOf(c);

    const ang = new Float64Array(joints.length);
    const rate = new Float64Array(joints.length);
    const status = joints.map(() => 'still');
    const torque = new Float64Array(joints.length);
    const cap = new Float64Array(joints.length);

    // The body each joint's parts make, and the parts no joint carries: bolted to the ground.
    const groups = new Map();
    for (const b of solids) {
        const key = b.carrier == null ? -1 : b.carrier;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
    }
    // A machine on wheels stands on them: its frame has its mass and goes where they take it.
    // A wheel is a cylinder about its axle; every other body is its parts' boxes, built
    // where the design has them. `rest` is each body's frame in the design's frame as built.
    const mobile = !!c.vehicle;
    const bodyOf = new Map(), rest = new Map(), wheelAt = new Map();
    for (const [key, list] of groups) {
        const CJ = key >= 0 ? c.joints[key] : null;
        if (CJ && CJ.wheel) {
            const Wl = CJ.wheel, kg = list.reduce((a, b) => a + b.m, 0);
            const ctr = list.reduce((a, b) => (b.m > a.m ? b : a)).center, q = qFromTo([0, 1, 0], unit(CJ.axis));
            rest.set(key, { q, t: ctr });
            wheelAt.set(key, ctr);
            bodyOf.set(key, world.addCylinder({
                position: toWorld(ctr), rotation: qMul(W.q, q), radius: Wl.radius, halfHeight: Wl.width / 2, segments: 24,
                mass: Math.max(1e-3, kg), friction: Wl.grip,
            }));
            continue;
        }
        const parts = list.map((b) => ({ center: b.center, rotation: boxRotation(b.axes), half: b.axes.map((a) => Math.hypot(...a)), mass: key === -1 && !mobile ? 0 : Math.max(1e-3, b.m) }));
        rest.set(key, IDENT);
        bodyOf.set(key, world.addCompound({ position: W.t, rotation: W.q, parts, friction: 0.7 }));
    }
    if (!bodyOf.has(-1)) { rest.set(-1, IDENT); bodyOf.set(-1, world.addBox({ position: W.t, half: [0.01, 0.01, 0.01], mass: 0 })); }
    // Where a body's design frame is in the world now: its pose, less where it sits in that frame.
    const frameOf = (key) => frameMul(poseFrame(world.pose(bodyOf.get(key))), frameInv(rest.get(key)));
    // A joint with no parts of its own moves with the one that carries it.
    const bodyFor = (j) => { while (j != null && !bodyOf.has(j)) j = c.joints[j].parent; return bodyOf.get(j == null ? -1 : j); };
    const upW = qRot(W.q, up);
    const hinge = joints.map((J, j) => {
        const CJ = c.joints[j];
        if (!CJ.pin || !CJ.axis || !bodyOf.has(j)) return null;
        const a = bodyFor(CJ.parent), b = bodyOf.get(j);
        if (a === undefined || a === b) return null;
        if (CJ.wheel) {
            // On its axle, riding up and down on a spring that settles it a tenth of its
            // radius under its share of the weight, braked by its drive until driven.
            return world.addJoint({
                kind: 'wheel', a, b, anchor: toWorld(wheelAt.get(j)), axis: upW, axisB: qRot(W.q, unit(CJ.axis)),
                lower: -CJ.wheel.radius * 0.15, upper: CJ.wheel.radius * 0.15,
                target: 0, hertz: 3, damping: 0.8,
                motorSpeed: 0, maxMotor: J.stall, enableMotor: true,
            });
        }
        const o = {
            kind: 'hinge', a, b, anchor: toWorld(CJ.pin), axis: qRot(W.q, unit(CJ.axis)),
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

    // What a joint holds still with: its drive's stall torque while powered, and whatever
    // a self-locking stage (a worm, a lead screw) holds by itself, powered or not.
    function holdOf(J, powered) { return Math.max(powered ? J.stall : 0, J.lock ?? 0); }
    // What the controller lets a joint's drive put out: nine tenths of what its boom bears.
    function limitOf(J) { return J.bend > 0 && isFinite(J.bend) ? J.bend * 0.9 : Infinity; }

    const tipKey = tipAt && tipAt.carrier != null && bodyOf.has(tipAt.carrier) ? tipAt.carrier : -1;
    const tipBody = () => bodyOf.get(tipKey);
    const tipWorld = () => frameApply(frameOf(tipKey), tipAt.pos);
    // The hook: on the line of the winch the design carries at its tip, run by its hoist
    // control at the speed and pull its drive gives through the drum (a design with no
    // winch has no hook). The line paid out below the tip, and the crate on it.
    const hoistCt = tipAt ? controls.find((ct) => ct.winch) : null;
    const hookMin = Math.max(0.05, size * 0.02);
    const hook = hoistCt ? {
        line: Math.min(hoistCt.winch.lineM, Math.max(hookMin, size * 0.15)), crate: null, at: null, rope: null, stalled: false,
        control: hoistCt, speed: hoistCt.noLoad, pull: hoistCt.stall, maxLine: hoistCt.winch.lineM, area: ropeArea(hoistCt.winch.ropeMm),
        reach: Math.max(0.1, size * 0.06),
        get u() { return hoistCt.u; },
    } : null;
    let load = null;
    // Where on `cr` (in its frame) a hook over world point `w` takes it: on its top, under the
    // hook, kept in from its edges.
    function slingAt(cr, w) {
        if (cr.eye) return cr.eye;
        // Its face up now (however it lies): the side whose axis stands most nearly upright.
        const P = world.pose(cr.body), q = [P[3], P[4], P[5], P[6]];
        const l = frameApply(frameInv(poseFrame(P)), w), cl = (v, h) => Math.max(-h * 0.9, Math.min(h * 0.9, v));
        const ups = [0, 1, 2].map((i) => { const e = [0, 0, 0]; e[i] = 1; return qRot(q, e)[1]; });
        const k = [0, 1, 2].reduce((a, i) => (Math.abs(ups[i]) > Math.abs(ups[a]) ? i : a), 1);
        const out = [0, 1, 2].map((i) => cl(l[i], cr.half[i]));
        out[k] = Math.sign(ups[k] || 1) * cr.half[k];
        return out;
    }

    // Where every solid of the machine is now (world boxes as min/max), for keeping clear of it.
    // The machine's solids where they stand now: each a center and its three half-axes in the world.
    function machineBoxes() {
        const F = m.frames(), out = [];
        for (const b of solids) {
            const T = frameMul(W, b.carrier != null ? F[b.carrier] : IDENT);
            out.push({ c: frameApply(T, b.center), axes: b.axes.map((a) => qRot(T.q, a)) });
        }
        return out;
    }
    // Whether a level cube of half-size h at p stands `gap` clear of solid B: a separating axis
    // among the world's three and the solid's own three (conservative where only an edge pair separates).
    function clearOf(B, p, h, gap) {
        const d = sub(B.c, p);
        const ns = [[1, 0, 0], [0, 1, 0], [0, 0, 1], ...B.axes.map(unit)];
        return ns.some((n) => {
            const rB = B.axes.reduce((s, a) => s + Math.abs(dot(a, n)), 0), rA = h * (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]));
            return Math.abs(dot(d, n)) > rA + rB + gap;
        });
    }

    // A test load: a steel block on its own rope from the tip. It hangs under the tip when
    // there is room; where the tip is down among the machine, it waits on the ground just
    // clear of it, and the rope goes taut as the tip lifts.
    function hang(kg) {
        if (load) { world.removeBody(load.body); load = null; }
        if (!(kg > 0) || !tipAt) return;
        const side = Math.cbrt(kg / STEEL), len = Math.max(0.05, side * 0.8), h = side / 2;
        const tb = tipBody(), at = tipWorld();
        const boxes = machineBoxes(), gap = Math.max(0.01, side * 0.05);
        const clear = (p) => boxes.every((B) => clearOf(B, p, h, gap));
        let p = [at[0], Math.max(at[1] - len - h, site.ground + h + 1e-3), at[2]];
        if (!clear(p)) {
            // Out along the ground, away from the machine's middle, until nothing of it is there.
            let d = [at[0] - mid[0], 0, at[2] - mid[1]];
            if (Math.hypot(d[0], d[2]) < 1e-6) d = [1, 0, 0];
            const out = unit(d);
            p = [at[0], site.ground + h + 1e-3, at[2]];
            for (let k = 0; k < 400 && !clear(p); k++) p = add(p, scale(out, Math.max(gap, side * 0.25)));
        }
        const top = [p[0], p[1] + h, p[2]];
        const body = world.addBox({ position: p, half: [h, h, h], mass: kg, friction: 0.8 });
        // Hung from the tip it is its own length; waiting on the ground it is a little
        // longer than the way to the tip, slack until the tip lifts.
        const L = Math.max(len, Math.hypot(...sub(at, top)) * 1.02);
        load = { body, rope: rope(world, tb, body, at, top, L, kg), side, kg, L };
    }

    const m = {
        name, contract: c, joints, controls, layout, up, angles: ang, rates: rate, status, torque, cap,
        payloadKg: 0, powered: true, hook, place: W, size, mid, ground: site.ground,
        get world() { return world; },
        /** Per joint, the rigid move of what it carries from where it was built, in the design's frame. */
        frames() {
            const Wi = frameInv(W);
            return joints.map((_, j) => {
                let k = j;
                while (k != null && !bodyOf.has(k)) k = c.joints[k].parent;
                return frameMul(Wi, frameOf(k == null ? -1 : k));
            });
        },
        /** Where the tip is now in the design's frame, or null. */
        tip() { return tipAt ? frameApply(frameInv(W), tipWorld()) : null; },
        /** Where the tip is now in the world, or null. */
        tipWorld() { return tipAt ? tipWorld() : null; },
        /** Where the hook is now in the world: the line's end below the tip (or the crate's top). */
        hookWorld() {
            if (!hook) return null;
            if (hook.crate) return frameApply(poseFrame(world.pose(hook.crate.body)), hook.at);
            // Paid out further than what is under it, it rests on that, its line slack.
            const t = tipWorld(), r = Math.max(0.02, size * 0.012);
            return [t[0], Math.max(t[1] - hook.line, site.under(t[0], t[2], t[1]).y + r), t[2]];
        },
        /** The free crate the hook hangs over, at any height, or null. */
        over() {
            if (!hook || hook.crate) return null;
            const t = tipWorld();
            return site.under(t[0], t[2], t[1]).crate;
        },
        /** The machine whose deck the hook hangs over (nothing higher between), or null. */
        overDeck() {
            if (!hook) return null;
            const t = tipWorld();
            return site.under(t[0], t[2], t[1], hook.crate).machine;
        },
        /** The pad the hook hangs over, or null. */
        overPad() {
            if (!hook) return null;
            const t = tipWorld();
            return site.pads.find((p) => Math.abs(t[0] - p.at[0]) <= p.half[0] && Math.abs(t[2] - p.at[2]) <= p.half[2]) || null;
        },
        set(id, u, axis = 'u') { const ct = controls.find((x) => x.id === id); if (ct) ct[axis === 'v' ? 'v' : 'u'] = Math.max(-1, Math.min(1, u)); },
        /** Drive a machine on wheels: `u` forward (−1 back), `v` turning to the right (−1 left). */
        drive(u, v = 0) { const ct = controls.find((x) => x.kind === 'drive'); if (ct) { ct.u = Math.max(-1, Math.min(1, u)); ct.v = Math.max(-1, Math.min(1, v)); } },
        /** Which way the machine faces on the ground (unit [x, z]) and where it is ([x, z]), on wheels. */
        heading() { if (!c.vehicle) return null; const f = qRot(W.q, c.vehicle.bed.axes[0]); const n = Math.hypot(f[0], f[2]) || 1; return [f[0] / n, f[2] / n]; },
        /** How fast it goes over the ground (m/s, + forward), on wheels. */
        groundSpeed() { if (!c.vehicle) return 0; const v = world.velocity(bodyOf.get(-1)), h = m.heading(); return v[0] * h[0] + v[2] * h[1]; },
        /** Run the hoist: + takes the line in, − pays it out. */
        hoist(u) { if (hook) hoistCt.u = Math.max(-1, Math.min(1, u)); },
        /** The crate under the hook, close enough to take, or null. */
        reachable() {
            if (!hook || hook.crate) return null;
            const at = m.hookWorld();
            let best = null, bd = Infinity;
            for (const cr of site.crates) {
                // Where on its top the hook would take it: the spot under the hook, kept on its top.
                const top = frameApply(poseFrame(world.pose(cr.body)), slingAt(cr, at));
                const d = Math.hypot(top[0] - at[0], top[2] - at[2]), dy = at[1] - top[1];
                if (d < hook.reach && dy > -hook.reach && dy < hook.reach * 2 && d < bd) { best = cr; bd = d; }
            }
            return best;
        },
        /** Hook the crate under the hook, at the spot on its top under it (another hook may hold it too); true if one was taken. */
        grab() {
            const cr = m.reachable();
            if (!cr) return false;
            const loc = slingAt(cr, m.hookWorld()), top = frameApply(poseFrame(world.pose(cr.body)), loc), at = tipWorld();
            hook.line = Math.max(hookMin, Math.hypot(...sub(at, top)));
            hook.crate = cr; hook.at = loc;
            // Its share of the load: all of it, or what the hooks holding it split.
            const n = site.machines.filter((o) => o.hook && o.hook.crate === cr).length;
            hook.rope = rope(world, tipBody(), cr.body, at, top, hook.line, cr.kg / n, hook.area);
            return true;
        },
        /** Let the hooked crate go. */
        release() {
            if (!hook || !hook.crate) return false;
            if (world.hasJoint(hook.rope)) world.removeJoint(hook.rope);
            const at = tipWorld();
            hook.line = Math.max(hookMin, at[1] - m.hookWorld()[1]);
            hook.crate = null; hook.rope = null; hook.at = null;
            return true;
        },
        /** Hang a `kg` test load on the tip (0 for none). */
        setPayload(kg) { if (Math.abs(kg - m.payloadKg) < 1e-9) return; m.payloadKg = kg; hang(kg); },
        /** Whether the hooked crate's rope carries it (the crate is off the ground). */
        carrying() {
            if (!hook || !hook.crate) return false;
            const P = world.pose(hook.crate.body), cr = hook.crate;
            return P[1] - site.reachY(cr) > site.support(cr).y + Math.min(0.03, cr.size * 0.05);
        },
        /** Its deck where it is now, on wheels: { center (its top's middle), half [along, across], axes (world, unit) }, else null. */
        bedWorld() {
            if (!c.vehicle) return null;
            const B = c.vehicle.bed;
            return { center: toWorld(B.center), half: B.half, axes: B.axes.map((a) => qRot(W.q, a)) };
        },

        _drive(dt) {
            for (let j = 0; j < joints.length; j++) {
                const h = hinge[j];
                if (h == null || !world.hasJoint(h)) continue;
                const J = joints[j], ct = ctrlOfJoint.get(j);
                if (J.wheel) {
                    // Throttle and steer (+ to the right), mixed: a wheel on the side turned toward runs slower.
                    // Its motor's torque falls from stall at rest to nothing at free speed; let
                    // go, it holds the wheel still with all its drive has (its brake).
                    const live = m.powered && !(ct && ct.dark);
                    const s = live && ct ? Math.max(-1, Math.min(1, ct.u - J.side * ct.v)) : 0;
                    let speed = 0, effort = live ? J.stall : 0;
                    if (s !== 0) {
                        const w = world.jointState(h).speed * J.roll * Math.sign(s);
                        speed = s * J.speed * J.roll;
                        effort = J.stall * Math.min(1, Math.max(0.05, 1 - w / J.speed));
                    }
                    cap[j] = effort;
                    world.setJointMotor(h, speed, effort, true);
                    continue;
                }
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
            // The hoist pays the line out or takes it in. Its drive's pull falls from stall at rest
            // to nothing at free speed: taking in what hangs on it, it runs at what that leaves,
            // and a crate heavier than it pulls stays where it is.
            if (hook) {
                const u = m.powered && !hoistCt.dark ? hoistCt.u : 0;
                const weight = hook.crate && m.carrying() ? hook.crate.kg * 9.81 : 0;
                const v = u > 0 ? hook.speed * Math.max(0, 1 - weight / hook.pull) : hook.speed;
                hook.stalled = u > 0 && weight >= hook.pull;
                if (u !== 0) {
                    hook.line = Math.max(hookMin, Math.min(hook.maxLine, hook.line - u * v * dt));
                    if (hook.rope && world.hasJoint(hook.rope)) world.setJointTarget(hook.rope, hook.line, ropeHertz(hook.crate.kg, hook.line, hook.area), 0.3, 0, true);
                }
            }
        },
        _read() {
            // On wheels, the machine is where its chassis is.
            if (mobile) {
                const F = frameOf(-1);
                W.q = F.q; W.t = F.t;
                const p = toWorld(base); mid[0] = p[0]; mid[1] = p[2];
            }
            const hanging = () => (hook && hook.crate && m.carrying() ? hook.crate.kg : 0) + m.payloadKg;
            for (let j = 0; j < joints.length; j++) {
                const h = hinge[j];
                if (h == null) { status[j] = 'still'; continue; }
                if (!world.hasJoint(h)) { status[j] = 'broken'; rate[j] = 0; torque[j] = 0; continue; }
                const s = world.jointState(h), J = joints[j], ct = ctrlOfJoint.get(j);
                if (J.wheel) {
                    // Its spin, and whether it rolls as driven, holds, or cannot turn.
                    ang[j] += s.speed * STEP; rate[j] = s.speed; torque[j] = s.motorEffort;
                    const driven = ct && !ct.dark && m.powered && (ct.u !== 0 || ct.v !== 0);
                    const slow = Math.abs(s.speed) < J.speed * 0.03, working = Math.abs(s.motorEffort) >= cap[j] * 0.98 && cap[j] > 0;
                    status[j] = driven ? (slow && working ? 'stalled' : working ? 'straining' : 'moving') : slow ? (m.powered ? 'holding' : 'locked') : 'stopping';
                    continue;
                }
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
                    // What hangs on it cannot hold up a drive this strong (a slew lifts nothing): it is
                    // pushing against something in its way, not too heavy.
                    if (status[j] === 'stalled' && (J.upright || hanging() * 9.81 * size < 0.5 * J.stall)) status[j] = 'blocked';
                } else if (!slow) status[j] = working ? 'falling' : 'stopping';
                else status[j] = m.powered && !(ct && ct.dark) ? 'holding' : 'locked';
            }
            for (const ct of controls) if (ct.output) ct.flow = m.powered && !ct.dark ? ct.u * ct.noLoad : 0;
        },
        _boxes: machineBoxes,
        _props() {
            const out = [];
            if (!tipAt) return out;
            const at = tipWorld();
            if (load) out.push({ kind: 'load', half: [load.side / 2, load.side / 2, load.side / 2], pose: world.pose(load.body), from: at });
            if (!hook) return out;
            const hw = m.hookWorld();
            const ut = tipWorld(), un = site.under(ut[0], ut[2], ut[1], hook.crate);
            out.push({ kind: 'hook', machine: m, radius: Math.max(0.02, size * 0.012), pose: [...hw, 0, 0, 0, 1], from: at, hooked: !!hook.crate, deck: un.machine ? un.y : null });
            return out;
        },
        destroy() {
            for (const b of new Set(bodyOf.values())) world.removeBody(b);
            if (load) world.removeBody(load.body);
            site.machines.splice(site.machines.indexOf(m), 1);
        },
    };
    return m;
}

/**
 * One machine alone in a yard of its own, as the foundry's Operate shows it: the
 * machine where it was built, crates about it beyond its reach, someone at its corner,
 * and the same machine API (step, reset, props, destroy act on the yard).
 */
export function machineOf(c) {
    let site = null, m = null;
    const proxy = {}, ops = controlsOf(c);
    function build() {
        if (site) site.destroy();
        const S = standOf(c);
        const pts = solidsOf(c).map(cornersOf).flat().map((p) => qRot(S, p));
        const floorY = Math.min(...pts.map((p) => p[1]));
        site = createSite({ ground: floorY, extent: 200 });
        m = site.addMachine(c, { ops });
        const lo = [0, 2].map((i) => Math.min(...pts.map((p) => p[i]))), hi = [0, 2].map((i) => Math.max(...pts.map((p) => p[i])));
        const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 0.5);
        const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) * 1.5 + 0.3;
        for (let k = 0; k < 5; k++) {
            const s = Math.max(0.3, size * (0.05 + 0.03 * (k % 3)));
            const a = k * 1.3 + 2.4, r = reach + s + size * 0.15 * k;
            site.addCrate([mid[0] + Math.cos(a) * r, mid[1] + Math.sin(a) * r], s);
        }
        site.addPerson([lo[0] - 0.8, lo[1] - 0.8]);
        proxy.floorY = floorY;
    }
    build();
    const pass = ['frames', 'tip', 'tipWorld', 'hookWorld', 'set', 'drive', 'heading', 'groundSpeed', 'hoist', 'grab', 'release', 'reachable', 'carrying'];
    for (const k of pass) proxy[k] = (...a) => m[k](...a);
    for (const k of ['contract', 'joints', 'controls', 'layout', 'up', 'angles', 'rates', 'status', 'torque', 'cap', 'hook', 'size']) Object.defineProperty(proxy, k, { get: () => m[k] });
    Object.defineProperty(proxy, 'world', { get: () => site.world });
    Object.defineProperty(proxy, 'site', { get: () => site });
    Object.defineProperty(proxy, 'powered', { get: () => m.powered, set: (v) => { m.powered = v; } });
    Object.defineProperty(proxy, 'payloadKg', { get: () => m.payloadKg });
    Object.defineProperty(proxy, 'timeScale', { get: () => site.timeScale, set: (v) => { site.timeScale = v; } });
    proxy.setPayload = (kg) => m.setPayload(kg);
    proxy.step = (dt) => site.step(dt);
    proxy.props = () => site.props();
    proxy.reset = () => {
        const kg = m.payloadKg, on = m.powered, ts = site.timeScale;
        for (const ct of ops.controls) ct.u = 0;
        build();
        m.powered = on; site.timeScale = ts;
        if (kg > 0) m.setPayload(kg);
    };
    proxy.destroy = () => { if (site) site.destroy(); site = null; };
    return proxy;
}
