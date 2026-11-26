// lib/mech/design.js — the design document: plain JSON, and the edits made to it.
//
//   design = { schema, name, paint, nextId, segments: [...], modules: [...] }
//
// A segment (skeleton.js has its geometry):
//   id, name, role        role is what the machine uses it as: 'pelvis' (the
//                         root), 'torso', 'head', 'thigh', 'shin', 'foot',
//                         'arm', 'forearm', 'pod'
//   parent, mirror        mirror: exists on both sides (and all that hangs from it)
//   attach                its joint, from the parent's joint, metres
//   bone, roll, len, back, hu, hw, off      the hull
//   joint   { type: 'fixed' | 'hinge' | 'ball', axis, range: [lo, hi] degrees,
//             act: an ACTUATOR, rating: MN m, bend: +1 | -1 (a knee: which way it folds) }
//   frame   { mat: a STRUCTURE, gauge }
//   armor   { '+u': { t: metres, mat: an ARMOR }, ... one per face }
//   lines   { power: { cap, n }, ... }   what crosses its joint to the parent, n runs of it
//   paint   'primary' | 'secondary' | 'accent'
//
// A module: { id, seg, type: a MODULES key, cell: [i, j, k], size: [a, b, c]
// in cells, face: the hull face it shows through (parts that need one), opts }.
// It is defined on the segment, so a mirrored segment carries it on both sides.

import { MODULES, LINE_KINDS } from "./catalog.js";
import { FACES, segMap, bay, placementFault, faceAxis, faceSign } from "./skeleton.js";

export const SCHEMA = 1;

const face6 = (t, mat) => Object.fromEntries(FACES.map((f) => [f, { t, mat: mat || 'steel' }]));
const noLines = () => Object.fromEntries(LINE_KINDS.map((k) => [k, { cap: 0, n: 1 }]));

/** A segment with everything filled in. */
export function makeSegment(o) {
    return {
        id: o.id, name: o.name || o.id, role: o.role || 'pod', parent: o.parent || null, mirror: !!o.mirror,
        attach: o.attach || [0, 0, 0], bone: o.bone || [0, 1, 0], roll: o.roll || 0,
        len: o.len ?? 6, back: o.back ?? 0, hu: o.hu || [2, 2], hw: o.hw || [2, 2], off: o.off || [0, 0],
        joint: Object.assign({ type: 'fixed', axis: [1, 0, 0], range: [-45, 45], act: 'hydraulic', rating: 0, bend: 1 }, o.joint),
        frame: Object.assign({ mat: 'steel', gauge: 1 }, o.frame),
        armor: Object.assign(face6(o.plate ?? 0.03, o.plateMat), o.armor),
        lines: Object.assign(noLines(), o.lines),
        paint: o.paint || 'primary',
    };
}

export function emptyDesign(name) {
    return {
        schema: SCHEMA, name: name || 'Untitled', nextId: 1,
        paint: { primary: '#b9bec6', secondary: '#3b4250', accent: '#d9541e', frame: '#2a2d33' },
        segments: [], modules: [],
    };
}

/** Segments that hang from `id`, at any depth. */
export function descendants(design, id) {
    const out = [];
    const walk = (p) => { for (const s of design.segments) if (s.parent === p) { out.push(s.id); walk(s.id); } };
    walk(id);
    return out;
}

function freshId(design, base) {
    const ids = new Set(design.segments.map((s) => s.id));
    if (!ids.has(base)) return base;
    for (let n = 2; ; n++) if (!ids.has(base + n)) return base + n;
}

// What "add a segment" offers, hung from the selected one.
export const SEGMENT_PRESETS = {
    pod:     { label: 'Pod', role: 'pod', bone: [0, 1, 0], len: 6, back: 0, hu: [2.4, 2.4], hw: [2.4, 2.4], joint: { type: 'fixed' } },
    turret:  { label: 'Turret', role: 'pod', bone: [0, 1, 0], len: 4, back: 0, hu: [3, 2.6], hw: [3, 2.6],
               joint: { type: 'hinge', axis: [0, 1, 0], range: [-170, 170], act: 'electric', rating: 30 } },
    limb:    { label: 'Limb', role: 'arm', bone: [0, -1, 0], len: 9, back: 0, hu: [2.2, 2.0], hw: [2.2, 2.0],
               joint: { type: 'ball', range: [-120, 60], act: 'hydraulic', rating: 60 } },
    link:    { label: 'Limb link', role: 'forearm', bone: [0, -1, 0], len: 9, back: 0, hu: [2.0, 1.7], hw: [2.0, 1.7],
               joint: { type: 'hinge', axis: [1, 0, 0], range: [-140, 0], act: 'hydraulic', rating: 40 } },
    wing:    { label: 'Pylon', role: 'pod', bone: [1, 0.15, 0], len: 10, back: 0, hu: [3.2, 2.0], hw: [1.2, 0.9], joint: { type: 'fixed' } },
    head:    { label: 'Head', role: 'head', bone: [0, 1, 0], len: 4, back: 0, hu: [2.2, 2.0], hw: [2.6, 2.4],
               joint: { type: 'ball', range: [-60, 60], act: 'electric', rating: 6 } },
};

/**
 * Hangs a new segment from `parentId`, placed just outside the parent's hull
 * on the side the preset's bone points. Returns it.
 */
export function addSegment(design, parentId, presetKey, at) {
    const p = SEGMENT_PRESETS[presetKey] || SEGMENT_PRESETS.pod;
    const parent = segMap(design)[parentId];
    const seg = makeSegment(Object.assign({}, p, {
        id: freshId(design, presetKey), name: p.label, parent: parentId,
        attach: at || [0, parent ? parent.len * 0.6 : 0, parent ? Math.max(parent.hw[0], parent.hw[1]) + 0.5 : 0],
        hu: p.hu.slice(), hw: p.hw.slice(), bone: p.bone.slice(),
        joint: Object.assign({}, p.joint, p.joint.axis ? { axis: p.joint.axis.slice() } : null, p.joint.range ? { range: p.joint.range.slice() } : null),
    }));
    design.segments.push(seg);
    return seg;
}

/** Removes a segment, all that hangs from it, and their modules. The root and the legs stay. */
export function removeSegment(design, id) {
    const seg = segMap(design)[id];
    if (!seg || !seg.parent || ['thigh', 'shin', 'foot'].includes(seg.role)) return false;
    const gone = new Set([id, ...descendants(design, id)]);
    design.segments = design.segments.filter((s) => !gone.has(s.id));
    design.modules = design.modules.filter((m) => !gone.has(m.seg));
    return true;
}

/** The cells of a segment's bay that modules hold, as "i,j,k"; `except` is a module id left out. */
export function takenCells(design, segId, except) {
    const t = new Set();
    for (const m of design.modules) {
        if (m.seg !== segId || m.id === except) continue;
        for (let i = 0; i < m.size[0]; i++) for (let j = 0; j < m.size[1]; j++) for (let k = 0; k < m.size[2]; k++) {
            t.add((m.cell[0] + i) + ',' + (m.cell[1] + j) + ',' + (m.cell[2] + k));
        }
    }
    return t;
}

/** Why module `m` cannot be where it is, or null. */
export function moduleFault(design, m, grid) {
    const seg = segMap(design)[m.seg];
    if (!seg) return 'no such segment';
    const fam = MODULES[m.type];
    if (!fam) return 'unknown module';
    for (let a = 0; a < 3; a++) if (m.size[a] < 1) return 'no size';
    return placementFault(grid || bay(seg), m, takenCells(design, m.seg, m.id), !!fam.surface);
}

/**
 * The nearest place in a segment's bay a module of `size` fits, to `hint`
 * ([0..1] along each bay axis). A part that shows through the hull is tried
 * against `face`. Returns the cell or null.
 */
export function findPlace(design, segId, type, size, face, hint, except) {
    const seg = segMap(design)[segId], fam = MODULES[type];
    if (!seg || !fam) return null;
    const grid = bay(seg), taken = takenCells(design, segId, except);
    const h = hint || [0.5, 0.5, 0.5];
    let best = null, bestD = Infinity;
    for (let i = 0; i + size[0] <= grid.n[0]; i++) for (let j = 0; j + size[1] <= grid.n[1]; j++) for (let k = 0; k + size[2] <= grid.n[2]; k++) {
        const d = Math.hypot((i + size[0] / 2) / grid.n[0] - h[0], (j + size[1] / 2) / grid.n[1] - h[1], (k + size[2] / 2) / grid.n[2] - h[2]);
        if (d >= bestD) continue;
        const m = { cell: [i, j, k], size, face };
        if (placementFault(grid, m, taken, !!fam.surface)) continue;
        best = [i, j, k]; bestD = d;
    }
    return best;
}

/** Where on a face a hint should sit so a module is found against it. */
export function hintForFace(face, hint) {
    const h = (hint || [0.5, 0.5, 0.5]).slice();
    h[faceAxis(face)] = faceSign(face) > 0 ? 1 : 0;
    return h;
}

/**
 * Adds a module at the nearest place it fits. `o`: { size, face, hint, cell, opts }.
 * Returns the module, or null when the bay has no room for it.
 */
export function addModule(design, segId, type, o) {
    o = o || {};
    const fam = MODULES[type];
    if (!fam) return null;
    const size = (o.size || fam.min).slice();
    let face = fam.surface ? (o.face || '+w') : undefined;
    let cell = o.cell;
    if (!cell) {
        const tryFaces = fam.surface ? [face, ...FACES.filter((f) => f !== face)] : [undefined];
        for (const f of (o.face ? [o.face] : tryFaces)) {
            cell = findPlace(design, segId, type, size, f, f ? hintForFace(f, o.hint) : o.hint);
            if (cell) { face = f; break; }
        }
    }
    if (!cell) return null;
    const opts = {};
    for (const k in fam.opts || {}) opts[k] = (o.opts && o.opts[k] != null) ? o.opts[k] : fam.opts[k].def;
    const m = { id: 'm' + (design.nextId++), seg: segId, type, cell: cell.slice(), size, opts };
    if (face) m.face = face;
    design.modules.push(m);
    return m;
}

export function removeModule(design, id) {
    const n = design.modules.length;
    design.modules = design.modules.filter((m) => m.id !== id);
    return design.modules.length !== n;
}

/** A design read from disk, with anything a newer catalog added filled in. */
export function normalize(design) {
    const d = Object.assign(emptyDesign(), design);
    d.segments = (design.segments || []).map((s) => makeSegment(s));
    d.modules = (design.modules || []).filter((m) => MODULES[m.type]).map((m) => Object.assign({ opts: {} }, m));
    return d;
}

export const clone = (design) => JSON.parse(JSON.stringify(design));
