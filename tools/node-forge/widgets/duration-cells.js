// A row of editable per-phoneme frame counts (kokoro-lab's alignment row).
// Cell width follows the frame count, so the row still reads as a timeline.
// Edit by typing, by wheel while a cell's number is focused (±1, shift ±5),
// or by dragging vertically (~6 px per frame, up = longer); a click that
// never moved traces the cell instead.
//
// cfg: { count(), get(i), label(i) (optional) }
// ctx: { onLiveChange(work) (each drag tick), onCommit(work) (typed value,
//        wheel notch, finished drag), onTrace(i), onReset() }

import { h, trackDrag } from "/lib/kit/dom.js";

export function mountDurationCells(container, cfg, ctx) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const L = cfg.count();
    const work = [];
    for (let i = 0; i < L; i++) work.push(Math.max(1, Math.round(cfg.get(i))));
    const cells = [];
    const sum = h('span', null, '0');
    const refreshSum = () => { sum.textContent = String(work.reduce((a, b) => a + b, 0)); };
    const update = (i) => { cells[i]._input.value = String(work[i]); cells[i].style.flexGrow = String(work[i]); refreshSum(); };
    const commit = () => ctx.onCommit(work.slice());

    const wrap = h('div.align-cells');
    for (let i = 0; i < L; i++) {
        const inp = h('input.acell-num', { type: 'text', value: String(work[i]) });
        const cell = h('div.acell', { style: { flexGrow: String(work[i]) } }, h('span.acell-ph', null, cfg.label ? cfg.label(i) : String(i + 1)), inp);
        cell._input = inp;
        inp.addEventListener('mousedown', (e) => e.stopPropagation());
        inp.addEventListener('change', () => { work[i] = Math.max(1, Math.round(+inp.value || 1)); update(i); commit(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
        cell.addEventListener('wheel', (e) => {
            if (document.activeElement !== inp) return;
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            work[i] = Math.max(1, work[i] + (e.deltaY < 0 ? step : -step));
            update(i);
            commit();
        });
        cell.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const drag = { y0: e.clientY, base: work[i], moved: false };
            trackDrag((ev) => {
                const dy = drag.y0 - ev.clientY;
                if (Math.abs(dy) > 3) drag.moved = true;
                work[i] = Math.max(1, drag.base + Math.round(dy / 6));
                update(i);
                if (ctx.onLiveChange) ctx.onLiveChange(work.slice());
            }, () => {
                if (drag.moved) commit();
                else if (ctx.onTrace) ctx.onTrace(i);
            });
        });
        cells.push(cell);
        wrap.appendChild(cell);
    }
    refreshSum();
    const note = h('div.axis-note', null, 'drag a cell, type a value, or click it then scroll to re-time · sum = ', sum, ' frames ');
    if (ctx.onReset) note.appendChild(h('button.small', { onclick: ctx.onReset }, '↺ reset timing'));
    container.append(wrap, note);
    container._cells = cells;   // test seam
    return container;
}
