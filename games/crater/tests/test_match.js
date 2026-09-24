// Crater's rules (match.js) and physics (shared.js), run in-process with a
// fake room and a fake clock: lobby, bots, turn order, shots, craters,
// damage, the win, and the return to the lobby.
import { test, eq, check, near, done } from "/lib/kit/test.js";
import { createMatch, MAX_PLAYERS, RETURN_TO_LOBBY_MS } from "/app/match.js";
import {
    C, generateHeightmap, heightAt, simulateShot, carveCrater, applyCraterDiff, blastDamage,
    muzzleOrigin, launchVelocity,
} from "/app/shared.js";

/** A match with a recording room and a manual clock. */
function harness() {
    const sent = [];
    let t = 0;
    const timers = [];
    const match = createMatch({
        log: () => {},
        random: () => 0.37,
        now: () => t,
        setTimeout: (fn, ms) => timers.push({ at: t + ms, fn }),
        room: {
            send: (id, tag, msg) => sent.push({ to: id, tag, msg }),
            broadcast: (tag, msg) => sent.push({ to: "*", tag, msg: JSON.parse(JSON.stringify(msg)) }),
        },
    });
    const advance = (ms) => {
        const end = t + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            if (!timers.length || timers[0].at > end) break;
            const next = timers.shift();
            t = next.at;
            next.fn();
        }
        t = end;
    };
    const last = (tag) => sent.filter((s) => s.tag === tag).pop();
    return { match, sent, advance, last };
}

test("terrain is deterministic and inside its bounds", () => {
    const a = generateHeightmap(1234), b = generateHeightmap(1234), c = generateHeightmap(99);
    eq(Array.from(a), Array.from(b), "same seed, same hills");
    check(Array.from(a).some((h, i) => h !== c[i]), "different seed, different hills");
    check(Array.from(a).every((h) => h >= 4 && h <= C.MAX_H - 4), "heights clamped");
    near(heightAt(a, 0), a[0], 1e-6, "left edge");
});

test("a shell falls, digs a crater, and the diff reproduces it", () => {
    const hm = generateHeightmap(7);
    const o = muzzleOrigin(hm, 20, Math.PI / 4, 1);
    const v = launchVelocity(Math.PI / 4, 0.5, 1);
    const shot = simulateShot(hm, o.x, o.y, v.vx, v.vy);
    check(shot.hit && shot.x > 20, "lands downrange at x=" + shot.x.toFixed(1));
    check(shot.path.length > 4, "records a path");
    const before = heightAt(hm, shot.x);
    const copy = Float32Array.from(hm);
    const diff = carveCrater(hm, shot.x, shot.y, C.CRATER_RAD);
    check(diff.length > 0 && heightAt(hm, shot.x) < before - 2, "ground dug out");
    applyCraterDiff(copy, diff);
    eq(Array.from(copy), Array.from(hm), "client applying the diff gets the server's terrain");
    eq(blastDamage(0, 0, 0, 0), C.MAX_DAMAGE, "full damage at the centre");
    eq(blastDamage(0, 0, C.BLAST_RADIUS, 0), 0, "none at the radius");
});

test("lobby: host, bots, ready gate, start", () => {
    const { match, last } = harness();
    match.join(1, "Ann");
    match.join(2, "Bob");
    eq(last("state").msg.hostId, 1, "first in hosts");
    check(!match.addBot(2), "only the host adds bots");
    const bot = match.addBot(1);
    check(bot && bot.bot && bot.ready, "bots are always ready");
    check(!match.start(1), "not everyone is ready");
    match.setReady(1, true);
    match.setReady(2, true);
    check(!match.start(2), "only the host starts");
    check(match.start(1), "host starts once all humans are ready");
    const m = last("match").msg;
    eq(m.players.length, 3, "three tanks");
    eq(m.hm.length, C.COLS, "terrain sent");
    check(m.players.every((p) => p.x > 5 && p.x < C.WORLD_W - 5), "tanks placed inside the margins");
    eq(match.admit(), "Match in progress — try later", "late joiners refused");
});

test("the lobby fills up", () => {
    const { match } = harness();
    for (let i = 1; i <= MAX_PLAYERS; i++) match.join(i, "P" + i);
    eq(match.admit(), "Server full");
});

test("turns, shots, damage and a bot's reply", () => {
    const { match, sent, advance, last } = harness();
    match.join(1, "Ann");
    match.addBot(1);
    match.setReady(1, true);
    match.start(1);
    const st = match.state;
    const shooterId = st.turn;
    check(match.fire(shooterId === 1 ? 2 : 1, { angle: 1, power: 0.5, dir: 1 }) === null, "out of turn: ignored");

    // Whoever's turn it is: if it is the bot, let it fire; then it is ours.
    if (shooterId !== 1) advance(C.BOT_DELAY + 10);
    eq(st.turn, 1, "our turn");
    const me = st.players.get(1);
    const bot = Array.from(st.players.values()).find((p) => p.bot);
    const shot = match.fire(1, { angle: Math.PI / 4, power: 0.6, dir: bot.x > me.x ? 1 : -1 });
    check(shot && last("shot").msg.shooter === 1, "shot broadcast");
    near(shot.flightMs, last("shot").msg.flightMs, 1e-9);
    eq(st.turn, bot.id, "turn passes to the bot");
    const shotsBefore = sent.filter((s) => s.tag === "shot").length;
    advance(C.BOT_DELAY - 10);
    eq(sent.filter((s) => s.tag === "shot").length, shotsBefore, "the bot waits for our shell to land first");
    advance(shot.flightMs + 20);
    eq(sent.filter((s) => s.tag === "shot").length, shotsBefore + 1, "then fires back");
    const reply = last("shot").msg;
    eq(reply.shooter, bot.id, "bot's shot");
    check(reply.nextTurn === 1 || reply.nextTurn === null, "back to us (or the match is over)");
});

test("the last tank standing wins; the lobby comes back", () => {
    const { match, advance, last } = harness();
    match.join(1, "Ann");
    match.addBot(1);
    match.setReady(1, true);
    match.start(1);
    const st = match.state;
    const bot = Array.from(st.players.values()).find((p) => p.bot);
    bot.hp = 1;                                  // one more hit ends it
    if (st.turn !== 1) advance(C.BOT_DELAY + 10);
    // Drop a shell straight onto the bot: search the power for a hit near it.
    const me = st.players.get(1), dir = bot.x > me.x ? 1 : -1;
    let best = null;
    for (let pw = 0.05; pw <= 1; pw += 0.005) {
        for (const ang of [0.5, 0.7, 0.9, 1.1]) {
            const o = muzzleOrigin(st.hm, me.x, ang, dir), v = launchVelocity(ang, pw, dir);
            const r = simulateShot(st.hm, o.x, o.y, v.vx, v.vy, { recordPath: false });
            if (r.hit && (!best || Math.abs(r.x - bot.x) < Math.abs(best.x - bot.x))) best = { x: r.x, ang, pw };
        }
    }
    const shot = match.fire(1, { angle: best.ang, power: best.pw, dir });
    check(shot.dead.includes(bot.id), "the bot dies");
    eq(shot.nextTurn, null, "no next turn");
    eq(st.phase, "ended");
    check(!last("over"), "the result waits for the shell to land");
    advance(shot.flightMs + 600);
    eq(last("over").msg, { winnerId: 1, winnerName: "Ann" });
    advance(RETURN_TO_LOBBY_MS);
    eq(st.phase, "lobby", "back to the lobby");
    const lobby = last("state").msg;
    eq(lobby.players.length, 1, "bots cleared");
    eq(lobby.players[0].ready, false, "humans unready again");
});

test("a leaver mid-match hands the turn on and can end the match", () => {
    const { match, advance, last } = harness();
    match.join(1, "Ann");
    match.join(2, "Bob");
    match.join(3, "Cy");
    for (const id of [1, 2, 3]) match.setReady(id, true);
    match.start(1);
    const st = match.state;
    const leaver = st.turn;
    match.leave(leaver);
    check(st.turn !== leaver && st.players.has(st.turn), "turn moved to a player still here");
    eq(last("state").msg.phase, "match", "roster update is a match snapshot");
    const left = st.aliveOrder.filter((id) => id !== st.turn)[0];
    match.leave(left);
    eq(st.phase, "ended", "one tank left: over");
    advance(10);
    eq(last("over").msg.winnerId, st.turn);
});

test("a stalled human turn is skipped", () => {
    const { match, advance, last } = harness();
    match.join(1, "Ann");
    match.join(2, "Bob");
    match.setReady(1, true);
    match.setReady(2, true);
    match.start(1);
    const first = match.state.turn;
    advance(C.TURN_TIMEOUT + 1);
    match.checkTimeout();
    const skip = last("skip").msg;
    eq(skip.prevTurn, first);
    check(skip.nextTurn !== first && match.state.turn === skip.nextTurn, "next player's turn");
});

done("crater match");
