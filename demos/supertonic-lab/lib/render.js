// ═══ render — the output waveform card ═══════════════════════════════════════
import { $ } from "/app/lib/state.js";
import { el } from "/app/lib/helpers.js";

let card = null;
function ensureCard() {
  if (card) return card;
  const wrap = el('div', 'card');
  wrap.appendChild(el('div', 'card-title', 'audio'));
  wrap.appendChild(el('div', 'card-desc', 'output waveform — 44.1 kHz mono'));
  const body = el('div', 'card-body');
  const cwrap = el('div', 'canvas-wrap');
  const canvas = document.createElement('canvas');
  cwrap.appendChild(canvas);
  body.appendChild(cwrap);
  const note = el('div', 'axis-note');
  body.appendChild(note);
  wrap.appendChild(body);
  $('#stages').appendChild(wrap);
  card = { canvas, ctx: canvas.getContext('2d'), note };
  return card;
}

export function renderWave(d, sr) {
  const c = ensureCard();
  const W = 1120, H = 150, mid = H / 2;
  if (c.canvas.width !== W) c.canvas.width = W;
  if (c.canvas.height !== H) c.canvas.height = H;
  const ctx = c.ctx;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a2230'; ctx.fillRect(0, mid, W, 1);
  const n = d.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = '#9d86e8';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0; const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    ctx.beginPath();
    ctx.moveTo(x, mid - (hi / peak) * mid); ctx.lineTo(x, mid - (lo / peak) * mid + 0.5); ctx.stroke();
  }
  c.note.textContent =
    (n / (sr || 44100)).toFixed(2) + 's · ' + n.toLocaleString() + ' samples · peak ' + peak.toFixed(3);
}
