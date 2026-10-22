// sward — a grass node's blades as a module of their own: a meadow's leaves,
// dead leaves and flowering culms, tufted near the eye and fanned far off,
// bent by the wind and parted by movers, cut and lit per pixel on the GPU.
//
//   import { swardModule } from "/lib/sward/index.js";
//   scene.createGrass({ ..., sward: swardModule({ height: 0.4, tufts: 0.35 }) });
//
// The engine owns where a sward is drawn and how (the rings, the thinning,
// the hand-overs, the far tier, the turf, the lighting); this module says
// what the blades are: the GLSL bro compiles into the grass node's cover
// shaders (the contract is bro's shaders/ground/scene_sward_layer.glsl, the
// reference docs/vegetation-api.js "Sward"). A world with other ground cover
// (moss, kelp, crystal spines) writes its own module the same way.
//
//   stand.glsl.js    where a cell's blades rise and how thickly; the sward
//                    as the far tier's tufts and the turf take it
//   build.glsl.js    a blade: its kind, shape, bend and colour
//   surface.glsl.js  a blade cut to its leaves or its culm's head, and lit
//
// swardModule(opts) -> { source, data, height, tallest, reach }:
//   height       mean blade height (m)
//   lush, dry    the blades' colours, lush and sun-dried (linear rgb)
//   bulk         how much a far blade is lit as the sward rather than its face
//   clump        clump noise frequency (1/m)
//   rootShade    the root's colour, times the blade's
//   sheen        a gust's lift of the bent blades
//   variety      large-scale height variation, 0 .. 1
//   wind         wind response, times
//   tufts        0 a sward of many small tufts .. 1 bunch grass in tussocks
//   flowering    the share of tufts sending up a flowering culm
//   dead         the share of a tuft's leaves that are dead
//   minNormalY   no grass where the ground is steeper than this (or maxSlope, degrees)

import { STAND } from "./stand.glsl.js";
import { BUILD } from "./build.glsl.js";
import { SURFACE } from "./surface.glsl.js";

export const SOURCE = STAND + BUILD + SURFACE;

// A flowering culm stands up to about 4.8 x the mean height times the
// field's height multiplier (clump 1.4, tuft 1.15, tall patch 1.7, culm
// 1.75); a leaf 3.6.
const TALLEST = 4.8;
// A tussock gathers its blades from up to this far off their cell's spot,
// and a leaf leans and droops past its root (m).
const REACH = 0.35;

export function swardModule({
    height = 0.4, lush = [0.12, 0.17, 0.03], dry = [0.42, 0.31, 0.09], bulk = 0.72, clump = 0.21,
    rootShade = 0.45, sheen = 0.35, variety = 1.0, wind = 1.0, tufts = 0.35, flowering = 0.08, dead = 0.08,
    minNormalY, maxSlope,
} = {}) {
    const minY = typeof minNormalY === 'number' ? minNormalY
        : typeof maxSlope === 'number' ? Math.cos(maxSlope * Math.PI / 180) : 0.62;
    const data = new Float32Array([
        tufts, flowering, dead, minY,
        lush[0], lush[1], lush[2], bulk,
        dry[0], dry[1], dry[2], clump,
        rootShade, sheen, variety, wind,
    ]);
    return { source: SOURCE, data, height, tallest: height * TALLEST, reach: REACH };
}
