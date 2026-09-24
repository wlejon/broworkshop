# CLAUDE.md

Guidance for agents working in broworkshop: the showcase apps for the
[bro](../bro) runtime (HTML/CSS apps on a GPU-accelerated engine; read
`../bro/CLAUDE.md` for the engine). bro and its sibling repos (`../bronze`,
`../brolm`, ...) are separate repos; do not edit them from here.

## Layout

| Path | Contents |
|------|----------|
| `games/` | games, all on the arcade shell (`lib/arcade/`) |
| `demos/` | engine / graphics / ML demos and labs |
| `tools/` | editors and utilities |
| `ai/` | agent and pipeline experiments |
| `templates/` | copy-to-start skeletons: `kit-app/` (tools/demos/labs), `worker-sim/` |
| `lib/kit/` | shared toolkit for everything that is not a game |
| `lib/arcade/` | game kernel + shell |
| `lib/*.js` | older shared modules (camera, system menu, history, sketch, ...) |
| `lib-tests/` | harness app for `lib/` unit tests |
| `launcher/` | the app grid (`launcher/apps.json` lists apps) |
| `scripts/validate.sh` | boot-smoke + test runner |
| `tests/` | `baseline.txt`, `app-tags.txt`; runner output lands in `tests/out/` (ignored) |
| `bin/` | stale engine copy, gitignored; do not use |

An app is a folder with `index.html` and `bro.json`
(`{ "title", "width", "height", "lib": "../../lib" }`; the engine reads only
the keys in bro's `config_loader.cpp`, unknown keys are ignored). The engine
mounts `/app` (the app folder) and `/lib` (this repo's `lib/`); scripts load
as `<script type="module" src="/app/main.js">` and import `"/lib/kit/..."`.

## Building apps

- **Tools, demos, labs, ai apps:** build on `lib/kit/`. Read
  [`lib/kit/README.md`](lib/kit/README.md) and copy `templates/kit-app/`.
  Ported references: `demos/kws-lab`, `demos/lm-playground`,
  `demos/spatial-hash`, `demos/lighting-demo`, `tools/shader-lab`.
- **Games:** `lib/arcade/` ([README](lib/arcade/README.md)); copy
  `games/arcade-template/`, implement `game.js`, `main.js` is `boot(game)`.
- **Model weights:** `findWeights` / `requireWeights` from
  `lib/kit/weights.js` with repo-relative candidates
  (`'brolm/weights/Qwen3.5-0.8B'`). Never write `D:/projects`; `BRO_WEIGHTS`
  names the directory holding the sibling repos.
- **3D:** `sceneViewport` / `orbitControls` from `lib/kit/viewport3d.js`
  instead of re-pasting the orbit mouse block.

## Running and validating

Engine: `../bro/build/Release/bro-headless.exe` (Windows) or
`../bro/build-release/bro-headless`; override with `BRO_HEADLESS`. Windowed:
`../bro/build/Release/bro.exe demos/kws-lab`.

```bash
scripts/validate.sh                      # smoke every app + run every test (no ML)
scripts/validate.sh demos/kws-lab        # one app (globs work: 'demos/*-lab')
scripts/validate.sh --ml demos/kws-lab   # include ML targets (weights + GPU)
scripts/validate.sh --smoke --shots      # boot only, save tests/out/shots/*.png
scripts/validate.sh --list               # what would run, with tags
```

- **Smoke** boots the app headless, advances 60 frames, fails on a non-zero
  exit (uncaught error, unhandled rejection, failed module load, empty body).
- **Tests** are `<app>/tests/test_*.js` and `<app>/test*.js`, run as
  `bro-headless <app> <script>` with CWD = repo root. Test scripts are ES
  modules: import helpers from `/lib/kit/test.js`.
- `tests/app-tags.txt` tags targets `ml` (skipped without `--ml`), `net`,
  `skip`, `timeout=N`. Tag new ML apps there.
- Results are compared to `tests/baseline.txt`: rows are marked `REGRESSED`
  (passed in the baseline) or `FIXED`. A failure that is already failing in
  the baseline is pre-existing. Exit status is 1 whenever anything fails;
  with `--regressions`, only when something regressed.
- After changing an app, run its targets before and after and keep the
  baseline honest: regenerate it with `--write-baseline tests/baseline.txt`
  only on a full run (`scripts/validate.sh --ml --write-baseline tests/baseline.txt`).
- Headless specifics (virtual time, `advanceTime`, input injection,
  screenshots): `../bro/docs/headless.md`. Verify UI changes visually with
  screenshots; htmlayout is not Chromium.

## Conventions

- **File size:** keep files under ~1k lines; when one grows past that,
  decompose it into sensible modules. Exceptions are allowed, but nothing over
  2k lines.
- **ES modules, no bundler.** Apps import what they need from `/lib`.
- **Apps showcase the engine.** When something does not work in bro, do not
  hack around it in app code: note it in [`ENGINE-ISSUES.md`](ENGINE-ISSUES.md)
  for the engine owner and pick the straightforward design.
- **Shared code:** a helper moves into `lib/kit/` (or `lib/arcade/`) when
  several apps need it; otherwise it stays in the app. Keep the kit small.
- **No Python.** Tooling is bash or JS run by bro-headless.
- **Write files with the file-editing tools**, never through shell
  redirection (`>`, `tee`, heredocs, `sed -i`).
- Leave `tools/mesh-viewer/.storage.json` and `tools/media-inspector/samples/`
  alone (local state).
