# lib — shared modules for bro workshop apps

## Arcade foundation (preferred for new 2D games)

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
| `camera.js` / `camera2d.js` | 3D orbit and 2D follow cameras |
| `tilemap.js` / `platformer.js` | tile grid + platformer body (future foundation) |
| `physics2d.js` | 2D physics helpers |
| `netroom.js` | lobby / turn helpers over `bro.net` |
| `project.js` / `history.js` / `sketch.js` | tool / editor plumbing |
| `system-menu.js` | windowed app menu bar |
| `dialogs.js` | file/folder browse |
| `openrouter.js` / `markdown.js` | AI tooling UI helpers |

Conventions for new modules:
- ES modules (`export`)
- Safe when optional engine features are missing
- No multi-line application chrome as HTML strings when a static template will do
