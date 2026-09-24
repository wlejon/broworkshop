// grid.js — the NavGrid baked from the same physics, drawn next to the mesh,
// and the groundFollow contrast.
//
// The grid comes from the SAME static bodies (`createNavGrid({ fromPhysics,
// physicsMinY, physicsMaxY })`, no hand-authored rectangles). Drawn beside the
// sampled navmesh the difference is a shape, not an argument:
//   - one flat magenta sheet at y 0; the cyan mesh stacks at 3, 4 and 8;
//   - a square hole under every ramp: a grid obstacle is the body's AABB
//     projected to XZ, so the whole ramp footprint is blocked;
//   - square wall corners (cells eroded) against rounded ones (polygons).
//
// Ground follow: agents plan in XZ. `attachAgent({ groundFollow: { mode:
// 'raycast' } })` makes the bound node's Y track the ground under the agent
// via a native down-raycast. Two agents, identical but for that option, are
// steered straight up the link-yard ramp with setTarget() — no navmesh, no
// grid — so the probe is the only difference: one climbs, the other slides
// through the slope at a constant height.

import { quadSheet, capsule } from "/lib/kit/nav3d.js";
import { bounds, linkMarks } from "/app/level.js";
import { navState } from "/app/navmesh.js";
import { agentState } from "/app/agents.js";

export const gridState = {
    overlay: null,
    cells: 0,           // walkable cells drawn
    tested: 0,          // cells probed
    step: 0.4,          // draw resolution
    visible: false,
    followers: [],      // { agent, node, follow, lane, yMin, yMax }
    followOn: true,
};

let sceneRef = null;
export function bindGridScene(scene) { sceneRef = scene; }

/** Redraw the grid's walkable cells as one sheet, just under the mesh overlay. */
export function rebuildGridOverlay() {
    if (gridState.overlay) { gridState.overlay.destroy(); gridState.overlay = null; }
    gridState.cells = gridState.tested = 0;
    const grid = navState.grid;
    if (!grid) return null;
    const pts = [];
    for (let x = bounds.minX; x <= bounds.maxX; x += gridState.step) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += gridState.step) {
            gridState.tested++;
            if (grid.isWalkable(x, z)) { gridState.cells++; pts.push(x, 0.03, z); }
        }
    }
    gridState.overlay = quadSheet(sceneRef, pts, gridState.step * 0.42, {
        name: 'gridOverlay', color: [0.95, 0.3, 0.8, 1], emissive: 0.8, emissiveColor: [0.8, 0.2, 0.65],
    });
    if (gridState.overlay) gridState.overlay.visible = gridState.visible;
    return gridState.overlay;
}

export function setGridOverlayVisible(on) {
    gridState.visible = !!on;
    if (gridState.overlay) gridState.overlay.visible = gridState.visible;
}

/** Is a world XZ walkable in the grid? (The tests name cells: a wall, a pillar.) */
export function gridWalkable(x, z) {
    return !!(navState.grid && navState.grid.isWalkable(x, z));
}

// --- ground follow -------------------------------------------------------------------

export const FOLLOW_START = { x: 7.0, z: 0.5 };                          // ground, south of the yard ramp
export const FOLLOW_END = { x: linkMarks.padWest.x - 1.0, z: -10.0 };     // up on the west pad

/**
 * The pair. `yOffset` means different things to each: an absolute node Y for
 * the plain agent, clearance above the probed ground for the follower —
 * precisely the behaviour on show. Layer 32 keeps them private.
 */
export function spawnFollowers() {
    clearFollowers();
    for (const follow of [false, true]) {
        const lane = follow ? 1.1 : -1.1;
        const at = { x: FOLLOW_START.x + lane, y: 0, z: FOLLOW_START.z };
        const agent = bro.ai.game.createAgent({ x: at.x, z: at.z, speed: 2.6, radius: 0.4, avoidance: { layers: 32, mask: 32 } });
        agentState.world.addAgent(agent);
        const color = follow ? '#7bed9f' : '#9aa7b4';
        const node = capsule(sceneRef, at, { name: follow ? 'follower.ground' : 'follower.flat', color, emissive: follow ? 0.9 : 0.25 });
        const opts = { yOffset: 0.76, capabilities: ['hold'] };
        if (follow) opts.groundFollow = { mode: 'raycast', layers: ['static'] };
        node.attachAgent(agentState.world, agent, opts);
        node.visible = gridState.followOn;
        gridState.followers.push({ agent, node, follow, lane, yMin: Infinity, yMax: -Infinity });
    }
    return gridState.followers.length;
}

export function clearFollowers() {
    for (const rec of gridState.followers) {
        rec.node.detachAgent();
        agentState.world.removeAgent(rec.agent);
        rec.node.destroy();
    }
    gridState.followers.length = 0;
}

export function setFollowersVisible(on) {
    gridState.followOn = !!on;
    for (const rec of gridState.followers) rec.node.visible = gridState.followOn;
}

/** Straight-line steering up the ramp: both cross the same geometry; only Y can differ. */
export function walkTheRamp() {
    for (const rec of gridState.followers) {
        rec.agent.setTarget(FOLLOW_END.x + rec.lane * 0.4, FOLLOW_END.z);
        rec.yMin = Infinity; rec.yMax = -Infinity;
    }
    return gridState.followers.length;
}

export function resetFollowers() {
    for (const rec of gridState.followers) {
        rec.agent.clearTarget();
        rec.agent.setPosition(FOLLOW_START.x + rec.lane, FOLLOW_START.z);
        rec.yMin = Infinity; rec.yMax = -Infinity;
    }
}

/** Record each node's Y range. The binding writes the transform; this only measures. */
export function tickFollowers() {
    for (const rec of gridState.followers) {
        rec.yMin = Math.min(rec.yMin, rec.node.y);
        rec.yMax = Math.max(rec.yMax, rec.node.y);
    }
}

export function followerOf(follow) {
    return gridState.followers.find((r) => r.follow === follow) || null;
}

/** Y range the follower (true) or the plain agent (false) covered since the last walk. */
export function followerSpread(follow) {
    const rec = followerOf(follow);
    return !rec || rec.yMax < rec.yMin ? 0 : rec.yMax - rec.yMin;
}
