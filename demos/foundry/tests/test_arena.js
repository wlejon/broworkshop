// demos/foundry/tests/test_arena.js — Fast headless Box3D combat & Metropolis-seam
// destruction verification for compiled machines.

import { test, check, done } from "/lib/kit/test.js";
import { createStarterLibrary } from "/lib/foundry/presets.js";
import { compileBlueprint } from "/lib/foundry/compiler.js";
import { createArena } from "/lib/foundry/arena.js";

const lib = createStarterLibrary();

test('Box3D duel: Fused Shredder vs Iron Wedge — fast sim, real collisions, gearbox protected', () => {
    const t0 = performance.now();
    const arena = createArena({ obstacles: true });
    const safe = compileBlueprint(lib.bot_shredder_safe, lib);
    const wedge = compileBlueprint(lib.bot_iron_wedge, lib);
    const b0 = arena.spawnBot(safe, { position: [-2.2, 0.2, 0], yaw: Math.PI / 2, controller: 'duelist' });
    const b1 = arena.spawnBot(wedge, { position: [2.2, 0.2, 0], yaw: -Math.PI / 2, controller: 'duelist' });

    // Run 6 seconds of live 60 Hz Box3D + compiled runtime physics!
    let maxSpeed = 0;
    let totalFx = 0;
    for (let i = 0; i < 360; i++) {
        arena.step(1 / 60);
        const v0 = arena.world.velocity(b0.chassisBody);
        maxSpeed = Math.max(maxSpeed, Math.hypot(v0[0], v0[2]));
        totalFx += arena.fxEvents.length;
    }
    const wallMs = performance.now() - t0;
    const p0 = arena.world.pose(b0.chassisBody);
    const p1 = arena.world.pose(b1.chassisBody);
    const aut0 = b0.runtime.getAutopsy();
    const gearSafe = b0.runtime.partState.get('weapon/gb/stage1');

    check(Number.isFinite(p0[0] + p0[1] + p1[0] + p1[1]), 'finite poses after 6s duel');
    check(maxSpeed > 1.2, `bots drove with real speed (max ${maxSpeed.toFixed(2)} m/s)`);
    check(b0.hitsDealt + b0.hitsTaken + b1.hitsTaken > 0, `bots clashed in Box3D (fx=${totalFx})`);
    check(!gearSafe.failed, 'Fused Shredder gearbox survived live combat duel!');
    check(wallMs < 1500, `6s Box3D duel ran fast (${wallMs.toFixed(0)} ms wall)`);

    console.log(`    6s Duel A in ${wallMs.toFixed(0)} ms: maxV=${maxSpeed.toFixed(2)} m/s, hits=${b0.hitsDealt}/${b0.hitsTaken}, fusedEvents=${b0.runtime.events.length}, repair=$${aut0.repairCost.toFixed(0)}, gearboxFailed=${gearSafe.failed}`);
    for (const ev of b0.runtime.events.slice(0, 5)) {
        console.log(`      t=${ev.t}s [${ev.severity}] ${ev.path}: ${ev.reason} (${ev.cascade})`);
    }
    arena.destroy();
});

test('Box3D duel: Glass Cannon vs Iron Wedge — unprotected spinner suffers real combat damage/wear', () => {
    const arena = createArena({ obstacles: false });
    const raw = compileBlueprint(lib.bot_shredder_raw, lib);
    const wedge = compileBlueprint(lib.bot_iron_wedge, lib);
    const b0 = arena.spawnBot(raw, { position: [-2.0, 0.2, 0], yaw: Math.PI / 2, controller: 'duelist' });
    const b1 = arena.spawnBot(wedge, { position: [2.0, 0.2, 0], yaw: -Math.PI / 2, controller: 'duelist' });

    for (let i = 0; i < 360; i++) arena.step(1 / 60);

    const aut0 = b0.runtime.getAutopsy();
    const gearRaw = b0.runtime.partState.get('weapon/gb/stage1');
    const outBrg = b0.runtime.partState.get('weapon/gb/out_brg');
    check(b0.hitsDealt + b0.hitsTaken > 0, 'Glass Cannon clashed with Iron Wedge');
    check(b0.runtime.events.length > 0 || gearRaw.maxStressSeen > 0.5 || outBrg.wear > 0.01,
        'Glass Cannon recorded real internal stress/wear/events from Box3D impacts');
    console.log(`    6s Duel B: hits=${b0.hitsDealt}/${b0.hitsTaken}, gearFailed=${gearRaw.failed}, gearMaxStress=${(gearRaw.maxStressSeen * 100).toFixed(0)}%, bushingWear=${(outBrg.wear * 100).toFixed(1)}%, repair=$${aut0.repairCost.toFixed(0)}`);
    arena.destroy();
});

test('Metropolis seam: compiled bot smashes bro.dynamics::Structure concrete arena pillar', () => {
    const arena = createArena({
        obstacles: true,
        pillarPositions: [{ x: 0, z: 0, w: 0.9, h: 0.9, d: 0.35 }],
    });
    const safe = compileBlueprint(lib.bot_shredder_safe, lib);
    const bot = arena.spawnBot(safe, { position: [0, 0.2, -3.2], yaw: 0, controller: 'pillar_ram' });
    const st = arena.structures[0].structure;
    const beforeStanding = st.counts.standing;

    for (let i = 0; i < 240; i++) arena.step(1 / 60);

    const after = st.counts;
    check(after.standing < beforeStanding, `bot broke concrete structure (${beforeStanding} -> ${after.standing} standing, ${after.pieces} loose pieces)`);
    console.log(`    Pillar smash: standing ${beforeStanding} -> ${after.standing} cells, loose pieces=${after.pieces}, bot events=${bot.runtime.events.length}`);
    arena.destroy();
});

test('Multi-pass BattleBots AI: bots flank, charge, retreat, and re-engage across 12s without deadlocking', () => {
    const arena = createArena({ obstacles: true });
    const goliath = compileBlueprint(lib.bot_goliath_twin_v4, lib);
    const fang = compileBlueprint(lib.bot_fang_crusher, lib);
    const b0 = arena.spawnBot(goliath, { position: [-2.4, 0.22, 0], yaw: Math.PI / 2, controller: 'duelist' });
    const b1 = arena.spawnBot(fang, { position: [2.4, 0.22, 0], yaw: -Math.PI / 2, controller: 'duelist' });

    const statesSeen = new Set();
    let activeMotionLate = 0;
    for (let i = 0; i < 12 * 60; i++) {
        arena.step(1 / 60);
        statesSeen.add(b0.ai.state);
        statesSeen.add(b1.ai.state);
        if (i >= 7 * 60) {
            const v0 = arena.world.velocity(b0.chassisBody);
            const v1 = arena.world.velocity(b1.chassisBody);
            if (Math.hypot(v0[0], v0[2]) > 0.6 || Math.hypot(v1[0], v1[2]) > 0.6) activeMotionLate++;
        }
    }
    check(statesSeen.has('charge') && statesSeen.has('retreat') && statesSeen.has('flank_spin'),
        `AI cycled multi-pass combat states (saw: ${[...statesSeen].join(', ')})`);
    check(activeMotionLate > 120, `bots remained actively fighting in seconds 7..12 (active frames=${activeMotionLate}/300)`);
    check(b0.hitsDealt + b1.hitsDealt + b0.hitsTaken >= 3, `multi-pass impacts occurred (${b0.hitsDealt}/${b1.hitsDealt})`);
    console.log(`    12s Multi-pass Brawl (Goliath vs Iron Fang): states=[${[...statesSeen].join(',')}], hits=${b0.hitsDealt}/${b1.hitsDealt}, lateActive=${activeMotionLate}/300`);
    arena.destroy();
});

test('Impact survivability: heavy industrial Excavator & Haul Tractor survive 10s of real impacts intact', () => {
    const arena = createArena({ obstacles: true });
    const exc = compileBlueprint(lib.mach_excavator_crawler, lib);
    const trk = compileBlueprint(lib.mach_haul_tractor, lib);
    const b0 = arena.spawnBot(exc, { position: [-2.2, 0.25, 0], yaw: Math.PI / 2, controller: 'duelist' });
    const b1 = arena.spawnBot(trk, { position: [2.2, 0.25, 0], yaw: -Math.PI / 2, controller: 'duelist' });

    for (let i = 0; i < 10 * 60; i++) arena.step(1 / 60);

    const aut0 = b0.runtime.getAutopsy();
    const aut1 = b1.runtime.getAutopsy();
    check(b0.hitsDealt + b0.hitsTaken + b1.hitsTaken >= 3, `industrial machines clashed (${b0.hitsDealt}/${b0.hitsTaken})`);
    check(aut0.failed.length === 0, `Excavator survived 10s intact (failed: ${aut0.failed.map((f) => `${f.label}:${f.reason}`).join(', ')})`);
    check(aut1.failed.length === 0, `Haul Tractor survived 10s intact (failed: ${aut1.failed.map((f) => `${f.label}:${f.reason}`).join(', ')})`);
    console.log(`    10s Industrial Survivability: Excavator hits=${b0.hitsDealt}/${b0.hitsTaken} failed=${aut0.failed.length}, Tractor hits=${b1.hitsDealt}/${b1.hitsTaken} failed=${aut1.failed.length}`);
    arena.destroy();
});

done('foundry-arena');
