// pred_dur — the alignment (symbol time -> frame time): how many output frames
// each phoneme is held for. Rendered as a row of editable CELLS, not a canvas:
// one cell per phoneme, its width proportional to its frame count so the row
// still reads left-to-right as a timeline, but the number is real, selectable
// text you can change directly.
//
// Edit a cell three ways — type a value, scroll the wheel (±1, shift ±5), or
// drag it vertically (up = longer). Every edit updates the cells live and cheap;
// the expensive part (re-decoding the back half + repainting the pipeline) is
// COALESCED behind scheduleDuration, so a flurry of tweaks costs one decode once
// you pause, instead of freezing on every change the way the drag-canvas did.
// Click a cell (without dragging) still traces that phoneme through every stage.

let durWork = null;        // live working copy of the per-phoneme frame counts
let durTimer = 0;          // debounce: coalesce edits into one re-decode

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

// Commit the working durations, debounced. The model runs one job at a time, so
// if a synth is mid-flight we retry shortly rather than dropping the edit. The
// pred_dur card is protected across the commit's re-render so the cells the user
// is touching are never torn out from under them.
function scheduleDuration() {
  if (durTimer) clearTimeout(durTimer);
  durTimer = setTimeout(commitDurWork, 180);
}
function commitDurWork() {
  durTimer = 0;
  if (!durWork || !lastTrace) return;
  if (synthBusy) { durTimer = setTimeout(commitDurWork, 60); return; }  // model busy — try again soon
  protectedStage = 'pred_dur';
  commitDuration(durWork.slice());
  protectedStage = null;
}

// Build the editable cell row. Each cell carries its phoneme index and an input
// for its frame count; handlers (type / wheel / drag / click-to-trace) are wired
// here once, on the persistent cell elements — registerFlow only re-collects them
// for the highlight, so a protected re-render never double-binds or leaks.
function renderAlign(body, s) {
  durWork = Array.from(s.data, (v) => Math.max(1, Math.round(v)));
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

// All the per-cell interaction. Editing writes to durWork and schedules a
// (debounced) re-decode; a plain click traces the phoneme. The drag uses the one
// global mousemove/mouseup pair (see init) via activeDrag, like the curve editor.
function wireAlignCell(cell, cells) {
  const i = cell._i, inp = cell._input;

  // type an exact value — commit on blur / Enter
  inp.addEventListener('mousedown', (e) => e.stopPropagation());  // don't start a drag/trace
  inp.addEventListener('change', () => {
    const v = Math.max(1, Math.round(+inp.value || 1));
    durWork[i] = v; updateAlignCell(cells, i); scheduleDuration();
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });

  // wheel: ±1 frame, ±5 with shift
  cell.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    durWork[i] = Math.max(1, durWork[i] + (e.deltaY < 0 ? step : -step));
    updateAlignCell(cells, i); scheduleDuration();
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
  if (d.moved) scheduleDuration();                  // re-decode the new timing (debounced)
  else selectPhoneme(d.i);                           // a plain click traces the phoneme
}
