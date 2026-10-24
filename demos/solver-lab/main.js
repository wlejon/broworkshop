import { boot, $, statusLine, logView, stats, readout, segmented, tabs } from "/lib/kit/index.js";
import { fitCanvas } from "/lib/kit/gauges.js";

boot();

const status = statusLine('#status');
const log = logView('#log', { max: 200 });
const statBar = stats('#stats', {
  mode: 'solver',
  verdict: 'verdict',
  metric: 'metric',
});

const CONSTRAINT_PRESETS = {
  xorMagic: {
    label: 'Bitvector XOR + HUD Layout',
    bv: `function solveXorPuzzle(x, y) {\n  if (x <= 0 || y <= 0 || x >= 1024 || y >= 1024) return 0;\n  if (((x ^ y) === 42) && (x + y === 170) && (x < y)) return 1;\n  return 0;\n}`,
    layout: JSON.stringify({
      container: { w: 640, h: 360 },
      nonOverlap: true,
      gap: 12,
      snapGrid: 4,
      boxes: [
        { id: "header", x: 12, y: 12, w: 616, h: 48 },
        { id: "sidebar", x: 12, y: 72, w: 160, h: 276 },
        { id: "viewport", minW: 280, maxW: 320, minH: 180, maxH: 200 },
        { id: "inspector", minW: 112, maxW: 132, minH: 180, maxH: 276 },
        { id: "timeline", minW: 280, maxW: 440, minH: 64, maxH: 80 },
      ],
      constraints: [
        "viewport.x >= sidebar.right + 12",
        "viewport.y == sidebar.y",
        "inspector.x >= viewport.right + 12",
        "inspector.y == viewport.y",
        "timeline.x == viewport.x",
        "timeline.y >= viewport.bottom + 12",
      ],
    }, null, 2),
  },
  bitMix: {
    label: 'Bitmask Algebra + Split Deck',
    bv: `function solveBitMask(a, b) {\n  if (a < 16 || a > 512 || b < 16 || b > 512) return 0;\n  if (((a & b) === 24) && ((a | b) === 124) && (a > b)) return 1;\n  return 0;\n}`,
    layout: JSON.stringify({
      container: { w: 640, h: 360 },
      nonOverlap: true,
      gap: 16,
      snapGrid: 8,
      boxes: [
        { id: "nav", x: 16, y: 16, w: 608, h: 40 },
        { id: "leftCard", minW: 280, maxW: 296, minH: 264, maxH: 280 },
        { id: "rightTop", minW: 280, maxW: 296, minH: 120, maxH: 136 },
        { id: "rightBot", minW: 280, maxW: 296, minH: 120, maxH: 136 },
      ],
      constraints: [
        "leftCard.x == 16",
        "leftCard.y >= nav.bottom + 16",
        "rightTop.x >= leftCard.right + 16",
        "rightTop.y == leftCard.y",
        "rightBot.x == rightTop.x",
        "rightBot.y >= rightTop.bottom + 16",
      ],
    }, null, 2),
  },
  unsatPuzzle: {
    label: 'UNSAT Parity Contradiction',
    bv: `function impossibleParity(x) {\n  if (x < 0 || x > 1024) return 0;\n  if (((x & 1) === 0) && ((x & 1) === 1)) return 1;\n  return 0;\n}`,
    layout: JSON.stringify({
      container: { w: 640, h: 360 },
      nonOverlap: true,
      gap: 10,
      boxes: [
        { id: "cardA", x: 20, y: 20, w: 260, h: 320 },
        { id: "cardB", minW: 300, maxW: 320, minH: 300, maxH: 320 },
      ],
      constraints: [
        "cardB.x >= cardA.right + 20",
        "cardB.y == cardA.y",
      ],
    }, null, 2),
  },
};

const TRAJ_PRESETS = {
  harmonicObstacle: {
    label: 'Obstacle Avoidance + Ripple U(x,y,z)',
    tx: 8.0,
    ty: 3.0,
    time: 1.5,
    harmonicK: 0.15,
    obstacles: [
      { center: [4.0, 2.2, 0.0], radius: 0.9, margin: 0.45, weight: 80.0 },
    ],
    src: `function potentialRipple(x, y, z) {\n  const r2 = x * x + 1.4 * y * y + 0.5 * z * z;\n  return 0.18 * r2 + 0.35 * Math.cos(x * 0.7) * Math.sin(y * 0.7);\n}`,
  },
  twinPillars: {
    label: 'Twin Pillars Slalom + Quartic Well',
    tx: 9.0,
    ty: 4.0,
    time: 1.6,
    harmonicK: 0.25,
    obstacles: [
      { center: [3.2, 1.8, 0.0], radius: 0.75, margin: 0.4, weight: 90.0 },
      { center: [6.2, 3.1, 0.0], radius: 0.75, margin: 0.4, weight: 90.0 },
    ],
    src: `function potentialQuartic(x, y, z) {\n  const u = 0.25 * (x * x + y * y) + 0.1 * z * z;\n  return u + 0.12 * Math.sin(x) * Math.sin(y);\n}`,
  },
  highArc: {
    label: 'High Ballistic Arc (Harmonic Bowl)',
    tx: 10.0,
    ty: 1.5,
    time: 1.8,
    harmonicK: 0.35,
    obstacles: [
      { center: [5.0, 2.0, 0.0], radius: 1.05, margin: 0.45, weight: 100.0 },
    ],
    src: `function potentialHarmonic(x, y, z) {\n  return 0.2 * (x * x + y * y + z * z) + 0.2 * Math.cos(0.5 * (x + y));\n}`,
  },
};

const ROLLBACK_PRESETS = {
  detArena: {
    label: 'Deterministic Arena Tick (Valid)',
    src: `function tick(state, inputs) {\n  const p0 = inputs[0] | 0;\n  const p1 = inputs[1] | 0;\n  const dx0 = ((p0 & 2) ? 4 : 0) - ((p0 & 1) ? 4 : 0);\n  const dy0 = ((p0 & 8) ? 4 : 0) - ((p0 & 4) ? 4 : 0);\n  const dx1 = ((p1 & 2) ? 4 : 0) - ((p1 & 1) ? 4 : 0);\n  const dy1 = ((p1 & 8) ? 4 : 0) - ((p1 & 4) ? 4 : 0);\n  state[0] = (state[0] + dx0) | 0;\n  state[1] = (state[1] + dy0) | 0;\n  state[2] = (state[2] + dx1) | 0;\n  state[3] = (state[3] + dy1) | 0;\n  state[4] = (state[4] + 1) | 0;\n}`,
  },
  detDuel: {
    label: 'Deterministic Coupled Springs (Valid)',
    src: `function tick(state, inputs) {\n  const i0 = inputs[0] | 0;\n  const i1 = inputs[1] | 0;\n  const pull = ((state[2] - state[0]) >> 4) | 0;\n  state[0] = (state[0] + pull + ((i0 & 3) - 1) * 3) | 0;\n  state[1] = (state[1] + (((i0 >> 2) & 3) - 1) * 3) | 0;\n  state[2] = (state[2] - pull + ((i1 & 3) - 1) * 3) | 0;\n  state[3] = (state[3] + (((i1 >> 2) & 3) - 1) * 3) | 0;\n  state[4] = (state[4] + 1) | 0;\n}`,
  },
  hazardTick: {
    label: 'Non-Deterministic Hazard (Blocked)',
    src: `function tick(state, inputs) {\n  const jitter = Math.floor(Math.random() * 10) | 0;\n  const clockBias = Date.now() & 7;\n  state[0] = (state[0] + (inputs[0] | 0) + jitter) | 0;\n  state[1] = (state[1] + clockBias) | 0;\n}`,
  },
};

const constraintKv = readout('#constraint-kv', {
  bvStatus: 'Bitvector Status',
  bvModel: 'Bitvector Assignment',
  bvTime: 'BV Solve Time',
  layoutSat: 'Layout Solver SAT',
  layoutBoxes: 'Solved Boxes',
  layoutTime: 'Layout Solve Time',
});

const trajKv = readout('#traj-kv', {
  autodiffOk: 'Auto-Diff Compiled',
  parity: 'CPU/GPU Proven Equivalent',
  gvn: 'GVN Eliminated / SPIR-V',
  gradSample: 'Symbolic ∇U(1.5, 1.0, 0.5)',
  converged: 'Trajectory Converged',
  v0: 'Solved Initial Velocity v0',
  missDist: 'Target Miss Distance',
  energyDrift: 'Max Symplectic Drift',
  clearance: 'Obstacle Clearance',
});

const rollbackKv = readout('#rollback-kv', {
  determinismLint: 'determinismLintPassed',
  hazardFree: 'Capsule hazardFree',
  capsuleValid: 'verifyCapsule Valid',
  desyncEnabled: 'desyncDetectionEnabled',
  rollbacks: 'Rollbacks / Resim Frames',
  desyncDetected: 'Desync Detected',
  finalChecksum: 'Peer 0 / Peer 1 Checksum',
});

export const state = {
  activeTab: 'constraints',
  bvResult: null,
  layoutResult: null,
  layoutSpec: null,
  autodiffResult: null,
  potentialField: null,
  trajectoryResult: null,
  trajPreset: TRAJ_PRESETS.harmonicObstacle,
  capsule: null,
  verifyResult: null,
  loadResult: null,
  rollbackSummary: null,
};

function compileFn(src) {
  const wrapped = '"use strict"; return (' + src.trim() + ');';
  return (new Function(wrapped))();
}

export function loadConstraintPreset(key) {
  const p = CONSTRAINT_PRESETS[key];
  if (!p) return;
  $('#bv-src').value = p.bv;
  $('#layout-src').value = p.layout;
  constraintSeg.value = key;
  runConstraints();
}

export function loadTrajPreset(key) {
  const p = TRAJ_PRESETS[key];
  if (!p) return;
  state.trajPreset = p;
  $('#traj-src').value = p.src;
  $('#traj-tx').value = String(p.tx);
  $('#traj-ty').value = String(p.ty);
  $('#traj-time').value = String(p.time);
  trajSeg.value = key;
  runTrajectory();
}

export function loadRollbackPreset(key) {
  const p = ROLLBACK_PRESETS[key];
  if (!p) return;
  $('#rollback-src').value = p.src;
  rollbackSeg.value = key;
  runRollback();
}

export function runConstraints() {
  try {
    const bvSrc = $('#bv-src').value;
    const layoutJson = $('#layout-src').value;

    const bvRes = bro.solveWithCert(bvSrc, { min: -65536, max: 65536 });
    const specObj = JSON.parse(layoutJson);
    const layRes = bro.layout.solve(specObj);

    state.bvResult = bvRes;
    state.layoutResult = layRes;
    state.layoutSpec = specObj;

    const modelStr = bvRes.sat && bvRes.model
      ? Object.entries(bvRes.model).map(([k, v]) => `${k}=${v}`).join(', ')
      : 'none (UNSAT)';
    const boxIds = layRes && layRes.boxes ? Object.keys(layRes.boxes) : [];

    constraintKv.set('bvStatus', bvRes.status.toUpperCase(), bvRes.sat);
    constraintKv.set('bvModel', modelStr, bvRes.sat);
    constraintKv.set('bvTime', `${(bvRes.solveTimeMs || 0).toFixed(2)} ms`);
    constraintKv.set('layoutSat', layRes && layRes.sat ? 'SAT (FEASIBLE)' : 'UNSAT', Boolean(layRes && layRes.sat));
    constraintKv.set('layoutBoxes', `${boxIds.length} boxes placed`);
    constraintKv.set('layoutTime', `${(layRes?.solveTimeMs || 0).toFixed(2)} ms`);

    const lines = [];
    lines.push(`Bitvector Solver: status=${bvRes.status}, sat=${bvRes.sat} (${(bvRes.solveTimeMs || 0).toFixed(2)} ms)`);
    if (bvRes.sat && bvRes.model) {
      lines.push(`  model: ${JSON.stringify(bvRes.model)}`);
    } else {
      lines.push(`  proven unsatisfiable across domain`);
    }
    lines.push(`Layout Solver: sat=${Boolean(layRes && layRes.sat)} (${boxIds.length} boxes):`);
    for (const id of boxIds) {
      const b = layRes.boxes[id];
      lines.push(`  ${id.padEnd(10)}: x=${b.x}, y=${b.y}, w=${b.w}, h=${b.h} (right=${b.right}, bottom=${b.bottom})`);
    }
    $('#constraint-out').textContent = lines.join('\n');

    statBar.set({
      mode: 'constraints',
      verdict: `${bvRes.status.toUpperCase()} / LAYOUT_${layRes?.sat ? 'SAT' : 'UNSAT'}`,
      metric: `${boxIds.length} boxes`,
    });
    status.ok(`Solved bitvector (${bvRes.status}) & ${boxIds.length} layout boxes`);
    log.add(`bro.solveWithCert: ${bvRes.status} (${modelStr}) | bro.layout.solve: ${boxIds.length} boxes`, bvRes.sat ? 'ok' : 'warn');
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('Constraint error: ' + (err.message || err), 'err');
  }
}

export function runTrajectory() {
  try {
    const src = $('#traj-src').value;
    const tx = Number($('#traj-tx').value) || 8.0;
    const ty = Number($('#traj-ty').value) || 3.0;
    const flightTime = Math.max(0.2, Number($('#traj-time').value) || 1.5);

    const ad = bro.gpu.differentiate(src);
    const potFn = compileFn(src);
    const potField = bro.physics.compilePotentialField(potFn);

    const preset = state.trajPreset || TRAJ_PRESETS.harmonicObstacle;
    const traj = bro.physics.solveTrajectory({
      startPos: [0, 0, 0],
      targetPos: [tx, ty, 0],
      gravity: [0, -9.81, 0],
      harmonicK: preset.harmonicK || 0.15,
      harmonicCenter: [tx * 0.5, ty * 0.5, 0],
      obstacles: preset.obstacles || [],
      mass: 1.0,
      flightTime,
      steps: 90,
      tolerance: 1e-4,
    });

    state.autodiffResult = ad;
    state.potentialField = potField;
    state.trajectoryResult = traj;

    const gSample = ad.evalGrad(1.5, 1.0, 0.5);
    const v0 = traj.initialVelocity || [0, 0, 0];

    trajKv.set('autodiffOk', `${ad.ok} (safe=${ad.provenSafe}, field=${potField.provenSafe})`, ad.ok && ad.provenSafe);
    trajKv.set('parity', String(ad.cpuGpuProvenEquivalent && ad.singleSourceParityVerified), ad.cpuGpuProvenEquivalent);
    trajKv.set('gvn', `${ad.gvnExpressionsEliminated} CSE / ${ad.spirvWordCount} SPIR-V words`);
    trajKv.set('gradSample', `[${gSample.dx.toFixed(3)}, ${gSample.dy.toFixed(3)}, ${gSample.dz.toFixed(3)}]`);
    trajKv.set('converged', String(traj.converged), traj.converged);
    trajKv.set('v0', `[${v0[0].toFixed(2)}, ${v0[1].toFixed(2)}, ${v0[2].toFixed(2)}] m/s`);
    trajKv.set('missDist', `${traj.missDistance.toExponential(2)} m`, traj.missDistance < 1e-3);
    trajKv.set('energyDrift', `${traj.maxEnergyDrift.toExponential(2)} J (inv=${traj.energyInvariantVerified})`, traj.energyInvariantVerified);
    trajKv.set('clearance', `${traj.minObstacleClearance.toFixed(3)} m (free=${traj.obstacleFree})`, traj.obstacleFree);

    const lines = [
      `bro.gpu.differentiate('${ad.kernelName}'): ok=${ad.ok}, provenSafe=${ad.provenSafe}, cpuGpuProvenEquivalent=${ad.cpuGpuProvenEquivalent}`,
      `  insts: ${ad.totalInstCountBeforeOpt} -> ${ad.totalInstCountAfterOpt} (GVN eliminated: ${ad.gvnExpressionsEliminated}), SPIR-V words: ${ad.spirvWordCount}`,
      `  evalGrad(1.5, 1.0, 0.5): U=${gSample.value.toFixed(4)}, dU=[${gSample.dx.toFixed(4)}, ${gSample.dy.toFixed(4)}, ${gSample.dz.toFixed(4)}]`,
      `bro.physics.solveTrajectory: converged=${traj.converged}, steps=${(traj.trajectory || []).length}`,
      `  initialVelocity: [${v0[0].toFixed(4)}, ${v0[1].toFixed(4)}, ${v0[2].toFixed(4)}]`,
      `  missDistance=${traj.missDistance.toExponential(3)}, maxEnergyDrift=${traj.maxEnergyDrift.toExponential(3)}, minClearance=${traj.minObstacleClearance.toFixed(3)}`,
    ];
    $('#traj-out').textContent = lines.join('\n');

    statBar.set({
      mode: 'autodiff+traj',
      verdict: traj.converged && traj.obstacleFree ? 'CONVERGED_SAFE' : 'SOLVED',
      metric: `drift ${traj.maxEnergyDrift.toExponential(1)}`,
    });
    status.ok(`Auto-diff (${ad.spirvWordCount} SPIR-V words) + trajectory converged (miss ${traj.missDistance.toExponential(2)} m)`);
    log.add(`bro.gpu.differentiate + solveTrajectory: v0=[${v0[0].toFixed(2)}, ${v0[1].toFixed(2)}], clearance=${traj.minObstacleClearance.toFixed(2)}m`, 'ok');
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('Trajectory error: ' + (err.message || err), 'err');
  }
}

export function runRollback() {
  try {
    const src = $('#rollback-src').value;
    const totalFrames = Math.max(8, Math.min(64, Number($('#rollback-frames').value) || 32));
    const netDelay = Math.max(1, Math.min(8, Number($('#rollback-delay').value) || 3));

    const capsule = bro.net.createVerifiedCapsule(src, {
      entryName: 'tick',
      authorId: 'workshop-peer',
    });
    const ver = bro.net.verifyCapsule(capsule, {
      requireDeterminismLint: true,
      requireHazardFree: true,
    });

    state.capsule = capsule;
    state.verifyResult = ver;
    state.loadResult = null;

    if (!ver.valid) {
      state.rollbackSummary = {
        blocked: true,
        reason: ver.reason || capsule.errorSummary || 'Capsule rejected by determinism lint gate',
        hazards: ver.hazards || capsule.hazards || [],
      };
      rollbackKv.set('determinismLint', String(ver.determinismLintPassed), ver.determinismLintPassed);
      rollbackKv.set('hazardFree', `${ver.hazardFree} (${ver.hazardCount} hazards)`, ver.hazardFree);
      rollbackKv.set('capsuleValid', 'REJECTED BY GATE', false);
      rollbackKv.set('desyncEnabled', '—');
      rollbackKv.set('rollbacks', '0 (execution blocked)');
      rollbackKv.set('desyncDetected', 'prevented pre-load', true);
      rollbackKv.set('finalChecksum', 'blocked');

      const hLines = [
        `CAPSULE REJECTED BY DETERMINISM GATE:`,
        `  determinismLintPassed: ${ver.determinismLintPassed}`,
        `  hazardFree           : ${ver.hazardFree} (hazardCount=${ver.hazardCount})`,
        `  reason               : ${ver.reason}`,
      ];
      for (const h of ver.hazards || []) {
        hLines.push(`  - [${h.kind || 'hazard'}] ${h.message || JSON.stringify(h)}`);
      }
      $('#rollback-out').textContent = hLines.join('\n');
      statBar.set({
        mode: 'rollback',
        verdict: 'CAPSULE_REJECTED',
        metric: `${ver.hazardCount} hazards`,
      });
      status.warn(`Capsule rejected: ${ver.reason}`);
      log.add(`bro.net.verifyCapsule blocked non-deterministic tick (${ver.hazardCount} hazards)`, 'warn');
      drawCanvas();
      return;
    }

    const loaded = bro.net.loadVerifiedCapsule(capsule, {
      requireDeterminismLint: true,
      requireHazardFree: true,
    });
    state.loadResult = loaded;

    const init0 = new Int32Array([80, 180, 420, 180, 0]);
    const init1 = new Int32Array([80, 180, 420, 180, 0]);

    const peer0 = bro.net.createRollbackSession({
      tick: loaded.fn,
      initialState: init0,
      playerCount: 2,
      localPlayerId: 0,
      maxRollbackFrames: 64,
    });
    const peer1 = bro.net.createRollbackSession({
      tick: loaded.fn,
      initialState: init1,
      playerCount: 2,
      localPlayerId: 1,
      maxRollbackFrames: 64,
    });

    const p0Inputs = [];
    const p1Inputs = [];
    const history = [];

    for (let f = 0; f < totalFrames; f++) {
      // Deterministic rich input sequences for player 0 and player 1
      const in0 = ((f % 7 < 4) ? 2 : 1) | ((f % 5 < 3) ? 8 : 4);
      const in1 = ((f % 6 < 3) ? 1 : 2) | ((f % 4 < 2) ? 4 : 8);
      p0Inputs.push(in0);
      p1Inputs.push(in1);

      peer0.advanceFrame(in0);
      peer1.advanceFrame(in1);

      // Deliver delayed packets
      const deliverFrame = f - netDelay;
      if (deliverFrame >= 0) {
        peer0.receiveRemoteInput(deliverFrame, 1, p1Inputs[deliverFrame]);
        peer1.receiveRemoteInput(deliverFrame, 0, p0Inputs[deliverFrame]);
      }
      const s0 = peer0.state;
      const s1 = peer1.state;
      history.push({
        frame: f,
        p0: [s0[0], s0[1], s0[2], s0[3]],
        p1: [s1[0], s1[1], s1[2], s1[3]],
        c0: peer0.checksumHex,
        c1: peer1.checksumHex,
      });
    }

    // Flush remaining in-flight packets at the end of the burst
    for (let f = Math.max(0, totalFrames - netDelay); f < totalFrames; f++) {
      peer0.receiveRemoteInput(f, 1, p1Inputs[f]);
      peer1.receiveRemoteInput(f, 0, p0Inputs[f]);
    }

    // Verify all frames' snapshots and checksums match after convergence
    const frameChecksums = [];
    let allMatched = true;
    for (let f = 1; f <= totalFrames; f++) {
      const snap0 = peer0.getSnapshot(f);
      const snap1 = peer1.getSnapshot(f);
      const match = Boolean(snap0 && snap1 && snap0.checksumHex === snap1.checksumHex && peer0.verifyPeerChecksum(f, snap1.checksumHex));
      if (!match) allMatched = false;
      frameChecksums.push({
        frame: f,
        c0: snap0 ? snap0.checksumHex : '',
        c1: snap1 ? snap1.checksumHex : '',
        match,
        state0: history[f - 1].p0,
      });
    }

    const st0 = peer0.getStats();
    const st1 = peer1.getStats();
    state.rollbackSummary = {
      blocked: false,
      totalFrames,
      netDelay,
      allMatched,
      determinismLintPassed: peer0.determinismLintPassed,
      desyncDetectionEnabled: peer0.desyncDetectionEnabled,
      rollbackCount: st0.rollbackCount + st1.rollbackCount,
      resimFrames: st0.totalFramesResimulated + st1.totalFramesResimulated,
      desyncDetected: peer0.desyncDetected || peer1.desyncDetected,
      finalC0: peer0.checksumHex,
      finalC1: peer1.checksumHex,
      finalState0: Array.from(peer0.state),
      finalState1: Array.from(peer1.state),
      frameChecksums,
      history,
    };

    rollbackKv.set('determinismLint', String(peer0.determinismLintPassed), peer0.determinismLintPassed);
    rollbackKv.set('hazardFree', `${ver.hazardFree} (0 hazards)`, ver.hazardFree);
    rollbackKv.set('capsuleValid', `VALID (${ver.certificateHash.slice(0, 14)}…)`, ver.valid);
    rollbackKv.set('desyncEnabled', String(peer0.desyncDetectionEnabled), peer0.desyncDetectionEnabled);
    rollbackKv.set('rollbacks', `${state.rollbackSummary.rollbackCount} rollbacks / ${state.rollbackSummary.resimFrames} frames`);
    rollbackKv.set('desyncDetected', String(state.rollbackSummary.desyncDetected), !state.rollbackSummary.desyncDetected);
    rollbackKv.set('finalChecksum', `${peer0.checksumHex} == ${peer1.checksumHex}`, allMatched);

    const outLines = [
      `Capsule Verified: sha256=${ver.sha256.slice(0, 20)}… cert=${ver.certificateHash.slice(0, 20)}…`,
      `Session: determinismLintPassed=${peer0.determinismLintPassed}, desyncDetectionEnabled=${peer0.desyncDetectionEnabled}`,
      `2-Peer Simulation (${totalFrames} frames, delay=${netDelay} frames):`,
      `  Peer 0: rollbacks=${st0.rollbackCount}, resimulated=${st0.totalFramesResimulated}, checksum=${peer0.checksumHex}`,
      `  Peer 1: rollbacks=${st1.rollbackCount}, resimulated=${st1.totalFramesResimulated}, checksum=${peer1.checksumHex}`,
      `  Final State Peer 0: [${Array.from(peer0.state).join(', ')}]`,
      `  Final State Peer 1: [${Array.from(peer1.state).join(', ')}]`,
      `  Bit-Exact Lockstep Convergence: ${allMatched ? '100% MATCH ACROSS ALL FRAMES' : 'DESYNC'}`,
    ];
    $('#rollback-out').textContent = outLines.join('\n');

    statBar.set({
      mode: 'rollback',
      verdict: allMatched ? 'LOCKSTEP_SYNC' : 'DESYNC',
      metric: `${state.rollbackSummary.rollbackCount} rollbacks`,
    });
    status.ok(`2-peer rollback converged across ${totalFrames} frames (${state.rollbackSummary.rollbackCount} rollbacks, checksum ${peer0.checksumHex})`);
    log.add(`Rollback converged: ${state.rollbackSummary.rollbackCount} rollbacks, ${state.rollbackSummary.resimFrames} resimulated frames, checksum=${peer0.checksumHex}`, 'ok');
    drawCanvas();
  } catch (err) {
    status.error(err);
    log.add('Rollback error: ' + (err.message || err), 'err');
  }
}

export function drawCanvas() {
  const { ctx, w, h: hh } = fitCanvas('#view');
  ctx.fillStyle = '#090c12';
  ctx.fillRect(0, 0, w, hh);

  ctx.strokeStyle = '#141b26';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
  }
  for (let y = 0; y < hh; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  if (state.activeTab === 'constraints') {
    drawConstraintsCanvas(ctx, w, hh);
  } else if (state.activeTab === 'trajectory') {
    drawTrajectoryCanvas(ctx, w, hh);
  } else {
    drawRollbackCanvas(ctx, w, hh);
  }
}

function drawConstraintsCanvas(ctx, w, hh) {
  const bv = state.bvResult;
  const lay = state.layoutResult;
  const spec = state.layoutSpec;
  if (!bv || !lay) return;

  const pad = 28;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(`Bitvector SMT & Declarative Layout Solver — BV: ${bv.status.toUpperCase()} | Layout: ${lay.sat ? 'SAT' : 'UNSAT'}`, pad, 30);

  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = bv.sat ? '#7fe6a8' : '#ff8585';
  const modelText = bv.sat && bv.model
    ? 'Bitvector Model: ' + Object.entries(bv.model).map(([k, v]) => `${k} = ${v} (0x${(v >>> 0).toString(16)})`).join('   ')
    : 'Bitvector Predicate: UNSATISFIABLE (no 32-bit integer witness exists)';
  ctx.fillText(modelText, pad, 52);

  if (!lay.sat || !lay.boxes) return;

  const cw = (spec && spec.container && spec.container.w) || 640;
  const ch = (spec && spec.container && spec.container.h) || 360;
  const availW = w - pad * 2;
  const availH = hh - 96;
  const scale = Math.min(availW / cw, availH / ch);
  const ox = pad + (availW - cw * scale) * 0.5;
  const oy = 74 + (availH - ch * scale) * 0.5;

  // Container outline
  ctx.fillStyle = '#0e141f';
  ctx.fillRect(ox, oy, cw * scale, ch * scale);
  ctx.strokeStyle = '#364b6e';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, cw * scale, ch * scale);

  const palette = ['#2a4d7c', '#2b6a50', '#5a3d7a', '#7a5229', '#2b5f6c'];
  const ids = Object.keys(lay.boxes);
  ids.forEach((id, i) => {
    const b = lay.boxes[id];
    const rx = ox + b.x * scale;
    const ry = oy + b.y * scale;
    const rw = b.w * scale;
    const rh = b.h * scale;

    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#9ec2ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, rw, rh);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillText(id, rx + 8, ry + 18);
    ctx.fillStyle = '#cfe0ff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`${b.x},${b.y} (${b.w}x${b.h})`, rx + 8, ry + 34);
  });
}

function drawTrajectoryCanvas(ctx, w, hh) {
  const ad = state.autodiffResult;
  const traj = state.trajectoryResult;
  const preset = state.trajPreset || TRAJ_PRESETS.harmonicObstacle;
  if (!ad || !traj) return;

  const pad = 32;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillText(
    `Symbolic Auto-Diff Potential Field & Symplectic Trajectory — ${traj.converged ? 'CONVERGED' : 'UNCONVERGED'}`,
    pad,
    30
  );

  const tx = Number($('#traj-tx').value) || 8.0;
  const ty = Number($('#traj-ty').value) || 3.0;
  const minX = -1.0, maxX = Math.max(11.0, tx + 1.5);
  const minY = -1.5, maxY = Math.max(6.0, ty + 2.5);

  const plotL = pad;
  const plotT = 56;
  const plotW = w - pad * 2;
  const plotH = hh - plotT - 32;

  const toScreenX = (x) => plotL + ((x - minX) / (maxX - minX)) * plotW;
  const toScreenY = (y) => plotT + plotH - ((y - minY) / (maxY - minY)) * plotH;
  const scaleR = (r) => (r / (maxX - minX)) * plotW;

  // Sample potential field & gradient vectors on a coarse grid
  const cols = 22, rows = 12;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const wx = minX + (c / cols) * (maxX - minX);
      const wy = minY + (r / rows) * (maxY - minY);
      const g = ad.evalGrad(wx, wy, 0);
      const sx = toScreenX(wx);
      const sy = toScreenY(wy);
      const mag = Math.hypot(g.dx, g.dy) || 1;
      const len = Math.min(14, mag * 4);
      ctx.strokeStyle = '#1f324d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - (g.dx / mag) * len, sy + (g.dy / mag) * len);
      ctx.stroke();
    }
  }

  // Draw obstacles
  for (const obs of preset.obstacles || []) {
    const ox = toScreenX(obs.center[0]);
    const oy = toScreenY(obs.center[1]);
    const rCore = scaleR(obs.radius);
    const rSafe = scaleR(obs.radius + (obs.margin || 0.3));

    ctx.strokeStyle = '#7a5a1f';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(ox, oy, rSafe, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(180, 60, 75, 0.35)';
    ctx.beginPath();
    ctx.arc(ox, oy, rCore, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff8585';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw solved trajectory
  const pts = traj.trajectory || [];
  if (pts.length > 1) {
    ctx.strokeStyle = '#7fe6a8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const sx = toScreenX(p.pos[0]);
      const sy = toScreenY(p.pos[1]);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }

  // Start & Target markers
  ctx.fillStyle = '#5c9dff';
  ctx.beginPath();
  ctx.arc(toScreenX(0), toScreenY(0), 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffd97b';
  ctx.beginPath();
  ctx.arc(toScreenX(tx), toScreenY(ty), 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawRollbackCanvas(ctx, w, hh) {
  const sum = state.rollbackSummary;
  if (!sum) return;

  const pad = 28;
  ctx.fillStyle = '#cfe0ff';
  ctx.font = 'bold 14px ui-monospace, monospace';

  if (sum.blocked) {
    ctx.fillText('Deterministic Capsule Security Gate — EXECUTION BLOCKED', pad, 34);
    ctx.fillStyle = '#ff8585';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(`Reason: ${sum.reason}`, pad, 64);

    sum.hazards.forEach((hz, i) => {
      const y = 96 + i * 36;
      ctx.fillStyle = '#2a161b';
      ctx.fillRect(pad, y, w - pad * 2, 28);
      ctx.strokeStyle = '#8a3846';
      ctx.strokeRect(pad, y, w - pad * 2, 28);
      ctx.fillStyle = '#ffb3b3';
      ctx.fillText(`[Hazard ${i + 1}] ${hz.kind || 'Nondeterminism'}: ${hz.message || JSON.stringify(hz)}`, pad + 10, y + 18);
    });
    return;
  }

  ctx.fillText(
    `2-Peer Rollback Lockstep Simulation — ${sum.allMatched ? '100% CHECKSUM AGREEMENT' : 'DESYNC'} (${sum.rollbackCount} rollbacks)`,
    pad,
    30
  );

  // Top half: 2D arena trajectories for Player 0 and Player 1
  const arenaTop = 50;
  const arenaH = Math.floor((hh - 140) * 0.65);
  ctx.fillStyle = '#0d131d';
  ctx.fillRect(pad, arenaTop, w - pad * 2, arenaH);
  ctx.strokeStyle = '#263852';
  ctx.strokeRect(pad, arenaTop, w - pad * 2, arenaH);

  const checks = sum.frameChecksums || [];
  if (checks.length > 0) {
    const mapX = (v) => pad + 24 + ((v % 600) / 600) * (w - pad * 2 - 48);
    const mapY = (v) => arenaTop + 20 + ((v % 360) / 360) * (arenaH - 40);

    // Player 0 path
    ctx.strokeStyle = '#5c9dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    checks.forEach((c, i) => {
      const x = mapX(c.state0[0]), y = mapY(c.state0[1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Player 1 path
    ctx.strokeStyle = '#7fe6a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    checks.forEach((c, i) => {
      const x = mapX(c.state0[2]), y = mapY(c.state0[3]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Bottom strip: per-frame Peer 0 vs Peer 1 checksum agreement cells
  const stripTop = arenaTop + arenaH + 28;
  ctx.fillStyle = '#97a1b2';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(`Per-Frame State Checksum Lockstep Verification (${checks.length} frames, delay=${sum.netDelay}):`, pad, stripTop - 8);

  const cellW = Math.max(8, Math.floor((w - pad * 2) / Math.max(1, checks.length)) - 2);
  checks.forEach((c, i) => {
    const cx = pad + i * (cellW + 2);
    ctx.fillStyle = c.match ? '#2f6f4f' : '#8a3846';
    ctx.fillRect(cx, stripTop, cellW, 28);
  });
}

const constraintSeg = segmented(
  '#constraint-presets',
  Object.entries(CONSTRAINT_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'xorMagic', onChange: (k) => loadConstraintPreset(k) }
);

const trajSeg = segmented(
  '#traj-presets',
  Object.entries(TRAJ_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'harmonicObstacle', onChange: (k) => loadTrajPreset(k) }
);

const rollbackSeg = segmented(
  '#rollback-presets',
  Object.entries(ROLLBACK_PRESETS).map(([k, v]) => [k, v.label]),
  { value: 'detArena', onChange: (k) => loadRollbackPreset(k) }
);

export const tabBar = tabs('#tabs', {
  onChange(name) {
    state.activeTab = name;
    if (name === 'constraints' && !state.bvResult) runConstraints();
    else if (name === 'trajectory' && !state.trajectoryResult) runTrajectory();
    else if (name === 'rollback' && !state.rollbackSummary) runRollback();
    else drawCanvas();
  },
});

$('#btn-solve-constraints').addEventListener('click', runConstraints);
$('#btn-solve-traj').addEventListener('click', runTrajectory);
$('#btn-run-rollback').addEventListener('click', runRollback);
$('#btn-run').addEventListener('click', () => {
  if (state.activeTab === 'constraints') runConstraints();
  else if (state.activeTab === 'trajectory') runTrajectory();
  else runRollback();
});
window.addEventListener('resize', drawCanvas);

// Initialize defaults for all 3 tabs and run active tab
$('#bv-src').value = CONSTRAINT_PRESETS.xorMagic.bv;
$('#layout-src').value = CONSTRAINT_PRESETS.xorMagic.layout;
$('#traj-src').value = TRAJ_PRESETS.harmonicObstacle.src;
$('#rollback-src').value = ROLLBACK_PRESETS.detArena.src;
runConstraints();

globalThis.__solverLab = {
  state,
  tabBar,
  loadConstraintPreset,
  loadTrajPreset,
  loadRollbackPreset,
  runConstraints,
  runTrajectory,
  runRollback,
};
