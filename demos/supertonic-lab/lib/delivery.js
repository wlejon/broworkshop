// ═══ FLOW — the synthesis seams ══════════════════════════════════════════════
// Supertonic's vector estimator runs a fixed number of classifier-free-guided
// Euler steps from N(0,1) noise. The three dials:
//   steps   more steps → smoother latent, slower (8 is the upstream default).
//   speed   > 1 shortens the utterance (1.05 upstream default).
//   seed    the Philox seed for the flow noise — which take you draw. With the
//           lock off, a fresh seed is rolled each synth so repeats actually differ.
// long-form splits a paragraph into sentences and concatenates with `gap` silence.

import { $ } from "/app/lib/state.js";
import { scheduleLive } from "/app/lib/synth.js";

let seedLocked = true;

export function buildFlow() {
  const bind = (id, lab, fmt) => {
    const sl = $('#' + id), out = $('#v-' + lab);
    const upd = () => { out.textContent = fmt(parseFloat(sl.value)); updateFlowMeta(); };
    sl.oninput = () => { upd(); scheduleLive(); };
    upd();
  };
  bind('steps', 'steps', (v) => String(v | 0));
  bind('speed', 'speed', (v) => v.toFixed(2));
  bind('gap',   'gap',   (v) => v.toFixed(2));

  $('#seed').oninput = () => { updateFlowMeta(); scheduleLive(); };
  $('#seed-lock').onchange = () => { seedLocked = $('#seed-lock').checked; };
  seedLocked = $('#seed-lock').checked;
  $('#btn-reseed').onclick = () => {
    $('#seed').value = String((Math.random() * 0x7fffffff) | 0);
    updateFlowMeta(); scheduleLive();
  };
  $('#longform').onchange = () => {
    $('#gap-dial').style.display = $('#longform').checked ? 'inline-flex' : 'none';
    scheduleLive();
  };
  updateFlowMeta();
}

function updateFlowMeta() {
  const steps = parseInt($('#steps').value, 10) | 0;
  $('#delivery-meta').textContent =
    steps + ' steps · seed ' + ($('#seed').value | 0) + (seedLocked ? ' (locked)' : ' (rolling)') +
    ($('#longform').checked ? ' · long-form' : '');
}

// Read the flow controls. With the lock off, roll a fresh seed each run and
// reflect it in the UI so repeated takes differ yet stay reproducible when locked.
export function currentFlow() {
  let seed = parseInt($('#seed').value, 10) || 0;
  if (!seedLocked) { seed = (Math.random() * 0x7fffffff) | 0; $('#seed').value = String(seed); }
  updateFlowMeta();
  return {
    steps:      parseInt($('#steps').value, 10) || 8,
    speed:      parseFloat($('#speed').value) || 1.05,
    seed:       seed,
    longForm:   $('#longform').checked,
    gapSeconds: parseFloat($('#gap').value) || 0,
  };
}
