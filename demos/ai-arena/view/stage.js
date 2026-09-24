// view/stage.js — the 3D arena: ground, translucent boundary walls, obstacle
// boxes, one capsule per unit with a faint FOV cone and a world-anchored HP
// bar, and the fog-of-war ghosts. The orbit camera and its mouse controls
// come from the kit viewport (right-drag orbit, middle-drag pan, wheel
// zoom); a left click on a unit reports it through onPick.
//
// Each capsule is driven by its AgentBinding (attachAgent writes position +
// rotation); update() only manages visibility and the per-unit overlays.
// Replays bypass the bindings and write the recorded frame straight onto the
// nodes (renderReplayFrame).
import { sceneViewport, orbitRotation, worldToScreen } from "/lib/kit/viewport3d.js";
import { AI } from "/app/sim/ai.js";

export const UNIT_Y = 0.9;   // capsule center height (radius + halfHeight)
const CAPSULE_R = 0.4;
const CAPSULE_HALF_H = 0.5;
const WALL_H = 2.5;
const WALL_THICK = 0.4;
const OBSTACLE_H = 1.8;

// World-space HP bar: ylock billboards so they turn with the camera but stay
// upright. Fixed world size; perspective handles zoom.
const HP_BAR_W = 1.3;
const HP_BAR_H = 0.18;
const HP_BAR_Y = 2.2;

export const FOV_ANGLE = Math.PI / 2.2;
const TEAM_RGB = [[0.90, 0.30, 0.24], [0.20, 0.60, 0.85]];
const FOV_RGB = [[0.95, 0.35, 0.28], [0.28, 0.66, 0.95]];

const CAMERA = { dist: 58, yaw: 0, pitch: -0.95 };   // MOBA-ish tilt, pitched ~55 degrees down

let vp = null;
let statics = [];       // ground, walls, obstacles
let units = {};         // unit id -> capsule node
let fovs = {};          // unit id -> FOV cone node
let hpBars = {};        // unit id -> { bg, fill, lastFrac, maxHp }
let ghosts = {};        // enemy id -> translucent capsule at the belief mean

export const stage = {
    get vp() { return vp; },
    get scene() { return vp.scene; },
    units: () => units,
    unitNode: (id) => units[id] || null,
    hpBar: (id) => hpBars[id] || null,
    ghost: (id) => ghosts[id] || null,
};

/** Set up the viewport on `canvas`. onPick(unitId) fires on a left click near a unit. */
export function initStage(canvas, onPick, getState) {
    vp = sceneViewport(canvas, {
        orbit: { target: [0, 0, 0], dist: CAMERA.dist, fov: 45, rot: orbitRotation(CAMERA.yaw, CAMERA.pitch) },
        controls: { minDist: 8, maxDist: 120 },
    });
    wirePicking(canvas, onPick, getState);
    return vp;
}

export function resetCamera() {
    vp.reframe([0, 0, 0], CAMERA.dist, { yaw: CAMERA.yaw, pitch: CAMERA.pitch });
}

/** Screen position (canvas CSS px) of a world point under the current camera. */
export function projectToCanvas(x, y, z) {
    const c = vp.canvas;
    const view = globalThis.Camera.orbitViewOpts(vp.cam, c);
    return worldToScreen([x, y, z], view, c.clientWidth, c.clientHeight);
}

// Left click (≤ 6 px of drag) picks the living unit whose capsule center
// projects nearest the cursor, within 40 px.
function wirePicking(canvas, onPick, getState) {
    let down = null;
    canvas.addEventListener("mousedown", (e) => {
        if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("mouseup", (e) => {
        if (e.button !== 0 || !down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 6) return;
        const r = canvas.getBoundingClientRect();
        const id = unitAt(getState(), e.clientX - r.left, e.clientY - r.top);
        if (id != null) onPick(id);
    });
}

/** Unit id nearest canvas point (px, py) within 40 px, or null. */
export function unitAt(state, px, py) {
    if (!state) return null;
    let best = null, bestD = 40;
    for (const a of state.agents) {
        if (!a.unit.alive || !units[a.unit.id]) continue;
        const sp = projectToCanvas(a.x, UNIT_Y, a.z);
        if (sp.behind) continue;
        const d = Math.hypot(sp.x - px, sp.y - py);
        if (d < bestD) { bestD = d; best = a.unit.id; }
    }
    return best;
}

/** A flat FOV wedge of radius 1 pointing down -Z (scaled per unit range). */
export function fovMesh() {
    const half = FOV_ANGLE / 2;
    return {
        positions: new Float32Array([
            0, 0, 0,
            Math.sin(half), 0, -Math.cos(half),
            Math.sin(-half), 0, -Math.cos(-half),
        ]),
        indices: new Uint32Array([0, 1, 2]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    };
}

function destroyAll() {
    for (const n of statics) n.destroy();
    statics = [];
    for (const map of [units, fovs, ghosts]) for (const k in map) map[k].destroy();
    for (const k in hpBars) { hpBars[k].bg.destroy(); hpBars[k].fill.destroy(); }
    units = {}; fovs = {}; hpBars = {}; ghosts = {};
}

/** (Re)build the arena and unit nodes for `scenario`. */
export function buildStage(scenario) {
    destroyAll();
    const scene = vp.scene;
    const B = scenario.bounds;
    const spanX = B.maxX - B.minX, spanZ = B.maxZ - B.minZ;
    const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;

    statics.push(scene.createMesh({
        mesh: "plane", halfW: spanX / 2, halfD: spanZ / 2,
        color: [0.14, 0.16, 0.18, 1.0], x: cx, y: 0, z: cz, name: "ground",
    }));

    // Translucent walls read as a walled box without hiding the action.
    const wall = (x, z, hw, hd) => scene.createMesh({
        mesh: "box", halfW: hw, halfH: WALL_H / 2, halfD: hd,
        color: [0.85, 0.92, 1.0, 0.3], x, y: WALL_H / 2, z, name: "wall",
    });
    statics.push(
        wall(cx, B.minZ - WALL_THICK, spanX / 2 + WALL_THICK, WALL_THICK),
        wall(cx, B.maxZ + WALL_THICK, spanX / 2 + WALL_THICK, WALL_THICK),
        wall(B.minX - WALL_THICK, cz, WALL_THICK, spanZ / 2 + WALL_THICK),
        wall(B.maxX + WALL_THICK, cz, WALL_THICK, spanZ / 2 + WALL_THICK));

    // Obstacles: opaque dark boxes (the sim is 2D; the height is cosmetic).
    for (const o of scenario.obstacles) {
        statics.push(scene.createMesh({
            mesh: "box", halfW: o.hw, halfH: OBSTACLE_H / 2, halfD: o.hd,
            color: [0.05, 0.06, 0.07, 1.0], x: o.x, y: OBSTACLE_H / 2, z: o.z, name: "obstacle",
        }));
    }

    const wedge = fovMesh();
    for (const r of scenario.roster) {
        units[r.id] = scene.createMesh({
            mesh: "capsule", radius: CAPSULE_R, halfHeight: CAPSULE_HALF_H,
            color: [...TEAM_RGB[r.teamId], 1.0], x: r.x, y: UNIT_Y, z: r.z, name: "unit-" + r.id,
        });
        fovs[r.id] = scene.createMesh({
            positions: wedge.positions, indices: wedge.indices, normals: wedge.normals,
            color: [...FOV_RGB[r.teamId], 0.10], emissive: 0.15, name: "unit-fov-" + r.id,
        });
        const at = [r.x, HP_BAR_Y, r.z];
        hpBars[r.id] = {
            bg: scene.createShape({
                shape: "rect", width: HP_BAR_W, height: HP_BAR_H,
                fill: r.teamId === 0 ? "#5a1a14" : "#0e3a5c",
                worldAnchor: at, billboard: "ylock", name: "hp-bg-" + r.id,
            }),
            fill: scene.createShape({
                shape: "rect", width: HP_BAR_W - 0.06, height: HP_BAR_H - 0.04,
                fill: hpColor(1), worldAnchor: at, billboard: "ylock", name: "hp-fill-" + r.id,
            }),
            lastFrac: -1,
            maxHp: r.maxHp || 1,
        };
    }
}

// Green -> yellow -> red as HP drains.
export function hpColor(frac) {
    return frac >= 0.55 ? "#4ae04a" : frac >= 0.25 ? "#e6c64a" : "#e74c3c";
}

function setHpBar(hb, x, z, frac) {
    hb.bg.worldAnchor = [x, HP_BAR_Y, z];
    hb.fill.worldAnchor = [x, HP_BAR_Y + 0.001, z];
    if (frac !== hb.lastFrac) {
        hb.fill.scaleX = Math.max(0.0001, frac);
        hb.fill.fillColor = hpColor(frac);
        hb.lastFrac = frac;
    }
}

function setHpBarVisible(hb, on) { hb.bg.visible = on; hb.fill.visible = on; }

/** Yaw the unit is aiming along: its BotAim if it has one, else its facing. */
export function aimYawOf(agent) {
    const mem = AI.memory[agent.unit.id];
    if (mem && mem.aim) {
        const f = BotAim.forward(mem.aim);
        return Math.atan2(f.x, -f.z);
    }
    return agent.yaw;
}

/** Per-frame unit overlays for a live match. */
export function updateStage(state) {
    for (const a of state.agents) {
        const id = a.unit.id, alive = !!a.unit.alive;
        const node = units[id];
        if (node) node.visible = alive;

        const hb = hpBars[id];
        if (hb) {
            setHpBarVisible(hb, alive);
            // Follow the rendered capsule (the binding's position), not the sim.
            if (alive) setHpBar(hb, node ? node.x : a.x, node ? node.z : a.z,
                                clamp01(a.unit.hp / (a.unit.maxHp || hb.maxHp)));
        }

        // The focused unit gets the bright gizmo cone instead (view/fx.js).
        const cone = fovs[id];
        if (!cone) continue;
        cone.visible = alive && id !== state.focusId;
        if (!cone.visible) continue;
        const range = a.unit.attackRange || 9;
        cone.x = a.x; cone.y = 0.03; cone.z = a.z;
        cone.scaleX = range; cone.scaleZ = range;
        cone.rotationY = -aimYawOf(a);
    }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Draw one ReplayReader frame ({ agents: [{ id, x, z, hp, yaw, alive }] })
 * onto the unit nodes. `byId` supplies maxHp (the frame carries only hp).
 * Units missing from the frame are dead (the recorder omits them). FOV cones
 * have no recorded equivalent, so they hide during playback.
 */
export function renderReplayFrame(frame, byId) {
    const seen = {};
    for (const a of frame.agents) {
        seen[a.id] = true;
        const node = units[a.id];
        if (node) {
            node.visible = a.alive;
            if (a.alive) { node.x = a.x; node.y = UNIT_Y; node.z = a.z; node.rotationY = -a.yaw; }
        }
        const hb = hpBars[a.id];
        if (hb) {
            setHpBarVisible(hb, a.alive);
            const owner = byId[a.id];
            if (a.alive) setHpBar(hb, a.x, a.z, clamp01(a.hp / ((owner && owner.unit.maxHp) || hb.maxHp)));
        }
        if (fovs[a.id]) fovs[a.id].visible = false;
    }
    for (const id in units) {
        if (seen[id]) continue;
        units[id].visible = false;
        if (hpBars[id]) setHpBarVisible(hpBars[id], false);
        if (fovs[id]) fovs[id].visible = false;
    }
}

function ensureGhost(id, teamId) {
    if (ghosts[id]) return ghosts[id];
    const g = vp.scene.createMesh({
        mesh: "capsule", radius: CAPSULE_R, halfHeight: CAPSULE_HALF_H,
        color: [...TEAM_RGB[teamId], 0.32], emissive: 0.2,
        x: 0, y: UNIT_Y, z: 0, name: "fog-ghost-" + id,
    });
    g.visible = false;
    ghosts[id] = g;
    return g;
}

/**
 * Apply a team's fog-of-war view (after updateStage this frame). For each
 * tracked enemy: visible -> the real capsule stays; tracked but out of
 * sight -> hide the capsule and show a translucent ghost at the belief's
 * mean; never seen -> hide both. The viewing team's own units are untouched.
 */
export function applyFog(enemies, byId) {
    const tracked = {};
    for (const e of enemies) {
        tracked[e.enemyId] = true;
        const owner = byId[e.enemyId];
        const ghost = ghosts[e.enemyId];
        if (!(owner && owner.unit.alive) || e.visible) {
            if (ghost) ghost.visible = false;
            continue;
        }
        if (units[e.enemyId]) units[e.enemyId].visible = false;
        if (hpBars[e.enemyId]) setHpBarVisible(hpBars[e.enemyId], false);
        if (e.everSeen && e.meanX != null) {
            const g = ensureGhost(e.enemyId, owner.unit.teamId);
            g.visible = true;
            g.x = e.meanX; g.y = UNIT_Y; g.z = e.meanZ;
        } else if (ghost) {
            ghost.visible = false;
        }
    }
    for (const id in ghosts) if (!tracked[id]) ghosts[id].visible = false;
}

/** Fog off: hide the ghosts (updateStage re-asserts real visibility each frame). */
export function clearFog() {
    for (const id in ghosts) ghosts[id].visible = false;
}
