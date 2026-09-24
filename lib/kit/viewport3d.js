// lib/kit/viewport3d.js — a bro.scene canvas with the standard orbit camera.
//
// The orbit-camera mouse handling below was copied verbatim into a dozen 3D
// demos; this is that block, once. Conventions (unchanged from those apps):
// right-drag orbits, middle-drag pans (both pointer-locked while held),
// wheel zooms; left button is left free for the app's own picking.
//
//   import { sceneViewport } from "/lib/kit/viewport3d.js";
//   const vp = sceneViewport('#stage', { orbit: { target: [0, 1, 0], dist: 10 } });
//   vp.scene.createMesh({ mesh: 'sphere', radius: 0.5 });
//   vp.onFrame((dt, t) => { /* animate */ });
//
// Uses lib/camera.js (global Camera) for the camera math.

import "../camera.js";

const Camera = globalThis.Camera || window.Camera;

/**
 * Wire orbit/pan/zoom mouse input on `canvas` to an orbit camera `cam`
 * (from Camera.createOrbit). opts:
 *   minDist = 0.1, maxDist = Infinity   wheel zoom clamp
 *   zoomRate = 0.001                    dist *= exp(deltaY * zoomRate)
 *   orbitButton = 2, panButton = 1      mouse buttons (-1 disables)
 *   pointerLock = true                  lock the pointer while dragging
 *   onChange()                          after any camera move
 *   accept(e)                           false leaves that mousedown to the app
 *                                       (e.g. right-click finishes a polyline)
 * Returns { dispose(), dragging }.
 */
export function orbitControls(canvas, cam, opts) {
    const o = Object.assign({
        minDist: 0.1, maxDist: Infinity, zoomRate: 0.001,
        orbitButton: 2, panButton: 1, pointerLock: true, onChange: null, accept: null,
    }, opts);
    let orbiting = false, panning = false;
    const changed = () => { if (o.onChange) o.onChange(); };

    const syncLock = () => {
        if (!o.pointerLock) return;
        const want = orbiting || panning;
        const locked = document.pointerLockElement === canvas;
        if (want && !locked) canvas.requestPointerLock();
        else if (!want && locked) document.exitPointerLock();
    };
    const onDown = (e) => {
        if (o.accept && !o.accept(e)) return;
        if (e.button === o.orbitButton) orbiting = true;
        else if (e.button === o.panButton) panning = true;
        else return;
        e.preventDefault();
        syncLock();
    };
    const onUp = (e) => {
        if (e.button === o.orbitButton) orbiting = false;
        if (e.button === o.panButton) panning = false;
        syncLock();
    };
    const onMove = (e) => {
        if (orbiting) { Camera.orbitLook(cam, e.movementX, e.movementY); changed(); }
        if (panning)  { Camera.orbitPan(cam, e.movementX, e.movementY); changed(); }
    };
    const onWheel = (e) => {
        cam.dist = Math.min(o.maxDist, Math.max(o.minDist, cam.dist * Math.exp(e.deltaY * o.zoomRate)));
        e.preventDefault();
        changed();
    };
    const noMenu = (e) => e.preventDefault();
    const noAux = (e) => { if (e.button === 1) e.preventDefault(); };

    canvas.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMove);
    canvas.addEventListener('wheel', onWheel);
    canvas.addEventListener('contextmenu', noMenu);
    canvas.addEventListener('auxclick', noAux);
    return {
        get dragging() { return orbiting || panning; },
        dispose() {
            canvas.removeEventListener('mousedown', onDown);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('contextmenu', noMenu);
            canvas.removeEventListener('auxclick', noAux);
            orbiting = panning = false;
            syncLock();
        },
    };
}

/**
 * A scene canvas with an orbit camera, input and a frame loop that pushes
 * the camera every frame. opts:
 *   orbit     Camera.createOrbit options ({ target, dist, fov, near, far, ... })
 *   controls  orbitControls options, or false for no mouse input
 * Returns { canvas, scene, cam, controls, onFrame(fn), onView(fn),
 *           reframe(target, dist, { yaw, pitch }?), ray(px, py) }.
 * onFrame callbacks get (dt seconds, t seconds) before the camera is pushed.
 */
export function sceneViewport(target, opts) {
    const o = opts || {};
    const canvas = typeof target === 'string' ? document.querySelector(target) : target;
    if (!canvas) throw new Error('kit: sceneViewport canvas missing: ' + target);
    const scene = canvas.getContext('scene');
    const cam = Camera.createOrbit(o.orbit || {});
    const controls = o.controls === false ? null : orbitControls(canvas, cam, o.controls);
    const hooks = [], viewHooks = [];
    const push = () => {
        const view = Camera.orbitViewOpts(cam, canvas);
        for (const fn of viewHooks) fn(view);
        scene.setCamera(view);
    };
    let last = performance.now(), t = 0;
    const frame = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now; t += dt;
        for (const fn of hooks) fn(dt, t);
        push();
        requestAnimationFrame(frame);
    };
    push();
    requestAnimationFrame(frame);
    return {
        canvas, scene, cam, controls,
        onFrame(fn) { hooks.push(fn); return fn; },
        /** fn(view) may adjust the scene.setCamera options (e.g. camera shake) before each push. */
        onView(fn) { viewHooks.push(fn); return fn; },
        /** Re-centre on `pivot`; `angles` { yaw, pitch } (radians) also sets the view direction. */
        reframe(pivot, dist, angles) {
            if (angles) cam.rot = orbitRotation(angles.yaw || 0, angles.pitch || 0);
            Camera.orbitReframe(cam, pivot, dist != null ? dist : cam.dist);
        },
        /**
         * World-space pick ray through canvas-local CSS pixel (px, py) of the
         * current view: { origin: [x,y,z], dir: unit [x,y,z] } (screenRay).
         */
        ray(px, py) {
            const r = canvas.getBoundingClientRect();
            return screenRay(Camera.orbitViewOpts(cam, canvas), r.width, r.height, px, py);
        },
    };
}

/**
 * Orbit orientation from yaw (about +Y) then pitch (about the camera's X),
 * radians; negative pitch looks down. Pass as `orbit.rot` to sceneViewport.
 */
export function orbitRotation(yaw, pitch) {
    return Camera.quatMul(Camera.quatFromAxis(0, 1, 0, yaw), Camera.quatFromAxis(1, 0, 0, pitch));
}

// --- picking math -------------------------------------------------------------
//
// Both take the scene.setCamera options shape ({ position, target, up, fov },
// e.g. Camera.orbitViewOpts(cam, canvas)) plus the canvas size in CSS pixels.
// Aspect comes from that size, as the engine derives it from the canvas, so
// screenRay and worldToScreen round-trip. An orthographic view
// ({ mode: 'orthographic', size, ... }; size = view height in world units)
// gives parallel rays from the view plane; its `aspect` is honoured when set.

function isOrtho(view) {
    return view.mode === 'orthographic' || view.mode === 'ortho';
}

// Half extents of an orthographic view: [halfWidth, halfHeight].
function orthoHalf(view, width, height) {
    const halfH = (view.size || 10) / 2;
    const aspect = view.aspect || width / Math.max(1, height);
    return [halfH * aspect, halfH];
}

function viewBasis(view) {
    const p = view.position, t = view.target, up = view.up || [0, 1, 0];
    let fx = t[0] - p[0], fy = t[1] - p[1], fz = t[2] - p[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fy * up[2] - fz * up[1], ry = fz * up[0] - fx * up[2], rz = fx * up[1] - fy * up[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    return {
        f: [fx, fy, fz], r: [rx, ry, rz],
        u: [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx],
        tanHalf: Math.tan((view.fov || 45) * Math.PI / 360),
    };
}

/**
 * World-space pick ray through canvas pixel (px, py).
 * Returns { origin: [x,y,z], dir: unit [x,y,z] }.
 */
export function screenRay(view, width, height, px, py) {
    const b = viewBasis(view);
    if (isOrtho(view)) {
        const [hw, hh] = orthoHalf(view, width, height);
        const ox = ((2 * px / width) - 1) * hw, oy = (1 - (2 * py / height)) * hh;
        const p = view.position;
        return {
            origin: [0, 1, 2].map((i) => p[i] + ox * b.r[i] + oy * b.u[i]),
            dir: b.f.slice(),
        };
    }
    const aspect = width / Math.max(1, height);
    const sx = ((2 * px / width) - 1) * aspect * b.tanHalf;
    const sy = (1 - (2 * py / height)) * b.tanHalf;
    let dx = b.f[0] + sx * b.r[0] + sy * b.u[0];
    let dy = b.f[1] + sx * b.r[1] + sy * b.u[1];
    let dz = b.f[2] + sx * b.r[2] + sy * b.u[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    return { origin: view.position.slice(0, 3), dir: [dx / dl, dy / dl, dz / dl] };
}

/**
 * Project a world point to canvas pixels.
 * Returns { x, y, depth, behind } (behind: at or behind the camera plane).
 */
export function worldToScreen(world, view, width, height) {
    const b = viewBasis(view), p = view.position;
    const vx = world[0] - p[0], vy = world[1] - p[1], vz = world[2] - p[2];
    const zc = vx * b.f[0] + vy * b.f[1] + vz * b.f[2];
    if (zc <= 1e-6) return { x: 0, y: 0, depth: zc, behind: true };
    const xc = vx * b.r[0] + vy * b.r[1] + vz * b.r[2];
    const yc = vx * b.u[0] + vy * b.u[1] + vz * b.u[2];
    if (isOrtho(view)) {
        const [hw, hh] = orthoHalf(view, width, height);
        return { x: (xc / hw + 1) * 0.5 * width, y: (1 - yc / hh) * 0.5 * height, depth: zc, behind: false };
    }
    const aspect = width / Math.max(1, height);
    const nx = (xc / zc) / (aspect * b.tanHalf), ny = (yc / zc) / b.tanHalf;
    return { x: (nx + 1) * 0.5 * width, y: (1 - ny) * 0.5 * height, depth: zc, behind: false };
}
