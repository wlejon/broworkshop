// ═══ render — the trace cards (code raster · confidence · waveform) ══════════

// A sequential colormap (dark→blue→green→amber→white-ish) for code ids.
function seqColor(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const stops = [[12, 16, 28], [38, 70, 160], [40, 165, 145], [225, 175, 60], [250, 240, 210]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, x | 0), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
// Confidence color: red (unsure) → amber → green (sure).
function confColor(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = t < 0.5 ? 230 : 230 - (t - 0.5) * 2 * 150;
  const g = t < 0.5 ? 90 + t * 2 * 130 : 220;
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',90)';
}

// Persistent cards, keyed by name; bodies refresh in place.
let cards = {};
function card(name, title, desc) {
  let c = cards[name];
  if (!c) {
    const wrap = el('div', 'card');
    wrap.appendChild(el('div', 'card-title', title));
    if (desc) wrap.appendChild(el('div', 'card-desc', desc));
    const body = el('div', 'card-body');
    wrap.appendChild(body);
    $('#stages').appendChild(wrap);
    c = cards[name] = { wrap, body };
  }
  c.body.textContent = '';
  return c.body;
}
function clearCards(except) {
  for (const k of Object.keys(cards)) {
    if (except && except.indexOf(k) >= 0) continue;
    cards[k].wrap.remove(); delete cards[k];
  }
}

function renderStages(result) {
  const stages = result.stages || [];
  const present = [];
  for (const name of STAGE_ORDER) {
    const s = stages.find((x) => x.name === name);
    if (!s) continue;
    present.push(name);
    const info = STAGE_INFO[name];
    const body = card(name, name, info.desc);
    if (info.kind === 'codes') renderCodes(body, s);
    else if (info.kind === 'conf') renderConf(body, s);
  }
  // the waveform always, from the returned samples
  present.push('audio');
  renderWave(card('audio', 'audio', 'output waveform — ' + (result.sampleRate / 1000) + ' kHz mono'),
             result.samples);
  clearCards(present);
}

// 16 x F RVQ codes — one row per codebook, color = code id (per-row normalized so
// the semantic row and the acoustic rows are each legible).
function renderCodes(body, s) {
  const W = Math.min(1120, Math.max(360, s.w * 8)), rowH = 15, H = s.h * rowH;
  const cv = mkCanvas(body, W, H), ctx = cv.getContext('2d');
  // per-row min/max
  const lo = new Float32Array(s.h), hi = new Float32Array(s.h);
  for (let r = 0; r < s.h; r++) {
    let mn = Infinity, mx = -Infinity; const base = r * s.w;
    for (let x = 0; x < s.w; x++) { const v = s.data[base + x]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo[r] = mn; hi[r] = mx;
  }
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const r = Math.min(s.h - 1, (y / rowH) | 0), base = r * s.w, span = (hi[r] - lo[r]) || 1;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(s.w - 1, (x * s.w / W) | 0);
      const c = seqColor((s.data[base + sx] - lo[r]) / span);
      const o = (y * W + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // row separators + labels
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let r = 1; r < s.h; r++) ctx.fillRect(0, r * rowH, W, 1);
  body.appendChild(el('div', 'axis-note', s.h + ' codebooks × ' + s.w + ' frames · row 0 = semantic (Talker), 1–' + (s.h - 1) + ' = acoustic (Code Predictor)'));
}

// 1 x F confidence — bars colored + heighted by the Talker's top-1 probability.
function renderConf(body, s) {
  const W = Math.min(1120, Math.max(360, s.w * 8)), H = 90;
  const cv = mkCanvas(body, W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  const n = s.w, bw = W / n;
  let mn = 1, mx = 0, sum = 0;
  for (let i = 0; i < n; i++) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  for (let i = 0; i < n; i++) {
    const v = s.data[i], h = Math.max(1, v * (H - 2));
    ctx.fillStyle = confColor(v);
    ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h);
  }
  body.appendChild(el('div', 'axis-note',
    'top-1 prob per frame · min ' + mn.toFixed(2) + ' · mean ' + (sum / n).toFixed(2) + ' · max ' + mx.toFixed(2) +
    ' — red dips are where the model hedged'));
}

function renderWave(body, d) {
  const W = 1120, H = 120, mid = H / 2;
  const cv = mkCanvas(body, W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, W, H);
  const n = d.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6; for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = '#5aa0e0';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0; const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    ctx.beginPath();
    ctx.moveTo(x, mid - (hi / peak) * mid); ctx.lineTo(x, mid - (lo / peak) * mid + 0.5); ctx.stroke();
  }
}

// ── live stream meter: chunks arriving + the growing waveform ───────────────
function renderStreamMeter() {
  clearCards(['stream']);
  const body = card('stream', 'streaming', CHUNK_FRAMES + ' frames/chunk · audio plays as it generates');
  let total = 0; for (const c of streamAccum) total += c.length;
  body.appendChild(el('div', 'axis-note',
    streamFrames + ' chunks · ' + (total / (lastResult ? lastResult.sampleRate : 24000)).toFixed(2) + 's so far'));
  if (!total) return;
  const flat = new Float32Array(total);
  let o = 0; for (const c of streamAccum) { flat.set(c, o); o += c.length; }
  renderWave(body, flat);
}
