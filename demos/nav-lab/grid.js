// grid.js — the NavGrid, baked from physics and drawn next to the navmesh.
//
// Chunk 1 argued that a NavGrid cannot describe this building, using a path
// query as the evidence. This module makes the same argument with a picture:
// bake the grid from the SAME static Jolt bodies the navmesh bakes from
// (`createNavGrid({ fromPhysics, physicsLayers, physicsMinY, physicsMaxY })`,
// no hand-authored obstacle rectangles anywhere), then draw every walkable cell
// as a flat quad. Put that overlay next to the navmesh's sampled surface and
// the difference is not an argument any more, it is a shape:
//
//   - The grid is a single flat sheet at y = 0. The navmesh overlay stacks
//     over it at y = 3, 4 and 8.
//   - The grid punches a rectangular hole under every ramp, because a NavGrid
//     obstacle is the body's AABB projected to XZ — a ramp's bounding box
//     intersects the walkable band, so the whole ramp footprint is blocked.
//     The navmesh walks up it.
//   - Wall corners are square in the grid and rounded in the mesh, because one
//     erodes cells and the other erodes polygons.
//
// That AABB behaviour is worth stating rather than hiding: it is not a bug, it
// is what "one walkability bit per XZ cell, obstacles as boxes" costs.
//
// ─── Ground follow ───────────────────────────────────────────────────────────
//
// Agents plan in XZ. `attachAgent({ groundFollow: { mode: 'raycast' } })` makes
// the bound node's Y track the ground under the agent via a native physics
// down-raycast, once per frame. The contrast this module draws is two agents
// walking the identical straight line up the link-yard ramp:
//
//   without groundFollow  the node sits at a constant Y and slides through the
//                         ramp — the classic 2D-agent-in-a-3D-level artefact
//   with groundFollow     the node climbs the ramp, because the probe found it
//
// Neither agent has a navmesh or a nav grid bound: they are steered straight at
// a target with setTarget(). That is deliberate — it isolates groundFollow as
// the only difference between them.

import { bounds } from '/app/level.js';
import { navState } from '/app/navmesh.js';
import { agentState } from '/app/agents.js';
import { linkMarks } from '/app/links.js';

export const gridState = {
    overlay: null,
    cells: 0,           // walkable cells drawn
    tested: 0,          // cells probed
    step: 0.4,          // draw resolution (independent of the grid's cellSize)
    visible: false,

    followers: [],      // { agent, node, follow }
    followOn: true,
    walking: false,
};

// --- Grid overlay ------------------------------------------------------------
//
// One node, one triangle soup, exactly like the navmesh overlay — and drawn at
// a slightly different height so the two can be shown at once without
// z-fighting. Magenta for the grid, cyan for the mesh.

export function rebuildGridOverlay(scene) {
    if (gridState.overlay) { scene.destroyNode(gridState.overlay); gridState.overlay = null; }
    gridState.cells = 0;
    gridState.tested = 0;
    const grid = navState.grid;
    if (!grid) return null;

    const step = gridState.step;
    const half = step * 0.42;
    const pos = [], nrm = [], idx = [];

    for (let x = bounds.minX; x <= bounds.maxX; x += step) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
            gridState.tested++;
            if (!grid.isWalkable(x, z)) continue;
            gridState.cells++;
            const b = pos.length / 3;
            const y = 0.03;      // just off the floor, under the mesh overlay
            pos.push(x - half, y, z - half,  x + half, y, z - half,
                     x + half, y, z + half,  x - half, y, z + half);
            for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
            idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
    }
    if (!pos.length) return null;

    gridState.overlay = scene.createMesh({
        name: 'gridOverlay',
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        indices: new Uint32Array(idx),
        color: [0.95, 0.30, 0.80, 1.0],
        emissive: 0.8,
        emissiveColor: [0.80, 0.20, 0.65],
        roughness: 1.0,
        twoSided: true,
    });
    gridState.overlay.castsShadow = false;
    gridState.overlay.visible = gridState.visible;
    return gridState.overlay;
}

export function setGridOverlayVisible(v) {
    gridState.visible = !!v;
    if (gridState.overlay) gridState.overlay.visible = gridState.visible;
}

// Is a world XZ blocked in the grid? Exposed so the smoke test can assert
// against cells it can name — inside the divider, inside a pillar.
export function gridWalkable(x, z) {
    return !!(navState.grid && navState.grid.isWalkable(x, z));
}

// --- Ground follow -----------------------------------------------------------

const FOLLOW_START = { x: 7.0, z: 0.5 };            // ground, south of the ramp
const FOLLOW_END   = { x: linkMarks.padWest.x - 1.0, z: -10.0 };   // up on the pad

// Two agents, side by side, identical in every respect except the groundFollow
// probe. `yOffset` means different things to each: an absolute node Y for the
// plain agent, clearance above the probed ground for the follower — which is
// precisely the behaviour being demonstrated.
export function spawnFollowers(scene) {
    clearFollowers(scene);
    for (const follow of [false, true]) {
        const lane = follow ? 1.1 : -1.1;
        const agent = bro.ai.game.createAgent({
            x: FOLLOW_START.x + lane, z: FOLLOW_START.z,
            speed: 2.6, radius: 0.4,
            // Layer 32: private to this demo, so the pair cannot disturb (or be
            // disturbed by) the crowd scenarios or the link walkers.
            avoidance: { layers: 32, mask: 32 },
        });
        agentState.world.addAgent(agent);

        const node = scene.createMesh({
            name: follow ? 'follower.ground' : 'follower.flat',
            mesh: 'capsule', radius: 0.34, halfHeight: 0.42,
            x: FOLLOW_START.x + lane, y: 0.76, z: FOLLOW_START.z,
            color: follow ? '#7bed9f' : '#9aa7b4',
            metallic: 0.05, roughness: 0.5,
            emissive: follow ? 0.9 : 0.25,
            emissiveColor: follow ? '#7bed9f' : '#9aa7b4',
        });

        const opts = { yOffset: 0.76, capabilities: ['hold'] };
        if (follow) opts.groundFollow = { mode: 'raycast', layers: ['static'] };
        node.attachAgent(agentState.world, agent, opts);

        gridState.followers.push({
            agent, node, follow, lane,
            yMin: Infinity, yMax: -Infinity,
        });
    }
    return gridState.followers.length;
}

export function clearFollowers(scene) {
    for (const rec of gridState.followers) {
        rec.node.detachAgent();
        agentState.world.removeAgent(rec.agent);
        scene.destroyNode(rec.node);
    }
    gridState.followers.length = 0;
    gridState.walking = false;
}

// Send the pair up the ramp. Straight-line steering, no path at all: the ramp
// is directly between the start and the target, so both agents walk over the
// same geometry and only their Y can differ.
export function walkTheRamp() {
    for (const rec of gridState.followers) {
        rec.agent.setTarget(FOLLOW_END.x + rec.lane * 0.4, FOLLOW_END.z);
        rec.yMin = Infinity; rec.yMax = -Infinity;
    }
    gridState.walking = true;
    return gridState.followers.length;
}

export function resetFollowers() {
    for (const rec of gridState.followers) {
        rec.agent.clearTarget();
        rec.agent.setPosition(FOLLOW_START.x + rec.lane, FOLLOW_START.z);
        rec.yMin = Infinity; rec.yMax = -Infinity;
    }
    gridState.walking = false;
}

// Record each node's Y range as it goes. The binding writes the transforms
// itself; this only measures, which is what makes the assertion honest.
export function tickFollowers() {
    let anyMoving = false;
    for (const rec of gridState.followers) {
        const y = rec.node.y;
        if (y < rec.yMin) rec.yMin = y;
        if (y > rec.yMax) rec.yMax = y;
        if (rec.agent.hasTarget && !rec.agent.atTarget) anyMoving = true;
    }
    gridState.walking = anyMoving;
}

export function followerSpread(follow) {
    const rec = gridState.followers.find(r => r.follow === follow);
    if (!rec || rec.yMax < rec.yMin) return 0;
    return rec.yMax - rec.yMin;
}

export function followerOf(follow) {
    return gridState.followers.find(r => r.follow === follow) || null;
}

export { FOLLOW_START, FOLLOW_END };
