# Creature Lab

A lab for iterating on creature motion. A creature is a folder of code: a
skeleton, a body of masses on its bones blended into one skin, and a rig
written for that species in brokernel.
The lab drives the rig with scripted intent and measures what it does. It
renders sheets and JSON metrics headless from the command line, and plays runs
back in a window.

## The creature contract

`lab/contract.js` defines the records. The same names are the brokernel
module `creature::contract`.

- **Intent in** (`INTENT` floats a creature): wanted velocity, a heading or a
  face-the-way-it-moves flag, a gaze point and its weight, an action (`move`,
  `graze`, `startle`, `lie`, `alert`, `bound`: go by leaps, as an escape)
  with its amount, and the individual's seed.
- **Ground**: the `env` record. A rig asks `creature::ground`'s `height` and
  `normal` for the ground under it (`lab/ground.bk`): planes, slopes, and
  rough ground from a hash that agrees between GPU and CPU.
- **State**: the species' own floats per creature. The first five are the
  contract's: position, yaw, and whether it has been placed.
- **Pose out**: bones x 3 `vec4` per creature, written to the pose buffer.
- **Telemetry out** (`TELE` floats): position, yaw, speed, gait, phase,
  action, body height, pitch, roll, stride frequency, the time into a leap,
  and per foot whether it is planted and where.

One rig dispatch (`@kernel @grid(1) k_rig`) steps every creature of a batch
once. Skinning is an instanced mesh's brokernel vertex hook (`lab/skin.bk`)
reading the pose buffer through `setShaderBuffer`; it blends a vertex's bones
as dual quaternions, so a bent joint keeps its girth. The lab draws the same
way everywhere: sheets, live view and tests.

A creature folder (`creatures/<name>/`) has these files, and
`creatures/<name>.js` re-exports its `creature.js`:

| File | What |
|------|------|
| `creature.js` | `name`, `skeleton`, `body`, `rig: { file, kernel, modules }` (`modules`: the rig's own brokernel modules by name, as files in the folder), `scale`, `cycles` (which scenario is each steady gait, with reference duty factors and footfall offsets), `form` (the body's reference measures), `variants` (named knob sets; the deer's broken ones are `slip`, `sink`, `overbend`, `stumble`), `scenarios` |
| `skeleton.js` | bones (parent, head, tail, per-axis joint limits in degrees), feet, tracked points, chart joints |
| `body.js` | the body: masses on bones built with `lab/flesh.js` (the deer splits it into `body.js`, `legs.js` and `coat.js`) |
| `rig.bk` | the species' rig. `@knob` constants can be overridden from the command line |
| `scenarios.js` | the species' own scenarios, added to the lab's |

Rigs are written per species: the gait, where the feet go, the plan of the
body's place. What makes that plan move like a body is shared, in layers any
skeleton gets (each reads only `creature::skeleton`, the module the lab
writes from a skeleton: masses, the dangling chains, the legs with their
lengths and the bone each hangs from, the spine from the root to the front
legs' bone):

| Module | What |
|--------|------|
| `creature::pose` (`lab/pose.bk`) | `Pose`: every bone's world rotation and head; points on bones, local rotations, the centre of mass, writing a pose out |
| `creature::body` (`lab/body.bk`) | the centre of mass as a state of its own, moved only by what the loaded feet can push: each leg along its line from foot to swing joint, push only, more as it flexes, a little across it, within friction; free fall with no foot down. `body_step(plan, stiffness, Support)` steers it toward the rig's plan; a foot loads and unloads over 40 ms, and a gait with flight pushes harder in stance to carry its weight over the stride. `Support.effort` above 1 is an all-out push (each leg pushes that much more, nearly to full reach); `Support.lead` feeds the plan's vertical acceleration forward, for a deliberate move whose push begins when it is asked rather than when the body has fallen behind |
| `creature::leap` (`lab/leap.bk`) | a leap from a gait: the run-up's strides paced so the hind feet's last stance ends at the take-off spot, a crouch onto the hind legs and an all-out push held long enough to lift the body, a ballistic flight whose height clears an obstacle (or a bound's rise with none), the trunk pitching nose-up to nose-down, and a landing absorbed fore first. `leap_begin`, `leap_hip` and `leap_pitch` give the plan, `leap_leg` each foot's lift and touchdown, `leap_effort` and `leap_follow` the body's Support; times scale with the legs' pendulum time |
| `creature::spine` (`lab/spine.bk`) | the back's flex, bend and twist from what the legs do: flexed by the feet's spread along the body (most in a gait whose pairs swing together), bent into a turn's curve and toward gathered feet, twisted by sideways acceleration, hollowed by the body's vertical acceleration; each a spring of the trunk's frequency |
| `creature::secondary` (`lab/secondary.bk`) | every dangling chain (neck, head, ears, tail) carried by its momentum: the subtree's centre of mass on a spring and damper toward where the rig puts it, its frequency from the part's size and its damping from its share of the body's mass (a heavy neck near critical, so a gait's rhythm never rings it into a whip; an ear or a slender tail light, so it swings past and settles), joint limits eased into, and a part swung into the ground resting on it (a part the rig lays there stays there); `hold` keeps part of a bone's world rotation (a head steadied in space but not pinned). `carry` takes the `env`, for the ground |

`lab/common.bk` and `creature::ground` hold the small helpers (smoothsteps
with no jump in acceleration, quaternions, value noise). The deer's rig
places its root where the body is (the pose moved so its centre of mass sits
on `creature::body`'s), steps its feet from where the body is and how it
moves, takes its trunk's angles from `creature::spine` and passes the pose
through `creature::secondary`; its `LAYERS` knob scales all of it (0: the
plan as the rig draws it). Telemetry's position is the plan's (the root the
body moves about), so the body's own motion shows against it.

The reference creature is `deer`: a deer-sized quadruped with spine, neck,
head, ears and tail. Its gaits are walk, trot and gallop, and its actions are
idle, graze, startle, lie down and bound; from a gallop it leaps a log in its
path (`creature::leap`). `hexa` is an invented one with no
reference behind it: six legs on a tripod walk, a long tail and a heavy head.
Its rig is on the same layers (`creature::body`, `creature::spine`,
`creature::secondary`, with the same `LAYERS` knob; `hexa:plan` is it with
them off), its height held where the planted legs reach.

## Bodies: masses blended into one skin

`lab/flesh.js` builds a body from masses on the skeleton's rest pose:

```js
const B = new Flesh(skel, { color: coat, triangles: 14000 });
B.blob('hump', 'thorax', [0, 0.80, 0.55], [0.17, 0.12, 0.26], { blend: 0.06 });
B.limb('neck', ['thorax', 'neck'], [
    { c: [0, 0.66, 0.78], r: [0.19, 0.20] },
    { c: [0, 0.68, 1.06], r: [0.15, 0.17] },
], { blend: 0.05 });
B.section('girth', { at: [0, 0.6, 0.3], normal: [0, 0, 1], bone: 'thorax', radius: 0.4 });
return B.build();
```

- `blob(name, bone, c, r, {dir, up, blend})`: an ellipsoid with radii
  `[side, up, along]`, on one bone or `[[bone, w], ...]`.
- `limb(name, bones, points, {up, blend, steps, joint})`: key points
  `{c, r, bone?}` (r one radius or `[side, up]`) splined into a swept
  ellipse, its section frame leaning to `up`. A point's bones are the named
  ones nearest it unless it names its own.
- `section(name, {at, normal, bone, radius})`: a named cut that form
  measures, carried by one bone, or with `bone: [a, b]` bisecting two (a
  joint).
- `blend` is how far a mass melts into the others (m), so a neck is one
  skin with the chest at a softness the author picks.

`build()` evaluates the field on the GPU (`lab/flesh.bk`): each mass adds
`exp(-d / blend)` and the skin is where the sum is 1. It meshes the field once
at rest with surface nets, decimates to the triangle budget, orders the
vertices for the vertex cache and projects them onto the surface. The skin
weights come from the same field: each mass weighs in by
`exp(-d / (blend * soft))`, and within a mass by its key points' bones
along it; they are smoothed over the mesh and the top four kept. The
colour function is called per vertex with `share(mass)`, how much of each
mass is there. The result is one closed piece; the lab's dual-quaternion
skin hook deforms it.

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
$B tools/creature-lab tools/creature-lab/cli.js -- film deer gallop --from 3 --to 4.5
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer all
$B tools/creature-lab tools/creature-lab/cli.js -- snapshot deer before
$B tools/creature-lab tools/creature-lab/cli.js -- ab deer@before deer walk --diff
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer trot --knob HEAD_HOLD=0.5
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer all
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer gallop --top 0
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer --rank --top 12
$B tools/creature-lab tools/creature-lab/cli.js -- natural deer
$B tools/creature-lab tools/creature-lab/cli.js -- herd deer trot --count 50
$B tools/creature-lab tools/creature-lab/cli.js -- scenarios deer
```

`herd` runs `--count` creatures (50) of one batch through a scenario under the
live view's light and shadows, and writes the GPU frame time (mean, median,
p90, max), its passes and the triangle count to `herd-<scenario>-<count>.json`.

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
- **Film** (`lab/film.js`): motion as the eye judges it, over a window of
  the run (`--from`, `--to`; 1.5 s mid-run by default).
  - a filmstrip of `--frames` (14) side views a fixed time apart
  - a side view along the run's first heading: the creature drawn at five
    moments where it really was, the head, withers, hips and tail-tip paths
    over it with a dot every 0.1 s, the terrain and any log on it
  - slit-scans through the head, withers and tail tip: a vertical slit
    through the point in the creature's frame, one column a step, the bones
    crossing it drawn by height, so a bob or a swish reads as a wave and a
    jerk as a step in it
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
  - at rest: each named section's area, girth, width, depth, top and bottom,
    each mass's volume and the body's, checked against `form.reference`
  - through a cycle of each scenario (walk and trot by default): each
    section's area and girth, each mass's volume and the body's as a share of
    rest. A mass's volume is the region its own skin encloses (the vertices
    it is the main mass of), capped across its borders, so the masses' volumes
    sum to the body's.
  - `flags`: one line per finding
- **Hard lines** (the `finder` command, `finder/`): where the body shows a
  line a single skin would not, measured without a reference, so it judges
  any creature.
  - A body is one piece or several (`build()` returns `pieces` and each
    vertex's `piece`); a flesh body is one, and its skin is labelled by the
    mass and bone under it (`neck over thorax`). On the skinned mesh of every
    4th step (`lab/seams.js`): **crossings**, the curve along which two
    pieces pass through each other, its length and the angle between the
    surfaces; **folds**, the skin passing through itself, keyed by the
    masses on both sides; **creases**, edges sharper
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
    kinks are inward notches of the outline, skipped where the outline's
    two sides lie more than 8 cm apart in depth (one part in front of
    another, such as legs crossing in view). Each is measured in cm of line
    on the body and named by the pieces or masses and bone under it.
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
- `ground`: slope, uphill direction, rough amplitude, wavelength and seed,
  and a `log` lying on it (`{ at: [x, z], yaw, height, length }`: round, its
  height its diameter). Feet find the log in `height`; `terrain` is the
  ground without it, and `obstacle_ahead` the distance along a direction to
  where a path crosses it.
- `start`
- `track`: keys of speed, heading, turn, face, action, param and gaze, each
  holding from its time on

A creature's `scenarios.js` adds its own, such as the deer's
`browse-and-flee`, `leap` (a run-up at 5 m/s, a leap over a 1 m log, the
run-out) and `startle-bound` (grazing, startled, escaping in bounds, then
galloping on).

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
  - the rest deer is one closed skin with no crossing or fold; the debug
    views decode, and the image finds no seam
  - a flesh blob meshes to its ellipsoid's volume and sections; two limbs on
    two bones blend into one skin whose weights hand from one bone to the
    other, and the masses' volumes sum to the body's
  - on a deer walk with a defect put in: a corner in a joint's speed is one
    kink, noise on a joint jitters, a body lifted along a line gains energy
    and is off free fall while one lifted on a free-fall arc is not

## Adding a creature

1. Copy `creatures/hexa/` (or `deer/`) to `creatures/<name>/` and add
   `creatures/<name>.js`.
2. Write its skeleton with limits, then its body as masses on those bones
   (`hexa/body.js` is one page), then its rig against `creature::contract`.
3. Name its steady gaits in `cycles` (with references if known) and its
   broken variants.
4. Run `sheets <name> all` and `metrics <name> all`, and read the sheets.
5. Run `finder <name> all` and `natural <name>`: both need only the
   skeleton's feet and tracks (`head` and `withers` for the head measure)
   and the body's masses. Run `form <name>` for each mass's volume in
   motion.
