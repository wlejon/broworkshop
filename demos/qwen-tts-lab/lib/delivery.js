// ═══ DELIVERY — the sampling seam ════════════════════════════════════════════
// temperature 0 = greedy / deterministic (bit-exact, the model's single best
// take). Raise it and top-k / top-p / seed shape how far the take roams. The
// seed makes a varied take reproducible; lock it to A/B the exact same draw.

function buildDelivery() {
  const bind = (id, lab, fmt) => {
    const sl = $('#' + id), out = $('#v-' + lab);
    const upd = () => { out.textContent = fmt(parseFloat(sl.value)); updateDeliveryMeta(); };
    sl.oninput = upd; upd();
  };
  bind('temp', 'temp', (v) => v.toFixed(2));
  bind('topk', 'topk', (v) => String(v | 0));
  bind('topp', 'topp', (v) => v.toFixed(2));
  $('#seed').oninput = updateDeliveryMeta;
  $('#seed-lock').onchange = () => { seedLocked = $('#seed-lock').checked; };
  $('#btn-greedy').onclick = () => {
    $('#temp').value = '0'; $('#topk').value = '0'; $('#topp').value = '1';
    $('#temp').dispatchEvent(new Event('input'));
    $('#topk').dispatchEvent(new Event('input'));
    $('#topp').dispatchEvent(new Event('input'));
  };
  updateDeliveryMeta();
}

function updateDeliveryMeta() {
  const t = parseFloat($('#temp').value);
  $('#delivery-meta').textContent = t > 0
    ? 'sampling · seed ' + ($('#seed').value | 0) + (seedLocked ? ' (locked)' : '')
    : 'greedy · deterministic';
}

// Read the sampling controls. When sampling and the seed isn't locked, roll a
// fresh seed each run so repeated takes actually differ — and reflect it in the UI.
function currentSampling() {
  const temperature = parseFloat($('#temp').value) || 0;
  const topK = parseInt($('#topk').value, 10) || 0;
  const topP = parseFloat($('#topp').value);
  let seed = parseInt($('#seed').value, 10) || 0;
  if (temperature > 0 && !seedLocked) {
    seed = (Math.random() * 0x7fffffff) | 0;
    $('#seed').value = String(seed);
  }
  updateDeliveryMeta();
  return { temperature, topK, topP, seed };
}
