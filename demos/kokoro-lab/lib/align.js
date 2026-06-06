// Alignment: each phoneme gets horizontal width proportional to its frame
// count — the literal symbol-time -> frame-time layout.
// Draw the alignment blocks from a duration array; returns the summed frames.
function drawAlign(cv, durs) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const total = durs.reduce((a, b) => a + b, 0) || 1;
  ctx.clearRect(0, 0, W, H);
  let x = 0;
  for (let i = 0; i < durs.length; i++) {
    const w = (durs[i] / total) * W;
    ctx.fillStyle = (i % 2) ? '#1f3350' : '#284873';
    ctx.fillRect(x, 0, Math.max(1, w - 1), H);
    if (w > 16) {
      ctx.fillStyle = '#9fb6d4'; ctx.font = '10px monospace';
      ctx.fillText(String(durs[i] | 0), x + 3, 14);
    }
    x += w;
  }
  return total;
}

// pred_dur is editable: drag a block sideways to lengthen/shorten that phoneme
// (emphasis / pacing). A click without a drag still traces the phoneme.
function renderAlign(body, s) {
  const W = 1100, H = 54;
  const cv = mkCanvas(body, W, H);
  const total = drawAlign(cv, s.data);
  const editable = (s.name === 'pred_dur');
  cv.addEventListener('mousedown', (e) => {
    if (synthBusy || !lastTrace) return;
    e.preventDefault();                              // don't start a text selection
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }   // don't let a queued slider render fire mid-edit
    const tot = s.data.reduce((a, b) => a + b, 0) || 1;   // current sum, not the value at paint time
    const rect = cv.getBoundingClientRect();
    const tgt = ((e.clientX - rect.left) / rect.width) * tot;
    let acc = 0, l = 0;
    for (; l < s.data.length; l++) { acc += s.data[l]; if (tgt < acc) break; }
    if (l >= s.data.length) l = s.data.length - 1;
    if (!editable) { selectPhoneme(l); return; }     // non-editable: plain click
    activeDrag = { cv, s, total: tot, work: Array.from(s.data, (v) => Math.round(v)),
                   x0: e.clientX, l, base: Math.round(s.data[l]), rectW: rect.width, moved: false };
  });
  const note = el('div', 'axis-note',
    (editable ? 'drag a block to re-time · ' : '') +
    'left → right = time · block width = frames · sum = ' + (total | 0) + ' frames' +
    (editable ? ' · ' : ' · click a block to trace it'));
  if (editable) {
    const reset = el('span', 'curve-reset', '↺ reset timing');
    reset.addEventListener('click', resetDurations);
    note.appendChild(reset);
  }
  body.appendChild(note);
}

// drag in progress: dx pixels -> ± frames on the grabbed block, live redraw
function dragDurAt(e) {
  const d = activeDrag; if (!d) return;
  const dx = e.clientX - d.x0;
  if (Math.abs(dx) > 3) d.moved = true;
  const dframes = Math.round((dx / d.rectW) * d.total);
  d.work[d.l] = Math.max(1, d.base + dframes);
  drawAlign(d.cv, d.work);
}
function onDurUp() {
  const d = activeDrag; activeDrag = null; if (!d) return;
  if (d.moved) {                    // keep the dragged blocks intact through the commit's re-render
    protectedStage = d.s.name;
    commitDuration(d.work);
    protectedStage = null;
  } else selectPhoneme(d.l);
}

