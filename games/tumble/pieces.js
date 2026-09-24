// Tumble pieces — geometry, physics shape and palette metadata per type.
//
// World conventions: right-handed, Y-up, 1 cell = 1 world unit. Cell
// (cx, cy, cz) is centred at world (cx + 0.5, cy + 0.5, cz + 0.5), and a
// piece fills exactly that cell (ramps overshoot slightly so neighbours
// join). `rot` is 0..3, a multiple of 90° about +Y.
//
// build(scene, cellCentre, rot) creates the meshes + static Jolt bodies and
// returns { node, body, extras?, extraBodies?, anim? }.

import "/lib/camera.js";

const { quatFromAxis, quatMul } = globalThis.Camera;
const RAD2DEG = 180 / Math.PI;

export function rotY(rot) { return rot * Math.PI / 2; }

/** Quaternion about +Y as the {x,y,z,w} object Jolt wants. */
export function quatY(angle) {
    const s = Math.sin(angle * 0.5), c = Math.cos(angle * 0.5);
    return { x: 0, y: s, z: 0, w: c };
}

/** Booster shove direction (unit XZ) for rot 0..3: +X, +Z, -X, -Z. */
export function boosterDir(rot) {
    const yaw = rotY(rot & 3);
    return { x: Math.cos(yaw), z: Math.sin(yaw) };
}

/** Ramp downhill direction (unit XZ) for rot 0..3: -X, -Z, +X, +Z. */
export function rampDownhill(rot) {
    const r = rot & 3;
    if (r === 0) return { x: -1, z: 0 };
    if (r === 1) return { x: 0, z: -1 };
    if (r === 2) return { x: 1, z: 0 };
    return { x: 0, z: 1 };
}

function quatArrToObj(q) { return { x: q[0], y: q[1], z: q[2], w: q[3] }; }

// The scene node takes Euler angles applied as Z·Y·X, so "tilt in the body
// frame, then yaw" cannot be written as ry=yaw, rz=tilt (the tilt would stay
// in the world frame and vanish when the long axis yaws onto Z). Compose the
// quaternion instead and convert it to the engine's Euler order.
function quatToEuler(q) {
    const rx = Math.atan2(2 * (q[3] * q[0] + q[1] * q[2]), 1 - 2 * (q[0] * q[0] + q[1] * q[1]));
    const ry = Math.asin(Math.max(-1, Math.min(1, 2 * (q[3] * q[1] - q[2] * q[0]))));
    const rz = Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2]));
    return { rx: rx * RAD2DEG, ry: ry * RAD2DEG, rz: rz * RAD2DEG };
}

/** Yaw ∘ tilt-about-Z as a quaternion array. */
function tiltThenYaw(tilt, yaw) {
    return quatMul(quatFromAxis(0, 1, 0, yaw), quatFromAxis(0, 0, 1, tilt));
}

function staticBox(half, pos, extra) {
    return Physics.createBody(Object.assign({
        shape: "box", static: true, halfExtents: half, position: pos,
    }, extra));
}

export const PIECES = {
    block: {
        label: "Block", key: "1", color: "#5a6375", rotatable: false,
        describe: "Solid 1×1 cube. The staple floor/wall unit.",
        build(scene, cw) {
            const node = scene.createMesh({
                mesh: "box", halfW: 0.5, halfH: 0.5, halfD: 0.5,
                x: cw.x, y: cw.y, z: cw.z,
                color: "#5a6375", metallic: 0.05, roughness: 0.82,
            });
            // Slightly slick so marbles keep rolling across tops.
            const body = staticBox({ x: 0.5, y: 0.5, z: 0.5 }, cw, { friction: 0.22, restitution: 0.18 });
            return { node, body };
        },
    },

    ramp: {
        label: "Ramp", key: "2", color: "#6a8dbf", rotatable: true,
        describe: "Sloped plank. Rotation picks which way it points down.",
        build(scene, cw, rot) {
            // Steep and slick so marbles pick up speed instead of parking.
            const q = tiltThenYaw(34 * Math.PI / 180, rotY(rot));
            const e = quatToEuler(q);
            const node = scene.createMesh({
                mesh: "box", halfW: 0.58, halfH: 0.04, halfD: 0.45,
                x: cw.x, y: cw.y, z: cw.z, rx: e.rx, ry: e.ry, rz: e.rz,
                color: "#6a8dbf", metallic: 0.1, roughness: 0.6,
            });
            const body = staticBox({ x: 0.58, y: 0.04, z: 0.45 }, cw,
                { rotation: quatArrToObj(q), friction: 0.06, restitution: 0.2 });
            return { node, body };
        },
    },

    wall: {
        label: "Wall", key: "3", color: "#8b6ec4", rotatable: true,
        describe: "Thin vertical panel. Blocks one side of a cell.",
        build(scene, cw, rot) {
            // rot picks the cell face: 0 = +X, 1 = +Z, 2 = -X, 3 = -Z.
            const o = [{ x: 0.45, z: 0 }, { x: 0, z: 0.45 }, { x: -0.45, z: 0 }, { x: 0, z: -0.45 }][rot & 3];
            const alongX = (rot & 1) === 1;
            const half = { x: alongX ? 0.48 : 0.05, y: 0.4, z: alongX ? 0.05 : 0.48 };
            const pos = { x: cw.x + o.x, y: cw.y - 0.1, z: cw.z + o.z };
            const node = scene.createMesh({
                mesh: "box", halfW: half.x, halfH: half.y, halfD: half.z,
                x: pos.x, y: pos.y, z: pos.z,
                color: "#8b6ec4", metallic: 0.1, roughness: 0.7,
            });
            const body = staticBox(half, pos, { friction: 0.5, restitution: 0.25 });
            return { node, body };
        },
    },

    bumper: {
        label: "Bumper", key: "4", color: "#e25a8f", rotatable: false,
        describe: "Springy sphere. Bounces marbles in lively directions.",
        build(scene, cw) {
            const node = scene.createMesh({
                mesh: "sphere", radius: 0.32, segments: 20, rings: 16,
                x: cw.x, y: cw.y, z: cw.z,
                color: "#e25a8f", metallic: 0.15, roughness: 0.35,
                emissive: 0.6, emissiveColor: [1.0, 0.4, 0.7],
            });
            const body = Physics.createBody({
                shape: "sphere", static: true, radius: 0.32,
                position: cw, friction: 0.1, restitution: 0.92,
            });
            return { node, body };
        },
    },

    spinner: {
        label: "Spinner", key: "5", color: "#5acc88", rotatable: true,
        describe: "Kinematic paddle. Whacks marbles along.",
        build(scene, cw, rot) {
            // A static body re-rotated every tick (see marbles.js); Jolt treats
            // it as moving, which is plenty at this scale.
            const node = scene.createMesh({
                mesh: "box", halfW: 0.46, halfH: 0.15, halfD: 0.07,
                x: cw.x, y: cw.y, z: cw.z, ry: rot * 90,
                color: "#5acc88", metallic: 0.25, roughness: 0.45,
                emissive: 0.25, emissiveColor: [0.5, 1.0, 0.7],
            });
            const body = staticBox({ x: 0.46, y: 0.15, z: 0.07 }, cw,
                { rotation: quatY(rotY(rot)), friction: 0.5, restitution: 0.5 });
            return { node, body, anim: { kind: "spinner", rot, phase: 0 } };
        },
    },

    booster: {
        label: "Booster", key: "6", color: "#ffc34a", rotatable: true,
        describe: "Conveyor pad. Any marble on top is shoved along its arrow.",
        build(scene, cw, rot) {
            const pos = { x: cw.x, y: cw.y - 0.42, z: cw.z };
            const node = scene.createMesh({
                mesh: "box", halfW: 0.45, halfH: 0.05, halfD: 0.45,
                x: pos.x, y: pos.y, z: pos.z, ry: rot * 90,
                color: "#ffc34a", metallic: 0.05, roughness: 0.35,
                emissive: 0.5, emissiveColor: [1.0, 0.75, 0.2],
            });
            const body = staticBox({ x: 0.45, y: 0.05, z: 0.45 }, pos,
                { rotation: quatY(rotY(rot)), friction: 0.35, restitution: 0.08 });
            // Dark stripe on top shows the shove direction.
            const arrow = scene.createMesh({
                mesh: "box", halfW: 0.22, halfH: 0.02, halfD: 0.05,
                x: cw.x, y: cw.y - 0.34, z: cw.z, ry: rot * 90,
                color: "#1a1209", metallic: 0.0, roughness: 0.95,
            });
            return { node, body, extras: [arrow] };
        },
    },

    chute: {
        label: "Chute", key: "7", color: "#4ec2d6", rotatable: false,
        describe: "Downward funnel — four angled ramps converging to the centre.",
        build(scene, cw) {
            // Four slabs, outer edge up, yawed to face N/E/S/W: an inverted pyramid.
            const nodes = [], bodies = [];
            const half = { x: 0.48, y: 0.03, z: 0.22 };
            for (let i = 0; i < 4; i++) {
                const a = i * Math.PI / 2;
                const q = tiltThenYaw(-34 * Math.PI / 180, a);
                const e = quatToEuler(q);
                const pos = { x: cw.x + Math.cos(a) * 0.28, y: cw.y - 0.05, z: cw.z + Math.sin(a) * 0.28 };
                nodes.push(scene.createMesh({
                    mesh: "box", halfW: half.x, halfH: half.y, halfD: half.z,
                    x: pos.x, y: pos.y, z: pos.z, rx: e.rx, ry: e.ry, rz: e.rz,
                    color: "#4ec2d6", metallic: 0.2, roughness: 0.4,
                }));
                bodies.push(staticBox(half, pos,
                    { rotation: quatArrToObj(q), friction: 0.22, restitution: 0.1 }));
            }
            return { node: nodes[0], extras: nodes.slice(1), body: bodies[0], extraBodies: bodies.slice(1) };
        },
    },
};

/** Palette order; hotkeys 1..7 index into the level's available subset. */
export const PIECE_ORDER = ["block", "ramp", "wall", "bumper", "spinner", "booster", "chute"];
