// demos/clipmap-terrain/tests/test_main.js

let passed = 0;
let failed = 0;

function check(desc, cond) {
    if (cond) {
        console.log("  ok  " + desc);
        passed++;
    } else {
        console.log("  FAIL: " + desc);
        failed++;
    }
}

console.log("\n=== Clipmap Terrain Integration Tests ===\n");

// [1] Scene & Clipmap Initialization
console.log("[1] Scene & Context Verification");
const canvas = document.getElementById('c');
check("canvas element exists in DOM", !!canvas);

const scene = canvas ? canvas.getContext('scene') : null;
check("scene 3D context exists", !!scene);
check("scene.createClipmapTerrain is a function", scene && typeof scene.createClipmapTerrain === 'function');

// [2] Clipmap Terrain Creation & Property Verification
console.log("\n[2] Clipmap Terrain Creation & Property Verification");
let clipmap = null;
try {
    clipmap = scene.createClipmapTerrain({
        levels: 6,
        resolution: 128,
        cellSize: 2.0,
        heightScale: 1.0,
        seaLevel: 0.0,
        snowLine: 1200.0,
        planetRadius: 0.0,
        detailRelief: 15.0,
        detailWavelength: 20.0,
        materials: {
            rock: { albedo: [0.4, 0.4, 0.4], roughness: 0.8 },
            snow: { albedo: [0.9, 0.9, 0.9], roughness: 0.3 },
            sand: { albedo: [0.7, 0.6, 0.4], roughness: 0.9 },
            grass: { albedo: [0.2, 0.4, 0.1], roughness: 0.8 }
        },
        forest: {
            albedo: [0.1, 0.3, 0.1],
            strength: 0.5
        }
    });
    check("scene.createClipmapTerrain succeeded", !!clipmap);
} catch (e) {
    check("scene.createClipmapTerrain failed: " + e.message, false);
}

if (clipmap) {
    check("clipmap.levels equals 6", clipmap.levels === 6);
    check("clipmap.resolution equals 128", clipmap.resolution === 128);
    check("clipmap.cellSize equals 2.0", clipmap.cellSize === 2.0);
    check("clipmap.triangleCount is positive", typeof clipmap.triangleCount === 'number' && clipmap.triangleCount > 0);
    check("clipmap.vertexCount is positive", typeof clipmap.vertexCount === 'number' && clipmap.vertexCount > 0);
    check("clipmap.farDistance is positive", typeof clipmap.farDistance === 'number' && clipmap.farDistance > 0);
    check("clipmap.node is a SceneNode", clipmap.node !== null && typeof clipmap.node === 'object');
}

// [3] Height Layer Population
console.log("\n[3] Height Layer Population & Updating");
if (clipmap) {
    const W = 64, H = 64;
    const heightData = new Float32Array(W * H);
    for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
            heightData[z * W + x] = Math.sin(x * 0.2) * Math.cos(z * 0.2) * 500.0 + 300.0;
        }
    }

    try {
        clipmap.setHeightLayer(0, {
            data: heightData,
            width: W,
            height: H,
            originX: 0,
            originZ: 0,
            metresPerCell: 10.0,
            wrapX: false,
            bandLimited: false
        });
        check("setHeightLayer(0, desc) succeeded", true);
        check("clipmap.layerCount is at least 1", clipmap.layerCount >= 1);
    } catch (e) {
        check("setHeightLayer failed: " + e.message, false);
    }

    // Material and detail updates
    try {
        clipmap.setSnowLine(1500.0);
        check("setSnowLine(1500) succeeded", true);

        clipmap.setDetail({ wavelength: 30.0, relief: 20.0, gain: 0.5, octaves: 4 });
        check("setDetail succeeded", true);

        clipmap.setForest({ albedo: [0.1, 0.25, 0.1], strength: 0.8 });
        check("setForest succeeded", true);
    } catch (e) {
        check("setDetail/setSnowLine/setForest failed: " + e.message, false);
    }

    // Update camera position
    try {
        clipmap.update(100.0, 500.0, 200.0);
        check("clipmap.update(100, 500, 200) succeeded", true);
    } catch (e) {
        check("clipmap.update failed: " + e.message, false);
    }

    // Elevation queries
    const elev = clipmap.elevationAt(0, 0);
    check("elevationAt(0, 0) returned valid number", typeof elev === 'number' && Number.isFinite(elev));

    const rendElev = clipmap.renderedElevationAt(0, 0);
    check("renderedElevationAt(0, 0) returned valid number", typeof rendElev === 'number' && Number.isFinite(rendElev));
}

// [4] Screenshot
console.log("\n[4] Capturing Verification Screenshot");
if (typeof advanceTime === 'function') {
    advanceTime(50);
}
if (typeof screenshot === 'function') {
    screenshot("clipmap_terrain_test.png");
    console.log("  screenshot: clipmap_terrain_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in clipmap-terrain integration test suite`);
}
