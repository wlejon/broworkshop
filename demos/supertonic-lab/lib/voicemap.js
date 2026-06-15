// ═══ VOICE MAP — drag in the palette's principal plane ═══════════════════════
// A 2D view of the PCA voice basis (design.js): the 10 presets are dots placed by
// their projection onto the top two principal components (PC0 horizontal ≈ gender/
// pitch, PC1 vertical), female/male tinted. Drag anywhere to author a voice by
// position — the cursor's σ coordinates set the pc0/pc1 basis sliders via
// design.setBasis(), so the map and the BASIS sliders are two views of one control.
// Reads design.basisInfo() for the dot coordinates and redraws on 'design-update'.

import { $ } from "/app/lib/state.js";
import { basisInfo, setBasis } from "/app/lib/design.js";
import { scheduleLive } from "/app/lib/synth.js";

const PAD = 22;        // px border inside the canvas
const EXT = 2.4;       // σ shown to each edge (so ±2σ presets sit comfortably inside)
const CX = 0, CY = 1;  // principal components on the x / y axes

let cv = null, ctx = null;

function evtXY(e) {
  const r = cv.getBoundingClientRect();
  const px = (e.offsetX != null ? e.offsetX : (e.clientX - r.left));
  const py = (e.offsetY != null ? e.offsetY : (e.clientY - r.top));
  return [px, py];
}
function pxToSigma(px, py) {
  const w = cv.width, h = cv.height, clamp = (v) => Math.max(-EXT, Math.min(EXT, v));
  return [
    clamp((px - PAD) / (w - 2 * PAD) * (2 * EXT) - EXT),
    clamp(EXT - (py - PAD) / (h - 2 * PAD) * (2 * EXT)),     // invert y (up = +)
  ];
}
function sigToPx(ax, ay) {
  const w = cv.width, h = cv.height;
  return [PAD + (ax + EXT) / (2 * EXT) * (w - 2 * PAD), PAD + (EXT - ay) / (2 * EXT) * (h - 2 * PAD)];
}

export function buildVoiceMap() {
  cv = $('#voicemap'); if (!cv) return;
  ctx = cv.getContext('2d');
  let dragging = false;
  const place = (e) => { const [px, py] = evtXY(e); const [ax, ay] = pxToSigma(px, py); setBasis(CX, ax, CY, ay); draw(); scheduleLive(); };
  cv.addEventListener('mousedown', (e) => { dragging = true; place(e); });
  cv.addEventListener('mousemove', (e) => { if (dragging) place(e); });
  document.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('design-update', draw);
  draw();
}

export function draw() {
  if (!ctx) return;
  const w = cv.width, h = cv.height, info = basisInfo();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e131b'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1c2533'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const [ox, oy] = sigToPx(0, 0);
  ctx.strokeStyle = '#202a38';
  ctx.beginPath(); ctx.moveTo(PAD, oy); ctx.lineTo(w - PAD, oy); ctx.moveTo(ox, PAD); ctx.lineTo(ox, h - PAD); ctx.stroke();
  ctx.fillStyle = '#6b7585'; ctx.font = '9px sans-serif';
  ctx.fillText('pc0 →', w - PAD - 30, oy - 4); ctx.fillText('pc1', ox + 4, PAD + 8);
  if (!info) { ctx.fillStyle = '#6b7585'; ctx.font = '11px sans-serif'; ctx.fillText('load a model', PAD, h / 2); return; }

  ctx.font = '10px sans-serif';
  for (let i = 0; i < info.names.length; i++) {
    const c = info.coords[i], nm = info.names[i];
    const [px, py] = sigToPx(c[CX] || 0, c[CY] || 0);
    ctx.fillStyle = /^f/i.test(nm) ? '#ff9ec4' : '#86b8ff';
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#9aa6b6'; ctx.fillText(nm, px + 6, py + 3);
  }
  // current authored position from the pc sliders (slider ±1 == ±2σ)
  const sx = (parseFloat(($('#pc' + CX) || {}).value) || 0) * 2;
  const sy = (parseFloat(($('#pc' + CY) || {}).value) || 0) * 2;
  const [hx, hy] = sigToPx(sx, sy);
  ctx.strokeStyle = '#b39dff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - 9, hy); ctx.lineTo(hx + 9, hy); ctx.moveTo(hx, hy - 9); ctx.lineTo(hx, hy + 9); ctx.stroke();
}
