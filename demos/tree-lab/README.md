# Tree Lab

bro.flora's tree species presets grown alone in a nursery world (cached under
the app's cache dir), drawn as branch tubes and a clumped leaf scatter that
bro.scene sways in its wind field, beside a 1.8 m post for scale.

The presets grow to 7–10 m broadleaves (oak, beech, elm, birch) and 11–23 m
conifers; growing longer barely adds height. `draw(world, { scale, leaf })`
sizes a tree at draw time: `scale` multiplies the whole plant (2.6 makes the
oak 18.7 m with a 0.91 m trunk and 7 m clear bole), `leaf` is the drawn
leaf's size against the grown one, the crown filled with proportionally more
leaves so it covers as before.

`MATURE_HEIGHT` is each species' mature height and `matureScale(name, m)`
the scale that stands a grown tree at it (a redwood 90 m, a pine 28 m); the
page draws every species at its mature height with 1.5x leaves.

`voxelTree(world, { scale, leaf, depth })` (voxel.js) voxelizes the same
tree, bark and leaf cards, into one bro.voxeldag archetype over its bounding
cube and stands it in a `foliage` region where the mesh tree stands (lit
two-sided, the sun through the leaves). Each leaf voxel's opacity is what
its leaves cover: leaf area A in a voxel of side s passes exp(-0.5 A / s^2)
of the light, so rays see sky through the crown and the region's shadow on
the ground is dappled as the mesh tree's is. The 22 m oak at depth 6 is
0.17 m voxels, 21k bricks; against the mesh tree (bro.eye compare) it holds
SSIM 0.91 at 60 m and 0.99 from 150 m, for 0.3-0.7 ms where the mesh tree
takes 1.5-3.5. The region is given the tree's plant (root, height and trunk
word from its vegetation records), so it sways in the wind as the mesh
tree's trunk does.

`growStand`, `layout` and `plant` (forest.js) make a forest: the mix of
species grown and voxelized once, the trees laid out by dart throwing so
each keeps clear of its neighbours' crowns by a share of their radii, every
tree a voxel tree in a region of its own (any position, turn and size). Up
to `slots` (8) mesh trees follow the camera (`update(eye)`, or `follow(vp)`
each frame): a tree coming within reach of the band [handoff, 1.35 handoff]
(30 m) takes a mesh, which dithers out over the band (`fadeOutDist`) as its
voxels dither in (`minDist`), pixel for pixel, and casts the tree's shadow
while it holds it (the region's `castShadow` off). A tree gives its mesh back
only once wholly past the band, so no swap is seen. The meshes draw a 1 x 2
segment leaf card, five times cheaper than the lab's 3 x 5.

## Files

```
index.html, main.js   page + entry: a button per species, time of day
lab.js                scene, sky, ground, the post; growSpecies, measureTree,
                      draw, clear, lookFrom
voxel.js              voxelTree: the tree as a voxeldag archetype and region
forest.js             growStand, layout, plant: a mixed stand, mesh near,
                      voxels beyond
sheet.js              runSheet: each species' size, a still from eye height,
                      and its GPU ms over the bare frame at given distances
```

A headless script runs the sheet:

```js
import { runSheet } from "/app/sheet.js";
runSheet({ names: ['oak'], seconds: [60], drawOpts: { scale: 2.6, leaf: 1.5 }, costAt: [20, 60, 150] });
```

`bro-headless demos/tree-lab that-script.js`; stills go to the app's cache dir.
