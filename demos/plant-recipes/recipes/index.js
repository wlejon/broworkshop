// The recipe catalogue: every archetype's builder, keyed by name.
//
//   ARCHETYPES.tree({ species: 'oak', age01: 0.6, seed: 1 })  -> { parts, aabbMin, aabbMax }
//   ARCHETYPES.tree.stages({ species: 'cherry' })              -> the stages it supports
//
// A part is { mesh, color, metallic?, roughness?, twoSided? }.

import { tree, CANOPY_SHAPES } from "/app/recipes/tree.js";
import { conifer } from "/app/recipes/conifer.js";
import { shrub } from "/app/recipes/shrub.js";
import { grassTuft } from "/app/recipes/grass.js";
import { vine } from "/app/recipes/vine.js";
import { fern } from "/app/recipes/fern.js";
import { succulent } from "/app/recipes/succulent.js";
import { flower } from "/app/recipes/flower.js";
import { rosebush } from "/app/recipes/rosebush.js";
import { cactus } from "/app/recipes/cactus.js";
import { palm } from "/app/recipes/palm.js";

export const ARCHETYPES = { tree, conifer, shrub, grassTuft, vine, fern, succulent, flower, rosebush, cactus, palm };

export { CANOPY_SHAPES };
export { STAGES, resolveStage } from "/app/recipes/lifecycle.js";
export { Species, speciesList } from "/app/recipes/species.js";
