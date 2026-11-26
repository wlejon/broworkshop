// demos/foundry/tests/test_cad_foundry.js — Headless verification + studio render capture
// for the Precision Mechanical CAD Workbench & Box3D Proving Ground.

import { CAD_CATALOG, buildCadAssembly } from "/lib/cad/assemblies.js";
import { createProvingGround } from "/lib/cad/proving.js";

function assert(cond, msg) {
    if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
    console.log(`[PASS] ${msg}`);
}

const canvas = document.createElement('canvas');
canvas.width = 1280; canvas.height = 760;
const scene = canvas.getContext('scene');

// 1. Verify all 4 code-compiled precision CAD assemblies build cleanly with dense geometry & instanced bolts
for (const entry of CAD_CATALOG) {
    const asm = buildCadAssembly(scene, entry.id);
    assert(asm.stats.partCount >= 10, `${entry.id} has rich subassembly count (${asm.stats.partCount} parts)`);
    assert(asm.stats.triangles >= 8000, `${entry.id} has high CAD triangle detail (${asm.stats.triangles} tris)`);
    // Exercise kinematics & exploded cutaway smoothly without NaN or errors
    for (let i = 0; i < 10; i++) {
        asm.update({ theta: i * 0.45, turretYaw: i * 0.1, turretPitch: 0.15 + i * 0.03, recoil: 0.1, wheelSpin: i * 0.5, spades: i % 2 === 0 }, i / 10);
    }
    asm.setStress(true, 0.7);
    asm.setStress(false, 0.5);
    asm.destroy();
}

// 2. Verify live Box3D Proving Ground: mouse-ray aiming + howitzer recoil + concrete bunker destruction!
{
    const pg = createProvingGround(scene);
    pg.start('truss_howitzer');
    // Aim directly at the center target bunker [0, 3.0, -24] from camera above & behind
    const origin = [0, 7, 24];
    const tgt = [0, 3.0, -24];
    const dx = tgt[0] - origin[0], dy = tgt[1] - origin[1], dz = tgt[2] - origin[2];
    const dm = Math.hypot(dx, dy, dz);
    pg.aimAtRay({ origin, dir: [dx / dm, dy / dm, dz / dm] });
    assert(pg.state.aimLocked, `Mouse raycast locked onto downrange concrete bunker (range=${pg.state.aimRange.toFixed(1)}m)`);

    let maxBroken = 0;
    let maxRecoil = 0;
    for (let i = 0; i < 180; i++) {
        const r = pg.step(1 / 60, { throttle: 0, steer: 0, fire: i === 15 || i === 100, spades: true });
        if (r.brokenCells > maxBroken) maxBroken = r.brokenCells;
        if (pg.state.recoil > maxRecoil) maxRecoil = pg.state.recoil;
    }
    assert(pg.state.shotsFired >= 2, `Howitzer fired ${pg.state.shotsFired} AP shells`);
    assert(maxRecoil > 0.10, `Hydro-pneumatic recoil stroked (${maxRecoil.toFixed(3)}m)`);
    assert(maxBroken > 0, `Mouse-aimed shells physically shattered bunker (${maxBroken} cells broken)`);
    pg.cleanup();
}

console.log('ALL_CAD_FOUNDRY_TESTS_PASSED');
