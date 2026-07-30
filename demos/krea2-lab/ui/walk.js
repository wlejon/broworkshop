// Walk: render an axis across its range and save the result as a set of stills
// plus one animation — the artifact that actually shows what an axis DOES.
//
// A slider tells you nothing until you have seen both ends of it and the road
// between. The isolation sweep in the mint section makes five small frames at
// ±6 with everything else neutralized, which answers "is this a control";
// a walk answers "what is this control worth", at full size, with YOUR prompt
// and YOUR other settings left exactly as they are.
//
// One axis at a time by default. Every frame in such a walk differs from its
// neighbours in exactly one number, so the axis is the only explanation for what
// moved — which is the whole claim a showcase makes. Selecting N axes therefore
// runs N independent walks rather than a grid.
//
// But some concepts are not one axis. The mouth barely opens unless `round`
// travels against `open`, and reading `open` alone would say the model has no
// mouth control when it plainly does. So a selection can instead be walked as
// one RIG: every member moves on every frame, each along its own from/to (set
// them the other way round to send an axis backwards), all on one shared 0…1
// parameter. That trades "the axis is the only explanation" for "the rig is",
// which is the honest claim when the members only mean something together — and
// it is a choice made in the UI rather than one made for you.
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
  // key -> {from, to}, only for axes given a range of their own
  let ranges = (prefs.walkRanges && typeof prefs.walkRanges === 'object')
    ? JSON.parse(JSON.stringify(prefs.walkRanges)) : {};
  let builtLen = '';      // catalogue signature the current rows were built from

  if (prefs.walkSteps != null) $('walk-steps').value = prefs.walkSteps;
  if (prefs.walkMs != null) $('walk-ms').value = prefs.walkMs;
  if (prefs.walkPingPong != null) $('walk-pingpong').checked = !!prefs.walkPingPong;
  if (prefs.walkGif != null) $('walk-gif').checked = !!prefs.walkGif;
  if (prefs.walkTogether) $('walk-mode-together').checked = true;
  else $('walk-mode-each').checked = true;
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
  const stepCount = () =>
    Math.max(2, Math.min(101, Math.round(+$('walk-steps').value) || 2));
  const snap = (v) => Math.round(Math.round(v / AXIS_STEP) * AXIS_STEP * 100) / 100;

  // Every axis owns its range outright. There used to be one from/to for the
  // whole run with per-axis overrides layered on top, and that was wrong twice
  // over: "-6 → 6" meant nothing once a baked bank clipped it to ±3 and an
  // expression to 0…5, and a range that merely FOLLOWED the panel was recomputed
  // on every refresh — so nudging the frame count appeared to throw the ranges
  // away. Now a newly selected axis starts at its own full domain and the number
  // in the box is the only thing that decides, forever.
  //
  // from > to is not an error: it reverses the interpolation, which is what a rig
  // needs — the mouth barely opens unless `round` travels against `open`.
  function domainOf(axis) {
    return { lo: axis && isFinite(axis.min) ? axis.min : AXIS_MIN,
             hi: axis && isFinite(axis.max) ? axis.max : AXIS_MAX };
  }
  function effectiveRange(axis) {
    const d = domainOf(axis);
    const own = axis && ranges[axis.key];
    if (!own) return { from: d.lo, to: d.hi, lo: d.lo, hi: d.hi, set: false };
    // Still clipped: an axis' domain can narrow under a stored range (a bank
    // reloads, a walk is restored from prefs written against a wider axis).
    return { from: clamp(own.from, d.lo, d.hi), to: clamp(own.to, d.lo, d.hi),
             lo: d.lo, hi: d.hi, set: true };
  }

  function walkValues(axis) {
    const r = effectiveRange(axis);
    const n = stepCount();
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = snap(r.from + (r.to - r.from) * (i / (n - 1)));
      if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
    }
    return out;
  }
  const clamp = (v, lo, hi) =>
    Math.max(lo === undefined ? AXIS_MIN : lo,
             Math.min(hi === undefined ? AXIS_MAX : hi, isFinite(v) ? v : 0));

  // ── walking several axes as one rig ───────────────────────────────────────
  // One frame moves EVERY member, each along its own range, all on the same
  // 0…1 parameter. The step grid is shared; the ranges are not.
  //
  // A frame's identity is the whole vector plus its position along the walk, so
  // the same reuse rule holds as for a single axis: doubling the frame count
  // re-renders only the steps that fall between the ones already on disk, and
  // changing any member's range forks new files beside the old ones rather than
  // overwriting a walk you already made.
  function comboGrid(members) {
    const n = stepCount();
    const rs = members.map(effectiveRange);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const v = {};
      members.forEach((m, j) => { v[m.key] = snap(rs[j].from + (rs[j].to - rs[j].from) * t); });
      const sig = JSON.stringify(v);
      if (out.length && out[out.length - 1].sig === sig) continue;
      out.push({ t: Math.round(t * 10000) / 10000, v: v, sig: sig });
    }
    // `sig` was only for the dedupe — it must not reach the frame hash, or the
    // key ORDER of a JSON string would quietly become part of a frame's identity.
    return out.map((e) => ({ t: e.t, v: e.v }));
  }

  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // Sortable by position first (so a directory listing reads in walk order),
  // then the vector itself, so two runs that pass through the same point share
  // the frame. Long rigs fall back to a hash of the vector rather than a
  // filename the OS would refuse.
  function comboFrameName(entry) {
    const head = 't' + String(Math.round(entry.t * 10000)).padStart(5, '0');
    const parts = Object.keys(entry.v).sort().map((k) => {
      const v = entry.v[k];
      return (v < 0 ? 'm' : 'p') + Math.abs(v).toFixed(2);
    });
    const tail = parts.join('_');
    return tail.length <= 56 ? head + '_' + tail : head + '_' + fnv(tail);
  }

  function comboName(members) {
    const keys = members.map((m) => m.key).sort();
    const joined = keys.join('+');
    // sanitizeName() truncates at 80, which would let two long rigs collide in
    // one folder — so a long rig names itself by its first member and a hash.
    return 'rig_' + (joined.length <= 56
      ? joined
      : keys[0] + '+' + (keys.length - 1) + 'more_' + fnv(joined));
  }

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
                  exclusive: a.exclusive || '',
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

  const pickedAxes = () => rows.filter((r) => selected.indexOf(r.key) >= 0);
  const together = () => $('walk-mode-together').checked;

  // ── per-axis range rows ───────────────────────────────────────────────────
  // Rebuilt ONLY when the selection changes. Everything else that refreshes the
  // panel — a frame count, a mode switch — leaves these rows and their DOM alone,
  // because blowing them away and re-seeding them from a default is exactly how
  // a configured range used to disappear when you nudged something unrelated.
  let rangeRowsFor = null;
  function buildRanges(force) {
    const picked = pickedAxes();
    const sig = picked.map((p) => p.key).join('|');
    if (!force && sig === rangeRowsFor) return;
    rangeRowsFor = sig;

    const host = $('walk-ranges');
    host.innerHTML = '';
    picked.forEach((axis) => {
      const r = effectiveRange(axis);
      const row = document.createElement('div');
      row.className = 'walk-rng' + (r.set ? ' set' : '');
      row.setAttribute('data-key', axis.key);

      const nm = document.createElement('span');
      nm.className = 'walk-rng-name';
      nm.textContent = axis.label;
      nm.title = axis.key + ' · can hold ' + r.lo + ' … ' + r.hi;
      row.appendChild(nm);

      const mk = (which) => {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.25';
        inp.min = String(r.lo); inp.max = String(r.hi);
        inp.value = String(r[which]);
        inp.title = which + ' (' + r.lo + ' … ' + r.hi + ') — set from above to ' +
                    'to run this axis backwards';
        const commit = (live) => {
          const raw = String(inp.value).trim();
          // Mid-typing "-" or "" is not a value. Committing it live would write a
          // 0 and fight the person typing "-3".
          if (live && (raw === '' || raw === '-' || !isFinite(+raw))) return;
          const cur = effectiveRange(axis);
          const next = { from: cur.from, to: cur.to };
          next[which] = clamp(+raw, r.lo, r.hi);
          ranges[axis.key] = next;
          row.classList.add('set');
          ctx.persist();
          refreshPlan();
        };
        // Both, because a value typed and left without blurring should still
        // count — a walk started from a box that never fired `change` would
        // silently use the old number.
        inp.addEventListener('input', () => commit(true));
        inp.addEventListener('change', () => commit(false));
        return inp;
      };
      row.appendChild(mk('from'));
      const flip = document.createElement('button');
      flip.type = 'button';
      flip.textContent = '↔';
      flip.title = 'run this axis the other way';
      flip.addEventListener('click', () => {
        const cur = effectiveRange(axis);
        ranges[axis.key] = { from: cur.to, to: cur.from };
        ctx.persist();
        refreshCount(true);
      });
      row.appendChild(flip);
      row.appendChild(mk('to'));

      const clr = document.createElement('button');
      clr.type = 'button';
      clr.className = 'clr';
      clr.textContent = '⤢';
      clr.title = 'back to this axis’ full range (' + r.lo + ' … ' + r.hi + ')';
      clr.addEventListener('click', () => {
        delete ranges[axis.key];
        ctx.persist();
        refreshCount(true);
      });
      row.appendChild(clr);
      host.appendChild(row);
    });
  }

  function refreshCount(force) {
    buildRanges(force);
    refreshPlan();
  }

  // The plan line and the badge, with no DOM rebuilt — safe to call from inside
  // a range input's own handler.
  function refreshPlan() {
    const n = selected.length;
    const picked = pickedAxes();
    $('walk-count').textContent = n ? String(n) : '';
    $('walk-count').classList.toggle('show', n > 0);
    if (!n) {
      $('walk-plan').textContent = 'pick one or more axes to walk';
      ctx.refreshButtons();
      return;
    }
    if (together()) {
      const frames = comboGrid(picked).length;
      $('walk-plan').textContent =
        (n === 1 ? '1 axis' : n + ' axes moving together') + ' × ' + frames +
        ' frames = ' + frames + ' renders (already-rendered frames are skipped)';
    } else {
      // Summed, not multiplied: each axis walks its own range over its own
      // domain, so the frame count is per axis and the total is the honest
      // number of renders.
      let total = 0, minF = Infinity, maxF = 0;
      picked.forEach((r) => {
        const f = walkValues(r).length;
        total += f;
        if (f < minF) minF = f;
        if (f > maxF) maxF = f;
      });
      const each = maxF === minF ? maxF + ' frames' : minF + '–' + maxF + ' frames';
      $('walk-plan').textContent =
        (n === 1 ? '1 axis' : n + ' axes') + ' × ' + each + ' = ' +
        total + ' renders (already-rendered frames are skipped)';
    }
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
    const axes = pickedAxes();

    // One job = one sweep = one folder and one animation. Walking axes on their
    // own makes a job each; walking them together makes exactly one, whose value
    // is the whole vector rather than a number.
    let jobs;
    if (together()) {
      // Two members of the same exclusive field cannot both be on a frame — the
      // second would simply overwrite the first and the walk would silently be
      // of one axis. Say so instead of rendering nonsense.
      const groups = {};
      for (const a of axes) {
        if (!a.exclusive) continue;
        if (groups[a.exclusive]) {
          status('“' + groups[a.exclusive] + '” and “' + a.label + '” cannot move ' +
                 'on the same frame — a render carries one ' + a.exclusive +
                 ', so walk them separately', 'err');
          return;
        }
        groups[a.exclusive] = a.label;
      }
      const grid = comboGrid(axes);
      const constants = Object.assign({}, baseMsg);
      axes.forEach((a) => a.hold(constants));
      delete constants.type;
      jobs = [{
        name: comboName(axes),
        label: axes.length + ' axes together (' + axes.map((a) => a.label).join(', ') + ')',
        constants: constants,
        values: grid,
        frameName: comboFrameName,
        apply: (msg, entry) => axes.forEach((a) => a.apply(msg, entry.v[a.key])),
      }];
    } else {
      jobs = axes.map((axis) => {
        // This axis is the variable, so it must not also sit in the constants —
        // otherwise its current resting value would be baked into the folder's
        // identity and a walk of the same axis from a different resting position
        // would look like different settings. How to set it aside is the axis'
        // own business: an `axisControls` key is deleted, a baked bank drops one
        // of its keys, an expression is displaced outright.
        const constants = Object.assign({}, baseMsg);
        axis.hold(constants);
        delete constants.type;
        return {
          name: axis.key,
          label: axis.label + (axis.label === axis.key ? '' : ' (' + axis.key + ')'),
          constants: constants,
          values: walkValues(axis),
          frameName: frameName,
          apply: (msg, v) => axis.apply(msg, v),
        };
      });
    }

    running = true;
    signal = { cancelled: false };
    ctx.setBusy(true);
    ctx.refreshButtons();
    $('walk-log').innerHTML = '';
    const t0 = Date.now();
    let totalFrames = jobs.reduce((s, j) => s + j.values.length, 0), doneFrames = 0;
    let renderedTotal = 0, reusedTotal = 0, failed = 0;
    logLine(axes.length + (together() ? ' axes as one rig · ' : ' axes · ') +
            totalFrames + ' frames · ' + ms + ' ms/frame' +
            (pingPong ? ' · ping-pong' : ''), 'head');
    // Every axis' range, written down: the log is the record of what a walk on
    // disk actually was, and the ranges are half of that.
    axes.forEach((a) => {
      const r = effectiveRange(a);
      logLine('  ' + a.label + ': ' + r.from.toFixed(2) + ' → ' + r.to.toFixed(2), 'dim');
    });
    logLine('into ' + dir, 'dim');

    for (let i = 0; i < jobs.length; i++) {
      if (signal.cancelled) break;
      const job = jobs[i];
      const values = job.values;
      const constants = job.constants;
      const label = job.label;
      const line = logLine('walking ' + label + '…');
      status('walking ' + label + (jobs.length > 1
        ? ' · ' + (i + 1) + '/' + jobs.length : ''));

      const anims = [{ msPerFrame: ms, pingPong: pingPong, format: 'webm',
                       name: 'walk_' + values.length + 'f_' + ms + 'ms' + (pingPong ? '_pp' : '') }];
      if (alsoGif) anims.push({ msPerFrame: ms, pingPong: pingPong, format: 'gif',
                                name: 'walk_' + values.length + 'f_' + ms + 'ms' + (pingPong ? '_pp' : '') });

      try {
        const res = await runner.runSweep({
          name: job.name,
          baseKey: constants,
          values: values,
          frameName: job.frameName,
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
            job.apply(msg, v);
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
  ['walk-steps', 'walk-ms'].forEach((id) => {
    $(id).addEventListener('change', () => { refreshPlan(); ctx.persist(); });
    $(id).addEventListener('input', refreshPlan);
  });
  ['walk-pingpong', 'walk-gif'].forEach((id) => {
    $(id).addEventListener('change', ctx.persist);
  });
  ['walk-mode-each', 'walk-mode-together'].forEach((id) => {
    $(id).addEventListener('change', () => { refreshPlan(); ctx.persist(); });
  });
  // Only the axes that have a row: a range stored for an axis you deselected is
  // not on screen, so wiping it here would be a change you could not see.
  $('btn-walk-full').addEventListener('click', () => {
    pickedAxes().forEach((a) => { delete ranges[a.key]; });
    ctx.persist();
    refreshCount(true);
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
    p.walkSteps = $('walk-steps').value;
    p.walkMs = $('walk-ms').value;
    p.walkDir = $('walk-dir').value;
    p.walkPingPong = $('walk-pingpong').checked;
    p.walkGif = $('walk-gif').checked;
    p.walkTogether = together();
    // Only the axes actually overridden — a range that merely follows the panel
    // is not state, and persisting it would freeze the panel's own from/to.
    p.walkRanges = ranges;
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
                        comboGrid: comboGrid, comboFrameName: comboFrameName,
                        comboName: comboName, effectiveRange: effectiveRange,
                        setRange: (k, from, to) => {
                          if (from == null) delete ranges[k];
                          else ranges[k] = { from: from, to: to };
                          refreshCount(true);
                        },
                        get selected() { return selected.slice(); },
                        get rows() { return rows.slice(); },
                        get picked() { return pickedAxes(); },
                        rebuild: build };
}
