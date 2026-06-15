// ═══ VOICE MAP — the primary voice designer ══════════════════════════════════
// A 2D view of the palette's voice space (design.js): PC0 horizontal (≈ gender/
// pitch — femme right, masc left), PC1 vertical. The 10 presets are landmarks
// (F*/M* tinted); drag anywhere — including well past the presets, where the model
// still holds — to author a voice by position. The crosshair is the current voice;
// its absolute σ coordinates are the pc0/pc1 targets in design.setBasis(). Reads
// design.basisInfo() and redraws on 'design-update'.

import { $ } from "/app/lib/state.js";
import { basisInfo, setBasis } from "/app/lib/design.js";
import { scheduleLive } from "/app/lib/synth.js";

const PAD = 30;
let cv = null, ctx = null, EXT = 6;

function evtXY(e) {
  const r = cv.getBoundingClientRect();
  return [(e.offsetX != null ? e.offsetX : e.clientX - r.left), (e.offsetY != null ? e.offsetY : e.clientY - r.top)];
}
function pxToSigma(px, py) {
  const w = cv.width, h = cv.height, cl = (v) => Math.max(-EXT, Math.min(EXT, v));
  return [cl((px - PAD) / (w - 2 * PAD) * (2 * EXT) - EXT), cl(EXT - (py - PAD) / (h - 2 * PAD) * (2 * EXT))];
}
function sigToPx(ax, ay) {
  const w = cv.width, h = cv.height;
  return [PAD + (ax + EXT) / (2 * EXT) * (w - 2 * PAD), PAD + (EXT - ay) / (2 * EXT) * (h - 2 * PAD)];
}

export function buildVoiceMap() {
  cv = $('#voicemap'); if (!cv) return;
  ctx = cv.getContext('2d');
  let dragging = false;
  const place = (e) => { const [px, py] = evtXY(e); const [ax, ay] = pxToSigma(px, py); setBasis(ax, ay); draw(); scheduleLive(); };
  cv.addEventListener('mousedown', (e) => { dragging = true; place(e); });
  cv.addEventListener('mousemove', (e) => { if (dragging) place(e); });
  document.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('design-update', draw);
  draw();
}

export function draw() {
  if (!ctx) return;
  const w = cv.width, h = cv.height, info = basisInfo();
  if (info) EXT = info.range || 6;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1119'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1c2533'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  // σ grid + origin cross
  ctx.strokeStyle = '#161d28'; ctx.lineWidth = 1;
  for (let s = -EXT + 1; s < EXT; s++) { const [gx] = sigToPx(s, 0), [, gy] = sigToPx(0, s); ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, h - PAD); ctx.moveTo(PAD, gy); ctx.lineTo(w - PAD, gy); ctx.stroke(); }
  const [ox, oy] = sigToPx(0, 0);
  ctx.strokeStyle = '#27313f'; ctx.beginPath(); ctx.moveTo(PAD, oy); ctx.lineTo(w - PAD, oy); ctx.moveTo(ox, PAD); ctx.lineTo(ox, h - PAD); ctx.stroke();

  ctx.fillStyle = '#6b7585'; ctx.font = '10px sans-serif';
  ctx.fillText('← masc', PAD + 2, oy - 5); ctx.fillText('femme →', w - PAD - 48, oy - 5);
  ctx.fillText('pc1 ↑', ox + 5, PAD + 10);

  if (!info) { ctx.fillStyle = '#6b7585'; ctx.font = '12px sans-serif'; ctx.fillText('load a model', PAD, h / 2); return; }

  // preset landmarks
  ctx.font = '11px sans-serif';
  for (let i = 0; i < info.names.length; i++) {
    const c = info.coords[i], nm = info.names[i], [px, py] = sigToPx(c[0] || 0, c[1] || 0);
    ctx.fillStyle = /^f/i.test(nm) ? '#ff9ec4' : '#86b8ff';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#aab4c2'; ctx.fillText(nm, px + 7, py + 4);
  }
  // current authored position
  const [hx, hy] = sigToPx(info.pos[0], info.pos[1]);
  ctx.strokeStyle = '#c4b5ff'; ctx.fillStyle = 'rgba(179,157,255,0.18)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - 13, hy); ctx.lineTo(hx + 13, hy); ctx.moveTo(hx, hy - 13); ctx.lineTo(hx, hy + 13); ctx.stroke();
}
