# lib — shared code for the workshop apps

The engine mounts this folder at `/lib`; apps import what they need
(`import { boot } from "/lib/kit/app.js"`). ES modules, no bundler.

| Folder / file | For | Read |
|---------------|-----|------|
| [`kit/`](kit/README.md) | tools, demos, labs, ai apps: theme + layout, DOM and widget helpers, weights lookup, 3D viewport, audio, ML, agent, editor plumbing, headless test helpers | [kit/README.md](kit/README.md), skeleton `templates/kit-app/` |
| [`arcade/`](arcade/README.md) | games: loop, view, input, audio, save, the screen/HUD shell, 3D stage, boards, effects, scores | [arcade/README.md](arcade/README.md), skeleton `games/arcade-template/` |

The arcade builds on the kit where they overlap (`arcade/scene3d.js` uses the
kit's orbit camera and pick rays); the kit never imports the arcade.

## Domain libraries (top level)

Self-contained modules that are not part of either foundation, each with
its usage in the file's header comment.

| Module | What | Used by |
|--------|------|---------|
| `markdown.js` | streaming-safe Markdown → escaped HTML (LLM output) | kit/chat-view, tools/desktop-notebook |
| `linediff.js` | LCS line diff as `ctx` / `del` / `add` ops | kit/chat-view |
| `openrouter.js` | OpenRouter model catalog, picker, `chatCompletion` with retries | kit/agent-llm, kit/agent-backend, ai/maker-agent |
| `tot-reasoning.js` | Tree-of-Thought search over `bro.ai.game.createGenericMcts` | lib-tests only (a library for LLM apps) |
| `netroom.js` | lobby + tagged-JSON messages over `bro.net` | arcade/netplay, games/crater |
| `bot-aim.js` | turret aim with reaction lag, turn rate and a fire cone | games/fps, demos/ai-arena |
| `crosshair.js` | screen-centre reticle overlay (bloom, ADS) | games/fps, demos/terrain |
| `system-menu.js` | `bro.menu` bar: File, View, Debug (inspector, perf HUD) | kit/app.js `boot()`, the hands-off speech/image labs |
| `sweep-runner.js` | content-addressed parameter sweeps rendered to disk | demos/krea2-lab |
| `city/` | a city grown from a site: street field and tensor streamlines (`field.js`, `streets.js`), planar road graph with blocks, roads that end at the water pruned (`graph.js`), frontage and corner lots, and lots backing onto the water (`lots.js`), buildings composed of masses by zone (`buildings.js`: podiums and shafts, setbacks, wings, attics, roofs, plant, crowns, a skyline peaking at the district cores), all in `generate.js`; GPU-side: `building.bk` + `building_render.js` (every mass one instanced record), drawn by `facade.bk` (a mass's surface at any point of its own frame: facade, rooms, night windows, roof), `ground.js` (road segments and block surfaces for a terrain kernel and ground shader); breakable: `structure.js` (a building's structural members, sized by its style's system: bays, slabs, walls, columns, and their joints), `destruction.js` + `destruction.bk` (lib/destruct over the city's masses: a building wakes into members when something reaches it, each member drawn with its facade, rooms and breaks) | demos/metropolis |
| `destruct/` | structures that stand by their loads and break by force: `solver.js` + `solver.bk` (boxes on the GPU through `bro.kernel`: structures of members and joints added as they are needed, shots fired into them, stepped at 60 Hz), `builder.js` + `build_worker.js` (structures built for a solver off its thread), `dust.js` + `dust.bk` (the dust raised, a lit scene volume of puffs), `grit.js` + `grit.bk` (the crumbs and shards loose pieces shed as they fall: a GPU kernel's ballistic bits, drawn as small lit boxes) | lib/city/destruction.js |

`system-menu.js` and `sweep-runner.js` would belong in the kit, but the
hands-off labs import them by these paths; they move when those labs do.

## Tests

`lib-tests/` is a harness app for unit tests of `lib/` code: `test_*.js`
there import what they test from `/lib` (`history`, `project`,
`tot-reasoning`) or exercise engine bindings the kit leans on (`Physics`,
sprites and particles, polygon triangulation). `scripts/validate.sh
lib-tests` runs them. Tests for app-owned code live in the app's `tests/`.

## Conventions

- ES modules with named exports; no globals.
- Degrade cleanly when an optional engine feature is compiled out.
- Static markup stays in the app's HTML; modules build only repeated or
  data-driven UI.
- A helper moves here when several apps need it; one caller keeps it in the
  app. Keep files under ~1k lines.
