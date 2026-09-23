// Laya triage: one request with its calibrated answers and the act/escalate
// decision taken from confidence, beside live open-loop traffic that shows the
// request scheduler batching concurrent callers across the GPUs.

import { installSystemMenu } from "/lib/system-menu.js";
import { model, defaultModelDir, browseFolder, loadModel, unavailableReason, familyRoot,
         familyCheckpoints } from "/app/lib/model.js";
import { PRESETS, QUESTIONS, presetsFor, trafficMix } from "/app/lib/presets.js";
import { traffic, setRunning, burst, tickTraffic, resetTraffic, windowSummary } from "/app/lib/traffic.js";
import { $, renderResult, drawLatency, drawBatches, renderStats } from "/app/lib/render.js";
import { session } from "/app/lib/session.js";

installSystemMenu();

function setStatus(text, kind) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status' + (kind ? ' ' + kind : '');
}

function setReady(on) {
  for (const id of ['#btn-run', '#btn-traffic', '#btn-burst', '#btn-reset']) $(id).disabled = !on;
}

function showUnavailable(msg) {
  const u = $('#unavailable');
  u.textContent = msg;
  u.classList.toggle('hidden', !msg);
}

// ── Model ───────────────────────────────────────────────────────────────────

// The checkpoint picker lists the family members found beside the folder in
// the path box; picking one loads it. A folder outside a family checkout is
// still loadable through the path box alone.
function refreshCheckpoints(dir) {
  const sel = $('#ckpt-select');
  const members = familyCheckpoints(familyRoot(dir));
  sel.textContent = '';
  const norm = (d) => (d || '').replace(/\\/g, '/').replace(/\/+$/, '');
  for (const c of members) {
    const o = document.createElement('option');
    o.value = c.dir;
    o.textContent = c.label;
    if (norm(c.dir) === norm(dir)) o.selected = true;
    sel.appendChild(o);
  }
  if (!members.some((c) => norm(c.dir) === norm(dir))) {
    const o = document.createElement('option');
    o.value = dir;
    o.textContent = dir ? 'custom folder' : 'none found';
    o.selected = true;
    sel.appendChild(o);
  }
  sel.disabled = members.length < 2;
}

$('#ckpt-select').addEventListener('change', () => {
  $('#model-dir').value = $('#ckpt-select').value;
  load();
});

function load() {
  const dir = $('#model-dir').value;
  setRunning(false);
  $('#btn-traffic').textContent = 'Start traffic';
  setReady(false);
  refreshCheckpoints(dir);
  session.loading = true;
  session.loadError = '';
  session.checkpoint = '';
  setStatus('loading… (weights + CUDA-graph pre-warm, a few seconds)', 'busy');
  const t0 = Date.now();
  loadModel(dir).then((m) => {
    session.loading = false;
    session.model = m;
    session.loadMs = Date.now() - t0;
    const cfg = m.config();
    session.checkpoint = cfg.checkpoint;
    showUnavailable('');
    setStatus(`ready · ${cfg.checkpoint} · ${cfg.devices.length} GPU${cfg.devices.length === 1 ? '' : 's'} · ` +
              `loaded in ${(session.loadMs / 1000).toFixed(1)} s`, 'ok');
    $('#brand-sub').textContent = `${cfg.encoder} · ${cfg.num_layers} layers · ${cfg.max_len}-token context · ` +
                                  `${cfg.tokenizer} · bro.lm.loadLaya`;
    buildPresets(cfg.checkpoint);
    trafficMix.multilingual = cfg.checkpoint === 'multilingual';
    setReady(true);
    m.resetStats();
  }, (e) => {
    session.loading = false;
    session.loadError = String(e && e.message || e);
    setStatus('not loaded', 'err');
    showUnavailable('The Laya model could not be loaded: ' + session.loadError +
                    ' Nothing on this page works without it; there is no simulated fallback.');
  });
}

$('#btn-load').addEventListener('click', load);
$('#btn-browse').addEventListener('click', () => {
  const d = browseFolder($('#model-dir').value);
  if (d) { $('#model-dir').value = d; load(); }
  else if (typeof showOpenFolderDialog !== 'function') setStatus('no folder dialog in this build; type the path', 'err');
});
if (typeof showOpenFolderDialog !== 'function') $('#btn-browse').disabled = true;

// ── Single request ──────────────────────────────────────────────────────────

const presetBox = $('#presets');
function selectPreset(p) {
  $('#state').value = JSON.stringify(p.state, null, 2);
  for (const b of presetBox.children) b.classList.toggle('active', b.dataset.id === p.id);
}
// English presets for every checkpoint; the non-English ones only while the
// multilingual checkpoint is loaded.
function buildPresets(checkpoint) {
  const active = [...presetBox.children].find((b) => b.classList.contains('active'));
  presetBox.textContent = '';
  for (const p of presetsFor(checkpoint)) {
    const b = document.createElement('button');
    b.className = 'preset' + (p.lang ? ' foreign' : '');
    b.dataset.id = p.id;
    b.textContent = p.label;
    b.addEventListener('click', () => { selectPreset(p); if (model) runSingle(); });
    presetBox.appendChild(b);
  }
  if (active && ![...presetBox.children].some((b) => b.dataset.id === active.dataset.id)) selectPreset(PRESETS[0]);
  else if (active) active.classList.add('active');
  $('#presets-note').textContent = checkpoint === 'multilingual'
    ? 'Multilingual checkpoint: the dashed tickets are in other languages (questions stay in English), and half the generated traffic is too.'
    : 'Non-English tickets appear with the multilingual checkpoint; this one only reads English.';
}
buildPresets('english');
selectPreset(PRESETS[0]);

function threshold() { return parseFloat($('#threshold').value); }
$('#threshold').addEventListener('input', () => {
  $('#threshold-val').textContent = Math.round(threshold() * 100) + '%';
  if (session.lastResult) renderResult(session.lastResult, threshold(), session.lastObservedMs);
});

function readState() {
  const text = $('#state').value;
  try { return JSON.parse(text); } catch (e) { return text; }   // plain text is a valid state too
}

export function runSingle() {
  if (!model) return;
  const t0 = Date.now();
  session.singleError = '';
  $('#btn-run').disabled = true;
  model.predictAsync(readState(), QUESTIONS, { priority: 10, deadlineMs: 30 }).then((res) => {
    $('#btn-run').disabled = false;
    session.lastObservedMs = Date.now() - t0;
    session.lastResult = res;
    renderResult(res, threshold(), session.lastObservedMs);
  }, (e) => {
    $('#btn-run').disabled = false;
    session.singleError = String(e && e.message || e);
    $('#decision').className = 'decision escalate';
    $('#decision-head').textContent = 'Request failed';
    $('#decision-sub').textContent = session.singleError;
  });
}
$('#btn-run').addEventListener('click', runSingle);

// ── Traffic ─────────────────────────────────────────────────────────────────

function restartWindow() { resetTraffic(); if (model) model.resetStats(); }

$('#rate').addEventListener('input', () => {
  traffic.rate = parseInt($('#rate').value, 10);
  $('#rate-val').textContent = traffic.rate + ' req/s';
  if (model) model.resetStats();
});
$('#btn-traffic').addEventListener('click', () => {
  const on = !traffic.running;
  if (on) restartWindow();
  setRunning(on);
  $('#btn-traffic').textContent = on ? 'Stop traffic' : 'Start traffic';
  $('#btn-traffic').classList.toggle('active', on);
});
$('#btn-burst').addEventListener('click', () => { if (model) burst(model, 64); });
$('#btn-reset').addEventListener('click', restartWindow);

// ── Frame loop ──────────────────────────────────────────────────────────────

let lastStats = 0;
function frame() {
  if (model) {
    tickTraffic(model);
    const now = Date.now();
    if (now - lastStats >= 100) {          // stats() copies a few hundred values; 10 Hz is plenty
      lastStats = now;
      const st = model.stats();
      renderStats(st, windowSummary(3000), model);
      drawBatches($('#batches'), st);
    }
    drawLatency($('#latency'), traffic.deadlineMs);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Boot ────────────────────────────────────────────────────────────────────

const why = unavailableReason();
if (why) {
  showUnavailable(why + ' There is no simulated fallback.');
  setStatus('unavailable', 'err');
  $('#btn-load').disabled = true;
} else {
  $('#model-dir').value = defaultModelDir();
  refreshCheckpoints($('#model-dir').value);
  if ($('#model-dir').value) load();
  else {
    setStatus('not loaded', 'err');
    showUnavailable('No Laya checkpoint found (set LAYA_MODEL_DIR, put a laya/ checkout beside this workspace, or browse to one).');
  }
}
