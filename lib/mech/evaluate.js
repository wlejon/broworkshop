// lib/mech/evaluate.js — what a design is, worked out from the document alone.
//
//   const report = evaluate(design);
//
// Deterministic and free of the engine: the same design gives the same report
// in the page, in a Worker and on a server. Everything a pilot will feel is
// read from here: mass and where it sits, what each system asks of the power,
// coolant, fuel, feed and control lines in each regime and whether the lines
// through the frame carry it, what each joint must hold against what its
// actuator and section can, how it walks and runs, whether its jets can hold
// it level, and what it loses with each part shot away.

import { add, sub, mul, dot, cross, len, norm, clamp, mirrorV, hull2 } from "./vec.js";
import { CELL, G, STRUCTURE, ARMOR, ACTUATOR, LINES, LINE_KINDS, HULL_COOLING, REGIMES, REGIME_KEYS,
         MODULES, FRAME_SKIN, FRAME_RIBS, ACTUATOR_DUTY, fmt } from "./catalog.js";
import { FACES, instances, hullBasis, hullToLocal, hullCorners, hullCenter, hullArea, faceQuad, quadArea,
         faceNormal, faceName, sectionAt, bay, moduleBox, moduleFace, faceAxis, faceSign, restPose, segMap, skinPoint } from "./skeleton.js";
import { moduleFault } from "./design.js";

const LEG_ROLES = ['thigh', 'shin', 'foot'];
const RATE_KINDS = ['power', 'coolant', 'data'];      // supplied at a rate
const STORE_KINDS = ['fuel', 'ammo'];                 // drawn from what is carried
const DYNAMIC = 2.0;                                 // a landing or a hard turn, in g

/**
 * Thrust that holds the machine still in the air: a force for each jet,
 * within its gimbal and its rating, summing to the weight with no torque
 * about the centre of mass, as nearly as the jets allow.
 */
function trim(jets, com, weight, lref) {
    const n = jets.length;
    if (!n) return { ok: false, throttle: 1, force: weight, torque: 0, f: [] };
    const rho = jets.map((j) => mul(sub(j.pos, com), 1 / lref));
    const cap = jets.map((j) => j.thrust / weight);
    const tan = jets.map((j) => Math.tan(j.gimbal * Math.PI / 180));
    // Every jet starts shut and opens at a pace set by what its thrust costs,
    // so the level it settles at leans on the engines that are cheap to run.
    const g = jets.map(() => [0, 0, 0]);
    let lip = 0, cheap = Infinity;
    for (const r of rho) lip += 1 + dot(r, r);
    for (const j of jets) cheap = Math.min(cheap, j.cost);
    const pace = jets.map((j) => 1 / clamp(j.cost / Math.max(1e-9, cheap), 1, 40));
    const step = 0.5 / lip;
    let F = [0, 0, 0], T = [0, 0, 0];
    const sums = () => {
        F = [0, -1, 0]; T = [0, 0, 0];
        for (let i = 0; i < n; i++) { F = add(F, g[i]); T = add(T, cross(rho[i], g[i])); }
    };
    for (let it = 0; it < 1500; it++) {
        sums();
        for (let i = 0; i < n; i++) {
            let v = sub(g[i], mul(add(F, cross(T, rho[i])), 2 * step * pace[i]));
            // back into the cone about the jet's axis
            const a = jets[i].axis, h = dot(v, a), radial = sub(v, mul(a, h)), r = len(radial);
            if (r > h * tan[i]) {
                if (r * tan[i] <= -h) v = [0, 0, 0];
                else {
                    const s = (h + r * tan[i]) / (1 + tan[i] * tan[i]);
                    v = add(mul(a, s), r > 1e-12 ? mul(radial, s * tan[i] / r) : [0, 0, 0]);
                }
            }
            const l = len(v);
            g[i] = l > cap[i] ? mul(v, cap[i] / l) : v;
        }
    }
    sums();
    let used = 0, have = 0;
    const f = g.map((v, i) => { used += len(v) * weight; have += jets[i].thrust; return mul(v, weight); });
    return {
        force: len(F) * weight, torque: len(T) * weight * lref, torqueVec: mul(T, weight * lref),
        throttle: clamp(used / Math.max(1, have), 0, 1), f, each: g.map((v, i) => len(v) / Math.max(1e-9, cap[i])),
    };
}

/**
 * @param {Object} design
 * @param {{dead?: Set<string>, failures?: boolean}} [opts]  dead: instances shot away (what hangs from them goes too)
 */
export function evaluate(design, opts) {
    opts = opts || {};
    const issues = [];
    const issue = (level, where, text) => issues.push({ level, where, text });
    const segs = segMap(design);
    const allInsts = instances(design);
    const rest = restPose(design, allInsts);
    const dead = new Set();
    for (const it of allInsts) if ((opts.dead && opts.dead.has(it.id)) || (it.parent && dead.has(it.parent))) dead.add(it.id);
    const insts = allInsts.filter((it) => !dead.has(it.id));
    const instById = Object.fromEntries(insts.map((it) => [it.id, it]));
    const kidsOf = {};
    for (const it of insts) if (it.parent) (kidsOf[it.parent] ||= []).push(it.id);

    // --- what each segment is, once ---------------------------------------------
    const S = {};
    for (const seg of design.segments) {
        const B = hullBasis(seg), grid = bay(seg);
        S[seg.id] = { seg, B, grid, area: hullArea(seg), center: hullToLocal(B, hullCenter(seg)), mods: [], cut: {} };
    }
    const world = (it, local) => add(rest.pos[it.id], it.side < 0 ? mirrorV(local) : local);
    const worldDir = (it, local) => (it.side < 0 ? mirrorV(local) : local);

    // --- modules, once per definition -------------------------------------------
    const modDefs = {};
    for (const m of design.modules) {
        const s = S[m.seg], fam = MODULES[m.type];
        if (!s || !fam) continue;
        const box = moduleBox(s.grid, m);
        const fa = moduleFace(m, m.face);
        const g = { size: box.size, V: box.size[0] * box.size[1] * box.size[2], A: fa.A, L: fa.L };
        const spec = fam.spec(g, m.opts || {});
        const fault = moduleFault(design, m, s.grid);
        const def = { m, fam, spec, fault, box, center: hullToLocal(s.B, box.center), g };
        if (fam.surface && m.face) {
            def.shown = hullToLocal(s.B, skinPoint(s.seg, box.center, m.face));
            def.out = hullToLocal(s.B, [0, 1, 2].map((a) => (a === faceAxis(m.face) ? faceSign(m.face) : 0)));
            s.cut[m.face] = (s.cut[m.face] || 0) + fa.A;
        }
        modDefs[m.id] = def;
        s.mods.push(def);
        if (fault && !opts.dead) issue('error', m.id, `${fam.label} in ${s.seg.name}: ${fault}`);
    }

    // --- mass ---------------------------------------------------------------------
    const mass = { frame: 0, armor: 0, actuators: 0, lines: 0, modules: 0, fuel: 0, ammo: 0, total: 0, bySegment: {} };
    const points = [];
    const segMassOf = {};
    for (const seg of design.segments) {
        const s = S[seg.id], st = STRUCTURE[seg.frame.mat] || STRUCTURE.steel;
        const frame = st.rho * s.area * FRAME_SKIN * seg.frame.gauge * FRAME_RIBS;
        let armor = 0;
        s.faces = {};
        for (const f of FACES) {
            const a = quadArea(faceQuad(seg, f)), pl = seg.armor[f] || { t: 0, mat: 'steel' };
            const covered = Math.max(0, a - (s.cut[f] || 0));
            const kg = covered * pl.t * (ARMOR[pl.mat] || ARMOR.steel).rho;
            s.faces[f] = { area: a, covered, mass: kg, t: pl.t, mat: pl.mat };
            armor += kg;
        }
        const act = seg.joint.type === 'fixed' ? 0 : (ACTUATOR[seg.joint.act] || ACTUATOR.hydraulic).mass * seg.joint.rating;
        let lines = 0;
        if (seg.parent && S[seg.parent]) {
            const run = len(sub(add(seg.attach, s.center), S[seg.parent].center));
            for (const k of LINE_KINDS) lines += (seg.lines[k]?.cap || 0) * (seg.lines[k]?.n || 1) * LINES[k].mass * run;
            s.run = run;
        }
        segMassOf[seg.id] = { frame, armor, act, lines };
    }
    for (const it of insts) {
        const s = S[it.seg.id], sm = segMassOf[it.seg.id];
        const c = world(it, s.center);
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of hullCorners(it.seg)) {
            const w = hullToLocal(s.B, p);
            for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], w[a]); hi[a] = Math.max(hi[a], w[a]); }
        }
        const shell = sm.frame + sm.armor;
        points.push({ m: shell, p: c, inst: it.id, box: sub(hi, lo) });
        points.push({ m: sm.act + sm.lines, p: rest.pos[it.id], inst: it.id });
        mass.frame += sm.frame; mass.armor += sm.armor; mass.actuators += sm.act; mass.lines += sm.lines;
        let mods = 0;
        for (const d of s.mods) {
            if (d.fault) continue;
            points.push({ m: d.spec.mass, p: world(it, d.center), inst: it.id });
            mods += d.spec.mass;
            mass.fuel += d.spec.store?.fuel || 0; mass.ammo += d.spec.store?.ammo || 0;
        }
        mass.modules += mods;
        mass.bySegment[it.id] = shell + sm.act + sm.lines + mods;
    }
    let com = [0, 0, 0];
    for (const p of points) { mass.total += p.m; com = add(com, mul(p.p, p.m)); }
    com = mass.total > 0 ? mul(com, 1 / mass.total) : [0, 0, 0];
    const inertia = [0, 0, 0];
    for (const p of points) {
        const r = sub(p.p, com), b = p.box || [0, 0, 0];
        inertia[0] += p.m * (r[1] * r[1] + r[2] * r[2] + (b[1] * b[1] + b[2] * b[2]) / 12);
        inertia[1] += p.m * (r[0] * r[0] + r[2] * r[2] + (b[0] * b[0] + b[2] * b[2]) / 12);
        inertia[2] += p.m * (r[0] * r[0] + r[1] * r[1] + (b[0] * b[0] + b[1] * b[1]) / 12);
    }
    const weight = mass.total * G;
    let height = 0, frontal = 0;
    for (const it of insts) {
        const s = S[it.seg.id];
        for (const p of hullCorners(it.seg)) height = Math.max(height, world(it, hullToLocal(s.B, p))[1]);
        for (const f of FACES) frontal += s.faces[f].area * Math.max(0, -hullToLocal(s.B, faceNormal(it.seg, f))[2]);
    }

    // What hangs from each instance: mass and where its centre is.
    const sub_ = {};
    for (let i = insts.length - 1; i >= 0; i--) {
        const it = insts[i];
        let m = 0, c = [0, 0, 0];
        for (const p of points) if (p.inst === it.id) { m += p.m; c = add(c, mul(p.p, p.m)); }
        for (const k of kidsOf[it.id] || []) { m += sub_[k].m; c = add(c, mul(sub_[k].com, sub_[k].m)); }
        sub_[it.id] = { m, com: m > 0 ? mul(c, 1 / m) : rest.pos[it.id].slice() };
    }

    // --- module instances -----------------------------------------------------------
    const mods = [];
    for (const it of insts) for (const d of S[it.seg.id].mods) {
        if (d.fault) continue;
        const mi = { key: it.id + '/' + d.m.id, inst: it.id, def: d, pos: world(it, d.center) };
        if (d.shown) { mi.shown = world(it, d.shown); mi.out = worldDir(it, d.out); }
        mods.push(mi);
    }

    // --- flight: what the jets can do ---------------------------------------------------
    const jets = mods.filter((x) => x.def.spec.thrust && x.shown).map((x) => ({
        key: x.key, inst: x.inst, id: x.def.m.id, pos: x.shown, axis: mul(x.out, -1), out: x.out,
        thrust: x.def.spec.thrust, gimbal: x.def.spec.gimbal || 0, spool: x.def.spec.spool || 0.5,
        cost: ((x.def.spec.demand?.fuel?.[1] || 0) + 0.2 * (x.def.spec.demand?.power?.[1] || 0)) / x.def.spec.thrust,
    }));
    let gyro = 0;
    for (const x of mods) gyro += x.def.spec.gyro || 0;
    let tmax = [0, 0, 0];
    for (const j of jets) tmax = add(tmax, mul(j.axis, j.thrust));
    const lref = Math.max(4, height / 4);
    const tr = trim(jets, com, Math.max(1, weight), lref);
    const hoverOk = jets.length > 0 && tr.force < 0.02 * weight;
    const gyroHolds = tr.torque <= gyro;
    const flight = {
        jets, thrust: len(tmax), lift: tmax[1], tw: weight > 0 ? tmax[1] / weight : 0,
        hover: { ok: hoverOk && gyroHolds, lifts: hoverOk, throttle: hoverOk ? tr.throttle : 1, force: tr.force, torque: tr.torque,
                 torqueVec: tr.torqueVec || [0, 0, 0], gyro, each: tr.each || [], f: tr.f },
    };

    // --- what each system asks for, by regime -----------------------------------------
    // A regime's `jets` is how far the throttles are pushed from the hover
    // setting (0: off, null: hover itself, 1: everything open).
    const hoverOf = {};
    jets.forEach((j, i) => { hoverOf[j.key] = flight.hover.lifts ? flight.hover.each[i] : 1; });
    const levelsOf = (key) => {
        const r = REGIMES[key];
        return { always: 1, legs: r.legs, arms: r.arms, weapons: r.weapons, jets: r.jets == null ? flight.hover.throttle : r.jets, hover: r.jets == null };
    };
    const levelFor = (x, lv) => {
        const drive = x.def.spec.drive;
        if (drive !== 'jets' || !(x.key in hoverOf)) return lv[drive];
        return lv.hover ? hoverOf[x.key] : lv.jets >= 1 ? 1 : hoverOf[x.key] * lv.jets;
    };
    const actuators = [];
    for (const it of insts) {
        const j = it.seg.joint;
        if (j.type === 'fixed' || !(j.rating > 0)) continue;
        const a = ACTUATOR[j.act] || ACTUATOR.hydraulic;
        const peak = j.rating * a.rate * ACTUATOR_DUTY / a.eff;       // MW
        actuators.push({ inst: it.id, drive: LEG_ROLES.includes(it.seg.role) ? 'legs' : 'arms', power: peak, heat: peak * (1 - a.eff), out: peak * a.eff });
    }
    const hullCool = {};
    for (const it of insts) hullCool[it.id] = S[it.seg.id].area * HULL_COOLING;

    const regimes = {};
    const need = {};        // inst -> kind -> { req, regime, sign }
    for (const it of insts) need[it.id] = Object.fromEntries(LINE_KINDS.map((k) => [k, { req: 0, regime: null, sign: 0 }]));
    for (const key of REGIME_KEYS) {
        const lv = levelsOf(key);
        const cap = {}, dem = {}, store = {}, net = {};
        for (const k of LINE_KINDS) { cap[k] = {}; dem[k] = {}; store[k] = {}; net[k] = {}; }
        const bump = (o, k, inst, v) => { if (v) o[k][inst] = (o[k][inst] || 0) + v; };
        const demandOf = (x, k, level) => { const d = x.def.spec.demand?.[k]; return d ? d[0] + d[1] * level : 0; };
        for (const it of insts) bump(cap, 'coolant', it.id, hullCool[it.id]);
        for (const x of mods) {
            const sp = x.def.spec;
            for (const k of LINE_KINDS) { bump(cap, k, x.inst, sp.supply?.[k]); bump(store, k, x.inst, sp.store?.[k]); }
            if (sp.drive && sp.drive !== 'gen') for (const k of LINE_KINDS) bump(dem, k, x.inst, demandOf(x, k, levelFor(x, lv)));
        }
        for (const a of actuators) {
            bump(dem, 'power', a.inst, a.power * lv[a.drive]);
            bump(dem, 'coolant', a.inst, a.heat * lv[a.drive]);
            bump(dem, 'data', a.inst, 1);
        }
        const total = (o) => { let t = 0; for (const i in o) t += o[i]; return t; };
        // Power first: how hard the generators work sets what they burn and shed.
        const pS = total(cap.power), pD = total(dem.power);
        const load = pS > 0 ? Math.min(1, pD / pS) : 0;
        for (const x of mods) if (x.def.spec.drive === 'gen') for (const k of LINE_KINDS) bump(dem, k, x.inst, demandOf(x, k, load));
        const R = { levels: lv, load };
        for (const k of LINE_KINDS) {
            const D = total(dem[k]), St = total(store[k]);
            let Sp, sat, endurance = Infinity;
            if (STORE_KINDS.includes(k)) {
                Sp = St; sat = D > 0 ? (St > 0 ? 1 : 0) : 1;
                if (D > 0) endurance = St / D;
                for (const it of insts) net[k][it.id] = (St > 0 ? D * (store[k][it.id] || 0) / St : 0) - (dem[k][it.id] || 0) * sat;
            } else {
                Sp = total(cap[k]); sat = D > 0 ? Math.min(1, Sp / D) : 1;
                if (D > Sp && k !== 'data') endurance = St / (D - Sp);
                const use = Sp > 0 ? Math.min(1, D / Sp) : 0;
                for (const it of insts) net[k][it.id] = (cap[k][it.id] || 0) * use - (dem[k][it.id] || 0) * sat;
            }
            R[k] = { supply: Sp, demand: D, sat, store: St, endurance };
        }
        // What crosses each joint is the sum over what hangs from it.
        for (const k of LINE_KINDS) {
            const flow = {};
            for (let i = insts.length - 1; i >= 0; i--) {
                const it = insts[i];
                let f = net[k][it.id] || 0;
                for (const c of kidsOf[it.id] || []) f += flow[c];
                flow[it.id] = f;
                const mag = Math.abs(f);
                if (it.parent && mag > need[it.id][k].req) need[it.id][k] = { req: mag, regime: key, sign: Math.sign(f) };
            }
        }
        regimes[key] = R;
    }

    // --- the lines through the frame -----------------------------------------------------
    const trunks = {}, feed = {};
    for (const it of insts) {
        trunks[it.id] = {}; feed[it.id] = {};
        for (const k of LINE_KINDS) {
            const n = need[it.id][k], ln = it.seg.lines[k] || { cap: 0, n: 1 };
            const req = n.req < 1e-6 ? 0 : n.req;
            const ratio = req > 0 ? Math.min(1, ln.cap / req) : 1;
            trunks[it.id][k] = { req, cap: ln.cap, n: ln.n, regime: n.regime, sign: n.sign, load: ln.cap > 0 ? req / ln.cap : (req > 0 ? Infinity : 0) };
            const up = it.parent ? feed[it.parent][k] : 1;
            feed[it.id][k] = up * (n.sign < 0 ? ratio : 1);
            if (it.parent && req > 0 && ratio < 0.995 && !opts.dead) {
                const what = `${LINES[k].label.toLowerCase()} line into ${it.seg.name}${it.side ? (it.side > 0 ? ' (R)' : ' (L)') : ''}`;
                const amt = (v) => (k === 'data' ? Math.ceil(v - 1e-6) + ' ch' : v.toFixed(v < 10 ? 1 : 0) + ' ' + LINES[k].unit);
                if (it.side >= 0) {
                    issue(ln.cap > 0 ? 'warn' : 'error', it.seg.id,
                        `The ${what} carries ${amt(ln.cap)} of the ${amt(req)} ${n.sign < 0 ? 'it must bring in' : 'it must take out'} (${REGIMES[n.regime].label.toLowerCase()})`);
                }
            }
        }
    }

    // --- joints: what they hold against what they can ------------------------------------
    const legs = {};
    for (const side of [1, -1]) {
        const tag = side > 0 ? 'R' : 'L';
        const pick = (role) => insts.find((it) => it.seg.role === role && it.side === side);
        const thigh = pick('thigh'), shin = pick('shin'), foot = pick('foot');
        if (thigh && shin && foot) legs[tag] = { thigh, shin, foot };
    }
    const legOk = !!(legs.R && legs.L);
    const anyLeg = legs.R || legs.L;
    let legLen = 0, l1 = 0, l2 = 0, footLen = 0, soleArea = 0, hipX = 0;
    const soles = [];
    if (anyLeg) {
        l1 = len(anyLeg.shin.seg.attach); l2 = len(anyLeg.foot.seg.attach); legLen = l1 + l2;
        footLen = anyLeg.foot.seg.len + anyLeg.foot.seg.back;
        hipX = Math.abs(rest.pos[anyLeg.thigh.id][0]);
        for (const tag in legs) {
            const ft = legs[tag].foot, s = S[ft.seg.id];
            const bottom = FACES.find((f) => faceName(ft.seg, f, ft.side) === 'bottom') || '-w';
            const q = faceQuad(ft.seg, bottom).map((p) => world(ft, hullToLocal(s.B, p)));
            legs[tag].sole = q;
            legs[tag].soleCenter = mul(q.reduce(add, [0, 0, 0]), 0.25);
            soleArea = quadArea(q);
            for (const p of q) soles.push([p[0], p[2]]);
        }
    }

    const joints = {};
    for (const it of insts) {
        if (!it.parent) continue;
        const seg = it.seg, j = seg.joint, s = S[seg.id], at = rest.pos[it.id], sb = sub_[it.id];
        const w = sb.m * G, r = sub(sb.com, at);
        let hold = 0, struct = 0;
        const isLeg = LEG_ROLES.includes(seg.role) && legOk;
        if (isLeg) {
            // One leg carries the machine, knee bent: the arms the ground's push has about each joint.
            const arm = seg.role === 'thigh' ? Math.hypot(0.12 * legLen, Math.abs(at[0] - com[0]) * 0.5)
                      : seg.role === 'shin' ? 0.22 * legLen : 0.35 * footLen;
            hold = weight * arm;
            struct = DYNAMIC * hold;
        } else {
            const reach = j.type === 'fixed' ? Math.hypot(r[0], r[2]) : len(r);
            hold = w * reach;
            struct = DYNAMIC * hold;
        }
        // Thrust and recoil made beyond this joint pass through it.
        let push = 0;
        const under = (id) => { for (let x = instById[id]; x; x = instById[x.parent]) if (x.id === it.id) return true; return false; };
        for (const jt of jets) if (under(jt.inst)) push += len(cross(sub(jt.pos, at), mul(jt.axis, jt.thrust)));
        for (const x of mods) {
            const wp = x.def.spec.weapon;
            if (wp && wp.recoil && x.shown && under(x.inst)) {
                const kick = len(cross(sub(x.shown, at), mul(x.out, -wp.recoil)));
                push += kick;
                if (!isLeg) hold += kick;
            }
        }
        struct += push;
        const sec = sectionAt(seg, 0), st = STRUCTURE[seg.frame.mat] || STRUCTURE.steel;
        const tk = FRAME_SKIN * seg.frame.gauge, a = 2 * sec[0], c = 2 * sec[1];
        const modulus = tk * Math.min(a * (c + a / 3), c * (a + c / 3));
        const structHave = st.sigma * modulus / 1.5;
        const torqueHave = j.type === 'fixed' ? Infinity : j.rating * 1e6 * feed[it.id].power;
        const J = joints[it.id] = {
            hold, struct, structHave, torqueHave, rating: j.rating * 1e6, fixed: j.type === 'fixed',
            torqueMargin: j.type === 'fixed' ? Infinity : (hold > 0 ? torqueHave / hold : Infinity),
            structMargin: struct > 0 ? structHave / struct : Infinity,
        };
        if (opts.dead || it.side < 0) continue;
        const nm = seg.name;
        if (J.structMargin < 1) issue('error', seg.id, `${nm}'s frame holds ${(structHave / 1e6).toFixed(0)} MN m at its joint; it is asked for ${(struct / 1e6).toFixed(0)}. It breaks.`);
        else if (J.structMargin < 1.3) issue('warn', seg.id, `${nm}'s frame is at ${(100 / J.structMargin).toFixed(0)}% of what it holds`);
        if (J.torqueMargin < 1) issue(isLeg ? 'error' : 'warn', seg.id, `${nm}'s actuator gives ${(torqueHave / 1e6).toFixed(0)} MN m; holding what it carries takes ${(hold / 1e6).toFixed(0)}`);
    }

    // --- on the ground ----------------------------------------------------------------------
    const move = { stands: false, walk: 0, sprint: 0, limit: '', jump: 0, turn: 0, legLength: legLen, hipHeight: anyLeg ? rest.pos[anyLeg.thigh.id][1] : 0,
                   footPressure: 0, stepPressure: 0, balance: null, stride: 0 };
    if (!legOk) {
        if (!opts.dead) issue('error', null, 'A biped needs a thigh, a shin and a foot on each side');
    } else {
        const L = legs.R || legs.L;
        const jm = (it) => joints[it.id];
        const strength = Math.min(jm(L.thigh).torqueMargin, jm(L.shin).torqueMargin, jm(L.foot).torqueMargin);
        const sound = Math.min(jm(L.thigh).structMargin, jm(L.shin).structMargin, jm(L.foot).structMargin) >= 1;
        move.stands = strength >= 1 && sound;
        const hull = hull2(soles);
        let fwd = Infinity, back = -Infinity, side = 0;
        for (const p of hull) { fwd = Math.min(fwd, p[1]); back = Math.max(back, p[1]); side = Math.max(side, Math.abs(p[0])); }
        const b = { front: com[2] - fwd, back: back - com[2], side: side - Math.abs(com[0]), hull };
        b.least = Math.min(b.front, b.back, b.side);
        b.tip = Math.atan2(Math.max(0, b.least), Math.max(0.1, com[1])) * 180 / Math.PI;
        move.balance = b;
        if (b.least < 0) { move.stands = false; if (!opts.dead) issue('error', null, `The centre of mass stands ${(-b.least).toFixed(1)} m outside its feet: it falls over`); }
        else if (b.least < 0.12 * footLen && !opts.dead) issue('warn', null, `Only ${b.least.toFixed(1)} m between the centre of mass and the edge of its feet`);
        move.footPressure = weight / Math.max(1, 2 * soleArea) / 1e3;
        move.stepPressure = 1.5 * weight / Math.max(1, soleArea) / 1e3;
        if (move.stands) {
            const hipA = ACTUATOR[L.thigh.seg.joint.act] || ACTUATOR.hydraulic, kneeA = ACTUATOR[L.shin.seg.joint.act] || ACTUATOR.hydraulic;
            const sp = regimes.sprint;
            const fed = Math.min(feed[L.thigh.id].power, feed[L.shin.id].power) * sp.power.sat * sp.data.sat;
            const out = 2 * (L.thigh.seg.joint.rating * hipA.rate * hipA.eff + L.shin.seg.joint.rating * kneeA.rate * kneeA.eff) * ACTUATOR_DUTY * 1e6 * fed;
            let iLeg = 0;
            for (const p of points) {
                let x = instById[p.inst];
                while (x && x.id !== L.thigh.id) x = instById[x.parent];
                if (x) { const r = sub(p.p, rest.pos[L.thigh.id]); iLeg += p.m * dot(r, r); }
            }
            const wn = Math.sqrt(L.thigh.seg.joint.rating * 1e6 / Math.max(1, iLeg));
            const lim = [
                ['power its legs put out', out / (0.20 * weight)],
                ['how fast its hips can swing the legs', wn / (2 * Math.PI) * 2.2 * 2.0 * legLen],
                ['how fast its actuators turn', Math.min(hipA.rate, kneeA.rate) * 0.8 * legLen],
                ['the length of its legs', Math.sqrt(4 * G * legLen)],
            ];
            lim.sort((p, q) => p[1] - q[1]);
            move.walk = Math.min(Math.sqrt(0.30 * G * legLen), lim[0][1]);
            move.sprint = lim[0][1]; move.limit = lim[0][0]; move.limits = lim;
            move.stride = 2.0 * legLen * clamp(move.sprint / Math.sqrt(4 * G * legLen), 0.45, 1);
            const push = 2 * L.shin.seg.joint.rating * 1e6 * feed[L.shin.id].power / (0.22 * legLen);
            const acc = push / mass.total - G;
            move.jump = acc > 0 ? acc * 0.25 * legLen / G : 0;
            move.turn = 0.5 * hipA.rate * 180 / Math.PI;
        } else if (!opts.dead && strength < 1) issue('error', null, 'Its legs cannot hold it up');
    }

    // --- in the air -----------------------------------------------------------------------
    {
        const th = Math.sqrt(Math.max(0, flight.thrust * flight.thrust - weight * weight));
        flight.climb = mass.total > 0 ? Math.max(0, flight.lift - weight) / mass.total : 0;
        flight.topSpeed = flight.tw > 1 ? Math.sqrt(2 * th / (1.2 * 1.0 * Math.max(1, frontal))) : 0;
        // What it can turn itself with while holding its own weight.
        const auth = [gyro, gyro, gyro];
        jets.forEach((j, i) => {
            const r = sub(j.pos, com), thr = flight.hover.each[i] ?? 1;
            const lever = cross(r, j.axis), swing = j.thrust * thr * Math.sin(j.gimbal * Math.PI / 180);
            for (let a = 0; a < 3; a++) {
                const perp = Math.hypot(r[(a + 1) % 3], r[(a + 2) % 3]);
                auth[a] += Math.abs(lever[a]) * j.thrust * Math.min(thr, 1 - thr) + swing * perp * 0.7;
            }
        });
        flight.authority = auth.map((t, a) => (inertia[a] > 0 ? t / inertia[a] * 180 / Math.PI : 0));
        flight.endurance = { hover: Math.min(regimes.hover.fuel.endurance, regimes.hover.power.endurance), burn: Math.min(regimes.burn.fuel.endurance, regimes.burn.power.endurance) };
        if (!opts.dead) {
            if (!jets.length) issue('warn', null, 'No jets: it cannot leave the ground');
            else if (flight.tw < 1) issue('warn', null, `Thrust is ${(flight.tw * 100).toFixed(0)}% of its weight: it cannot fly`);
            else if (!flight.hover.lifts) issue('warn', null, 'Its jets lift its weight but cannot be pointed to hold it still');
            else if (!gyroHolds) issue('warn', null, `Holding level in the air takes ${(tr.torque / 1e6).toFixed(0)} MN m its jets cannot give and its gyros (${(gyro / 1e6).toFixed(0)} MN m) cannot hold: it tumbles`);
        }
    }

    // --- weapons ------------------------------------------------------------------------------
    const weapons = [];
    const fire = regimes.fire;
    let dps = 0, alpha = 0;
    for (const x of mods) {
        const wp = x.def.spec.weapon;
        if (!wp) continue;
        const fed = Math.min(feed[x.inst].power, feed[x.inst].ammo, feed[x.inst].data) * fire.power.sat * fire.data.sat * fire.ammo.sat;
        const dmg = wp.kind === 'explosive' ? wp.damage * 0.5 : wp.damage;   // a kg of missile lands 0.5 MJ
        weapons.push({ key: x.key, inst: x.inst, id: x.def.m.id, label: x.def.fam.label, kind: wp.kind, damage: dmg, rate: dmg * wp.rof * fed, fed });
        dps += dmg * wp.rof * fed; alpha += dmg;
    }

    // --- what covers what matters -----------------------------------------------------------------
    const protection = [];
    for (const seg of design.segments) {
        const s = S[seg.id];
        for (const d of s.mods) {
            if (d.fault || !(d.fam.volatile || d.m.type === 'cockpit')) continue;
            let least = Infinity, where = null;
            for (const f of FACES) {
                const ax = faceAxis(f), pl = seg.armor[f] || { t: 0, mat: 'steel' };
                const depth = faceSign(f) > 0 ? (s.grid.n[ax] - d.m.cell[ax] - d.m.size[ax]) : d.m.cell[ax];
                const mm = pl.t * 1000 * (ARMOR[pl.mat] || ARMOR.steel).kinetic + depth * CELL * 12;
                if (mm < least) { least = mm; where = f; }
            }
            protection.push({ id: d.m.id, seg: seg.id, label: d.fam.label, mm: least, face: where, faceName: faceName(seg, where, 1), cockpit: d.m.type === 'cockpit' });
        }
    }
    protection.sort((a, b) => a.mm - b.mm);

    // --- what is wrong ------------------------------------------------------------------------------
    if (!opts.dead) {
        const cockpits = design.modules.filter((m) => m.type === 'cockpit' && !modDefs[m.id]?.fault);
        const cpInst = mods.filter((x) => x.def.m.type === 'cockpit').length;
        if (cpInst === 0) issue('error', null, 'No cockpit');
        else if (cpInst > 1) issue('warn', cockpits[0].id, 'More than one cockpit');
        const say = (key, k, text) => {
            const r = regimes[key][k];
            if (r.sat < 0.995 && r.demand > 0) issue('warn', null, text(r));
        };
        const secs = (s) => (s === Infinity ? '' : s < 1 ? ' at once' : ` after ${s.toFixed(0)} s`);
        say('stand', 'power', (r) => `Standing still draws ${fmt.mw(r.demand)}; it generates ${fmt.mw(r.supply)}`);
        say('combat', 'power', (r) => `Combat draws ${fmt.mw(r.demand)}; it generates ${fmt.mw(r.supply)} and browns out${secs(r.endurance)}`);
        say('combat', 'coolant', (r) => `Combat makes ${fmt.mw(r.demand)} of heat; it sheds ${fmt.mw(r.supply)} and overheats${secs(r.endurance)}`);
        say('stand', 'coolant', (r) => `It overheats standing still: ${fmt.mw(r.demand)} of heat, ${fmt.mw(r.supply)} shed`);
        say('combat', 'data', (r) => `Its systems need ${Math.ceil(r.demand)} control channels; it has ${Math.floor(r.supply)}`);
        if (regimes.burn.fuel.demand > 0 && regimes.burn.fuel.store <= 0) issue('error', null, 'Its engines burn fuel and it carries none');
        if (regimes.fire.ammo.demand > 0 && regimes.fire.ammo.store <= 0) issue('error', null, 'Its guns have no magazine');
    }

    const report = {
        mass, com, inertia, weight, height, frontal, rest, insts, dead,
        regimes, trunks, feed, joints, move, flight, weapons, dps, alpha, protection, issues,
        mods, modDefs, segs: S, legs, soleArea,
    };
    if (opts.failures !== false && !opts.dead) report.failures = failures(design, report);
    return report;
}

/**
 * What the machine loses with each part shot away, worst first: each entry is
 * one instance gone (with all that hangs from it) and what is left.
 */
function failures(design, base) {
    const out = [];
    const pct = (a, b) => (b > 0 ? Math.round(100 * (1 - a / b)) : 0);
    for (const it of base.insts) {
        if (!it.parent) continue;
        const r = evaluate(design, { dead: new Set([it.id]), failures: false });
        const lost = [];
        let score = 0;
        const hadPilot = base.mods.some((x) => x.def.m.type === 'cockpit'), hasPilot = r.mods.some((x) => x.def.m.type === 'cockpit');
        if (hadPilot && !hasPilot) { lost.push('the pilot'); score += 1000; }
        const pw = pct(r.regimes.combat.power.supply, base.regimes.combat.power.supply);
        if (pw >= 5) { lost.push(pw + '% of its power'); score += pw * 3; }
        const cl = pct(r.regimes.combat.coolant.supply, base.regimes.combat.coolant.supply);
        if (cl >= 5) { lost.push(cl + '% of its cooling'); score += cl; }
        const ch = pct(r.regimes.combat.data.supply, base.regimes.combat.data.supply);
        if (ch >= 5) { lost.push(ch + '% of its control'); score += ch * 2; }
        if (base.move.stands && !r.move.stands) { lost.push('its footing'); score += 200; }
        const th = pct(r.flight.lift, base.flight.lift);
        if (th >= 5) { lost.push(th + '% of its lift'); score += th; }
        if (base.flight.hover.ok && !r.flight.hover.ok) { lost.push(r.flight.tw < 1 ? 'flight' : 'level flight'); score += 120; }
        const dp = pct(r.dps, base.dps);
        if (dp >= 5) { lost.push(dp + '% of its fire'); score += dp * 1.5; }
        const fu = pct(r.mass.fuel, base.mass.fuel);
        if (fu >= 5) { lost.push(fu + '% of its fuel'); score += fu * 0.8; }
        if (!lost.length) continue;
        out.push({ inst: it.id, seg: it.seg.id, name: it.seg.name + (it.side ? (it.side > 0 ? ' (R)' : ' (L)') : ''), lost, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}

/** Rates every actuator (or only segment `only`'s) at `margin` times what its joint must hold. */
export function autoActuators(design, margin, only) {
    margin = margin || 1.4;
    for (let pass = 0; pass < 3; pass++) {
        const r = evaluate(design, { failures: false });
        for (const seg of design.segments) {
            if (!seg.parent || seg.joint.type === 'fixed' || (only && seg.id !== only)) continue;
            let hold = 0;
            for (const it of r.insts) if (it.seg === seg) hold = Math.max(hold, r.joints[it.id].hold);
            const mn = hold * margin / 1e6, step = mn < 20 ? 1 : mn < 200 ? 5 : 25;
            seg.joint.rating = Math.max(1, Math.ceil(mn / step) * step);
        }
    }
    return design;
}

/** Gauges every frame (or only segment `only`'s) to hold `margin` times what passes through its joint. */
export function autoFrames(design, margin, only) {
    margin = margin || 1.5;
    for (let pass = 0; pass < 3; pass++) {
        const r = evaluate(design, { failures: false });
        for (const seg of design.segments) {
            if (!seg.parent || (only && seg.id !== only)) continue;
            let worst = Infinity;
            for (const it of r.insts) if (it.seg === seg) worst = Math.min(worst, r.joints[it.id].structMargin);
            if (!isFinite(worst)) continue;
            seg.frame.gauge = clamp(Math.ceil(seg.frame.gauge * margin / worst * 10) / 10, 0.4, 8);
        }
    }
    return design;
}

/** Actuators, frames and lines sized to the machine as it is laid out. */
export function settle(design) {
    for (let i = 0; i < 2; i++) { autoActuators(design); autoFrames(design); autoLines(design); }
    return design;
}

/**
 * Sizes every line to what crosses its joint, with `margin` to spare. Lines
 * weigh something, and weight changes what the jets ask for, so it settles in
 * a couple of passes.
 */
export function autoLines(design, margin) {
    margin = margin || 1.2;
    const round = (v, k) => {
        if (v <= 0) return 0;
        if (k === 'data') return Math.ceil(v - 1e-6);
        const step = v < 10 ? 1 : v < 100 ? 5 : v < 1000 ? 25 : 100;
        return Math.ceil(v / step) * step;
    };
    for (let pass = 0; pass < 3; pass++) {
        const r = evaluate(design, { failures: false });
        for (const seg of design.segments) {
            if (!seg.parent) continue;
            for (const k of LINE_KINDS) {
                let req = 0;
                for (const it of r.insts) if (it.seg === seg) req = Math.max(req, r.trunks[it.id][k].req);
                seg.lines[k] = { cap: round(req * (k === 'data' ? 1 : margin), k), n: seg.lines[k]?.n || 1 };
            }
        }
    }
    return design;
}
