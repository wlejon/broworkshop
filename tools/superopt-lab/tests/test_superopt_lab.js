import { check, test, frames, clickOn, shot, done } from "/lib/kit/test.js";

frames(5);

const lab = globalThis.__superoptLab;
check(lab && lab.state && lab.panes, "__superoptLab exposed");
const failedChecks = (sel) => document.querySelectorAll(sel + " .k-check.fail").length;

test("prove: a one-in-4-billion counterexample, an overflow plane, an equivalence and round trips", () => {
  const p = lab.state.prove;
  check(p.result && p.cex && p.cex[0] === -2147483648, `abs counterexample is INT32_MIN (got ${p.cex})`);
  check(failedChecks("#prove-checks") === 0, "the page reproduces it");
  frames(2);
  shot("prove");

  lab.panes.prove.load("avg");
  check(p.cex && p.cex.length === 2, `average overflow has a two-argument counterexample (${p.cex})`);
  const [x, y] = p.cex;
  check(((x & y) + ((x ^ y) >> 1)) !== ((x + y) >> 1), "the two averages differ there");
  check(p.map.bad.reduce((s, v) => s + v, 0) > 50000, "random inputs find the overflow region too");
  frames(2);
  shot("prove-avg");

  lab.panes.prove.load("absBranchless");
  check(!p.cex && failedChecks("#prove-checks") === 0, "branchless abs proven equal, and every page check agrees");

  lab.panes.prove.load("codec");
  check(!p.cex && failedChecks("#prove-checks") === 0, "the XOR codec round-trips");
  lab.panes.prove.load("codecBug");
  check(p.cex && ((((p.cex[0] * 3) | 0) / 3) | 0) !== p.cex[0], `times-3 codec fails at ${p.cex}`);
});

test("fuzz: path inputs replay, hazard witnesses reproduce, random testing misses them", () => {
  clickOn("#tab-fuzz");
  frames(3);
  const f = lab.state.fuzz;
  check(f.vectors.length >= 3 && f.vectors.every((v) => v.ok), `${f.vectors.length} path inputs replay on the page`);
  check(f.vectors.some((v) => v.args[0] === 0x1337BEEF), "the magic branch is reached");
  const kinds = new Set(f.hazards.map((h) => h.kind));
  check(kinds.has("div-by-zero") && kinds.has("out-of-bounds"), `hazards: ${[...kinds].join(", ")}`);
  check(f.hazards.every((h) => h.symptom), "every witness shows its symptom on the page");
  check(failedChecks("#fuzz-checks") === 0, "no page check fails");
  frames(2);
  shot("fuzz");

  lab.panes.fuzz.load("clamp");
  check(f.hazards.length === 0 && f.random.hits === 0, "saturating add: no hazards, none at random either");
});

test("superoptimize: a synthesized one-liner and proven rewrites, both agreeing on the page", () => {
  clickOn("#tab-superopt");
  frames(3);
  const s = lab.state.superopt;
  check(s.sup && s.sup.optimized && s.sup.stats.costAfter < s.sup.stats.costBefore, "sign(x) synthesized cheaper");
  check(s.parity && s.parity.diffs === 0 && s.parity.tried > 500000, "the page agrees on every input it tries");
  check(document.querySelectorAll("#so-view .so-code").length === 2, "before and after shown");
  frames(2);
  shot("superopt");

  lab.panes.superopt.load("tile");
  check(s.rew.rewrites.length >= 2 && s.rew.allProvenEquivalent, "tile rewrites proven");
  check(s.parity.diffs === 0, "rewritten tile agrees on the page");
  check(failedChecks("#so-checks") === 0, "no page check fails");
  frames(2);
  shot("superopt-rewrite");
});

done("superopt-lab");
