# Promotion candidates: workshop code that belongs in bro

What in `lib/kit/`, `lib/arcade/` and the top-level `lib/*.js` gives the
most value, and which of it should become an engine feature or a
first-class bro JS API. Measured 2026-09-24.

## Value by reach

"Apps" is the number of app folders (under `games/ demos/ tools/ ai/
templates/ launcher/`) that import the module directly. `lib/kit/index.js`
re-exports app, dom, ui, params, prefs and weights for another 18 apps.

| Module | Apps | Shape |
|--------|-----:|-------|
| kit `test.js` | 100 | headless test harness (`frames`, `click`, `check`, `simUntil`) |
| kit `dom.js` | 56 | `$`, `h`, `ids`, `fmtClock`: plain DOM sugar |
| kit `app.js` | 53 | `boot()`: menu bar, status line, error routing |
| kit `ui.js` | 37 | logs, stats, tabs, progress, frame loop, toggles |
| kit `params.js` | 29 | declarative control rows bound to a params object |
| arcade `random.js` | 26 | `seededRandom` |
| kit `ml.js` | 24 | device badge, model-load status, `baseName` |
| kit `viewport3d.js` | 23 | orbit controls, `sceneViewport`, `screenRay`, `worldToScreen` |
| arcade `shell.js` | 23 | boot, screens, session, HUD; runs `loop/view/input/audio/save` |
| kit `weights.js` | 20 (+18 via index) | locate model weights in sibling repos / model cache |
| arcade `scores.js` | 17 | leaderboards, stats text |
| kit `prefs.js` | 14 | one localStorage JSON record |
| arcade `effects.js` / `pointer.js` / `hooks.js` | 13 each | particles + shake + toasts / canvas mouse / test hooks |
| kit `worker-rpc.js` | 10 | request/reply over a Worker |
| arcade `options.js` | 10 | Settings rows |
| kit `audio.js` | 9 | PCM helpers, WAV IO, clip player, mic recorder |
| arcade `scene3d.js` | 9 | 3D stage: orbit camera, picking, taps |
| `system-menu.js` | 7 (+ every `boot()` app) | `bro.menu` File / View / Debug bar |
| kit `gauges.js` | 7 | `fitCanvas`, `levelMeter`, `historyPlot` |
| kit `physics3d.js` | 5 | body + mesh pairing, event fan-out, pick ray, grabber |
| kit `history.js` / `project.js` / `editor.js` | 5 / 4 / 5 | undo stack, document bundle, menu wiring |
| kit `math3d.js` | 4 | quaternion / vector helpers |
| kit `kokoro.js` | 4 | find + load Kokoro TTS with its G2P assets |

The first five are app-framework code, not engine features: they are what
a web page would bring with it too. The candidates below are the modules
that paper over something the engine owns (a camera, a physics world, a
file system, a worker) or that every bro app re-derives from engine data.

## Candidates, strongest first

### 1. Camera controllers and screen/world projection → `bro.scene`

`camera.js` (orbit and fly camera state), `viewport3d.js` (`orbitControls`,
`screenRay`, `worldToScreen`, `sceneViewport.toScreen`) and arcade
`scene3d.js` sit under 23 + 9 apps; every 3D app needs them. Projection is
done: `scene.unprojectLocal(x, y)` / `scene.projectLocal(x, y, z)` work on
the live camera (bro a7347b39), and `sceneViewport.ray` / `toScreen` and
arcade `rayAt` / `toScreen` now wrap them. The pure `screenRay` /
`worldToScreen` remain for view math with no scene (scene-editor snapping).
**Promote:** an optional built-in `scene.orbitControls(canvas, opts)` /
`flyControls` (right-drag orbit, middle pan, wheel zoom, damping). The kit
then keeps only layout sugar.

### 2. Physics body ↔ scene node pairing and event fan-out → `Physics` / `bro.scene`

`physics3d.js` `addBody` / `BodyGroup` build a mesh per shape and copy the
body pose onto the node every frame; `physicsEvents()` exists because
`getContacts()` / `getBrokenConstraints()` drain on read, so only one
reader may call them. The engine already has `createPhysicsNode`, and
contacts now accumulate until drained (bro 8abffa5a).
**Promote:** a debug-mesh option on `createPhysicsNode` (shape → mesh in
the engine, where the shape data lives), and a subscription form
(`Physics.onContact(fn)`) so several systems can listen without a
hand-rolled drain owner. `grabber` (a mouse spring) could follow as a
`Physics.createMouseJoint`-style constraint.

### 3. Weights and model-path resolution → `bro.models`

20 direct users plus every ML lab through `index.js`, each asking the same
question: where are the weights for X? `weights.js` walks `BRO_WEIGHTS`,
ancestors of the app dir, the checkout parent and the per-user model cache.
The engine owns `bro.appDir`, the user-data dir and the native loaders
(which resolve against the process CWD, a trap the kit comments on).
**Promote:** `bro.models.find(candidates, { probe })` returning an
absolute path, with the search roots configured in engine settings, and a
download-cache location the engine and apps agree on. `kokoro.js` (G2P
asset discovery) is the same problem for one model and would become a
`bro.tts.loadKokoro({ search })` default.

### 4. Worker request/reply → `Worker` helper in bro

10 apps (every ML lab that loads off the main thread) use `worker-rpc.js`:
request ids, error replies, progress events, `abandon()`. It is small,
but every bro ML API is synchronous and documented as "run it in a
Worker", so the engine is the one creating this need.
**Promote:** ship it as `bro.worker.rpc(url)` / `bro.worker.serve(handlers)`
with the same protocol, or give the blocking ML calls `*Async` variants
that run on an engine thread (`laya` already has `predictAsync`).

### 5. Menu bar, inspector and perf toggles → engine default menu

`system-menu.js` installs File / View / Debug (DOM inspector, perf HUD,
reload) for every `boot()` app and several labs. Those items drive engine
features only.
**Promote:** `bro.menu.installDefault({ extra })` in the engine; the kit's
`boot({ menu })` passes app items through.

### 6. HiDPI canvas fitting → canvas / engine

`fitCanvas` (`gauges.js`, 7 apps, plus private copies in games) resizes a
canvas backing store to its box × devicePixelRatio, polling the box each
frame. bro already has `ResizeObserver` with `devicePixelContentBoxSize`,
so this is mostly a kit change; the engine-shaped part is an opt-in
auto-sized canvas (`<canvas data-bro-autosize>` or a context option) whose
backing store the engine keeps at box × DPR, which would also retire the
size polling in `sceneViewport` and the arcade view.
**Promote:** the auto-size option; meanwhile move `fitCanvas` onto
`ResizeObserver`.

### 7. Quaternion and vector helpers → `bro.math`

`math3d.js` (`q`, `v3`, `quatFromEuler`, `quatMul`, `quatYTo`) duplicates
what bromath has natively: `bro.math` exposes bromath types, but the scene
and Physics APIs take plain arrays / `{x,y,z,w}`, so apps convert by hand.
**Promote:** free functions on `bro.math` that take and return arrays
(`quat.fromEuler`, `quat.mul`, `quat.fromTo`), matching what the scene and
Physics accept.

### 8. Undo history → not an engine feature

`history.js` / `project.js` (5 and 4 editors) are pure app logic with no
engine dependency beyond `fs`. Keep them in the kit. The engine-side ask is
narrower: `project.js` writes tmp-then-rename by hand; an atomic
`fs.writeFileAtomic` in brokit would serve it and settings persistence.

## Smaller, keep in the workshop for now

| Module | Why it stays |
|--------|--------------|
| kit `text.js` (UTF-8 ↔ UTF-16 offsets, caret stops, cluster map) | a bro-specific need (HarfBuzz byte-domain offsets) but only 2 callers; if a text-editing API ever exposes byte offsets it should accept UTF-16 instead |
| kit `audio.js` PCM helpers (`resample`, `downmix`, `readWav`, `saveWav`) | broaudio has native versions; worth exposing `bro.audio.resample` / `readWav` if a third ML audio lab appears |
| `bot-aim.js`, `crosshair.js` | two games each; game code, not engine |
| arcade loop / input / save | only the arcade shell uses them; `input.js` already rides `bro.settings` action bindings |
| `markdown.js`, `linediff.js`, `openrouter.js`, `netroom.js` | domain libraries with one or two users |
| `sweep-runner.js`, `tot-reasoning.js` | one hands-off lab / no app user yet |
