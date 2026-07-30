// Walk: render an axis across its range and save the result as a set of stills
// plus one animation — the artifact that actually shows what an axis DOES.
//
// A slider tells you nothing until you have seen both ends of it and the road
// between. The isolation sweep in the mint section makes five small frames at
// ±6 with everything else neutralized, which answers "is this a control";
// a walk answers "what is this control worth", at full size, with YOUR prompt
// and YOUR other settings left exactly as they are.
//
// One axis at a time, by construction. Every frame in a walk differs from its
// neighbours in exactly one number, so the axis is the only explanation for what
// moved — which is the whole claim a showcase makes. Walking two axes at once
// would forfeit it, so selecting N axes runs N independent walks rather than a
// grid.
//
// Nothing here turns a slider. The walk builds a generate message from the
// current settings once, at the start, then overrides the one axis per frame.
// So the UI is not disturbed, a walk cannot be corrupted by a slider nudged
// while it runs, and every axis in one run shares byte-identical constants.
//
// Re-running is cheap on purpose (/lib/sweep-runner.js): the constants hash to a
// folder, each value hashes to a file inside it, and a frame that already exists
// is never rendered again. Add two steps to a 13-step walk and it renders two
// frames. Change the prompt and it starts a new folder, leaving the old walk
// intact — the walks ARE the deliverable, so nothing overwrites them silently.

import { $ } from '/app/ui/util.js';
import { createSweepRunner } from '/lib/sweep-runner.js';

// The axis sliders' own domain (ui/axes.js builds every one at -6…6 step 0.01).
// Frame filenames are numbered off this grid rather than off a run's step count,
// so the same value keeps the same name whether you walked it in 5 steps or 25 —
// which is what lets a finer re-run reuse the coarser run's frames. Face axes are
// narrower (±3 for a baked bank, 0…5 for an expression) but share the grid, so
// their names stay unique and sort the same way.
const AXIS_MIN = -6, AXIS_MAX = 6, AXIS_STEP = 0.01;

// How a catalogue entry that does not say otherwise puts its value into a
// generate message: as one key of `axisControls`, which is where every axis in
// the bank, every minted axis and every unnamed atom lives.
//
//   hold(msg)     take THIS axis out of the run's constants (its resting value
//                 must not be part of its own walk's identity — the constants
//                 hash names the folder).
//   apply(msg, v) set the walked value, on a message hold() already ran over.
//
// A zero is an ABSENT key, exactly as collectAxisControls() sends it, so the
// mid-walk neutral frame hashes and renders like the same picture made with the
// slider sitting at 0.
function defaultHold(key) {
  return (m) => {
    const ac = Object.assign({}, m.axisControls || {});
    delete ac[key];
    m.axisControls = ac;
  };
}
function defaultApply(key) {
  return (m, v) => {
    const ac = Object.assign({}, m.axisControls || {});
    if (v) ac[key] = v; else delete ac[key];
    m.axisControls = ac;
  };
}

export function initWalk(ctx) {
  const prefs = ctx.prefs;
  let selected = Array.isArray(prefs.walkAxes) ? prefs.walkAxes.slice() : [];
  let rows = [];          // [{key, label, kind, cb, row}]
  let running = false;
  let signal = { cancelled: false };
  let builtLen = '';      // catalogue signature the current rows were built from

  if (prefs.walkFrom != null) $('walk-from').value = prefs.walkFrom;
  if (prefs.walkTo != null) $('walk-to').value = prefs.walkTo;
  if (prefs.walkSteps != null) $('walk-steps').value = prefs.walkSteps;
  if (prefs.walkMs != null) $('walk-ms').value = prefs.walkMs;
  if (prefs.walkPingPong != null) $('walk-pingpong').checked = !!prefs.walkPingPong;
  if (prefs.walkGif != null) $('walk-gif').checked = !!prefs.walkGif;
  $('walk-dir').value = prefs.walkDir || (bro.appDir + (bro.appDir.indexOf('\\') >= 0 ? '\\walks' : '/walks'));

  function status(msg, kind) {
    const el = $('walk-status');
    el.textContent = msg;
    el.className = 'hint' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : kind === 'ok' ? ' ok' : '');
  }

  // ── the value grid ────────────────────────────────────────────────────────
  // Inclusive of both ends, snapped to the slider's own 0.01 grid so a walk's
  // values are values a slider could actually hold (and so two runs that mean
  // the same step land on the same filename).
  // `axis` is optional: a face axis carries its own narrower domain (a baked
  // bank is ±3, an expression 0…5), and walking outside it would ask the worker
  // for values its slider cannot hold. The run's from/to is clipped INTO the
  // axis' domain rather than rejected, so one range setting can drive a mixed
  // selection and each axis walks as much of it as it has.
  function walkValues(axis) {
    const lo = axis && isFinite(axis.min) ? axis.min : AXIS_MIN;
    const hi = axis && isFinite(axis.max) ? axis.max : AXIS_MAX;
    const from = clamp(+$('walk-from').value, lo, hi);
    const to = clamp(+$('walk-to').value, lo, hi);
    const n = Math.max(2, Math.min(101, Math.round(+$('walk-steps').value) || 2));
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = from + (to - from) * (i / (n - 1));
      const snapped = Math.round(v / AXIS_STEP) * AXIS_STEP;
      const r = Math.round(snapped * 100) / 100;
      if (out.length === 0 || out[out.length - 1] !== r) out.push(r);
    }
    return out;
  }
  const clamp = (v, lo, hi) =>
    Math.max(lo === undefined ? AXIS_MIN : lo,
             Math.min(hi === undefined ? AXIS_MAX : hi, isFinite(v) ? v : 0));

  // Stable, sortable, value-derived frame name. The tick index makes a directory
  // listing read in walk order; the signed decimal keeps it human.
  function frameName(v) {
    const tick = Math.round((v - AXIS_MIN) / AXIS_STEP);
    const pad = String(tick).padStart(4, '0');
    return pad + '_' + (v < 0 ? 'm' : 'p') + Math.abs(v).toFixed(2);
  }

  // ── the axis picker ───────────────────────────────────────────────────────
  // The catalogue arrives in instalments — the bank when axes_meta.json lands,
  // the face axes as the worker reports which baked banks it loaded, the 383
  // unnamed atoms when the explore list finishes its own four fetches, and a
  // minted axis whenever one is minted — so this rebuilds whenever the
  // catalogue's CONTENT changes and is otherwise a no-op. Rebuilding is safe
  // here in a way it is not in ui/explore.js: a checkbox's state lives in
  // `selected`, not in the DOM, so rows come back checked. Filtering only shows
  // and hides, and never rebuilds.
  function build() {
    const cat = (ctx.axisCatalog ? ctx.axisCatalog() : [])
      .concat(ctx.faceCatalog ? ctx.faceCatalog() : [])
      .concat(ctx.exploreCatalog ? ctx.exploreCatalog() : []);
    // Keys, not count: a bank going unavailable while another arrives leaves the
    // count alone, and the custom expression word changes its own key as it is
    // edited. FNV-1a over the keys is cheap enough to run per deck refresh.
    let sig = 0x811c9dc5;
    for (const a of cat) {
      for (let i = 0; i < a.key.length; i++) {
        sig = ((sig ^ a.key.charCodeAt(i)) * 0x01000193) >>> 0;
      }
    }
    sig = cat.length + ':' + sig;
    if (!cat.length || sig === builtLen) return false;
    const host = $('walk-list');
    host.innerHTML = '';
    rows = [];
    let group = null, box = null;
    cat.forEach((a) => {
      if (a.category !== group || !box) {
        group = a.category;
        const det = document.createElement('details');
        det.className = 'axis-cat-group';
        det.setAttribute('open', '');
        const sum = document.createElement('summary');
        sum.className = 'ctl-cat';
        const nm = document.createElement('span');
        nm.textContent = group;
        sum.appendChild(nm);
        det.appendChild(sum);
        host.appendChild(det);
        box = det;
      }
      const row = document.createElement('label');
      row.className = 'walk-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.indexOf(a.key) >= 0;
      cb.addEventListener('change', () => {
        const i = selected.indexOf(a.key);
        if (cb.checked && i < 0) selected.push(a.key);
        else if (!cb.checked && i >= 0) selected.splice(i, 1);
        refreshCount();
        ctx.persist();
      });
      const nm = document.createElement('span');
      nm.className = 'walk-name';
      nm.textContent = a.label;
      nm.title = a.key + (a.verdict ? ' · judged ' + a.verdict : '');
      row.appendChild(cb); row.appendChild(nm);
      if (a.kind !== 'bank') {
        const tag = document.createElement('span');
        tag.className = 'walk-tag ' + a.kind;
        tag.textContent = a.kind === 'minted' ? 'yours' : 'unnamed';
        row.appendChild(tag);
      }
      box.appendChild(row);
      rows.push({ key: a.key, label: a.label, kind: a.kind, cb: cb, row: row,
                  verdict: a.verdict || '',
                  min: isFinite(a.min) ? a.min : AXIS_MIN,
                  max: isFinite(a.max) ? a.max : AXIS_MAX,
                  hold: a.hold || defaultHold(a.key),
                  apply: a.apply || defaultApply(a.key) });
    });
    builtLen = sig;
    applyFilter();
    refreshCount();
    return true;
  }

  function applyFilter() {
    const q = ($('walk-filter').value || '').trim().toLowerCase();
    const kind = $('walk-kind').value;    // all | bank | minted | atom
    rows.forEach((r) => {
      const hit = (kind === 'all' || r.kind === kind) &&
                  (!q || r.label.toLowerCase().indexOf(q) >= 0 || r.key.toLowerCase().indexOf(q) >= 0);
      // A selected axis stays visible whatever the filter says — it is part of
      // the run you are about to start, so hiding it would misreport the job.
      r.row.style.display = (hit || r.cb.checked) ? '' : 'none';
    });
    const boxes = $('walk-list').querySelectorAll('.axis-cat-group');
    boxes.forEach((b) => {
      const any = Array.prototype.some.call(b.querySelectorAll('.walk-row'),
                                            (c) => c.style.display !== 'none');
      b.style.display = any ? '' : 'none';
    });
  }

  function refreshCount() {
    const n = selected.length;
    const picked = rows.filter((r) => selected.indexOf(r.key) >= 0);
    // Summed, not multiplied: a face axis' narrower domain clips the range, so
    // the frame count is per axis and the total is the honest number of renders.
    let total = 0, minF = Infinity, maxF = 0;
    picked.forEach((r) => {
      const f = walkValues(r).length;
      total += f;
      if (f < minF) minF = f;
      if (f > maxF) maxF = f;
    });
    $('walk-count').textContent = n ? String(n) : '';
    $('walk-count').classList.toggle('show', n > 0);
    const each = maxF === minF ? maxF + ' frames' : minF + '–' + maxF + ' frames';
    $('walk-plan').textContent = !n
      ? 'pick one or more axes to walk'
      : (n === 1 ? '1 axis' : n + ' axes') + ' × ' + each + ' = ' +
        total + ' renders (already-rendered frames are skipped)';
    ctx.refreshButtons();
  }

  // ── the run ───────────────────────────────────────────────────────────────
  function chooseDir() {
    if (typeof window.showOpenFolderDialog !== 'function') {
      status('folder dialog unavailable in this build — type a path instead', 'err');
      return;
    }
    const d = window.showOpenFolderDialog($('walk-dir').value || '');
    if (!d) return;
    $('walk-dir').value = d;
    ctx.persist();
  }

  // One render through the worker, as RGBA bytes. The frame is also put on the
  // main canvas: a walk takes minutes, and watching it come out is how you tell
  // early that the prompt or the range was wrong.
  function renderMsg(msg) {
    return new Promise((resolve, reject) => {
      ctx.client.send(msg, (err, resp) => {
        if (err) { reject(err); return; }
        try {
          const c = document.createElement('canvas');
          c.width = resp.width; c.height = resp.height;
          const g = c.getContext('2d');
          g.drawImage(resp.bitmap, 0, 0);
          ctx.drawBitmap(c, resp.width, resp.height);
          const px = g.getImageData(0, 0, resp.width, resp.height);
          resolve({ pixels: px.data, width: resp.width, height: resp.height, ms: resp.ms });
        } catch (e) { reject(e); }
      });
    });
  }

  function logLine(text, kind) {
    const host = $('walk-log');
    const line = document.createElement('div');
    line.className = 'walk-log-line' + (kind ? ' ' + kind : '');
    line.textContent = text;
    host.appendChild(line);
    host.scrollTop = host.scrollHeight;
    return line;
  }

  function setProgress(done, total) {
    const bar = $('walk-progress');
    bar.classList.add('show');
    bar.firstElementChild.style.width =
      Math.round((done / Math.max(1, total)) * 100) + '%';
  }

  async function start() {
    if (running || !ctx.loaded || ctx.busy || !selected.length) return;
    const dir = $('walk-dir').value.trim();
    if (!dir) { status('choose an output folder first', 'err'); return; }

    let runner;
    try { runner = createSweepRunner({ root: dir }); }
    catch (e) { status(String(e.message || e), 'err'); return; }

    const ms = Math.max(20, Math.min(5000, Math.round(+$('walk-ms').value) || 200));
    const pingPong = $('walk-pingpong').checked;
    const alsoGif = $('walk-gif').checked;

    // The constants, captured ONCE. Every axis in this run, and every frame of
    // every axis, is rendered against this exact message — so the only thing
    // that ever differs is the one number under test.
    const baseMsg = ctx.buildGenerateMsg('full');

    // Ordered so the run is reproducible: the catalogue's order, not click order.
    const axes = rows.filter((r) => selected.indexOf(r.key) >= 0);
    const grids = axes.map((a) => walkValues(a));

    running = true;
    signal = { cancelled: false };
    ctx.setBusy(true);
    ctx.refreshButtons();
    $('walk-log').innerHTML = '';
    const t0 = Date.now();
    let totalFrames = grids.reduce((s, g) => s + g.length, 0), doneFrames = 0;
    let renderedTotal = 0, reusedTotal = 0, failed = 0;
    logLine(axes.length + ' axes · ' + totalFrames + ' frames · ' +
            $('walk-from').value + ' → ' + $('walk-to').value +
            ' (clipped to each axis’ own range) · ' + ms + ' ms/frame' +
            (pingPong ? ' · ping-pong' : ''), 'head');
    logLine('into ' + dir, 'dim');

    for (let i = 0; i < axes.length; i++) {
      if (signal.cancelled) break;
      const axis = axes[i];
      const values = grids[i];
      // This axis is the variable, so it must not also sit in the constants —
      // otherwise its current resting value would be baked into the folder's
      // identity and a walk of the same axis from a different resting position
      // would look like different settings. How to set it aside is the axis'
      // own business: an `axisControls` key is deleted, a baked bank drops one
      // of its keys, an expression is displaced outright.
      const constants = Object.assign({}, baseMsg);
      axis.hold(constants);
      delete constants.type;

      const label = axis.label + (axis.label === axis.key ? '' : ' (' + axis.key + ')');
      const line = logLine('walking ' + label + '…');
      status('walking ' + label + ' · axis ' + (i + 1) + '/' + axes.length);

      const anims = [{ msPerFrame: ms, pingPong: pingPong, format: 'webm',
                       name: 'walk_' + values.length + 'f_' + ms + 'ms' + (pingPong ? '_pp' : '') }];
      if (alsoGif) anims.push({ msPerFrame: ms, pingPong: pingPong, format: 'gif',
                                name: 'walk_' + values.length + 'f_' + ms + 'ms' + (pingPong ? '_pp' : '') });

      try {
        const res = await runner.runSweep({
          name: axis.key,
          baseKey: constants,
          values: values,
          frameName: frameName,
          animations: anims,
          signal: signal,
          onProgress: (p) => {
            const overall = doneFrames + p.done;
            setProgress(overall, totalFrames);
            const el = Math.round((Date.now() - t0) / 1000);
            line.textContent = 'walking ' + label + ' · ' + p.done + '/' + p.total +
                               (p.reused ? ' (reused)' : '') + ' · ' + el + 's';
          },
          render: (v) => {
            const msg = Object.assign({ type: 'generate' }, constants);
            axis.apply(msg, v);
            return renderMsg(msg);
          },
        });
        doneFrames += values.length;
        renderedTotal += res.rendered;
        reusedTotal += res.reused;
        const vids = res.animations.map((a) => a.file + (a.reused ? ' (kept)' : '')).join(', ');
        line.textContent = label + ' · ' + res.rendered + ' rendered, ' + res.reused +
                           ' reused · ' + (vids || 'no animation') +
                           (res.cancelled ? ' · cancelled' : '');
        line.className = 'walk-log-line ok';
        const link = document.createElement('div');
        link.className = 'walk-log-path';
        link.textContent = res.dir;
        link.title = 'output folder for this walk';
        $('walk-log').appendChild(link);
      } catch (e) {
        failed++;
        line.textContent = label + ' · FAILED: ' + (e.message || e);
        line.className = 'walk-log-line err';
        doneFrames += values.length;
      }
    }

    const secs = Math.round((Date.now() - t0) / 1000);
    running = false;
    ctx.setBusy(false);
    ctx.refreshButtons();
    $('walk-progress').classList.remove('show');
    $('walk-progress').firstElementChild.style.width = '0%';
    const summary = renderedTotal + ' rendered · ' + reusedTotal + ' reused · ' +
                    secs + 's' + (failed ? ' · ' + failed + ' failed' : '');
    logLine(signal.cancelled ? 'cancelled — ' + summary : 'done — ' + summary,
            failed ? 'err' : 'head');
    status(signal.cancelled ? 'cancelled · ' + summary : 'done · ' + summary,
           failed ? 'err' : 'ok');
    ctx.pump();
  }

  // Cancel takes effect between frames: a render already inside the worker runs
  // to completion (the pipeline has no abort seam), and letting it finish means
  // it lands in the cache instead of being thrown away.
  function cancel() {
    if (!running) return;
    signal.cancelled = true;
    status('cancelling — finishing the frame in flight…', 'warn');
    $('btn-walk-cancel').disabled = true;
  }

  $('btn-walk-start').addEventListener('click', () => { start(); });
  $('btn-walk-cancel').addEventListener('click', cancel);
  $('btn-walk-dir').addEventListener('click', chooseDir);
  $('walk-filter').addEventListener('input', applyFilter);
  $('walk-kind').addEventListener('change', applyFilter);
  $('walk-dir').addEventListener('change', ctx.persist);
  ['walk-from', 'walk-to', 'walk-steps', 'walk-ms'].forEach((id) => {
    $(id).addEventListener('change', () => { refreshCount(); ctx.persist(); });
    $(id).addEventListener('input', refreshCount);
  });
  ['walk-pingpong', 'walk-gif'].forEach((id) => {
    $(id).addEventListener('change', ctx.persist);
  });
  $('btn-walk-none').addEventListener('click', () => {
    selected = [];
    rows.forEach((r) => { r.cb.checked = false; });
    refreshCount(); applyFilter(); ctx.persist();
  });
  // "every axis the filter is currently showing" — the useful bulk action, and
  // the only safe one: a naked select-all over 400 unnamed atoms would queue
  // days of rendering behind one click.
  $('btn-walk-shown').addEventListener('click', () => {
    rows.forEach((r) => {
      if (r.row.style.display === 'none') return;
      r.cb.checked = true;
      if (selected.indexOf(r.key) < 0) selected.push(r.key);
    });
    refreshCount(); applyFilter(); ctx.persist();
  });

  // Both hooks just try a build; build() itself is the no-op when the catalogue
  // has not grown. onDeckRefresh runs on every committed control change, which
  // is exactly when a newly minted axis would appear.
  ctx.onAxesMeta(build);
  ctx.onDeckRefresh(build);

  refreshCount();

  ctx.onRefreshButtons((busyOrUnloaded) => {
    $('btn-walk-start').disabled = running || busyOrUnloaded || !selected.length;
    $('btn-walk-cancel').disabled = !running;
  });
  ctx.onPersist((p) => {
    p.walkAxes = selected;
    p.walkFrom = $('walk-from').value;
    p.walkTo = $('walk-to').value;
    p.walkSteps = $('walk-steps').value;
    p.walkMs = $('walk-ms').value;
    p.walkDir = $('walk-dir').value;
    p.walkPingPong = $('walk-pingpong').checked;
    p.walkGif = $('walk-gif').checked;
  });

  // The held constants for one axis, exactly as start() computes them. This is
  // the value whose hash names the output folder, so a test can assert that two
  // configurations really are (or are not) the same settings.
  function constantsFor(axisKey) {
    const row = rows.filter((r) => r.key === axisKey)[0];
    const constants = Object.assign({}, ctx.buildGenerateMsg('full'));
    (row ? row.hold : defaultHold(axisKey))(constants);
    delete constants.type;
    return constants;
  }

  // Test seam: headless tests drive the runner without a model by substituting
  // their own render function, and need the value grid + naming to assert on.
  ctx.walkInternals = { walkValues: walkValues, frameName: frameName,
                        constantsFor: constantsFor,
                        get selected() { return selected.slice(); },
                        get rows() { return rows.slice(); },
                        rebuild: build };
}
