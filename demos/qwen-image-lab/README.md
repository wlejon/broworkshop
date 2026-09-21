# Qwen-Image Lab

Every control surface [qwen-image-research](../../../qwen-image-research) found
in **Qwen-Image 2.1**, as a bro app: a 7.1B single-stream flow-matching DiT
(hidden 4096, 32 blocks) conditioned on Qwen3-VL-8B rows and decoded by a 16×
RGBA autoencoder, driven through brodiffusion's `qwenImage21*` research hooks.

```
CUDA_VISIBLE_DEVICES=0 D:/projects/bro/build/Release/bro.exe demos/qwen-image-lab
```

The model directory defaults to `D:/projects/brodiffusion/weights/qwen-image-2.1`
and loads INT8 (DiT **and** text encoder, ~17 GiB resident — BF16 does not fit
1024² on 24 GB). Loading takes about 38 s. A 512²/8 render is ~1.5 s, 1024²/40
about 28 s.

There is **no CFG** (`guidanceScale` 1.0 is the reference recipe) and therefore
no negative prompt. What the prompt does not say, the axes and the desk do.

## The panels

The left rail holds nine sections — **scene · axes · mint · desk · sched ·
gate · spatial · tune · prefix** — and the deck at its foot. The main area has
six tabs: **Render**, **Gate Paint**, **Spatial**, **Schedule**, **Explore**
and **Signals**. A control lives in exactly one section; a tab is where you
paint on, draw on or look at what the controls did.

### scene
Prompt, seed, size and steps, with the two configurations the research settled
on as one-click presets: **explore · 512²/8**, where the desk is calibrated and
a render costs a second and a half, and **final · 1024²/40**, the model's own
recipe. A desk fitted at 8 steps keeps 98% of its travel at 1024²/8 and about
65% at 40 steps — the break is step count, not resolution — so `1024² / 8` is
the third chip.

Below that, **condition images**: the edit path. Add a file by path or by
browsing, or click *use current render* to feed the canvas back in. Each image
enters the model twice — through the vision tower, which fills the chat
template's `<|image_pad|>` rows so the prompt is *about* the picture, and
through the 16× autoencoder, whose latents join the joint sequence and carry
the pixels. With *derive the canvas* ticked, width/height are omitted and the
canvas comes from the last image's aspect at `outputResolution`.

Controls call `generate`/`prime` with `conditionImages` and `outputResolution`
(worker: `qwenImage21PrimeEdit`). A condition image costs about 0.24 s/step
extra at 512² — the vision tower plus a longer prefix.

### axes
The 88 minted directions of `assets/axes_qi21_v2.bcd1` (12 neutral scene stems ×
2 phrasings a pole, diff of means, bank scale 0.15 × the mean token norm =
121.256), one slider each, grouped by the category in the name and filtered by
a search box because 88 sliders is a list, not a panel.

**These carry the authority.** The best minted axis moves its readout 25σ where
the best in-network dial manages 4.4σ. Each is added to every token row of the
positive conditioning at `prime()` time, so the model sees the *sum* of the
rack: the **stack budget** slider is `setControlBudget()`, and over budget every
active axis is scaled by one common factor so the mix survives and only the
overdrive is shed. The deck's meter reads `controlNorm()` back from the render.

Controls call `loadControlDictionary` (once, at load), `setControl` (per render,
from scratch) and `setControlBudget`.

### mint
Mint a new axis from words, live, without leaving the app — the v2 recipe of
`qwen-image-research/scripts/60_mint_v2.js` run on what you type.

Give it a **prompt pair** (`lit by warm brass lamplight` / `lit by cold blue
moonlight`) or a prompt plus a **suffix list**, and it encodes each pole across
12 neutral scene stems × 1–2 phrasings, pools each encode's rows, takes the
per-(stem, phrasing) pole difference, zeroes the attention-sink dimensions
(energy above 50× the uniform share — a handful of dimensions that carry a
tenth of the norm and mean nothing directional), averages, and normalises. The
bank's scale convention is kept: `0.15 × the mean token norm`, which is where
the shipped bank's 121.256 comes from.

The panel prints the **consistency** — the mean pairwise cosine of those
per-stem differences, before and after sink suppression — which is the number
that says whether the axis means the same thing across scenes, and an
**inspector** decomposing the new direction against the 88 registered ones, so
"I have just re-minted `light.key`" is visible before it is rendered.

An image mint does the same against the vision tower: `EncodePromptImages`
rows for the condition images, minus the text rows of the same prompt.

A minted axis is registered with `setControlVector`, which is a *runtime* axis —
`loadControlDictionary` is bank-level and drops them, so the directions are
persisted as base64 and carried back in the load message on every reload. They
drive exactly like bank axes: same slider, same deck chip, same stack budget.

### desk
`assets/controller.json` — the fitted faders. Each is a direction in the
scheduled knob-parameter space (round 3: 8 faders over 42 knobs carrying 29+
scheduled parameters), derived by ridge against 27 CLIP/pixel readouts. A
slider of 1.0 means *move this axis by `tau × gainCal` sigmas of its own readout
and leave the other target axes alone*; the safe range is ±2.

`gainCal` is the box redrawn **by render**: per fader, the largest amplitude
whose ±2 renders still hold their subject. Travel is not monotone in amplitude
past that edge — push harder and the picture swaps rather than the axis moving,
and the CLIP probes that certified the old desk could not see it happen.

The panel prints what each non-zero fader is spending (its top knobs by
coefficient) and a **retention meter**: a structural-similarity proxy over 8×8
luma blocks against the untouched render, with round 3's 0.71 bar marked. A
render with every fader at zero is adopted as the baseline automatically;
*pin baseline* overrides it.

The worker ports `lib/{controller,sched,dials,hooks}.js`: fader positions →
clamped parameter vector (with `gainCal` and the transfer correction) → the
normalised dial vector at step *i* over the early/mid/late basis → hook specs,
re-issued per step. `assets/controller_round2.json` ships alongside for
comparison; point `ui/model.js`'s `CONTROLLER` at it to load the 17-knob desk
instead.

**Prompt-conditioned** is the toggle at the foot of the panel — round 3's
`prompt` block. Round 2's diagnosis was that a fader's per-image inconsistency
is a shortfall of scene knowledge and that no per-image gain fixes it: the
forward model has no scene input and structurally cannot know which picture it
is standing in front of. This gives it one. The prompt's own conditioning rows
are pooled to 4099 numbers, projected to an 8-dimensional `p`, and `p` indexes
a Jacobian `J(p) = W₀ + Σ pⱼWⱼ` that the fader directions are re-derived from
by the same regularised right pseudo-inverse the global desk was fitted with.

One encode and one matrix product — 57 ms, no render. The fader *positions* do
not change; where each fader points does, so the panel prints the drift: the
cosine between the conditioned direction and the global one and how much longer
it got. Measured on this file: cos 0.61–0.83 on a cottage by a lake, 0.37–0.71
on a neon night market, with the conditioned directions two to three times
longer. At the same slider position the two desks render 274 mse apart.

### sched
A curve per armed control, steps on x — see the **Schedule** tab. Every armed
control gets a lane and every lane is one coefficient per step, drawn with the
mouse, set per step by number, or filled from a preset (early / late / ramp /
fall / middle / off). A curve is a *shape*: change the step count and it
resamples rather than truncating.

Three lane kinds reach the model three different ways:

- **axis** → `qwenImage21AddControlSchedule(axis, alpha[], lo, hi)` with
  `alpha[i] = value × curve[i]`. The axis is then taken **out** of the
  prime-time stack, because a schedule composes with `setControl` and leaving
  it in both counts it twice.
- **desk** → the fader is scaled per step *before* the parameter vector is
  built, which is not the same as scaling one knob late: a fader is a direction
  through the knob space.
- **hook** (gate multipliers, gate delta, mod delta, norm_out, prefix K/V) →
  the step loop re-issues the control scaled away from its own neutral, so a
  curve at 0 means "off at this step" whether that neutral is 0 or 1.

Measured at 8 steps, 512²: `light.key` at +2 is worth mse 542.9 unscheduled,
528.8 armed over the first third and **4.2** over the last — a conditioning
axis is an early instrument, and once the composition has settled there is
almost nothing left for it to aim. The `attn · img` multiplier leans early too
but only three to one (388.5 vs 132.1), because it is a per-token dial on the
residual rather than an instruction about what to draw. That asymmetry is what
the timeline exists to show.

### gate
The post-tanh residual gates.

- **Four multipliers**, one per (sublayer, row set) pair —
  `qwenImage21SetGateScaleRows` / `AddGateScaleRows`. `attn · img` is the most
  useful dial on the model and the only surface that still works armed at step 6
  of 8 (127% of its step-0 effect). The `txt` multipliers are prefix-side:
  moving one drops the prefix K/V cache and costs a re-extract (+13% on that
  step). The `img` ones cost nothing.
- **Block band**, half-open `[lo, hi)` over the 32 blocks.
- **Gate delta** — `qwenImage21SetGateDelta`, a post-tanh *add*. A modulation
  delta lands before the tanh, where 74% of the `gate2` channels sit with
  tanh′ < 0.05; this one has unit authority on every channel, and a gate above 1
  is not reachable any other way.
- **Mask brush** — `qwenImage21AddGateMask`, painted in the **Gate Paint** tab.
  One mask row per 16×16 px; the joint order is text rows first, then image
  tokens row-major. Measured here: a stroke covering 78 of 1024 tokens changes
  its own region **17× more** than the frame's border. Defaults are the screened
  ones — blocks `[16, 32)`, armed at step 4 of 8, on the `attn` sublayer, since
  the MLP half is what drags a late edit's retention from over 100% down to
  about 30%. The arm step is a registered control: it goes into the manifest,
  the Explore grid can sweep it, and clicking an x̂0 thumbnail sets it.

### spatial
Several painted regions at once, each with its own settings, in one denoise —
the **Spatial** tab. Capture a base render, add a region, paint it, and give it
a gate multiplier, a block band, a sublayer, an arm step, a feather and
optionally an axis of its own. A cell belongs to one region: painting into it
takes it off the others, or two masks would multiply on the same token.

A region carries two kinds of instruction and they cost differently.

- its **gate multiplier** is a per-token mask, the model's only spatial hook.
  The binding keeps a list, so N regions are N masks in **one** render. Two
  regions pulling opposite ways change their own bands by 14.5 and 12.4 while
  the gap between them moves 5.8 — at no extra pass.
- its **axis** is conditioning, which is global by construction: an axis is
  added to every token row, so "this axis, but only here" cannot be one
  forward. The worker primes a second state from the same seed, steps it in
  lockstep, and blends its latent back under the region's feathered weight
  after every step, so the join happens inside the denoiser rather than between
  two finished pictures. That is a real second pass — measured at 1.78× the
  render time — and the panel says so before you press it.

### tune
- **Modulation delta** — `qwenImage21AddModDelta`, four chunk fractions
  (`scale1`, `gate1`, `scale2`, `gate2`) over a block band, on the target rows
  (free per step), the prefix rows (re-extracts) or both. Specified as a
  *fraction* of that chunk's own value at the current step, because the chunk
  norms run 21 to 189 and an absolute add would mean four different things in
  four places. 97% of its authority is spent by step 2 — but a knob armed late
  is a *different* knob, not a weaker one (`cos(early, late)` is between −0.13
  and +0.08 for five of the six schedulable knobs).
- **norm_out scale** — `qwenImage21SetNormOutScaleDelta`, one knob on output
  magnitude.
- **Prefix K/V** — `qwenImage21AddPrefixKvScale`. The one prefix-side hook that
  needs no re-extraction: a dial applied where the cached K/V are read, so it is
  free mid-denoise and survives a cache reset. Attenuating V fades the prompt's
  contribution while leaving the attention pattern it induces intact; K alone
  flattens that pattern instead.

### prefix
Slots for the extracted prefix K/V — a prompt frozen *below* the text encoder.

From step 1 onward the extracted prefix **is** the conditioning: the rows are
not recomputed, so what the image attends to is the cache. *Save prefix* primes
this prompt, takes the one step that extracts it, and deep-copies the result
into a slot (`qwenImage21SavePrefixCache`, ~0.24 s). Two sliders then blend the
live cache towards slot A and then towards slot B (`BlendPrefixCache` is
one-sided — `live ← (1−a)·live + a·slot` — so A at 1.0 followed by B at *t* is
exactly the A→B position, and A alone is the prompt-A-cache / prompt-B-target
experiment: prime with B, attend to A).

Both caches must describe the same **layout** — same prefix length, same target
grid, same layer count — so a blend needs two prompts that tokenize to the same
length *and* a render at the size the slot was taken at. The cards print both
and turn amber when the scene is rendering somewhere else; the walk strip
follows the slots rather than the scene for the same reason.

How far a swap moves the picture depends on the step count, because the blend
lands after step 0 and step 0 is what settles the composition. Measured at
512²: at 4 steps the swap is worth mse 5 against a prompt-to-prompt distance of
1119, at 8 steps 93, at 20 steps 367 of 1972. It is the one dial in this lab
that gets *stronger* the longer the run.

What re-extracts and what is free: the **text** half of the prefix is rebuilt
whenever the conditioning rows change — a txt gate multiplier, a gate mask, an
edited row, a control-schedule alpha that moved — and costs one prefill (+13%
on that step). The **image** half of a mask, the prefix-K/V dial and a slot
blend are read where the cache is *used*, so they are free mid-denoise and
survive every re-extract.

### the deck
Pinned at the rail's foot: one chip per non-neutral control across every
section. Click a chip to jump to its control, `×` to return it to neutral,
*reset all* to neutralise everything in one render. The axis stack meter sits
under it. This is the "what is shaping this image" view a rack of 100 sliders
otherwise loses.

### render
The canvas (wheel to zoom, drag to pan, double-click for 1:1), the history rail
and **A / B** — one click swaps the canvas to the pinned baseline and prints
the pixel MSE and retention between them.

*save all* writes every image in the history plus a **manifest**: for each
render, every control by the key it is driven by (all 111 of them, including
the ones at neutral — a rack is what was *not* armed too), the curves beside
them, and the message the worker was actually sent, verbatim, minus the
megabyte-scale payloads. 9.3 KB for three renders. *load…* puts the last
render's rack back: clear everything, load the manifest, press Generate, and
the picture returns to the pixel.

### explore
The **Explore** tab: an N×M grid over two chosen controls, or a 1-D walk along
one. Every cell is the message *Generate* would send with one or two values
overridden and the size cut down, which is what makes "click to adopt" honest —
adopting a frame and rendering it the ordinary way reproduces it exactly.

Any registered control is offerable, armed ones first — including the mask's
**arm step**, so *fader × the step its mask lands on* is a grid. Painted cells
are token grids captured at the render size, so they ride along only when the
grid is rendered at that size; at any other the panel says it left them out
rather than quietly rendering something else.

The walk carries the retention meter per frame against the first, with round
3's **0.71** collapse line marked. `light.key` swept 0 → +8 reads 1.000, 0.810,
0.641, 0.481: the last two are no longer the same picture, which is the failure
mode the CLIP probes that certified the round-2 desk could not see.

### signals
The **Signals** tab — what the render did, read off the model.

- **x̂0 preview.** The flow-match Euler step is exact, so two consecutive
  latents recover the velocity and with it the clean image that step committed
  to: `k = σᵢ/(σᵢ₊₁−σᵢ)`, `x̂0 = xᵢ − k·(xᵢ₊₁−xᵢ)`. Decoded at chosen steps
  (or spread automatically) into a thumbnail strip, which answers *when* an
  edit lands. At the last step σ is zero, k is −1 and the estimate is exactly
  the final latent — the last thumbnail is the render itself, to the pixel.
  Only the VAE decodes cost anything: 276 ms for four at 512². Click a
  thumbnail to arm the selected control — the gate brush, or any spatial
  region — at that step.
- **Gate capture.** `qwenImage21CaptureGates` fills two sinks, the mean
  effective attention gate and the mean effective SwiGLU gate per (block, row),
  folded through every armed scale, post-tanh delta and mask. Four strips of 32
  blocks: each sublayer against each row class. An `attn · img` multiplier of
  0.5 over blocks [16, 32) reads back at exactly ×0.500 there, ×1.000 below the
  band, ×1.000 on the text rows and ×1.000 on the SwiGLU strip. The legend also
  prints the *lowest single image row*, because a brush over 60 of 1024 tokens
  moves the mean by 3.5% and the minimum to ×0.400. With nothing armed all 32
  blocks report one number — one modulation vector drives the whole stack, so
  the strip is a picture of what an armed hook did, not of per-block structure.

## Running the tests

```
cd D:/projects/broworkshop/demos/qwen-image-lab
CUDA_VISIBLE_DEVICES=0 D:/projects/bro/build/Release/bro-headless.exe . tests/<test>.js
```

`bro-headless`'s global `assert` **logs and continues**; the process exits
non-zero at the end. Read the log, or `grep -c "ASSERTION FAILED"`.

| test | what it proves | model? |
| --- | --- | --- |
| `test_ui.js` | every panel mounts, every control builds, the deck chips and section badges track, the presets drive size and steps | no |
| `test_generate.js` | a 512²/4 render through the actual UI; the bank and the desk build from the load response | yes |
| `test_axes.js` | the same settings reproduce a render exactly (mse 0), a bank axis at ±2 moves it (mse 182 / 290), a desk fader moves it (mse 109), and zeroing either restores the baseline to the pixel | yes |
| `test_edit.js` | both condition-image routes (canvas pixels, typed path) reach the model, the derived canvas works, and removing the image reproduces the text-only render exactly | yes |
| `test_gate.js` | the brush paints a region, the mask localises (inside 9.3 against a border of 0.55), and the sublayer selector changes the render | yes |
| `test_release_te.js` | releasing the encoder frees 8.3 GB, a memoized prompt still primes, an unseen one is refused by name, and the reload restores it | yes |
| `test_mint.js` | an axis minted from typed words clears the consistency bar, lands on the bank's own scale, drives like a bank axis, zeroes back to the pixel, survives a bank reload, and comes off cleanly — plus an image mint through the vision tower and a suffix-list mint | yes |
| `test_prefix.js` | two prompts of equal token length, a slot each; the blend moves the render towards the prompt the cache came from with no re-encode, a zero blend is a no-op to the pixel, and the walk strip renders A→B at the slots' size | yes |
| `test_schedule.js` | all three lane kinds reach the model; an axis armed late is worth 4.2 against 528.8 armed early, a gate multiplier 132 against 388; every lane zeroed returns to the untouched render to the pixel; a curve resamples with the step count | yes |
| `test_spatial.js` | two gate regions in one pass hold their own bands (14.5 / 12.4) with the gap between them at 5.8; a per-region axis lands 2.6× harder in its own band at 1.78× the render time; feather is felt at the seam | yes |
| `test_x0.js` | the last thumbnail is the finished render at mse 0.000000, the preview disturbs nothing, the estimates close monotonically (1417 → 508 → 309 → 178 → 0), and a click arms the chosen control at that step | yes |
| `test_explore.js` | a 2×2 grid over an axis and a gate, a second over a painted mask's arm step and an axis, adoption that reproduces the thumbnail at mse 0.000000, and a walk crossing the 0.71 bar between +2.67 and +5.33 | yes |
| `test_capture.js` | an armed hook reads back on the blocks, sublayer and row class it named and nowhere else (×0.500 / ×1.000 / ×1.000 / ×1.000), on both sublayers; a brush shows up in the minimum long before the mean | yes |
| `test_conditioned.js` | conditioning costs 57 ms and re-aims every fader (cos 0.61–0.83 on one prompt, 0.37–0.71 on another), two prompts give two desks, the same prompt gives the same one, and at zero the render is untouched | yes |
| `test_history.js` | the manifest records 111 controls, the curves and the worker's own message in 9.3 KB, and loading it back reproduces the render to the pixel | yes |

Budget about 40 s for the model load in every test that needs one.

## Layout

```
bro.json                  the app manifest
index.html                the DOM contract every module addresses
style.css
app.js                    the shared ctx: state, persist, buildGenerateMsg, the render loop
ui/util.js                $, the geometry constants, MSE / SSIM-proxy, image helpers
ui/store.js               one localStorage blob
ui/client.js              the worker client — one request at a time, queued FIFO
ui/controls.js            buildCtl / refreshDeck / switchSection — the control framework
ui/model.js               load, unload, release the text encoder, the VRAM overlay
ui/scene.js               size presets and the condition-image slots
ui/axes.js                the 88-axis bank and the stack budget
ui/desk.js                controller.json's faders, the travel readout, the retention meter
ui/mint.js                minting an axis from words, and the direction inspector
ui/gate.js                the four multipliers, the gate delta, and the mask brush
ui/schedule.js            the timeline: a curve per armed control
ui/spatial.js             painted regions, each with its own settings
ui/tune.js                the modulation delta, norm_out, and the prefix-K/V dial
ui/prefix.js              prefix-cache slots, the blend sliders, the walk strip
ui/signals.js             the x̂0 strip and the gate-capture heat strips
ui/explore.js             the N×M grid and the 1-D walk with the retention meter
ui/render.js              the canvas viewport, history, save, A/B
ui/manifest.js            save-all with a manifest, and loading one back
lab/qwen-image-worker.js  the protocol, the model lifecycle, and dispatch
lab/worker-desk.js        controller.json → faders → parameter vector → dials
lab/worker-conditioned.js round 3's prompt block: pool, project, pseudo-invert
lab/worker-hooks.js       hook tensors, masks, schedules, x̂0, latent blending
lab/worker-mint.js        the v2 mint recipe, sink suppression, registration
lab/worker-render.js      the step loop that carries every surface at once
assets/axes_qi21_v2.bcd1  88 minted axes  (copied from qwen-image-research)
assets/controller.json    the round-3 desk   (copied from qwen-image-research)
assets/controller_round2.json  the round-2 desk, for comparison
```

Every generation runs one manual `prime`/`stepOnce` loop in the worker, and it
has to be manual: the modulation delta is a fraction of the model's own vector
and is rebuilt against `qwenImage21TimeMod(t)` every step, the desk re-issues
its scheduled knobs per step, the schedule editor's lanes re-aim the other
hooks per step, each painted region arms at its own step, the x̂0 preview reads
the latent either side of a step, and a region carrying its own axes needs a
second state stepped in lockstep with the first. Hooks are re-issued only when
their value actually moved — calling `SetGateScale` with the same numbers twice
would pay for a prefix re-extract and buy nothing.

The worker is ES modules, split by what it owns rather than by size; `import`
from `/app/...` resolves inside a worker in this host, and `require` still
works there too (the manifest loader is how `fs` and the native pipeline are
reached).
