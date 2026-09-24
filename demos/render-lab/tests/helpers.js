// Shared helpers for the render-lab tests (not a test itself: no test_ prefix).

import { vp, scene, cam, state, applyPost } from "/app/lab.js";

/** Mutate `state`, re-apply the stack (the HUD's own path) and render a frame. */
export function step(mutate) {
    mutate();
    applyPost(scene);
    advanceTime(32);
    flush();
}

/** Re-centre the orbit camera on `pivot` looking down -Z, and render. */
export function lookFrom(pivot, dist) {
    vp.reframe(pivot, dist, { yaw: 0, pitch: 0 });
    advanceTime(96); flush();
}

/** Snapshot the camera; returns a restore function. */
export function saveCam() {
    const s = { pivot: cam.pivot.slice(), pos: cam.pos.slice(), rot: cam.rot.slice(), dist: cam.dist };
    return () => {
        cam.pivot = s.pivot.slice(); cam.pos = s.pos.slice(); cam.rot = s.rot.slice(); cam.dist = s.dist;
        advanceTime(64); flush();
    };
}

/** Mean absolute RGB difference between two captures `ms` of virtual time apart. */
export function frameDelta(ms) {
    advanceTime(64); flush();
    const a = scene.captureFrame(320, 200);
    advanceTime(ms); flush();
    const b = scene.captureFrame(320, 200);
    let sum = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
             + Math.abs(a.data[i + 2] - b.data[i + 2]);
    }
    return sum / (a.data.length / 4 * 3);
}
