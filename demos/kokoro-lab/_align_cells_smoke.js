// pred_dur cell-editor smoke — model-free. Builds a synthetic trace, renders the
// stages, and exercises the editable alignment cells: build, type, wheel, drag,
// the running sum, and the trace highlight. No Kokoro load — this is pure DOM +
// edit logic, so it can't hit the model device flake the other smokes do.
//   bro-headless ../broworkshop/demos/kokoro-lab ../broworkshop/demos/kokoro-lab/_align_cells_smoke.js

const _frames = [10, 20, 5, 30, 8, 15];
const L = _frames.length;
const _ph  = { name: 'phonemes', h: 1, w: L, data: Int32Array.from([1, 2, 3, 4, 5, 6]) };
const _pd  = { name: 'pred_dur', h: 1, w: L, data: Float32Array.from(_frames) };
const _T = _frames.reduce((a, b) => a + b, 0);
const _wav = { name: 'audio', h: 1, w: _T, data: new Float32Array(_T) };
lastTrace = { samples: new Float32Array(_T), sampleRate: 24000,
              durations: _frames.slice(), stages: [_ph, _pd, _wav] };
curDur = null;     // no real prediction here, so the async pump is a no-op (edits just queue)

renderStages(lastTrace.stages);                       // first render = buildStages

const body  = stageCards['pred_dur'].body;
const cells = body.querySelectorAll('.acell');
assert(cells.length === L, 'one cell per phoneme (' + cells.length + ' vs ' + L + ')');
assert(body.querySelector('canvas') === null, 'pred_dur is a cell layout, not a canvas');
assert(cells[1]._input.value === '20', 'cell shows its frame count');
assert(cells[1].style.flexGrow === '20', 'cell width grows with its frame count');
console.log('build: ' + L + ' cells, no canvas, values + widths correct');

// ── type an exact value ──────────────────────────────────────────────────────
cells[2]._input.value = '42';
cells[2]._input.dispatchEvent({ type: 'change' });
assert(durWork[2] === 42, 'typing sets durWork');
assert(cells[2].style.flexGrow === '42', 'typed value re-widens the cell');
const _sumEl = body.querySelector('.axis-note span');
assert((+_sumEl.textContent) === _T - 5 + 42, 'running sum reflects the edit');
console.log('type: durWork[2]=42, width + sum updated');

// ── wheel: +1, and +5 with shift ─────────────────────────────────────────────
cells[0].dispatchEvent({ type: 'wheel', deltaY: -1 });
assert(durWork[0] === 11, 'wheel up = +1 frame');
cells[0].dispatchEvent({ type: 'wheel', deltaY: 5 });
assert(durWork[0] === 10, 'wheel down = -1 frame');
cells[0].dispatchEvent({ type: 'wheel', deltaY: -1, shiftKey: true });
assert(durWork[0] === 15, 'shift+wheel = +5 frames');
console.log('wheel: ±1 and shift ±5 work');

// ── drag: vertical, up = longer; floors at 1 ─────────────────────────────────
cells[3].dispatchEvent({ type: 'mousedown', clientY: 100 });
assert(activeDrag && activeDrag.i === 3, 'mousedown on a cell arms the drag');
dragDurAt({ clientY: 40 });                            // 60 px up / 6 = +10
assert(activeDrag.moved === true, 'a real move is flagged (not a click)');
assert(durWork[3] === 40, 'drag up lengthens (30 + 10)');
onDurUp();
assert(activeDrag === null, 'mouseup clears the drag');
console.log('drag: vertical adjust works, +10 frames');

// ── a click that never moves traces the phoneme instead of editing ───────────
selPhoneme = -1;
cells[4].dispatchEvent({ type: 'mousedown', clientY: 100 });
onDurUp();                                             // no move between down/up
assert(selPhoneme === 4, 'a plain click traces the phoneme');
assert(cells[4].classList.contains('sel'), 'the traced cell is highlighted');
console.log('click: traces + highlights the phoneme cell');

// ── async pump: an edit requests a re-decode (no debounce, latest-wins) ───────
assert(durPending === true, 'an edit marked the timing dirty for the async pump');
assert(synthBusy === false, 'pump is a no-op without a real prediction (curDur null)');
durPending = false;                                    // model-free: don't actually decode
console.log('pump: an edit requested a re-decode (latest-wins, no debounce)');

// ── the cells must survive the post-commit (protected) re-render ─────────────
// (last, since the renders below reset durWork + rebuild the cell elements)
stageCards['pred_dur'].body.querySelectorAll('.acell')[0]._tag = 0x10A11;
protectedStage = 'pred_dur';
renderStages(lastTrace.stages);                        // the redraw a commit triggers
protectedStage = null;
assert(stageCards['pred_dur'].body.querySelectorAll('.acell')[0]._tag === 0x10A11,
       'pred_dur cells preserved across a protected re-render');
assert(flowStages.some((f) => f.items === stageCards['pred_dur'].body._alignCells),
       'cells re-registered for the trace highlight');
renderStages(lastTrace.stages);                        // a normal (unprotected) re-render rebuilds them
assert(stageCards['pred_dur'].body.querySelectorAll('.acell')[0]._tag === undefined,
       'an unprotected re-render rebuilds the cells (emotion / pin / reset reflect new timing)');
console.log('render: cells persist when protected, rebuild otherwise');

console.log('ALIGN_CELLS_SMOKE OK');
