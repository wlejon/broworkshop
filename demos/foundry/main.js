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

const { status } = boot({ status: '#status' });
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

function renderAll(opts) {
    const c = contract(currentId);
    const d = lib[currentId];
    renderCrumbs();
    P.renderLibrary($('library'), lib, cache, currentId, open, useDesign);
    P.renderTitle($('title'), c);
    P.renderGoal($('goal'), c, $('goalPill'));
    P.renderContract($('contract'), c);
    P.renderProblems($('problems'), c);
    $('problemsCard').hidden = false;
    if (!opts || opts.view !== false) view.show(c, { frame: !(opts && opts.keepCamera) });
    if (selected && !c.children.some((x) => x.id === selected)) selected = null;
    view.select(selected);
    P.renderInspector($('inspector'), $('inspTitle'), d, c, selected, inspectorApi());
    renderBench();
    $('stats').textContent = `${Object.keys(lib).length} designs · ${c.partCount} parts in ${P.fmtBox(c.size)}`;
}

function renderBench() {
    const c = contract(currentId);
    const outId = outPort(c);
    const op = operatingPoint(c);
    const out = c.ports.find((p) => p.id === outId);
    P.renderFlow($('flow'), c, outId, op ? (op.payloadKg ?? op.effort) : 0);
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
        if (currentId === id) renderAll({ keepCamera: true });
    };
    history.record(label, apply(after), apply(before));
    invalidate(id, lib, cache);
    compileLibrary(lib, cache);
    renderAll({ keepCamera: true });
    const c = contract(id);
    if (!c.ok) status.warn(`${label}: ${c.errors[0]}`);
    else status.set(`${label}.`);
}

function freshId(d, base) {
    let k = 1;
    while (d.children.some((c) => c.id === `${base}${k}`)) k++;
    return `${base}${k}`;
}

/** Link `ref` to the first open port of the right kind among the others, so a new child lands somewhere. */
function autoLink(d, c, childId, el) {
    const taken = new Set(c.links.flatMap((l) => [l.out, l.in]));
    const ins = el.ports.filter((p) => p.dir === 'in');
    // First choice: what the design was giving out goes into the new child, which gives it out now.
    for (const ex of d.ports) {
        const [cid, pid] = [ex.at.slice(0, ex.at.lastIndexOf('.')), ex.at.slice(ex.at.lastIndexOf('.') + 1)];
        const ch = c.children.find((x) => x.id === cid);
        const q = ch && ch.el.ports.find((x) => x.id === pid);
        const p = q && q.dir === 'out' && ins.find((x) => x.domain === q.domain);
        if (p) { d.links.push({ a: ex.at, b: `${childId}.${p.id}` }); return ex; }
    }
    // Else any free output of the right kind.
    for (const ex of d.ports) taken.add(ex.at);
    for (const p of ins) {
        for (const o of c.children) {
            const q = o.el.ports.find((x) => x.domain === p.domain && x.dir === 'out' && !taken.has(`${o.id}.${x.id}`));
            if (q) { d.links.push({ a: `${o.id}.${q.id}`, b: `${childId}.${p.id}` }); return null; }
        }
    }
    return null;
}

function addChild(spec) {
    edit(`Add ${spec.part ? PARTS[spec.part].label : lib[spec.design].name}`, (d) => {
        const c = contract(currentId);
        // A part or design whose input takes what the design's output was giving: put it on the end.
        const el = spec.part ? null : contract(spec.design);
        d.children.push(spec);
        const ports = el ? el.ports : buildPart(spec.part, spec.params).ports;
        const exposed = autoLink(d, c, spec.id, { ports });
        if (exposed) {
            const newOut = ports.find((p) => p.dir === 'out' && p.domain !== 'elec');
            if (newOut) exposed.at = `${spec.id}.${newOut.id}`;
        }
    });
    selected = spec.id;
    renderAll({ keepCamera: true });
}

function addPart(type) {
    const d = lib[currentId];
    addChild({ id: freshId(d, type.replace(/[A-Z].*/, '').slice(0, 4)), part: type, params: partDefaults(type) });
}

function useDesign(id) {
    const d = lib[currentId];
    if (id === currentId) return;
    const c = contract(id);
    if (c.level >= d.level) {
        status.warn(`${lib[id].name} is level ${c.level}; ${d.name} (level ${d.level}) can only use designs below it.`);
        return;
    }
    addChild({ id: freshId(d, id.slice(0, 3)), design: id });
}

function inspectorApi() {
    const ref = (port) => `${selected}.${port}`;
    const findLink = (d, r) => d.links.find((l) => l.a === r || l.b === r);
    return {
        setParam(key, value) {
            edit(`Set ${key}`, (d) => {
                const ch = d.children.find((x) => x.id === selected);
                ch.params = { ...(ch.params || partDefaults(ch.part)), [key]: value };
            });
        },
        open() { drillInto(selected); },
        remove() {
            const id = selected;
            edit(`Remove ${id}`, (d) => {
                d.children = d.children.filter((x) => x.id !== id);
                d.links = d.links.filter((l) => !l.a.startsWith(id + '.') && !l.b.startsWith(id + '.'));
                d.ports = d.ports.filter((p) => !p.at.startsWith(id + '.'));
            });
            selected = null;
            renderAll({ keepCamera: true });
        },
        link(port, other) { edit(`Link ${ref(port)}`, (d) => d.links.push({ a: ref(port), b: other })); },
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

function newDesign() {
    const level = lib[currentId].level;
    let k = 1;
    while (lib[`design${k}`]) k++;
    const id = `design${k}`;
    lib[id] = { id, name: `Design ${k}`, level, paint: [0.55, 0.57, 0.6], note: 'Add parts from the palette, or designs from a lower level with “use”.', children: [], links: [], ports: [] };
    compileLibrary(lib, cache);
    open(id);
}

// --- wiring ---------------------------------------------------------------------------------

P.renderPalette($('palette'), addPart);
$('newDesign').addEventListener('click', newDesign);
$('undo').addEventListener('click', () => history.undo());
$('redo').addEventListener('click', () => history.redo());
$('load').addEventListener('input', renderBench);
window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;
    if (e.key === 'z') { history.undo(); e.preventDefault(); }
    if (e.key === 'y') { history.redo(); e.preventDefault(); }
});

let downAt = null;
$('stage3d').addEventListener('mousedown', (e) => { downAt = [e.offsetX, e.offsetY]; });
$('stage3d').addEventListener('mouseup', (e) => {
    if (!downAt || Math.hypot(e.offsetX - downAt[0], e.offsetY - downAt[1]) > 4 || e.button !== 0) return;
    selected = view.pick(e.offsetX, e.offsetY);
    view.select(selected);
    P.renderInspector($('inspector'), $('inspTitle'), lib[currentId], contract(currentId), selected, inspectorApi());
});
$('stage3d').addEventListener('dblclick', (e) => {
    const id = view.pick(e.offsetX, e.offsetY);
    if (id) drillInto(id);
});

renderAll();
status.set('Click a part to change it; double-click a design inside to open it.');

// For tests and agents.
window.foundry = {
    lib, cache, view, vp, history,
    get current() { return currentId; },
    get selected() { return selected; },
    open, drillInto, addPart, useDesign,
    select(id) { selected = id; view.select(id); P.renderInspector($('inspector'), $('inspTitle'), lib[currentId], contract(currentId), id, inspectorApi()); },
    contract,
};
