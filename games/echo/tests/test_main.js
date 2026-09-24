// Echo: rules (playback timing, echo checking, round growth) and the shell
// flow (keys and clicks, pause freezes playback, a wrong pad ends the run
// with NEW BEST).
// Run: scripts/validate.sh games/echo
import { test, done, check, eq, frames, simUntil, press, text, shot } from "/lib/kit/test.js";
import { seededRandom } from "/lib/arcade/random.js";
import { padRect } from "/app/render.js";

frames(6);
const G = window.__echo;
check(G, "__echo hooks exposed");
const R = G.rules;

/** Step until it is the player's turn; returns the flashes seen. */
function watch(e) {
    const seen = [];
    for (let t = 0; t < 20000 && e.phase !== "input"; t += 16) {
        R.step(e, 16);
        for (const ev of R.drainEvents(e)) if (ev.type === "flash") seen.push(ev.pad);
    }
    return seen;
}

test("rules: playback flashes the sequence, then it is your turn", () => {
    const e = R.createEcho(seededRandom(4));
    eq([e.round, e.sequence.length, e.status], [1, 1, "WATCH"], "round 1");
    check(!R.press(e, 0), "no presses while watching");
    eq(watch(e), e.sequence, "flashed the sequence");
    eq(e.status, "YOUR TURN", "your turn");
    eq(R.flashDuration(1), 600, "slow at first");
    eq(R.flashDuration(40), 220, "floor at 220 ms");
});

test("rules: a correct echo scores and adds a step", () => {
    const e = R.createEcho(seededRandom(4));
    watch(e);
    R.press(e, e.sequence[0]);
    eq([e.phase, e.score], ["nice", 1], "round cleared");
    check(R.drainEvents(e).some((ev) => ev.type === "roundclear"), "roundclear event");
    const seen = watch(e);
    eq(e.sequence.length, 2, "one step longer");
    eq(seen, e.sequence, "replays the whole sequence");
});

test("rules: a wrong pad ends it", () => {
    const e = R.createEcho(seededRandom(4));
    watch(e);
    R.press(e, (e.sequence[0] + 1) % 4);
    eq([e.phase, e.status, e.score], ["dead", "WRONG", 0], "dead");
    eq(R.drainEvents(e).map((ev) => ev.type), ["press", "wrong"], "events");
});

test("shell: keys echo, pause freezes playback", () => {
    check(G.screen === "title", "boots to the title");
    press("Enter");
    frames(2);
    eq(G.screen, "playing", "Enter plays");
    eq(text("#hud-status"), "WATCH", "HUD status");
    const e = G.run.echo;
    check(simUntil(() => e.phase === "input", 5000, 16), "your turn");
    press(String(e.sequence[0] + 1));
    frames(1);
    eq(e.score, 1, "key echo scored");
    check(simUntil(() => e.phase === "watch" && e.round === 2, 3000, 16), "round 2");
    frames(2);
    eq(text("#hud-round"), "2", "HUD round");
    press("Escape");
    frames(1);
    eq(G.screen, "pause", "Esc pauses");
    const at = [e.phase, e.watchIndex, e.timer];
    frames(120);
    eq([e.phase, e.watchIndex, e.timer], at, "playback frozen while paused");
    press("Escape");
    frames(1);
    eq(G.screen, "playing", "Esc resumes");
    shot("playing");
});

test("shell: clicks echo, a wrong pad ends the run with NEW BEST", () => {
    G.save.set("highScore", 0);
    const e = G.run.echo;
    check(simUntil(() => e.phase === "input", 5000, 16), "your turn");
    const click = (pad) => {
        const r = padRect(pad, G.api.view.width(), G.api.view.height());
        mouseDown(r.x + r.w / 2, r.y + r.h / 2);
        mouseUp(r.x + r.w / 2, r.y + r.h / 2);
        frames(1);
    };
    for (const pad of e.sequence) click(pad);
    eq(e.score, 2, "clicked echo scored");
    check(simUntil(() => e.phase === "input", 8000, 16), "round 3 your turn");
    click((e.sequence[0] + 1) % 4);
    check(simUntil(() => G.screen === "gameover", 500, 16), "game over");
    const stats = text("#gameover-stats");
    check(/Sequence\s+2\s+·\s+NEW BEST/.test(stats), "NEW BEST on the game-over screen: " + stats);
    eq(G.save.highScore(), 2, "high score saved");
    shot("gameover");
});

done("echo");
