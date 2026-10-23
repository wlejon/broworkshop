// Headless unit test suite for Impossible Capabilities Studio (#151).
//
// Run with bro-headless:
//   bro-headless lib-tests lib-tests/test_impossible_studio.js
//   scripts/validate.sh --tests lib-tests/test_impossible_studio.js

import {
    runInverseProcedural,
    runDifferentiableTrajectory,
    runSelfHealingLiveCode,
    runAutonomousEvolution,
    runNeuroSymbolicCegis,
    runTrustlessP2PCapsule
} from "../impossible-studio/engines.js";

let tests = 0;
let failed = 0;

function t(name, fn) {
    tests++;
    try {
        fn();
        console.log("  ok   " + name);
    } catch (e) {
        failed++;
        console.log("  FAIL " + name + ": " + (e && e.message ? e.message : e));
        if (e && e.stack) console.log(e.stack);
    }
}

function truthy(v, msg) {
    if (!v) throw new Error(msg || "expected truthy");
}

t("1. Inverse Procedural World (solveProcedural): converges discrete SMT + continuous Auto-Diff params", () => {
    const res = runInverseProcedural();
    truthy(res.badgeOk, "inverse_world badgeOk");
    truthy(res.certHash && res.certHash.startsWith("0x"), "certificateHash present");
    truthy(res.viz.solvedParams.bridgeSpan === 24, "discrete SMT bridgeSpan == 24");
    truthy(res.viz.lossHistory[res.viz.lossHistory.length - 1] < 1e-3, "loss converged < 1e-3");
});

t("2. Differentiable Physics Trajectory (solveTrajectory): solves symplectic Leapfrog BVP to target", () => {
    const res = runDifferentiableTrajectory();
    truthy(res.badgeOk, "diff_physics badgeOk");
    const lastTraj = res.viz.trajectories[res.viz.trajectories.length - 1];
    truthy(lastTraj && lastTraj.errNorm < 1e-3, "terminal position error < 1e-3 (got " + (lastTraj && lastTraj.errNorm) + ")");
});

t("3. Self-Healing Live Code (live.createSupervisor): repairs div-by-zero, acos domain, and shift overflow", () => {
    const res = runSelfHealingLiveCode();
    truthy(res.badgeOk, "self_healing badgeOk");
    truthy(res.rewrittenCode.includes("Math.max(1e-12"), "zero-norm guard injected");
    truthy(res.rewrittenCode.includes("Math.min(1.0, Math.max(-1.0"), "acos clamp injected");
    truthy(res.rewrittenCode.includes(">>> 0"), "unsigned shift guard injected");
});

t("4. Autonomous Kernel Evolution (bro.evolve): promotes Gen 0 -> Gen 1 -> Gen 2 -> Gen 3 @kernel", () => {
    const res = runAutonomousEvolution();
    truthy(res.badgeOk, "auto_evolve badgeOk");
    truthy(res.viz.generations.length === 4, "4 evolutionary generations recorded");
    truthy(res.viz.generations[3].mops > res.viz.generations[0].mops * 5, "Gen 3 > 5x faster than Gen 0");
});

t("5. Neuro-Symbolic CEGIS (lm.synthesizeVerifiedFunction): refutes faulty drafts and proves 2^32 equivalence", () => {
    const res = runNeuroSymbolicCegis();
    truthy(res.badgeOk, "neuro_cegis badgeOk");
    truthy(res.viz.rounds.length === 3, "3 CEGIS rounds recorded");
    truthy(!res.viz.rounds[0].ok && !res.viz.rounds[1].ok && res.viz.rounds[2].ok, "Drafts 1 & 2 refuted, Draft 3 proven");
});

t("6. Trustless P2P Capsule (net.createVerifiedCapsule): admits deterministic capsule and quarantines RNG/Date.now", () => {
    const res = runTrustlessP2PCapsule();
    truthy(res.badgeOk, "p2p_capsule badgeOk");
    truthy(res.rewrittenCode.includes("VERIFIED_P2P_CAPSULE"), "trusted capsule verified");
    truthy(res.rewrittenCode.includes("QUARANTINED"), "malicious capsule quarantined");
});

console.log("\n" + (tests - failed) + "/" + tests + " passed");
if (failed > 0) throw new Error(failed + " test(s) failed");
