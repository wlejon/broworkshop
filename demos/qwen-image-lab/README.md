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
re-issued per step. The prompt-conditioned path (round 3's `prompt` block) is
**not** ported — the global `virtual` desk is what a file carries for every
prompt, and re-deriving per prompt needs an encode and a pseudo-inverse.
`assets/controller_round2.json` ships alongside for comparison; point
`ui/model.js`'s `CONTROLLER` at it to load the 17-knob desk instead.

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
  about 30%.

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

### the deck
Pinned at the rail's foot: one chip per non-neutral control across every
section. Click a chip to jump to its control, `×` to return it to neutral,
*reset all* to neutralise everything in one render. The axis stack meter sits
under it. This is the "what is shaping this image" view a rack of 100 sliders
otherwise loses.

### render
The canvas (wheel to zoom, drag to pan, double-click for 1:1), the history rail
with per-render and *save all* PNG export, and **A / B** — one click swaps the
canvas to the pinned baseline and prints the pixel MSE and retention between
them.

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
ui/gate.js                the four multipliers, the gate delta, and the mask brush
ui/tune.js                the modulation delta, norm_out, and the prefix-K/V dial
ui/render.js              the canvas viewport, history, save, A/B
lab/qwen-image-worker.js  the native pipeline, the desk port, and the step loop
assets/axes_qi21_v2.bcd1  88 minted axes  (copied from qwen-image-research)
assets/controller.json    the round-3 desk   (copied from qwen-image-research)
assets/controller_round2.json  the round-2 desk, for comparison
```

Every generation runs one manual `prime`/`stepOnce` loop in the worker: the
modulation delta has to be rebuilt against `qwenImage21TimeMod(t)` every step,
the desk re-issues its scheduled knobs per step, and the mask arms at its own
step. Hooks are re-issued only when their value actually moved — calling
`SetGateScale` with the same numbers twice would pay for a prefix re-extract and
buy nothing.
