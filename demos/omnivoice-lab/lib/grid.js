// ═══ grid — the 8 x T token grid: selection, codebook ticks, the re-roll tools ═
// The grid is the model's actual output (row = codebook, column = frame at
// 25 fps), drawn under the waveform on the same time axis. Drag across it to
// select a span; tick the codebooks the re-roll may touch; the presets build an
// init grid from that and hand it to edit.js.
import { $, NQ, current, busy } from "/app/lib/state.js";
import { el, clamp } from "/app/lib/helpers.js";
import { W, GX, xFrame, redrawOverlays, setCursor, frameTime } from "/app/lib/render.js";
import { reroll } from "/app/lib/edit.js";
import { playSpan } from "/app/lib/audio.js";

export let sel = null;                       // { t0, t1 } frames, t1 exclusive
export const cbs = [1, 1, 1, 1, 1, 1, 1, 1]; // codebooks a re-roll may touch
export let showChanges = true;

export function setSelection(t0, t1) {
  if (!current) { sel = null; redrawOverlays(); return; }
  const T = current.numFrames;
  t0 = clamp(t0 | 0, 0, T); t1 = clamp(t1 | 0, 0, T);
  if (t1 < t0) { const x = t0; t0 = t1; t1 = x; }
  sel = t1 > t0 ? { t0, t1 } : null;
  syncTools();
  redrawOverlays();
}
export function clearSelection() { sel = null; syncTools(); redrawOverlays(); }
export function setCodebooks(list) {
  // an array of 0/1 per codebook, or a list of indices
  if (list.length === NQ && list.every((v) => v === 0 || v === 1 || v === true || v === false)) for (let q = 0; q < NQ; q++) cbs[q] = list[q] ? 1 : 0;
  else { cbs.fill(0); for (const q of list) if (q >= 0 && q < NQ) cbs[q] = 1; }
  syncTools(); redrawOverlays();
}
export function setShowChanges(v) { showChanges = !!v; syncTools(); redrawOverlays(); }

// The re-mask grid (1 = regenerate, 0 = keep) for a preset, or null + a reason.
export function rerollMask(preset) {
  if (!current) return { mask: null, why: 'no take in the grid' };
  const T = current.numFrames, mask = new Uint8Array(NQ * T);
  if (preset === 'acoustics') {
    for (let q = 1; q < NQ; q++) mask.fill(1, q * T, (q + 1) * T);
    return { mask, why: '' };
  }
  if (!sel) return { mask: null, why: 'drag a span on the grid first' };
  if (!cbs.some(Boolean)) return { mask: null, why: 'tick at least one codebook' };
  if (preset === 'span') {
    for (let q = 0; q < NQ; q++) if (cbs[q]) mask.fill(1, q * T + sel.t0, q * T + sel.t1);
  } else if (preset === 'around') {
    mask.fill(1);
    for (let q = 0; q < NQ; q++) if (cbs[q]) mask.fill(0, q * T + sel.t0, q * T + sel.t1);
  } else return { mask: null, why: 'unknown preset ' + preset };
  return { mask, why: '' };
}

// ── the tools row above the grid canvas ──────────────────────────────────────
let tools = null;   // { ticks: [input], seed, show, note }
export function buildGridTools(host) {
  host.textContent = '';
  const ticks = [];
  host.appendChild(el('span', 'meta', 'codebooks'));
  for (let q = 0; q < NQ; q++) {
    const l = el('label', 'cbtick');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!cbs[q];
    c.title = 'codebook ' + q + (q === 0 ? ' (semantic — unmasks first)' : ' (acoustic)');
    c.addEventListener('change', () => { cbs[q] = c.checked ? 1 : 0; syncTools(); redrawOverlays(); });
    l.appendChild(c); l.appendChild(el('span', null, 'q' + q));
    host.appendChild(l); ticks.push(c);
  }
  const quick = (label, title, list) => { const b = el('button', 'mini', label); b.title = title; b.addEventListener('click', () => setCodebooks(list)); host.appendChild(b); };
  quick('all', 'tick every codebook', [0, 1, 2, 3, 4, 5, 6, 7]);
  quick('1–7', 'the acoustic codebooks only', [1, 2, 3, 4, 5, 6, 7]);
  quick('0', 'the semantic codebook only', [0]);
  host.appendChild(el('span', 'meta', '·'));
  const preset = (label, title, name, cls) => { const b = el('button', 'mini ' + (cls || ''), label); b.title = title; b.addEventListener('click', () => reroll(name)); host.appendChild(b); return b; };
  const spanBtns = [];
  preset('↻ acoustics', 'keep codebook 0 everywhere, re-roll codebooks 1..7 (same words, new acoustics)', 'acoustics');
  const bSpan = preset('↻ span', 'keep everything but the selected span on the ticked codebooks — re-roll that', 'span', 'span-req');
  const bAround = preset('↻ around span', 'keep only the selected span (ticked codebooks) and re-roll everything else', 'around', 'span-req');
  spanBtns.push(bSpan, bAround);
  host.appendChild(el('span', 'meta', 'seed'));
  const seed = document.createElement('input'); seed.type = 'number'; seed.id = 'reroll-seed'; seed.min = '0'; seed.step = '1'; seed.value = '1';
  seed.title = 'the re-roll\'s seed — the same seed over the same init grid reproduces the re-roll';
  host.appendChild(seed);
  const dice = el('button', 'mini', '🎲'); dice.title = 'a random re-roll seed';
  dice.addEventListener('click', () => { seed.value = String((Math.random() * 1e9) | 0); });
  host.appendChild(dice);
  const show = el('label', 'lock'); const sc = document.createElement('input'); sc.type = 'checkbox'; sc.checked = showChanges;
  sc.addEventListener('change', () => setShowChanges(sc.checked));
  show.appendChild(sc); show.appendChild(el('span', null, 'show changes')); show.title = 'dim the re-rolled cells that came back unchanged, so the changed ones stand out';
  host.appendChild(show);
  const ps = el('button', 'mini span-req', '▶ span'); ps.title = 'play the selected span';
  ps.addEventListener('click', () => { if (sel) playSpan(sel.t0, sel.t1); });
  host.appendChild(ps); spanBtns.push(ps);
  const cl = el('button', 'mini span-req', '✕ span'); cl.title = 'clear the selection';
  cl.addEventListener('click', clearSelection);
  host.appendChild(cl); spanBtns.push(cl);
  const note = el('span', 'meta', ''); host.appendChild(note);
  tools = { ticks, seed, show: sc, note, spanBtns };
  syncTools();
}
export function rerollSeed() { return tools ? Math.max(0, +tools.seed.value | 0) : 1; }
export function setRerollSeed(v) { if (tools) tools.seed.value = String(v | 0); }
function syncTools() {
  if (!tools) return;
  for (let q = 0; q < NQ; q++) tools.ticks[q].checked = !!cbs[q];
  tools.show.checked = showChanges;
  const hasSel = !!sel;
  for (const b of tools.spanBtns) b.classList.toggle('active-sel', hasSel);
  tools.note.textContent = sel ? 'span ' + sel.t0 + '–' + sel.t1 + ' (' + frameTime(sel.t0).toFixed(2) + '–' + frameTime(sel.t1).toFixed(2) + ' s, ' + (sel.t1 - sel.t0) + ' fr) × ' + cbs.reduce((a, b) => a + b, 0) + ' codebooks'
                                : 'drag on the grid or the waveform to select a span';
}

// ── mouse: hover readout + drag-select (shared by the grid and the waveform) ──
let drag = null;   // { canvas, t0 }
function canvasXY(ev, canvas) {
  const r = canvas.getBoundingClientRect();
  return [(ev.clientX - r.left) * (canvas.width / (r.width || canvas.width)),
          (ev.clientY - r.top) * (canvas.height / (r.height || canvas.height))];
}
export function wireSelectable(canvas, rowH) {
  canvas.style.cursor = 'crosshair';
  canvas.addEventListener('mousedown', (ev) => {
    if (!current) return;
    ev.preventDefault();
    const [x] = canvasXY(ev, canvas);
    if (x < GX) return;
    drag = { canvas, t0: xFrame(x, current.numFrames), moved: false };
    setSelection(drag.t0, drag.t0 + 1);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!current) return;
    const [x, y] = canvasXY(ev, canvas);
    const T = current.numFrames;
    if (x < GX) { setCursor(-1); return; }
    const f = xFrame(x, T);
    let info = '';
    if (rowH) {
      const q = clamp((y / rowH) | 0, 0, NQ - 1), i = q * T + f;
      const code = current.codes[i], st = current.unmaskStep ? current.unmaskStep[i] : -2;
      const sc = current.commitScore ? current.commitScore[i] : NaN;
      info = ' · q' + q + ' = ' + code + (st === -1 ? ' · kept' : st >= 0 ? ' · committed at step ' + st : '') +
             (sc === sc ? ' · score ' + sc.toFixed(2) : '') + (current.changed && current.changed[i] ? ' · CHANGED' : '');
    } else {
      const s = current.samples, a = Math.floor(f * s.length / T), b = Math.min(s.length, Math.floor((f + 1) * s.length / T));
      let peak = 0; for (let i = a; i < b; i++) { const v = Math.abs(s[i]); if (v > peak) peak = v; }
      info = ' · peak ' + peak.toFixed(3);
    }
    setCursor(f, info);
  });
  canvas.addEventListener('mouseout', () => setCursor(-1));
}
// One global pair so re-rendered cards never leak listeners.
export function onDocMouseMove(ev) {
  if (!drag || !current) return;
  const [x] = canvasXY(ev, drag.canvas);
  const f = xFrame(x, current.numFrames);
  drag.moved = true;
  setSelection(Math.min(drag.t0, f), Math.max(drag.t0, f) + 1);
}
export function onDocMouseUp() { drag = null; }
