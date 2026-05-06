# flora

Procedural plant viewer. Composes bromesh primitives in JS to build eight
archetypes — tree, conifer, shrub, vine, fern, grassTuft, succulent, flower —
with per-archetype controls and a forest-placement mode.

## Modes

- **Single** — one plant centered at the origin. Switch archetype via the
  dropdown; sliders regenerate in place.
- **Forest** — Poisson-style placement of many plants on a square patch with
  a Voronoi-style canopy packing pass (crown shyness + lean toward open
  sky). Forest controls live above the per-archetype block.

## Recipes

Each archetype is a function in `recipes.js` returning
`{ parts: [{ mesh, color, metallic?, roughness? }], aabbMin, aabbMax }`.
The app spawns one scene node per part. Recipes compose:

- **tree** — trunk + recursive angular-cluster branches via
  `Mesh.meshBranches`, plus a canopy. The canopy is either noise-displaced
  blob spheres (`foliageStyle: 'blobs'`, default) or real instanced cards
  via `Mesh.scatterLeaves` on the branch tree (`foliageStyle: 'leaves'`).
- **conifer** — thin trunk + stacked translucent cones via `Mesh.sweep`.
- **shrub** — clump of noise-displaced spheres.
- **vine** — helical `Mesh.sweep` stem with leaf blobs along the path.
- **fern** — curved rachis with paired leaflets, all `Mesh.sweep` strokes.
- **grassTuft** — bent blade strokes via `Mesh.sweep`.
- **succulent** — phyllotactic ring of swept leaves.
- **flower** — `Mesh.bezierSweep` stem + `Mesh.flower` head + two
  `Mesh.leafCard` leaves clipped to the stem.

## Run

```
bro demos/flora
```

Drag in the viewport to orbit; right-drag (or shift-drag) to pan; scroll to
zoom. Sliders regenerate continuously; the seed input and Reseed button
reroll the underlying RNG.
