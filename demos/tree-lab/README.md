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
the ground is dappled as the mesh tree's is. A bark voxel's opacity is what
its wood covers: a branch of surface A in it covers A / (pi s^2) seen side
on, so a twig is a faint voxel rather than a beam a voxel thick, while a
stretch of trunk surface (its normals agreeing) is opaque. The 22 m oak at depth 6 is
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
only once wholly past the band, so no swap is seen; with every slot held, a
tree coming nearer stays voxels. The meshes draw a 1 x 2 segment leaf card,
five times cheaper than the lab's 3 x 5 and as light (bro.eye, calm). `maxDist`
ends the voxel trees that far off (0: never). `meshShadow: false` leaves a
mesh tree's shadow to its voxels, cached and not redrawn as the tree sways:
a millisecond cheaper with ten mesh trees, the shadows stepped at the
voxels' 0.17 m.

`speciesLevels` and `plantLod` (lod.js) draw the same laid-out forest as
the grown trees themselves at every distance, each tree a mesh node pair
(bark, leaves) at a level of detail picked by its distance: from 0, 40, 100
and 250 m the leaf cards are 3, 6, 12 and 24 times the lab's leaf with
1/L² as many (the crown's leaf area kept), and the branches thinner than
half a pixel where the level begins are dropped, the rest 6 to 3 sided and
mitred at the joints. Every level carries the tree's vegetation records,
so every tree at every distance sways and shades as foliage, and every
level casts. 726 trees on 600 m square: 1.8 ms from eye height, 1.7 from
30 m, 1.3 from 150 m, 1.1-1.4 from 1 km (GPU frame). `until` ends the
meshes there, each dithering out over [until, 1.35 until] (`fadeOutDist`).

`bakeImpostor` and `impostorNode` (impostor.js) draw trees past that as
impostors: each species baked once from 8 x 4 directions by an orthographic
camera through debug views at the leaf level the meshes hand over at (L24),
with the terms bro.scene's vegetation shading takes from the crown: albedo
darkened toward its centre with a lit rim, each leaf's normal turned to the
eye and leaning to the crown's bulk, and the occlusion of its ambient light;
coverage from a 4x finer capture. Each tree is one quad facing the eye that
samples the view nearest its direction in its own frame (mipmapped to the
pixel's footprint), tinted by the tree's own leaf tone, lit as foliage
(`s.leaf`) through the baked normal, and cut by its coverage against a
per-pixel dither; nearer than the band it collapses to nothing. The quad
sits 0.4 of the crown's radius toward the eye, where the leaves seen are.
`shadowProxyNode` casts their shadow: each species' crown as L48 cards
pulled into it and its limbs in one mesh, instanced over the trees as a
`shadowOnly` mesh (the shadow pass does not run the impostors' cut), each
shadow page drawing only the trees whose sphere reaches it
(`setInstanceCullSpheres`; without it every page drew all of them, 17 ms a
frame of page redraws while the camera moved). Measured on the same trees
as meshes and as impostors, the canopy's mean colour agrees within
0.87-1.19 per channel at noon, golden hour and dawn from 150 m and 600 m
up, after a blue gain of 0.87. With meshes to 250 m and impostors beyond,
9476 trees on a 3.2 km square cost 1.3 ms from eye height and 30 m, 0.8
from 150 m, 0.4 from 1 km, the impostors and their shadow 0.16-0.3 of it,
with the camera still.

Moving is another matter for the shadow. The mesh trees' level swaps
(`plantLod` destroys a tree's nodes and makes the next level's) redraw
the cached shadow pages they touch the frame they happen: a 25 m/s dolly at
eye height costs 3 ms a frame on average and 7 ms at worst, a climb from
30 m to 1 km 1.7 and 4.9. With the shadow cast by the proxies alone
(`plantLod`'s `castUntil: 0`) nothing the camera does changes a caster:
the dolly is 1.3 ms on average and 2.1 at worst, the climb 0.8 and 1.3.
But near the eye the proxies' cards cast large still blocks where the mesh
trees cast dappled, swaying light. The impostors do not sway.

## Files

```
index.html, main.js   page + entry: a button per species, time of day
lab.js                scene, sky, ground, the post; growSpecies, measureTree,
                      draw, clear, lookFrom
voxel.js              voxelTree: the tree as a voxeldag archetype and region
forest.js             growStand, layout, plant: a mixed stand, mesh near,
                      voxels beyond
lod.js                speciesLevels, plantLod: the grown trees at every
                      distance, reduced per level, all swaying
impostor.js           bakeImpostor, impostorNode, shadowProxyNode: far
                      trees as baked view-atlas quads and their shadow
sheet.js              runSheet: each species' size, a still from eye height,
                      and its GPU ms over the bare frame at given distances
```

A headless script runs the sheet:

```js
import { runSheet } from "/app/sheet.js";
runSheet({ names: ['oak'], seconds: [60], drawOpts: { scale: 2.6, leaf: 1.5 }, costAt: [20, 60, 150] });
```

`bro-headless demos/tree-lab that-script.js`; stills go to the app's cache dir.
