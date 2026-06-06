// pred_dur — the alignment (symbol time -> frame time): how many output frames
// each phoneme is held for. Rendered as a row of editable CELLS, not a canvas:
// one cell per phoneme, its width proportional to its frame count so the row
// still reads left-to-right as a timeline, but the number is real, selectable
// text you can change directly.
//
// Edit a cell three ways — type a value, scroll the wheel (±1, shift ±5), or
// drag it vertically (up = longer). Every edit updates the cells live and cheap,
// then asks for a re-decode. There is NO debounce: the decode runs on a
// background thread (bro.tts.decodeFrom), so editing never blocks. The pump is
// latest-wins — while a decode is in flight, new edits just mark the target
// dirty; when it lands it plays and immediately chases the newest durWork. You
// hear each render as it finishes while you keep scrubbing. The expensive
// pipeline repaint (heatmaps / curves) is held back until the edits settle, so
// the hot loop stays cheap. Click a cell (without dragging) still traces it.

let durWork = null;        // live working copy of the per-phoneme frame counts
let durPending = false;    // an edit is waiting to be (re-)decoded — latest wins

// Reflect work[i] back onto cell i — number, proportional width, running sum.
// Cheap (text + a style toggle); no synthesis, no pipeline repaint.
function updateAlignCell(cells, i) {
  const c = cells[i]; if (!c) return;
  c._input.value = String(durWork[i]);
  c.style.flexGrow = String(durWork[i]);
  if (c._sum) {
    let t = 0; for (let k = 0; k < durWork.length; k++) t += durWork[k];
    c._sum.textContent = t | 0;
  }
}

// An edit happened: mark the latest timing dirty and kick the async pump.
function requestDuration() {
  durPending = true;
  pumpDuration();
}

// Launch ONE background re-decode of the current durWork if the model is free.
// Mirrors commitDuration's prep (length-regulate t_en → asr, resample F0/N onto
// the new timing) but hands the decode to bro.tts.decodeFrom and applies the
// result in onDone — so the JS thread is never blocked. On completion it chases
// the newest edit if one arrived, else repaints the pipeline once (settle).
function pumpDuration() {
  if (synthBusy || !durPending) return;
  if (!kokoro || !voice || !lastTrace || !curDur) return;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
  if (!ten || !F0 || !N || !ph) { setBadge('re-time: trace is missing stages', true); durPending = false; return; }

  durPending = false;
  const newDur = durWork.slice();
  const H = kokoro.hiddenDim, L = newDur.length;
  const totalP = newDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return;

  // length-regulate t_en (channel-major data[c*L + l]) into asr[c*totalP + t]
  const td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = newDur[l] | 0;
    for (let rr = 0; rr < reps; rr++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }
  const F0p = resampleByDur(F0.data, curDur, newDur);
  const Np  = resampleByDur(N.data,  curDur, newDur);

  synthBusy = true;
  try {
    bro.tts.decodeFrom(kokoro, voice, asrP, F0p, Np, ph.w, {
      trace: true,
      onDone: (r, info) => {
        synthBusy = false;
        if (info.error) setBadge('decodeFrom: ' + info.error, true);
        else if (!info.cancelled) applyDuration(r, newDur, asrP, F0p, Np, totalP, L);
        if (durPending) pumpDuration();              // chase the latest edit
        else { settleDuration(); if (dirty) pump(); } // settled — repaint once, then any pending voice change
      },
    });
  } catch (e) {
    synthBusy = false;
    setBadge('decodeFrom: ' + e.message, true);
    if (durPending) setTimeout(pumpDuration, 0);
  }
}

// Publish a finished decode WITHOUT the heavy pipeline repaint: swap the new
// back-half stages into the trace, commit the front grids so the next edit
// composes correctly, and play the audio. The pred_dur cells were already
// updated live by the edit; the heatmaps / curves wait for settleDuration.
function applyDuration(r, newDur, asrP, F0p, Np, totalP, L) {
  const set = (nm, data, w) => { const s = lastTrace.stages.find((x) => x.name === nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  for (const st of r.stages) { const i = lastTrace.stages.findIndex((x) => x.name === st.name); if (i >= 0) lastTrace.stages[i] = st; }
  set('asr', asrP, totalP);
  set('F0_pred', F0p, F0p.length);
  set('N_pred', Np, Np.length);
  set('pred_dur', Float32Array.from(newDur), L);
  curDur = newDur.slice();
  lastTrace.durations = newDur.slice();
  setClip(r.samples, r.sampleRate);
  play();
  edited = true;
  $('#run-meta').textContent = 'timing · ' + (r.samples.length / r.sampleRate).toFixed(2) + 's';
}

// Edits stopped: repaint the whole pipeline once (heatmaps / curves / waveform)
// to reflect the final timing and capture the prosody pin. pred_dur is protected
// so the live cells the user just left aren't torn out.
function settleDuration() {
  if (!lastTrace) return;
  protectedStage = 'pred_dur';
  const sc = $('#stages').scrollTop;
  renderStages(lastTrace.stages);
  $('#stages').scrollTop = sc;
  protectedStage = null;
  capturePinnedEdit();
  $('#run-meta').textContent += ' · ↺ reset to restore';
}

// Build the editable cell row. Each cell carries its phoneme index and an input
// for its frame count; handlers (type / wheel / drag / click-to-trace) are wired
// here once, on the persistent cell elements — registerFlow only re-collects them
// for the highlight, so a protected re-render never double-binds or leaks.
function renderAlign(body, s) {
  durWork = Array.from(s.data, (v) => Math.max(1, Math.round(v)));
  durPending = false;                    // fresh trace/voice — drop any stale edit
  const wrap = el('div', 'align-cells');
  const cells = [];
  for (let i = 0; i < durWork.length; i++) {
    const cell = el('div', 'acell');
    cell.style.flexGrow = String(durWork[i]);
    cell.appendChild(el('span', 'acell-ph', String(i + 1)));
    const inp = document.createElement('input');
    inp.className = 'acell-num'; inp.type = 'text'; inp.value = String(durWork[i]);
    cell.appendChild(inp);
    cell._input = inp; cell._i = i;
    wireAlignCell(cell, cells);
    cells.push(cell);
    wrap.appendChild(cell);
  }
  body.appendChild(wrap);
  body._alignCells = cells;            // registerFlow picks these up for the highlight

  const note = el('div', 'axis-note',
    'type · scroll · or drag a cell to re-time · sum = ');
  const sum = el('span', null, String(durWork.reduce((a, b) => a + b, 0) | 0));
  note.appendChild(sum);
  note.appendChild(el('span', null, ' frames'));
  for (const c of cells) c._sum = sum;   // each edit refreshes the running total
  const reset = el('span', 'curve-reset', '↺ reset timing');
  reset.addEventListener('click', resetDurations);
  note.appendChild(reset);
  body.appendChild(note);
}

// All the per-cell interaction. A discrete edit (type / wheel) writes to durWork
// and immediately requests an async re-decode you hear right away; a drag updates
// the cells live and decodes once on release (re-synthesizing the whole clip on
// every drag pixel would just restart playback). A plain click traces the
// phoneme. The drag uses the one global mousemove/mouseup pair (see init) via
// activeDrag, like the curve editor.
function wireAlignCell(cell, cells) {
  const i = cell._i, inp = cell._input;

  // type an exact value — commit on blur / Enter
  inp.addEventListener('mousedown', (e) => e.stopPropagation());  // don't start a drag/trace
  inp.addEventListener('change', () => {
    const v = Math.max(1, Math.round(+inp.value || 1));
    durWork[i] = v; updateAlignCell(cells, i); requestDuration();
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });

  // wheel: ±1 frame, ±5 with shift
  cell.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    durWork[i] = Math.max(1, durWork[i] + (e.deltaY < 0 ? step : -step));
    updateAlignCell(cells, i); requestDuration();
  });

  // vertical drag: up = more frames. A click that never moves traces instead.
  cell.addEventListener('mousedown', (e) => {
    if (!lastTrace) return;
    e.preventDefault();
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }   // don't let a queued slider render fire mid-edit
    activeDrag = { cells, i, y0: e.clientY, base: durWork[i], moved: false };
  });
}

// drag in progress: dy pixels -> ± frames on the grabbed cell, live + cheap.
// ~6 px per frame so a deliberate drag has resolution without runaway.
function dragDurAt(e) {
  const d = activeDrag; if (!d) return;
  const dy = d.y0 - e.clientY;                      // up = positive = longer
  if (Math.abs(dy) > 3) d.moved = true;
  durWork[d.i] = Math.max(1, d.base + Math.round(dy / 6));
  updateAlignCell(d.cells, d.i);
}
function onDurUp() {
  const d = activeDrag; activeDrag = null; if (!d) return;
  if (d.moved) requestDuration();                   // re-decode the dragged timing (async)
  else selectPhoneme(d.i);                            // a plain click traces the phoneme
}
