# Stompworld

Side-scrolling platformer on the **arcade foundation** (`/lib/arcade`). Run, jump, stomp, reach the flag. Also hosts AI training and demo modes.

## Files

| File | Role |
|------|------|
| `bro.json` | App manifest (800×576 viewport) |
| `main.js` | Boots `/lib/arcade/shell.js` |
| `game.js` | Arcade plugin — play mode + train/demo wiring |
| `index.html` | Canvas `#view`, HUD, screen overlays |
| `theme.css` | Pixel-art theme over `arcade.css` |
| `art.js` | Code-driven pixel art (tile/sprite atlases) |
| `level.js` | World 1-1 ASCII layout + entity spawns |
| `sim.js` | Headless physics for AI (preserve feel) |
| `train.js` | AI training workers + trajectory replay |
| `demo.js` | Post-training AI demo |
| `agent.js` / `agent_obs.js` / `play_agent.js` | Agent stack |
| `trainer_worker.js` / `mcts_worker.js` | Training workers |
| `ckpt/` | Checkpoints (`best.bin`, etc.) |

## Controls (play)

- **A / D** or **← / →** — run
- **Space** (or **W** / **↑**) — jump (hold for higher arc)
- **J / K / F** or **click** — fire beam
- **Esc** / **P** — pause

## Menu

- **Play** — human play mode (starts armed)
- **Train AI** — MCTS self-play + trainer workers; **F** fast, **C** clear tape, **Esc** pause → title to stop
- **AI Demo** — loads `ckpt/best.bin` and runs the trained policy + scripted finish
- **How to Play** / **Quit**

## How the art is built

Every tile, hero frame, stomper frame, and the flag is described as an
ASCII grid + small palette in `art.js`. At first use, those recipes are
stamped via `fillRect` into offscreen `<canvas>` atlases. Same pattern as
before the arcade migration.

## Adding a level

`level.js` is a single ASCII array. Edit `ROWS`, save, reload. Solid
tiles are listed in `SOLID_IDS` (passed to `Tilemap.create`).

## AI note

Training and demo still use `sim.js` for physics so rollouts match play feel.
Checkpoints live under `ckpt/`. Demo requires `ckpt/best.bin` from a prior train.

## Smoke test (headless)

```bash
bro-headless ../broworkshop/games/stompworld -e "
  advanceTime(50);
  document.querySelector('.menu-item.selected').click();
  advanceTime(50);
  keyDown(100); advanceTime(800);   // 'd' key
  keyDown(32);  advanceTime(150); keyUp(32);  // space
  keyUp(100);
  flush();
  screenshot('out.png');
  console.log('mode:', __SW.pendingMode);
"
```

`window.__SW = { pendingMode, Art, Training }` is exposed for headless inspection.
