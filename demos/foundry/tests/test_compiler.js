// demos/foundry/tests/test_compiler.js — Headless verification of the recursive
// Foundry compiler, virtual dyno, fail-safe cascades, wear rates, and 3-tier scaling.

import { test, check, done } from "/lib/kit/test.js";
import { createStarterLibrary } from "/lib/foundry/presets.js";
import { compileBlueprint } from "/lib/foundry/compiler.js";
import { auditMachineMotion } from "/lib/foundry/motion_audit.js";
import { createMachineRuntime } from "/lib/foundry/runtime.js";

const lib = createStarterLibrary();

test('compile all 46 starter blueprints across 3 scale tiers with ZERO spatial interference', () => {
    const ids = Object.keys(lib);
    check(ids.length >= 46, `expected >= 46 presets, got ${ids.length}`);
    for (const id of ids) {
        const c = compileBlueprint(lib[id], lib);
        check(c.spec.errors.length === 0, `${id} errors: ${c.spec.errors.join('; ')}`);
        check(c.massKg > 0 && Number.isFinite(c.massKg), `${id} finite mass`);
        check(c.spec.compileMs < 40, `${id} fast compile (${c.spec.compileMs.toFixed(2)} ms)`);
        check(c.interferences.length === 0, `${id} spatial interferences: ${c.interferences.map((x) => x.text).join('; ')}`);
        console.log(`    ${id.padEnd(22)} scale=${c.scale.padEnd(11)} parts=${String(c.parts.length).padStart(2)} sub=${c.asmBoxes.length} mass=${c.massKg.toFixed(1).padStart(6)}kg grade=${c.spec.grade.padEnd(11)} (${c.spec.compileMs.toFixed(2)}ms)`);
    }
});

test('20-second steady-state operational dyno: all prebuilt operational machines run cleanly with ZERO failures', () => {
    const operationalIds = [
        'mach_excavator_crawler', 'mach_mech_walker', 'mach_haul_tractor',
        'mach_rotary_drill', 'mach_engine_lathe', 'mach_compound_powerhouse',
        'bot_atlas_forklift', 'bot_kodiak_grapple', 'bot_ballista_catapult', 'bot_battering_bull',
        'bot_shredder_safe', 'bot_mauler_drum', 'bot_fang_crusher', 'bot_catapult_flipper',
        'bot_twin_saw_mantis', 'bot_piledriver_crank', 'bot_goliath_twin_v4',
        'bot_iron_wedge', 'bot_anvil_hammer', 'bot_ripper_gas',
        'machine_gantry_crane', 'machine_shop_press', 'machine_cnc_mill',
        'titan_recovery_crane', 'titan_hip_drive', 'titan_hydraulic_leg', 'titan_crawler_bogie', 'titan_siege_core',
    ];
    for (const id of operationalIds) {
        const c = compileBlueprint(lib[id], lib);
        const rt = createMachineRuntime(c);
        const nomLoad = Math.max(4, Math.round((c.spec.primaryContTorqueNm || 20) * 0.28));
        for (let i = 0; i < 20 * 60; i++) {
            rt.stepDyno(1 / 60, { throttle: 0.75, loadTorqueNm: nomLoad });
        }
        const aut = rt.getAutopsy();
        check(aut.failed.length === 0, `${id} failed during normal 20s dyno: ${aut.failed.map((f) => `${f.label}: ${f.reason}`).join('; ')}`);
    }
    console.log(`    All ${operationalIds.length} prebuilt operational machines ran 20s continuously with 0 failures!`);
});

test('hydraulic & belt fail-safe mechanisms: relief valve and HTD belt protect upstream machinery', () => {
    const crusher = compileBlueprint(lib.bot_fang_crusher, lib);
    const mauler = compileBlueprint(lib.bot_mauler_drum, lib);
    const press = compileBlueprint(lib.machine_shop_press, lib);
    const titanLeg = compileBlueprint(lib.titan_hydraulic_leg, lib);
    check(crusher.spec.grade === 'SAFE', `Iron Fang hydraulic crusher should grade SAFE, got ${crusher.spec.grade}`);
    check(mauler.spec.grade === 'SAFE', `Mauler belted drum should grade SAFE, got ${mauler.spec.grade}`);
    check(press.spec.grade === 'SAFE', `Workshop forging press should grade SAFE, got ${press.spec.grade}`);
    check(titanLeg.spec.grade === 'SAFE', `Titan hydraulic leg should grade SAFE, got ${titanLeg.spec.grade}`);
    check(crusher.coolingBoostWPerK > 0, 'Iron Fang radiator provides active cooling boost');
});

test('fail-safe grading distinguishes Fused Shredder vs Glass Cannon', () => {
    const safe = compileBlueprint(lib.bot_shredder_safe, lib);
    const raw = compileBlueprint(lib.bot_shredder_raw, lib);
    check(safe.spec.grade === 'SAFE', `Fused Shredder grade should be SAFE, got ${safe.spec.grade}`);
    check(raw.spec.grade === 'UNPROTECTED', `Glass Cannon grade should be UNPROTECTED, got ${raw.spec.grade}`);
    check(safe.weaponChain && raw.weaponChain, 'both bots have weapon chains');
    console.log('    Fused Shredder verdict:', safe.spec.failSafeVerdicts.find((v) => v.chainId === safe.weaponChain.id)?.text);
    console.log('    Glass Cannon verdict:  ', raw.spec.failSafeVerdicts.find((v) => v.chainId === raw.weaponChain.id)?.text);
});

test('dyno moderate shock (60 N·m): slip clutch absorbs spike, shear pin & gearbox untouched', () => {
    const c = compileBlueprint(lib.spinner_drive_fused, lib);
    const rt = createMachineRuntime(c);
    // Spin up for 1.5 s
    for (let i = 0; i < 90; i++) rt.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 10 });
    const cs = rt.chainState.get(c.primaryChain.id);
    check(cs.omegaOut > 40, `spinner spun up (omega=${cs.omegaOut.toFixed(1)})`);

    // Apply a 60 N·m glancing shock (total ~70 N·m: above 50 N·m slip clutch, below 88 N·m shear pin & 105 N·m gearbox!)
    let slipped = false;
    for (let i = 0; i < 12; i++) {
        rt.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 10, shockTorqueNm: 60 });
        if (cs.slipping) slipped = true;
    }
    const clutchPs = rt.partState.get('clutch');
    const pinPs = rt.partState.get('pin');
    const gearPs = rt.partState.get('gb/stage1');
    check(slipped, 'slip clutch should slip under 60 N·m spike');
    check(clutchPs.wear > 0 && clutchPs.tempC > 24.5, 'clutch absorbed slip energy as heat & pad wear');
    check(!pinPs.failed && !gearPs.failed, 'neither shear pin nor gearbox failed under glancing 60 N·m hit');
    console.log(`    Clutch slipped: T=${clutchPs.tempC.toFixed(1)}°C, wear=${(clutchPs.wear * 100).toFixed(2)}%, gearbox intact`);
});

test('dyno catastrophic jam (150 N·m): $3 shear pin snaps cleanly and SAVES gearbox vs raw pinion strip', () => {
    const cSafe = compileBlueprint(lib.spinner_drive_fused, lib);
    const cRaw = compileBlueprint(lib.spinner_drive_raw, lib);
    const rtSafe = createMachineRuntime(cSafe);
    const rtRaw = createMachineRuntime(cRaw);

    for (let i = 0; i < 60; i++) {
        rtSafe.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 8 });
        rtRaw.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 8 });
    }
    // Slam both with a 150 N·m sudden jam!
    rtSafe.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 10, shockTorqueNm: 150 });
    rtRaw.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 10, shockTorqueNm: 150 });

    const pinSafe = rtSafe.partState.get('pin');
    const gearSafe = rtSafe.partState.get('gb/stage1');
    const gearRaw = rtRaw.partState.get('gb/stage1');

    check(pinSafe.failed && pinSafe.failReason === 'SHEAR PIN SNAPPED', `Fused shear pin snapped (got ${pinSafe.failReason})`);
    check(!gearSafe.failed, 'Fused gearbox SURVIVED thanks to shear pin!');
    check(gearRaw.failed && gearRaw.failReason === 'GEAR TEETH STRIPPED', `Raw gearbox stripped (got ${gearRaw.failReason})`);

    const autSafe = rtSafe.getAutopsy();
    const autRaw = rtRaw.getAutopsy();
    check(autSafe.repairCost < autRaw.repairCost * 0.3,
        `Fused repair ($${autSafe.repairCost.toFixed(0)}) << Raw repair ($${autRaw.repairCost.toFixed(0)})`);
    check(autSafe.savedCost > 100, `Fused saved cost > $100 (got $${autSafe.savedCost.toFixed(0)})`);
    console.log(`    Fused repair: $${autSafe.repairCost.toFixed(1)} (saved $${autSafe.savedCost.toFixed(0)}) vs Raw repair: $${autRaw.repairCost.toFixed(1)}`);
});

test('wear law: undersized bronze bushings wear dramatically faster than tapered roller bearings', () => {
    const cLight = compileBlueprint(lib.gb_3to1_light, lib);
    const cHeavy = compileBlueprint(lib.gb_4to1_heavy, lib);
    const rtLight = createMachineRuntime(cLight);
    const rtHeavy = createMachineRuntime(cHeavy);

    // Run 30 s under heavy continuous load (55 N·m output + 1100 N radial load — above bronze continuous rating, below peak)
    for (let i = 0; i < 30 * 60; i++) {
        rtLight.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 55, radialShockN: 1100 });
        rtHeavy.stepDyno(1 / 60, { throttle: 1.0, loadTorqueNm: 55, radialShockN: 1100 });
    }
    const bLight = rtLight.partState.get('out_brg');
    const bHeavy = rtHeavy.partState.get('out_brg');
    check(bLight.wear > 0.15, `Bronze bushing should wear heavily under overload (got ${(bLight.wear * 100).toFixed(1)}%)`);
    check(bHeavy.wear < 0.05, `Roller bearing should barely wear (got ${(bHeavy.wear * 100).toFixed(2)}%)`);
    check(rtLight.events.length > 0, 'Light gearbox emitted immediate out-of-spec events');
    console.log(`    30s overload wear: bronze bushing ${(bLight.wear * 100).toFixed(1)}% (failed=${bLight.failed}) vs roller ${(bHeavy.wear * 100).toFixed(2)}%`);
});

test('scale invariance: Titan 6m Hip Actuator Pack compiles with multi-tonne mass and 18 kN·m clutch', () => {
    const c = compileBlueprint(lib.titan_hip_drive, lib);
    check(c.massKg > 800, `Titan hip drive mass > 800 kg (got ${c.massKg.toFixed(0)} kg)`);
    check(c.primaryChain.totalRatio === 20, `20:1 total bull-gear ratio (got ${c.primaryChain.totalRatio})`);
    check(c.primaryChain.limiterCapAtOut === 18000, `18 kN·m slip clutch cap`);
    check(c.spec.grade === 'SAFE', `Titan hip pack is fail-safe (got ${c.spec.grade})`);
    console.log(`    Titan Hip Pack: ${c.massKg.toFixed(0)} kg, ratio ${c.primaryChain.totalRatio}:1, peak ${(c.primaryChain.peakTorqueOut / 1000).toFixed(1)} kN·m, grade=${c.spec.grade}`);
});

test('motion interaction audit: all starter blueprints have ZERO swept collisions, frame clips, shaft obstructions, or kinematic stalls', () => {
    const ids = Object.keys(lib);
    for (const id of ids) {
        const bp = lib[id];
        const c = compileBlueprint(bp, lib);
        const rep = auditMachineMotion(c, { samples: 12, liveSim: bp.scale !== 'subassembly' });
        check(rep.counts.errors === 0, `${id} motion errors: ${rep.findings.filter((f) => f.severity === 'error').map((f) => f.text).join('; ')}`);
    }
    console.log(`    All ${ids.length} blueprints passed full kinematic swept-motion & shaft-obstruction audit with 0 errors!`);
});

test('motion interaction audit reliably catches sabotaged swept collisions, frame clips, and shaft obstructions', () => {
    // 1. Sabotage Ballista Catapult by slamming its throwing arm down into the front Hardox scoop
    const badCat = JSON.parse(JSON.stringify(lib.bot_ballista_catapult));
    const armNode = badCat.nodes.find((n) => n.id === 'arm');
    armNode.pos3d[1] = 0.22;
    const rep1 = auditMachineMotion(compileBlueprint(badCat, lib), { samples: 12 });
    check(rep1.findings.some((f) => f.kind === 'SWEPT_COLLISION' || f.kind === 'FRAME_CLIP'),
        `expected swept collision/frame clip on sabotaged catapult, got: ${rep1.findings.map((f) => f.kind).join(', ')}`);

    // 2. Sabotage Kodiak Grapple by blocking its right drive axle with the battery pack
    const badKodiak = JSON.parse(JSON.stringify(lib.bot_kodiak_grapple));
    const battNode = badKodiak.nodes.find((n) => n.id === 'batt');
    battNode.pos3d = [0.24, 0.14, -0.09];
    const rep2 = auditMachineMotion(compileBlueprint(badKodiak, lib), { samples: 12 });
    check(rep2.findings.some((f) => f.kind === 'SHAFT_OBSTRUCTION'),
        `expected SHAFT_OBSTRUCTION on sabotaged grapple, got: ${rep2.findings.map((f) => f.kind).join(', ')}`);
    console.log(`    Sabotage detection verified: caught [${rep1.findings[0]?.kind}] and [${rep2.findings.find((f) => f.kind === 'SHAFT_OBSTRUCTION')?.kind}]`);
});

done('foundry-compiler');
