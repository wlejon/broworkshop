// lib/foundry/blueprint.js — Hierarchical Blueprint Document & Library.
//
// A Blueprint is a pure JSON graph of primitive components AND/OR nested
// compiled assemblies (`type: 'assembly', ref: '<blueprintId>'`).
// Exposing ports turns any Blueprint into a reusable component with its own
// certified spec sheet and bounding box.

import { PRIMITIVES, PORT_COMPAT, defaultParams } from "./primitives.js";

export const SCHEMA_VERSION = 1;

/**
 * Create an empty blueprint document.
 * scale: 'subassembly' (5-40 cm) | 'machine' (0.6-2.5 m bot) | 'titan' (4-50 m mech module)
 */
export function createBlueprint(o = {}) {
    return {
        schema: SCHEMA_VERSION,
        id: o.id || 'bp_' + Math.random().toString(36).slice(2, 8),
        name: o.name || 'Untitled Assembly',
        scale: o.scale || 'subassembly',
        kind: o.kind || 'subassembly',
        description: o.description || '',
        nodes: (o.nodes || []).map((n) => ({ ...n, params: { ...(n.params || {}) } })),
        links: (o.links || []).map((l) => ({ ...l })),
        // Exposed external ports: [{ id, label, domain, dir: 'in'|'out', nodeId, portId }]
        exposedPorts: (o.exposedPorts || []).map((p) => ({ ...p })),
        nextId: o.nextId || 1,
    };
}

export function cloneBlueprint(bp) {
    return JSON.parse(JSON.stringify(bp));
}

/** Resolve the input/output port lists for any node (primitive or nested assembly). */
export function nodePorts(node, library) {
    if (node.type === 'assembly') {
        const sub = library && library[node.ref];
        if (!sub) return { ins: [], outs: [], label: node.ref || 'Missing Assembly', color: '#818cf8' };
        const ins = (sub.exposedPorts || []).filter((p) => p.dir === 'in')
            .map((p) => ({ id: p.id, label: p.label, domain: p.domain }));
        const outs = (sub.exposedPorts || []).filter((p) => p.dir === 'out')
            .map((p) => ({ id: p.id, label: p.label, domain: p.domain }));
        return { ins, outs, label: node.label || sub.name, color: '#818cf8' };
    }
    const def = PRIMITIVES[node.type];
    if (!def) return { ins: [], outs: [], label: node.type, color: '#94a3b8' };
    return { ins: def.ins, outs: def.outs, label: node.label || def.label, color: def.color };
}

export function findNode(bp, id) {
    return bp.nodes.find((n) => n.id === id) || null;
}

export function freshNodeId(bp, base) {
    const used = new Set(bp.nodes.map((n) => n.id));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) {
        const k = base + '_' + i;
        if (!used.has(k)) return k;
    }
}

export function addNode(bp, spec, library) {
    const isAsm = spec.type === 'assembly';
    const base = isAsm ? (spec.ref || 'asm') : spec.type;
    const id = spec.id && !findNode(bp, spec.id) ? spec.id : freshNodeId(bp, base);
    const params = isAsm
        ? { ...(spec.params || {}) }
        : Object.assign(defaultParams(spec.type), spec.params || {});
    const label = spec.label || (isAsm ? (library?.[spec.ref]?.name || spec.ref) : (PRIMITIVES[spec.type]?.label || spec.type));
    const node = {
        id,
        type: spec.type,
        ref: isAsm ? spec.ref : undefined,
        label,
        x: spec.x ?? 120 + bp.nodes.length * 165,
        y: spec.y ?? 140,
        pos3d: spec.pos3d ? spec.pos3d.slice() : undefined,
        yaw3d: spec.yaw3d || 0,
        params,
    };
    bp.nodes.push(node);
    return node;
}

export function removeNode(bp, nodeId) {
    const idx = bp.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return false;
    bp.nodes.splice(idx, 1);
    bp.links = bp.links.filter((l) => l.from !== nodeId && l.to !== nodeId);
    bp.exposedPorts = bp.exposedPorts.filter((p) => p.nodeId !== nodeId);
    return true;
}

export function canLink(bp, fromId, fromPort, toId, toPort, library) {
    if (!fromId || !toId || fromId === toId) return { ok: false, reason: 'cannot connect node to itself' };
    const a = findNode(bp, fromId), b = findNode(bp, toId);
    if (!a || !b) return { ok: false, reason: 'missing node' };
    const pa = nodePorts(a, library).outs.find((p) => p.id === fromPort);
    const pb = nodePorts(b, library).ins.find((p) => p.id === toPort);
    if (!pa || !pb) return { ok: false, reason: 'invalid port' };
    const allowed = PORT_COMPAT[pa.domain] || [pa.domain];
    if (!allowed.includes(pb.domain)) return { ok: false, reason: `port mismatch (${pa.domain} -> ${pb.domain})` };
    if (bp.links.some((l) => l.from === fromId && l.fromPort === fromPort && l.to === toId && l.toPort === toPort)) {
        return { ok: false, reason: 'already connected' };
    }
    return { ok: true, domain: pa.domain };
}

export function addLink(bp, fromId, fromPort, toId, toPort, library) {
    const chk = canLink(bp, fromId, fromPort, toId, toPort, library);
    if (!chk.ok) return null;
    // For single-input rotational shafts, replace an existing rotational input link on that port.
    if (chk.domain === 'rot') {
        bp.links = bp.links.filter((l) => !(l.to === toId && l.toPort === toPort));
    }
    const id = 'L' + (bp.nextId++);
    const link = { id, from: fromId, fromPort, to: toId, toPort, domain: chk.domain };
    bp.links.push(link);
    return link;
}

export function removeLink(bp, linkId) {
    const n = bp.links.length;
    bp.links = bp.links.filter((l) => l.id !== linkId);
    return bp.links.length !== n;
}

/** Detect cyclic assembly references (A contains B contains A). */
export function hasAssemblyCycle(bpId, library, seen = new Set()) {
    if (seen.has(bpId)) return true;
    const bp = library[bpId];
    if (!bp) return false;
    seen.add(bpId);
    for (const n of bp.nodes) {
        if (n.type === 'assembly' && n.ref) {
            if (hasAssemblyCycle(n.ref, library, new Set(seen))) return true;
        }
    }
    return false;
}

/** Topological order of nodes over powerflow links (elec / rot / lin); falls back cleanly on any cycle. */
export function topoNodes(bp) {
    const inDeg = new Map();
    const out = new Map();
    for (const n of bp.nodes) { inDeg.set(n.id, 0); out.set(n.id, []); }
    for (const l of bp.links) {
        if (l.domain === 'struct') continue;
        if (!inDeg.has(l.from) || !inDeg.has(l.to)) continue;
        out.get(l.from).push(l.to);
        inDeg.set(l.to, inDeg.get(l.to) + 1);
    }
    const q = [];
    for (const n of bp.nodes) if (inDeg.get(n.id) === 0) q.push(n.id);
    const order = [];
    while (q.length) {
        const id = q.shift();
        order.push(id);
        for (const nxt of out.get(id) || []) {
            const d = inDeg.get(nxt) - 1;
            inDeg.set(nxt, d);
            if (d === 0) q.push(nxt);
        }
    }
    // Append any disconnected or cyclic stragglers deterministically.
    for (const n of bp.nodes) if (!order.includes(n.id)) order.push(n.id);
    return order.map((id) => findNode(bp, id)).filter(Boolean);
}
