// Tumble campaign: every level clears with its verified layout (solutions.js),
// and Plank Walk still fails on an empty board (the first skill gate).
import { test, done, check, eq, frames, simUntil } from "/lib/kit/test.js";

frames(6);
const T = window.__tumble;
check(T && T.SOLUTIONS.length === T.LEVELS.length, "a solution per level");

function freshLevel(idx) {
    T.resetProgress();
    T.unlockAll();
    T.startLevel(idx);
    frames(4);
    eq(T.run.levelIdx, idx, "level " + idx + " loaded");
}

const results = [];

T.SOLUTIONS.forEach((sol, i) => {
    test("L" + (i + 1) + " " + sol.name, () => {
        freshLevel(i);
        eq(sol.id, T.run.level.id, "solution matches level");
        const applied = T.applySolution(i);
        eq([applied.placed, applied.skipped], [sol.pieces.length, 0], "every piece placed");
        T.enterRun();
        check(simUntil(() => T.screen === "complete", 20000), "clears: " + sol.note);
        const t = T.run.resultMs / 1000;
        results.push(sol.name + " " + t.toFixed(2) + "s " + T.medalFor(t, T.run.level));
    });
});

test("empty Plank Walk fails (skill gate)", () => {
    freshLevel(1);
    T.enterRun();
    check(simUntil(() => T.snapshot().mode === "build", 20000), "falls back to build");
    check(T.screen === "playing", "no clear");
});

console.log("[campaign] " + results.join(" | "));
done("tumble campaign");
