import { check, test, frames, clickOn, setValue, waitFor, shot, done } from "/lib/kit/test.js";

frames(5);

const lab = globalThis.__solverLab;
check(lab && lab.state && lab.panes, "__solverLab exposed");
const failedChecks = (sel) => document.querySelectorAll(sel + " .k-check.fail").length;

test("solve: a witness, a hash preimage, a whole set and a proven contradiction", () => {
  const s = lab.state.solve;
  check(s.result && s.result.sat, "xorSum is SAT");
  const [x, y] = s.result.args;
  check((x ^ y) === 42 && x + y === 170 && x < y, `witness satisfies xorSum: x=${x}, y=${y}`);
  frames(2);
  shot("solve");

  lab.panes.solve.load("hash");
  check(s.result.sat && ((Math.imul(s.result.args[0], 0x9E3779B1) >>> 16) === 0xBEEF), "hash preimage found and re-hashes to 0xBEEF");
  check(failedChecks("#solve-checks") === 0, "no page check fails on the preimage");
  frames(2);
  shot("solve-hash");

  lab.panes.solve.load("triple");
  const [a, b, c] = s.result.args;
  check(s.result.sat && a * a + b * b === c * c && a > 20 && a < b, `Pythagorean triple (${a}, ${b}, ${c})`);
  check(failedChecks("#solve-checks") === 0, "the page's brute force over every triple agrees");

  lab.panes.solve.load("sierpinski");
  check(s.all && s.all.length === 729, `solveAll enumerates all 729 Sierpinski points (got ${s.all && s.all.length})`);
  check(s.truth && s.truth.size === 729, "the page's brute force agrees on 729");
  check(failedChecks("#solve-checks") === 0, "no page check fails");
  frames(2);
  shot("solve-set");

  lab.panes.solve.load("none");
  check(s.result && !s.result.sat, "odd square never even: UNSAT");
});

test("layout: solved, resized live, infeasible until wide enough", () => {
  clickOn("#tab-layout");
  frames(3);
  const st = lab.state.layout;
  const b = st.result.boxes;
  check(st.result.sat, "editor shell is SAT");
  check(b.viewport.x === b.sidebar.right + 12 && b.inspector.right === 960 - 12, "viewport after the sidebar, inspector at the right edge");
  check(b.inspector.w >= 180 && b.inspector.w <= 320 && 3 * b.inspector.w >= b.viewport.w, "inspector within its range");
  check(failedChecks("#layout-checks") === 0, "every constraint holds by the page's evaluation");
  check(document.querySelectorAll("#layout-view .lbox").length === 5, "five boxes rendered as elements");
  shot("layout");

  const before = b.viewport.w;
  setValue("#layout-cw", 1200);
  check(st.result.sat && st.result.boxes.viewport.w > before, "wider container, wider viewport");

  lab.panes.layout.load("tight");
  check(!st.result.sat, "two 300 px panels do not fit in 560 px");
  setValue("#layout-cw", 704);
  check(st.result.sat, "they fit at 704 px");
});

test("lockstep: late inputs, rollbacks, same confirmed state; the gate rejects bad capsules", () => {
  clickOn("#tab-lockstep");
  frames(3);
  const l = lab.state.lockstep;
  check(l.verifyResult && l.verifyResult.valid, "arena capsule verified");
  const s = l.sim;
  check(s && s.rollbacks[0] + s.rollbacks[1] > 0 && s.resim > 0, "late inputs caused rollbacks");
  check(s.wrong[0].some(Boolean) || s.wrong[1].some(Boolean), "some live views were wrong while inputs were in flight");
  check(s.confirmed.every(Boolean), "every confirmed frame matches");
  const truth = s.truth[s.frames - 1];
  check(s.final.every((st) => st.every((v, i) => v === truth[i])), "both peers end on the page's replay");
  waitFor(() => l.digest && l.digest.ok === true, "the page's SHA-256 matches", 5000);
  // Stop on a frame where a live view is wrong, so the shot shows a misprediction.
  let k = 40;
  while (k < s.frames - 1 && !(s.wrong[0][k] || s.wrong[1][k])) k++;
  setValue("#lock-frame", k);
  check(!l.playing && l.frame === k, `scrubbed to frame ${k}`);
  frames(2);
  shot("lockstep");

  setValue("#lock-tamper", true);
  check(l.verifyResult && !l.verifyResult.valid && l.verifyResult.tampered, "tampered capsule rejected");
  setValue("#lock-tamper", false);

  lab.panes.lockstep.load("hazard");
  const kinds = new Set((l.verifyResult.hazards || []).map((h) => h.kind));
  check(!l.verifyResult.valid && kinds.has("unseeded-prng") && kinds.has("wall-clock-time"), `hazards flagged: ${[...kinds].join(", ")}`);
  check(!l.sim, "no session ran the rejected tick");
  frames(2);
  shot("lockstep-rejected");
});

done("solver-lab");
