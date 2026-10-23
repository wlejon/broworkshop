// End-to-end UI & screenshot test for impossible-studio (#151).
import { test, check, frames, clickOn, text, done } from "/lib/kit/test.js";

frames(5);

test("Tab 1 (Inverse Procedural World) boots and renders contour field + convergence curve", () => {
    check(/INVERSE WORLD CONVERGED/.test(text("#proofBadge")), "badge shows INVERSE WORLD CONVERGED");
    check(/^0x[0-9a-f]{8,}/i.test(text("#certHash")), "certHash populated");
    check(document.querySelector("#rewrittenCode").value.includes("SOLVED_TERRAIN_PARAMS"), "solved terrain params shown");
});

test("Tab 2 (Differentiable Physics) solves symplectic Leapfrog BVP trajectory", () => {
    clickOn('.tab-pill[data-tab="diff_physics"]');
    frames(4);
    check(/TRAJECTORY SOLVED/.test(text("#proofBadge")), "badge shows TRAJECTORY SOLVED");
    check(document.querySelector("#rewrittenCode").value.includes("SOLVED_LAUNCH_VELOCITY"), "solved launch velocity shown");
    screenshot("/tmp/impossible_studio_verified.png");
});

test("Tab 3 (Self-Healing Live Code) repairs 3 crash hazards automatically", () => {
    clickOn('.tab-pill[data-tab="self_healing"]');
    frames(3);
    check(/AUTO-HEALED/.test(text("#proofBadge")), "badge shows AUTO-HEALED");
});

test("Tab 4 (Autonomous Kernel Evolution) evolves Gen 0 -> Gen 3 SPIR-V", () => {
    clickOn('.tab-pill[data-tab="auto_evolve"]');
    frames(3);
    check(/EVOLVED 4 GENERATIONS/.test(text("#proofBadge")), "badge shows EVOLVED 4 GENERATIONS");
});

test("Tab 5 (Neuro-Symbolic CEGIS) refutes 2 drafts and proves Draft 3 across 2^32 inputs", () => {
    clickOn('.tab-pill[data-tab="neuro_cegis"]');
    frames(3);
    check(/SYNTHESIZED & PROVEN/.test(text("#proofBadge")), "badge shows SYNTHESIZED & PROVEN");
});

test("Tab 6 (Trustless P2P Capsule) verifies trusted capsule and quarantines malicious peer", () => {
    clickOn('.tab-pill[data-tab="p2p_capsule"]');
    frames(3);
    check(/CAPSULE A VERIFIED/.test(text("#proofBadge")), "badge shows CAPSULE A VERIFIED");
});

test("Return to Tab 1 (Inverse Procedural World) for showcase screenshot", () => {
    clickOn('.tab-pill[data-tab="inverse_world"]');
    frames(4);
    screenshot("/tmp/impossible_studio_verified.png");
});

done("impossible-studio");
