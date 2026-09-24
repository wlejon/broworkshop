// lib/kit/math3d.js — small quaternion / vector helpers for 3D demos.
//
// Two shapes, because the engine speaks both: `Physics` takes and returns
// {x,y,z,w} / {x,y,z} objects (`q`, `v3`, `QI`), scene nodes take
// [x,y,z,w] arrays (`quatFromEuler`, `quatMul`, `quatYTo`; `toArr`
// converts). Camera math (orbit / fly) is camera.js.
//
//   import { q, v3, quatYTo, toArr } from "/lib/kit/math3d.js";
//   body.rotation = q.mul(q.axis(0, 1, 0, yaw), tilt);
//   node.rotation = quatYTo(dx, dy, dz);     // point a cylinder along d

// --- {x,y,z,w} objects (Physics) ------------------------------------------------

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

// --- [x,y,z,w] arrays (scene nodes, bromesh) -------------------------------------

/** Euler XYZ (radians) -> quaternion [x,y,z,w], matching bromesh. */
export function quatFromEuler(x, y, z) {
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    ];
}

/** Hamilton product a * b ([x,y,z,w]). */
export function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

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
