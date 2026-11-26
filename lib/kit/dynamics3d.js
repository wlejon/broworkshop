// lib/kit/dynamics3d.js — a bro.dynamics world in a bro.scene.
//
// The pieces every 3D app with bodies repeats: a mesh with the dimensions of a
// body's shape, a fixed body drawn where it stands, the nodes of moving bodies
// kept on their bodies, a thin cylinder posed between two points because the
// scene has no line primitive, and a ray under the mouse.
//
//   import { addStatic, addBody, applyMoved, rod, pickRay, raycast } from "/lib/kit/dynamics3d.js";
//
//   const world = bro.dynamics.createWorld();
//   addStatic(world, scene, { shape: 'box', half: [10, 0.5, 10], position: [0, -0.5, 0] }, { color: '#333' });
//   const nodes = new Map();
//   const crate = addBody(world, scene, { shape: 'box', half: [.4, .4, .4], position: [0, 3, 0], mass: 20 }, { color: '#c93' });
//   nodes.set(crate.body, crate.node);
//   vp.onFrame((dt) => { world.step(dt); applyMoved(world, nodes); });
//
// A body spec is what World.addBox / addSphere / addCapsule / addCylinder take
// (docs/dynamics-api.js), plus `shape` naming which. Vectors are arrays.

import { quatYTo } from "./math3d.js";

function lookOpts(look) {
    const l = look || {};
    const o = { color: l.color || '#b0bec5', roughness: l.roughness ?? 0.6 };
    if (l.metallic != null) o.metallic = l.metallic;
    if (l.emissive) { o.emissive = l.emissive; o.emissiveColor = l.emissiveColor || l.color; }
    if (l.twoSided) o.twoSided = true;
    return o;
}

/**
 * A mesh with the geometry of a body spec: box, sphere, capsule, cylinder.
 * look: { color, roughness, metallic, emissive, emissiveColor, twoSided,
 * segments }. Unpositioned.
 */
export function shapeMesh(scene, spec, look) {
    const o = lookOpts(look);
    const seg = (look && look.segments) || 0;
    switch (spec.shape) {
        case 'box':
            return scene.createMesh({ mesh: 'box', halfW: spec.half[0], halfH: spec.half[1], halfD: spec.half[2], ...o });
        case 'sphere':
            return scene.createMesh({ mesh: 'sphere', radius: spec.radius, segments: seg || 22, rings: Math.round((seg || 22) * 0.7), ...o });
        case 'capsule':
            return scene.createMesh({ mesh: 'capsule', radius: spec.radius, halfHeight: spec.halfHeight, segments: seg || 16, ...o });
        case 'cylinder':
            return scene.createMesh({ mesh: 'cylinder', radius: spec.radius, halfHeight: spec.halfHeight, segments: seg || 20, ...o });
        default:
            throw new Error('dynamics3d: no mesh for shape ' + spec.shape);
    }
}

const ADD = { box: 'addBox', sphere: 'addSphere', capsule: 'addCapsule', cylinder: 'addCylinder' };

/** The body of a spec in `world`. */
export function createBody(world, spec) {
    const add = ADD[spec.shape];
    if (!add) throw new Error('dynamics3d: no body for shape ' + spec.shape);
    return world[add](spec);
}

function place(node, position, rotation) {
    const p = position || [0, 0, 0];
    node.x = p[0]; node.y = p[1]; node.z = p[2];
    if (rotation) node.quaternion = [rotation[0], rotation[1], rotation[2], rotation[3]];
}

/**
 * A fixed body and a mesh where it stands. `look.mesh(scene)` overrides the
 * generated mesh. Returns { body, mesh }.
 */
export function addStatic(world, scene, spec, look) {
    const body = createBody(world, { ...spec, mass: 0 });
    const mesh = look && look.mesh ? look.mesh(scene) : shapeMesh(scene, spec, look);
    place(mesh, spec.position, spec.rotation);
    return { body, mesh };
}

/**
 * A moving body and its mesh, placed at the body's start. Keep `node` on the
 * body with applyMoved. Returns { body, node }.
 */
export function addBody(world, scene, spec, look) {
    const body = createBody(world, spec);
    const node = look && look.mesh ? look.mesh(scene) : shapeMesh(scene, spec, look);
    place(node, spec.position, spec.rotation);
    return { body, node };
}

/**
 * Put the nodes of the bodies the last step moved where their bodies are.
 * `nodes` is a Map from body to scene node. Call once after each step: a body
 * at rest is not listed, and its node is already there.
 */
export function applyMoved(world, nodes) {
    const m = world.moved();
    for (let i = 0; i < m.length; i += 9) {
        const node = nodes.get(m[i]);
        if (!node) continue;
        node.x = m[i + 1]; node.y = m[i + 2]; node.z = m[i + 3];
        node.quaternion = [m[i + 4], m[i + 5], m[i + 6], m[i + 7]];
    }
}

// --- line segments ---------------------------------------------------------------

/**
 * A thin cylinder re-posed between two world points ({x, y, z}): cables,
 * normals, tethers. opts: { radius = 0.035, emissive = 0, roughness = 0.7 }.
 * Returns { mesh, set(a, b), visible, destroy() }.
 */
export function rod(scene, color, opts) {
    const o = opts || {};
    const mesh = scene.createMesh({
        mesh: 'cylinder', radius: o.radius || 0.035, halfHeight: 0.5, segments: o.segments || 8,
        color, roughness: o.roughness ?? 0.7,
        ...(o.emissive ? { emissive: o.emissive, emissiveColor: color } : {}),
    });
    return {
        mesh,
        /** Span a..b. Scaling only Y keeps the cross-section constant. */
        set(a, b) {
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            mesh.x = (a.x + b.x) / 2; mesh.y = (a.y + b.y) / 2; mesh.z = (a.z + b.z) / 2;
            mesh.quaternion = quatYTo(dx, dy, dz);
            mesh.scaleY = Math.max(1e-3, Math.hypot(dx, dy, dz));
            mesh.visible = true;
        },
        set visible(on) { mesh.visible = !!on; },
        get visible() { return mesh.visible; },
        destroy() { mesh.destroy(); },
    };
}

// --- structures ------------------------------------------------------------------

/**
 * A World.addStructure structure drawn as one instanced box per cell: where
 * it was built while it stands, on its loose body once it has come away, and
 * not at all once dropped.
 *
 * opts: { color(member, cell) -> [r, g, b] (0..1), roughness = 0.85,
 * metallic = 0 }. Returns { node, update(), destroy() }; call update() after
 * each world.step.
 */
export function structureView(scene, structure, opts) {
    const o = opts || {};
    const cells = structure.cells, n = cells.length / 12;
    const rows = new Float32Array(n * 16);
    const half = new Float32Array(n * 3);
    const place = (i, x, y, z, qx, qy, qz, qw) => {
        const r = i * 16, sx = 2 * half[i * 3], sy = 2 * half[i * 3 + 1], sz = 2 * half[i * 3 + 2];
        const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz;
        const wx = qw * qx, wy = qw * qy, wz = qw * qz;
        rows[r] = (1 - 2 * (yy + zz)) * sx; rows[r + 1] = 2 * (xy - wz) * sy; rows[r + 2] = 2 * (xz + wy) * sz; rows[r + 3] = x;
        rows[r + 4] = 2 * (xy + wz) * sx; rows[r + 5] = (1 - 2 * (xx + zz)) * sy; rows[r + 6] = 2 * (yz - wx) * sz; rows[r + 7] = y;
        rows[r + 8] = 2 * (xz - wy) * sx; rows[r + 9] = 2 * (yz + wx) * sy; rows[r + 10] = (1 - 2 * (xx + yy)) * sz; rows[r + 11] = z;
    };
    for (let i = 0; i < n; i++) {
        const c = i * 12;
        half[i * 3] = cells[c + 8]; half[i * 3 + 1] = cells[c + 9]; half[i * 3 + 2] = cells[c + 10];
        place(i, cells[c + 1], cells[c + 2], cells[c + 3], cells[c + 4], cells[c + 5], cells[c + 6], cells[c + 7]);
        const tint = o.color ? o.color(cells[c], i) : [0.72, 0.72, 0.7];
        rows[i * 16 + 12] = tint[0]; rows[i * 16 + 13] = tint[1]; rows[i * 16 + 14] = tint[2]; rows[i * 16 + 15] = 1;
    }
    const node = scene.createInstancedMesh({
        mesh: bro.mesh.Mesh.box(0.5, 0.5, 0.5), roughness: o.roughness ?? 0.85, metallic: o.metallic ?? 0, castsShadow: true,
    });
    node.setInstances(rows);
    return {
        node,
        /** The cells the last step moved, onto their bodies. */
        update() {
            const m = structure.moved(), gone = structure.crushed();
            if (!m.length && !gone.length) return 0;
            for (let i = 0; i < m.length; i += 8) place(m[i], m[i + 1], m[i + 2], m[i + 3], m[i + 4], m[i + 5], m[i + 6], m[i + 7]);
            for (let i = 0; i < gone.length; i++) {
                const r = gone[i] * 16;
                rows[r] = rows[r + 1] = rows[r + 2] = rows[r + 4] = rows[r + 5] = rows[r + 6] = rows[r + 8] = rows[r + 9] = rows[r + 10] = 0;
            }
            node.setInstances(rows);
            return m.length / 8;
        },
        /** Stop drawing cells (after structure.drop of their body). */
        hide(list) {
            for (const i of list) { const r = i * 16; rows[r] = rows[r + 5] = rows[r + 10] = 0; rows[r + 1] = rows[r + 2] = rows[r + 4] = rows[r + 6] = rows[r + 8] = rows[r + 9] = 0; }
            node.setInstances(rows);
        },
        destroy() { node.destroy(); },
    };
}

// --- picking ---------------------------------------------------------------------

/**
 * World-space ray under a canvas-local pixel of a sceneViewport `vp`:
 * { origin: [x, y, z], dir: [x, y, z] }, or null before the canvas has a size.
 */
export function pickRay(vp, lx, ly) {
    const ray = vp.scene.unprojectLocal(lx, ly);
    if (!ray) return null;
    return { origin: [ray.origin[0], ray.origin[1], ray.origin[2]], dir: [ray.dir[0], ray.dir[1], ray.dir[2]] };
}

/** The nearest body of `world` along a pickRay: World.raycast's hit plus the ray, or null. */
export function raycast(world, ray, maxDist, mask) {
    if (!ray) return null;
    const hit = world.raycast(ray.origin, ray.dir, maxDist || 500, mask);
    return hit ? { ...hit, ray } : null;
}
