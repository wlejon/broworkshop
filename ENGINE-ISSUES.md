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

### Animation and rigging

#### `mesh.applySkinning` applies the inverse bind matrices a second time (2026-09-24)
bromesh `applySkinning` (src/manipulation/skin.cpp) multiplies each matrix
by the skin's `inverseBindMatrices` itself, but its header, `pose.h`'s
`computeSkinningMatrices` comment and docs/rigging-api.js say to pass
`pose.computeSkinningMatrices(skeleton)` (already world x inverseBind).
Repro: a 2-bone column (y 0..2, bone 1 at y=1) bent 90 degrees at bone 1:
with `computeSkinningMatrices` the vertices reach max |x| 0.2; with
`computeWorldMatrices` they reach 1.0 (correct). bro's own tests use both
(tests/rigging/diag_autorig_locomotion.js vs probe_meshy.js).
Affects: tools/mesh-viewer uses world matrices and its test pins the bent
shape, so it flags whichever way this is resolved.

#### `Pose.data` returns a copy; writing into it does nothing (2026-09-24)
docs/rigging-api.js calls `pose.data` "stride 10 per bone; writable". Writing
elements of the returned array (`pose.data[13..16] = quat`) leaves the pose
unchanged; only assigning a whole array back (`const d = pose.data; ...;
pose.data = d`) takes effect. Either return a live view or document the
copy-and-assign form.

#### `blendState().pos` is `[]` with no blend space (2026-09-24)
With a single clip on the base track, `blendState().pos` is an empty array,
not `undefined` as docs/animation-api.js implies. Test for `pos && pos.length`.
Repro: demos/anim-lab, `selectClip('idle')`, `player.blendState().pos` → `[]`.

### Layout and CSS

#### Inline wrapping still whole-node in `pre-wrap`, `break-word`, and mixed block/inline blocks (2026-09-24)
htmlayout now breaks a text run after an inline element inside the text
(htmlayout a8d25ed), but two paths keep the old behaviour: text in
`white-space: pre-wrap` or `overflow-wrap: break-word` is still broken once
per text node against the full line width, and a block that mixes block-level
and inline children lays each span out as one box.
Repro: `<div style="width:300px;font:12px monospace;white-space:pre-wrap"><span>voice</span> <span id=m>recording did not start because the Steam library was not found anywhere</span></div>`:
`#m` starts on line 2.

#### Inline padding on right-to-left text is placed as if left-to-right (2026-09-24)
A span holding RTL text inside an RTL paragraph gets its start padding on the
left and end padding on the right; they should mirror. LTR spans inside RTL
paragraphs are right.

### Paint and text rendering

#### `linear-gradient()` with `rgb()` stops paints solid black (2026-09-24)
`background: linear-gradient(90deg, rgb(20, 40, 90), rgb(220, 180, 80))` (and
the `background-image` longhand) paints the box black; the same gradient with
hex stops paints. `getComputedStyle` reports the gradient correctly, so it is
the paint side (probably splitting the stop list on the commas in `rgb(...)`).
Affects: tools/algo-viz's pathfinding legend (now hex).

#### A tab inside `<pre>` renders as a missing-glyph box (2026-09-24)
U+0009 in preformatted text paints as a tofu box instead of advancing to the
next tab stop. Repro: `<pre>a\tb\t\tc</pre>`, screenshot.
Affects: demos/vlm-lab (tab-indented JSON in Markdown code blocks via lib/markdown.js).

#### Scrollbars ignore the dark theme: a bright white strip (2026-09-24)
An overflowing `overflow-y: scroll` box on a dark background draws its
vertical scrollbar as a flat white bar. Cosmetic.
Affects: the kit `.k-side` column (demos/nav-lab and others).

### Selection, Range and editing

#### Range rects are zero-width outside a scroller's viewport (2026-09-24)
`Range.getBoundingClientRect()` over text scrolled out of an `overflow:auto`
container returns the right `top` but `width: 0`. Text below the window fold
and element rects are fine.
Repro: `<div style="height:200px;overflow-y:auto;font:20px Arial"><div>near text</div><div style="height:1000px"></div><div id=far>far text</div></div>`,
a Range over `#far`'s first 4 chars: width 0 (29 once scrolled into view).
Affects: demos/text-lab scrolls each probe into view first (`reveal()` in input.js).

#### Range rects are shifted down by the menu bar height (2026-09-24)
Once `bro.menu` is shown (every kit app's `boot()` installs one), Range
`getBoundingClientRect()` / `getClientRects()` (collapsed carets included) come
back 28px too low; element rects and mouse hit-testing stay right.
Repro: `<p id=c>Select any segment</p>`, Range over the first 6 chars:
`range.top - p.top` is 0, then 28 after
`bro.menu.show(); bro.menu.set([{label:'File',items:[{id:'q',label:'Quit'}]}])`.
Affects: demos/range-selection-lab's caret HUD; anything anchored to a
selection rect.

#### Range clone/extract drop partially-contained nodes; extract removes nothing (2026-09-24)
`cloneContents()` / `extractContents()` are right only when both boundaries
are in one text node or are element offsets (`src/dom/range.cpp` has no
partially-contained-child step). With `<p id=q>Select any <em>live telemetry</em> here</p>`
and `<p id=p>The <strong>DOM Range</strong> interface</p>`:
- text@3 → em text@4: clone gives `"ect any live"` (want `ect any <em>live</em>`);
  extract returns `""` and leaves the document untouched;
- text@0 → em text@4: clone gives `"live"`;
- `#p` text@0 → end of `<strong>`'s text: clone gives `""`.
Affects: demos/range-selection-lab's fragment preview, clone and extract
buttons; its tests pin the current wrong outputs.

#### `surroundContents` hangs on a text-only range and never throws (2026-09-24)
`r.setStart(t, 0); r.setEnd(t, 2); r.surroundContents(document.createElement('b'))`
on a paragraph's text node never returns (killed after 30 s). Over a range that
partially selects an element (text@3 → inside `<em>`) the spec says throw
`InvalidStateError`; bro inserts an empty `<mark></mark>` at the start instead
(`Sel<mark></mark>ect any <em>live</em> here`). Element-offset ranges wrap correctly.
Affects: demos/range-selection-lab's B / I / </> / mark / badge buttons hang
the app on a plain text selection; its tests only use element-offset selections.

#### Script changes to the Selection fire no `selectionchange` (2026-09-24)
`selectionchange` never fires for `getSelection().setBaseAndExtent(...)`,
`.collapse(...)` or `removeAllRanges()` + `addRange(r)` (count 0 after each,
with `advanceTime` + `flush`). Chromium queues one per change.
Affects: demos/range-selection-lab's inspector re-reads after its own operations.

#### Selection paint: shown inside `display:none`, and overshoots an element-offset end (2026-09-24)
- Select "some" in `<p id=plain>some plain text here</p>`, then
  `plain.style.display = 'none'`: a blue selection box stays painted (at the
  top-left of the page in the repro), over whatever is there now.
  demos/range-selection-lab: a Range-tab selection paints over the text
  shaper canvas after switching tabs.
- `<p id=p1>first <b>second</b> tail</p>`, `r.setStart(p1.firstChild, 4); r.setEnd(p1, 2)`
  mirrored into the selection: `toString()` is `"t second"`, but the highlight
  runs to the end of the paragraph. demos/dom-lab's Range panel.

#### A click on a text-less block puts the caret in text elsewhere (2026-09-24)
A click on an empty non-editable block should clear the selection
(`input_mouse.cpp` has a `removeAllRanges()` branch), but
`layout::hitTestText` snaps to the nearest text anywhere, so the caret lands
in another paragraph (possibly a contenteditable one).
Repro: `<p id=other>some other text</p><div id=plain style="height:40px"></div><p>plain text below</p>`,
collapse the selection in `#other`, then `mouseDown/mouseUp` 20px into
`#plain`: the selection collapses in "plain text below" at offset 3.
Chromium puts the caret in the clicked div.
Affects: demos/text-lab's editing panel shows it as ENGINE BUG.

#### Clicking inside a `<button>`'s child moves the selection into it (2026-09-24)
A press on a `<button>` leaves the selection alone; a press on an element
inside one (`<button><b>Bold</b></button>`, usual toolbar markup) collapses
the selection into that child's text: `input_mouse.cpp` checks only the hit
target's own tag, and never reads `defaultPrevented` on mousedown.
Repro: select "some" in `<p>some plain text</p>`, `mouseDown/mouseUp` on the
`<b>`: the selection becomes `""` inside the `<b>`.
Affects: demos/range-selection-lab uses `user-select: none` on its toolbar.

#### Double-clicking a canvas selects nearby `pointer-events: none` text (2026-09-24)
`Engine::handleMouseDown` runs `layout::hitTestText(docX, docY)` whatever the
press target is, and the text hit test finds text that is not under the
pointer and has `pointer-events: none`.
Repro: a 300x200 `<canvas>` and below it an absolutely positioned
`pointer-events:none` div "CAT  +15"; two `click()`s on the canvas:
`String(getSelection())` is `"15"` (Chromium `""`).
Affects: games/wordspire (double-clicking a tile selects the `#action-text`
toast). Any canvas game with a DOM overlay; `user-select: none` on the canvas hides it.
Want: a press on a replaced element (canvas, img, video) starts no text
selection, and text hit testing skips `pointer-events: none`.

#### A canvas drag with `mousedown` default-prevented still selects text (2026-09-24)
Pressing on a `<canvas>` whose `mousedown` handler calls `preventDefault()`
and dragging still starts a text selection. Chromium starts none.
Repro: `<div hidden>…</div><canvas width=400 height=200></canvas><p>visible after</p>`,
drag across the canvas: `String(getSelection())` is `"e after"`.
In tools/synth (with `user-select: none` removed from
`[data-pane=editor] .k-viewport`) the selection also ran through a `hidden`
pane's labels and painted phantom highlight boxes over the canvas; the
minimal repro no longer selects the hidden text (not re-run in the synth).
Affects: tools/synth keeps `user-select: none` on its waveform viewport.

#### `<textarea>` / `<input>` have no `setRangeText` (2026-09-24)
`typeof document.createElement('textarea').setRangeText` is `'undefined'`.
Affects: tools/desktop-notebook (lib/editor.js `splice` rewrites `value` +
`setSelectionRange`, losing native undo grouping).

### DOM APIs, events, CSS animations

#### Missing globals and properties: `CSS`, `Option`, `HTMLDetailsElement.open` (2026-09-24)
- `typeof CSS` is `'undefined'`: `CSS.supports` / `CSS.escape` throw.
- `typeof Option` is `'undefined'` (`Image` exists). Apps use
  `document.createElement('option')`.
- `<details>` has no `open` property: `d.open = true` sets an expando (no
  attribute, stays closed); `d.open` is `undefined` after
  `setAttribute('open', '')`. tools/node-forge's tests click the `<summary>`.

#### `querySelector` splits at a comma inside a quoted attribute value (2026-09-24)
`document.querySelector('[data-x="1,2"]')` returns `<html>`;
`querySelectorAll` matches every element. `el.matches(...)` is right.
Affects: tools/inpainting-studio's outpaint buttons use side names instead.

#### DOMParser parses XML and SVG types with the HTML parser (2026-09-24)
`parseFromString(src, 'application/xml' | 'text/xml' | 'image/svg+xml')` gives
an HTML document (`documentElement` is `HTML`, names lowercased, `<b/>`
becomes `<b></b>`, no `<parsererror>` for malformed XML); `contentType` does
report the requested type.
Affects: demos/range-selection-lab's DOMParser tab (notes it; its "malformed
XML" preset cannot show a parse error).

#### MutationObserver: missing and malformed records (2026-09-24)
- `innerHTML = ''` and `textContent = ''` queue no record;
  `innerHTML = '<b>x</b>'` reports 1 added / 0 removed.
  `replaceChildren()` / `removeChild` are right. demos/dom-lab logs the gap.
- `Range.deleteContents()` over `<p>`'s first text node (0..6), observed with
  `{ childList, characterData, subtree, characterDataOldValue }`, gives a
  `characterData` record with `target: null` (oldValue right), then a
  `childList` record with 1 added node and an empty `childList` record
  (0 added, 0 removed). demos/range-selection-lab shows "(record.target is null)".

#### Shadow DOM: `<style>` not scoped per shadow root; slotted children inherit from the host (2026-09-24)
- Two shadow roots with `<style>.x{color:red}</style><b class=x>` and
  `<style>.x{color:blue}</style><b class=x>`: both `<b>` compute blue (last
  sheet wins). demos/dom-lab's "ocean" `<card-box>` paints the sunset gradient.
- A light-DOM child in a `<slot>` inside a shadow `<h3 style="color:red;font-weight:700">`
  computes the host's colour and weight 400 instead of the h3's.
  demos/dom-lab's slotted card title.

#### Space on a focused checkbox toggles it even when keydown is cancelled (2026-09-24)
Click a checkbox (it takes focus), press Space with a document `keydown`
listener calling `preventDefault()`: the checkbox still toggles. In a browser,
cancelling keydown suppresses the activation.
Repro: `<input type=checkbox id=cb>`, that listener, `click()` on `#cb`,
`keyDown(0x20)`: `checked` goes true → false.
Affects: demos/character-lab (Space = jump flips the last clicked checkbox;
its UI test clicks the viewport first).

#### `animation:` shorthand containing `cubic-bezier()` is dropped; shorthand not reflected in computed style (2026-09-24)
`.a { animation: kk 2s cubic-bezier(0.4, 0, 0.2, 1) infinite }` never animates
(computed `transform` stays `none`); with `linear` it runs, and the longhands
work. Separately, `getComputedStyle(el).animationName` /
`animationTimingFunction` report `none` / `ease` for any animation set through
the shorthand, including running ones.
Repro: that rule plus `@keyframes kk { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }`,
`advanceTime(500)`: cubic → `none`, linear → `rotate(90deg)`.
Affects: demos/waapi-lab arena lane 2 (its test "the CSS @keyframes lane
moves with the other two" fails until fixed).

#### Writing `Animation.currentTime` un-holds a paused animation (2026-09-24)
`const a = el.animate([{left:'0px'},{left:'600px'}], {duration: 4000}); a.pause(); a.currentTime = 0; advanceTime(500)`
→ `playState` `paused` but `currentTime` 500. `pause()` alone holds.
Affects: demos/platform-lab parks its transport this way at boot (its smoke
test logs the drift).

#### MediaQueryList change event has no `currentTarget` (2026-09-24)
docs/matchmedia-api.js lists `currentTarget` on the change event; `target` is
the list, `currentTarget` is not.
Repro: `const m = matchMedia('(min-width: 900px)'); m.onchange = e => console.log(e.currentTarget === m); resize(700, 900)` → false.
Affects: demos/platform-lab's smoke test logs it.

### Windows, workers, messaging

#### Worker `postMessage` does not keep buffer identity (2026-09-24)
Two views of one ArrayBuffer posted to a Worker arrive over two separate
buffers (a write through one is not seen by the other). The window path
(`structuredClone`) keeps identity, as the web does.
Repro: `const b = new ArrayBuffer(8); w.postMessage({ a: new Uint8Array(b), c: new Uint8Array(b) })`;
in the worker `e.data.a.buffer === e.data.c.buffer` is false.

#### Page module scripts are compiled as `index.html` (2026-09-24)
bro joins a page's scripts into one program compiled under `index.html`'s
name (`engine_init.cpp` `initAppRealm`), so `<script type="module"
src="sub/main.js">` gets `import.meta.url` = index.html and its relative
imports resolve from the app root (`import "./lib.js"` fails). An entry at the
app root hides it; modules imported from the entry get their own URL.

### Media

#### `bro.image.gpu.colormap` samples a sliver of the field (2026-09-24)
A 64x64 field holding a 0..1 horizontal ramp, `colormap(cv, f, lut, { lo: 0,
hi: 1, srcW: 64, srcH: 64 })` into a 64x64 webgl2 canvas, read back with
`readPixels`: the row reads 0, 0, 2, 4, 6 at x = 0, 16, 32, 48, 63 instead of
a 0..255 ramp (about 1/40 of the field width). The shader in
bro/src/bronze_host/js/image_gpu.js reads correctly, so probably the upload or UV setup.
Affects: demos/image-kernels' GPU view looks magnified against its CPU path
(its test_kernels.js logs the edge value).

#### `bro.media.thumbnails().data` is a Uint8Array, docs say Uint8ClampedArray (2026-09-24)
docs/video-api.js promises a `Uint8ClampedArray` (and shows
`new ImageData(strip.data, ...)`).
Repro: `bro.media.thumbnails('demos/video_demo/hello.webm', { count: 2 }).data.constructor.name`.
Affects: tools/media-inspector views the buffer as clamped bytes itself
(filmstrip.js `stripCanvas`).

#### `<video>` load of a missing or unsupported file: no `error`, stale state (2026-09-24)
After a good WebM, setting `src` to an Ogg Vorbis file or a missing path and
calling `load()` fires neither `loadedmetadata` nor `error` (nor `emptied`),
and the element keeps the previous file's `readyState` 4, `duration` 2.008,
`videoWidth` 320; `error` stays unset. Per spec `load()` resets to
HAVE_NOTHING and an unplayable source fires `error` (MEDIA_ERR_SRC_NOT_SUPPORTED).
Repro: `v.src = 'demos/video_demo/hello.webm'; v.load();` pump, then
`v.src = 'demos/scene-audio/assets/pad-chime.ogg'; v.load();` pump.
Affects: tools/media-inspector/player.js waits with a timeout. (Not a bug:
bro.media and `<video>` read WebM (VP9/VP8 + Opus) only, so the Ogg clips
AudioContext decodes cannot be inspected.)

### ML bindings (brovisionml, triposplat, diar)

#### brovisionml loaders call `to()` before `load()` on CUDA; callbacks never fire (2026-09-24)
Every bro.vision loader except `loadBirefnet` throws on the default (CUDA)
device, e.g. `loadDepth failed: dinov2::Backbone: to() called before load()`;
likewise loadNormal (dsine::EncoderB5), loadHed, loadLineart, loadMlsd,
loadOpenpose, loadSegformer, loadSam (sam::ImageEncoder). With
`{ device: 'cpu' }` they succeed, so the binding (brovisionml
`src/api/native_vision_models.cpp`) moves the module before loading weights.
The loaders also ignore `onReady` / `onError` (they load synchronously and
return the model).
Repro: `bro-headless demos/nllb-lab -e "bro.vision.loadDepth('<weights>/brovisionml/weights/Depth-Anything-V2-Small', {})"`
(re-run 2026-09-24 for loadDepth only).
Affects: demos/vision-lab (loads synchronously, shows the error, its test
logs each as KNOWN); tools/inpainting-studio's Depth-map ControlNet guide
falls back to a black map (tests/test_generate.js logs KNOWN and wants a real
map once fixed).

#### TripoSplat clouds come back upside down (2026-09-24, not re-run)
docs/triposplat-api.js says `generate()` returns Y-up positions; for
demos/triposplat's portrait sample (green cap, blue overalls) the green
splats' mean y is -0.25 and the blue ones' +0.18, and the figure shows
head-down from the default camera. The Z-up → Y-up rotation probably has the
wrong sign. demos/triposplat renders the cloud as returned.

#### docs/diar-api.js has `loadClusterDiarizer`'s arguments wrong (2026-09-24)
The doc says `loadClusterDiarizer(embeddingDir, vadDir, opts)`; the binding
takes `(sortformerDir, speakerEncoderDir, opts)` (Sortformer activity is the
VAD, the Qwen-TTS speaker encoder gives the embeddings). demos/cluster-diar-lab
calls it the binding's way.

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

### Game AI

#### bro.ai.game has no square-grid flow field (2026-09-24)
`HexNav.field` builds an integration/flow field for hex grids only; a
`createNavGrid(...)` object has `findPath` and `hasLineOfSight` but no
`field`. demos/tactical-flowfield runs its own fast-marching wave in JS
(40–75 ms per rebuild on 128x72, on every terrain edit). Want a native
`NavGrid.field(goal, { costs, extraCost })`. Feature request.

## Notes (not bugs; doc gaps worth a line)

- WAAPI gaps are documented in docs/web-animations-api.js and demos/waapi-lab
  probes them live: `steps()` falls back to `ease` (and `getTiming().easing`
  then reports `"ease"`); `updatePlaybackRate`, `commitStyles`, `persist`,
  `effect.updateTiming` are absent; `document.getAnimations()` lists only
  script animations, not running CSS animations.
- `terrain.setVoxel(x, y, z, v)` on a height-field terrain moves the grid node
  at `floor(x), floor(z)`, not the nearest one, so a sculpt sampling
  `heightAt` at the raycast hit can see no change (demos/terrain's test samples
  at the floored node). Worth documenting in terrain-api.js.
- `ClipmapTerrain` `detailRelief` is a unitless slope (engine default 0.35,
  per `clipmap_terrain.h`); clipmap-api.js does not say so, and
  demos/clipmap-terrain once passed 18 "metres" (km-high walls).
- `<select>.value` round-trips correctly now; older app comments claiming
  otherwise are stale.
- `performance.now()` in headless advances only with virtual time, so fps/ms
  readouts read 62.5 fps / 0 ms there. Use `Date.now()` for wall-clock budgets.
- FastNoise2 coherent generators (Simplex, Perlin, Value, Cellular*) default to
  a "Feature Scale" of ~100 world units per feature, so
  `genUniformGrid2D(x, y, w, h, frequency, seed)` with a classic frequency
  (0.01..0.1) is almost flat. `node.set('Feature Scale', 1)` restores
  "features per unit" (matches `bro.image.gpu.fbm2D`). noise-api.js should
  say so, and that the offsets are world space. tools/algo-viz was ~100x too
  smooth because of it.

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
- Layout (htmlayout; bro tests in `tests/layout/`), verified 2026-09-24: column flex with a percentage width (978de23); `min-width` on inline-block and shrink-to-fit max-width (0f195e7, 4be8a38); `grid-column: 1 / -1` (1d72e7f); a text run after an inline element breaks inside the text (a8d25ed; inline elements join their block's lines); flex intrinsics with `letter-spacing` (8b3d5b2) and top-level inline-flex/inline-grid shrink to fit (4be8a38); flex-wrap rows that exactly fit (68c76b6); `table-layout: fixed` (404fe87); `text-overflow: ellipsis` (d6da139); rects of descendants of a newly hidden element (2ec6c57). procwatch styles its tags as chips again, shader-lab's panes are 50/50, nav-lab's test checks the button's own rect.
- bro-server no longer runs the page's scripts (with no script named it runs `server.js`) — bro 80c8ec0f; verified 2026-09-24. games/fps dropped its missing-scene tolerance.
