// Trajectory tab: a potential U(x, y, z) written as plain JS is
// differentiated symbolically (bro.gpu.differentiate, one source compiled
// for CPU and GPU), compiled into a force field, and a shooting solver finds
// the launch velocity whose flight through that field, under gravity and
// around obstacles, lands on the target. The page checks the gradient
// against finite differences, the CPU against the GPU, the landing and the
// clearance itself, and the gravity-only case against the closed form.

import { $, readout } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { C, alpha, compileFn, verdict, checks, legend, presetPicker } from "./common.js";

const G = 9.81;

export const PRESETS = {
  ripple: {
    label: 'Ripple bowl',
    target: [8, 3],
    time: 1.5,
    note: 'A shallow bowl with a ripple on top, and one obstacle on the straight-line path. The solver has to bend the shot through the field to land on the target.',
    obstacles: [{ center: [4.0, 2.4, 0], radius: 0.9, margin: 0.45, weight: 80 }],
    src: `function ripple(x, y, z) {
  const r2 = x * x + 1.4 * y * y + 0.5 * z * z;
  return 0.18 * r2 + 0.35 * Math.cos(x * 0.7) * Math.sin(y * 0.7);
}`,
  },
  slalom: {
    label: 'Slalom',
    target: [9, 4],
    time: 1.6,
    note: 'Two pillars and a quartic well. The repulsive margins around each pillar are part of the field the shooter integrates through.',
    obstacles: [
      { center: [3.2, 2.0, 0], radius: 0.75, margin: 0.4, weight: 90 },
      { center: [6.2, 3.6, 0], radius: 0.75, margin: 0.4, weight: 90 },
    ],
    src: `function quartic(x, y, z) {
  const u = 0.25 * (x * x + y * y) + 0.1 * z * z;
  return 0.04 * u * u + 0.12 * Math.sin(x) * Math.sin(y);
}`,
  },
  eggcrate: {
    label: 'Egg crate',
    target: [9, 2],
    time: 1.8,
    note: 'A periodic landscape of hills and hollows; the force arrows show where it pushes the projectile.',
    obstacles: [],
    src: `function eggCrate(x, y, z) {
  return 1.6 * Math.sin(0.9 * x) * Math.cos(0.9 * y) + 0.1 * z * z;
}`,
  },
  headwind: {
    label: 'Headwind',
    target: [8, 1],
    time: 1.4,
    note: 'U = 3x is a constant force of 3 N pushing back along −x: the solver must launch faster than gravity alone needs.',
    obstacles: [],
    src: `function headwind(x, y, z) {
  return 3 * x;
}`,
  },
  gravity: {
    label: 'Gravity only',
    target: [7, 2],
    time: 1.2,
    note: 'With U = 0 the answer has a closed form, v₀ = (dx / T, dy / T + gT / 2). The page computes it and compares.',
    obstacles: [],
    src: `function flat(x, y, z) {
  return 0;
}`,
  },
};

export function createTrajectoryTab(app) {
  const kv = readout('#traj-kv', {
    v0: 'launch velocity',
    miss: 'miss distance',
    iters: 'shooting iterations',
    drift: 'energy drift',
    clearance: 'obstacle clearance',
    code: 'gradient code',
  });
  const answer = verdict('#traj-verdict');
  const checkList = checks('#traj-checks');
  const picker = presetPicker('#traj-presets', PRESETS, (k) => load(k));
  const state = { key: null, target: [8, 3], obstacles: [], ad: null, field: null, traj: null, fn: null, view: null };

  const timeEl = $('#traj-time');
  const syncTime = () => { $('#traj-time-val').textContent = Number(timeEl.value).toFixed(2) + ' s'; };
  const syncTarget = () => { $('#traj-target').textContent = `(${state.target[0].toFixed(1)}, ${state.target[1].toFixed(1)})`; };

  function load(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.key = key;
    picker.select(key);
    $('#traj-note').textContent = p.note;
    $('#traj-src').value = p.src;
    timeEl.value = String(p.time);
    state.target = p.target.slice();
    state.obstacles = p.obstacles;
    syncTime();
    syncTarget();
    run();
  }

  function run() {
    const src = $('#traj-src').value;
    let fn;
    try { fn = compileFn(src); } catch (e) { app.fail('U does not compile: ' + e.message); return; }
    const T = Number(timeEl.value);
    const [tx, ty] = state.target;

    const ad = bro.gpu.differentiate(src);
    const field = bro.physics.compilePotentialField(fn);
    const traj = bro.physics.solveTrajectory({
      potentialField: field,
      startPos: [0, 0, 0],
      targetPos: [tx, ty, 0],
      gravity: [0, -G, 0],
      obstacles: state.obstacles,
      mass: 1,
      flightTime: T,
      steps: 120,
      tolerance: 1e-4,
    });
    Object.assign(state, { ad, field, traj, fn });

    const v0 = traj.initialVelocity || [0, 0, 0];
    const ok = traj.converged && traj.obstacleFree;
    answer.set(ok ? 'ok' : 'warn', traj.converged ? 'CONVERGED' : 'NOT CONVERGED',
      `v₀ = (${v0[0].toFixed(2)}, ${v0[1].toFixed(2)}) m/s, |v₀| = ${Math.hypot(v0[0], v0[1]).toFixed(2)} m/s`);
    kv.set('v0', `(${v0[0].toFixed(3)}, ${v0[1].toFixed(3)}, ${v0[2].toFixed(3)})`);
    kv.set('miss', `${traj.missDistance.toExponential(1)} m`, traj.missDistance < 1e-3);
    kv.set('iters', String(traj.iterations));
    kv.set('drift', `${(traj.maxEnergyDrift * 100).toFixed(4)} %`, traj.energyInvariantVerified);
    kv.set('clearance', state.obstacles.length ? `${traj.minObstacleClearance.toFixed(2)} m` : 'no obstacles', traj.obstacleFree);
    kv.set('code', `${ad.totalInstCountBeforeOpt} → ${ad.totalInstCountAfterOpt} instructions, ${ad.spirvWordCount} SPIR-V words`);

    const list = [gradientCheck(ad, fn), cpuGpuCheck(ad), landingCheck(traj), clearanceCheck(traj, state.obstacles)];
    if (state.key === 'gravity' && src === PRESETS.gravity.src) list.push(closedFormCheck(v0, tx, ty, T));
    list.push({ ok: null, label: `${ad.gvnExpressionsEliminated} repeated subexpressions shared between U and its three partials`, detail: `sin calls ${ad.sinCallCountBeforeGvn} → ${ad.sinCallCountAfterGvn}, cos calls ${ad.cosCallCountBeforeGvn} → ${ad.cosCallCountAfterGvn}` });
    const tally = checkList.set(list);
    app.report({ verdict: traj.converged ? 'converged' : 'no solution', solved: `miss ${traj.missDistance.toExponential(0)} m`, checks: `${tally.passed}/${list.filter((c) => c.ok !== null).length}` },
      traj.converged ? `Shot solved in ${traj.iterations} iterations` : 'The shooting solver did not converge', tally.failed || !ok ? 'warn' : 'ok');
    app.redraw();
  }

  // Sample points spread over the visible field.
  function samplePoints() {
    const pts = [];
    for (let i = 0; i < 24; i++) pts.push([-0.5 + (i % 6) * 2.1 + 0.37 * (i % 5), -1 + Math.floor(i / 6) * 1.7 + 0.21 * (i % 3), 0.15 * (i % 4)]);
    return pts;
  }

  function gradientCheck(ad, fn) {
    const hstep = 1e-4;
    let worst = 0;
    for (const [x, y, z] of samplePoints()) {
      const g = ad.evalGrad(x, y, z);
      const fd = [
        (fn(x + hstep, y, z) - fn(x - hstep, y, z)) / (2 * hstep),
        (fn(x, y + hstep, z) - fn(x, y - hstep, z)) / (2 * hstep),
        (fn(x, y, z + hstep) - fn(x, y, z - hstep)) / (2 * hstep),
      ];
      const err = Math.max(Math.abs(g.dx - fd[0]), Math.abs(g.dy - fd[1]), Math.abs(g.dz - fd[2])) / (1 + Math.hypot(...fd));
      worst = Math.max(worst, err);
    }
    return { ok: worst < 1e-3, label: `the symbolic gradient matches central finite differences at 24 points`, detail: `worst relative error ${worst.toExponential(1)} (f32 gradient vs f64 differences)` };
  }

  function cpuGpuCheck(ad) {
    if (typeof ad.evalGradGpu !== 'function') return { ok: null, label: 'no GPU gradient entry point' };
    let worst = 0;
    for (const [x, y, z] of samplePoints()) {
      const a = ad.evalGradCpu(x, y, z), b = ad.evalGradGpu(x, y, z);
      worst = Math.max(worst, Math.abs(a.dx - b.dx), Math.abs(a.dy - b.dy), Math.abs(a.dz - b.dz));
    }
    return { ok: worst <= 1e-5, label: 'the CPU and GPU builds of the gradient agree at the same 24 points', detail: `largest difference ${worst === 0 ? '0 (bit-identical)' : worst.toExponential(1)}` };
  }

  function landingCheck(traj) {
    const pts = traj.trajectory || [];
    const end = pts.length ? pts[pts.length - 1].pos : [NaN, NaN];
    const d = Math.hypot(end[0] - state.target[0], end[1] - state.target[1]);
    return { ok: d < 1e-3, label: `the integrated path ends ${d.toExponential(1)} m from the target`, detail: `${pts.length} points over ${Number(timeEl.value).toFixed(2)} s` };
  }

  function clearanceCheck(traj, obstacles) {
    if (!obstacles.length) return { ok: null, label: 'no obstacles to clear' };
    const pts = traj.trajectory || [];
    let worst = Infinity;
    for (const p of pts) for (const o of obstacles) worst = Math.min(worst, Math.hypot(p.pos[0] - o.center[0], p.pos[1] - o.center[1]) - o.radius);
    return { ok: worst > 0, label: worst > 0 ? `the path stays ${worst.toFixed(2)} m clear of every obstacle` : `the path passes ${(-worst).toFixed(2)} m inside an obstacle`, detail: 'measured by the page from the returned points' };
  }

  function closedFormCheck(v0, tx, ty, T) {
    const vx = tx / T, vy = ty / T + 0.5 * G * T;
    const d = Math.hypot(v0[0] - vx, v0[1] - vy);
    return { ok: d < 1e-2, label: `matches the closed form v₀ = (${vx.toFixed(3)}, ${vy.toFixed(3)})`, detail: `difference ${d.toExponential(1)} m/s (symplectic integration vs exact)` };
  }

  // World window: always shows the start, the target and the path, square metres.
  function frame(w, hh) {
    const pts = (state.traj && state.traj.trajectory) || [];
    let x0 = -1, x1 = Math.max(11, state.target[0] + 1.5), y0 = -1.5, y1 = Math.max(6, state.target[1] + 2.5);
    for (const p of pts) { x0 = Math.min(x0, p.pos[0] - 0.5); x1 = Math.max(x1, p.pos[0] + 0.5); y0 = Math.min(y0, p.pos[1] - 0.5); y1 = Math.max(y1, p.pos[1] + 0.5); }
    const pad = 30;
    const s = Math.min((w - pad * 2) / (x1 - x0), (hh - pad * 2) / (y1 - y0));
    const ox = (w - (x1 - x0) * s) / 2, oy = (hh - (y1 - y0) * s) / 2;
    return {
      x0, x1, y0, y1, s,
      sx: (x) => ox + (x - x0) * s,
      sy: (y) => oy + (y1 - y) * s,
      wx: (px) => x0 + (px - ox) / s,
      wy: (py) => y1 - (py - oy) / s,
    };
  }

  function draw() {
    const { ctx, w, h: hh } = fitCanvas('#traj-view');
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, hh);
    if (!state.traj || !state.fn) return;
    const f = state.view = frame(w, hh);
    $('#traj-title').textContent = `Flight through U, ${Number(timeEl.value).toFixed(2)} s to (${state.target[0].toFixed(1)}, ${state.target[1].toFixed(1)})`;
    legend('#traj-legend', [
      [alpha(C.accent, 0.55), 'U high'], [C.surface, 'U low'], [C.dim, '−∇U, the field\'s force', 'line'],
      [C.ok, 'solved path, a dot every 0.1 s', 'line'], [C.accent, 'start and launch velocity'], [C.warn, 'target', 'ring'], [C.err, 'obstacle'],
    ]);
    drawField(ctx, f, w, hh);
    drawAxes(ctx, f, w, hh);
    drawObstacles(ctx, f);
    drawPath(ctx, f);
  }

  // U as continuous shading under contour lines (marching squares at evenly
  // spaced levels), then −∇U as a field of arrows.
  function drawField(ctx, f, w, hh) {
    const cell = 6;
    const cols = Math.ceil(w / cell), rows = Math.ceil(hh / cell);
    const vals = new Float64Array(cols * rows);
    let lo = Infinity, hi = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = state.fn(f.wx(c * cell + cell / 2), f.wy(r * cell + cell / 2), 0);
        vals[r * cols + c] = v;
        if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    const span = hi - lo;
    if (!(span > 1e-9)) return;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = (vals[r * cols + c] - lo) / span;
        ctx.fillStyle = alpha(C.accent, 0.04 + 0.40 * Math.round(t * 48) / 48);
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    const levels = 14;
    const at = (c, r) => vals[r * cols + c];
    const px = (c) => c * cell + cell / 2, py = (r) => r * cell + cell / 2;
    ctx.lineWidth = 1;
    for (let k = 1; k < levels; k++) {
      const L = lo + span * k / levels;
      ctx.strokeStyle = alpha(C.accent, k % 2 ? 0.22 : 0.42);
      ctx.beginPath();
      for (let r = 0; r + 1 < rows; r++) {
        for (let c = 0; c + 1 < cols; c++) {
          const a = at(c, r), b = at(c + 1, r), d = at(c, r + 1), e = at(c + 1, r + 1);
          // Crossing points on the square's four edges, where L falls between ends.
          const pts = [];
          const edge = (v0, v1, x0, y0, x1, y1) => {
            if ((v0 < L) === (v1 < L)) return;
            const s = (L - v0) / (v1 - v0);
            pts.push(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s);
          };
          edge(a, b, px(c), py(r), px(c + 1), py(r));
          edge(b, e, px(c + 1), py(r), px(c + 1), py(r + 1));
          edge(e, d, px(c + 1), py(r + 1), px(c), py(r + 1));
          edge(d, a, px(c), py(r + 1), px(c), py(r));
          for (let i = 0; i + 3 < pts.length; i += 4) {
            ctx.moveTo(pts[i], pts[i + 1]);
            ctx.lineTo(pts[i + 2], pts[i + 3]);
          }
        }
      }
      ctx.stroke();
    }
    ctx.strokeStyle = C.dim;
    ctx.lineWidth = 1;
    const step = 44;
    for (let py = step / 2; py < hh; py += step) {
      for (let px = step / 2; px < w; px += step) {
        const g = state.ad.evalGrad(f.wx(px), f.wy(py), 0);
        const m = Math.hypot(g.dx, g.dy);
        if (!(m > 1e-6)) continue;
        const len = Math.min(16, 4 + m * 3);
        const ux = -g.dx / m, uy = g.dy / m;    // −∇U, screen y down
        const ex = px + ux * len, ey = py + uy * len;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ux * 4 - uy * 3, ey - uy * 4 + ux * 3);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ux * 4 + uy * 3, ey - uy * 4 - ux * 3);
        ctx.stroke();
      }
    }
  }

  function drawAxes(ctx, f, w, hh) {
    ctx.font = C.font;
    ctx.fillStyle = C.dim;
    ctx.strokeStyle = alpha(C.muted, 0.25);
    ctx.textAlign = 'center';
    for (let x = Math.ceil(f.x0); x <= f.x1; x++) {
      const px = f.sx(x);
      ctx.beginPath(); ctx.moveTo(px, hh - 18); ctx.lineTo(px, hh - 12); ctx.stroke();
      if (x % 2 === 0) ctx.fillText(x + ' m', px, hh - 2);
    }
    ctx.textAlign = 'left';
    for (let y = Math.ceil(f.y0); y <= f.y1; y++) {
      const py = f.sy(y);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(6, py); ctx.stroke();
      if (y % 2 === 0) ctx.fillText(y + ' m', 9, py + 4);
    }
  }

  function drawObstacles(ctx, f) {
    for (const o of state.obstacles) {
      const cx = f.sx(o.center[0]), cy = f.sy(o.center[1]);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = alpha(C.err, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, (o.radius + o.margin) * f.s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = alpha(C.err, 0.3);
      ctx.strokeStyle = C.err;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, o.radius * f.s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  function drawPath(ctx, f) {
    const pts = state.traj.trajectory || [];
    ctx.strokeStyle = C.ok;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((p, i) => { if (i) ctx.lineTo(f.sx(p.pos[0]), f.sy(p.pos[1])); else ctx.moveTo(f.sx(p.pos[0]), f.sy(p.pos[1])); });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = C.ok;
    let nextT = 0;
    for (const p of pts) {
      if (p.t + 1e-6 < nextT) continue;
      nextT += 0.1;
      ctx.beginPath(); ctx.arc(f.sx(p.pos[0]), f.sy(p.pos[1]), 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // Launch velocity: 0.15 s worth of it.
    const v0 = state.traj.initialVelocity || [0, 0];
    const ax = f.sx(v0[0] * 0.15), ay = f.sy(v0[1] * 0.15);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f.sx(0), f.sy(0)); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(f.sx(0), f.sy(0), 6, 0, Math.PI * 2); ctx.fill();
    const tx = f.sx(state.target[0]), ty = f.sy(state.target[1]);
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx - 12, ty); ctx.lineTo(tx + 12, ty); ctx.moveTo(tx, ty - 12); ctx.lineTo(tx, ty + 12); ctx.stroke();
    ctx.lineWidth = 1;
  }

  const canvas = $('#traj-view');
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    const f = state.view;
    return f ? [f.wx(e.clientX - r.left), f.wy(e.clientY - r.top)] : null;
  };
  canvas.addEventListener('mousemove', (e) => {
    const p = toWorld(e);
    if (!p || !state.ad) return;
    const g = state.ad.evalGrad(p[0], p[1], 0);
    $('#traj-hover').textContent = `x ${p[0].toFixed(2)}  y ${p[1].toFixed(2)}   U ${g.value.toFixed(3)}   ∇U (${g.dx.toFixed(3)}, ${g.dy.toFixed(3)})`;
  });
  canvas.addEventListener('click', (e) => {
    const p = toWorld(e);
    if (!p) return;
    state.target = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    syncTarget();
    run();
  });
  timeEl.addEventListener('input', syncTime);
  timeEl.addEventListener('change', run);
  $('#traj-run').addEventListener('click', run);

  return { state, load, run, draw, setTarget(x, y) { state.target = [x, y]; syncTarget(); run(); }, question: 'What launch lands on the target through this field, and is the gradient right?' };
}
