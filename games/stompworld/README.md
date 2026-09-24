# Stompworld

Side-scrolling platformer on the arcade foundation (`/lib/arcade`). Run,
jump, stomp, blast terrain with the beam, reach the flag. The same level
doubles as an AI playground: **Train AI** runs MCTS self-play and a trainer
in workers, **AI Demo** plays the trained policy.

## Files

| File | Role |
|------|------|
| `main.js` | `boot(game, { width: 800, height: 576 })` |
| `game.js` | Arcade plugin: modes, input, letterboxed draw, HUD, sounds |
| `rules.js` | Shared rules: hero tuning, enemy motion, stomps, beam hits |
| `play.js` | Human play: lives, clock, aimed beam, death / flag animations |
| `sim.js` | Headless, snapshot-able env for the AI (6 movement actions, auto-fire) |
| `render.js` | Drawing shared by play, training replay and demo |
| `level.js` | Stage 1 layout + entity spawns |
| `art.js` | Code-drawn pixel art (ASCII recipes stamped into canvases) |
| `ai/obs.js` | Observation vector (`bro.ai.game.grid` obs window) |
| `ai/policy.js` | The policy/value net, checkpoint paths |
| `ai/heuristic.js` | Scripted controllers + behaviour-cloning warmup |
| `ai/play_agent.js` | Net + MCTS agent used by the self-play workers |
| `ai/mcts_worker.js` / `ai/trainer_worker.js` | Module workers |
| `ai/train.js` / `ai/demo.js` | The Train AI and AI Demo modes |
| `ai/inspect.js` | Dev script: what a checkpoint thinks, greedy + sampled rollouts |
| `ckpt/` | Checkpoints (`best.bin`, `best.json`, `last_N.bin`; gitignored) |

`play.js` and `sim.js` step the hero and enemies with the same `rules.js`
functions, so the agent trains on the game a human plays.

## Controls (play)

- **A / D** or **← / →**: run
- **Space**, **W** or **↑**: jump (hold for a higher arc)
- **J / K / F** or **click**: fire the beam at the mouse (straight ahead
  before the mouse has moved)
- **Esc** / **P**: pause

Three lives; falling, touching an enemy from the side or running out of
time costs one (and restarts the clock).

## Training

- **Train AI**: a trainer worker plus five MCTS workers at different
  search depths. The trainer resumes from `ckpt/best.bin`, or else
  behaviour-clones `ai/heuristic.js` and pretrains. The screen replays the
  best recent trajectory with the others as ghosts. **F** fast replay,
  **C** clear the shared failure tape, **Esc** then Title Menu stops it.
- **AI Demo**: greedy policy from spawn to the beam pickup, then a scripted
  walk back and on to the flag. Needs `ckpt/best.bin`.
- Changing `ai/obs.js` or the net shape in `ai/policy.js` invalidates saved
  checkpoints.

```bash
bro-headless games/stompworld games/stompworld/ai/inspect.js   # from the broworkshop root
```

## Tests

`scripts/validate.sh games/stompworld` runs:

- `tests/test_play.js`: menus, running and both jump keys, beam fire (keyboard
  and mouse-aimed), stomps, pause, pit / clock deaths, game over, the flag.
- `tests/test_sim.js`: pits are jumpable, snapshots restore exactly, pickup
  + auto-fire, the heuristic finishes, BC warmup fills a replay buffer,
  observation layout.
- `tests/test_ai.js`: AI Demo with and without a checkpoint and Train AI
  end to end (workers, trajectories, replay, F, stop), using a scratch
  checkpoint folder under `tests/out/` rather than `ckpt/`.

`window.__SW` exposes `mode`, `world` (play state), `train` / `demo`
counters and `setCheckpointDir(dir)` for tests.
