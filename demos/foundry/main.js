// demos/foundry/main.js — the foundry: design mechanisms from parts and from
// designs already compiled, against a goal. A design compiles to a contract
// (box, ports, what each output gives and holds), and the level above builds
// with that contract as if it were a part.

import { boot } from "/lib/kit/app.js";
import { sceneViewport } from "/lib/kit/viewport3d.js";
import { History } from "/lib/kit/history.js";
import { h, clear } from "/lib/kit/dom.js";
import { PARTS, partDefaults, buildPart } from "/lib/foundry/parts.js";
import { compileLibrary, invalidate } from "/lib/foundry/compile.js";
import { starterLibrary } from "/lib/foundry/designs.js";
import { createFoundryView } from "/app/view.js";
import * as P from "/app/panels.js";

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
    $('stats').textContent = `${Object.keys(lib).length} designs · ${c.partCount} parts in ${P.fmtBox(c.size)}`;
}

/** Select a child (null for none): highlighted in the view and the flow, open in the inspector. */
function selectChild(id) {
    selected = id || null;
    view.select(selected);
    markFlow();
    P.renderInspector($('inspector'), $('inspTitle'), lib[currentId], contract(currentId), selected, inspectorApi());
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

function open(id) {
    currentId = id;
    trail = [id];
    selected = null;
    renderAll();
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
    invalidate(id, lib, cache);
    compileLibrary(lib, cache);
    renderAll({ keepCamera: true });
    save();
    const c = contract(id);
    if (!c.ok) status.warn(`${label}: ${c.errors[0]}`);
    else status.set(`${label}.`);
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
    const link = (a, b) => { d.links.push({ a, b }); linked.add(a); linked.add(b); };
    let chained = false;
    for (const ex of d.ports) {
        const q = portOf(ex.at);
        const p = q && q.dir === 'out' && ins.find((x) => x.domain === q.domain && !linked.has(`${childId}.${x.id}`));
        if (!p) continue;
        link(ex.at, `${childId}.${p.id}`);
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
            if (q) { link(`${o.id}.${q.id}`, ref); break; }
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
                link(ref, oref);
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
    const next = Object.keys(lib).find((k) => k !== id);
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

// --- saving: the library lives in local storage, every change written through ---------------------

const STORE = 'foundry.library.v1';

function save() {
    try { localStorage.setItem(STORE, JSON.stringify(lib)); } catch (e) { /* storage full or absent: the session still works */ }
}

function loadSaved() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { saved = null; }
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
window.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
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
    selectChild(view.pick(e.offsetX, e.offsetY));
});
$('flow').addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('[data-child]');
    if (chip) selectChild(chip.dataset.child);
});
$('stage3d').addEventListener('dblclick', (e) => {
    const id = view.pick(e.offsetX, e.offsetY);
    if (id) drillInto(id);
});

loadSaved();
if (!lib[currentId]) { currentId = Object.keys(lib)[0]; trail = [currentId]; }
renderAll();
status.set('Click a part to change it; double-click a design inside to open it.');

// For tests and agents.
window.foundry = {
    lib, cache, view, vp, history,
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
        try { localStorage.removeItem(STORE); } catch (e) { /* none */ }
        open('drivePod');
    },
    select: selectChild,
    contract,
};
