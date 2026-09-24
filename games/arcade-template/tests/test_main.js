// Template tests: the rules directly, then the shell flow through real key
// presses. Keep both halves when you copy the template: rules tests pin the
// game's logic, shell tests prove the screens and HUD are wired.
// Run: scripts/validate.sh games/arcade-template
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";

frames(6);
const G = window["__arcade-template"];     // window.__<game.id>, from main.js
check(G, "hooks exposed");
const R = G.rules;

test("rules: tapping scores, time runs out", () => {
    const f = R.createField();
    R.tap(f);
    R.tap(f);
    eq(f.score, 2, "two taps");
    R.step(f, R.ROUND_MS);
    check(f.over, "round over");
    R.tap(f);
    eq(f.score, 2, "no score after time");
    eq(R.drainEvents(f).map((e) => e.type), ["score", "score", "timeup"], "events");
});

test("rules: the square stays inside the field", () => {
    const f = R.createField();
    for (let t = 0; t < 30000; t += 16) {
        R.step(f, 16);
        check(f.x > 0 && f.x < 1 && f.y > 0 && f.y < 1, "inside at " + t);
    }
});

test("shell: title -> play -> HUD -> pause", () => {
    eq(G.screen, "title", "boots to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    press(" ");
    frames(2);
    eq(text("#hud-score"), "1", "Space scores");
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: time up -> game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    G.run.field.elapsed = R.ROUND_MS - 100;
    check(simUntil(() => G.screen === "gameover", 1000, 16), "game over");
    check(/Score\s+1\s+·\s+NEW BEST/.test(text("#gameover-stats")), "NEW BEST shown");
    eq(G.save.highScore(), 1, "high score saved");
});

done("arcade-template");
