// Fuzz tab: bro.fuzz solves for an input that reaches each branch of a
// function and for inputs that make it divide by zero or index out of
// bounds. The page replays every input it returns, and throws a million
// random inputs at the same function to show what blind testing reaches.

import { $, readout } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, alpha, compileFn, paramNames, verdict, checks, legend, presetPicker,
  int32Stream, num, tuple, int } from "./common.js";

export const PRESETS = {
  gate: {
    label: 'Magic gate',
    note: 'One branch opens only for x = 0x1337BEEF; behind it a division can hit zero, and outside it a table lookup can run off the end.',
    src: `function gate(x, y) {
  if (x === 0x1337BEEF) {
    if (y > 100) return 1 / (y - 105);
    return 2;
  }
  const t = [1, 2, 3, 4];
  return t[x & 7];
}`,
  },
  lookup: {
    label: 'Keyed lookup',
    note: 'A record kind is checked against a key mixed with XOR, then used to index; kind 7 divides by an offset.',
    src: `function lookup(kind, off) {
  const table = [10, 20, 30, 40, 50, 60, 70, 80];
  if ((kind ^ 0x5EED) === 0x0BAD) {
    return table[off & 15];
  }
  if (kind === 7) return 100 / (off - 3);
  return table[kind & 7];
}`,
  },
  clamp: {
    label: 'Saturating add',
    note: 'No hazards and no rare branches: random inputs reach every path too. Fuzzing is not only for magic numbers; it says when there is nothing to find.',
    src: `function clampAdd(a, b) {
  const s = a + b;
  if (s > 1000) return 1000;
  if (s < -1000) return -1000;
  return s | 0;
}`,
  },
};

const RANDOM_N = 1_000_000;

export function createFuzzTab(app) {
  const kv = readout('#fuzz-kv', {
    paths: 'feasible paths',
    coverage: 'branch coverage',
    hazards: 'hazards with a witness',
    time: 'fuzz time',
  });
  const answer = verdict('#fuzz-verdict');
  const checkList = checks('#fuzz-checks');
  const picker = presetPicker('#fuzz-presets', PRESETS, (k) => load(k));
  const state = { key: null, result: null, vectors: [], hazards: [], tree: null, random: null };

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#fuzz-src').value = p.src;
    $('#fuzz-note').textContent = p.note;
    run();
  }

  // A hazard shows on the page as a result that is not a finite number:
  // Infinity or NaN from a division by zero, undefined from a read past the end.
  const symptom = (v) => (v === undefined ? 'undefined' : typeof v === 'number' && !Number.isFinite(v) ? String(v) : null);

  function run() {
    const src = $('#fuzz-src').value;
    let fn;
    try { fn = compileFn(src); } catch (e) { app.fail('Does not compile: ' + e.message); return; }
    const arity = Math.max(1, paramNames(src).length);
    const t0 = Date.now();
    const r = bro.fuzz(src, { maxPaths: 16 });
    const wall = Date.now() - t0;
    state.result = r;

    // Replay each vector; reported outputs are int32, so a fractional page
    // result is compared as the int32 it converts to.
    state.vectors = (r.testVectors || r.tests || []).map((t) => {
      const got = fn(...t.args);
      const asInt = typeof got === 'number' ? got | 0 : got;
      return { args: t.args, path: t.branchPath || t.path || '', output: t.output, got, ok: got === t.output || asInt === t.output };
    });
    // Hazards that come with a witness, one per kind and witness.
    const seen = new Set();
    state.hazards = (r.hazards || []).filter((h) => Array.isArray(h.witnessArgs) && h.witnessArgs.length === arity).filter((h) => {
      const k = h.kind + ':' + h.witnessArgs.join(',');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((h) => {
      let got, threw = null;
      try { got = fn(...h.witnessArgs); } catch (e) { threw = e.message; }
      const s = threw ? 'threw ' + threw : symptom(got);
      return { kind: h.kind, message: h.message || h.description, args: h.witnessArgs, got, symptom: s };
    });
    state.tree = buildTree(state.vectors);
    state.random = randomRun(fn, arity, symptom);

    const nh = state.hazards.length;
    answer.set(nh ? 'err' : 'ok', nh ? `${nh} HAZARD${nh === 1 ? '' : 'S'}` : 'SAFE', `${r.feasiblePaths} paths, ${Math.round((r.branchCoverage || 0) * 100)}% of branches reached`);
    kv.set('paths', String(r.feasiblePaths ?? state.vectors.length));
    kv.set('coverage', `${r.coveredBranches ?? '—'} of ${r.totalBranches ?? '—'} branches`, r.branchCoverage === 1);
    kv.set('hazards', nh ? state.hazards.map((h) => h.kind).join(', ') : 'none', nh === 0);
    kv.set('time', `${wall} ms`);

    const list = [];
    const bad = state.vectors.filter((v) => !v.ok);
    list.push({
      ok: bad.length === 0,
      label: bad.length ? `${bad.length} of ${state.vectors.length} inputs return something else on the page` : `all ${state.vectors.length} path inputs return what bro.fuzz says when the page runs them`,
      detail: bad.length ? bad.map((v) => `f${tuple(v.args)} = ${v.got}, reported ${v.output}`).join('; ') : null,
    });
    for (const h of state.hazards) {
      list.push({ ok: !!h.symptom, label: `${h.kind} at f${tuple(h.args.map(int))}: the page gets ${h.symptom || JSON.stringify(h.got)}`, detail: h.message });
    }
    const rr = state.random;
    list.push(nh
      ? { ok: null, label: rr.hits ? `${num(RANDOM_N)} random inputs trigger a hazard ${num(rr.hits)} times` : `${num(RANDOM_N)} random inputs never trigger a hazard`, detail: `${rr.outputs} distinct results seen; ${rr.ms} ms of page time` }
      : { ok: rr.hits === 0, label: `${num(RANDOM_N)} random inputs, no non-finite or undefined result`, detail: `${rr.outputs} distinct results seen; ${rr.ms} ms of page time` });
    const rare = state.vectors.filter((v) => !rr.outputsSeen.has(key(v.got)));
    if (rare.length) list.push({ ok: null, label: `${rare.length} path result${rare.length === 1 ? '' : 's'} never came up in the random run`, detail: rare.map((v) => `f${tuple(v.args.map(int))} = ${fmt(v.got)}`).join(', ') });

    const tally = checkList.set(list);
    app.report({ verdict: nh ? `${nh} hazards` : 'safe', size: `${state.vectors.length} paths`, checks: `${tally.passed}/${tally.counted}` },
      nh ? `${nh} hazard${nh === 1 ? '' : 's'} found, each witness reproduced by the page` : 'Every path reached, nothing unsafe', tally.failed ? 'warn' : (nh ? 'warn' : 'ok'));
    app.redraw();
  }

  const key = (v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : String(v));
  const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) && Number.isFinite(v) ? v.toPrecision(3) : String(v));

  function randomRun(fn, arity, symptomOf) {
    const next = int32Stream(0xF022);
    const args = new Array(arity).fill(0);
    const outputsSeen = new Set();
    let hits = 0;
    const t0 = Date.now();
    for (let i = 0; i < RANDOM_N; i++) {
      for (let k = 0; k < arity; k++) args[k] = next();
      let v;
      try { v = fn(...args); } catch (e) { hits++; continue; }
      if (symptomOf(v)) hits++;
      if (outputsSeen.size < 4096) outputsSeen.add(key(v));
    }
    return { hits, outputs: outputsSeen.size >= 4096 ? '4,096+' : num(outputsSeen.size), outputsSeen, ms: Date.now() - t0 };
  }

  // Merge the vectors' branch paths ("b0->b8->T(b9)->…") into one tree.
  function buildTree(vectors) {
    const root = { id: 'entry', edge: null, kids: [], leaf: null };
    for (const v of vectors) {
      let node = root;
      for (const tok of v.path.split('->').filter(Boolean)) {
        const m = /^([TF])\((\w+)\)$/.exec(tok);
        const id = m ? m[2] : tok;
        const edge = m ? m[1] : null;
        let kid = node.kids.find((k) => k.id === id && k.edge === edge);
        if (!kid) { kid = { id, edge, kids: [], leaf: null }; node.kids.push(kid); }
        node = kid;
      }
      const leaf = { id: 'out', edge: null, kids: [], leaf: v };
      node.kids.push(leaf);
    }
    // Fold runs of unconditional blocks so the tree shows decisions.
    const fold = (n) => {
      n.kids = n.kids.map((k) => {
        while (!k.leaf && k.kids.length === 1 && !k.kids[0].edge && !k.kids[0].leaf) k = { ...k.kids[0], edge: k.edge };
        return fold(k);
      });
      return n;
    };
    return fold(root);
  }

  function draw() {
    const { ctx, w, h: hh } = fitCanvas('#fuzz-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    if (!state.tree) return;
    $('#fuzz-title').textContent = 'Every path through the function, and an input that takes it';
    legend('#fuzz-legend', [[C.accent, 'branch taken (T)'], [C.muted, 'not taken (F)'], [C.ok, 'replayed by the page'], [C.err, 'hazard witness']]);

    const pad = 28;
    const hzH = state.hazards.length ? 120 : 0;
    const treeH = hh - pad * 2 - hzH;
    drawTree(ctx, pad, pad, w - pad * 2, treeH);
    if (hzH) drawHazards(ctx, pad, hh - pad - hzH + 16, w - pad * 2, hzH - 16);
  }

  function drawTree(ctx, x, y, w, hh) {
    const leaves = [];
    let depth = 0;
    const walk = (n, d) => {
      n.depth = d;
      depth = Math.max(depth, d);
      if (n.leaf) { leaves.push(n); return; }
      n.kids.forEach((k) => walk(k, d + 1));
    };
    walk(state.tree, 0);
    if (!leaves.length) return;
    const leafW = Math.min(330, w * 0.34);
    const colW = Math.max(60, (w - leafW - 40) / Math.max(1, depth - 1));
    // A few paths spread over the height; many pack down to a readable row.
    const rowH = Math.min(150, hh / leaves.length);
    const top = y + (hh - rowH * leaves.length) / 2;
    leaves.forEach((n, i) => { n.y = top + rowH * (i + 0.5); });
    const place = (n) => {
      if (n.leaf) { n.x = x + (depth - 1) * colW + 40; return n.y; }
      const ys = n.kids.map(place);
      n.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      n.x = x + n.depth * colW;
      return n.y;
    };
    place(state.tree);

    ctx.font = C.font;
    const edges = (n) => {
      for (const k of n.kids) {
        const taken = k.edge === 'T';
        ctx.strokeStyle = k.edge ? (taken ? C.accent : C.muted) : C.borderHi;
        ctx.lineWidth = k.edge ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        const mx = (n.x + k.x) / 2;
        ctx.bezierCurveTo(mx, n.y, mx, k.y, k.x, k.y);
        ctx.stroke();
        if (k.edge) {
          ctx.fillStyle = taken ? C.accent : C.muted;
          ctx.fillText(k.edge, mx - 3, (n.y + k.y) / 2 - 5);
        }
        edges(k);
      }
    };
    ctx.lineWidth = 1;
    edges(state.tree);
    const nodes = (n) => {
      if (n.leaf) { drawLeaf(ctx, n.x, n.y, leafW, rowH, n.leaf); return; }
      ctx.fillStyle = C.surface;
      ctx.strokeStyle = C.borderHi;
      ctx.beginPath(); ctx.arc(n.x, n.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.textAlign = 'center';
      ctx.fillText(n.id === 'entry' ? 'in' : n.id, n.x, n.y + 4);
      ctx.textAlign = 'left';
      n.kids.forEach(nodes);
    };
    nodes(state.tree);
  }

  function drawLeaf(ctx, x, y, w, rowH, v) {
    const h = Math.min(40, rowH - 8);
    const hz = state.hazards.find((z) => z.args.every((a, i) => a === v.args[i]));
    ctx.fillStyle = C.surface;
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = hz ? C.err : v.ok ? C.ok : C.err;
    ctx.fillRect(x, y - h / 2, 3, h);
    ctx.strokeStyle = C.border;
    ctx.strokeRect(x + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    ctx.font = C.font;
    ctx.fillStyle = C.text;
    ctx.fillText(`f${tuple(v.args.map(int))}`, x + 12, y - 2);
    ctx.fillStyle = C.muted;
    ctx.fillText(`→ ${fmt(v.got)}${v.ok ? '  ✓ replayed' : `  ✗ reported ${v.output}`}`, x + 12, y + 12);
  }

  function drawHazards(ctx, x, y, w, hh) {
    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.fillText('HAZARDS, EACH WITH AN INPUT THAT TRIGGERS IT', x, y);
    const n = state.hazards.length;
    const cw = Math.min(380, (w - (n - 1) * 12) / n);
    state.hazards.forEach((h, i) => {
      const cx = x + i * (cw + 12), cy = y + 12;
      ctx.fillStyle = alpha(C.err, 0.08);
      ctx.fillRect(cx, cy, cw, hh - 16);
      ctx.fillStyle = C.err;
      ctx.fillRect(cx, cy, 3, hh - 16);
      ctx.fillText(h.kind, cx + 12, cy + 18);
      ctx.fillStyle = C.text;
      ctx.fillText(`f${tuple(h.args.map(int))}`, cx + 12, cy + 38);
      ctx.fillStyle = h.symptom ? C.ok : C.err;
      ctx.fillText(h.symptom ? `page gets ${h.symptom} ✓` : `page gets ${fmt(h.got)} ✗`, cx + 12, cy + 56);
      ctx.fillStyle = C.dim;
      ctx.fillText(`random inputs: ${num(state.random.hits)} of ${num(RANDOM_N)} trigger any hazard`, cx + 12, cy + 74);
    });
  }

  $('#fuzz-run').addEventListener('click', run);

  return { state, load, run, draw, question: 'Which inputs reach each path, and which make the function divide by zero or read past an array?' };
}
