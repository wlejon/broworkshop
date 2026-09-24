// Character vs character (two capsules pushed apart; a player slowed by a
// packed crowd, and not by the same crowd as ghosts) and the innerBody lab
// (the overlap binary, and the 2x2 of innerBody x maxStrength on a ball).

import { check, test, done } from "/lib/kit/test.js";
import { scene, keys, tune, charState, rebuild, teleport, RADIUS, STAND_HALF,
         crowd, crowdState, npcs, setCrowdSize, setCrowdPhysical, resetCrowd, placeNpc, npcPosition, PLAZA,
         ballLab, ballState, launchBall, clearBall, selfOverlap, BALL_LAB } from "/app/lab.js";
import { clearKeys, hold, run } from "/app/tests/helpers.js";

advanceTime(64);
flush();

const standY = RADIUS + STAND_HALF;
const rebuildWith = (o, ms) => { Object.assign(tune, o); rebuild(scene); advanceTime(ms || 32); };

// Wander frozen: steering is the only non-determinism and nothing here tests it.
const wander = crowd.speed;
crowd.speed = 0;

test('two interpenetrating characters push apart with no app collision code', () => {
    setCrowdPhysical(true);
    setCrowdSize(2);
    advanceTime(64);
    check(crowdState.active === 2 && npcs[0].ch && npcs[1].ch, 'two real controllers');
    teleport(PLAZA.x - 14, standY, PLAZA.z);        // the player is not a party to it
    advanceTime(96);
    placeNpc(0, PLAZA.x - 0.10, PLAZA.z);           // 0.20 m apart, 0.60 m capsules
    placeNpc(1, PLAZA.x + 0.10, PLAZA.z);
    const sep = () => { const a = npcPosition(0), b = npcPosition(1); return Math.hypot(a.x - b.x, a.z - b.z); };
    const s0 = sep();
    check(s0 < 0.35, `started overlapping (${s0.toFixed(3)})`);
    const track = [];
    run(900, () => { track.push(sep()); });
    const s1 = sep();
    check(s1 > s0 + 0.15 && s1 > 0.5, `pushed apart: ${s0.toFixed(3)} -> ${s1.toFixed(3)} m`);
    check(Math.min(...track.slice(10)) > s0 * 0.9, 'never fell back to the overlap');
});

test('a packed crowd costs the player ground; the same crowd as ghosts does not', () => {
    const START_Z = PLAZA.z + 7.0, WALK = 2600;
    rebuildWith({ moveSpeed: 4.5 });
    const block = () => {
        let k = 0;
        for (let row = 0; row < 4; ++row)
            for (let col = 0; col < 5; ++col) placeNpc(k++, PLAZA.x + (col - 2) * 0.62, PLAZA.z + 1.2 - row * 0.62);
    };
    const walk = (sample) => {
        teleport(PLAZA.x, standY, START_Z);
        advanceTime(200);
        const z0 = charState.position.z;
        if (sample) { clearKeys(); keys.w = true; run(WALK, sample); clearKeys(); advanceTime(16); }
        else hold(WALK, 'w');
        return Math.abs(charState.position.z - z0);
    };

    setCrowdSize(0);
    advanceTime(64);
    const open = walk();
    check(open > 8, `open ground ${open.toFixed(2)} m`);

    setCrowdPhysical(true);
    setCrowdSize(20);
    advanceTime(32);
    block();
    advanceTime(200);
    check(crowdState.active === 20, `twenty in the block (${crowdState.active})`);
    let minThrough = 1, maxTouch = 0;
    const packed = walk(() => {
        maxTouch = Math.max(maxTouch, crowdState.touchingPlayer);
        if (crowdState.touchingPlayer > 0) minThrough = Math.min(minThrough, crowdState.playerThrough);
    });
    check(packed < open * 0.75, `the crowd cost ground: ${packed.toFixed(2)} vs ${open.toFixed(2)} m`);
    check(maxTouch > 0, `contact made (${maxTouch} at once)`);
    // Progress along the commanded direction, not raw speed (see sampleThrough).
    check(minThrough < 0.8, `throughput fell to ${(minThrough * 100).toFixed(0)}%`);

    setCrowdPhysical(false);
    advanceTime(32);
    block();
    const ghosts = walk();
    check(ghosts > packed + 2, `ghosts cost nothing: ${ghosts.toFixed(2)} vs ${packed.toFixed(2)} m`);
    setCrowdPhysical(true);
    setCrowdSize(0);
    advanceTime(32);
});

crowd.speed = wander;

test('innerBody: an overlap at the character finds it only when the body exists', () => {
    teleport(BALL_LAB.x, standY, BALL_LAB.z);
    advanceTime(200);
    // ballState.selfTag is read page-side each frame. The imported `character`
    // binding is NOT used after a rebuild: a test's view of a page module's
    // `let` export is a snapshot (ENGINE-ISSUES.md).
    rebuildWith({ innerBody: true }, 64);
    const on = selfOverlap();
    check(ballState.selfTag > 0 && on.visible, `innerBody on: tag ${ballState.selfTag}, found`);
    rebuildWith({ innerBody: false }, 64);
    const off = selfOverlap();
    check(ballState.selfTag === -1 && !off.visible, `innerBody off: no body, nothing found [${off.ids}]`);
    const y = charState.position.y;
    hold(500, 'w');
    check(charState.isGrounded && Math.abs(charState.position.y - y) < 0.2, 'still supported by the floor');
    check(Math.abs(charState.position.z - BALL_LAB.z) > 1.0, 'and still walks');
});

// Launched 4.5 m out with gravity off: the only thing that changes where the
// ball ends up is whether something stopped it. The docs imply innerBody makes
// the character solid to a thrown body; it does not — CharacterVirtual
// resolves its dynamic contacts itself, and maxStrength is the real knob.
test('the ball: maxStrength decides it, innerBody does not', () => {
    const shoot = (inner, strength) => {
        rebuildWith({ innerBody: inner, maxStrength: strength }, 64);
        teleport(BALL_LAB.x, standY, BALL_LAB.z);
        clearKeys();
        advanceTime(240);
        launchBall({ x: 0, z: -1 });
        run(1500);
        const r = { past: ballState.past, verdict: ballState.verdict, minDist: ballState.minDist };
        clearBall();
        advanceTime(32);
        return r;
    };
    const ss = shoot(true, 400), su = shoot(false, 400), ws = shoot(true, 0), wu = shoot(false, 0);
    console.log(`  ball past the character: 400 N ${ss.past.toFixed(2)} (${ss.verdict}) / ${su.past.toFixed(2)}; ` +
        `0 N ${ws.past.toFixed(2)} (${ws.verdict}) / ${wu.past.toFixed(2)}`);
    check(ws.past > 6 && ws.verdict === 'PASSED THROUGH', `0 N: sailed ${ws.past.toFixed(2)} m (${ws.verdict})`);
    check(ss.past < 1.0 && ss.verdict === 'BLOCKED', `400 N: ${ss.past.toFixed(2)} m (${ss.verdict})`);
    check(ss.minDist >= RADIUS + ballLab.radius - 0.12, `never inside the capsule (${ss.minDist.toFixed(3)})`);
    const strength = ws.past - ss.past;
    check(ss.verdict === su.verdict && ws.verdict === wu.verdict, 'innerBody never changes the verdict');
    check(Math.abs(ss.past - su.past) < 0.1, 'innerBody barely moves the blocked ball');
    check(Math.abs(ws.past - wu.past) * 10 < strength, 'maxStrength matters 10x more than innerBody');
    rebuildWith({ maxStrength: 400, innerBody: true });
});

test('the crowd comes back on the plaza', () => {
    setCrowdSize(18);
    setCrowdPhysical(true);
    resetCrowd();
    advanceTime(400);
    check(crowdState.active === 18, `crowd restored (${crowdState.active})`);
});

done('character-lab crowd + ball');
