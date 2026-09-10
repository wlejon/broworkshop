// Headless smoke for OmniVoice Lab: drives the app's own modules against the
// real model, asserting DOM state and grid geometry (never audio quality).
//
//   cd ../broworkshop && ../bro/build/Release/bro-headless.exe demos/omnivoice-lab demos/omnivoice-lab/tests/test_smoke.js
//
// Skips (passes with a message) when the weights or a GPU backend are absent:
// OmniVoice's LM is GPU-only. The app's init() kicks its own async load; we
// pump the headless tick until onReady lands (advanceTime drains callbacks,
// wallSleep gives the worker thread real time — see docs/headless.md).
//
// Wall time on an RTX 4090: ~10 s load + ~40 s of 16-step generations.
import { $, omni, takes, current, busy, NQ, MASK, FPS, SPF } from "/app/lib/state.js";
import { generate, chain, pipeline } from "/app/lib/synth.js";
import { reroll } from "/app/lib/edit.js";
import { setSelection, setCodebooks, sel, cbs } from "/app/lib/grid.js";
import { prompts, activePrompt, promptFromTake, languageCount, setLanguage, setInstructPick,
         currentInstruct, clearInstruct, setActive } from "/app/lib/voice.js";
import { setText, splitSentences, setSentenceSeconds, sentenceRows, rebuildSentences } from "/app/lib/text.js";
import { setParam, setLength, frameTarget, currentParams } from "/app/lib/schedule.js";
import { cards } from "/app/lib/render.js";

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const SHOTS = (typeof process !== 'undefined' && process.env && process.env.OMNI_SHOTS) ||
              (WROOT + '/broworkshop/demos/omnivoice-lab/tests/out/');
const TEXT = 'Hello there, this is a test of the OmniVoice pipeline.';

function ms(t0) { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }
function pumpUntil(desc, fn, seconds) {
  const iters = Math.ceil((seconds * 1000) / 16);
  for (let i = 0; i < iters; i++) {
    advanceTime(16); wallSleep(16);
    if (fn()) return;
  }
  throw new Error('timeout waiting for ' + desc);
}
function settled() { return !busy; }
function sameCodes(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function count(sel) { return document.querySelectorAll(sel).length; }
function fire(el, type) { el.dispatchEvent(new Event(type)); }

// ── 1. the app loads its model ───────────────────────────────────────────────
let t0 = Date.now();
pumpUntil('model load', () => !!omni || /failed|no GPU|no config/.test($('#backend').textContent), 240);
if (!omni) {
  console.log('SKIP: ' + $('#backend').textContent);
} else {
  console.log('loaded in ' + ms(t0) + ' · ' + $('#backend').textContent + ' · ' + $('#model-meta').textContent);
  assert(omni.loaded && omni.device !== 'CPU', 'model loaded on a GPU: ' + omni.device);
  assert(!$('#btn-generate').disabled, 'generate enabled after load');

  // ── 2. the model-derived panels ────────────────────────────────────────────
  assert(languageCount() > 500 && count('#language option') > 500, 'language picker lists 600+ names: ' + count('#language option'));
  assert($('#language').value.toLowerCase() === 'english', 'English preselected');
  $('#lang-search').value = 'span'; fire($('#lang-search'), 'input');
  const filtered = count('#language option');
  assert(filtered > 1 && filtered < 60, 'language search filters the list: ' + filtered);
  $('#lang-search').value = ''; fire($('#lang-search'), 'input');
  assert(count('#instruct-picks select') === 6, 'six instruct categories as pickers: ' + count('#instruct-picks select'));
  const gender = $('#instruct-picks select').options[1].value;
  setInstructPick('gender', gender);
  assert(currentInstruct() === gender && $('#instruct-preview').textContent.indexOf(gender) >= 0, 'instruct assembles from the picks: ' + currentInstruct());
  clearInstruct();
  assert(currentInstruct() === '', 'instruct cleared');
  assert(count('#tag-chips button') >= 3, 'non-verbal tag chips: ' + count('#tag-chips button'));
  assert(/\[laughter\]/.test($('#tag-chips').textContent), 'chips include [laughter]');
  assert(/\d+ text ids/.test($('#tok-meta').textContent), 'tokenizer preview: ' + $('#tok-meta').textContent);

  // ── 3. length: the rule's estimate is live and the sliders drive it ────────
  setText(TEXT);
  advanceTime(200);
  const est = frameTarget(TEXT, null);
  assert(est > 25 && est < 400, 'estimateFrames for the sentence: ' + est);
  assert(new RegExp('^' + est + ' frames').test($('#est-meta').textContent), 'estimate readout shows it: ' + $('#est-meta').textContent);
  setLength(0, 2);
  assert(frameTarget(TEXT, null) < est, 'speed 2 shrinks the target: ' + frameTarget(TEXT, null));
  setLength(2, 1);
  assert(frameTarget(TEXT, null) === 50, 'duration 2 s fixes 50 frames');
  assert(/fixed by duration/.test($('#est-meta').textContent), 'readout says fixed');
  setLength(0, 1);

  // ── 4. generate: a take, the grid, the heatmaps ────────────────────────────
  setParam('numSteps', 16); setParam('seed', 7);
  $('#seed-lock').checked = true;
  t0 = Date.now();
  generate();
  assert(busy && $('#btn-generate').disabled && !$('#btn-stop').disabled, 'transport shows busy');
  pumpUntil('generate', () => settled() && takes.length === 1, 120);
  const take = takes[0];
  console.log('generate: ' + ms(t0) + ' · ' + take.numFrames + ' frames · LM ' + take.lmSeconds.toFixed(2) + 's · ' + $('#run-meta').textContent);
  assert(current === take, 'the new take is current');
  assert(take.numFrames === est, 'generated exactly the estimated frames: ' + take.numFrames + ' vs ' + est);
  assert(take.codes.length === NQ * take.numFrames, 'codes are NQ x T');
  assert(take.samples.length === take.numFrames * SPF, 'decodeCodes gives T x 960 samples: ' + take.samples.length);
  for (let i = 0; i < take.codes.length; i++) assert(take.codes[i] >= 0 && take.codes[i] < MASK, 'every cell committed');
  assert(take.unmaskStep.length === take.codes.length && take.unmaskStep.every((s) => s >= 0 && s < 16), 'unmaskStep grid from the trace');
  let finite = 0; for (let i = 0; i < take.commitScore.length; i++) if (take.commitScore[i] === take.commitScore[i]) finite++;
  assert(finite === take.codes.length, 'a commit score was recorded for every cell: ' + finite);
  assert(take.stepStats.length === 1 && take.stepStats[0].length === 16, 'one segment of 16 step stats');
  const sumU = take.stepStats[0].reduce((a, s) => a + s.unmasked, 0);
  assert(sumU === take.codes.length, 'per-step unmask counts sum to the grid: ' + sumU);
  // DOM
  assert(count('#take-list .take') === 1 && count('#take-list .take.current') === 1, 'take strip has the take, marked current');
  assert(cards.audio && cards.grid && cards.unmask && cards.steps && cards.confidence, 'all five cards exist');
  assert(cards.grid.canvas.width === 1180 && cards.grid.canvas.height === NQ * 18, 'grid canvas 1180 x ' + (NQ * 18) + ': ' + cards.grid.canvas.width + 'x' + cards.grid.canvas.height);
  assert(cards.unmask.canvas.height === NQ * 13 && cards.confidence.canvas.height === NQ * 13, 'heatmap canvases 8 rows');
  assert(count('#card-grid .card-tools input[type=checkbox]') === 9, 'grid tools: 8 codebook ticks + show changes');
  assert(/mean commit step per codebook/.test(cards.unmask.note.textContent), 'unmask note: ' + cards.unmask.note.textContent);
  assert(/LM \d+\.\d+ s/.test(cards.steps.note.textContent), 'steps note carries the LM timing: ' + cards.steps.note.textContent);
  assert(/frames/.test($('#run-meta').textContent), 'run-meta filled');
  assert(!busy && !$('#btn-generate').disabled && !$('#btn-play').disabled, 'transport idle again');
  // the semantic codebook commits first on average (layer penalty)
  const meanStep = (q) => { let s = 0; for (let t = 0; t < take.numFrames; t++) s += take.unmaskStep[q * take.numFrames + t]; return s / take.numFrames; };
  assert(meanStep(0) < meanStep(7), 'codebook 0 unmasks earlier than 7: ' + meanStep(0).toFixed(1) + ' < ' + meanStep(7).toFixed(1));
  // locked seed stays
  assert(+$('#seed').value === 7, 'locked seed unchanged');
  flush(); screenshot(SHOTS + 'omnivoice-lab-1-take.png');

  // ── 5. re-roll a span: only the selected positions change ──────────────────
  const T = take.numFrames, t0f = Math.floor(T * 0.3), t1f = Math.floor(T * 0.5);
  setSelection(t0f, t1f);
  assert(sel && sel.t0 === t0f && sel.t1 === t1f, 'selection set: ' + JSON.stringify(sel));
  setCodebooks([0, 1, 2, 3, 4, 5, 6, 7]);
  t0 = Date.now();
  reroll('span', 123);
  pumpUntil('re-roll span', () => settled() && takes.length === 2, 120);
  const rr = takes[1];
  console.log('re-roll span: ' + ms(t0) + ' · ' + JSON.stringify(rr.rerollInfo));
  assert(rr.parentId === take.id && rr.kind === 'reroll' && current === rr, 're-roll take is a child of the take, and current');
  assert(rr.numFrames === T && rr.samples.length === T * SPF, 're-roll keeps T (' + T + ') and the exact sample count');
  let inside = 0, outsideChanged = 0, insideChanged = 0;
  for (let q = 0; q < NQ; q++) for (let t = 0; t < T; t++) {
    const i = q * T + t, inSpan = t >= t0f && t < t1f;
    if (inSpan) { inside++; if (rr.codes[i] !== take.codes[i]) insideChanged++; }
    else if (rr.codes[i] !== take.codes[i]) outsideChanged++;
    assert(!!rr.changed[i] === (rr.codes[i] !== take.codes[i]), 'changed mask matches the diff');
    assert(!!rr.masked[i] === inSpan, 'masked grid is the span x all codebooks');
    if (!inSpan) assert(rr.unmaskStep[i] === -1, 'kept cells report unmaskStep -1');
    else assert(rr.unmaskStep[i] >= 0, 're-rolled cells report their step');
  }
  assert(outsideChanged === 0, 'nothing outside the span changed');
  assert(insideChanged > 0 && insideChanged <= inside, 'the span re-rolled: ' + insideChanged + ' of ' + inside + ' cells changed');
  assert(rr.rerollInfo.masked === inside && rr.rerollInfo.changed === insideChanged && rr.rerollInfo.leaked === 0, 'rerollInfo agrees');
  assert(/nothing outside the mask changed/.test(cards.grid.note.textContent), 'grid note reports the check: ' + cards.grid.note.textContent);
  assert(count('#take-list .take') === 2, 'take strip has two takes');
  flush(); screenshot(SHOTS + 'omnivoice-lab-2-reroll.png');
  // the launcher thumbnail: the trace column with a re-rolled span in the grid
  screenshot(SHOTS + 'thumbnail.png', '#right');

  // the same seed over the same init grid reproduces the re-roll (kept cells are
  // the parent's, so select on the parent again)
  const { showTake } = await import('/app/lib/takes.js');
  showTake(take, true);
  setSelection(t0f, t1f); setCodebooks([0, 1, 2, 3, 4, 5, 6, 7]);
  reroll('span', 123);
  pumpUntil('re-roll again', () => settled() && takes.length === 3, 120);
  assert(sameCodes(takes[2].codes, rr.codes), 'a re-roll with the same seed reproduces the codes exactly');

  // ── 6. re-roll acoustics: codebook 0 kept, 1..7 re-drawn ───────────────────
  showTake(take, true);
  t0 = Date.now();
  reroll('acoustics', 9);
  pumpUntil('re-roll acoustics', () => settled() && takes.length === 4, 120);
  const ra = takes[3];
  console.log('re-roll acoustics: ' + ms(t0) + ' · ' + JSON.stringify(ra.rerollInfo));
  for (let t = 0; t < T; t++) assert(ra.codes[t] === take.codes[t], 'codebook 0 kept at frame ' + t);
  let acChanged = 0; for (let i = T; i < NQ * T; i++) if (ra.codes[i] !== take.codes[i]) acChanged++;
  assert(acChanged > 0 && ra.rerollInfo.leaked === 0 && ra.rerollInfo.masked === 7 * T, 'acoustic codebooks re-rolled: ' + acChanged + ' cells');

  // ── 7. per-sentence pacing: a chained generation ───────────────────────────
  const CHAIN = 'First sentence goes here. Then a second one follows it.';
  assert(splitSentences(CHAIN).length === 2, 'sentence split: ' + JSON.stringify(splitSentences(CHAIN)));
  assert(splitSentences('Mr. Smith paid 3.5 dollars. Fine!').length === 2, 'abbreviations and decimals do not split');
  setText(CHAIN);
  $('#chain-on').checked = true; rebuildSentences();
  assert(count('#sentences .sent') === 2 && sentenceRows().length === 2, 'two sentence rows');
  setSentenceSeconds(0, 2.0); setSentenceSeconds(1, 1.6);
  assert(sentenceRows()[0].seconds === 2 && sentenceRows()[1].seconds === 1.6, 'per-sentence seconds set');
  assert(/50 fr fixed/.test(document.querySelectorAll('#sentences .sest')[0].textContent), 'row shows the fixed frames: ' + document.querySelectorAll('#sentences .sest')[0].textContent);
  $('#chain-mode').value = 'encode';
  t0 = Date.now();
  generate();                                   // chain-on routes generate() through the chain
  pumpUntil('chain', () => settled() && takes.length === 5, 240);
  const ch = takes[4];
  console.log('chain: ' + ms(t0) + ' · ' + ch.segments.map((s) => s.frames).join('+') + ' frames · LM ' + ch.lmSeconds.toFixed(2) + 's');
  assert(ch.kind === 'chain' && ch.segments.length === 2, 'chain take with two segments');
  assert(ch.segments[0].frames === 50 && ch.segments[1].frames === 40, 'segments at the typed durations: ' + ch.segments.map((s) => s.frames));
  assert(ch.numFrames === 90 && ch.codes.length === NQ * 90 && ch.samples.length === 90 * SPF, 'chain grid + audio concatenated: ' + ch.numFrames);
  assert(ch.unmaskStep.every((s) => s >= 0), 'chain carries each segment\'s unmask trace');
  assert(ch.stepStats.length === 2, 'step stats per segment');
  assert(ch.text === CHAIN, 'chain text is the sentences rejoined');
  assert(cards.grid.canvas.height === NQ * 18 && /90 frames/.test(cards.grid.note.textContent), 'grid redrawn for the chain: ' + cards.grid.note.textContent);
  $('#chain-on').checked = false; rebuildSentences();
  flush(); screenshot(SHOTS + 'omnivoice-lab-3-chain.png');

  // ── 8. a take becomes the voice; synthesize with it ────────────────────────
  const entry = promptFromTake(take);
  assert(entry && prompts.length === 1 && activePrompt() === entry.prompt, 'prompt bank has the take\'s voice, active');
  assert(entry.prompt.text === TEXT && entry.prompt.numFrames > 0 && entry.prompt.codes.length === NQ * entry.prompt.numFrames, 'prompt shape: ' + entry.prompt.numFrames + ' frames');
  assert(count('#prompt-bank .prompt-entry') === 1 && count('#prompt-bank .prompt-entry.active') === 1, 'bank DOM shows it active');
  const SECOND = 'And now the same voice says something else.';
  setText(SECOND); advanceTime(200);
  assert(/scaled by the prompt/.test($('#est-meta').textContent), 'estimate now reads the prompt: ' + $('#est-meta').textContent);
  const estP = frameTarget(SECOND, activePrompt());
  t0 = Date.now();
  generate();
  pumpUntil('generate with prompt', () => settled() && takes.length === 6, 120);
  const tp = takes[5];
  console.log('generate(prompt): ' + ms(t0) + ' · ' + tp.numFrames + ' frames');
  assert(tp.promptName === entry.name && tp.cond.prompt === entry.prompt && tp.numFrames === estP, 'the take carries the voice it was made with');
  assert(/◉/.test(document.querySelectorAll('#take-list .take')[5].textContent), 'strip shows the voice on the take');
  // deselecting the prompt leaves the model to pick a voice
  setActive(-1);
  assert(activePrompt() === null && count('#prompt-bank .prompt-entry.active') === 0, 'prompt deselected');

  // ── 8b. a reference clip: decode, transcribe with Whisper, encode a prompt ──
  const CLIP = WROOT + '/brosoundml/weights/whisper/test_audio_en.wav';
  if (require('node:fs').existsSync(CLIP)) {
    const { transcribeClip, promptFromClip } = await import('/app/lib/voice.js');
    $('#ref-wav').value = CLIP;
    t0 = Date.now();
    const words = transcribeClip();
    console.log('transcribe(clip): ' + ms(t0) + ' · "' + words + '"');
    assert(words.length > 5 && $('#ref-text').value === words, 'Whisper transcript landed in the transcript box');
    const ce = promptFromClip();
    assert(ce && prompts.length === 2 && activePrompt() === ce.prompt && ce.prompt.numFrames > 0, 'prompt from clip added + active: ' + ce.prompt.numFrames + ' frames');
    assert(ce.prompt.text.toLowerCase().indexOf(words.toLowerCase().slice(0, 12)) === 0, 'prompt keeps the (punctuated) transcript: ' + ce.prompt.text);
    assert(count('#prompt-bank .prompt-entry') === 2 && count('#prompt-bank .prompt-entry.active') === 1, 'bank DOM has both');
    setActive(-1);
  } else console.log('(no reference clip at ' + CLIP + ' — clip -> prompt path not exercised)');

  // ── 9. the full pipeline (synthesize) makes a take too ─────────────────────
  setLength(1.5, 1);
  t0 = Date.now();
  pipeline();
  pumpUntil('pipeline', () => settled() && takes.length === 7, 120);
  const pp = takes[6];
  console.log('pipeline: ' + ms(t0) + ' · ' + pp.numFrames + ' frames · ' + pp.samples.length + ' samples · codec ' + pp.codecSeconds.toFixed(2) + 's');
  assert(pp.kind === 'pipeline' && pp.numFrames === 37 && pp.codes.length === NQ * 37 && pp.samples.length > 0 && !pp.exact, 'pipeline take: trace grid + post-processed audio');
  assert(/alignment approximate/.test(cards.audio.note.textContent), 'audio note flags the post-processing');
  setLength(0, 1);

  flush(); screenshot(SHOTS + 'omnivoice-lab-4-final.png');
  console.log('OMNIVOICE LAB SMOKE OK · ' + takes.length + ' takes');
}
