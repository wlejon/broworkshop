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
| `ui.js` | status line, progress, log, stats, fps, toggle, tabs, frame loop |
| `params.js` | controls bound to values / objects |
| `weights.js` | model weight resolution (BRO_WEIGHTS, sibling repos, cache) |
| `viewport3d.js` | `bro.scene` canvas + orbit camera + standard mouse controls, pick rays |
| `editor.js` | document editors: tool switcher, undo/redo/save/open commands |
| `skeletal.js` | clip authoring for skinned meshes: bone frames, keyframe compile, bone overlay |
| `humanoid.js` | a shared humanoid clip library (idle/walk/run/crouch/...) + the autoRig bone map |
| `test.js` | headless test helpers (assert, wait, click, type, screenshot) |

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
  output area).
- **Text:** `.ok .warn .err .dim`. `[hidden]` always hides.

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
- `fpsMeter()` → `tick()` once a frame returns fps
- `toggleButton(el, { on, labels: [off, on], onChange })` → `on`, `toggle()`
- `tabs(bar, { onChange })` — `[data-tab=x]` buttons show `[data-pane=x]`
- `frameLoop(fn(dt, t))` → `pause() resume() step() stop() running`

**params.js**
- `bindControl(input, { out, fmt, onChange })` wires one existing control:
  typed values (number / boolean / string), a formatted readout, `input`
  events for ranges and text, `change` for the rest.
- `params(container, state, spec, { onChange(key, value, state) })` builds
  labelled rows for `state`'s fields. Spec entries: `{ min, max, step }` →
  slider, `{ options }` (array, `[value, label]` pairs, or object) → select,
  boolean value → checkbox, `{ type: 'number' | 'text' }`, plus `label`,
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
returns `{ scene, cam, controls, onFrame(fn), reframe(pivot, dist) }` and
pushes the camera every frame. `orbitControls(canvas, cam, { minDist, maxDist,
zoomRate, orbitButton = 2, panButton = 1, pointerLock, onChange, accept })` alone
wires the standard input: right-drag orbit, middle-drag pan (pointer-locked),
wheel zoom; left button stays free for picking; `accept(e)` returning false
leaves a press to the app. Picking math, on the `scene.setCamera` options
(`Camera.orbitViewOpts(cam, canvas)`) and the canvas CSS size:
`screenRay(view, w, h, px, py)` → `{ origin, dir }` and
`worldToScreen(world, view, w, h)` → `{ x, y, depth, behind }`. Camera math
is `lib/camera.js` (`Camera.*`).

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

## Headless tests

Test scripts are ES modules compiled in-process by bro-headless, so they
`import` from `/lib` exactly like app code (the engine mounts `/lib` and
`/app` as module roots for the driver script too, and shares the page's
module instances). Top-level `await` works. Put them in `<app>/tests/test_*.js`;
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
