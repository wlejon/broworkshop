// The heightfield: the collision body and the visual mesh are built from one
// height function, so a raycast must land on the function, the engine's
// groundNormal must agree with its derivative, regeneration must rebuild the
// body, and the seam with the flat course must have no step.

import { check, test, done, shot } from "/lib/kit/test.js";
import { scene, world, tune, charState, keys, rebuild, teleport, RADIUS, STAND_HALF,
         terrain, terrainState, regenerateTerrain, heightAt, slopeAt, onTerrain, probeGround,
         TERRAIN_WALK, SEAM_Z } from "/app/lab.js";
import { clearKeys, run } from "/app/tests/helpers.js";

advanceTime(64);
flush();

let worstProbe = 0;

test('the collision surface IS the height function', () => {
    check(terrainState.tag > 0, `heightfield body (tag ${terrainState.tag})`);
    for (const [x, z] of [[0, -30], [8, -40], [-11, -52], [4, -66], [-6, -25]]) {
        check(onTerrain(x, z), `(${x}, ${z}) is on the patch`);
        const got = probeGround(x, z);
        check(got !== null, `raycast found it at (${x}, ${z})`);
        worstProbe = Math.max(worstProbe, Math.abs(got - heightAt(x, z)));
    }
    // Quantized samples interpolated: centimetres expected, a metre would mean
    // the body was built from different numbers than the mesh.
    check(worstProbe < 0.25, `within ${worstProbe.toFixed(3)} m at every probe`);
});

test('the character walks the hills; groundNormal agrees with the gradient', () => {
    Object.assign(tune, { maxSlopeAngle: 50, moveSpeed: 4.5, innerBody: true });
    rebuild(scene);
    advanceTime(32);
    const sx = TERRAIN_WALK.x, sz = TERRAIN_WALK.z;
    teleport(sx, heightAt(sx, sz) + 0.6 + RADIUS + STAND_HALF, sz);
    advanceTime(400);
    check(charState.isGrounded && onTerrain(charState.position.x, charState.position.z), 'landed on the patch');
    check(terrainState.onTerrain, 'the readout agrees');

    let maxSlope = 0, worstErr = 0, samples = 0, climbed = 0, runMin = charState.position.y;
    clearKeys();
    keys.w = true;
    run(3600, () => {
        const p = charState.position;
        if (!charState.isGrounded || !onTerrain(p.x, p.z)) { runMin = p.y; return; }
        runMin = Math.min(runMin, p.y);
        climbed = Math.max(climbed, p.y - runMin);
        const analytic = slopeAt(p.x, p.z);
        maxSlope = Math.max(maxSlope, charState.slopeDeg);
        // On a ridge the capsule bridges two faces; compare where it is smooth.
        if (analytic < 40) { worstErr = Math.max(worstErr, Math.abs(charState.slopeDeg - analytic)); samples++; }
    });
    clearKeys();
    advanceTime(64);
    check(samples > 60, `${samples} grounded samples`);
    check(maxSlope > 8, `non-zero slope (peak ${maxSlope.toFixed(1)}°)`);
    check(climbed > 0.5, `climbed ${climbed.toFixed(2)} m without leaving the ground`);
    check(worstErr < 12, `engine vs analytic within ${worstErr.toFixed(1)}°`);
    console.log(`  heightfield: peak ${maxSlope.toFixed(1)}°, worst error ${worstErr.toFixed(1)}°, ` +
        `climbed ${climbed.toFixed(2)} m, probe ${worstProbe.toFixed(3)} m`);
    shot('terrain');
});

test('regenerating rebuilds the body from the new function', () => {
    const amp = terrain.amplitude, n = terrainState.rebuilds;
    const sx = TERRAIN_WALK.x, sz = TERRAIN_WALK.z;
    const before = probeGround(sx, sz);
    terrain.amplitude = amp * 2;
    regenerateTerrain();
    advanceTime(64);
    check(terrainState.rebuilds === n + 1, 'counted');
    const after = probeGround(sx, sz);
    check(after !== null && Math.abs(after - heightAt(sx, sz)) < 0.25, `new surface matches (${after.toFixed(3)})`);
    check(Math.abs(after - before) > 0.3, `the terrain changed (${before.toFixed(2)} -> ${after.toFixed(2)} m)`);
    terrain.amplitude = amp;
    regenerateTerrain();
    advanceTime(64);
});

test('the seam with the flat course has no step', () => {
    check(Math.abs(heightAt(0, SEAM_Z)) < 0.01, `tapered to 0 at the seam (${heightAt(0, SEAM_Z).toFixed(4)})`);
    check(world.groundFarZ === SEAM_Z, `the ground slab ends at the same line (${world.groundFarZ})`);
});

done('character-lab terrain');
