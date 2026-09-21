// Signals — what the last render actually did, read off the model rather than
// inferred from the picture.
//
// TWO READOUTS.
//
// x̂0 preview. The flow-match Euler step is exact, so two consecutive latent
// snapshots recover the model's velocity and with it the clean image this step
// committed to — with no extra forward pass:
//
//     k = sigma_i / (sigma_{i+1} - sigma_i),   x̂0 = x_i - k * (x_{i+1} - x_i)
//
// Decoding that at a few steps answers WHEN an edit lands, which is the
// question the whole schedule editor exists to ask. Only the VAE decode costs
// anything, so the strip is a handful of steps and not all of them. Clicking a
// thumbnail arms the chosen control at that step, which closes the loop: see
// where the picture is still soft, put the edit there.
//
// Gate capture. qwenImage21CaptureGates fills two sinks — the mean effective
// ATTENTION gate and the mean effective SwiGLU gate per (block, row) — folded
// through every armed scale, post-tanh delta and mask. Four strips of 32: each
// sublayer against each row class. What it can show is that a mask or a scale
// landed on the blocks it was aimed at; what it cannot show is per-block
// structure, because one modulation vector drives all 32 blocks and with
// nothing armed every row is the same pair of constants.

import { $ } from '/app/ui/util.js';

export function initSignals(ctx) {
  const prefs = ctx.prefs;
  let x0Frames = [];

  if (prefs.sigCapture) $('sig-capture').checked = true;
  if (prefs.sigX0) $('sig-x0').checked = true;
  if (prefs.sigX0Steps) $('sig-x0-steps').value = prefs.sigX0Steps;
  if (prefs.sigX0N != null) $('sig-x0-n').value = prefs.sigX0N;

  const steps = () => Math.max(1, +$('steps').value || 8);

  // 'auto' spreads the thumbnails evenly over the run, always including the
  // last step — the one that is the finished picture.
  function wantedSteps() {
    const n = steps();
    const raw = $('sig-x0-steps').value.trim();
    if (raw && raw.toLowerCase() !== 'auto') {
      return raw.split(/[,\s]+/).map((s) => parseInt(s, 10))
                .filter((v) => !isNaN(v) && v >= 0 && v < n);
    }
    const k = Math.max(1, Math.min(n, +$('sig-x0-n').value | 0));
    const out = [];
    for (let i = 0; i < k; i++) out.push(Math.round((i + 1) * (n - 1) / k));
    return out.filter((v, i, a) => a.indexOf(v) === i);
  }

  // ── the arm-step targets ────────────────────────────────────────────────
  // Every control with an arm step, named: the gate brush and each spatial
  // region. Clicking an x̂0 thumbnail moves the chosen one to that step.
  function armTargets() {
    const out = [{ key: 'mask', label: 'gate mask brush',
                   set: (s) => { $('gp-at').value = String(s); $('gp-at').dispatchEvent(new Event('change')); } }];
    (ctx.spatialRegions ? ctx.spatialRegions() : []).forEach((r) => {
      out.push({ key: 'region:' + r.id, label: 'region · ' + r.name,
                 set: (s) => { r.at = s; $('sp-at').value = String(s); ctx.persist(); } });
    });
    return out;
  }
  function fillArm() {
    const sel = $('sig-arm');
    const keep = sel.value;
    sel.innerHTML = '';
    armTargets().forEach((t) => {
      const o = document.createElement('option');
      o.value = t.key; o.textContent = t.label;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  }

  // ── the x̂0 strip ────────────────────────────────────────────────────────
  function renderX0(list) {
    const host = $('sig-x0-strip');
    host.innerHTML = '';
    x0Frames = list || [];
    if (!x0Frames.length) {
      const e = document.createElement('div');
      e.className = 'dim';
      e.textContent = 'tick “x̂0 preview” and render — the estimate is free, the decode is not';
      host.appendChild(e);
      return;
    }
    x0Frames.forEach((f) => {
      const cell = document.createElement('div');
      cell.className = 'walk-cell';
      const cv = document.createElement('canvas');
      const BOX = 150;
      const s = Math.min(BOX / f.width, BOX / f.height, 1);
      cv.width = Math.round(f.width * s); cv.height = Math.round(f.height * s);
      cv.getContext('2d').drawImage(f.bitmap, 0, 0, cv.width, cv.height);
      cv.title = 'arm the selected control at step ' + f.step;
      const lab = document.createElement('div');
      lab.className = 'walk-label';
      lab.textContent = 'step ' + f.step;
      cell.appendChild(cv); cell.appendChild(lab);
      cell.addEventListener('click', () => {
        const t = armTargets().filter((x) => x.key === $('sig-arm').value)[0] || armTargets()[0];
        t.set(f.step);
        host.querySelectorAll('.walk-cell').forEach((c) => c.classList.remove('pick'));
        cell.classList.add('pick');
        $('sig-status').textContent = t.label + ' armed at step ' + f.step;
      });
      host.appendChild(cell);
    });
  }

  // ── the gate strip ──────────────────────────────────────────────────────
  // One cell per block, coloured on the band the four strips actually occupy —
  // a fixed 0..1 ramp would make every strip the same shade of nothing, since
  // an untouched gate sits in a narrow range and the whole point is to see
  // where an armed hook moved it.
  function colorOf(v, lo, hi) {
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    const u = Math.max(0, Math.min(1, t));
    const r = Math.round(20 + 220 * u), g = Math.round(40 + 110 * u), b = Math.round(90 - 40 * u);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  let lastGates = null;
  function renderGates(gates) {
    lastGates = gates;
    const host = $('sig-gates');
    host.innerHTML = '';
    if (!gates) {
      $('sig-gates-legend').textContent = '';
      const e = document.createElement('div');
      e.className = 'dim';
      e.textContent = 'tick “capture gates” and render — one device readback per render';
      host.appendChild(e);
      return;
    }
    const rows = [
      ['attn · txt', gates.attn.map((g) => g.prefix)],
      ['attn · img', gates.attn.map((g) => g.img)],
      ['mlp · txt', gates.mlp.map((g) => g.prefix)],
      ['mlp · img', gates.mlp.map((g) => g.img)],
    ];
    let lo = Infinity, hi = -Infinity;
    rows.forEach(([, vals]) => vals.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    rows.forEach(([label, vals]) => {
      const row = document.createElement('div');
      row.className = 'gate-strip-row';
      const lab = document.createElement('span');
      lab.className = 'gate-strip-label'; lab.textContent = label;
      const cells = document.createElement('div');
      cells.className = 'gate-strip-cells';
      vals.forEach((v, i) => {
        const c = document.createElement('div');
        c.className = 'gate-cell';
        c.style.background = colorOf(v, lo, hi);
        c.title = 'block ' + i + ' · ' + label + ' · ' + v.toFixed(4);
        cells.appendChild(c);
      });
      row.appendChild(lab); row.appendChild(cells);
      host.appendChild(row);
    });
    const imgMin = Math.min.apply(null, gates.attn.map((g) => g.imgMin));
    $('sig-gates-legend').textContent =
      gates.attn.length + ' blocks × ' + gates.cols + ' rows (' + gates.prefix +
      ' prefix + ' + gates.imgLen + ' image) · scale ' + lo.toFixed(4) + ' … ' + hi.toFixed(4) +
      ' · lowest single attn·img row ' + imgMin.toFixed(4) +
      ' — a mask shows up there before it shows up in a mean';
  }

  ['sig-capture', 'sig-x0'].forEach((id) => $(id).addEventListener('change', () => {
    ctx.persist();
    if (ctx.live) ctx.schedule('full');
  }));
  ['sig-x0-steps', 'sig-x0-n'].forEach((id) => $(id).addEventListener('change', ctx.persist));

  ctx.onPersist((p) => {
    p.sigCapture = $('sig-capture').checked;
    p.sigX0 = $('sig-x0').checked;
    p.sigX0Steps = $('sig-x0-steps').value;
    p.sigX0N = $('sig-x0-n').value;
  });
  ctx.onGenerateMsg((msg) => {
    if ($('sig-capture').checked) msg.captureGates = true;
    if ($('sig-x0').checked) {
      const s = wantedSteps();
      if (s.length) msg.x0 = { steps: s };
    }
  });
  ctx.onRender((frame, msg, resp) => {
    fillArm();
    if (resp.x0) renderX0(resp.x0);
    if (resp.gates) renderGates(resp.gates);
    $('sig-timing').textContent =
      (resp.x0 ? resp.x0.length + ' x̂0 decodes · ' : '') +
      (resp.gates ? 'gates captured · ' : '') +
      (resp.msPerStep ? (resp.msPerStep / 1000).toFixed(2) + ' s/step' : '');
    $('sig-note').textContent = resp.schedules
      ? resp.schedules + ' control schedule' + (resp.schedules === 1 ? '' : 's') + ' armed' : '';
  });
  ctx.onDeckRefresh(fillArm);

  // Test seams.
  ctx.sigWantedSteps = wantedSteps;
  ctx.x0Frames = () => x0Frames.slice();
  ctx.setSignals = (capture, x0) => {
    $('sig-capture').checked = !!capture;
    $('sig-x0').checked = !!x0;
    ctx.persist();
  };
  ctx.lastGates = () => lastGates;

  fillArm();
  renderX0([]);
  renderGates(null);
}
