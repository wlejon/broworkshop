// links.js — off-mesh links: the routes that are not walking.
//
// A navmesh describes the surface you can WALK on. Every real level also has
// connections that are not surface at all: a gap you jump, a ledge you drop
// off, a ladder you climb. Recast/Detour calls these off-mesh links, and bro
// bakes them straight into the mesh (`bakeNavMesh({ offMeshLinks })`) so
// `findPath` routes through them like any other polygon — no special-case
// pathfinding code in the app at all.
//
// ─── The tradeoff this module refuses to hide ────────────────────────────────
//
// Links and dynamic obstacles are mutually exclusive. `bakeNavMesh` THROWS if
// you pass both, and it is right to: a dtTileCache rebuilds tiles at runtime
// and would silently drop bake-time connections. So the app has two modes and
// the HUD says so in plain words:
//
//   Static + links     jump / drop / ladder, save() works, no runtime crates
//   Tiled + obstacles  runtime crates and doors, no links, no save()
//
// Switching is a re-bake, not a toggle. Rather than hiding one half of the
// engine behind a mode the user cannot see, the mode switch is the first
// control in this section.
//
// ─── The geometry ────────────────────────────────────────────────────────────
//
// The chunk-1 level has no gaps in it — every storey is reachable on foot. A
// link demo needs somewhere a link is the ONLY way across, so this module adds
// a "link yard" in the north-east quadrant of the east room: a ramp up to a
// west pad at y = 3, a 4.5 m gap, and an east pad that touches nothing. The
// east pad is an ISLAND. With the jump link baked, `findPath` reaches it and a
// waypoint carries link info; without it, the pad is unreachable and the same
// query returns a partial path that stops at the lip of the gap. One piece of
// geometry, two demonstrations.
//
// The other two links reuse the existing building: a one-way drop off the
// mezzanine's east edge into the hall four metres below, and a two-way ladder
// from the hall floor up onto the mezzanine's south-east corner.
//
// ─── Traversal ───────────────────────────────────────────────────────────────
//
// Detour moves an agent along a link segment in a straight line — correct, and
// it reads as a teleport-with-extra-steps. `node.navigationInfo().onLink` says
// when the agent is mid-link, which is exactly the hook the docs suggest using
// to play a jump animation. So each walker here rides an invisible carrier node
// (the one `attachAgent` owns) and its visible capsule is placed by this module
// each frame: on the ground it sits on the carrier, and while `onLink` is true
// it flies a parabola for a jump, a gravity-ish fall for a drop, and a straight
// climb for a ladder. The engine routes; the app performs.

import { bakeParams, navState, setOffMeshLinks, findPath } from '/app/navmesh.js';
import { agentState } from '/app/agents.js';

// --- Link yard geometry ------------------------------------------------------
//
// Authored here rather than in level.js because it exists only for this
// feature. Same discipline as level.js though: one descriptor list drives both
// the visual mesh and the Jolt static body, so the bake walks on exactly what
// is drawn.

const RAMP_OVERLAP = 0.4;

// Top face running from (z0, y0) to (z1, y1) at constant X — the same solve
// level.js uses for its ramps, kept local so this module can be lifted out.
function rampZ(name, z0, y0, z1, y1, xc, hx, thick, color) {
    if (z1 < z0) { [z0, z1] = [z1, z0]; [y0, y1] = [y1, y0]; }
    const dz = z1 - z0, dy = y1 - y0;
    const th = -Math.atan2(dy, dz);
    const len = Math.hypot(dz, dy) + RAMP_OVERLAP * 2;
    const hy = thick * 0.5;
    const mz = (z0 + z1) * 0.5, my = (y0 + y1) * 0.5;
    return {
        name, color, rx: th, rz: 0,
        cx: xc, cy: my - hy * Math.cos(th), cz: mz - hy * Math.sin(th),
        hx, hy, hz: len * 0.5,
    };
}

// The pads sit with their UNDERSIDE at y = 2.7 — above the default 2.0 m
// agentHeight, so the ground beneath them stays walkable and the yard does not
// sever the route into the inner chamber behind it.
export const yardSlabs = [
    rampZ('yard.ramp', -2, 0, -8, 3, 7, 1.2, 0.4, '#7d8894'),
    { name: 'yard.padW', cx: 8.25, cy: 2.85, cz: -10.5, hx: 2.75, hy: 0.15, hz: 2.5,
      rx: 0, rz: 0, color: '#6d7681' },
    { name: 'yard.padE', cx: 17.75, cy: 2.85, cz: -10.5, hx: 2.25, hy: 0.15, hz: 2.5,
      rx: 0, rz: 0, color: '#6d7681' },
];

// Points on the yard the HUD and the smoke test both aim at.
export const linkMarks = {
    padWest:   { x: 8.0,  y: 3, z: -10.5 },   // reachable on foot, up the ramp
    padEast:   { x: 18.0, y: 3, z: -10.5 },   // ISLAND — jump link or nothing
    yardFoot:  { x: 7.0,  y: 0, z: -2.0 },    // bottom of the yard ramp
    mezzEdge:  { x: -6.0, y: 4, z: 14.0 },    // above the drop
    hallBelow: { x: -2.5, y: 0, z: 14.0 },    // where the drop lands
    ladderTop: { x: -4.6, y: 4, z: 18.6 },
    ladderBase:{ x: -3.2, y: 0, z: 18.6 },
};

// --- The links themselves ----------------------------------------------------
//
// Each endpoint must land within `radius` of the ERODED walkable surface or
// the link is silently dropped at bake time — the same rule Godot applies to a
// NavigationLink placed off the mesh. The takeoff points below sit a decimetre
// outside their pad edges on purpose: that is where a jump starts.

export const LINK_DEFS = [
    {
        id: 'jump', kind: 'jump', color: '#ffd166',
        label: 'Jump — 4.5 m gap, two-way',
        start: { x: 10.6, y: 3, z: -10.5 },
        end:   { x: 15.9, y: 3, z: -10.5 },
        radius: 1.0, bidirectional: true, userId: 1,
        arc: 1.8,          // apex height above the chord, metres
    },
    {
        id: 'drop', kind: 'drop', color: '#ff6b6b',
        label: 'Drop — mezzanine ledge, one-way',
        start: { x: -4.6, y: 4, z: 14.0 },
        end:   { x: -2.5, y: 0, z: 14.0 },
        radius: 1.0, bidirectional: false, userId: 2,
        arc: 0.35,         // a small step-off, then gravity
    },
    {
        id: 'ladder', kind: 'ladder', color: '#5ad2f4',
        label: 'Ladder — hall to mezzanine, two-way',
        start: { x: -3.2, y: 0, z: 18.6 },
        end:   { x: -4.6, y: 4, z: 18.6 },
        radius: 1.0, bidirectional: true, userId: 3,
        arc: 0,            // climbed, not thrown
    },
];

export const linkState = {
    enabled: true,        // static bake carries the links
    sealed: false,        // jump link deliberately removed ("seal the pad")
    nodes: [],            // visual geometry per link
    walkers: [],          // link-traversing agents
    traversals: 0,        // completed link crossings, all walkers
    onLinkNow: 0,         // walkers mid-link this frame
    lastLink: '—',        // id of the most recent link entered
    crossedGap: 0,        // walkers that have stood on the east pad
    partial: null,        // last partial-path comparison
};

// The descriptor list handed to bakeNavMesh, or null when links are off. Sealing
// drops ONLY the jump link, which is what makes the east pad an island — the
// partial-path demo without touching any other part of the level.
export function activeLinkDefs() {
    if (!linkState.enabled) return null;
    return LINK_DEFS.filter(l => !(linkState.sealed && l.id === 'jump'));
}

// navmesh.js owns the bake; it asks this module (through a setter, so the two
// files do not import each other in a cycle) for the current link list.
export function syncLinksToBake() {
    setOffMeshLinks(activeLinkDefs());
}

// --- Build ------------------------------------------------------------------

export function buildLinkYard(scene) {
    const out = [];
    for (const s of yardSlabs) {
        const node = scene.createMesh({
            name: s.name, mesh: 'box',
            halfW: s.hx, halfH: s.hy, halfD: s.hz,
            x: s.cx, y: s.cy, z: s.cz,
            rx: s.rx * 180 / Math.PI, rz: s.rz * 180 / Math.PI,
            color: s.color, metallic: 0.0, roughness: 0.8,
        });
        const half = (s.rx || s.rz) * 0.5;
        const rot = s.rx
            ? { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) }
            : { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
        Physics.createBody({
            shape: 'box', static: true, layer: 'static',
            position: { x: s.cx, y: s.cy, z: s.cz },
            rotation: rot,
            halfExtents: { x: s.hx, y: s.hy, z: s.hz },
        });
        out.push({ node, slab: s });
    }
    return out;
}

// --- Link visuals ------------------------------------------------------------
//
// The scene has no line primitive, so a link is drawn as a chain of small
// spheres following the same curve the walkers fly: a parabola for a jump, a
// near-vertical fall for a drop, a straight climb for a ladder. Colour is the
// link's type, which makes the three kinds legible from across the level.

// Position along a link's visual/travel curve at t ∈ [0, 1].
export function linkCurvePoint(def, t) {
    const x = def.start.x + (def.end.x - def.start.x) * t;
    const z = def.start.z + (def.end.z - def.start.z) * t;
    let y = def.start.y + (def.end.y - def.start.y) * t;
    if (def.kind === 'jump') {
        y += def.arc * Math.sin(Math.PI * t);
    } else if (def.kind === 'drop') {
        // Step off level, then accelerate down: the fall reads as a fall
        // rather than as a ramp, which is the whole point of drawing it.
        y = def.start.y + def.arc * Math.sin(Math.PI * Math.min(1, t * 1.4))
          - (def.start.y - def.end.y) * (t * t);
    }
    return { x, y, z };
}

export function rebuildLinkVisuals(scene) {
    for (const n of linkState.nodes) scene.destroyNode(n);
    linkState.nodes.length = 0;

    const live = activeLinkDefs() || [];
    const liveIds = new Set(live.map(l => l.id));

    for (const def of LINK_DEFS) {
        const on = liveIds.has(def.id);
        const beads = def.kind === 'ladder' ? 9 : 13;
        for (let i = 0; i <= beads; i++) {
            const p = linkCurvePoint(def, i / beads);
            const n = scene.createMesh({
                name: `link.${def.id}.${i}`,
                mesh: 'sphere',
                radius: (i === 0 || i === beads) ? 0.28 : 0.15,
                x: p.x, y: p.y + 0.1, z: p.z,
                color: def.color,
                emissive: on ? 2.0 : 0.15,
                emissiveColor: def.color,
                roughness: 1.0,
            });
            n.castsShadow = false;
            // A sealed link is drawn dim rather than deleted: "this connection
            // exists in the level but not in the bake" is the state the
            // partial-path demo is actually about.
            n.visible = true;
            linkState.nodes.push(n);
        }
    }
    return linkState.nodes.length;
}

// --- Walkers that traverse links --------------------------------------------
//
// Built on `attachAgent` + `navigateTo`, unlike chunk 1's hand-rolled followers.
// That is deliberate: the binding is the only thing that reports `onLink`, and
// onLink is the signal this whole section is about. The binding owns an
// invisible CARRIER node; the visible capsule is placed by this module so the
// jump arc is ours to author.

const WALKER_COLORS = ['#ffd166', '#ff8f5a', '#7bed9f'];

export function spawnLinkWalker(scene, at, index) {
    const agent = bro.ai.game.createAgent({
        x: at.x, z: at.z, speed: 4.0, radius: 0.4, elevation: at.y,
        // Layer 16: invisible to chunk 1's route walkers (layer 8) and to every
        // crowd scenario (layers 1/2/4), so nothing here perturbs their numbers.
        avoidance: { layers: 16, mask: 16 },
    });
    agentState.world.addAgent(agent);

    const carrier = scene.createNode(`linkCarrier.${index}`);
    carrier.attachAgent(agentState.world, agent, {
        navMesh: navState.mesh,
        yOffset: 0.0,
        capabilities: ['hold'],
    });

    const node = scene.createMesh({
        name: `linkWalker.${index}`,
        mesh: 'capsule', radius: 0.34, halfHeight: 0.42,
        x: at.x, y: at.y + 0.76, z: at.z,
        color: WALKER_COLORS[index % WALKER_COLORS.length],
        metallic: 0.1, roughness: 0.45,
        emissive: 0.6, emissiveColor: WALKER_COLORS[index % WALKER_COLORS.length],
    });

    const rec = {
        agent, carrier, node,
        goal: null, onLink: false, def: null,
        traversals: 0, visitedEast: false,
        startedAt: { ...at },
    };
    linkState.walkers.push(rec);
    return rec;
}

// Point the walkers at a world position. Returns how many started a route.
export function sendLinkWalkers(to, opts) {
    let started = 0;
    for (const rec of linkState.walkers) {
        rec.goal = { ...to };
        const ok = rec.carrier.navigateTo(to, Object.assign({
            navMesh: navState.mesh,
            extents: { x: 2, y: 1.2, z: 2 },
        }, opts || {}));
        if (ok) started++;
    }
    return started;
}

export function clearLinkWalkers(scene) {
    for (const rec of linkState.walkers) {
        try { rec.carrier.stopNavigation(); } catch (e) { /* no route */ }
        rec.carrier.detachAgent();
        agentState.world.removeAgent(rec.agent);
        scene.destroyNode(rec.carrier);
        scene.destroyNode(rec.node);
    }
    linkState.walkers.length = 0;
}

// Which link is this position sitting on? Matched by proximity to either
// endpoint, which is unambiguous here — the three links are metres apart.
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

// Per-frame: read the binding's onLink flag, drive the traversal motion, and
// keep the counters the HUD reports.
export function tickLinkWalkers() {
    let onNow = 0;
    for (const rec of linkState.walkers) {
        const info = rec.carrier.navigationInfo();
        const cx = rec.agent.x, cz = rec.agent.z;

        if (info.onLink && !rec.onLink) {
            // Entered a link this frame.
            rec.def = linkUnder(cx, cz);
            linkState.lastLink = rec.def ? rec.def.id : 'link';
        } else if (!info.onLink && rec.onLink) {
            rec.traversals++;
            linkState.traversals++;
            rec.def = null;
        }
        rec.onLink = info.onLink;
        if (info.onLink) onNow++;

        // Base height: the carrier's own Y, which the binding interpolates
        // along the route (and along the link segment).
        let y = rec.carrier.y;

        if (info.onLink && rec.def) {
            const def = rec.def;
            const dx = def.end.x - def.start.x, dz = def.end.z - def.start.z;
            const len2 = dx * dx + dz * dz;
            // Progress along the link's XZ chord. A ladder is vertical, so its
            // chord is short; clamp keeps t sane either way.
            let t = len2 > 1e-4
                ? ((cx - def.start.x) * dx + (cz - def.start.z) * dz) / len2
                : 0.5;
            // The route may traverse a two-way link in either direction; the
            // projection above already handles that, but a backwards traversal
            // comes out as t running 1 → 0, which the curve handles unchanged.
            t = Math.max(0, Math.min(1, t));
            y = linkCurvePoint(def, t).y;
        }

        rec.node.x = cx;
        rec.node.y = y + 0.76;
        rec.node.z = cz;
        rec.node.rotationY = rec.agent.yaw;
        rec.agent.elevation = y;

        // The strong proof that a link was really crossed: the walker is
        // standing on the island pad, which nothing on foot can reach.
        if (!rec.visitedEast && cx > 15.4 && cx < 20.1
            && cz > -13.1 && cz < -7.9 && Math.abs(y - 3) < 1.2) {
            rec.visitedEast = true;
            linkState.crossedGap++;
        }
    }
    linkState.onLinkNow = onNow;
}

// --- Partial paths -----------------------------------------------------------
//
// The siege case, in one click. Seal the pad (drop the jump link from the bake)
// and the east pad becomes an island. Ask for a route to it twice:
//
//   requireFullPath: false  →  a path that clamps to the closest reachable
//                              point and reports partial === true
//   requireFullPath: true   →  null; no path at all
//
// Both answers come back from the same mesh in the same tick, which is the only
// way to show that the difference is the FLAG and not the level.

export function comparePartial(from, to) {
    const loose = findPath(from, to, { requireFullPath: false });
    const strict = findPath(from, to, { requireFullPath: true });

    const end = loose ? loose.points[loose.points.length - 1] : null;
    const r = {
        loose, strict,
        looseFound: !!loose,
        loosePartial: !!(loose && loose.partial),
        strictFound: !!strict,
        clampedAt: end ? { ...end } : null,
        // Distance from where the clamped route gives up to the true goal —
        // the honest measure of "how far short did it stop".
        shortfall: end ? Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) : Infinity,
    };
    linkState.partial = r;
    return r;
}

export function setLinksEnabled(on) { linkState.enabled = !!on; syncLinksToBake(); }
export function setSealed(on)       { linkState.sealed  = !!on; syncLinksToBake(); }

// How many of the requested links actually survived the bake. bro exposes no
// link read-back, so this is inferred the only way available: ask for a route
// that can only exist if the link does.
export function linkIsLive(def) {
    const mesh = navState.mesh;
    if (!mesh || !mesh.valid) return false;
    const wp = mesh.findPath(def.start, def.end, {
        extents: { x: 1.5, y: 1.2, z: 1.5 }, requireFullPath: true,
    });
    return !!wp;
}

// Does a route use a link at all? `wp.links` is a list of POINT indices whose
// following segment is a link traversal.
export function linkSegmentsOf(path) {
    if (!path || !path.links || !path.links.length) return [];
    return path.links.map(i => ({
        index: i,
        from: path.points[i],
        to: path.points[i + 1] || path.points[i],
    }));
}

export { bakeParams };
