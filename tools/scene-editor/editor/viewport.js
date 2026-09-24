// The 3D viewport: scene canvas, orbit camera with the kit's standard mouse
// controls, editor lighting, the ground grid + axes, and screen -> world
// rays for picking.

import { orbitControls, orbitRotation, screenRay, Camera } from "/lib/kit/viewport3d.js";
import { SceneAxes } from "../model/scene-axes.js";

/**
 * opts: { onCamera() after every camera change, acceptOrbit(e) (see
 * orbitControls' accept) }.
 */
export function createViewport(canvas, opts) {
    const o = opts || {};
    const scene = canvas.getContext('scene');
    // Three-quarter view from above, so the default box shows three faces.
    const cam = Camera.createOrbit({ target: [0, 0, 0], dist: 7, fov: 45, rot: orbitRotation(0.6, -0.45) });

    const view = () => Camera.orbitViewOpts(cam, canvas);
    const size = () => [canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height];
    const apply = () => {
        scene.setCamera(view());
        if (o.onCamera) o.onCamera();
    };

    // Editor look: evenly lit from every side, no shadows. High ambient gives
    // each face a readable base colour; a soft key + fill add just enough
    // shading to read shape. Linear tonemap keeps authored colours faithful.
    scene.setToneMap({ mode: 'linear', exposure: 1.0, gamma: 2.2 });
    scene.setAmbient([0.55, 0.56, 0.58]);
    scene.createLight({ type: 'directional', direction: [-0.4, -1.0, -0.3],
        color: [1.0, 0.98, 0.94], intensity: 0.7, name: 'editor-key' });
    scene.createLight({ type: 'directional', direction: [0.5, -0.3, 0.6],
        color: [0.88, 0.92, 1.0], intensity: 0.4, name: 'editor-fill' });

    // Ground grid + XYZ axes: a static mesh outside the registry, so it never
    // takes part in picking or snapping.
    const axes = SceneAxes.buildSceneAxes();
    const axesNode = scene.createMesh({
        positions: axes.positions, normals: axes.normals, colors: axes.colors,
        indices: axes.indices, name: 'scene-axes',
    });

    const controls = orbitControls(canvas, cam, { minDist: 0.1, onChange: apply, accept: o.acceptOrbit });

    return {
        canvas, scene, cam, controls, axesNode,
        apply,
        /** scene.setCamera options for the current orbit. */
        view,
        /** Canvas size in CSS pixels, [w, h]. */
        size,
        /** Canvas-relative position of a mouse event. */
        point(e) {
            const r = canvas.getBoundingClientRect();
            return { cx: e.clientX - r.left, cy: e.clientY - r.top };
        },
        /** World ray through canvas pixel (cx, cy). */
        ray(cx, cy) {
            const [w, h] = size();
            return screenRay(view(), w, h, cx, cy);
        },
        /** Unit camera forward. */
        forward() {
            const v = view();
            const f = [v.target[0] - v.position[0], v.target[1] - v.position[1], v.target[2] - v.position[2]];
            const L = Math.hypot(f[0], f[1], f[2]) || 1;
            return [f[0] / L, f[1] / L, f[2] / L];
        },
    };
}
