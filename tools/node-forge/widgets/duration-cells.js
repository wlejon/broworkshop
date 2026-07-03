// Node Forge — generalized duration/alignment cell-row panel widget.
//
// Generalizes kokoro-lab/lib/align.js's editable per-phoneme frame-count row:
// proportional-width cells (width ∝ frame count, so the row still reads
// left-to-right as a timeline) editable three ways — type a value, mouse-
// wheel (±1, shift ±5, only while that cell's number is focused), or drag
// vertically (~6px/frame, up = longer). A click that never moved traces the
// cell instead of editing it.
//
// mount(container, cfg, ctx) is called directly by a node's own mount().
//   cfg.count()      -> number of cells (L)
//   cfg.get(i)        -> current frame count for cell i
//   cfg.label(i)      -> optional per-cell top label; defaults to i+1
// Every live tick (drag move) calls ctx.onLiveChange(work) — cheap, UI-only,
// matching align.js's decision NOT to re-decode on every drag pixel. A
// discrete edit (typed value, wheel notch) or a drag's mouseup (only if it
// actually moved) calls ctx.onCommit(work) — the caller decides sync vs
// async re-decode and any debounce/latest-wins chase, exactly like a node's
// exec()-vs-live split elsewhere. A plain click (no movement) calls
// ctx.onTrace(i) instead of a commit.

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  export function mountDurationCells(container, cfg, ctx) {
    container.textContent = '';
    const L = cfg.count();
    const work = [];
    for (let i = 0; i < L; i++) work.push(Math.max(1, Math.round(cfg.get(i))));

    const wrap = el('div', 'align-cells');
    const cells = [];
    let sumEl = null;
    function refreshSum() {
      let t = 0; for (let i = 0; i < work.length; i++) t += work[i];
      if (sumEl) sumEl.textContent = t | 0;
    }
    function updateCell(i) {
      const c = cells[i];
      c._input.value = String(work[i]);
      c.style.flexGrow = String(work[i]);
      refreshSum();
    }

    for (let i = 0; i < L; i++) {
      const cell = el('div', 'acell');
      cell.style.flexGrow = String(work[i]);
      cell.appendChild(el('span', 'acell-ph', cfg.label ? cfg.label(i) : String(i + 1)));
      const inp = document.createElement('input');
      inp.className = 'acell-num'; inp.type = 'text'; inp.value = String(work[i]);
      cell.appendChild(inp);
      cell._input = inp;

      inp.addEventListener('mousedown', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        work[i] = Math.max(1, Math.round(+inp.value || 1));
        updateCell(i);
        ctx.onCommit(work.slice());
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });

      cell.addEventListener('wheel', (e) => {
        if (document.activeElement !== inp) return;   // not engaged — let the page scroll
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        work[i] = Math.max(1, work[i] + (e.deltaY < 0 ? step : -step));
        updateCell(i);
        ctx.onCommit(work.slice());
      });

      let drag = null;
      cell.addEventListener('mousedown', (e) => {
        e.preventDefault();
        drag = { y0: e.clientY, base: work[i], moved: false };
      });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const dy = drag.y0 - e.clientY;
        if (Math.abs(dy) > 3) drag.moved = true;
        work[i] = Math.max(1, drag.base + Math.round(dy / 6));
        updateCell(i);
        if (ctx.onLiveChange) ctx.onLiveChange(work.slice());
      });
      window.addEventListener('mouseup', () => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        if (moved) ctx.onCommit(work.slice());
        else if (ctx.onTrace) ctx.onTrace(i);
      });

      cells.push(cell);
      wrap.appendChild(cell);
    }
    container.appendChild(wrap);

    const note = el('div', 'axis-note', 'drag a cell, type a value, or click it then scroll to re-time · sum = ');
    sumEl = el('span', null, '0'); refreshSum();
    note.appendChild(sumEl);
    note.appendChild(document.createTextNode(' frames'));
    if (ctx.onReset) {
      const reset = el('span', 'tinybtn', ' ↺ reset timing ');
      reset.style.cursor = 'pointer';
      reset.addEventListener('click', ctx.onReset);
      note.appendChild(reset);
    }
    container.appendChild(note);
    container._cells = cells;   // test seam
    return container;
  }
