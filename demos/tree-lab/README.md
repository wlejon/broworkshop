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
camera through debug views with L6 leaves (finer than the L24 meshes they
follow: larger cards fill the gaps between a crown's leaves that the
grown tree leaves open, and a forest of them hides too much of the ground),
with the terms bro.scene's vegetation shading takes from the crown: albedo
darkened toward its centre with a lit rim, each leaf's normal turned to the
eye and leaning to the crown's bulk, and the occlusion of its ambient light;
coverage from a 4x finer capture, each sample counting the share of it a
leaf covers. Each tree is one quad facing the eye that
samples the view nearest its direction in its own frame (mipmapped to the
pixel's footprint), tinted by the tree's own leaf tone, lit as foliage
(`s.leaf`) through the baked normal with the mesh leaves' bounce from
inside the crown (`occluder_sun` 0.5), and cut by 0.8 of its coverage
against a per-pixel dither; nearer than the band it collapses to nothing. The quad
sits 0.4 of the crown's radius toward the eye, where the leaves seen are.
`shadowProxyNode` casts their shadow: each species' crown as L12 cards at
half its leaf area and its limbs in one mesh, instanced over the trees as a
`shadowOnly` mesh (the shadow pass does not run the impostors' cut), each
shadow page drawing only the trees whose sphere reaches it
(`setInstanceCullSpheres`; without it every page drew all of them, 17 ms a
frame of page redraws while the camera moved). Against the truth (the
same 2282 trees all drawn at L3, casting their own shadow, in wind), the
impostors with their proxies give the frame's mean linear colour within
0.91-1.06 per channel at noon and golden hour from 150 m and 600 m up
(blue gain 0.95; the 0.8 coverage and the L6 bake were swept for it: L24
and full coverage were 0.80 at 600 m, noon). plantLod's meshes alone are
0.84-0.98 from 600 m: their L24 cards cover too much as well. With meshes to 250 m and impostors beyond,
9476 trees on a 3.2 km square cost 1.3 ms from eye height and 30 m, 0.8
from 150 m, 0.4 from 1 km, the impostors and their shadow 0.16-0.3 of it,
with the camera still.

The shadow is split between them by bro.scene's `shadowRange`. The mesh
trees cast `near` (`plantLod`'s `castRange`): into the sway level's
overlays, some 30 m around the eye, redrawn each frame and held in no
cached page, so they sway and their level swaps (`plantLod` destroys a
tree's nodes and makes the next level's) redraw nothing. The proxies cast
`far`: the cached pages past the sway level. With the mesh trees casting
everywhere instead, each swap redraws the cached pages it touches the frame
it happens: a 25 m/s dolly at eye height costs 3 ms a frame on average and
7 ms at worst, a climb from 30 m to 1 km 1.7 and 4.9. Split, the dolly is
1.3 ms on average and 1.4 at worst, the climb 0.75 and 1.2, and the ground
under the trees matches the mesh trees' own shadow within 0.97-1.06 from
eye height, 30 m and 150 m. The impostors do not sway.

On the CPU, each species' level is a `scene.createGeometry` made once
(`speciesLevels`), so a swap makes two nodes and uploads nothing; making
each node copy and upload its own mesh cost about 4 ms a swap. The dolly's
frames take 0.62 ms of CPU on average and 1.34 at worst (0.3 of it
`plantLod`'s pass over the 9476 trees; the worst is a run's first frame
or two), the climb's 0.48 and 1.31.

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
