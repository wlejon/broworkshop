// ═══ STEER — codebook-0 logit bias (the power-user Talker seam) ══════════════
// Qwen's sampler exposes an additive bias on specific codebook-0 (Talker) logits,
// applied after the repetition penalty and before suppression/sampling: each
// {id: delta} shifts that code's logit (>0 favors it, a big negative effectively
// forbids it). The RVQ ids are opaque, so this is an experimentation seam — the
// natural way to find an id is the trace: row 0 of the code raster IS codebook 0,
// so clicking a frame there grabs the code the Talker emitted and stages it for
// biasing. Threaded into synthesis by gatherOpts() as opts.logitBias; applies to
// every voice path (speaker / instruct / x-vector).

const steerBias = {};        // code id (int) -> additive logit delta
const STEER_DEFAULT = -3;    // a click suppresses by default (the common "kill this droning code")

function steerActive() { for (const k in steerBias) return true; return false; }
// The opts.logitBias fragment (a plain {id: delta} object), or null when empty.
function steerOpts() {
  if (!steerActive()) return null;
  const o = {}; for (const k in steerBias) o[k] = steerBias[k];
  return o;
}

function steerAdd(id, delta) {
  id = id | 0;
  steerBias[id] = (delta == null ? STEER_DEFAULT : +delta);
  renderSteer(); scheduleLive();
}
function steerRemove(id) { delete steerBias[id]; renderSteer(); scheduleLive(); }
function steerClear() { for (const k in steerBias) delete steerBias[k]; renderSteer(); scheduleLive(); }

// Pull the codebook-0 code under a click on the code raster (row 0 only) and stage
// it for biasing. s/W are the stage + drawn width from renderCodes (recaptured each
// render). Other rows are acoustic (Code Predictor) — bias doesn't reach them.
function steerPickFromCodes(ev, canvas, s, W) {
  try {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / (rect.width || canvas.width));
    const cy = (ev.clientY - rect.top) * (canvas.height / (rect.height || canvas.height));
    const row = (cy / 15) | 0;
    if (row !== 0) { setBadge('logit bias steers codebook 0 only — click the top row', true); return; }
    const frame = Math.min(s.w - 1, Math.max(0, (cx * s.w / W) | 0));
    const id = Math.round(s.data[frame]);
    steerAdd(id, STEER_DEFAULT);
    setBadge('staged code ' + id + ' (frame ' + frame + ') · delta ' + STEER_DEFAULT + ' — adjust + Render');
  } catch (e) { setBadge('pick: ' + e.message, true); }
}

function buildSteer() {
  $('#btn-steer-add').addEventListener('click', () => {
    const v = parseInt($('#steer-id').value, 10);
    if (!isFinite(v) || v < 0) { setBadge('enter a non-negative code id', true); return; }
    steerAdd(v, STEER_DEFAULT); $('#steer-id').value = '';
  });
  $('#btn-steer-clear').addEventListener('click', steerClear);
  renderSteer();
}

// The active bias list: a delta slider + remove per code id, newest concerns first.
function renderSteer() {
  const host = $('#steer-list'); if (!host) return;
  host.textContent = '';
  const ids = Object.keys(steerBias).map((k) => k | 0).sort((a, b) => a - b);
  if (!ids.length) {
    host.appendChild(el('span', 'hint', 'no codes biased — click row 0 of the code raster, or add an id'));
    updateSteerMeta(); return;
  }
  for (const id of ids) {
    const row = el('div', 'steer-entry');
    row.appendChild(el('span', 'steer-id', 'code ' + id));
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '-12'; sl.max = '12'; sl.step = '0.5'; sl.value = String(steerBias[id]);
    const val = el('span', 'steer-val', steerBias[id].toFixed(1));
    sl.oninput = () => { steerBias[id] = +sl.value; val.textContent = steerBias[id].toFixed(1); updateSteerMeta(); scheduleLive(); };
    row.appendChild(sl); row.appendChild(val);
    const x = el('button', 'x', '×'); x.title = 'remove'; x.onclick = () => steerRemove(id);
    row.appendChild(x);
    host.appendChild(row);
  }
  updateSteerMeta();
}

function updateSteerMeta() {
  const n = Object.keys(steerBias).length;
  $('#steer-meta').textContent = n
    ? n + ' code' + (n > 1 ? 's' : '') + ' biased on codebook 0'
    : 'favor (+) or forbid (−) specific Talker codes';
}
