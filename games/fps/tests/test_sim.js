// FPS Arena match simulation (sim.js + bots.js), run in-process with a fake
// `send`: joining, naming, authoritative movement, hitscan, death, respawn,
// and bots that actually hunt and kill.
import { test, eq, near, check, done } from "/lib/kit/test.js";
import { createMatch, MAX_HEALTH, HIT_DAMAGE, RESPAWN_SECS } from "/app/sim.js";
import { decodeMessage, encodeInput, encodeSetName, EVT, IN } from "/app/protocol.js";

const DT = 1 / 60;

/** A match whose outbound packets are decoded into per-connection inboxes. */
function harness(bots) {
    const inbox = new Map();
    let seed = 1;
    const match = createMatch({
        bots,
        log: () => {},
        random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
        send: (id, buf) => {
            if (!inbox.has(id)) inbox.set(id, []);
            inbox.get(id).push(decodeMessage(buf));
        },
    });
    const take = (id, pred) => (inbox.get(id) || []).filter(pred);
    const clear = () => inbox.clear();
    return { match, inbox, take, clear };
}

test("a joining client is welcomed, spawned and named", () => {
    const { match, take } = harness(3);
    match.join(1);
    check(take(1, (m) => m.type === "welcome" && m.id === 1).length === 1, "welcome");
    const spawn = take(1, (m) => m.type === "event" && m.evt === EVT.SPAWN)[0];
    const p = match.players.get(1);
    check(spawn && spawn.x === p.x && spawn.z === p.z, "spawn event at the player's position");
    match.message(1, encodeSetName("Tester"));
    const names = take(1, (m) => m.type === "names").pop();
    eq(names.entries.length, 4, "three bots + me");
    check(names.entries.some((e) => e.id === 1 && e.name === "Tester"), "renamed");
    check(names.entries.filter((e) => /\(bot\)$/.test(e.name)).length === 3, "bots named");
});

test("the server moves a player from its input, one tick at a time", () => {
    const { match, take } = harness(0);
    const p = match.join(1);
    p.x = 0; p.z = 10;
    match.message(1, encodeInput(1, IN.FWD, Math.PI / 2, 0));
    for (let i = 0; i < 30; i++) match.tick(DT);
    near(p.x, 3, 0.01, "half a second east at 6 m/s");
    const state = take(1, (m) => m.type === "state").pop();
    eq(state.lastInputTick, 1, "acknowledges the input tick");
    near(state.players.find((q) => q.id === 1).x, p.x, 1e-5, "state carries the position");
});

test("hitscan: four hits kill, the kill is broadcast, the victim respawns", () => {
    const { match, take } = harness(0);
    const a = match.join(1), b = match.join(2);
    Object.assign(a, { x: 0, z: 10 });
    Object.assign(b, { x: 0, z: 14 });
    // Face +Z (yaw π looks down +Z) and tap the trigger four times.
    for (let shot = 0; shot < 4; shot++) {
        match.message(1, encodeInput(shot * 2 + 1, IN.SHOOT, Math.PI, 0));
        match.tick(DT);
        match.message(1, encodeInput(shot * 2 + 2, 0, Math.PI, 0));
        for (let i = 0; i < 12; i++) match.tick(DT);         // past the cooldown
        if (shot < 3) eq(b.health, MAX_HEALTH - HIT_DAMAGE * (shot + 1), "hit " + (shot + 1));
    }
    check(!b.alive, "dead after four hits");
    eq(a.kills, 1, "shooter credited");
    check(take(2, (m) => m.type === "event" && m.evt === EVT.HIT).length === 4, "victim told of each hit");
    check(take(1, (m) => m.type === "event" && m.evt === EVT.KILL && m.victimId === 2).length === 1, "kill broadcast");
    for (let i = 0; i < Math.ceil(RESPAWN_SECS / DT) + 2; i++) match.tick(DT);
    check(b.alive && b.health === MAX_HEALTH, "respawned at full health");
    check(take(2, (m) => m.type === "event" && m.evt === EVT.SPAWN).length === 2, "spawn event on respawn");
});

test("holding the trigger fires once, not every tick", () => {
    const { match } = harness(0);
    const a = match.join(1), b = match.join(2);
    Object.assign(a, { x: 0, z: 10 });
    Object.assign(b, { x: 0, z: 14 });
    match.message(1, encodeInput(1, IN.SHOOT, Math.PI, 0));
    for (let i = 0; i < 60; i++) match.tick(DT);
    eq(b.health, MAX_HEALTH - HIT_DAMAGE, "one shot per press");
});

test("walls stop bullets", () => {
    const { match } = harness(0);
    const a = match.join(1), b = match.join(2);
    Object.assign(a, { x: 0, z: 4 });        // the centre pillar spans z -1..1
    Object.assign(b, { x: 0, z: -4 });
    match.message(1, encodeInput(1, IN.SHOOT, 0, 0));
    match.tick(DT);
    eq(b.health, MAX_HEALTH, "no damage through the pillar");
});

test("bots hunt: they move, aim, and score kills among themselves", () => {
    const { match } = harness(3);
    const bots = Array.from(match.players.values());
    const start = bots.map((p) => ({ x: p.x, z: p.z }));
    let kills = 0;
    for (let i = 0; i < 60 * 60; i++) match.tick(DT);         // one simulated minute
    for (const p of bots) kills += p.kills;
    const moved = bots.filter((p, i) => Math.hypot(p.x - start[i].x, p.z - start[i].z) > 1).length;
    check(moved >= 2, moved + " bots moved");
    check(kills >= 1, kills + " kills in a minute of bot deathmatch");
    const states = new Set(Array.from(match.bots.list.values(), (b) => b.state));
    console.log("  bot kills " + kills + ", states now " + Array.from(states).join(","));
});

done("fps sim");
