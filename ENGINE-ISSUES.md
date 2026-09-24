# Engine issues found from broworkshop

Things that do not work in bro and that apps should not paper over. Engine
repo: `../bro`.

**Adding an entry.** Put it under the subsystem heading it belongs to (add a
heading if none fits). Check first that it is not already listed; if it is,
add your app to that entry's "Affects" line instead of writing a second one.
Each entry says: what is wrong (and what the web / the docs say should
happen), a minimal repro that runs against the current build, and which apps
it affects plus any workaround they carry. Date it.

**Closing an entry.** When the engine fixes one, re-run its repro, then move
it to "Fixed" at the bottom as one line: title, the bro commit if known, the
date you verified it. Fix the app workarounds it names.

Repros below assume the repo root as CWD and `bro-headless` =
`../bro/build/Release/bro-headless.exe`. "A page with X" means any app folder
whose `index.html` holds X (a scratch folder with just `index.html` works).
Every open item was last re-run against the bro Release build of 2026-09-24,
except where an entry says "not re-run".

## Open

### Layout and CSS

#### `position: fixed` scrolls with the viewport (2026-09-24)
Fixed-position elements move with the root scroll, both where they paint and
where clicks land. Surfaced once element rects began honouring the root
scroll (bro af6c4219).

#### The root scroll range ignores overflowing descendants (2026-09-24)
`documentHeight_` uses `<html>`'s own box, so content overflowing it is not
reachable by scrolling and the range can come out short.

#### A `flex: 1` fill does not stretch to a taller card (2026-09-24)
tools/reader's library cards: the progress fill (`flex: 1`) keeps its
original height when the card grows taller. Predates the inline rewrite.

### DOM APIs, events, CSS animations

#### CSS transitions are not `CSSTransition` objects (2026-09-24)
CSS animations now appear in `getAnimations()` as `CSSAnimation`s (bro
e983ea14); running transitions do not appear at all.

#### A CSS animation under `display: none` keeps its clock running (2026-09-24)
It stops driving frames and events but is not cancelled; the spec cancels it
(and restarts it when the element is displayed again).

#### `document.getAnimations()` orders CSS animations by creation, not tree order (2026-09-24)
CSS animations come first, in creation order, then script animations; the
spec orders CSS animations by tree order of their targets.

### Windows, workers, messaging

#### Worker `postMessage` does not keep identity for plain objects (2026-09-24)
Buffers now keep identity (bro 235dad45), but an object that appears twice
in a message arrives as two copies, and a cycle cannot be sent;
`structuredClone` and the window path keep both, as the web does.

### bronze JS runtime and module loading

#### A NaN typed as a number is truthy in conditions (2026-09-24)
When the compiler knows a value is a number (unary `+`, `0/0`, a `NaN`
literal), `||`, `&&`, `?:` and `!` treat NaN as truthy (the test looks like
`d != 0`). Values of unknown type and `Boolean(NaN)` are fine.
Repro: `bro-headless tools/synth -e "const d = {}; const n = NaN; console.log(+d.x || 120, n || 1, !n, n ? 1 : 2, n && 1)"`
prints `NaN NaN false 1 1`; want `120 1 true 2 NaN`.
Affects: the `+opts.x || def` idiom everywhere (tools/synth's tempo was NaN;
it now uses `Number.isFinite`). Find others with
`grep -rn "(+[a-zA-Z_.]* ||" games demos tools ai lib`.

#### `String.prototype.lastIndexOf` ignores `fromIndex` (2026-09-24)
`'ab\ncd\nef'.lastIndexOf('\n', 3)` is 5 (want 2), `'abc'.lastIndexOf('c', 1)`
is 2 (want -1).
Affects: the textarea line-start idiom `value.lastIndexOf('\n', pos - 1) + 1`;
tools/desktop-notebook's indent / heading / block insert (its test skips the
Tab-indent check while `'a\nb\nc'.lastIndexOf('\n', 2) !== 1`).

#### three.js r160 `new THREE.WebGLRenderer()` throws "a number is not a function" (2026-09-24)
In the r160 UMD build, the WebGLState factory's `$(1)` (a nested function
declaration, `setCullFace`) resolves to a number instead of the hoisted
function: a scoping / function-declaration hoisting bug with a `$`-named
binding in a large minified function.
Repro: an app folder holding `three.min.js` from
`git archive 9a7c6aa^ demos/spatial-audio/three.min.js` and a module script
`import "/app/three.min.js"; new THREE.WebGLRenderer({ canvas })`.
No broworkshop app vendors three.js now (spatial-audio was rebuilt on bro.scene).

#### A driver script importing the page's ENTRY module evaluates it again (2026-09-24)
The module registry (`eval_jit.cpp`, `opts.moduleRegistry`) shares page
modules with a headless driver script, except the entry module named in
`<script type="module" src>`: importing it from a test runs it a second time
(two boots into one DOM and one physics world). Its dependencies are shared.
Repro: page `main.js` = `import "/app/m.js"; console.log('main')`; a test
doing `import "/app/main.js"` logs `main` twice and `m.js` runs once.
Affects: tests should import non-entry modules (kit apps: keep `main.js` a
thin boot).

#### A driver script sees a page module's `let` exports as a snapshot (2026-09-24)
A test importing a shared page module gets the values its `let` exports held
at import time; later reassignments (from a page timer or a page function the
test calls) never show, in named imports or `import * as ns`. Objects and
functions are shared; accessor functions return live values.
Repro: `live.js` = `export let y = 1; export let c = null; export function bump(){ y++ }
export function rebuild(){ c = { n: (c ? c.n : 0) + 1 } } export function readC(){ return c }`,
page `main.js` = `import { bump, rebuild } from "/app/live.js"; rebuild(); setTimeout(bump, 50)`;
the test imports `{ y, c, rebuild, readC }` and `* as ns`, `advanceTime(100)`:
`y` and `ns.y` are 1; after the test's own `rebuild()`, `c !== readC()`.
Affects: demos/character-lab (tests read `ballState.selfTag` /
`characterAvatar()` instead of the stale `character` handle).

#### Error location misattributed across module imports (2026-09-24)
A ReferenceError at line 8 of a headless test script that imports
`/app/m.js` is reported `at .../app/m.js (external module bindings):8:1 (in
.../test.js)`: the imported module's name with the script's line. Failures in
test scripts that import kit helpers point at the wrong file first.
Repro: a script `import { m } from "/app/m.js";` + six `console.log` lines +
`notDefinedAnywhere(m);`.

#### Per-call and typed-array overhead dominates tight JS loops (2026-09-24)
Re-measured 2026-09-24 in a headless driver script (20M iterations,
`Date.now()`): ~13 ns per call to a local function, ~28 ns per method call,
~26 ns per Float32Array read (a typed-array read costs more than a call).
Earlier in-page numbers (optimized boot tier): ~70 ns local call, ~250 ns
cross-module namespace call (175 ns bound to a local const), 14–40 ns
typed-array read. In demos/tactical-flowfield the per-unit steering loop was
~10 µs per unit per tick (1000 units ≈ 10 ms per 60 Hz tick).

#### ai/pi-agent and ai/maker-agent bundles never finished compiling (2026-09-24, not reproducible from the tree)
bro-headless produced nothing for 300 s on a ~41k-line esbuild bundle
(`pi.bundle.js` / `maker.bundle.js`, pi's `@mariozechner/pi-agent-core` +
`pi-ai`); the bundle loaded under QuickJS. Apps no longer need it (their agent
loop is `lib/kit/agent.js`, both boot in ~1 s). The open question: why bronze
does not finish a single ~41k-line module. The bundles were build output and
never tracked; rebuild with `npm i && node build.mjs` in `ai/pi-agent/bundler/`
from the commit before the kit rebuild.

## Notes (not bugs; doc gaps worth a line)

- `<select>.value` round-trips correctly now; older app comments claiming
  otherwise are stale.
- `performance.now()` in headless advances only with virtual time, so fps/ms
  readouts read 62.5 fps / 0 ms there. Use `Date.now()` for wall-clock budgets.

## Fixed

- `createPhysicsNode({ body: tag })` binds the body again — bro 1d3b8445; verified 2026-09-24 (physics-playground and character-lab `tests/test_physics_node.js` pass).
- Physics `step()` no longer discards unread contact events (they accumulate until `getContacts()`) — bro 8abffa5a; verified 2026-09-24 (an `added` and a `removed` from two sub-steps both arrive). games/pegbounce can drop its per-sub-step drain.
- `ReflectionProbe.intensity` is readable and settable, including via `createReflectionProbe({ intensity })` — bro 5d3cedf8; verified 2026-09-24. demos/render-lab's probe Intensity slider works.
- `import.meta.url` in a page's entry module names that module, not index.html — verified 2026-09-24.
- World-anchored constraints (`body2: -1`) measure the right way (limits, motors, gear/rack drift) — bro 747a696a; verified 2026-09-24. mechanical-sandbox anchors joints to the world.
- `Physics.createBody` reads `dofs`, and `shape: 'chain'` reads `points` / `depth` — bro ad70148b; verified 2026-09-24 (lib-tests/test_physics.js passes).
- Wheel constraint `hertz` / `dampingRatio` suspend without translation limits — bro bf94f090; verified 2026-09-24. The frequency applies to the joint's effective mass (as in Jolt/Box2D), so a heavy chassis on light wheels sags more than `hertz` alone suggests.
- A secondary window's `bro.window` acts on its own window — bro a97ca6d4; verified 2026-09-24 (window-lab test_smoke passes).
- `postMessage({ v: view }, [view.buffer])` clones then detaches — brokit efcb977, bro 04729bdd; verified 2026-09-24. window-lab sends the view transferred.
- `new Worker(new URL(...), { type: 'module' })` works — bro 06899506; verified 2026-09-24. worker-sim and stompworld use it.
- Scene, verified 2026-09-24 (bro `tests/scene/` 58/58): `unprojectLocal(x, y)` → `{ origin, dir }` works with `setCamera` and camera nodes, plus the inverse `projectLocal(x, y, z)` (a7347b39; kit `sceneViewport.ray/toScreen`, arcade `rayAt/toScreen` and `pickRay` wrap them); TileWorld `addObject({ color })` tint and the dropped `addObjectKind` style keys (1ada0970); `atlasPixels` takes any byte view (a1136e4d); `setFog(null)` (c3b9f275); sprite `isPlaying` / `currentAnimation` (f5a7b7bb); 2D particle options and `liveCount` (d1bfc7f9); one wrapper per scene node, so `===` works (daec207d); a scene HtmlNode takes clicks only where it shows content and honours `pointer-events: none` (1b4e093b; farm's name tags are `pointer-events: none`).
- CSS animations and WAAPI are one model, verified 2026-09-24 (bro `tests/style/test_css_animation_objects.js`, `test_waapi_timing_and_lifecycle.js`): script `el.click()` no longer focuses, a label's click focuses its control properly (d32ff816); CSS animations are `CSSAnimation` objects in `el.getAnimations()` / `document.getAnimations()`, every layer of a comma list runs, `steps()` / `linear()` easings, `updatePlaybackRate`, `commitStyles`, `persist`, `effect.updateTiming`, and filled animations are auto-removed (e983ea14). An invalid easing string now throws a TypeError. waapi-lab asserts all of it.
- Follow-ups, verified 2026-09-24: `pre-wrap` / `break-word` / mixed block-and-inline blocks wrap inside text after an inline element, and inline padding mirrors on RTL text (htmlayout 72777c7, bro e6a66434); element rects subtract the root scroll, `window.scrollTo` / `scrollY` / `scrollIntoView` move the viewport (af6c4219); `setRangeText` records one undo step and `execCommand('undo'/'redo')` works in inputs and textareas (aed8325b; desktop-notebook drops its JS undo history); `deleteContents` / `surroundContents` free what they remove unless script holds it (ef5aa488); Worker `postMessage` keeps buffer identity (235dad45).
- Paint and DOM APIs, verified 2026-09-24 (bro `tests/style/`, `tests/dom/`, `tests/shadow_dom/`, `tests/events/`): `linear-gradient()` with `rgb()` stops (625516ac); tabs in `<pre>` advance to 8-column stops (d8f1039b); scrollbars follow the colour scheme and `scrollbar-color` (ea32f7e5); `CSS`, `Option`, `details.open` (bro 4450b38e, htmlayout 5483b87); selector lists split only at top-level commas (htmlayout 2e05b3d); DOMParser parses XML/SVG as XML with `parsererror` (4ca1d817); MutationObserver records for `innerHTML =` / `textContent =` (95402d6a); shadow `<style>` scoped per root, slotted children inherit from the slot (108b7bcb); keydown runs before a control's default action (ead08d78); `animation` shorthand with `cubic-bezier()` and computed longhands (htmlayout 7b0ddbc, bro 38f6d4e3), per-keyframe-interval easing (8c4e7849), removing `animation-name` cancels (35cfe935), animation/transition event fields (70f41130); a paused animation stays held when `currentTime` is written (8abda133); MediaQueryList change `currentTarget` (4033b5e9); each page module script runs as its own module under its own URL (96fb8f99). waapi-lab's CSS keyframes lane passes; the dom-lab, platform-lab, range-selection-lab, character-lab and node-forge tests assert the fixed behaviour. Note: text/comment nodes a script or MutationRecord holds now survive `innerHTML` replacement detached instead of being freed.
- Animation, media, ML, game AI, verified 2026-09-24 (ML targets run with `--ml` on the GPU): `applySkinning` takes `computeSkinningMatrices` output (bromesh f573ade, bro 5828be0a; mesh-viewer uses joint matrices); `Pose.data` is a copy by design, docs show edit-then-assign (5828be0a); `blendState().pos` absent without a blend space (ba917f37); `bro.image.gpu.colormap` — a webgl2 context now takes its drawing-buffer size from the canvas's width/height attributes at creation (a2881563); `bro.media.thumbnails().data` is a Uint8ClampedArray (f9b54b1c); `<video>` `load()` resets, fires `emptied`, and an unplayable source sets `error` code 4 (1d5fd6b9; media-inspector drops its timeout); brovisionml loaders load before moving to the GPU, docs say they are synchronous (brovisionml d56f93c, bro 3f93a71b); TripoSplat clouds come back upright facing +Z (brodiffusion 90aa215, bro 52e72df2); docs/diar-api.js `loadClusterDiarizer` arguments (923243c9); native `NavGrid.field` flow field, and `setCellCost` now prices A* (brogameagent 6477939, bro 91b1e46d; tactical-flowfield drops its JS wave); terrain `setVoxel`, clipmap `detailRelief` and FastNoise Feature Scale documented (5272b828).
- Selection, Range and editing, verified 2026-09-24 (bro `tests/dom/`, `tests/events/test_selection_press.js`): Range rects in scrolled-out text and under the menu bar, and per-line rects for wrapped inline elements (htmlayout 73996c8, bro 66aa265e, 8a83b3be); spec clone/extract/delete for partially-contained nodes, `surroundContents` throws InvalidStateError instead of hanging, `insertNode` per spec, `selectionchange` from script, `getRangeAt` returns the live range (8a83b3be); selection paint skips `display:none` and stops at element offsets (73996c8, 66aa265e); a press moves the selection only where a caret can go: a text-less block takes the caret itself, a button's child, a canvas, `pointer-events:none` text and a prevented mousedown start no selection (89a886dd); `setRangeText` (30ee3208). range-selection-lab tests assert the right results, text-lab drops `reveal()` and its ENGINE BUG panel, synth drops `user-select:none` on its viewport, desktop-notebook's `splice` uses `setRangeText`.
- Layout (htmlayout; bro tests in `tests/layout/`), verified 2026-09-24: column flex with a percentage width (978de23); `min-width` on inline-block and shrink-to-fit max-width (0f195e7, 4be8a38); `grid-column: 1 / -1` (1d72e7f); a text run after an inline element breaks inside the text (a8d25ed; inline elements join their block's lines); flex intrinsics with `letter-spacing` (8b3d5b2) and top-level inline-flex/inline-grid shrink to fit (4be8a38); flex-wrap rows that exactly fit (68c76b6); `table-layout: fixed` (404fe87); `text-overflow: ellipsis` (d6da139); rects of descendants of a newly hidden element (2ec6c57). procwatch styles its tags as chips again, shader-lab's panes are 50/50, nav-lab's test checks the button's own rect.
- bro-server no longer runs the page's scripts (with no script named it runs `server.js`) — bro 80c8ec0f; verified 2026-09-24. games/fps dropped its missing-scene tolerance.
