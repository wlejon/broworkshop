// lib/kit/nav3d.js — bro.ai.game navigation in a bro.scene: level geometry,
// debug drawing, route following, link curves and picking.
//
// The navmesh demos (demos/nav-lab, demos/nav-carving) all needed the same
// pieces: a level built from oriented boxes that are both render mesh and
// static Jolt body (so `bakeNavMesh({ fromPhysics })` walks exactly what is
// drawn), a sampled picture of the baked surface (the NavMesh has no polygon
// read-back), path ribbons and waypoint pips, a waypoint follower that drives
// an XZ-steering Agent along a 3D route, the arc an agent flies across an
// off-mesh link, and a click that lands on the walkable surface.
//
//   import { slab, rampZ, buildSlabs, walkableOverlay, ribbon, routeOf,
//            startRoute, followRoute, linkPoint, linkBeads, pickSurface } from "/lib/kit/nav3d.js";
//
// Points are {x, y, z}; y is up. Nothing here owns a navmesh or a world.

import { addStatic, pickRay, raycast } from "./physics3d.js";

// --- level geometry ----------------------------------------------------------------

/** How far a ramp is extended past both ends so its wedge buries into the floors. */
export const RAMP_OVERLAP = 0.4;

/**
 * A slab descriptor: an oriented box { name, cx, cy, cz, hx, hy, hz, rx, rz,
 * color, kind }. rx / rz are radians about X / Z (one axis per slab); `kind`
 * is cosmetic ('floor' | 'wall' | 'ramp' | 'stair' ...).
 */
export function slab(o) {
    return { rx: 0, rz: 0, kind: 'floor', color: '#6d7681', ...o };
}

/**
 * A ramp whose TOP face runs from (x0, y0) to (x1, y1) at constant z = zc.
 * Authoring by the surface, not the box centre, is what keeps the foot flush
 * with the floor (a lip there exceeds agentMaxClimb and silently disconnects
 * the storey above). hz = half width, thick = slab thickness.
 */
export function rampX(name, x0, y0, x1, y1, zc, hz, thick, color, overlap = RAMP_OVERLAP) {
    if (x1 < x0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = y1 - y0;
    const th = Math.atan2(dy, dx);             // rotating about +Z raises the +X end
    const hy = thick * 0.5;
    return slab({
        name, kind: 'ramp', color,
        cx: (x0 + x1) / 2 + hy * Math.sin(th), cy: (y0 + y1) / 2 - hy * Math.cos(th), cz: zc,
        hx: (Math.hypot(dx, dy) + overlap * 2) / 2, hy, hz, rz: th,
    });
}

/** rampX along Z: top face from (z0, y0) to (z1, y1) at x = xc; hx = half width. */
export function rampZ(name, z0, y0, z1, y1, xc, hx, thick, color, overlap = RAMP_OVERLAP) {
    if (z1 < z0) { [z0, z1] = [z1, z0]; [y0, y1] = [y1, y0]; }
    const dz = z1 - z0, dy = y1 - y0;
    const th = -Math.atan2(dy, dz);            // about +X a RISING +Z needs a negative angle
    const hy = thick * 0.5;
    return slab({
        name, kind: 'ramp', color,
        cx: xc, cy: (y0 + y1) / 2 - hy * Math.cos(th), cz: (z0 + z1) / 2 - hy * Math.sin(th),
        hx, hy, hz: (Math.hypot(dz, dy) + overlap * 2) / 2, rx: th,
    });
}

/** The {x,y,z,w} rotation of a slab (single-axis pitch). */
export function slabRotation(s) {
    const half = (s.rx || s.rz) * 0.5;
    return s.rx ? { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) }
                : { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

/**
 * Build every slab as a render mesh plus a static Jolt box on `layer`
 * (default 'static'), from the one descriptor so the bake and the picture
 * cannot disagree. Returns [{ node, tag, slab }].
 */
export function buildSlabs(scene, slabs, opts) {
    const layer = (opts && opts.layer) || 'static';
    return slabs.map((s) => {
        const e = addStatic(scene, {
            shape: 'box', layer,
            position: { x: s.cx, y: s.cy, z: s.cz },
            rotation: slabRotation(s),
            halfExtents: { x: s.hx, y: s.hy, z: s.hz },
        }, { color: s.color, metallic: 0, roughness: s.kind === 'wall' ? 0.95 : 0.8 });
        e.mesh.name = s.name;
        return { node: e.mesh, tag: e.tag, slab: s };
    });
}

// --- debug drawing -----------------------------------------------------------------

/**
 * One mesh of flat, upward-facing squares: `centers` is a flat [x,y,z, ...]
 * list, `half` the half side. One node, one triangle soup — a node per cell
 * would be thousands of draws for a debug view. look: { color, emissive,
 * emissiveColor, name }. Returns the node, or null for an empty list.
 */
export function quadSheet(scene, centers, half, look) {
    const n = Math.floor(centers.length / 3);
    if (!n) return null;
    const pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
        const x = centers[i * 3], y = centers[i * 3 + 1], z = centers[i * 3 + 2];
        pos.set([x - half, y, z - half, x + half, y, z - half, x + half, y, z + half, x - half, y, z + half], i * 12);
        for (let k = 0; k < 4; k++) nrm[i * 12 + k * 3 + 1] = 1;
        const b = i * 4;
        idx.set([b, b + 2, b + 1, b, b + 3, b + 2], i * 6);
    }
    const o = look || {};
    const node = scene.createMesh({
        name: o.name || 'quadSheet', positions: pos, normals: nrm, indices: idx,
        color: o.color || [0.2, 0.85, 0.95, 1], emissive: o.emissive != null ? o.emissive : 0.9,
        emissiveColor: o.emissiveColor || o.color || [0.15, 0.7, 0.85], roughness: 1, twoSided: true,
    });
    node.castsShadow = false;
    return node;
}

/**
 * Sample the baked walkable surface. bro exposes no polygon read-back, so a
 * regular XZ lattice is pushed through `nearestPoint` once per storey with a
 * tight Y extent (so stacked floors resolve separately); a point that snaps
 * within `tol * step` of where it was asked is on the mesh.
 * opts: { bounds: {minX, maxX, minZ, maxZ}, storeys: [y...], step = 0.6,
 *         yExtent = 1.2, tol = 0.3 }. Returns a flat [x, snappedY, z, ...] list.
 */
export function sampleWalkable(mesh, opts) {
    const out = [];
    if (!mesh || !mesh.valid) return out;
    const { bounds, storeys } = opts;
    const step = opts.step || 0.6, tol = (opts.tol != null ? opts.tol : 0.3) * step;
    const ext = { x: step * 0.5, y: opts.yExtent || 1.2, z: step * 0.5 };
    for (let x = bounds.minX; x <= bounds.maxX; x += step) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
            for (const y of storeys) {
                const q = mesh.nearestPoint({ x, y, z }, ext);
                // nearestPoint clamps into the extents box, so a hit on the far
                // side of an eroded wall still answers: reject anything that moved.
                if (q && Math.abs(q.x - x) <= tol && Math.abs(q.z - z) <= tol) out.push(x, q.y, z);
            }
        }
    }
    return out;
}

/**
 * sampleWalkable drawn as a quad sheet floating `lift` above the surface.
 * opts: sampleWalkable's plus { lift = 0.06, look }. Returns { node, samples }.
 */
export function walkableOverlay(scene, mesh, opts) {
    const pts = sampleWalkable(mesh, opts);
    const lift = opts.lift != null ? opts.lift : 0.06;
    for (let i = 1; i < pts.length; i += 3) pts[i] += lift;
    const node = quadSheet(scene, pts, (opts.step || 0.6) * 0.42, { name: 'navOverlay', ...(opts.look || {}) });
    return { node, samples: pts.length / 3 };
}

/**
 * A flat ribbon along a polyline of {x,y,z}: horizontal even on ramps so it
 * reads from an orbit camera. opts: { width = 0.22, lift = 0.16, color,
 * emissive = 1.4, name }. Returns the node, or null for < 2 usable points.
 */
export function ribbon(scene, pts, opts) {
    const o = opts || {};
    const w = o.width != null ? o.width : 0.22, lift = o.lift != null ? o.lift : 0.16;
    if (!pts || pts.length < 2) return null;
    const pos = [], nrm = [], idx = [];
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
        if (L < 1e-4) continue;
        const px = (-dz / L) * w, pz = (dx / L) * w, base = pos.length / 3;
        pos.push(a.x - px, a.y + lift, a.z - pz, a.x + px, a.y + lift, a.z + pz,
                 b.x + px, b.y + lift, b.z + pz, b.x - px, b.y + lift, b.z - pz);
        nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    if (!pos.length) return null;
    const color = o.color || [1.0, 0.78, 0.25, 1.0];
    const node = scene.createMesh({
        name: o.name || 'pathRibbon',
        positions: new Float32Array(pos), normals: new Float32Array(nrm), indices: new Uint32Array(idx),
        color, emissive: o.emissive != null ? o.emissive : 1.4,
        emissiveColor: o.emissiveColor || color, roughness: 1, twoSided: true,
    });
    node.castsShadow = false;
    return node;
}

/** A glowing sphere, out of the shadow pass. */
export function marker(scene, color, radius, emissive) {
    const n = scene.createMesh({
        mesh: 'sphere', radius: radius || 0.42,
        color, emissive: emissive != null ? emissive : 1.6, emissiveColor: color, roughness: 1,
    });
    n.castsShadow = false;
    return n;
}

/**
 * `max` pre-built markers parked out of sight (a click-to-path app re-queries
 * constantly; churning nodes per click is the wrong shape).
 * Returns { show(points, lift = 0.22), hide(), nodes }.
 */
export function pipPool(scene, max, look) {
    const o = look || {};
    const nodes = [];
    for (let i = 0; i < max; i++) {
        const p = marker(scene, o.color || '#ffd166', o.radius || 0.19, o.emissive != null ? o.emissive : 2);
        p.visible = false;
        nodes.push(p);
    }
    return {
        nodes,
        show(pts, lift = 0.22) {
            for (let i = 0; i < nodes.length; i++) {
                const on = !!pts && i < pts.length;
                nodes[i].visible = on;
                if (on) { nodes[i].x = pts[i].x; nodes[i].y = pts[i].y + lift; nodes[i].z = pts[i].z; }
            }
        },
        hide() { for (const n of nodes) n.visible = false; },
    };
}

/** An agent's body: a capsule standing on (x, y, z). opts: { name, color, radius = 0.34, halfHeight = 0.42, emissive }. */
export function capsule(scene, at, opts) {
    const o = opts || {};
    const r = o.radius || 0.34, hh = o.halfHeight || 0.42;
    return scene.createMesh({
        name: o.name, mesh: 'capsule', radius: r, halfHeight: hh,
        x: at.x, y: at.y + r + hh, z: at.z,
        color: o.color || '#5ad2f4', metallic: 0.05, roughness: 0.5,
        emissive: o.emissive != null ? o.emissive : 0.35, emissiveColor: o.color || '#5ad2f4',
    });
}

// --- routes ------------------------------------------------------------------------

/** Length of a polyline of {x,y,z} (3D). */
export function pathLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    return L;
}

/**
 * NavMesh.findPath's flat Float32Array unpacked into a route:
 * { points: [{x,y,z}], length, minY, maxY, rise, partial, links } — `links`
 * holds the point indices whose following segment is an off-mesh link.
 * null in, null out.
 */
export function routeOf(wp) {
    if (!wp) return null;
    const points = [];
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i + 2 < wp.length; i += 3) {
        points.push({ x: wp[i], y: wp[i + 1], z: wp[i + 2] });
        minY = Math.min(minY, wp[i + 1]); maxY = Math.max(maxY, wp[i + 1]);
    }
    return { points, length: pathLength(points), minY, maxY, rise: maxY - minY,
             partial: !!wp.partial, links: wp.links ? Array.from(wp.links) : [] };
}

/**
 * Put a follower record on a route. rec: { agent (bro.ai.game Agent), y }.
 * Sets rec.route / leg / done and steers at the first waypoint after the
 * snapped start. A route with fewer than two points leaves rec done.
 */
export function startRoute(rec, route) {
    if (!route || route.points.length < 2) {
        rec.route = null; rec.done = true;
        rec.agent.clearTarget();
        return false;
    }
    rec.route = route; rec.leg = 1; rec.done = false;
    rec.agent.setTarget(route.points[1].x, route.points[1].z);
    return true;
}

/**
 * Advance a follower after the AI world has ticked. Agents steer in XZ only
 * (`elevation` feeds ORCA's level filter and moves nothing), so the height
 * comes from the route: the agent is projected onto the leg it walks and the
 * waypoint heights are interpolated — what carries a walker up a ramp rather
 * than through it. Consumes a waypoint within `arrive` (XZ). Writes rec.y and
 * agent.elevation. Returns true on the step the route completes.
 */
export function followRoute(rec, arrive = 0.55) {
    if (!rec.route || rec.done) return false;
    const pts = rec.route.points, agent = rec.agent;
    let finished = false;
    const tgt = pts[rec.leg];
    if (Math.hypot(agent.x - tgt.x, agent.z - tgt.z) < arrive) {
        if (rec.leg + 1 < pts.length) {
            rec.leg++;
            agent.setTarget(pts[rec.leg].x, pts[rec.leg].z);
        } else {
            rec.done = finished = true;
            agent.clearTarget();
        }
    }
    const a = pts[rec.leg - 1], b = pts[rec.leg];
    const sx = b.x - a.x, sz = b.z - a.z, len2 = sx * sx + sz * sz;
    const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((agent.x - a.x) * sx + (agent.z - a.z) * sz) / len2)) : 1;
    rec.y = a.y + (b.y - a.y) * t;
    agent.elevation = rec.y;
    return finished;
}

// --- off-mesh link curves ----------------------------------------------------------

/**
 * Point at t in [0, 1] along a link's travel curve. def: { kind, start, end,
 * arc } — 'jump' flies a parabola `arc` m above the chord, 'drop' steps off
 * and falls, anything else ('ladder', 'elevator') is the straight chord.
 */
export function linkPoint(def, t) {
    const s = def.start, e = def.end;
    const x = s.x + (e.x - s.x) * t, z = s.z + (e.z - s.z) * t;
    let y = s.y + (e.y - s.y) * t;
    if (def.kind === 'jump') y += (def.arc || 0) * Math.sin(Math.PI * t);
    else if (def.kind === 'drop') {
        y = s.y + (def.arc || 0) * Math.sin(Math.PI * Math.min(1, t * 1.4)) - (s.y - e.y) * t * t;
    }
    return { x, y, z };
}

/**
 * A link drawn as a chain of beads along linkPoint (the scene has no line
 * primitive); end beads are larger. opts: { on = true (dim when false),
 * beads = 13, lift = 0.1, name }. Returns the nodes.
 */
export function linkBeads(scene, def, opts) {
    const o = opts || {};
    const n = o.beads || (def.kind === 'ladder' || def.kind === 'elevator' ? 9 : 13);
    const nodes = [];
    for (let i = 0; i <= n; i++) {
        const p = linkPoint(def, i / n);
        const b = marker(scene, def.color, i === 0 || i === n ? 0.28 : 0.15, o.on === false ? 0.15 : 2.0);
        b.name = `${o.name || 'link'}.${i}`;
        b.x = p.x; b.y = p.y + (o.lift != null ? o.lift : 0.1); b.z = p.z;
        nodes.push(b);
    }
    return nodes;
}

// --- picking -----------------------------------------------------------------------

/**
 * The walkable point under canvas-local pixel (lx, ly) of a sceneViewport:
 * a physics ray against the level's bodies (so overlays, ribbons and agents
 * can never be hit), snapped onto `mesh` when given — clicking a wall face or
 * a ramp's side still resolves to the nearest place an agent can stand.
 * opts: { mesh, extents = {2.5, 2, 2.5}, maxDist = 500 }. Returns {x,y,z} or null.
 */
export function pickSurface(vp, lx, ly, opts) {
    const o = opts || {};
    const hit = raycast(pickRay(vp, lx, ly), o.maxDist || 500);
    if (!hit) return null;
    const p = hit.point || hit.position;
    const at = Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z };
    if (!o.mesh || !o.mesh.valid) return at;
    return o.mesh.nearestPoint(at, o.extents || { x: 2.5, y: 2.0, z: 2.5 }) || at;
}
