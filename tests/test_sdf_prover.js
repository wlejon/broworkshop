// Verification test for bromesh's interval-pruned + symbolically differentiated
// SDF pipeline (customExpr, queryContact, evalBlockBounds, marchingCubes/surfaceNets)
// and bronze's static prover + deterministic check.
//
// Run with bro-headless:
//   bro-headless lib-tests tests/test_sdf_prover.js
// Run with bronze static prover:
//   bronze check --deterministic tests/test_sdf_prover.js

'use strict';

// Prover-clean, deterministic SDF helper kernel for bronze check --deterministic
function evaluateAnalyticalSphereDistance(px, py, pz, radius) {
    const r2 = px * px + py * py + pz * pz;
    return Math.sqrt(r2) - radius;
}

function accumulateDeterministicFieldSamples(count, radius) {
    const n = count | 0;
    if (n <= 0) return 0.0;
    let acc = 0.0;
    for (let i = 0; i < n; i++) {
        const x = (i + 1) * 0.125;
        const d = evaluateAnalyticalSphereDistance(x, 0.0, 0.0, radius);
        acc = acc + d;
    }
    return acc;
}

let tests = 0;
let failed = 0;

function t(name, fn) {
    tests++;
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL ' + name + ': ' + (e && e.message ? e.message : e));
        if (e && e.stack) console.log(e.stack);
    }
}

function near(a, b, eps, msg) {
    const tol = eps !== undefined ? eps : 1e-4;
    if (Math.abs(a - b) > tol) {
        throw new Error((msg || 'near') + ': ' + a + ' vs ' + b + ' (tol=' + tol + ')');
    }
}

function truthy(v, msg) {
    if (!v) throw new Error(msg || 'expected truthy');
}

// 1. Deterministic prover-clean helper verification
t('prover-clean analytical sphere distance and deterministic accumulation', () => {
    const d0 = evaluateAnalyticalSphereDistance(3.0, 4.0, 0.0, 2.0);
    near(d0, 3.0, 1e-6, 'distance at (3,4,0) for r=2');
    const sum1 = accumulateDeterministicFieldSamples(8, 1.0);
    const sum2 = accumulateDeterministicFieldSamples(8, 1.0);
    near(sum1, sum2, 0.0, 'deterministic sample accumulation is bit-exact');
});

// 2. Custom SDF primitive via formula expression (#108)
t('SDFGraph.customExpr: formula string evaluation and CSG composition', () => {
    const g = Mesh.createSDF();
    const n1 = g.customExpr('sqrt(x*x + y*y + z*z) - 1.5', 1.0);
    g.setRoot(n1);
    near(g.evalPoint(0, 0, 0), -1.5, 1e-4, 'origin inside custom sphere');
    near(g.evalPoint(2.5, 0, 0), 1.0, 1e-4, 'point outside custom sphere');

    const g2 = Mesh.createSDF();
    const n2 = g2.customExpr('sqrt(x*x + y*y + z*z) - 1.25', 1.0);
    g2.setRoot(n2);
    near(g2.evalPoint(0, 1.25, 0), 0.0, 1e-4, 'surface point on custom SDF');
});

// 3. Interval arithmetic block bounds & macro-block pruning (#105)
t('SDFGraph.evalBlockBounds: interval arithmetic bounds far and surface blocks', () => {
    const g = Mesh.createSDF();
    const s = g.sphere(1.0);
    const c = g.customExpr('sqrt(x*x + y*y + z*z) - 1.0', 1.0);
    g.setRoot(g.opUnion(s, c));

    // Far-exterior block [4, 5]^3 must have strictly positive lower bound
    const farBounds = g.evalBlockBounds({ min: [4, 4, 4], max: [5, 5, 5] });
    truthy(farBounds && typeof farBounds.min === 'number' && typeof farBounds.max === 'number',
        'evalBlockBounds returns { min, max }');
    truthy(farBounds.min > 4.0, 'far block lower bound > 4.0 (got ' + farBounds.min + ')');
    truthy(farBounds.max >= farBounds.min, 'max >= min');

    // Straddling block [0.5, 1.5] x [-0.2, 0.2]^2 must straddle isoLevel=0
    const straddle = g.evalBlockBounds({ min: [0.5, -0.2, -0.2], max: [1.5, 0.2, 0.2] });
    truthy(straddle.min <= 0.0 && straddle.max >= 0.0,
        'surface block straddles zero (min=' + straddle.min + ', max=' + straddle.max + ')');

    if (typeof g.evaluateVolumeStats === 'function') {
        const stats = g.evaluateVolumeStats({
            resolution: 32,
            bounds: { min: [-4, -4, -4], max: [4, 4, 4] },
            enableMacroBlockPruning: true,
        });
        truthy(stats.totalBlocks > 0 && stats.prunedBlocks > 0, 'prunedBlocks > 0');
    }
});

// 4. Symbolic forward-mode automatic differentiation & contact query (#106)
t('SDFGraph.queryContact: exact analytical normal and closest surface point', () => {
    const g = Mesh.createSDF();
    const customSphere = g.customExpr('sqrt(x*x + y*y + z*z) - 1.5', 1.0);
    g.setRoot(customSphere);

    const contact = g.queryContact(3.0, 0.0, 0.0);
    truthy(contact && contact.normal && contact.closestSurfacePoint && contact.gradient,
        'queryContact returns distance, normal, closestSurfacePoint, gradient');
    near(contact.distance, 1.5, 1e-4, 'signed distance at (3,0,0)');
    near(contact.normal.x, 1.0, 1e-4, 'normal.x at (3,0,0)');
    near(contact.normal.y, 0.0, 1e-4, 'normal.y at (3,0,0)');
    near(contact.normal.z, 0.0, 1e-4, 'normal.z at (3,0,0)');
    near(contact.closestSurfacePoint.x, 1.5, 1e-4, 'closestSurfacePoint.x on r=1.5 sphere');
    near(contact.closestSurfacePoint.y, 0.0, 1e-4, 'closestSurfacePoint.y');
    near(contact.closestSurfacePoint.z, 0.0, 1e-4, 'closestSurfacePoint.z');
});

// 5. Mesh extraction (marchingCubes & surfaceNets) from custom SDF (#108)
t('SDFGraph.marchingCubes and surfaceNets mesh extraction on custom SDF', () => {
    const g = Mesh.createSDF();
    const gyroidSphere = g.customExpr(
        'sqrt(x*x + y*y + z*z) - 1.2 + 0.08 * sin(2.0*x) * cos(2.0*y)',
        1.2
    );
    g.setRoot(gyroidSphere);

    if (typeof g.compileSpirv === 'function') {
        const spv = g.compileSpirv();
        truthy(spv && spv.length > 5 && spv[0] === 0x07230203, 'valid SPIR-V magic word 0x07230203');
    }

    const meshMc = g.marchingCubes({
        resolution: 20,
        bounds: { min: [-2, -2, -2], max: [2, 2, 2] },
    });
    truthy(meshMc && meshMc.vertexCount > 50 && meshMc.triangleCount > 50,
        'marchingCubes extracted non-empty mesh from custom SDF');

    const meshSn = g.surfaceNets({
        resolution: 20,
        bounds: { min: [-2, -2, -2], max: [2, 2, 2] },
    });
    truthy(meshSn && meshSn.vertexCount > 50 && meshSn.triangleCount > 50,
        'surfaceNets extracted non-empty mesh from custom SDF');
});

console.log('\n' + (tests - failed) + '/' + tests + ' passed');
if (failed > 0) throw new Error(failed + ' test(s) failed');
