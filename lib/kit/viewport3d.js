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
 * Returns { dispose(), dragging }.
 */
export function orbitControls(canvas, cam, opts) {
    const o = Object.assign({
        minDist: 0.1, maxDist: Infinity, zoomRate: 0.001,
        orbitButton: 2, panButton: 1, pointerLock: true, onChange: null,
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
 * Returns { canvas, scene, cam, controls, onFrame(fn), reframe(target, dist) }.
 * onFrame callbacks get (dt seconds, t seconds) before the camera is pushed.
 */
export function sceneViewport(target, opts) {
    const o = opts || {};
    const canvas = typeof target === 'string' ? document.querySelector(target) : target;
    if (!canvas) throw new Error('kit: sceneViewport canvas missing: ' + target);
    const scene = canvas.getContext('scene');
    const cam = Camera.createOrbit(o.orbit || {});
    const controls = o.controls === false ? null : orbitControls(canvas, cam, o.controls);
    const hooks = [];
    let last = performance.now(), t = 0;
    const frame = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now; t += dt;
        for (const fn of hooks) fn(dt, t);
        scene.setCamera(Camera.orbitViewOpts(cam, canvas));
        requestAnimationFrame(frame);
    };
    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    requestAnimationFrame(frame);
    return {
        canvas, scene, cam, controls,
        onFrame(fn) { hooks.push(fn); return fn; },
        reframe(pivot, dist) { Camera.orbitReframe(cam, pivot, dist != null ? dist : cam.dist); },
    };
}
