// Prove tab: bro.prove decides whether a candidate computes the same function
// as a specification (or whether a decoder undoes an encoder) for every int32
// input, and names an input where they part when they do. The page reruns the
// counterexample, then tests the pair the ordinary way, with half a million
// random inputs and the usual edge values, and maps where the differences are.

import { $, readout, segmented } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, alpha, compileFn, paramNames, verdict, checks, legend, presetPicker,
  int32Stream, EDGES, same, num, tuple, short, int, INT_MIN, INT_MAX } from "./common.js";

export const PRESETS = {
  absBug: {
    label: 'abs at INT32_MIN',
    mode: 'equiv',
    note: 'The obvious abs, against one that saturates. They differ at exactly one of 4.3 billion inputs: -INT32_MIN does not fit in an int32 and wraps back to itself.',
    spec: `function absSaturating(x) {
  if (x === -2147483648) return 2147483647;
  return x < 0 ? (-x | 0) : x;
}`,
    cand: `function absNaive(x) {
  return x < 0 ? (-x | 0) : x;
}`,
  },
  avg: {
    label: 'Average overflow',
    mode: 'equiv',
    note: 'The bit trick averages without forming x + y; the plain version wraps when the sum leaves int32. Here random testing does find it: a quarter of all pairs overflow.',
    spec: `function avgBits(x, y) {
  return (x & y) + ((x ^ y) >> 1);
}`,
    cand: `function avgPlain(x, y) {
  return (x + y) >> 1;
}`,
  },
  absBranchless: {
    label: 'Branchless abs',
    mode: 'equiv',
    note: 'A sign mask instead of a branch. Equal on every input, INT32_MIN included (both wrap the same way): the prover says so for all 2³² inputs, which no amount of testing can.',
    spec: `function absBranch(x) {
  return x < 0 ? (-x | 0) : x;
}`,
    cand: `function absMask(x) {
  const m = x >> 31;
  return ((x ^ m) - m) | 0;
}`,
  },
  div2: {
    label: 'Halving with >>',
    mode: 'equiv',
    note: 'Division truncates toward zero; an arithmetic shift rounds toward minus infinity. Every negative odd input differs.',
    spec: `function half(x) {
  return (x / 2) | 0;
}`,
    cand: `function halfShift(x) {
  return x >> 1;
}`,
  },
  codec: {
    label: 'XOR codec',
    mode: 'roundtrip',
    note: 'Does decode undo encode for every input? Add, XOR, subtract, XOR back: proven for all 2³² values.',
    spec: `function encode(x) {
  return ((x ^ 0x5A5A5A5A) + 12345) | 0;
}`,
    cand: `function decode(y) {
  return ((y - 12345) | 0) ^ 0x5A5A5A5A;
}`,
  },
  codecBug: {
    label: 'Times 3, over 3',
    mode: 'roundtrip',
    note: 'Multiplying by 3 wraps for large inputs, and division cannot undo a wrap.',
    spec: `function encode(x) {
  return (x * 3) | 0;
}`,
    cand: `function decode(y) {
  return (y / 3) | 0;
}`,
  },
};

const RANDOM_N = 500_000;
const MAP_BINS = 64;
const CURVE_N = 1200;

export function createProveTab(app) {
  const kv = readout('#prove-kv', {
    status: 'status',
    domain: 'domain',
    guards: 'guards proven',
    cert: 'proof hash',
    time: 'prove time',
  });
  const answer = verdict('#prove-verdict');
  const checkList = checks('#prove-checks');
  const picker = presetPicker('#prove-presets', PRESETS, (k) => load(k));
  const mode = segmented('#prove-mode', [['equiv', 'same function'], ['roundtrip', 'decode undoes encode']], {
    value: 'equiv',
    onChange: () => { syncMode(); run(); },
  });

  const state = { key: null, result: null, cex: null, arity: 1, map: null, near: null };

  function syncMode() {
    const rt = mode.value === 'roundtrip';
    $('#prove-spec-title').textContent = rt ? 'Encode' : 'Specification';
    $('#prove-cand').previousElementSibling.textContent = rt ? 'Decode' : 'Candidate';
  }

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#prove-spec').value = p.spec;
    $('#prove-cand').value = p.cand;
    $('#prove-note').textContent = p.note;
    mode.value = p.mode;
    syncMode();
    run();
  }

  function run() {
    const specSrc = $('#prove-spec').value, candSrc = $('#prove-cand').value;
    const rt = mode.value === 'roundtrip';
    let spec, cand;
    try { spec = compileFn(specSrc); cand = compileFn(candSrc); } catch (e) { app.fail('Does not compile: ' + e.message); return; }
    const arity = rt ? 1 : Math.max(1, paramNames(specSrc).length);
    state.arity = arity;

    const t0 = Date.now();
    const r = rt ? bro.prove(specSrc, { roundTripWith: candSrc })
                 : bro.prove(candSrc, { equivTo: specSrc, domainMin: INT_MIN, domainMax: INT_MAX });
    const wall = Date.now() - t0;
    state.result = r;
    const cex = r.counterexample && Array.isArray(r.counterexample.args) && r.counterexample.args.length ? r.counterexample.args.map((v) => v | 0) : null;
    state.cex = cex;

    // What the page compares: f(args) and g(args), or x and decode(encode(x)).
    const lhs = rt ? (x) => x : spec;
    const rhs = rt ? (x) => cand(spec(x)) : cand;

    if (cex) {
      answer.set('err', 'DIFFERS', rt ? `decode(encode(${int(cex[0])})) is not ${int(cex[0])}` : `at ${tuple(cex.map(int))}`);
    } else {
      answer.set('ok', rt ? 'ROUND TRIP' : 'EQUIVALENT', rt ? 'decode undoes encode for every int32' : `the same function on all 2${arity === 1 ? '³²' : '⁶⁴'} inputs`);
    }
    kv.set('status', r.status || '—', !cex);
    kv.set('domain', arity === 1 ? 'every int32' : `every int32 ${arity}-tuple`);
    kv.set('guards', `${r.provenGuards ?? '—'} of ${r.totalGuards ?? '—'}`, r.provenGuards === r.totalGuards);
    kv.set('cert', short(r.proofHash, 16));
    kv.set('time', `${wall} ms`);

    const list = [];
    if (cex) {
      const a = lhs(...cex), b = rhs(...cex);
      list.push({
        ok: !same(a, b),
        label: rt ? `the page runs it: decode(encode(${int(cex[0])})) = ${int(b)}` : `the page runs both at ${tuple(cex.map(int))}: ${int(a)} vs ${int(b)}`,
        detail: same(a, b) ? 'they agree: the counterexample does not reproduce' : null,
      });
    }
    const rand = randomTest(lhs, rhs, arity);
    state.map = rand.map;
    state.curve = arity === 1 ? sampleCurve(lhs, rhs, cex) : null;
    if (cex) {
      list.push(rand.diffs
        ? { ok: null, label: `${num(RANDOM_N)} random inputs also find it: ${num(rand.diffs)} differ`, detail: `the first at ${tuple(rand.first.map(int))}; ${rand.ms} ms of page time` }
        : { ok: null, label: `${num(RANDOM_N)} random inputs find no difference: random testing would pass this`, detail: `${rand.ms} ms of page time; a single input in 2³² is a 1 in ${num(2 ** 32)} draw` });
    } else {
      list.push({ ok: rand.diffs === 0, label: rand.diffs ? `${num(rand.diffs)} of ${num(RANDOM_N)} random inputs differ, the first at ${tuple(rand.first.map(int))}` : `${num(RANDOM_N)} random inputs agree`, detail: `${rand.ms} ms of page time; agreeing samples are evidence, the proof covers the rest` });
    }
    const edge = edgeTest(lhs, rhs, arity);
    list.push(cex
      ? { ok: null, label: edge.diffs ? `the ${num(edge.tried)} edge-value inputs catch it too (${num(edge.diffs)} differ)` : `none of the ${num(edge.tried)} edge-value inputs differ`, detail: 'zero, ±1, powers of two, the int32 limits' }
      : { ok: edge.diffs === 0, label: `all ${num(edge.tried)} edge-value inputs agree`, detail: 'zero, ±1, powers of two, the int32 limits' });
    const synth = (r.synthesizedTests || []).filter((t) => Array.isArray(t.args));
    if (!rt && synth.length) {
      const bad = synth.filter((t) => !same(cand(...t.args), t.expectedReturn));
      list.push({ ok: bad.length === 0, label: `the ${synth.length} branch-coverage tests bro wrote replay on the page`, detail: synth.map((t) => `${tuple(t.args)} → ${t.expectedReturn}`).join(', ') });
    }
    state.near = neighbourhood(lhs, rhs, cex, arity, rt, spec);
    const tally = checkList.set(list);
    app.report({ verdict: cex ? 'differs' : (rt ? 'round trip' : 'equivalent'), size: `${arity} arg${arity === 1 ? '' : 's'}`, checks: `${tally.passed}/${tally.counted}` },
      cex ? `Counterexample at ${tuple(cex.map(int))}, reproduced by the page` : 'Proven for every input', tally.failed ? 'warn' : 'ok');
    app.redraw();
  }

  // Half a million seeded random inputs, binned over the int32 line (one
  // argument) or plane (two) by how many differ.
  function randomTest(lhs, rhs, arity) {
    const next = int32Stream(0xC0FFEE);
    const bins = arity >= 2 ? MAP_BINS * MAP_BINS : MAP_BINS * 8;
    const total = new Uint32Array(bins), bad = new Uint32Array(bins);
    const binOf = (v, n) => Math.min(n - 1, Math.floor(((v - INT_MIN) / 4294967296) * n));
    const args = new Array(arity).fill(0);
    let diffs = 0, first = null;
    const t0 = Date.now();
    for (let i = 0; i < RANDOM_N; i++) {
      for (let k = 0; k < arity; k++) args[k] = next();
      const b = arity >= 2 ? binOf(args[1], MAP_BINS) * MAP_BINS + binOf(args[0], MAP_BINS) : binOf(args[0], bins);
      total[b]++;
      if (!same(lhs(...args), rhs(...args))) {
        diffs++; bad[b]++;
        if (!first) first = args.slice();
      }
    }
    return { diffs, first, ms: Date.now() - t0, map: { total, bad, arity, bins } };
  }

  // One argument: what each side returns across the int32 line, at seeded
  // random points (even spacing would land only on even inputs) plus the edge
  // values and the counterexample.
  function sampleCurve(lhs, rhs, cex) {
    const next = int32Stream(0x5EED);
    const xs = [];
    for (let i = 0; i < CURVE_N; i++) xs.push(next());
    xs.push(...EDGES);
    if (cex) xs.push(cex[0]);
    xs.sort((p, q) => p - q);
    return xs.map((x) => {
      const a = lhs(x), b = rhs(x);
      return { x, a, b, same: same(a, b) };
    });
  }

  function edgeTest(lhs, rhs, arity) {
    let tried = 0, diffs = 0;
    const walk = (prefix) => {
      if (prefix.length === Math.min(arity, 3)) {
        const args = prefix.concat(new Array(Math.max(0, arity - 3)).fill(0));
        tried++;
        if (!same(lhs(...args), rhs(...args))) diffs++;
        return;
      }
      for (const v of EDGES) walk(prefix.concat([v]));
    };
    walk([]);
    return { tried, diffs };
  }

  // The inputs next to the counterexample (or next to zero), first argument
  // varied, the rest held: what each side returns there.
  function neighbourhood(lhs, rhs, cex, arity, rt, spec) {
    const base = cex ? cex.slice() : new Array(arity).fill(0);
    const rows = [];
    for (let d = -4; d <= 4; d++) {
      const x0 = base[0] + d;
      if (x0 < INT_MIN || x0 > INT_MAX) continue;
      const args = base.slice();
      args[0] = x0;
      const a = lhs(...args), b = rhs(...args);
      rows.push({ args, a, b, mid: rt ? spec(...args) : null, same: same(a, b), at: d === 0 && !!cex });
    }
    return rows;
  }

  function draw() {
    const { ctx, w, h: hh } = fitCanvas('#prove-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    if (!state.map) return;
    const rt = mode.value === 'roundtrip';
    $('#prove-title').textContent = state.cex
      ? `Where the two part: ${num(RANDOM_N)} random inputs, and the counterexample`
      : `${num(RANDOM_N)} random inputs, every one agreeing`;
    const series = state.curve
      ? [[C.muted, rt ? 'x' : 'specification'], [C.accent, rt ? 'decode(encode(x))' : 'candidate']]
      : [];
    legend('#prove-legend', [...series, [alpha(C.ok, 0.6), 'random inputs agree'], [C.err, 'differ'], [C.warn, 'the prover\'s counterexample', 'ring']]);

    const pad = 28;
    const tableW = Math.min(520, Math.max(380, w * 0.36));
    const side = w >= 1100;
    const mapW = side ? w - tableW - pad * 3 : w - pad * 2;
    const mapH = side ? hh - pad * 2 : hh * 0.55 - pad;
    if (state.map.arity >= 2) drawPlane(ctx, pad, pad, mapW, mapH);
    else drawLine(ctx, pad, pad, mapW, mapH);
    if (side) drawTable(ctx, pad * 2 + mapW, pad, tableW, hh - pad * 2, rt);
    else drawTable(ctx, pad, pad * 2 + mapH, w - pad * 2, hh - mapH - pad * 3, rt);
  }

  // Mix of agreeing and differing samples in a bin as a colour.
  function binColor(total, bad) {
    if (!total) return C.input;
    if (!bad) return alpha(C.ok, 0.45);
    return alpha(C.err, 0.35 + 0.65 * (bad / total));
  }

  function drawPlane(ctx, x, y, w, hh) {
    const { total, bad } = state.map;
    const n = MAP_BINS;
    const size = Math.min(w - 60, hh - 50);
    const cell = size / n;
    const ox = x + 50 + (w - 60 - size) / 2, oy = y + 6;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const b = r * n + c;
        ctx.fillStyle = binColor(total[b], bad[b]);
        ctx.fillRect(ox + c * cell, oy + (n - 1 - r) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    ctx.strokeStyle = C.borderHi;
    ctx.strokeRect(ox + 0.5, oy + 0.5, size, size);
    // Zero axes.
    ctx.fillStyle = alpha(C.text, 0.25);
    ctx.fillRect(ox + size / 2, oy, 1, size);
    ctx.fillRect(ox, oy + size / 2, size, 1);
    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText('INT32_MIN', ox, oy + size + 16);
    ctx.fillText('0', ox + size / 2, oy + size + 16);
    ctx.fillText('INT32_MAX', ox + size, oy + size + 16);
    ctx.fillText(`${paramNames($('#prove-spec').value)[0] || 'x'} →`, ox + size * 0.75, oy + size + 32);
    ctx.textAlign = 'right';
    ctx.fillText('MAX', ox - 6, oy + 10);
    ctx.fillText('0', ox - 6, oy + size / 2 + 4);
    ctx.fillText('MIN', ox - 6, oy + size);
    ctx.fillText(`${paramNames($('#prove-spec').value)[1] || 'y'} ↑`, ox - 6, oy + size * 0.25);
    ctx.textAlign = 'left';
    if (state.cex) {
      const px = ox + ((state.cex[0] - INT_MIN) / 4294967296) * size;
      const py = oy + size - ((state.cex[1] - INT_MIN) / 4294967296) * size;
      pin(ctx, px, py, tuple(state.cex.map(int)));
    }
  }

  function drawLine(ctx, x, y, w, hh) {
    const { total, bad, bins } = state.map;
    x += 70; w -= 70;  // room for the value axis' labels
    const bandH = Math.min(56, hh * 0.12);
    const by = y + hh - bandH - 34;
    if (state.curve) drawCurve(ctx, x, y + 6, w, by - y - 44);
    const bw = w / bins;
    let peak = 1;
    for (let i = 0; i < bins; i++) peak = Math.max(peak, total[i]);
    for (let i = 0; i < bins; i++) {
      ctx.fillStyle = binColor(total[i], bad[i]);
      const hgt = bandH * (0.35 + 0.65 * total[i] / peak);
      ctx.fillRect(x + i * bw, by + bandH - hgt, Math.max(1, bw - 0.5), hgt);
    }
    ctx.fillStyle = C.borderHi;
    ctx.fillRect(x, by + bandH, w, 1);
    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    const tick = (v, label) => {
      const px = x + ((v - INT_MIN) / 4294967296) * w;
      ctx.fillRect(px, by + bandH, 1, 5);
      ctx.fillText(label, px, by + bandH + 18);
    };
    tick(INT_MIN, 'INT32_MIN'); tick(-(2 ** 30), '-2³⁰'); tick(0, '0'); tick(2 ** 30, '2³⁰'); tick(INT_MAX, 'INT32_MAX');
    ctx.textAlign = 'left';
    ctx.fillText(`${num(RANDOM_N)} random inputs, each bar ~${num(RANDOM_N / bins)} of them in 1/${bins} of the int32 line`, x, by - 10);
  }

  // Output against input: the specification as a line, the candidate as dots
  // over it, red where the two return different values.
  function drawCurve(ctx, x, y, w, hh) {
    const pts = state.curve;
    const px = (v) => x + ((v - INT_MIN) / 4294967296) * w;
    const py = (v) => y + hh - ((Math.max(INT_MIN, Math.min(INT_MAX, v)) - INT_MIN) / 4294967296) * hh;
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    ctx.strokeStyle = C.border;
    ctx.strokeRect(x + 0.5, y + 0.5, w, hh);
    ctx.fillStyle = alpha(C.text, 0.12);
    ctx.fillRect(px(0), y, 1, hh);
    ctx.fillRect(x, py(0), w, 1);
    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText('INT32_MAX', x - 6, y + 10);
    ctx.fillText('0', x - 6, py(0) + 4);
    ctx.fillText('INT32_MIN', x - 6, y + hh);
    ctx.fillText('returns ↑', x - 6, y + hh * 0.25);
    ctx.textAlign = 'left';

    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let open = false;
    for (const p of pts) {
      if (!finite(p.a)) { open = false; continue; }
      if (open) ctx.lineTo(px(p.x), py(p.a)); else ctx.moveTo(px(p.x), py(p.a));
      open = true;
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const p of pts) {
      if (!finite(p.b) || !p.same) continue;
      ctx.fillStyle = alpha(C.accent, 0.8);
      ctx.fillRect(px(p.x) - 1.5, py(p.b) - 1.5, 3, 3);
    }
    // The differing points last, so nothing covers them, each tied to where
    // the specification is.
    for (const p of pts) {
      if (p.same || !finite(p.b)) continue;
      if (finite(p.a)) {
        ctx.strokeStyle = alpha(C.err, 0.5);
        ctx.beginPath(); ctx.moveTo(px(p.x) + 0.5, py(p.a)); ctx.lineTo(px(p.x) + 0.5, py(p.b)); ctx.stroke();
      }
      ctx.fillStyle = C.err;
      ctx.beginPath(); ctx.arc(px(p.x), py(p.b), 3.5, 0, Math.PI * 2); ctx.fill();
    }
    if (state.cex) {
      const cx = state.cex[0];
      const p = pts.find((q) => q.x === cx);
      if (p && finite(p.b)) {
        // Labelled beside the ring, toward the plot's middle, clear of the axis.
        const rx = px(cx), ry = py(p.b);
        ctx.strokeStyle = C.warn;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
        const label = `${int(cx)} → ${int(p.b)}, not ${int(p.a)}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = C.warn;
        ctx.fillText(label, rx < x + w / 2 ? rx + 14 : rx - 14 - tw, ry < y + hh / 2 ? ry + 18 : ry - 12);
      }
    }
  }

  function pin(ctx, px, py, label) {
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.font = C.font;
    ctx.fillStyle = C.warn;
    const tw = ctx.measureText(label).width;
    const lx = Math.min(Math.max(px - tw / 2, 4), px + 200);
    ctx.textAlign = 'left';
    ctx.fillText(label, Math.max(4, lx), py - 14);
  }

  // The rows next to the counterexample: each side's value, the odd one marked.
  function drawTable(ctx, x, y, w, hh, rt) {
    const rows = state.near || [];
    const names = paramNames($('#prove-spec').value);
    const heads = rt ? ['x', 'encode(x)', 'decode(…)'] : [names.length > 1 ? names.join(', ') : (names[0] || 'x'), 'specification', 'candidate'];
    ctx.font = C.font;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText(state.cex ? 'NEXT TO THE COUNTEREXAMPLE' : 'AROUND ZERO', x, y + 10);
    const rowH = Math.min(30, (hh - 40) / (rows.length + 1));
    const cols = [x, x + w * 0.42, x + w * 0.71];
    let ry = y + 30;
    ctx.fillStyle = C.dim;
    heads.forEach((t, i) => ctx.fillText(t, cols[i], ry + rowH / 2 + 4));
    ry += rowH;
    for (const row of rows) {
      if (row.at) {
        ctx.fillStyle = alpha(C.warn, 0.12);
        ctx.fillRect(x - 6, ry, w + 6, rowH);
        ctx.fillStyle = C.warn;
        ctx.fillRect(x - 6, ry, 2, rowH);
      }
      const vals = [row.args.length > 1 ? tuple(row.args.map(int)) : int(row.args[0]), int(rt ? row.mid : row.a), int(row.b)];
      vals.forEach((t, i) => {
        ctx.fillStyle = i === 2 && !row.same ? C.err : i === 0 ? C.text : C.value;
        ctx.fillText(t, cols[i], ry + rowH / 2 + 4);
      });
      ctx.fillStyle = row.same ? C.ok : C.err;
      ctx.textAlign = 'right';
      ctx.fillText(row.same ? '=' : '≠', x + w, ry + rowH / 2 + 4);
      ctx.textAlign = 'left';
      ry += rowH;
    }
  }

  $('#prove-run').addEventListener('click', run);

  return { state, load, run, draw, question: 'Do these compute the same thing for every input, and if not, where do they part?' };
}
