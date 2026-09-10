# OmniVoice Lab

A playground for [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice), the
600-language masked-diffusion TTS bro exposes as `bro.tts.loadOmniVoice`
(see `bro/docs/tts-api.js` for the binding and `brosoundml/docs/omnivoice.md`
for the model). Where Kokoro Lab drags pitch and energy contours and Qwen TTS
Lab steers an autoregressive sampler, OmniVoice has neither: its output is an
8 × T grid of HiggsAudio codec codes (8 codebooks, 25 frames per second) that
every diffusion step fills in a little more. The lab makes each of *its* seams
tangible.

```
bro demos/omnivoice-lab
bro-headless demos/omnivoice-lab demos/omnivoice-lab/tests/test_smoke.js   # from the broworkshop dir
```

Weights: `../brosoundml/weights/omnivoice` (or `BRO_WEIGHTS`), resolved through
`ai/voice-pipeline/models.js` (group `omnivoice`, from
`huggingface.co/k2-fsa/OmniVoice`); Whisper for transcribing a reference clip
sits beside it in `weights/whisper`. The LM is GPU-only (every step is a full
0.6B forward), so the load is gated on `bro.gpu`; it runs bf16 on CUDA.

## The seams, panel by panel

**Length** (left, *length*). The model has no duration predictor: a rule
weighs the text's characters (and the prompt's transcript against its frame
count) and that decides T before the first step. The readout shows
`estimateFrames` live for the current text + prompt; the **duration** slider
fixes T outright (`frames = seconds × 25`), **speed** divides the estimate.
Tick **per-sentence pacing** (*text* panel) and the text splits into
sentences, each with its own seconds field; ▶ Generate then runs the
long-form chain: sentence N at its own frame count, conditioned on sentence
N−1's output as the prompt (either re-encoded through the codec with
`createPrompt`, or handed over as the codes it already is — the *chain
prompt* picker), the segments concatenated. Segment boundaries are drawn on
the waveform and the grid.

**Token grid** (right, *token grid*). The 8 × T grid of the current take,
colour = code id, on the same time axis as the waveform above it. Row q0 is
the semantic codebook (it unmasks first, by the layer penalty), q1–q7 the
acoustic ones. Drag across the grid (or the waveform) to select a span, tick
the codebooks a re-roll may touch, set a seed, and:

- **↻ acoustics** — keep codebook 0 everywhere, re-mask 1..7: same words,
  new acoustics.
- **↻ span** — keep everything but the selected span on the ticked codebooks,
  and regenerate that: inpaint one word.
- **↻ around span** — keep only the selected span, regenerate everything
  else around it.

Each re-roll builds an `init` grid (`tokens` = the take's codes, `keep` = 1
outside the mask) and calls `generateCodes` at the same T, decodes with
`decodeCodes`, and lands as a new take. The masked region is outlined in
yellow; with **show changes** on, masked cells that came back the same are
dimmed so the changed ones stand out, and the note reports how many changed
and confirms nothing outside the mask did. The same seed over the same init
grid reproduces a re-roll exactly. Hover any cell for its code, the step it
committed at, its commit score, and whether it changed. **▶ span** plays the
selection.

**Schedule & sampling** (left). `numSteps`, `tShift` (the schedule warp:
small values commit few cells early and most at the end), `guidanceScale`
(0 = conditional row only, half the work), `positionTemperature` (noise on
the unmask *order*), `classTemperature` (> 0 samples each code from its
top-10 %), `layerPenalty` (how strongly lower codebooks go first), gumbel
noise on/off, and the seed (locked = reused across takes, else a fresh one
per take). While a generation runs, the **unmask order** card fills in live
from `onStep` (colour = step index; grey = kept by an init grid); once it
lands, the card shows the trace's `unmaskStep` grid with the mean commit step
per codebook. The **schedule** card draws cells committed per step (the
t-shift warp's shape) and the mean commit score of those cells, plus the LM /
codec / wall timings.

**Commit confidence** is the model's *raw* confidence at each cell at the step
it committed: `step.confidence`, the maximum CFG log-probability there, before
the layer penalty and before the position-temperature Gumbel noise. That is
deliberately not `step.scores` — a score is the raw confidence minus
`codebook x layerPenalty` and then noised, so scores live on a different scale
in every row and are `-Infinity` at every already-fixed cell; the card used to
normalise per codebook to hide that, which made every row look equally
uncertain by construction. The raw confidence is comparable across the whole
grid, so the card uses one global colour scale (red = hedged, green = sure),
prints its range and its mean per codebook, and shows the exact log-prob on
hover. The hedged (red) cells are where a re-roll roams.

**Voice** (left). The **bank** holds prompts; the active one (click to
toggle) is passed as `opts.prompt`, none = the model picks a voice. Make one
from a **clip** (📁 picks a file, ✎ transcribe runs Whisper into the
transcript box, ＋ prompt from clip encodes it with `createPrompt`), from any
take (**◉ voice** on the take strip: the take's audio + its text), or from a
saved `.ovcp` (⤒). Each entry can be renamed and saved (⤓ .ovcp). **denoise**
prepends the denoise token when a prompt is present. **design** picks at most
one value per `instructAttributes()` category and shows the assembled
instruct string; **language** filters the 600+ names from `languages()`,
with None for language-agnostic.

**Text** (left). The text box, one chip per `nonverbalTags()` entry (they
tokenize standalone, so they can sit anywhere), reminders for CMU phonemes in
square brackets and pinyin with tone digits, and the tokenizer's id count.

**Takes** (right, bottom). Every generation becomes a take: waveform
thumbnail, frames / seconds / steps / seed / voice, ▶ play, ⤓ wav (native
save dialog, 16-bit PCM), ◉ voice, ⊞ grid (load it into the grid — re-rolls
start from whatever is in the grid), ✕.

## Generate vs Pipeline

**▶ Generate** is the grid-exact path: `generateCodes` at the shown frame
count, then `decodeCodes` — the waveform is exactly T × 960 samples, aligned
to the grid, no post-processing. **▶ Pipeline** is `synthesize()` with
everything upstream does: the duration rule, chunking at punctuation with
cross-fades past 30 s, silence trim, loudness match, fade + pad. Its grid comes
from the trace and its audio is post-processed, so frame ↔ sample alignment is
approximate on those takes (the audio card says so).

## Files

```
app.js            wire the DOM up, load the model
lib/state.js      shared state + constants (and the module map)
lib/model.js      model-dir resolution, the GPU gate, the async load
lib/voice.js      prompt bank, clip -> prompt, Whisper, instruct pickers, languages
lib/text.js       text box, tag chips, tokenizer preview, sentence rows
lib/schedule.js   length knobs + the diffusion dials
lib/synth.js      generate / pipeline / chain + the onStep recorder
lib/edit.js       re-roll through generateCodes' init grid
lib/grid.js       grid selection, codebook ticks, the re-roll tools, mouse
lib/render.js     the cards: waveform, grid, unmask order, schedule, confidence
lib/takes.js      the take strip
lib/audio.js      clip publish / play / span / WAV export
tests/test_smoke.js   headless: load, generate, re-roll a span (only the span changes), chain, voice from a take, pipeline
tests/test_interaction.js   headless, through input injection: hover readout, drag-select on the grid and the waveform,
                      codebook ticks + shortcuts, ↻ span from the button + typed seed, ■ Stop mid-run, the take strip's ▶ ◉ ⊞ ✕
```
