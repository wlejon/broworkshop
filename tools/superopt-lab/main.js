import { boot, $, h, statusLine, logView, stats, readout, segmented, tabs } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";

boot();

const status = statusLine('#status');
const log = logView('#log', { max: 200 });
const statBar = stats('#stats', {
  mode: 'pass',
  verdict: 'verdict',
  cert: 'cert',
});

const PROVE_PRESETS = {
  absFixed: {
    label: 'Branchless Abs (EQ)',
    domainMin: -1073741824,
    domainMax: 1073741824,
    spec: `function specAbs(x) {\n  return x < 0 ? (-x | 0) : (x | 0);\n}`,
    cand: `function candAbs(x) {\n  const m = x >> 31;\n  return ((x ^ m) - m) | 0;\n}`,
  },
  absBug: {
    label: 'Abs INT32_MIN Bug',
    domainMin: -2147483648,
    domainMax: 2147483647,
    spec: `function specClampAbs(x) {\n  if (x === -2147483648) return 2147483647;\n  return x < 0 ? (-x | 0) : (x | 0);\n}`,
    cand: `function buggyAbs(x) {\n  return x < 0 ? (-x | 0) : (x | 0);\n}`,
  },
  shiftBug: {
    label: 'Div2 vs Shift >> 1',
    domainMin: -1024,
    domainMax: 1024,
    spec: `function div2Trunc(x) {\n  return (x / 2) | 0;\n}`,
    cand: `function shiftRight1(x) {\n  return x >> 1;\n}`,
  },
  bithackEq: {
    label: 'Bitwise Floor Avg (EQ)',
    domainMin: -65536,
    domainMax: 65536,
    spec: `function floorAvgSpec(x, y) {\n  return (x + y) >> 1;\n}`,
    cand: `function floorAvgBithack(x, y) {\n  return (x & y) + ((x ^ y) >> 1);\n}`,
  },
};

const SUPEROPT_PRESETS = {
  branchyAbs: {
    label: 'Branchy Abs (CEGIS)',
    src: `function branchyAbs(x) {\n  if (x < 0) return -x;\n  return x;\n}`,
  },
  polySoup: {
    label: 'Math.pow + Bit Guards',
    src: `function polySoup(x) {\n  let u = x & 255;\n  if (u < 0) return -1;\n  let a = Math.max(0, x & 255);\n  let b = Math.floor((x & 255) / 8);\n  let p = Math.pow(u, 3) + 3 * Math.pow(u, 2) + 3 * u + 1;\n  return a + b + p;\n}`,
  },
  divPow2: {
    label: 'Power-of-2 Shift & Clamp',
    src: `function indexTile(x) {\n  let u = x & 1023;\n  if (u < 0) return 0;\n  let cell = Math.floor((x & 1023) / 16);\n  let sq = Math.pow(u, 2);\n  return cell + sq;\n}`,
  },
};

const KERNEL_PRESETS = {
  saxpy: {
    label: 'SAXPY (Parallel)',
    src: `function saxpy(out, x, y, a, n) {\n  for (let i = 0; i < n; i++) {\n    out[i] = a * x[i] + y[i];\n  }\n}`,
  },
  scaleBias: {
    label: 'Scale + Bias (Parallel)',
    src: `function scaleBias(out, inp, scale, bias, n) {\n  for (let i = 0; i < n; i++) {\n    out[i] = inp[i] * scale + bias;\n  }\n}`,
  },
  stencil1d: {
    label: '1D Stencil (Parallel)',
    src: `function stencil1d(dst, src, n) {\n  for (let i = 0; i < n; i++) {\n    dst[i] = 0.25 * src[i] + 0.5 * src[i + 1] + 0.25 * src[i + 2];\n  }\n}`,
  },
  prefixSum: {
    label: 'Prefix Sum (RAW Hazard)',
    src: `function prefixSumHazard(a, x, n) {\n  for (let i = 0; i < n; i++) {\n    a[i] = a[i - 1] + x[i];\n  }\n}`,
  },
};

const proveKv = readout('#prove-kv', {
  status: 'Prove Status',
  equivalent: 'Equivalent',
  verified: 'Verified Safe',
  counterexample: 'Counterexample',
  feasiblePaths: 'Fuzz Feasible Paths',
  branchCov: 'Fuzz Branch Coverage',
  proofHash: 'Proof Certificate',
});

const superoptKv = readout('#superopt-kv', {
  synthesized: 'CEGIS Synthesized',
  allProven: 'All Rewrites Proven',
  astCost: 'AST Cost (Before -> After)',
  estOps: 'Est. Ops (Before -> After)',
  candidates: 'Candidates / Pruned / SMT',
  bench: '100k Iter Microbench',
  certHash: 'Certificate Hash',
});

const kernelKv = readout('#kernel-kv', {
  parallelizable: 'GPU Parallelizable',
  noRaw: 'Proven No RAW',
  noWaw: 'Proven No WAW',
  noWar: 'Proven No WAR',
  inBounds: 'Proven In-Bounds',
  loopBounds: 'Induction / Bound',
  hazards: 'Loop-Carried Hazards',
  certHash: 'Certificate Hash',
});

export const state = {
  activeTab: 'prove',
  proveResult: null,
  fuzzResult: null,
  proveSamples: [],
  superoptResult: null,
  rewriteResult: null,
  benchResult: null,
  kernelResult: null,
  kernelPreview: null,
};

function compileFn(src) {
  const wrapped = '"use strict"; return (' + src.trim() + ');';
  return (new Function(wrapped))();
}

export function loadProvePreset(key) {
  const p = PROVE_PRESETS[key];
  if (!p) return;
  $('#prove-spec').value = p.spec;
  $('#prove-cand').value = p.cand;
  $('#prove-min').value = String(p.domainMin);
  $('#prove-max').value = String(p.domainMax);
  proveSeg.value = key;
  runProve();
}

export function loadSuperoptPreset(key) {
  const p = SUPEROPT_PRESETS[key];
  if (!p) return;
  $('#superopt-src').value = p.src;
  superoptSeg.value = key;
  runSuperopt();
}

export function loadKernelPreset(key) {
  const p = KERNEL_PRESETS[key];
  if (!p) return;
  $('#kernel-src').value = p.src;
  kernelSeg.value = key;
  runAutoKernel();
}

export function runProve() {
  try {
    const specSrc = $('#prove-spec').value;
    const candSrc = $('#prove-cand').value;
    const domainMin = Number($('#prove-min').value);
    const domainMax = Number($('#prove-max').value);

    const proveRes = bro.prove(candSrc, {
      equivTo: specSrc,
      domainMin: Number.isFinite(domainMin) ? domainMin : -2147483648,
      domainMax: Number.isFinite(domainMax) ? domainMax : 2147483647,
    });
    const fuzzRes = bro.fuzz(candSrc, { maxPaths: 16 });

    state.proveResult = proveRes;
    state.fuzzResult = fuzzRes;

    const eq = Boolean(proveRes.equivalent);
    const cex = proveRes.counterexample;
    const cexText = cex
      ? `args=[${(cex.args || []).join(', ')}] -> spec=${cex.expectedOutput}, cand=${cex.actualOutput}`
      : 'none (proven across domain)';

    proveKv.set('status', proveRes.status, proveRes.verified);
    proveKv.set('equivalent', eq ? 'YES (BIT-EXACT)' : 'NO (COUNTEREXAMPLE)', eq);
    proveKv.set('verified', `${proveRes.verified} (guards ${proveRes.provenGuards}/${proveRes.totalGuards})`, proveRes.verified);
    proveKv.set('counterexample', cexText, !cex);
    proveKv.set('feasiblePaths', `${fuzzRes.feasiblePaths} paths (${(fuzzRes.tests || []).length} tests)`);
    proveKv.set('branchCov', `${((fuzzRes.branchCoverage || 0) * 100).toFixed(0)}% (${fuzzRes.coveredBranches}/${fuzzRes.totalBranches})`);
    proveKv.set('proofHash', (proveRes.proofHash || '').slice(0, 24) + '…');

    const lines = [];
    lines.push(`status: ${proveRes.status} | equivalent: ${eq} | proofHash: ${proveRes.proofHash}`);
    if (cex) {
      lines.push(`COUNTEREXAMPLE FOUND:`);
      lines.push(`  witness args   : [${(cex.args || []).join(', ')}]`);
      lines.push(`  expected (spec): ${cex.expectedOutput}`);
      lines.push(`  actual (cand)  : ${cex.actualOutput}`);
    } else {
      lines.push(`UNSAT: No counterexample exists in [${domainMin}, ${domainMax}].`);
    }
    if (fuzzRes.tests && fuzzRes.tests.length) {
      lines.push(`Symbolic path tests (${fuzzRes.tests.length}):`);
      for (const t of fuzzRes.tests.slice(0, 6)) {
        lines.push(`  args=[${(t.args || []).join(', ')}] -> out=${t.output} (${t.path || 'root'})`);
      }
    }
    $('#prove-out').textContent = lines.join('\n');

    // Sample spec vs candidate across test points for canvas visualization
    const specFn = compileFn(specSrc);
    const candFn = compileFn(candSrc);
    const pts = [-2147483648, -1024, -17, -1, 0, 1, 17, 1024, 2147483647];
    if (cex && Array.isArray(cex.args) && cex.args.length > 0 && !pts.includes(cex.args[0])) {
      pts.unshift(cex.args[0]);
    }
    state.proveSamples = pts.slice(0, 10).map((x) => {
      const y2 = Math.floor(x / 3) | 0;
      const s = specFn.length >= 2 ? specFn(x, y2) : specFn(x);
      const c = candFn.length >= 2 ? candFn(x, y2) : candFn(x);
      return { x, spec: s, cand: c, match: s === c };
    });

    statBar.set({
      mode: 'prove+fuzz',
      verdict: eq ? 'EQUIVALENT' : 'COUNTEREXAMPLE',
      cert: (proveRes.proofHash || '').slice(0, 12),
    });
    if (eq) {
      status.ok(`Proven equivalent (${proveRes.proofHash.slice(0, 12)})`);
      log.add(`bro.prove: EQUIVALENT across [${domainMin}, ${domainMax}], fuzz coverage ${(fuzzRes.branchCoverage * 100).toFixed(0)}%`, 'ok');
    } else {
      status.warn(`Counterexample found: ${cexText}`);
      log.add(`bro.prove: COUNTEREXAMPLE ${cexText}`, 'warn');
    }
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('Prove error: ' + (err.message || err), 'err');
  }
}

export function runSuperopt() {
  try {
    const src = $('#superopt-src').value;
    const sup = bro.superoptimize(src, { maxCandidates: 2048 });
    const rew = bro.rewriteSource(src, { requireFormalProof: true });

    state.superoptResult = sup;
    state.rewriteResult = rew;

    const finalSrc = sup.optimized ? sup.optimizedSource : rew.rewrittenSource;
    const origFn = compileFn(src);
    const optFn = compileFn(finalSrc);

    // Verify concrete agreement and microbenchmark over 100k iterations
    let parityOk = true;
    for (let i = -32; i <= 32; i++) {
      if (origFn(i) !== optFn(i)) {
        parityOk = false;
        break;
      }
    }

    const iters = 100000;
    let sinkOrig = 0;
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      sinkOrig = (sinkOrig + (origFn((i & 255) - 128) | 0)) | 0;
    }
    const origMs = Math.max(0.01, performance.now() - t0);

    let sinkOpt = 0;
    const t1 = performance.now();
    for (let i = 0; i < iters; i++) {
      sinkOpt = (sinkOpt + (optFn((i & 255) - 128) | 0)) | 0;
    }
    const optMs = Math.max(0.01, performance.now() - t1);

    state.benchResult = {
      iters,
      origMs,
      optMs,
      parityOk: parityOk && sinkOrig === sinkOpt,
      costBefore: sup.stats ? sup.stats.costBefore : rew.estimatedOpsBefore,
      costAfter: sup.stats ? sup.stats.costAfter : rew.estimatedOpsAfter,
      opsBefore: rew.estimatedOpsBefore,
      opsAfter: rew.estimatedOpsAfter,
    };

    const st = sup.stats || {};
    superoptKv.set('synthesized', sup.optimized ? `YES (${sup.synthesizedExpression})` : 'Rewrite Rules Applied', sup.optimized || (rew.rewrites && rew.rewrites.length > 0));
    superoptKv.set('allProven', `${Boolean(sup.verified && rew.allProvenEquivalent)} (parity=${state.benchResult.parityOk})`, Boolean(sup.verified && rew.allProvenEquivalent));
    superoptKv.set('astCost', `${st.costBefore ?? '—'} -> ${st.costAfter ?? '—'}`);
    superoptKv.set('estOps', `${rew.estimatedOpsBefore} -> ${rew.estimatedOpsAfter} (${rew.rewrites.length} rules)`);
    superoptKv.set('candidates', `${st.candidatesTested || 0} tested / ${st.concretePruned || 0} pruned / ${st.smtQueries || 0} SMT`);
    superoptKv.set('bench', `${origMs.toFixed(2)} ms -> ${optMs.toFixed(2)} ms`);
    superoptKv.set('certHash', (sup.certificateHash || rew.certificateHash || '').slice(0, 24) + '…');

    const outLines = [];
    if (sup.optimized) {
      outLines.push(`// CEGIS Synthesized (${sup.ruleDescription}):`);
      outLines.push(sup.optimizedSource.trim());
      outLines.push('');
    }
    if (rew.rewrites && rew.rewrites.length > 0) {
      outLines.push(`// Verified Source Rewrites (${rew.rewrites.length}):`);
      outLines.push(rew.rewrittenSource.trim());
      if (rew.unifiedDiff) {
        outLines.push('\n' + rew.unifiedDiff.trim());
      }
    } else if (!sup.optimized) {
      outLines.push(rew.rewrittenSource.trim());
    }
    $('#superopt-out').textContent = outLines.join('\n');

    const cert = (sup.certificateHash || rew.certificateHash || '').slice(0, 12);
    statBar.set({
      mode: 'superopt',
      verdict: sup.optimized ? 'SYNTHESIZED' : `REWRITTEN (${rew.rewrites.length})`,
      cert,
    });
    status.ok(`${sup.summary} | ${rew.summary}`);
    log.add(`bro.superoptimize: cost ${st.costBefore}->${st.costAfter}, rewrites=${rew.rewrites.length}, bench ${origMs.toFixed(2)}ms -> ${optMs.toFixed(2)}ms`, 'ok');
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('Superopt error: ' + (err.message || err), 'err');
  }
}

export function runAutoKernel() {
  try {
    const src = $('#kernel-src').value;
    const ak = bro.autoKernel(src);
    state.kernelResult = ak;

    kernelKv.set('parallelizable', ak.parallelizable ? 'YES (WGSL READY)' : 'NO (HAZARD BLOCKED)', ak.parallelizable);
    kernelKv.set('noRaw', String(ak.provenNoRaw), ak.provenNoRaw);
    kernelKv.set('noWaw', String(ak.provenNoWaw), ak.provenNoWaw);
    kernelKv.set('noWar', String(ak.provenNoWar), ak.provenNoWar);
    kernelKv.set('inBounds', String(ak.provenInBounds), ak.provenInBounds);
    kernelKv.set('loopBounds', `${ak.inductionVar || '?'} in [0, ${ak.boundExpr || '?'}]`);
    kernelKv.set('hazards', `${(ak.hazards || []).length} hazards`, (ak.hazards || []).length === 0);
    kernelKv.set('certHash', (ak.certificateHash || '').slice(0, 24) + '…');

    if (ak.parallelizable && ak.kernelSource) {
      $('#kernel-out').textContent = ak.kernelSource.trim();
    } else if (ak.hazards && ak.hazards.length > 0) {
      const hLines = [`LOOP PARALLELIZATION REJECTED (${ak.hazards.length} dependence hazard):`];
      for (const hz of ak.hazards) {
        hLines.push(`  [${hz.hazardKind}] array '${hz.arrayName}': write ${hz.arrayName}[${hz.writeIndexExpr}] @ iter=${hz.iterA} conflicts with read ${hz.arrayName}[${hz.readIndexExpr}] @ iter=${hz.iterB} (conflict index=${hz.conflictIndex})`);
        hLines.push(`  -> ${hz.description}`);
      }
      $('#kernel-out').textContent = hLines.join('\n');
    } else {
      $('#kernel-out').textContent = ak.summary || 'No parallelizable loop found.';
    }

    // Execute loop on a 48-element Float32Array to visualize buffer transformation / conflict
    const N = 48;
    const inp = new Float32Array(N);
    const aux = new Float32Array(N);
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      inp[i] = Math.sin(i * 0.22) * 10 + (i % 5) - 2;
      aux[i] = Math.cos(i * 0.15) * 4;
      out[i] = aux[i];
    }
    const loopFn = compileFn(src);
    if (loopFn.length === 5) {
      if (src.includes('y[i]')) loopFn(out, inp, aux, 1.75, N);
      else loopFn(out, inp, 1.75, 2.5, N);
    } else if (loopFn.length === 4) {
      loopFn(out, inp, 2.0, N);
    } else if (loopFn.length === 3) {
      if (src.includes('a[i - 1]')) {
        out[0] = inp[0];
        for (let i = 1; i < N; i++) out[i] = out[i - 1] + inp[i];
      } else {
        loopFn(out, inp, N - 2);
      }
    }
    state.kernelPreview = { inp, out, n: N };

    statBar.set({
      mode: 'autoKernel',
      verdict: ak.parallelizable ? 'PARALLEL_OK' : 'RAW_HAZARD',
      cert: (ak.certificateHash || '').slice(0, 12),
    });
    if (ak.parallelizable) {
      status.ok(ak.summary);
      log.add(`bro.autoKernel: ${ak.summary} (cert ${ak.certificateHash.slice(0, 12)})`, 'ok');
    } else {
      status.warn(ak.summary);
      log.add(`bro.autoKernel: ${ak.summary}`, 'warn');
    }
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('AutoKernel error: ' + (err.message || err), 'err');
  }
}

export function drawCanvas() {
  const { ctx, w, h: hh } = fitCanvas('#view');
  ctx.fillStyle = '#090c12';
  ctx.fillRect(0, 0, w, hh);

  // Subtle grid
  ctx.strokeStyle = '#141b26';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
  }
  for (let y = 0; y < hh; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (state.activeTab === 'prove') {
    drawProveCanvas(ctx, w, hh);
  } else if (state.activeTab === 'superopt') {
    drawSuperoptCanvas(ctx, w, hh);
  } else {
    drawKernelCanvas(ctx, w, hh);
  }
}

function drawProveCanvas(ctx, w, hh) {
  const pr = state.proveResult;
  const fz = state.fuzzResult;
  if (!pr) return;

  const pad = 28;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(`SMT Bitvector Equivalence & Symbolic Path Explorer — ${pr.equivalent ? 'PROVEN EQUIVALENT' : 'COUNTEREXAMPLE WITNESS'}`, pad, 30);

  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = pr.equivalent ? '#7fe6a8' : '#ff8585';
  ctx.fillText(
    pr.equivalent
      ? `Certificate: ${pr.proofHash}`
      : `Counterexample: args=[${(pr.counterexample?.args || []).join(', ')}] -> spec=${pr.counterexample?.expectedOutput}, cand=${pr.counterexample?.actualOutput}`,
    pad,
    52
  );

  // Draw sample comparison bars / table
  const samples = state.proveSamples || [];
  const topY = 80;
  const rowH = Math.min(34, Math.floor((hh - topY - 80) / Math.max(1, samples.length)));

  ctx.fillStyle = '#8a94a6';
  ctx.fillText('Input x', pad, topY - 8);
  ctx.fillText('Spec Output', pad + 160, topY - 8);
  ctx.fillText('Candidate Output', pad + 320, topY - 8);
  ctx.fillText('Agreement', pad + 500, topY - 8);

  samples.forEach((s, i) => {
    const y = topY + i * rowH;
    ctx.fillStyle = s.match ? '#121926' : '#2a161b';
    ctx.fillRect(pad, y, w - pad * 2, rowH - 4);
    ctx.strokeStyle = s.match ? '#24324a' : '#8a3846';
    ctx.strokeRect(pad, y, w - pad * 2, rowH - 4);

    ctx.fillStyle = '#d7dde6';
    ctx.fillText(String(s.x), pad + 10, y + rowH * 0.62);
    ctx.fillStyle = '#9ec2ff';
    ctx.fillText(String(s.spec), pad + 160, y + rowH * 0.62);
    ctx.fillStyle = s.match ? '#7fe6a8' : '#ff8585';
    ctx.fillText(String(s.cand), pad + 320, y + rowH * 0.62);
    ctx.fillText(s.match ? 'MATCH' : 'DIVERGED (WITNESS)', pad + 500, y + rowH * 0.62);
  });

  if (fz) {
    const barY = hh - 46;
    const cov = Math.max(0, Math.min(1, fz.branchCoverage || 0));
    ctx.fillStyle = '#161e2e';
    ctx.fillRect(pad, barY, w - pad * 2, 22);
    ctx.fillStyle = '#2f6f4f';
    ctx.fillRect(pad, barY, (w - pad * 2) * cov, 22);
    ctx.strokeStyle = '#3c8c63';
    ctx.strokeRect(pad, barY, w - pad * 2, 22);
    ctx.fillStyle = '#eafff2';
    ctx.fillText(`Symbolic Fuzz Branch Coverage: ${(cov * 100).toFixed(0)}% (${fz.coveredBranches}/${fz.totalBranches} branches, ${fz.feasiblePaths} feasible paths)`, pad + 10, barY + 15);
  }
}

function drawSuperoptCanvas(ctx, w, hh) {
  const b = state.benchResult;
  const sup = state.superoptResult;
  const rew = state.rewriteResult;
  if (!b || !sup || !rew) return;

  const pad = 32;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText('CEGIS Superoptimizer & Peephole Guard Rewriter — Cost & Microbenchmark', pad, 32);

  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = '#7fe6a8';
  ctx.fillText(`Certificate: ${(sup.certificateHash || rew.certificateHash || '').slice(0, 48)}`, pad, 54);

  const metrics = [
    { label: 'AST Cost', before: b.costBefore || 1, after: b.costAfter || 1, unit: 'nodes' },
    { label: 'Estimated Ops', before: b.opsBefore || 1, after: b.opsAfter || 1, unit: 'ops' },
    { label: '100k Iter Runtime', before: b.origMs, after: b.optMs, unit: 'ms' },
  ];

  const chartTop = 92;
  const groupH = Math.min(100, Math.floor((hh - chartTop - 40) / metrics.length));
  const barMaxW = Math.max(180, w - pad * 2 - 220);

  metrics.forEach((m, idx) => {
    const y = chartTop + idx * groupH;
    const maxVal = Math.max(m.before, m.after, 0.001);
    const wBefore = (m.before / maxVal) * barMaxW;
    const wAfter = (m.after / maxVal) * barMaxW;

    ctx.fillStyle = '#d7dde6';
    ctx.fillText(m.label, pad, y + 18);

    // Before bar
    ctx.fillStyle = '#3b4d6b';
    ctx.fillRect(pad + 150, y + 4, wBefore, 22);
    ctx.fillStyle = '#d7dde6';
    ctx.fillText(`Before: ${typeof m.before === 'number' && !Number.isInteger(m.before) ? m.before.toFixed(2) : m.before} ${m.unit}`, pad + 158, y + 19);

    // After bar
    ctx.fillStyle = '#2f6f4f';
    ctx.fillRect(pad + 150, y + 32, wAfter, 22);
    ctx.fillStyle = '#eafff2';
    ctx.fillText(`After : ${typeof m.after === 'number' && !Number.isInteger(m.after) ? m.after.toFixed(2) : m.after} ${m.unit}`, pad + 158, y + 47);
  });
}

function drawKernelCanvas(ctx, w, hh) {
  const ak = state.kernelResult;
  const prev = state.kernelPreview;
  if (!ak || !prev) return;

  const pad = 32;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(
    `Auto-Kernel Dependence Analyzer — ${ak.parallelizable ? 'PROVEN DATA-PARALLEL (WGSL)' : 'REJECTED: LOOP-CARRIED HAZARD'}`,
    pad,
    30
  );

  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = ak.parallelizable ? '#7fe6a8' : '#ff8585';
  ctx.fillText(ak.summary || '', pad, 52);

  // Plot input and output buffers
  const plotLeft = pad;
  const plotRight = w - pad;
  const plotTop = 76;
  const plotBot = hh - 40;
  const plotW = plotRight - plotLeft;
  const plotH = plotBot - plotTop;
  const midY = (plotTop + plotBot) / 2;

  ctx.strokeStyle = '#253248';
  ctx.strokeRect(plotLeft, plotTop, plotW, plotH);
  ctx.beginPath();
  ctx.moveTo(plotLeft, midY);
  ctx.lineTo(plotRight, midY);
  ctx.stroke();

  let maxAbs = 1;
  for (let i = 0; i < prev.n; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(prev.inp[i]), Math.abs(prev.out[i]));
  }

  const xOf = (i) => plotLeft + (i / (prev.n - 1)) * plotW;
  const yOf = (v) => midY - (v / maxAbs) * (plotH * 0.42);

  // Input trace
  ctx.strokeStyle = '#5c9dff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < prev.n; i++) {
    const x = xOf(i), y = yOf(prev.inp[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Output trace
  ctx.strokeStyle = ak.parallelizable ? '#7fe6a8' : '#ff8585';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < prev.n; i++) {
    const x = xOf(i), y = yOf(prev.out[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Highlight hazard conflict index if present
  if (ak.hazards && ak.hazards.length > 0) {
    const hz = ak.hazards[0];
    const ci = Math.max(1, Math.min(prev.n - 1, hz.conflictIndex || 1));
    const cx = xOf(ci);
    ctx.strokeStyle = '#ff8585';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, plotTop);
    ctx.lineTo(cx, plotBot);
    ctx.stroke();
    ctx.fillStyle = '#ff8585';
    ctx.fillText(`RAW Hazard @ index=${hz.conflictIndex} (iter ${hz.iterA} -> iter ${hz.iterB})`, Math.min(plotRight - 280, cx + 8), plotTop + 20);
  }
}

const proveSeg = segmented(
  '#prove-presets',
  Object.entries(PROVE_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'absFixed', onChange: (k) => loadProvePreset(k) }
);

const superoptSeg = segmented(
  '#superopt-presets',
  Object.entries(SUPEROPT_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'branchyAbs', onChange: (k) => loadSuperoptPreset(k) }
);

const kernelSeg = segmented(
  '#kernel-presets',
  Object.entries(KERNEL_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'saxpy', onChange: (k) => loadKernelPreset(k) }
);

export const tabBar = tabs('#tabs', {
  onChange(name) {
    state.activeTab = name;
    if (name === 'prove' && !state.proveResult) runProve();
    else if (name === 'superopt' && !state.superoptResult) runSuperopt();
    else if (name === 'autokernel' && !state.kernelResult) runAutoKernel();
    else drawCanvas();
  },
});

$('#btn-prove').addEventListener('click', runProve);
$('#btn-superopt').addEventListener('click', runSuperopt);
$('#btn-kernel').addEventListener('click', runAutoKernel);
$('#btn-run').addEventListener('click', () => {
  if (state.activeTab === 'prove') runProve();
  else if (state.activeTab === 'superopt') runSuperopt();
  else runAutoKernel();
});
window.addEventListener('resize', drawCanvas);

// Initialize default presets for all 3 tabs and run active tab
$('#prove-spec').value = PROVE_PRESETS.absFixed.spec;
$('#prove-cand').value = PROVE_PRESETS.absFixed.cand;
$('#superopt-src').value = SUPEROPT_PRESETS.branchyAbs.src;
$('#kernel-src').value = KERNEL_PRESETS.saxpy.src;
runProve();

globalThis.__superoptLab = {
  state,
  tabBar,
  loadProvePreset,
  loadSuperoptPreset,
  loadKernelPreset,
  runProve,
  runSuperopt,
  runAutoKernel,
};
