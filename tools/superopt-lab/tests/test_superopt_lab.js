import { check, test, frames, clickOn, text, shot, done } from "/lib/kit/test.js";

frames(5);

const lab = globalThis.__superoptLab;
check(lab && lab.state, "__superoptLab exposed");

test("tab 1: equivalence prover & symbolic fuzzer (proven equivalent preset)", () => {
  const pr = lab.state.proveResult;
  const fz = lab.state.fuzzResult;
  check(pr && pr.equivalent === true, "absFixed should be proven equivalent");
  check(typeof pr.proofHash === "string" && pr.proofHash.length >= 16, "proofHash populated");
  check(fz && fz.feasiblePaths >= 1, "fuzz feasiblePaths >= 1");
  check(text("#prove-out").includes("UNSAT"), "prove output shows UNSAT");
});

test("tab 1: equivalence prover finds INT32_MIN counterexample on absBug", () => {
  lab.loadProvePreset("absBug");
  frames(2);
  const pr = lab.state.proveResult;
  check(pr && pr.equivalent === false, "absBug must not be equivalent");
  check(pr.counterexample && Array.isArray(pr.counterexample.args), "counterexample witness present");
  check(pr.counterexample.args[0] === -2147483648, "witness is INT32_MIN (-2147483648)");
  check(text("#prove-out").includes("COUNTEREXAMPLE"), "prove readout shows counterexample");
});

test("tab 2: superoptimizer & guard rewriter + 100k microbenchmark", () => {
  clickOn("#tab-superopt");
  frames(3);
  check(lab.state.activeTab === "superopt", "switched to superopt tab");
  const sup = lab.state.superoptResult;
  const b = lab.state.benchResult;
  check(sup && sup.verified === true && sup.optimized === true, "branchyAbs synthesized");
  check(sup.stats.costAfter < sup.stats.costBefore, "AST cost reduced");
  check(b && b.parityOk === true && b.origMs > 0 && b.optMs > 0, "microbenchmark ran and verified parity");

  lab.loadSuperoptPreset("polySoup");
  frames(2);
  const rew = lab.state.rewriteResult;
  check(rew && rew.allProvenEquivalent === true, "polySoup rewrites proven equivalent");
  check(Array.isArray(rew.rewrites) && rew.rewrites.length >= 2, "multiple rewrite rules applied");
  check(rew.estimatedOpsAfter < rew.estimatedOpsBefore, "estimated ops reduced");
});

test("tab 3: auto-kernel parallelizer (parallel SAXPY vs RAW hazard prefixSum)", () => {
  clickOn("#tab-autokernel");
  frames(3);
  check(lab.state.activeTab === "autokernel", "switched to autokernel tab");
  const ak1 = lab.state.kernelResult;
  check(ak1 && ak1.parallelizable === true, "saxpy proven parallelizable");
  check(ak1.provenNoRaw && ak1.provenNoWaw && ak1.provenNoWar && ak1.provenInBounds, "all dependence flags true");
  check(typeof ak1.kernelSource === "string" && ak1.kernelSource.includes("@kernel"), "GPU @kernel source generated");
  check(ak1.kernel !== null && typeof ak1.kernel === "object", "compiled GPU @kernel object attached");

  lab.loadKernelPreset("prefixSum");
  frames(2);
  const ak2 = lab.state.kernelResult;
  check(ak2 && ak2.parallelizable === false, "prefixSum rejected as non-parallelizable");
  check(ak2.provenNoRaw === false, "RAW hazard flagged");
  check(Array.isArray(ak2.hazards) && ak2.hazards.length >= 1, "hazards array populated");
  check(ak2.hazards[0].hazardKind === "RAW", "hazardKind is RAW");
});

shot("superopt-lab");
done("superopt-lab");
