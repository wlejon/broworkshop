// Solve tab: bro.solveWithCert finds one input that makes a predicate true
// (or proves none exists); bro.solveAll enumerates the solution set. The page
// re-runs the predicate on every answer and brute-forces a window itself, so
// "found", "all of them" and "none exists" are each checked, not just shown.

import { $, readout, segmented } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, alpha, compileFn, paramNames, verdict, checks, legend, presetPicker, hex32, num } from "./common.js";

export const PRESETS = {
  xorSum: {
    label: 'XOR and sum',
    mode: 'one',
    note: 'Two unknowns tied together by XOR and addition. The solver turns both operators into bit-level clauses and solves them in one SAT problem.',
    window: [1, 1023],
    derived: [
      { label: 'x ^ y', f: (x, y) => x ^ y, want: 42 },
      { label: 'x + y', f: (x, y) => x + y, want: 170 },
    ],
    src: `function xorSum(x, y) {
  if (x <= 0 || y <= 0) return 0;
  if (x >= 1024 || y >= 1024) return 0;
  return (x ^ y) === 42 && x + y === 170 && x < y;
}`,
  },
  hash: {
    label: 'Hash preimage',
    mode: 'one',
    note: 'Find an input whose multiplicative hash has 0xBEEF in its top 16 bits. There is no algebraic inverse to apply; the solver searches the multiplier circuit bit by bit.',
    derived: [
      { label: 'imul(x, 0x9E3779B1)', f: (x) => Math.imul(x, 0x9E3779B1) >>> 0, wantBits: [16, 31, 0xBEEF] },
      { label: 'h = … >>> 16', f: (x) => Math.imul(x, 0x9E3779B1) >>> 16, want: 0xBEEF },
    ],
    src: `function preimage(x) {
  const h = Math.imul(x, 0x9E3779B1) >>> 16;
  return h === 0xBEEF;
}`,
  },
  triple: {
    label: 'Pythagorean triple',
    mode: 'one',
    note: 'Three unknowns, two multiplications each side: a right triangle with whole sides, the short side above 20.',
    window: [1, 99],
    derived: [
      { label: 'a² + b²', f: (a, b) => a * a + b * b },
      { label: 'c²', f: (a, b, c) => c * c, sameAs: 0 },
    ],
    src: `function triple(a, b, c) {
  if (a < 1 || b < 1 || c < 1) return 0;
  if (a > 99 || b > 99 || c > 99) return 0;
  return a * a + b * b === c * c && a < b && a > 20;
}`,
  },
  sierpinski: {
    label: 'Sierpinski set',
    mode: 'all',
    limit: 1024,
    window: [0, 63, 0, 63],
    note: 'Every (x, y) with no set bit in common. bro.solveAll enumerates the set; the page brute-forces the same 64×64 window to show the solver found every point and nothing else.',
    src: `function sierpinski(x, y) {
  if (x < 0 || y < 0 || x > 63 || y > 63) return 0;
  return (x & y) === 0;
}`,
  },
  lattice: {
    label: 'XOR lattice in a disc',
    mode: 'all',
    limit: 1024,
    window: [-40, 40, -40, 40],
    note: 'A nonlinear disc intersected with a bitwise lattice, over negative and positive inputs alike.',
    src: `function lattice(x, y) {
  if (x < -40 || y < -40 || x > 40 || y > 40) return 0;
  return x * x + y * y < 900 && ((x ^ y) & 7) === 0;
}`,
  },
  none: {
    label: 'No solution',
    mode: 'one',
    window: [0, 46340],
    note: 'An odd number squared is odd, so no input can satisfy this. A test can only fail to find one; the solver proves there is none.',
    src: `function oddSquareIsEven(x) {
  if (x < 0 || x > 46340 || (x & 1) === 0) return 0;
  return ((x * x) & 1) === 0;
}`,
  },
};

const BRUTE_LIMIT = 2_000_000;

export function createSolveTab(app) {
  const kv = readout('#solve-kv', {
    status: 'status',
    model: 'assignment',
    time: 'solve time',
  });
  const answer = verdict('#solve-verdict');
  const checkList = checks('#solve-checks');
  const picker = presetPicker('#solve-presets', PRESETS, (k) => load(k));
  const mode = segmented('#solve-mode', [['one', 'one solution'], ['all', 'every solution']], {
    value: 'one',
    onChange: () => { syncMode(); run(); },
  });

  const state = { key: null, result: null, all: null, truth: null, window: null };

  function syncMode() {
    $('#solve-limit-field').hidden = mode.value !== 'all';
  }

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#solve-src').value = p.src;
    $('#solve-note').textContent = p.note;
    mode.value = p.mode;
    if (p.limit) $('#solve-limit').value = String(p.limit);
    syncMode();
    run();
  }

  function run() {
    const src = $('#solve-src').value;
    const preset = PRESETS[state.key] || {};
    let fn;
    try { fn = compileFn(src); } catch (e) { app.fail('Predicate does not compile: ' + e.message); return; }
    const names = paramNames(src);
    state.result = null; state.all = null; state.truth = null;
    state.window = preset.window || null;

    if (mode.value === 'all') runAll(src, fn, names, preset); else runOne(src, fn, names, preset);
    app.redraw();
  }

  function runOne(src, fn, names, preset) {
    const t0 = Date.now();
    const r = bro.solveWithCert(src);
    const wall = Date.now() - t0;
    state.result = r;
    const list = [];
    if (r.sat) {
      const args = r.args || [];
      const text = names.map((n, i) => `${n} = ${args[i]}`).join(', ');
      answer.set('ok', 'SAT', text);
      kv.set('status', 'satisfiable', true);
      kv.set('model', text);
      const ran = fn(...args);
      list.push({ ok: !!ran, label: `f(${args.join(', ')}) returns ${JSON.stringify(ran)} when the page runs it` });
      if (names.length === 1) list.push(bruteFirst(fn, args[0]));
      else if (preset.window && src === preset.src) list.push(bruteBox(fn, names.length, preset.window, args));
      for (const d of (src === preset.src && preset.derived) || []) {
        if (d.want === undefined) continue;
        const got = d.f(...args);
        list.push({ ok: got === d.want, label: `${d.label} = ${got}, the predicate asks for ${d.want}` });
      }
    } else {
      answer.set('err', 'UNSAT', 'no input satisfies the predicate');
      kv.set('status', 'unsatisfiable (proven)', false);
      kv.set('model', '—');
      list.push(scanNone(fn, names, preset.window));
    }
    kv.set('time', `${(r.solveTimeMs || 0).toFixed(1)} ms (call ${wall} ms)`);
    const tally = checkList.set(list);
    app.report({ verdict: r.sat ? 'SAT' : 'UNSAT', solved: `${names.length} var${names.length === 1 ? '' : 's'}`, checks: `${tally.passed}/${list.length}` },
      r.sat ? 'Witness found and re-checked by the page' : 'Proven unsatisfiable', tally.failed ? 'warn' : 'ok');
  }

  function runAll(src, fn, names, preset) {
    const limit = Math.max(1, Math.min(4096, Number($('#solve-limit').value) || 1024));
    const t0 = Date.now();
    const sols = bro.solveAll(src, limit, {}) || [];
    const ms = Date.now() - t0;
    state.all = sols;
    answer.set(sols.length ? 'ok' : 'err', sols.length ? `${num(sols.length)} SOLUTIONS` : 'UNSAT',
      sols.length >= limit ? `stopped at the limit of ${num(limit)}` : 'the complete set');
    kv.set('status', sols.length ? `${num(sols.length)} found` : 'none', sols.length > 0);
    kv.set('model', sols.slice(0, 4).map((s) => `(${s.join(', ')})`).join(' ') + (sols.length > 4 ? ' …' : ''));
    kv.set('time', `${ms} ms for the set`);

    const list = [];
    const bad = sols.filter((s) => !fn(...s));
    list.push({ ok: bad.length === 0, label: bad.length ? `${bad.length} returned solutions fail when the page runs them` : `all ${num(sols.length)} solutions hold when the page runs them` });
    if (names.length === 2 && preset.window) {
      const [x0, x1, y0, y1] = preset.window;
      const truth = new Set();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fn(x, y)) truth.add(x + ',' + y);
      state.truth = truth;
      const found = new Set(sols.map((s) => s[0] + ',' + s[1]));
      let missed = 0;
      for (const k of truth) if (!found.has(k)) missed++;
      const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
      list.push({
        ok: missed === 0,
        label: missed ? `missed ${num(missed)} of the ${num(truth.size)} solutions in the window` : `found every solution: the page's brute force over ${num(cells)} cells finds the same ${num(truth.size)}`,
        detail: sols.length >= limit ? 'raise "up to" to enumerate the whole set' : null,
      });
    }
    const tally = checkList.set(list);
    app.report({ verdict: `${sols.length} solutions`, solved: `${names.length} vars`, checks: `${tally.passed}/${list.length}` },
      `Enumerated ${num(sols.length)} solutions`, tally.failed ? 'warn' : 'ok');
  }

  // A one-variable witness: how far a brute-force scan from 0 has to go.
  function bruteFirst(fn, witness) {
    const t0 = Date.now();
    for (let i = 0; i < BRUTE_LIMIT; i++) {
      if (fn(i) || (i && fn(-i))) {
        return { ok: null, label: `a brute-force scan outward from 0 first hits after ${num(2 * i)} tries`, detail: `${Date.now() - t0} ms of page time; the solver's answer was ${hex32(witness)}` };
      }
    }
    return { ok: null, label: `a brute-force scan outward from 0 finds nothing in ${num(2 * BRUTE_LIMIT)} tries`, detail: `${Date.now() - t0} ms of page time; the solver searched all 2³² inputs symbolically` };
  }

  // Every argument over the preset's range: how many solutions exist, and is
  // the solver's witness one of them.
  function bruteBox(fn, n, [lo, hi], witness) {
    const t0 = Date.now();
    const v = new Array(n).fill(lo);
    let count = 0, tries = 0;
    for (;;) {
      tries++;
      if (fn(...v)) count++;
      let i = n - 1;
      while (i >= 0 && v[i] === hi) v[i--] = lo;
      if (i < 0) break;
      v[i]++;
    }
    const range = `${n === 2 ? 'pairs' : 'triples'} in [${lo}, ${hi}]`;
    return {
      ok: count > 0 && !!fn(...witness),
      label: `the page tries all ${num(tries)} ${range}: ${num(count)} solution${count === 1 ? '' : 's'}, the witness among them`,
      detail: `${Date.now() - t0} ms of page time`,
    };
  }

  function scanNone(fn, names, window) {
    if (names.length !== 1 || !window) return { ok: null, label: 'nothing for the page to scan' };
    const [lo, hi] = window;
    let hits = 0;
    for (let x = lo; x <= hi; x++) if (fn(x)) hits++;
    return { ok: hits === 0, label: `the page's scan of x ∈ [${num(lo)}, ${num(hi)}] finds ${hits ? num(hits) + ' solutions' : 'none either'}`, detail: 'a scan covers only its window; the solver\'s UNSAT covers every int32' };
  }

  function draw() {
    const { ctx, w, h: hh } = fitCanvas('#solve-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    const hint = $('#solve-hint');
    hint.hidden = true;
    if (state.all) { drawSet(ctx, w, hh); return; }
    const r = state.result;
    if (!r) return;
    if (!r.sat) {
      $('#solve-title').textContent = 'No assignment exists';
      legend('#solve-legend', []);
      hint.hidden = false;
      hint.textContent = 'UNSAT: the solver proved that no input makes the predicate true.';
      return;
    }
    const src = $('#solve-src').value;
    const preset = PRESETS[state.key] || {};
    drawBits(ctx, w, hh, r.args || [], paramNames(src), src === preset.src ? preset.derived || [] : []);
  }

  // One row of 32 cells per argument, most significant bit on the left, then
  // a row per value the predicate computes from them, marked where it meets
  // what the predicate asks for.
  function drawBits(ctx, w, hh, args, names, derived) {
    $('#solve-title').textContent = derived.length ? 'The witness, and what the predicate computes from it' : 'The witness, bit by bit';
    legend('#solve-legend', derived.length
      ? [[C.accent, 'input bit'], [C.ok, 'computed bit'], [C.input, 'clear']]
      : [[C.accent, 'set bit'], [C.input, 'clear bit']]);

    const rows = args.map((v, i) => ({ label: `${names[i] || 'arg' + i} = ${v}`, v: v >>> 0, color: C.accent }));
    const values = derived.map((d) => d.f(...args) >>> 0);
    derived.forEach((d, i) => {
      const v = values[i];
      let mark = null;
      if (d.want !== undefined) mark = { ok: v === (d.want >>> 0), text: `= ${d.want} asked` };
      if (d.sameAs !== undefined) mark = { ok: v === values[d.sameAs], text: `= ${derived[d.sameAs].label}` };
      rows.push({ label: `${d.label} = ${v}`, v, color: C.ok, mark, bits: d.wantBits });
    });

    const pad = 48, gapSection = derived.length ? 34 : 0;
    const labelH = 24;
    let cell = Math.floor((w - pad * 2) / 32);
    const fit = (hh - pad * 2 - gapSection - 24) / rows.length - labelH - 10;
    cell = Math.max(10, Math.min(44, cell, Math.floor(fit)));
    const rowH = labelH + cell + 10;
    const gridW = cell * 32;
    const totalH = rows.length * rowH + gapSection + 24;
    const top = Math.max(pad / 2, (hh - totalH) / 2);
    const left = (w - gridW) / 2;
    const big = C.font.replace(/^\d+px/, cell >= 28 ? '14px' : '12px');

    // Byte guides through every row.
    ctx.fillStyle = C.border;
    for (const b of [24, 16, 8]) ctx.fillRect(left + (31 - b) * cell + cell - 0.5, top + labelH - 4, 1, totalH - labelH - 18);

    let y = top;
    rows.forEach((row, r) => {
      if (r === args.length && derived.length) {
        ctx.fillStyle = C.dim;
        ctx.font = C.font;
        ctx.textAlign = 'left';
        ctx.fillText('COMPUTED BY THE PREDICATE', left, y + 18);
        ctx.fillStyle = C.border;
        ctx.fillRect(left + 190, y + 14, gridW - 190, 1);
        y += gapSection;
      }
      ctx.font = big;
      ctx.textAlign = 'left';
      ctx.fillStyle = C.text;
      ctx.fillText(row.label, left, y + 16);
      ctx.textAlign = 'right';
      ctx.font = C.font;
      let right = left + gridW;
      if (row.mark) {
        ctx.fillStyle = row.mark.ok ? C.ok : C.err;
        ctx.fillText(`${row.mark.ok ? '✓' : '✗'} ${row.mark.text}`, right, y + 16);
        right -= ctx.measureText(`${row.mark.ok ? '✓' : '✗'} ${row.mark.text}`).width + 16;
      }
      ctx.fillStyle = C.dim;
      ctx.fillText(hex32(row.v), right, y + 16);

      const cy = y + labelH;
      if (row.bits) {
        // The bit range the predicate constrains, framed, with its value.
        const [lo, hi, want] = row.bits;
        const got = (row.v >>> lo) & ((1 << (hi - lo + 1)) - 1);
        const ok = got === want;
        ctx.fillStyle = alpha(ok ? C.ok : C.err, 0.10);
        ctx.fillRect(left + (31 - hi) * cell - 2, cy - 2, (hi - lo + 1) * cell + 4, cell + 4);
        ctx.strokeStyle = ok ? C.ok : C.err;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + (31 - hi) * cell - 2.5, cy - 2.5, (hi - lo + 1) * cell + 5, cell + 5);
      }
      for (let b = 31; b >= 0; b--) {
        const on = ((row.v >>> b) & 1) === 1;
        ctx.fillStyle = on ? row.color : C.input;
        ctx.fillRect(left + (31 - b) * cell + 1, cy + 1, cell - 2, cell - 2);
      }
      if (row.bits) {
        const [lo, hi, want] = row.bits;
        const got = (row.v >>> lo) & ((1 << (hi - lo + 1)) - 1);
        ctx.fillStyle = got === want ? C.ok : C.err;
        ctx.textAlign = 'center';
        ctx.fillText(`bits ${hi}..${lo} = 0x${got.toString(16).toUpperCase()} ${got === want ? '✓' : '✗'}`,
          left + (31 - (hi + lo) / 2) * cell + cell / 2, cy + cell + 8 + 4);
      }
      y += rowH;
    });

    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    for (const b of [31, 24, 16, 8, 0]) ctx.fillText(String(b), left + (31 - b) * cell + cell / 2, y + 8);
    ctx.textAlign = 'left';
  }

  // The solution set over the preset's window, against the page's brute force.
  function drawSet(ctx, w, hh) {
    const win = state.window;
    const sols = state.all;
    if (!win) {
      $('#solve-title').textContent = `${sols.length} solutions`;
      return;
    }
    const [x0, x1, y0, y1] = win;
    $('#solve-title').textContent = `Solution set over x ∈ [${x0}, ${x1}], y ∈ [${y0}, ${y1}]`;
    legend('#solve-legend', [[C.ok, 'returned by bro.solveAll'], [alpha(C.accent, 0.35), 'true by the page\'s brute force'], [C.err, 'missed or false', 'ring']]);
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
    const pad = 36;
    const cell = Math.max(2, Math.min((w - pad * 2) / nx, (hh - pad * 2) / ny));
    const ox = (w - cell * nx) / 2, oy = (hh - cell * ny) / 2;
    const sx = (x) => ox + (x - x0) * cell;
    const sy = (y) => oy + (y1 - y) * cell;   // y up

    ctx.fillStyle = C.surface;
    ctx.fillRect(ox, oy, cell * nx, cell * ny);
    if (x0 < 0 && x1 > 0) { ctx.fillStyle = C.borderHi; ctx.fillRect(sx(0), oy, 1, cell * ny); }
    if (y0 < 0 && y1 > 0) { ctx.fillStyle = C.borderHi; ctx.fillRect(ox, sy(0) + cell, cell * nx, 1); }

    const truth = state.truth || new Set();
    ctx.fillStyle = alpha(C.accent, 0.35);
    for (const k of truth) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillRect(sx(x), sy(y), cell, cell);
    }
    const found = new Set();
    ctx.fillStyle = C.ok;
    const r = Math.max(1, cell * 0.32);
    for (const s of sols) {
      found.add(s[0] + ',' + s[1]);
      if (s[0] < x0 || s[0] > x1 || s[1] < y0 || s[1] > y1) continue;
      ctx.beginPath();
      ctx.arc(sx(s[0]) + cell / 2, sy(s[1]) + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = C.err;
    ctx.lineWidth = 1.5;
    const ring = (x, y) => { ctx.beginPath(); ctx.arc(sx(x) + cell / 2, sy(y) + cell / 2, cell * 0.6, 0, Math.PI * 2); ctx.stroke(); };
    for (const k of truth) if (!found.has(k)) { const [x, y] = k.split(',').map(Number); ring(x, y); }
    for (const k of found) if (!truth.has(k)) { const [x, y] = k.split(',').map(Number); ring(x, y); }
    ctx.lineWidth = 1;

    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText(String(x0), sx(x0) + cell / 2, oy + cell * ny + 16);
    ctx.fillText(String(x1), sx(x1) + cell / 2, oy + cell * ny + 16);
    ctx.fillText('x', ox + cell * nx / 2, oy + cell * ny + 16);
    ctx.textAlign = 'right';
    ctx.fillText(String(y1), ox - 6, sy(y1) + cell / 2 + 4);
    ctx.fillText(String(y0), ox - 6, sy(y0) + cell / 2 + 4);
    ctx.fillText('y', ox - 6, oy + cell * ny / 2 + 4);
    ctx.textAlign = 'left';
  }

  $('#solve-run').addEventListener('click', run);
  syncMode();

  return { state, load, run, draw, question: 'Which inputs make this predicate true, and are there any at all?' };
}
