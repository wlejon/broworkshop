// level.js — the building a NavGrid cannot describe.
//
// Every piece is one kit `slab` descriptor (an oriented box). One list feeds
// both the render meshes and the Jolt static bodies (kit buildSlabs), and the
// navmesh is baked from the physics (`fromPhysics`), so what the bake walks on
// is provably the surface that is drawn and collided with.
//
// The layout breaks a flat 2D grid four ways:
//
//   1. STACKED FLOORS. Ground (y 0), mezzanine (y 4) and roof deck (y 8)
//      overlap in XZ, and an east platform (y 3) stacks over the ground past
//      the choke. A NavGrid stores one walkability bit per XZ cell.
//   2. SLOPES. Ramps at 18.4°, 26.6° and 52°. Drop maxSlope below 26.6 and
//      ramp D (the only way onto the platform) leaves the mesh. The 52° ramp
//      is a two-parameter story (see ramp.steep).
//   3. STEPS. Twelve 0.333 m risers from the mezzanine to the roof; below a
//      0.333 m agentMaxClimb the staircase severs and takes the roof with it.
//      CLEARANCE: the platform's underside is at 2.5 m, just above the default
//      2.0 m agentHeight, so the ground beneath it stays walkable until the
//      agent-height slider passes 2.5.
//   4. A CHOKE. The divider at x = 4 has one 2.6 m doorway; erode by 1.3 and
//      it closes, and routes through it turn partial. The ORCA crowd queues
//      here.
//
// Plus the LINK YARD (north-east): a ramp to a west pad at y 3, a 4.5 m gap,
// and an east pad that touches nothing — reachable only by the jump link.

import { slab, rampX, rampZ, buildSlabs } from "/lib/kit/nav3d.js";

const WALL = '#4a525c', RAIL = '#8a939e', FLOOR = '#6d7681', RAMP = '#7d8894';
const WALL_H = 3.0, WALL_T = 0.5;

export const slabs = [];
const add = (o) => { const s = slab(o); slabs.push(s); return s; };
const addRamp = (s) => { slabs.push(s); return s; };

// --- ground (top at y 0) + perimeter ------------------------------------------------
add({ name: 'ground', cx: 0, cy: -0.5, cz: 0, hx: 22, hy: 0.5, hz: 22, color: '#5a6470' });
for (const [name, cx, cz, hx, hz] of [
    ['wall.n', 0, -22, 22, WALL_T], ['wall.s', 0, 22, 22, WALL_T],
    ['wall.w', -22, 0, WALL_T, 22], ['wall.e', 22, 0, WALL_T, 22],
]) add({ name, kind: 'wall', cx, cy: WALL_H / 2, cz, hx, hy: WALL_H / 2, hz, color: WALL });

// --- the choke: a divider at x = 4 with one doorway, clear span |z| < 1.3 ---------
const DOOR_HALF = 1.3, LEAF_HZ = (22 - DOOR_HALF) / 2;
for (const sgn of [-1, 1]) {
    add({ name: sgn < 0 ? 'divider.n' : 'divider.s', kind: 'wall', cx: 4, cy: WALL_H / 2,
          cz: sgn * (DOOR_HALF + LEAF_HZ), hx: 0.4, hy: WALL_H / 2, hz: LEAF_HZ, color: WALL });
}

// --- east room: pillars and an inner chamber with its own 2.6 m doorway --------------
for (const [px, pz] of [[10, -6], [16, -6], [10, 17], [16, 17]]) {
    add({ name: `pillar.${px}.${pz}`, kind: 'wall', cx: px, cy: 1.6, cz: pz, hx: 0.6, hy: 1.6, hz: 0.6, color: '#3f4750' });
}
add({ name: 'chamber.w', kind: 'wall', cx: 12, cy: 1.4, cz: -18, hx: 0.35, hy: 1.4, hz: 3.6, color: WALL });
add({ name: 'chamber.s.a', kind: 'wall', cx: 13.1, cy: 1.4, cz: -14.4, hx: 1.1, hy: 1.4, hz: 0.35, color: WALL });
add({ name: 'chamber.s.b', kind: 'wall', cx: 17.9, cy: 1.4, cz: -14.4, hx: 1.1, hy: 1.4, hz: 0.35, color: WALL });
add({ name: 'chamber.e', kind: 'wall', cx: 19, cy: 1.4, cz: -18, hx: 0.35, hy: 1.4, hz: 3.6, color: WALL });

// --- east platform (top at y 3; underside 2.5) + ramp D (26.6°) ---------------------
add({ name: 'platform', cx: 14, cy: 2.75, cz: 7, hx: 4, hy: 0.25, hz: 5, color: FLOOR });
add({ name: 'platform.rail.e', kind: 'wall', cx: 17.85, cy: 3.5, cz: 7, hx: 0.15, hy: 0.5, hz: 5, color: RAIL });
addRamp(rampZ('ramp.D', -4, 0, 2, 3, 14, 2.4, 0.5, RAMP));

// --- mezzanine (top at y 4) over the west hall ---------------------------------------
// XZ cells in x∈[-21,-4], z∈[6,20] are walkable at y 0 AND y 4. No ramp runs
// beneath it: a 3.5 m ceiling is fine to walk under, a ramp climbing into it is not.
add({ name: 'mezz', cx: -12.5, cy: 3.75, cz: 13, hx: 8.5, hy: 0.25, hz: 7, color: FLOOR });
add({ name: 'mezz.rail.s', kind: 'wall', cx: -12.5, cy: 4.5, cz: 19.85, hx: 8.5, hy: 0.5, hz: 0.15, color: RAIL });
// Ramp A: hall to mezzanine, 4 m over 12 m ≈ 18.4°, stopping at the z = 6 edge.
addRamp(rampZ('ramp.A', -6, 0, 6, 4, -13, 2.4, 0.5, RAMP));
// Ramp B, 52°: raising maxSlope ALONE never admits it at cellSize 0.25 —
// Recast's ledge filter also drops spans whose neighbours sit more than
// agentMaxClimb apart, and one 0.25 m cell of a 52° run rises past it. Raise
// maxSlope AND lower cellSize (0.15) and it joins the mesh as a shortcut.
addRamp(rampX('ramp.steep', -4, 4, -0.9, 0, 10, 1.6, 0.5, '#8c6a55'));

// --- stairs: mezzanine (y 4) to roof (y 8), twelve 0.333 m risers ---------------------
// Each step rests on the mezzanine; treads overlap so the spans touch, and the
// foot starts 2.3 m inboard (an overhanging bottom tread is eaten by erosion
// and the whole flight bakes as an island).
const STEPS = 12, RISE = 4 / STEPS, RUN = 0.7;
for (let i = 0; i < STEPS; i++) {
    const top = 4 + (i + 1) * RISE, base = 3.4;
    add({ name: `stair.${i}`, kind: 'stair', cx: -6.75 - i * RUN, cy: (base + top) / 2, cz: 16.5,
          hx: 0.45, hy: (top - base) / 2, hz: 2.0, color: i % 2 ? RAMP : '#727c88' });
}

// --- roof deck (top at y 8), over the mezzanine, over the hall -------------------------
add({ name: 'roof', cx: -17.5, cy: 7.75, cz: 16, hx: 3.5, hy: 0.25, hz: 4, color: FLOOR });
add({ name: 'roof.rail.w', kind: 'wall', cx: -20.85, cy: 8.5, cz: 16, hx: 0.15, hy: 0.5, hz: 4, color: RAIL });
add({ name: 'roof.rail.n', kind: 'wall', cx: -17.5, cy: 8.5, cz: 12.15, hx: 3.5, hy: 0.5, hz: 0.15, color: RAIL });
add({ name: 'roof.rail.s', kind: 'wall', cx: -17.5, cy: 8.5, cz: 19.85, hx: 3.5, hy: 0.5, hz: 0.15, color: RAIL });

// --- link yard: ramp to a west pad (y 3), a 4.5 m gap, an island pad ------------------
// Pad undersides sit at 2.7 m (above agentHeight) so the ground beneath stays
// walkable and the route into the inner chamber is not severed.
addRamp(rampZ('yard.ramp', -2, 0, -8, 3, 7, 1.2, 0.4, RAMP));
add({ name: 'yard.padW', cx: 8.25, cy: 2.85, cz: -10.5, hx: 2.75, hy: 0.15, hz: 2.5, color: FLOOR });
add({ name: 'yard.padE', cx: 17.75, cy: 2.85, cz: -10.5, hx: 2.25, hy: 0.15, hz: 2.5, color: FLOOR });

// --- named points (properties of the level: they move with the geometry) --------------
export const marks = {
    hallSW:    { x: -17, y: 0, z: -17 },    // ground, west hall
    hallSE:    { x: -8,  y: 0, z: 16 },     // ground, directly under the mezzanine
    eastRoom:  { x: 17,  y: 0, z: -2 },     // ground, past the choke
    chamber:   { x: 15.5, y: 0, z: -17.5 }, // ground, inside the inner chamber
    platform:  { x: 14,  y: 3, z: 8 },      // east deck
    mezzanine: { x: -10, y: 4, z: 13 },     // first floor
    roof:      { x: -17, y: 8, z: 16 },     // second floor
};

export const linkMarks = {
    padWest:    { x: 8.0,  y: 3, z: -10.5 },  // reachable on foot, up the yard ramp
    padEast:    { x: 18.0, y: 3, z: -10.5 },  // ISLAND: the jump link or nothing
    yardFoot:   { x: 7.0,  y: 0, z: -2.0 },   // bottom of the yard ramp
    mezzEdge:   { x: -6.0, y: 4, z: 14.0 },   // above the drop
    hallBelow:  { x: -2.5, y: 0, z: 14.0 },   // where the drop lands
    ladderTop:  { x: -4.6, y: 4, z: 18.6 },
    ladderBase: { x: -3.2, y: 0, z: 18.6 },
};

/** The doorway in the x = 4 divider (clear span |z| < halfZ). */
export const CHOKE = { x: 4, z: 0, halfZ: DOOR_HALF };

/** XZ bounds of everything walkable, and the Y of each storey the overlay probes. */
export const bounds = { minX: -22, maxX: 22, minZ: -22, maxZ: 22 };
export const storeys = [0, 3, 4, 8];

/** Create the physics world and build every slab. Returns [{ node, tag, slab }]. */
export function buildLevel(scene) {
    Physics.createWorld({});
    return buildSlabs(scene, slabs);
}

/** One shadow-casting sun plus a cool fill, so the mezzanine reads as hanging. */
export function buildLights(scene) {
    scene.setAmbient([0.05, 0.055, 0.07]);
    const sun = scene.createLight({ type: 'directional', direction: [-0.45, -1.0, -0.35], color: [1.0, 0.96, 0.88], intensity: 3.4 });
    sun.castsShadow = true;
    const fill = scene.createLight({ type: 'directional', direction: [0.6, -0.4, 0.7], color: [0.45, 0.55, 0.75], intensity: 0.9 });
    return { sun, fill };
}
