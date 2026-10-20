// biomes entry: the view and the sky. The world is built here as the
// engine's plant mechanisms land in bro.
import { boot } from "/lib/kit/index.js";
import { sceneViewport, orbitRotation } from "/lib/kit/viewport3d.js";
import { daylight } from "/lib/kit/sky.js";

boot();

export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 4, 0], dist: 60, fov: 50, near: 0.1, far: 4000, rot: orbitRotation(Math.PI * 0.75, -0.3) },
    controls: { orbitButton: 0, panButton: 2, minDist: 1, maxDist: 2000 },
});
export const { scene } = vp;
export const sky = daylight(scene, { cascades: 3, atlas: 4096, pcf: 3 });
