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
//            grabber, quatYTo, q } from "/lib/kit/physics3d.js";
//
//   const floor = addStatic(scene, { shape: 'box', halfExtents: { x: 10, y: 0.5, z: 10 },
//                                    position: { x: 0, y: -0.5, z: 0 } }, { color: '#333' });
//   const crates = new BodyGroup(scene);
//   crates.add({ shape: 'box', halfExtents: { x: .4, y: .4, z: .4 }, position: p }, { color: '#c93' });
//   const events = physicsEvents();
//   events.onContacts((list) => ...);
//   vp.onFrame(() => events.pump());
//
// Quaternions: Physics speaks {x,y,z,w} objects (the `q` helpers below), scene
// nodes take [x,y,z,w] arrays (`quatYTo`, `toArr`).

import { screenRay } from "./viewport3d.js";   // also loads lib/camera.js

const Camera = globalThis.Camera;

// --- quaternion / vector helpers ({x,y,z,w}) ----------------------------------

export const QI = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const q = {
    mul: (a, b) => ({
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    }),
    conj: (a) => ({ x: -a.x, y: -a.y, z: -a.z, w: a.w }),
    /** Rotation of `angle` radians about the unit axis (ax, ay, az). */
    axis: (ax, ay, az, angle) => {
        const s = Math.sin(angle / 2);
        return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
    },
    /** Rotate the {x,y,z} vector v by quaternion a. */
    rot: (a, v) => {
        const tx = 2 * (a.y * v.z - a.z * v.y);
        const ty = 2 * (a.z * v.x - a.x * v.z);
        const tz = 2 * (a.x * v.y - a.y * v.x);
        return {
            x: v.x + a.w * tx + (a.y * tz - a.z * ty),
            y: v.y + a.w * ty + (a.z * tx - a.x * tz),
            z: v.z + a.w * tz + (a.x * ty - a.y * tx),
        };
    },
    /** Shortest angle between two orientations, radians. */
    angle: (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))),
    /** Spherical interpolation, shortest arc. */
    slerp: (a, b, t) => {
        let c = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;
        if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        let ka = 1 - t, kb = t;
        if (c < 0.9995) {
            const th = Math.acos(c), s = Math.sin(th);
            ka = Math.sin((1 - t) * th) / s;
            kb = Math.sin(t * th) / s;
        }
        const x = a.x * ka + bx * kb, y = a.y * ka + by * kb, z = a.z * ka + bz * kb, w = a.w * ka + bw * kb;
        const L = Math.hypot(x, y, z, w) || 1;
        return { x: x / L, y: y / L, z: z / L, w: w / L };
    },
    /** Yaw (rotation about +Y) of an orientation, radians. */
    yaw: (a) => Math.atan2(2 * (a.w * a.y + a.x * a.z), 1 - 2 * (a.y * a.y + a.z * a.z)),
};

export const v3 = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
    len: (a) => Math.hypot(a.x, a.y, a.z),
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
};

/** {x,y,z,w} -> [x,y,z,w] for scene nodes. */
export const toArr = (a) => [a.x, a.y, a.z, a.w];

/** Shortest rotation taking +Y onto the direction (dx, dy, dz), as [x,y,z,w]. */
export function quatYTo(dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const x = dx / len, y = dy / len, z = dz / len;
    if (y > 0.999999) return [0, 0, 0, 1];
    if (y < -0.999999) return [1, 0, 0, 0];
    const ax = z, az = -x;                           // (0,1,0) x d
    const al = Math.hypot(ax, az) || 1;
    const half = Math.acos(y) / 2;
    const s = Math.sin(half);
    return [(ax / al) * s, 0, (az / al) * s, Math.cos(half)];
}

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
 * { o: {x,y,z}, d: {x,y,z} }. Computed in JS from the orbit camera (kit
 * screenRay) because SceneGraph.unprojectLocal has no working form for
 * setCamera-driven scenes (ENGINE-ISSUES.md); switch back here once it does.
 */
export function pickRay(vp, lx, ly) {
    const r = vp.canvas.getBoundingClientRect();
    const ray = screenRay(Camera.orbitViewOpts(vp.cam, vp.canvas), r.width, r.height, lx, ly);
    return { o: { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] }, d: { x: ray.dir[0], y: ray.dir[1], z: ray.dir[2] } };
}

/** Closest body along a ray: Physics.raycastClosest's hit plus the ray, or null. */
export function raycast(ray, maxDist) {
    if (!ray) return null;
    const hit = Physics.raycastClosest(ray.o.x, ray.o.y, ray.o.z, ray.d.x, ray.d.y, ray.d.z, maxDist || 500);
    return hit ? { ...hit, ray } : null;
}

/** Canvas-local pixel of a mouse event. */
export function localPoint(canvas, ev) {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
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
        ray = pickRay(vp, lx, ly);
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
