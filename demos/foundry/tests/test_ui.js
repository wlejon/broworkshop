// demos/foundry/tests/test_ui.js — End-to-end interactive UI & visual screenshot
// verification across all 3 Foundry modes and all 3 physical scales.

import { test, check, frames, clickOn, setValue, text, shot, done } from "/lib/kit/test.js";

// Let initial boot + first render settle
frames(15);

test('boots cleanly on Fused Shredder Mk1 in Blueprint + 3D mode (wide + chassis close-up)', () => {
    const F = globalThis.__foundry;
    check(F && F.compiled, 'foundry booted and compiled');
    check(F.activeId === 'bot_shredder_safe', `activeId=${F.activeId}`);
    check(/SAFE/.test(text('#specSheet')), 'spec sheet shows SAFE grade');
    F.stepBench(0.6, { throttle: 1, loadTorqueNm: 12 });
    frames(6);
    shot('01-blueprint-bot');
    // Close-up inside the chassis bay (verifies transverse drive pods, wheels, gears, zero clipping!)
    F.vp.reframe([0, 0.14, -0.06], 0.92, { yaw: 0.48, pitch: -0.42 });
    frames(6);
    shot('01b-chassis-closeup');
});

test('Dyno Bench mode: catastrophic 150 N·m jam snaps shear pin & triggers immediate out-of-spec alert', () => {
    const F = globalThis.__foundry;
    setValue('#presetSelect', 'spinner_drive_fused');
    clickOn('#modes [data-value="dyno"]');
    frames(8);
    // Spin up on bench then slam with catastrophic jam via real button click!
    F.stepBench(1.2, { throttle: 1, loadTorqueNm: 10 });
    clickOn('#btnHitJam');
    frames(12);
    const pin = F.benchRuntime.partState.get('pin');
    const gear = F.benchRuntime.partState.get('gb/stage1');
    check(pin.failed && pin.failReason === 'SHEAR PIN SNAPPED', `pin snapped: ${pin.failReason}`);
    check(!gear.failed, 'gearbox protected by shear pin');
    check(/SHEAR PIN SNAPPED/.test(text('#eventsFeed')), 'immediate alert rendered in #eventsFeed');
    check(/saved/i.test(text('#autopsyBox')), 'autopsy reports fail-safe repair savings');
    shot('02-dyno-jam-failsafe');
});

test('Tier 1 precision sub-assembly: 3:1 Light Gearbox overload wear', () => {
    const F = globalThis.__foundry;
    setValue('#presetSelect', 'gb_3to1_light');
    frames(8);
    F.stepBench(20, { throttle: 1, loadTorqueNm: 55, radialShockN: 950 });
    frames(6);
    const brg = F.benchRuntime.partState.get('out_brg');
    check(brg.wear > 0.08, `bronze bushing wore visibly (${(brg.wear * 100).toFixed(1)}%)`);
    shot('03-gearbox-precision');
});

test('Tier 3 scale invariance: Titan 6m Hip Actuator Pack renders cleanly on gantry', () => {
    const F = globalThis.__foundry;
    clickOn('#modes [data-value="blueprint"]');
    setValue('#presetSelect', 'titan_hip_drive');
    frames(8);
    F.stepBench(1.0, { throttle: 0.9, loadTorqueNm: 6000 });
    frames(6);
    check(F.compiled.scale === 'titan', 'titan scale active');
    check(/SAFE/.test(text('#specSheet')), 'titan hip drive grades SAFE');
    shot('04-titan-scale');
});

test('New diverse operational machines + Hangar selection + Blueprint-to-Arena battle workflow', () => {
    const F = globalThis.__foundry;
    clickOn('#modes [data-value="blueprint"]');
    for (const [id, shotName] of [
        ['bot_piledriver_crank', '06-piledriver-crank'],
        ['bot_goliath_twin_v4', '07-goliath-twin-v4'],
        ['machine_cnc_mill', '08-cnc-mill-tool'],
        ['titan_siege_core', '09-titan-siege-core'],
    ]) {
        setValue('#presetSelect', id);
        frames(8);
        check(F.compiled.interferences.length === 0, `${id} has zero spatial interference`);
        F.stepBench(1.2, { throttle: 0.75, loadTorqueNm: Math.max(8, Math.round(F.compiled.spec.primaryContTorqueNm * 0.25)) });
        const aut = F.benchRuntime.getAutopsy();
        check(aut.failed.length === 0, `${id} stays 100% operational (${aut.failed.map((f) => f.reason).join(',')})`);
        frames(6);
        shot(shotName);
    }

    // Select Mauler Mk2 in Blueprint, then click "⚔ Battle This Machine" -> Arena MUST spawn YOUR Mauler Mk2!
    setValue('#presetSelect', 'bot_mauler_drum');
    frames(6);
    clickOn('#btnBattleMine');
    frames(8);
    check(F.mode === 'arena', 'switched to Combat Arena via Battle This Machine button');
    check(F.arena && F.arena.bots[0].compiled.id === 'bot_mauler_drum', `Arena Bot 0 is your active blueprint (${F.arena?.bots[0]?.compiled.id})`);
    setValue('#arenaMatch', 'bot_fang_crusher');
    frames(6);
    F.stepArena(2.6);
    frames(8);
    shot('10-arena-your-blueprint-vs-fang');
});

test('Combat Arena mode: default Fused Shredder vs Iron Wedge duel', () => {
    const F = globalThis.__foundry;
    clickOn('#btnBackEdit');
    frames(6);
    setValue('#presetSelect', 'bot_shredder_safe');
    frames(6);
    clickOn('#btnBattleMine');
    frames(8);
    setValue('#arenaMatch', 'bot_iron_wedge');
    frames(6);
    F.stepArena(3.0);
    frames(10);
    check(F.arena && F.arena.bots.length === 2, '2 bots active in Box3D arena');
    check(text('#arenaHud').length > 10, 'arena HUD populated');
    shot('05-combat-arena');
});

test('Non-slice-and-dice control, catapult, crane & grapple machines render and battle cleanly', () => {
    const F = globalThis.__foundry;
    clickOn('#modes [data-value="blueprint"]');
    frames(4);

    F.openBlueprint('bot_atlas_forklift');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Atlas Forklift zero interference');
    shot('11-atlas-forklift');

    F.openBlueprint('bot_ballista_catapult');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Ballista Catapult zero interference');
    shot('12-ballista-catapult');

    F.openBlueprint('machine_gantry_crane');
    frames(8);
    check(F.compiled.interferences.length === 0, '5t Gantry Crane zero interference');
    shot('13-gantry-crane');

    F.openBlueprint('bot_atlas_forklift');
    frames(4);
    clickOn('#btnBattleMine');
    frames(4);
    setValue('#arenaMatch', 'bot_kodiak_grapple');
    frames(6);
    F.stepArena(3.2);
    frames(10);
    check(F.arena && F.arena.bots[0].compiled.id === 'bot_atlas_forklift', 'Player Atlas Forklift in Arena');
    check(F.arena.bots[1].compiled.id === 'bot_kodiak_grapple', 'Opponent Kodiak Grapple in Arena');
    shot('14-arena-forklift-vs-grapple');
});

test('Industrial, Construction, Machine-Tool & Bipedal Mech machines render cleanly', () => {
    const F = globalThis.__foundry;
    clickOn('#modes [data-value="blueprint"]');
    frames(4);

    F.openBlueprint('mach_excavator_crawler');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Excavator zero interference');
    shot('15-excavator');

    F.openBlueprint('mach_mech_walker');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Strider Mech zero interference');
    shot('16-strider-mech');

    F.openBlueprint('mach_haul_tractor');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Haul Tractor zero interference');
    shot('17-haul-tractor');

    F.openBlueprint('mach_rotary_drill');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Drill Rig zero interference');
    shot('18-drill-rig');

    F.openBlueprint('mach_engine_lathe');
    frames(8);
    check(F.compiled.interferences.length === 0, 'Engine Lathe zero interference');
    shot('19-engine-lathe');

    F.openBlueprint('mach_excavator_crawler');
    frames(4);
    clickOn('#btnBattleMine');
    frames(4);
    setValue('#arenaMatch', 'mach_haul_tractor');
    frames(6);
    F.stepArena(3.5);
    frames(10);
    shot('20-arena-excavator-vs-tractor');
});

done('foundry-ui');
