// VRAM-growth repro for identity breeding at the user's settings (1024², 8
// steps). Renders once, adds an exemplar (loads DINOv3+BiRefNet), captures a
// probe, then breeds pop 8 × 3 generations (28 renders) while sampling
// nvidia-smi every ~2 s. Prints used-VRAM per sample so per-render growth —
// and any OOM — is visible in the log. Not part of the suite.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/repro_vram.js

function $(id) { return document.getElementById(id); }

function vram() {
  try {
    return require('child_process')
      .execSync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader')
      .toString().trim();
  } catch (e) { return 'nvidia-smi failed: ' + e.message; }
}

let lastStatus = '';
function pumpUntil(pred, budgetMs, tag) {
  const start = Date.now();
  let lastSample = 0;
  while (!pred() && (Date.now() - start) < budgetMs) {
    sleep(20);
    const now = Date.now();
    if (now - lastSample > 2000) {
      lastSample = now;
      const st = $('ids-status') ? $('ids-status').textContent : '';
      if (st !== lastStatus) lastStatus = st;
      console.log('[vram] ' + vram() + '  | ' + tag + ' | ' + st);
    }
  }
  return pred();
}

console.log('[vram] baseline (pre-load): ' + vram());
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000, 'model load'), 'model loaded');
assert(!$('status-text').classList.contains('err'), 'load ok');
console.log('[vram] after model load: ' + vram());

if ($('live').checked) $('live').click();
if (!$('btn-deck-clear').disabled) $('btn-deck-clear').click();
$('rand-seed').checked = false;
$('width').value = '1024';
$('height').value = '1024';
$('steps').value = '8';
$('guidance').value = '1.0';
$('prompt').value = 'a red fox sitting in a snowy forest clearing, golden hour';
$('neg-prompt').value = '';
$('seed').value = '7';

$('status-text').textContent = '';
$('btn-generate').click();
assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                       $('status-text').classList.contains('err'), 300000, 'base render'),
       'base render finished');
assert(!$('status-text').classList.contains('err'), 'base render ok');
console.log('[vram] after base render: ' + vram());

$('btn-ids-add').click();
assert(pumpUntil(() => $('ids-status').textContent.indexOf('exemplar added') === 0 ||
                       $('ids-status').classList.contains('err'), 300000, 'scorer+exemplar'),
       'exemplar added: ' + $('ids-status').textContent);
console.log('[vram] after scorer load + embed: ' + vram());

$('btn-ids-probe').click();
$('ids-pop').value = '8';
$('ids-gens').value = '3';
$('ids-drift').value = '0.3';
$('btn-ids-breed').click();
console.log('[vram] breed started (8 pop × 3 gens × 1 probe = 28 renders)');
const ok = pumpUntil(() => $('ids-status').textContent.indexOf('breed done') === 0 ||
                           $('ids-status').classList.contains('err'), 1200000, 'breeding');
console.log('[vram] final: ' + vram());
console.log('[vram] end status: ' + $('ids-status').textContent);
assert(ok, 'breed ended within budget');
console.log($('ids-status').classList.contains('err')
  ? 'REPRO — breed failed: ' + $('ids-status').textContent
  : 'NO REPRO — breed completed at 1024²/8st');
