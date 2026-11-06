# Creature Lab

A lab for iterating on creature motion. A creature is a folder of code: a body
sculpted in code, a skeleton, and a rig written for that species in brokernel.
The lab drives the rig with scripted intent and measures what it does. It
renders sheets and JSON metrics headless from the command line, and plays runs
back in a window.

## The creature contract

`lab/contract.js` defines the records. The same names are the brokernel
module `creature::contract`.

- **Intent in** (`INTENT` floats a creature): wanted velocity, a heading or a
  face-the-way-it-moves flag, a gaze point and its weight, an action (`move`,
  `graze`, `startle`, `lie`, `alert`) with its amount, and the individual's
  seed.
- **Ground**: the `env` record. A rig asks `creature::ground`'s `height` and
  `normal` for the ground under it (`lab/ground.bk`): planes, slopes, and
  rough ground from a hash that agrees between GPU and CPU.
- **State**: the species' own floats per creature. The first five are the
  contract's: position, yaw, and whether it has been placed.
- **Pose out**: bones x 3 `vec4` per creature, written to the pose buffer.
- **Telemetry out** (`TELE` floats): position, yaw, speed, gait, phase,
  action, body height, pitch, roll, stride frequency, and per foot whether it
  is planted and where.

One rig dispatch (`@kernel @grid(1) k_rig`) steps every creature of a batch
once. Skinning is an instanced mesh's brokernel vertex hook (`lab/skin.bk`)
reading the pose buffer through `setShaderBuffer`; it blends a vertex's bones
as dual quaternions, so a bent joint keeps its girth. The lab draws the same
way everywhere: sheets, live view and tests.

A creature folder (`creatures/<name>/`) has these files, and
`creatures/<name>.js` re-exports its `creature.js`:

| File | What |
|------|------|
| `creature.js` | `name`, `skeleton`, `body`, `rig: { file, kernel }`, `scale`, `cycles` (which scenario is each steady gait, with reference duty factors and footfall offsets), `form` (the body's reference measures, and which parts stay inside which), `variants` (named knob sets; the deer's broken ones are `slip`, `sink`, `overbend`, `stumble`), `scenarios` |
| `skeleton.js` | bones (parent, head, tail, per-axis joint limits in degrees), feet, tracked points, chart joints |
| `body.js` | the soft-skinned body, sculpted with `lab/sculpt.js` (the deer splits it into `body.js`, `legs.js` and `coat.js`) |
| `rig.bk` | the species' rig. `@knob` constants can be overridden from the command line |
| `scenarios.js` | the species' own scenarios, added to the lab's |

Rigs are written per species. Shared code is small helpers only:
`lab/common.bk` and `creature::ground`.

The reference creature is `deer`: a deer-sized quadruped with spine, neck,
head, ears and tail. Its gaits are walk, trot and gallop, and its actions are
idle, graze, startle and lie down.

## Commands

Run the commands from the broworkshop root:

```bash
B=../bro/build/Release/bro-headless.exe
$B tools/creature-lab tools/creature-lab/cli.js -- sheets deer walk trot
$B tools/creature-lab tools/creature-lab/cli.js -- turnaround deer gallop --rows 12
$B tools/creature-lab tools/creature-lab/cli.js -- turnaround deer trot --rows 4 --cell 2.5 --views right,front-right
$B tools/creature-lab tools/creature-lab/cli.js -- form deer walk trot
$B tools/creature-lab tools/creature-lab/cli.js -- trajectory deer walk
$B tools/creature-lab tools/creature-lab/cli.js -- range deer trot
$B tools/creature-lab tools/creature-lab/cli.js -- charts deer gaits
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer all
$B tools/creature-lab tools/creature-lab/cli.js -- snapshot deer before
$B tools/creature-lab tools/creature-lab/cli.js -- ab deer@before deer walk --diff
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer trot --knob HEAD_HOLD=0.5
$B tools/creature-lab tools/creature-lab/cli.js -- scenarios deer
```

**Naming creatures and scenarios**

- A creature can be a folder (`deer`), a snapshot (`deer@before`), or a
  variant (`deer:stumble`).
- Scenarios are names, or `all`. With none named, the commands run walk,
  trot, gallop, idle, graze, startle and lie-down.

**Options**

- `--out <dir>`: the output root.
- `--rows <n>`: turnaround rows.
- `--seed <n>`
- `--knob NAME=v[,NAME=v]`: override rig `@knob` values. The knobs are added
  to the creature's label, so their outputs land in their own folder.
- `--cell <scale>`, `--views right,front,...`, `--phases 0.4,0.45`:
  turnaround cells that much bigger, only those columns, only those phases of
  the cycle, for a close look at joints.

**Where outputs go**

- Outputs go to `tests/out/creature-lab/<creature>/<scenario>-<kind>.png` and
  `<scenario>-metrics.json`.
- A/B outputs go to `<A>-vs-<B>/`.
- `--diff` adds per-run sheets under `a/` and `b/`, and look.js pixel
  comparisons under `diff/`.
- Snapshots (`creatures/<name>@<label>/`) are local copies for A/B and are
  never committed.

Every output is deterministic. A rerun writes the same bytes.

## Outputs

- **Turnaround**: 8 views at 45 degrees by 8 to 12 phases.
  - Steady gaits are cut to one measured cycle; other scenarios are spread
    across the run.
  - The light is flat and neutral, with a checker ground, a 1 m scale bar,
    and height lines at 0.5, 1.0 and 1.5 m.
  - Hooves are dotted: filled when planted, hollow in swing, red-ringed when
    under the ground.
  - A/B alternates the rows, with B shaded.
- **Trajectory**: feet, then withers, hips, head and tail tip, each from the
  side, the front and the top.
  - Each panel has an equal-aspect scale with a cm scale bar.
  - Ticks mark every 0.1 of the phase.
  - The feet panels show the ground.
  - A/B draws A solid and B dashed.
- **Range**: each joint at its minimum, rest and maximum.
  - The bone that moves is traced in red, and small joints are zoomed.
  - A dial shows the limit band, the rest angle, the range each side used in
    the run, and any overflow in red.
- **Charts**:
  - a Hildebrand footfall diagram: measured contact bars, the rig's own
    planted claim, and the reference box
  - joint angles over the phase, with limit bands
  - hip, withers and head height, pitch, roll and speed
  - steady scenarios are plotted over the phase; other scenarios over time
- **Metrics JSON** (`lab/analyze.js`):
  - foot slip while planted
  - ground penetration of soles and joints
  - joint-limit hits, per axis
  - the centre of mass against the support polygon
  - head stability: head bob against withers bob, and head turn
  - duty factor and phase offsets per leg, checked against the creature's
    reference for steady gaits
  - `flags`: one line per finding

  Contact is measured from the geometry: the sole within 1.2 cm of the
  ground. It is not taken from the rig's claim.
- **Form JSON** (`lab/form.js`, the `form` command, `form.json`): the body
  measured, its skin placed on the CPU exactly as `lab/skin.bk` places it.
  - at rest: each named ring's girth, width, depth, top and bottom, and each
    named part's extent and volume, checked against `form.reference`
  - through a cycle of each scenario (walk and trot by default): each named
    ring's area and girth and each closed part's volume as a share of rest;
    folds (the skin along each part bunching, folding through itself or
    stretching between rings); and how far the parts named in `form.inside`
    (a leg's top above a height) show outside the part that should cover
    them
  - `flags`: one line per finding

  Parts and rings are named in the body: a loft's `name`, a key ring's
  `name`.

## Scenarios

The lab's scenarios (`lab/scenarios.js`) are scripted intent tracks:

- stand, walk, trot, gallop
- start-stop and gaits (walk to trot to gallop and back)
- tight-turn, trot-turn, turn-in-place
- slope-up, slope-down, slope-across (15 degrees)
- rough-walk, rough-trot
- idle, graze, startle, lie-down

A scenario has these parts:

- `about`
- `duration`
- `ground`: slope, uphill direction, rough amplitude, wavelength and seed
- `start`
- `track`: keys of speed, heading, turn, face, action, param and gaze, each
  holding from its time on

A creature's `scenarios.js` adds its own, such as the deer's
`browse-and-flee`.

## Live view

`bro tools/creature-lab` (windowed) records the chosen scenario and plays it
back.

- Pick the creature and the scenario.
- Play, scrub, change the speed, and follow the creature or orbit the camera.
- Show A, B, or both side by side. B is a variant or a snapshot.
- See the run's metric flags.
- Open any sheet of the shown run (both, when A and B show), drawn there and
  then from the code as it is, in about a second. A sheet is composited in
  memory (`lab/page.js`: the scene through `captureFrame` under a 2D
  overlay), the same way in a window and headless, so the page around it
  stays as it was.

Headless runs drive the view through `globalThis.creatureLab`.

## Tests

`scripts/validate.sh tools/creature-lab` runs the smoke test and three tests:

- `tests/test_oracle.js`:
  - the deer's walk and trot are clean
  - each broken variant (slip, sink, overbend, stumble) is reported for the
    fault it has
  - reruns are bit-identical
  - GPU and CPU ground heights agree
- `tests/test_sheets.js`:
  - every sheet kind renders and has ink
  - a sheet rendered twice is the same bytes
  - `ab --diff` writes its files
  - the time from a fresh load to sheets stays within seconds
- `tests/test_live.js`: the live view loads, scrubs, shows A/B, draws every
  sheet kind on demand and still draws after. It writes screenshots to
  `tests/out/shots/`.

## Adding a creature

1. Copy `creatures/deer/` to `creatures/<name>/` and add
   `creatures/<name>.js`.
2. Write its skeleton with limits, then its body, then its rig against
   `creature::contract`.
3. Name its steady gaits in `cycles` (with references if known) and its
   broken variants.
4. Run `sheets <name> all` and `metrics <name> all`, and read the sheets.
