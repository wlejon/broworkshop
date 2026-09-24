// arena.js — the static stage: a fixed top-down camera over a floor, an
// inner mat so motion reads against the ground, and four corner pillars.
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";

export const ARENA = 9;   // players are clamped to [-ARENA, ARENA] on x/z

// Camera at (0, 17, 14.5) looking at the origin. It stays fixed: WASD is
// screen-aligned, so orbiting would turn "up" into some other direction.
const CAM_H = 17, CAM_BACK = 14.5;

export function buildArena(canvas) {
    const vp = sceneViewport(canvas, {
        orbit: {
            target: [0, 0, 0], dist: Math.hypot(CAM_H, CAM_BACK), fov: 50,
            rot: orbitRotation(0, -Math.atan2(CAM_H, CAM_BACK)),
        },
        controls: false,
    });
    const scene = vp.scene;
    scene.setAmbient([0.10, 0.11, 0.13]);
    scene.setToneMap({ mode: 'aces', exposure: 1.1 });
    scene.createLight({
        type: 'directional', direction: [-0.45, -1.0, -0.35],
        color: [1.0, 0.97, 0.9], intensity: 2.6,
    });

    scene.createMesh({
        mesh: 'plane', halfW: ARENA + 1, halfD: ARENA + 1, y: 0,
        color: '#262c38', metallic: 0.0, roughness: 0.9,
    });
    scene.createMesh({
        mesh: 'plane', halfW: ARENA - 1.5, halfD: ARENA - 1.5, y: 0.02,
        color: '#303848', metallic: 0.0, roughness: 0.85,
    });
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        scene.createMesh({
            mesh: 'box', halfW: 0.35, halfH: 1.2, halfD: 0.35,
            x: px * ARENA, y: 1.2, z: pz * ARENA,
            color: '#3d4a63', metallic: 0.1, roughness: 0.6,
        });
    }
    return vp;
}
