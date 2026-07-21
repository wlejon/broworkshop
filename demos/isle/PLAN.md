# PLAN — `demos/isle`: a model-driven, procedurally-synthesized island

> A from-scratch broworkshop app that demonstrates **everything** the `bro.worldgen`
> diffusion terrain model gives, by using the model as a *semantic control field*
> and synthesizing a vast, beautiful, naturalistic island **procedurally** from it —
> never by rendering the model's raw output. Replaces a deleted "world" app that
> baked 30 m elevation for ~10 minutes, looked ugly, and used one channel.
>
> This file is the durable brief. Read it top to bottom, then read the "First actions"
> section and start Milestone 1. Build in reviewable chunks, verify with a headless
> screenshot each time, commit as you go.

---

## 0. The thesis (do not lose this)

**Treat the diffusion model as the art director, not the renderer.** The model decides
*what and where* (this ridge is snowy alpine, this valley is wet forest, the coast is
here); cheap procedural generation (GPU FBm detail, instanced flora, splat materials)
decides *how it looks up close*. Neither alone works: noise has no structure, the model
has no cheap detail and is too slow to render directly.

**Coarse-character / fine-relief split** — the crux of using this particular model well:

- The coarse climate net runs at **7.68 km/cell** (continental). An island is only a few
  such cells across, so temperature/precipitation are ~uniform over it. That is not a bug —
  it is the design: **the coarse climate sample sets the island's *regional identity*.**
  Relocate/reseed and the whole island flips tropical ↔ temperate ↔ arctic.
- The **fine elevation (30 m)** drives all *internal* variation. From it derive slope,
  aspect, and flow-accumulation, then apply real physics: **temperature by altitude lapse
  rate**, **moisture by orographic uplift + flow** (wet windward valleys, dry leeward
  ridges), biome banding beach→forest→montane→alpine→snow.
- Result: regional character from the coarse net, local relief from fine elevation,
  everything renderable derived. **Every channel earns a visible axis** (table below).

| Model output | Drives |
|---|---|
| elevation (m) | terrain silhouette, sea level, coastlines, snow-line interplay |
| p5 (low elevation) | valley floors / water table → where lakes & rivers settle |
| temperature °C | snow line, ice, biome palette, haze tint, evergreen vs bare |
| temperatureSeasonality | deciduous↔evergreen, snow persistence, seasonal colour |
| precipitation mm/yr | vegetation density, river volume, desert↔forest, rock↔grass |
| precipitationSeasonality | savanna↔rainforest, monsoon rivers, bloom timing |
| *derived* slope/aspect | cliffs, exposed rock, orographic precip side |
| *derived* flow-accumulation | rivers, lakes, erosion carving |

---

## 1. Locked decisions (from the design conversation)

- **Traversal:** first-person on-foot **⇄ freefly** toggle. **Scroll-wheel changes move
  speed.** Always-on **minimap** + full **map on `M`**.
- **Art direction:** **naturalistic PBR** (engine PBR + IBL/HDRI + fog).
- **Scale/budget:** **island**, bake in **seconds** (hard constraint — no 10-minute bake).
  Bounded and finite; vast-feeling via clipmap LOD, not via true infinity.

Deferred/opens (pick sensible defaults, note them, move on): final app name (`isle` is a
working title), exact island size, whether to implement engine track **E2** (climate
surface layer) in v1 or ship slope/height materials first, flora budget.

---

## 2. Engine reality (verified — build on these, don't reinvent)

### 2a. `scene.createClipmapTerrain` is the terrain spine — and it already has detail + materials
`docs/clipmap-api.js`. Camera-centred geometry clipmap: one mesh, GPU vertex displacement
from a streamed **height pyramid**, crack-free by construction, flat triangle budget
(~250k), receives shadows. **This is the right tool** — model output feeds the pyramid,
LOD keeps it cheap, only texture data streams.

- `createClipmapTerrain({ levels, resolution:128, cellSize, heightScale, seaLevel })`.
- `setHeightLayer(index 0..3, { data:Float32Array, width, height, originX, originZ,
  metresPerCell })` — **finest first**, coarsest is the base and must cover everywhere the
  camera reaches; finer layers blend in over their outer 8%. Data is copied and **mip-chained**
  (required — the shader samples a fractional lod).
- `update(camX,camY,camZ)` every frame; `elevationAt(x,z)` for collision (exact near camera,
  approximate far); `node` is a normal MeshNode (PBR/fog/shadow-receive).

**Stale doc warning:** clipmap-api.js says "Materials, splatting and procedural detail are
not here yet." **That is out of date.** The engine already ships:
- `src/scene/shaders/clipmap_detail.glsl` — multi-octave procedural FBm detail, camera-anchored,
  uniforms `u_detailWavelength / u_detailRelief / u_detailGain / u_detailOctaves`.
- `src/scene/shaders/clipmap_material.glsl` — a **rock / snow / sand / grass** material model
  (albedo + roughness) blended by **slope, elevation, cavity, and `u_snowLine`**.
- `clipmap_common.glsl`, `clipmap.vert.glsl`, `clipmap.frag.glsl`.

So near-photoreal terrain shading and sub-cell detail **exist**; they are just **not exposed
to JS** (only `setHeightLayer` is bound — see `src/js/clipmap_bindings.cpp`) and are **not yet
climate-driven** (the palette/snow-line come from constants + slope/height, not from the model's
temperature/precip/biome).

### 2b. `scene.createTerrain` — the alternative, and why we don't lead with it
`docs/terrain-api.js`. Chunked CPU heightmaps with `setHeightSource(fn)` (per-chunk, sample a
resident tile — good fit conceptually) and `raycast()`. BUT its materials are **height-banded
flat palette colours assigned at raycast time**, not biome/PBR, and LOD rings pop/stitch. Weaker
look than the clipmap. Keep as a fallback only.

### 2c. Supporting engine APIs (all confirmed present)
- **Lighting / sky:** `scene.setEnvironment({ hdr, intensity, rotation })` (IBL skybox + ambient;
  HDRIs in `demos/lighting-demo/hdri/`, CC0), `scene.createLight({type:'directional',…})`,
  `scene.setToneMap({mode:'aces',exposure,gamma})`, `scene.setAmbient([…])`. `docs/lighting-api.js`.
- **Fog / atmosphere:** `scene.setFog({start,end})` linear, or `{density, height}` for
  exp² + ground-mist height fog. `docs/scene-api.js` (~line 1038). Tint by climate.
- **Vegetation instancing:** `scene.createInstancedMesh({ mesh, instances… })` — N copies of one
  mesh, frustum-culled; split large spreads across a few nodes. `docs/scene-api.js` (~line 558).
- **Flora meshes:** `bro.flora.createWorld()` → `world.addPrototype(bro.flora.prototypes.{straight,
  fork,whorl}(…))` → `world.step(dt)` → `world.emitMesh(i)` / `emitFoliage()` / `emitBloomAnchors()`.
  `docs/flora-api.js`. Use it to **grow a handful of prototype trees/shrubs once**, then instance
  them across the terrain by biome — do NOT grow per-plant at scale.
- **Player:** `Physics.createCharacter` (Jolt CharacterVirtual, move_and_slide-style;
  `character.setVelocity`, `character.getState`, stepUp/floor-snap). `docs/physics-api.js` (~1100).
  **But** for v1 prefer a simpler kinematic controller that reads `clipmap.elevationAt(x,z)` for
  ground height (exact match to the visible surface; no Jolt heightfield needed). Reserve
  `createCharacter` for later prop/wall collision.
- **Model:** `bro.worldgen` — `docs/worldgen-api.js`. `loadWorld(dir,{seed,onReady,onError})`
  (async only), `world.elevation(i1,j1,i2,j2,{onDone})` / `elevationSync`, `world.coarse(...)`,
  `world.stage(name,...)` / `stageSync`. Axes: **i = N→S rows = result.height**, **j = W→E cols =
  result.width**, `data[z*width+x]`. `coarseCellSize`/`latentCellSize` are **METRES/cell**
  (7680 / 240 on the 30 m checkpoint), NOT cell ratios. **One request at a time per world**
  (tile cache not thread-safe) — serialize, or load a second world.

---

## 3. Architecture

```
app.js  boot → load model → bake atlas → build world → run loop → wire input
lib/
  atlas.js      bake + derive the control atlas (see §4)
  biome.js      classify + palette + material params (reuse worldgen-lab Whittaker)
  hydrology.js  flow-accumulation on coarse elevation → rivers/lakes, water level
  terrain.js    clipmap setup: height layers from atlas + detail/material tuning
  materials.js  map biome/climate → clipmap material knobs (+ climate surface layer, E2)
  flora.js      grow N prototypes once; instance across terrain by biome/moisture/slope
  water.js      sea plane / water shader at sea level; river & lake surfaces
  sky.js        HDRI env, sun, tonemap, humidity/temperature-tinted fog, altitude snow
  player.js     FP kinematic controller (elevationAt) ⇄ freefly; scroll = move speed
  mapview.js    minimap (always) + full map on M, from the atlas, with player marker
  season.js     (M5) time/season slider re-driving the seasonality channels — showpiece
```

Conventions: thin `app.js` + modular `lib/`, ESM at `/app/...` and shared at `/lib/...`,
`bro.json` manifest, mirror `demos/worldgen-lab` and `qwen-tts-lab` structure. Add
`{ "dir": "demos/isle" }` to `broworkshop/launcher/apps.json`.

### Data flow (worked example — tune the numbers)
1. **Pick an island location.** Use the **worldgen-lab** (climate/overview probes) to find a
   seed + (i,j) where a landmass sits in ocean. Store as the app's default.
2. **Bake the structural field (seconds).** `world.elevation(i0,j0,i0+N,j0+N)` at 30 m/cell,
   `N≈384–512` (an ~11–15 km island; 256² was ~1.7 s in worldgen-lab, so 512²≈~7 s — keep N
   at the small end for "seconds", expose as config). This covers island **+ ocean margin**;
   beyond it the clipmap clamps to the edge (endless sea). One clipmap layer.
3. **GPU detail fills below 30 m** via the existing `clipmap_detail.glsl` — this is the whole
   point: model gives structure, procedural gives the fine relief. No fine 30 m restreaming
   needed for a bounded island (optional later: a finer near-field layer).
4. **Sample regional climate once.** `world.coarse(...)` at the island centre → one
   temperature / precip / seasonality reading → sets snow-line, palette character, fog tint,
   flora set.
5. **Derive the atlas** (CPU, once): slope/aspect (∇elevation), flow-accumulation → rivers/lakes,
   coast distance, lapse-rate temperature, orographic moisture, biome id. Low-res is fine.
6. **Render:** clipmap (layer + detail + materials), water plane at y=0 (sea level), instanced
   flora by biome, sky/fog. **Maps** draw the atlas (biome or hypsometric) to a canvas.
7. **Traverse:** player y = `clipmap.elevationAt(x,z)` + eye height on foot; free XYZ in freefly.

---

## 4. The control atlas (`lib/atlas.js`)

Bake once, keep resident, sample cheaply. Holds (as typed arrays + optional GPU textures):
- `elevation` (m, 30 m/cell) — the structural field (clipmap layer + everything below).
- `regional` climate scalars (one each): temperature °C, precipitation mm/yr, temp/precip
  seasonality, p5 — from a single `coarse()` sample at island centre.
- Derived per-cell (can be coarser than elevation): `slope`, `aspect`, `flow`, `coastDist`,
  `localTemp = regionalTemp − lapse·elevation`, `moisture = f(regionalPrecip, orographic(aspect),
  flow)`, `biome` (id), `snowLine` (from localTemp crossing 0 °C along elevation).
- Expose: `sampleHeight(x,z)`, `sampleBiome(x,z)`, `sampleMoisture(x,z)`, and the raw arrays for
  the maps and the clipmap surface layer.

Reuse the **Whittaker `classify(E,T,P)`** from `demos/worldgen-lab/lib/probes/climate.js` as the
biome starting point; extend with slope (cliff/rock) and coast (beach) bands.

---

## 5. Engine track (fix the limitation in the engine, not the app)

Per the standing rule *apps showcase the engine; fix limitations in the engine, never in app
code*. The clipmap shaders exist; the gaps are **JS exposure** and **climate-awareness**. Do
these in `bro` (`src/scene/clipmap_terrain.{h,cpp}`, `src/js/clipmap_bindings.cpp`, and the
`src/scene/shaders/clipmap_*.glsl`). Read those files first.

- **E1 — Expose material + detail knobs to JS (small, do first).**
  Bind setters for the uniforms the shaders already use: `setSnowLine(m)`, `setDetail({wavelength,
  relief,gain,octaves})`, and `setMaterials({rock,snow,sand,grass})` (albedo+roughness each, and
  the slope/height blend thresholds if reasonable). This lets `isle` give each island a palette and
  a snow line matched to its regional climate. Verify with the existing terrain/clipmap demo.
- **E2 — Climate surface layer (the payoff; do after E1 works).**
  Add a `setSurfaceLayer(desc)` analogous to `setHeightLayer` — a low-res field of biome id /
  moisture / temperature — sampled in `clipmap_material.glsl` (world XZ → texel, same origin/
  metresPerCell scheme, GL_CLAMP_TO_EDGE) to **spatially modulate** the palette. This is what turns
  slope/height materials into true model-driven biome bands (desert→forest→tundra from the actual
  climate). Keep the existing slope/snow behaviour as the fallback when no surface layer is set.
- **E3 — optional polish:** moisture→wetness (albedo darken + roughness), coast sand band from
  coastDist, triplanar strength by slope. Only if time allows.

If E1/E2 slip, the app still renders (slope/height/snow materials look good); E2 is the upgrade
from "pretty generic terrain" to "this is clearly the model's world."

---

## 6. Milestones (build + headless-verify + commit each)

- **M1 — Scaffold + bake + lit freefly island.** `bro.json`, `index.html`, `app.js`, `lib/atlas.js`,
  `lib/terrain.js`, `lib/sky.js`. Load model → bake elevation over a known island location → one
  clipmap height layer → HDRI env + sun + ACES → freefly camera + scroll speed. **Goal:** proves the
  loop is fast (seconds) and the silhouette is the model's. Screenshot the island from the air.
- **M2 — Water + hydrology + biome materials.** Sea plane at y=0; `lib/hydrology.js` flow→rivers/
  lakes; `lib/biome.js` + `lib/materials.js` driving the clipmap material knobs (needs **E1**;
  **E2** if ready). Screenshot coast + a river valley.
- **M3 — Procedural detail + flora.** Tune `clipmap_detail.glsl` knobs per biome; `lib/flora.js`
  grows a few prototypes and instances them by biome/moisture/slope (density from precipitation).
  Screenshot ground-level forest vs alpine.
- **M4 — Player + maps.** `lib/player.js` FP kinematic (elevationAt) ⇄ freefly, scroll speed;
  `lib/mapview.js` minimap always + `M` full map from the atlas with a player marker. Screenshot
  on-foot + open map.
- **M5 — Season/time showpiece.** `lib/season.js` slider/loop re-driving the seasonality channels →
  snow line, foliage colour/density, river volume shift in real time. GIF it.

Order the engine track so **E1 lands before M2** and **E2 before/with M2–M3**.

---

## 7. Gotchas (already paid for — do not rediscover)

- **worldgen `coarseCellSize`/`latentCellSize` are METRES/cell** (7680 / 240), not ratios. To map
  a native (30 m) cell index to a coarse cell, divide by `coarseCellSize / cellSize` (= 256).
- **worldgen axes:** `stage/elevation(i1,j1,i2,j2)`, i = N→S = `height`, j = W→E = `width`,
  `data[z*width+x]`. Don't transpose. **One request at a time per world.** `loadWorld` is async only.
- **clipmap `setHeightLayer`:** coarsest layer is the base and must cover the reachable world;
  data is mip-chained (required); `originX/originZ` are world metres of texel (0,0) — getting them
  wrong shifts a layer plausibly-but-silently.
- **`createTerrain.setHeightSource`:** if ever used, **use the provided `worldX0/worldZ0`** (they
  carry the +1 skirt; padded grid is `chunkSize+3`); re-deriving them makes silent per-chunk seams;
  runs on the JS thread inside `update()` so must be cheap (sample a resident tile).
- **`scene.createMesh` raw `colors` is stride-4 RGBA**, not RGB — a stride-3 buffer renders
  near-white garbage under lighting (learned building worldgen-lab's relief probe).
- **`bro.image.gpu.colormap`:** use an **explicit `{lo,hi}` range**, not `autoRange` — autoRange
  EMA-smooths across frames so static fields visibly "evolve." And the target canvas must be
  **persistent** (rebuilding it per paint draws a tiny blob). Both relevant to the map views.
- **Never `--no-gpu`; default to GPU.** Gate big model loads on `bro.gpu`.
- **Headless test/verify:** a static app auto-boots from `index.html`; a test does
  `import { ready } from "/app/app.js"` and pumps `for(…){ wallSleep(100); advanceTime(16);
  if (ready()) break; }`; `bro-headless <appdir> <script>` — **script path is relative to CWD**,
  not the appdir. Use `screenshot()` to verify each milestone. Export a `ready()` flag from
  `app.js` for this.

---

## 8. Working conventions (repo rules — honour them)

- **Bash, not PowerShell**, for all shell/git/file ops.
- **Commit as you go** (build → verify → commit per isolated chunk). Concise messages describing
  the capability, no "phase" language. `git add` **specific paths** only (never `-A`; sibling trees
  hold WIP). Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Commit to the current branch** (incl. main); no unsolicited branches.
- **Never bump submodule pointers / push siblings** — the user owns those. Engine (`bro`) changes
  for the E-track are committed in the `bro` repo; the app lives in `broworkshop`.
- Don't delete/clean build folders. Don't pipe builds through `tail` (log to file, grep `error C`).
- Slow builds aren't hung — background + wait, don't spam.
- Perf bar: >60 fps is fine; tune beyond that only if asked.

---

## 9. First actions for the fresh session

1. Read this file, then read, in order: `docs/worldgen-api.js`, `docs/clipmap-api.js`,
   `src/scene/shaders/clipmap_material.glsl`, `src/scene/shaders/clipmap_detail.glsl`,
   `src/js/clipmap_bindings.cpp`, `src/scene/clipmap_terrain.h`. This tells you exactly what the
   clipmap already does and what E1 must expose.
2. Skim `demos/worldgen-lab/` (structure, the Whittaker `classify`, the load/bake plumbing) and
   `demos/terrain/app.js` (a working clipmap-adjacent scene: HDRI env, sun, tonemap).
3. Use the **worldgen-lab** to pick a concrete island location (seed + i/j with land in sea);
   record it as the app default.
4. Start **M1**: scaffold `demos/isle`, bake the structural elevation field, stand up the clipmap +
   sky + freefly camera, and get an aerial screenshot of a lit island. Confirm the whole
   load+bake+render is **seconds**, not minutes. Then commit.

Build the smallest thing that renders a recognizable island first; add richness milestone by
milestone. The win condition: a vast, gorgeous island you can walk and fly, whose shape, biomes,
snow, rivers, and vegetation are all **visibly the diffusion model's doing** — produced by a bake
measured in seconds.
```
