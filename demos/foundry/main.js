// Foundry — the mech designer. A design (lib/mech/design.js) is edited in five
// modes over one 3D view of it: Frame (the skeleton and its hulls), Bays (what
// is packed inside them), Lines (what runs through the joints), Armour, and a
// Test stand that moves it as lib/mech/evaluate.js says it can. Every edit is
// evaluated at once and the panels on the right are that report.

import { boot } from "/lib/kit/app.js";
import { h, clear, $ } from "/lib/kit/dom.js";
import { segmented, foldPanels, fpsMeter, stats } from "/lib/kit/ui.js";
import { History } from "/lib/kit/history.js";
import { Project } from "/lib/kit/project.js";
import { documentCommands } from "/lib/kit/editor.js";
import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { starterBiped } from "/lib/mech/starter.js";
import { evaluate, autoLines, autoActuators, autoFrames, settle } from "/lib/mech/evaluate.js";
import { normalize, addSegment, removeSegment, addModule, removeModule, moduleFault, findPlace, hintForFace,
         SEGMENT_PRESETS, setLength, setBone as aimBone } from "/lib/mech/design.js";
import { segMap, hullBasis, hullToLocal, localToHull, bay, moduleBox, faceName, FACES, skinPoint } from "/lib/mech/skeleton.js";
import { MODULES, MODULE_GROUPS, STRUCTURE, ARMOR, ACTUATOR, LINES, LINE_KINDS, CELL, REGIMES, fmt } from "/lib/mech/catalog.js";
import { add, mul, norm, qrot, clamp, RAD } from "/lib/mech/vec.js";
import { poseAt, GAITS } from "/lib/mech/gait.js";
import { createMechView } from "/app/view.js";
import { createStage } from "/app/stage.js";
import { field, slider, number, select, button, bar, tonnes, renderHeadline, renderSummary, renderRegimes, renderIssues, renderFailures } from "/app/panels.js";

const MODES = { frame: 'Frame', bays: 'Bays', lines: 'Lines', armor: 'Armour', test: 'Test stand' };
const LAYER_DEFAULTS = {
    frame: { armor: false, inner: false, hull: true },
    bays:  { armor: false, inner: true, hull: true },
    lines: { armor: false, inner: false, hull: true },
    armor: { armor: true, inner: false, hull: false },
    test:  { armor: true, inner: false, hull: false },
};
const HINTS = {
    frame: 'Click a segment. Drag the handles to move its joint (W), aim its bone (E) or size its hull (R).',
    bays: 'Pick a module on the left, then click the face of a hull to put it against that face. Click a module to select it; Delete removes it.',
    lines: 'Each tube is what crosses a joint. Red carries less than it is asked for. Click a segment to size its lines.',
    armor: 'Click a face to set its plate. Radiators, nozzles and muzzles are holes in it.',
    test: 'The machine moving as the numbers say it can.',
};

// --- document ----------------------------------------------------------------------

let design = starterBiped();
let report = evaluate(design);
let mode = 'frame';
const sel = { seg: null, mod: null, face: null };
let armed = null, lineKind = null, gait = 'stand', armorView = 'paint', gizmoMode = 'translate';
const dirty = { eval: false, mesh: false, pose: false, inspector: false, tree: false, overlays: false, failures: 0 };

const history = new History({ limit: 300 });
let committed = JSON.stringify(design), pending = null, pendingTimer = 0;

/** A change was made: evaluate and redraw this frame, and record it for undo once it settles. */
function touch(label, o) {
    dirty.eval = true;
    if (o && o.light) dirty.pose = true; else dirty.mesh = true;
    if (o && o.inspector) dirty.inspector = true;
    if (o && o.tree) dirty.tree = true;
    pending = label;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flush, 450);
}
function flush() {
    clearTimeout(pendingTimer);
    if (!pending) return;
    const before = committed, after = JSON.stringify(design), label = pending;
    pending = null;
    if (before === after) return;
    committed = after;
    history.record(label, () => load(after), () => load(before));
}
function load(json) {
    design = normalize(JSON.parse(json));
    committed = JSON.stringify(design);
    pending = null;
    const segs = segMap(design);
    if (sel.seg && !segs[sel.seg]) sel.seg = null;
    if (sel.mod && !design.modules.some((m) => m.id === sel.mod)) sel.mod = null;
    refreshAll();
}
function refreshAll() {
    dirty.eval = dirty.mesh = dirty.inspector = dirty.tree = true;
    $('#name').value = design.name;
}

const project = new Project({
    app: 'foundry', schema: 1, history,
    serialize: () => { flush(); return design; },
    deserialize: (data) => { load(JSON.stringify(data)); },
    onNew: () => { load(JSON.stringify(starterBiped())); },
});
const doc = documentCommands({
    history, project, undoButton: '#undo', redoButton: '#redo',
    canRun: () => { flush(); return !bro.gizmo.dragging; },
});
const app = boot({ menu: doc.menu });

// --- view ---------------------------------------------------------------------------

const vp = sceneViewport('#stage', {
    orbit: { target: [0, 27, 0], dist: 135, fov: 36, near: 0.5, far: 5000, rot: orbitRotation(3.75, -0.10) },
    controls: { minDist: 6, maxDist: 900 },
});
const stage = createStage(vp.scene);
const view = createMechView(vp.scene);
const layer = { armor: $('#showArmor'), inner: $('#showInner'), hull: $('#showHull') };
for (const k in layer) layer[k].addEventListener('change', () => view.setLayers({ [k]: layer[k].checked }));
$('#showBlock').checked = true;
$('#showBlock').addEventListener('change', (e) => stage.setBlock(e.target.checked));

const segs = () => segMap(design);
/** The instance of a segment the handles and readouts speak for: the right one, or the only one. */
const instOf = (segId) => report.insts.find((it) => it.seg.id === segId && it.side >= 0) || report.insts.find((it) => it.seg.id === segId);
const live = [];       // readouts inside the inspector, refreshed after every evaluation

// --- modes ---------------------------------------------------------------------------

const modeBar = segmented('#modes', Object.entries(MODES), { value: mode, small: false, onChange: setMode });
function setMode(m) {
    mode = m;
    modeBar.value = m;
    armed = null;
    if (m !== 'bays') sel.mod = null;
    if (m !== 'armor') sel.face = null;
    const d = LAYER_DEFAULTS[m];
    for (const k in layer) layer[k].checked = d[k];
    view.setLayers(d);
    if (m !== 'test') view.setPose(null);
    view.setGlow(1);
    if (m === 'armor' || armorView === 'thickness') dirty.mesh = true;
    $('#hint').textContent = HINTS[m];
    dirty.inspector = dirty.overlays = true;
    renderModePanel();
    attachGizmo();
}

function select_(segId, modId, face) {
    sel.seg = segId || null; sel.mod = modId || null; sel.face = face || null;
    dirty.inspector = dirty.overlays = dirty.tree = true;
    attachGizmo();
}

// --- overlays ---------------------------------------------------------------------------

let ghost = null;      // { seg, cell, size, ok } under the cursor while a module is armed
function redrawOverlays() {
    view.clearOverlays();
    view.focus(mode === 'test' ? null : sel.seg, mode === 'frame');
    if (mode === 'bays') {
        if (sel.seg) view.showBay(sel.seg);
        const m = sel.mod && design.modules.find((x) => x.id === sel.mod);
        if (m) view.showCells(m.seg, m.cell, m.size, [1.0, 0.82, 0.2, 0.38], 0.1);
        if (ghost) view.showCells(ghost.seg, ghost.cell, ghost.size, ghost.ok ? [0.3, 1.0, 0.45, 0.45] : [1.0, 0.25, 0.2, 0.45], 0.04);
    } else if (mode === 'lines') view.showLines(lineKind);
    const flying = mode === 'test' && (gait === 'hover' || gait === 'burn');
    if ((mode === 'frame' || mode === 'test' || mode === 'lines') && !flying) {
        view.showMarker(report.com, 0.9, [1.0, 0.85, 0.1]);
        const b = report.move.balance;
        if (b && mode !== 'lines') view.showLoop(b.hull.map((p) => [p[0], 0.15, p[1]]), [0.3, 0.9, 1.0], 0.12);
        if (mode !== 'lines') view.showArrow([report.com[0], 0.2, report.com[2]], [0, report.com[1] - 1.2, 0], [1.0, 0.85, 0.1], 0.08);
    }
    if (flying) {
        // What each jet throws out behind it, riding with the segment it is in.
        const scale = report.height * 0.5 / Math.max(1, report.weight);
        report.flight.jets.forEach((j, i) => {
            const thr = gait === 'burn' ? 1 : report.flight.hover.each[i] || 0;
            const f = gait === 'hover' && report.flight.hover.f[i] ? report.flight.hover.f[i] : mul(j.axis, j.thrust * thr);
            const at = [j.pos[0] - report.rest.pos[j.inst][0], j.pos[1] - report.rest.pos[j.inst][1], j.pos[2] - report.rest.pos[j.inst][2]];
            view.showArrow(at, mul(f, -scale), [1.0, 0.5, 0.15], 0.35, j.inst);
        });
    }
}

// --- the gizmo ---------------------------------------------------------------------------

const snap = [0, 0, 0];
function attachGizmo() {
    bro.gizmo.detach();
    const seg = sel.seg && segs()[sel.seg];
    if (!seg || armed) return;          // with a module in hand every click places it: no handles in the way
    if (mode === 'frame' && seg.parent) {
        bro.gizmo.setMode(gizmoMode);
        bro.gizmo.attach({
            position: () => report.rest.pos[instOf(seg.id).id],
            translate: (dx, dy, dz) => {
                seg.attach = [seg.attach[0] + dx, seg.attach[1] + dy, seg.attach[2] + dz];
                if (!seg.mirror && !isMirrored(seg) && Math.abs(seg.attach[0]) < 0.3) seg.attach[0] = 0;
                touch('Move ' + seg.name, { light: true });
            },
            rotate: (x, y, z, w) => { aimBone(design, seg, qrot([x, y, z, w], seg.bone)); touch('Aim ' + seg.name); },
            scale: (sx, sy, sz) => {
                const B = hullBasis(seg), f = [sx, sy, sz];
                for (let a = 0; a < 3; a++) {
                    if (Math.abs(f[a] - 1) < 1e-6) continue;
                    const d = [Math.abs(B.U[a]), Math.abs(B.V[a]), Math.abs(B.W[a])];
                    if (d[0] >= d[1] && d[0] >= d[2]) seg.hu = seg.hu.map((v) => clamp(v * f[a], 0.8, 20));
                    else if (d[1] >= d[2]) setLength(design, seg, clamp(seg.len * f[a], 1.5, 60));
                    else seg.hw = seg.hw.map((v) => clamp(v * f[a], 0.8, 20));
                }
                touch('Size ' + seg.name);
            },
            endDrag: () => { dirty.mesh = dirty.inspector = true; flush(); },
        });
        bro.gizmo.show();
    } else if (mode === 'bays' && sel.mod) {
        const m = design.modules.find((x) => x.id === sel.mod);
        if (!m) return;
        bro.gizmo.setMode('translate');
        snap[0] = snap[1] = snap[2] = 0;
        bro.gizmo.attach({
            position: () => {
                const it = instOf(m.seg), B = hullBasis(seg);
                return add(report.rest.pos[it.id], hullToLocal(B, moduleBox(bay(seg), m).center));
            },
            translate: (dx, dy, dz) => {
                const d = localToHull(hullBasis(seg), [dx, dy, dz]);
                for (let a = 0; a < 3; a++) {
                    snap[a] += d[a];
                    const steps = Math.trunc(snap[a] / CELL);
                    if (!steps) continue;
                    snap[a] -= steps * CELL;
                    const was = m.cell[a];
                    m.cell[a] += steps;
                    if (moduleFault(design, m)) m.cell[a] = was; else touch('Move ' + MODULES[m.type].label, { inspector: true });
                }
            },
            endDrag: () => flush(),
        });
        bro.gizmo.show();
    }
}
const isMirrored = (seg) => { for (let s = seg; s; s = segs()[s.parent]) if (s.mirror) return true; return false; };

// --- the mouse ---------------------------------------------------------------------------

const canvas = vp.canvas;
function rayAt(e) {
    const [px, py] = localPoint(canvas, e);
    return vp.ray(px, py);
}
/** Where an armed module would go for a hit on a hull: { seg, cell, size, face, ok }. */
function placeFor(hit) {
    const fam = MODULES[armed], size = fam.min, seg = hit.seg, grid = bay(seg);
    const pb = view.pickBay(hit);
    const at = pb.cell || [0, 1, 2].map((a) => Math.floor((hit.point[a] - grid.o[a]) / CELL));
    const hint = at.map((c, a) => clamp((c + 0.5) / Math.max(1, grid.n[a]), 0, 1));
    const face = fam.surface ? hit.face : undefined;
    const cell = findPlace(design, seg.id, armed, size, face, face ? hintForFace(face, hint) : hint);
    return cell ? { seg: seg.id, cell, size, face, ok: true } : { seg: seg.id, cell: at, size, face, ok: false };
}
canvas.addEventListener('mousemove', (e) => {
    if (mode !== 'bays' || !armed) { if (ghost) { ghost = null; dirty.overlays = true; } return; }
    const ray = rayAt(e), hit = ray && view.pick(ray.origin, ray.dir);
    const g = hit ? placeFor(hit) : null;
    if (JSON.stringify(g) !== JSON.stringify(ghost)) { ghost = g; dirty.overlays = true; }
});
canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || bro.gizmo.dragging || bro.gizmo.hovered) return;
    const ray = rayAt(e);
    if (!ray) return;
    const hit = view.pick(ray.origin, ray.dir);
    if (!hit) { if (!armed) select_(null); return; }
    if (mode === 'bays') {
        if (armed) {
            const p = placeFor(hit);
            const m = p.ok && addModule(design, p.seg, armed, { cell: p.cell, size: p.size, face: p.face });
            if (!m) { app.status.warn(`No room for a ${MODULES[armed].label.toLowerCase()} there`); return; }
            app.status.ok(`${MODULES[armed].label} placed in ${hit.seg.name}`);
            touch('Add ' + MODULES[armed].label);
            select_(p.seg, m.id);
            return;
        }
        const pb = view.pickBay(hit);
        select_(hit.seg.id, pb.mod ? pb.mod.m.id : null);
        return;
    }
    select_(hit.seg.id, null, mode === 'armor' ? hit.face : null);
});
window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (armed) { armed = null; ghost = null; renderModePanel(); dirty.overlays = true; attachGizmo(); } else select_(null); }
    else if ((k === 'delete' || k === 'backspace') && mode === 'bays' && sel.mod) deleteModule();
    else if (mode === 'frame' && 'wer'.includes(k) && k.length === 1) { gizmoMode = { w: 'translate', e: 'rotate', r: 'scale' }[k]; attachGizmo(); renderModePanel(); }
});
function deleteModule() {
    const m = design.modules.find((x) => x.id === sel.mod);
    if (!m) return;
    removeModule(design, m.id);
    touch('Remove ' + MODULES[m.type].label);
    select_(m.seg);
}

// --- left: the tree and the mode's own panel -------------------------------------------

function renderTree() {
    const el = $('#tree');
    clear(el);
    const depth = {};
    for (const it of report.insts) depth[it.seg.id] = it.depth;
    const order = [];
    const walk = (p) => { for (const s of design.segments) if ((s.parent || null) === p) { order.push(s); walk(s.id); } };
    walk(null);
    for (const s of order) {
        const it = instOf(s.id), twice = it && it.side !== 0;
        const count = design.modules.filter((m) => m.seg === s.id).length;
        el.append(h('div.f-node' + (sel.seg === s.id ? '.on' : ''), { style: { paddingLeft: 6 + (depth[s.id] || 0) * 12 + 'px' }, onclick: () => select_(s.id) },
            h('span', null, s.name + (twice ? ' ×2' : '')),
            h('span.dim', null, (count ? count + ' · ' : '') + (it ? tonnes(report.mass.bySegment[it.id] * (twice ? 2 : 1)) : ''))));
    }
}

function renderModePanel() {
    const el = $('#modePanel');
    clear(el);
    if (mode === 'frame') {
        const preset = select('pod', Object.fromEntries(Object.entries(SEGMENT_PRESETS).map(([k, p]) => [k, p.label])), () => {});
        el.append(h('h2', null, 'Skeleton'),
            h('div.k-row', null, ...[['translate', 'Move joint'], ['rotate', 'Aim bone'], ['scale', 'Size hull']].map(([m, label]) =>
                h('button.small' + (gizmoMode === m ? '.active' : ''), { onclick: () => { gizmoMode = m; attachGizmo(); renderModePanel(); } }, label))),
            h('div.k-row.f-gap', null, preset, button('Hang from selection', () => {
                if (!sel.seg) { app.status.warn('Select the segment to hang it from'); return; }
                const s = addSegment(design, sel.seg, preset.value);
                touch('Add ' + s.name, { tree: true });
                select_(s.id);
            })),
            h('div.k-row.f-gap', null, button('Remove segment', () => {
                const s = segs()[sel.seg];
                if (!s) return;
                if (!removeSegment(design, s.id)) { app.status.warn(s.parent ? 'A biped keeps its legs' : 'The root stays'); return; }
                touch('Remove ' + s.name, { tree: true });
                select_(null);
            }), button('Start over', () => { design = starterBiped(); touch('Start over', { tree: true, inspector: true }); select_(null); $('#name').value = design.name; })));
    } else if (mode === 'bays') {
        el.append(h('h2', null, 'Modules'));
        for (const g of MODULE_GROUPS) {
            el.append(h('div.k-cap', null, g));
            const row = h('div.f-palette');
            for (const [type, fam] of Object.entries(MODULES)) {
                if (fam.group !== g) continue;
                row.append(h('button' + (armed === type ? '.active' : ''), { title: fam.note, onclick: () => { armed = armed === type ? null : type; ghost = null; renderModePanel(); dirty.overlays = true; attachGizmo(); } },
                    h('i', { style: { background: `rgb(${fam.color.map((c) => Math.round(c * 255)).join(',')})` } }), fam.label));
            }
            el.append(row);
        }
        el.append(h('div.f-note', null, armed ? MODULES[armed].note + (MODULES[armed].surface ? ' Click the face it should show through.' : '') : 'Pick one to place it.'));
    } else if (mode === 'lines') {
        el.append(h('h2', null, 'Lines'),
            h('div.f-palette', null, h('button' + (lineKind === null ? '.active' : ''), { onclick: () => { lineKind = null; renderModePanel(); dirty.overlays = true; } }, 'All'),
                ...LINE_KINDS.map((k) => h('button' + (lineKind === k ? '.active' : ''), { onclick: () => { lineKind = k; renderModePanel(); dirty.overlays = true; } },
                    h('i', { style: { background: `rgb(${LINES[k].color.map((c) => Math.round(c * 255)).join(',')})` } }), LINES[k].label))),
            h('div.k-row.f-gap', null, button('Fit every line', () => { autoLines(design, 1.2); touch('Fit lines', { inspector: true }); }, '', 'Each line sized to 1.2 times what crosses its joint')),
            h('div.f-note', null, 'A line is as heavy as it is long and as much as it carries. Generating where the power is used keeps the lines short; a second run survives the first being cut.'));
    } else if (mode === 'armor') {
        const scaleAll = (f) => { for (const s of design.segments) for (const k of FACES) s.armor[k].t = +(s.armor[k].t * f).toFixed(4); touch('Scale armour', { inspector: true }); };
        const colors = h('div.f-colors');
        for (const key of ['primary', 'secondary', 'accent', 'frame']) {
            const input = h('input', { type: 'color', value: design.paint[key] });
            input.addEventListener('input', () => { design.paint[key] = input.value; touch('Paint'); });
            colors.append(h('label', null, input, key));
        }
        el.append(h('h2', null, 'Armour'),
            h('div.k-row', null, ...[['paint', 'Paint'], ['thickness', 'Thickness']].map(([v, label]) =>
                h('button.small' + (armorView === v ? '.active' : ''), { onclick: () => { armorView = v; dirty.mesh = true; renderModePanel(); } }, label))),
            armorView === 'thickness' ? h('div.f-legend', null, h('i'), h('div', null, ...['10', '25', '60', '160', '400 mm'].map((t) => h('span', null, t)))) : null,
            h('div.k-row.f-gap', null, button('All plate −20%', () => scaleAll(0.8)), button('+25%', () => scaleAll(1.25))),
            h('div.k-cap', null, 'paint'), colors,
            h('div.f-note', null, `Armour is ${tonnes(report.mass.armor)} of ${tonnes(report.mass.total)}. Every millimetre is weight the legs carry and the jets lift.`));
    } else if (mode === 'test') {
        el.append(h('h2', null, 'Test stand'),
            h('div.f-palette', null, ...GAITS.map((g) => h('button' + (gait === g ? '.active' : ''), { onclick: () => { gait = g; gaitT = 0; renderModePanel(); dirty.overlays = true; } },
                { stand: 'Stand', walk: 'Walk', sprint: 'Run', hover: 'Hover', burn: 'Full burn' }[g]))),
            h('div.f-note', null, 'The yellow ball is the centre of mass, the blue outline what its feet span. In the air the arrows are what each jet pushes with to hold it level.'));
    }
}

// --- right: the inspector ---------------------------------------------------------------

const mnm = (v) => (v === Infinity ? '∞' : (v / 1e6).toFixed(0) + ' MN m');
function margin(have, need) {
    const m = need > 0 ? have / need : Infinity;
    return bar(m === Infinity ? 0 : 1 / m, m < 1 ? 'err' : m < 1.3 ? 'warn' : 'ok', m === Infinity ? 'no load' : Math.round(100 / m) + '% of what it holds');
}
const liveText = (fn) => { const el = h('span.f-live', null, ''); live.push(() => { el.textContent = fn(); }); return el; };
const liveNode = (fn) => { const el = h('div'); live.push(() => { clear(el); const n = fn(); if (n) el.append(n); }); return el; };

function renderInspector() {
    const el = $('#inspector');
    clear(el);
    live.length = 0;
    const seg = sel.seg && segs()[sel.seg];
    if (mode === 'test') inspectTest(el);
    else if (mode === 'bays' && sel.mod) inspectModule(el, design.modules.find((m) => m.id === sel.mod));
    else if (!seg) el.append(h('div.dim', null, HINTS[mode]));
    else if (mode === 'frame') inspectFrame(el, seg);
    else if (mode === 'bays') inspectBay(el, seg);
    else if (mode === 'lines') inspectLines(el, seg);
    else if (mode === 'armor') inspectArmor(el, seg);
    for (const fn of live) fn();
}

function inspectFrame(el, seg) {
    const T = (label, o) => touch(label + ' ' + seg.name, o);
    const name = h('input', { type: 'text', value: seg.name });
    name.addEventListener('change', () => { seg.name = name.value || seg.id; T('Rename', { tree: true }); });
    el.append(field('name', name), h('div.f-live', null, liveText(() => {
        const it = instOf(seg.id), g = bay(seg);
        return `${seg.role}${it.side ? ', one each side' : ''} · ${tonnes(report.mass.bySegment[it.id])} · bay ${g.n.join(' × ')} cells`;
    })));
    if (seg.parent && !isMirrored(segs()[seg.parent])) {
        const cb = h('input', { type: 'checkbox', checked: seg.mirror });
        cb.addEventListener('change', () => {
            if (['thigh', 'shin', 'foot'].includes(seg.role)) { cb.checked = true; return; }
            seg.mirror = cb.checked;
            if (seg.mirror && Math.abs(seg.attach[0]) < 1) seg.attach[0] = 4;
            T('Mirror', { tree: true });
        });
        el.append(field('both sides', cb));
    }
    el.append(field('paint', select(seg.paint, { primary: 'Primary', secondary: 'Secondary', accent: 'Accent' }, (v) => { seg.paint = v; T('Paint'); })));

    if (seg.parent) {
        el.append(h('div.k-cap', null, 'joint, from ' + segs()[seg.parent].name + "'s"));
        const xyz = h('span.f-xyz');
        ['x', 'y', 'z'].forEach((axis, a) => xyz.append(number(seg.attach[a], { step: 0.1, digits: 2 }, (v) => { seg.attach[a] = v; T('Move'); })));
        el.append(field('at (m)', xyz));
    }
    el.append(h('div.k-cap', null, 'hull'));
    const pitch = Math.atan2(-seg.bone[2], seg.bone[1]) / RAD, splay = Math.asin(clamp(seg.bone[0], -1, 1)) / RAD;
    const aim = { pitch, splay };
    const setBone = () => {
        const p = aim.pitch * RAD, s = aim.splay * RAD;
        aimBone(design, seg, [Math.sin(s), Math.cos(s) * Math.cos(p), -Math.cos(s) * Math.sin(p)]);
        T('Aim');
    };
    el.append(
        field('length', slider(seg.len, { min: 1.5, max: 40, step: 0.1, unit: ' m' }, (v) => { setLength(design, seg, v); T('Size'); })),
        field('behind joint', slider(seg.back, { min: 0, max: 12, step: 0.1, unit: ' m' }, (v) => { seg.back = v; T('Size'); })),
        field('width, root', slider(seg.hu[0] * 2, { min: 1.6, max: 30, step: 0.1, unit: ' m' }, (v) => { seg.hu[0] = v / 2; T('Size'); })),
        field('width, tip', slider(seg.hu[1] * 2, { min: 1.6, max: 30, step: 0.1, unit: ' m' }, (v) => { seg.hu[1] = v / 2; T('Size'); })),
        field('depth, root', slider(seg.hw[0] * 2, { min: 1.6, max: 30, step: 0.1, unit: ' m' }, (v) => { seg.hw[0] = v / 2; T('Size'); })),
        field('depth, tip', slider(seg.hw[1] * 2, { min: 1.6, max: 30, step: 0.1, unit: ' m' }, (v) => { seg.hw[1] = v / 2; T('Size'); })),
        field('bone pitch', slider(pitch, { min: -180, max: 180, step: 1, unit: '°' }, (v) => { aim.pitch = v; setBone(); }), '0 points up, 90 forward, 180 down'),
        field('bone splay', slider(splay, { min: -90, max: 90, step: 1, unit: '°' }, (v) => { aim.splay = v; setBone(); }), 'outward from the centre line'),
        field('roll', slider(seg.roll, { min: -90, max: 90, step: 1, unit: '°' }, (v) => { seg.roll = v; T('Size'); })));

    el.append(h('div.k-cap', null, 'frame'),
        field('material', select(seg.frame.mat, Object.fromEntries(Object.entries(STRUCTURE).map(([k, s]) => [k, s.label])), (v) => { seg.frame.mat = v; T('Frame'); }), STRUCTURE[seg.frame.mat].note),
        field('gauge', slider(seg.frame.gauge, { min: 0.4, max: 8, step: 0.1, digits: 1 }, (v) => { seg.frame.gauge = v; T('Frame'); })));
    if (seg.parent) {
        el.append(liveNode(() => { const j = report.joints[instOf(seg.id).id]; return j && h('div.f-load', null, h('span', null, `holds ${mnm(j.structHave)}, asked ${mnm(j.struct)}`), margin(j.structHave, j.struct)); }),
            h('div.k-row.f-gap', null, button('Gauge to load', () => { autoFrames(design, 1.5, seg.id); T('Frame', { inspector: true }); }, 'small')));
        const j = seg.joint;
        el.append(h('div.k-cap', null, 'joint'),
            field('kind', select(j.type, { fixed: 'Fixed', hinge: 'Hinge', ball: 'Ball' }, (v) => { j.type = v; if (v !== 'fixed' && !(j.rating > 0)) j.rating = 20; T('Joint', { inspector: true }); })));
        if (j.type === 'hinge') {
            const cur = Math.abs(j.axis[0]) > 0.5 ? 'x' : Math.abs(j.axis[1]) > 0.5 ? 'y' : 'z';
            el.append(field('turns about', select(cur, { x: 'Across (pitch)', y: 'Upright (yaw)', z: 'Fore-aft (roll)' }, (v) => { j.axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[v]; T('Joint'); })));
            if (seg.role === 'shin') el.append(field('knee folds', select(String(j.bend || 1), { 1: 'Forward', '-1': 'Backward' }, (v) => { j.bend = +v; T('Joint'); })));
        }
        if (j.type !== 'fixed') {
            el.append(
                field('actuator', select(j.act, Object.fromEntries(Object.entries(ACTUATOR).map(([k, a]) => [k, a.label])), (v) => { j.act = v; T('Actuator', { inspector: true }); }), ACTUATOR[j.act].note),
                field('rating', slider(j.rating, { min: 1, max: Math.max(1500, j.rating * 2), step: 1, unit: ' MN m' }, (v) => { j.rating = v; T('Actuator'); })),
                liveNode(() => { const J = report.joints[instOf(seg.id).id]; return J && h('div.f-load', null, h('span', null, `gives ${mnm(J.torqueHave)}, holding takes ${mnm(J.hold)}`), margin(J.torqueHave, J.hold)); }),
                h('div.f-live', null, liveText(() => `${tonnes(ACTUATOR[j.act].mass * j.rating)} · ${fmt.mw(j.rating * ACTUATOR[j.act].rate * 0.2 / ACTUATOR[j.act].eff)} at work`)),
                h('div.k-row.f-gap', null, button('Rate to load', () => { autoActuators(design, 1.4, seg.id); T('Actuator', { inspector: true }); }, 'small')));
        }
    }
}

function inspectBay(el, seg) {
    const g = bay(seg), mods = design.modules.filter((m) => m.seg === seg.id);
    let used = 0, total = 0;
    for (let i = 0; i < g.n[0]; i++) for (let j = 0; j < g.n[1]; j++) for (let k = 0; k < g.n[2]; k++) if (g.valid(i, j, k)) total++;
    for (const m of mods) used += m.size[0] * m.size[1] * m.size[2];
    el.append(h('div', null, h('b', null, seg.name)), h('div.f-load', null, h('span', null, `${used} of ${total} cells (${CELL} m each)`), bar(total ? used / total : 0, '', '')));
    for (const m of mods) {
        const fam = MODULES[m.type], d = report.modDefs[m.id];
        el.append(h('div.f-node', { onclick: () => select_(seg.id, m.id) }, h('span', null, fam.label), h('span.dim', null, (d && d.spec.stats[0] ? d.spec.stats[0][1] + ' · ' : '') + m.size.join('×'))));
    }
    if (!mods.length) el.append(h('div.dim', null, 'Empty. Pick a module on the left and click this hull.'));
}

function inspectModule(el, m) {
    if (!m) return;
    const fam = MODULES[m.type], seg = segs()[m.seg];
    const T = (o) => touch('Edit ' + fam.label, o);
    /** Apply a change to the module, and take it back if it then does not fit. */
    const attempt = (fn) => {
        const was = JSON.stringify(m);
        fn();
        const fault = moduleFault(design, m);
        if (fault) { Object.assign(m, JSON.parse(was)); app.status.warn(`${fam.label}: ${fault}`); dirty.inspector = true; return false; }
        T(); dirty.overlays = true;
        return true;
    };
    el.append(h('div', null, h('b', null, fam.label), h('span.dim', null, ' in ' + seg.name)), h('div.f-note', null, fam.note));
    const size = h('span.f-xyz'), cell = h('span.f-xyz');
    for (let a = 0; a < 3; a++) {
        size.append(number(m.size[a], { min: 1, max: 40, step: 1, digits: 0 }, (v) => { if (!attempt(() => { m.size[a] = Math.round(v); })) return; attachGizmo(); }));
        cell.append(number(m.cell[a], { min: 0, max: 60, step: 1, digits: 0 }, (v) => { if (!attempt(() => { m.cell[a] = Math.round(v); })) return; attachGizmo(); }));
    }
    el.append(field('size (cells)', size, 'across, along the bone, deep'), field('at (cell)', cell));
    if (fam.surface) {
        el.append(field('shows through', select(m.face || '+v', Object.fromEntries(FACES.map((f) => [f, faceName(seg, f, 1)])), (v) => {
            const was = m.face, cellWas = m.cell.slice();
            m.face = v;
            if (moduleFault(design, m)) {
                const c = findPlace(design, m.seg, m.type, m.size, v, hintForFace(v, m.cell.map((x, a) => x / Math.max(1, bay(seg).n[a]))), m.id);
                if (c) m.cell = c; else { m.face = was; m.cell = cellWas; app.status.warn('No room against that face'); dirty.inspector = true; return; }
            }
            T({ inspector: true }); attachGizmo();
        })));
    }
    for (const key in fam.opts || {}) {
        const o = fam.opts[key];
        el.append(field(o.label, slider(m.opts[key] ?? o.def, o, (v) => { m.opts[key] = v; T(); })));
    }
    el.append(h('div.k-cap', null, 'what it does'), liveNode(() => {
        const d = report.modDefs[m.id];
        if (!d) return null;
        const kv = h('div.k-kv');
        if (d.fault) kv.append(h('div.err', null, h('span', null, 'cannot work'), h('b', null, d.fault)));
        kv.append(h('div', null, h('span', null, 'mass'), h('b', null, tonnes(d.spec.mass))));
        for (const [k, v] of d.spec.stats) kv.append(h('div', null, h('span', null, k), h('b', null, v)));
        const dm = d.spec.demand || {};
        const need = LINE_KINDS.filter((k) => dm[k] && (dm[k][0] + dm[k][1]) > 0).map((k) => {
            const v = dm[k][0] + dm[k][1];
            return (k === 'data' ? v + ' ch' : v.toFixed(v < 10 ? 1 : 0) + ' ' + LINES[k].unit) + ' ' + (k === 'coolant' ? 'of heat' : LINES[k].label.toLowerCase());
        });
        if (need.length) kv.append(h('div', null, h('span', null, 'at full work'), h('b', null, need.join(', '))));
        return kv;
    }));
    el.append(h('div.k-row.f-gap', null,
        button('Duplicate', () => {
            const c = addModule(design, m.seg, m.type, { size: m.size.slice(), face: m.face, opts: m.opts, hint: m.cell.map((x, a) => (x + m.size[a] / 2) / Math.max(1, bay(seg).n[a])) });
            if (!c) { app.status.warn('No room for another'); return; }
            touch('Duplicate ' + fam.label); select_(m.seg, c.id);
        }, 'small'),
        button('Remove', deleteModule, 'small')));
}

function inspectLines(el, seg) {
    el.append(h('div', null, h('b', null, seg.name)));
    if (!seg.parent) { el.append(h('div.dim', null, 'The root has no joint to cross. Select what hangs from it.')); return; }
    el.append(h('div.f-note', null, `What crosses the joint to ${segs()[seg.parent].name}.`));
    for (const k of LINE_KINDS) {
        const ln = seg.lines[k], unit = LINES[k].unit;
        const T = () => touch('Line ' + seg.name);
        const capIn = number(ln.cap, { min: 0, max: 1e6, step: k === 'data' ? 1 : 5, digits: 0 }, (v) => { ln.cap = v; T(); });
        el.append(h('div.f-line', null,
            h('i', { style: { background: `rgb(${LINES[k].color.map((c) => Math.round(c * 255)).join(',')})` } }),
            h('span.nm', null, LINES[k].label), capIn, h('span.dim', null, unit),
            select(String(ln.n), { 1: '×1', 2: '×2', 3: '×3' }, (v) => { ln.n = +v; T(); }),
            liveNode(() => {
                const t = report.trunks[instOf(seg.id).id][k];
                if (!(t.req > 0)) return h('span.dim', null, 'nothing crosses');
                const amt = k === 'data' ? Math.ceil(t.req - 1e-6) : t.req.toFixed(t.req < 10 ? 1 : 0);
                return bar(ln.cap > 0 ? t.req / ln.cap : 1, t.req > ln.cap * 1.005 ? 'err' : 'ok', `${amt} ${unit} ${t.sign < 0 ? 'in' : 'out'} · ${REGIMES[t.regime].label.toLowerCase()}`);
            })));
    }
    el.append(h('div.k-row.f-gap', null, button('Fit these', () => {
        const r = report.trunks[instOf(seg.id).id];
        for (const k of LINE_KINDS) seg.lines[k].cap = k === 'data' ? Math.ceil(r[k].req - 1e-6) : Math.ceil(r[k].req * 1.2);
        touch('Fit lines ' + seg.name, { inspector: true });
    }, 'small')), h('div.f-live', null, liveText(() => `these lines weigh ${tonnes(LINE_KINDS.reduce((s, k) => s + seg.lines[k].cap * seg.lines[k].n * LINES[k].mass * (report.segs[seg.id].run || 0), 0))}`)));
}

function inspectArmor(el, seg) {
    el.append(h('div', null, h('b', null, seg.name)), h('div.f-live', null, liveText(() => {
        const S = report.segs[seg.id];
        return `${tonnes(FACES.reduce((s, f) => s + S.faces[f].mass, 0))} of plate`;
    })));
    const mats = Object.fromEntries(Object.entries(ARMOR).map(([k, a]) => [k, a.label]));
    const sliders = {};
    for (const f of FACES) {
        const pl = seg.armor[f];
        sliders[f] = slider(pl.t * 1000, { min: 0, max: 400, step: 5, unit: ' mm' }, (v) => { pl.t = v / 1000; touch('Plate ' + seg.name); });
        el.append(h('div.f-face' + (sel.face === f ? '.on' : ''), { onclick: () => { if (sel.face !== f) { sel.face = f; dirty.inspector = true; } } },
            h('span.nm', null, faceName(seg, f, 1)), sliders[f], select(pl.mat, mats, (v) => { pl.mat = v; touch('Plate ' + seg.name); })));
    }
    const all = slider(seg.armor[sel.face || '+u'].t * 1000, { min: 0, max: 400, step: 5, unit: ' mm' }, (v) => {
        for (const f of FACES) { seg.armor[f].t = v / 1000; sliders[f].set(v); }
        touch('Plate ' + seg.name);
    });
    el.append(h('div.k-cap', null, 'every face'), field('thickness', all),
        field('paint', select(seg.paint, { primary: 'Primary', secondary: 'Secondary', accent: 'Accent' }, (v) => { seg.paint = v; touch('Paint'); })),
        h('div.k-cap', null, 'what it covers'), liveNode(() => {
            const rows = report.protection.filter((p) => p.seg === seg.id);
            if (!rows.length) return h('div.dim', null, 'Nothing here that burns, bursts or flies the machine.');
            const kv = h('div.k-kv');
            for (const p of rows) kv.append(h('div', null, h('span', null, p.label), h('b', null, `${p.mm.toFixed(0)} mm from the ${p.faceName}`)));
            return kv;
        }));
}

function inspectTest(el) {
    el.append(liveNode(() => {
        const mv = report.move, fl = report.flight, kv = h('div.k-kv');
        const row = (k, v) => kv.append(h('div', null, h('span', null, k), h('b', null, v)));
        if (gait === 'stand' || gait === 'walk' || gait === 'sprint') {
            if (!mv.stands) { row('on the ground', 'cannot stand'); return kv; }
            row('speed', ((gait === 'stand' ? 0 : gait === 'walk' ? mv.walk : mv.sprint) * 3.6).toFixed(0) + ' km/h');
            if (gait === 'sprint') for (const l of mv.limits) row(l[0], (l[1] * 3.6).toFixed(0) + ' km/h');
            row('leg', mv.legLength.toFixed(1) + ' m, hips ' + mv.hipHeight.toFixed(1) + ' m up');
        } else {
            row('lift', fmt.mn(fl.lift) + ' against ' + fmt.mn(report.weight));
            row('hover', fl.hover.ok ? Math.round(fl.hover.throttle * 100) + '% throttle' : fl.hover.lifts ? 'tumbles' : 'cannot');
            row('torque left over', mnm(fl.hover.torque) + ' (gyros hold ' + mnm(fl.hover.gyro) + ')');
            fl.jets.forEach((j, i) => row(MODULES[report.modDefs[j.id].m.type].label + ' ' + j.inst, fmt.mn(j.thrust) + ' at ' + Math.round((gait === 'burn' ? 1 : fl.hover.each[i] || 0) * 100) + '%'));
        }
        const g = report.regimes[gait === 'sprint' ? 'sprint' : gait];
        if (g) for (const k of ['power', 'coolant']) row(k === 'power' ? 'power' : 'heat', `${g[k].demand.toFixed(0)} of ${g[k].supply.toFixed(0)} MW`);
        return kv;
    }));
}

// --- chrome ---------------------------------------------------------------------------------

$('#name').value = design.name;
$('#name').addEventListener('change', (e) => { design.name = e.target.value || 'Untitled'; touch('Rename'); });
$('#settle').addEventListener('click', () => { settle(design); touch('Size everything to load', { inspector: true }); app.status.ok('Actuators, frames and lines sized to load'); });
foldPanels(document.body);
const readouts = stats('#stats', { fps: 'fps', eval: 'evaluate ms', build: 'build ms', tris: 'segments' });
const fps = fpsMeter();
const pickSeg = (where) => {
    const m = design.modules.find((x) => x.id === where);
    if (m) { if (mode !== 'bays') setMode('bays'); select_(m.seg, m.id); } else if (segs()[where]) select_(where);
};

let gaitT = 0, failTimer = 0;
vp.onFrame((dt) => {
    if (dirty.eval) {
        const t0 = performance.now();
        report = evaluate(design, { failures: false });
        readouts.set('eval', (performance.now() - t0).toFixed(1));
        dirty.eval = false;
        dirty.overlays = true;
        renderHeadline($('#headline'), report);
        renderSummary($('#summary'), report);
        renderRegimes($('#regimes'), report);
        renderIssues($('#issues'), $('#issueCount'), report, pickSeg);
        // An inspector about to be rebuilt may speak of what is no longer there.
        if (!dirty.inspector) { for (const fn of live) fn(); dirty.tree = true; }
        clearTimeout(failTimer);
        failTimer = setTimeout(() => { report.failures = evaluate(design).failures; renderFailures($('#failures'), report, pickSeg); }, 350);
        if (dirty.pose && !dirty.mesh) { view.update(design, report); dirty.pose = false; }
    }
    if (dirty.mesh) {
        const t0 = performance.now();
        view.sync(design, report, { armor: mode === 'armor' ? armorView : 'paint' });
        view.setLayers({ armor: layer.armor.checked, inner: layer.inner.checked, hull: layer.hull.checked });
        readouts.set('build', (performance.now() - t0).toFixed(1));
        readouts.set('tris', report.insts.length);
        dirty.mesh = dirty.pose = false;
        dirty.overlays = true;
    }
    if (dirty.inspector) { renderInspector(); dirty.inspector = false; dirty.tree = true; }
    if (dirty.tree) { renderTree(); dirty.tree = false; }
    if (dirty.overlays) { redrawOverlays(); dirty.overlays = false; }
    if (mode === 'test') {
        gaitT += dt;
        const g = poseAt(design, report, gait, gaitT);
        view.setPose(g.pose);
        stage.advance(g.speed * dt);
        const glow = { '*': 1 };
        for (const j of report.flight.jets) glow[j.inst] = Math.max(glow[j.inst] || 0, 0.6 + 7 * (g.jets[j.key] || 0));
        view.setGlow(glow);
    }
    readouts.set('fps', fps.tick().toFixed(0));
});

refreshAll();
setMode('frame');
app.status.ok('ready');

globalThis.__foundry = {
    vp, view, stage, history, project,
    get design() { return design; }, get report() { return report; }, get mode() { return mode; }, get sel() { return sel; },
    setMode, select: select_, touch, flush,
    arm(type) { armed = type; renderModePanel(); attachGizmo(); },
    setGait(g) { gait = g; gaitT = 0; renderModePanel(); dirty.overlays = true; },
    setArmorView(v) { armorView = v; dirty.mesh = true; },
};
