# lib/kit — the toolkit for tools, demos, labs and ai apps

Games use [`lib/arcade/`](../arcade/README.md). Everything else builds on the kit:
one stylesheet for the dark lab look and the standard layout, a handful of
small ES modules for the things every app was hand-rolling, and helpers for
headless tests. No bundler, no framework; pages stay static HTML.

Start from [`templates/kit-app/`](../../templates/kit-app/) (copy the folder).
Ported examples: `demos/kws-lab` and `demos/lm-playground` (ML labs),
`demos/spatial-hash` (canvas demo), `demos/lighting-demo` (3D viewport),
`tools/shader-lab` (tool).

| File | What |
|------|------|
| `kit.css` | design tokens, base controls, layout + component classes |
| `index.js` | re-exports app, dom, ui, params, weights (one import line) |
| `app.js` | `boot()`: menu bar, status line, error display |
| `dom.js` | `$`, `$$`, `h` element builder, `ids`, formatters |
| `ui.js` | status line, progress, log, stats, `readout` rows, fps, toggle, tabs, frame loop, `fixedStep(h)` accumulator, `foldPanels()` (click a `.k-panel` caption to fold; ticking a caption checkbox unfolds) |
| `params.js` | controls bound to values / objects |
| `weights.js` | model weight resolution (BRO_WEIGHTS, sibling repos, cache) |
| `viewport3d.js` | `bro.scene` canvas + orbit camera + standard mouse controls, pick rays |
| `flycam.js` | free-fly camera (WASD / Space / C / Shift, drag- or pointer-lock look, optional roll, ground clearance) for terrain-scale scenes |
| `sky.js` | HDRI sky (`skyEnvironment`), sun direction + sun sliders (`sunControls`), a time-of-day rig (`daylight`: studio / dawn / noon / golden / night) |
| `nav3d.js` | `bro.ai.game` navmesh labs: slab/ramp level geometry, walkable-surface overlay sampling, route ribbons, markers, pooled pips, capsule agents, `startRoute`/`followRoute` waypoint walking, off-mesh link beads, surface picking (nav-lab, nav-carving) |
| `editor.js` | document editors: tool switcher, undo/redo/save/open commands |
| `skeletal.js` | clip authoring for skinned meshes: bone frames, keyframe compile, bone overlay |
| `humanoid.js` | a shared humanoid clip library (idle/walk/run/crouch/...) + the autoRig bone map |
| `physics3d.js` | Jolt + scene plumbing: body+visual pairs, body groups, rods, the event drain, pick rays, a mouse grabber |
| `ragdoll.js` | a 12-part humanoid `Physics.createRagdoll` rig: poses as per-joint deltas, FK, blend, error metrics |
| `text.js` | `bro.text` from JS: UTF-16 ↔ UTF-8 offsets, caret stops, cluster maps (data + drawn on a canvas) |
| `audio.js` | PCM plumbing (no DOM): shared `AudioContext`, resample/concat/gain/peak/dB, `clipPlayer`, `saveWav`, `micRecorder`, `signal` test-audio generators |
| `audio-ui.js` | audio widgets: `levelMeter`, `peakScope`, `historyPlot`, `waveView` (trim), `sourcePicker` (bro.listen sources), `transport`, `mixerStrips`, `fitCanvas` |
| `worker-rpc.js` | request/response over a module worker: `workerClient(url)` (page) + `serveWorker(handlers)` / `emit` (worker) |
| `prefs.js` | `prefStore(key, defaults)`: one localStorage JSON record with `set` / `snapshot` / `restore` |
| `imagegen.js` | `bro.diffusion` lab pieces: model picker, backend badge, prompt + settings panel, run bar, step-wise `runGeneration` with cancel, `imageView`, gallery `imageStrip`, `wordAxes` |
| `imagegen-worker.js` | worker half of imagegen: `loadFamily`, `stepHandlers` (prime / step / reset / search / remove), `wordAxis` |
| `agent.js` | tool-calling agent loop (pi-agent-core's event protocol): `createAgent({ stream, tools, systemPrompt, onEvent, approve })`, `textResult` / `errorResult`, `checkArgs` |
| `agent-tools.js` | agent tools: `codingTools(cwd)` (read/write/edit_file, list_dir, bash, eval_js), `lookTool(fn)` |
| `agent-llm.js` | agent providers: `brolmStream` (Qwen3 / Qwen3.5 through `bro.lm`, Hermes `<tool_call>` + `<think>` parsing, ChatML) and `openrouterStream` (native tool calls) |
| `agent-backend.js` | backend picker toolbar row (OpenRouter key + brain/eyes models, or a local model path + Load), persisted in a prefStore; `.stream()` gives the provider |
| `chat-view.js` + `chat.css` | agent transcript: markdown bubbles, thinking folds, tool cards (args, results, diffs), approval cards, `contextMeter`, `chatSession` (prompt box + Send/Stop) |
| `test.js` | headless test helpers (assert, wait, click, type, screenshot) |

`../openrouter.js` (outside the kit) is the OpenRouter client: model catalog +
explorer, and `chatCompletion(cfg, payload, signal)` with rate-limit retries.

## Page skeleton

```html
<link rel="stylesheet" href="/lib/kit/kit.css">
<body class="k-app">
  <header class="k-header"><h1>Title</h1><span class="k-sub">what it shows</span></header>
  <div class="k-toolbar">
    <button id="run" class="primary">Run</button>
    <label class="k-field">speed <input type="range" id="speed" min="0" max="4" step="0.1" value="1"><span class="k-val" id="speedVal"></span></label>
  </div>
  <div class="k-body">
    <aside class="k-side"><div class="k-panel"><h2>Params</h2><div id="params"></div></div></aside>
    <main class="k-main"><div class="k-viewport"><canvas id="view"></canvas></div></main>
  </div>
  <footer class="k-statusbar"><span id="status"></span><span class="k-stats" id="stats"></span></footer>
  <script type="module" src="/app/main.js"></script>
</body>
```

Every region is optional. `.k-side.right` is a right-hand panel; `.k-main.pad`
is a padded scrolling content column; `.k-toolbar.bare` drops the divider.
For a full-window 3D canvas use `<canvas>` + a floating `.k-hud` panel
(`demos/lighting-demo`).

### CSS reference

- **Tokens** (`:root`, override in app CSS): `--k-bg --k-surface --k-input
  --k-border --k-border-hi --k-text --k-muted --k-dim --k-value --k-btn
  --k-btn-hover --k-on --k-on-border --k-on-text --k-accent --k-ok --k-warn
  --k-err --k-font --k-font-ui --k-size --k-radius --k-gap --k-pad --k-side-w`.
- **Controls:** bare `button input select textarea` are styled.
  `button.primary`, `.active` (toggled on), `.danger`, `.small`.
- **Layout:** `k-app k-header k-sub k-spacer k-toolbar k-body k-side k-main
  k-viewport k-hud k-statusbar`.
- **Grouping:** `k-row` (wrapping flex row), `k-col`, `k-panel` (card; `h2`
  is its caption), `k-sep` (vertical divider), `k-grow`.
- **Components:** `k-field` (label + control + `k-val` readout), `k-chip`
  (`.on`), `k-progress`, `k-log`, `k-stats`, `k-tabs`, `k-box` (bordered
  output area), `k-kv` (label/value rows built by `readout()`; a row's `.on`
  turns it green), `k-note` (explanatory prose; `.warn` for a caveat).
- **Dashboards:** `k-deck` inside a `k-main.pad` wraps fixed-width
  `k-panel`s (`--k-card-w`, default 560px; `.wide` spans two); `h3` inside a
  panel is a section heading (window-lab, input-lab).
- **Text:** `.ok .warn .err .dim`, `k-caption` (a section caption in a
  `.k-main.pad` column, with an optional `span.dim` hint). `[hidden]` always hides.

## Modules

```js
import { boot, $, h, ids, statusLine, logView, stats, fpsMeter, toggleButton,
         tabs, frameLoop, progressBar, params, bindControl,
         findWeights, requireWeights, weightPath } from "/lib/kit/index.js";
```

**app.js** — `boot({ menu, status = '#status', catchErrors = true })` installs
the menu bar (`menu` is the `installSystemMenu` options, `false` for none),
wraps `#status` in a `statusLine`, and routes uncaught errors and unhandled
rejections into it (they still reach the engine log and fail headless runs).
Returns `{ status }`.

**dom.js** — `$(sel)` throws on a miss; `$$(sel)` returns an array;
`h('button.small#go', { onclick, title, dataset, style }, ...children)`;
`ids('status', 'model-path')` → `{ status, modelPath }`; `clear(el)`;
`fmtBytes`, `fmtMs`, `clock`.

**ui.js** (each takes a selector or element already in the page):
- `statusLine(el)` → `set(text, kind)`, `ok`, `warn`, `busy`, `error(errOrText)`
- `progressBar(el)` → `set(0..1)`
- `logView(el, { max, newestFirst, time })` → `add(textOrNode, kind)`, `clear()`
- `stats(el, { key: 'label' })` → `set(key, v)` / `set({...})`; without labels
  it writes to existing `[data-stat=key]` or `#key` elements
- `readout(el, labels)` — `.k-kv` label/value rows built once (labels: an
  object, or an array keyed by index) → `set(key, v, on?)` / `set({...})`
  (writes only changed text; `on` toggles the row's `.on`), `get(key)`,
  `row(key)`, `keys`
- `fpsMeter()` → `tick()` once a frame returns fps
- `toggleButton(el, { on, labels: [off, on], onChange })` → `on`, `toggle()`
- `tabs(bar, { onChange })` — `[data-tab=x]` buttons show `[data-pane=x]`
- `segmented(el, options, { value, onChange, small = true, title })` — a row
  of exclusive buttons (options: values, `[value, label]` pairs or
  `{ value: label }`); the chosen one is `.active`, each has `data-value`.
  Handle: `value` (get/set; setting does not fire onChange), `buttons`
- `frameLoop(fn(dt, t))` → `pause() resume() step() stop() running`

**params.js**
- `bindControl(input, { out, fmt, onChange })` wires one existing control:
  typed values (number / boolean / string), a formatted readout, `input`
  events for ranges and text, `change` for the rest.
- `params(container, state, spec, { onChange(key, value, state) })` builds
  labelled rows for `state`'s fields. Spec entries: `{ min, max, step }` →
  slider, `{ options }` (array, `[value, label]` pairs, or object) → select,
  boolean value → checkbox, `{ type: 'number' | 'text' | 'color' }` (color
  rows show the hex beside the swatch), plus `label`,
  `fmt`, `hint`. Returns `{ set(key, v, silent), refresh(), rows }`.

**weights.js** — never hardcode `D:/projects`. Candidates are paths relative
to the weights root (the directory holding the `bro*` sibling repos):

```js
const dir = findWeights(['brolm/weights/Qwen3.5-0.8B'], { probe: 'config.json' });
if (!dir) status.error(missingWeights('Qwen3.5-0.8B', ['brolm/weights/Qwen3.5-0.8B']));
```

Root = `$BRO_WEIGHTS`, else the nearest ancestor of the app dir holding a
sibling (`brolm`, `brosoundml`, `brodiffusion`, `brovisionml`,
`brosoundml-data`), else the parent of the broworkshop checkout. Relative
candidates are also tried under the model cache (`$BRO_MODELS_DIR`, else
`<user data>/bro/models`). Results are absolute (native loaders resolve
relative paths against the process CWD, brokit's fs against the app dir).
`requireWeights(what, candidates)` throws the "not found" message;
`weightPath(rel)` resolves without checking. No DOM use: works in workers
and test scripts.

**viewport3d.js** —
`sceneViewport(canvas, { orbit: { target, dist, fov, near, far }, controls })`
returns `{ canvas, scene, cam, controls, onFrame(fn), onView(fn),
reframe(pivot, dist, { yaw, pitch }?), ray(px, py) }` and pushes the camera
every frame; `ray(px, py)` is `screenRay` through a canvas-local pixel of the
current view; `onView(fn)` may adjust the `setCamera` options before each push (camera
shake). `orbitRotation(yaw, pitch)` builds an `orbit.rot`. `orbitControls(canvas, cam, { minDist, maxDist,
zoomRate, orbitButton = 2, panButton = 1, pointerLock, onChange, accept })` alone
wires the standard input: right-drag orbit, middle-drag pan (pointer-locked),
wheel zoom; left button stays free for picking; `accept(e)` returning false
leaves a press to the app. Picking math, on the `scene.setCamera` options
(`Camera.orbitViewOpts(cam, canvas)`) and the canvas CSS size:
`screenRay(view, w, h, px, py)` → `{ origin, dir }` and
`worldToScreen(world, view, w, h)` → `{ x, y, depth, behind }`. Camera math
is `lib/camera.js` (`Camera.*`).

**flycam.js** — `flyCamera(canvas, { pos, yaw, pitch, speed, boost, lookSpeed,
look: 'drag' | 'lock', lookButton = 2, roll, worldUp, ground(x, z), clearance,
fov, near, far })` → `{ cam, keys, update(dt), pose({ pos, yaw, pitch }),
forward(), locked, altitude, groundHeight, opts, dispose() }`. Call
`scene.setCamera(fly.update(dt))` each frame; `opts` is live (bind speed / fov
sliders to it). Yaw 0 looks down -Z. `look: 'drag'` holds the right button to
look and leaves the left to the app; `'lock'` captures the pointer on click.
Used by demos/terrain and demos/clipmap-terrain.

**sky.js** — `skyEnvironment(scene, { hdri, intensity, rotation })` loads one
of `HDRIS` (falls back to flat ambient); `sunDirection(elevationDeg,
headingDeg)`; `sunControls(container, sunLight, { elevation, heading,
intensity })` builds the three sliders. `daylight(scene, { order, cascades,
atlas, pcf, fireflies, onChange })` owns sun + fill + fog + HDRI per preset
(`DAYLIGHT`) → `{ apply(key), update(dt), setScale(s), current, presets,
order, emissiveGain, sun }`; call `update(dt)` each frame (night fireflies)
and `setScale` with the scene's size so fog and shadows fit. Used by
demos/plant-recipes and demos/flora-lab.

**physics3d.js** — for 3D Jolt demos (global `Physics` + a `bro.scene`):
- `addBody(scene, body, look)` → `{ tag, node }` (a PhysicsNode + a mesh built
  from the same shape: box / sphere / capsule / cylinder / compound, or
  `look.mesh(scene)`; `look.velocity` launches it); `addStatic` → `{ tag, mesh }`;
  `removeBody(e)`; `shapeMesh(scene, shape, look)`.
- `new BodyGroup(scene | () => scene)`: `add(body, look, extra)`, `get`,
  `has`, `size`, `values()`, `remove(tag)`, `clear()` — the registry behind
  select / clear-all.
- `rod(scene, color, opts)` → `{ set(a, b), visible, destroy() }`: a
  cylinder spanning two points (cables, ropes, normals).
- `physicsEvents()` → `{ onContacts(fn), onBroken(fn), off(fn), pump() }`:
  the ONE drain of `getContacts` / `getBrokenConstraints` (both drain on
  read); call `pump()` once a frame and subscribe everything else.
- `pickRay(vp, lx, ly)` (a sceneViewport + canvas-local pixel) →
  `{ o, d }`; `raycast(ray, maxDist)` → the closest hit plus the ray;
  `localPoint(canvas, ev)`.
- `grabber(vp, { stiffness, damping, rodColor, onRelease })` →
  `{ begin(hit), end(), setRay(ray), update(dt), grabbed }`: mouse-drag a
  body with a mass-scaled spring; the app decides what to grab.
- `q` / `v3` ({x,y,z(,w)} math), `QI`, `quatYTo(dx, dy, dz)`, `toArr`.

**ragdoll.js** — `PARTS` / `PART_NAMES` / `partIndex(name)`; a pose is
`{ partName: localDelta }` (`{}` = standing). `buildPose(deltas, rootPos,
rootRot)` → the flat 7-floats-per-part array the ragdoll drives take;
`lerpPose(a, b, t)`, `posePart`; `poseError(rd, deltas)` (mean joint-angle
error, radians), `jointResidual(rd)` (worst pivot separation, m).
`spawnRagdoll(scene, { position, rotation, layer, motor, colors, pose })` →
`{ rd, nodes, meshes, tags, destroy() }`. Used by demos/physics-playground
and demos/ragdoll-blender.

**skeletal.js** — authoring clips for `createSkinnedMesh` / the animation
player (`docs/animation-api.js`, `docs/rigging-api.js`) without per-rig code:
- `boneFrames(skeleton, { map, rest })` resolves logical bone names
  (`hips`, `upperArmL`, ...) to the skeleton's indices and rest rotations.
- `compileClip(def, frames, { lenient })` turns a clip def (`{ name,
  duration, tracks: [{ bone, property: 'rotation'|'translation'|'scale',
  keys: [{ time, euler | value }] }] }`) into a bromesh Animation, rotations
  composed onto each bone's rest pose; unknown bones throw unless `lenient`.
  `sampleTracks(duration, { bone: { rot(p), pos(p) } }, steps)` samples
  curves of the phase `p` into such tracks. `quatFromEuler`, `quatMul`.
- `boneOverlay(scene, node, parents)` → `{ setEnabled(on), update(), enabled }`:
  joint spheres + links that follow the skinned node's live pose;
  `skeletonParents(skeleton)` gives `parents`.

**humanoid.js** — `humanoidClipDefs()` (14 clips: idle, walk, run,
walkBack, walkStrafeL/R, crouchIdle, crouchWalk, wave, point, nod, jump,
root-motion walkRM/runRM), `compileClips(defs, frames,
{ only })` → `{ name: clip }`, `HUMANOID_BONES` (the logical names), and
`AUTORIG_HUMANOID` (`{ map, rest }` for the 22-bone `Rig.autoRig` humanoid).
Used by demos/anim-lab and demos/character-lab (`avatar.js`).

**editor.js** — plumbing for document editors (`tools/scene-editor`):
- `toolbox({ tools, initial, buttons, onChange })`: named tools, one
  current, synced to `[data-tool]` buttons. A tool is any object; the toolbox
  uses its optional `activate() deactivate() busy() cancel()`. Returns
  `{ name, tool, get(n), names, set(n), busy(), cancelAll() }`; `set` cancels
  in-progress gestures first.
- `documentCommands({ history, project, canRun, after, undoButton, redoButton })`:
  undo / redo / new / open / save / save-as for a `History` (lib/history.js)
  and `Project` (lib/project.js), with Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y /
  Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N (ignored while typing in a field)
  and undo/redo buttons that enable with the history. Returns the commands
  plus `menu` (`{ file, handlers }`) for `boot({ menu })`.

**text.js** — `bro.text` offsets are UTF-8 **bytes**; JS strings, Selection
and Range count UTF-16 units. Convert explicitly:
- `u16ToU8(str, i)`, `u8ToU16(str, b)`, `utf8Length`, `sliceByBytes(str, a, b)`,
  `codePoints(str)` (`{ cp, char, u16, u8, u16Len, u8Len }` each),
  `forEachCodePoint`, `codePointLabels` (for code-point strips),
  `isCombining`, `isRtlCodePoint`.
- `shape(text, opts)`: `bro.text.shape` (default Arial 32), throws on null.
- `stepForward/stepBackward(text, opts, byte)`, `caretStops(text, opts)`:
  the byte offsets a caret may occupy (cluster boundaries).
- `clusterMap(text, opts)`: each cluster in visual order with byte + UTF-16
  spans, source text, pen `x`, `advance`, `glyphs`, `rtl`, `ligature`,
  `multiCodePoint`; plus `tiles`, `monotonic`, `reordered`, `advanceSum`.
- `drawClusterMap(canvas, text, opts, { x, baseline, labels, stops, bg })`:
  fillText with a box per cluster at its own pen x (ligatures pink,
  multi-glyph orange, RTL purple), byte-span labels and caret-stop ticks.
  Returns the map. Used by demos/text-lab and demos/range-selection-lab.

**audio.js** — PCM helpers over one lazily created `AudioContext`
(`audioContext()`); not imported by `index.js`.
- `decodeAudioFile(path, rate)` -> `{ pcm, rate, seconds, srcRate, channels }`
  (mono, resampled to `rate`; null when it cannot decode), `readWav(path, rate)`
  (same shape, 16-bit PCM read raw off disk: no trip through the context
  rate), `downmix(pcm, ch)`.
- `resample(pcm, inRate, outRate)` (linear), `concatPcm(parts)`,
  `gained(pcm, gain, a, b)`, `peakOf(pcm, gain, a, b)`, `toDb(amp)`.
- `clipPlayer()`: `play(pcm, rate)` replaces the previous clip; `stop()`.
- `saveWav(pcm, rate, { path, defaultName, channels })`: 16-bit WAV; with
  no `path` it opens a save dialog (never in tests). Returns the path or null.
- `micRecorder({ rate, chunkFrames, agc, onChunk })`: `start()` / `stop()` -> Float32Array clip over
  `bro.mic` (headless has no device; tests feed PCM instead, see
  games/clap-runner).
- `signal.silence/tone/sweep/clicks/concat(...)`: deterministic test audio.

**audio-ui.js** — widgets over elements already in the page; each returns a
small handle (see the doc comment on each export for opts):
- `levelMeter(target, { min, max, curve, mark, needle })` -> `set(v)`,
  `mark(v)`, `color(css)`; renders a `.k-meter`.
- `peakScope(canvas, { history, color })` scrolling peak columns;
  `historyPlot(canvas, { size, min, max, ref, fmt })` line plot of recent values.
- `waveView(canvas, { height, trim, onTrim })` -> `set({ clip, gain,
  analysis, sel })`: min/max waveform, `bro.sense.analyze` tonal/onset
  overlay, draggable trim selection.
- `sourcePicker(select, { refresh })` -> `rebuild()`, `spec()`: mic / system
  loopback / per-app `bro.listen` sources.
- `transport({ toggle, seek, time }, src)`: play/pause + seek + clock over
  any `{ duration, position, seek, setPlaying }` source.
- `mixerStrips(host, rows, { onMute, onSolo, level })` -> `update()`,
  `paint(key, state)`: per-bus M/S + meter rows (`.k-strip`).
- `fitCanvas(canvas)` -> `{ ctx, w, h }` in CSS pixels at devicePixelRatio.
Used by demos/listen-lab, mic-chunks, scene-audio and spatial-audio.

**worker-rpc.js** — `workerClient(url)` wraps `new Worker(url, { type:
'module' })`: `request(msg, transfer)` -> Promise of the reply (requests
carry `_rid`, replies echo it, `{ type: 'error', message }` rejects),
`post(msg)` fire-and-forget, `on(type, fn)` for events (messages without
`_rid`), `ready` / `isReady` / `onReady(fn)` (the worker posts `'ready'`),
`abandon()` rejects every pending request with `err.abandoned`. In the
worker, `serveWorker({ type: async (msg) => reply })` dispatches by `type`,
replies with the handler's return value (`reply.transfer` = transfer list),
turns a throw into an error reply, and posts `'ready'`; `emit(type, fields)`
sends an event.

**prefs.js** — `prefStore('my-lab.v1', defaults)` -> `{ data, set(patch),
save(), snapshot(), restore(raw) }`. Storage failures are silent. Tests
`snapshot()` first and `restore()` in a `finally`, since headless
localStorage persists to the app's `.storage.json`.

**imagegen.js / imagegen-worker.js** — the shared shell of the
`bro.diffusion` labs (pixart-lab is the smallest complete example, then
sana-lab, then diffusion-lab). The page builds `modelPicker`, `genPanel`
(fields `seed steps guidance size | width height` map onto
GenerateOptions through `opts()`), `runBar`, `imageView` and `imageStrip`,
then runs `runGeneration(rpc, { prompt, opts, controls, decode(i), ctrl(i),
onStep })`, which primes and then asks for one denoising step per request.
`cancel()` abandons the requests and resets the worker's state. The worker
serves `stepHandlers(() => pipeline)` plus its own `load`. `wordAxes`
(page) and `wordAxis` (worker) build conditioning-space axes from two word
sets. The strip owns the bitmaps added to it; the view only borrows them.

## Headless tests

Test scripts are ES modules compiled in-process by bro-headless, so they
`import` from `/lib` exactly like app code (the engine mounts `/lib` and
`/app` as module roots for the driver script too, and shares the page's
module instances — except the page's entry module: importing the
`<script src>` file itself boots the app a second time, see ENGINE-ISSUES.md;
keep `main.js` a thin boot and import the modules under it). Top-level `await` works. Put them in `<app>/tests/test_*.js`;
`scripts/validate.sh <app>` runs them with CWD = repo root.

```js
import { check, eq, near, throws, test, done, frames, pumpUntil, waitFor,
         q, text, center, clickOn, typeInto, setValue, press, shot } from "/lib/kit/test.js";

frames(10);                                        // 10 x 16 ms of virtual time
clickOn('#btn-load');                              // real click: hit test + focus
waitFor(() => /ready/.test(text('#status')), 'model loaded', 600000);
setValue('#threshold', 0.5);                       // fires input + change
test('reply names Paris', () => check(/paris/i.test(text('#reply'))));
shot('after-load');                                // tests/out/shots/<app>-after-load.png
done();                                            // throws if any test() failed
```

- ML tests: `needWeights(what, candidates, { probe })` returns the weights
  path, or logs `SKIP: <what> not found ...` and exits 0 (a machine without
  the weights skips instead of failing); `skip(reason)` does the same for
  any other missing prerequisite.
- A failing check throws; an uncaught throw makes bro-headless exit 1.
  `test(name, fn)` logs ok/FAIL and continues; `done()` throws at the end.
- `frames(n)` advances virtual time. `pumpUntil`/`waitFor` budget in wall
  time (model loads and workers run on real threads) while advancing
  virtual time so callbacks deliver. `simUntil(pred, virtualMs)` budgets in
  virtual time instead: deterministic for in-engine simulation (game loops,
  physics), e.g. `simUntil(() => T.screen === 'complete', 20000)`.
- `clickOn` refuses a hidden element or one covered by another; `typeInto`
  clicks then types through the engine; `press('Enter')` sends SDL keys.
- Import the app's modules, never its entry `main.js` (the engine evaluates
  an entry module a second time when a test imports it). Keep `main.js` a
  thin boot over an importable module (`lab.js`, `app.js`, ...).
- A page module's `let` export is a snapshot in the test: later
  reassignments are not seen. Read live state through objects or accessor
  functions (`characterAvatar()`), not a reassigned binding.
  (Both in ENGINE-ISSUES.md.)
- The headless globals (`advanceTime`, `click`, `screenshot`, `getPixel`,
  `wheel`, `mouseDown`, ...) are all still there; see bro's `docs/headless.md`.

## Conventions

- Keep static structure in HTML with kit classes; build only repeated or
  data-driven UI with `h()`.
- App CSS is only what is specific to the app. Reach for a token before a
  literal colour.
- Model paths: `findWeights` with repo-relative candidates, never absolute.
- A widget belongs in the kit when several apps need it. Otherwise it stays
  in the app.
