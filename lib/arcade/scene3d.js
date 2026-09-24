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

import { boot } from "/lib/arcade/shell.js";
import { orbitControls, screenRay } from "/lib/kit/viewport3d.js";
import "/lib/camera.js";

const Camera = globalThis.Camera;

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
 * A scene canvas with an orbit camera and screen-space picking. opts:
 *   canvas = "#view"   selector or element
 *   orbit              Camera.createOrbit options ({ target, dist, fov, near, far })
 *   controls           orbitControls options ({ minDist, maxDist, ... }), or false
 * Returns { canvas, scene, cam, controls, applyCamera, reframe, rayAt,
 *           planeHit, pick, onTap }.
 */
export function createStage(opts) {
    const o = opts || {};
    const canvas = typeof o.canvas === "object" && o.canvas
        ? o.canvas
        : document.querySelector(o.canvas || "#view");
    if (!canvas) throw new Error("arcade.createStage: canvas missing");
    const scene = canvas.getContext("scene");
    if (!scene) throw new Error("arcade.createStage: scene context unavailable");
    const cam = Camera.createOrbit(o.orbit || {});
    const controls = o.controls === false ? null : orbitControls(canvas, cam, o.controls);

    /** Push the orbit camera to the scene (call once per frame, e.g. from draw). */
    function applyCamera() {
        scene.setCamera(Camera.orbitViewOpts(cam, canvas));
    }

    /** Re-aim the camera at `pivot` from `dist`, keeping the view angle. */
    function reframe(pivot, dist) {
        Camera.orbitReframe(cam, pivot, dist != null ? dist : cam.dist);
    }

    /**
     * World ray under a client (CSS) pixel: { origin, dir } or null. Computed
     * from the orbit camera and the canvas box (kit screenRay), which is the
     * projection the engine renders with.
     */
    function rayAt(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return null;
        return screenRay(Camera.orbitViewOpts(cam, canvas), r.width, r.height, clientX - r.left, clientY - r.top);
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
    return { canvas, scene, cam, controls, applyCamera, reframe, rayAt, planeHit, pick, onTap };
}
