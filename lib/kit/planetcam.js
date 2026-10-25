// lib/kit/planetcam.js — walk and fly controls for a round world (a scene
// with a body: scene.setBody({ radius })), beside the app's orbit camera.
//
//   import { planetController } from "/lib/kit/planetcam.js";
//   const ctl = planetController(vp.canvas, scene, {
//       altitude: (pos) => eye's height over the ground or sea under it,
//       water: (pos) => whether that is the sea,
//       fromOrbit: () => ({ position, target }),   // the orbit view, on leaving it
//       toOrbit: (view) => Camera.orbitFromView(vp.cam, view),
//   });
//   vp.onFrame((dt) => ctl.update(dt));
//   vp.onView((view) => { if (ctl.mode !== 'orbit') Object.assign(view, ctl.view()); });
//
// Modes: 'orbit' (the app's own camera; the controller only listens for F),
// 'walk' and 'fly'. F cycles walk -> fly -> orbit -> walk; setMode() does
// the same from a button.
//   walk  the eye `eye` m over the ground, falling toward the body's centre;
//         WASD moves, Shift runs, Space jumps; on the sea it floats, the eye
//         `swimEye` over the water. Entering walk from orbit drops the eye to
//         the ground under it; from fly it falls from where it is.
//   fly   WASD along the view, Space / C (or Ctrl) along the local up; the
//         speed is `flyRate` x the height over the ground (a few m/s at the
//         treetops, thousands of km/s out at orbit), Shift `boost`s it and
//         the wheel scales it. Coming down to the ground lands into walk.
// Look: click the view to capture the pointer (Esc releases), or hold the
// left button and drag. The view's up is always the local up (no roll), its
// pitch held short of straight up or down. Keys typed into a form field
// stay there. Positions are the scene's place frame; the controller moves
// with the place on its 'reanchor' event.

import { Camera } from "./camera.js";
const FIELD = /^(INPUT|SELECT|TEXTAREA)$/;
const MODES = ['walk', 'fly', 'orbit'];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const addTo = (p, v, s) => { p[0] += v[0] * s; p[1] += v[1] * s; p[2] += v[2] * s; };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
// `v` with its part along unit `n` taken out.
const flatten = (v, n) => { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; };

/**
 * opts:
 *   altitude(pos) -> m             the eye's height over the ground (or sea) under it (required)
 *   water(pos) -> bool             whether what is under it is the sea
 *   fromOrbit() -> { position, target }   the orbit view, when walk or fly take over
 *   toOrbit({ position, target, up })     hand the view back to the orbit camera
 *   onMode(mode, prev)             after every change of mode
 *   eye = 1.7, swimEye = 0.4       walking / floating eye height (m)
 *   walkSpeed = 3, runSpeed = 9    m/s (Shift runs), swimming at half
 *   jumpSpeed = 4.2, gravity = 9.81
 *   flyRate = 0.3, flyMin = 3, boost = 4   fly speed = max(flyMin, flyRate x height) m/s
 *   lookSpeed = 0.0025, fov = 60
 * Returns { mode, setMode(m), cycle(), update(dt), view(), pose(), keys,
 *           speedScale, opts, state(), dispose() }.
 */
export function planetController(canvas, scene, opts) {
    const o = Object.assign({
        altitude: null, water: null, fromOrbit: null, toOrbit: null, onMode: null,
        eye: 1.7, swimEye: 0.4, walkSpeed: 3, runSpeed: 9, jumpSpeed: 4.2, gravity: 9.81,
        flyRate: 0.3, flyMin: 3, boost: 4, lookSpeed: 0.0025, fov: 60,
    }, opts);
    if (!o.altitude) throw new Error('planetController: opts.altitude is required');

    let mode = 'orbit';
    let pos = [0, 0, 0];
    let heading = [0, 0, -1];   // unit, in the tangent plane at pos
    let pitch = 0;
    let vel = [0, 0, 0];        // world velocity (walk: its tangent part)
    let drive = [0, 0, 0], gain = 1;   // fly: the eased thrust and boost
    let vUp = 0, grounded = true, speedScale = 1;
    let mx = 0, my = 0, dragging = false;
    const keys = {};

    const locked = () => document.pointerLockElement === canvas;
    const up = () => scene.upAt(pos);
    const eyeHeight = () => (o.water && o.water(pos) ? o.swimEye : o.eye);
    const forward = (u) => {
        const c = Math.cos(pitch), s = Math.sin(pitch);
        return [heading[0] * c + u[0] * s, heading[1] * c + u[1] * s, heading[2] * c + u[2] * s];
    };
    // Re-level the heading in the tangent plane (the up turns as the eye moves).
    const level = (u) => {
        let h = flatten(heading, u);
        if (Math.hypot(h[0], h[1], h[2]) < 1e-6) h = flatten(cross(u, [1, 0, 0]), u);
        heading = norm(h);
    };
    // Take a pose: the eye at `p`, looking toward `t`.
    const aim = (p, t) => {
        pos = p.slice(0, 3);
        const u = up();
        const f = norm([t[0] - p[0], t[1] - p[1], t[2] - p[2]]);
        pitch = Math.max(-1.53, Math.min(1.53, Math.asin(Math.max(-1, Math.min(1, dot(f, u))))));
        heading = flatten(f, u);
        if (Math.hypot(heading[0], heading[1], heading[2]) < 1e-6) heading = flatten(cross(u, [1, 0, 0]), u);
        heading = norm(heading);
    };
    // The eye at `h` over the ground under it, along the local up.
    const settleAt = (h) => {
        for (let i = 0; i < 3; i++) addTo(pos, up(), h - o.altitude(pos));
    };

    function setMode(next) {
        if (!MODES.includes(next) || next === mode) return;
        const prev = mode;
        if (prev === 'orbit') {
            const v = o.fromOrbit ? o.fromOrbit() : null;
            if (v) aim(v.position, v.target);
        }
        mode = next;
        vel = [0, 0, 0]; drive = [0, 0, 0]; vUp = 0; gain = speedScale;
        if (next === 'walk') {
            if (prev === 'orbit') {
                // Down to the ground under the eye, looking out level.
                const b = scene.toBody(pos), r = Math.hypot(b[0], b[1], b[2]);
                const R = (scene.place && scene.place.body && scene.place.body.radius) || r;
                pos = scene.toPlace(scale(b, R / r));
                settleAt(eyeHeight());
                pitch = 0;
                level(up());
                grounded = true;
            } else grounded = o.altitude(pos) <= eyeHeight() + 0.05;
            pitch = Math.max(-1.3, Math.min(1.3, pitch));
        }
        if (next === 'orbit') {
            if (locked()) document.exitPointerLock();
            if (o.toOrbit) {
                const v = view();
                const d = Math.max(20, 2 * o.altitude(pos));
                const f = forward(up());
                o.toOrbit({ position: v.position, target: [pos[0] + f[0] * d, pos[1] + f[1] * d, pos[2] + f[2] * d], up: v.up });
            }
        }
        if (o.onMode) o.onMode(mode, prev);
    }
    const cycle = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

    // --- input -------------------------------------------------------------
    const keyName = (e) => {
        const c = e.code || '';
        if (c.startsWith('Key')) return c.slice(3).toLowerCase();
        if (c === 'Space') return ' ';
        if (c.startsWith('Shift')) return 'shift';
        if (c.startsWith('Control')) return 'c';
        return { ArrowUp: 'w', ArrowDown: 's', ArrowLeft: 'a', ArrowRight: 'd' }[c] || (e.key || '').toLowerCase();
    };
    const onKeyDown = (e) => {
        if (e.target && FIELD.test(e.target.tagName)) return;
        const k = keyName(e);
        if (k === 'f' && !e.repeat) { cycle(); return; }
        if (mode === 'orbit') return;
        keys[k] = true;
        if (k === ' ' || (e.code || '').startsWith('Arrow')) e.preventDefault();
    };
    const onKeyUp = (e) => { keys[keyName(e)] = false; };
    const onDown = (e) => {
        if (mode === 'orbit' || e.button !== 0) return;
        if (!locked()) { dragging = true; canvas.requestPointerLock(); }
    };
    const onUp = (e) => { if (e.button === 0) dragging = false; };
    const onMove = (e) => {
        if (mode === 'orbit' || !(locked() || dragging)) return;
        mx += e.movementX || 0; my += e.movementY || 0;
    };
    const onWheel = (e) => {
        if (mode !== 'fly') return;
        e.preventDefault();
        speedScale = Math.min(16, Math.max(1 / 16, speedScale * Math.pow(2, -e.deltaY / 4)));
    };
    const onBlur = () => { for (const k in keys) keys[k] = false; dragging = false; };
    // The place moved under the eye: carry the pose with it.
    const onReanchor = (e) => {
        pos = e.apply(pos);
        heading = e.turn(heading);
        vel = e.turn(vel);
        drive = e.turn(drive);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMove);
    canvas.addEventListener('wheel', onWheel);
    window.addEventListener('blur', onBlur);
    scene.addEventListener('reanchor', onReanchor);

    // --- motion ------------------------------------------------------------
    const axis = (a, b) => (keys[a] ? 1 : 0) - (keys[b] ? 1 : 0);
    const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

    function look(u) {
        if (mx || my) {
            const a = -mx * o.lookSpeed, c = Math.cos(a), s = Math.sin(a);
            const side = cross(u, heading);
            heading = norm([heading[0] * c + side[0] * s, heading[1] * c + side[1] * s, heading[2] * c + side[2] * s]);
            const lim = mode === 'walk' ? 1.3 : 1.53;
            pitch = Math.max(-lim, Math.min(lim, pitch - my * o.lookSpeed));
            mx = my = 0;
        }
    }

    function walk(dt) {
        let u = up();
        level(u);
        look(u);
        const right = norm(cross(heading, u));
        const swim = o.water && o.water(pos);
        const speed = (keys.shift ? o.runSpeed : o.walkSpeed) * (swim ? 0.5 : 1);
        const wish = norm([0, 1, 2].map((i) => heading[i] * axis('w', 's') + right[i] * axis('d', 'a')));
        // (Quick to start and stop on foot; slower in the air.)
        const k = ease(grounded ? 10 : 2, dt);
        vel = flatten(vel, u);
        for (let i = 0; i < 3; i++) vel[i] += (wish[i] * speed - vel[i]) * k;
        addTo(pos, vel, dt);
        u = up();
        const eh = eyeHeight();
        if (grounded && keys[' '] && !swim) { grounded = false; vUp = o.jumpSpeed; }
        if (grounded) {
            // Follow the ground: snapped to it, unless it falls away faster
            // than a stride can step down (a ledge: fall).
            const d = o.altitude(pos) - eh;
            const stepDown = 0.4 + 2 * Math.hypot(vel[0], vel[1], vel[2]) * dt;
            if (d > stepDown) { grounded = false; vUp = 0; }
            else addTo(pos, u, -d);
        }
        if (!grounded) {
            vUp -= o.gravity * dt;
            addTo(pos, u, vUp * dt);
            const d = o.altitude(pos) - eh;
            if (d <= 0) { addTo(pos, u, -d); grounded = true; vUp = 0; }
        }
    }

    function fly(dt) {
        const u = up();
        level(u);
        look(u);
        const f = forward(u), right = norm(cross(heading, u));
        // The thrust (unitless) and the boost ease in and out; the speed is
        // the height's now, so a dive slows as the ground nears and never
        // overshoots it (a velocity eased in m/s would, from orbit).
        const t = norm([0, 1, 2].map((i) => f[i] * axis('w', 's') + right[i] * axis('d', 'a') + u[i] * axis(' ', 'c')));
        const k = ease(Math.hypot(t[0], t[1], t[2]) > 0 ? 4 : 3, dt);
        for (let i = 0; i < 3; i++) drive[i] += (t[i] - drive[i]) * k;
        gain += ((keys.shift ? o.boost : 1) * speedScale - gain) * ease(4, dt);
        const speed = Math.max(o.flyMin, o.flyRate * Math.max(o.altitude(pos), 0)) * gain;
        vel = scale(drive, speed);
        addTo(pos, vel, dt);
        // Never under the ground; coming down onto it lands.
        const eh = eyeHeight(), d = o.altitude(pos) - eh;
        if (d < 0) {
            addTo(pos, up(), -d);
            // (Landing looks out ahead, not at the feet a dive looked down at.)
            if (dot(vel, u) < 0) { setMode('walk'); pitch = Math.max(-0.35, Math.min(0.35, pitch)); }
            else drive = flatten(drive, u);
        }
    }

    function view() {
        const u = up(), f = forward(u);
        const q = Camera.quatLook(f, u);
        const d = Math.max(10, Math.abs(o.altitude(pos)));
        return {
            fov: o.fov,
            position: pos.slice(),
            target: [pos[0] + f[0] * d, pos[1] + f[1] * d, pos[2] + f[2] * d],
            up: Camera.quatRotVec(q, [0, 1, 0]),
        };
    }

    return {
        keys, opts: o,
        get mode() { return mode; },
        get speedScale() { return speedScale; },
        set speedScale(v) { speedScale = v; },
        setMode, cycle,
        /** Advance walk or fly by dt seconds (nothing in orbit). */
        update(dt) {
            if (mode === 'walk') walk(dt);
            else if (mode === 'fly') fly(dt);
        },
        /** The scene.setCamera options for walk or fly (position, target, up, fov). */
        view,
        /** Jump to a pose { position, target } (place frame), stopped. */
        pose(p) { aim(p.position, p.target); vel = [0, 0, 0]; drive = [0, 0, 0]; vUp = 0; },
        /** What the controller is doing: { mode, pos, heading, pitch, vel, grounded, altitude, speedScale }. */
        state() {
            return { mode, pos: pos.slice(), heading: heading.slice(), pitch, vel: vel.slice(), vUp, grounded,
                     altitude: o.altitude(pos), speedScale };
        },
        dispose() {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            canvas.removeEventListener('mousedown', onDown);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('blur', onBlur);
            scene.removeEventListener('reanchor', onReanchor);
            if (locked()) document.exitPointerLock();
        },
    };
}
