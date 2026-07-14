# Arcade template

Copy this folder to start a new bro arcade game.

```bash
# from broworkshop root
cp -r games/arcade-template games/mygame
# then edit games/mygame/{bro.json,game.js,index.html,theme.css}
```

## Files

| File | You edit? | Role |
|------|-----------|------|
| `main.js` | No | Always `boot(game)` only |
| `game.js` | **Yes** | Rules, draw, cues, HUD values |
| `index.html` | Yes | Title copy, HUD slots, extra screens |
| `theme.css` | Yes | Colors via CSS variables |
| `bro.json` | Yes | Window title and size |

## Plugin checklist

1. Set unique `id` (save namespace) and `clearColor`.
2. `create(ctx)` → run state. Keep `play` / `highScore` from `ctx` if useful.
3. `update(run, dt, input)` — poll `input.down` / `input.pressed`.
4. Return `{ status: "gameover" }` when the run ends.
5. Optional: `{ status: "screen", name: "levelclear" }` + `#screen-levelclear` + `onMenuAction`.
6. `draw(run, ctx, view)` — `view.size()` for width/height.
7. `hud(run)` — keys match `#hud-<key>` elements.
8. `cue(name, audio)` — **game** sounds only. Menu tones are shell-owned.

Full contract: [`/lib/arcade/README.md`](../../lib/arcade/README.md).

## Run

```bash
bro games/arcade-template
# after rename:
bro games/mygame
```
