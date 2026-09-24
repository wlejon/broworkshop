# Plant Recipes

Procedural plant viewer with full life-cycle stages and species presets.
Composes bromesh primitives in JS to build eleven archetypes:

| Archetype  | Sub-categories (species) |
|------------|--------------------------|
| **tree**       | oak, maple, birch, willow, cherry, ginkgo, poplar, baobab, magnolia, jacaranda |
| **conifer**    | pine, spruce, fir, cedar, juniper, redwood, cypress |
| **shrub**      | boxwood, lavender, hydrangea, holly, hibiscus |
| **rosebush**   | tea, climbing, shrub, miniature, wild |
| **flower**     | daisy, sunflower, tulip, lily, poppy, daffodil, cosmos |
| **cactus**     | barrel, prickly-pear, saguaro, hedgehog |
| **palm**       | coconut, date, fan |
| **vine**       | ivy, grape, morning-glory, wisteria |
| **fern**       | sword, lady, ostrich, maidenhair |
| **grassTuft**  | fescue, ryegrass, pampas, sedge |
| **succulent**  | echeveria, agave, sedum, aloe |

## Life cycle

The age slider [0..1] maps onto a per-archetype list of stages:

```
seed → sprout → seedling → juvenile → mature → flowering → fruiting → senescent
```

Each stage produces morphologically distinct geometry: a seed is a small
displaced sphere on the ground, a sprout a tiny stem with cotyledons, a
juvenile a small fractal of the mature form; flowering and fruiting layer
reproductive structures on top of mature, and senescent tints and thins.

The stage bar shows the stages the current archetype + species supports (a
species opts out of flowering / fruiting by having no bloom / fruit colour);
click a stage to jump to it. **Cycle** sweeps the age 0 → 1 over 12 s.

## UI

- **Single**: one plant at the origin. **Forest**: many plants of one
  archetype with Voronoi canopy packing and per-instance species mixing.
- Parameters are grouped into fold panels (General, Life cycle, Appearance,
  Advanced, Forest). Picking a species loads its preset into the panel.
- The time-of-day bar (studio, dawn, noon, golden, night) is the shared
  `daylight()` rig from `lib/kit/sky.js`.
- Left-drag orbits, right-drag pans, the wheel zooms.

## Files

```
index.html, main.js   page + entry (thin)
lab.js                viewport, sky, ground, state, regenerate, the panel
schema.js             per-archetype parameter rows and groups
forest.js             forest layout (deterministic per seed)
recipes/
  lifecycle.js        STAGES, resolveStage, defineArchetype
  core.js             math, palette, morphological primitives
  species.js          species presets, applySpecies
  tree.js ... vine.js one archetype each: stage builders + defineArchetype
  index.js            ARCHETYPES and the public names
tests/test_lifecycle.js
```

An archetype is its stage builders plus the stages it supports:

```js
export const rosebush = defineArchetype('rosebush', BUILDERS, stagesOf);
rosebush(opts)          // species preset applied, stage resolved from opts.age01
rosebush.stages(opts)   // what the stage bar shows
```

Stage builders share the primitives in `core.js` (`seedShape`,
`cotyledonPair`, `firstTrueLeaves`, `bloomCluster`, `fruitCluster`,
`thornCluster`, `spineCluster`, `autumnTint`), so a new archetype is mostly
composition.

## Validation

```
scripts/validate.sh demos/plant-recipes
```

Builds every archetype × species × stage combination (non-empty, under 1.5M
triangles), drives the panel, and saves screenshots.
