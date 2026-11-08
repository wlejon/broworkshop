// The flock brain (lab/flock.bk) does what its behaviours say, on the GPU,
// for a group of deer with no scene (the brain and the rig alone):
//   graze   most stand grazing or walk slowly; none leaves the field; they
//           keep apart (few closer than 80 cm)
//   travel  they move at about a trot, heading the same way
//   flee    before the threat nobody runs; once it crosses, the alarm spreads
//           (more are alarmed than are near it), those alarmed 2 s are
//           running away from it, and some gallop
//   grid    the neighbour grid's lists hold every creature once, each in
//           the cell its position is in
//   scripts/validate.sh tools/creature-lab/tests/test_flock.js

import { check, test, done } from "/lib/kit/test.js";
import { loadCreature } from "/app/lab/creature.js";
import { Flock } from "/app/lab/flock.js";
import { groundEnv } from "/app/lab/scenarios.js";
import { TELE, T, GAIT } from "/app/lab/contract.js";

globalThis.creatureLab?.dispose?.();
const deer = await loadCreature('deer');
const DT = 1 / 120;

function run(flock, seconds) { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) flock.step(DT); }

function sample(flock) {
    const tele = flock.readTele(), mind = flock.readMind(), n = flock.count;
    const out = [];
    for (let i = 0; i < n; i++) {
        const o = i * TELE;
        out.push({ x: tele[o + T.POS], z: tele[o + T.POS + 2], yaw: tele[o + T.YAW], speed: tele[o + T.SPEED], gait: tele[o + T.GAIT],
            alarm: mind[i * flock.b.MIND + 2], since: mind[i * flock.b.MIND + 3] });
    }
    return out;
}

function make(behaviour, count) {
    const f = new Flock(deer, count, { behaviour });
    f.setGround(groundEnv({}));
    return f;
}

await test('graze: a loose herd that stays on its field', () => {
    const f = make('graze', 120);
    run(f, 8);
    const s = sample(f);
    const slow = s.filter((c) => c.speed < 1.6).length;
    check(slow > 0.9 * s.length, `${slow}/${s.length} slow`);
    const off = s.filter((c) => Math.hypot(c.x, c.z) > f.radius + 2).length;
    check(off === 0, `${off} off the field`);
    let close = 0;
    for (const a of s) if (s.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 0.8)) close++;
    check(close < 0.12 * s.length, `${close} closer than 80 cm to another`);
    f.destroy();
});

await test('travel: together, at about a trot', () => {
    const f = make('travel', 120);
    run(f, 8);
    const s = sample(f);
    const trot = s.filter((c) => c.gait >= GAIT.WALK && c.speed > 1.5).length;
    check(trot > 0.6 * s.length, `${trot}/${s.length} moving at pace`);
    // Their headings agree: the mean heading vector is long.
    let hx = 0, hz = 0;
    for (const c of s) { hx += Math.sin(c.yaw); hz += Math.cos(c.yaw); }
    const agree = Math.hypot(hx, hz) / s.length;
    check(agree > 0.6, `heading agreement ${agree.toFixed(2)}`);
    f.destroy();
});

await test('flee: the alarm spreads and they gallop', () => {
    const f = make('flee', 200);
    run(f, 3.5);
    let s = sample(f);
    check(s.every((c) => c.alarm < 0.01), 'nobody alarmed before the threat');
    // The threat comes in from outside at 9 m/s and reaches the middle a few seconds later.
    run(f, 7);
    s = sample(f);
    const th = f.threat;
    check(th, 'a threat is crossing');
    const alarmed = s.filter((c) => c.alarm > 0.5).length;
    const near = s.filter((c) => Math.hypot(c.x - th.x, c.z - th.z) < 9).length;
    check(alarmed > near, `${alarmed} alarmed, ${near} near the threat now`);
    // Those alarmed 2 s or more are running away from it: past a walk,
    // heading off its side. (Most, not all: the deer's rig gathers speed at
    // 1.6 m/s^2 from a stand, so a few are still getting going.)
    const going = s.filter((c) => c.alarm > 0.5 && c.since > 2);
    const away = going.filter((c) => c.speed > 2.5 && Math.sin(c.yaw) * (c.x - th.x) + Math.cos(c.yaw) * (c.z - th.z) > 0).length;
    const gallop = s.filter((c) => c.gait === GAIT.GALLOP).length;
    console.log(`flee: ${alarmed} alarmed, ${near} near, ${away} of ${going.length} alarmed 2 s running away, ${gallop} galloping`);
    check(going.length > 10 && away > 0.7 * going.length, `${away} of ${going.length} alarmed 2 s running away`);
    check(gallop > 0, `${gallop} galloping`);
    f.destroy();
});

await test('grid: every creature is listed once, in its own cell', () => {
    const f = make('mill', 300);
    run(f, 2);
    // Bin the positions as they are now, then read the lists back.
    f.b.clear.dispatch(f.grid * f.grid, f.headBuf);
    f.b.bin.dispatch(f.count, f.batch.teleBuf, f.paramsBuf, f.headBuf, f.nextBuf);
    const tele = f.readTele();
    const head = new Int32Array(f.headBuf.read(new Float32Array(f.grid * f.grid)).buffer);
    const next = new Int32Array(f.nextBuf.read(new Float32Array(f.count)).buffer);
    const SEE = f.b.SEE, n = f.count, G = f.grid, o = -0.5 * SEE * G;
    const cellOf = (x, z) => Math.min(G - 1, Math.max(0, Math.floor((z - o) / SEE))) * G + Math.min(G - 1, Math.max(0, Math.floor((x - o) / SEE)));
    const on = new Uint8Array(n);
    let listed = 0, wrong = 0, cells = 0;
    for (let c = 0; c < G * G; c++) {
        if (head[c] >= 0) cells++;
        for (let j = head[c], g = 0; j >= 0 && g <= n; j = next[j], g++) {
            on[j]++; listed++;
            if (cellOf(tele[j * TELE + T.POS], tele[j * TELE + T.POS + 2]) !== c) wrong++;
        }
    }
    check(listed === n && on.every((v) => v === 1), `${listed} listed of ${n}`);
    check(wrong === 0, `${wrong} listed in a cell not their own`);
    check(cells > 10, `${cells} cells in use`);
    f.destroy();
});

done('flock');
