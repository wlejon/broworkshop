// links.js — off-mesh links: the routes that are not walking.
//
// A navmesh is the surface you WALK on; real levels also have gaps you jump,
// ledges you drop off and ladders you climb. bro bakes those straight into the
// mesh (`bakeNavMesh({ offMeshLinks })`) and findPath routes through them like
// any polygon: no special-case pathfinding here at all. Links need the static
// bake (see navmesh.js), so the HUD's mode switch is the first control.
//
// The link yard's east pad (level.js) touches nothing: with the jump baked,
// findPath reaches it and marks the takeoff; sealed (the jump dropped from the
// bake) the same query clamps at the lip, which is the partial-path demo.
//
// Traversal: Detour moves an agent along a link in a straight line.
// `navigationInfo().onLink` says when the agent is mid-link, the hook for a
// jump animation — so each walker rides an invisible CARRIER node (the one
// attachAgent owns) and its visible capsule is placed here: on the carrier on
// the ground, and along the link's curve (kit linkPoint) while onLink. The
// engine routes; the app performs.

import { capsule, linkPoint, linkBeads } from "/lib/kit/nav3d.js";
import { navState, findPath, EXTENTS } from "/app/navmesh.js";
import { agentState } from "/app/agents.js";
import { linkMarks } from "/app/level.js";

/**
 * Each endpoint must land within `radius` of the ERODED surface or the link
 * is silently dropped at bake time (as a Godot NavigationLink off the mesh).
 * Takeoffs sit a decimetre past their pad edges: that is where a jump starts.
 */
export const LINK_DEFS = [
    { id: 'jump', kind: 'jump', color: '#ffd166', label: 'Jump: 4.5 m gap, two-way',
      start: { x: 10.6, y: 3, z: -10.5 }, end: { x: 15.9, y: 3, z: -10.5 },
      radius: 1.0, bidirectional: true, userId: 1, arc: 1.8 },
    { id: 'drop', kind: 'drop', color: '#ff6b6b', label: 'Drop: mezzanine ledge, one-way',
      start: { x: -4.6, y: 4, z: 14.0 }, end: { x: -2.5, y: 0, z: 14.0 },
      radius: 1.0, bidirectional: false, userId: 2, arc: 0.35 },
    { id: 'ladder', kind: 'ladder', color: '#5ad2f4', label: 'Ladder: hall to mezzanine, two-way',
      start: { x: -3.2, y: 0, z: 18.6 }, end: { x: -4.6, y: 4, z: 18.6 },
      radius: 1.0, bidirectional: true, userId: 3, arc: 0 },
];

export const linkState = {
    enabled: true,        // the static bake carries the links
    sealed: false,        // jump link removed from the bake ("seal the pad")
    nodes: [],            // bead visuals
    walkers: [],
    traversals: 0,        // completed link crossings, all walkers
    onLinkNow: 0,         // walkers mid-link this frame
    lastLink: '—',        // id of the most recent link entered
    crossedGap: 0,        // walkers that have stood on the island pad
    partial: null,        // last comparePartial result
};

let sceneRef = null;
export function bindLinkScene(scene) { sceneRef = scene; }

/** The defs the next bake carries, or null with links off. Sealing drops only the jump. */
export function activeLinkDefs() {
    if (!linkState.enabled) return null;
    return LINK_DEFS.filter((l) => !(linkState.sealed && l.id === 'jump'));
}

/** Hand the current link list to the next bake. */
export function syncLinksToBake() { navState.links = activeLinkDefs(); }
export function setLinksEnabled(on) { linkState.enabled = !!on; syncLinksToBake(); }
export function setSealed(on) { linkState.sealed = !!on; syncLinksToBake(); }

/**
 * Redraw every link: live ones bright, the rest dim rather than deleted —
 * "this connection exists in the level but not in the bake" is the state the
 * partial-path demo is about.
 */
export function rebuildLinkVisuals() {
    for (const n of linkState.nodes) n.destroy();
    linkState.nodes.length = 0;
    const live = new Set(((navState.linksBaked && activeLinkDefs()) || []).map((l) => l.id));
    for (const def of LINK_DEFS) {
        for (const n of linkBeads(sceneRef, def, { on: live.has(def.id), name: `link.${def.id}` })) linkState.nodes.push(n);
    }
}

/**
 * Did a link survive the bake? No read-back exists, so ask for a route that
 * can only exist through it (strict, takeoff to landing).
 */
export function linkIsLive(def) {
    const mesh = navState.mesh;
    if (!mesh || !mesh.valid) return false;
    return !!mesh.findPath(def.start, def.end, { extents: { x: 1.5, y: 1.2, z: 1.5 }, requireFullPath: true });
}

/** The segments of a route that are link traversals: [{ index, from, to }]. */
export function linkSegmentsOf(route) {
    if (!route || !route.links || !route.links.length) return [];
    return route.links.map((i) => ({ index: i, from: route.points[i], to: route.points[i + 1] || route.points[i] }));
}

// --- walkers -------------------------------------------------------------------------
//
// attachAgent + navigateTo, unlike agents.js: the binding is the only thing
// that reports onLink. Avoidance layer 16 keeps them out of everyone's way.

const WALKER_COLORS = ['#ffd166', '#ff8f5a', '#7bed9f'];

export function spawnLinkWalker(at, index) {
    const agent = bro.ai.game.createAgent({ x: at.x, z: at.z, speed: 4.0, radius: 0.4, elevation: at.y, avoidance: { layers: 16, mask: 16 } });
    agentState.world.addAgent(agent);
    const carrier = sceneRef.createNode(`linkCarrier.${index}`);
    carrier.y = at.y;
    carrier.attachAgent(agentState.world, agent, { navMesh: navState.mesh, yOffset: 0, capabilities: ['hold'] });
    const color = WALKER_COLORS[index % WALKER_COLORS.length];
    const node = capsule(sceneRef, at, { name: `linkWalker.${index}`, color, emissive: 0.6 });
    const rec = { agent, carrier, node, goal: null, onLink: false, def: null, traversals: 0, visitedEast: false, startedAt: { ...at } };
    linkState.walkers.push(rec);
    return rec;
}

/** The two walkers at the foot of the yard ramp, so "Send over the gap" is a whole journey. */
export function spawnLinkWalkers() {
    for (let i = 0; i < 2; i++) {
        spawnLinkWalker({ x: linkMarks.yardFoot.x + (i - 0.5) * 1.4, y: 0, z: linkMarks.yardFoot.z + 1.0 }, i);
    }
}

export function clearLinkWalkers() {
    for (const rec of linkState.walkers) {
        rec.carrier.stopNavigation();
        rec.carrier.detachAgent();
        agentState.world.removeAgent(rec.agent);
        rec.carrier.destroy();
        rec.node.destroy();
    }
    linkState.walkers.length = 0;
}

/**
 * Put the walkers back at the yard foot with fresh counters. Respawned, not
 * teleported: the binding keeps the last route height and plans the next
 * navigateTo from it, so a walker moved with setPosition from the island pad
 * would plan from y = 3 while standing on the ground (ENGINE-ISSUES.md).
 */
export function resetLinkWalkers() {
    clearLinkWalkers();
    spawnLinkWalkers();
    Object.assign(linkState, { traversals: 0, crossedGap: 0, lastLink: '—', onLinkNow: 0 });
}

/** Stop every walker (a re-bake replaces the surface their routes were planned on). */
export function stopLinkWalkers() {
    for (const rec of linkState.walkers) rec.carrier.stopNavigation();
}

/** Route every walker to a point. Returns how many started (complete or partial). */
export function sendLinkWalkers(to, opts) {
    let started = 0;
    for (const rec of linkState.walkers) {
        rec.goal = { ...to };
        if (rec.carrier.navigateTo(to, { navMesh: navState.mesh, extents: EXTENTS, ...(opts || {}) })) started++;
    }
    return started;
}

// Which link is a walker on? Nearest endpoint; the three are metres apart.
function linkUnder(x, z) {
    let best = null, bestD = 3.0;
    for (const def of activeLinkDefs() || []) {
        for (const e of [def.start, def.end]) {
            const d = Math.hypot(e.x - x, e.z - z);
            if (d < bestD) { bestD = d; best = def; }
        }
    }
    return best;
}

/** Per frame, after the bindings stepped: read onLink, fly the curve, count. */
export function tickLinkWalkers() {
    let onNow = 0;
    for (const rec of linkState.walkers) {
        const info = rec.carrier.navigationInfo();
        const cx = rec.agent.x, cz = rec.agent.z;
        if (info.onLink && !rec.onLink) {
            rec.def = linkUnder(cx, cz);
            linkState.lastLink = rec.def ? rec.def.id : 'link';
        } else if (!info.onLink && rec.onLink) {
            rec.traversals++;
            linkState.traversals++;
            rec.def = null;
        }
        rec.onLink = info.onLink;
        if (info.onLink) onNow++;

        // The carrier's Y is the binding's route height (interpolated along
        // the link segment too); mid-link the curve replaces it.
        let y = rec.carrier.y;
        if (info.onLink && rec.def) {
            const d = rec.def, dx = d.end.x - d.start.x, dz = d.end.z - d.start.z, len2 = dx * dx + dz * dz;
            // Progress along the XZ chord; a backwards traversal runs t 1 → 0,
            // which the curve handles unchanged.
            const t = len2 > 1e-4 ? Math.max(0, Math.min(1, ((cx - d.start.x) * dx + (cz - d.start.z) * dz) / len2)) : 0.5;
            y = linkPoint(d, t).y;
        }
        rec.node.x = cx; rec.node.y = y + 0.76; rec.node.z = cz;

        // The proof a link was really crossed: standing on the island pad.
        if (!rec.visitedEast && cx > 15.4 && cx < 20.1 && cz > -13.1 && cz < -7.9 && Math.abs(y - 3) < 1.2) {
            rec.visitedEast = true;
            linkState.crossedGap++;
        }
    }
    linkState.onLinkNow = onNow;
}

// --- partial paths -------------------------------------------------------------------

/**
 * The same route asked twice on one mesh in one tick: requireFullPath false
 * clamps to the closest reachable point and says partial; true returns null.
 * With the pad sealed the two disagree, which shows the difference is the FLAG.
 */
export function comparePartial(from, to) {
    const loose = findPath(from, to, { requireFullPath: false });
    const strict = findPath(from, to, { requireFullPath: true });
    const end = loose ? loose.points[loose.points.length - 1] : null;
    const r = {
        loose, strict,
        looseFound: !!loose, loosePartial: !!(loose && loose.partial), strictFound: !!strict,
        clampedAt: end ? { ...end } : null,
        // How far short the clamped route stops.
        shortfall: end ? Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) : Infinity,
    };
    linkState.partial = r;
    return r;
}
