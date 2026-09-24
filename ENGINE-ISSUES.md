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
Breaks picking in games/gridkeep, hearthfolk, hexfront, tilehaven (their
tests fail in the baseline) and demos/lighting-demo light selection, plus
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
included; kit `screenRay`/`worldToScreen` handle `mode: 'orthographic'`).

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

## Notes (not bugs)

- `<select>.value` round-trips correctly now (set programmatically, and
  after a keyboard pick + `change`); older app comments claiming otherwise
  are stale.
- `performance.now()` in headless advances only with virtual time
  (`advanceTime`), so fps/ms readouts measured with it read as 62.5 fps /
  0 ms there. Use `Date.now()` for wall-clock budgets.
