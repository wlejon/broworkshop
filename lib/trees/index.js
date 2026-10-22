// trees — a plants node's trees and shrubs as a module of their own: a
// crown of lobes over a trunk with a limb to each, its foliage leaves near
// the eye and broad daubs far off, bent by the wind, lit through from
// behind.
//
//   import { treeModule, treeSpecies } from "/lib/trees/index.js";
//   scene.createPlants({ module: treeModule(), species: MY_SPECIES.map(treeSpecies), rules });
//
// The engine owns where plants stand and how they are drawn (placement, the
// plan's element counts, the polygons and tubes, the light through the
// crown, the shadows, the probes); this module says what a plant is: the
// GLSL bro compiles into the plants node's shaders (the contract is bro's
// shaders/foliage/scene_plant_layer.glsl, the reference
// docs/vegetation-api.js "Plant modules"). A world with other things
// standing (coral, crystal spires, giant fungi) writes its own module.
//
//   crown.glsl.js    the lobes, a leaf element, the trunk and limbs, the sway
//   surface.glsl.js  a leaf's face and the light through it
//
// treeSpecies(opts) -> a createPlants species (the engine's fields and this
// module's data):
//   height, base, radius   the plant's height (m), where its crown starts (a
//                          fraction of it) and the crown's radius (m)
//   shape                  0 a round crown .. 1 a cone
//   lobes, lobeSize        how many clumps of foliage, and their size (of the radius)
//   leafLength, leafWidth  a leaf's length (m) and width (of its length)
//   elements               leaves at full detail
//   trunk                  the trunk's radius (m)
//   spread, droop          how far the lobes reach out; how much the leaves hang
//   light, dark            the foliage's colours, lit side and deep (linear rgb)
//   hueVariety             per plant and lobe colour shift
//   glow, glowColor        the light through the leaves from behind
//   bark                   the trunk's colour
//   density                how dense the crown is to light (1/m)
//   needle                 0 broad leaves .. 1 needle sprays

import { CROWN } from "./crown.glsl.js";
import { SURFACE } from "./surface.glsl.js";

export const SOURCE = CROWN + SURFACE;

export function treeModule() {
    return { source: SOURCE };
}

export function treeSpecies({
    height = 12, base = 0.3, radius = 4, shape = 0, lobes = 18, lobeSize = 0.42, leafLength = 0.22,
    leafWidth = 0.5, elements = 6000, trunk = 0.25, spread = 0.8, droop = 0.2, light = [0.32, 0.45, 0.10],
    hueVariety = 0.25, dark = [0.05, 0.10, 0.04], glow = 0.8, bark = [0.16, 0.12, 0.09], density = 0.6,
    glowColor = [1.0, 0.95, 0.4], needle = 0,
} = {}) {
    return {
        height, base, radius, shape, elements, leafLength, density,
        limbs: lobes,
        albedo: [0, 1, 2].map((i) => 0.5 * (light[i] + dark[i])),
        data: [
            lobeSize, leafWidth, trunk, spread,
            light[0], light[1], light[2], droop,
            dark[0], dark[1], dark[2], hueVariety,
            bark[0], bark[1], bark[2], glow,
            glowColor[0], glowColor[1], glowColor[2], needle,
        ],
    };
}
