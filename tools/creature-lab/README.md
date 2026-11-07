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
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer all
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer gallop --top 0
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer --rank --top 12
$B tools/creature-lab tools/creature-lab/cli.js -- natural deer
$B tools/creature-lab tools/creature-lab/cli.js -- scenarios deer
```

`finder` scans each named scenario into `finder/scan-<scenario>.json`
(about 10 to 20 s a scenario), then ranks every scan in that folder, so
scenarios can be scanned a few at a time and ranked together. `--rank` with
no scenario only ranks; `--top <n>` draws that many close-ups (`0` scans
without drawing); `--every <steps>` sets how often the mesh is measured (4).
`natural` runs walk, trot, gallop, start-stop, gaits, trot-turn and startle
by default; the steady gaits run for 20 s so there are cycles to compare.

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
- **Hard lines** (the `finder` command, `finder/`): where the body shows a
  line a single skin would not, measured without a reference, so it judges
  any creature.
  - Every loft and blob of the sculpt is a piece (`build()` returns
    `pieces` and each vertex's `piece`; a piece is named by its `name`, else
    by its kind and last bone). On the skinned mesh of every 4th step
    (`lab/seams.js`): **crossings**, the curve along which two pieces pass
    through each other, its length and the angle between the surfaces;
    **folds**, a piece passing through itself; **creases**, edges sharper
    than at rest by more than 25 degrees; and **bone pull**, the skin's
    distance from its main bone against rest. A site's score is its length
    in cm times its angle over 90 degrees, so every kind ranks against the
    others. Closed pieces' volumes are followed as a share of rest.
  - On the image (`lab/shots.js`, `lab/lit.js`): the frames where the mesh
    is worst, and 8 spread through the run, are drawn lit as the live view
    lights them (its sun, ambient and shadows) from four cameras round the
    body. The skin hook's debug views give each pixel its piece, its
    distance from the eye in cm and its normal (`setDebugView('piece' |
    'depth' | 'normal')`, `lab/skin.bk`). Seams are two pieces meeting at
    one depth at an angle of 8 degrees or more; creases are the normal
    jumping between neighbouring pixels by more than it turns either side;
    kinks are inward notches of the outline. Each is measured in cm of
    line on the body and named by the pieces and bone under it.
  - `finder.json`: the worst moments (one per site, the view that shows it
    most), every site's worst score per scenario, and the shape without a
    reference: the pieces, the crossings and folds already there at rest,
    closed pieces' volume range per scenario, and the worst bone pull.
  - `worst-NN.png`: a moment as a large lit close-up from the direction that
    shows the line best, the same with the measured line marked, and the
    scan view with the site ringed, headed by its measured length, angle,
    score, scenario and time. `worst.png` is their index;
    `<scenario>-seams.png` charts the mesh's score through the run with the
    image's scores on it.
- **Naturalness** (the `natural` command, `natural/`, `lab/natural.js`):
  motion judged against principles rather than a reference. Each measure has
  a threshold (`NATURAL`) and a flag line when it fails.
  - **Overlap and follow-through**: per bone, the lag of its swing behind its
    parent's over the mean steady cycle (circular cross-correlation). A
    bone off the legs moving with its parent at no lag is `locked`.
  - **Secondary motion**: at each change the intent asks for (a start, a
    stop, a new speed, a turn, an action), each free bone's angle over the
    next 1.2 s: its excursion, how far it swings past where it settles,
    reversals and settling time; `rigid`, `follows` or `momentum`. Also the
    share of skin on one bone alone.
  - **The mass's physics**: the centre of mass's acceleration. In flight
    (no foot down) it must be free fall; with feet down it must not be
    pulled down faster than gravity nor pushed sideways past friction
    (mu 1); no flight may gain energy.
  - **Smoothness**: each joint's angular acceleration against its
    neighbours two steps off; a spike is a corner in the joint's speed.
    Kinks a second, per joint and overall, with jerk.
  - **Variety**: each steady cycle's deviation from the mean cycle, split
    into slow change (variety: `repeats` under 1% of the range, `wanders`
    over 12%) and step-to-step noise (`jitters` over 1.5%).
  - **Head stabilisation**: the head's pitch and yaw against the withers'
    (0.5 s high-pass): `rides` with the trunk, or `frozen` (under half a
    degree while the trunk pitches more than 2).
  - **Arcs**: the swing feet and tracked points over the last cycle in the
    creature's frame: corners, reversals (going back along a line) and the
    straight share of the path.
  - `<scenario>-natural.json` and `<scenario>-natural.png` (a chart per
    measure and the flags), and `natural.json` with every scenario's flags.

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
  memory (`lab/page.js`: the paper, a 2D under layer, the scene through
  `captureFrame`, a 2D overlay), the same way in a window and headless, so
  the page around it stays as it was. The sheet's scene is parked between
  sheets and put on a hidden canvas of the document for each capture (a
  parked scene is not rendered), and it renders at one pixel a CSS px
  whatever the display's scale.

Headless runs drive the view through `globalThis.creatureLab`.

## Tests

`scripts/validate.sh tools/creature-lab` runs the smoke test and four tests:

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
  sheet kind on demand and still draws after, and through the windowed frame
  loop (`runFrames`) on a HiDPI display draws an A/B turnaround with a body
  in every cell of its first A and B rows. It writes screenshots to
  `tests/out/shots/`.
- `tests/test_measures.js`:
  - two crossing tubes cross along curves of the expected length and angle;
    parallel tubes draw no line; a closed tube's volume is its prism's
  - the rest deer's crossings include the neck and every leg into the trunk;
    the debug views decode, and the image finds the neck-into-trunk line
  - on a deer walk with a defect put in: a corner in a joint's speed is one
    kink, noise on a joint jitters, a body lifted along a line gains energy
    and is off free fall while one lifted on a free-fall arc is not

## Adding a creature

1. Copy `creatures/deer/` to `creatures/<name>/` and add
   `creatures/<name>.js`.
2. Write its skeleton with limits, then its body, then its rig against
   `creature::contract`.
3. Name its steady gaits in `cycles` (with references if known) and its
   broken variants.
4. Run `sheets <name> all` and `metrics <name> all`, and read the sheets.
5. Run `finder <name> all` and `natural <name>`: both need only the
   skeleton's feet and tracks (`head` and `withers` for the head measure)
   and the sculpt's pieces.
