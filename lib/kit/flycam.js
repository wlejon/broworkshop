// lib/kit/flycam.js — a free-flying camera with the standard keyboard + mouse
// input, for terrain-scale 3D demos (the orbit camera is viewport3d.js).
//
//   import { flyCamera } from "/lib/kit/flycam.js";
//   const fly = flyCamera(canvas, { pos: [50, 42, 50], yaw: -0.8, pitch: -0.3, speed: 18 });
//   loop: scene.setCamera(fly.update(dt));
//
// Keys: W/A/S/D or arrows move, Space / C (or Ctrl) rise and sink, Shift
// boosts; with `roll`, Q/E roll. Mouse look is either
//   look: 'drag'  hold `lookButton` (right by default), pointer-locked while held,
//                 leaving the left button to the app (picking, sculpting);
//   look: 'lock'  click the canvas to capture the pointer, Esc releases.
// Keys typed into a form field stay there.
//
// Movement is velocity-smoothed (accel / damping, lib/camera.js fly model).
// Without roll the camera keeps yaw + pitch (pitch clamped short of straight
// up/down); with roll it is a free 6DOF quaternion camera.

import "../camera.js";

const Camera = globalThis.Camera;
const FIELD = /^(INPUT|SELECT|TEXTAREA)$/;
const KEYMAP = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd', control: 'c' };

/**
 * opts:
 *   pos = [0, 10, 20], yaw = 0, pitch = 0   start pose (radians; yaw 0 looks
 *                                           down -Z, positive pitch looks up)
 *   speed = 18, boost = 3                   m/s, Shift multiplier
 *   lookSpeed = 0.003                       radians per mouse pixel
 *   accel = 12, damping = 6                 velocity smoothing rates (1/s)
 *   look = 'drag' | 'lock', lookButton = 2
 *   roll = false                            6DOF with Q/E roll
 *   worldUp = false                         Space/C along world Y, not camera up
 *   ground(x, z) -> height, clearance = 2   keep the camera above a surface
 *   fov = 60, near = 0.1, far = 1000
 * Returns { cam, keys, update(dt) -> scene.setCamera options, pose(p),
 *           forward(), locked, altitude, groundHeight, opts, dispose() }.
 */
export function flyCamera(canvas, opts) {
    const o = Object.assign({
        pos: [0, 10, 20], yaw: 0, pitch: 0, speed: 18, boost: 3, lookSpeed: 0.003,
        accel: 12, damping: 6, look: 'drag', lookButton: 2, roll: false, worldUp: false,
        ground: null, clearance: 2, fov: 60, near: 0.1, far: 1000,
    }, opts);
    const cam = Camera.createFly({
        pos: o.pos, accel: o.accel, damping: o.damping, lookSpeed: o.lookSpeed,
        fov: o.fov, near: o.near, far: o.far,
    });
    const keys = {};
    let yaw = o.yaw, pitch = o.pitch, dragging = false, mx = 0, my = 0, groundH = 0;
    const PITCH_MAX = Math.PI * 0.48;
    const orient = () => {
        cam.rot = Camera.quatNorm(Camera.quatMul(Camera.quatFromAxis(0, 1, 0, yaw), Camera.quatFromAxis(1, 0, 0, pitch)));
    };
    orient();

    const locked = () => document.pointerLockElement === canvas;
    const onKeyDown = (e) => {
        if (e.target && FIELD.test(e.target.tagName)) return;
        const k = KEYMAP[e.key.toLowerCase()] || e.key.toLowerCase();
        keys[k] = true;
        if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
    };
    const onKeyUp = (e) => { keys[KEYMAP[e.key.toLowerCase()] || e.key.toLowerCase()] = false; };
    const onDown = (e) => {
        if (o.look === 'lock') { if (e.button === 0 && !locked()) canvas.requestPointerLock(); return; }
        if (e.button !== o.lookButton) return;
        dragging = true;
        e.preventDefault();
        canvas.requestPointerLock();
    };
    const onUp = (e) => {
        if (o.look === 'drag' && e.button === o.lookButton && dragging) {
            dragging = false;
            if (locked()) document.exitPointerLock();
        }
    };
    const onMove = (e) => {
        if (o.look === 'drag' ? !dragging : !locked()) return;
        mx += e.movementX; my += e.movementY;
    };
    const noMenu = (e) => e.preventDefault();
    const onBlur = () => { for (const k in keys) keys[k] = false; };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMove);
    canvas.addEventListener('contextmenu', noMenu);
    window.addEventListener('blur', onBlur);

    const thrust = () => {
        const f = Camera.flyForward(cam), r = Camera.flyRight(cam);
        const u = o.worldUp ? [0, 1, 0] : Camera.flyUp(cam);
        const t = [0, 0, 0];
        const add = (v, s) => { t[0] += v[0] * s; t[1] += v[1] * s; t[2] += v[2] * s; };
        if (keys.w) add(f, 1);
        if (keys.s) add(f, -1);
        if (keys.d) add(r, 1);
        if (keys.a) add(r, -1);
        if (keys[' ']) add(u, 1);
        if (keys.c) add(u, -1);
        const len = Math.hypot(t[0], t[1], t[2]);
        return len < 1e-6 ? [0, 0, 0] : [t[0] / len, t[1] / len, t[2] / len];
    };

    return {
        cam, keys,
        get locked() { return locked(); },
        /** Height above `ground` at the last update, and that ground height (0 without one). */
        get altitude() { return cam.pos[1] - groundH; },
        get groundHeight() { return groundH; },
        /** World-space unit forward vector. */
        forward() { return Camera.flyForward(cam); },
        /** Jump to a pose: { pos, yaw, pitch }; stops the camera. */
        pose(p) {
            if (p.pos) cam.pos = p.pos.slice();
            if (p.yaw != null) yaw = p.yaw;
            if (p.pitch != null) pitch = p.pitch;
            cam.vel = [0, 0, 0];
            orient();
        },
        /** Advance by dt seconds; returns the scene.setCamera options. */
        update(dt) {
            cam.lookSpeed = o.lookSpeed;
            if (mx || my) {
                if (o.roll) Camera.flyLook(cam, mx, my);
                else {
                    yaw -= mx * o.lookSpeed;
                    pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, pitch - my * o.lookSpeed));
                    orient();
                }
                mx = my = 0;
            }
            if (o.roll) {
                const dir = (keys.q ? 1 : 0) - (keys.e ? 1 : 0);
                if (dir) Camera.flyRoll(cam, dt, dir);
            }
            Camera.flyIntegrate(cam, thrust(), dt, o.speed * (keys.shift ? o.boost : 1));
            if (o.ground) {
                groundH = o.ground(cam.pos[0], cam.pos[2]);
                if (cam.pos[1] < groundH + o.clearance) {
                    cam.pos[1] = groundH + o.clearance;
                    if (cam.vel[1] < 0) cam.vel[1] = 0;
                }
            }
            cam.fov = o.fov; cam.near = o.near; cam.far = o.far;
            return Camera.flyViewOptsQuat(cam, canvas);
        },
        /** Live-tunable: speed, boost, lookSpeed, fov, near, far, clearance. */
        opts: o,
        dispose() {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            canvas.removeEventListener('mousedown', onDown);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('contextmenu', noMenu);
            window.removeEventListener('blur', onBlur);
            if (locked()) document.exitPointerLock();
        },
    };
}
