// tests/test_foundry.js — End-to-end verification for the Machine Compiler,
// Interval Extents Solver, Recursive Unit Composition, and Live Box3D Arena.
// Run with: bro-headless demos/foundry tests/test_foundry.js

import { compileMachine } from "/lib/machine/compiler.js";
import { BUILTIN_CATALOG, createCatalogResolver, listCatalogEntries } from "/lib/machine/assemblies.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";

function fail(msg) { throw new Error('FAIL: ' + msg); }
function ok(cond, msg) { if (!cond) fail(msg); }

const customUnits = {};
const resolver = createCatalogResolver(customUnits);

// 1. Compile all 18 built-in catalog units (8 T1 + 4 T2 + 6 T3) twice and assert determinism.
const entries = listCatalogEntries(customUnits);
ok(entries.length === 18, `expected 18 built-in catalog entries, got ${entries.length}`);

const compiledMap = new Map();
for (const bp of entries) {
    const c1 = compileMachine(bp, resolver);
    const c2 = compileMachine(bp, resolver);
    ok(c1.nameplate.massKg > 0 && Number.isFinite(c1.nameplate.massKg), `${bp.id} mass > 0`);
    ok(c1.com.every(Number.isFinite), `${bp.id} COM finite`);
    ok(c1.clusters.length >= 1, `${bp.id} clusters >= 1`);
    ok(JSON.stringify(c1.nameplate) === JSON.stringify(c2.nameplate), `${bp.id} compile is deterministic`);
    for (const lc of ['gravity', 'actuate', 'recoil']) {
        ok(Number.isFinite(c1.loadCases[lc].peakUtil) && Number.isFinite(c1.loadCases[lc].tipMargin), `${bp.id} ${lc} finite`);
    }
    compiledMap.set(bp.id, c1);
    console.log(`PASS compile [${bp.tier}] ${bp.id}: mass=${Math.round(c1.nameplate.massKg)}kg clusters=${c1.nameplate.clusterCount} dofs=${c1.nameplate.dofCount} rating=${c1.nameplate.rating}`);
}

// 2. Recursive custom user-unit nesting (T1 -> T2 -> T3).
customUnits.user_arm = {
    id: 'user_arm',
    name: 'User Custom Recoil Arm',
    tier: 1,
    ports: [{ id: 'aim', type: 'signal' }],
    nodes: [{ id: 'root', kind: 'beam', pos: [0, 0, 0], half: [0.4, 0.3, 0.4], material: 'titanium', role: 'mount' }],
    units: [{ id: 'breech', unitId: 'recoil_breech', parent: 'root', mountPos: [0, 0.25, -0.3] }],
};
customUnits.user_pod = {
    id: 'user_pod',
    name: 'User Twin Pod',
    tier: 2,
    ports: [{ id: 'pod_fire', type: 'signal' }],
    nodes: [{ id: 'spine', kind: 'beam', pos: [0, 0, 0], half: [0.8, 0.25, 0.5], material: 'steel', role: 'frame' }],
    units: [
        { id: 'arm_l', unitId: 'user_arm', parent: 'spine', mountPos: [-0.85, 0.1, 0] },
        { id: 'arm_r', unitId: 'user_arm', parent: 'spine', mountPos: [0.85, 0.1, 0], mirrorX: true },
    ],
};
const nestedRig = {
    id: 'user_rig',
    name: 'Nested Custom Rig',
    tier: 3,
    nodes: [{ id: 'hull', kind: 'beam', pos: [0, 1.3, 0], half: [1.3, 0.35, 1.8], material: 'titanium', role: 'chassis' }],
    units: [
        { id: 'b1', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.4, 0.95, 0] },
        { id: 'b2', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.4, 0.95, 0] },
        { id: 'pods', unitId: 'user_pod', parent: 'hull', mountPos: [0, 1.85, 0] },
    ],
};
const cNested = compileMachine(nestedRig, resolver);
ok(cNested.nameplate.cannonCount === 2, `recursive user unit propagated 2 cannons (got ${cNested.nameplate.cannonCount})`);
ok(cNested.nameplate.partCount >= 14, `recursive user unit flattened >= 14 parts (got ${cNested.nameplate.partCount})`);
console.log(`PASS recursive compile: parts=${cNested.nameplate.partCount} clusters=${cNested.nameplate.clusterCount} cannons=${cNested.nameplate.cannonCount}`);

// Helper to verify no NaNs anywhere on spawned machine.
function assertHealthy(world, inst, label) {
    for (const b of inst.clusterBodies) {
        if (!world.hasBody(b)) continue;
        const p = world.pose(b);
        for (let i = 0; i < 7; i++) ok(Number.isFinite(p[i]), `${label} body ${b} NaN pose`);
        ok(p[1] > -10 && p[1] < 200, `${label} body ${b} exploded y=${p[1]}`);
    }
}

// 3. Live physics: Siege Howitzer deploys spades + fires heavy shell cleanly.
{
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0 });
    const c = compiledMap.get('siege_howitzer');
    const inst = spawnCompiledMachine(w, c, { position: [0, -c.bounds.min[1] + 0.2, 0] });
    for (let i = 0; i < 40; i++) {
        stepMachine(inst, 1 / 60, { spades: true, fire: i === 25, turretPitch: 0.25 });
        w.step(1 / 60, 4);
    }
    assertHealthy(w, inst, 'siege_howitzer');
    ok(inst.projectilesOut.length === 1, `siege_howitzer fired shell (got ${inst.projectilesOut.length})`);
    const sp = w.velocity(inst.projectilesOut[0].body);
    ok(Math.hypot(sp[0], sp[1], sp[2]) > 40, `shell velocity > 40 m/s`);
    w.destroy();
    console.log('PASS live siege_howitzer deploy & fire');
}

// 4. Live physics: Twin-Cannon Tank & Iron Strider both move forward reliably.
for (const id of ['twin_autocannon_tank', 'iron_strider']) {
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0 });
    const c = compiledMap.get(id);
    const inst = spawnCompiledMachine(w, c, { position: [0, -c.bounds.min[1] + 0.2, 0] });
    const z0 = w.pose(inst.rootBody)[2];
    for (let i = 0; i < 140; i++) {
        stepMachine(inst, 1 / 60, { throttle: 1.0, steer: 0 });
        w.step(1 / 60, 4);
    }
    assertHealthy(w, inst, id);
    const z1 = w.pose(inst.rootBody)[2];
    const disp = z0 - z1;
    ok(disp > 1.2, `${id} moved forward (dz=${disp.toFixed(2)}m)`);
    w.destroy();
    console.log(`PASS live locomotion ${id}: moved ${disp.toFixed(2)} m`);
}

// 5. Live physics: Clockwork Catapult winds spring & launches boulder.
{
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0 });
    const c = compiledMap.get('clockwork_catapult');
    const inst = spawnCompiledMachine(w, c, { position: [0, -c.bounds.min[1] + 0.2, 0] });
    for (let i = 0; i < 120; i++) {
        stepMachine(inst, 1 / 60, { fire: i >= 95 });
        w.step(1 / 60, 4);
    }
    assertHealthy(w, inst, 'clockwork_catapult');
    ok(inst.projectilesOut.length >= 1, `clockwork_catapult released siege shot (got ${inst.projectilesOut.length})`);
    w.destroy();
    console.log('PASS live clockwork_catapult wind & launch');
}

// 6. Full 2-machine battle + destructible Metropolis-style Structure tower (240 steps).
{
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0 });
    const st = w.addStructure({
        members: [
            { center: [-2, 1.5, 0], half: [0.5, 1.5, 0.5], anchored: true },
            { center: [2, 1.5, 0], half: [0.5, 1.5, 0.5], anchored: true },
            { center: [0, 3.3, 0], half: [2.6, 0.3, 1.2] },
        ],
        ties: [[0, 2], [1, 2]],
        maxPieces: 64,
    });
    const a = spawnCompiledMachine(w, compiledMap.get('iron_strider'), { position: [0, -compiledMap.get('iron_strider').bounds.min[1] + 0.2, 22], yaw: 0, team: 1 });
    const b = spawnCompiledMachine(w, compiledMap.get('juggernaut_ram'), { position: [0, -compiledMap.get('juggernaut_ram').bounds.min[1] + 0.2, -22], yaw: Math.PI, team: 2 });
    let totalShells = 0;
    for (let i = 0; i < 240; i++) {
        const pa = w.pose(a.rootBody), pb = w.pose(b.rootBody);
        stepMachine(a, 1 / 60, computeAiInput(a, [pb[0], pb[1], pb[2]], 1 / 60));
        stepMachine(b, 1 / 60, computeAiInput(b, [pa[0], pa[1], pa[2]], 1 / 60));
        totalShells += a.projectilesOut.length + b.projectilesOut.length;
        a.projectilesOut.length = 0; b.projectilesOut.length = 0;
        w.step(1 / 60, 4);
    }
    assertHealthy(w, a, 'battle_strider');
    assertHealthy(w, b, 'battle_juggernaut');
    ok(totalShells >= 1, 'battle produced live cannon fire');
    ok(st.counts.cells > 0, 'structure tower intact in world');
    w.destroy();
    console.log(`PASS 240-step battle: shells=${totalShells} integrity=(${(a.integrity * 100).toFixed(0)}%, ${(b.integrity * 100).toFixed(0)}%)`);
}

console.log('FOUNDRY_ALL_TESTS_PASSED');
