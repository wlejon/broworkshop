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
(bark, leaves) at a level of detail picked by its distance: from 0, 40, 90
and 150 m the leaf cards are 3, 6, 12 and 24 times the lab's leaf with
1/L² as many, times the share of the leaf area that leaves the crown
covering what the L3 level covers (measured per species from three
directions: a birch keeps 0.43 of it at L24, an oak 0.72), and the branches thinner than
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
leaf covers. Each tree is one octagon facing the eye (all of a species'
octagons in one mesh, each vertex's uv naming its tree and corner, the
vertex hook building it from the tree's record): the bake's octagon round
the crown of the view the tree is seen in (its extent in x, y and both
diagonals, 0.46-0.58 of the view's square), mapped through the quad's
axes in that view's so each corner lands on its texel. It
samples the view nearest its direction in its own frame (mipmapped to the
pixel's footprint), tinted by the tree's own leaf tone, lit as foliage
(`s.leaf`) through the baked normal with the mesh leaves' bounce from
inside the crown (`occluder_sun` 0.5), and drawn with its coverage as the
share of each pixel's samples it covers (bro.scene's `alphaToCoverage`,
under the lab's 4x MSAA), so a thin crown resolves as the grown tree's
sub-pixel leaves do, a blend with what is behind it, not a speckle.
Seen from the side the coverage is pulled apart around 0.35 by 2.5 (its
clumps opaque, its thin parts clear: the grown crowns read as solid shapes
with ground between them there), and from above (20 to 50 degrees up,
fading) it is as baked, times 0.8, as the grown crowns are seen through;
nearer than the band, or past its far fade, it collapses to nothing. The quad
sits 0.4 of the crown's radius toward the eye, where the leaves seen are.
`shadowProxyNode` casts their shadow: each species' crown as L12 cards at
0.4 of its leaf area and its limbs in one mesh, instanced over the trees as a
`shadowOnly` mesh (the shadow pass does not run the impostors' cut), each
shadow page drawing only the trees whose sphere reaches it
(`setInstanceCullSpheres`; without it every page drew all of them, 17 ms a
frame of page redraws while the camera moved). Against the truth (the
same 2282 trees all drawn at L3, casting their own shadow, in wind), the
mesh trees to 250 m with impostors and proxies beyond give the frame's
mean linear colour within 0.94-1.08 per channel at noon, golden hour and
dawn from 30 m, 150 m and 600 m up, the ground alone 0.96-1.03. By rings of
ground distance seen from 12 and 30 m up, the rings either side of the
250 m handoff (230-340 m) are within 0.93-1.06, as near as the meshes'
own rings inside it (0.93-1.08): the handoff adds no step of its own.

`saveImpostor(imp, dir, name, height)` writes a bake for another app to
draw: two PNG atlases, the views tiled 8 across and 4 down (`<name>_albedo`:
the albedo's square root and the coverage; `<name>_normal`: the normal and
the crown's occlusion), and `<name>.json` with the box, the grown height and
each view's octagon. The page draws a tree of its own at the origin, so a
script baking clears it first (`clear()`), or it is baked into every view.
Against the meshes' own shadow (every level casting, no proxies) the
proxies' ground is 0.996, 1.025 and 1.045 from 2, 30 and 150 m up. No
one cover holds from 1.5 km up too: 0.4 there left the golden-hour
ground at 0.76-0.87 of the truth's, 0.25 put it right but lifted golden
hour from 600 m to 1.17. So the proxies thin with distance: 0.08 of the
cards and the limbs on every tree, the rest dropping out tree by tree
from 700 to 1600 m from the eye (`setInstanceCullSpheres`'s maxDistance
and fade). A cached page keeps the trees it was drawn with, and the sun's
clipmap levels are centred on the eye, so the coarse levels, drawn far
from it, take the thinner shadow. With the 150 m handoff the frame is
then 0.92-1.10 of the truth from 30 m, 150 m, 600 m and 1.5 km up at
noon, golden hour and dawn. Thinning the cards in a vertex hook instead
did as well but made the page draws five times dearer (a 7 ms frame when
the dolly began). The impostors'
0.8 coverage and L6 bake, their blue gain of 0.95 and the proxies' 0.4
were swept for it: with an L24 bake at full coverage the frame was 0.80
from 600 m at noon, and plantLod's meshes at full leaf area alone were
0.84-0.98 from there. Each mesh level's leaf area is measured against the
finest level's coverage (`speciesLevels`). Cut against a per-pixel dither
instead of covering samples, the impostors matched the frame's mean as
well but read as an even speckled carpet past 300 m where the grown trees
stand apart; the side contrast was found looking at 1:1 crops of that
field. The side contrast holds only while the mip sampled still resolves
the crown's clumps (fading out between mips 1.5 and 3): coarser, a texel's
alpha is the crown's mean, which pulled apart made the forest fade out
from 2 km up. With meshes to 250 m and impostors beyond,
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
1.34 ms on average and 1.43 at worst, the climb 0.86 and 1.32, with the
ground's agreement above. The impostors do not sway.

`canopyNode` (canopy.js) draws the forest past the impostors (their
`until`, dithering out over [until, 1.35 until] as it dithers in): one
quad over the forest's ground at its crowns' mean height, textured with 4 m
cells of what the trees cover seen from above (each tree's coverage by
radius from its bake's top views, a cell's coverage 1 - prod(1 - a) of the
trees over it, times 1.2) and the colour covering it, mipmapped, lit as
foliage facing up. Seen at a slant the crowns' sides hide the gaps between
them, so its coverage is that of a layer 1 + 2 (1 / sin(elevation) - 1)
as deep. Past a
few kilometres a crown is a few pixels and the impostors spend their quads
on sub-pixel triangles that hit the pixels' samples less and less: from 8
km up the impostor forest had faded into the ground, from 20 km it was
gone. Its coverage and slant were swept against the truth (4934 trees on 2
km all at L3, with the layer alone in their place and the proxies' shadow):
from 3 km up the frame is 0.99-1.02 at noon, 1.02-1.09 at golden hour and
0.90-0.91 at dawn; from 1.5 km, where the impostors still have most of the
frame, 1.06-1.10, 0.90-0.94 and 0.79-0.82 (the proxies' shadow above). A
normal leaning toward the sun, or the half way between sun and eye, put the
noon and dawn errors right only by making golden hour 1.2-1.5. `hideBeyond` hides
the impostor nodes while the eye is farther than their band from the whole
forest, so they cull nothing up there. A climb from 2 m to 40 km in 15 s
over 55754 trees on a 6 km square (meshes to 250 m, impostors to 3 km, the
layer beyond): 2.0 ms mean below 30 m (2.6 worst), 1.0 to 300 m, 1.35 to 3
km (2.7 worst, the proxies' shadow pages redrawing), 0.6 to 10 km, 0.33
above, in the page's view. At 2560 x 1364 with the 150 m handoff and the
impostors as one mesh: 2.55 ms mean below 30 m (2.83 at the 95th
percentile), 1.56 to 300 m (1.93), 1.46 to 3 km (2.00), 0.57 to 10 km
(1.01), 0.22 above (0.25). Its worst frames (3-4 ms, from 600 m up) are
shadow pages drawn while the world service's budget was its 8 ms for
settling a new view: above there the climb moves the eye more than 10 m
a frame (3.6 km/s at 360 fps), the distance the engine takes for a jump
to a new view. The same climb in 45 s (under 10 m a frame to 2 km up)
keeps the budget at the frames' slack, about 1.3 ms, and its worst frame
from 300 m to 3 km is 2.84 ms (1.36 mean, 1.64 at the 95th percentile). Its texture takes 2 s to
make for that square. A 25 m/s dolly at eye
height through that forest (some 580 mesh trees within reach) is 2.13-2.19
ms on average, 2.2-2.25 at the 95th percentile and 2.3-3.5 at worst, in
the page's 1620 x 970 view. With the view at 2560 x 1364 (`--width 2860
--height 1470`) it is 3.2-3.6 ms on average and 3.3-4.0 at the 95th
percentile when the impostors were instanced quads and the trees handed to
them at 250 m (the mesh trees' vegetation pass 1.5 ms of it, the impostors
0.8 and, booked to the instance cull pass, 0.45 more; the shadow proxies
0.22 there too). On either of this machine's two GPUs, some runs of the
same dolly are slower in every pass (4.25-4.7 on average, 7-9 at the
95th).

Five changes brought it to 2.38-2.40 ms on average and 2.69-2.76 at the
95th percentile, 3.24 at worst (2.06 standing still), the proxies thinned
by distance included:

- Handing the trees to the impostors at 150 m (the levels beginning at 0,
  40, 90 and 150 m, about 230 mesh trees within reach): the vegetation
  pass 1.0 ms. Against the truth the rings from 60 to 450 m seen from 12
  and 30 m up are 0.89-1.16 either way, the frame from 150 m up 0.94-1.09
  (0.94-1.07 handing over at 250 m), from 600 m up the same. At 120 m the
  far rings fall to 0.79.
- The impostors as one mesh of quads per species rather than an instanced
  quad: the GPU spends some 16 ns on each instance of a draw however small
  (56,000 one-triangle instances 0.92 ms, the same triangles as one mesh
  0.026), which was the 0.45. Their fill is what is left: drawn nearest
  first it is 0.06 less, every fragment discarded it is more (no depth to
  hide the layers behind), without the normals fetch 0.13 less.
- Each drawn as its view's octagon rather than the whole square: their
  pass from 0.78 ms to 0.52, the truth's numbers unchanged to the third
  decimal.
- Their atlases kept as float16 (albedo) and unorm8 (normals), 0.07 less.
- The engine no longer culls a shadow-only draw for the camera: the
  proxies' 56,000 instances were culled for a view that never draws them,
  0.22 ms a frame. Their own shadow pages cost little while the camera
  moves (34 pages a frame redrawn in the dolly). Merging them into one
  draw (`staticBatch`) draws every triangle in every page, 0.57 ms.

Without MSAA the vegetation pass is a quarter cheaper, so most of it is not
the samples.

On the CPU, each species' level is a `scene.createGeometry` made once
(`speciesLevels`), so a swap makes two nodes and uploads nothing; making
each node copy and upload its own mesh cost about 4 ms a swap. The dolly's
frames take 0.55-0.64 ms of CPU on average and 0.87-1.02 at worst
(0.3-0.5 of it `plantLod`'s pass over the 9476 trees, varying run to run),
the climb's 0.48-0.61 and 0.94-1.14.

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
impostor.js           bakeImpostor, impostorNode, shadowProxyNode,
                      saveImpostor: far trees as baked view-atlas quads,
                      their shadow, and the bake as files
canopy.js             canopyNode, hideBeyond: the forest past the
                      impostors as one textured layer
sheet.js              runSheet: each species' size, a still from eye height,
                      and its GPU ms over the bare frame at given distances
```

A headless script runs the sheet:

```js
import { runSheet } from "/app/sheet.js";
runSheet({ names: ['oak'], seconds: [60], drawOpts: { scale: 2.6, leaf: 1.5 }, costAt: [20, 60, 150] });
```

`bro-headless demos/tree-lab that-script.js`; stills go to the app's cache dir.
