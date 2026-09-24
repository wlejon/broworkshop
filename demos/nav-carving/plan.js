// plan.js — routes that mix navmesh walking with ladder, jump and lift.
//
// A tiled bake cannot carry off-mesh links (bakeNavMesh throws if asked for
// both, because a dtTileCache rebuild would silently drop them), so this
// app keeps its links above the mesh: a small graph whose nodes are the
// start, the goal and every link endpoint, whose walk edges are
// `findPath(requireFullPath)` answers on the live surface and whose link edges
// are the ladder, the jump and the lift. Dijkstra over ~9 nodes gives the
// cheapest mix; walk edges between link endpoints are cached per surface
// generation, so a carve re-prices every detour at once.
//
// Costs are seconds for an agent walking at WALK_SPEED, so a ladder, a jump
// and a lift ride compare honestly against the walk they replace.

import { LINKS, LANDINGS, floorOf } from "/app/level.js";
import { findRoute, generation } from "/app/nav.js";
import { routeOf } from "/lib/kit/nav3d.js";

export const WALK_SPEED = 3.5;
export const CLIMB_SPEED = 1.2;       // m/s up or down the ladder
export const JUMP_TIME = 1.1;
const JUMP_PENALTY = 2.5;             // a leap of faith should lose to a bridge
export const LIFT_SPEED = 2.5;
const LIFT_OVERHEAD = 4.0;            // expected wait + doors

/** Every link endpoint as a graph node: { id, p, link, end } (end: 0 start, 1 end; lift: floor). */
const ENDPOINTS = [];
for (const def of LINKS) {
    ENDPOINTS.push({ p: def.start, link: def, end: 0 }, { p: def.end, link: def, end: 1 });
}
const LIFT = { id: 'lift', kind: 'lift', color: '#5ad2f4' };
LANDINGS.forEach((p, floor) => ENDPOINTS.push({ p, link: LIFT, end: floor }));
ENDPOINTS.forEach((e, i) => { e.id = 2 + i; });

export const planStats = { plans: 0, walkQueries: 0, cacheHits: 0 };

let cacheGen = -1;
const walkCache = new Map();

function walk(a, b) {
    const cached = a.id >= 2 && b.id >= 2;
    const key = a.id + '>' + b.id;
    if (cached) {
        if (cacheGen !== generation()) { walkCache.clear(); cacheGen = generation(); }
        if (walkCache.has(key)) { planStats.cacheHits++; return walkCache.get(key); }
    }
    planStats.walkQueries++;
    const route = routeOf(findRoute(a.p, b.p, true));
    if (cached) walkCache.set(key, route);
    return route;
}

function linkCost(a, b) {
    const def = a.link;
    if (def.kind === 'ladder') return Math.abs(b.p.y - a.p.y) / CLIMB_SPEED + 0.6;
    if (def.kind === 'jump') return JUMP_TIME + JUMP_PENALTY;
    return LIFT_OVERHEAD + Math.abs(b.p.y - a.p.y) / LIFT_SPEED;
}

/** The other endpoints a link endpoint leads to. */
function linkedFrom(e) {
    return ENDPOINTS.filter((o) => o !== e && o.link === e.link);
}

/**
 * Plan from → to. Returns { legs, cost, partial, generation } where legs are
 * { kind: 'walk', route } or { kind: 'ladder'|'jump'|'lift', def, from, to,
 * fromFloor, toFloor }. An unreachable goal gets the closest reachable point
 * (partial: true), like `navigateTo` does: one clamped walk leg.
 */
export function plan(from, to) {
    planStats.plans++;
    const S = { id: 0, p: from }, G = { id: 1, p: to };
    const nodes = [S, G, ...ENDPOINTS];
    const dist = new Map(nodes.map((n) => [n, Infinity]));
    const prev = new Map();
    const done = new Set();
    dist.set(S, 0);
    for (;;) {
        let u = null;
        for (const n of nodes) if (!done.has(n) && dist.get(n) < Infinity && (!u || dist.get(n) < dist.get(u))) u = n;
        if (!u || u === G) break;
        done.add(u);
        const relax = (v, cost, edge) => {
            const d = dist.get(u) + cost;
            if (d < dist.get(v) - 1e-9) { dist.set(v, d); prev.set(v, { u, edge }); }
        };
        for (const v of nodes) {
            if (v === u || v === S || done.has(v)) continue;
            const r = walk(u, v);
            if (r) relax(v, r.length / WALK_SPEED, { kind: 'walk', route: r });
        }
        if (u.link) for (const v of linkedFrom(u)) if (!done.has(v)) relax(v, linkCost(u, v), { kind: u.link.kind, u, v });
    }
    if (dist.get(G) === Infinity) {
        const clamp = routeOf(findRoute(from, to, false));
        return { legs: clamp ? [{ kind: 'walk', route: clamp }] : [], cost: Infinity, partial: true, generation: generation() };
    }
    const legs = [];
    for (let n = G; prev.has(n); n = prev.get(n).u) {
        const { edge } = prev.get(n);
        if (edge.kind === 'walk') legs.unshift({ kind: 'walk', route: edge.route });
        else {
            legs.unshift({
                kind: edge.kind, def: edge.u.link, from: edge.u.p, to: edge.v.p,
                fromFloor: floorOf(edge.u.p.y), toFloor: floorOf(edge.v.p.y),
            });
        }
    }
    return { legs, cost: dist.get(G), partial: false, generation: generation() };
}

/** The link kinds a plan uses, in order ('ladder', 'jump', 'lift'). */
export function linksOf(p) {
    return p ? p.legs.filter((l) => l.kind !== 'walk').map((l) => l.kind) : [];
}

/** All points of a plan as one polyline (link legs contribute their ends). */
export function polylineOf(p) {
    const out = [];
    for (const leg of p ? p.legs : []) {
        const pts = leg.kind === 'walk' ? leg.route.points : [leg.from, leg.to];
        for (const q of pts) out.push(q);
    }
    return out;
}

export { ENDPOINTS, LIFT };
