# Engine issues found from broworkshop

Things that do not work in bro and that apps should not paper over. Add an
entry when you hit one (date, what, minimal repro, which apps it affects);
remove it when the engine fixes it. Engine repo: `../bro`.

## Open

### `SceneGraph.unprojectLocal` signature changed under 13 apps (2026-09-24)
`scene.unprojectLocal(x, y)` → `{ origin, dir }` is what every app calls; the
bronze binding is now `unprojectLocal(node, [x, y])` → flat
`[ox, oy, oz, dx, dy, dz]` with `node` required (the native body treats a
null node as world space). Every existing call throws
`expected a __bro_native.scene.SceneNode handle, got a non-object`.
Repro: `bro-headless demos/lighting-demo -e "advanceTime(50); document.querySelector('#stage').getContext('scene').unprojectLocal(500, 500)"`.
Broke picking in games/gridkeep, hearthfolk, hexfront, tilehaven (their
tests fail in the baseline; hearthfolk, tilehaven and gridkeep are ported off it) and demos/lighting-demo light selection, plus
the other callers (`grep -rn "unprojectLocal(" games demos tools ai lib`).
Either restore the documented app-facing shape or publish the replacement
and the apps get ported to it.
The new form does not work as a replacement yet either: with a camera set
through `scene.setCamera({...})` (every orbit-camera app),
`scene.unprojectLocal(scene.root, [640, 500])` returns `[]`, because the
native body bails when `activeCamera()` is null; and `null` for the node is
rejected by the binding (`got null`). So there is currently no screen-ray
at all for setCamera apps. `lib/arcade/scene3d.js` `rayAt()` (games/tumble)
computes the ray in JS with kit `screenRay` meanwhile; switch it back to
the engine call once one works. games/farm and games/hearthfolk now pick
through the same `rayAt()` / `toScreen()` (their orthographic iso cameras
included; kit `screenRay`/`worldToScreen` handle `mode: 'orthographic'`),
and so do games/tilehaven and games/gridkeep.

### Column flex container with a percentage width stretches children to the wrong width (2026-09-24)
A `display:flex; flex-direction:column` box whose `width` is a percentage
lays its stretched children out at *that percentage of its own width*
(a 40% = 400px column gives its children 160px). Pixel widths and block
containers are fine. Minimal page:
```html
<div style="display:flex;width:1000px"><div style="width:40%;display:flex;flex-direction:column">
  <div id="c">x</div></div></div>
<!-- #c measures 160px, expected 400px -->
```
Hit while porting tools/shader-lab (switched to `flex: 1`, which is the
intended 1:1 split anyway).

### Error location misattributed across module imports (2026-09-24)
A ReferenceError at line 8 of a headless test script that imports
`/lib/system-menu.js` was reported `at .../lib/system-menu.js ... :8:21`
(the imported module's name with the script's line). Makes failures in
test scripts that import kit helpers point at the wrong file.

### ai/pi-agent and ai/maker-agent never finish booting (2026-09-24)
Both import a ~41k-line esbuild bundle (`pi.bundle.js` / `maker.bundle.js`).
bro-headless logs the page manifest and then produces nothing for 300 s
(smoke and all 12 of their tests time out); the tests' own header says the
bundle used to load under QuickJS. Looks like bronze compile time on large
single modules. Tagged `timeout=90` in `tests/app-tags.txt` so the known
timeout stays cheap.

### No `CSS` global (2026-09-24)
`CSS.supports(...)` / `CSS.escape(...)` throw ReferenceError.

### `createPhysicsNode({ body: tag })` does not bind the body (2026-09-24)
**FIXED** in bro 7c134014 (the factory maps the tag through `bodyIdForTag`).
The native factory (`native_scene_factories.cpp`) reads only `bodyId`, as a
raw Jolt `BodyID`, and ignores the `body: tag` option every app passes
(the documented shape, and what `Physics.createBody` returns). The node
never syncs, so every dynamic body's visual sits at the origin: in
demos/physics-playground the crates, ragdolls, gear wheels and machine
parts all render in one heap at (0,0,0), and demos/character-lab's props
likewise. There is no JS accessor for the raw id, so apps cannot work
around it. Isolated checks that fail until it is fixed:
demos/physics-playground/tests/test_physics_node.js,
demos/character-lab/tests/test_physics_node.js. All PhysicsNode creation
for the physics demos goes through lib/kit/physics3d.js `addBody` and
lib/kit/ragdoll.js.

### A driver script importing the page's ENTRY module evaluates it again (2026-09-24)
The module registry (`eval_jit.cpp`, `opts.moduleRegistry`) shares the
page's module instances with a headless driver script, except the entry
module named in `<script type="module" src>`: importing that one from a
test runs it a second time, so the app boots twice into one DOM and one
physics world (two sets of panels, two copies of every static body, two
contact drains splitting the event stream). Its dependencies ARE shared.
Minimal repro: page `main.js` = `import "/app/m.js"; console.log('main')`,
test = `import "/app/main.js"` logs `main` twice; a test importing
`/app/m.js` sees one `m.js`. Tests should import the app's non-entry
modules (kit apps: keep `main.js` a thin boot over importable modules).

### `new Worker(new URL(...))` throws; `import.meta.url` names the page (2026-09-24)
`new Worker(new URL('./w.js', import.meta.url), { type: 'module' })`, the
standard module-worker form, throws `new Worker(scriptPath) requires a
script path` (`host_worker.cpp` accepts only a string, resolved against the
app dir). And in `/app/main.js` loaded by `<script type="module">`,
`import.meta.url` is `file:///.../index.html`, not main.js, so even
`.href` would resolve against the wrong file. Breaks
templates/worker-sim at boot (the error is inside a DOMContentLoaded
listener, so its smoke still passes). A string path relative to the app
dir works, and module workers do load `/lib/...` and relative imports:
games/stompworld uses `new Worker('ai/trainer_worker.js', { type: 'module' })`.
Repro: `bro-headless templates/worker-sim -e "advanceTime(100)"`.

### A driver script sees a page module's `let` exports as a snapshot (2026-09-24)
Beyond the entry-module case above: a test importing a (shared, non-entry)
page module gets the values its `let` exports held at import time. When the
page later reassigns one, the test's binding never changes, whether the
reassignment comes from a page timer or from a page function the test
calls. The module instance IS shared: objects and functions are the same
ones, and an accessor function returns the live value. The namespace
object (`import * as ns`) is stale too. Minimal repro: `live.js` =
`export let y = 1; export let c = null; export function bump(){ y = y + 1; }
export function rebuild(){ c = { n: (c ? c.n : 0) + 1 }; } export function readC(){ return c; }`;
page `main.js` = `import { bump, rebuild } from "/app/live.js"; rebuild(); setTimeout(bump, 50);`.
The test imports `{ y, c, rebuild, readC }` and `* as ns` from
`/app/live.js`, then runs `advanceTime(100)`. It sees `y` and `ns.y` still 1,
though the timer set it to 2. After calling `rebuild()` itself, `c` is still
the first object, while `readC()` returns the new one. In demos/character-lab the imported
`character` handle goes stale after every controller rebuild; its tests
read `ballState.selfTag` / `characterAvatar()` instead.

### Space on a focused checkbox toggles it even when keydown is cancelled (2026-09-24)
Click a checkbox (it takes focus), then press Space: the checkbox toggles
during keydown even though a document `keydown` listener called
`preventDefault()`. In a browser, cancelling the keydown suppresses the
activation. Apps that use Space for a game action (demos/character-lab's
jump) therefore also flip whichever panel checkbox was clicked last.
Minimal page: `<input type=checkbox id=cb>` plus
`document.addEventListener('keydown', e => { if (e.key === ' ') e.preventDefault(); })`;
the test does `click()` on #cb, then `keyDown(0x20)`, and `cb.checked` flips.
character-lab's UI test clicks the viewport first, as a player would.

### Scene node wrappers are not identity-stable (2026-09-24)
`scene.activeCamera`, `scene.findByName(...)` and similar return a fresh
wrapper on each call, so `scene.activeCamera === cam` is false for the same
node. Compare `.id` instead (demos/anim-lab `cameras.js` does).

### `blendState().pos` is `[]` with no blend space (2026-09-24)
With a single clip (or crossfade) on the base track, the animation player's
`blendState().pos` is an empty array, not `undefined` as
`docs/animation-api.js` implies. Test for `pos && pos.length`.

### A scene HtmlNode swallows canvas clicks over its whole surface (2026-09-24)
A `scene.createHtmlNode({ width, height, ... })` billboard takes pointer
hits over its full layout rect, transparent areas included, and
`pointer-events: none` in its html does not let them through: a mousedown
under the billboard never reaches the canvas (not even a window capture
listener sees it), although `document.elementFromPoint` there answers the
canvas. Name tags drawn as mostly-empty 360x150 surfaces above people
therefore block clicks on whatever stands behind them. Repro: games/farm,
move the player avatar to (22, 14) (its spawn) and `click()` on the Foreman
at (22, 12): no mousedown on #view. farm's `tests/test_inspect.js` moves the
avatar aside before clicking. Want: hit-test HtmlNode content, honour
`pointer-events: none`, or an option to make a node non-interactive.

### `min-width` is ignored on `display: inline-block` (2026-09-24)
`<span style="display:inline-block; min-width:96px">lobby id</span>X` lays
the span out at its text width (55px), so the next inline sits right
against it; `width: 96px` on the same span works (96px). Chromium gives
96px for both. Seen in demos/steam-lab's `.kv` key/value rows
("lobby id—", "frames0"). Repro: a page with the span above,
`getBoundingClientRect().width` of the span.

### `grid-column: 1 / -1` does not span; negative grid lines ignored (2026-09-24)
In `grid-template-columns: 1fr 1fr` (400px wide), a child with
`grid-column: 1 / -1` is 200px (one column); `1 / 3` and `span 2` are
400px. demos/steam-lab's Events panel (meant full width under the 2x2
grid) sits in the left column only; it did before the kit port too.

### A long text run after an inline element wraps whole to the next line (2026-09-24)
`<div style="width:300px"><span>voice</span> <span>recording did not
start because the Steam library was not found anywhere</span></div>`
(12px monospace): line 1 holds only "voice"; the message starts at x=0 on
line 2 (Range rects), although "recording did not start because" fits
after "voice". Same with `white-space: normal` and `pre-wrap`, and with the
text as a bare text node after the span. Chromium breaks inside the text.
Seen in demos/steam-lab's event log: a long message leaves its kind tag
alone on the first row.

### bro-server runs the app's page scripts, and a page error kills the server (2026-09-24)
`bro-server games/fps games/fps/server.js` loads the app manifest and
evaluates index.html's `<script>`s (the log shows "AppLoader: loaded
manifest ... 1 scripts", and page stacks "in games\fps\index.html") before
the server script, in a process with no renderer. If a page script throws
(fps's did: `getContext("scene")` is null there), the server script runs to
completion — it even binds its port — and then bro-server reports
`failed to evaluate script 'games/fps/server.js'` and exits. Wrapping the
server in a probe that imports it inside try/catch shows the import itself
succeeds. Expected: bro-server does not run the page at all (or at least
does not charge a page error to the server script). games/fps now tolerates
a missing scene context at boot so its server runs; any app with a server
and a page that assumes a renderer at load is exposed.

### Double-clicking a canvas selects nearby `pointer-events: none` text (2026-09-24)
A double-click on a `<canvas>` selects a word from some other element's
text: `Engine::handleMouseDown` (`src/engine/input_mouse.cpp`) runs
`layout::hitTestText(docX, docY)` whatever the press target is, and that
text hit test finds text that is not under the pointer and that has
`pointer-events: none`. In games/wordspire, double-clicking a tile (which
submits the word) selects the toast `#action-text` ("CAT  +15", a
`pointer-events: none` overlay 100px lower), and the toast then shows the
blue selection box. Repro: in a wordspire classic run, `click(x, y)` twice
on a tile, then `String(getSelection())` is the toast text; Chromium gives
"". Expected: a press whose target is a replaced element (canvas, img,
video) starts no text selection, and text hit testing skips
`pointer-events: none` boxes. Any canvas game with a DOM overlay/toast is
exposed; `user-select: none` on the canvas would hide it.

### TileWorld `addObject({ color })` per-instance tint is ignored (2026-09-24)
tile-api.js documents `opts.color` on `addObject` as a per-instance tint
(alpha honoured on non-atlased kinds), but every instance renders in the
kind's base colour. Minimal page: a 4x1 palette TileWorld, one
`addObjectKind(Mesh.box(0.3,0.3,0.3), { color: [1,1,1,1] })`, instances
with `color: [1,0,0,1]`, `[0,1,0,1]`, `[0,0,1,1]` and none, then
`rebuild()` + `rebuildObjects()`: all four boxes are white. games/gridkeep
(tower type/level colours, creep colours, slow/hit flashes) and
games/blastgrid (bomber colours, bomb fuse redden, fire fade) lose their
colour coding; both authored white kinds for exactly this. games/tilehaven
house tints and cargo colours are affected too.

### Physics world `step()` discards contact events nobody has read yet (2026-09-24)
**FIXED** in bro 5e93be7e (events accumulate until drained, capped at the listener capacity).
Each `step()` on a `Physics.createWorldHandle()` world (and `stepInline` /
`consumeStep` on the default world) does `contactsFront_ = listener_->drain()`
in `src/physics/physics_world.cpp`, replacing the list `getContacts()`
returns. Stepping twice before reading loses the first step's events, so a
contact that begins in one sub-step and ends in the next reports only
`removed`, never `added`. Repro: a static sphere at (0,0), a ball of the
same radius dropped onto its shoulder from 30 units above, stepped as
`h.step(dt/2); h.step(dt/2); h.getContacts()` per frame: the ball visibly
deflects but the only event is `removed`. Expected: events accumulate
until `getContacts()` swaps them out (it already `swap`s). games/pegbounce
sub-steps at 1/120 s and lost glancing peg hits (pegs the ball bounced off
never lit); it now calls `getContacts()` after every sub-step.

### Flex max-content ignores a child span's own `letter-spacing` (2026-09-24)
A `display:flex` row sized by content (inside a centred flex column) comes out
narrower than its items when one item is a `<span style="letter-spacing:2px">`
that differs from its parent's spacing. The shortfall is then taken from the
item that can shrink, here an empty `width:11px` dot, which lays out at 5px.
Repro: `<div style="display:flex;flex-direction:column;align-items:center">
<div style="display:flex;gap:7px"><span style="width:11px;height:11px;
display:inline-block;background:red"></span><span>NAME</span><span
style="letter-spacing:2px">···</span></div></div>`. The dot measures 5 wide
instead of 11 (6px = 3 glyphs x 2px). Drop the inner letter-spacing and it
measures 11. Separately, a top-level `display:inline-flex` chip in the same
page measures the full viewport width (1904) rather than its content.
games/blastgrid's contender chips show their colour dots as thin bars
(`.cwins { letter-spacing: 2px }`). The old build showed no dots at all.

### Range rects are zero-width outside a scroller's viewport (2026-09-24)
`Range.getBoundingClientRect()` over text that is scrolled out of an
`overflow:auto` container's visible area returns the right `top` but
`width: 0`. Chromium returns the full rect whether the text is visible or not.
Text below the *window* fold (no inner scroller) measures correctly, and
element `getBoundingClientRect()` is fine too. Repro:
`<div id=box style="height:200px;overflow-y:auto;font:20px Arial"><div id=near>near
text</div><div style="height:1000px"></div><div id=far>far text</div></div>`.
A Range over the first 4 chars of `#far` gives width 0 (top 1023). After
`box.scrollTop = 900` it gives 28.9, and `#near`'s Range drops to 0.
demos/text-lab measures bidi, selection and caret probes inside its scrolling
`#main`, so it scrolls each probe into view first (`reveal()` in input.js).

### A click on a text-less block puts the caret in text elsewhere (2026-09-24)
A click on an empty, non-editable block that hits no text should clear the
selection (`input_mouse.cpp` has a `removeAllRanges()` branch for this). But
`layout::hitTestText` snaps to the nearest text node anywhere in the
document, so the branch never runs, and the caret lands in some other
paragraph. That paragraph can be a contenteditable one. Repro:
`<p id=other>some other text</p><div id=plain style="height:40px"></div>
<p>plain text below</p>`. Collapse the selection at `other`'s text offset 5,
then `mouseDown/mouseUp` 20px into `#plain`. The selection ends up collapsed
in `#other`'s text at offset 2 (the x-nearest character). Chromium puts a
collapsed caret inside the clicked div. demos/text-lab's editing panel
shows the control row "non-editable empty div" as ENGINE BUG.

### Range rects are shifted down by the menu bar height (2026-09-24)
Once `bro.menu` is shown (every kit app's `boot()` installs one),
`Range.getBoundingClientRect()` and `getClientRects()` (collapsed carets
included) come back `contentTop` (28px) too low. Element
`getBoundingClientRect()` and mouse hit-testing stay right. Repro: a page with
`<p id=c>Select any segment</p>` gives Range(first 6 chars).top = p.top + 4.
After `bro.menu.show(); bro.menu.set([{label:'File',items:[{id:'q',label:'Quit'}]}])`,
`innerHeight` drops 1080→1052 and p.top is unchanged, but range.top becomes
p.top + 32. So anything that hit-tests at a Range rect (drag-select from a
word, a caret HUD, a popup anchored at the selection) lands one line low.
demos/range-selection-lab's caret HUD reads 28px low. Its drag test takes its
coordinates from element rects.

### Range clone/extract drop partially-contained nodes; extract removes nothing (2026-09-24)
`Range.cloneContents()` and `extractContents()` are only right when both
boundaries are in the same text node, or are element offsets. With
`<p id=q>Select any <em>live telemetry</em> here</p>`:
- start text@3, end inside `<em>`'s text @4: clone gives `"ect any live"`, but
  the spec wants `ect any <em>live</em>` (the partially-contained `<em>` is
  cloned shallow around its part). extract returns `""` and leaves the
  document untouched.
- start text@**0**, end em text@4: clone gives `"live"`. A start at offset 0
  is treated as "fully contained" and then never collected.
- `<p id=p>The <strong>DOM Range</strong> interface</p>`, text@0 to the end
  of `<strong>`'s text (@9): clone gives `""`.
(`src/dom/range.cpp` `cloneContents` has no partially-contained-child step.)
demos/range-selection-lab's "selected fragment" preview, clone and extract
buttons show these results. Its tests pin the current wrong outputs as known
engine issues.

### `surroundContents` hangs on a text-only range and never throws (2026-09-24)
`r.setStart(t, 0); r.setEnd(t, 2); r.surroundContents(document.createElement('b'))`
on a paragraph's first text node never returns. bro-headless spins until
killed. Over a range that partially selects an element (start in text, end
inside `<em>`), the spec says throw `InvalidStateError`. bro doesn't throw:
it splits the text and inserts an empty `<mark></mark>` at the start,
extracting nothing (the extract bug above).
`Range::surroundContents` is `extractContents` + `insertNode` + re-parent,
with no partial-containment check. Ranges on element offsets
(`setStart(p, 1); setEnd(p, 2)`) wrap correctly. demos/range-selection-lab's
B / I / </> / mark / badge buttons call `surroundContents` (falling back to
extract + wrap when it throws), so they hang the app on a plain text
selection. Its tests only click them over element-offset selections.

### Clicking inside a `<button>`'s child moves the selection into it (2026-09-24)
A press on a `<button>` itself leaves the document selection alone. A press
on an element inside one (`<button><b>Bold</b></button>`, the usual editor
toolbar markup) collapses the selection into that child's text:
`input_mouse.cpp` tests only the hit target's own tag against
INPUT/TEXTAREA/SELECT/BUTTON/OPTION, not its ancestors. `preventDefault()` on
`mousedown` does not stop it either, because that path never reads
`defaultPrevented`. Chromium does neither of these. Repro: select "some" in
`<p>some plain text</p>`, then `mouseDown/mouseUp` on the centre of the `<b>`
inside `<button><b>Bold</b></button>`. The selection becomes a caret in the
`<b>`'s text. demos/range-selection-lab sets `user-select: none` on its
toolbar (normal for editor chrome), which avoids it there.

### MutationObserver: Range.deleteContents gives a characterData record with a null target (2026-09-24)
Observe `<p id=q>Select any <em>…</em></p>` with
`{ childList, characterData, subtree, characterDataOldValue }`. Then
`r.setStart(text, 0); r.setEnd(text, 6); r.deleteContents()` delivers a
`characterData` record whose `target` is `null` (oldValue `"Select any "` is
right). A later `r.insertNode(span)` adds a `childList` record with 0 added
and 0 removed nodes, next to the real one. demos/range-selection-lab's stream
shows the null target as "(record.target is null)".

### Script changes to the Selection fire no `selectionchange` (2026-09-24)
`document.addEventListener('selectionchange', …)` never fires for
`getSelection().setBaseAndExtent(…)`, `.collapse(…)` or
`removeAllRanges()` + `addRange(r)`: the count is 0 after each, with
`advanceTime` + `flush` in between. Chromium queues one event per change,
script changes included. demos/range-selection-lab's inspector re-reads the
selection after each of its own operations. A selection made by another
script is not shown until the next mouse or key event in the editor.

### A selection inside a `display:none` subtree is still painted (2026-09-24)
Select "some" in `<p id=plain>some plain text here</p>`, then set
`plain.style.display = 'none'`. The blue selection highlight stays on screen
at the paragraph's old position, over whatever is laid out there now. In
demos/range-selection-lab, a selection made on the Range tab paints over the
text shaper canvas after switching tabs (the Range pane is `hidden`).

### DOMParser parses XML and SVG types with the HTML parser (2026-09-24)
`new DOMParser().parseFromString(src, 'application/xml' | 'text/xml' |
'image/svg+xml')` returns an HTML document. `documentElement` is `<HTML>`
with HEAD/BODY, the markup sits in `<body>`, names are lowercased
(`<Feature>` → `FEATURE`) and self-closing `<b/>` becomes `<b></b>`.
Malformed XML (`<xml><unclosed><m>t</m></xml>`) gives no `<parsererror>`.
`contentType` does report the requested type. `XMLSerializer` then
serializes `<html><head></head><body>…`. demos/range-selection-lab's
DOMParser tab shows a note when an XML type comes back as HTML. Its
"malformed XML" preset cannot demonstrate a parse error.

### A shrink-to-fit `flex-wrap: wrap` row wraps items that exactly fit (2026-09-24)
An absolutely positioned `display:flex; flex-wrap:wrap; column-gap:20px`
box (the arcade `#hud.hud-row`) sizes itself to its max-content width, then
breaks the line anyway. It looks like a float comparison. games/2048: two
stats measure 43.5177 + 48.9414 + a 20px gap = 112.459, the content box is
112.459 wide, and the second stat lands on a second line. With other text
widths the same HUD stays on one row (echo, missile-command). Chromium
never wraps a shrink-to-fit flex line against its own max-content width.
Repro: `lib/arcade/arcade.css` `#hud` plus `.hud-row`, with two `.hud-stat`
children whose labels are "Score"/"Best" in Helvetica and values "0"/"2048".

### `getBoundingClientRect` of a descendant of a newly hidden element keeps its old box (2026-09-24)
Fold a panel by adding a class that sets `display:none` on its body. The
body itself then reports a 0x0 rect, and `getComputedStyle` says
`display: none`. A button inside that body still returns its old, non-zero
rect, so `clickOn` believes it is visible and clicks empty space. Seen with
the kit's `foldPanels()` in demos/nav-lab. The nav-lab tests check the rect
of the panel's direct child instead.

### bro.ai.game has no square-grid flow field (2026-09-24)
`HexNav.field` builds an integration/flow field for hex grids only. `NavGrid`
answers A* (`findPath`, with cell costs) and `hasLineOfSight`, but has no
equivalent of the field. demos/tactical-flowfield therefore runs its own
fast-marching wave in JS. With a 128x72 grid that costs 40–75 ms per
rebuild, and it rebuilds on every terrain edit, so painting stutters. A
native `NavGrid.field(goal, { costs, extraCost })` would remove the JS wave.

### Per-call overhead dominates tight JS loops (2026-09-24)
Measured in optimized (boot) bronze: about 70 ns for a trivial call to a
local function, about 250 ns for a cross-module namespace call (175 ns when
the import is first bound to a local const), and 14–40 ns for a typed-array
read. In demos/tactical-flowfield the per-unit steering loop is about
10 µs per unit per tick, even after inlining every lookup (1000 units come
to ~10 ms per 60 Hz tick). The flow-field wave takes 40 ms or more over 9k
cells. Numbers are rough and come from `perf.now()` around loops in `-e`
scripts.

### The `.k-side` scrollbar paints as a bright white strip (2026-09-24)
When a kit side column overflows, its vertical scrollbar draws as a flat
white bar that ignores the dark theme. The pre-kit nav-lab showed it too.
Cosmetic.

### A reflection probe's `intensity` cannot be set (2026-09-24)
**FIXED** in bro 4bb78bc7.
`ReflectionProbeNode` has `setIntensity`, but the bronze `SceneNode.intensity`
accessor (`bro_scene_SceneNode_intensity_get/_set` in
`native_scene_nodes.cpp`) only handles `Type::Light`: on a probe the getter
returns 1.0 and the setter drops the value. `createReflectionProbe({ intensity })`
goes through the same setter, so it is ignored too. (`interior` and `priority`
work: `scene_extras.js` types them for probes.) Repro:
`bro-headless demos/render-lab -e "advanceTime(50); const p = document.querySelector('#stage').getContext('scene').createReflectionProbe({ size: 4, intensity: 0.4 }); p.intensity = 2; console.log(p.intensity)"`
prints 1. demos/render-lab's probe Intensity slider does nothing;
`demos/render-lab/tests/test_probe_intensity.js` pins it.

### TileWorld `addObject({ color })` per-instance tint is not drawn (2026-09-24)
tile-api.js documents `opts.color` on `addObject` as a per-instance tint
(RGB on atlased kinds, RGBA otherwise). games/hexfront places every unit
from a white kind (`addObjectKind(mesh, { color: [1,1,1,1] })`) with
`color: [0.88, 0.26, 0.20, 1]` for red and `[0.28, 0.50, 0.95, 1]` for blue.
All units render white, so the two armies look the same. The HEAD version
of hexfront shows the same thing. A kind's own `style.color` works (the
green trees). Repro: `bro-headless games/hexfront games/hexfront/tests/test_main.js`,
then look at `tests/out/shots/games_hexfront-initial.png`.

### `scene.setFog(null)` throws (2026-09-24)
`setFog(null)` throws `Cannot read properties of null (reading 'startDistance')`
from the bronze `scene.js` `setFog` wrapper, which reads fields off the
argument before checking it. scene-api.js documents `setFog({})` as "fog
off", so null is only a natural guess, but other scene setters accept null
(`setEnvironment(null)`) and it should too. lib/impostor.js used null and
broke flora-lab's impostor toggle; it now passes `{}`. Repro:
`bro-headless demos/flora-lab -e "document.getElementById('stage').getContext('scene').setFog(null)"`.

### bronze: three.js r160 `new THREE.WebGLRenderer()` throws "a number is not a function" (2026-09-24)
The vendored three.min.js (r160 UMD) that demos/spatial-audio used failed
its boot smoke in the baseline: constructing the renderer throws
`TypeError: a number is not a function` at `Wa` (three.min.js 7:369004),
called from `Ot` / `new to`. The failing call is `$(1)` in
`...s.setFunc(3),K(!1),$(1),j(t.CULL_FACE),J(0)...` inside the WebGLState
factory, where `$` is a nested function declaration (`setCullFace`); the
compiled code resolves that identifier to a number instead of the hoisted
function, so it looks like a bronze scoping / function-declaration hoisting
bug with a `$`-named binding in a large minified function. Repro: an app
folder holding `git show HEAD:demos/spatial-audio/three.min.js` and a
module script `import "/app/three.min.js"; new THREE.WebGLRenderer({ canvas })`.
spatial-audio no longer uses three.js (it was rebuilt on bro.scene); no
other broworkshop app vendors it.

### World-anchored constraints (`body2: -1`) are mirrored: limits, motors, gear/rack drift correction (2026-09-24)
`PhysicsWorld::createConstraint` (physics_world.cpp) passes the moving body
as Jolt body1 and the world as body2. Jolt measures a constraint as body2
relative to body1, so for the `body2: -1` form the API documents
everything is measured backwards:
- a slider's `limitMin/limitMax` apply to the NEGATED travel of body1
  (limits `-2.1..0.1` stop a piston 0.1 m down instead of 2.1 m);
- a hinge motor's `target` spins body1 the other way;
- `gear` and `rackAndPinion` read those hinge angles / slider positions
  (via `constraint1/2`) for their position (drift) correction, so the
  correction pushes the wrong way. A motor-driven rack jitters by ±0.4 m
  frame to frame while its velocity reads a steady 0.48 m/s.
Symmetric limits hide the first two (physics-playground's rack uses ±2.2).
The fix is probably to hand Jolt `Body::sFixedToWorld` as body1 and the
body as body2 when `body2` is -1 (Jolt's own samples do this). Workaround
in demos/mechanical-sandbox (rig.js `hinge`/`slider`): anchor to a static
frame body as `body1` with the moving part as `body2`. Repro: build a crate
on `{ type: 'slider', body1: crate, axis: {x:0,y:1,z:0}, limitMin: -0.9,
limitMax: 3.2 }` and it stops 0.9 m UP. For the rack jitter, build
demos/mechanical-sandbox's gearbox with world-anchored hinges/slider and
sample the crate's y every 5 frames.

### A secondary window's `bro.window` drives the MAIN window (2026-09-24)
`getWindow()` in `src/bronze_host/native_window.cpp` always returns
`eng->window()`, so every `bro.window.*` call made from the realm of a window
opened with `window.open(dir)` reads and writes the host window instead of
its own. Repro: `bro-headless templates/kit-app -e "bro.window.setMinSize(777, 555); open('../../demos/window-lab/pinned')"`
and the pinned child reports minWidth 777 / minHeight 555 (the host's) and
`borderless: false` although its bro.json asks for `true`. The manifest
defaults are applied at creation (`applyChildManifestDefaults`) but no child
can read them back, and a child's `setMinSize` / `setBorderless` /
`setAlwaysOnTop` / `maximize` land on the host. demos/window-lab's per-child
controls and pinned card show it; its tests "per-child limits leave the host
window alone" and "the pinned card's manifest flags and limits reached its
window" assert the correct behaviour and fail until this is fixed (they were
the baseline failure).

### `postMessage({ v: view }, [view.buffer])` throws DataCloneError (2026-09-24)
Transferring a buffer while a TypedArray view of it sits in the payload is
valid on the web (the view arrives backed by the transferred buffer). bro
detaches first and then fails to clone the view: `DataCloneError: Cannot
clone TypedArray with detached buffer`. A buffer in the transfer list with
no view in the payload transfers correctly (and is detached on the sender).
Repro, in any page with a child window `w`:
`const a = new Uint8Array(1024); w.postMessage({ v: a }, [a.buffer])`.
demos/window-lab test "transfer: a view whose buffer is in the transfer list
arrives intact" asserts the correct behaviour.

### `animation:` shorthand containing `cubic-bezier()` is dropped (2026-09-24)
`.a { animation: kk 2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }` never
animates (computed `transform` stays `none`), with or without spaces inside
the parentheses. The same rule with `linear` / `ease-in-out` works, and the
longhands (`animation-timing-function: cubic-bezier(...)` etc.) work.
Separately, `getComputedStyle(el).animationName` / `animationTimingFunction`
report the defaults (`none` / `ease`) for any animation set through the
shorthand, including the ones that do run. Repro: a `<style>` with the rule
above plus `@keyframes kk { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }`,
a div with class `a`, `advanceTime(500)`, read `getComputedStyle(div).transform`.
demos/waapi-lab's arena lane 2 stands still because of it; its test "arena:
the CSS @keyframes lane moves with the other two" fails until it is fixed.

## Notes (not bugs)

- WAAPI gaps are documented in docs/web-animations-api.js and demos/waapi-lab
  probes them live: `steps()` falls back to `ease` (and
  `getTiming().easing` then reports `"ease"`, not the string given);
  `updatePlaybackRate`, `commitStyles`, `persist`, `effect.updateTiming`
  are absent. Also `document.getAnimations()` lists only script animations,
  not running CSS animations (the spec includes CSSAnimation objects).

- `terrain.setVoxel(x, y, z, v)` on a height-field terrain moves the grid
  node at `floor(x), floor(z)`, not the nearest one. A sculpt that samples
  `heightAt` at the raycast hit can therefore see no change when the hit
  lies in a triangle that does not use that node (demos/terrain's test
  samples at the floored node). Worth documenting in terrain-api.js.
- `ClipmapTerrain` `detailRelief` is a unitless slope (each detail octave's
  amplitude is relief x that octave's wavelength x the ground slope; engine
  default 0.35), per `clipmap_terrain.h`. clipmap-api.js does not say so,
  and demos/clipmap-terrain passed 18 "metres", which spiked the surface
  into km-high walls. Worth a line in the doc.

- `<select>.value` round-trips correctly now (set programmatically, and
  after a keyboard pick + `change`); older app comments claiming otherwise
  are stale.
- `performance.now()` in headless advances only with virtual time
  (`advanceTime`), so fps/ms readouts measured with it read as 62.5 fps /
  0 ms there. Use `Date.now()` for wall-clock budgets.
