// Pegbounce: scoring rules, physics (shots, predict parity, guides), the
// level / guide menus, a full shot, level clear + unlock, level fail, and
// settings. Run: scripts/validate.sh games/pegbounce
import { test, done, check, eq, near, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";

frames(6);
const PB = window.__pegbounce;
check(PB, "__pegbounce hooks exposed");
const R = PB.rules;
const P = PB.Physics;

// A clean save, so earlier runs do not change what is unlocked.
PB.save.set("unlocked", 1);
PB.save.set("best", {});
PB.save.set("stars", {});
PB.save.set("highScore", 0);
PB.save.set("trajectory", true);
PB.save.set("screenshake", true);
PB.save.set("selectedGuide", "wingtip");
PB.save.set("sfxVol", 80);
PB.menu.guideId = "wingtip";

/** Step a live-less world at 1/180 s until its ball is gone; returns orange hits. */
function dropThrough(w, angle, x, y) {
    P.launchBall(w, angle, 820, x, y);
    let oranges = 0;
    for (let t = 0; P.hasActiveBall(w) && t < 8; t += 1 / 180) {
        P.step(w, 1 / 180);
        P.markLitFromEvents(w, w.scoreEvents);
        for (const e of w.scoreEvents) {
            if (e.kind === "peg-hit" && e.peg.type === "orange" && !e.peg._seen) { e.peg._seen = true; oranges++; }
        }
        w.scoreEvents.length = 0;
    }
    return oranges;
}

function startLevel(i) {
    PB.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="levels"]');
    clickOn("#level-tile-" + i);
    eq(PB.screen, "guide", "level tile opens the guide screen");
    clickOn('#screen-guide [data-action="startlevel"]');
    frames(2);
    check(PB.screen === "playing" && PB.round.levelIdx === i, "level " + (i + 1) + " started");
}

const shotDone = () => simUntil(() => !PB.round.shotInProgress, 15000, 16);

test("rules: multiplier tiers, stars, aim clamp", () => {
    eq([0, 2, 3, 6, 10, 15].map((n) => R.comboMult(n, 0)), [1, 1, 2, 3, 5, 10], "orange tiers");
    eq([5, 6, 12, 20, 30].map((n) => R.comboMult(0, n)), [1, 2, 3, 5, 10], "hit-count tiers");
    eq(R.shotMult(3, 0, true), 4, "purple doubles");
    eq(R.starCount(3000, [1500, 3000, 6000]), 2, "two stars");
    eq(R.starString(1), "★☆☆", "star string");
    near(R.clampAim(-1), R.AIM_MIN, 1e-9, "aim clamps right");
    near(R.clampAim(4), Math.PI - R.AIM_MIN, 1e-9, "aim clamps left");
});

test("levels: 20 levels, 5 guides, every level has oranges", () => {
    check(PB.Levels.LEVELS.length >= 20, "20 levels");
    eq(PB.Guides.GUIDES.length, 5, "5 guides");
    PB.Levels.LEVELS.forEach((lv, i) => {
        const w = PB.Levels.buildLevel(i, 42);
        check(P.countRemainingOrange(w) > 0, "level " + (i + 1) + " has an orange peg");
        P.destroyWorld(w);
    });
});

test("physics: shots hit pegs; a dense wedge clears several oranges", () => {
    let any = false;
    for (const a of [0.9, 1.05, 1.2, 1.35, 1.5, 1.65, 1.8, 1.95, 2.1]) {
        const r = PB.simulateShot(0, a, 12345);
        if (r.shotScore > 0) any = true;
        check(r.elapsed < 12, "shot at " + a + " ends");
    }
    check(any, "some angle scores on level 1");

    const w = P.createWorld(1);
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 10; c++) P.addPeg(w, 300 + (r & 1 ? 14 : 0) + c * 28, 200 + r * 30, P.PEG.ORANGE);
    }
    const oranges = dropThrough(w, Math.PI / 2, 512, 64);
    P.destroyWorld(w);
    check(oranges >= 2, "wedge clears >= 2 oranges, got " + oranges);
});

test("physics: Mirage predict matches the live ball", () => {
    const w = P.createWorld(1);
    const angle = (75 * Math.PI) / 180;
    P.launchBall(w, angle, 820, 600, 80);
    const live = [];
    for (let i = 0; i < 240 && P.hasActiveBall(w); i++) {
        P.step(w, 1 / 120);
        if (i % 12 === 0 && w.ball.active) live.push({ x: w.ball.x, y: w.ball.y });
    }
    const pred = [];
    P.predict(w, angle, 820, 600, 80, 2.0, pred);
    P.destroyWorld(w);
    check(live.length > 4 && pred.length > 4, "both produced samples");
    // predict samples every 3 steps, live every 12: every 4th prediction pairs up.
    let drift = 0;
    for (let i = 0; i < Math.min(live.length, Math.floor(pred.length / 4)); i++) {
        drift = Math.max(drift, Math.abs(pred[i * 4].x - live[i].x), Math.abs(pred[i * 4].y - live[i].y));
    }
    check(drift < 1, "predict within 1 px of live, drift " + drift.toFixed(2));
});

test("guides: each green-peg ability changes the world", () => {
    const setup = () => {
        const w = P.createWorld(1);
        const green = P.addPeg(w, 512, 400, P.PEG.GREEN);
        P.addPeg(w, 512 + 100, 400, P.PEG.BLUE);
        P.launchBall(w, Math.PI / 2, 820, 512, 300);
        return { w, green };
    };
    const G = (id) => PB.Guides.byId(id);

    let s = setup();
    const before = s.w.pegs.length;
    G("wingtip").trigger(s.w, s.green);
    check(s.w.pegs.length > before, "wingtip adds pegs");
    P.destroyWorld(s.w);

    s = setup();
    G("terraflame").trigger(s.w, s.green);
    check(s.w.ball.onFire, "terraflame lights the ball");
    P.destroyWorld(s.w);

    s = setup();
    G("pulsewave").trigger(s.w, s.green);
    eq(s.w.pulses.length, 1, "pulsewave queues a pulse");
    for (let i = 0; i < 60; i++) P.step(s.w, 1 / 60);
    check(s.w.scoreEvents.some((e) => e.kind === "peg-hit" && e.peg.type === "blue"), "pulse lights the blue peg");
    P.destroyWorld(s.w);

    s = setup();
    G("orbital").trigger(s.w, s.green);
    eq(s.w.extraBalls.length, 2, "orbital splits the ball");
    P.destroyWorld(s.w);

    s = setup();
    G("mirage").trigger(s.w, s.green);
    check(s.w.mirageNextShot, "mirage flags the next shot");
    P.destroyWorld(s.w);
});

test("menus: title, locked levels, guide choice", () => {
    eq(PB.screen, "title", "boots to title");
    shot("title");
    clickOn('#screen-title [data-action="levels"]');
    eq(PB.screen, "levels", "level select");
    check(!q("#level-tile-0").classList.contains("disabled"), "level 1 open");
    check(q("#level-tile-1").classList.contains("disabled"), "level 2 locked");
    eq(q("#level-tile-1 .lt-best").textContent, "Locked", "locked label");
    shot("levels");
    clickOn("#level-tile-0");
    eq(PB.screen, "guide", "guide screen");
    clickOn("#guide-card-terraflame");
    eq(PB.menu.guideId, "terraflame", "card picks the guide");
    check(q("#guide-card-terraflame").classList.contains("chosen"), "chosen card marked");
    eq(PB.save.get("selectedGuide"), "terraflame", "guide persisted");
    clickOn("#guide-card-wingtip");
    press("Escape");
    eq(PB.screen, "title", "Esc backs out");
});

test("play: keyboard aim and launch, a shot banks score", () => {
    startLevel(0);
    check(!q("#hud").hidden, "HUD visible");
    eq(text("#hud-guide"), "Wingtip", "HUD guide");
    const r = PB.round;
    eq(text("#hud-balls"), String(r.balls), "HUD balls");
    const a0 = r.aimAngle;
    keyDown(0x40000050, 0, 0);     // hold Left
    frames(10);
    keyUp(0x40000050, 0, 0);
    check(r.aimAngle < a0, "Left turns the cannon");
    // An angle that scores on this layout (level 1 has no moving pegs, so
    // the simulation predicts the live shot).
    const angle = [1.5, 1.8, 1.2, 1.35, 1.95].find((a) => PB.simulateShot(0, a, 11).shotScore > 0);
    check(angle, "a scoring angle exists");
    r.aimAngle = angle;
    const balls = r.balls;
    press(" ");
    frames(1);
    check(r.shotInProgress, "Space launches");
    eq(r.balls, balls - 1, "a ball spent");
    frames(20);
    shot("play");
    check(shotDone(), "shot finishes");
    check(r.score > 0, "shot scored " + r.score);
    eq(text("#hud-score"), String(r.score), "HUD score");
    check(r.world.pegs.some((p) => p.removed), "hit pegs burst");
});

test("play: mouse aims the cannon", () => {
    const r = PB.round;
    const view = PB.shell.api.view;
    const rect = view.canvas.getBoundingClientRect();
    // Field point far right of the cannon, a little below: aim goes shallow right.
    const fit = PB.fieldFit(view.width(), view.height());
    const sx = rect.width / view.width(), sy = rect.height / view.height();
    mouseMove(rect.left + (fit.offX + 1000 * fit.scale) * sx, rect.top + (fit.offY + 200 * fit.scale) * sy);
    frames(1);
    check(r.aimAngle < 0.5, "cannon follows the mouse, angle " + r.aimAngle.toFixed(2));
});

test("clear: last orange wins the level, stars persist, next unlocks", () => {
    const r = PB.round;
    const oranges = r.world.pegs.filter((p) => p.type === "orange" && !p.removed);
    // Clear the field down to one orange.
    for (const p of r.world.pegs) if (p !== oranges[0]) p.lit = true;
    P.sweepLit(r.world);
    eq(r.remainingOrange(), 1, "one orange left");
    // Drop the ball onto the shoulder of the last orange from just above it.
    const last = oranges[0];
    PB.Physics.launchBall(r.world, Math.PI / 2, 10, last.x + 5, last.y - 30);
    r.shotInProgress = true;
    r.balls -= 1;
    check(simUntil(() => PB.screen === "clear", 15000, 16), "clear screen");
    check(r.score >= R.FEVER_BONUS, "fever bonus banked: " + r.score);
    check(/Level 1/.test(text("#clear-stats")) && /NEW BEST/.test(text("#clear-stats")), "clear stats + NEW BEST");
    check(text("#clear-stars").length === 3, "stars shown");
    eq(PB.save.get("unlocked"), 2, "level 2 unlocked");
    check(PB.save.get("best")[1] === r.score, "level best saved");
    eq(PB.save.highScore(), r.score, "overall best saved");
    shot("clear");
    clickOn('#screen-clear [data-action="next"]');
    eq(PB.screen, "guide", "next goes to the guide screen");
    eq(PB.menu.levelIdx, 1, "next level queued");
    clickOn('#screen-guide [data-action="startlevel"]');
    frames(2);
    eq(PB.round.levelIdx, 1, "level 2 running");
});

test("fail: out of balls ends the run on Level Failed", () => {
    const r = PB.round;
    r.balls = 1;
    r.bonusBallsAwarded = 99;       // no bonus ball can rescue this shot...
    r.aimAngle = 0.3;               // shallow: off the right wall and out
    press(" ");
    // ...nor the catch bar.
    const over = () => { r.world.caughtThisShot = false; return PB.screen === "gameover"; };
    check(simUntil(over, 20000, 16), "gameover screen");
    eq(text("#screen-gameover .overlay-title"), "Level Failed", "failed title");
    check(/Cleared\s+\d+ of \d+ orange/.test(text("#gameover-stats")), "fail stats");
    shot("fail");
    clickOn('#screen-gameover [data-action="restart"]');
    frames(2);
    check(PB.screen === "playing" && PB.round.levelIdx === 1 && PB.round.balls === PB.round.ballsStart, "retry restarts the level");
});

test("pause: Resume does not launch", () => {
    press("Escape");
    eq(PB.screen, "pause", "paused");
    press("Enter");
    frames(2);
    eq(PB.screen, "playing", "resumed");
    check(!PB.round.shotInProgress, "the Enter that resumed did not fire");
});

test("settings: toggles persist, trajectory hides the aim dots", () => {
    PB.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="settings"]');
    eq(text("#opt-trajectory"), "ON", "trajectory on");
    clickOn('[data-action="toggle-trajectory"]');
    eq(text("#opt-trajectory"), "OFF", "trajectory toggled");
    eq(PB.save.get("trajectory"), false, "persisted");
    eq(PB.round.previewPath(false).length, 0, "no dots without trajectory");
    check(PB.round.previewPath(true).length > 0, "dots with trajectory");
    clickOn('[data-action="toggle-trajectory"]');
    clickOn('[data-action="cycle-sfx"]');
    eq(text("#opt-sfxVol"), "90", "sfx volume cycles");
    clickOn('#screen-settings [data-action="title"]');
    clickOn('#screen-title [data-action="highscores"]');
    check(/First Bounce/.test(text("#hs-list")), "best list shows level 1");
});

done("pegbounce");
