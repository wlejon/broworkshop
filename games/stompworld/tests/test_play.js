// Stompworld human play through the arcade shell: menu, running and
// jumping (both jump bindings), beam fire, stomps, pause, lost lives
// (pit, clock), the flag, and game over.
import { check, eq, test, done, frames, simUntil, q, text, press, shot } from "/lib/kit/test.js";

const SW = window.__SW;
const visible = (id) => !q("#overlay").hidden && !q("#screen-" + id).hidden;
const hold = (code, ms) => { keyDown(code, 0, 0); frames(Math.round(ms / 16)); keyUp(code, 0, 0); flush(); };
const KEY = { d: 100, j: 106, space: 0x20, up: 0x40000052 };

function startPlay() {
    if (!visible("title")) { press("Escape"); frames(2); }
    if (visible("pause")) {
        q('#screen-pause [data-action="title"]').click();
        frames(2);
    }
    q('#screen-title [data-action="play"]').click();
    frames(3);
    check(SW.mode === "play" && !!SW.world, "play run started");
    return SW.world;
}

/** Stand the hero on the ground at a column (row 15 is the running row). */
function putHero(w, col) {
    w.hero.x = col * 32 + 4;
    w.hero.y = 15 * 32 + 2 - 4;
    w.hero.vx = 0; w.hero.vy = 0;
    frames(3);
}

frames(5);
test("title menu, keyboard Enter starts play", () => {
    check(visible("title"), "title shown");
    press("Enter");
    frames(3);
    eq(SW.mode, "play");
    check(!q("#hud").hidden, "HUD visible");
    eq(text("#hud-lives"), "3");
});

test("running right moves the hero and the clock runs", () => {
    const w = SW.world;
    const x0 = w.hero.x;
    hold(KEY.d, 800);
    check(w.hero.x > x0 + 100, "moved right: " + (w.hero.x - x0).toFixed(0) + " px");
    check(w.timeLeft < 299.5, "clock counts down");
    frames(40);   // standing still, short of the first pit
    check(+text("#hud-time") < 300, "HUD clock");
    eq(w.lives, 3);
    shot("running");
});

test("space and ArrowUp both jump", () => {
    const w = SW.world;
    for (const key of [KEY.space, KEY.up]) {
        simUntil(() => w.hero.onGround, 2000);
        const y0 = w.hero.y;
        keyDown(key, 0, 0);
        frames(6);
        check(w.hero.y < y0 - 20, "jumped with key " + key.toString(16));
        keyUp(key, 0, 0);
        simUntil(() => w.hero.onGround, 3000);
    }
});

test("beam fires along facing before the mouse moves", () => {
    const w = SW.world;
    w.weaponCooldown = 0;
    press("j");
    frames(1);
    check(w.beams.length > 0, "beam drawn");
    const b = w.beams[0];
    check(b.x1 > b.x0 && Math.abs(b.y1 - b.y0) < 1, "straight ahead to the right");
});

test("beam aimed with the mouse flings a flyer", () => {
    const w = startPlay();
    const f = w.flyers.find((e) => e.bobAmp === 0 && e.y > 15 * 32);   // body-height flyer
    w.stompers.length = 0;
    putHero(w, 18);   // solid ground just left of its patrol (col 15 is a pit)
    frames(1);
    // Point at the flyer: world → view → client (the canvas fills the window).
    const r = q("#view").getBoundingClientRect();
    const scale = Math.min(r.width / 800, r.height / 576);
    const ox = r.left + (r.width - 800 * scale) / 2, oy = r.top + (r.height - 576 * scale) / 2;
    mouseMove(ox + (f.x + f.w / 2 - w.cam.x) * scale, oy + (f.y + f.h / 2 - w.cam.y) * scale);
    frames(1);
    const score0 = w.score;
    w.weaponCooldown = 0;
    press("j");
    frames(1);
    check(f.ragdoll, "flyer knocked out: beam " + JSON.stringify(w.beams[0]) + " flyer " + f.x.toFixed(0) + "," + f.y.toFixed(0)
        + " hero " + w.hero.x.toFixed(0) + "," + w.hero.y.toFixed(0) + " lives " + w.lives);
    check(w.score >= score0 + 500, "flyer bonus");
    shot("beam");
});

test("landing on a stomper squashes it", () => {
    const w = startPlay();
    w.flyers.length = 0;   // keep patrolling flyers out of the bounce
    eq(w.lives, 3, "fresh run");
    const s = w.stompers[0];
    w.hero.x = s.x;
    w.hero.y = s.y - w.hero.h - 6;
    w.hero.vy = 200;
    const score0 = w.score;
    frames(2);
    check(!s.alive && !s.ragdoll, "squashed");
    eq(w.score, score0 + 100, "stomp score");
    check(w.hero.vy < 0, "bounced");
    eq(w.lives, 3, "no life lost");
});

test("pause and resume", () => {
    press("Escape");
    frames(2);
    check(visible("pause"), "pause screen");
    q('#screen-pause [data-action="resume"]').click();
    frames(2);
    check(q("#overlay").hidden, "back to play");
});

test("falling in a pit costs a life and respawns", () => {
    const w = startPlay();
    w.hero.x = 14 * 32;    // the first gap
    w.hero.y = 16 * 32;
    simUntil(() => w.lives === 2 && w.deathTimer === 0, 5000);
    eq(w.lives, 2);
    check(w.hero.x < 5 * 32, "back at spawn");
    eq(text("#hud-lives"), "2");
});

test("running out of time costs a life and restarts the clock", () => {
    const w = SW.world;
    w.timeLeft = 0.05;
    simUntil(() => w.lives === 1 && w.deathTimer === 0, 5000);
    eq(w.lives, 1);
    check(w.timeLeft > 290, "clock reset: " + w.timeLeft);
});

test("losing the last life ends the game", () => {
    const w = SW.world;
    w.hero.x = 14 * 32;
    w.hero.y = 16 * 32;
    simUntil(() => visible("gameover"), 5000);
    check(visible("gameover"), "game over screen");
    check(/Score/.test(text("#gameover-stats")), "stats: " + text("#gameover-stats"));
    shot("gameover");
});

test("reaching the flag wins", () => {
    const w = startPlay();
    putHero(w, 116);
    keyDown(KEY.d, 0, 0);
    simUntil(() => visible("win"), 6000);
    keyUp(KEY.d, 0, 0);
    check(visible("win"), "win screen");
    check(/Score: \d+/.test(text("#win-stats")), text("#win-stats"));
    check(w.score >= 1000, "flag bonus");
    shot("win");
});

done("stompworld play");
