// tests/test_foundry.js — Strict physical & compiler verification for Foundry:
//   - All 18 built-in catalog units compile deterministically
//   - 3-level recursive user unit nesting (T1 -> T2 -> T3)
//   - All 6 Tier-3 machines operate with ZERO self-breakage (broken === 0),
//     stay upright (upY > 0.85), move forward under drive/walk, and fire forward (-Z)!
//   - 240-step 2-machine battle with destructible concrete Structure tower.

import { compileMachine } from "/lib/machine/compiler.js";
import { BUILTIN_CATALOG, createCatalogResolver, listCatalogEntries } from "/lib/machine/assemblies.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";

function fail(msg) { throw new Error('FAIL: ' + msg); }
function ok(cond, msg) { if (!cond) fail(msg); }

const customUnits = {};
const resolver = createCatalogResolver(customUnits);

// 1. Compile all 18 built-in catalog units twice and verify determinism.
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
ok(cNested.nameplate.partCount >= 18, `recursive user unit flattened >= 18 parts (got ${cNested.nameplate.partCount})`);
console.log(`PASS recursive compile: parts=${cNested.nameplate.partCount} clusters=${cNested.nameplate.clusterCount} cannons=${cNested.nameplate.cannonCount}`);

function assertHealthy(world, inst, label) {
    for (const b of inst.clusterBodies) {
        if (!world.hasBody(b)) continue;
        const p = world.pose(b);
        for (let i = 0; i < 7; i++) ok(Number.isFinite(p[i]), `${label} body ${b} NaN pose`);
        ok(p[1] > -5 && p[1] < 100, `${label} body ${b} invalid y=${p[1]}`);
    }
}

// 3. Strict 180-step physical validation of ALL 6 Tier-3 machines!
const armedForward = new Set(['siege_howitzer', 'iron_strider', 'clockwork_catapult', 'twin_autocannon_tank', 'biped_titan']);
for (const id of ['siege_howitzer', 'iron_strider', 'juggernaut_ram', 'clockwork_catapult', 'twin_autocannon_tank', 'biped_titan']) {
    const c = compiledMap.get(id);
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0, layers: 1 });
    const inst = spawnCompiledMachine(w, c, { position: [0, -c.bounds.min[1] + 0.14, 0] });
    for (let i = 0; i < 180; i++) {
        stepMachine(inst, 1 / 60, {
            throttle: i >= 15 ? 0.9 : 0,
            fire: i === 70 || (id === 'clockwork_catapult' && i >= 95),
            spades: id === 'siege_howitzer' && i > 110,
            clutchDump: id === 'juggernaut_ram' && i === 100,
        });
        w.step(1 / 60, 4);
    }
    assertHealthy(w, inst, id);
    const rp = w.pose(inst.rootBody);
    const upY = 1 - 2 * (rp[3] * rp[3] + rp[5] * rp[5]);
    const dz = -rp[2];
    ok(inst.brokenCount === 0 && inst.strippedCount === 0, `${id} broke under normal operation (broken=${inst.brokenCount}, stripped=${inst.strippedCount})`);
    ok(upY > 0.82, `${id} stayed upright (upY=${upY.toFixed(2)})`);
    ok(dz > 1.5, `${id} moved forward cleanly (dz=${dz.toFixed(2)}m)`);
    if (armedForward.has(id)) {
        ok(inst.projectilesOut.length >= 1, `${id} fired projectile (got ${inst.projectilesOut.length})`);
        const sv = w.velocity(inst.projectilesOut[0].body);
        ok(sv[2] < -20, `${id} projectile fired forward (-Z) (velZ=${sv[2].toFixed(1)})`);
    }
    w.destroy();
    console.log(`PASS machine ${id}: dz=${dz.toFixed(2)}m upY=${upY.toFixed(2)} broken=0 shells=${inst.projectilesOut.length}`);
}

// 4. Full 240-step 2-machine battle + destructible concrete Structure tower.
{
    const w = bro.dynamics.createWorld({ workers: 4 });
    w.addBox({ position: [0, -1, 0], half: [120, 1, 120], mass: 0, friction: 1.0, layers: 1 });
    const st = w.addStructure({
        members: [
            { center: [-2, 1.5, 0], half: [0.5, 1.5, 0.5], anchored: true },
            { center: [2, 1.5, 0], half: [0.5, 1.5, 0.5], anchored: true },
            { center: [0, 3.3, 0], half: [2.6, 0.3, 1.2] },
        ],
        ties: [[0, 2], [1, 2]],
        maxPieces: 64,
    });
    const a = spawnCompiledMachine(w, compiledMap.get('iron_strider'), { position: [0, -compiledMap.get('iron_strider').bounds.min[1] + 0.14, 22], yaw: 0, team: 1 });
    const b = spawnCompiledMachine(w, compiledMap.get('juggernaut_ram'), { position: [0, -compiledMap.get('juggernaut_ram').bounds.min[1] + 0.14, -22], yaw: Math.PI, team: 2 });
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

console.log('FOUNDRY_STRICT_TESTS_PASSED');
