// FPS Arena wire format: every packet the client and server exchange
// round-trips through protocol.js, and the movement/collision the client
// predicts with is the server's own.
import { test, eq, near, check, done } from "/lib/kit/test.js";
import {
    MSG, EVT, IN, encodeInput, encodeSetName, decodeClientMessage, encodeWelcome, encodeState,
    encodeEvent, encodeSpawn, encodeNames, decodeMessage,
} from "/app/protocol.js";
import { stepMove, collide, rayAABB, rayCylinder, solidHit, OBSTACLES, ARENA_HALF, PLAYER_RADIUS, WALL_THICK } from "/app/arena.js";

test("input round-trips", () => {
    const buf = encodeInput(123456, IN.FWD | IN.SHOOT, 1.25, -0.5);
    eq(buf.byteLength, 14, "input size");
    const m = decodeClientMessage(buf);
    eq(m.type, "input");
    eq(m.tick, 123456);
    eq(m.keys, IN.FWD | IN.SHOOT);
    near(m.yaw, 1.25, 1e-6, "yaw");
    near(m.pitch, -0.5, 1e-6, "pitch");
});

test("name message decodes, junk does not", () => {
    eq(decodeClientMessage(encodeSetName("Ünïcode")), { type: "set_name", name: "Ünïcode" });
    eq(decodeClientMessage(new TextEncoder().encode("{oops").buffer), null);
    eq(decodeClientMessage(new Uint8Array([MSG.INPUT, 1, 2]).buffer), null);
});

test("welcome round-trips", () => {
    eq(decodeMessage(encodeWelcome(42, 9000)), { type: "welcome", id: 42, serverTick: 9000 });
    // bro.net connection handles use all 32 bits; a 16-bit id field never matched.
    eq(decodeMessage(encodeWelcome(4237698328, 1)).id, 4237698328, "full 32-bit connection id");
    eq(decodeMessage(encodeEvent(EVT.HIT, 4237698328, 10000, 25)).killerId, 4237698328, "32-bit ids in events");
});

test("state round-trips every player", () => {
    const players = [
        { id: 1, x: 1.5, y: 0, z: -2.25, yaw: 0.5, health: 75, alive: true, firing: true, kills: 3 },
        { id: 10001, x: -16, y: 0, z: 16, yaw: -3, health: 0, alive: false, firing: false, kills: 0 },
    ];
    const buf = encodeState(77, 70, players);
    eq(buf.byteLength, 10 + 24 * 2, "state size");
    const m = decodeMessage(buf);
    eq(m.type, "state");
    eq([m.serverTick, m.lastInputTick, m.players.length], [77, 70, 2]);
    for (let i = 0; i < 2; i++) {
        const a = players[i], b = m.players[i];
        eq([b.id, b.health, b.alive, b.firing, b.kills], [a.id, a.health, a.alive, a.firing, a.kills]);
        near(b.x, a.x, 1e-5); near(b.z, a.z, 1e-5); near(b.yaw, a.yaw, 1e-5);
    }
});

test("events round-trip", () => {
    eq(decodeMessage(encodeEvent(EVT.KILL, 5, 10002, 0)),
       { type: "event", evt: EVT.KILL, killerId: 5, victimId: 10002, value: 0 });
    eq(decodeMessage(encodeEvent(EVT.HIT, 10000, 5, 25)).value, 25);
    const s = decodeMessage(encodeSpawn(-16, 16));
    eq([s.evt, s.x, s.z], [EVT.SPAWN, -16, 16]);
});

test("names round-trip, including multi-byte text", () => {
    const entries = [{ id: 3, name: "Jonny" }, { id: 10000, name: "Alpha (bot)" }, { id: 4000000000, name: "日本" }];
    eq(decodeMessage(encodeNames(entries)).entries, entries);
});

test("truncated packets decode to null, not garbage", () => {
    eq(decodeMessage(new Uint8Array([MSG.WELCOME, 1]).buffer), null);
    eq(decodeMessage(new Uint8Array([]).buffer), null);
    eq(decodeMessage(new Uint8Array([0x7f]).buffer), null);
});

test("walking forward covers MOVE_SPEED metres a second and stops at walls", () => {
    const p = { x: 0, z: 10 };
    for (let i = 0; i < 60; i++) stepMove(p, IN.FWD, Math.PI / 2, 1 / 60);   // yaw π/2 = +X
    near(p.x, 6, 0.01, "6 m east in 1 s");
    near(p.z, 10, 1e-6, "no drift");
    for (let i = 0; i < 600; i++) stepMove(p, IN.FWD, Math.PI / 2, 1 / 60);
    near(p.x, ARENA_HALF - PLAYER_RADIUS - WALL_THICK, 1e-6, "stopped at the east wall");
});

test("diagonals are normalised", () => {
    const p = { x: 0, z: 10 };
    stepMove(p, IN.FWD | IN.RIGHT, 0, 0.1);
    near(Math.hypot(p.x, p.z - 10), 0.6, 1e-6, "0.6 m in 0.1 s either way");
});

test("collision pushes a player out of an obstacle", () => {
    const o = OBSTACLES[0];
    const p = { x: o.x, z: o.z };
    collide(p);
    const inside = Math.abs(p.x - o.x) < o.hw + PLAYER_RADIUS - 1e-6 && Math.abs(p.z - o.z) < o.hd + PLAYER_RADIUS - 1e-6;
    check(!inside, "pushed clear: " + JSON.stringify(p));
});

test("rays hit boxes and cylinders where they should", () => {
    const box = { x: 5, z: 0, hw: 1, hd: 1, hh: 1 };
    near(rayAABB(0, 1, 0, 1, 0, 0, box), 4, 1e-9, "front face at 4 m");
    eq(rayAABB(0, 3, 0, 1, 0, 0, box), -1, "passes over the top");
    near(rayCylinder(0, 1, 0, 1, 0, 0, 5, 0, 0.5, 1.8), 4.5, 1e-9, "cylinder surface");
    eq(rayCylinder(0, 2, 0, 1, 0, 0, 5, 0, 0.5, 1.8), -1, "over the head");
    near(solidHit(0, 1.6, 10, 0, 0, -1), 10 - 1, 1e-9, "the centre pillar blocks at z = 1");
});

done("fps protocol");
