// Parallelize tab: bro.autoKernel decides whether a loop's iterations are
// independent (no read-after-write, write-after-read or write-after-write
// between iterations, every index in bounds) and, when they are, rewrites it
// as a GPU kernel. The page traces every element each iteration touches to
// see the dependences for itself, then runs the kernel on the GPU against the
// plain loop on the CPU.

import { $, readout } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, MONO, alpha, compileFn, paramNames, verdict, checks, legend, presetPicker, num } from "./common.js";

// make(n): the loop's arguments for n iterations, arrays filled deterministically.
const fill = (len, f) => { const a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = f(i); return a; };

export const PRESETS = {
  saxpy: {
    label: 'SAXPY',
    note: 'out[i] depends on x[i] and y[i] only: every iteration writes its own element and reads nothing another writes.',
    src: `function saxpy(out, x, y, a, n) {
  for (let i = 0; i < n; i++) {
    out[i] = a * x[i] + y[i];
  }
}`,
    make: (n) => [new Float32Array(n), fill(n, (i) => Math.sin(i * 0.001)), fill(n, (i) => (i % 97) * 0.01), 1.75, n],
  },
  stencil: {
    label: '3-point blur',
    note: 'Each output reads three neighbours. Reads may overlap freely; only the one write per iteration matters, and it lands in a separate array.',
    src: `function blur(dst, src, n) {
  for (let i = 0; i < n; i++) {
    dst[i] = 0.25 * src[i] + 0.5 * src[i + 1] + 0.25 * src[i + 2];
  }
}`,
    make: (n) => [new Float32Array(n), fill(n + 2, (i) => (i * 7919) % 101), n],
  },
  split: {
    label: 'Interleave',
    note: 'Two writes per iteration, at 2i and 2i + 1: the prover has to show no two iterations ever hit the same slot.',
    src: `function split(out, inp, n) {
  for (let i = 0; i < n; i++) {
    out[2 * i] = inp[i] * 2;
    out[2 * i + 1] = inp[i] + 1;
  }
}`,
    make: (n) => [new Float32Array(2 * n), fill(n, (i) => i % 13), n],
  },
  prefix: {
    label: 'Prefix sum',
    note: 'Iteration i reads what iteration i - 1 just wrote: a read-after-write chain through the whole array. Running these at once would read stale values.',
    src: `function prefixSum(a, x, n) {
  for (let i = 0; i < n; i++) {
    a[i + 1] = a[i] + x[i];
  }
}`,
    make: (n) => [new Float32Array(n + 1), fill(n, (i) => (i % 5) + 1), n],
  },
  shift: {
    label: 'Shift left',
    note: 'Each iteration overwrites the element the previous one read: write-after-read. In order it shifts the array; all at once, some reads see shifted values.',
    src: `function shiftLeft(a, n) {
  for (let i = 0; i < n; i++) {
    a[i] = a[i + 1];
  }
}`,
    make: (n) => [fill(n + 1, (i) => i), n],
  },
  reverse: {
    label: 'Reverse in place',
    note: 'Iteration i and iteration n - 1 - i touch the same two elements. bro rejects the loop, and the page\'s trace shows the pairs that would race.',
    src: `function reverse(a, n) {
  for (let i = 0; i < n; i++) {
    a[i] = a[n - 1 - i];
  }
}`,
    make: (n) => [fill(n, (i) => i), n],
  },
};

const TRACE_N = 16;

export function createParallelTab(app) {
  const kv = readout('#par-kv', {
    raw: 'read after write',
    war: 'write after read',
    waw: 'write after write',
    bounds: 'indices in bounds',
    kernel: 'kernel',
    cert: 'certificate',
  });
  const answer = verdict('#par-verdict');
  const checkList = checks('#par-checks');
  const picker = presetPicker('#par-presets', PRESETS, (k) => load(k));
  const sizeEl = $('#par-size');
  sizeEl.value = '20';
  const state = { key: null, result: null, trace: null, gpu: null, names: [] };

  function syncSize() { $('#par-size-val').textContent = num(2 ** Number(sizeEl.value)); }
  syncSize();
  sizeEl.addEventListener('input', syncSize);
  sizeEl.addEventListener('change', () => run());

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#par-src').value = p.src;
    $('#par-note').textContent = p.note;
    run();
  }

  function run() {
    const src = $('#par-src').value;
    // The example says how to build the loop's arguments; an edited loop keeps its shapes.
    const preset = PRESETS[state.key];
    if (!preset) { app.fail('Pick an example first'); return; }
    state.names = paramNames(src);
    const t0 = Date.now();
    const r = bro.autoKernel(src);
    const wall = Date.now() - t0;
    state.result = r;
    try { state.trace = trace(src, preset.make(TRACE_N)); } catch (e) { state.trace = null; app.fail('Trace failed: ' + e.message); }
    state.gpu = r.parallelizable && r.kernel ? gpuRun(src, preset, 2 ** Number(sizeEl.value), r.kernel) : null;

    const flag = (ok) => (ok ? 'proven none' : 'not proven');
    kv.set('raw', flag(r.provenNoRaw), !!r.provenNoRaw);
    kv.set('war', flag(r.provenNoWar), !!r.provenNoWar);
    kv.set('waw', flag(r.provenNoWaw), !!r.provenNoWaw);
    kv.set('bounds', r.provenInBounds ? 'proven' : 'not proven', !!r.provenInBounds);
    kv.set('kernel', r.kernel ? `${r.kernel.kernelName}, ${r.kernel.spirvWords ? num(r.kernel.spirvWords.length) : '?'} SPIR-V words (${wall} ms)` : '—', !!r.kernel);
    kv.set('cert', r.certificateHash || '—');
    if (r.parallelizable) answer.set('ok', 'PARALLEL', `every iteration independent; rewritten as @kernel ${r.kernel ? r.kernel.kernelName : ''}`);
    else answer.set('err', 'SEQUENTIAL', r.hazards && r.hazards.length ? `${r.hazards[0].hazardKind} on ${r.hazards[0].arrayName}` : (r.summary || 'not provably independent'));

    const list = [];
    const tr = state.trace;
    if (tr) {
      const nc = tr.conflicts.length;
      if (r.parallelizable) {
        list.push({ ok: nc === 0, label: nc ? `the page's trace finds ${nc} elements touched by two iterations` : `the page traces ${TRACE_N} iterations: no element is touched by two of them with a write`, detail: `${num(tr.accesses)} reads and writes recorded` });
      } else {
        const ex = tr.conflicts[0];
        list.push({
          ok: nc > 0 ? true : null,
          label: nc ? `the page's trace finds ${nc} element${nc === 1 ? '' : 's'} shared between iterations, e.g. ${ex.arr}[${ex.idx}]: ${ex.text}` : `the page's trace of ${TRACE_N} iterations finds no shared element`,
          detail: nc ? `kinds seen: ${[...new Set(tr.conflicts.map((c) => c.kind))].join(', ')}` : 'bro could not prove independence; the trace covers only these iterations',
        });
      }
      for (const hz of r.hazards || []) {
        const hit = tr.conflicts.find((c) => c.arr === hz.arrayName && c.idx === hz.conflictIndex);
        list.push({ ok: !!hit, label: `bro's witness: iterations ${hz.iterA} and ${hz.iterB} meet at ${hz.arrayName}[${hz.conflictIndex}]`, detail: hit ? `the trace sees it: ${hit.text}` : 'the page\'s trace does not show this collision' });
      }
    }
    const g = state.gpu;
    if (g) {
      list.push({ ok: g.mismatches === 0, label: g.mismatches ? `${num(g.mismatches)} of ${num(g.compared)} elements differ between GPU and CPU` : `the GPU kernel and the CPU loop agree on all ${num(g.compared)} elements`, detail: `largest difference ${g.maxDiff}${g.vk ? '' : '; ran on the CPU fallback, not a GPU'}` });
      list.push({ ok: null, label: `${num(g.n)} iterations: CPU loop ${g.cpuMs} ms, GPU ${g.gpuMs} ms warm (${g.firstMs} ms first)`, detail: 'the GPU time includes copying every array there and back; a kernel this light is bound by the copies' });
    } else if (!r.parallelizable) {
      list.push({ ok: null, label: 'no kernel to run: the loop stays sequential on the CPU' });
    }
    const tally = checkList.set(list);
    app.report({ verdict: r.parallelizable ? 'parallel' : 'sequential', size: g ? `${num(g.n)} elements` : `${TRACE_N} traced`, checks: `${tally.passed}/${tally.counted}` },
      r.parallelizable ? 'Proven independent, run on the GPU, checked against the CPU' : 'Rejected, and the page sees why', tally.failed ? 'warn' : 'ok');
    app.redraw();
  }

  // Run the loop with every typed-array argument behind a Proxy, and a hook
  // at the top of the loop body that says which iteration is running.
  function trace(src, args) {
    const names = paramNames(src);
    let cur = -1;
    const inst = src.replace(/(for\s*\(\s*let\s+(\w+)[^)]*\)\s*\{)/, '$1 __it($2);');
    const fn = (new Function('__it', '"use strict"; return (' + inst.trim() + ');'))((i) => { cur = i; });
    const log = [];
    const arrays = [];
    const wrapped = args.map((a, k) => {
      if (!ArrayBuffer.isView(a)) return a;
      arrays.push({ name: names[k] || 'arg' + k, len: a.length });
      const name = names[k] || 'arg' + k;
      return new Proxy(a, {
        get(t, p) {
          if (typeof p === 'string' && /^\d+$/.test(p)) log.push({ arr: name, idx: Number(p), it: cur, w: false });
          const v = t[p];
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, p, v) {
          if (typeof p === 'string' && /^\d+$/.test(p)) log.push({ arr: name, idx: Number(p), it: cur, w: true });
          t[p] = v;
          return true;
        },
      });
    });
    fn(...wrapped);

    // Per element: which iterations wrote and read it.
    const cells = new Map();
    for (const e of log) {
      const k = e.arr + '#' + e.idx;
      let c = cells.get(k);
      if (!c) { c = { arr: e.arr, idx: e.idx, w: new Set(), r: new Set(), order: [] }; cells.set(k, c); }
      (e.w ? c.w : c.r).add(e.it);
      c.order.push(e);
    }
    const conflicts = [];
    for (const c of cells.values()) {
      const its = new Set([...c.w, ...c.r]);
      if (!c.w.size || its.size < 2) continue;
      // Classify by program order: the first cross-iteration pair involving a write.
      let kind = null, text = '';
      for (let i = 0; i < c.order.length && !kind; i++) {
        for (let j = i + 1; j < c.order.length; j++) {
          const a = c.order[i], b = c.order[j];
          if (a.it === b.it || (!a.w && !b.w)) continue;
          kind = a.w && b.w ? 'WAW' : a.w ? 'RAW' : 'WAR';
          text = `${a.w ? 'written' : 'read'} by iteration ${a.it}, then ${b.w ? 'written' : 'read'} by iteration ${b.it}`;
          break;
        }
      }
      conflicts.push({ arr: c.arr, idx: c.idx, kind, text, its: [...its] });
    }
    return { arrays, log, cells, conflicts, accesses: log.length };
  }

  function gpuRun(src, preset, n, kernel) {
    const cpuArgs = preset.make(n), gpuArgs = preset.make(n);
    const loop = compileFn(src);
    let t0 = Date.now();
    loop(...cpuArgs);
    const cpuMs = Date.now() - t0;
    t0 = Date.now();
    kernel.dispatch1D(...gpuArgs);
    const firstMs = Date.now() - t0;
    const again = preset.make(n);
    t0 = Date.now();
    kernel.dispatch1D(...again);
    const gpuMs = Date.now() - t0;
    let mismatches = 0, compared = 0, maxDiff = 0;
    cpuArgs.forEach((a, k) => {
      if (!ArrayBuffer.isView(a)) return;
      const b = again[k];
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDiff) maxDiff = d;
        if (d > 1e-6 * Math.max(1, Math.abs(a[i]))) mismatches++;
      }
      compared += a.length;
    });
    return { n, cpuMs, gpuMs, firstMs, mismatches, compared, maxDiff, vk: !!kernel.lastUsedVulkanGpu };
  }

  function draw() {
    const { ctx, w, h: hh } = fitCanvas('#par-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    const tr = state.trace;
    if (!tr) return;
    $('#par-title').textContent = `Which elements each of the first ${TRACE_N} iterations touches`;
    legend('#par-legend', [[C.accent, 'write'], [alpha(C.ok, 0.8), 'read'], [C.err, 'shared between iterations', 'ring']]);
    const pad = 28;
    const footH = 150;
    drawTrace(ctx, pad, pad, w - pad * 2, hh - footH - pad * 2);
    drawFoot(ctx, pad, hh - footH - pad / 2, w - pad * 2, footH);
  }

  // One grid per array: a row per iteration, a column per element.
  function drawTrace(ctx, x, y, w, hh) {
    const tr = state.trace;
    const arrays = tr.arrays;
    const gap = 36;
    const totalCols = arrays.reduce((s, a) => s + a.len, 0);
    const cell = Math.max(6, Math.min(26, (w - 40 - gap * (arrays.length - 1)) / totalCols, (hh - 60) / TRACE_N));
    const gridH = cell * TRACE_N;
    const used = totalCols * cell + gap * (arrays.length - 1);
    let gx = x + 40 + Math.max(0, (w - 40 - used) / 2);
    const gy = y + 30 + Math.max(0, (hh - 60 - gridH) / 2);
    const shared = new Set(tr.conflicts.map((c) => c.arr + '#' + c.idx));

    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    for (let it = 0; it < TRACE_N; it += it < 2 ? 1 : 4) ctx.fillText(`i = ${it}`, gx - 8, gy + it * cell + cell / 2 + 4);
    ctx.textAlign = 'left';

    const pos = new Map();
    for (const a of arrays) {
      const writes = tr.log.some((e) => e.arr === a.name && e.w);
      ctx.fillStyle = C.text;
      ctx.fillText(`${a.name}${writes ? '' : '  (read only)'}`, gx, gy - 12);
      for (let idx = 0; idx < a.len; idx++) {
        const px = gx + idx * cell;
        if (shared.has(a.name + '#' + idx)) {
          ctx.fillStyle = alpha(C.err, 0.14);
          ctx.fillRect(px, gy, cell, gridH);
        }
      }
      ctx.strokeStyle = C.border;
      ctx.strokeRect(gx + 0.5, gy + 0.5, a.len * cell, gridH);
      pos.set(a.name, gx);
      gx += a.len * cell + gap;
    }
    for (const c of tr.cells.values()) {
      const ax = pos.get(c.arr);
      if (ax === undefined) continue;
      const px = ax + c.idx * cell;
      for (const it of c.r) {
        if (it < 0 || it >= TRACE_N) continue;
        ctx.fillStyle = alpha(C.ok, 0.75);
        ctx.fillRect(px + cell * 0.3, gy + it * cell + cell * 0.3, cell * 0.4, cell * 0.4);
      }
      for (const it of c.w) {
        if (it < 0 || it >= TRACE_N) continue;
        ctx.fillStyle = C.accent;
        ctx.fillRect(px + 1, gy + it * cell + 1, cell - 2, cell - 2);
      }
    }
    // Shared elements: ring every touch and join the iterations that meet there.
    ctx.strokeStyle = C.err;
    ctx.lineWidth = 1.5;
    for (const cf of tr.conflicts) {
      const ax = pos.get(cf.arr);
      const px = ax + cf.idx * cell + cell / 2;
      const its = cf.its.filter((i) => i >= 0 && i < TRACE_N).sort((a, b) => a - b);
      if (its.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(px, gy + its[0] * cell + cell / 2);
      ctx.lineTo(px, gy + its[its.length - 1] * cell + cell / 2);
      ctx.stroke();
      for (const it of its) { ctx.beginPath(); ctx.arc(px, gy + it * cell + cell / 2, cell * 0.45, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.lineWidth = 1;
    ctx.fillStyle = C.dim;
    ctx.fillText('element index →', x + 40, gy + gridH + 18);
  }

  // GPU against CPU, and the kernel bro wrote.
  function drawFoot(ctx, x, y, w, hh) {
    const r = state.result, g = state.gpu;
    ctx.fillStyle = C.border;
    ctx.fillRect(x, y, w, 1);
    ctx.font = C.font;
    const half = w * 0.48;
    ctx.fillStyle = C.dim;
    ctx.fillText(g ? `RUN ON ${num(g.n)} ELEMENTS` : 'NOT RUN ON THE GPU', x, y + 22);
    if (g) {
      const max = Math.max(g.cpuMs, g.gpuMs, 1);
      const row = (label, ms, color, yy) => {
        ctx.fillStyle = C.muted;
        ctx.fillText(label, x, yy + 10);
        ctx.fillStyle = color;
        ctx.fillRect(x + 110, yy, Math.max(2, (half - 190) * ms / max), 12);
        ctx.fillStyle = C.value;
        ctx.fillText(`${ms} ms`, x + 110 + Math.max(2, (half - 190) * ms / max) + 8, yy + 10);
      };
      row('CPU loop', g.cpuMs, C.borderHi, y + 40);
      row(g.vk ? 'GPU kernel' : 'kernel (CPU)', g.gpuMs, C.accent, y + 62);
      ctx.fillStyle = g.mismatches ? C.err : C.ok;
      ctx.fillText(g.mismatches ? `✗ ${num(g.mismatches)} elements differ` : `✓ all ${num(g.compared)} elements identical (max diff ${g.maxDiff})`, x, y + 98);
    } else {
      ctx.fillStyle = C.muted;
      const msg = r.hazards && r.hazards.length ? r.hazards[0].description : r.summary;
      wrap(ctx, msg || '', x, y + 44, half - 20, 16);
    }
    const kx = x + half + 20;
    ctx.fillStyle = C.dim;
    ctx.fillText(r.kernelSource ? 'THE KERNEL BRO WROTE' : 'THE LOOP', kx, y + 22);
    const lines = (r.kernelSource || $('#par-src').value).trim().split('\n').slice(0, 7);
    ctx.font = MONO;
    ctx.fillStyle = r.kernelSource ? C.ok : C.text;
    lines.forEach((t, i) => ctx.fillText(t, kx, y + 42 + i * 15));
    ctx.font = C.font;
  }

  function wrap(ctx, text, x, y, w, lh) {
    let line = '', yy = y;
    for (const word of text.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > w && line) { ctx.fillText(line, x, yy); yy += lh; line = word; } else line = t;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  $('#par-run').addEventListener('click', run);

  return { state, load, run, draw, question: 'Can every iteration of this loop run at once on the GPU, and does the GPU get the same answer?' };
}
