// End-to-end UI & screenshot test for superopt-studio (#145).
import { test, check, frames, setValue, clickOn, text, done } from "/lib/kit/test.js";

frames(5);

test("boots with Preset 1 proven equivalent and populated metrics", () => {
    check(/PROVEN EQUIVALENT/.test(text("#proofBadge")), "proof badge shows PROVEN EQUIVALENT");
    check(/^0x[0-9a-f]{8,}/i.test(text("#certHash")), "certHash populated");
    check(document.querySelector("#rewrittenCode").value.length > 10, "rewrittenCode populated");
});

test("Preset 2 (Guard & Polymorphic Math Soup) shrinks code size and ops", () => {
    setValue("#presetSelect", "poly_soup");
    frames(4);
    check(/PROVEN EQUIVALENT/.test(text("#proofBadge")), "poly_soup proven equivalent");
    check(/smaller/.test(text("#metricBytesDelta")), "bytes delta shows reduction");
    screenshot("/tmp/superopt_studio_verified.png");
});

test("Preset 3 (Array Deforestation) fuses .map().filter().reduce()", () => {
    setValue("#presetSelect", "deforest");
    frames(3);
    check(/PROVEN EQUIVALENT/.test(text("#proofBadge")), "deforest proven equivalent");
    const out = document.querySelector("#rewrittenCode").value;
    check(out.includes("for ("), "fused loop generated");
});

test("Preset 4 (Sequential Loop -> Parallel @kernel + SPIR-V) proves WAW/RAW/WAR UNSAT", () => {
    setValue("#presetSelect", "auto_kernel");
    frames(3);
    check(/PROVEN RACE-FREE/.test(text("#proofBadge")), "auto_kernel badge shows PROVEN RACE-FREE");
    const out = document.querySelector("#rewrittenCode").value;
    check(out.includes("@kernel"), "synthesized @kernel source");
});

test("Preset 5 (Loop-Carried Hazard Trap) catches RAW witness and guards parallelization", () => {
    setValue("#presetSelect", "hazard_trap");
    frames(3);
    check(/HAZARD REFUTED/.test(text("#proofBadge")), "hazard_trap badge shows HAZARD REFUTED");
    check(/RAW witness/.test(text("#metricCegis")), "RAW witness displayed in telemetry");
});

test("Preset 2 final studio state for visual showcase", () => {
    clickOn('.preset-pill[data-preset="poly_soup"]');
    frames(4);
    screenshot("/tmp/superopt_studio_verified.png");
});

done("superopt-studio");
