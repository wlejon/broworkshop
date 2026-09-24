// Tumble gameplay: placement rules, coach, win / fail flow, progression,
// keyboard controls, and mouse building through the engine's input path.
import { test, done, check, eq, frames, simUntil, press, q, text, shot } from "/lib/kit/test.js";

frames(6);
const T = window.__tumble;
check(T, "__tumble hooks exposed");

/** Run the current level until it clears or falls back to build. */
function runToEnd(virtualMs) {
    T.enterRun();
    let sawRun = false;
    simUntil(() => {
        if (T.snapshot().mode === "run") sawRun = true;
        return T.screen === "complete" || (sawRun && T.snapshot().mode === "build");
    }, virtualMs || 15000);
    return T.screen === "complete" ? "complete" : "fail";
}

function start(idx) {
    T.startLevel(idx);
    frames(4);
    check(T.screen === "playing" && T.run.levelIdx === idx, "level " + idx + " playing");
}

test("campaign shape", () => {
    eq(T.LEVELS.length, 8, "levels");
    eq(T.LEVELS.map((l) => l.id), ["drop-in", "plank", "bank", "bounce", "chute", "conveyor", "spin", "gauntlet"], "order");
});

test("Drop-In: placement rules and coach", () => {
    T.resetProgress();
    start(0);
    check(q("#hud-action").classList.contains("coach-mode"), "coach shows on a fresh Drop-In");
    check(/Tip 1 \/ 3/.test(text("#hud-action-kicker")), "tip 1 of 3");
    check(T.place("block", 2, 0, 2), "place ok");
    check(!T.place("block", 2, 0, 2), "duplicate cell rejected");
    check(!T.place("block", 99, 0, 99), "out of bounds rejected");
    check(!T.place("block", 0, 5, 0), "spout cell reserved");
    check(!T.place("booster", -1, 0, -1), "type without budget rejected");
    frames(1);
    check(/Tip 2 \/ 3/.test(text("#hud-action-kicker")), "placing advances the coach");
    eq(text("#hud-budget"), "1 / 5", "budget HUD");
    check(T.removeAt(2, 0, 2), "remove ok");
    frames(1);
    eq(text("#hud-budget"), "0 / 5", "budget refunded");
    shot("build-empty");
});

test("Drop-In: free-fall clears and unlocks Plank Walk", () => {
    eq(runToEnd(8000), "complete", "Drop-In clears with no pieces");
    const s = T.snapshot();
    check(s.unlocked >= 2 && s.best["drop-in"] != null && s.coachDone, "best + unlock + coach saved");
    check(/Plank Walk/.test(text("#complete-next")), "complete names the next level");
    eq(q("#complete-primary").getAttribute("data-action"), "next", "primary is Next Level");
    check(!q("#complete-menu-item").hidden, "Main Menu offered");
    check(!q("#complete-newbest").hidden, "first clear is a new best");
    shot("complete-dropin");
});

test("Plank Walk: coach, empty run fails, booster runway wins", () => {
    start(1);
    check(/Booster/.test(text("#hud-action-text")), "plank coach teaches boosters: " + text("#hud-action-text"));
    eq(T.snapshot().selected, "booster", "booster preselected on a path level");
    eq(T.snapshot().rot, 0, "booster aimed at the cup (+X)");
    eq(runToEnd(20000), "fail", "empty Plank Walk fails back to build");
    check(T.snapshot().marblesAlive === 0, "no marbles left after a fail");
    start(1);
    const applied = T.applySolution(1);
    check(applied.placed === 3 && applied.skipped === 0, "solution places 3 boosters");
    shot("plank-runway");
    eq(runToEnd(15000), "complete", "booster runway clears Plank Walk");
    check(T.snapshot().unlocked >= 3, "unlocks Bank Shot");
});

test("restart after complete is stable", () => {
    start(0);
    eq(runToEnd(8000), "complete", "second Drop-In clear");
    start(0);
    eq(T.snapshot().placed, 0, "fresh board");
    eq(T.snapshot().marblesAlive, 0, "no leftover marbles");
});

test("progression tour and level select", () => {
    T.resetProgress();
    for (let i = 0; i < T.LEVELS.length; i++) {
        start(i);
        check(T.forceComplete(2000 + i * 150), "force L" + i);
        frames(2);
        eq(T.screen, "complete", "complete L" + i);
        const last = i === T.LEVELS.length - 1;
        eq(q("#complete-primary").getAttribute("data-action"), last ? "title" : "next", "primary action L" + i);
        if (last) {
            check(/Tour complete/.test(text("#complete-next")), "tour copy");
            check(q("#complete-menu-item").hidden && q("#complete-menu-item").classList.contains("disabled"),
                "duplicate Main Menu hidden and skipped");
        } else {
            check(text("#complete-next").indexOf(T.LEVELS[i + 1].name) >= 0, "names " + T.LEVELS[i + 1].name);
        }
    }
    eq(Object.keys(T.save.get("best")).length, 8, "8 best times");
    T.shell.switchTo("levels");
    frames(2);
    const grid = q("#levels-grid");
    eq(grid.querySelectorAll(".locked").length, 0, "all unlocked");
    const golds = T.LEVELS.filter((lv, i) => T.medalFor((2000 + i * 150) / 1000, lv) === "gold").length;
    eq(grid.querySelectorAll(".medal-gold").length, golds, "gold medal tiles");
    shot("level-select");
    T.shell.switchTo("title");
    frames(2);
    check(new RegExp("^8 / 8 cleared · " + golds + " gold").test(text("#title-progress")),
        "title summary: " + text("#title-progress"));
});

test("keyboard controls", () => {
    start(3); // Springboard: block, ramp, wall, bumper, booster
    press(" ");
    frames(2);
    eq(T.snapshot().mode, "run", "Space runs");
    press(" ");
    frames(2);
    eq(T.snapshot().mode, "build", "Space rebuilds");
    press("2");
    frames(2);
    eq(T.snapshot().selected, "ramp", "key 2 selects the second piece");
    check(q("#hud-palette .palette-item.selected").getAttribute("data-piece") === "ramp", "palette follows");
    const rot = T.snapshot().rot;
    press("r");
    frames(2);
    eq(T.snapshot().rot, (rot + 1) & 3, "R rotates");
    press("e");
    frames(2);
    eq(T.snapshot().layer, 1, "E raises the build layer");
    press("q");
    press("q");
    frames(2);
    eq(T.snapshot().layer, 0, "Q lowers, clamped at the floor");
    check(T.place("ramp", -2, 1, 0, 1), "place on an upper layer");
});

test("camera: right-drag orbits without removing pieces, wheel zooms", () => {
    start(3);
    check(T.place("block", 3, 0, 2), "a piece to keep");
    const r = q("#view").getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const before = T.cam.pos.slice();
    mouseDown(cx, cy, 2);
    for (let i = 1; i <= 6; i++) mouseMove(cx + i * 15, cy);
    mouseUp(cx + 90, cy, 2);
    frames(2);
    eq(T.snapshot().placed, 1, "right-drag does not remove");
    check(T.cam.pos.some((v, i) => Math.abs(v - before[i]) > 1e-3), "right-drag orbited the camera");
    const dist = T.cam.dist;
    wheel(cx, cy, 3);
    frames(2);
    check(T.cam.dist !== dist && T.cam.dist >= 4 && T.cam.dist <= 60, "wheel zooms within 4..60");
});

test("marbles fall under physics", () => {
    start(0);
    T.enterRun();
    check(simUntil(() => {
        const m = T.snapshot().marbles;
        return m.length && m[0].y < 4.5;
    }, 3000), "marble falls");
    shot("running");
});

done("tumble gameplay");
