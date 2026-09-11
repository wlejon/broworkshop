// ═══ takes — every generation, in a strip ═════════════════════════════════════
import { $, takes, takeId, current, setCurrent, FPS } from "/app/lib/state.js";
import { el, fmtSecs, clamp } from "/app/lib/helpers.js";
import { setClip, play, playSamples, saveWavOf } from "/app/lib/audio.js";
import { renderTake } from "/app/lib/render.js";
import { promptFromTake } from "/app/lib/voice.js";
import { clearSelection } from "/app/lib/grid.js";

const KIND_GLYPH = { generate: '▶', pipeline: '⇶', chain: '⛓', reroll: '↻' };

export function mkTake(f) {
  const id = takeId();
  return Object.assign({
    id, kind: 'generate', name: (KIND_GLYPH[f.kind] || '') + ' take ' + id, text: '', codes: null, numFrames: 0,
    samples: null, sampleRate: 24000, unmaskStep: null, commitScore: null, commitConfidence: null,
    stepStats: null, params: {},
    cond: null, promptName: '', changed: null, masked: null, parentId: 0, segments: null,
    lmSeconds: 0, codecSeconds: 0, wallMs: 0, exact: true, createdAt: Date.now(),
  }, f, { id, name: (KIND_GLYPH[f.kind] || '') + ' take ' + id + (f.parentId ? ' ← ' + f.parentId : '') });
}

export function addTake(take, show) {
  takes.push(take);
  renderTakes();
  if (show !== false) showTake(take);
  scrollToLatest();
  return take;
}

export function removeTake(take) {
  const i = takes.indexOf(take); if (i < 0) return;
  takes.splice(i, 1);
  if (current === take) { setCurrent(null); }
  renderTakes();
  scrollTakes(0);
}

// Make a take the one in the grid / waveform / heatmaps, and hear it.
export function showTake(take, silent) {
  setCurrent(take);
  clearSelection();
  setClip(take.samples, take.sampleRate);
  renderTake(take);
  markCurrent();
  scrollToTake(take);
  const p = take.params || {};
  $('#run-meta').textContent = take.name + ' · ' + take.numFrames + ' frames · ' + fmtSecs(take.samples.length, take.sampleRate) +
    ' · ' + p.numSteps + ' steps · seed ' + p.seed + (take.promptName ? ' · voice “' + take.promptName + '”' : '') +
    (take.lmSeconds ? ' · LM ' + take.lmSeconds.toFixed(2) + 's' : '') + ' · ' + take.wallMs + ' ms wall';
  if (!silent) play();
}

// Persistent strip entries keyed by take id (one thumbnail canvas each, drawn once).
const entries = new Map();
export function renderTakes() {
  wireTakeScroll();
  const host = $('#take-list');
  if (!takes.length) {
    host.textContent = '';
    host.appendChild(el('span', 'hint empty', 'no takes yet'));
    entries.clear();
    updateNav();
    return;
  }
  for (const [id, e] of entries) if (!takes.some((t) => t.id === id)) { e.remove(); entries.delete(id); }
  const empty = host.querySelector('.empty'); if (empty) empty.remove();
  for (const t of takes) {
    if (entries.has(t.id)) continue;
    const e = el('div', 'take');
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 36;
    e.appendChild(cv);
    drawThumb(cv, t);
    const name = el('div', 'tname', t.name); name.title = t.text; e.appendChild(name);
    const p = t.params || {};
    e.appendChild(el('div', 'tinfo', t.numFrames + ' fr · ' + fmtSecs(t.samples.length, t.sampleRate) + ' · ' + p.numSteps + ' st · g ' + p.guidanceScale +
      ' · seed ' + p.seed + (t.promptName ? ' · ◉ ' + t.promptName : p.instruct ? ' · “' + p.instruct + '”' : '') +
      (t.segments ? ' · ' + t.segments.length + ' seg' : '') + (t.changed ? ' · ' + countOnes(t.changed) + ' cells changed' : '')));
    e.appendChild(el('div', 'tinfo', '“' + t.text.slice(0, 60) + (t.text.length > 60 ? '…' : '') + '”'));
    const b = el('div', 'tbtns');
    const mk = (label, title, fn, cls) => { const x = el('button', cls || '', label); x.title = title; x.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); b.appendChild(x); };
    mk('▶', 'play this take', () => playSamples(t.samples, t.sampleRate));
    mk('⤓ wav', 'save this take as a .wav', () => saveWavOf(t));
    mk('◉ voice', 'use this take as the voice (createPrompt on its audio + text)', () => promptFromTake(t));
    mk('⊞ grid', 'load this take into the grid', () => showTake(t));
    mk('✕', 'remove', () => removeTake(t), 'x');
    e.appendChild(b);
    e.addEventListener('click', () => showTake(t));
    host.appendChild(e);
    entries.set(t.id, e);
  }
  markCurrent();
  updateNav();
}

function markCurrent() {
  for (const [id, e] of entries) e.classList.toggle('current', !!current && current.id === id);
  updateNav();
}

function countOnes(a) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i]) n++; return n; }

function drawThumb(cv, t) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2, d = t.samples, n = d.length;
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H);
  if (!n) return;
  let peak = 1e-6; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const per = Math.max(1, Math.floor(n / W));
  ctx.strokeStyle = t.kind === 'reroll' ? '#e0b45a' : t.kind === 'chain' ? '#7fd4a6' : '#5aa0e0';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0; const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    ctx.beginPath(); ctx.moveTo(x, mid - (hi / peak) * mid); ctx.lineTo(x, mid - (lo / peak) * mid + 0.5); ctx.stroke();
  }
}

// ── Virtual horizontal scrolling for takes strip ──────────────────────────────
let scrollOffset = 0;
let scrollWired = false;

function getMaxScroll() {
  const vp = $('#take-viewport') || $('#takes');
  const list = $('#take-list');
  if (!vp || !list) return 0;
  const vpW = vp.clientWidth || vp.getBoundingClientRect().width || 800;
  const totalW = list.scrollWidth || (takes.length * 266);
  return Math.max(0, totalW - vpW + 16);
}

export function scrollTakes(delta) {
  const list = $('#take-list');
  if (!list) return;
  const max = getMaxScroll();
  scrollOffset = clamp(scrollOffset + delta, 0, max);
  list.style.transform = 'translateX(' + (-scrollOffset) + 'px)';
  updateNav(max);
}

export function scrollToTake(t) {
  const vp = $('#take-viewport') || $('#takes');
  const list = $('#take-list');
  if (!vp || !list || !t) return;
  const e = entries.get(t.id);
  if (!e) return;
  const vpW = vp.clientWidth || vp.getBoundingClientRect().width || 800;
  const max = getMaxScroll();
  const left = e.offsetLeft;
  const right = left + e.offsetWidth;
  if (left < scrollOffset) {
    scrollOffset = Math.max(0, left - 12);
  } else if (right > scrollOffset + vpW) {
    scrollOffset = Math.min(max, right - vpW + 12);
  }
  list.style.transform = 'translateX(' + (-scrollOffset) + 'px)';
  updateNav(max);
}

export function scrollToLatest() {
  const list = $('#take-list');
  if (!list) return;
  const max = getMaxScroll();
  scrollOffset = max;
  list.style.transform = 'translateX(' + (-scrollOffset) + 'px)';
  updateNav(max);
}

function updateNav(max) {
  const m = max !== undefined ? max : getMaxScroll();
  const btnL = $('#btn-takes-left');
  const btnR = $('#btn-takes-right');
  const countSpan = $('#take-count');
  if (btnL) btnL.disabled = scrollOffset <= 0;
  if (btnR) btnR.disabled = scrollOffset >= m;
  if (countSpan) {
    if (!takes.length) { countSpan.textContent = ''; return; }
    const curIdx = current ? takes.findIndex((t) => t.id === current.id) : -1;
    countSpan.textContent = (curIdx >= 0 ? '#' + (curIdx + 1) + ' of ' : '') + takes.length + (takes.length === 1 ? ' take' : ' takes');
  }
}

export function wireTakeScroll() {
  if (scrollWired) return;
  scrollWired = true;
  const takesSec = $('#takes');
  const vp = $('#take-viewport') || takesSec;
  if (!takesSec || !vp) return;

  // 1. Mouse wheel horizontal scrolling over entire takes section
  takesSec.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const delta = ev.deltaX || ev.deltaY || 0;
    scrollTakes(delta);
  }, { passive: false });

  // 2. Navigation buttons
  const btnL = $('#btn-takes-left');
  const btnR = $('#btn-takes-right');
  if (btnL) btnL.addEventListener('click', () => scrollTakes(-260));
  if (btnR) btnR.addEventListener('click', () => scrollTakes(260));

  // 3. Drag to scroll on viewport
  let isDown = false, startX = 0, startOff = 0;
  vp.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    isDown = true;
    startX = e.clientX;
    startOff = scrollOffset;
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    const max = getMaxScroll();
    scrollOffset = clamp(startOff - dx, 0, max);
    const list = $('#take-list');
    if (list) list.style.transform = 'translateX(' + (-scrollOffset) + 'px)';
    updateNav(max);
  });
  window.addEventListener('mouseup', () => { isDown = false; });

  // 4. Window resize listener
  window.addEventListener('resize', () => {
    scrollTakes(0);
  });
}
