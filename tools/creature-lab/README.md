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
| `creature.js` | `name`, `skeleton`, `body`, `rig: { file, kernel, modules }` (`modules`: the rig's own brokernel modules by name, as files in the folder), `scale`, `speeds` (its walk, trot, gallop and circling pace, which size the lab's scenarios), `space` (m a flock keeps between neighbours, 2.2 if unset), `cycles` (which scenario is each steady gait, with reference duty factors and footfall offsets), `form` (the body's reference measures), `variants` (named knob sets; the deer's broken ones are `slip`, `sink`, `overbend`, `stumble`), `scenarios` |
| `skeleton.js` | bones (parent, head, tail, per-axis joint limits in degrees), feet, tracked points, chart joints |
| `body.js` | the body: masses on bones built with `lab/flesh.js` (the deer splits it into `body.js`, `legs.js` and `coat.js`) |
| `face.bk` | its face (`creature::face`, named by `creature.js`'s `face`), drawn per pixel over the skin: see below |
| `poses.js` | its keys, when it is drawn pose by pose (`creature.js`'s `keys`): see Keys below |
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
| `creature::body` (`lab/body.bk`) | the centre of mass as a state of its own, moved only by what the loaded feet can push: each leg along its line from foot to swing joint, push only, more as it flexes, a little across it, within friction; free fall with no foot down. `body_step(plan, stiffness, Support)` steers it toward the rig's plan; a foot loads and unloads over 0.125 of the legs' pendulum time (40 ms for the deer), the body strays at most a quarter leg from its plan, and a gait with flight pushes harder in stance to carry its weight over the stride. `Support.effort` above 1 is an all-out push (each leg pushes that much more, nearly to full reach); `Support.lead` feeds the plan's vertical acceleration forward, for a deliberate move whose push begins when it is asked rather than when the body has fallen behind (that acceleration already carries the flight's weight, so the extra stance push is owed only for the share not led) |
| `creature::leap` (`lab/leap.bk`) | a leap from a gait: the run-up's strides paced so the hind feet's last stance ends at the take-off spot, a crouch onto the hind legs and an all-out push held long enough to lift the body, a ballistic flight whose height clears an obstacle (or a bound's rise with none), the trunk pitching nose-up to nose-down, and a landing absorbed fore first. `leap_begin`, `leap_hip` and `leap_pitch` give the plan, `leap_leg` each foot's lift and touchdown, `leap_effort` and `leap_follow` the body's Support; times scale with the legs' pendulum time |
| `creature::spine` (`lab/spine.bk`) | the back's flex, bend and twist from what the legs do: flexed by the feet's spread along the body (most in a gait whose pairs swing together), bent into a turn's curve and toward gathered feet, twisted by sideways acceleration, hollowed by the body's vertical acceleration; each a spring of the trunk's frequency |
| `creature::secondary` (`lab/secondary.bk`) | every dangling chain (neck, head, ears, tail) carried by its momentum: the subtree's centre of mass on a spring and damper toward where the rig puts it, its frequency from the part's size and its damping from its share of the body's mass (a heavy neck near critical, so a gait's rhythm never rings it into a whip; an ear or a slender tail light, so it swings past and settles), joint limits eased into, and a part swung into the ground resting on it (a part the rig lays there stays there); `hold` keeps part of a bone's world rotation (a head steadied in space but not pinned). `carry` takes the `env`, for the ground |

`creature::limbs` (`lab/limbs.bk`) is the library a species' legs module
calls: a leg solved in its plane (the abduction that puts the plane through
the foot, then a four-bone hind leg as a pantograph and a five-bone fore leg
whose blade follows the swing; `solve_hind_flat` for a foot that stands on
its heel, its angle eased under a limit so the folded pantograph does not
drive the heel into the ground), the eased bump a swing's lift and folding
are made of, a soft cap on a length, a planted foot's roll onto its toe, and
the lean over the feet that carry the body. `swing_arc` carries a swinging
foot on an arc about its girdle (its angle from straight down and its
distance each eased from lift-off to the landing mark, both measured from
where the girdle is now) rather than along the line between them, so a foot
the body overtakes does not pass close under its girdle and swing the leg
through that angle at once. `soft_range`, `soft_xyz` and `within_range` ease
an angle, a bone's angles, or a bone's world rotation into its joint ranges
over a band instead of clamping, so a joint asked past its range turns to
rest against it with no corner in its speed.

`creature::dangle` (`lab/dangle.bk`) is a sprung tip for a part that hangs
off the body (an ear, a scut): `dangle_step` moves a particle toward the
part's rest tip on a damped spring (damped against the rest point's own
motion, so it rides with the body and lags only its changes, with a share of
gravity), and `aim_at` turns the part's bone toward it, softly capped; a rig
then eases the result into the joint's ranges with `within_range`. Its state
is `DANGLE_REC` floats a tip.

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
path (`creature::leap`). Turning on the spot it steps round in diagonal
pairs, and lying down its lower joints fold ahead of the rest
(`FOLD_AHEAD`). Galloping, its body may rise `GALLOP_FREE` past what its
planted hooves hold, and a hoof the posed leg hung short of last step
(`SHORT_LET`) steps, so a leg that runs out of length lets go of its mark
rather than dragging its hoof off it. `hexa` is an invented one with no
reference behind it: a slender six-legged browser of the plain, a long back
on three pairs of long legs, an arched neck of two bones, lyre horns, long
ears and a thin tufted tail. Walking, its legs go in a ripple up each side
(each a third of a cycle after the one behind, `leg_off`), which closes up
into a tripod as it hurries (`RIPPLE_V`, `TRIPOD_V`), a foot's share of the
cycle on the ground falling from `DUTY_WALK` to `DUTY_RUN` with it, and never
more feet in the air than leave it standing; the run's back rises and falls
with each tripod (`RUN_BOB`) and its head, ears and tail beat with the
stride, more the more it hurries. A swinging foot leaves and lands with no
speed (a quintic ease along its path, its lift and the hoof's curl one bell),
so a footfall is no corner in any joint. Turning on the spot it steps round
at a rate its legs can follow. The body rides low enough that a leg reaches
only `STEP_REACH` of its length at a step's ends, short of where its reach
begins to ease in (`SOFT_REACH`), so no footfall falls inside that easing; a stance travels less
than the pairs stand apart, and the body rides as much lower as the legs
need to reach a step's ends still bent. Its rig moves the body on
`creature::body` and `creature::spine` (the `LAYERS` knob; `hexa:plan` is it
with them off), its height held where the planted legs reach; its neck,
head, ears and tail are the rig's own (the neck giving at each step, the
ears roaming and flicking, the tail a hanging cord the hips' sway runs down
as a wave, drawn from the stride's phase so nothing in it rings).

`bunny` is a wild rabbit (0.2 m high, 0.42 m long) with motion of its own,
not on those layers. It has no walk: it hops (the fore feet stepping one
after the other, then the hind pair swinging up together to land beside or
ahead of them), and faster it half-bounds with flight; telemetry calls these
gaits `hop` and `bound`. Its body goes as `bunny::stride` (`stride.bk`) has
it: each girdle surges about the stride's pace, the two opposed about the
centre of mass (the hindquarters carry 0.58 of it, so the withers surge
further than the hips), slowing over its own feet's stance and running on
while they swing, so the trunk stretches as the hind push throws the front
on and gathers as the hips catch up, the back's flex following that spacing;
in the bound's flights the body falls freely. The body recoils from its own
legs, which are a large share of it: the legs are solved twice, and between
the two the trunk is moved by what the mass stands off its usual place over
the path's point and the hips' planned height (a mean over `RECOIL_T`), a
foot in the air carried with it through the middle of its swing, so legs
thrown forward and down send the trunk back and up and the mass keeps the
stride's even pace and the plan's rise and fall. The head is held steady in
space (the neck solved each step so the head stays at its posture's smoothed
height, eased into the neck's reach, its turn set in the world), lifted as
it goes and riding a little of the trunk's pitch. The ears (`ear.js`: their
axis and opening, shared by the skeleton, the body and the coat) are shells
from narrow bases 4 cm apart, standing in a V, each hollowed by a carved
mass and lined pale inside. Each listens on its own: it holds where it has
turned for an irregular while, then swivels its opening about its own
length on a critical spring to the next, half the time toward a sound the
pair shares and else on its own scan, now and then flicking instead
(`EAR_FLICKS`); relaxed they splay, alert they stand close facing the gaze,
grazing they stay up as the head goes down, hopping they listen ahead,
running they sweep back, loafing they lie along the neck. Each of their two
bones is aimed at a sprung tip (`creature::dangle`), and the scut is sprung
the same way. Moving a little (under `SHUFFLE_TOP` m/s) it shuffles rather
than hops: the fore paws step one after the other, the hind feet come up
low after them near together, and the rump does not vault. Turning it hops
round, never shuffles, and a hind foot left astray is brought home with its
pair (`settle_hinds`). Its feet swing on `swing_arc` paths,
folded toward their girdle only as far as clears the ground by the swing's
lift; the fore stride is shorter hopping (0.10 m) than bounding (0.13 m),
since the hop's fore leg stands under its shoulder and the longer stride
would carry it to full stretch, and the hopping fore foot's home comes back
from where it sits (`HOME_HOP_F`) so the paw lands near under the shoulder,
not reaching. The hop's hips vault over the hind swing (`HOP_ARC`, added
after the height's spring, so the vault peaks with the swing rather than as
the feet come down), and the hind feet land a little ahead of their home,
beside the fore prints (`HOP_LAND_H`). Sitting and hopping it is hunched: the
back rounded (`FLEX_SIT`, the trunk's flex about which bounding stretches it
long) and the hips carried low (`HIP_DROP`). At rest it sits on its flat
hind feet (`solve_hind_flat`). Alert, it sits up on its haunches with its fore paws held
against its chest; lying, it loafs with its ears laid back. Grazing, it chews,
its nose twitches, its ears turn each on its own, and its scut flicks up as it
runs. A swinging foot is kept no nearer its girdle than the leg folds within
its joints' ranges, and a girdle is planned over the ground under a swinging
foot's home, not under its landing mark (a hop's is well ahead, and on a
slope well below).

`strider` is an invented biped (1.2 m to its crown, 31 kg) given in keys
(see Keys below), not on the deer's layers: a fox-headed runner that carries
its body level over two long digitigrade legs, as a running bird does (a
short thigh held forward along the belly, a long shin back to a raised hock,
a long slim foot down to the toes it stands on), its compact trunk rising
forward from the hips and balanced over the feet by a long tail with a
brush at its end; a large head on a short neck in a pale ruff, tall ears of
two bones each, small arms folded at its breast. Its `poses.js` draws the
poses it stands, forages, rests, stands alert and flinches in. Its gaits
are not drawn pose by pose: `stride(p, G)` makes the pose of any phase of a
stride from how it goes (where a leg is in its stance or swing, the hips'
bob, sway and turn, the back turning against them, the tail keeping the
heading the hips had a moment before, the arms' beat, the neck giving at
each landing, the ears' nod), so every part keeps time with the one phase;
`WALK` and `RUN` are the two sets of numbers it is read with, and each
cycle is that at eight phases a step, mirrored for the other. Its rig stands the
keys on the ground. The walk is blended from the stand by how fast it goes
(`WALK_V`) and goes over to the run between `JOG_V` and `RUN_V` through a
jog that is some of each, the stance's share of the stride blended with the
poses (telemetry's gait `run` past halfway). The stride's rate is what
carries the body one stance's ground in one stance's time. A foot that
lands is pinned where it landed and its leg solved to it; one that lifts
leaves from where it was and joins the key's path through its swing; the
toes lie along the ground under them. A foot leaves the ground when the
keys draw it off (`LIFT_DRAWN`), not on the clock alone, and a swing lands
where the turn will have carried its place by then. With neither foot down
its mass falls freely (`air_step`), and what the flight left it off the keys
is let go at the landing without overshoot (`air_lift` steps that before the
pose is made, so a landed step stands on this step's lift as a flight's
does, and the ears, arms and tail swing from the body where the fall has
it). A foot that lifts is joined to the keys' swing from the ground it left
over `JOIN_U` of the swing, so it leaves at the ground's speed. Turning on the spot it steps where it stands, and
standing with a foot astray it steps home. Foraging (`graze`) it crouches
with its nose and hands at the ground, nosing about and scrabbling in
bouts; resting (`lie`) it sits back on its haunches with its tail laid
round; startled it flinches down and back with its ears flat, then stands
tall and alert. Standing it breathes, shifts its weight from foot to foot,
sways its tail, flicks an ear and glances about (`LIFE`). Its head turns to
the gaze, the ears leading; each ear listens on its own, swivelling to a
new place every second or two, and its hands are never quite still. Its
upper body is its own rig's, with no shared layer over it: the head is held
steady (where the keys would turn it is eased, and the neck and head each
take half the turn back from the chest, `HEAD_SPACE`; what the keys bend
the neck by beyond that it keeps, the head turned back by as much, so the
neck gives under a head that does not tip), and the ears, forearms and
hands carry their momentum, each bone's tip on a spring from where the keys
have it (`creature::dangle`, the rig's `LOOSE` table: firmer as it runs).
The tail's bones trail instead (`trail`): each tip follows where the keys
put it without overshoot, so the tail streams behind a run and swings wide
of a turn. `strider:plan` is the keys with these off. Its skeleton
rests with the arms reaching forward and down, clear of the breast, so each
is meshed in a skin of its own; every pose folds them (`poses.js` `arm`).
Its face (`face.bk`) draws
amber eyes in dark rims, a nose pad and a mouth.

### Keys: a creature drawn pose by pose

A species whose whole body makes its gait (a biped: the hips drop, sway and
turn with each step, the chest turns against them, the arms and tail
answer) is drawn rather than derived. Its `creature.js` names `keys: {
poses, cycles }` (its `poses.js`; `lab/posing.js` has the form). A pose
says where the body is: the root's offset and turn, any bone's turn from
its parent in degrees, and each foot's ball from where it rests, with the
heel's lift and the toes' pitch. Legs are never keyed by their joints: a
leg is solved from its hip to the ball, so a pose is drawn by placing the
feet, and a rig can pin a foot under any pose. A pose may start from
another (`base`). A cycle is poses at phases of a stride with each leg's
stance; with `mirror: true` only the first half is drawn and the second is
its mirror half a cycle on.

`resolveKeys` writes them out as the brokernel module `creature::keys`
(`K_<POSE>`, `C_<CYCLE>`, each cycle's stance windows and the ground a
stance covers, `CYC_SPAN`), and `creature::keyed` (`lab/keyed.bk`) is what
a rig reads them with:

| Function | What |
|----------|------|
| `key_get`, `key_mix`, `key_add`, `key_turn` | a pose; two blended; one's difference from another laid over a third; a bone turned further |
| `cycle_at` | a cycle at a phase: a spline through its keys with no corner in any bone's speed, and no foot under the ground between keys that have it down |
| `cycle_stance`, `cycle_swing`, `cycle_duty` | where a leg is in its stance or swing |
| `gait_at`, `gait_stance`, `gait_swing`, `gait_duty`, `gait_span` | two cycles on one clock blended (a walk into a run), their stances' lengths with them |
| `key_ball`, `key_trunk`, `leg_solve`, `key_pose` | where a key has a foot; its bones off the legs stood on the ground; a leg solved from its hip to a ball (heel lift, toe pitch, the foot's turn, the knee turning with it, eased into its reach and its joints' ranges); a key as it is drawn |
| `air_lift`, `air_step` | flight: with no foot down the pose is moved so its centre of mass falls freely from the velocity it left the ground with, and what that leaves it off the keys is let go through the next stance |

`model <creature> [pose ...]` draws the keys with no rig and no motion
layers: every pose from four sides with where its centre of mass stands
against its feet (red when a pose it stands in has it past them; a cycle's
key is a moment of a stride and is not held to that, the cycle is flagged
when its mass never passes over its feet), and every cycle's phases from
the side and the front with its stances and the ground one covers. It is
where a pose is drawn and judged, in two seconds, before any of it moves.

`wader` is an invented long-legged wading bird (0.95 m, 2 kg) on the same
layers (`wader:plan` is its plan alone). Each leg is a bird's Z (femur,
drumstick, bare tarsus, toes) solved hip to toe tip by `solve_hind`. In
stance the toes lie flat, and the foot rises onto their tips as it leaves.
In the swing they curl under, then open to land flat. The walk is on a
little bend of the legs, more the faster it goes, so a foot that lands well
ahead still has its reach. Faster it runs, as the strider does. Walking, its
head bobs: it holds still in the world while the body passes, then thrusts
to where its place on the body will be halfway through the next hold. The
thrust is eased with no speed or acceleration at either end, because the
neck carries a tenth of the mass and an abrupt thrust jolts the body. The
neck has one shape for each place of the head (`solve_neck`): its last bone
turns with the line from the neck's root to the head and a little past it,
so reaching down it hooks over, and the two below it are the sides of a
triangle that brings it there, their joint kept to the side it lies on at
rest, so the S deepens as the head draws in and opens as it reaches. Its
reach eases in at either end, and the head keeps its bill level, turned to
the gaze. Looking aside, the head is carried toward what it looks at
(`LOOK_CARRY`) and the neck bends after it, twisted along its length by a
share of the look growing up it (`NECK_TWIST`). The folded wings are not
still: standing, one is now and then shrugged loose and tucked again;
walking, the wing over the leg that carries the bird is pressed to its flank
and the other rides a little loose, its tip dipping.
Foraging, it leans forward, the neck lowered and the bill down, and strikes
at the ground now and then. Resting, it sits back on its folded legs.
Startled, it crouches with its wings lifted from the body, then stands alert
with the neck stretched up. Its face draws side-set yellow eyes, the lores
and a black brow stripe into the crest.

`finch` is an invented small songbird (14 cm, 24 g) that hops, with legs
like the wader's, on the same layers (`finch:plan` is its plan alone). Both
feet are on one clock, with a short stance and a flight each cycle (telemetry's
gait `hop`). The body's height is a bouncing body's, measured from where it
lands and leaves: a free fall through the flight, an even push through the
stance. A hop keeps the pace it left the ground at (the pace is followed in
the stance and held through the flight). Hopping, the body rides that plan
and not `creature::body`, whose feet are too slow for a stance this short;
in the air the whole bird is put back on its mass's usual place over the
root, which the tucking legs carry it off. It starts and stops hopping at the bottom of a stance, where the
body is still, and a spring lets go of whatever bounce is left across the
switch. A foot leaving the ground is carried up with the body from where
it left the hip, then tucked under the belly, then reaches out to land flat.
Those moves are eased with no acceleration at their ends, because the legs
are a seventh of the mass and a quick tuck would jerk a body that should be
falling freely. The folded wings are held to the body outside the startle;
sprung, a landing flings them open. Its head glances: quick turns to a new
side every so often, held between, toward the gaze when there is one. The
tail cocks up as it lands. Foraging, it leans over and pecks in quick jabs.
Resting, it settles onto its belly. Startled, it crouches and flutters its
wings, then stands alert. Its face draws a black eye in a pale ring and a
stripe from the bill through the eye.

A creature can carry its own motion oracle: its def's `motion(rec, series,
{steadyFrom, steady, headBob})`, which `analyze` calls and whose flags join
the run's (and whose report is the metrics' `motion`). The bunny's
(`creatures/bunny/motion.js`) measures what a rabbit's hop and bound do: the
flights (share, longest, the hips' rise), the trunk's stretch and gather
(the hips-to-withers spacing along the heading), the head's carriage against
the withers (no lower than at rest) and its bob against theirs, and where
each hind foot lands against the fore feet's last prints. A steady bound
must fly, stretch and gather, and land its hind feet ahead.

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
- `keep` (on a blob or limb: true, or a margin in m) keeps the mass's
  detail through decimation: its vertices are locked
  (`Mesh.simplifyToTriangleCount`'s lock) and the budget is spent on the
  rest, so the deer's eyes and nose pad, 3 to 4 cm across, keep their shape.
  A coarser level of detail passes `keep: false`.
- `carve: true` (on a blob or limb) makes a mass that takes the body away
  inside it, as the bunny's ear hollows: the field is the smooth greater of
  the body's and the carve's inside distance in its blends, rounded over one
  blend, so the cut keeps a gradient for the vertices to find the surface
  by. A carve weighs and colours nothing.
- `joint` (a limb's, 1 cm by default) rounds the meeting of its spans by a
  smooth minimum, in full where the limb turns by 25 degrees or more and
  by a twentieth of it where its spans run on straight: a smooth minimum
  fills the crease inside a bend, but between straight spans it would
  bulge the whole limb (a point near several short spans takes the bulge
  from each).
- form reports each mass's swell: over the vertices that are its alone,
  how far its skin stands off the shape it declares (mm, the median and
  the 90th percentile), flagged past 1 mm.

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

### Faces

A face's marks are smaller than any mesh carries, so they are drawn per
pixel. The skin hooks (`lab/skin.bk`, and `lab/skin-crowd.bk` at the
crowd's full level) pass each point's rest position to the fragment, and
call the creature's `creature::face`:

```
pub fn face(p: vec3<f32>, foot: f32, s: mesh::Surface) -> mesh::Surface
```

`p` is the point at rest and `foot` a pixel's size there (from its screen
derivatives), so each edge is softened over one pixel. The marks ride the
head however it moves, and stay sharp however coarse the mesh under them is.
A creature without a face gets `lab/face.bk`, which leaves the skin as its
coat paints it, and so do the crowd's coarser levels. The deer's
(`creatures/deer/face.bk`) has:

- glossy dark eyes in almond lids, with a black rim, a pale ring and the
  preorbital gland's slit;
- a moist black nose pad with comma nostrils;
- the white band behind the pad, the pale upper lip, and the lips' dark line;
- a white chin.

The eyeballs and nose pad are masses kept at full detail, so they stand out
of the head in silhouette. Its coat (`coat.js`) paints a coarse version of the
same marks for the levels the face is not drawn on.

## Commands

Run the commands from the broworkshop root:

```bash
B=../bro/build/Release/bro-headless.exe
$B tools/creature-lab tools/creature-lab/cli.js -- sheets deer walk trot
$B tools/creature-lab tools/creature-lab/cli.js -- model strider
$B tools/creature-lab tools/creature-lab/cli.js -- model strider forage rest --cycles run --cell 0.7
$B tools/creature-lab tools/creature-lab/cli.js -- turnaround deer gallop --rows 12
$B tools/creature-lab tools/creature-lab/cli.js -- turnaround deer trot --rows 4 --cell 2.5 --views right,front-right
$B tools/creature-lab tools/creature-lab/cli.js -- form deer walk trot
$B tools/creature-lab tools/creature-lab/cli.js -- trajectory deer walk
$B tools/creature-lab tools/creature-lab/cli.js -- range deer trot
$B tools/creature-lab tools/creature-lab/cli.js -- charts deer gaits
$B tools/creature-lab tools/creature-lab/cli.js -- film deer gallop --from 3 --to 4.5
$B tools/creature-lab tools/creature-lab/cli.js -- look bunny gallop --phases 0.6,0.7 --views front-left,left --dist 1.8
$B tools/creature-lab tools/creature-lab/cli.js -- look bunny gallop --rows 4 --pieces
$B tools/creature-lab tools/creature-lab/cli.js -- look strider walk --rows 3 --dist 2.3 --cell 1.3
$B tools/creature-lab tools/creature-lab/cli.js -- poses strider walk gallop
$B tools/creature-lab tools/creature-lab/cli.js -- upper strider start-stop --from 0.8 --to 2.2
$B tools/creature-lab tools/creature-lab/cli.js -- watch strider walk --view side
$B tools/creature-lab tools/creature-lab/cli.js -- watch strider walk --view front --from 0.4 --span 0.25
$B tools/creature-lab tools/creature-lab/cli.js -- skin strider walk trot --rows 2
$B tools/creature-lab tools/creature-lab/cli.js -- parts strider walk trot idle
$B tools/creature-lab tools/creature-lab/cli.js -- parts strider walk --part head,ear1L --frames 8
$B tools/creature-lab tools/creature-lab/cli.js -- kinematics deer walk
$B tools/creature-lab tools/creature-lab/cli.js -- spacing deer walk --fps 24
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer all
$B tools/creature-lab tools/creature-lab/cli.js -- snapshot deer before
$B tools/creature-lab tools/creature-lab/cli.js -- ab deer@before deer walk --diff
$B tools/creature-lab tools/creature-lab/cli.js -- metrics deer trot --knob HEAD_HOLD=0.5
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer all
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer gallop --top 0
$B tools/creature-lab tools/creature-lab/cli.js -- finder deer --rank --top 12
$B tools/creature-lab tools/creature-lab/cli.js -- natural deer
$B tools/creature-lab tools/creature-lab/cli.js -- score bunny
$B tools/creature-lab tools/creature-lab/cli.js -- sweep bunny gallop trot --sweep LEG_BAND=0.05,0.3
$B tools/creature-lab tools/creature-lab/cli.js -- kinks bunny gallop --at "RF lift"
$B tools/creature-lab tools/creature-lab/cli.js -- trace bunny gallop --leg RF --from 6.4 --to 6.6
$B tools/creature-lab tools/creature-lab/cli.js -- herd deer trot --count 50
$B tools/creature-lab tools/creature-lab/cli.js -- flock deer flee --count 1000 --shadows off
$B tools/creature-lab tools/creature-lab/cli.js -- scenarios deer
```

`herd` runs `--count` creatures (50) of one batch through a scenario under the
live view's light and shadows, and writes the GPU frame time (mean, median,
p90, max), its passes and the triangle count to `herd-<scenario>-<count>.json`.

`flock` runs `--count` creatures (200) under the flock brain doing one
behaviour (graze, travel, mill, flee; `--warm` steps first, 600), seen from
above the field (`--view field`) or from a standing eye among them
(`--view ground`) or 2.5 m from one of them (scaled by its height over the deer's) at its head's height
(`--view close`: the full level and its face); `--cull off` draws every creature into every view, for
comparison. It writes `flock-<behaviour>-<count>.json` and a
screenshot. The JSON holds:

- the GPU frame time, its passes, and each kernel's ms (the brain, the grid,
  the rig);
- how many the crowd drew at each level of detail, and the triangles drawn;
- what the group is doing: gaits, median and top speed, how many are off the
  field, the nearest-neighbour spacing, and how many have a neighbour within
  80 cm.

## Flocks

A flock (`lab/flock.js`) is a batch whose intents come from a brain on the
GPU (`lab/flock.bk`), so stepping it costs nothing on the CPU per creature.
A step is four dispatches:

1. the neighbour grid cleared;
2. the grid filled: 7 m cells, each a list threaded with an atomic exchange;
3. the brain, which reads each creature's neighbours from the 3x3 cells
   around it and writes its intent;
4. the rig.

The brain keeps neighbours apart, eases off when one is close ahead in its
path, matches their heading and draws toward them. It keeps the group on a
round field sized to its count. Its behaviours:

- **graze**: each grazes a while, then walks a few metres (back toward the
  others when it has strayed). A crowded one walks out.
- **travel**: they trot together along a heading shared from their
  neighbourhood's middle toward a goal that circles the field.
- **mill**: they circle the field's middle.
- **flee**: they graze until a threat crosses. One within 9 m of it, or near
  an alarmed neighbour, startles, then bounds and gallops away (within 70° of
  the way it faces). The alarm fades once the threat is far. A fleeing
  creature may run past the field's edge, to twice its radius, before the
  brain turns it back.

A flock in a scene draws as a crowd (`lab/crowd.js`, `lab/crowd.bk`): the
creature's body meshed three times (full; about 2400 triangles; about 500,
on a grid 1.6 and 2.8 times the full level's cell),
each an instanced node skinned by `lab/skin-crowd.bk`. Each frame a kernel
turns the poses into dual quaternions, and another puts every creature in
view on a level's list by its height on screen (full above 240 px, the middle
level above 70 px). The lists' lengths are the nodes' instance counts
(`setInstanceCountBuffer`), so nothing is read back. The full and middle
levels hold at most 150 and 1500; the rest step down, as does a creature out
of view (it still casts). The same kernel writes each listed creature's
sphere: the engine draws into the camera and into each shadow view only the
creatures it holds (`setInstanceCullSpheres`). The nodes' cull box
(`setCullBounds`) is the field and the run past it.

`finder` scans each named scenario into `finder/scan-<scenario>.json`
(about 15 s a scenario for the bunny), then ranks every scan in that folder, so
scenarios can be scanned a few at a time and ranked together. `--rank` with
no scenario only ranks; `--top <n>` draws that many close-ups (`0` scans
without drawing); `--every <steps>` sets how often the mesh is measured (4).
Any command takes `--profile`: bronze's sampling profiler runs over it and
prints the functions by self time, the callers of the costliest, and any
function tier 1 refused to compile (and why).
`natural` runs walk, trot, gallop, start-stop, gaits, trot-turn and startle
by default; the steady gaits run for 20 s so there are cycles to compare.

The text tools (`lab/iterate.js`) print to the terminal and write the same
text under the creature's folder; `score`, `sweep` and `kinks` run what
`natural` runs, so their numbers are its.

- `score` (`score.txt`): a line a scenario: the metrics' flags, natural's
  flags, kinks a second and the two foot events most fall at, the root's
  kinks, the share of ground time pushed past friction and pulled down
  faster than gravity, the share of flight off free fall, the corners the
  swing feet and tracked points turn, and the joints that jitter; then the
  metrics' flags in full. `--vs <creature>` (a `snapshot` taken before an
  edit) puts its row above the creature's, a table a scenario
  (`score-vs-<it>.txt`).
- `sweep --sweep NAME=a,b,c` (`sweep-NAME.txt`): the score of the rig as it
  is and with each value, a table a scenario. Other `--knob` overrides apply
  to every row.
- `kinks` (`kinks.txt`): per scenario, the foot events the kinks gather at,
  with the bones kinking at each and their median size; the root's.
  `--bone <name>` lists that bone's every kink (time, size, event); `--at
  "<foot> <down|lift>"` every bone kinking there.
- `trace <scenario>` (`<scenario>-trace.txt`): a row a step from `--from` to
  `--to` (0.25 s mid-run by default; `--every <n>`): which feet are down,
  then for `--leg <foot>` its toe over the ground, its distance from the
  leg's top bone and that offset along the heading and down, and its miss
  from where the rig's telemetry says it is (its target while it swings),
  for `--root` the root bone's place across and ahead of the plan's, its
  height, and how far each step is off the line through the steps either
  side (mm: a pop in the body is one large value, which a sheet cannot show),
  then each bone of the leg and of `--bones` by its flexion (local x, deg)
  with `*` within a step of a kink, the rig's probe slots that are not zero,
  and the nearest foot event.
- `creature::probe` (`lab/probe.bk`): a rig that declares `pub const PROBE`
  (an offset into its state, with `PROBE_N` floats reserved after it) has
  that slice recorded every step of a lab run (`rec.probe`); `probe(state, s
  + PROBE, i, v)` and `probe3` write slots, which `trace` prints as `p0` ..
  `p15`. The bunny reserves one.

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

- **Watch** (`watch <creature> <scenario> --view <view>`, `lab/watch.js`):
  the sheet a motion is judged by eye in, before any measure of it is
  read. A picture read whole has only so many pixels, and a sheet of forty
  cells leaves the creature a hundred tall, where a missing arm or a body
  that never shifts its weight cannot be seen. So it draws one scenario
  from one view in at most six consecutive frames, shaped to the creature
  so it fills each (five to six hundred pixels tall), and refuses more: it
  is run again per view (`side`, `front`, `back`, `front-quarter`,
  `back-quarter`, `top`) and per part of a cycle (`--from 0.4 --span 0.25`),
  or per stretch of time (`--from 10.25 --to 10.6`, seconds: a moment of a
  run of several gaits, which is not in its last cycle).
  - One camera for all the frames, standing where the creature does at its
    steady pace, not on its hips: its rise and fall, sway and lean are in
    the picture. A run that turns where it stands (`turn-in-place`) is
    drawn through its whole length from a camera that stays where the
    creature began, so the turn itself is seen (`--from`/`--to` s for a
    part of it).
  - Each frame carries the outline of the frame before, so what moved
    since, and how far, is seen.
  - A plumb line through where it stands and level lines at its hips' and
    head's rest heights; under each frame, which feet are down.
- **Skin** (`skin`, `lab/skinsee.js`): whether each limb has a skin of its
  own, and where the skin is pulled as the bones move.
  - **bound**: at rest each limb (a chain of bones out to a leaf) is cut
    across along its length. A limb drawn inside another mass (an arm laid
    against the trunk it was meshed with) has the other's skin in the loop
    about it, or none: there is no limb there to move, and its bones pull a
    web out of the body. A limb's root lies in the body it grows from
    (`SKIN.root` of its length may); past that it is flagged, with whose
    skin it is in. `model` prints these too.
  - **stretch**: through a run, every edge of the mesh against its rest
    length; where it is pulled past `SKIN.stretch` or crushed under
    `SKIN.squash` is listed by the bones either side.
  - The sheet draws the body by it at phases of the run: blue crushed, grey
    at rest, red pulled.
- **Parts** (`parts`, `lab/parts.js`): how each part moves against what
  carries it. The parts are the limbs (one of each mirrored pair) and each
  bone that branches with all it carries (a head with its ears).
  - Per part: its turn and its tip's travel in the world and on its
    carrier, the carrier's turn, and each of its joints' turn.
  - Verdicts: **glued** (it does not move on its carrier), **rides** (thrown
    about the world, hardly moving on its carrier), **wobbles** (a part that
    carries others swinging further in the world than its carrier, in a
    stride), **steadied** (it swings less than its carrier: a head held
    over a working trunk). A joint of a part that does not turn is listed.
  - The sheet gives each part a row of close-ups through the run and two
    smears, every frame laid over the others: going along with the
    creature, and with its carrier held still. A part that rides its
    carrier is sharp in the second; a steadied one is sharp in the first.

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
- **Look** (`lab/look.js`): the creature as the live view draws it (its sky
  light, sun and shadows on the checker ground), close, through a cycle.
  - rows are phases of the last steady cycle (`--rows`, or `--phases`), or
    times across an action's run; columns are cameras (`--views` from
    front-left, left, back-left, front, right, back; the first three by
    default), `--dist` body lengths out (2.6), aimed at the body's middle at
    rest, or with `--focus <bone>` at that bone's middle as each row has it
    (a close-up of the ears: `--focus earL1 --dist 0.8`)
  - `--pieces` writes `<scenario>-look-pieces.png`: each pixel coloured by
    the body piece it is on, shaded by the lit picture, each piece named at
    its middle in view; a body of one piece (a flesh body) is coloured by
    the bone each vertex mostly follows instead, so a ragged patch on the lit
    sheet says whose skin it is
  - `--cell <scale>` makes each shot that much bigger (360 x 270 at 1)
- **Poses** (`lab/poses.js`): whether a gait's poses read as the gait they
  are, and the body as a shape, with no reference (`poses.json`, flags
  printed; thresholds in `POSES`).
  - the first foot's key poses (contact, the hips' lowest and highest in
    its stance, mid-stance, lift-off, mid-swing) lit from the side, the legs
    traced over the skin (thick: planted), and under each the hips' height,
    the trunk's lean, and each leg's bend (between its two upper bones) and
    extension (hip to their end over their length)
  - a walk (duty 0.5 or more) is an inverted pendulum: its stance leg's
    bend through the middle of stance (20-70%) against `walkBend`, and the
    hips' rise from contact to their highest against the rise a rigid leg
    of the measured length would give from the contact's reach (`vault`,
    against `walkVault`)
  - a run is a spring: the leg gives through stance and leaves the ground
    extended (`pushOff`)
  - the silhouette: the rest pose rasterized from the front and the side
    and mid-stance from the front, tails left out of the front: where the
    legs part against the hip joints' height, the share of the trunk's
    height with the arms clear of it, and the front width profile's pinches
    (neck, waist, a leg's joints), each against the widths within 12 cm
    above and below; no waist pinch is a tube, a weak neck pinch a stalk;
    and the first leg's own skin side on, the thigh's greatest depth over
    its middle against the shank's (`thighCalf`): a calf deeper than the
    thigh makes the leg top-light
- **Upper body** (`lab/upper.js`): the trunk, head and arms over the run's
  time rather than a cycle's mean, so a start or a stop shows as it happens.
  - each tracked point and each arm's elbow and hand tip: the size of its
    acceleration in the world, its kinks (red ticks), its jerk and its
    largest acceleration
  - each bone off the legs and the tails: its turning speed in the world and
    the kinks of its turn
  - every kink tagged with the start, stop or turn it follows within
    `UPPER.after` s ("start +0.12 s") or else the nearest foot event, and
    printed worst first a row
  - each of those bones' own swing against its parent over the steady
    cycles (amplitude, lag, locked), bones lying across the body left out
  - how much the upper half moves over a stride: the hip and shoulder
    lines' turn and the shoulders' turn against the hips, the shoulders'
    roll, each hand's fore-aft swing as a share of the stride, each elbow's
    flexion range, the head's bob; flagged under `UPPER` (a trunk that
    reads as carried rather than walked in)
  - `--from` / `--to` narrow the window
- **Kinematics** (`lab/kinematics.js`): where in a stride the motion jumps.
  - per leg, each bone's flexion, angular velocity and angular acceleration
    over the steady cycle (each cycle thin, the mean bold), the leg's measured
    contact across the top, lift-off (solid) and touchdown (dashed) through
    every row
  - the trunk's and the hanging chains' bones the same way, then the tracked
    points' height and fore-aft place in the creature's frame (a jolt to the
    whole trunk shows there)
  - the corners natural.js's smoothness test finds are red ticks;
    `<scenario>-kinematics.json` lists each with its phase and the nearest
    event of its leg, and the CLI prints the commonest places
- **Spacing** (`lab/kinematics.js`): the animator's spacing chart, points
  sampled at `--fps` (30) over the last steady cycle, so the gap between dots
  is the speed.
  - each toe (in the creature's frame and the world's), each leg's middle
    joint, and the tracked points, along their side-view path, with each
    frame's step in cm under it
  - a skip (a frame's step twice the one beside it, over 0.6 cm and a quarter
    of the point's fastest step: a start or stop with no ease, or a jump) is
    red; `<scenario>-spacing.json` lists them
- **Metrics JSON** (`lab/analyze.js`):
  - foot slip while planted
  - ground penetration of soles and joints
  - joint-limit hits, per axis
  - the centre of mass against the support polygon
  - head stability: head bob against withers bob, and head turn
  - duty factor and phase offsets per leg, checked against the creature's
    reference for steady gaits
  - `flags`: one line per finding

  Contact is measured from the geometry: any point of the sole within
  1.2 cm of the ground. It is not taken from the rig's claim. A support
  flag names its worst moment and where each standing foot is from the
  mass, and a body off its feet's support for under 0.06 s is not flagged.
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
    body (set for the deer; a smaller creature's come in by its length and
    height and aim at its middle, so it fills the frame as the deer does). The skin hook's debug views give each pixel its piece, its
    distance from the eye in cm and its normal (`setDebugView('piece' |
    'depth' | 'normal')`, `lab/skin.bk`). Seams are two pieces meeting at
    one depth at an angle of 8 degrees or more; creases are the normal
    jumping between neighbouring pixels by more than it turns either side;
    kinks are inward notches of the outline, skipped where the outline's
    two sides lie more than 8 cm apart in depth (one part in front of
    another, such as legs crossing in view). A crease or kink counts only
    where the skin turns sharper than at rest (the largest angle between
    vertex normals within two edges, posed against rest, by 8 degrees or
    more: `SEAMS.turn`), so the edges a body is made with (an ear's rim,
    the cleft between an ear and the crown) are not faults of the pose.
    Each is measured in cm of line on the body and named by the pieces or
    masses and bone under it. The mesh's broad phase bins triangles in
    cells of four median edges (at most 4 cm); the images are scanned only
    over the body's box.
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
    (mu 1); no flight may gain energy. Each flag says why: the flight and
    pull flags name the bones that held the mass up or carried it down at
    the worst moment (each bone's mass times how its joint moved against
    free fall), and the friction flag gives the push along the creature's
    travel and across it, with what the feet bore then.
  - **Smoothness**: each joint's angular acceleration against its
    neighbours two steps off; a spike is a corner in the joint's speed.
    Kinks a second, per joint and overall, with jerk. Each spike carries the
    foot event (`LF down`, `RH lift`) within three steps of it, or
    `between`, and the flag names where they gather. The root is tested the
    same way, apart from the joints: its place (mm, so a kink of 80 mm/s in
    a step counts as a joint's 80 deg/s) and its turn in the world, since a
    kink there shows in every leg on the ground at once.
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

They are sized to the creature: speeds from its `speeds` (the deer's walk
1.1, trot 3.0, gallop 7.5 m/s and circling 0.9 when it has none), gaze
points and rough ground's amplitude and wavelength by its `scale.height` over
the deer's 0.95 m.

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
galloping on), and the bunny's `sit-up`, `graze-and-bolt` and `hop-about`.

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
- The flock panel swaps the run for a live flock of the A creature
  (`lab/flock-view.js`): the count (25 to 10000), what they do, shadows on or
  off, and a threat sent across (a red post). It steps at the rig's 120 Hz,
  at most four steps a frame, on a checker ground sized to the field.

Headless runs drive the view through `globalThis.creatureLab`
(`setFlock(count, behaviour, shadows)` for the flock).

## Tests

`scripts/validate.sh tools/creature-lab` runs the smoke test and seven tests:

- `tests/test_parts.js`, the skin and the parts seen:
  - a tube of skin about an arm is the arm's own; weighted to the trunk it
    is found, with where the arm comes out of the body
  - a head fixed on a swinging chest is glued, one swinging further
    wobbles, one turned back against it is steadied
  - the strider's limbs are bound in their own skin and its skin is not
    pulled walking or trotting; its parts sheets are clean, its head
    steadied at the walk
  - the watch sheet is drawn for one scenario and one view, and refuses a
    run without a view, two scenarios, or more than six frames
- `tests/test_keys.js`, keys and the strider drawn in them:
  - a pose puts the feet and the root where it draws them; a mirrored pose
    is the pose with its sides exchanged
  - a cycle passes through its keys, its second half the first mirrored,
    with no foot under the ground between them
  - the stand is balanced over its feet; the run's flight has neither down
  - the strider is clean stood, walking, jogging, running, starting and
    stopping, turning on the spot, on slopes and rough ground, foraging,
    resting and startled; its feet stay where they landed
  - it reports a walk and a run, and between a run's steps its mass is in
    free fall
  - the model sheet is written

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
- `tests/test_flock.js`, the flock brain on deer:
  - grazing, they stay slow, on the field, and apart
  - travelling, they move at pace with their headings agreeing
  - fleeing, nobody runs before the threat. After it, the alarm spreads
    beyond those near it, most alarmed 2 s are running away, and some gallop.
  - the neighbour grid lists every creature once, in its own cell

## Adding a creature

1. Copy `creatures/hexa/` (or `deer/`) to `creatures/<name>/` and add
   `creatures/<name>.js`.
2. Write its skeleton with limits, then its body as masses on those bones
   (`hexa/body.js` is one page), then its rig against `creature::contract`.
   For a creature drawn in keys, copy `creatures/strider/`: draw how it
   stands and its poses in `poses.js`, reading `model <name>` after each
   edit, then its cycles; its rig stands them on the ground.
3. Name its steady gaits in `cycles` (with references if known) and its
   broken variants.
4. Look first: `watch <name> walk --view side`, then `--view front`, and
   say what is seen in them before reading any flag.
   Run `sheets <name> all` and `metrics <name> all`, and read the sheets.
   Run `skin <name> walk` (each limb in a skin of its own, nothing pulled)
   and `parts <name>` on a gait and on `idle` (nothing glued, riding or
   wobbling) before judging the motion from whole-body sheets, which are
   too small to show either.
5. Run `finder <name> all` and `natural <name>`: both need only the
   skeleton's feet and tracks (`head` and `withers` for the head measure)
   and the body's masses. Run `form <name>` for each mass's volume in
   motion.
6. Iterate on the rig with the text tools, each a few seconds: `score
   <name>` after an edit; `kinks <name> <scenario>` for where its kinks
   gather; `trace <name> <scenario> --leg <foot>` (or `--bones`) through the
   moment, with `creature::probe` values for what a solver was given; `sweep
   <name> --sweep KNOB=a,b,c` to choose a value; `look <name> <scenario>`
   (and `--pieces`) to see it.
