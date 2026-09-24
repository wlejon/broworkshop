# Arcade game foundation

Shared **kernel + shell** for bro workshop games: classic 2D canvas titles,
and 3D/scene games that still want the same menu/HUD/session chrome.

**Copy `games/arcade-template/`** to start a new game. Older one-off game
folders were early engine experiments — use this foundation instead.

## Layers

```
game instance  (rules, draw, sfx, theme)     games/<name>/
arcade shell   (screens, session, HUD, boot) lib/arcade/shell.js
arcade kernel  (loop, view, input, audio, save)
```

| Module | Role |
|--------|------|
| `loop.js` | rAF loop, clamped dt (ms) |
| `view.js` | canvas + 2D context, size, clear |
| `input.js` | rebindable actions (`bro.settings`) |
| `audio.js` | short tones / sequences |
| `save.js` | namespaced prefs + high score |
| `shell.js` | boot, screens, menu, session, frame |
| `scene3d.js` | 3D games: `bootScene`, `createStage` (scene, orbit camera, picking, taps) |
| `grid.js` | 2D board games: grids, line matches, gravity `collapse`, `createWave` / `createFalls` animations, `fitBoard` layout, `seededRandom`, `formatClock` |
| `effects.js` | `createEffects`: particle bursts, floating score labels, shake, DOM toasts |
| `pointer.js` | `bindPointer`: canvas mouse in drawing px, only while playing |
| `scores.js` | `recordScore` per-mode leaderboards + `createScoreTabs` High Scores screen |
| `options.js` | `createOptions`: Settings rows that cycle on Enter (`sfxVolume()`, `toggle()`) |
| `arcade.css` | shared chrome; theme via CSS variables |

## Quick start

1. Copy `games/arcade-template/` to `games/mygame/`.
2. Set `bro.json` title and size.
3. Edit `game.js` (`create` / `update` / `draw` / `hud`).
4. Edit `theme.css` and HTML copy.
5. Launch with `bro games/mygame`.

```js
import { boot } from "/lib/arcade/shell.js";
import { game } from "/app/game.js";
boot(game);
```

## Game plugin contract

```js
export const game = {
  id: "mygame",           // required — save namespace
  clearColor: "#0a0a0c",  // optional canvas clear
  actions: [],            // optional extra input actions
  defaults: {},           // optional save defaults (merged with highScore: 0)

  // optional, once after the title is up: pointer listeners, saved settings,
  // async loads (may switchTo a loading screen and back)
  init(api) {},

  create(ctx) { return { score: 0 }; },
  // ctx: { audio, save, input, view, play, highScore, switchTo, getScreen, getRun }

  update(run, dt, input) {
    // return { status: "gameover" } to end the run
    // return { status: "screen", name: "levelclear" } for mid-run overlays
  },

  draw(run, ctx, view) {},
  drawTitle(ctx, view) {},   // optional — under title when no run yet

  hud(run) { return { score: run.score, best: /* or omit; shell fills */ }; },
  gameOverText(run, result) {},
  // Game SFX only — menu move/select tones are shell-owned.
  cue(name, audio) {},
  // Optional override for shell menu tones:
  // cueMenu(name, audio) {},

  onEnterScreen(name, run, api) {},
  onMenuAction(action, run, api) {
    // custom data-action handlers
    // return "playing" | { switchTo, startRun, gameover }
  },
};
```

### Input during play

```js
if (input.pressed("left")) { /* once */ }
if (input.down("primary")) { /* held */ }
```

Standard actions: `up` `down` `left` `right` `primary` `secondary` `pause` `confirm`.  
Pause (Esc / P) is owned by the shell. Entering `playing` clears pending
presses, so the Enter or click that picked a menu item never reaches the game.

The shell records the high score when a run ends (`run._newBest`); do not
call `save.maybeHighScore` from the game, or "NEW BEST" never shows.

### Puzzle / board games

`games/gemswap`, `games/fluffshuffle` and `games/wordspire` are the
references: `rules.js` (pure grid functions) · `board.js` (a `Board` class,
one session, no DOM, effects out through an `fx` object in cell
coordinates) · `render.js` · a thin `game.js` that wires `createEffects`,
`bindPointer`, `createScoreTabs` and `createOptions` in `init` and puts
`board` and `layout` on `run` · `hooks.js` for the test surface.

### Screens (HTML)

| Element | Purpose |
|---------|---------|
| `#view` | primary canvas (2D game **or** 3D scene) |
| `#hud` | live stats; children `#hud-<key>` (also `#hud-high` alias) |
| `#overlay` | menu host |
| `#screen-title` `#screen-howto` `#screen-pause` `#screen-gameover` | required |
| `#gameover-stats` | optional stats text (`class="stats-block stats-table"` keeps padded columns aligned) |
| `#screen-<custom>` | intermediate screens |

| `data-action` | Effect |
|---------------|--------|
| `play` / `restart` | new run → playing |
| `resume` | back to playing |
| `howto` | how-to |
| `back` / `title` | title menu |
| `quit` | exit app |
| *(other)* | `game.onMenuAction` |

### Intermediate screens

```js
// update:
return { status: "screen", name: "levelclear" };

onMenuAction(action, run, api) {
  if (action === "nextlevel") { advance(run); return "playing"; }
},
onEnterScreen(name, run, api) {
  if (name === "levelclear") { /* fill stats DOM */ }
},
```

## 3D / scene games

The shell always needs a **2D** view for its clear/loop, so a scene game
boots it on a hidden canvas and keeps `#view` for `getContext("scene")`.
`scene3d.js` does both halves; **`games/tumble`** is the reference:

```js
// main.js
import { bootScene } from "/lib/arcade/scene3d.js";
import { game } from "/app/game.js";
bootScene(game, { width: 1280, height: 800 });

// game.js — build the stage inside create(), never at module load
stage = stage || createStage({
    orbit: { target: [0, 3, 0], dist: 12, fov: 50 },
    controls: { minDist: 4, maxDist: 60 },        // kit orbitControls options
});
stage.onTap((p) => place(stage.planeHit(stage.rayAt(p.clientX, p.clientY), 0)));
stage.onTap((p) => remove(stage.pick(p.clientX, p.clientY)), { button: 2 });
draw() { stage.applyCamera(); }
```

The stage gives right-drag orbit / middle-drag pan / wheel zoom (kit
`orbitControls`), `reframe(pivot, dist)`, `rayAt` (screen → world ray),
`planeHit(ray, y)`, `pick` (scene raycast) and `onTap`, a press + release
that did not drag, so right-click actions do not fire at the end of an
orbit. Rebuild a level with `scene.clear()` + `Physics.createWorld()`
rather than tracking every node and body. Older scene games
(blastgrid, hexfront, ...) still paste the hidden-canvas
block and their own camera; move them over when touched.

### Large 3D titles — `sim.js` + plugin

When rules grow past a few hundred lines, split the file:

```
sim.js    createGame(scene, seed) + constants  (pure domain)
game.js   thin plugin: ensureScene, syncRender, HUD, cue, tests
```

Examples: `tumble` (board / marbles / aids / ui split), `deepdelve`,
`blastgrid`, `tilehaven`, `hearthfolk`.  
Do not call `getContext("scene")` or touch the DOM from `sim.js`.

## Theme tokens

```css
:root {
  --arcade-bg: #06100a;
  --arcade-accent: #7bd88f;
  --arcade-text: #e0ffe8;
  --arcade-muted: #4a7a5a;
  --arcade-faint: #3a5a44;
  --arcade-overlay: rgba(6, 16, 10, 0.9);
  --arcade-hud-border: #1e3a25;
  --arcade-menu-hover: rgba(123, 216, 143, 0.08);
  --arcade-menu-selected: rgba(123, 216, 143, 0.18);
}
```

## Games on this foundation

Every folder under `games/` now boots via `main.js` + `boot(game)` except
none — full workshop coverage.

| Cluster | Games |
|---------|--------|
| Template | `arcade-template` |
| Classic 2D | snake, breakout, invaders, asteroids, hopper, missile-command, echo, chomper, blockfall, 2048 |
| Arcade+ modes | pegbounce, blockpop, serpcoil, gemswap, wordspire, fluffshuffle, fintank, starfighter, touchdown, stompworld |
| 3D / scene | tumble, deepdelve, blastgrid, hexfront, gridkeep, tilehaven, hearthfolk, farm |
| Netplay client | crater (`shared.js` + server), fps (`protocol.js` + server) |

## HTML conventions (polished chrome)

```html
<div id="hud" hidden>
  <div class="hud-stat">
    <div class="hud-label">Score</div>
    <div id="hud-score" class="hud-value">0</div>
  </div>
</div>
```

Menu labels use title case (`Play`, `How to Play`, `Title Menu`).  
Hints: `Up / Down navigate · Enter select`.  
How-to controls live in a `<pre>` inside `.htp-body`.

## Gameplay code style (second-pass standard)

Reference implementations: `games/snake/game.js`, `games/breakout/game.js`.

```
// Top: plugin purpose + what shell owns
// Constants
export const game = { create, update, draw, hud, gameOverText, cue, … }  // thin
// ── Rules ──
// ── Draw ──
// helpers…
```

| Do | Don't |
|----|--------|
| Put session state on `run` | Module-level mutable game state |
| Section headers for helpers | One 600-line soup with no map |
| `cue` for game events only | `menu` / `select` in `cue` (shell) |
| `gameOverText` with ` ·  NEW BEST` | Ad-hoc high-score strings |
| Pointer listeners keyed on `canvas` | Global `mouseWired` flags |
| Names like `stepBall` / `drawFood` | Opaque one-letter control flow |

## Design rules

1. **Template first** — shell changes help every game, not one title.
2. **HTML structure, CSS theme, JS rules** — no multi-line chrome HTML in JS.
3. **One boot path** — `main.js` only calls `boot(game)`.
4. **Readable over clever** — score and death should be obvious in `game.js`.
5. **Lazy scene init** — 3D setup belongs in `create()`, not import time.
6. **Theme = variables only** — avoid restyling shell layout in `theme.css`.
