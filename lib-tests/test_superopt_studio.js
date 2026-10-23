// Headless verification & unit test suite for Superoptimizer & Verified Rewriter Studio (#145).
//
// Run with bro-headless:
//   bro-headless lib-tests lib-tests/test_superopt_studio.js
//   scripts/validate.sh --tests lib-tests/test_superopt_studio.js

import { PRESETS } from "../superopt-studio/presets.js";
import { rewriteAndProve, autoKernelAndProve, buildCallableFromSource } from "../superopt-studio/rewriter.js";

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

function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || "eq") + ": " + a + " !== " + b);
}

// 1. Preset 1: Branchy Bit-Hacks (CEGIS Superoptimizer + SMT Proof)
t("Preset 1 (branchy_abs): CEGIS superoptimization + 2^32 SMT equivalence proof", () => {
    const p = PRESETS.branchy_abs;
    const rep = rewriteAndProve(p.code);
    truthy(rep.allProvenEquivalent, "branchy_abs must be proven equivalent");
    truthy(rep.certificateHash && rep.certificateHash.startsWith("0x"), "certificateHash present");
    truthy(rep.rewrites.length >= 1, "at least 1 rewrite pass applied");

    const fnOrig = buildCallableFromSource(p.code);
    const fnOpt = buildCallableFromSource(rep.rewrittenSource);
    truthy(fnOrig && fnOpt, "both original and rewritten functions compile");
    for (const v of [-2147483647, -1024, -1, 0, 1, 42, 1024, 2147483647]) {
        eq(fnOpt(v) | 0, fnOrig(v) | 0, "runtime equivalence at x=" + v);
    }
});

// 2. Preset 2: Polymorphic Math & Defensive Guard Soup (Dead Guard + Strength Reduction + Horner)
t("Preset 2 (poly_soup): dead-guard elimination, strength reduction, and Horner polynomial rewrite", () => {
    const p = PRESETS.poly_soup;
    const rep = rewriteAndProve(p.code);
    truthy(rep.allProvenEquivalent, "poly_soup must be proven equivalent");
    truthy(rep.bytesAfter < rep.bytesBefore, "poly_soup reduces code size (" + rep.bytesBefore + " -> " + rep.bytesAfter + ")");
    truthy(rep.opsAfter < rep.opsBefore, "poly_soup reduces IR ops (" + rep.opsBefore + " -> " + rep.opsAfter + ")");
    truthy(!rep.rewrittenSource.includes("Math.pow"), "Math.pow eliminated by Horner rewrite");

    const fnOrig = buildCallableFromSource(p.code);
    const fnOpt = buildCallableFromSource(rep.rewrittenSource);
    for (let x = -50; x <= 300; x += 17) {
        eq(fnOpt(x) | 0, fnOrig(x) | 0, "poly_soup equivalence at x=" + x);
    }
});

// 3. Preset 3: Allocation-Heavy .map().filter().reduce() Pipeline Deforestation
t("Preset 3 (deforest): .map().filter().reduce() fused into single zero-allocation loop", () => {
    const p = PRESETS.deforest;
    const rep = rewriteAndProve(p.code);
    truthy(rep.allProvenEquivalent, "deforest must be proven equivalent");
    truthy(!rep.rewrittenSource.includes(".map(") && !rep.rewrittenSource.includes(".filter("),
        "intermediate .map/.filter allocations eliminated");

    const fnOrig = buildCallableFromSource(p.code);
    const fnOpt = buildCallableFromSource(rep.rewrittenSource);
    eq(fnOpt(p.benchArray), fnOrig(p.benchArray), "deforested loop matches array pipeline result");
});

// 4. Preset 4: Sequential Loop -> Parallel @kernel + Vulkan SPIR-V
t("Preset 4 (auto_kernel): SMT proves loop race-free (WAW/RAW/WAR UNSAT) and lowers @kernel + SPIR-V", () => {
    const p = PRESETS.auto_kernel;
    const ak = autoKernelAndProve(p.code);
    truthy(ak.parallelizable, "saxpy loop must be proven parallelizable");
    truthy(ak.certificateHash && ak.certificateHash.startsWith("0x"), "certificateHash present");
    truthy(ak.kernelSource.includes("@kernel"), "synthesized source has @kernel directive");
});

// 5. Preset 5: Loop-Carried Hazard Trap (Prefix Sum)
t("Preset 5 (hazard_trap): SMT catches loop-carried RAW dependency at (i1=0, i2=1) and blocks parallelization", () => {
    const p = PRESETS.hazard_trap;
    const ak = autoKernelAndProve(p.code);
    truthy(!ak.parallelizable, "prefixSum must be refuted for parallelization");
    truthy(ak.hazards && ak.hazards.length >= 1, "at least 1 loop-carried hazard witness reported");
    eq(ak.hazards[0].hazardKind, "RAW", "hazard kind is RAW");
});

console.log("\n" + (tests - failed) + "/" + tests + " passed");
if (failed > 0) throw new Error(failed + " test(s) failed");
