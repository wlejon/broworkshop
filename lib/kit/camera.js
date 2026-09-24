// camera.js — orbit and fly camera math for bro.scene apps.
//
// Quaternion-based, so both cameras are gimbal-lock-free and can pitch fully
// over the top of the target. Pure math: a camera is a plain object and
// `*ViewOpts` turns it into the options `scene.setCamera` takes. Most apps
// want the wired-up version, `sceneViewport` / `orbitControls` in
// viewport3d.js, or `flycam.js`.
//
//   import { Camera } from "/lib/kit/camera.js";
//   const orbit = Camera.createOrbit({ target: [0, 1, 0], dist: 4 });
//   Camera.orbitLook(orbit, dx, dy);   // on mousemove (pixels)
//   orbit.dist = Math.max(0.5, orbit.dist + wheelStep);
//   scene.setCamera(Camera.orbitViewOpts(orbit, canvas));

// --- Vector / quaternion helpers (quat = [x, y, z, w]) -----------------------

function v3add(a, b)   { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

function quatFromAxis(ax, ay, az, angle) {
    const s = Math.sin(angle * 0.5), c = Math.cos(angle * 0.5);
    return [ax * s, ay * s, az * s, c];
}
function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
function quatNorm(q) {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (len < 1e-12) return [0, 0, 0, 1];
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}
function quatRotVec(q, v) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    ];
}

// --- Orbit camera ------------------------------------------------------------
//
// Separates the rotation pivot from the camera position so panning doesn't
// shift what rotation orbits around:
//   - `pivot` is the fixed rotation origin (e.g. the model's bbox centre).
//   - `pos` is the absolute camera position.
//   - `rot` is the camera orientation (quaternion).
// Mouselook rotates `pos` around `pivot` while preserving the camera's
// pivot-local offset. Panning translates `pos` along screen axes without
// touching `pivot`.

function createOrbit(opts) {
    opts = opts || {};
    const pivot = (opts.pivot || opts.target) ? (opts.pivot || opts.target).slice() : [0, 0, 0];
    // Slight downward tilt by default: a "look from above" starting pose.
    const rot = opts.rot ? opts.rot.slice() : quatFromAxis(1, 0, 0, -0.2);
    const dist = opts.dist != null ? opts.dist : 4;
    const pos = opts.pos ? opts.pos.slice() : v3add(pivot, quatRotVec(rot, [0, 0, dist]));
    const cam = {
        pivot, pos, rot,
        fov:  opts.fov  != null ? opts.fov  : 45,
        near: opts.near != null ? opts.near : 0.1,
        far:  opts.far  != null ? opts.far  : 1000,
        yawSpeed:   opts.yawSpeed   != null ? opts.yawSpeed   : 0.005,
        pitchSpeed: opts.pitchSpeed != null ? opts.pitchSpeed : 0.005,
        // Pan scales with `dist` so a drag covers a similar fraction of the
        // view at any zoom; ~0.001 is close to cursor-follows-content at 45°.
        panSpeed:   opts.panSpeed   != null ? opts.panSpeed   : 0.001,
    };
    // `dist` = distance from pivot to camera. Assigning rescales the
    // pivot→pos offset while preserving direction, so `cam.dist *= k` zooms.
    Object.defineProperty(cam, 'dist', {
        enumerable: true,
        get() {
            const dx = this.pos[0] - this.pivot[0];
            const dy = this.pos[1] - this.pivot[1];
            const dz = this.pos[2] - this.pivot[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        },
        set(v) {
            const dx = this.pos[0] - this.pivot[0];
            const dy = this.pos[1] - this.pivot[1];
            const dz = this.pos[2] - this.pivot[2];
            const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (L < 1e-9) {
                const off = quatRotVec(this.rot, [0, 0, v]);
                this.pos = [this.pivot[0] + off[0], this.pivot[1] + off[1], this.pivot[2] + off[2]];
            } else {
                const s = v / L;
                this.pos = [this.pivot[0] + dx * s, this.pivot[1] + dy * s, this.pivot[2] + dz * s];
            }
        },
    });
    return cam;
}

// Re-frame the camera around a new pivot at a given radius, keeping the
// current orientation so the view angle is consistent across model loads.
function orbitReframe(cam, pivot, dist) {
    cam.pivot = pivot.slice();
    const off = quatRotVec(cam.rot, [0, 0, dist]);
    cam.pos = [pivot[0] + off[0], pivot[1] + off[1], pivot[2] + off[2]];
}

// Apply mouse-delta pixels to orbit rotation around `pivot`.
//   dx > 0 → camera orbits right; dy > 0 → camera orbits up.
// Yaw is around world +Y, pitch around the camera's right axis. The
// pivot-local offset is preserved, so after a pan rotation still orbits the
// original pivot rather than the panned view centre.
function orbitLook(cam, dx, dy) {
    const qy = quatFromAxis(0, 1, 0, -dx * cam.yawSpeed);
    const qp = quatFromAxis(1, 0, 0, -dy * cam.pitchSpeed);
    const rotNew = quatNorm(quatMul(quatMul(qy, cam.rot), qp));
    const ox = cam.pos[0] - cam.pivot[0];
    const oy = cam.pos[1] - cam.pivot[1];
    const oz = cam.pos[2] - cam.pivot[2];
    const rotInv = [-cam.rot[0], -cam.rot[1], -cam.rot[2], cam.rot[3]];
    const off = quatRotVec(rotNew, quatRotVec(rotInv, [ox, oy, oz]));
    cam.pos = [cam.pivot[0] + off[0], cam.pivot[1] + off[1], cam.pivot[2] + off[2]];
    cam.rot = rotNew;
}

// Pan along the camera's screen axes; content follows the cursor. Rate scales
// with the pivot radius. The pivot does not move.
function orbitPan(cam, dx, dy) {
    const right = quatRotVec(cam.rot, [1, 0, 0]);
    const up    = quatRotVec(cam.rot, [0, 1, 0]);
    const k = cam.dist * cam.panSpeed;
    cam.pos[0] += (-dx * right[0] + dy * up[0]) * k;
    cam.pos[1] += (-dx * right[1] + dy * up[1]) * k;
    cam.pos[2] += (-dx * right[2] + dy * up[2]) * k;
}

function orbitPosition(cam) { return cam.pos.slice(); }
function orbitUp(cam) { return quatRotVec(cam.rot, [0, 1, 0]); }

// Options for scene.setCamera. The look-at target is one unit along the
// camera's forward axis, so after panning the camera looks straight ahead.
// `aspect` is omitted on purpose: the engine derives it from the canvas's own
// layout box, which clientWidth/clientHeight can disagree with before layout
// settles.
function orbitViewOpts(cam /*, canvas */) {
    const fwd = quatRotVec(cam.rot, [0, 0, -1]);
    return {
        fov: cam.fov, near: cam.near, far: cam.far,
        position: cam.pos.slice(),
        target: [cam.pos[0] + fwd[0], cam.pos[1] + fwd[1], cam.pos[2] + fwd[2]],
        up: quatRotVec(cam.rot, [0, 1, 0]),
    };
}

// --- Fly camera --------------------------------------------------------------
//
// Free 6DOF camera: translates along its own basis, rotates via mouselook and
// roll keys.

function createFly(opts) {
    opts = opts || {};
    return {
        pos:  opts.pos ? opts.pos.slice() : [0, 0, 5],
        rot:  opts.rot ? opts.rot.slice() : [0, 0, 0, 1],
        vel:  [0, 0, 0],
        fov:  opts.fov  != null ? opts.fov  : 60,
        near: opts.near != null ? opts.near : 0.1,
        far:  opts.far  != null ? opts.far  : 1000,
        accel:     opts.accel     != null ? opts.accel     : 12,
        damping:   opts.damping   != null ? opts.damping   : 6,
        rollSpeed: opts.rollSpeed != null ? opts.rollSpeed : 2.5,
        lookSpeed: opts.lookSpeed != null ? opts.lookSpeed : 0.002,
    };
}

function flyForward(cam) { return quatRotVec(cam.rot, [0, 0, -1]); }
function flyRight(cam)   { return quatRotVec(cam.rot, [1, 0, 0]); }
function flyUp(cam)      { return quatRotVec(cam.rot, [0, 1, 0]); }

// Mouselook: yaw around world +Y, pitch around local right.
function flyLook(cam, dx, dy) {
    cam.rot = quatNorm(quatMul(
        quatMul(quatFromAxis(0, 1, 0, -dx * cam.lookSpeed), cam.rot),
        quatFromAxis(1, 0, 0, -dy * cam.lookSpeed)));
}

// Roll around the forward axis; dir = +1 rolls counterclockwise.
function flyRoll(cam, dt, dir) {
    const f = flyForward(cam);
    cam.rot = quatNorm(quatMul(quatFromAxis(f[0], f[1], f[2], dir * cam.rollSpeed * dt), cam.rot));
}

// World-space unit thrust from a { key: bool } map: WASD + Space/Control
// (camera-local up/down). [0,0,0] when no keys are held.
function flyThrustFromKeys(cam, keys) {
    const f = flyForward(cam), r = flyRight(cam), u = flyUp(cam);
    let x = 0, y = 0, z = 0;
    if (keys['w']) { x += f[0]; y += f[1]; z += f[2]; }
    if (keys['s']) { x -= f[0]; y -= f[1]; z -= f[2]; }
    if (keys['d']) { x += r[0]; y += r[1]; z += r[2]; }
    if (keys['a']) { x -= r[0]; y -= r[1]; z -= r[2]; }
    if (keys[' '])       { x += u[0]; y += u[1]; z += u[2]; }
    if (keys['control']) { x -= u[0]; y -= u[1]; z -= u[2]; }
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-6) return [0, 0, 0];
    return [x / len, y / len, z / len];
}

// Velocity-integrated movement with exponentially smoothed accel/damping.
// `thrust` is a world-space direction (zero means coast); `speed` is the
// target velocity.
function flyIntegrate(cam, thrust, dt, speed) {
    const thrustLen = Math.sqrt(thrust[0] * thrust[0] + thrust[1] * thrust[1] + thrust[2] * thrust[2]);
    const accelBlend   = 1 - Math.exp(-cam.accel * dt);
    const dampingBlend = 1 - Math.exp(-cam.damping * dt);
    for (let i = 0; i < 3; i++) {
        if (thrustLen > 1e-6) cam.vel[i] += (thrust[i] * speed - cam.vel[i]) * accelBlend;
        else cam.vel[i] *= (1 - dampingBlend);
        cam.pos[i] += cam.vel[i] * dt;
    }
}

// target+up submission.
function flyViewOpts(cam, canvas) {
    return {
        fov: cam.fov, near: cam.near, far: cam.far,
        position: cam.pos.slice(),
        target: v3add(cam.pos, flyForward(cam)),
        up: flyUp(cam),
        aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
    };
}

// position+quaternion submission: preserves full 6DOF roll exactly.
function flyViewOptsQuat(cam, canvas) {
    return {
        fov: cam.fov, near: cam.near, far: cam.far,
        position: cam.pos.slice(),
        quaternion: cam.rot.slice(),
        aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
    };
}

export const Camera = {
    // math
    v3add, v3scale,
    quatFromAxis, quatMul, quatNorm, quatRotVec,
    // orbit
    createOrbit, orbitReframe, orbitLook, orbitPan,
    orbitPosition, orbitUp, orbitViewOpts,
    // fly
    createFly, flyLook, flyRoll, flyThrustFromKeys, flyIntegrate,
    flyForward, flyRight, flyUp, flyViewOpts, flyViewOptsQuat,
};
