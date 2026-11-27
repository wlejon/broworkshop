// demos/foundry/main.js — the foundry: design mechanisms from parts and from
// designs already compiled, against a goal. A design compiles to a contract
// (box, ports, what each output gives and holds), and the level above builds
// with that contract as if it were a part.

import { boot } from "/lib/kit/app.js";
import { sceneViewport } from "/lib/kit/viewport3d.js";
import { History } from "/lib/kit/history.js";
import { h, clear } from "/lib/kit/dom.js";
import { PARTS, partDefaults, buildPart } from "/lib/foundry/parts.js";
import { compileLibrary, invalidate, reachingSpin } from "/lib/foundry/compile.js";
import { starterLibrary } from "/lib/foundry/designs.js";
import { createFoundryView } from "/app/view.js";
import * as P from "/app/panels.js";
import { machineOf } from "/lib/foundry/site.js";
import { renderDeck, updateDeck } from "/app/deck.js";
import { YARDS } from "/lib/foundry/yards.js";
import { crew as crewOf } from "/lib/foundry/pilot.js";

const fs = require('fs');
const { status } = boot({
    status: '#status',
    menu: {
        file: [
            { id: 'file.new', label: 'New Design', accel: 'Ctrl+N' },
            { id: 'file.copy', label: 'Copy Design' },
            { id: 'file.restore', label: 'Restore the Starter Designs' },
        ],
        handlers: { 'file.new': () => newDesign(), 'file.copy': () => copyDesign(), 'file.restore': () => restoreStarter() },
    },
});
const $ = (id) => document.getElementById(id);

const lib = starterLibrary();
const cache = compileLibrary(lib);
const history = new History({ limit: 300, onChange: () => { $('undo').disabled = !history.canUndo(); $('redo').disabled = !history.canRedo(); } });

const vp = sceneViewport($('stage3d'), { orbit: { fov: 38 }, controls: { minDist: 0.02, orbitButton: 0, panButton: 2 } });
const view = createFoundryView(vp);
vp.onFrame((dt) => view.tick(dt));

let currentId = 'drivePod';
let trail = ['drivePod'];      // breadcrumb: the designs opened to get here
let selected = null;

function contract(id) {
    let c = cache.get(id);
    if (!c) { compileLibrary(lib, cache); c = cache.get(id); }
    return c;
}

function outPort(c) {
    if (c.goal) return c.goal.out;
    const p = c.ports.find((x) => x.dir === 'out');
    return p ? p.id : null;
}

/** The operating point at the load slider: { flow, effort } at the output. */
function operatingPoint(c) {
    const outId = outPort(c);
    const load = +$('load').value;
    const src = c.sources.find((s) => s.port === outId);
    const path = c.paths.find((p) => p.to === outId);
    const mount = (c.mounts || []).find((m) => m.port === outId);
    if (mount) return { payloadKg: isFinite(mount.payloadKg) ? mount.payloadKg * load * 2 : 0 };
    if (src && !src.unpowered) {
        const f = src.noLoad * (1 - load);
        const e = Math.max(0, Math.min(src.stall * (1 - f / src.noLoad), f > 0 ? src.power / f : Infinity));
        return { flow: f, effort: e };
    }
    if (path) {
        const fIn = c.goal && c.goal.given ? c.goal.given.flow : 0;
        const eIn = c.goal && c.goal.given ? c.goal.given.effort : 0;
        return { flow: fIn / path.k, effort: Math.min(path.peak, eIn * path.k * path.eff * load * 2) };
    }
    return null;
}

// --- rendering ------------------------------------------------------------------------

const framedSize = new Map();   // design → the size the camera last framed it at

function renderAll(opts) {
    const c = contract(currentId);
    const d = lib[currentId];
    renderCrumbs();
    P.renderLibrary($('library'), lib, cache, currentId, open, useDesign, canUse);
    P.renderTitle($('title'), c, { rename: renameDesign, note: setNote });
    P.renderGoal($('goal'), c, $('goalPill'), { set: setGoal, draft: (out) => draftGoal(c, out), refresh: () => renderAll({ view: false }) });
    $('delDesign').disabled = usersOf(currentId).length > 0;
    $('delDesign').title = usersOf(currentId).length ? `Used in ${usersOf(currentId).map((x) => x.name).join(', ')}` : `Delete ${d.name}`;
    P.renderContract($('contract'), c);
    $('emptyStage').hidden = d.children.length > 0;
    P.renderProblems($('problems'), c, selectChild);
    $('problemsCard').hidden = false;
    if (!opts || opts.view !== false) {
        // An edit keeps the camera unless the design outgrew what it framed or shrank well inside it.
        const size = Math.max(...c.size);
        const was = framedSize.get(currentId) || 0;
        const frame = !(opts && opts.keepCamera) || !(was > 0) || size > was * 1.3 || size < was * 0.4;
        view.show(c, { frame });
        if (frame) framedSize.set(currentId, size);
    }
    if (selected && !c.children.some((x) => x.id === selected)) selected = null;
    view.select(selected);
    P.renderInspector($('inspector'), $('inspTitle'), d, c, selected, inspectorApi());
    renderBench();
    $('stats').textContent = saveError ? `not saved: ${saveError}` : `${Object.keys(lib).length} designs · ${c.partCount} parts in ${P.fmtBox(c.size)}`;
}

/** Select a child (null for none): highlighted in the view and the flow, open in the inspector. */
function selectChild(id) {
    selected = id || null;
    view.select(selected);
    markFlow();
    P.renderInspector($('inspector'), $('inspTitle'), lib[currentId], contract(currentId), selected, inspectorApi());
    if (selected) $('inspector').parentNode.scrollIntoView({ block: 'nearest' });
}

function markFlow() {
    for (const chip of $('flow').querySelectorAll('[data-child]')) chip.classList.toggle('sel', chip.dataset.child === selected);
}

function renderBench() {
    const c = contract(currentId);
    const outId = outPort(c);
    const op = operatingPoint(c);
    const out = c.ports.find((p) => p.id === outId);
    P.renderFlow($('flow'), c, outId, op ? (op.payloadKg ?? op.effort) : 0);
    markFlow();
    $('outEmpty').hidden = !!op;
    $('curve').hidden = !op;
    $('loadRow').hidden = !op;
    P.drawCurve($('curve'), c, outId, op);
    if (out && op && op.payloadKg != null) {
        $('loadVal').textContent = `${P.fmtKg(op.payloadKg)} at the ${out.label.toLowerCase()}`;
        $('outHint').textContent = out.label;
    } else if (out && op) {
        $('loadVal').textContent = `${P.fmtEffort(out.domain, op.effort)} at ${P.fmtFlow(out.domain, op.flow)}`;
        $('outHint').textContent = out.label;
        view.setFlows({ [outId]: op.flow });
    } else {
        $('loadVal').textContent = '';
        $('outHint').textContent = '';
    }
}

function renderCrumbs() {
    const el = $('crumbs');
    clear(el);
    trail.forEach((id, i) => {
        if (i) el.append(h('span', { class: 'sep' }, '›'));
        const b = h('button', { class: i === trail.length - 1 ? 'cur' : '' }, lib[id].name);
        b.addEventListener('click', () => { trail = trail.slice(0, i + 1); currentId = id; selected = null; renderAll(); });
        el.append(b);
    });
}

// --- navigation ---------------------------------------------------------------------

let cameFrom = null;   // the design open before this one, where deleting this one goes back to

function open(id) {
    if (id !== currentId) cameFrom = currentId;
    currentId = id;
    trail = [id];
    selected = null;
    renderAll();
    if (machine) buildMachine();
}

function drillInto(childId) {
    const spec = lib[currentId].children.find((x) => x.id === childId);
    if (!spec || !spec.design) return;
    trail.push(spec.design);
    currentId = spec.design;
    selected = null;
    renderAll();
}

// --- edits (every one undoable: the design is snapshotted around it) ------------------------

function edit(label, fn) {
    const id = currentId;
    const before = structuredClone(lib[id]);
    fn(lib[id]);
    const after = structuredClone(lib[id]);
    const apply = (snap) => () => {
        lib[id] = structuredClone(snap);
        invalidate(id, lib, cache);
        compileLibrary(lib, cache);
        if (currentId === id) renderAll({ keepCamera: true }); else open(id);
        save();
    };
    history.record(label, apply(after), apply(before));
    // What the designs built on this one made of their goals, before and after.
    const above = Object.keys(lib).filter((k) => k !== id && contains(k, id));
    const was = new Map(above.map((k) => [k, cache.get(k) ? P.statusOf(cache.get(k)) : null]));
    invalidate(id, lib, cache);
    compileLibrary(lib, cache);
    renderAll({ keepCamera: true });
    save();
    const c = contract(id);
    const lost = above.filter((k) => was.get(k) === 'pass' && P.statusOf(contract(k)) !== 'pass').map((k) => lib[k].name);
    const won = above.filter((k) => was.get(k) && was.get(k) !== 'pass' && P.statusOf(contract(k)) === 'pass').map((k) => lib[k].name);
    const ripple = [lost.length ? `${lost.join(', ')} now ${lost.length > 1 ? 'miss their goals' : 'misses its goal'}` : '', won.length ? `${won.join(', ')} now ${won.length > 1 ? 'meet their goals' : 'meets its goal'}` : ''].filter(Boolean).join('; ');
    if (!c.ok) status.warn(`${label}: ${c.errors[0]}`);
    else if (lost.length) status.warn(`${label}. ${ripple}.`);
    else status.set(`${label}.${ripple ? ` ${ripple}.` : ''}`);
}

function freshId(d, base) {
    let k = 1;
    while (d.children.some((c) => c.id === `${base}${k}`)) k++;
    return `${base}${k}`;
}

const splitRef = (r) => [r.slice(0, r.lastIndexOf('.')), r.slice(r.lastIndexOf('.') + 1)];

/**
 * Wire a new child in, so it lands somewhere useful:
 *  - what the design was giving out goes into the new child, which gives it out now;
 *  - else each of its inputs takes a free output of the same kind, and each of
 *    its outputs feeds a free input (one the design exposed stops being exposed);
 *  - then the design exposes what is still loose: its first output if it has
 *    none, and each loose input of a kind it takes no input of yet.
 */
function autoLink(d, c, childId, ports) {
    const portOf = (ref) => { const [cid, pid] = splitRef(ref); const ch = c.children.find((x) => x.id === cid); return ch && ch.el.ports.find((x) => x.id === pid); };
    const linked = new Set(d.links.flatMap((l) => [l.a, l.b]));
    const ins = ports.filter((p) => p.dir === 'in'), outs = ports.filter((p) => p.dir === 'out');
    // A mount joined to a mount turns to carry the two furthest: an arm of segments runs on, not coils.
    const specOf = (cid) => d.children.find((x) => x.id === cid);
    const link = (a, b, dom) => {
        const l = { a, b };
        if (dom === 'mnt') {
            // The turn of the link that placed `a`, if one did: the next turn answers it, so a chain runs straight.
            const [ca, pa] = splitRef(a), [cb, pb] = splitRef(b);
            const into = d.links.find((x) => x.b === `${ca}.${pb}` || x.a === `${ca}.${pb}`);
            l.spin = reachingSpin(lib, cache, specOf(ca), pa, specOf(cb), pb, into ? into.spin || 0 : null);
        }
        d.links.push(l); linked.add(a); linked.add(b);
    };
    let chained = false;
    for (const ex of d.ports) {
        const q = portOf(ex.at);
        const p = q && q.dir === 'out' && ins.find((x) => x.domain === q.domain && !linked.has(`${childId}.${x.id}`));
        if (!p) continue;
        link(ex.at, `${childId}.${p.id}`, q.domain);
        const next = outs.find((x) => x.domain === q.domain) || outs.find((x) => x.domain !== 'elec');
        if (next) { ex.at = `${childId}.${next.id}`; ex.label = next.label; linked.add(ex.at); }
        else d.ports.splice(d.ports.indexOf(ex), 1);
        chained = true;
        break;
    }
    const exposed = new Set(d.ports.map((p) => p.at));
    for (const p of ins) {
        const ref = `${childId}.${p.id}`;
        if (linked.has(ref)) continue;
        for (const o of c.children) {
            const q = o.el.ports.find((x) => x.domain === p.domain && x.dir === 'out' && !linked.has(`${o.id}.${x.id}`) && !exposed.has(`${o.id}.${x.id}`));
            if (q) { link(`${o.id}.${q.id}`, ref, p.domain); break; }
        }
    }
    if (!chained) {
        for (const p of outs) {
            const ref = `${childId}.${p.id}`;
            if (linked.has(ref)) continue;
            for (const o of c.children) {
                const q = o.el.ports.find((x) => x.domain === p.domain && x.dir === 'in' && !linked.has(`${o.id}.${x.id}`));
                if (!q) continue;
                const oref = `${o.id}.${q.id}`;
                d.ports = d.ports.filter((x) => x.at !== oref);
                link(ref, oref, p.domain);
                break;
            }
        }
    }
    const expose = (p) => {
        let id = p.id, k = 2;
        while (d.ports.some((x) => x.id === id)) id = `${p.id}${k++}`;
        const label = d.ports.some((x) => x.label === p.label) ? `${p.label} (${childId})` : p.label;
        d.ports.push({ id, label, at: `${childId}.${p.id}` });
    };
    const isOut = (ex) => { const q = portOf(ex.at) || ports.find((x) => `${childId}.${x.id}` === ex.at); return q && q.dir === 'out'; };
    if (!d.ports.some(isOut)) {
        const p = outs.find((x) => !linked.has(`${childId}.${x.id}`) && x.domain !== 'elec') || outs.find((x) => !linked.has(`${childId}.${x.id}`));
        if (p) expose(p);
    }
    // Power comes in on its own line for each child that needs it; a mechanical input or a mount once.
    for (const p of ins) {
        if (linked.has(`${childId}.${p.id}`)) continue;
        const has = p.domain !== 'elec' && d.ports.some((ex) => { const q = portOf(ex.at); return q && q.dir === 'in' && q.domain === p.domain; });
        if (!has) expose(p);
    }
}

function addChild(spec) {
    edit(`Add ${spec.part ? PARTS[spec.part].label : lib[spec.design].name}`, (d) => {
        const c = contract(currentId);
        const ports = spec.part ? buildPart(spec.part, spec.params).ports : contract(spec.design).ports;
        d.children.push(spec);
        autoLink(d, c, spec.id, ports);
    });
    selected = spec.id;
    renderAll({ keepCamera: true });
}

function addPart(type) {
    const d = lib[currentId];
    addChild({ id: freshId(d, type.replace(/[A-Z].*/, '').slice(0, 4)), part: type, params: partDefaults(type) });
}

/** Whether design `a` is `b` or has it inside, at any depth. */
function contains(a, b, seen = new Set()) {
    if (a === b) return true;
    if (seen.has(a) || !lib[a]) return false;
    seen.add(a);
    return lib[a].children.some((ch) => ch.design && contains(ch.design, b, seen));
}

/** A design can go into the open one unless it holds the open one already. */
const canUse = (id) => !contains(id, currentId);

function useDesign(id) {
    const d = lib[currentId];
    if (!canUse(id)) {
        status.warn(`${lib[id].name} already has ${d.name} inside it, so it cannot go in ${d.name}.`);
        return;
    }
    const base = lib[id].name.replace(/[^A-Za-z]/g, '').slice(0, 3).toLowerCase() || 'd';
    addChild({ id: freshId(d, base), design: id });
}

function inspectorApi() {
    const ref = (port) => `${selected}.${port}`;
    const findLink = (d, r) => d.links.find((l) => l.a === r || l.b === r);
    return {
        setParam(key, value) {
            const spec = lib[currentId].children.find((x) => x.id === selected);
            const sc = PARTS[spec.part].schema[key];
            const shown = sc && sc.options ? sc.options[value] : value;
            edit(`Set ${sc ? sc.label : key}${sc && sc.unit ? ` (${sc.unit})` : ''} of ${selected} to ${shown}`, (d) => {
                const ch = d.children.find((x) => x.id === selected);
                ch.params = { ...(ch.params || partDefaults(ch.part)), [key]: value };
            });
        },
        open() { drillInto(selected); },
        /** Designs that can stand in for the selected one: they have every port it is wired by, the same way round. */
        swapOptions() {
            const spec = lib[currentId].children.find((x) => x.id === selected);
            if (!spec || !spec.design) return [];
            const c = contract(currentId), el = c.children.find((x) => x.id === selected).el;
            const used = new Set([...lib[currentId].links.flatMap((l) => [l.a, l.b]), ...lib[currentId].ports.map((p) => p.at)]
                .filter((r) => splitRef(r)[0] === selected).map((r) => splitRef(r)[1]));
            const need = el.ports.filter((p) => used.has(p.id));
            return Object.keys(lib)
                .filter((k) => k !== spec.design && canUse(k))
                .filter((k) => { const o = contract(k); return o.ok && need.every((p) => o.ports.some((q) => q.id === p.id && q.domain === p.domain && q.dir === p.dir)); })
                .map((k) => ({ id: k, name: lib[k].name }));
        },
        swap(designId) {
            const id = selected;
            edit(`Swap ${id} for ${lib[designId].name}`, (d) => { d.children.find((x) => x.id === id).design = designId; });
        },
        /**
         * Chain `n` more of the selected design after it, each one's output into the
         * next one's input of the same kind (a tip into a base, a shaft into a shaft).
         * What the selected one fed, and the port it gave out, move to the last.
         * Each copy's power comes in on its own exposed line.
         */
        chain(n) {
            const id0 = selected, spec0 = lib[currentId].children.find((x) => x.id === id0);
            if (!spec0 || !spec0.design || !(n >= 1)) return;
            const X = contract(spec0.design);
            const pairOf = (dom) => { const o = X.ports.find((p) => p.dir === 'out' && p.domain === dom); const i = X.ports.find((p) => p.dir === 'in' && p.domain === dom); return o && i ? [o, i] : null; };
            const pair = pairOf('mnt') || pairOf('rot') || pairOf('lin') || pairOf('hyd');
            if (!pair) { status.warn(`${X.name} has no output that goes into an input of its own kind, so it does not chain.`); return; }
            const [o, i] = pair;
            // Each link's turn answers the one before it (see reachingSpin); the copies are all
            // alike, so the answers repeat and four probes cover a chain of any length.
            const into0 = lib[currentId].links.find((l) => l.b === `${id0}.${i.id}` || l.a === `${id0}.${i.id}`);
            const answers = new Map();
            const nextSpin = (before) => {
                if (!answers.has(before)) answers.set(before, reachingSpin(lib, cache, spec0, o.id, { design: spec0.design }, i.id, before));
                return answers.get(before);
            };
            let spin = into0 ? into0.spin || 0 : null;
            n = Math.min(500, Math.round(n));
            edit(`Chain ${n} more ${X.name}`, (d) => {
                const tail0 = `${id0}.${o.id}`;
                const onward = d.links.find((l) => l.a === tail0 || l.b === tail0);
                const ex = d.ports.find((p) => p.at === tail0);
                if (onward) d.links.splice(d.links.indexOf(onward), 1);
                const base = id0.replace(/\d+$/, '');
                let prev = id0;
                for (let k = 0; k < n; k++) {
                    const id = freshId(d, base);
                    d.children.push({ id, design: spec0.design });
                    spin = nextSpin(spin);
                    d.links.push({ a: `${prev}.${o.id}`, b: `${id}.${i.id}`, spin });
                    for (const p of X.ports) {
                        if (p.dir !== 'in' || p.domain !== 'elec') continue;
                        let pid = p.id, j = 2;
                        while (d.ports.some((x) => x.id === pid)) pid = `${p.id}${j++}`;
                        d.ports.push({ id: pid, label: `${p.label} (${id})`, at: `${id}.${p.id}` });
                    }
                    prev = id;
                }
                const tail = `${prev}.${o.id}`;
                if (onward) d.links.push(onward.a === tail0 ? { ...onward, a: tail } : { ...onward, b: tail });
                if (ex) ex.at = tail;
            });
        },
        /**
         * The selected child's free inputs that a drive can go on: unlinked (or only
         * exposed) mechanical inputs of one kind, when there are two or more of it,
         * as on a slewing ring's pinions. { domain, ports, options } or null; options
         * are the designs and parts with an output of that kind.
         */
        fillOptions() {
            const c = contract(currentId), ch = c.children.find((x) => x.id === selected);
            if (!ch) return null;
            const d = lib[currentId], linked = new Set(d.links.flatMap((l) => [l.a, l.b]));
            const free = ch.el.ports.filter((p) => p.dir === 'in' && ['rot', 'lin', 'hyd'].includes(p.domain) && !linked.has(`${selected}.${p.id}`));
            const byDom = new Map();
            for (const p of free) byDom.set(p.domain, [...(byDom.get(p.domain) || []), p]);
            const [domain, ports] = [...byDom].sort((a, b) => b[1].length - a[1].length)[0] || [];
            if (!ports || ports.length < 2) return null;
            const designs = Object.keys(lib).filter((k) => k !== currentId && canUse(k))
                .filter((k) => { const o = contract(k); return o.ok && o.ports.some((q) => q.dir === 'out' && q.domain === domain); })
                .map((k) => ({ value: `design:${k}`, label: lib[k].name }));
            const parts = Object.entries(PARTS).filter(([t]) => buildPart(t).ports.some((q) => q.dir === 'out' && q.domain === domain && !buildPart(t).ports.some((r) => r.dir === 'in' && r.domain === domain)))
                .map(([t, def]) => ({ value: `part:${t}`, label: def.label }));
            return { domain, ports, options: [...designs, ...parts] };
        },
        /** A new `what` ('design:<id>' or 'part:<type>') on each of the selected child's free inputs, in one edit. */
        fill(what) {
            const F = inspectorApi().fillOptions();
            if (!F) return;
            const [kind, ref] = what.split(':');
            const proto = kind === 'design' ? contract(ref) : buildPart(ref);
            const out = proto.ports.find((q) => q.dir === 'out' && q.domain === F.domain);
            const name = kind === 'design' ? lib[ref].name : PARTS[ref].label, id0 = selected;
            edit(`Drive ${F.ports.length} inputs of ${id0} with ${name}`, (d) => {
                const base = kind === 'design' ? (name.replace(/[^A-Za-z]/g, '').slice(0, 3).toLowerCase() || 'd') : ref.replace(/[A-Z].*/, '').slice(0, 4);
                for (const p of F.ports) {
                    const at = `${id0}.${p.id}`;
                    // An input given out by the design is driven here now instead.
                    d.ports = d.ports.filter((x) => x.at !== at);
                    const id = freshId(d, base);
                    d.children.push(kind === 'design' ? { id, design: ref } : { id, part: ref, params: partDefaults(ref) });
                    d.links.push({ a: `${id}.${out.id}`, b: at });
                    // Each drive's power comes in on its own line.
                    for (const q of proto.ports) {
                        if (q.dir !== 'in' || q.domain !== 'elec') continue;
                        let pid = q.id, j = 2;
                        while (d.ports.some((x) => x.id === pid)) pid = `${q.id}${j++}`;
                        d.ports.push({ id: pid, label: `${q.label} (${id})`, at: `${id}.${q.id}` });
                    }
                }
            });
        },
        remove() {
            const id = selected;
            const c = contract(currentId);
            edit(`Remove ${id}`, (d) => {
                // Close the chain up: what fed it drives what it fed, and what it gave
                // out the design now gives out from upstream.
                const ins = c.links.filter((l) => l.in.startsWith(id + '.')), outs = c.links.filter((l) => l.out.startsWith(id + '.'));
                const domainOf = (r) => { const [cid, pid] = splitRef(r); const ch = c.children.find((x) => x.id === cid); const p = ch && ch.el.ports.find((q) => q.id === pid); return p && p.domain; };
                d.children = d.children.filter((x) => x.id !== id);
                d.links = d.links.filter((l) => !l.a.startsWith(id + '.') && !l.b.startsWith(id + '.'));
                for (const i of ins) {
                    const dom = domainOf(i.out);
                    const o = outs.find((x) => domainOf(x.in) === dom);
                    if (o) { d.links.push({ a: i.out, b: o.in }); outs.splice(outs.indexOf(o), 1); continue; }
                    const ex = d.ports.find((p) => p.at.startsWith(id + '.') && domainOf(p.at) === dom && !c.ports.some((q) => q.id === p.id && q.dir === 'in'));
                    if (ex) ex.at = i.out;
                }
                d.ports = d.ports.filter((p) => !p.at.startsWith(id + '.'));
            });
            selected = null;
            renderAll({ keepCamera: true });
        },
        link(port, other) { edit(`Link ${ref(port)} to ${other}`, (d) => d.links.push({ a: ref(port), b: other })); },
        unlink(port) { edit(`Unlink ${ref(port)}`, (d) => { const l = findLink(d, ref(port)); d.links.splice(d.links.indexOf(l), 1); }); },
        spin(port) { edit(`Turn ${ref(port)}`, (d) => { const l = findLink(d, ref(port)); l.spin = ((l.spin || 0) + 1) % 4; }); },
        expose(port) {
            edit(`Expose ${ref(port)}`, (d) => {
                const c = contract(currentId);
                const p = c.children.find((x) => x.id === selected).el.ports.find((q) => q.id === port);
                let id = p.id; let k = 2;
                while (d.ports.some((x) => x.id === id)) id = `${p.id}${k++}`;
                d.ports.push({ id, label: p.label, at: ref(port) });
            });
        },
        unexpose(port) { edit(`Hide ${ref(port)}`, (d) => { d.ports = d.ports.filter((x) => x.at !== ref(port)); }); },
    };
}

// --- the library: new, copy, delete, rename, and the goal (each undoable) ----------------------

const PAINTS = [[0.86, 0.36, 0.10], [0.92, 0.66, 0.12], [0.10, 0.52, 0.56], [0.70, 0.13, 0.12], [0.30, 0.34, 0.40], [0.36, 0.30, 0.62], [0.24, 0.55, 0.26]];

/** Change the library itself (not one design): add or drop designs, undoably. */
function libEdit(label, fn, goTo) {
    const before = structuredClone(lib), from = currentId;
    fn();
    const after = structuredClone(lib), to = goTo || currentId;
    const apply = (snap, id) => () => {
        for (const k of Object.keys(lib)) delete lib[k];
        Object.assign(lib, structuredClone(snap));
        cache.clear();
        compileLibrary(lib, cache);
        open(lib[id] ? id : Object.keys(lib)[0]);
        save();
    };
    history.record(label, apply(after, to), apply(before, from));
    cache.clear();
    compileLibrary(lib, cache);
    open(to);
    save();
    status.set(`${label}.`);
}

function freshDesignId(base) {
    let k = 1;
    while (lib[`${base}${k}`]) k++;
    return `${base}${k}`;
}

function newDesign() {
    const id = freshDesignId('design');
    const n = id.slice(6);
    libEdit(`New design`, () => {
        lib[id] = { id, name: `Design ${n}`, paint: PAINTS[(+n - 1) % PAINTS.length], note: '', children: [], links: [], ports: [] };
    }, id);
}

function copyDesign() {
    const src = lib[currentId];
    const id = freshDesignId(currentId.replace(/\d+$/, '') + 'v');
    libEdit(`Copy ${src.name}`, () => {
        lib[id] = { ...structuredClone(src), id, name: `${src.name} (copy)` };
    }, id);
}

/** The designs that use `id` directly. */
const usersOf = (id) => Object.values(lib).filter((d) => d.children.some((ch) => ch.design === id));

function deleteDesign() {
    const id = currentId;
    const users = usersOf(id);
    if (users.length) { status.warn(`${lib[id].name} is used in ${users.map((d) => d.name).join(', ')}; remove it there first.`); return; }
    if (Object.keys(lib).length < 2) return;
    const next = cameFrom && cameFrom !== id && lib[cameFrom] ? cameFrom : Object.keys(lib).find((k) => k !== id);
    libEdit(`Delete ${lib[id].name}`, () => { delete lib[id]; }, next);
}

function renameDesign(name) {
    name = name.trim();
    if (!name || name === lib[currentId].name) return;
    edit(`Rename to ${name}`, (d) => { d.name = name; });
}

function setNote(note) {
    if (note.trim() === (lib[currentId].note || '')) return;
    edit('Change the note', (d) => { d.note = note.trim(); });
}

/** Down to two significant figures, so a goal drafted from a design is one it meets. */
function floor2(v) {
    if (!(v > 0) || !isFinite(v)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.floor(v / p) * p;
}

/**
 * A goal for output `outId` (else the first output) that the design meets as
 * it stands: what it lifts and how far, or what it holds at a working speed.
 */
function draftGoal(c, outId) {
    const out = c.ports.find((p) => p.id === outId) || c.ports.find((p) => p.dir === 'out' && (c.mounts.some((m) => m.port === p.id) || c.sources.some((s) => s.port === p.id) || c.paths.some((x) => x.to === p.id)));
    if (!out) return null;
    const m = c.mounts.find((x) => x.port === out.id);
    if (m) return { out: out.id, lift: { payloadKg: floor2(m.payloadKg), reachM: floor2(m.reach) } };
    const src = c.sources.find((s) => s.port === out.id);
    if (src && !src.unpowered) {
        const flow = src.noLoad * 0.5;
        const effort = Math.min(src.cont, src.stall * 0.5, src.power / flow);
        return { out: out.id, need: { effort: floor2(effort), flow: floor2(flow) } };
    }
    const path = c.paths.find((x) => x.to === out.id);
    if (path) {
        const given = { effort: 10, flow: 3000 * (2 * Math.PI / 60) };
        return { out: out.id, given, need: { effort: floor2(Math.min(given.effort * path.k * path.eff, path.cont)), flow: floor2(given.flow / path.k) } };
    }
    return null;
}

function setGoal(goal) {
    edit(goal ? 'Set the goal' : 'Clear the goal', (d) => { if (goal) d.goal = goal; else delete d.goal; });
}

// --- saving: the library is a file in the app's data dir, every change written through ----------

const STORE = `${bro.app.dataDir}/library.json`;
let saveError = null;   // why the last save failed, shown in the footer until one works

function save() {
    // Written beside and renamed over, so a crash mid-write leaves the last good library.
    try { fs.writeFileSync(STORE + '.tmp', JSON.stringify({ version: 1, designs: lib })); fs.renameSync(STORE + '.tmp', STORE); }
    catch (e) { saveError = e.message; console.error(`foundry: could not save the library: ${e.message}`); $("stats").textContent = `not saved: ${e.message}`; return; }
    saveError = null;
}

function loadSaved() {
    let saved = null;
    try { saved = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')).designs : null; } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return;
    for (const k of Object.keys(lib)) delete lib[k];
    Object.assign(lib, saved);
    cache.clear();
    compileLibrary(lib, cache);
}

function restoreStarter() {
    // The starter designs go back as they shipped; designs of your own stay.
    libEdit('Restore the starter designs', () => { Object.assign(lib, starterLibrary()); }, 'drivePod');
}

// --- wiring ---------------------------------------------------------------------------------

P.renderPalette($('palette'), addPart);
$('newDesign').addEventListener('click', newDesign);
$('copyDesign').addEventListener('click', copyDesign);
$('delDesign').addEventListener('click', deleteDesign);
$('undo').addEventListener('click', () => history.undo());
$('redo').addEventListener('click', () => history.redo());
$('load').addEventListener('input', renderBench);
// --- operating: the open design run as a machine ---------------------------------------------

let machine = null;             // operate.js machine of the open design, while operating
// Keys held on a lever or dial: key → { id, dir, t }. A held key starts its control slow and
// brings it up to full over KEY_RAMP seconds, so a tap nudges and a hold runs: a hanging
// load can be brought over a spot by hand without flinging it.
const held = new Map();
const KEY_START = 0.06, KEY_RAMP = 1.2;
function holdKey(m, k, ct, dir) {
    if (held.has(k)) return;
    held.set(k, { id: ct.id, dir, t: 0 });
    m.set(ct.id, dir * KEY_START);
}
function rampKeys(m, dt) {
    for (const hk of held.values()) { hk.t += dt; m.set(hk.id, hk.dir * Math.min(1, KEY_START + hk.t / KEY_RAMP)); }
}

function setOperating(on) {
    if (on === !!machine) return;
    document.body.classList.toggle('f-operating', on);
    $('operate').classList.toggle('on', on);
    $('operate').textContent = on ? 'Design' : 'Operate';
    $('deck').hidden = !on;
    held.clear();
    if (on) {
        selected = null; view.select(null);
        buildMachine();
        status.set('Drag a control, or hold its keys. Levers and dials stop when let go.');
    } else {
        machine.destroy();
        machine = null;
        view.setOperate(false);
        view.show(contract(currentId), { frame: false });
        renderAll({ view: false });
    }
}

function buildMachine() {
    const c = contract(currentId);
    if (machine) machine.destroy();
    machine = machineOf(c);
    view.show(c, { frame: false });
    view.setOperate(true);
    showMachine();
    renderDeck($('deck'), machine, (id, u) => machine.set(id, u));
    const mount = (c.mounts || [])[0];
    const max = mount && isFinite(mount.payloadKg) ? mount.payloadKg : 0;
    $('opLoadRow').hidden = !(max > 0);
    $('opLoad').max = String(max > 0 ? Math.ceil(max * 1.6) : 1);
    $('opLoad').step = String(max > 0 ? Math.max(0.1, max / 200) : 0.01);
    $('opLoad').value = '0';
    $('opHint').textContent = `${machine.controls.length} control${machine.controls.length === 1 ? '' : 's'}`;
    machine.powered = $('opPower').checked;
    machine.timeScale = +$('opSpeed').value;
    renderJointRows();
}

function renderJointRows() {
    const el = $('opJoints');
    clear(el);
    for (const J of machine.joints) {
        // Named by the control that moves it, which is what the operator knows it by.
        const ct = machine.controls.find((x) => x.joints.includes(J.j));
        const name = ct ? ct.label : J.label.split(' › ').at(-1).replace(/ \(\w+\)$/, '');
        el.append(h('div', { class: 'f-op-j', 'data-j': J.j },
            h('span', { class: 'n' }, name + (J.upright ? ' (turntable)' : '')),
            h('span', { class: 'v' }), h('div', { class: 'b' }, h('i', {}))));
    }
}

function updateOperate() {
    if (!machine) return;
    updateDeck($('deck'), machine);
    for (const row of $('opJoints').children) {
        const j = +row.dataset.j, J = machine.joints[j];
        const t = Math.abs(machine.torque[j]), cap = J.limit || J.cont || 1;
        row.querySelector('.v').textContent = `${machine.status[j]} · ${P.fmtEffort('rot', t)} of ${P.fmtEffort('rot', cap)}`;
        const bar = row.querySelector('i');
        bar.style.width = `${Math.min(100, (t / cap) * 100).toFixed(1)}%`;
        bar.className = t > cap ? 'bad' : t > cap * 0.85 ? 'warn' : '';
    }
    const kg = machine.payloadKg;
    $('opLoadVal').textContent = kg > 0 ? P.fmtKg(kg) : 'none';
}

/** The machine drawn where its world has it. */
function showMachine() {
    view.pose(machine.frames());
    view.setProps(machine.props());
}

vp.onFrame((dt) => {
    if (!machine) return;
    rampKeys(machine, Math.min(dt, 0.1));
    machine.step(Math.min(dt, 0.1));
    showMachine();
    for (const ct of machine.controls) if (ct.output) view.setFlows({ [ct.output]: ct.flow || 0 });
    updateOperate();
});

$('operate').addEventListener('click', () => setOperating(!machine));
$('opPower').addEventListener('change', () => { if (machine) machine.powered = $('opPower').checked; });
$('opSpeed').addEventListener('change', () => { if (machine) machine.timeScale = +$('opSpeed').value; });
$('opReset').addEventListener('click', () => { if (machine) { machine.reset(); showMachine(); } });
$('opLoad').addEventListener('input', () => { if (machine) machine.setPayload(+$('opLoad').value); });

// --- the yard: machines from the library working together ------------------------------------

let yard = null;                // { def, site, crew, driven } while in the yard

function setYard(on) {
    if (on === !!yard) return;
    if (on && machine) setOperating(false);
    document.body.classList.toggle('f-yarding', on);
    $('yardBtn').classList.toggle('on', on);
    $('deck').hidden = !on;
    held.clear();
    if (on) { openYard($('yardPick').value || YARDS[0].id); return; }
    yard.site.destroy();
    yard = null;
    view.closeYard();
    clear($('deck'));
    view.show(contract(currentId));
    renderAll();
}

function openYard(id) {
    const def = YARDS.find((y) => y.id === id) || YARDS[0];
    if (yard) yard.site.destroy();
    const site = def.build(contract);
    site.timeScale = +$('yardSpeed').value;
    yard = { def, site, crew: null, driven: null };
    $('yardPick').value = def.id;
    $('yardAbout').textContent = def.about;
    $('yardHint').textContent = `${site.machines.length} machines · ${site.tasks.length} task${site.tasks.length === 1 ? '' : 's'}`;
    view.showYard(site);
    runCrew(false);
    drive(null);
    renderYardLists();
    status.set('Run the crew to watch the machines do the work together, or click a machine and drive it yourself.');
}

/** Let the machines' pilots do the yard's open tasks (or stop them, leaving the machines where they are). */
function runCrew(on) {
    if (!yard) return;
    if (yard.crew) for (const p of yard.crew.pilots.values()) p.stop();
    yard.crew = null;
    if (on) {
        drive(null);
        yard.crew = crewOf(yard.site).assign();
        const failed = yard.crew.jobs.filter((j) => j.failed).map((j) => j.failed);
        status.set(failed.length ? `The crew cannot do it all: ${failed.join('; ')}.` : `The crew is on it: ${yard.crew.jobs.map((j) => `${j.task.label} by ${j.legs.map((l) => l.machine.name).join(', then ')}`).join('; ')}.`);
    }
    $('yardRun').classList.toggle('on', !!yard.crew);
    $('yardRun').textContent = yard.crew ? 'Stop the crew' : 'Run the crew';
}

/** Take machine `m` of the yard by hand (null: none): its deck, and its hook. */
function drive(m) {
    if (!yard) return;
    if (m && yard.crew) runCrew(false);
    yard.driven = m;
    held.clear();
    view.selectMachine(m);
    const el = $('deck');
    clear(el);
    if (!m) {
        el.append(h('div', { class: 'f-dk-empty' }, 'Click a machine (or press Tab) to drive it: its deck is compiled from what it is made of, its winch\'s Hoist with the rest. Let the hook down onto a crate and press Space to take it; Space again lets it go.'));
        renderYardLists();
        return;
    }
    renderDeck(el, m, (id, u) => m.set(id, u));
    const row = el.querySelector('.f-dk-row');
    if (!m.hook) {
        if (row) row.append(h('div', { class: 'f-hook' }, h('div', { class: 'f-dk-name' }, 'No hook'), h('div', { class: 'f-dk-read' }, h('span', { class: 'st' }, 'it carries no winch'))));
        renderYardLists();
        return;
    }
    const take = h('button', { class: 'small', id: 'hookTake' }, 'Take (Space)');
    take.addEventListener('click', () => hookToggle(m));
    const hoistKeys = m.hook.control.keys ? `${m.hook.control.keys[0].toUpperCase()} / ${m.hook.control.keys[1].toUpperCase()}` : '';
    if (row) row.append(h('div', { class: 'f-hook' },
        h('div', { class: 'f-dk-head' }, h('span', { class: 'f-dk-name' }, 'Hook'), h('span', { class: 'f-dk-keys' }, 'Space')),
        take,
        h('div', { class: 'f-dk-read' }, h('span', { class: 'st', id: 'hookSt' }), h('span', { class: 'val', id: 'hookVal' })),
        h('div', { class: 'f-yard-about' }, `Hoist (${hoistKeys}) takes the line in and pays it out.`)));
    renderYardLists();
}

function hookToggle(m) {
    if (!m.hook) { status.set(`${m.name} carries no winch, so it has no hook.`); return; }
    if (m.hook.crate) { m.release(); return; }
    if (!m.grab()) status.set(`${m.name}: no crate under the hook. Put the tip over one and let the line down onto it.`);
}

function renderYardLists() {
    if (!yard) return;
    const tasks = $('yardTasks'), ms = $('yardMachines');
    clear(tasks); clear(ms);
    for (const t of yard.site.tasks) tasks.append(h('div', { class: 'f-yard-item', 'data-task': t.id }, h('span', { class: 'dot' }), h('span', { class: 'n' }, t.label), h('span', { class: 'd' })));
    for (const m of yard.site.machines) {
        const el = h('div', { class: 'f-yard-item machine' + (yard.driven === m ? ' sel' : ''), 'data-machine': m.name }, h('span', { class: 'dot' }), h('span', { class: 'n' }, m.name), h('span', { class: 'd' }));
        el.addEventListener('click', () => drive(yard.driven === m ? null : m));
        ms.append(el);
    }
    updateYardLists();
}

function updateYardLists() {
    for (const t of yard.site.tasks) {
        const el = $('yardTasks').querySelector(`[data-task="${t.id}"]`);
        if (!el) continue;
        const job = yard.crew && yard.crew.jobs.find((j) => j.task === t);
        const carrier = yard.site.machines.find((m) => m.hook && m.hook.crate === t.crate);
        const text = t.done ? `done: on ${t.pad.name}` : job && job.failed ? job.failed : carrier ? `on ${carrier.name}'s hook` : job ? 'the crew has it' : 'open';
        el.className = 'f-yard-item' + (t.done ? ' done' : job && job.failed ? ' bad' : carrier || job ? ' busy' : '');
        el.querySelector('.d').textContent = text;
    }
    for (const m of yard.site.machines) {
        const el = $('yardMachines').querySelector(`[data-machine="${m.name}"]`);
        if (!el) continue;
        const p = yard.crew && yard.crew.pilots.get(m);
        const broken = m.status.includes('broken');
        const doing = broken ? 'broken' : p && p.busy ? p.doing : yard.driven === m ? 'yours to drive' : m.hook && m.hook.crate ? `holding ${m.hook.crate.name}` : 'standing by';
        el.className = 'f-yard-item machine' + (yard.driven === m ? ' sel' : '') + (broken ? ' bad' : p && p.busy ? ' busy' : '');
        el.querySelector('.d').textContent = doing;
    }
    if (yard.driven && $('hookSt')) {
        const m = yard.driven, cr = m.reachable();
        $('hookSt').textContent = m.hook.stalled ? `too heavy: ${m.hook.crate.name} is more than the winch pulls` : m.hook.crate ? (m.carrying() ? `lifting ${m.hook.crate.name}` : `on ${m.hook.crate.name}`) : cr ? `over ${cr.name}: Space takes it` : 'empty';
        $('hookSt').className = 'st ' + (m.hook.stalled ? 'bad' : m.hook.crate ? 'ok' : cr ? 'warn' : '');
        $('hookVal').textContent = `${m.hook.line.toFixed(2)} m`;
        $('hookTake').textContent = m.hook.crate ? 'Let go (Space)' : 'Take (Space)';
    }
}

vp.onFrame((dt) => {
    if (!yard) return;
    const d = Math.min(dt, 0.1);
    if (yard.crew) {
        yard.crew.step(d);
        if (!yard.crew.busy) {
            const all = yard.site.tasks.every((t) => t.done);
            status.set(all ? 'Every task is done.' : yard.crew.failed || 'The crew has stopped.');
            yard.crew = null;
            $('yardRun').classList.remove('on');
            $('yardRun').textContent = 'Run the crew';
        }
    } else { if (yard.driven) rampKeys(yard.driven, d); yard.site.step(d); }
    view.poseYard(yard.site);
    if (yard.driven) updateDeck($('deck'), yard.driven);
    updateYardLists();
});

for (const y of YARDS) $('yardPick').append(h('option', { value: y.id }, y.name));
$('yardBtn').addEventListener('click', () => setYard(!yard));
$('yardPick').addEventListener('change', () => { if (yard) openYard($('yardPick').value); });
$('yardReset').addEventListener('click', () => { if (yard) openYard(yard.def.id); });
$('yardRun').addEventListener('click', () => runCrew(!yard.crew));
$('yardSpeed').addEventListener('change', () => { if (yard) yard.site.timeScale = +$('yardSpeed').value; });

window.addEventListener('keyup', (e) => {
    if (yard && yard.driven) {
        const k = e.key.toLowerCase();
        const id = held.has(k) ? held.get(k).id : null;
        if (id) { held.delete(k); yard.driven.set(id, 0); }
        return;
    }
    const id = held.has(e.key.toLowerCase()) ? held.get(e.key.toLowerCase()).id : null;
    if (!id || !machine) return;
    held.delete(e.key.toLowerCase());
    const ct = machine.controls.find((x) => x.id === id);
    if (ct && (ct.kind === 'lever' || ct.kind === 'dial')) machine.set(id, 0);
});

window.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
    if (!typing && !e.ctrlKey && e.key.toLowerCase() === 'y') { setYard(!yard); e.preventDefault(); return; }
    if (yard) {
        if (typing || e.ctrlKey) return;
        const k = e.key.toLowerCase(), m = yard.driven;
        if (k === 'r') { runCrew(!yard.crew); e.preventDefault(); return; }
        if (e.key === 'Tab') {
            const ms = yard.site.machines, i = ms.indexOf(m);
            drive(ms[(i + (e.shiftKey ? ms.length - 1 : 1)) % ms.length] || ms[0]);
            e.preventDefault(); return;
        }
        if (e.key === 'Escape') { drive(null); return; }
        if (!m) return;
        if (k === ' ') { if (!e.repeat) hookToggle(m); e.preventDefault(); return; }
        const ct = m.controls.find((x) => x.keys && x.keys.includes(k));
        if (ct && !ct.dark) {
            const dir = ct.keys[0] === k ? 1 : -1;
            if (ct.kind === 'lever' || ct.kind === 'dial') holdKey(m, k, ct, dir); else m.set(ct.id, ct.u + dir * 0.1);
            e.preventDefault();
        }
        return;
    }
    if (!typing && !e.ctrlKey && e.key.toLowerCase() === 'o') { setOperating(!machine); e.preventDefault(); return; }
    if (machine && !typing && !e.ctrlKey) {
        const k = e.key.toLowerCase();
        const ct = machine.controls.find((x) => x.keys && x.keys.includes(k));
        if (ct && !ct.dark) {
            const dir = ct.keys[0] === k ? 1 : -1;
            if (ct.kind === 'lever' || ct.kind === 'dial') holdKey(machine, k, ct, dir);
            else machine.set(ct.id, ct.u + dir * 0.1);
            e.preventDefault();
            return;
        }
    }
    if (e.key === 'Delete' && !typing && selected) { inspectorApi().remove(); e.preventDefault(); return; }
    if (e.key === 'Escape' && !typing && selected) { selected = null; renderAll({ view: false }); return; }
    if (!e.ctrlKey || typing) return;
    if (e.key === 'z') { history.undo(); e.preventDefault(); }
    if (e.key === 'y') { history.redo(); e.preventDefault(); }
    if (e.key === 'n') { newDesign(); e.preventDefault(); }
});

let downAt = null;
$('stage3d').addEventListener('mousedown', (e) => { downAt = [e.offsetX, e.offsetY]; });
$('stage3d').addEventListener('mouseup', (e) => {
    if (!downAt || Math.hypot(e.offsetX - downAt[0], e.offsetY - downAt[1]) > 4 || e.button !== 0) return;
    if (yard) { const m = view.pickMachine(e.offsetX, e.offsetY); if (m) drive(m); return; }
    selectChild(view.pick(e.offsetX, e.offsetY));
});
$('flow').addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('[data-child]');
    if (chip) selectChild(chip.dataset.child);
});
$('stage3d').addEventListener('dblclick', (e) => {
    if (yard) return;
    const id = view.pick(e.offsetX, e.offsetY);
    if (id) drillInto(id);
});

loadSaved();
if (!lib[currentId]) { currentId = Object.keys(lib)[0]; trail = [currentId]; }
renderAll();
status.set('Click a part to change it; double-click a design inside to open it.');

// For tests and agents.
window.foundry = {
    lib, cache, view, vp, history, store: STORE,
    get current() { return currentId; },
    get selected() { return selected; },
    open, drillInto, addPart, useDesign, newDesign, copyDesign, deleteDesign, restoreStarter, setGoal,
    /** Back to the starter designs alone, nothing saved, no history: a clean slate for a test. */
    reset() {
        for (const k of Object.keys(lib)) delete lib[k];
        Object.assign(lib, starterLibrary());
        cache.clear();
        compileLibrary(lib, cache);
        history.clear();
        try { if (fs.existsSync(STORE)) fs.unlinkSync(STORE); } catch (e) { /* nothing saved */ }
        open('drivePod');
    },
    select: selectChild,
    contract,
    /** Run the open design as a machine (or back to designing). */
    operate: setOperating,
    get machine() { return machine; },
    /** Into the yard (id: which one) or out of it. */
    yard(on, id) { setYard(on); if (on && id) openYard(id); },
    get site() { return yard && yard.site; },
    get crew() { return yard && yard.crew; },
    runCrew, drive,
};
