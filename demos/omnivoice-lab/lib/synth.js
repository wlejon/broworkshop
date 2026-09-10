// ═══ synth — generate (grid-exact) · pipeline (synthesize) · chain (per sentence)
//
// Three ways to make a take, all through the one single-owner model:
//   generate  generateCodes at an exact frame count, then decodeCodes: the raw
//             codec render of the grid, so the waveform is aligned to the frames
//             sample-for-sample (T × 960). The lab's default path — every
//             re-roll starts from a take made this way.
//   pipeline  synthesize(): the duration rule, long-text chunking + cross-fade,
//             silence trim, loudness match, fade + pad. The grid comes from the
//             trace; the audio is post-processed, so frame ↔ sample alignment is
//             approximate on this kind of take.
//   chain     per-sentence pacing: each sentence at its own frame count, segment
//             N's output as segment N+1's prompt (the long-form chaining rule),
//             concatenated.
// onStep feeds a recorder that notes, per cell, the step it committed at and
// the score it committed with, and animates the unmask heatmap live.
import { $, omni, busy, setBusy, NQ, MASK, SR, FPS, SPF } from "/app/lib/state.js";
import { setBadge, concatF32 } from "/app/lib/helpers.js";
import { currentCond, activePrompt } from "/app/lib/voice.js";
import { currentText, chainOn, sentenceRows, splitSentences } from "/app/lib/text.js";
import { currentParams, lengthOpts, frameTarget, nextSeed } from "/app/lib/schedule.js";
import { mkTake, addTake } from "/app/lib/takes.js";
import { beginLive, liveStep, liveDone } from "/app/lib/render.js";
import { stop as stopAudio } from "/app/lib/audio.js";

export let inflight = null;       // the AsyncHandle in flight (for cancel)
let cancelled = false;

// ── op bookkeeping ───────────────────────────────────────────────────────────
export function startOp(label) {
  setBusy(true); cancelled = false;
  $('#btn-generate').disabled = true; $('#btn-pipeline').disabled = true; $('#btn-stop').disabled = false;
  $('#run-meta').textContent = label;
}
export function endOp() {
  inflight = null; setBusy(false);
  const ok = !!omni;
  $('#btn-generate').disabled = !ok; $('#btn-pipeline').disabled = !ok; $('#btn-stop').disabled = true;
}
export function setInflight(h) { inflight = h; }
export function cancel() {
  cancelled = true;
  if (inflight) { try { inflight.cancel(); } catch (e) {} }
  stopAudio();
}

// The conditioning + params every call shares.
export function baseOpts() {
  const cond = currentCond();
  const o = Object.assign({}, currentParams());
  if (cond.prompt) o.prompt = cond.prompt;
  if (cond.language) o.language = cond.language;
  if (cond.instruct) o.instruct = cond.instruct;
  o.denoise = cond.denoise;
  return o;
}
// The plain-data snapshot a take keeps (no functions, no prompt object).
export function snapshotParams(o) {
  const keep = ['numSteps', 'tShift', 'guidanceScale', 'positionTemperature', 'classTemperature',
                'layerPenalty', 'gumbelNoise', 'seed', 'language', 'instruct', 'denoise', 'frames', 'duration', 'speed'];
  const s = {};
  for (const k of keep) if (o[k] !== undefined) s[k] = o[k];
  return s;
}

// ── the step recorder ────────────────────────────────────────────────────────
// One segment per chunk (synthesize restarts `step` at 0 per chunk; generateCodes
// is one chunk). Per cell: the step it committed at, the score it committed
// with (this step's unmask score, the value top-k ranked). `keep` marks init
// cells, which never commit (they report -1 like the trace).
export function makeRecorder(keep) {
  const rec = { segs: [], cur: null, keep: keep || null, calls: 0 };
  rec.onStep = (s) => {
    rec.calls++;
    if (!rec.cur || s.step === 0) {
      const n = s.numCodebooks * s.numFrames;
      rec.cur = { T: s.numFrames, NQ: s.numCodebooks, numSteps: s.numSteps,
                  unmask: new Int32Array(n).fill(-1), score: new Float32Array(n).fill(NaN), stats: [] };
      rec.segs.push(rec.cur);
    }
    const c = rec.cur, tok = s.tokens, sc = s.scores, n = tok.length;
    let sum = 0, cnt = 0, masked = 0;
    for (let i = 0; i < n; i++) {
      if (tok[i] === MASK) { masked++; continue; }
      if (c.unmask[i] >= 0) continue;
      if (rec.keep && rec.segs.length === 1 && rec.keep[i]) continue;   // an init cell, never committed
      c.unmask[i] = s.step;
      const v = sc[i];
      c.score[i] = (v === v && isFinite(v)) ? v : 0;
      sum += c.score[i]; cnt++;
    }
    c.stats.push({ step: s.step, unmasked: s.unmasked, committed: cnt, masked, meanScore: cnt ? sum / cnt : NaN });
    liveStep(rec, s);
  };
  // Concatenate the segments along the frame axis into one grid's worth.
  rec.finish = () => {
    let T = 0; for (const g of rec.segs) T += g.T;
    const score = new Float32Array(NQ * T).fill(NaN), unmask = new Int32Array(NQ * T).fill(-1);
    let off = 0;
    for (const g of rec.segs) {
      for (let q = 0; q < NQ; q++) for (let t = 0; t < g.T; t++) {
        score[q * T + off + t] = g.score[q * g.T + t];
        unmask[q * T + off + t] = g.unmask[q * g.T + t];
      }
      off += g.T;
    }
    return { T, score, unmask, stepStats: rec.segs.map((g) => g.stats), numSteps: rec.segs.length ? rec.segs[0].numSteps : 0 };
  };
  return rec;
}

// ── generate: the grid-exact path ────────────────────────────────────────────
export function generate() {
  if (!omni || busy) return null;
  if (chainOn()) return chain();
  const text = currentText().trim();
  if (!text) { setBadge('type something to speak', true); return null; }
  const opts = baseOpts();
  let frames;
  try { frames = frameTarget(text, opts.prompt); } catch (e) { setBadge('estimateFrames: ' + e.message, true); return null; }
  const rec = makeRecorder(null);
  const t0 = Date.now();
  const cond = currentCond();
  startOp('generating ' + frames + ' frames (' + (frames / FPS).toFixed(2) + ' s) · ' + opts.numSteps + ' steps…');
  beginLive(frames, opts.numSteps, 'generate');
  opts.frames = frames; opts.trace = true; opts.onStep = rec.onStep;
  opts.onDone = (r, info) => {
    endOp();
    if (info.error) { setBadge('generate: ' + info.error, true); liveDone(); return; }
    if (info.cancelled || cancelled) { $('#run-meta').textContent = 'cancelled'; liveDone(); return; }
    let dec; const tc = Date.now();
    try { dec = omni.decodeCodes(r.codes, r.numFrames); } catch (e) { setBadge('decodeCodes: ' + e.message, true); liveDone(); return; }
    const fin = rec.finish();
    const take = mkTake({
      kind: 'generate', text, codes: r.codes, numFrames: r.numFrames, samples: dec.samples, sampleRate: dec.sampleRate,
      unmaskStep: r.trace ? r.trace.unmaskStep : fin.unmask, commitScore: fin.score, stepStats: fin.stepStats,
      params: snapshotParams(Object.assign({ frames }, opts)), cond, promptName: cond.promptName,
      lmSeconds: r.trace ? r.trace.lmSeconds : 0, codecSeconds: (Date.now() - tc) / 1000, wallMs: Date.now() - t0, exact: true,
    });
    addTake(take, true);
    nextSeed();
    setBadge('ready · ' + take.name + ' · LM ' + take.lmSeconds.toFixed(2) + 's');
  };
  try { inflight = omni.generateCodes(text, opts); }
  catch (e) { endOp(); liveDone(); setBadge('generateCodes: ' + e.message, true); return null; }
  return inflight;
}

// ── pipeline: synthesize() with everything upstream does ─────────────────────
export function pipeline() {
  if (!omni || busy) return null;
  const text = currentText().trim();
  if (!text) { setBadge('type something to speak', true); return null; }
  const opts = baseOpts();
  const len = lengthOpts();
  if (len.duration > 0) opts.duration = len.duration; else opts.speed = len.speed;
  let est = 0; try { est = frameTarget(text, opts.prompt); } catch (e) {}
  const rec = makeRecorder(null);
  const t0 = Date.now();
  const cond = currentCond();
  startOp('pipeline · ~' + est + ' frames' + (est > 30 * FPS ? ' (chunked at punctuation)' : '') + '…');
  beginLive(est, opts.numSteps, 'pipeline');
  opts.trace = true; opts.onStep = rec.onStep;
  opts.onDone = (r, info) => {
    endOp();
    if (info.error) { setBadge('pipeline: ' + info.error, true); liveDone(); return; }
    if (info.cancelled || cancelled) { $('#run-meta').textContent = 'cancelled'; liveDone(); return; }
    const tr = r.trace, fin = rec.finish();
    const segments = tr.chunkFrames.length > 1 ? Array.from(tr.chunkFrames, (f, i) => ({ text: 'chunk ' + (i + 1), frames: f })) : null;
    const take = mkTake({
      kind: 'pipeline', text, codes: tr.codes, numFrames: tr.numFrames, samples: r.samples, sampleRate: r.sampleRate,
      unmaskStep: tr.unmaskStep, commitScore: fin.T === tr.numFrames ? fin.score : null, stepStats: fin.stepStats,
      params: snapshotParams(opts), cond, promptName: cond.promptName, segments,
      lmSeconds: tr.lmSeconds, codecSeconds: tr.codecSeconds, wallMs: Date.now() - t0, exact: false,
    });
    addTake(take, true);
    nextSeed();
    setBadge('ready · ' + take.name + ' · LM ' + tr.lmSeconds.toFixed(2) + 's · codec ' + tr.codecSeconds.toFixed(2) + 's');
  };
  try { inflight = omni.synthesize(text, opts); }
  catch (e) { endOp(); liveDone(); setBadge('synthesize: ' + e.message, true); return null; }
  return inflight;
}

// ── chain: per-sentence pacing through the long-form rule ────────────────────
// Sentence i is generated at its own frame count (a typed duration, else the
// rule), conditioned on segment i-1's output as the prompt: either re-encoded
// through the codec (createPrompt on the decoded audio with its text — the
// clip route) or handed over as the codes it already is (a hand-built prompt
// object, which is what upstream's chunk loop does). Segment 0 uses the bank's
// active prompt, if any.
export function chain(rowsOverride) {
  if (!omni || busy) return null;
  let rows = rowsOverride || (chainOn() ? sentenceRows() : splitSentences(currentText()).map((t) => ({ text: t, seconds: 0 })));
  rows = rows.filter((r) => r.text && r.text.trim());
  if (!rows.length) { setBadge('no sentences to chain', true); return null; }
  const mode = $('#chain-mode').value;
  const cond = currentCond();
  const base = baseOpts();
  const speed = lengthOpts().speed;
  const t0 = Date.now();
  const segs = [];
  let lmTotal = 0, codecTotal = 0;
  const rec = makeRecorder(null);
  startOp('chain · sentence 1 / ' + rows.length + '…');
  const fail = (m) => { endOp(); liveDone(); setBadge(m, true); };
  const step = (i) => {
    if (cancelled) { endOp(); liveDone(); $('#run-meta').textContent = 'cancelled'; return; }
    if (i >= rows.length) return finishChain();
    const row = rows[i];
    let prompt = cond.prompt;
    if (i > 0) {
      const prev = segs[i - 1];
      try {
        prompt = mode === 'codes'
          ? { codes: prev.codes, numFrames: prev.numFrames, text: prev.text, rms: cond.prompt ? cond.prompt.rms : 0 }
          : omni.createPrompt(prev.samples, { sampleRate: SR, refText: prev.text });
      } catch (e) { return fail('chain prompt: ' + e.message); }
    }
    let frames;
    try {
      frames = row.seconds > 0 ? Math.max(1, Math.round(row.seconds * FPS))
                               : omni.estimateFrames(row.text, { prompt: prompt || undefined, speed });
    } catch (e) { return fail('estimateFrames: ' + e.message); }
    const opts = Object.assign({}, base, { frames, trace: true, seed: base.seed + i, onStep: rec.onStep });
    if (prompt) opts.prompt = prompt; else delete opts.prompt;
    $('#run-meta').textContent = 'chain · sentence ' + (i + 1) + ' / ' + rows.length + ' · ' + frames + ' frames · “' + row.text.slice(0, 40) + '”';
    beginLive(frames, opts.numSteps, 'chain ' + (i + 1) + '/' + rows.length);
    opts.onDone = (r, info) => {
      if (info.error) return fail('chain: ' + info.error);
      if (info.cancelled || cancelled) { endOp(); liveDone(); $('#run-meta').textContent = 'cancelled'; return; }
      let dec; const tc = Date.now();
      try { dec = omni.decodeCodes(r.codes, r.numFrames); } catch (e) { return fail('decodeCodes: ' + e.message); }
      codecTotal += (Date.now() - tc) / 1000;
      lmTotal += r.trace ? r.trace.lmSeconds : 0;
      segs.push({ text: row.text, codes: r.codes, numFrames: r.numFrames, samples: dec.samples,
                  unmaskStep: r.trace ? r.trace.unmaskStep : null, seconds: row.seconds, seed: opts.seed });
      step(i + 1);
    };
    try { inflight = omni.generateCodes(row.text, opts); }
    catch (e) { fail('generateCodes: ' + e.message); }
  };
  const finishChain = () => {
    endOp();
    let T = 0; for (const s of segs) T += s.numFrames;
    const codes = new Int32Array(NQ * T), unmask = new Int32Array(NQ * T).fill(-1);
    let off = 0;
    for (const s of segs) {
      for (let q = 0; q < NQ; q++) for (let t = 0; t < s.numFrames; t++) {
        codes[q * T + off + t] = s.codes[q * s.numFrames + t];
        if (s.unmaskStep) unmask[q * T + off + t] = s.unmaskStep[q * s.numFrames + t];
      }
      off += s.numFrames;
    }
    const fin = rec.finish();
    const take = mkTake({
      kind: 'chain', text: rows.map((r) => r.text).join(' '), codes, numFrames: T,
      samples: concatF32(segs.map((s) => s.samples)), sampleRate: SR,
      unmaskStep: unmask, commitScore: fin.T === T ? fin.score : null, stepStats: fin.stepStats,
      params: snapshotParams(base), cond, promptName: cond.promptName,
      segments: segs.map((s) => ({ text: s.text, frames: s.numFrames, seconds: s.seconds, seed: s.seed })),
      chainMode: mode, lmSeconds: lmTotal, codecSeconds: codecTotal, wallMs: Date.now() - t0, exact: true,
    });
    addTake(take, true);
    nextSeed();
    setBadge('ready · ' + take.name + ' · ' + segs.length + ' segments · LM ' + lmTotal.toFixed(2) + 's');
  };
  step(0);
  return true;
}

export const samplesPerFrame = SPF;
