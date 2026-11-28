// lib/foundry/compile.js — compile a design into a contract.
//
// A design is children (parts, or other designs by id), the links between
// their ports, the ports it exposes, and a goal:
//
//   { id, name, paint, note,
//     children: [{ id, part, params } | { id, design }, ... ]   each may carry
//               at: [x,y,z] and rot: 0..23 to fix it in place
//     links:    [{ a: 'child.port', b: 'child.port', spin }]
//     ports:    [{ id, label, at: 'child.port' }]
//     goal:     { out, given: { effort, flow }, need: { effort, flow }, box, massMax }
//             | { out, lift: { payloadKg, reachM }, box, massMax } }
//
// A design's level is one above the highest design it uses (parts are level
// 0), so a design of parts alone is level 1.
//
// Compiling places the children: the first child (or each one with `at`)
// stands where it is put, and a mechanical link (rot, lin) brings the child at
// its other end into place, port face to port face, turned `spin` quarter
// turns about the shared axis. Hoses and cables (hyd, elec) leave a child
// where it stands; a child nothing places sits beside the rest.
//
// The contract is all the next level up sees of it, and it has the same
// shape as a part (parts.js): a box, mass, placed ports, the paths power
// takes between them with their ratio, efficiency and the effort at which
// they give, the sources it drives and the supplies it holds, plus `shapes`,
// the boxes of its children, which are its solid body to the level above.
// A parent never looks inside a child's contract to compile, so a long chain
// of assemblies costs what its direct children cost.

import { buildPart } from "./parts.js";
import { rotApply, rotMapping, boxPlace, add, sub, neg, dist, ROTS } from "./rot.js";
import { legHolds } from "./operate.js";
import { STEP_M } from "./gait.js";

const MECH = new Set(['rot', 'lin', 'mnt']);
const TOUCH = 0.0015;          // metres two boxes may share before they clash
const MATE_TOL = 0.0015;       // metres between ports that count as meeting

function splitRef(ref) {
    const i = ref.lastIndexOf('.');
    return i < 0 ? [ref, ''] : [ref.slice(0, i), ref.slice(i + 1)];
}

function placePort(pl, port) {
    return { pos: add(rotApply(pl.rot, port.pos), pl.pos), axis: rotApply(pl.rot, port.axis) };
}

/** Element (part or contract) of a child spec. */
function elementOf(spec, lib, cache, stack) {
    if (spec.part) return buildPart(spec.part, spec.params);
    if (spec.design) return compileDesign(spec.design, lib, cache, stack);
    throw new Error('foundry: a child needs a part or a design');
}

/**
 * Compile design `id` of library `lib` ({ [id]: design }). `cache` (a Map)
 * keeps contracts between calls; pass the same one while editing and drop an
 * id (and whatever uses it, see invalidate()) when that design changes.
 */
export function compileDesign(id, lib, cache = new Map(), stack = []) {
    if (cache.has(id)) return cache.get(id);
    const d = lib[id];
    if (!d) throw new Error(`foundry: no design "${id}"`);
    if (stack.includes(id)) throw new Error(`foundry: "${id}" contains itself (${stack.concat(id).join(' › ')})`);
    const errors = [], warnings = [];

    // --- children ------------------------------------------------------------
    const kids = new Map();
    for (const c of d.children) {
        let el;
        try { el = elementOf(c, lib, cache, stack.concat(id)); }
        catch (e) { errors.push(`${c.id}: ${e.message}`); continue; }
        if (el.kind === 'contract' && !el.ok) errors.push(`${c.id} (${el.name}) does not compile`);
        kids.set(c.id, { spec: c, el, ports: new Map(el.ports.map((p) => [p.id, p])) });
    }

    // --- links ---------------------------------------------------------------
    const linkOf = new Map();       // 'child.port' -> { other: 'child.port', link }
    const links = [];
    for (const l of d.links || []) {
        const [ca, pa] = splitRef(l.a), [cb, pb] = splitRef(l.b);
        const A = kids.get(ca), B = kids.get(cb);
        const PA = A && A.ports.get(pa), PB = B && B.ports.get(pb);
        if (!PA || !PB) { errors.push(`link ${l.a} — ${l.b}: no such port`); continue; }
        if (PA.domain !== PB.domain) { errors.push(`link ${l.a} — ${l.b}: ${PA.domain} cannot drive ${PB.domain}`); continue; }
        if (PA.dir === PB.dir) { errors.push(`link ${l.a} — ${l.b}: two ${PA.dir}puts`); continue; }
        for (const ref of [l.a, l.b]) {
            if (linkOf.has(ref)) errors.push(`${ref} is linked twice`);
        }
        // Store out -> in.
        const out = PA.dir === 'out' ? l.a : l.b, inn = PA.dir === 'out' ? l.b : l.a;
        const rec = { out, in: inn, domain: PA.domain, spin: l.spin || 0, mech: MECH.has(PA.domain) };
        links.push(rec);
        linkOf.set(out, { other: inn, link: rec });
        linkOf.set(inn, { other: out, link: rec });
    }

    // --- placement -------------------------------------------------------------
    const place = new Map();        // child -> { pos, rot }
    const queue = [];
    const fix = (cid, pos, rot) => { place.set(cid, { pos, rot }); queue.push(cid); };
    for (const [cid, k] of kids) if (k.spec.at) fix(cid, k.spec.at.slice(), k.spec.rot || 0);
    const bfs = () => {
        while (queue.length) {
            const cid = queue.shift();
            const pl = place.get(cid);
            for (const [pid, p] of kids.get(cid).ports) {
                const lk = linkOf.get(`${cid}.${pid}`);
                if (!lk || !lk.link.mech) continue;
                const [oc, op] = splitRef(lk.other);
                if (place.has(oc)) continue;
                const O = kids.get(oc);
                const here = placePort(pl, p);
                const rot = rotMapping(O.ports.get(op).axis, neg(here.axis), lk.link.spin);
                const pos = sub(here.pos, rotApply(rot, O.ports.get(op).pos));
                fix(oc, pos, rot);
            }
        }
    };
    bfs();
    // The first child stands at the origin when nothing carries `at`.
    for (const [cid, k] of kids) {
        if (place.size) break;
        fix(cid, [0, 0, 0], k.spec.rot || 0);
        bfs();
    }
    // What nothing placed (cable- and hose-linked children, loose islands) sits
    // beside what stands, on -X, on the floor of it; an island follows its first child.
    let env = envelopeOf(kids, place);
    for (const [cid, k] of kids) {
        if (place.has(cid)) continue;
        const rot = k.spec.rot || 0;
        const b = boxPlace(k.el.box, rot, [0, 0, 0]);
        const gap = Math.max(0.006, (env ? env.max[1] - env.min[1] : 0.05) * 0.06);
        const pos = env
            ? [env.min[0] - gap - b.max[0], env.min[1] - b.min[1], (env.min[2] + env.max[2]) / 2 - (b.min[2] + b.max[2]) / 2]
            : [0, 0, 0];
        fix(cid, pos, rot);
        bfs();
        env = envelopeOf(kids, place);
    }

    // Every mechanical link must actually meet.
    for (const l of links) {
        if (!l.mech) continue;
        const [ca, pa] = splitRef(l.out), [cb, pb] = splitRef(l.in);
        const A = placePort(place.get(ca), kids.get(ca).ports.get(pa));
        const B = placePort(place.get(cb), kids.get(cb).ports.get(pb));
        const gap = dist(A.pos, B.pos);
        const facing = A.axis[0] === -B.axis[0] && A.axis[1] === -B.axis[1] && A.axis[2] === -B.axis[2];
        if (gap > MATE_TOL || !facing) {
            errors.push(`${l.out} does not meet ${l.in}: ${facing ? (gap * 1000).toFixed(1) + ' mm apart' : 'they face different ways'}`);
            l.misaligned = true;
        }
    }

    // --- solid bodies: child shapes in this frame, and their clashes -------------
    const shapes = [];
    for (const [cid, k] of kids) {
        const pl = place.get(cid);
        for (const s of k.el.shapes) {
            // A round solid's axis turns with it (quarter turns keep it on an axis).
            let round = null;
            if (s.round != null) { const u = [0, 0, 0]; u[s.round] = 1; const r = rotApply(pl.rot, u).map(Math.abs); round = r.indexOf(Math.max(...r)); }
            shapes.push({ child: cid, ...boxPlace(s, pl.rot, pl.pos), round });
        }
    }
    const clashes = [];
    for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
            const A = shapes[i], B = shapes[j];
            if (A.child === B.child) continue;
            const depth = overlapDepth(A, B);
            if (depth > TOUCH) {
                const key = A.child < B.child ? `${A.child}|${B.child}` : `${B.child}|${A.child}`;
                const prev = clashes.find((c) => c.key === key);
                if (!prev) clashes.push({ key, a: A.child, b: B.child, depth });
                else prev.depth = Math.max(prev.depth, depth);
            }
        }
    }
    for (const c of clashes) errors.push(`${c.a} runs ${(c.depth * 1000).toFixed(1)} mm into ${c.b}`);

    // --- envelope, mass ---------------------------------------------------------
    env = envelopeOf(kids, place) || { min: [0, 0, 0], max: [0, 0, 0] };
    const center = [0, 1, 2].map((a) => (env.min[a] + env.max[a]) / 2);
    let massKg = 0, partCount = 0;
    const com = [0, 0, 0];
    for (const [cid, k] of kids) {
        const pl = place.get(cid);
        const c = add(rotApply(pl.rot, k.el.com), pl.pos);
        massKg += k.el.massKg;
        partCount += k.el.partCount;
        for (let a = 0; a < 3; a++) com[a] += c[a] * k.el.massKg;
    }
    if (massKg > 0) for (let a = 0; a < 3; a++) com[a] /= massKg;

    // --- exposed ports ----------------------------------------------------------
    const exposed = new Map();      // 'child.port' -> exposed id
    const ports = [];
    for (const ep of d.ports || []) {
        const [cid, pid] = splitRef(ep.at);
        const k = kids.get(cid), p = k && k.ports.get(pid);
        if (!p) { errors.push(`port ${ep.id}: no ${ep.at}`); continue; }
        if (linkOf.has(ep.at)) errors.push(`port ${ep.id}: ${ep.at} is already linked inside`);
        const w = placePort(place.get(cid), p);
        exposed.set(ep.at, ep.id);
        ports.push({ id: ep.id, label: ep.label || p.label, domain: p.domain, dir: p.dir, pos: sub(w.pos, center), axis: w.axis, at: ep.at });
    }

    // --- behaviour: trace every exposed output back to what drives it ------------
    const traces = {};
    const paths = [], sources = [], supplies = [];
    const supplyUse = new Map();
    for (const ep of ports) {
        if (ep.dir !== 'out' || ep.domain === 'mnt') continue;
        const [cid, pid] = splitRef(ep.at);
        const k = kids.get(cid);
        const sup = k.el.supplies.find((s) => s.port === pid);
        if (sup) { supplies.push({ ...sup, port: ep.id }); continue; }
        const tr = trace(cid, pid, kids, linkOf, exposed, errors);
        traces[ep.id] = tr;
        const chain = combine(tr.stages);
        if (tr.root.kind === 'input') {
            paths.push({
                from: tr.root.port, to: ep.id, k: chain.K, eff: chain.E,
                cont: chain.cont, peak: chain.peak, flowMax: chain.flowMax,
                mode: chain.weakest ? chain.weakest.mode : 'holds', role: chain.weakest ? chain.weakest.role : undefined,
                label: chain.weakest ? chain.weakest.label : ep.label,
                weakest: chain.weakest, guarded: chain.guarded, stages: chain.stages, lock: chain.lock,
            });
        } else if (tr.root.kind === 'source') {
            const s = tr.root.src;
            const src = {
                port: ep.id,
                stall: s.stall * chain.K * chain.E,
                noLoad: s.noLoad / chain.K,
                cont: Math.min(s.cont * chain.K * chain.E, chain.cont),
                power: s.power * chain.E,
                peak: chain.peak,
                flowMax: Math.min(chain.flowMax, Infinity),
                weakest: chain.weakest, guarded: chain.guarded, stages: chain.stages,
                lock: lockThrough(chain, s.lock),
                draw: null, unpowered: false,
            };
            if (s.draw) {
                const ref = `${tr.root.child}.${s.draw.port}`;
                const eff = s.draw.eff * chain.E;
                if (exposed.has(ref)) src.draw = { port: exposed.get(ref), eff };
                else {
                    const lk = linkOf.get(ref);
                    const [sc, sp] = lk ? splitRef(lk.other) : [null, null];
                    const supEl = sc && kids.get(sc);
                    const sup = supEl && supEl.el.supplies.find((x) => x.port === sp);
                    if (sup) {
                        const need = src.power / eff;
                        supplyUse.set(lk.other, (supplyUse.get(lk.other) || 0) + need);
                        src.power = Math.min(src.power, sup.power * eff);
                        src.supply = { child: sc, power: sup.power, energyWh: sup.energyWh };
                    } else if (supEl && supEl.el.sources.some((x) => x.draw)) {
                        errors.push(`${ref}: drawn from something that is not a supply`);
                    } else {
                        src.unpowered = true;
                        warnings.push(`${tr.root.child} has no power: link or expose ${ref}`);
                    }
                }
            }
            // Drives side by side on a summing input: each one's own power line.
            for (const b of tr.root.parallel || []) {
                const d = b.root.src.draw;
                if (!d) continue;
                const ref = `${b.root.child}.${d.port}`;
                if (exposed.has(ref)) { if (!src.draw) src.draw = { port: exposed.get(ref), eff: d.eff * b.chain.E * chain.E }; continue; }
                const lk = linkOf.get(ref);
                const [sc, sp] = lk ? splitRef(lk.other) : [null, null];
                const sup = sc && kids.get(sc).el.supplies.find((x) => x.port === sp);
                if (sup) supplyUse.set(lk.other, (supplyUse.get(lk.other) || 0) + b.root.src.power / d.eff);
                else if (b.dark) warnings.push(`${b.root.child} has no power: link or expose ${ref}`);
            }
            if (src.stall > src.peak * 1.001) {
                const w = chain.weakest;
                if (w && w.role === 'limiter') src.stall = Math.min(src.stall, src.peak);
                else if (w) {
                    const u = ep.domain === 'lin' ? 'N' : 'N·m';
                    warnings.push(`${ep.label}: at stall, ${w.label} ${w.mode} (${si(src.stall, u)} against the ${si(src.peak, u)} it holds)`);
                }
            }
            if (src.noLoad > chain.flowMax * 1.001) warnings.push(`${ep.label}: runs faster than ${chain.flowWeakest} is good for`);
            sources.push(src);
        } else if (tr.root.kind === 'open') {
            warnings.push(`${ep.label}: nothing drives ${tr.root.ref}`);
        }
    }
    for (const [ref, need] of supplyUse) {
        const [sc, sp] = splitRef(ref);
        const sup = kids.get(sc).el.supplies.find((x) => x.port === sp);
        if (need > sup.power * 1.001) warnings.push(`${sc} gives ${fmtW(sup.power)}; its motors want ${fmtW(need)}`);
    }

    // --- statics: the joints, and what each mount can lift --------------------------
    // A joint is a boom (a part with `beam`) turned about its pivot. What it
    // holds is the lesser of the torque driving it and the beam's bending
    // strength. What it carries is everything outboard of it in the worst
    // pose, every joint straight out and level: a body's lever about a joint
    // is then its distance from that joint along the chain. `s` is that
    // distance measured from the design's base (its exposed mount input):
    // within a rigid group (what one joint swings, or what stands on the base)
    // it is the actual distance from the group's anchor, perpendicular to the
    // joint's axis, and across a joint the distances add. A nested design
    // comes up as `stretch` (its first moment of mass about its base and the
    // distance to each of its tips, stretched) and its joints, and this level
    // adds what it hangs on those tips.
    const G = 9.81;
    const lever = (pt, pivot, axis) => {
        const v = sub(pt, pivot), a = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
        return Math.hypot(v[0] - a * axis[0], v[1] - a * axis[1], v[2] - a * axis[2]);
    };
    const sAt = (g, p) => g.s + (g.axis ? lever(p, g.anchor, g.axis) : dist(p, g.anchor));
    const comOf = (cid) => { const pl = place.get(cid); return add(rotApply(pl.rot, kids.get(cid).el.com), pl.pos); };
    const portAt = (cid, pid) => placePort(place.get(cid), kids.get(cid).ports.get(pid));
    const joints = [];              // { label, cont, limit, mode, s, hold, innerTips? }
    const node = new Map();         // child -> { group, entry, s, sm, atBase, inner }
    const reach = [];
    const visit = (cid, entry, group) => {
        if (node.has(cid) || !place.has(cid)) return;
        const el = kids.get(cid).el;
        const atBase = !!(entry && el.kind === 'contract' && el.stretch && el.base === entry);
        const rec = { group, entry, atBase, inner: [], s: 0, sm: 0 };
        if (atBase) {
            rec.s = sAt(group, portAt(cid, entry).pos);
            rec.sm = el.stretch.moment;
            for (const J of el.joints) {
                // Its drive draws on power lines the design exposed, each turning its share of the
                // drive: a line that goes nowhere here loses its share, and losing them all turns nothing.
                const lines = (J.powers || []).map((p) => ({ ...p, ref: `${cid}.${p.port}` }));
                const lost = lines.filter((p) => !exposed.has(p.ref) && !linkOf.has(p.ref));
                const lostShare = Math.min(1, lost.reduce((a, p) => a + p.share, 0)), left = 1 - lostShare;
                const drive = (J.drive ?? J.cont) * left;
                const short = lost.length > 0 && drive < J.cont;
                const names = lost.map((p) => el.ports.find((q) => q.id === p.port).label).join(', ');
                joints.push({
                    child: cid, label: `${el.name} › ${J.label}`, cont: Math.min(J.cont, drive), drive, lock: J.lock,
                    limit: short ? `${cid} (no power on ${names})` : `${el.name} › ${J.limit}`,
                    mode: short ? 'cannot turn it' : J.mode, s: rec.s + J.s, hold: J.hold, innerTips: J.tips, bend: J.bend ?? null, beamMode: J.beamMode,
                    axis: J.axis ? rotApply(place.get(cid).rot, J.axis) : null, onBase: !!J.onBase && !group.anc.length,
                    // The lines still live, as this design gives them out, their shares of what is left.
                    powers: left > 1e-9 ? lines.filter((p) => !lost.includes(p) && exposed.has(p.ref)).map((p) => ({ port: exposed.get(p.ref), share: p.share / left })) : [],
                    // Its pin, the way its load hangs and its drive, as this design has them, and the joint that carries it.
                    pin: J.pin ? add(rotApply(place.get(cid).rot, J.pin), place.get(cid).pos) : null, dir: J.dir ? rotApply(place.get(cid).rot, J.dir) : null,
                    parent: J.parent != null ? rec.inner[J.parent] : (group.anc.at(-1) ?? null), nested: { child: cid, index: rec.inner.length },
                    speed: J.speed ?? null, stall: J.stall != null ? J.stall * left : null, wheel: J.wheel || null,
                });
                rec.inner.push(joints.length - 1);
            }
        } else rec.s = sAt(group, comOf(cid));
        node.set(cid, rec);
        reach.push(cid);
    };
    const driveOf = (cid, pin) => {
        const ref = `${cid}.${pin}`, lk = linkOf.get(ref);
        if (!lk) return exposed.has(ref) ? { torque: Infinity, label: 'what drives it' } : { torque: 0, label: 'nothing drives it' };
        const [oc, op] = splitRef(lk.other);
        const errs = [], tr = trace(oc, op, kids, linkOf, exposed, errs);
        for (const e of errs) if (!errors.includes(e)) errors.push(e);
        const ch = combine(tr.stages);
        if (tr.root.kind === 'input') return { torque: ch.cont, label: ch.weakest ? ch.weakest.label : 'its input', lock: ch.lock };
        if (tr.root.kind !== 'source') return { torque: 0, label: 'nothing drives it', lock: null };
        if (tr.root.parallel) {
            // Drives side by side: the dark ones already give nothing in the sum.
            const P = tr.root.parallel, lit = P.filter((b) => !b.dark), s = tr.root.src.cont * ch.K * ch.E;
            const ring = kids.get(tr.root.child).el;
            // Each drive's share of the sum, on the power line it draws on (when the design gives that out).
            const give = (b) => Math.min(b.root.src.cont * b.chain.K * b.chain.E, b.chain.cont), total = lit.reduce((a, b) => a + give(b), 0) || 1;
            const powers = lit.map((b) => ({ b, ref: b.root.src.draw && `${b.root.child}.${b.root.src.draw.port}` }))
                .filter((x) => x.ref && exposed.has(x.ref)).map((x) => ({ port: exposed.get(x.ref), share: give(x.b) / total }));
            return {
                torque: Math.min(s, ch.cont), lock: lockThrough(ch, tr.root.src.lock), powers,
                speed: tr.root.src.noLoad / ch.K, stall: Math.min(tr.root.src.stall * ch.K * ch.E, ch.peak),
                label: !lit.length ? `${tr.root.child} (no power on any of its drives)` : ch.cont < s && ch.weakest ? ch.weakest.label : `${lit.length} drives on ${ring.label} (${tr.root.child})`,
            };
        }
        // A source that draws power from nothing turns nothing; a locking drive still holds.
        const dw = tr.root.src.draw && `${tr.root.child}.${tr.root.src.draw.port}`;
        if (dw && !exposed.has(dw) && !linkOf.has(dw)) return { torque: 0, label: `${tr.root.child} (no power)`, lock: lockThrough(ch, tr.root.src.lock) };
        const s = tr.root.src.cont * ch.K * ch.E, root = kids.get(tr.root.child).el;
        return {
            torque: Math.min(s, ch.cont), lock: lockThrough(ch, tr.root.src.lock),
            powers: dw && exposed.has(dw) ? [{ port: exposed.get(dw), share: 1 }] : [],
            speed: tr.root.src.noLoad / ch.K, stall: Math.min(tr.root.src.stall * ch.K * ch.E, ch.peak),
            label: ch.cont < s && ch.weakest ? ch.weakest.label : (root.kind === 'contract' ? root.name : `${root.label} (${tr.root.child})`),
        };
    };
    const walk = () => {
        while (reach.length) {
            const cid = reach.shift(), rec = node.get(cid), k = kids.get(cid);
            for (const [pid, p] of k.ports) {
                if (pid === rec.entry) continue;
                const lk = linkOf.get(`${cid}.${pid}`);
                if (!lk || !lk.link.mech) continue;
                const [oc, op] = splitRef(lk.other);
                if (node.has(oc)) continue;
                const O = kids.get(oc), Op = O.ports.get(op);
                if (O.el.wheel && Op.domain === 'rot' && Op.dir === 'in') {
                    // A wheel: it turns on and on about its hub, carrying nothing but itself, and
                    // rolls with its drive's torque over its radius. What it stands on is its tyre
                    // and the axle under it (the part it turns on, when that says what it carries).
                    const pin = portAt(oc, op), dr = driveOf(oc, op), Wl = O.el.wheel, ax = k.el.axle;
                    joints.push({
                        child: oc, label: `${O.el.label} (${oc})`, cont: dr.torque, limit: dr.label, mode: 'cannot turn it',
                        s: sAt(rec.group, pin.pos), hold: 0, bend: null, beamMode: null, axis: pin.axis, onBase: !rec.group.anc.length,
                        lock: dr.lock ?? null, drive: dr.torque, powers: dr.powers || [],
                        pin: pin.pos, parent: rec.group.anc.at(-1) ?? null, nested: null, speed: dr.speed ?? null, stall: dr.stall ?? null,
                        wheel: {
                            radius: Wl.radius, width: Wl.width, grip: Wl.grip,
                            loadN: Math.min(Wl.loadN, ax ? ax.loadN : Infinity),
                            carryBy: ax && ax.loadN < Wl.loadN ? `${k.el.label} (${cid})` : `${O.el.label} (${oc})`,
                            carryMode: ax && ax.loadN < Wl.loadN ? ax.mode : Wl.mode,
                        },
                    });
                    const j = joints.length - 1;
                    visit(oc, op, { anchor: pin.pos, axis: pin.axis, s: joints[j].s, anc: [...rec.group.anc, j] });
                } else if (O.el.beam && Op.domain === 'rot' && Op.dir === 'in') {
                    // A joint: the boom and what it carries swing about its pin.
                    const pin = portAt(oc, op), dr = driveOf(oc, op), bend = O.el.beam.bend, byBeam = bend <= dr.torque;
                    joints.push({
                        child: oc, label: `${O.el.label} (${oc})`, cont: Math.min(bend, dr.torque),
                        limit: byBeam ? `${O.el.label} (${oc})` : dr.label, mode: byBeam ? O.el.beam.mode : 'cannot turn it',
                        s: sAt(rec.group, pin.pos), hold: 0, bend, beamMode: O.el.beam.mode, axis: pin.axis, onBase: !rec.group.anc.length,
                        // Held with the power off: a self-locking drive, as far as the beam takes it.
                        lock: dr.lock != null ? Math.min(bend, dr.lock) : null, drive: dr.torque, powers: dr.powers || [],
                        pin: pin.pos, parent: rec.group.anc.at(-1) ?? null, nested: null, speed: dr.speed ?? null, stall: dr.stall ?? null,
                    });
                    const j = joints.length - 1;
                    visit(oc, op, { anchor: pin.pos, axis: pin.axis, s: joints[j].s, anc: [...rec.group.anc, j] });
                } else if (rec.atBase && p.domain === 'mnt' && p.dir === 'out' && k.el.stretch.tips[pid] != null) {
                    // Out of a nested design's tip: beyond its joints, at its stretched reach.
                    const inner = rec.inner.filter((j) => joints[j].innerTips.includes(pid));
                    visit(oc, op, { anchor: portAt(cid, pid).pos, axis: null, s: rec.s + k.el.stretch.tips[pid], anc: [...rec.group.anc, ...inner] });
                } else visit(oc, op, rec.group);
            }
        }
    };
    const baseEp = ports.find((ep) => ep.domain === 'mnt' && ep.dir === 'in');
    if (baseEp) {
        const [bc, bp] = splitRef(baseEp.at);
        visit(bc, bp, { anchor: portAt(bc, bp).pos, axis: null, s: 0, anc: [] });
        walk();
    }
    for (const cid of kids.keys()) {
        if (node.has(cid) || !place.has(cid)) continue;
        visit(cid, null, { anchor: comOf(cid), axis: null, s: 0, anc: [] });
        walk();
    }
    // Each body's weight on every joint inboard of it.
    let stretchMoment = 0;
    for (const [cid, rec] of node) {
        const m = kids.get(cid).el.massKg;
        stretchMoment += m * rec.s + rec.sm;
        for (const j of rec.group.anc) joints[j].hold += G * (m * (rec.s - joints[j].s) + rec.sm);
    }
    // Which way each joint's load hangs from its pin: the mass-weighted centre of what it carries
    // (a nested joint brings its own). The machine model raises a joint by turning this upward.
    for (let j = 0; j < joints.length; j++) {
        const J = joints[j];
        if (J.dir || !J.pin) continue;
        let sum = [0, 0, 0], mt = 0;
        for (const [cid, rec] of node) {
            if (!rec.group.anc.includes(j)) continue;
            const m = kids.get(cid).el.massKg, d = sub(comOf(cid), J.pin);
            sum = add(sum, d.map((v) => v * m)); mt += m;
        }
        J.dir = mt > 0 ? sum.map((v) => v / mt) : null;
    }
    // The joint that carries each child (the last inboard of it), for posing.
    const carrierOf = (cid) => { const rec = node.get(cid); return rec ? (rec.group.anc.at(-1) ?? null) : null; };
    // `hold` is the worst pose, the joint level: what a design used at any angle owes the level
    // above. Standing on its base, a joint on the base itself whose axis runs the way the base
    // faces (a turntable) swings everything round level: gravity puts no torque on its drive,
    // and what holds the weight up is its boom's bending strength alone (`carry`, by `carryBy`).
    // A machine on wheels has no base: down is through the frame its wheels hang from.
    // Feet: each foot part's sole (the middle of its underside) and each nested design's feet,
    // where this design has them, and the joint that carries each (the last inboard of it).
    const feet = [];
    for (const [cid, k] of kids) {
        if (!place.has(cid) || !node.has(cid)) continue;
        const pl = place.get(cid), rec = node.get(cid), at = (p) => add(rotApply(pl.rot, p), pl.pos);
        if (k.el.foot) {
            const F = k.el.foot;
            feet.push({ child: cid, label: `${k.el.label} (${cid})`, pos: at([0, -F.depth, 0]), down: rotApply(pl.rot, [0, -1, 0]), size: F.size, grip: F.grip, loadN: F.loadN, mode: F.mode, carrier: rec.group.anc.at(-1) ?? null });
        } else if (k.el.kind === 'contract' && k.el.feet) {
            for (const F of k.el.feet) feet.push({ ...F, child: cid, label: `${k.el.name} › ${F.label}`, pos: at(F.pos), down: rotApply(pl.rot, F.down), carrier: F.carrier != null ? rec.inner[F.carrier] : (rec.group.anc.at(-1) ?? null) });
        }
    }
    const bedKid = !baseEp && (joints.some((J) => J.wheel) || feet.length) ? [...kids.keys()].find((cid) => place.has(cid) && kids.get(cid).el.bed) : null;
    const baseAxis = baseEp ? portAt(...splitRef(baseEp.at)).axis : bedKid ? rotApply(place.get(bedKid).rot, [0, -1, 0]) : null;
    for (const J of joints) {
        J.upright = !!(baseAxis && J.onBase && J.axis && Math.abs(J.axis[0] * baseAxis[0] + J.axis[1] * baseAxis[1] + J.axis[2] * baseAxis[2]) > 0.999);
        J.carry = J.upright ? (J.bend ?? Infinity) : J.cont;
        J.carryBy = J.upright ? 'its boom' : J.limit;
    }
    const sagging = joints.filter((J) => J.hold > J.carry).sort((a, b) => b.hold / b.carry - a.hold / a.carry);
    for (const J of sagging.slice(0, 3)) {
        warnings.push(`${J.child && !J.label.includes(`(${J.child})`) ? `${J.child}: ` : ""}${J.label} cannot hold up what hangs on it: ${si(J.hold, 'N·m')} against the ${si(J.carry, 'N·m')} ${J.carryBy} holds`);
    }
    if (sagging.length > 3) warnings.push(`${sagging.length - 3} more joints cannot hold up what hangs on them`);
    // Every exposed mount output: its stretched reach and what it lifts there.
    const tipOf = (cid, pid) => {
        const rec = node.get(cid), el = kids.get(cid).el;
        if (rec.atBase && el.stretch.tips[pid] != null) {
            return { s: rec.s + el.stretch.tips[pid], anc: [...rec.group.anc, ...rec.inner.filter((j) => joints[j].innerTips.includes(pid))] };
        }
        return { s: sAt(rec.group, portAt(cid, pid).pos), anc: rec.group.anc };
    };
    const mounts = [], tipS = {}, tipAnc = {};
    for (const ep of ports) {
        if (ep.domain !== 'mnt' || ep.dir !== 'out') continue;
        const t = tipOf(...splitRef(ep.at));
        tipS[ep.id] = t.s;
        tipAnc[ep.id] = t.anc;
        // payloadKg: what the joints lift there; holdKg: what they hold with the
        // power off (nothing, unless every one of them locks).
        let best = { port: ep.id, payloadKg: Infinity, holdKg: Infinity, reach: t.s, weakest: null };
        for (const j of t.anc) {
            const J = joints[j], r = t.s - J.s;
            const per = (torque) => (r > 1e-6 ? Math.max(0, torque - J.hold) / (G * r) : Infinity);
            const kg = per(J.carry);
            // A turntable holds with the power off: gravity does not turn it.
            best.holdKg = Math.min(best.holdKg, J.upright ? kg : J.lock != null ? per(J.lock) : 0);
            if (kg < best.payloadKg) Object.assign(best, { payloadKg: kg, weakest: J.label, limit: J.carryBy, mode: J.upright ? J.beamMode : J.mode });
        }
        if (!t.anc.length) best.holdKg = Infinity;
        mounts.push(best);
    }

    // A machine on wheels: how fast it goes, what it pushes with and carries, and how steep
    // a slope it climbs (empty, and with `kg` aboard). Its weight shares out over its
    // wheels; each pushes with the lesser of its drive over its radius and its grip on
    // that share, against a rolling resistance of 2% of the weight.
    let vehicle = null;
    const wheelJ = joints.map((J, j) => (J.wheel ? j : -1)).filter((j) => j >= 0);
    if (bedKid && wheelJ.length) {
        const n = wheelJ.length, R = (j) => joints[j].wheel.radius;
        const weakest = wheelJ.reduce((a, j) => (joints[j].wheel.loadN < joints[a].wheel.loadN ? j : a), wheelJ[0]);
        const payloadKg = Math.max(0, (n * joints[weakest].wheel.loadN) / G - massKg);
        const speed = Math.min(...wheelJ.map((j) => (joints[j].speed ?? 0) * R(j)));
        const P = kids.get(bedKid), bed = P.el.bed, pl = place.get(bedKid);
        // Each wheel: the most its drive pushes with, and its grip.
        const push = wheelJ.map((j) => ({ maxN: joints[j].cont / R(j), grip: joints[j].wheel.grip }));
        vehicle = {
            wheels: wheelJ, speed, push, massKg, payloadKg, grade: gradeOf({ push }, massKg),
            gradeFull: gradeOf({ push }, massKg + payloadKg), carryBy: joints[weakest].wheel.carryBy, carryMode: joints[weakest].wheel.carryMode,
            down: baseAxis,
            // Its deck, where a load can be set down: the middle of its top face and its half sizes.
            bed: { center: sub(add(rotApply(pl.rot, [0, bed.top, 0]), pl.pos), center), half: bed.half, axes: [rotApply(pl.rot, [1, 0, 0]), rotApply(pl.rot, [0, 0, 1])] },
        };
        if (payloadKg <= 0) warnings.push(`its wheels cannot carry its own weight: ${joints[weakest].wheel.carryBy} ${joints[weakest].wheel.carryMode}`);
    }
    // A machine on feet: its legs (each foot, and the joints from the frame out to it), its deck,
    // and what it carries: standing on all but one foot while that one steps, each foot it stands
    // on bears its share of the weight, so the payload is what the fewest bear, less itself.
    let walker = null;
    if (bedKid && !wheelJ.length && feet.length) {
        const P = kids.get(bedKid), bed = P.el.bed, pl = place.get(bedKid);
        const chain = (j) => { const out = []; while (j != null) { out.unshift(j); j = joints[j].parent; } return out; };
        const legs = feet.map((F) => ({ foot: { ...F, pos: sub(F.pos, center) }, joints: chain(F.carrier) }));
        const weakest = feet.reduce((a, F) => (F.loadN < a.loadN ? F : a), feet[0]);
        const standing = Math.max(1, feet.length - 1);
        const payloadKg = Math.max(0, (standing * weakest.loadN) / G - massKg);
        walker = {
            legs, massKg, payloadKg, carryBy: weakest.label, carryMode: weakest.mode,
            down: baseAxis,
            bed: { center: sub(add(rotApply(pl.rot, [0, bed.top, 0]), pl.pos), center), half: bed.half, axes: [rotApply(pl.rot, [1, 0, 0]), rotApply(pl.rot, [0, 0, 1])] },
        };
        if (payloadKg <= 0) warnings.push(`its feet cannot carry its own weight: ${weakest.label} ${weakest.mode}`);
    }

    // Exposed outputs of supplies that are not driven by a trace (battery-only designs).
    const children = [];
    for (const [cid, k] of kids) {
        const pl = place.get(cid);
        children.push({ id: cid, spec: k.spec, el: k.el, pos: sub(pl.pos, center), rot: pl.rot, carrier: carrierOf(cid) });
    }

    const contract = {
        kind: 'contract',
        id, name: d.name, level: 1 + Math.max(0, ...[...kids.values()].map((k) => (k.el.kind === 'contract' ? k.el.level : 0))), paint: d.paint, note: d.note || '',
        ok: errors.length === 0,
        errors, warnings,
        box: { min: sub(env.min, center), max: sub(env.max, center) },
        size: sub(env.max, env.min),
        massKg, com: sub(com, center), partCount,
        ports, paths, sources, supplies,
        shapes: shapes.map((s) => ({ child: s.child, min: sub(s.min, center), max: sub(s.max, center), round: s.round })),
        children, links, clashes, traces,
        base: baseEp ? baseEp.id : null,
        stretch: baseEp ? { moment: stretchMoment, tips: tipS } : null,
        joints: joints.map((J, j) => ({
            child: J.child, label: J.label, cont: J.cont, lock: J.lock, limit: J.limit, mode: J.mode, s: J.s, hold: J.hold, drive: J.drive ?? J.cont, powers: J.powers || [],
            axis: J.axis, onBase: J.onBase, bend: J.bend ?? null, beamMode: J.beamMode || null, upright: J.upright, carry: J.carry, carryBy: J.carryBy,
            pin: J.pin ? sub(J.pin, center) : null, dir: J.dir || null, parent: J.parent, nested: J.nested, speed: J.speed, stall: J.stall, wheel: J.wheel || null,
            tips: Object.keys(tipAnc).filter((t) => tipAnc[t].includes(j)),
        })),
        mounts, vehicle, walker,
        // Its feet, where this design has them, each with the joint that carries it.
        feet: feet.map((F) => ({ ...F, pos: sub(F.pos, center), child: F.child })),
    };
    contract.goal = evaluateGoal(d.goal, contract);
    cache.set(id, contract);
    return contract;
}

/**
 * How far solids A and B run into one another (0 or less: apart). Boxes by
 * their overlap on each axis; a round solid (a cylinder about axis `round`,
 * filling its box across) is a circle across that axis, so two drives side by
 * side on a ring clash only when their bodies, not their boxes, meet.
 */
function overlapDepth(A, B) {
    const o = [0, 1, 2].map((a) => Math.min(A.max[a], B.max[a]) - Math.max(A.min[a], B.min[a]));
    if (!(o[0] > 0 && o[1] > 0 && o[2] > 0)) return Math.min(...o);
    const ax = A.round ?? B.round;
    if (ax == null || (A.round != null && B.round != null && A.round !== B.round)) return Math.min(...o);
    if (o[ax] <= 0) return o[ax];
    const [p, q] = [0, 1, 2].filter((a) => a !== ax);
    const circle = (S) => ({ c: [(S.min[p] + S.max[p]) / 2, (S.min[q] + S.max[q]) / 2], r: Math.min(S.max[p] - S.min[p], S.max[q] - S.min[q]) / 2 });
    let across;
    if (A.round != null && B.round != null) {
        const a = circle(A), b = circle(B);
        across = a.r + b.r - Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]);
    } else {
        // A circle against a box's face across: from the circle's centre to the nearest point of the rectangle.
        const [C, R] = A.round != null ? [circle(A), B] : [circle(B), A];
        const nx = Math.max(R.min[p], Math.min(C.c[0], R.max[p])), ny = Math.max(R.min[q], Math.min(C.c[1], R.max[q]));
        across = C.r - Math.hypot(C.c[0] - nx, C.c[1] - ny);
    }
    return Math.min(o[ax], across, o[p], o[q]);
}

function envelopeOf(kids, place) {
    let env = null;
    for (const [cid, k] of kids) {
        const pl = place.get(cid);
        if (!pl) continue;
        const b = boxPlace(k.el.box, pl.rot, pl.pos);
        if (!env) env = { min: b.min.slice(), max: b.max.slice() };
        else for (let a = 0; a < 3; a++) { env.min[a] = Math.min(env.min[a], b.min[a]); env.max[a] = Math.max(env.max[a], b.max[a]); }
    }
    return env;
}

/** Walk from out-port `pid` of child `cid` upstream to a source, an exposed input, or nothing. */
function trace(cid, pid, kids, linkOf, exposed, errors, depth = 0) {
    if (depth > 4096) { errors.push('a power path loops'); return { root: { kind: 'open', ref: `${cid}.${pid}` }, stages: [] }; }
    const k = kids.get(cid);
    const src = k.el.sources.find((s) => s.port === pid);
    if (src) return { root: { kind: 'source', src, child: cid }, stages: [] };
    const path = k.el.paths.find((p) => p.to === pid);
    if (!path) return { root: { kind: 'open', ref: `${cid}.${pid}` }, stages: [] };
    const stage = { child: cid, path, el: k.el };
    if (Array.isArray(path.from)) { const r = sumOf(cid, path, kids, linkOf, exposed, errors, depth); r.stages.push(stage); return r; }
    const inRef = `${cid}.${path.from}`;
    if (exposed.has(inRef)) return { root: { kind: 'input', port: exposed.get(inRef) }, stages: [stage] };
    const lk = linkOf.get(inRef);
    if (!lk) return { root: { kind: 'open', ref: inRef }, stages: [stage] };
    const [oc, op] = splitRef(lk.other);
    const up = trace(oc, op, kids, linkOf, exposed, errors, depth + 1);
    up.stages.push(stage);
    return up;
}

/**
 * A path with several inputs that add (a slewing ring's pinions, `from` a list):
 * each input traced on its own, and what they give together at the inputs.
 *
 * Driven by sources, it is one source standing at the inputs: the drives' torques
 * add, the slowest sets the speed, and `parallel` keeps each branch (its source,
 * the stages between, and the input it drives) for power checks and spinning.
 * A branch with no power gives nothing. Driven from the design's own inputs, it
 * is an input that is all of them, through one stage standing for the branches
 * side by side. Branches must all be sources or all inputs; one left loose is
 * an error, since a pinion that is not driven is a brake on the rest.
 */
function sumOf(cid, path, kids, linkOf, exposed, errors, depth) {
    const branches = path.from.map((pin) => {
        const ref = `${cid}.${pin}`;
        if (exposed.has(ref)) return { pin, root: { kind: 'input', port: exposed.get(ref) }, stages: [] };
        const lk = linkOf.get(ref);
        if (!lk) return { pin, root: { kind: 'open', ref }, stages: [] };
        const [oc, op] = splitRef(lk.other);
        return { pin, ...trace(oc, op, kids, linkOf, exposed, errors, depth + 1) };
    });
    const open = branches.filter((b) => b.root.kind === 'open');
    if (open.length === branches.length) return { root: open[0].root, stages: [] };
    if (open.length) errors.push(`${cid}: ${open.length} of its ${branches.length} inputs are not driven, and drag on the rest (${open.map((b) => b.pin).join(', ')})`);
    const live = branches.filter((b) => b.root.kind !== 'open');
    for (const b of live) b.chain = combine(b.stages);
    if (live.every((b) => b.root.kind === 'source')) {
        const dark = (b) => { const d = b.root.src.draw; const ref = d && `${b.root.child}.${d.port}`; return !!(ref && !exposed.has(ref) && !linkOf.has(ref)); };
        let stall = 0, cont = 0, power = 0, lock = 0, noLoad = Infinity;
        for (const b of live) {
            const s = b.root.src, ch = b.chain;
            noLoad = Math.min(noLoad, s.noLoad / ch.K, ch.flowMax);
            const l = lockThrough(ch, s.lock);
            lock = l == null || lock == null ? null : lock + l;
            if (dark(b)) continue;
            stall += Math.min(s.stall * ch.K * ch.E, ch.peak);
            cont += Math.min(s.cont * ch.K * ch.E, ch.cont);
            power += s.power * ch.E;
        }
        const src = { port: live[0].pin, stall, noLoad, cont, power, lock, draw: null };
        return { root: { kind: 'source', src, child: cid, parallel: live.map((b) => ({ pin: b.pin, root: b.root, stages: b.stages, chain: b.chain, dark: dark(b) })) }, stages: [] };
    }
    if (live.every((b) => b.root.kind === 'input')) {
        const ch = live.map((b) => b.chain), sum = (f) => ch.reduce((a, c) => a + f(c), 0);
        const side = {
            from: live.map((b) => b.pin), to: live.map((b) => b.pin), k: ch[0].K, eff: Math.min(...ch.map((c) => c.E)),
            cont: sum((c) => c.cont), peak: sum((c) => c.peak), flowMax: Math.min(...ch.map((c) => c.flowMax)),
            mode: (ch[0].weakest && ch[0].weakest.mode) || 'holds', label: `${live.length} inputs side by side`,
        };
        if (ch.some((c) => Math.abs(c.K - ch[0].K) > ch[0].K * 0.01)) errors.push(`${cid}: its inputs are geared differently, so they fight`);
        return { root: { kind: 'input', port: live.map((b) => b.root.port) }, stages: [{ child: cid, path: side, el: kids.get(cid).el, side: true }] };
    }
    errors.push(`${cid}: its inputs are driven partly from inside and partly from outside the design`);
    return { root: { kind: 'open', ref: `${cid}.${path.from[0]}` }, stages: [] };
}

/**
 * 'rot>hyd' when a stage takes in one kind of motion and gives out another
 * (its ratio is then between unlike units and says nothing on its own), else null.
 */
function convertOf(s) {
    const ports = s.el && s.el.ports;
    const a = ports && ports.find((x) => x.id === s.path.from), b = ports && ports.find((x) => x.id === s.path.to);
    return a && b && a.domain !== b.domain ? `${a.domain}>${b.domain}` : null;
}

/**
 * Compose a run of stages (upstream first). Every limit is moved to the end
 * of the run: a stage's effort at the output is its own times the gain of
 * everything after it, its flow its own over the ratio after it.
 */
function combine(stages) {
    let K = 1, E = 1;
    for (const s of stages) { K *= s.path.k; E *= s.path.eff; }
    const out = [];
    let gain = 1, ratio = 1;
    let cont = Infinity, peak = Infinity, flowMax = Infinity, flowWeakest = '';
    for (let i = stages.length - 1; i >= 0; i--) {
        const s = stages[i], p = s.path;
        const atOut = { child: s.child, label: stageLabel(s), mode: p.mode, role: p.role, cont: p.cont * gain, peak: p.peak * gain, flowMax: p.flowMax / ratio, k: p.k, eff: p.eff, nested: p.weakest || null, gain, locks: !!p.selfLocking || p.lock != null, convert: convertOf(s) };
        out.unshift(atOut);
        cont = Math.min(cont, atOut.cont);
        if (atOut.peak < peak) peak = atOut.peak;
        if (atOut.flowMax < flowMax) { flowMax = atOut.flowMax; flowWeakest = atOut.label; }
        gain *= p.k * p.eff;
        ratio *= p.k;
    }
    // What the run holds at its output with the power off: a stage that
    // cannot be driven backwards (a self-locking worm, or a nested run with
    // one) holds the load, and so does everything after it, up to the least
    // of what those stages carry standing still (a held load does not wear
    // teeth the way a turning one does: it is their static strength, not
    // their running rating). null when nothing locks.
    let lock = null;
    for (let i = 0; i < stages.length; i++) {
        const p = stages[i].path;
        let L = p.selfLocking ? out[i].peak : p.lock != null ? p.lock * out[i].gain : null;
        if (L == null) continue;
        for (let j = i + 1; j < out.length; j++) L = Math.min(L, out[j].peak);
        lock = lock == null ? L : Math.max(lock, L);
    }
    // Who gives first, and whether that is a part meant to.
    let weakest = null, guarded = null;
    for (const s of out) if (!weakest || s.peak < weakest.peak) weakest = s;
    if (weakest && (weakest.role === 'limiter' || weakest.role === 'fuse')) {
        for (const s of out) {
            if (s.role === 'limiter' || s.role === 'fuse') continue;
            if (!guarded || s.peak < guarded.peak) guarded = s;
        }
    }
    return { K, E, cont, peak, flowMax, flowWeakest, weakest, guarded, stages: out, lock };
}

/** What a run holds with the power off: its own lock, or a locked source's carried through it. */
function lockThrough(chain, rootLock) {
    const fromRoot = rootLock != null ? Math.min(rootLock * chain.K, chain.cont) : null;
    if (fromRoot == null) return chain.lock;
    return chain.lock == null ? fromRoot : Math.max(chain.lock, fromRoot);
}

function stageLabel(s) {
    if (s.side) return `${s.path.label} (${s.child})`;
    if (s.el.kind === 'contract') return s.path.weakest ? `${s.el.name} › ${s.path.weakest.label}` : s.el.name;
    return `${s.el.label} (${s.child})`;
}

// A number with its SI prefix on the unit: si(3.9e6, 'N·m') → '3.9 MN·m'.
function si(v, unit) {
    for (const [s, p] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']]) if (Math.abs(v) >= s) return `${(v / s).toFixed(v / s >= 100 ? 0 : 1)} ${p}${unit}`;
    return `${v.toFixed(0)} ${unit}`;
}
function fmtW(v) { return si(v, 'W'); }

/**
 * The goal of a design, judged against its contract. A goal names an output
 * and what it must give there: need.effort held at need.flow. For a path the
 * input it is given decides what comes out (given.effort, given.flow); a
 * source drives itself. box: the space it must fit (any way round); massMax.
 */
/**
 * The steepest slope (rad) vehicle `v` climbs weighing `kg` in all: its weight shared over
 * its wheels, each pushing with the lesser of its drive and its grip on its share, against
 * a rolling resistance of 2% of the weight.
 */
export function gradeOf(v, kg) {
    const n = v.push.length, W = 9.81 * kg;
    const push = v.push.reduce((a, w) => a + Math.min(w.maxN, (w.grip * W) / n), 0);
    return Math.asin(Math.max(-1, Math.min(1, (push - 0.02 * W) / W)));
}

export function evaluateGoal(goal, c) {
    if (!goal) return null;
    const checks = [];
    if (goal.drive) {
        // A drive goal: `drive.speedMs` flat out, `drive.payloadKg` aboard, and up a slope of
        // `drive.gradePct` (rise over run, %) with it aboard.
        const v = c.vehicle, D = goal.drive;
        const sp = v ? v.speed : 0, kg = v ? v.payloadKg : 0;
        const gr = v ? Math.tan(gradeOf(v, c.massKg + Math.min(D.payloadKg ?? v.payloadKg, v.payloadKg))) * 100 : 0;
        checks.push({ id: 'speed', label: 'top speed', kind: 'speed', want: D.speedMs, got: sp, pass: sp >= D.speedMs * 0.999 });
        if (D.payloadKg != null) checks.push({ id: 'payload', label: 'carries', kind: 'payload', want: D.payloadKg, got: kg, pass: kg >= D.payloadKg * 0.999 });
        if (D.gradePct != null) checks.push({ id: 'grade', label: 'climbs, loaded', kind: 'grade', want: D.gradePct, got: gr, pass: gr >= D.gradePct * 0.999 });
        if (goal.massMax) checks.push({ id: 'mass', label: 'mass', kind: 'mass', want: goal.massMax, got: c.massKg, pass: c.massKg <= goal.massMax });
        if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
        return { checks, pass: checks.every((x) => x.pass), drive: D };
    }
    if (goal.wheel) {
        // A wheel goal (one corner of a machine on wheels): stands under `wheel.loadKg` and
        // pushes with `wheel.pushN` at the ground, steady.
        const J = (c.joints || []).find((j) => j.wheel), W = goal.wheel;
        const kg = J ? J.wheel.loadN / 9.81 : 0, push = J ? J.cont / J.wheel.radius : 0;
        checks.push({ id: 'payload', label: 'carries', kind: 'payload', want: W.loadKg, got: kg, pass: kg >= W.loadKg * 0.999 });
        checks.push({ id: 'push', label: 'pushes', kind: 'push', want: W.pushN, got: push, pass: push >= W.pushN * 0.999 });
        if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
        return { checks, pass: checks.every((x) => x.pass), wheel: W };
    }
    if (goal.leg) {
        // A leg goal: stood as a walker stands it, its foot bears `leg.loadKg` without
        // sinking, and its joints hold that up.
        const L = goal.leg, F = (c.feet || [])[0];
        const bears = F ? F.loadN / 9.81 : 0, holds = F ? legHolds(c)[0] / 9.81 : 0;
        checks.push({ id: 'bears', label: 'foot bears', kind: 'payload', want: L.loadKg, got: bears, pass: bears >= L.loadKg * 0.999 });
        checks.push({ id: 'holds', label: 'joints hold', kind: 'payload', want: L.loadKg, got: holds, pass: holds >= L.loadKg * 0.999 });
        if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
        return { checks, pass: checks.every((x) => x.pass), leg: L };
    }
    if (goal.walk) {
        // A walk goal: on three feet (the fourth stepping), `walk.payloadKg` aboard, held by
        // its feet and its weakest leg's joints; and it steps up `walk.stepM`.
        const Wk = goal.walk, w = c.walker;
        const held = w ? (Math.max(1, w.legs.length - 1) * Math.min(...legHolds(c))) / 9.81 - c.massKg : 0;
        const kg = w ? Math.min(w.payloadKg, held) : 0, step = w ? STEP_M : 0;
        checks.push({ id: 'payload', label: 'carries', kind: 'payload', want: Wk.payloadKg, got: kg, pass: kg >= Wk.payloadKg * 0.999 });
        if (Wk.stepM != null) checks.push({ id: 'step', label: 'steps up', kind: 'reach', want: Wk.stepM, got: step, pass: step >= Wk.stepM * 0.999 });
        if (goal.massMax) checks.push({ id: 'mass', label: 'mass', kind: 'mass', want: goal.massMax, got: c.massKg, pass: c.massKg <= goal.massMax });
        if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
        return { checks, pass: checks.every((x) => x.pass), walk: Wk };
    }
    if (goal.lift) {
        // A lift goal: `lift.payloadKg` held at the mount `out`, at least `lift.reachM` out.
        const m = (c.mounts || []).find((x) => x.port === goal.out);
        const kg = m ? m.payloadKg : 0, r = m ? m.reach : 0;
        checks.push({ id: 'payload', label: 'lifts', kind: 'payload', want: goal.lift.payloadKg, got: kg, pass: kg >= goal.lift.payloadKg * 0.999 });
        checks.push({ id: 'reach', label: 'reach', kind: 'reach', want: goal.lift.reachM, got: r, pass: r >= goal.lift.reachM * 0.999 });
        if (goal.box) {
            const a = c.size.slice().sort((x, y) => x - y), b = goal.box.slice().sort((x, y) => x - y);
            checks.push({ id: 'box', label: 'fits', kind: 'box', want: goal.box, got: c.size, pass: a.every((v, i) => v <= b[i] + 1e-6) });
        }
        if (goal.massMax) checks.push({ id: 'mass', label: 'mass', kind: 'mass', want: goal.massMax, got: c.massKg, pass: c.massKg <= goal.massMax });
        if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
        return { checks, pass: checks.every((x) => x.pass), lift: goal.lift, out: goal.out };
    }
    const out = c.ports.find((p) => p.id === goal.out);
    let effort = 0, flow = 0;
    const src = c.sources.find((s) => s.port === goal.out);
    const path = c.paths.find((p) => p.to === goal.out);
    if (src) {
        const f = goal.need.flow;
        const curve = src.stall * Math.max(0, 1 - f / src.noLoad);
        effort = src.unpowered ? 0 : Math.max(0, Math.min(src.cont, curve, f > 0 ? src.power / f : Infinity));
        flow = src.noLoad;
    } else if (path && goal.given) {
        flow = goal.given.flow / path.k;
        effort = Math.min(goal.given.effort * path.k * path.eff, path.cont);
    }
    const domain = out ? out.domain : 'rot';
    checks.push({ id: 'effort', label: 'holds', domain, kind: 'effort', want: goal.need.effort, got: effort, pass: effort >= goal.need.effort * 0.999 });
    checks.push({ id: 'flow', label: src ? 'free speed' : 'speed', domain, kind: 'flow', want: goal.need.flow, got: flow, pass: flow >= goal.need.flow * 0.999 });
    if (goal.box) {
        const a = c.size.slice().sort((x, y) => x - y), b = goal.box.slice().sort((x, y) => x - y);
        checks.push({ id: 'box', label: 'fits', kind: 'box', want: goal.box, got: c.size, pass: a.every((v, i) => v <= b[i] + 1e-6) });
    }
    if (goal.massMax) checks.push({ id: 'mass', label: 'mass', kind: 'mass', want: goal.massMax, got: c.massKg, pass: c.massKg <= goal.massMax });
    if (!c.ok) checks.push({ id: 'builds', label: 'builds', kind: 'builds', want: 0, got: c.errors.length, pass: false });
    return { checks, pass: checks.every((x) => x.pass), given: goal.given || null, need: goal.need, out: goal.out };
}

/**
 * The quarter turn (0..3) for a link from child `a`'s port `pa` to child `b`'s
 * port `pb` that carries them furthest: each is tried and the one with the
 * longest box wins.
 *
 * A chain of one design (`b` has a port `pa` of its own, tip to base) is tried
 * three in a row. A link's turn sets how its child sits, whatever the turn
 * before it, so one turn repeated stands every copy the same way and a tip
 * that sits aside of its base walks the chain off sideways a step a copy.
 * Among turns as long, the one that brings the third tip back most nearly
 * onto the line out of the first base wins; `before` is the turn of the link
 * that placed `a` (null for the first), and each next link takes the turn
 * this gives for the one before it: a straight hundred, not a drift.
 */
export function reachingSpin(lib, cache, a, pa, b, pb, before = null) {
    const strip = (s, id) => { const { at, rot, ...rest } = s; return { ...rest, id }; };
    const has = (s, pid) => { try { return (elementOf(s, lib, cache, []).ports || []).some((p) => p.id === pid); } catch (e) { return false; } };
    const chain = has(b, pa) && has(a, pb);
    const tryPair = (s1, s2) => {
        const children = [strip(a, 'a'), strip(b, 'b')], links = [{ a: `a.${pa}`, b: `b.${pb}`, spin: s1 }];
        if (chain) { children.push(strip(b, 'c')); links.push({ a: `b.${pa}`, b: `c.${pb}`, spin: s2 }); }
        let c;
        try { c = compileDesign('__spin', { ...lib, __spin: { id: '__spin', name: 'probe', children, links, ports: [] } }, new Map(cache)); } catch (e) { return null; }
        let drift = 0;
        if (chain) {
            // Where a child's port is, placed: its position and the way it faces.
            const at = (id, pid) => { const ch = c.children.find((x) => x.id === id); const p = ch.el.ports.find((q) => q.id === pid); return { pos: add(rotApply(ch.rot, p.pos), ch.pos), axis: rotApply(ch.rot, p.axis) }; };
            // The line the chain should run along: out of the first one's base, against the way the base faces.
            const ba = at('a', pb), tc = at('c', pa), D = sub(tc.pos, ba.pos), u = ba.axis, along = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
            drift = Math.hypot(D[0] - along * u[0], D[1] - along * u[1], D[2] - along * u[2]);
        }
        return { len: Math.max(...c.size), drift };
    };
    let best = 0, bestLen = -1, bestDrift = Infinity;
    for (let s = 0; s < 4; s++) {
        // With a turn before, this link is the second of the three; else the first, with the best second after it.
        const tries = before != null ? [tryPair(before, s)] : chain ? [0, 1, 2, 3].map((t) => tryPair(s, t)) : [tryPair(s, 0)];
        for (const r of tries) {
            if (!r) continue;
            const longer = r.len > bestLen * (1 + 1e-3) + 1e-9, asLong = Math.abs(r.len - bestLen) <= bestLen * 1e-3;
            if (longer || (asLong && r.drift < bestDrift - 1e-6)) { best = s; bestLen = r.len; bestDrift = r.drift; }
        }
    }
    return best;
}

/** Compile every design of a library (dependencies first) into one cache. */
export function compileLibrary(lib, cache = new Map()) {
    for (const id of Object.keys(lib)) {
        try { compileDesign(id, lib, cache); }
        catch (e) { cache.set(id, failed(id, lib[id], e)); }
    }
    return cache;
}

function failed(id, d, e) {
    return {
        kind: 'contract', id, name: d ? d.name : id, level: 1, ok: false,
        errors: [e.message], warnings: [], box: { min: [0, 0, 0], max: [0, 0, 0] }, size: [0, 0, 0],
        massKg: 0, com: [0, 0, 0], partCount: 0, ports: [], paths: [], sources: [], supplies: [],
        shapes: [], children: [], links: [], clashes: [], traces: {}, joints: [], mounts: [], goal: null,
    };
}

/** Drop `id` and every design that uses it from `cache`. */
export function invalidate(id, lib, cache) {
    const users = (x) => Object.keys(lib).filter((k) => lib[k].children.some((c) => c.design === x));
    const todo = [id];
    while (todo.length) {
        const x = todo.pop();
        if (!cache.has(x)) continue;
        cache.delete(x);
        todo.push(...users(x));
    }
}

/**
 * Flows through a contract when its output turns at `flowOut` (or its input
 * at `flowIn`): Map child -> { [port]: flow }, and nested contracts' maps
 * under `inner`. The view spins gears with this.
 */
export function flowsFor(contract, portFlows) {
    const out = new Map();
    const at = (cid) => out.get(cid) || out.set(cid, { ports: {}, inner: null }).get(cid);
    for (const [portId, flow] of Object.entries(portFlows)) {
        const tr = contract.traces[portId];
        if (tr) walk(tr, flow);
    }
    // Walk downstream→upstream: the flow entering a stage is its output flow times its ratio.
    function walk(tr, flow) {
        let f = flow;
        for (let i = tr.stages.length - 1; i >= 0; i--) {
            const s = tr.stages[i];
            const rec = at(s.child);
            for (const to of [].concat(s.path.to)) rec.ports[to] = f;
            const fin = f * s.path.k;
            for (const from of [].concat(s.path.from)) rec.ports[from] = fin;
            if (s.el.kind === 'contract' && !s.side) rec.inner = flowsFor(s.el, { [s.path.to]: f });
            f = fin;
        }
        if (tr.root.kind === 'source' && tr.root.parallel) {
            // Every drive on a summing input turns at the input's speed.
            for (const b of tr.root.parallel) walk(b, f);
        } else if (tr.root.kind === 'source') {
            const rec = at(tr.root.child);
            rec.ports[tr.root.src.port] = f;
            const sEl = contract.children.find((c) => c.id === tr.root.child).el;
            if (sEl.kind === 'contract') rec.inner = flowsFor(sEl, { [tr.root.src.port]: f });
        }
    }
    return out;
}

export { ROTS };
