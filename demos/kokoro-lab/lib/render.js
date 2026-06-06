// ═══ render ════════════════════════════════════════════════════════════════
// hoist the editable prosody surfaces + waveform to the top (see STAGE_ORDER);
// stable for any stage the order list doesn't name (keeps emit order).
function orderStages(stages) {
  const rank = (n) => { const i = STAGE_ORDER.indexOf(n); return i < 0 ? STAGE_ORDER.length : i; };
  return stages
    .map((s, i) => [s, i])
    .sort((a, b) => (rank(a[0].name) - rank(b[0].name)) || (a[1] - b[1]))
    .map((x) => x[0]);
}

// Stages render once into persistent cards, then refresh IN PLACE on every
// re-decode — the stage tree is never torn down. The card the user is editing
// (or just edited) holds the truth they drew, so its body is left exactly as-is
// while every downstream stage regenerates from the new data.
//
// The heatmap stages are by far the most expensive thing here — a per-pixel
// ImageData build plus a full-array stats pass, for several large grids. The
// timing editor doesn't need them live (it cares about the cells + audio), so it
// renders with deferHeat = true (leave the heatmaps on their last image, cheap)
// and repaints them once, coalesced, when the edits settle (scheduleHeatRefresh).
let deferHeat = false;     // skip heatmap stages this pass (set by the timing editor)
let heatTimer = 0;         // coalesce the deferred heatmap repaint

function renderStages(stages) {
  const ordered = orderStages(stages);
  const sig = ordered.map((s) => s.name).join('|');
  if (!stageCards || sig !== stageSig) { buildStages(ordered, sig); return; }

  const protect = (activePaint && activePaint.s && activePaint.s.name) ||
                  (activeDrag && activeDrag.s && activeDrag.s.name) || protectedStage;
  flowStages = [];
  selPhoneme = -1;
  $('#sel-label').textContent = '';
  for (const s of ordered) {
    const cell = stageCards[s.name];
    if (!cell) { buildStages(ordered, sig); return; }   // unexpected stage set — full rebuild
    if (s.name === protect) { registerFlow(cell.body, cell.info); continue; }   // leave the edited canvas alone
    // expensive heatmaps: keep the last image, just re-register its overlay so
    // the data-flow highlight still works on the (stale) picture.
    if (deferHeat && cell.info.kind === 'heat') { registerFlow(cell.body, cell.info); continue; }
    updateHead(cell, s);
    cell.body.textContent = '';
    paintBody(cell.body, s, cell.info);
    registerFlow(cell.body, cell.info);
  }
}

// Re-render the cheap stages now (cells / curves / waveform), leaving the
// heatmaps untouched — for the timing editor's hot loop, so a pause between
// edits never triggers a multi-hundred-millisecond per-pixel repaint.
function renderStagesLight(stages) {
  deferHeat = true;
  try { renderStages(stages); } finally { deferHeat = false; }
}

// Once the edits stop, repaint the heatmaps a single time so they catch up with
// the final timing. Coalesced: each new edit pushes it out, so it only fires
// when the user actually pauses — never during active editing.
function scheduleHeatRefresh() {
  if (heatTimer) clearTimeout(heatTimer);
  heatTimer = setTimeout(() => {
    heatTimer = 0;
    if (!lastTrace) return;
    protectedStage = 'pred_dur';        // keep the live cells (and any focus) intact
    const sc = $('#stages').scrollTop;
    renderStages(lastTrace.stages);     // full repaint, heatmaps included
    $('#stages').scrollTop = sc;
    protectedStage = null;
  }, 350);
}

// First render (or whenever the stage set changes): build the cards fresh.
function buildStages(ordered, sig) {
  const root = $('#stages');
  root.textContent = '';
  flowStages = [];
  selPhoneme = -1;
  $('#sel-label').textContent = '';
  stageCards = {};
  stageSig = sig;
  for (const s of ordered) {
    const info = STAGE_INFO[s.name] || { kind: 'heat', desc: '' };
    const card = el('div', 'stage');
    const head = el('div', 'stage-head');
    head.appendChild(el('span', 'stage-name', s.name));
    const shapeEl = el('span', 'stage-shape', '');
    head.appendChild(shapeEl);
    head.appendChild(el('span', 'stage-desc', info.desc));
    const statsEl = el('span', 'stage-stats', '');
    head.appendChild(statsEl);
    card.appendChild(head);
    const body = el('div', 'stage-body');
    card.appendChild(body);
    root.appendChild(card);
    const cell = { card, body, info, shapeEl, statsEl };
    stageCards[s.name] = cell;
    updateHead(cell, s);
    paintBody(body, s, info);
    registerFlow(body, info);
  }
}

function updateHead(cell, s) {
  cell.shapeEl.textContent = s.h + ' x ' + s.w;
  const st = stats(s.data);
  cell.statsEl.textContent =
    'min ' + st.mn.toFixed(2) + '  max ' + st.mx.toFixed(2) + '  μ ' + st.mean.toFixed(2);
}

function paintBody(body, s, info) {
  try {
    if (info.kind === 'chips')      renderChips(body, s);
    else if (info.kind === 'align') renderAlign(body, s);
    else if (info.kind === 'curve') renderCurve(body, s, info.color || '#8ad9ff');
    else if (info.kind === 'wave')  renderWave(body, s);
    else                            renderHeat(body, s);
  } catch (e) {
    body.appendChild(el('div', 'axis-note', 'render error: ' + e.message));
  }
}

// (Re)register a stage for the data-flow highlight from its current DOM.
// Three shapes: phoneme chips and the pred_dur cell row both highlight a single
// per-phoneme element (the cells wire their own listeners in renderAlign, so we
// only collect them here — re-collecting on a protected re-render never doubles
// a binding); canvas stages carry a positioned overlay we resize to the span.
function registerFlow(body, info) {
  if (!info || !info.flow) return;
  if (info.flow.axis === 'chip') {
    const chips = [...body.querySelectorAll('.chip')];
    chips.forEach((c, i) => c.addEventListener('click', () => selectPhoneme(i)));
    flowStages.push({ flow: info.flow, items: chips });
  } else if (body._alignCells) {
    flowStages.push({ flow: info.flow, items: body._alignCells });
  } else {
    const cv = body.querySelector('canvas');
    if (cv && cv._overlay) flowStages.push({ flow: info.flow, overlay: cv._overlay });
  }
}

// Trace one phoneme through the whole pipeline: highlight its territory at
// every stage. Symbol-time stages light the phoneme's column/row; frame-time
// stages light its duration span. Click the same phoneme again to clear.
function selectPhoneme(l) {
  selPhoneme = (l === selPhoneme) ? -1 : l;
  const dur = lastTrace ? lastTrace.durations : null;
  const L = dur ? dur.length : 0;
  let total = 0; for (let i = 0; i < L; i++) total += dur[i];

  for (const fs of flowStages) {
    if (fs.items) {                          // chips or pred_dur cells: light element l
      fs.items.forEach((c, i) => c.classList.toggle('sel', i === selPhoneme));
      continue;
    }
    const ov = fs.overlay;
    if (selPhoneme < 0 || !dur || !total) { ov.style.display = 'none'; continue; }
    let p0, p1;
    if (fs.flow.time === 'sym') { p0 = selPhoneme / L; p1 = (selPhoneme + 1) / L; }
    else { let s = 0; for (let i = 0; i < selPhoneme; i++) s += dur[i]; p0 = s / total; p1 = (s + dur[selPhoneme]) / total; }
    ov.style.display = 'block';
    if (fs.flow.axis === 'y') {
      ov.style.left = '0'; ov.style.right = '0'; ov.style.width = '';
      ov.style.top = (p0 * 100) + '%'; ov.style.height = ((p1 - p0) * 100) + '%';
    } else {
      ov.style.top = '0'; ov.style.bottom = '0'; ov.style.height = '';
      ov.style.left = (p0 * 100) + '%'; ov.style.width = ((p1 - p0) * 100) + '%';
    }
  }

  const lab = $('#sel-label');
  if (selPhoneme < 0 || !lastTrace) lab.textContent = '';
  else lab.textContent = 'tracing phoneme #' + selPhoneme +
    ' · id ' + (lastTrace.stages[0].data[selPhoneme] | 0) +
    ' · ' + (dur ? dur[selPhoneme] : 0) + ' frames';

  // hear what you just lit up: play this phoneme's slice of the waveform
  if (selPhoneme >= 0 && dur && total) playPhonemeSegment(selPhoneme, dur, total);
}

// Play just one phoneme's audio. Its frame span maps proportionally onto the
// published clip (same time axis, different sample rate), so we trigger the
// existing clip and restrict playback to that sub-region — no re-upload.
function playPhonemeSegment(l, dur, total) {
  if (clipId < 0 || !audioCtx || !clipSamples) return;
  let s = 0; for (let i = 0; i < l; i++) s += dur[i];
  const a = Math.floor((s / total) * clipSamples);
  const b = Math.max(a + 1, Math.floor(((s + dur[l]) / total) * clipSamples));
  try {
    const pb = audioCtx.playClip(clipId, 1.0, false);
    audioCtx.setPlaybackRegion(pb, a, b);
  } catch (e) { setBadge('audio: ' + e.message, true); }
}

function renderChips(body, s) {
  const wrap = el('div', 'chips');
  for (let i = 0; i < s.data.length; i++)
    wrap.appendChild(el('span', 'chip', String(s.data[i] | 0)));
  body.appendChild(wrap);
}

