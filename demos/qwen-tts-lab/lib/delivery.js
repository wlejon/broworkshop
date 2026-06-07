// ═══ DELIVERY — the sampling seam ════════════════════════════════════════════
// temperature 0 = greedy / deterministic (bit-exact, the model's single best
// take). Raise it and top-k / top-p / seed shape how far the take roams. The
// seed makes a varied take reproducible; lock it to A/B the exact same draw.
//
// Two Talker-steering dials go past Qwen's stock sampler:
//   rep    repetition penalty on codebook 0 — >1 pushes the AR Talker off the
//          droning / looping it falls into. 1.05 is the upstream default.
//   adapt  confidence-adaptive temperature — scales temp per frame by how unsure
//          the model is, so it stays near-greedy where confident and samples
//          hotter only where it hedged (the dips in the c0_confidence strip).
//          Needs temp > 0 to bite.

function buildDelivery() {
  const bind = (id, lab, fmt) => {
    const sl = $('#' + id), out = $('#v-' + lab);
    const upd = () => { out.textContent = fmt(parseFloat(sl.value)); updateDeliveryMeta(); };
    sl.oninput = upd; upd();
  };
  bind('temp', 'temp', (v) => v.toFixed(2));
  bind('topk', 'topk', (v) => String(v | 0));
  bind('topp', 'topp', (v) => v.toFixed(2));
  bind('rep', 'rep', (v) => v.toFixed(2));
  bind('adapt', 'adapt', (v) => v.toFixed(2));
  $('#seed').oninput = updateDeliveryMeta;
  $('#seed-lock').onchange = () => { seedLocked = $('#seed-lock').checked; };
  $('#btn-greedy').onclick = () => {
    $('#temp').value = '0'; $('#topk').value = '0'; $('#topp').value = '1';
    $('#adapt').value = '0';
    $('#temp').dispatchEvent(new Event('input'));
    $('#topk').dispatchEvent(new Event('input'));
    $('#topp').dispatchEvent(new Event('input'));
    $('#adapt').dispatchEvent(new Event('input'));
  };
  updateDeliveryMeta();
}

function updateDeliveryMeta() {
  const t = parseFloat($('#temp').value);
  const rep = parseFloat($('#rep').value), adapt = parseFloat($('#adapt').value);
  const extra = (rep !== 1.05 ? ' · rep ' + rep.toFixed(2) : '') +
                (t > 0 && adapt > 0 ? ' · adaptive ' + adapt.toFixed(2) : '');
  $('#delivery-meta').textContent = (t > 0
    ? 'sampling · seed ' + ($('#seed').value | 0) + (seedLocked ? ' (locked)' : '')
    : 'greedy · deterministic') + extra;
}

// Read the sampling controls. When sampling and the seed isn't locked, roll a
// fresh seed each run so repeated takes actually differ — and reflect it in the UI.
function currentSampling() {
  const temperature = parseFloat($('#temp').value) || 0;
  const topK = parseInt($('#topk').value, 10) || 0;
  const topP = parseFloat($('#topp').value);
  const repetitionPenalty = parseFloat($('#rep').value);
  const adaptive = parseFloat($('#adapt').value) || 0;
  let seed = parseInt($('#seed').value, 10) || 0;
  if (temperature > 0 && !seedLocked) {
    seed = (Math.random() * 0x7fffffff) | 0;
    $('#seed').value = String(seed);
  }
  updateDeliveryMeta();
  return { temperature, topK, topP, seed, repetitionPenalty, adaptive };
}
