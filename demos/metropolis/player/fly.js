// Fly camera: WASD across, Space / C up and down, Shift faster, drag to look.
// Speed grows with height above the ground, so a street and a flyover both feel right.

import { terrainHeight } from "/app/world/terrain_field.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createFlyCamera(canvas, scene, { fov = 58 } = {}) {
    const pos = [0, 100, 0], fwd = [0, 0, -1], up = [0, 1, 0];
    let yaw = 0, pitch = 0, dragging = false;
    const keys = new Set();
    window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
    canvas.addEventListener('mousedown', () => { dragging = true; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        yaw -= (e.movementX || 0) * 0.003;
        pitch = clamp(pitch - (e.movementY || 0) * 0.003, -1.5, 1.5);
    });

    function push() {
        const cp = Math.cos(pitch);
        fwd[0] = -Math.sin(yaw) * cp; fwd[1] = Math.sin(pitch); fwd[2] = -Math.cos(yaw) * cp;
        scene.setCamera({
            fov, near: 0.2, far: 16000, position: pos,
            target: [pos[0] + fwd[0] * 50, pos[1] + fwd[1] * 50, pos[2] + fwd[2] * 50], up,
        });
    }

    function update(dt) {
        const agl = Math.max(1, pos[1] - terrainHeight(pos[0], pos[2]));
        const speed = (keys.has('shift') ? 4 : 1) * clamp(agl * 1.2, 6, 900);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        const r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        const u = (keys.has(' ') ? 1 : 0) - (keys.has('c') ? 1 : 0);
        pos[0] += (fwd[0] * f + rx * r) * speed * dt;
        pos[1] += (fwd[1] * f + u) * speed * dt;
        pos[2] += (fwd[2] * f + rz * r) * speed * dt;
        pos[1] = Math.max(pos[1], terrainHeight(pos[0], pos[2]) + 1.6);
        push();
    }

    return {
        update,
        setPose(p, y, pt) { pos[0] = p[0]; pos[1] = p[1]; pos[2] = p[2]; yaw = y; pitch = pt; push(); },
        state: () => ({ pos: [...pos], fwd: [...fwd], up: [...up], yaw, pitch, fov }),
    };
}
