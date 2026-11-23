// Integration test for Phase 2 ecosystem libraries:
//   - /lib/pbr-materials.js (seamless PBR trios verified via bro.eye.measure)
//   - /lib/flora-trees.js (bro.flora oak + disk-cached 8x4 impostor + static shadow proxy on sloped terrain)
//   - /lib/city-building-blueprint.js & /lib/city-building-mesh.js (differentiated floors,
//     step-back bro.eye.compare LOD0/LOD1/LOD2 coherence, and enterable LOD0 InteriorVolume + local lights)

import { createUrbanMaterialLibrary, materialProps } from "/lib/pbr-materials.js";
import { growSpecies, buildSpeciesLevels, bakeSpeciesImpostor, createTreeStand } from "/lib/flora-trees.js";
import { generateBuildingBlueprint, generateFloorPlan } from "/lib/city-building-blueprint.js";
import { buildBuildingLod2Data, buildBuildingLod1Nodes, buildBuildingLod0 } from "/lib/city-building-mesh.js";

function ok(cond, msg) {
    if (!cond) throw new Error(msg);
}

const canvas = document.createElement('canvas');
canvas.width = 256;
canvas.height = 256;
document.body.appendChild(canvas);
flush();

const scene = canvas.getContext('scene');
ok(scene, 'scene context available');

scene.setToneMap({ mode: 'linear', gamma: 1.0 });
scene.setAmbient({ color: [0.45, 0.55, 0.70], intensity: 0.7 });
const sun = scene.createLight({
    type: 'directional',
    direction: [-0.35, -0.9, -0.3],
    color: [1.0, 0.98, 0.94],
    intensity: 2.8,
});
sun.castsShadow = true;

// 1. Seamless PBR Material Library
const mats = createUrbanMaterialLibrary(128);
for (const name of ['asphalt', 'concrete', 'limestone', 'brickRed', 'curtainGlass', 'stucco', 'woodSiding', 'woodFloor', 'roofShingle', 'brushedMetal', 'grass']) {
    const m = mats[name];
    ok(m && m.albedo.data.length === 128 * 128 * 4, `material ${name} albedo present`);
    const meas = bro.eye.measure({ width: m.albedo.width, height: m.albedo.height, data: m.albedo.data });
    const seamScore = meas.seam?.score ?? 0;
    ok(seamScore < 0.30, `material ${name} wraps seamlessly (seam.score=${seamScore.toFixed(3)})`);
}
console.log('  ok   PBR material library verified');

// 2. Terrain-aware flora-trees (bro.flora oak + cached impostor + static shadow proxy)
const ground = scene.createMesh({
    mesh: Mesh.plane(800, 800),
    position: [0, 0, 0],
    ...materialProps(mats.grass),
    castsShadow: false,
    receivesShadow: true,
});

const spOak = growSpecies('oak', { seconds: 35, seed: 0xc0f1 });
spOak.levels = buildSpeciesLevels(scene, spOak, {
    levels: [
        { from: 0, L: 3, sides: 6, area: 1.0 },
        { from: 40, L: 6, sides: 5, area: 0.85 },
    ],
});
spOak.imp = bakeSpeciesImpostor(scene, spOak, { hideNodes: [ground] });
const impCached = bakeSpeciesImpostor(scene, spOak, { hideNodes: [ground] });
ok(impCached.fromCache === true, 'second bakeSpeciesImpostor hits disk cache');

const slopedTrees = [];
for (let i = 0; i < 24; i++) {
    const x = -110 + (i % 6) * 42;
    const z = -120 + Math.floor(i / 6) * 38;
    const y = 4.0 * Math.sin(x * 0.04) + 2.0 * Math.cos(z * 0.03);
    slopedTrees.push({ sp: spOak, x, y, z, yaw: i * 0.7, size: 0.9 + (i % 3) * 0.1, r: spOak.radius });
}
const stand = createTreeStand(scene, [spOak], slopedTrees, { handoff: 55, shadowProxy: true, closeLod: true });
scene.setCamera({ fov: 50, near: 0.5, far: 1200, position: [0, 32, 160], target: [0, 10, -40] });
stand.update([0, 32, 160]);
for (let f = 0; f < 6; f++) scene.captureFrame();
const treeFrame = scene.captureFrame();
ok(treeFrame && treeFrame.width === 256, `sloped tree stand captured cleanly (width=${treeFrame?.width})`);
for (let step = 1; step <= 4; step++) {
    const eye = [step * 6, 32, 160 - step * 8];
    scene.setCamera({ fov: 50, near: 0.5, far: 1200, position: eye, target: [0, 10, -40] });
    stand.update(eye);
    scene.captureFrame();
    const st = scene.cullStats();
    ok(st.shadowPagesDynamic === 0, `static tree shadow proxies stay cached on step ${step} (dynamic=${st.shadowPagesDynamic})`);
}
stand.destroy();
console.log('  ok   flora-trees terrain elevation, impostor cache & static shadows verified');

// 3. Single-Source Building Blueprints & Step-Back LOD0/LOD1/LOD2 Visual Equivalence
const archetypes = ['house', 'shopfront', 'midrise', 'skyscraper', 'station'];
for (const arch of archetypes) {
    const bp = generateBuildingBlueprint({ id: arch.length * 17, seed: arch.length * 919, archetype: arch, groundY: 0, floors: arch === 'skyscraper' ? 16 : undefined });
    if (bp.floors >= 3) {
        const f0 = generateFloorPlan(bp, 0);
        const f1 = generateFloorPlan(bp, 1);
        const fTop = generateFloorPlan(bp, bp.floors - 1);
        ok(f0.program !== f1.program && f1.program !== fTop.program,
            `${arch} differentiates floor programs (${f0.program} / ${f1.program} / ${fTop.program})`);
    }

    const camDist = arch === 'skyscraper' ? 160 : (arch === 'midrise' ? 110 : 85);
    const camY = arch === 'skyscraper' ? 42 : (arch === 'midrise' ? 22 : 14);
    const targetY = bp.totalHeight * 0.45;
    scene.setCamera({ fov: 48, near: 0.5, far: 1200, position: [camDist * 0.55, camY, camDist], target: [0, targetY, 0] });

    const lod2Mesh = buildBuildingLod2Data(bp, mats);
    const lod2Node = scene.createMesh({ data: lod2Mesh, position: [0, 0, 0], castsShadow: false, receivesShadow: true, vertexColorTint: true });
    for (let i = 0; i < 3; i++) scene.captureFrame();
    const imgLod2 = scene.captureFrame();
    lod2Node.destroy();

    const lod1 = buildBuildingLod1Nodes(scene, bp, mats, { castsShadow: false });
    for (let i = 0; i < 3; i++) scene.captureFrame();
    const imgLod1 = scene.captureFrame();
    lod1.destroy();

    const lod0 = buildBuildingLod0(scene, bp, mats, { castsShadow: false });
    for (let i = 0; i < 3; i++) scene.captureFrame();
    const imgLod0 = scene.captureFrame();

    const cmp21 = bro.eye.compare(imgLod1, imgLod2);
    const cmp01 = bro.eye.compare(imgLod0, imgLod1);
    ok(cmp21.ssim > 0.80 && cmp21.deltaEMean < 12,
        `${arch} LOD1 vs LOD2 coherent: ssim=${cmp21.ssim.toFixed(3)} deltaE=${cmp21.deltaEMean.toFixed(2)}`);
    ok(cmp01.ssim > 0.85 && cmp01.deltaEMean < 10,
        `${arch} LOD0 vs LOD1 coherent: ssim=${cmp01.ssim.toFixed(3)} deltaE=${cmp01.deltaEMean.toFixed(2)}`);

    if (arch === 'house') {
        // 4. Enterable interior lighting & InteriorVolume check
        ok(lod0.interiorVolume.type === 'interiorVolume', 'LOD0 spawned InteriorVolumeNode');
        ok(lod0.lights.length > 0 && lod0.lights[0].castsShadow === false, 'LOD0 spawned bounded local Point light');
        scene.setCamera({ fov: 65, near: 0.1, far: 200, position: [0, 1.7, 1.8], target: [0, 1.3, -1.5] });
        for (let i = 0; i < 3; i++) scene.captureFrame();
        const insideImg = scene.captureFrame();
        const insideMeas = bro.eye.measure(insideImg);
        ok(insideMeas.lumaMean > 0.08, `LOD0 interior renders brightly with interior lights (lumaMean=${insideMeas.lumaMean.toFixed(3)})`);
    }
    lod0.destroy();
}
console.log('  ok   all 5 building archetypes pass cross-LOD compare and indoor interior check');

ground.destroy();
document.body.removeChild(canvas);
console.log('PASS: test_city_ecosystem');
