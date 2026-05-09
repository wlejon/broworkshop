# flora

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

Each stage produces *morphologically distinct geometry*: a seed is a small
displaced sphere on the ground, a sprout is a tiny stem with cotyledons, a
juvenile is a small fractal of the mature form, mature is the headline shape,
flowering and fruiting layer reproductive structures on top of mature, and
senescent applies an autumn-tint shift and thins foliage.

The stage bar above the age slider shows which stages an archetype supports
(species can opt in/out of flowering and fruiting depending on whether bloom
or fruit colors are set). Click a stage label to jump straight to it.

## UI

- **Single** — one plant centered at the origin.
- **Forest** — Poisson-style placement of many plants with Voronoi canopy
  packing (crown shyness + lean toward open sky), plus per-instance species
  randomization (`mix = mixed-genus` or `random`) for natural variety.
- **▶ Cycle** — animates the age slider from 0 → 1 over ~12s, regenerating
  each frame so you can watch the plant grow through every life stage.

Parameter rows are grouped into collapsible sections (`general`,
`lifecycle`, `appearance`, `advanced`).

## Architecture

```
demos/flora/
├── index.html
├── app.js                # UI panel, single + forest modes, lifecycle preview
├── recipes/
│   ├── lifecycle.js      # STAGES, resolveStage
│   ├── core.js           # math, palette, morphological primitives
│   ├── species.js        # Species presets per archetype
│   ├── tree.js           # tree dispatcher + 8 stage builders
│   ├── conifer.js
│   ├── shrub.js
│   ├── rosebush.js       # the headline life-cycle archetype
│   ├── cactus.js
│   ├── palm.js
│   ├── flower.js
│   ├── grass.js
│   ├── fern.js
│   ├── succulent.js
│   ├── vine.js
│   └── index.js          # façade
└── test_lifecycle.js     # bro-headless validation script
```

Each archetype recipe is a stage dispatcher:

```js
function rosebush(opts) {
    if (opts.species) opts = applySpecies('rosebush', opts.species, opts);
    const r = resolveStage(STAGES, opts.age01);
    return BUILDERS[r.stage](opts, r.stageT);
}
```

Stage builders share a small library of morphological primitives in
`core.js` — `seedShape`, `cotyledonPair`, `firstTrueLeaves`, `bloomCluster`,
`fruitCluster`, `thornCluster`, `spineCluster`, `autumnTint` — so adding a
new archetype is mostly composition.

## Run

```
bro ../broworkshop/demos/flora
```

Drag in the viewport to orbit; right-drag (or shift-drag) to pan; scroll to
zoom. Sliders regenerate continuously.

## Validation

The full (archetype × species × stage) matrix can be checked headlessly:

```
bro-headless ../broworkshop/demos/flora ../broworkshop/demos/flora/test_lifecycle.js
```

Asserts that every combination produces a non-empty mesh under 1.5M
triangles, then writes a representative screenshot per archetype plus a
strip of all eight stages of the rose bush.
