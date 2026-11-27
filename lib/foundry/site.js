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
// Every machine with a tip carries a hook on a hoist line. The hook takes the
// crate it is let down onto and lets it go again; a test load (setPayload) is a
// steel block on a rope of its own. Ropes are steel wire sized for five times
// what they carry: springs of EA/L that pull and never push.
//
// Tasks are what the yard asks for, checked by the world: deliver(crate, pad)
// is done when the crate stands still on the pad with nothing holding it.

import {
    qMul, qRot, qAxis, add, sub, scale, unit, IDENT, frameApply, frameMul, frameInv,
    standOf, solidsOf, cornersOf, boxRotation, tipOf, controlsOf,
} from "./operate.js";

const STEP = 1 / 60;            // the world's step (s)
const SUBSTEPS = 8;
const MAX_STEPS = 40;           // per call of step(): the most a frame catches up
export const RANGE = 1.75;      // rad either way a lifting joint turns before its stop
const EASE = 0.3;               // rad before a stop over which a joint's controller slows it to rest
const STEEL = 7850;
const WOOD = 500;
// A crate hangs on a sling whose legs and hook rub as it rocks: what damps its turning (1/s).
const SLING = 1.5;

/** A steel wire rope from `a` at `at` to `b` at `atB`, `L` long, for `kg` (a distance spring that only pulls). */
function rope(world, a, b, at, atB, L, kg) {
    return world.addJoint({
        kind: 'distance', a, b, anchor: at, anchorB: atB,
        target: L, lower: 0, upper: L * 1.5, enableSpring: true, hertz: ropeHertz(kg, L), damping: 0.3, maxPush: 0,
    });
}
// How fast `kg` bounces on such a rope `L` long: its stiffness EA/L over its mass.
function ropeHertz(kg, L) {
    const area = 5 * Math.max(kg, 1) * 9.81 / 1.77e9, k = 1e11 * area / Math.max(L, 1e-3);
    return Math.min(30, Math.sqrt(k / Math.max(kg, 1)) / (2 * Math.PI));
}

const poseFrame = (P) => ({ q: [P[3], P[4], P[5], P[6]], t: [P[0], P[1], P[2]] });

/** A yard: a world with ground at height `ground`, and what is put in it. */
export function createSite({ ground = 0, extent = 60 } = {}) {
    const world = bro.dynamics.createWorld({ gravity: [0, -9.81, 0] });
    world.addBox({ position: [0, ground - 1, 0], half: [extent, 1, extent], mass: 0, friction: 0.9 });
    let acc = 0, ids = 0;

    const site = {
        world, ground, machines: [], crates: [], pads: [], people: [], tasks: [],
        timeScale: 1, time: 0,

        /** Stand contract `c` at `pos` (its base's foot on the ground there), turned `yaw` about up. */
        addMachine(c, { pos = null, yaw = 0, name = null, ops = null } = {}) {
            const m = machineIn(site, c, { pos, yaw, ops, name: name || c.name || `machine ${site.machines.length + 1}` });
            site.machines.push(m);
            return m;
        },
        /** A wooden crate `size` m on a side standing at [x, z]. */
        addCrate([x, z], size, { name = null, kg = null } = {}) {
            const half = [size / 2, size / 2, size / 2], mass = kg ?? WOOD * size * size * size;
            const crate = { id: `crate${++ids}`, name: name || `Crate ${site.crates.length + 1}`, kind: 'crate', half, kg: mass, size,
                body: world.addBox({ position: [x, ground + size / 2 + 1e-3, z], half, mass, friction: 0.8, angularDamping: SLING }) };
            site.crates.push(crate);
            return crate;
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
        /** Whether `crate` stands still on `pad`, held by nothing. */
        onPad(crate, pad) {
            const P = world.pose(crate.body), v = world.velocity(crate.body);
            const still = Math.hypot(v[0], v[1], v[2]) < 0.05 * Math.max(1, crate.size);
            const inside = Math.abs(P[0] - pad.at[0]) <= pad.half[0] && Math.abs(P[2] - pad.at[2]) <= pad.half[2];
            const down = P[1] - crate.size / 2 < ground + crate.size * 0.1;
            const held = site.machines.some((m) => m.hook.crate === crate);
            return still && inside && down && !held;
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
            for (const t of site.tasks) if (t.kind === 'deliver') t.done = site.onPad(t.crate, t.pad);
        },
        /** Everything to draw that is not a machine: { kind, half|radius, pose, from? } (world). */
        props() {
            const out = [];
            for (const p of site.people) out.push({ ...p, pose: world.pose(p.body) });
            for (const c of site.crates) out.push({ ...c, pose: world.pose(c.body) });
            for (const p of site.pads) out.push({ ...p, pose: [...p.at, 0, 0, 0, 1], done: site.tasks.some((t) => t.pad === p && t.done) });
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
    const bodyOf = new Map();
    for (const [key, list] of groups) {
        const parts = list.map((b) => ({ center: b.center, rotation: boxRotation(b.axes), half: b.axes.map((a) => Math.hypot(...a)), mass: key === -1 ? 0 : Math.max(1e-3, b.m) }));
        bodyOf.set(key, world.addCompound({ position: W.t, rotation: W.q, parts, friction: 0.7 }));
    }
    if (!bodyOf.has(-1)) bodyOf.set(-1, world.addBox({ position: W.t, half: [0.01, 0.01, 0.01], mass: 0 }));
    // A joint with no parts of its own moves with the one that carries it.
    const bodyFor = (j) => { while (j != null && !bodyOf.has(j)) j = c.joints[j].parent; return bodyOf.get(j == null ? -1 : j); };
    const hinge = joints.map((J, j) => {
        const CJ = c.joints[j];
        if (!CJ.pin || !CJ.axis || !bodyOf.has(j)) return null;
        const a = bodyFor(CJ.parent), b = bodyOf.get(j);
        if (a === undefined || a === b) return null;
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

    const tipBody = () => bodyOf.get(tipAt && tipAt.carrier != null ? tipAt.carrier : -1) ?? bodyOf.get(-1);
    const tipWorld = () => frameApply(poseFrame(world.pose(tipBody())), tipAt.pos);
    // The hook: the line paid out below the tip, and the crate on it.
    const hookMin = Math.max(0.05, size * 0.02);
    const hook = { line: Math.max(hookMin, size * 0.15), crate: null, rope: null, u: 0, speed: Math.max(0.2, size * 0.2), reach: Math.max(0.1, size * 0.06) };
    let load = null;

    // Where every solid of the machine is now (world boxes as min/max), for keeping clear of it.
    function machineBoxes() {
        const F = m.frames(), out = [];
        for (const b of solids) {
            const T = frameMul(W, b.carrier != null ? F[b.carrier] : IDENT);
            const ps = cornersOf(b).map((p) => frameApply(T, p));
            out.push([0, 1, 2].map((i) => [Math.min(...ps.map((p) => p[i])), Math.max(...ps.map((p) => p[i]))]));
        }
        return out;
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
        const clear = (p) => boxes.every((B) => !(B[0][0] < p[0] + h + gap && p[0] - h - gap < B[0][1] && B[1][0] < p[1] + h + gap && p[1] - h - gap < B[1][1] && B[2][0] < p[2] + h + gap && p[2] - h - gap < B[2][1]));
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
                if (k == null) return IDENT;
                return frameMul(Wi, poseFrame(world.pose(bodyOf.get(k))));
            });
        },
        /** Where the tip is now in the design's frame, or null. */
        tip() { return tipAt ? frameApply(frameInv(W), tipWorld()) : null; },
        /** Where the tip is now in the world, or null. */
        tipWorld() { return tipAt ? tipWorld() : null; },
        /** Where the hook is now in the world: the line's end below the tip (or the crate's top). */
        hookWorld() {
            if (!tipAt) return null;
            if (hook.crate) { const P = world.pose(hook.crate.body); return frameApply(poseFrame(P), [0, hook.crate.size / 2, 0]); }
            const t = tipWorld();
            return [t[0], t[1] - hook.line, t[2]];
        },
        set(id, u) { const ct = controls.find((x) => x.id === id); if (ct) ct.u = Math.max(-1, Math.min(1, u)); },
        /** Run the hoist: + takes the line in, − pays it out. */
        hoist(u) { hook.u = Math.max(-1, Math.min(1, u)); },
        /** The crate under the hook, close enough to take, or null. */
        reachable() {
            if (!tipAt || hook.crate) return null;
            const at = m.hookWorld();
            let best = null, bd = Infinity;
            for (const cr of site.crates) {
                if (site.machines.some((o) => o.hook.crate === cr)) continue;
                const P = world.pose(cr.body), top = [P[0], P[1] + cr.size / 2, P[2]];
                const d = Math.hypot(top[0] - at[0], top[2] - at[2]), dy = at[1] - top[1];
                if (d < cr.size / 2 + hook.reach && dy > -hook.reach && dy < hook.reach * 2 && d < bd) { best = cr; bd = d; }
            }
            return best;
        },
        /** Hook the crate under the hook; true if one was taken. */
        grab() {
            const cr = m.reachable();
            if (!cr) return false;
            const P = world.pose(cr.body), top = [P[0], P[1] + cr.size / 2, P[2]], at = tipWorld();
            hook.line = Math.max(hookMin, Math.hypot(...sub(at, top)));
            hook.crate = cr;
            hook.rope = rope(world, tipBody(), cr.body, at, top, hook.line, cr.kg);
            return true;
        },
        /** Let the hooked crate go. */
        release() {
            if (!hook.crate) return false;
            if (world.hasJoint(hook.rope)) world.removeJoint(hook.rope);
            const P = world.pose(hook.crate.body), at = tipWorld();
            hook.line = Math.max(hookMin, at[1] - (P[1] + hook.crate.size / 2));
            hook.crate = null; hook.rope = null;
            return true;
        },
        /** Hang a `kg` test load on the tip (0 for none). */
        setPayload(kg) { if (Math.abs(kg - m.payloadKg) < 1e-9) return; m.payloadKg = kg; hang(kg); },
        /** Whether the hooked crate's rope carries it (the crate is off the ground). */
        carrying() {
            if (!hook.crate) return false;
            const P = world.pose(hook.crate.body);
            return P[1] - hook.crate.size / 2 > site.ground + hook.crate.size * 0.05;
        },

        _drive(dt) {
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
            // The hoist pays the line out or takes it in.
            if (hook.u !== 0 && m.powered) {
                hook.line = Math.max(hookMin, Math.min(size * 3, hook.line - hook.u * hook.speed * dt));
                if (hook.rope && world.hasJoint(hook.rope)) world.setJointTarget(hook.rope, hook.line, ropeHertz(hook.crate.kg, hook.line), 0.3, 0, true);
            }
        },
        _read() {
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
            for (const ct of controls) if (ct.output) ct.flow = m.powered && !ct.dark ? ct.u * ct.noLoad : 0;
        },
        _props() {
            const out = [];
            if (!tipAt) return out;
            const at = tipWorld();
            if (load) out.push({ kind: 'load', half: [load.side / 2, load.side / 2, load.side / 2], pose: world.pose(load.body), from: at });
            const hw = m.hookWorld();
            out.push({ kind: 'hook', machine: m, radius: Math.max(0.02, size * 0.012), pose: [...hw, 0, 0, 0, 1], from: at, hooked: !!hook.crate });
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
    const pass = ['frames', 'tip', 'tipWorld', 'hookWorld', 'set', 'hoist', 'grab', 'release', 'reachable', 'carrying'];
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
