# broworkshop

Showcase apps and starter templates for [bro](https://github.com/wlejon/bro).

## Run

```bash
# from this repo (bin/ holds the engine build)
bin/bro.exe .
# or open a single app:
bin/bro.exe games/snake
```

## Arcade foundation (all games)

Every game under `games/` boots through the shared arcade shell:

| | |
|--|--|
| Spec + API | [`lib/arcade/README.md`](lib/arcade/README.md) |
| Skeleton | [`games/arcade-template/`](games/arcade-template/) |
| Simple reference | [`games/snake/`](games/snake/) |
| Level-clear example | [`games/breakout/`](games/breakout/) |
| 3D scene example | [`games/tumble/`](games/tumble/) |

Copy the template, implement `game.js`, theme with CSS variables.
`main.js` is always `boot(game)` only.

## Adding an app

1. Create a directory (or copy a template).
2. Add `bro.json` (`{ "app": ".", "title": "...", "width": ..., "height": ... }`).
3. Add `index.html` and your scripts/styles.
4. Optionally list it in `launcher/apps.json`.

## Layout

| Path | Contents |
|------|----------|
| `bin/` | Engine binaries + API docs |
| `lib/` | Shared libraries (see `lib/README.md`) |
| `lib/arcade/` | Arcade game kernel + shell |
| `games/` | Games |
| `demos/` | Engine / ML / graphics demos |
| `tools/` | Editors and utilities |
| `ai/` | Agent / pipeline experiments |
| `launcher/` | App grid |

## License

[MIT](LICENSE)
