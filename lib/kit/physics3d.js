// lib/kit/physics3d.js — plumbing for 3D physics demos (global `Physics` +
// a bro.scene graph).
//
// Every Jolt demo was re-pasting the same handful of things: a body and a
// mesh built from two copies of the same dimensions, a PhysicsNode to tie them
// together, a registry so "clear" can find them again, a thin cylinder posed
// between two points because the scene has no line primitive, a mouse ray,
// and a once-per-frame drain of the contact / broken-constraint streams.
//
//   import { addBody, addStatic, BodyGroup, rod, pickRay, physicsEvents,
//            grabber } from "/lib/kit/physics3d.js";
//
//   const floor = addStatic(scene, { shape: 'box', halfExtents: { x: 10, y: 0.5, z: 10 },
//                                    position: { x: 0, y: -0.5, z: 0 } }, { color: '#333' });
//   const crates = new BodyGroup(scene);
//   crates.add({ shape: 'box', halfExtents: { x: .4, y: .4, z: .4 }, position: p }, { color: '#c93' });
//   const events = physicsEvents();
//   events.onContacts((list) => ...);
//   vp.onFrame(() => events.pump());
//
// Quaternion / vector math ({x,y,z,w} for Physics, arrays for nodes) is
// math3d.js.

import { localPoint } from "./viewport3d.js";
import { v3, toArr, quatYTo } from "./math3d.js";

// --- meshes matching body shapes ------------------------------------------------

function lookOpts(look) {
    const l = look || {};
    const o = { color: l.color || '#b0bec5', roughness: l.roughness ?? 0.6 };
    if (l.metallic != null) o.metallic = l.metallic;
    if (l.emissive) { o.emissive = l.emissive; o.emissiveColor = l.emissiveColor || l.color; }
    if (l.twoSided) o.twoSided = true;
    return o;
}

/**
 * A mesh with the same geometry as a createBody shape spec: box, sphere,
 * capsule, cylinder, compound (a node holding one mesh per part, placed at the
 * parts' localPosition / localRotation). look: { color, roughness, metallic,
 * emissive, emissiveColor, twoSided, segments }. Unpositioned; the caller
 * parents it or places it.
 */
export function shapeMesh(scene, shape, look) {
    const o = lookOpts(look);
    const seg = (look && look.segments) || 0;
    switch (shape.shape) {
        case 'box': {
            const e = shape.halfExtents;
            return scene.createMesh({ mesh: 'box', halfW: e.x, halfH: e.y, halfD: e.z, ...o });
        }
        case 'sphere':
            return scene.createMesh({ mesh: 'sphere', radius: shape.radius, segments: seg || 22, rings: Math.round((seg || 22) * 0.7), ...o });
        case 'capsule':
            return scene.createMesh({ mesh: 'capsule', radius: shape.radius, halfHeight: shape.halfHeight, segments: seg || 16, ...o });
        case 'cylinder':
            return scene.createMesh({ mesh: 'cylinder', radius: shape.radius, halfHeight: shape.halfHeight, segments: seg || 20, ...o });
        case 'compound': {
            const root = scene.createNode('compound');
            for (const p of shape.parts) {
                const m = shapeMesh(scene, p, look);
                const lp = p.localPosition;
                if (lp) { m.x = lp.x; m.y = lp.y; m.z = lp.z; }
                if (p.localRotation) m.quaternion = toArr(p.localRotation);
                root.add(m);
            }
            return root;
        }
        default:
            throw new Error('physics3d: no mesh for shape ' + shape.shape);
    }
}

/**
 * A dynamic (or kinematic) body with a PhysicsNode carrying its visual.
 * `look.mesh(scene)` overrides the generated mesh (torus, decorated gears).
 * `look.velocity` {x,y,z} sets an initial linear velocity.
 * Returns { tag, node }.
 */
export function addBody(scene, body, look) {
    const tag = Physics.createBody(body);
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    node.add(look && look.mesh ? look.mesh(scene) : shapeMesh(scene, body, look));
    const v = look && look.velocity;
    if (v) Physics.setLinearVelocity(tag, v.x, v.y, v.z);
    return { tag, node };
}

/**
 * A static body plus a mesh at the same fixed transform. Nothing syncs a
 * static visual, so it is a plain mesh rather than a PhysicsNode.
 * Returns { tag, mesh }.
 */
export function addStatic(scene, body, look) {
    const tag = Physics.createBody({ ...body, static: true });
    const mesh = look && look.mesh ? look.mesh(scene) : shapeMesh(scene, body, look);
    const p = body.position || { x: 0, y: 0, z: 0 };
    mesh.x = p.x; mesh.y = p.y; mesh.z = p.z;
    if (body.rotation) mesh.quaternion = toArr(body.rotation);
    return { tag, mesh };
}

/** Destroy an addBody / addStatic result: visual first, then the body. */
export function removeBody(e) {
    if (!e) return;
    // Node first: once the body is gone the node's bound BodyID dangles.
    if (e.node && e.node.destroy) e.node.destroy();
    if (e.mesh && e.mesh.destroy) e.mesh.destroy();
    Physics.destroyBody(e.tag);
}

/**
 * A registry of bodies that live and die together (spawned objects, debris,
 * projectiles). Entries are addBody results plus whatever `extra` fields the
 * caller attaches. `scene` may be a function returning the scene, so a module
 * can declare its group before the scene exists.
 */
export class BodyGroup {
    constructor(scene) { this.scene = scene; this.map = new Map(); }
    add(body, look, extra) {
        const sc = typeof this.scene === 'function' ? this.scene() : this.scene;
        const e = { ...addBody(sc, body, look), ...(extra || {}) };
        this.map.set(e.tag, e);
        return e;
    }
    get(tag) { return this.map.get(tag); }
    has(tag) { return this.map.has(tag); }
    get size() { return this.map.size; }
    values() { return this.map.values(); }
    remove(tag) {
        const e = this.map.get(tag);
        if (!e) return false;
        removeBody(e);
        this.map.delete(tag);
        return true;
    }
    clear() { for (const tag of [...this.map.keys()]) this.remove(tag); }
}

// --- line segments ---------------------------------------------------------------

/**
 * A thin cylinder re-posed between two world points: cables, ropes, springs,
 * contact normals. opts: { radius = 0.035, emissive = 0, roughness = 0.7 }.
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

// --- the event streams -------------------------------------------------------------

/**
 * Physics.getContacts() and Physics.getBrokenConstraints() DRAIN on read:
 * whatever one reader gets, nobody else sees. So exactly one owner drains them
 * once a frame and fans the arrays out. Handlers get the frame's array.
 * Returns { onContacts(fn), onBroken(fn), off(fn), pump() }.
 */
export function physicsEvents() {
    const contacts = new Set(), broken = new Set();
    return {
        onContacts(fn) { contacts.add(fn); return fn; },
        onBroken(fn) { broken.add(fn); return fn; },
        off(fn) { contacts.delete(fn); broken.delete(fn); },
        pump() {
            const b = Physics.getBrokenConstraints() || [];
            for (const fn of broken) fn(b);
            const c = Physics.getContacts() || [];
            for (const fn of contacts) fn(c);
        },
    };
}

// --- picking + dragging --------------------------------------------------------------

/**
 * World-space ray under a canvas-local pixel of a sceneViewport `vp`:
 * { o: {x,y,z}, d: {x,y,z} }, or null before the canvas has a size
 * (scene.unprojectLocal).
 */
export function pickRay(vp, lx, ly) {
    const ray = vp.scene.unprojectLocal(lx, ly);
    if (!ray) return null;
    return { o: { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] }, d: { x: ray.dir[0], y: ray.dir[1], z: ray.dir[2] } };
}

/** Closest body along a ray: Physics.raycastClosest's hit plus the ray, or null. */
export function raycast(ray, maxDist) {
    if (!ray) return null;
    const hit = Physics.raycastClosest(ray.o.x, ray.o.y, ray.o.z, ray.d.x, ray.d.y, ray.d.z, maxDist || 500);
    return hit ? { ...hit, ray } : null;
}

/**
 * Drag bodies with the mouse. A grabbed body is pulled toward the point under
 * the cursor at its grab distance by a mass-scaled spring-damper impulse, so a
 * crate and a wrecking ball feel the same to drag and both still collide on
 * the way. The app decides WHAT to grab (it calls begin(hit) from its own
 * mousedown); the grabber tracks the cursor and lets go on mouseup.
 *
 * opts: { stiffness = 120, damping = 14, maxDist = 500, rodColor = '#7bed9f',
 *         onRelease(tag) }.
 * Returns { begin(hit), end(), update(dt), setRay(ray), grabbed, dispose() }.
 * Call update(dt) once a frame (sceneViewport's onFrame).
 */
export function grabber(vp, opts) {
    const o = Object.assign({ stiffness: 120, damping: 14, rodColor: '#7bed9f', onRelease: null }, opts);
    const line = rod(vp.scene, o.rodColor, { radius: 0.02, emissive: 1.5 });
    line.visible = false;
    let g = null, ray = null;

    const onMove = (ev) => {
        if (!g) return;
        const [lx, ly] = localPoint(vp.canvas, ev);
        ray = pickRay(vp, lx, ly) || ray;
    };
    const onUp = (ev) => { if (g && ev.button === 0) api.end(); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    const api = {
        get grabbed() { return g ? g.tag : null; },
        /** Start dragging hit.bodyId; `hit.ray` / `hit.position` fix the grab distance. */
        begin(hit) {
            const t = Physics.getTransform(hit.bodyId);
            if (!t) return false;
            const props = Physics.getBodyProperties(hit.bodyId);
            ray = hit.ray;
            const p = hit.position;
            g = {
                tag: hit.bodyId,
                mass: Math.max(0.1, props ? props.mass : 1),
                dist: v3.dist(ray.o, p),
                // Where on the body it was grabbed, relative to the centre (world
                // frame at grab time; a dragged body mostly hangs from that point).
                off: v3.sub(p, t.position),
            };
            Physics.activate(g.tag);
            return true;
        },
        end() {
            if (!g) return;
            const tag = g.tag;
            g = null;
            line.visible = false;
            if (o.onRelease) o.onRelease(tag);
        },
        /** Replace the cursor ray (tests drive the grabber without a mouse). */
        setRay(r) { ray = r; },
        update(dt) {
            if (!g || !ray) return;
            const t = Physics.getTransform(g.tag);
            if (!t) { api.end(); return; }
            const target = v3.add(ray.o, v3.scale(ray.d, g.dist));
            const at = v3.add(t.position, g.off);
            const v = Physics.getVelocity(g.tag).linear;
            const k = o.stiffness * g.mass * dt, c = o.damping * g.mass * dt;
            Physics.addImpulse(g.tag,
                (target.x - at.x) * k - v.x * c,
                (target.y - at.y) * k - v.y * c + 9.81 * g.mass * dt,   // carry its weight
                (target.z - at.z) * k - v.z * c);
            Physics.activate(g.tag);
            line.set(at, target);
        },
        dispose() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            line.destroy();
        },
    };
    return api;
}
