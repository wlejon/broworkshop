// cutter.js — the cutter: a primitive with a size, a transform driven by
// bro.gizmo, and a coloured preview node. transformedMesh() bakes the
// transform into a Mesh in world space for the boolean.

export const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus'];
export const GIZMO_MODES = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };
export const GIZMO_KEYS = { translate: 'W', rotate: 'E', scale: 'R' };
export const SNAP = 0.25;

const OP_COLORS = { carve: '#ff4757', union: '#2ed573', intersect: '#1e90ff' };
const HOME = [0.8, 0.8, 0.8];

// --- quaternion / matrix helpers ([x, y, z, w]) ----------------------------------

function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
function quatNorm(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Column-major 4x4 of translate(t) * rotate(q) * scale(s), as Mesh.transform takes. */
export function trsMatrix(t, q, s) {
    const [x, y, z, w] = q;
    const r = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w),     2 * (x * z - y * w),
        2 * (x * y - z * w),     1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w),     2 * (y * z - x * w),     1 - 2 * (x * x + y * y),
    ];
    return [
        r[0] * s[0], r[1] * s[0], r[2] * s[0], 0,
        r[3] * s[1], r[4] * s[1], r[5] * s[1], 0,
        r[6] * s[2], r[7] * s[2], r[8] * s[2], 0,
        t[0], t[1], t[2], 1,
    ];
}

const snapped = (v) => Math.round(v / SNAP) * SNAP;

/**
 * The cutter on `scene`. Returns { shape, op, size, position, quaternion,
 * scale, snap, setShape, setOp, setSize, setGizmoMode, reset, mesh(),
 * transformedMesh() }. `size` is { width, height, depth, radius } in metres.
 */
export function createCutter(scene) {
    let shape = 'box', op = 'carve', mode = 'translate', preview = null;
    const size = { width: 1.2, height: 1.2, depth: 1.2, radius: 0.72 };
    let position = HOME.slice(), quaternion = [0, 0, 0, 1], scale = [1, 1, 1];
    // The un-snapped position a drag accumulates into: snapping each small
    // gizmo delta would round it away and the cutter would never move.
    let dragPos = null;

    const cutter = {
        snap: false,
        get shape() { return shape; },
        get op() { return op; },
        get mode() { return mode; },
        get size() { return size; },
        get position() { return position.slice(); },
        get quaternion() { return quaternion.slice(); },
        get scale() { return scale.slice(); },
        get node() { return preview; },

        /** The untransformed cutter primitive at the current size. */
        mesh() {
            switch (shape) {
                case 'cylinder': return Mesh.cylinder(size.radius, size.height * 0.5, 24);
                case 'sphere':   return Mesh.sphere(size.radius, 24, 18);
                case 'cone':     return Mesh.cone(size.radius, size.height, 24);
                case 'torus':    return Mesh.torus(size.radius, size.radius * 0.35, 24, 16);
                default:         return Mesh.box(size.width * 0.5, size.height * 0.5, size.depth * 0.5);
            }
        },
        /** The cutter in world space, ready for the boolean. */
        transformedMesh() {
            const m = cutter.mesh();
            m.transform(trsMatrix(position, quaternion, scale));
            m.computeNormals();
            return m;
        },

        setShape(s) {
            if (!SHAPES.includes(s)) throw new Error('csg: no cutter shape ' + s);
            shape = s; rebuild();
        },
        setOp(o) { op = o; rebuild(); },
        /** Set width / height / depth / radius (metres). */
        setSize(key, v) { size[key] = v; rebuild(); },
        setGizmoMode(m) {
            mode = m;
            if (globalThis.bro && bro.gizmo) bro.gizmo.setMode(m);
        },
        /** Move to (x, y, z), snapped when snapping is on. */
        moveTo(p) {
            position = cutter.snap ? p.map(snapped) : p.slice();
            sync();
        },
        reset() {
            position = HOME.slice(); quaternion = [0, 0, 0, 1]; scale = [1, 1, 1];
            sync();
        },
    };

    function sync() {
        if (!preview) return;
        preview.position = position.slice();
        preview.quaternion = quaternion.slice();
        preview.scale = scale.slice();
    }
    function rebuild() {
        if (preview) preview.destroy();
        const color = OP_COLORS[op] || OP_COLORS.carve;
        preview = scene.createMesh({
            mesh: cutter.mesh(), color, emissive: 0.45, emissiveColor: color,
            roughness: 0.2, metallic: 0.1, castsShadow: false,
        });
        sync();
    }

    if (globalThis.bro && bro.gizmo) {
        bro.gizmo.show();
        bro.gizmo.setMode(mode);
        bro.gizmo.attach({
            position: () => position.slice(),
            orientation: () => quaternion.slice(),
            beginDrag: () => { dragPos = position.slice(); },
            endDrag: () => { dragPos = null; },
            translate: (dx, dy, dz) => {
                const base = dragPos || position;
                const next = [base[0] + dx, base[1] + dy, base[2] + dz];
                if (dragPos) dragPos = next;
                cutter.moveTo(next);
            },
            rotate: (qx, qy, qz, qw) => {
                quaternion = quatNorm(quatMul([qx, qy, qz, qw], quaternion));
                sync();
            },
            scale: (sx, sy, sz) => {
                scale = [scale[0] * sx, scale[1] * sy, scale[2] * sz].map((v) => Math.max(0.1, v));
                sync();
            },
        });
    }
    rebuild();
    return cutter;
}
