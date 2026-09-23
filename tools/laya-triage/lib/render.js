// DOM + canvas rendering: the single-request answer cards, and the live
// concurrency view (per-request latency, forward occupancy, device load).

import { QUESTIONS } from '/app/lib/presets.js';
import { traffic } from '/app/lib/traffic.js';

export const $ = (s) => document.querySelector(s);

const DEVICE_COLORS = ['#4fb3ff', '#f5a524', '#9b7bff', '#3ecf8e'];
const deviceColor = (d) => DEVICE_COLORS[(d | 0) % DEVICE_COLORS.length];
const pct = (x) => (100 * x).toFixed(0) + '%';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bar(label, p, strong) {
  const row = el('div', 'bar-row' + (strong ? ' strong' : ''));
  row.appendChild(el('span', 'bar-label', label));
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  fill.style.width = (100 * p).toFixed(1) + '%';
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(el('span', 'bar-val', pct(p)));
  return row;
}

// ── Single request ──────────────────────────────────────────────────────────

// The act/escalate decision comes from the calibrated confidence of the
// routing answer (1 - normalised entropy): the checkpoint's own act head is
// saturated (~1.0 for everything), so it cannot gate. The yes/no answers are
// flags on the ticket, not gates: their entropy confidence is low for any
// p in the 0.1-0.3 range, which would escalate nearly everything.
export function decide(res, threshold) {
  const dep = res.answers.department;
  const flags = [];
  if (res.answers.churn_threat.noul >= 0.5) flags.push('churn risk');
  if (res.answers.refund_requested.noul >= 0.5) flags.push('refund');
  if (res.answers.angry.noul >= 0.5) flags.push('upset customer');
  return { act: dep.confidence >= threshold, confidence: dep.confidence, flags };
}

export function renderResult(res, threshold, observedMs) {
  const box = $('#answers');
  box.textContent = '';
  const d = decide(res, threshold);
  const banner = $('#decision');
  banner.className = 'decision ' + (d.act ? 'act' : 'escalate');
  const dep = res.answers.department;
  $('#decision-head').textContent = (d.act ? 'Act: route to ' + dep.choice : 'Escalate to a human') +
    (d.flags.length ? '  ·  ' + d.flags.join(', ') : '');
  $('#decision-sub').textContent = (d.act
    ? 'Routing confidence ' + pct(d.confidence) + ' is at or above ' + pct(threshold) + '.'
    : 'Routing confidence ' + pct(d.confidence) + ' is below ' + pct(threshold) +
      ' (best guess: ' + dep.choice + ' at ' + pct(dep.probabilities[dep.choice]) + ').') +
    ' Flags are yes/no answers at 50% or more.';

  for (const id of Object.keys(QUESTIONS)) {
    const a = res.answers[id];
    if (!a) continue;
    const card = el('div', 'card');
    const head = el('div', 'card-head');
    head.appendChild(el('span', 'q-id', id));
    head.appendChild(el('span', 'q-type t-' + a.type, a.type));
    head.appendChild(el('span', 'q-conf', 'confidence ' + pct(a.confidence)));
    card.appendChild(head);
    card.appendChild(el('div', 'q-text', QUESTIONS[id].instructions));
    if (a.type === 'noul') {
      card.appendChild(bar('yes', a.noul, a.noul >= 0.5));
    } else {
      const probs = a.probabilities || {};
      const legend = a.legend || {};
      let best = '', bestP = -1;
      for (const k in probs) if (probs[k] > bestP) { bestP = probs[k]; best = k; }
      for (const k in probs) card.appendChild(bar(a.type === 'score' ? k + ': ' + (legend[k] || '') : k, probs[k], k === best));
      if (a.type === 'score') {
        card.appendChild(el('div', 'q-note', 'expected level ' + a.score.toFixed(2) +
          ' (score questions are Laya\'s weakest type: a hint, not a verdict)'));
      }
    }
    box.appendChild(card);
  }
  const t = res.timing;
  $('#single-timing').textContent =
    `${t.totalMs.toFixed(1)} ms in the engine (tokenize ${t.tokenizeMs.toFixed(1)}, queue ${t.queueMs.toFixed(1)}, ` +
    `forward ${t.forwardMs.toFixed(1)}) · ${observedMs} ms until this page saw it · GPU ${t.device} · ` +
    `shared its forward with ${t.batchRequests - 1} other request${t.batchRequests === 2 ? '' : 's'} · ` +
    `${res.usage.input_tokens} tokens · act head ${res.answers.department.rl_agent.act_probability.toFixed(3)} (saturated, not used)`;
}

// ── Live view ───────────────────────────────────────────────────────────────

function fitCanvas(c) {
  const w = Math.max(100, c.clientWidth | 0), h = Math.max(60, c.clientHeight | 0);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c.getContext('2d');
}

const SPAN_MS = 10000;
const Y_MAX = 60;

export function drawLatency(canvas, deadlineMs) {
  const g = fitCanvas(canvas);
  const W = canvas.width, H = canvas.height, L = 34, B = 16;
  g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
  const y = (ms) => (H - B) - Math.min(ms, Y_MAX) / Y_MAX * (H - B - 6);
  g.font = '10px sans-serif'; g.fillStyle = '#6b7686';
  for (const ms of [0, 10, 20, 30, 40, 50, 60]) {
    g.fillStyle = '#1c2330'; g.fillRect(L, y(ms), W - L, 1);
    g.fillStyle = '#6b7686'; g.fillText(ms + '', 6, y(ms) + 3);
  }
  g.fillStyle = '#e5484d'; g.fillRect(L, y(deadlineMs) - 1, W - L, 2);
  g.fillText('deadline ' + deadlineMs + ' ms', W - 104, y(deadlineMs) - 5);
  g.fillStyle = '#6b7686'; g.fillText('last 10 s', L, H - 3);
  const now = Date.now();
  const recs = traffic.records;
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i];
    const age = now - r.at;
    if (age > SPAN_MS) break;
    const x = L + (1 - age / SPAN_MS) * (W - L - 4);
    g.fillStyle = r.missed ? '#e5484d' : deviceColor(r.device);
    g.fillRect(x - 1.5, y(r.totalMs) - 1.5, 3, 3);
  }
}

// One bar per recent forward: height = packed tokens / token budget, colour =
// GPU, the number on top = requests that shared it.
export function drawBatches(canvas, stats) {
  const g = fitCanvas(canvas);
  const W = canvas.width, H = canvas.height, B = 14;
  g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
  const batches = stats.recentBatches || [];
  const n = Math.min(batches.length, Math.floor(W / 9));
  const bw = n ? Math.min(24, (W - 8) / n) : 0;
  g.fillStyle = '#1c2330'; g.fillRect(0, 6, W, 1);
  g.font = '9px sans-serif';
  for (let i = 0; i < n; i++) {
    const b = batches[batches.length - n + i];
    const occ = b.budget > 0 ? Math.min(1, b.tokens / b.budget) : 0;
    const h = occ * (H - B - 8);
    const x = 4 + i * bw;
    g.fillStyle = deviceColor(b.device);
    g.fillRect(x, H - B - h, Math.max(1, bw - 2), h);
    if (bw >= 12) { g.fillStyle = '#c9d1dc'; g.fillText(String(b.requests), x + 1, H - B - h - 3); }
  }
  g.fillStyle = '#6b7686';
  g.fillText('each bar is one forward: height = tokens / budget, label = requests packed into it', 4, H - 3);
}

export function renderStats(stats, win, model) {
  const cfg = model.config();
  const s = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  s('#m-inflight', String(traffic.inFlight));
  s('#m-queued', String(stats.queuedRequests));
  s('#m-rps', win.rps.toFixed(0));
  s('#m-p50', win.n ? win.p50.toFixed(1) : '--');
  s('#m-p99', win.n ? win.p99.toFixed(1) : '--');
  s('#m-missed', win.n ? pct(win.missed / win.n) : '--');
  s('#m-batch', stats.forwards ? stats.meanBatchRequests.toFixed(1) : '--');
  s('#m-occ', stats.forwards ? pct(stats.meanOccupancy) : '--');
  s('#m-seen', win.n ? '+' + win.seenMean.toFixed(0) + ' ms' : '--');
  s('#cost-model', `budget ${stats.tokenBudget} tokens/forward for a ${stats.targetForwardMs} ms forward target · ` +
    `cost model ${stats.estFixedMs.toFixed(2)} ms + ${stats.estMsPer1kTokens.toFixed(2)} ms per 1k tokens · ` +
    `${stats.completed} done, ${stats.failed} failed` + (traffic.lastError ? ' · last error: ' + traffic.lastError : ''));
  const dev = $('#devices');
  if (dev.children.length !== stats.devices.length) {
    dev.textContent = '';
    for (const d of stats.devices) {
      const row = el('div', 'dev-row');
      const sw = el('span', 'dev-swatch'); sw.style.background = deviceColor(d.device);
      row.appendChild(sw);
      row.appendChild(el('span', 'dev-name', 'GPU ' + d.device + ' · ' + d.name));
      const track = el('div', 'bar-track'); track.appendChild(el('div', 'bar-fill'));
      row.appendChild(track);
      row.appendChild(el('span', 'dev-val'));
      dev.appendChild(row);
    }
  }
  stats.devices.forEach((d, i) => {
    const row = dev.children[i];
    row.querySelector('.bar-fill').style.width = (100 * Math.min(1, d.busyFraction)).toFixed(1) + '%';
    row.querySelector('.bar-fill').style.background = deviceColor(d.device);
    row.querySelector('.dev-val').textContent = pct(d.busyFraction) + ' busy · ' + d.forwards + ' fwd · ' + d.graphs + ' graphs';
  });
  s('#replicas', cfg.devices.length + (cfg.devices.length === 1 ? ' replica' : ' replicas'));
}
