// level.js — the building that a NavGrid cannot describe.
//
// Every piece of this level is one `slab` descriptor: an oriented box with a
// half-extent triple and an optional pitch about X or Z. One descriptor list
// feeds BOTH the visual meshes and the Jolt static bodies, which is the whole
// point — the navmesh is baked from the physics geometry (`fromPhysics`), so
// what the bake walks on is provably the same surface the renderer draws and
// the player collides with. There is no second, hand-authored "nav geometry"
// list to drift out of sync.
//
// The layout is chosen to break a flat 2D grid in four distinct ways:
//
//   1. STACKED FLOORS. Ground (y=0), mezzanine (y=4) and roof (y=8) overlap in
//      XZ, and an east platform (y=3) stacks over the ground on the far side of
//      the level. A NavGrid stores one walkability bit per XZ cell, so it
//      physically cannot represent "walkable at y=0 AND walkable at y=4 above
//      it". The mezzanine hangs directly over the west hall for that reason,
//      and the roof deck hangs over the mezzanine, giving three walkable
//      surfaces in a single XZ column.
//
//   2. SLOPES. Three ramps at 18.4°, 26.6° and 52.2°. The first two are
//      walkable at the default 45° limit and the third is not. Drop maxSlope
//      below 26.6 and the second ramp — and the platform it is the only route
//      to — drops off the mesh: the slope parameter proving itself in one
//      variable. The 52° ramp is a two-parameter story; see ramp B below.
//
//   3. STEPS. A flight of twelve 0.333 m risers from the mezzanine to the roof.
//      Walkable at the default 0.4 m agentMaxClimb; drop the HUD slider below
//      0.333 and the staircase severs, taking the whole roof deck with it,
//      because Recast stops merging the spans.
//
//   3b. CLEARANCE. The east platform's underside sits at y=2.5, just above the
//      default 2.0 m agentHeight, so the ground beneath it stays walkable.
//      Raise agentHeight past 2.5 and that ground is carved away.
//
//   4. A CHOKE POINT. The corridor joining the west hall to the east room is
//      2.6 m of clear width. At agentRadius 0.5 an agent fits with room to
//      spare; erode by 1.3 and the corridor closes outright and paths through
//      it turn partial. (Chunk 2's ORCA crowd will queue through this doorway.)
//
// Ramp geometry note: `rampX`/`rampZ` are specified by the two world-space
// points their TOP SURFACE must pass through, and solve backwards for the box
// centre. Authoring ramps by their centre instead is how you end up with a
// 0.4 m lip at the foot that silently exceeds agentMaxClimb and disconnects
// the floor above — which is a real bug this level hit before the helper
// existed. Each ramp is also over-extended `RAMP_OVERLAP` past both endpoints
// so its wedge buries itself in the floor slabs rather than butting against
// them.

const RAMP_OVERLAP = 0.4;

// Every slab: { name, cx, cy, cz, hx, hy, hz, rx, rz, color, kind }.
// `kind` is cosmetic only — it picks the material.
const slabs = [];

function slab(o) {
    slabs.push({
        rx: 0, rz: 0, kind: 'floor', color: '#6d7681',
        ...o,
    });
    return slabs[slabs.length - 1];
}

// A box whose top face runs from (x0, y0) to (x1, y1) at constant Z.
// Rotating a box about +Z by θ sends local +X to (cosθ, sinθ, 0), so the +X
// end rises for θ > 0. Local +Y goes to (-sinθ, cosθ, 0); the top face centre
// therefore sits `hy` along that axis, and the box centre is the endpoint
// midpoint pushed back down it.
// A box is symmetric, so the two endpoints are interchangeable — normalising to
// the +X direction keeps atan2 on its principal branch. Passing the ramp's high
// end first would otherwise put θ near 180° and flip the box upside down.
function rampX(name, x0, y0, x1, y1, zc, hz, thick, color) {
    if (x1 < x0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = y1 - y0;
    const th = Math.atan2(dy, dx);
    const len = Math.hypot(dx, dy) + RAMP_OVERLAP * 2;
    const hy = thick * 0.5;
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    return slab({
        name, kind: 'ramp', color,
        cx: mx + hy * Math.sin(th), cy: my - hy * Math.cos(th), cz: zc,
        hx: len * 0.5, hy, hz,
        rz: th,
    });
}

// Same, along Z. Rotating about +X by θ sends local +Z to (0, -sinθ, cosθ),
// so a RISING +Z direction needs a NEGATIVE angle.
function rampZ(name, z0, y0, z1, y1, xc, hx, thick, color) {
    if (z1 < z0) { [z0, z1] = [z1, z0]; [y0, y1] = [y1, y0]; }
    const dz = z1 - z0, dy = y1 - y0;
    const th = -Math.atan2(dy, dz);
    const len = Math.hypot(dz, dy) + RAMP_OVERLAP * 2;
    const hy = thick * 0.5;
    const mz = (z0 + z1) * 0.5, my = (y0 + y1) * 0.5;
    return slab({
        name, kind: 'ramp', color,
        cx: xc, cy: my - hy * Math.cos(th), cz: mz - hy * Math.sin(th),
        hx, hy, hz: len * 0.5,
        rx: th,
    });
}

// --- Ground floor (top at y = 0) ---------------------------------------------
// One 44 x 44 pad. Everything else stands on it.

slab({ name: 'ground', cx: 0, cy: -0.5, cz: 0, hx: 22, hy: 0.5, hz: 22, color: '#5a6470' });

// Perimeter wall, so the bake has a hard boundary instead of trailing off.
const WALL_H = 3.0, WALL_T = 0.5;
for (const [n, cx, cz, hx, hz] of [
    ['wall.n', 0, -22, 22, WALL_T], ['wall.s', 0, 22, 22, WALL_T],
    ['wall.w', -22, 0, WALL_T, 22], ['wall.e', 22, 0, WALL_T, 22],
]) {
    slab({ name: n, kind: 'wall', cx, cy: WALL_H / 2, cz, hx, hy: WALL_H / 2, hz, color: '#4a525c' });
}

// --- The choke point ---------------------------------------------------------
// A full-height divider at x = 4 splitting west hall from east room, with a
// single 2.6 m doorway on the centreline. This is the geometry the agentRadius
// slider kills first, and the queue chunk 2's crowd will form.

// Doorway clear span is [-DOOR_HALF, +DOOR_HALF]; each leaf runs from there to
// the perimeter wall at |z| = 22.
const DOOR_HALF = 1.3;
const LEAF_HZ = (22 - DOOR_HALF) / 2;
slab({ name: 'divider.n', kind: 'wall', cx: 4, cy: WALL_H / 2, cz: -(DOOR_HALF + LEAF_HZ),
       hx: 0.4, hy: WALL_H / 2, hz: LEAF_HZ, color: '#4a525c' });
slab({ name: 'divider.s', kind: 'wall', cx: 4, cy: WALL_H / 2, cz: DOOR_HALF + LEAF_HZ,
       hx: 0.4, hy: WALL_H / 2, hz: LEAF_HZ, color: '#4a525c' });

// --- East room: pillars and an inner chamber with its own doorway ------------

for (const [px, pz] of [[10, -6], [16, -6], [10, 17], [16, 17]]) {
    slab({ name: `pillar.${px}.${pz}`, kind: 'wall', cx: px, cy: 1.6, cz: pz,
           hx: 0.6, hy: 1.6, hz: 0.6, color: '#3f4750' });
}
// Inner chamber, north-east corner, entered through a single 2.6 m doorway in
// its south wall — a second interior room to route into, and a place where the
// eroded surface visibly detaches from the wall faces.
slab({ name: 'chamber.w', kind: 'wall', cx: 12, cy: 1.4, cz: -18, hx: 0.35, hy: 1.4, hz: 3.6, color: '#4a525c' });
slab({ name: 'chamber.s.a', kind: 'wall', cx: 13.1, cy: 1.4, cz: -14.4, hx: 1.1, hy: 1.4, hz: 0.35, color: '#4a525c' });
slab({ name: 'chamber.s.b', kind: 'wall', cx: 17.9, cy: 1.4, cz: -14.4, hx: 1.1, hy: 1.4, hz: 0.35, color: '#4a525c' });
slab({ name: 'chamber.e', kind: 'wall', cx: 19, cy: 1.4, cz: -18, hx: 0.35, hy: 1.4, hz: 3.6, color: '#4a525c' });

// --- East platform (top at y = 3) --------------------------------------------
// A mid-height deck over the east room. Its underside sits at y = 2.5, which is
// just above the default 2.0 m agentHeight — so the ground stays walkable
// beneath it, and pushing the HUD's agent-height slider past 2.5 carves that
// ground away. That is the clearance parameter demonstrating itself, and it is
// a second stacked surface on the far side of the choke point.

slab({ name: 'platform', cx: 14, cy: 2.75, cz: 7, hx: 4, hy: 0.25, hz: 5, color: '#6d7681' });
slab({ name: 'platform.rail.e', kind: 'wall', cx: 17.85, cy: 3.5, cz: 7, hx: 0.15, hy: 0.5, hz: 5, color: '#8a939e' });

// Ramp D: ground up to the platform, 3 m over 6 m ≈ 26.6°.
rampZ('ramp.D', -4, 0, 2, 3, 14, 2.4, 0.5, '#7d8894');

// --- Mezzanine (top at y = 4), hanging over the west hall --------------------
// The stacked-surface proof: XZ cells in x∈[-21,-4], z∈[6,20] are walkable at
// BOTH y=0 (hall floor, underneath, with 3.5 m of clearance) and y=4 (here).
// No approach ramp may run beneath it — a 3.5 m ceiling is fine to walk under
// but a ramp climbing into it is not, and that is exactly how the first draft
// of this level silently failed to connect its storeys.

slab({ name: 'mezz', cx: -12.5, cy: 3.75, cz: 13, hx: 8.5, hy: 0.25, hz: 7, color: '#6d7681' });
// Balcony lip — low enough to see over, high enough to read as a railing. Only
// on the south edge; the east edge takes the steep ramp and the stairs.
slab({ name: 'mezz.rail.s', kind: 'wall', cx: -12.5, cy: 4.5, cz: 19.85, hx: 8.5, hy: 0.5, hz: 0.15, color: '#8a939e' });

// Ramp A: hall floor up to the mezzanine, 4 m over 12 m ≈ 18.4°. Approaches
// from the north (open hall), stopping exactly at the mezzanine's z = 6 edge so
// it is never underneath it. This is the route every cross-floor path takes at
// default settings.
rampZ('ramp.A', -6, 0, 6, 4, -13, 2.4, 0.5, '#7d8894');

// Ramp B: the steep one — 4 m over 3.1 m ≈ 52°, well past the default 45°
// limit, and the level's deliberate "too steep to walk" surface.
//
// Measured behaviour, which is more interesting than the obvious version:
// raising maxSlope alone NEVER admits this ramp. At the default cellSize of
// 0.25 it stays off the mesh at maxSlope 55, 60, 70 and even 85. Drop cellSize
// to 0.15 and it appears immediately at maxSlope 60. The reason is that
// maxSlope is not the only gate a ramp passes — Recast's ledge filter also
// discards any span whose neighbours sit more than agentMaxClimb away, and one
// cell of run on a θ ramp rises cellSize * tan θ. At 0.25 m cells that
// per-cell rise, once quantised to cellHeight, exceeds the climb budget and
// the ramp voxelises into disconnected slivers that regionMinSize then culls.
//
// So this ramp is a two-parameter demonstration: raise maxSlope AND lower
// cellSize (or raise agentMaxClimb) and it joins the mesh, opening a shortcut
// from the hall straight up onto the mezzanine. Either one on its own does
// nothing, which is exactly the kind of thing a lab should make visible.
// The single-variable slope demonstration lives on ramp D instead: drop
// maxSlope below 26.6° and that ramp — and the platform it serves — vanishes.
rampX('ramp.steep', -4, 4, -0.9, 0, 10, 1.6, 0.5, '#8c6a55');

// --- Stairs: mezzanine (y=4) up to the roof deck (y=8) -----------------------
// Twelve risers of 0.333 m, each tread 0.7 m deep, climbing westward across the
// mezzanine to meet the roof's east edge at x = -12.5. The riser sits just under
// the 0.4 m default agentMaxClimb, so the staircase is walkable out of the box —
// and dropping the HUD's step-height slider below it severs the roof deck
// outright, because Recast stops merging the spans. Each step is a box resting
// on the mezzanine rather than a column to the ground, so nothing pokes through
// the floor below.

const STEP_COUNT = 12, STEP_RISE = 4 / STEP_COUNT, STEP_RUN = 0.7;
for (let i = 0; i < STEP_COUNT; i++) {
    const top = 4 + (i + 1) * STEP_RISE;
    const base = 3.4;
    slab({
        name: `stair.${i}`, kind: 'stair',
        // Treads overlap slightly (hx > run/2) so consecutive spans certainly
        // touch rather than leaving a sliver of gap for the voxeliser to find.
        // The foot starts 2.3 m inboard of the mezzanine's east edge, not flush
        // with it: a staircase that overhangs the floor it stands on has its
        // bottom tread eaten by the agent-radius erosion, and the whole flight
        // then bakes as an island you can see but never step onto.
        cx: -6.75 - i * STEP_RUN, cy: (base + top) / 2, cz: 16.5,
        hx: 0.45, hy: (top - base) / 2, hz: 2.0,
        color: i % 2 ? '#7d8894' : '#727c88',
    });
}

// --- Roof deck (top at y = 8) ------------------------------------------------
// Reached only via the stairs, and it overhangs the mezzanine, which itself
// overhangs the hall: three walkable surfaces in one XZ column, 4 m apart. Its
// east edge is left open where the staircase lands.

slab({ name: 'roof', cx: -17.5, cy: 7.75, cz: 16, hx: 3.5, hy: 0.25, hz: 4, color: '#6d7681' });
slab({ name: 'roof.rail.w', kind: 'wall', cx: -20.85, cy: 8.5, cz: 16, hx: 0.15, hy: 0.5, hz: 4, color: '#8a939e' });
slab({ name: 'roof.rail.n', kind: 'wall', cx: -17.5, cy: 8.5, cz: 12.15, hx: 3.5, hy: 0.5, hz: 0.15, color: '#8a939e' });
slab({ name: 'roof.rail.s', kind: 'wall', cx: -17.5, cy: 8.5, cz: 19.85, hx: 3.5, hy: 0.5, hz: 0.15, color: '#8a939e' });

// --- Named waypoints the HUD and the smoke test both use ---------------------
// Kept here rather than in app.js because they are properties of the LEVEL:
// if the geometry moves, these move with it.

export const marks = {
    hallSW:    { x: -17, y: 0, z: -17 },   // ground, west hall
    hallSE:    { x: -8,  y: 0, z: 16 },    // ground, DIRECTLY UNDER the mezzanine
    eastRoom:  { x: 17,  y: 0, z: -2 },    // ground, past the choke point
    chamber:   { x: 15.5, y: 0, z: -17.5 },// ground, inside the inner chamber
    platform:  { x: 14,  y: 3, z: 8 },     // east deck — first storey, east side
    mezzanine: { x: -10, y: 4, z: 13 },    // FIRST FLOOR — the multi-level goal
    roof:      { x: -17, y: 8, z: 16 },    // SECOND FLOOR
};

// XZ bounds of everything walkable, for the NavGrid and the overlay sampler.
export const bounds = { minX: -22, maxX: 22, minZ: -22, maxZ: 22 };

// The Y of each distinct walkable storey. The overlay sampler probes these
// with a tight Y extent so stacked surfaces resolve independently instead of
// collapsing into one another.
export const storeys = [0, 3, 4, 8];

export { slabs };

// Build the visual meshes and the matching Jolt static bodies from the one
// descriptor list. Returns the scene nodes so the HUD can hide the shell.
export function buildLevel(scene) {
    Physics.createWorld({});

    const nodes = [];
    for (const s of slabs) {
        const node = scene.createMesh({
            name: s.name,
            mesh: 'box',
            halfW: s.hx, halfH: s.hy, halfD: s.hz,
            x: s.cx, y: s.cy, z: s.cz,
            rx: s.rx * 180 / Math.PI,
            rz: s.rz * 180 / Math.PI,
            color: s.color,
            metallic: 0.0,
            roughness: s.kind === 'wall' ? 0.95 : 0.8,
        });
        nodes.push({ node, slab: s });

        // Single-axis pitch, so the quaternion is a one-liner either way.
        const half = (s.rx || s.rz) * 0.5;
        const rot = s.rx
            ? { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) }
            : { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

        Physics.createBody({
            shape: 'box',
            static: true,
            layer: 'static',
            position: { x: s.cx, y: s.cy, z: s.cz },
            rotation: rot,
            halfExtents: { x: s.hx, y: s.hy, z: s.hz },
        });
    }
    return nodes;
}

// Lit environment: one shadow-casting sun plus a cool fill, so the mezzanine
// actually reads as hanging over the hall rather than floating in flat light.
export function buildEnvironment(scene) {
    scene.setAmbient([0.05, 0.055, 0.07]);
    const sun = scene.createLight({
        type: 'directional',
        direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.96, 0.88],
        intensity: 3.4,
    });
    sun.castsShadow = true;
    const fill = scene.createLight({
        type: 'directional',
        direction: [0.6, -0.4, 0.7],
        color: [0.45, 0.55, 0.75],
        intensity: 0.9,
    });
    return { sun, fill };
}
