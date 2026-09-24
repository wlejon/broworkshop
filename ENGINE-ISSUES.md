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

## Notes (not bugs)

- `<select>.value` round-trips correctly now (set programmatically, and
  after a keyboard pick + `change`); older app comments claiming otherwise
  are stale.
- `performance.now()` in headless advances only with virtual time
  (`advanceTime`), so fps/ms readouts measured with it read as 62.5 fps /
  0 ms there. Use `Date.now()` for wall-clock budgets.
