// ═══ rendering ═══════════════════════════════════════════════════════════════
// The waveform-with-tokens timeline: the source PCM drawn as a min/max
// envelope, and (after a run) every emitted token pinned at its encoder-frame
// timestamp — a tick into the waveform plus the piece text on one of two
// staggered label rows below.

import { $, TARGET_RATE } from "/app/lib/state.js";
import { model, tok } from "/app/lib/model.js";

const TL_H = 150;      // canvas height
const WAVE_H = 84;     // waveform band height
const LABEL_ROWS = 2;  // staggered token-label rows

function timelineCanvas() {
  const host = $('#timeline');
  let cv = host.querySelector('canvas');
  const w = Math.max(320, host.clientWidth || $('#stages').clientWidth - 8);
  if (!cv) {
    cv = document.createElement('canvas');
    host.appendChild(cv);
  }
  if (cv.width !== w || cv.height !== TL_H) { cv.width = w; cv.height = TL_H; }
  return cv;
}

// Draw the waveform, and the token pins when `result` is non-null.
export function drawTimeline(samples, result) {
  if (!samples || !samples.length) return;
  $('#timeline-head').style.display = '';
  const cv = timelineCanvas();
  const g = cv.getContext('2d');
  const W = cv.width, mid = 14 + WAVE_H / 2;
  g.fillStyle = '#0a0d12';
  g.fillRect(0, 0, W, TL_H);

  // time ruler (top edge)
  const secs = samples.length / TARGET_RATE;
  g.fillStyle = '#4f586a';
  g.font = '10px monospace';
  const step = secs > 12 ? 2 : secs > 6 ? 1 : 0.5;
  g.strokeStyle = '#161c26';
  for (let t = 0; t <= secs; t += step) {
    const x = (t / secs) * (W - 2) + 1;
    g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 14 + WAVE_H); g.stroke();
    g.fillText(t.toFixed(step < 1 ? 1 : 0) + 's', x + 2, 9);
  }

  // min/max envelope
  g.strokeStyle = '#3d6f8f';
  g.beginPath();
  const spp = samples.length / (W - 2);
  for (let x = 0; x < W - 2; x++) {
    let mn = 1, mx = -1;
    const a = Math.floor(x * spp), b = Math.min(samples.length, Math.ceil((x + 1) * spp));
    for (let i = a; i < b; i++) { const v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn > mx) { mn = 0; mx = 0; }
    g.moveTo(x + 1, mid - mx * (WAVE_H / 2 - 2));
    g.lineTo(x + 1, mid - mn * (WAVE_H / 2 - 2) + 0.5);
  }
  g.stroke();

  if (!result || !result.tokenIds.length || !tok) return;

  // token pins: a tick at each emission time + the piece text on staggered rows
  const fs = model.frameSeconds;
  g.font = '11px monospace';
  for (let i = 0; i < result.tokenIds.length; i++) {
    const t = result.tokenFrames[i] * fs;
    const x = Math.min(W - 2, (t / secs) * (W - 2) + 1);
    const row = i % LABEL_ROWS;
    const y = 14 + WAVE_H + 16 + row * 16;
    g.strokeStyle = '#2e7d5b';
    g.beginPath(); g.moveTo(x, 14 + WAVE_H); g.lineTo(x, y - 9); g.stroke();
    const piece = tok.decode([result.tokenIds[i]]);
    g.fillStyle = '#7fd99a';
    g.fillText(piece.trim() || '·', x + 1, y);
  }
}

// The raw-emissions table: start time · piece · id.
export function renderTokenTable(result) {
  const host = $('#tokens');
  host.innerHTML = '';
  $('#tokens-head').style.display = result && result.tokenIds.length ? '' : 'none';
  if (!result || !result.tokenIds.length) return;
  const fs = model.frameSeconds;
  const table = document.createElement('table');
  table.className = 'tok-table';
  for (let i = 0; i < result.tokenIds.length; i++) {
    const tr = document.createElement('tr');
    const td = (cls, text) => {
      const d = document.createElement('td');
      d.className = cls; d.textContent = text; tr.appendChild(d);
    };
    td('t', (result.tokenFrames[i] * fs).toFixed(2) + 's');
    td('piece', tok.decode([result.tokenIds[i]]) || '·');
    td('id', String(result.tokenIds[i]));
    table.appendChild(tr);
  }
  host.appendChild(table);
}
