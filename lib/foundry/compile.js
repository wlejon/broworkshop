// lib/foundry/compile.js — compile a design into a contract.
//
// A design is children (parts, or other designs by id), the links between
// their ports, the ports it exposes, and a goal:
//
//   { id, name, level, paint, note,
//     children: [{ id, part, params } | { id, design }, ... ]   each may carry
//               at: [x,y,z] and rot: 0..23 to fix it in place
//     links:    [{ a: 'child.port', b: 'child.port', spin }]
//     ports:    [{ id, label, at: 'child.port' }]
//     goal:     { out, given: { effort, flow }, need: { effort, flow }, box, massMax } }
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
        for (const s of k.el.shapes) shapes.push({ child: cid, ...boxPlace(s, pl.rot, pl.pos) });
    }
    const clashes = [];
    for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) {
            const A = shapes[i], B = shapes[j];
            if (A.child === B.child) continue;
            const o = [0, 1, 2].map((a) => Math.min(A.max[a], B.max[a]) - Math.max(A.min[a], B.min[a]));
            if (o[0] > TOUCH && o[1] > TOUCH && o[2] > TOUCH) {
                const depth = Math.min(o[0], o[1], o[2]);
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
                weakest: chain.weakest, guarded: chain.guarded, stages: chain.stages,
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
            if (src.stall > src.peak * 1.001) {
                const w = chain.weakest;
                if (w && w.role === 'limiter') src.stall = Math.min(src.stall, src.peak);
                else if (w) warnings.push(`${ep.label}: at stall, ${w.label} ${w.mode} (${fmtN(src.stall)} against the ${fmtN(src.peak)} it holds)`);
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
                joints.push({ label: `${el.name} › ${J.label}`, cont: J.cont, limit: `${el.name} › ${J.limit}`, mode: J.mode, s: rec.s + J.s, hold: J.hold, innerTips: J.tips });
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
        const tr = trace(oc, op, kids, linkOf, exposed, []);
        const ch = combine(tr.stages);
        if (tr.root.kind === 'input') return { torque: ch.cont, label: ch.weakest ? ch.weakest.label : 'its input' };
        if (tr.root.kind !== 'source') return { torque: 0, label: 'nothing drives it' };
        const s = tr.root.src.cont * ch.K * ch.E, root = kids.get(tr.root.child).el;
        return { torque: Math.min(s, ch.cont), label: ch.cont < s && ch.weakest ? ch.weakest.label : (root.kind === 'contract' ? root.name : `${root.label} (${tr.root.child})`) };
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
                if (O.el.beam && Op.domain === 'rot' && Op.dir === 'in') {
                    // A joint: the boom and what it carries swing about its pin.
                    const pin = portAt(oc, op), dr = driveOf(oc, op), bend = O.el.beam.bend, byBeam = bend <= dr.torque;
                    joints.push({
                        label: `${O.el.label} (${oc})`, cont: Math.min(bend, dr.torque),
                        limit: byBeam ? `${O.el.label} (${oc})` : dr.label, mode: byBeam ? O.el.beam.mode : 'cannot turn it',
                        s: sAt(rec.group, pin.pos), hold: 0,
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
    for (const J of joints) {
        if (J.hold > J.cont) warnings.push(`${J.label} cannot hold up what hangs on it: ${fmtN(J.hold)} N·m against the ${fmtN(J.cont)} N·m ${J.limit} holds`);
    }
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
        let best = { port: ep.id, payloadKg: Infinity, reach: t.s, weakest: null };
        for (const j of t.anc) {
            const J = joints[j], r = t.s - J.s;
            const kg = r > 1e-6 ? Math.max(0, J.cont - J.hold) / (G * r) : Infinity;
            if (kg < best.payloadKg) best = { port: ep.id, payloadKg: kg, reach: t.s, weakest: J.label, limit: J.limit, mode: J.mode };
        }
        mounts.push(best);
    }

    // Exposed outputs of supplies that are not driven by a trace (battery-only designs).
    const children = [];
    for (const [cid, k] of kids) {
        const pl = place.get(cid);
        children.push({ id: cid, spec: k.spec, el: k.el, pos: sub(pl.pos, center), rot: pl.rot });
    }

    const contract = {
        kind: 'contract',
        id, name: d.name, level: d.level || 1, paint: d.paint, note: d.note || '',
        ok: errors.length === 0,
        errors, warnings,
        box: { min: sub(env.min, center), max: sub(env.max, center) },
        size: sub(env.max, env.min),
        massKg, com: sub(com, center), partCount,
        ports, paths, sources, supplies,
        shapes: shapes.map((s) => ({ child: s.child, min: sub(s.min, center), max: sub(s.max, center) })),
        children, links, clashes, traces,
        base: baseEp ? baseEp.id : null,
        stretch: baseEp ? { moment: stretchMoment, tips: tipS } : null,
        joints: joints.map((J, j) => ({
            label: J.label, cont: J.cont, limit: J.limit, mode: J.mode, s: J.s, hold: J.hold,
            tips: Object.keys(tipAnc).filter((t) => tipAnc[t].includes(j)),
        })),
        mounts,
    };
    contract.goal = evaluateGoal(d.goal, contract);
    cache.set(id, contract);
    return contract;
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
        const atOut = { child: s.child, label: stageLabel(s), mode: p.mode, role: p.role, cont: p.cont * gain, peak: p.peak * gain, flowMax: p.flowMax / ratio, k: p.k, eff: p.eff, nested: p.weakest || null };
        out.unshift(atOut);
        cont = Math.min(cont, atOut.cont);
        if (atOut.peak < peak) peak = atOut.peak;
        if (atOut.flowMax < flowMax) { flowMax = atOut.flowMax; flowWeakest = atOut.label; }
        gain *= p.k * p.eff;
        ratio *= p.k;
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
    return { K, E, cont, peak, flowMax, flowWeakest, weakest, guarded, stages: out };
}

function stageLabel(s) {
    if (s.el.kind === 'contract') return s.path.weakest ? `${s.el.name} › ${s.path.weakest.label}` : s.el.name;
    return `${s.el.label} (${s.child})`;
}

function fmtN(v) { return v >= 1000 ? `${(v / 1000).toFixed(1)} k` : `${v.toFixed(0)}`; }
function fmtW(v) { return v >= 1000 ? `${(v / 1000).toFixed(1)} kW` : `${v.toFixed(0)} W`; }

/**
 * The goal of a design, judged against its contract. A goal names an output
 * and what it must give there: need.effort held at need.flow. For a path the
 * input it is given decides what comes out (given.effort, given.flow); a
 * source drives itself. box: the space it must fit (any way round); massMax.
 */
export function evaluateGoal(goal, c) {
    if (!goal) return null;
    const checks = [];
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
        kind: 'contract', id, name: d ? d.name : id, level: d ? d.level : 1, ok: false,
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
        if (!tr) continue;
        // Walk downstream→upstream: the flow entering a stage is its output flow times its ratio.
        let f = flow;
        for (let i = tr.stages.length - 1; i >= 0; i--) {
            const s = tr.stages[i];
            const rec = at(s.child);
            rec.ports[s.path.to] = f;
            const fin = f * s.path.k;
            rec.ports[s.path.from] = fin;
            if (s.el.kind === 'contract') rec.inner = flowsFor(s.el, { [s.path.to]: f });
            f = fin;
        }
        if (tr.root.kind === 'source') {
            const rec = at(tr.root.child);
            rec.ports[tr.root.src.port] = f;
            const sEl = contract.children.find((c) => c.id === tr.root.child).el;
            if (sEl.kind === 'contract') rec.inner = flowsFor(sEl, { [tr.root.src.port]: f });
        }
    }
    return out;
}

export { ROTS };
