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

### CSS painting

#### Canvas `fillStyle` / `strokeStyle` / `shadowColor` ignore `currentcolor` (2026-09-24)
The canvas colour parser does not know `currentcolor`; it should resolve to
the canvas element's `color`, as `ctx.filter`'s `drop-shadow()` now does.

#### Filter `blur()` lengths are read as px (2026-09-24)
CSS `filter: blur(1em)` blurs 1px; canvas filter lengths have no em support.
Shadow lengths already resolve units (bro a63dbf71).

#### Multi-line text shadows paint line by line (2026-09-24)
A later line's shadow can land on top of an earlier line's text; browsers
paint all shadows under all text of the element.

### bronze JS runtime and module loading

#### three.js r160 `new THREE.WebGLRenderer()` throws "a number is not a function" (2026-09-24)
In the r160 UMD build, the WebGLState factory's `$(1)` (a nested function
declaration, `setCullFace`) resolves to a number instead of the hoisted
function: a scoping / function-declaration hoisting bug with a `$`-named
binding in a large minified function.
Repro: an app folder holding `three.min.js` from
`git archive 9a7c6aa^ demos/spatial-audio/three.min.js` and a module script
`import "/app/three.min.js"; new THREE.WebGLRenderer({ canvas })`.
No broworkshop app vendors three.js now (spatial-audio was rebuilt on bro.scene).

#### A `for-in`/`for-of` head cannot assign to a property (2026-09-24)
`for (o.a of xs)`, `for ([o.b] of xs)` and `for ({ x: o.c } of xs)` fail to
parse ("expected ';' after for init"): the AST stores only a name or pattern
for the loop head, so parser, lowering and every walk need a target
expression there.

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
- In headless, a `<video>` with sound follows the audio that `advanceTime`
  renders, and rAF sees the same `currentTime` a script reads after the step
  (bro 37f855bc). Where a clip ends after a fixed number of steps can vary by a
  frame from run to run (hello.webm: 0.500 or 0.533 s), probably because audio
  waits for the first decoded picture. Assert ranges, not exact end times.

## Fixed

- Shadows, verified 2026-09-24 (bro `tests/style/test_shadow_lists_units.js`, `tests/canvas/test_canvas_filter.js`): every text-shadow in a list paints, and shadow lengths resolve em/rem/viewport/absolute units and `calc()` — bro a63dbf71; canvas `ctx.filter` `drop-shadow()` uses the canvas's `color` for `currentcolor` — bro 3ceef1a7.
- bronze modules and destructuring, verified 2026-09-24 (oracle cases `module_namespace_identity/`, `module_destructuring_member_target/`, `destructuring_member_target_suspend.js`; `eval_module_registry_test.cpp`): one namespace object per module across importers, `export * as`, `import()` and the registry publish (818e132); member targets in destructuring patterns see imported bindings, `import()` inside patterns/parameter defaults/class fields is rewritten (818e132); `yield` and calls inside a member target, and nested patterns with defaults, compile correctly (07da771).
- CSS painting, verified 2026-09-24: a shadow that names no colour paints in `currentcolor` (box-shadow, text-shadow, `drop-shadow()`), and one shared parser now reads space-syntax colours, colour-first order and `drop-shadow(12px 0 lime)` correctly — bro 88ac32cc (`tests/style/test_shadow_currentcolor.js`); `skew(ax, ay)` is one matrix in the 3D parse that `getBoundingClientRect` and transform interpolation use — htmlayout dceefc6, bro 89afb4a6 (`tests/style/test_skew_two_angles.js`).
- CSS transitions, verified 2026-09-24 (bro `tests/style/test_starting_style.js`, `test_transition_value_interpolation.js`; htmlayout `testStartingStyle`): `@starting-style` (top level, nested, inside @media/@layer/@container/@supports) gives new and re-shown elements a starting style to transition from — htmlayout 8289782, bro 39c2d206 (which also relayouts for transitioning layout properties); transform lists of different shapes interpolate per CSS Transforms 2, through matrix decomposition from the first mismatch — bro 4f2193b7; multi-value strings (`box-shadow`, `text-shadow`, `drop-shadow()`, two-value lengths) blend part by part, with colours premultiplied — same commit. Remaining limits, documented in docs/web-animations-api.js: a starting style inherits from the parent's normal style, and percentages inside the matrix part of a transform still flip at 50%. bronze: an anonymous class expression takes the name of its binding (2b7828e).
- Module registry, verified 2026-09-24 (bro `tests/headless/test_module_entry_shared.js`, `test_module_live_bindings.js`; bronze `eval_module_registry_test.cpp`): a driver importing the page's `<script type="module" src>` entry gets the running instance instead of evaluating it again, and `let` exports (named and `import * as ns`) are live across page and driver — bronze 8c5000c, bro 390e80de. character-lab's crowd-ball test uses the imported `character` binding, platform-lab exports `listenerMql` directly, and the "entry evaluated twice" / "exports are snapshots" comments across the apps and lib/kit/README.md are gone.
- bronze runtime, verified 2026-09-24 (bronze oracle cases, bro `tests/headless/test_error_stack_module_file.js`): a NaN typed as a number is falsy in `||`/`&&`/`?:`/`!`/`if` (bronze f811611); `String.prototype.lastIndexOf` honours `fromIndex` (022edba); a stack frame names the file its position is in, not the imported module's (6ca2430, bro c1b84a4f; ABI change); functions and classes in imported modules no longer carry the bundler's `modN.` prefix in `.name` and stack frames (5b45e02). tools/synth's tempo is back to the `+d.bpm || 120` idiom; desktop-notebook's Tab-indent test runs.
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
- CSS animations and WAAPI are one model, verified 2026-09-24 (bro `tests/style/test_css_animation_objects.js`, `test_waapi_timing_and_lifecycle.js`): script `el.click()` no longer focuses, a label's click focuses its control properly (d32ff816); CSS animations are `CSSAnimation` objects in `el.getAnimations()` / `document.getAnimations()`, every layer of a comma list runs, `steps()` / `linear()` easings, `updatePlaybackRate`, `commitStyles`, `persist`, `effect.updateTiming`, and filled animations are auto-removed (e983ea14). An invalid easing string now throws a TypeError. waapi-lab asserts all of it. Then (f9788f50): running transitions are `CSSTransition` objects with the spec's reversal and cancel rules, `display: none` cancels CSS animations and transitions, and `document.getAnimations()` is in spec order.
- `elementFromPoint` / `elementsFromPoint` return exactly what a click hits (the separate fallback search that ignored stacking, clipping and `pointer-events` is gone) — bro e14dcc33; `transition-behavior: allow-discrete`, discrete changes apply at once otherwise, `display` exit transitions, `visibility` / `none`-transform interpolation — htmlayout 270a374, bro 8fb54148. Verified 2026-09-24; bro full suite 565/565.
- `position: fixed` stays put when the viewport scrolls (paint, hit testing, rects) and the root scroll range covers overflowing content (htmlayout cc8f802, bro 8b841d6a); a stretched grid/flex item lays its contents out against the stretch, so a `flex: 1` fill grows with its card (htmlayout b07ecf3, bro 2a80997b; reader's progress bar is `flex: none`, its buttons sit at the card bottom); Worker `postMessage` and `bro.net.sendClone` keep object identity and clone cycles (0295ee67). Verified 2026-09-24.
- Follow-ups, verified 2026-09-24: `pre-wrap` / `break-word` / mixed block-and-inline blocks wrap inside text after an inline element, and inline padding mirrors on RTL text (htmlayout 72777c7, bro e6a66434); element rects subtract the root scroll, `window.scrollTo` / `scrollY` / `scrollIntoView` move the viewport (af6c4219); `setRangeText` records one undo step and `execCommand('undo'/'redo')` works in inputs and textareas (aed8325b; desktop-notebook drops its JS undo history); `deleteContents` / `surroundContents` free what they remove unless script holds it (ef5aa488); Worker `postMessage` keeps buffer identity (235dad45).
- Paint and DOM APIs, verified 2026-09-24 (bro `tests/style/`, `tests/dom/`, `tests/shadow_dom/`, `tests/events/`): `linear-gradient()` with `rgb()` stops (625516ac); tabs in `<pre>` advance to 8-column stops (d8f1039b); scrollbars follow the colour scheme and `scrollbar-color` (ea32f7e5); `CSS`, `Option`, `details.open` (bro 4450b38e, htmlayout 5483b87); selector lists split only at top-level commas (htmlayout 2e05b3d); DOMParser parses XML/SVG as XML with `parsererror` (4ca1d817); MutationObserver records for `innerHTML =` / `textContent =` (95402d6a); shadow `<style>` scoped per root, slotted children inherit from the slot (108b7bcb); keydown runs before a control's default action (ead08d78); `animation` shorthand with `cubic-bezier()` and computed longhands (htmlayout 7b0ddbc, bro 38f6d4e3), per-keyframe-interval easing (8c4e7849), removing `animation-name` cancels (35cfe935), animation/transition event fields (70f41130); a paused animation stays held when `currentTime` is written (8abda133); MediaQueryList change `currentTarget` (4033b5e9); each page module script runs as its own module under its own URL (96fb8f99). waapi-lab's CSS keyframes lane passes; the dom-lab, platform-lab, range-selection-lab, character-lab and node-forge tests assert the fixed behaviour. Note: text/comment nodes a script or MutationRecord holds now survive `innerHTML` replacement detached instead of being freed.
- Animation, media, ML, game AI, verified 2026-09-24 (ML targets run with `--ml` on the GPU): `applySkinning` takes `computeSkinningMatrices` output (bromesh f573ade, bro 5828be0a; mesh-viewer uses joint matrices); `Pose.data` is a copy by design, docs show edit-then-assign (5828be0a); `blendState().pos` absent without a blend space (ba917f37); `bro.image.gpu.colormap` — a webgl2 context now takes its drawing-buffer size from the canvas's width/height attributes at creation (a2881563); `bro.media.thumbnails().data` is a Uint8ClampedArray (f9b54b1c); `<video>` `load()` resets, fires `emptied`, and an unplayable source sets `error` code 4 (1d5fd6b9; media-inspector drops its timeout); brovisionml loaders load before moving to the GPU, docs say they are synchronous (brovisionml d56f93c, bro 3f93a71b); TripoSplat clouds come back upright facing +Z (brodiffusion 90aa215, bro 52e72df2); docs/diar-api.js `loadClusterDiarizer` arguments (923243c9); native `NavGrid.field` flow field, and `setCellCost` now prices A* (brogameagent 6477939, bro 91b1e46d; tactical-flowfield drops its JS wave); terrain `setVoxel`, clipmap `detailRelief` and FastNoise Feature Scale documented (5272b828).
- Selection, Range and editing, verified 2026-09-24 (bro `tests/dom/`, `tests/events/test_selection_press.js`): Range rects in scrolled-out text and under the menu bar, and per-line rects for wrapped inline elements (htmlayout 73996c8, bro 66aa265e, 8a83b3be); spec clone/extract/delete for partially-contained nodes, `surroundContents` throws InvalidStateError instead of hanging, `insertNode` per spec, `selectionchange` from script, `getRangeAt` returns the live range (8a83b3be); selection paint skips `display:none` and stops at element offsets (73996c8, 66aa265e); a press moves the selection only where a caret can go: a text-less block takes the caret itself, a button's child, a canvas, `pointer-events:none` text and a prevented mousedown start no selection (89a886dd); `setRangeText` (30ee3208). range-selection-lab tests assert the right results, text-lab drops `reveal()` and its ENGINE BUG panel, synth drops `user-select:none` on its viewport, desktop-notebook's `splice` uses `setRangeText`.
- Layout (htmlayout; bro tests in `tests/layout/`), verified 2026-09-24: column flex with a percentage width (978de23); `min-width` on inline-block and shrink-to-fit max-width (0f195e7, 4be8a38); `grid-column: 1 / -1` (1d72e7f); a text run after an inline element breaks inside the text (a8d25ed; inline elements join their block's lines); flex intrinsics with `letter-spacing` (8b3d5b2) and top-level inline-flex/inline-grid shrink to fit (4be8a38); flex-wrap rows that exactly fit (68c76b6); `table-layout: fixed` (404fe87); `text-overflow: ellipsis` (d6da139); rects of descendants of a newly hidden element (2ec6c57). procwatch styles its tags as chips again, shader-lab's panes are 50/50, nav-lab's test checks the button's own rect.
- bro-server no longer runs the page's scripts (with no script named it runs `server.js`) — bro 80c8ec0f; verified 2026-09-24. games/fps dropped its missing-scene tolerance.
