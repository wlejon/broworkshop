// TripoSplat Lab — the 3D viewport: one GaussianSplatNode in a kit
// sceneViewport. Left-drag orbits (right too), middle-drag pans, the wheel
// zooms. The scene FBO clears transparent, so the canvas's CSS background
// shows through (the light / dark toggle is pure CSS).

import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";

const DEFAULT_DIST = 2.2;
const Camera = globalThis.Camera;

/** Handle: setCloud(cloud), hasCloud(), splatCount(), savePly(path), autoRotate, setScale(s), reset(), vp. */
export function splatViewport(target) {
    const vp = sceneViewport(target, {
        orbit: { target: [0, 0, 0], dist: DEFAULT_DIST, fov: 45, rot: orbitRotation(0.5, -0.22) },
        controls: { orbitButton: 0, panButton: 1, minDist: 0.3, maxDist: 10 },
    });
    let node = null, bb = null, scale = 1;
    const api = { autoRotate: true, vp };

    // Frame the whole cloud, keeping the current orientation.
    function reframe() {
        const pivot = bb ? [bb.cx * scale, bb.cy * scale, bb.cz * scale] : [0, 0, 0];
        vp.reframe(pivot, bb ? Math.max(0.4, bb.ext * scale * 1.7) : DEFAULT_DIST);
    }

    // ~0.45 rad/s about world +Y while idle.
    vp.onFrame((dt) => {
        if (api.autoRotate && node && !(vp.controls && vp.controls.dragging)) {
            Camera.orbitLook(vp.cam, -(0.45 * dt) / vp.cam.yawSpeed, 0);
        }
    });

    function bounds(cloud) {
        const p = cloud && cloud.positions;
        if (!p || !p.length) return null;
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < p.length; i += 3) {
            for (let a = 0; a < 3; a++) { const v = p[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
        }
        return { cx: (mn[0] + mx[0]) / 2, cy: (mn[1] + mx[1]) / 2, cz: (mn[2] + mx[2]) / 2,
                 ext: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1 };
    }

    api.setCloud = (cloud) => {
        if (node) { node.destroy(); node = null; }
        bb = bounds(cloud);
        node = vp.scene.createGaussianSplat({ name: 'splat', cloud, scale });
        reframe();
    };
    api.hasCloud = () => !!node;
    api.splatCount = () => (node ? node.splatCount : 0);
    api.savePly = (path) => {
        if (!node) throw new Error('nothing to save');
        return node.savePly(path);
    };
    api.setScale = (s) => {
        scale = Number.isFinite(s) && s > 0 ? s : 1;
        if (node) { node.scaleX = scale; node.scaleY = scale; node.scaleZ = scale; }
        reframe();
    };
    // The default front three-quarter view, re-framed.
    api.reset = () => { vp.cam.rot = orbitRotation(0.5, -0.22); reframe(); };
    api.node = () => node;
    return api;
}
