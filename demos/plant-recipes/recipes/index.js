// Façade — gathers everything the flora app needs from the recipes folder
// into a single set of globals.

import { Lifecycle } from "/app/recipes/lifecycle.js";
import { Species, FloraSpecies } from "/app/recipes/species.js";

export const Recipes = {};

// Re-export lifecycle constants for the UI.
Recipes.STAGES = Lifecycle.STAGES;
Recipes.STAGE_DEFAULT_AGES = Lifecycle.STAGE_DEFAULT_AGES;
Recipes.resolveStage = Lifecycle.resolveStage;
Recipes.Species = Species;
Recipes.speciesList = FloraSpecies.speciesList;
