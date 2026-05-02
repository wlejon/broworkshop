# broworkshop

Starter apps for [bro](../bro). Categorized: complete games you can clone and reshape, tools for specific workflows, demos that exercise one subsystem each, and AI/research apps.

This is bro's "everything but an editor." bro itself is a runtime — HTML/CSS/JS over a custom pipeline with native scene/physics/audio/networking. The workshop is where patterns get worked out before they earn their way into bro's C++ core. If two or three apps converge on the same shape, that shape becomes a candidate for promotion to a binding in bro.

## Layout

```
launcher/         the meta-app — grid of installed apps, click to spawn
lib/              shared JS modules used by multiple apps
lib-tests/        tests for lib/

games/            complete genre-focused starting points
                    arcade: snake, breakout, asteroids, invaders, missile-command,
                            chomper, hopper, pegbounce, gemswap, blockfall, blockpop,
                            tumble, serpcoil, fluffshuffle, 2048, echo
                    puzzle/word: wordspire
                    sports: touchdown
                    sim:    fintank
                    3D:     starfighter, fps, crater, stompworld

tools/            workflow-specific tools
                    artstation       — code-driven pixel art
                    mesh-viewer      — load + inspect meshes
                    scene-editor     — 3D scene assembly with gizmos
                    synth            — sound design playground

demos/            subsystem showcases
                    example          — minimal "Hello, bro"
                    flora            — procedural plant viewer
                    lighting-demo    — PBR + IBL + tonemap
                    spatial-audio    — broaudio spatial nodes
                    terrain          — voxel terrain + streaming
                    video_demo       — VideoEncoder / GifEncoder

ai/               research / training apps
                    ai-arena         — brogameagent demo with replay + commander/MCTS
```

## Running

You'll need a built bro binary in the sibling [bro](../bro) repo.

```bash
# launcher (grid of all apps)
../bro/build/Debug/bro.exe launcher          # Windows
../bro/build/bro launcher                    # Linux / macOS

# any single app
../bro/build/Debug/bro.exe games/snake
../bro/build/bro tools/scene-editor
```

## What goes where

- **`games/`** — finished, playable, single-genre. The point is to be a clean starting point for "I want to make a $genre game" — clone the directory, rename, edit. Not toy demos.
- **`tools/`** — built around one workflow each. Asks "what's the smallest app that lets me $workflow?" rather than bundling everything into a monolithic editor.
- **`demos/`** — exercise a single subsystem. Short, readable, optimized for "I want to see how $thing works."
- **`ai/`** — research apps with their own workflows around training, replays, evals.

## Adding an app

1. Create a directory under the right category.
2. Add `bro.json` (`{ "app": ".", "title": "...", "width": ..., "height": ... }`).
3. Add `index.html`. Optionally `style.css`, `app.js`, etc.
4. Add an entry in `launcher/apps.json` (the dir field is the path from the workshop root, e.g. `"games/foo"`).
5. Optional: drop a thumbnail into `launcher/thumbnails/<basename>.png` (or paste a screenshot at runtime — Ctrl+V in the launcher targets the most-recently-launched app).

## Promotion to bro

If a pattern in `lib/` or repeated across apps stabilizes — the API stops shifting, two or three apps want it — that's the signal to promote it into a C++ binding in `../bro/src/js/`. Native gizmos, the crosshair overlay, and the menu bar all came through this path.

## License

MIT (matches bro).
