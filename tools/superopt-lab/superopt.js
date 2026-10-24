// Superoptimize tab: bro.superoptimize searches for a cheaper expression that
// equals a whole function (generate candidates, prune on concrete inputs,
// prove the survivor with SMT), and bro.rewriteSource applies proven local
// rewrites. The page runs the original and the result side by side on half a
// million inputs and times both.

import { $, h, clear, readout } from "/lib/kit/index.js";
import { compileFn, verdict, checks, legend, presetPicker, int32Stream, EDGES, same, num, tuple, int, C } from "./common.js";

export const PRESETS = {
  sign: {
    label: 'sign(x)',
    note: 'Two comparisons and three returns. The search finds the Hacker\'s Delight one-liner: an arithmetic shift for the sign bit, a logical shift of the negation for "above zero".',
    src: `function sign(x) {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}`,
  },
  clampByte: {
    label: 'Clamp to a byte',
    note: 'Two branches folded into one nested select.',
    src: `function clampByte(x) {
  if (x < 0) return 0;
  if (x > 255) return 255;
  return x;
}`,
  },
  min: {
    label: 'min(x, y)',
    note: 'An if/else becomes a select the code generator can emit without a branch.',
    src: `function min(x, y) {
  if (x < y) {
    return x;
  } else {
    return y;
  }
}`,
  },
  tile: {
    label: 'Tile index',
    note: 'No single expression to find here, so the rewriter works line by line: a floor-divide by 16 on a non-negative value is a shift, and pow(u, 2) is u * u. Each rewrite is proven on its own.',
    src: `function tile(x) {
  let u = x & 1023;
  let cell = Math.floor(u / 16);
  return cell + Math.pow(u, 2);
}`,
  },
  poly: {
    label: 'Cubic in a byte',
    note: 'Math.pow and floating floor-division on a value masked to a byte: each becomes integer arithmetic.',
    src: `function poly(x) {
  let u = x & 255;
  let b = Math.floor(u / 8);
  let p = Math.pow(u, 3) + 3 * Math.pow(u, 2) + 3 * u + 1;
  return b + p;
}`,
  },
};

const PARITY_N = 500_000;
const BENCH_N = 4_000_000;

export function createSuperoptTab(app) {
  const kv = readout('#so-kv', {
    how: 'found by',
    cost: 'cost model',
    search: 'search',
    cert: 'certificate',
  });
  const answer = verdict('#so-verdict');
  const checkList = checks('#so-checks');
  const picker = presetPicker('#so-presets', PRESETS, (k) => load(k));
  const state = { key: null, sup: null, rew: null, finalSrc: null, parity: null, bench: null };

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#so-src').value = p.src;
    $('#so-note').textContent = p.note;
    run();
  }

  function run() {
    const src = $('#so-src').value;
    let orig;
    try { orig = compileFn(src); } catch (e) { app.fail('Does not compile: ' + e.message); return; }
    const sup = bro.superoptimize(src, { maxCandidates: 2048 });
    const rew = bro.rewriteSource(src, { requireFormalProof: true });
    state.sup = sup;
    state.rew = rew;
    const rewrites = rew.rewrites || [];
    state.finalSrc = sup.optimized ? sup.optimizedSource : rewrites.length ? rew.rewrittenSource : null;

    const list = [];
    state.parity = null; state.bench = null;
    if (state.finalSrc) {
      const opt = compileFn(state.finalSrc);
      const arity = Math.max(1, orig.length);
      state.parity = parity(orig, opt, arity);
      state.bench = bench(orig, opt, arity);
      const p = state.parity;
      list.push({ ok: p.diffs === 0, label: p.diffs ? `${num(p.diffs)} of ${num(p.tried)} inputs give a different result, the first at ${tuple(p.first.map(int))}` : `the original and the result agree on all ${num(p.tried)} inputs the page tries`, detail: `${num(PARITY_N)} random inputs plus every edge-value combination` });
      const b = state.bench;
      list.push({ ok: null, label: `${num(BENCH_N)} calls each: ${b.origMs} ms before, ${b.optMs} ms after`, detail: 'wall time on the page, bronze JIT; the JIT already removes some of what the rewrite does' });
      if (sup.optimized) list.push({ ok: null, label: `${num(sup.stats.candidatesTested)} candidates tried, ${num(sup.stats.concretePruned)} ruled out by running them, ${sup.stats.smtQueries} sent to the prover`, detail: `${sup.stats.elapsedMs.toFixed(1)} ms of search` });
      for (const r of rewrites) list.push({ ok: !!r.provenEquivalent, label: `${r.ruleName}: ${r.beforeSnippet} → ${r.afterSnippet}`, detail: r.provenEquivalent ? 'proven equivalent by bro' : 'not proven' });
    } else {
      list.push({ ok: null, label: 'nothing to check: no cheaper equivalent was found', detail: `${sup.stats ? num(sup.stats.candidatesTested) : 0} candidates tried` });
    }

    const st = sup.stats || {};
    if (sup.optimized) {
      answer.set('ok', 'SYNTHESIZED', `${sup.synthesizedExpression}`);
      kv.set('how', sup.ruleDescription || 'search', true);
      kv.set('cost', `${st.costBefore} → ${st.costAfter}`, st.costAfter < st.costBefore);
      kv.set('search', `${num(st.candidatesGenerated)} generated, ${st.smtQueries} proven`);
      kv.set('cert', sup.certificateHash || '—');
    } else if (rewrites.length) {
      answer.set('ok', `${rewrites.length} REWRITE${rewrites.length === 1 ? '' : 'S'}`, `ops ${rew.estimatedOpsBefore} → ${rew.estimatedOpsAfter}, each proven`);
      kv.set('how', 'local rewrites', true);
      kv.set('cost', `${rew.estimatedOpsBefore} → ${rew.estimatedOpsAfter} ops`, rew.estimatedOpsAfter < rew.estimatedOpsBefore);
      kv.set('search', `${num(st.candidatesTested || 0)} whole-function candidates, none cheaper`);
      kv.set('cert', rew.certificateHash || '—');
    } else {
      answer.set('warn', 'UNCHANGED', 'no cheaper equivalent found');
      kv.set('how', '—', false);
      kv.set('cost', st.costBefore != null ? String(st.costBefore) : '—');
      kv.set('search', `${num(st.candidatesTested || 0)} candidates tried`);
      kv.set('cert', '—');
    }
    const tally = checkList.set(list);
    app.report({ verdict: sup.optimized ? 'synthesized' : rewrites.length ? `${rewrites.length} rewrites` : 'unchanged', size: `cost ${sup.optimized ? `${st.costBefore}→${st.costAfter}` : `${rew.estimatedOpsBefore}→${rew.estimatedOpsAfter}`}`, checks: `${tally.passed}/${tally.counted}` },
      state.finalSrc ? 'Optimized, and the page agrees on every input it tried' : 'No cheaper equivalent found', tally.failed ? 'warn' : 'ok');
    app.redraw();
  }

  function parity(orig, opt, arity) {
    const next = int32Stream(0x5EED);
    const args = new Array(arity).fill(0);
    let tried = 0, diffs = 0, first = null;
    const test = () => {
      tried++;
      if (!same(orig(...args), opt(...args))) { diffs++; if (!first) first = args.slice(); }
    };
    for (let i = 0; i < PARITY_N; i++) { for (let k = 0; k < arity; k++) args[k] = next(); test(); }
    const walk = (k) => {
      if (k === Math.min(arity, 2)) { test(); return; }
      for (const v of EDGES) { args[k] = v; walk(k + 1); }
    };
    args.fill(0);
    walk(0);
    return { tried, diffs, first };
  }

  function bench(orig, opt, arity) {
    const time = (f) => {
      let sink = 0;
      const t0 = Date.now();
      if (arity === 1) for (let i = 0; i < BENCH_N; i++) sink = (sink + f((i * 2654435761) | 0)) | 0;
      else for (let i = 0; i < BENCH_N; i++) sink = (sink + f((i * 2654435761) | 0, (i * 40503) | 0)) | 0;
      return { ms: Date.now() - t0, sink };
    };
    time(orig); time(opt);   // warm both to the same tier first
    const a = time(orig), b = time(opt);
    return { origMs: a.ms, optMs: b.ms, sinkMatch: a.sink === b.sink };
  }

  // Line diff by longest common subsequence: which lines went, which came.
  function diffLines(a, b) {
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const del = new Set(), add = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) del.add(i++); else add.add(j++);
    }
    while (i < n) del.add(i++);
    while (j < m) add.add(j++);
    return { del, add };
  }

  function codePane(title, sub, lines, marks, cls) {
    return h('div.so-code', null,
      h('header', null, h('b', null, title), h('span', null, sub)),
      h('pre', null, lines.map((t, i) => h('span.ln' + (marks.has(i) ? '.' + cls : ''), null, t || ' '))));
  }

  function bar(label, value, max, cls, text) {
    const pct = max > 0 ? Math.max(0.5, (value / max) * 100) : 0;
    return h('div.so-bar', null, h('span', null, label), h('i' + (cls ? '.' + cls : ''), { style: { width: pct + '%' } }), h('span', null, text));
  }

  function draw() {
    const view = clear($('#so-view'));
    const src = $('#so-src').value;
    const { sup, rew } = state;
    if (!sup) return;
    const rewrites = (rew && rew.rewrites) || [];
    $('#so-title').textContent = state.finalSrc ? 'Before and after, and how the search got there' : 'No cheaper equivalent found';
    legend('#so-legend', [[C.err, 'removed'], [C.ok, 'added']]);

    const before = src.trim().split('\n');
    if (!state.finalSrc) {
      view.append(codePane('Original', '', before, new Set(), ''),
        h('p.so-none', null, `The search tried ${num((sup.stats && sup.stats.candidatesTested) || 0)} candidates and none was both cheaper and provably equal; no local rewrite applied either. The function is returned unchanged, which is the safe answer.`));
      return;
    }
    const after = state.finalSrc.trim().split('\n');
    const d = diffLines(before, after);
    const st = sup.stats || {};
    const costB = sup.optimized ? st.costBefore : rew.estimatedOpsBefore;
    const costA = sup.optimized ? st.costAfter : rew.estimatedOpsAfter;
    view.append(h('div.so-pair', null,
      codePane('Original', `cost ${costB}`, before, d.del, 'del'),
      codePane(sup.optimized ? 'Synthesized' : 'Rewritten', `cost ${costA}`, after, d.add, 'add')));

    view.append(h('div.so-section', null, 'What changed'));
    const cards = h('div.so-cards');
    if (sup.optimized) {
      cards.append(h('div.so-card', null, h('b', null, sup.ruleDescription || 'synthesized expression'),
        h('code.to', null, sup.synthesizedExpression),
        h('small', null, `replaces the whole body; proven equal on every input (${st.smtQueries} SMT ${st.smtQueries === 1 ? 'query' : 'queries'})`)));
    }
    for (const r of rewrites) {
      cards.append(h('div.so-card', null, h('b', null, r.description || r.ruleName),
        h('code.from', null, r.beforeSnippet), h('code.to', null, r.afterSnippet),
        h('small', null, r.provenEquivalent ? `proven equivalent · ${r.certificateHash || ''}` : 'not proven')));
    }
    view.append(cards);

    if (sup.optimized) {
      view.append(h('div.so-section', null, 'The search'));
      const max = st.candidatesGenerated || 1;
      view.append(h('div.so-bars', null,
        bar('generated', st.candidatesGenerated, max, 'dim', num(st.candidatesGenerated)),
        bar('tested on inputs', st.candidatesTested, max, 'dim', num(st.candidatesTested)),
        bar('ruled out by running', st.concretePruned, max, 'dim', num(st.concretePruned)),
        bar('sent to the prover', st.smtQueries, max, '', num(st.smtQueries)),
        bar('proven and kept', 1, max, 'after', '1')));
    }

    view.append(h('div.so-section', null, 'Cost'));
    const b = state.bench;
    const tmax = Math.max(b.origMs, b.optMs, 1);
    view.append(h('div.so-bars', null,
      bar('cost model, before', costB, Math.max(costB, costA), '', String(costB)),
      bar('cost model, after', costA, Math.max(costB, costA), 'after', String(costA)),
      bar(`page time, before`, b.origMs, tmax, '', `${b.origMs} ms`),
      bar(`page time, after`, b.optMs, tmax, 'after', `${b.optMs} ms`)));
  }

  $('#so-run').addEventListener('click', run);

  return { state, load, run, draw, question: 'Is there a cheaper program that computes exactly the same thing?' };
}
