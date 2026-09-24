// Arcade 3D plumbing — boot a bro.scene game through the shell, and the
// stage (scene + orbit camera + screen picking) its game.js builds on.
//
// The shell's loop clears a 2D view every frame, so a scene game boots it on
// a hidden 2D canvas and keeps #view for getContext("scene"):
//
//   // main.js
//   import { bootScene } from "/lib/arcade/scene3d.js";
//   import { game } from "/app/game.js";
//   bootScene(game);
//
//   // game.js — build the stage lazily inside create(), not at import time
//   stage = stage || createStage({ orbit: { target: [0, 3, 0], dist: 12, fov: 50 } });
//   stage.onTap((p) => place(stage.planeHit(stage.rayAt(p.clientX, p.clientY), 0)));
//   stage.onTap((p) => remove(stage.pick(p.clientX, p.clientY)), { button: 2 });
//   draw() { stage.applyCamera(); }
//
// Camera input is lib/kit's orbitControls: right-drag orbits, middle-drag
// pans, wheel zooms, left button stays free for the game.
//
// Board games with a fixed isometric view (farm, hearthfolk) pass `iso`
// instead of `orbit`: an orthographic camera at a fixed offset from a
// movable target, zoomed by a factor on its view height:
//
//   stage = createStage({ iso: { target: [20, 0, 14], offset: [16, 18, 16], size: 24,
//                                wheel: { step: 0.06, min: 0.3, max: 1.4 } } });
//   stage.iso.target[0] += 1; stage.applyCamera();   // pan
//   const p = stage.toScreen(x, y, z);                // world → client px

import { boot } from "/lib/arcade/shell.js";
import { orbitControls } from "/lib/kit/viewport3d.js";
import { Camera } from "/lib/kit/camera.js";

/**
 * boot() with a hidden 2D shell canvas, leaving #view to the scene.
 * opts: width = 1280, height = 800, plus anything boot() takes.
 * Returns the shell handle from boot().
 */
export function bootScene(game, opts) {
    const o = Object.assign({ width: 1280, height: 800 }, opts);
    const shellCanvas = document.createElement("canvas");
    shellCanvas.width = o.width;
    shellCanvas.height = o.height;
    shellCanvas.style.display = "none";
    document.body.appendChild(shellCanvas);
    return boot(game, Object.assign({}, o, { canvas: shellCanvas }));
}

/**
 * A scene canvas with an orbit (or fixed isometric) camera and screen-space
 * picking. opts:
 *   canvas = "#view"   selector or element
 *   orbit              Camera.createOrbit options ({ target, dist, fov, near, far })
 *   controls           orbitControls options ({ minDist, maxDist, ... }), or false
 *   iso                orthographic camera instead of the orbit:
 *                      { target = [0,0,0], offset = [16,18,16], size = 20,
 *                        zoom = 1, near = 0.1, far = 400,
 *                        wheel: { step, min, max } for wheel zoom (optional) }
 * Returns { canvas, scene, cam, iso, controls, view, applyCamera, reframe,
 *           rayAt, planeHit, pick, toScreen, onTap }.
 */
export function createStage(opts) {
    const o = opts || {};
    const canvas = typeof o.canvas === "object" && o.canvas
        ? o.canvas
        : document.querySelector(o.canvas || "#view");
    if (!canvas) throw new Error("arcade.createStage: canvas missing");
    const scene = canvas.getContext("scene");
    if (!scene) throw new Error("arcade.createStage: scene context unavailable");
    const iso = o.iso ? createIso(o.iso) : null;
    const cam = iso ? null : Camera.createOrbit(o.orbit || {});
    const controls = iso ? isoWheel(canvas, iso, o.iso.wheel, () => applyCamera())
        : o.controls === false ? null : orbitControls(canvas, cam, o.controls);

    /** The scene.setCamera options for the current camera. */
    function view() {
        if (!iso) return Camera.orbitViewOpts(cam, canvas);
        const t = iso.target, d = iso.offset;
        return {
            mode: "orthographic", size: iso.size * iso.zoom, near: iso.near, far: iso.far,
            position: [t[0] + d[0], t[1] + d[1], t[2] + d[2]], target: t.slice(), up: [0, 1, 0],
        };
    }

    /** Push the camera to the scene (call once per frame, e.g. from draw). */
    function applyCamera() {
        scene.setCamera(view());
    }

    /**
     * Re-aim the camera at `pivot`, keeping the view angle. `dist` is the
     * orbit distance, or for an iso stage the unzoomed view height.
     */
    function reframe(pivot, dist) {
        if (iso) {
            iso.target = pivot.slice();
            if (dist != null) iso.size = dist;
            return;
        }
        Camera.orbitReframe(cam, pivot, dist != null ? dist : cam.dist);
    }

    /**
     * World ray under a client (CSS) pixel: { origin, dir } or null
     * (scene.unprojectLocal). The current camera is pushed first, so a
     * reframe earlier in the same frame is already in the answer.
     */
    function rayAt(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        applyCamera();
        return scene.unprojectLocal(clientX - r.left, clientY - r.top);
    }

    /** Client (CSS) pixel of a world point: { x, y } or null when behind the camera (scene.projectLocal). */
    function toScreen(x, y, z) {
        const r = canvas.getBoundingClientRect();
        applyCamera();
        const p = scene.projectLocal(x, y, z);
        return !p || p.behind ? null : { x: r.left + p.x, y: r.top + p.y };
    }

    /** Where `ray` crosses the horizontal plane at height y: { x, y, z } or null. */
    function planeHit(ray, y) {
        if (!ray) return null;
        const o = ray.origin, d = ray.dir;
        if (Math.abs(d[1]) < 1e-6) return null;
        const t = (y - o[1]) / d[1];
        if (t < 0) return null;
        return { x: o[0] + d[0] * t, y, z: o[2] + d[2] * t };
    }

    /** First scene node under a client pixel: the scene.raycast hit, or null. */
    function pick(clientX, clientY, maxDist) {
        const ray = rayAt(clientX, clientY);
        if (!ray) return null;
        const hit = scene.raycast(ray.origin, ray.dir, maxDist || 1000);
        return hit && hit.hit !== false ? hit : null;
    }

    /**
     * Call fn({ clientX, clientY, button }, event) for a press + release of
     * `button` on the canvas that moved less than `slop` px in between, so a
     * right-click is not confused with the end of a right-drag orbit.
     * opts: button = 0, slop = 4. Returns dispose().
     */
    function onTap(fn, tapOpts) {
        const t = Object.assign({ button: 0, slop: 4 }, tapOpts);
        let press = null;
        const down = (e) => {
            if (e.button !== t.button) return;
            press = { clientX: e.clientX, clientY: e.clientY, button: e.button, moved: 0 };
        };
        const move = (e) => {
            if (!press) return;
            const dx = e.movementX != null ? e.movementX : 0;
            const dy = e.movementY != null ? e.movementY : 0;
            press.moved += Math.abs(dx) + Math.abs(dy);
        };
        const up = (e) => {
            if (!press || e.button !== t.button) return;
            const p = press;
            press = null;
            if (p.moved <= t.slop) fn({ clientX: p.clientX, clientY: p.clientY, button: p.button }, e);
        };
        canvas.addEventListener("mousedown", down);
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        return () => {
            canvas.removeEventListener("mousedown", down);
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
    }

    applyCamera();
    return {
        canvas, scene, cam, iso, controls, view, applyCamera, reframe,
        rayAt, planeHit, pick, toScreen, onTap,
    };
}

function createIso(opts) {
    return {
        target: (opts.target || [0, 0, 0]).slice(),
        offset: (opts.offset || [16, 18, 16]).slice(),
        size: opts.size != null ? opts.size : 20,
        zoom: opts.zoom != null ? opts.zoom : 1,
        near: opts.near != null ? opts.near : 0.1,
        far: opts.far != null ? opts.far : 400,
    };
}

// Wheel zoom for an iso stage: zoom *= 1 + deltaY * step, clamped to
// [min, max]. Returns { dispose } or null without a `wheel` option.
function isoWheel(canvas, iso, wheel, apply) {
    if (!wheel) return null;
    const step = wheel.step != null ? wheel.step : 0.06;
    const min = wheel.min != null ? wheel.min : 0.25, max = wheel.max != null ? wheel.max : 4;
    const onWheel = (e) => {
        iso.zoom = Math.max(min, Math.min(max, iso.zoom * (1 + e.deltaY * step)));
        apply();
    };
    canvas.addEventListener("wheel", onWheel);
    return { dispose: () => canvas.removeEventListener("wheel", onWheel) };
}
