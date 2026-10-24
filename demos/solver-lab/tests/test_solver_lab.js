import { check, test, frames, clickOn, shot, done } from "/lib/kit/test.js";

frames(5);

const lab = globalThis.__solverLab;
check(lab && lab.state, "__solverLab exposed");

test("tab 1: bitvector SMT solver & declarative box layout solver", () => {
  const bv = lab.state.bvResult;
  const lay = lab.state.layoutResult;
  check(bv && bv.sat === true && bv.status === "sat", "xorMagic bitvector puzzle is SAT");
  const { x, y } = bv.model;
  check((x ^ y) === 42 && x + y === 170 && x < y, `witness satisfies xorMagic: x=${x}, y=${y}`);

  check(lay && lay.sat === true && lay.boxes, "HUD layout spec is SAT");
  check(lay.boxes.viewport.x >= lay.boxes.sidebar.right + 12, "viewport placed right of sidebar");
  check(lay.boxes.timeline.y >= lay.boxes.viewport.bottom + 12, "timeline placed below viewport");

  lab.loadConstraintPreset("unsatPuzzle");
  frames(2);
  check(lab.state.bvResult && lab.state.bvResult.sat === false && lab.state.bvResult.status === "unsat", "contradiction proven UNSAT");
});

test("tab 2: symbolic auto-diff potential field & symplectic trajectory solver", () => {
  clickOn("#tab-trajectory");
  frames(3);
  check(lab.state.activeTab === "trajectory", "switched to trajectory tab");

  const ad = lab.state.autodiffResult;
  const pf = lab.state.potentialField;
  const tr = lab.state.trajectoryResult;

  check(ad && ad.ok === true && ad.provenSafe === true, "autodiff compiled & proven safe");
  check(ad.cpuGpuProvenEquivalent === true && ad.spirvWordCount > 20, "CPU/GPU parity + SPIR-V generated");
  check(pf && pf.provenSafe === true, "potential field provenSafe");

  check(tr && tr.converged === true, "trajectory shooting solver converged");
  check(tr.missDistance < 1e-3, `missDistance < 1e-3 (got ${tr.missDistance})`);
  check(tr.energyInvariantVerified === true, "symplectic energy invariant verified");
  check(tr.obstacleFree === true && tr.minObstacleClearance > 0, "trajectory clears obstacle");
});

test("tab 3: verified capsule gate & 2-peer deterministic rollback lockstep", () => {
  clickOn("#tab-rollback");
  frames(3);
  check(lab.state.activeTab === "rollback", "switched to rollback tab");

  const ver = lab.state.verifyResult;
  const sum = lab.state.rollbackSummary;
  check(ver && ver.valid === true && ver.determinismLintPassed === true && ver.hazardFree === true, "detArena capsule verified");
  check(sum && sum.blocked === false, "detArena simulation ran");
  check(sum.determinismLintPassed === true && sum.desyncDetectionEnabled === true, "canonical session properties set");
  check(sum.rollbackCount > 0 && sum.resimFrames > 0, "delayed inputs triggered rollbacks & resimulation");
  check(sum.allMatched === true && sum.finalC0 === sum.finalC1, "both peers converged to identical state checksums");

  lab.loadRollbackPreset("hazardTick");
  frames(2);
  const badVer = lab.state.verifyResult;
  const badSum = lab.state.rollbackSummary;
  check(badVer && badVer.valid === false, "hazardTick capsule rejected");
  check(badVer.determinismLintPassed === false && badVer.hazardFree === false, "determinism lint flagged Math.random/Date.now");
  check(badSum && badSum.blocked === true && badSum.hazards.length >= 2, "execution blocked by capsule gate");
});

shot("solver-lab");
done("solver-lab");
