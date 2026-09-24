// view/fx.js — transient combat visuals and the focused-unit gizmos.
//
//   projectiles      pooled emissive spheres mirroring world.projectiles
//   explosions       an expanding sphere where a unit died
//   damage numbers   world-anchored HtmlNode billboards that rise and fade
//   focus gizmos     ring + attack-range ring + FOV wedge on the focused
//                    unit, a line to its target (when in LOS), and its
//                    intent label
//
// Everything is a scene node; there is no HTML overlay and no manual
// screen projection.
import { AI } from "/app/sim/ai.js";
import { Arena } from "/app/sim/arena.js";
import { fovMesh, aimYawOf } from "/app/view/stage.js";

const PROJ_COLORS = [[1.00, 0.45, 0.35, 1.0], [0.40, 0.75, 1.00, 1.0]];
const RING_LIFE = 0.5;
const FLOAT_LIFE = 1.0;
// HtmlNode content is its own little document: style inline.
const LABEL_CSS = "font-family:Consolas,monospace;font-weight:bold;text-align:center;" +
                  "text-shadow:0 0 3px #000,0 0 3px #000;";

let scene = null;
const rings = [];                 // { x, z, t, r }
const floats = [];                // { x, z, text, color, t }
const projPool = [[], []];        // per team
const explosionPool = [];
const dmgPool = [];
const giz = {};
let lastIntent = null;

export const fx = {
    rings: () => rings,
    floats: () => floats,
    gizmos: () => giz,
};

export function initFx(s) {
    scene = s;
    buildGizmos();
}

export function addExplosion(x, z, radius) {
    rings.push({ x, z, t: 0, r: radius });
}

export function addDamageNumber(x, z, amount, color) {
    floats.push({ x, z, text: String(amount | 0), color: color || "#ffd24a", t: 0 });
}

export function clearFx() {
    rings.length = 0;
    floats.length = 0;
}

/** Age the effects by dt and redraw them against the live match. */
export function updateFx(state, dt) {
    age(rings, dt, RING_LIFE);
    age(floats, dt, FLOAT_LIFE);
    syncProjectiles(state.world.projectiles);
    syncExplosions();
    syncDamageNumbers();
    syncGizmos(state);
}

/** Replay playback: nothing live to draw (the recorder keeps no projectiles). */
export function hideFx() {
    for (const pool of projPool) for (const n of pool) n.visible = false;
    for (const e of explosionPool) e.visible = false;
    for (const n of dmgPool) n.visible = false;
    hideGizmos();
}

function age(list, dt, life) {
    for (let i = list.length - 1; i >= 0; i--) {
        list[i].t += dt;
        if (list[i].t >= life) list.splice(i, 1);
    }
}

// ─── Projectiles ─────────────────────────────────────────────────────────
function syncProjectiles(projs) {
    const counts = [0, 0];
    for (const p of projs) {
        const team = p.teamId === 1 ? 1 : 0;
        const pool = projPool[team];
        if (pool.length <= counts[team]) {
            const n = scene.createMesh({
                mesh: "sphere", radius: 0.15, segments: 10, rings: 6,
                color: PROJ_COLORS[team], emissive: 0.8, name: "proj-" + team,
            });
            pool.push(n);
        }
        const node = pool[counts[team]++];
        node.visible = true;
        node.x = p.x; node.y = 1.1; node.z = p.z;
        const s = p.mode === "aoe" ? 2.5 : p.mode === "pierce" ? 1.6 : 1.0;
        node.scaleX = s; node.scaleY = s; node.scaleZ = s;
    }
    for (let t = 0; t < 2; t++) {
        for (let j = counts[t]; j < projPool[t].length; j++) projPool[t][j].visible = false;
    }
}

// ─── Explosions ──────────────────────────────────────────────────────────
function syncExplosions() {
    while (explosionPool.length < rings.length) {
        explosionPool.push(scene.createMesh({
            mesh: "sphere", radius: 0.5, segments: 14, rings: 8,
            color: [1.0, 0.55, 0.15, 0.6], emissive: 0.9, name: "explosion",
        }));
    }
    for (let i = 0; i < explosionPool.length; i++) {
        const node = explosionPool[i], ring = rings[i];
        node.visible = !!ring;
        if (!ring) continue;
        const scale = ring.r * (0.3 + Math.min(1, ring.t / RING_LIFE) * 2.5);
        node.x = ring.x; node.y = 1.0; node.z = ring.z;
        node.scaleX = scale; node.scaleY = scale; node.scaleZ = scale;
    }
}

// ─── Floating damage numbers ─────────────────────────────────────────────
function labelNode(width, name) {
    const node = scene.createHtmlNode({
        width, height: width === 120 ? 40 : 36, pxPerUnit: 90,
        billboard: "full", html: "<div></div>", name,
    });
    node.visible = false;
    return node;
}

function syncDamageNumbers() {
    while (dmgPool.length < floats.length) dmgPool.push(labelNode(120, "dmg-float"));
    for (let i = 0; i < dmgPool.length; i++) {
        const node = dmgPool[i], f = floats[i];
        node.visible = !!f;
        if (!f) continue;
        node.worldAnchor = [f.x, 1.8 + f.t * 1.2, f.z];   // rises over its life
        const opacity = Math.max(0, 1 - f.t / FLOAT_LIFE).toFixed(2);
        node.setHtml('<div style="' + LABEL_CSS + 'font-size:18px;color:' + f.color + ';opacity:' + opacity + '">' + f.text + "</div>");
    }
}

// ─── Focused-unit gizmos ─────────────────────────────────────────────────
function buildGizmos() {
    giz.focusRing = scene.createMesh({
        mesh: "torus", majorRadius: 0.7, minorRadius: 0.07, majorSegments: 28, minorSegments: 8,
        color: [1.0, 0.82, 0.29, 1.0], emissive: 0.9, name: "gizmo-focus",
    });
    giz.rangeRing = scene.createMesh({
        mesh: "torus", majorRadius: 1.0, minorRadius: 0.04, majorSegments: 48, minorSegments: 6,
        color: [1.0, 0.82, 0.29, 0.35], emissive: 0.2, name: "gizmo-range",
    });
    const wedge = fovMesh();
    giz.fovCone = scene.createMesh({
        positions: wedge.positions, indices: wedge.indices, normals: wedge.normals,
        color: [1.0, 0.82, 0.29, 0.28], emissive: 0.35, name: "gizmo-fov",
    });
    giz.targetLine = scene.createMesh({
        mesh: "box", halfW: 0.5, halfH: 0.04, halfD: 0.04,
        color: [0.30, 0.86, 0.47, 0.8], emissive: 0.6, name: "gizmo-target",
    });
    // Full billboard so the intent stays readable from any angle.
    giz.intentLabel = labelNode(180, "gizmo-intent");
    hideGizmos();
}

function hideGizmos() {
    for (const k in giz) giz[k].visible = false;
    lastIntent = null;
}

function placeOnGround(node, x, y, z, range) {
    node.visible = true;
    node.x = x; node.y = y; node.z = z;
    if (range != null) { node.scaleX = range; node.scaleZ = range; }
}

function syncGizmos(state) {
    const focus = state.byId[state.focusId];
    if (!focus || !focus.unit.alive) { hideGizmos(); return; }
    const mem = AI.memory[focus.unit.id];
    const range = focus.unit.attackRange || 9;

    placeOnGround(giz.focusRing, focus.x, 0.02, focus.z);
    placeOnGround(giz.rangeRing, focus.x, 0.02, focus.z, range);
    placeOnGround(giz.fovCone, focus.x, 0.04, focus.z, range);
    giz.fovCone.rotationY = -aimYawOf(focus);

    const tid = mem && mem.targetId;
    const tgt = tid != null ? state.byId[tid] : null;
    let showLine = false;
    if (tgt && tgt.unit.alive) {
        const dx = tgt.x - focus.x, dz = tgt.z - focus.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05 && bro.ai.game.hasLineOfSight(focus.x, focus.z, tgt.x, tgt.z, Arena.OBSTACLES)) {
            showLine = true;
            const line = giz.targetLine;
            line.x = (focus.x + tgt.x) / 2; line.y = 1.1; line.z = (focus.z + tgt.z) / 2;
            line.scaleX = d;
            line.rotationY = Math.atan2(-dz, dx);
        }
    }
    giz.targetLine.visible = showLine;

    // setHtml re-parses the label subtree, so only on a change of intent.
    const label = giz.intentLabel;
    if (mem && mem.intent) {
        label.visible = true;
        label.worldAnchor = [focus.x, 2.8, focus.z];
        if (lastIntent !== mem.intent) {
            label.setHtml('<div style="' + LABEL_CSS + 'font-size:14px;color:#ffd24a">' + mem.intent + "</div>");
            lastIntent = mem.intent;
        }
    } else {
        label.visible = false;
        lastIntent = null;
    }
}
