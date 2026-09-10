// ═══ LENGTH + SCHEDULE — the frame count, and how the grid unmasks ════════════
import { $, omni, FPS } from "/app/lib/state.js";
import { activePrompt } from "/app/lib/voice.js";
import { currentText } from "/app/lib/text.js";

// slider id -> OmniVoiceParams key, default, formatter
const DIALS = [
  { id: 'steps',     v: 'v-steps',     key: 'numSteps',            def: 32,  fmt: (x) => String(x | 0) },
  { id: 'tshift',    v: 'v-tshift',    key: 'tShift',              def: 0.1, fmt: (x) => x.toFixed(2) },
  { id: 'guidance',  v: 'v-guidance',  key: 'guidanceScale',       def: 2,   fmt: (x) => x.toFixed(1) },
  { id: 'postemp',   v: 'v-postemp',   key: 'positionTemperature', def: 5,   fmt: (x) => x.toFixed(2) },
  { id: 'classtemp', v: 'v-classtemp', key: 'classTemperature',    def: 0,   fmt: (x) => x.toFixed(2) },
  { id: 'penalty',   v: 'v-penalty',   key: 'layerPenalty',        def: 5,   fmt: (x) => x.toFixed(1) },
];

export function currentParams() {
  const p = {};
  for (const d of DIALS) p[d.key] = +$('#' + d.id).value;
  p.numSteps = Math.max(1, p.numSteps | 0);
  p.gumbelNoise = $('#gumbel').checked;
  p.seed = Math.max(0, +$('#seed').value | 0);
  return p;
}
export function setParam(key, value) {
  const d = DIALS.find((x) => x.key === key);
  if (d) { $('#' + d.id).value = String(value); $('#' + d.v).textContent = d.fmt(+value); }
  else if (key === 'seed') $('#seed').value = String(value | 0);
  else if (key === 'gumbelNoise') $('#gumbel').checked = !!value;
}
export function seedLocked() { return $('#seed-lock').checked; }
export function randomSeed() { return (Math.random() * 1e9) | 0; }
// After a take: keep the seed when locked, otherwise draw a new one.
export function nextSeed() { if (!seedLocked()) $('#seed').value = String(randomSeed()); }

// ── length ───────────────────────────────────────────────────────────────────
export function lengthOpts() {
  return { duration: +$('#duration').value || 0, speed: +$('#speed').value || 1 };
}
export function setLength(duration, speed) {
  if (duration != null) $('#duration').value = String(duration);
  if (speed != null) $('#speed').value = String(speed);
  refreshLengthLabels(); updateEstimate();
}
function refreshLengthLabels() {
  const { duration, speed } = lengthOpts();
  $('#v-duration').textContent = duration > 0 ? duration.toFixed(1) + ' s (' + Math.max(1, Math.round(duration * FPS)) + ' fr)' : 'auto (rule)';
  $('#v-speed').textContent = speed.toFixed(2) + (duration > 0 ? ' (ignored)' : '');
}
// The frame count a generation will use for `text` with `prompt`: the rule's
// estimate divided by speed, or the fixed duration.
export function frameTarget(text, prompt) {
  const { duration, speed } = lengthOpts();
  if (!omni) return 0;
  return omni.estimateFrames(text, { prompt: prompt || undefined, speed, duration });
}
export function updateEstimate() {
  const m = $('#est-meta');
  if (!omni) { m.textContent = '—'; return; }
  const text = currentText().trim();
  if (!text) { m.textContent = 'no text'; return; }
  const prompt = activePrompt();
  try {
    const { duration, speed } = lengthOpts();
    const rule = omni.estimateFrames(text, { prompt: prompt || undefined });
    const fr = frameTarget(text, prompt);
    let how = duration > 0 ? 'fixed by duration' : speed !== 1 ? 'rule ' + rule + ' ÷ speed ' + speed.toFixed(2) : 'the duration rule';
    how += prompt ? ' · scaled by the prompt (' + prompt.numFrames + ' fr for “' + (prompt.text || '').slice(0, 24) + (prompt.text && prompt.text.length > 24 ? '…' : '') + '”)'
                  : ' · no prompt: the fixed pair (“Nice to meet you.” = 25 fr) stands in';
    m.textContent = fr + ' frames · ' + (fr / FPS).toFixed(2) + ' s · ' + how;
  } catch (e) { m.textContent = 'estimate: ' + e.message; }
}

export function resetSchedule() {
  for (const d of DIALS) setParam(d.key, d.def);
  $('#gumbel').checked = true;
}

export function buildSchedule() {
  for (const d of DIALS) {
    const r = $('#' + d.id), v = $('#' + d.v);
    v.textContent = d.fmt(+r.value);
    r.addEventListener('input', () => { v.textContent = d.fmt(+r.value); });
  }
  $('#duration').addEventListener('input', () => { refreshLengthLabels(); updateEstimate(); });
  $('#speed').addEventListener('input', () => { refreshLengthLabels(); updateEstimate(); });
  $('#btn-speed-reset').addEventListener('click', () => setLength(0, 1));
  $('#btn-seed-rand').addEventListener('click', () => { $('#seed').value = String(randomSeed()); });
  $('#btn-sched-reset').addEventListener('click', resetSchedule);
  refreshLengthLabels();
}
