// Nova Squadron: projection + rules, menus, yoke, lasers (fighter, ace,
// tower top), targeting computer + radio timing, damage, the three sectors,
// the vent bullseye -> victory -> next campaign, ship lost, pause.
// Run: scripts/validate.sh games/starfighter
import { test, done, check, eq, near, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";

frames(6);
const S = window.__starfighter;
check(S, "__starfighter hooks exposed");
const R = S.rules;
const W = S.waves;
const E = S.enemies;

S.save.set("highScore", 0);
S.save.set("sfxVol", 80);

/** Keep only `keep` enemies and stop the wave from spawning more. */
function isolate(f, keep) {
    f.enemies = keep ? [keep] : [];
    f.enemyBolts.length = 0;
    if (f.ws.schedule) f.ws.spawned = f.ws.spawnCursor = f.ws.schedule.length;
}

test("rules: projection, ray cast, shields, sectors, yoke", () => {
    const cam = S.createCamera(1000, 800);
    const c = cam.project(0, 0, 10);
    near(c.x, 500, 1e-6, "origin ray hits the centre x");
    near(c.y, 400, 1e-6, "centre y");
    check(cam.project(1, 1, 10).y < 400, "+Y is up");
    check(!cam.project(0, 0, 0.1).visible, "behind the near plane");
    const hit = R.raySphere(0, 0, 0, 0, 0, 1, 0, 1, 10, 2);
    near(hit.t, 10 - Math.sqrt(3), 1e-9, "ray-sphere entry");
    near(hit.miss, 1, 1e-9, "perpendicular miss");
    eq(R.raySphere(0, 0, 0, 0, 0, 1, 0, 0, -5, 2).t, Infinity, "nothing behind");
    eq(R.shieldBar(4), "■ ■ ■ ■ □ □", "shield bar");
    eq(W.sectorOf(W.TRENCH), 3, "trench is sector 3");
    eq(W.nextWave(W.SURFACE), W.TRENCH, "surface -> trench");
    eq(W.nextWave(W.TRENCH), null, "trench ends the loop");
    near(W.loopScale(2), 1.35, 1e-9, "loop 2 scale");
    eq(W.loopScale(20), 3, "scale caps at 3");
    eq(S.toYoke(512, 384, 1024, 768), { x: 0, y: 0 }, "centre is neutral");
    eq(S.toYoke(1024, 0, 1024, 768), { x: 1, y: 1 }, "top-right corner is full deflection");
    eq(S.toYoke(530, 384, 1024, 768).x, 0, "dead zone");
});

test("menus: title, briefing, settings, engage", () => {
    eq(S.screen, "title", "boots to title");
    shot("title");
    clickOn('#screen-title [data-action="howto"]');
    eq(S.screen, "howto", "briefing");
    clickOn('#screen-howto [data-action="back"]');
    clickOn('#screen-title [data-action="settings"]');
    eq(S.screen, "settings", "settings");
    eq(text("#opt-sfxVol"), "80", "sfx row");
    clickOn('#screen-settings [data-action="cycle-sfx"]');
    eq(S.save.get("sfxVol"), 90, "sfx cycles and saves");
    clickOn('#screen-settings [data-action="back"]');
    clickOn('#screen-title [data-action="play"]');
    frames(2);
    eq(S.screen, "playing", "ENGAGE starts a run");
    check(!q("#hud").hidden, "HUD shown");
    eq(text("#hud-wave"), "1-1", "sector 1-1");
    eq(text("#hud-shields"), R.shieldBar(R.MAX_SHIELDS), "full shields");
    check(/SECTOR 1-1/.test(text("#hud-radio")) && q("#hud-radio").classList.contains("active"), "sector intro on the radio");
});

test("play: fighters swoop in, the mouse flies the yoke, Space fires", () => {
    S.start(7);
    frames(2);
    const f = S.flight;
    check(simUntil(() => f.enemies.some((e) => e.kind === "fighter"), 4000, 16), "a fighter spawned");
    const view = S.shell.api.view;
    const rect = view.canvas.getBoundingClientRect();
    // Playing takes the pointer lock: relative motion nudges the yoke.
    check(document.pointerLockElement === view.canvas, "pointer locked while playing");
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    mouseMove(cx, cy);
    frames(1);
    f.steer(0, 0);
    mouseMove(cx + 120, cy - 60);
    frames(1);
    near(f.yoke.x, 0.5, 1e-6, "120 px right = half yoke");
    near(f.yoke.y, 0.25, 1e-6, "60 px up = quarter yoke up");
    // Without the lock the yoke follows the pointer's absolute position.
    document.exitPointerLock();
    mouseMove(rect.left + rect.width * 0.9, cy);
    frames(1);
    check(f.yoke.x > 0.6, "absolute yoke right: " + f.yoke.x.toFixed(2));
    near(f.yoke.y, 0, 1e-6, "yoke level");
    simUntil(() => false, 400, 16);
    check(f.ship.x > 10, "the ship eases after the reticle: " + f.ship.x.toFixed(1));
    const before = f.playerBolts.length;
    keyDown(32, 0, 0);                 // SDL keycode for Space, held a frame
    frames(1);
    keyUp(32, 0, 0);
    eq(f.playerBolts.length - before, 4, "four wingtip bolts");
    shot("play");
});

test("lasers: fighter kill, the ace breaks off, tower tops take the hit", () => {
    const f = S.flight;
    f.steer(0, 0);
    f.ship.x = f.ship.y = 0;
    f.reticle.x = f.reticle.y = 0;
    const fighter = E.createFighter({ life: 1e9, fireCount: 0 });
    Object.assign(fighter, { x: 0, y: 0, z: 30 });
    isolate(f, fighter);
    f.score = 0;
    f.fireCooldown = 0;
    eq(f.fire(), fighter, "the ray finds the fighter");
    check(fighter.dead && f.score === 1000, "fighter destroyed, +1000");
    check(f.explosions.length > 0, "explosion");

    const ace = E.createAce({ life: 1e9 });
    Object.assign(ace, { x: 0, y: 0, z: 40 });
    isolate(f, ace);
    f.fireCooldown = 0;
    f.fire();
    check(ace.flee && !ace.dead, "ace flees, not killed");
    eq(f.score, 1000 + R.ACE_BONUS, "+2000 for the ace");
    eq(f.radioText, "BLACK ACE BREAKING OFF", "radio call");

    // Base far below the ray; its glowing top sits on it.
    const tower = E.createTower({ x: 0, y: -12, z: 30, h: 14 });
    isolate(f, tower);
    f.fireCooldown = 0;
    eq(f.fire(), tower, "the shot hits the tower top");
    check(tower.dead, "tower destroyed");
    f.fireCooldown = 0;
    eq(f.fire(), null, "cooldown or not, empty sky hits nothing");
});

test("targeting computer: T toggles, the radio call times out on run time", () => {
    const f = S.flight;
    check(f.targeting, "on by default");
    press("t");
    frames(1);
    check(!f.targeting, "T turns it off");
    eq(text("#hud-radio"), "TARGETING COMPUTER: OFF", "radio text");
    check(q("#hud-radio").classList.contains("active"), "radio shown");
    simUntil(() => false, 1600, 16);
    check(!q("#hud-radio").classList.contains("active"), "radio cleared after 1.4 s");
    press("t");
    frames(1);
    check(f.targeting, "T turns it back on");
});

test("damage: an enemy bolt on the ship costs a shield", () => {
    const f = S.flight;
    isolate(f);
    const n = f.shields;
    f.enemyBolts.push({ x: f.ship.x, y: f.ship.y, z: 0.6, vx: 0, vy: 0, vz: -0.18, life: 4500, t: 0, color: "#6cf" });
    frames(1);
    eq(f.shields, n - 1, "shield lost");
    eq(text("#hud-shields"), R.shieldBar(n - 1), "HUD shields");
    const b = { x: f.ship.x + 30, y: f.ship.y, z: 0.6, vx: 0, vy: 0, vz: -0.18, life: 4500, t: 0, color: "#6cf" };
    f.enemyBolts.push(b);
    frames(1);
    eq(f.shields, n - 1, "a wide bolt misses");
});

test("sectors: space -> surface -> trench, bonuses, a shield back", () => {
    const f = S.flight;
    f.score = 0;
    f.shields = 3;
    isolate(f);
    f.ws.elapsed = f.ws.finishAfterMs;
    frames(1);
    eq(f.wave, W.SURFACE, "surface next");
    eq(f.score, 5000, "space bonus");
    eq(f.shields, 4, "one shield back");
    eq(text("#hud-wave"), "1-2", "HUD sector");
    check(simUntil(() => f.enemies.some((e) => e.kind === "tower" || e.kind === "bunker"), 4000, 16), "ground targets stream in");
    simUntil(() => false, 1500, 16);
    shot("surface");
    f.completeWave();
    eq(f.wave, W.TRENCH, "trench next");
    eq(f.score, 15000, "surface bonus");
});

test("trench: the vent locks on; a trust-mode bullseye wins the campaign", () => {
    const f = S.flight;
    f.shields = 99;                   // obstacles are not under test here
    f.steer(0, 0);
    check(simUntil(() => f.lockActive, 12000, 16), "vent in the lock window");
    check(q("#hud-lock").classList.contains("active"), "LOCK shown");
    shot("trench");
    const port = f.ws.port;
    isolate(f, port);
    f.shields = 4;
    f.ship.x = f.ship.y = 0;
    f.targeting = false;
    f.fireCooldown = 0;
    const before = f.score;
    eq(f.fire(), port, "shot at the vent");
    eq(f.score - before, R.VENT_BULLSEYE * 2, "bullseye, trust bonus x2");
    eq(f.radioText, "BULLSEYE  ::  TRUST BONUS x2", "radio");
    frames(2);
    eq(S.screen, "victory", "victory screen");
    eq(f.shields, 5, "the sector-clear shield lands first");
    eq(f.shieldBonus, 5 * R.SHIELD_BONUS_PER, "shield bonus");
    check(/CAMPAIGN 1 COMPLETE/.test(text("#victory-stats")), "stats");
    check(/NEW BEST/.test(text("#victory-stats")), "best recorded at victory");
    eq(S.save.highScore(), f.score, "saved best");
    shot("victory");
    clickOn('#screen-victory [data-action="continue"]');
    frames(2);
    eq(S.screen, "playing", "next campaign");
    eq(f.loop, 2, "loop 2");
    eq(text("#hud-wave"), "2-1", "sector 2-1");
});

test("ship lost: last shield -> SHIP LOST, fly again", () => {
    const f = S.flight;
    f.shields = 1;
    f.takeDamage(1);
    frames(1);
    eq(S.screen, "gameover", "game over");
    check(/Sector\s+2-1/.test(text("#gameover-stats")), "stats name the sector");
    shot("gameover");
    clickOn('#screen-gameover [data-action="restart"]');
    frames(2);
    eq(S.screen, "playing", "FLY AGAIN");
    eq(S.flight.loop, 1, "fresh campaign");
    eq(S.flight.shields, R.MAX_SHIELDS, "full shields");
});

test("pause: Resume does not fire", () => {
    press("Escape");
    eq(S.screen, "pause", "paused");
    press("Enter");
    frames(2);
    eq(S.screen, "playing", "resumed");
    eq(S.flight.playerBolts.length, 0, "the Enter that resumed did not fire");
});

done("starfighter");
