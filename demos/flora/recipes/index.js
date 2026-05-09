// Façade — gathers everything the flora app needs from the recipes folder
// into a single set of globals.

(function (root) {

const Recipes = root.Recipes || (root.Recipes = {});

// Re-export lifecycle constants for the UI.
Recipes.STAGES = root.Lifecycle.STAGES;
Recipes.STAGE_DEFAULT_AGES = root.Lifecycle.STAGE_DEFAULT_AGES;
Recipes.resolveStage = root.Lifecycle.resolveStage;
Recipes.Species = root.Species;
Recipes.speciesList = root.FloraSpecies.speciesList;

})(this);
