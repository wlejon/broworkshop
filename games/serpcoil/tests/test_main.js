// Serpcoil: path + chain rules, inserts and pops, cascades through the
// retreating front, power-ups, danger, level clear / unlock, the coil
// reaching the maw, menus. Run: scripts/validate.sh games/serpcoil
import { test, done, check, eq, near, frames, simUntil, press, clickOn, q, text, shot } from "/lib/kit/test.js";

frames(6);
const S = window.__serpcoil;
check(S, "__serpcoil hooks exposed");
const { scoreForPop, starsFor, clearBonus } = S.rules;
const D = S.ORB_DIAM;

S.save.set("unlocked", 1);
S.save.set("stars", {});
S.save.set("bestScore", {});
S.save.set("highScore", 0);
S.save.set("sfxVol", 80);

/**
 * Freeze spawning and lay out orbs of `colors` packed from d0. A lone
 * colour-6 sentinel further along keeps the chain from emptying (which
 * would win the level) unless sentinel is false.
 */
function layout(colors, d0 = 100, sentinel = true) {
    const ch = S.coil.chain;
    ch.queue.length = 0;
    ch.spawned = ch.totalToSpawn;
    ch.orbs.length = 0;
    colors.forEach((c, i) => ch.orbs.push({ color: c, d: d0 + i * D, phase: 0 }));
    if (sentinel) ch.orbs.push({ color: 6, d: d0 + (colors.length + 8) * D, phase: 0 });
    return ch;
}

const colorsOf = (ch) => ch.orbs.map((o) => o.color);

test("rules: path, pop scoring, stars", () => {
    const p = S.createPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
    near(p.length(), 200, 0.5, "straight path length");
    near(p.pointAt(50).x, 50, 0.5, "pointAt");
    near(p.tangentAt(100).x, 1, 1e-3, "tangent");
    eq(scoreForPop(3, 1), 60, "3 at depth 1");
    eq(scoreForPop(4, 1), 120, "4+ gets x1.5");
    eq(scoreForPop(3, 3), 240, "depth multiplies");
    eq(starsFor(1200, 50), 3, "3 stars at 1.2x perfect");
    eq(starsFor(800, 50), 2, "2 stars");
    eq(starsFor(10, 50), 1, "always one star");
    eq(clearBonus(2), 700, "clear bonus grows by level");
});

test("chain: matches and inserts", () => {
    const path = S.createPath([{ x: 0, y: 0 }, { x: 2000, y: 0 }]);
    const ch = new S.Chain({ path, palette: [1], totalToSpawn: 0 });
    [1, 1, 2, 2, 2, 3].forEach((c, i) => ch.orbs.push({ color: c, d: i * D, phase: 0 }));
    eq(ch.detectMatches(null), [[2, 5]], "one 3-run");
    eq(ch.detectMatches(0), [], "hint in a 2-run");
    const i = ch.insertAt(D * 1.5, 1);
    eq(i, 2, "inserted behind the 2s");
    eq(colorsOf(ch), [1, 1, 1, 2, 2, 2, 3], "order");
    check(ch.orbs.every((o, k) => k === 0 || o.d - ch.orbs[k - 1].d >= D - 1e-6), "repacked");
    eq(ch.popAround(i).length, 3, "the 1s pop");
    eq(ch.colorshift(0, 3), 3, "colorshift repaints the run");
    eq(colorsOf(ch), [3, 3, 3, 3], "2 2 2 3 -> 3 3 3 3");
});

test("menus: title, level select locks, how to play", () => {
    eq(S.screen, "title", "boots to title");
    shot("title");
    clickOn('#screen-title [data-action="levelselect"]');
    eq(S.screen, "levelselect", "level select");
    check(!q("#level-node-0").classList.contains("disabled"), "level 1 open");
    check(q("#level-node-1").classList.contains("disabled"), "level 2 locked");
    shot("levelselect");
    press("Escape");
    clickOn('#screen-title [data-action="howto"]');
    eq(S.screen, "howto", "how to play");
    clickOn('#screen-howto [data-action="back"]');
    clickOn('#screen-title [data-action="play"]');
    frames(2);
    eq(S.screen, "playing", "Play starts level 1");
    eq(S.coil.levelIdx, 0, "level 1");
    check(!q("#hud").hidden, "HUD shown");
});

test("play: chain spawns and marches, a shot lands in the chain", () => {
    S.startLevel(0, 12345);
    frames(2);
    const c = S.coil;
    c.chain.baseSpeed = 5;
    simUntil(() => c.chain.count >= 4, 5000, 16);
    check(c.chain.count >= 4, "orbs spawned: " + c.chain.count);
    eq(text("#hud-left"), String(c.left), "HUD left");
    // Aim at the second orb and fire with Space.
    const target = c.chain.positionOf(c.chain.orbs[1]);
    c.aimAt(target.x, target.y);
    const before = c.chain.count + c.chain.remainingToSpawn;
    press(" ");
    frames(1);
    check(c.shooter.projectiles.length === 1, "Space fires");
    check(simUntil(() => c.shooter.projectiles.length === 0, 3000, 16), "projectile lands");
    check(c.chain.count + c.chain.remainingToSpawn >= before, "the orb joined (or popped with) the chain");
    shot("play");
});

test("pops: insert completes a run; score + combo", () => {
    const c = S.coil;
    const ch = layout([1, 1, 2, 3]);
    c.score = 0;
    c.insertAt(100 + D * 1.5, 1);
    eq(colorsOf(ch), [2, 3, 6], "three 1s popped");
    eq(c.score, scoreForPop(3, 1), "scored");
});

test("cascade: the retreating front merges and pops again", () => {
    const c = S.coil;
    const ch = layout([1, 1, 2, 2, 1, 1]);
    c.score = 0;
    c.combo = 1;
    c.comboTimer = 0;
    c.insertAt(100 + D * 2.5, 2);              // 1 1 [2 2 2] 1 1
    eq(colorsOf(ch), [1, 1, 1, 1, 6], "2s popped, 1s left apart");
    check(ch.orbs[2].d - ch.orbs[1].d > D + 1, "gap between the halves");
    check(simUntil(() => ch.count === 1, 2000, 16), "front retreats, merges, 1 1 1 1 pops");
    eq(c.combo, 2, "cascade depth 2");
    eq(c.score, scoreForPop(3, 1) + scoreForPop(4, 2), "second pop at depth 2");
    eq(text("#hud-combo"), "x2", "HUD combo");
});

test("power-ups: backtrack, blaster, slow-mo, colorshift", () => {
    const c = S.coil;
    let ch = layout([1, 2, 3, 1, 2], 400);
    const fireAt = (orbIdx, pu, color) => {
        const p = ch.positionOf(ch.orbs[orbIdx]);
        c.shooter.projectiles.push({ x: p.x, y: p.y, vx: 0, vy: 0, color: color || 1, pu, life: 1000 });
        frames(1);
    };
    const d0 = ch.orbs[0].d;
    fireAt(2, S.PU.BACKTRACK);
    check(ch.orbs[0].d < d0 - 100, "backtrack pushes the chain back");

    ch = layout([1, 2, 3, 1, 2], 400);
    c.score = 0;
    fireAt(2, S.PU.BLASTER);
    check(ch.count < 6, "blaster removes orbs: " + ch.count);
    eq(c.score, (6 - ch.count) * 25, "25 a blasted orb");

    ch = layout([1, 2, 3], 400);
    fireAt(1, S.PU.SLOWMO);
    check(ch.slowmo > 5000, "slow-mo on");
    eq(ch.count, 4, "slow-mo removes nothing");

    ch = layout([1, 1, 2, 1, 1], 400);
    fireAt(2, S.PU.COLORSHIFT, 1);
    eq(colorsOf(ch), [6], "colorshift repaints 2 -> 1 and the run of 5 pops");
});

test("danger: head near the maw", () => {
    const c = S.coil;
    const len = c.path.length();
    const ch = layout([3, 4], 100, false);
    ch.orbs[0].d = len * 0.84;
    ch.orbs[1].d = len * 0.84 + D;
    frames(2);
    check(c.danger, "danger on");
    check(q("#hud-danger").style.display !== "none", "DANGER badge shown");
    layout([3, 4]);
    frames(2);
    check(!c.danger, "danger off");
});

test("clear: empty chain wins, stars persist, next level unlocks", () => {
    const c = S.coil;
    c.score = 900;
    layout([], 100, false);
    check(simUntil(() => S.screen === "levelclear", 1000, 16), "levelclear screen");
    eq(c.bonus, clearBonus(0), "clear bonus");
    eq(c.score, 900 + clearBonus(0), "bonus added");
    check(/NEW BEST/.test(text("#levelclear-stats")), "NEW BEST on clear");
    eq(text("#clear-stars").length, 3, "stars shown");
    eq(S.save.get("unlocked"), 2, "level 2 unlocked");
    eq(S.save.get("bestScore")[0], c.score, "level best saved");
    shot("clear");
    clickOn('#screen-levelclear [data-action="nextlevel"]');
    frames(2);
    eq(S.coil.levelIdx, 1, "next level running");
});

test("lose: coil reaches the maw -> Coil Devoured", () => {
    const c = S.coil;
    // One packed segment a hair short of the maw: the march carries it in.
    const ch = layout([2, 3], c.path.length() - D - 1, false);
    check(simUntil(() => S.screen === "gameover", 1000, 16), "gameover");
    check(/Level\s+2/.test(text("#gameover-stats")), "stats name the level");
    shot("gameover");
    clickOn('#screen-gameover [data-action="restart"]');
    frames(2);
    check(S.screen === "playing" && S.coil.levelIdx === 1, "Try Again replays level 2");
});

test("level select: an unlocked tile starts that level", () => {
    S.shell.switchTo("title");
    frames(1);
    clickOn('#screen-title [data-action="levelselect"]');
    check(!q("#level-node-1").classList.contains("disabled"), "level 2 now open");
    eq(q("#level-node-0 .level-stars").textContent.length > 0, true, "level 1 stars");
    clickOn("#level-node-1");
    frames(2);
    check(S.screen === "playing" && S.coil.levelIdx === 1, "tile starts level 2");
});

test("pause: Resume does not fire", () => {
    press("Escape");
    eq(S.screen, "pause", "paused");
    press("Enter");
    frames(2);
    eq(S.screen, "playing", "resumed");
    eq(S.coil.shooter.projectiles.length, 0, "the Enter that resumed did not fire");
});

done("serpcoil");
