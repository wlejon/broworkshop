# Arcade template

Copy this folder to start a bro arcade game.

```bash
# from broworkshop root
cp -r games/arcade-template games/mygame
# then: bro.json title/size, game.id in game.js, rules.js + render.js, index.html copy, theme.css
bro games/mygame
```

## Files

| File | Role |
|------|------|
| `rules.js` | The game: state from `createX()`, pure functions that change it, events out on `state.events`. No DOM, audio or drawing. |
| `render.js` | Draws a state onto the 2D canvas. Never changes it. |
| `game.js` | The plugin: input → rules, rules events → sound and screens, HUD values, game-over text. Thin. |
| `main.js` | `boot(game)` plus `exposeHooks(game.id, …)` for the tests. Leave as is. |
| `index.html` | Title copy, HUD slots, extra screens. |
| `theme.css` | Colours through the `--arcade-*` variables only. |
| `bro.json` | Window title and size. |
| `tests/test_main.js` | Rules tests plus a shell-flow test (title → play → game over). |

Split further when a file passes a few hundred lines: `snake` and
`breakout` are the small references, `gemswap` / `pegbounce` the larger
ones (a session class, `screens.js`, `hooks.js`).

## Plugin checklist

1. Set a unique `id` (save namespace, and `window.__<id>` for tests) and `clearColor`.
2. `create(api)` → a run object: `score`, the rules state, and `api.play` / `api.highScore` if the plugin needs them.
3. `update(run, dt, input)`: `input.pressed(name)` / `input.down(name)` → rules; drain `state.events` → `run.play(cue)`.
4. Return `{ status: "gameover" }` to end the run, `{ status: "screen", name }` for a mid-run screen (`#screen-<name>` + `onMenuAction`).
5. `draw(run, ctx, view)` calls render.js with `view.size()`.
6. `hud(run)` returns `{ key: value }` for `#hud-<key>`; the shell fills `#hud-best`.
7. `gameOverText(run)` with `statsBlock` + `newBest` from `/lib/arcade/scores.js`. The shell records the high score; never call `save.maybeHighScore` yourself.
8. `cue(name, audio)`: game sounds only; menu tones are the shell's.
9. Anything a run schedules (sequences, AI turns, delays) goes on `createTimers()` from `/lib/arcade/timers.js`, not `setTimeout`, so pause freezes it.

Shared pieces: `/lib/arcade/grid.js` (boards, `fitBoard`), `random.js`
(`seededRandom`), `timers.js` (`createTimers`, `formatClock`),
`effects.js` (particles, labels, shake, toasts), `pointer.js` (canvas
mouse), `scores.js` (leaderboards, `statsBlock`), `options.js` (Settings
rows), `hooks.js` (test hooks).

Full contract: [`/lib/arcade/README.md`](../../lib/arcade/README.md).
