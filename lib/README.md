# lib — shared modules for bro workshop apps

Two foundations: **`kit/`** for tools, demos, labs and ai apps, **`arcade/`**
for games. Apps import from `/lib/...` (the engine mounts this folder).

## Kit (tools, demos, labs, ai apps)

→ [`kit/README.md`](kit/README.md) · skeleton: [`templates/kit-app/`](../templates/kit-app/)

| Path | Purpose |
|------|---------|
| `kit/kit.css` | theme tokens, styled controls, standard layout (`k-app`, `k-side`, `k-viewport`, `k-statusbar`, ...) |
| `kit/app.js` | `boot()`: menu bar, status line, error display |
| `kit/dom.js` `ui.js` `params.js` | element builder, status/log/stats/tabs/toggles, controls bound to values |
| `kit/weights.js` | model weight resolution (`BRO_WEIGHTS`, sibling repos, model cache) |
| `kit/viewport3d.js` | `bro.scene` canvas + orbit camera + standard mouse controls |
| `kit/test.js` | headless test helpers (tests `import` from `/lib` directly) |

## Arcade foundation (all games)

**Start here for classic single-player canvas arcade games:**

→ [`arcade/README.md`](arcade/README.md)

| Path | Purpose |
|------|---------|
| `arcade/shell.js` | Boot a game plugin (screens, HUD, session, loop) |
| `arcade/loop.js` `view.js` `input.js` `audio.js` `save.js` | Kernel |
| `arcade/arcade.css` | Shared chrome; theme via CSS variables |
| `games/arcade-template/` | Copy-this skeleton |
| `games/snake/` | Filled reference game |

```js
import { boot } from "/lib/arcade/shell.js";
import { game } from "/app/game.js";
boot(game);
```

Older top-level modules (`loop.js`, `screens.js`, `input.js`, …) remain for
games that have not been migrated. New arcade titles should use `lib/arcade/`
only — do not treat pre-template games as architectural examples.

## Other modules

Reusable helpers beyond the arcade shell. Prefer ES `export` when adding new
files. There is no bundler; apps import what they need.

| Module | Purpose |
|--------|---------|
| `math.js` | clamp, lerp, random helpers |
| `fx.js` | screen shake, toast |
| `particles.js` | 2D particle pool |
| `camera.js` / `camera2d.js` | 3D orbit and 2D follow cameras (kit apps: use `kit/viewport3d.js`) |
| `tilemap.js` / `platformer.js` | tile grid + platformer body (future foundation) |
| `physics2d.js` | 2D physics helpers |
| `netroom.js` | lobby / turn helpers over `bro.net` |
| `project.js` / `history.js` / `sketch.js` | tool / editor plumbing |
| `system-menu.js` | windowed app menu bar (kit apps get it from `kit/app.js` `boot()`) |
| `dialogs.js` | file/folder browse |
| `openrouter.js` / `markdown.js` | AI tooling UI helpers |

Conventions for new modules:
- ES modules (`export`)
- Safe when optional engine features are missing
- No multi-line application chrome as HTML strings when a static template will do
- Unit tests go in `lib-tests/test_*.js` (or `lib/**/test_*.js`); `scripts/validate.sh lib-tests` runs them
