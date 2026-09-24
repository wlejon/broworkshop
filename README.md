# broworkshop

Showcase apps and starter templates for [bro](https://github.com/wlejon/bro).

## Run

```bash
# with a bro checkout beside this repo (../bro), built per its BUILDING.md
../bro/build/Release/bro.exe .               # the launcher
../bro/build/Release/bro.exe games/snake     # one app
```

## Validate

```bash
scripts/validate.sh                  # boot-smoke every app + run every test (no ML)
scripts/validate.sh --ml demos/kws-lab
scripts/validate.sh --help
```

Results are compared with [`tests/baseline.txt`](tests/baseline.txt), so a
regression stands out from a pre-existing failure. See [CLAUDE.md](CLAUDE.md).

## Foundations

| For | Use | Start from |
|-----|-----|------------|
| tools, demos, labs, ai apps | [`lib/kit/`](lib/kit/README.md) | [`templates/kit-app/`](templates/kit-app/) |
| games | [`lib/arcade/`](lib/arcade/README.md) | [`games/arcade-template/`](games/arcade-template/) |

Kit references: `demos/kws-lab`, `demos/lm-playground`, `demos/spatial-hash`,
`demos/lighting-demo`, `tools/shader-lab`. Arcade references: `games/snake`,
`games/breakout`, `games/tumble` (3D).

## Adding an app

1. Copy a template.
2. Set `bro.json` (`{ "title": "...", "width": ..., "height": ..., "lib": "../../lib" }`).
3. Write `index.html` and your modules; put headless tests in `tests/test_*.js`.
4. List it in `launcher/apps.json`; tag it `ml` in `tests/app-tags.txt` if it needs model weights.

## Layout

| Path | Contents |
|------|----------|
| `lib/` | Shared libraries (see `lib/README.md`) |
| `games/` | Games |
| `demos/` | Engine / ML / graphics demos |
| `tools/` | Editors and utilities |
| `ai/` | Agent / pipeline experiments |
| `templates/` | App skeletons |
| `launcher/` | App grid |
| `scripts/` | `validate.sh` |
| `tests/` | Validation baseline and tags |

## License

[MIT](LICENSE)
