// Missile Command: rules (launching, blasts, chains, impacts, wave bonus)
// and the shell flow (aim, fire, wave-complete screen, game over with NEW BEST).
// Run: scripts/validate.sh games/missile-command
import { test, done, check, eq, near, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/random.js";

frames(6);
const G = window["__missile-command"];
check(G, "__missile-command hooks exposed");
const R = G.rules;

/** A battlefield with nothing scheduled to fall. */
function quiet() {
    const d = R.createDefense(900, 700, seededRandom(3));
    d.spawnTimes = [];
    return d;
}

function run(d, ms) {
    for (let t = 0; t < ms; t += 16) R.step(d, 16);
}

test("rules: fresh battlefield", () => {
    const d = R.createDefense(900, 700, seededRandom(1));
    eq(d.cities.length, R.NUM_CITIES, "six cities");
    eq(d.silos.map((s) => s.ammo), [10, 10, 10], "full silos");
    eq(d.spawnTimes.length, 14, "10 + 4 ICBMs in wave 1");
    near(d.groundY, 700 * R.GROUND_FRAC, 0.01, "ground line");
});

test("rules: launch uses the nearest silo with ammo and clamps above ground", () => {
    const d = quiet();
    R.launch(d, 60, 300);
    eq(d.silos[0].ammo, 9, "left silo fired");
    d.silos[1].ammo = 0;
    R.launch(d, 450, 690);
    eq(d.missiles[1].ty, d.groundY - 8, "target clamped above the ground");
    check(d.silos[1].ammo === 0 && d.silos[0].ammo + d.silos[2].ammo === 18, "empty middle silo skipped");
    eq(R.drainEvents(d).map((e) => e.type), ["launch", "launch"], "launch events");
    for (const s of d.silos) s.ammo = 0;
    check(!R.launch(d, 450, 300), "no ammo, no launch");
});

test("rules: a counter-missile blast destroys ICBMs and chains", () => {
    const d = quiet();
    // The second sits beyond the first blast's reach but inside the one it sets off.
    d.enemies.push({ x: 490, y: 300, sx: 450, sy: 0, tx: 450, ty: 616, vx: 0, vy: 0, alive: true, splitAt: -1 });
    d.enemies.push({ x: 530, y: 300, sx: 0, sy: 0, tx: 0, ty: 616, vx: 0, vy: 0, alive: true, splitAt: -1 });
    R.launch(d, 450, 300);
    run(d, 2000);
    eq(d.enemies.length, 0, "both ICBMs gone");
    eq(d.score, 2 * R.BOMB_SCORE, "both scored, the second through the chain");
});

test("rules: an ICBM landing on a city destroys it", () => {
    const d = quiet();
    const c = d.cities[0];
    d.enemies.push({ x: c.x, y: c.y - 2, sx: c.x, sy: 0, tx: c.x, ty: c.y, vx: 0, vy: 60, alive: true, splitAt: -1 });
    run(d, 100);
    check(!c.alive, "city destroyed");
    check(R.drainEvents(d).some((e) => e.type === "cityhit"), "cityhit event");
    eq(d.score, 0, "enemy impacts never score");
});

test("rules: clearing a wave pays the bonus, even waves rebuild a city", () => {
    const d = quiet();
    d.wave = 2;
    d.cities[0].alive = false;
    d.silos[0].ammo = 4;
    run(d, 1000);
    eq(d.phase, "cleared", "wave cleared");
    eq(d.summary, { cities: 5, ammo: 24, cityBonus: 500, ammoBonus: 120 }, "summary");
    eq(d.score, 620, "bonus scored");
    check(d.cities[0].alive, "a ruined city is rebuilt");
    R.nextWave(d);
    eq([d.wave, d.phase, d.silos[0].ammo], [3, "playing", 10], "next wave refills");
});

test("rules: losing every city ends the game", () => {
    const d = quiet();
    for (const c of d.cities) c.alive = false;
    run(d, 2000);
    eq(d.phase, "over", "game over");
    check(R.drainEvents(d).some((e) => e.type === "gameover"), "gameover event");
});

test("shell: title, aim and fire, pause", () => {
    check(G.screen === "title", "boots to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    eq(text("#hud-wave"), "1", "HUD wave");
    // Aim above the middle silo; silo spacing follows the viewport width.
    const mid = G.run.defense.silos[1].x;
    mouseMove(mid, 250);
    frames(2);
    near(G.run.aim.x, mid, 1, "crosshair follows the mouse");
    press("Space");
    frames(1);
    eq(G.run.defense.silos.map((s) => s.ammo), [10, 9, 10], "Space fires from the nearest silo");
    frames(20);
    shot("playing");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const clock = G.run.defense.clock;
    frames(30);
    eq(G.run.defense.clock, clock, "paused clock does not move");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: wave complete screen, continue, game over with NEW BEST", () => {
    G.save.set("highScore", 0);
    const d = G.run.defense;
    d.spawnTimes = [];
    d.spawnCursor = 0;
    d.enemies = [];
    check(simUntil(() => G.screen === "wavecomplete", 4000, 16), "wave complete");
    check(/Cities saved\s+6 x 100 = 600/.test(text("#wave-stats")), "wave stats: " + text("#wave-stats"));
    shot("wavecomplete");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Continue plays on");
    eq(text("#hud-wave"), "2", "wave 2");
    for (const c of d.cities) c.alive = false;
    check(simUntil(() => G.screen === "gameover", 4000, 16), "cities gone");
    const stats = text("#gameover-stats");
    check(/Score\s+\d+\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    check(/Wave\s+2/.test(stats), "wave on the game-over screen");
    check(G.save.highScore() > 0, "high score saved");
    shot("gameover");
});

done("missile-command");
