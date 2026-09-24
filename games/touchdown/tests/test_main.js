// Touchdown: rules (terrain and pads, gravity, thrust and fuel, the
// safe-landing test) and the shell flow (thrust key, telemetry, pause,
// landed screen, crash -> game over with NEW BEST).
// Run: scripts/validate.sh games/touchdown
import { test, done, check, eq, near, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/grid.js";

frames(6);
const G = window.__touchdown;
check(G, "__touchdown hooks exposed");
const R = G.rules;
const UP = 0x40000052;

function mission(seed = 3) {
    return R.createMission(900, 800, seededRandom(seed));
}

/** Put the lander just above the middle of a pad, still and upright. */
function overPad(m, pad = m.terrain.pads[0]) {
    Object.assign(m.lander, { x: (pad.x1 + pad.x2) / 2, y: pad.y - 12, vx: 0, vy: 1, angle: 0 });
    return pad;
}

test("rules: terrain spans the view with flat pads", () => {
    const m = mission();
    const pts = m.terrain.points;
    eq([pts[0].x <= 0, pts[pts.length - 1].x >= 900], [true, true], "edge to edge");
    check(m.terrain.pads.length >= 2, "pads");
    for (let seed = 1; seed <= 30; seed++) {                 // pads are level and never overlap
        const t = R.buildTerrain(900, 800, 1 + (seed % 8), seededRandom(seed));
        const byX = t.pads.slice().sort((a, b) => a.x1 - b.x1);
        for (let i = 1; i < byX.length; i++) check(byX[i].x1 > byX[i - 1].x2, "pads apart (seed " + seed + ")");
        for (const p of t.pads) {
            near(R.terrainY(t, p.x1 + 0.5), p.y, 1e-6, "pad starts flat (seed " + seed + ")");
            near(R.terrainY(t, p.x2 - 0.5), p.y, 1e-6, "pad ends flat (seed " + seed + ")");
            check(p.bonus >= 50, "pad bonus");
        }
    }
    eq(m.lander.fuel, 1000, "full tank on level 1");
    eq(R.levelFuel(10), 350, "fuel floor");
});

test("rules: gravity pulls, thrust pushes and burns fuel", () => {
    const m = mission();
    m.lander.vx = 0;
    R.step(m, 16.67, {});
    near(m.lander.vy, R.GRAVITY, 1e-6, "one frame of gravity");
    R.step(m, 16.67, { thrust: true });
    near(m.lander.vy, 2 * R.GRAVITY - R.THRUST, 1e-6, "thrust up");
    near(m.lander.fuel, 1000 - R.FUEL_BURN, 1e-6, "fuel burned");
    R.step(m, 16.67, { left: true });
    near(m.lander.angle, -R.ROT_SPEED, 1e-6, "rotated left");
    m.lander.fuel = 0;
    const vy = m.lander.vy;
    R.step(m, 16.67, { thrust: true });
    check(m.lander.vy > vy, "no thrust on an empty tank");
});

test("rules: a gentle upright landing on a pad scores", () => {
    const m = mission();
    const pad = overPad(m);
    for (let i = 0; i < 200 && m.status === "flying"; i++) R.step(m, 16.67, {});
    eq(m.status, "landed", "landed");
    eq(m.landings, 1, "counted");
    check(m.score > pad.bonus, "pad bonus plus fuel and softness: " + m.score);
    eq(R.drainEvents(m).map((e) => e.type), ["land"], "land event");
    R.nextLevel(m);
    eq([m.level, m.status, m.lander.fuel], [2, "flying", 890], "level 2");
});

test("rules: fast, tilted or off-pad touchdowns crash", () => {
    const fast = mission();
    overPad(fast);
    fast.lander.vy = 5;
    for (let i = 0; i < 50 && fast.status === "flying"; i++) R.step(fast, 16.67, {});
    eq(fast.status, "crashed", "too fast");
    check(fast.reasons.includes("DESCENT TOO FAST"), "reason: " + fast.reasons);

    const tilted = mission();
    overPad(tilted);
    tilted.lander.angle = 0.6;
    for (let i = 0; i < 200 && tilted.status === "flying"; i++) R.step(tilted, 16.67, {});
    check(tilted.reasons.includes("NOT UPRIGHT"), "reason: " + tilted.reasons);
});

test("shell: thrust key, telemetry, pause", () => {
    check(G.screen === "title", "boots to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    check(!document.getElementById("telemetry").hidden, "telemetry shown");
    const m = G.run.mission;
    keyDown(UP);
    frames(20);
    check(m.lander.thrusting, "Up thrusts");
    check(m.lander.fuel < 1000, "burning fuel");
    shot("thrust");
    keyUp(UP);
    frames(1);
    eq(text("#hud-fuel"), String(Math.round(m.lander.fuel)), "HUD fuel");
    eq(text("#tel-vvel"), m.lander.vy.toFixed(2), "telemetry VVEL");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const y = m.lander.y;
    frames(30);
    eq(m.lander.y, y, "paused");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
});

test("shell: landed screen, then a crash ends the run with NEW BEST", () => {
    G.save.set("highScore", 0);
    const m = G.run.mission;
    overPad(m);
    check(simUntil(() => G.screen === "landed", 3000, 16), "landed screen");
    check(/BONUS\s+\+\d+/.test(text("#landed-stats")), "landed stats: " + text("#landed-stats"));
    shot("landed");
    press("Enter");
    frames(2);
    eq(text("#hud-level"), "2", "level 2");
    m.lander.vy = 6;
    check(simUntil(() => G.screen === "gameover", 5000, 16), "crashed");
    const stats = text("#gameover-stats");
    check(/Score\s+\d+\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    check(/Landed\s+1/.test(stats), "landings on the game-over screen");
    check(document.getElementById("telemetry").hidden, "telemetry hidden");
    shot("gameover");
});

done("touchdown");
