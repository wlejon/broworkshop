// ═══ Grid — an N×N seed browser at the current ψ ══════════════════════════════
// Render a block of consecutive seeds so the latent space is scannable at a
// glance. Click a tile to drop its seed into Sample. "Next" pages forward by a
// whole block.

function renderGrid() {
  if (!gan) return;
  const base = parseInt($('#grid-base').value, 10) || 0;
  const n = parseInt($('#grid-size').value, 10) || 4;
  const psi = curPsi(), cutoff = curCutoff();
  const out = $('#grid-out');
  out.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
  out.textContent = '';
  const cells = [];
  for (let i = 0; i < n * n; i++) {
    const cv = document.createElement('canvas');
    cv.className = 'grid-cell';
    cv.dataset.seed = base + i;
    out.appendChild(cv);
    cells.push(cv);
  }
  const steps = [];
  for (let i = 0; i < n * n; i++) steps.push(buildImg(base + i, psi, cutoff));
  runSeq('grid', steps, function (i, r) { drawBitmap(cells[i], r.image); });
}

function gridPage(dir) {
  const n = parseInt($('#grid-size').value, 10) || 4;
  const base = parseInt($('#grid-base').value, 10) || 0;
  $('#grid-base').value = Math.max(0, base + dir * n * n);
  renderGrid();
}

// Click a tile → load that seed into Sample and switch seams.
function onGridClick(e) {
  const cv = e.target.closest ? e.target.closest('.grid-cell') : null;
  if (!cv) return;
  $('#seed').value = cv.dataset.seed;
  showSeam('sample');
}
