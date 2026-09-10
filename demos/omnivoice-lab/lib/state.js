// OmniVoice Lab — a playground for the seams of a masked-diffusion TTS.
//
// OmniVoice (k2-fsa) has no F0 / energy / per-phoneme prosody surface (that
// was Kokoro's seam) and no autoregressive sampling loop to steer (Qwen3-TTS's).
// Its output is an 8 x T grid of HiggsAudio codec codes that every diffusion
// step fills in a little more; the lab makes each of ITS seams tangible:
//
//   LENGTH     the frame count is decided up front by a rule (the model has no
//              duration predictor): the estimate for the text + prompt, a fixed
//              duration, a speed divisor, and per-sentence pacing through the
//              long-form chain (segment N's output becomes segment N+1's prompt).
//   GRID       the 8 x T token grid, aligned under the waveform. Drag a time
//              span, tick codebooks, and RE-ROLL: an init grid keeps everything
//              outside the selection and re-masks the rest — inpainting.
//   SCHEDULE   steps, t-shift warp, guidance, position / class temperature,
//              layer penalty, gumbel noise, seed; onStep animates the unmask
//              order live and the trace's unmask-step grid + per-cell commit
//              confidence show where the model was sure.
//   VOICE      a prompt bank (reference clip + transcript via Whisper, or any
//              take's output as the voice, .ovcp save/load), voice design from
//              the instruct vocabulary, and the 600-language picker.
//   TEXT       tags that tokenize standalone, phoneme / pinyin notes, the
//              tokenizer's id count.
//   TAKES      every generation is a take: play, save, use as voice, load into
//              the grid.
//
// Modules (ES, imported by absolute /app/ path):
//   state.js     this file — shared state + constants
//   helpers.js   el / fs / dialogs / small math + string helpers, setBadge
//   model.js     model-dir resolution (ai/voice-pipeline/models.js), the GPU
//                gate, the async load, vocabulary hand-off to the panels
//   voice.js     prompt bank, clip -> prompt (Whisper transcript), instruct
//                pickers, language picker
//   text.js      the text box, tag chips, tokenizer preview, sentence rows
//   schedule.js  length knobs (duration / speed / estimate) + diffusion dials
//   synth.js     generate (grid-exact) · pipeline (synthesize) · chain
//   edit.js      re-roll: init grid from the selection, presets, change mask
//   grid.js      the 8 x T grid canvas: draw, hover, drag-select, codebook ticks
//   render.js    the cards: waveform, grid, unmask heatmap, steps, confidence
//   takes.js     the take strip
//   audio.js     clip publish / play / stop / WAV export
//   app.js       wire the DOM up and kick off the load

export const $ = (s) => document.querySelector(s);

// Codec geometry (mirrored from omni.config once loaded; these are the OmniVoice constants).
export const FPS = 25;            // frames per second
export const SR = 24000;          // codec sample rate
export const NQ = 8;              // codebooks
export const MASK = 1024;         // config.maskId
export const SPF = SR / FPS;      // samples per frame (960)

// The loaded model handle (bro.tts.OmniVoice) — set by model.js's onReady.
export let omni = null;
export function setOmni(v) { omni = v; }

// One async op at a time (the model is single-owner); synth/edit set this.
export let busy = false;
export function setBusy(v) { busy = !!v; }

// The take shown in the grid / waveform / heatmaps.
export let current = null;
export function setCurrent(v) { current = v; }

// Every generation, oldest first. A take:
//   { id, kind, name, text, codes: Int32Array(NQ*T), numFrames, samples,
//     sampleRate, unmaskStep: Int32Array|null, commitScore: Float32Array|null,
//     commitConfidence: Float32Array|null (the raw max log-prob, no penalty/noise),
//     stepStats: [{unmasked, meanScore}], params, promptName, changed: Uint8Array|null,
//     masked: Uint8Array|null, parentId, segments: [{text, frames}]|null,
//     lmSeconds, codecSeconds, wallMs, exact }
export const takes = [];
let nextId = 1;
export function takeId() { return nextId++; }
