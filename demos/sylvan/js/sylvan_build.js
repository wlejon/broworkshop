// js/sylvan_build.js — Ecosystem-driven botanical & aquatic scene graph for Sylvan.

import { skyEnvironment } from '/lib/kit/sky.js';
import {
  TERRAIN_CAUSTIC_BK,
  WATER_SHADER_BK,
  WATERFALL_SHADER_BK,
  KOI_SHADER_BK,
  PLANT_SWAY_BK,
  TREE_SWAY_BK,
} from './shaders.js';
import {
  makeMossyBasalt,
  makeMapleBark,
  makePalmateMapleLeaf,
  makeFernFrondTex,
  makePondBedTexture,
  makeKoiTexture,
} from './textures.js';
import {
  islandHeightAt,
  createSculptedIslandTerrain,
  createPondWaterDisk,
  createSculptedBoulder,
  createCurvedWaterfall,
  createAnatomicalKoi,
  createCurledLilyPad,
  createSmoothTube,
  createSedgeClumpGeo,
  createCarvedLanternMeshes,
} from './organic_geometry.js';

function paintUniformColor(mesh, r = 1, g = 1, b = 1, a = 1) {
  const vc = mesh.vertexCount;
  const cols = new Float32Array(vc * 4);
  for (let i = 0; i < vc; ++i) {
    cols[i * 4 + 0] = r;
    cols[i * 4 + 1] = g;
    cols[i * 4 + 2] = b;
    cols[i * 4 + 3] = a;
  }
  mesh.colors = cols;
  return mesh;
}

function paintLotusColors(mesh, baseRgb, tipRgb) {
  const src = mesh.colors;
  const vc = mesh.vertexCount;
  const out = new Float32Array(vc * 4);
  for (let i = 0; i < vc; ++i) {
    const r = src[i * 4 + 0];
    const g = src[i * 4 + 1];
    const b = src[i * 4 + 2];
    if (g < 0.05 && b < 0.05) {
      // Petal vertex: leafCard packed windBend in r (0 = base -> 1 = tip)
      const t = Math.max(0, Math.min(1, r));
      out[i * 4 + 0] = baseRgb[0] + (tipRgb[0] - baseRgb[0]) * t;
      out[i * 4 + 1] = baseRgb[1] + (tipRgb[1] - baseRgb[1]) * t;
      out[i * 4 + 2] = baseRgb[2] + (tipRgb[2] - baseRgb[2]) * t;
      out[i * 4 + 3] = 1.0;
    } else {
      // Preserve golden stamen dome centerColor
      out[i * 4 + 0] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 1.0;
    }
  }
  mesh.colors = out;
  return mesh;
}

function bakeLeafColors(mesh, vertsPerLeaf) {
  const palette = [
    [0.48, 0.05, 0.04], // deep oxblood crimson
    [0.66, 0.09, 0.05], // true Japanese maple scarlet
    [0.80, 0.16, 0.05], // fiery vermilion
    [0.88, 0.28, 0.06], // copper autumn orange
    [0.84, 0.42, 0.09], // warm amber tip
  ];
  const vc = mesh.vertexCount;
  const cols = new Float32Array(vc * 4);
  for (let i = 0; i < vc; ++i) {
    const leafIdx = (i / Math.max(1, vertsPerLeaf)) | 0;
    const h = Math.sin(leafIdx * 12.9898) * 43758.5453;
    const f = h - Math.floor(h);
    const p = palette[(f * palette.length) | 0];
    const jitter = 0.88 + 0.22 * ((h * 7.13) - Math.floor(h * 7.13));
    cols[i * 4 + 0] = Math.min(1, p[0] * jitter);
    cols[i * 4 + 1] = Math.min(1, p[1] * jitter);
    cols[i * 4 + 2] = Math.min(1, p[2] * jitter);
    cols[i * 4 + 3] = 1.0;
  }
  mesh.colors = cols;
  return mesh;
}

function buildJapaneseMaple(add, barkTex, leafCutoutTex, rootPos, registerPick) {
  const [rx, ry, rz] = rootPos;
  const rootY = ry - 0.12;

  // Lush multi-tiered asymmetric maple crown filling fine branching twig network
  const attractors = [];
  for (let i = 0; i < 320; ++i) {
    const u = ((i * 0.6180339887) % 1);
    const v = ((i * 0.3819660112) % 1);
    const w = ((i * 0.7548776662) % 1);
    const th = u * Math.PI * 2;
    const rXZ = 0.20 + Math.pow(v, 0.62) * 1.45;
    const tierY = 0.92 + w * 1.38 - rXZ * 0.12;
    attractors.push([
      rx + 0.56 + Math.cos(th) * rXZ,
      rootY + tierY,
      rz + 0.48 + Math.sin(th) * rXZ * 0.92,
    ]);
  }

  const trunkSegs = Mesh.spaceColonize(
    attractors,
    [[rx, rootY, rz]],
    [0.24, 0.95, 0.20],
    { attractionRadius: 2.3, killRadius: 0.16, segmentLength: 0.13, maxIterations: 115, tropism: [0.24, 0.18, 0.20], tropismWeight: 0.16 },
  );
  const thickened = Mesh.thickenBranches(trunkSegs, 0.008, 2.3);

  // Merge 4 surface buttress roots gripping gently into terrain contour
  const woodParts = [Mesh.meshBranches(thickened, 8)];
  for (let i = 0; i < 4; ++i) {
    const ang = (i / 4) * Math.PI * 2 + 0.45;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const pts = [];
    for (let s = 0; s <= 4; ++s) {
      const f = s / 4;
      const dist = 0.05 + f * 0.52;
      const px = rx + dx * dist, pz = rz + dz * dist;
      const gh = islandHeightAt(px, pz);
      const py = s === 0 ? (ry + 0.18) : (s === 4 ? gh - 0.06 : gh + (1 - f) * 0.08);
      pts.push([px, py, pz]);
    }
    woodParts.push(Mesh.tube(pts, [0.10, 0.068, 0.044, 0.025, 0.015], 8));
  }
  const barkMesh = Mesh.merge(woodParts);

  const treeUniforms = { time: 0.0, breeze: 0.52, rootPos: [rx, rootY, rz], flutterAmp: 0.0 };
  const leafUniforms = { time: 0.0, breeze: 0.52, rootPos: [rx, rootY, rz], flutterAmp: 0.016 };

  const trunkNode = add({
    name: 'Japanese Maple Wood',
    mesh: barkMesh,
    texture: barkTex,
    color: '#63483b', roughness: 0.90, metallic: 0.02,
  });
  trunkNode.setShader({ module: TREE_SWAY_BK, file: 'tree_wood.bk', uniforms: treeUniforms });

  const leafCard = Mesh.leafCard('oval', {
    width: 0.22, length: 0.24, bend: 0.34, cup: 0.24,
    fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 4,
  });
  const scatteredLeaves = Mesh.scatterLeaves(thickened, leafCard, {
    maxRadius: 0.062, minDepth: 2, perUnitLength: 290,
    upBias: 0.18, tiltJitter: 1.05, rollJitter: 1.2,
    baseScale: 1.04, scaleJitter: 0.42, dedupRadius: 0.018,
    avoid: Mesh.capsuleFieldFromSegments(thickened, 1.02),
    obstaclePushout: 0.018, seed: 1892,
  });
  bakeLeafColors(scatteredLeaves, leafCard.vertexCount);

  const leavesNode = add({
    name: 'Japanese Maple Canopy',
    mesh: scatteredLeaves,
    texture: leafCutoutTex,
    color: '#ffffff', roughness: 0.58, metallic: 0.0,
    alphaCutoff: 0.42, twoSided: true, subsurface: 0.68, vertexColorTint: true,
    castsShadow: true, receivesShadow: true,
  });
  leavesNode.setShader({ module: TREE_SWAY_BK, file: 'tree_leaves.bk', uniforms: leafUniforms });

  registerPick(trunkNode, {
    id: 'maple', name: 'Gnarled Crimson Japanese Maple', kind: 'Acer palmatum · Space-Colonized',
    desc: 'Organic pipe-model maple trunk & twigs bearing cupped 5-lobed palmate leaf cards synchronized in the GPU breeze field.',
  });
  registerPick(leavesNode, {
    id: 'maple_leaves', name: 'Palmate Autumn Maple Foliage', kind: 'Subsurface Translucent Crown',
    desc: 'Hundreds of serrated autumn crimson & amber leaf cards growing directly from outer twig tips with backlit translucency.',
  });

  return { trunkNode, leavesNode };
}

function buildFernRosette(add, frondMesh, fernTex, fx, fz, seed, fi) {
  const fy = islandHeightAt(fx, fz);
  const fronds = [];
  for (let k = 0; k < 10; ++k) {
    const a = (k / 10) * Math.PI * 2 + seed * 0.5;
    // Negative X rotation lifts +Z leaf card upward out of the ground!
    const tilt = -(0.34 + (k % 2) * 0.24);
    const f = frondMesh.clone();
    f.rotate(1, 0, 0, tilt).rotate(0, 1, 0, a).scale(0.90 + (k % 3) * 0.15);
    fronds.push(f);
  }
  const tuft = add({
    name: `Forest Fern Tussock ${fi + 1}`,
    mesh: Mesh.merge(fronds),
    position: [fx, fy + 0.01, fz],
    texture: fernTex, color: '#6cb858', roughness: 0.68, metallic: 0.0,
    alphaCutoff: 0.40, twoSided: true, subsurface: 0.55,
  });
  tuft.setShader({
    module: PLANT_SWAY_BK, file: `fern_${fi}.bk`,
    uniforms: { time: 0.0, breeze: 0.52, maxH: 0.46, phase: fi * 1.3 },
  });
  return tuft;
}

export function buildSylvanScene(scene, registerPick) {
  const basaltTex = makeMossyBasalt();
  const barkTex = makeMapleBark();
  const leafCutoutTex = makePalmateMapleLeaf(128, 128);
  const fernTex = makeFernFrondTex(128, 256);
  const bedTex = makePondBedTexture(256, 256);
  const koiTextures = {
    kohaku: makeKoiTexture('kohaku'),
    yamabuki: makeKoiTexture('yamabuki'),
    showa: makeKoiTexture('showa'),
  };

  // Ecosystem HDR sky, reflection probe, SSAO & MSAA
  skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 0.48, rotation: 0.6 });
  scene.setGroundBounce([0.10, 0.14, 0.07]);
  scene.setSSAO({ radius: 0.36, bias: 0.02, intensity: 1.0 });
  scene.setMSAA(4);
  scene.createReflectionProbe({ position: [0, 0.48, 0.12], size: [8.5, 5.5, 8.5], resolution: 128 });

  const add = (opts) => (opts.mesh ? scene.createMesh({ castsShadow: true, receivesShadow: true, ...opts }) : scene.createNode(opts));
  const rockNodes = [];
  const terrainUniforms = { time: 0.0, sunBoost: 1.0, mossBoost: 1.0, pad: 0.0 };

  const attachTerrainShader = (node, moss = 1.0) => {
    node.setShader({
      module: TERRAIN_CAUSTIC_BK, file: 'terrain_caustic.bk',
      uniforms: { ...terrainUniforms, mossBoost: moss },
    });
    rockNodes.push({ node, baseMoss: moss });
  };

  // 1. Sculpted Pond Bed & Mossy Diorama Island + Submerged River Cobbles (visible through clear water!)
  const terrain = add({
    name: 'Sanctuary Island Terrain',
    mesh: createSculptedIslandTerrain(72),
    texture: bedTex, color: '#788474', roughness: 0.90, metallic: 0.02,
  });
  attachTerrainShader(terrain, 0.85);

  // Submerged rounded river pebbles resting inside sunken bowl (-0.34 .. -0.20)
  for (let i = 0; i < 16; ++i) {
    const a = i * 2.39996;
    const r = 0.28 + Math.sqrt(i / 16) * 1.28;
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    const py = islandHeightAt(px, pz);
    const cob = add({
      name: `Submerged Pebble ${i + 1}`,
      mesh: createSculptedBoulder(0.11 + (i % 3) * 0.04, 0.055, 0.09 + (i % 2) * 0.03, 19.0 + i * 2.1),
      position: [px, py, pz],
      texture: bedTex, color: i % 2 === 0 ? '#747a78' : '#8a7e6e', roughness: 0.48, metallic: 0.04,
    });
    attachTerrainShader(cob, 0.0);
  }

  // 2. Sculpted Waterfall Gorge & Natural Perimeter Basalt Boulders (icosphere-subdivided, zero UV pinch)
  const cascadeCliff = add({
    name: 'Cascade Recessed Cliff',
    mesh: createSculptedBoulder(1.12, 0.86, 0.56, 2.3),
    position: [0.85, islandHeightAt(0.85, -1.78) - 0.04, -1.78],
    texture: basaltTex, color: '#747d7a', roughness: 0.72, metallic: 0.04,
  });
  attachTerrainShader(cascadeCliff, 1.0);
  const cascadeShelf = add({
    name: 'Cascade Spill Ledge',
    mesh: createSculptedBoulder(0.62, 0.34, 0.42, 6.7),
    position: [0.72, islandHeightAt(0.72, -1.42) + 0.14, -1.42],
    texture: basaltTex, color: '#687270', roughness: 0.45, metallic: 0.05,
  });
  attachTerrainShader(cascadeShelf, 0.7);
  const cliffRight = add({
    name: 'Cascade Right Buttress',
    mesh: createSculptedBoulder(0.58, 0.66, 0.52, 3.7),
    position: [1.56, islandHeightAt(1.56, -1.36) - 0.03, -1.36],
    texture: basaltTex, color: '#767f7c', roughness: 0.78, metallic: 0.04,
  });
  attachTerrainShader(cliffRight, 1.0);
  const cliffLeft = add({
    name: 'Cascade Left Buttress',
    mesh: createSculptedBoulder(0.54, 0.52, 0.48, 5.1),
    position: [-0.06, islandHeightAt(-0.06, -1.56) - 0.03, -1.56],
    texture: basaltTex, color: '#6d7774', roughness: 0.62, metallic: 0.04,
  });
  attachTerrainShader(cliffLeft, 0.95);
  registerPick(cascadeCliff, {
    id: 'cascade', name: 'Terraced Mossy Basalt Cascade', kind: 'Layered Spring Waterfall',
    desc: 'Stepped volcanic basalt gorge bathed in slope-driven moss, feeding twin tumbling spring curtains and mist.',
  });

  const rimBoulders = [
    [-2.06, -0.18, 0.46, 0.36, 0.40, 1.5],
    [-1.72, 1.32, 0.42, 0.30, 0.38, 3.2],
    [-0.58, 2.02, 0.46, 0.26, 0.34, 5.4],
    [0.84, 1.98, 0.44, 0.28, 0.36, 7.1],
    [1.88, 1.24, 0.42, 0.30, 0.38, 4.3],
    [2.16, -0.36, 0.48, 0.36, 0.44, 8.6],
    [-0.78, -1.94, 0.52, 0.40, 0.42, 2.9],
  ];
  rimBoulders.forEach(([bx, bz, rx, ry, rz, seed], i) => {
    const bNode = add({
      name: `Basin Rim Boulder ${i + 1}`,
      mesh: createSculptedBoulder(rx, ry, rz, seed),
      position: [bx, islandHeightAt(bx, bz) - 0.06, bz],
      texture: basaltTex, color: '#58605d', roughness: 0.72, metallic: 0.04,
    });
    attachTerrainShader(bNode, 1.0);
  });

  // 3. Translucent Flowing Pond Water + Exposed Curved Waterfall Streams + Mist Particles
  const pondWater = add({
    name: 'Crystal Pond Water',
    mesh: createPondWaterDisk(2.08, 28, 64),
    position: [0, 0.0, 0],
    color: [0.06, 0.28, 0.32, 0.54], roughness: 0.03, metallic: 0.02,
    castsShadow: false, receivesShadow: true,
  });
  pondWater.setShader({
    module: WATER_SHADER_BK, file: 'pond_water.bk',
    uniforms: { time: 0.0, breeze: 0.52, clarity: 0.85, pad: 0.0 },
  });
  registerPick(pondWater, {
    id: 'pond', name: 'Spring-Fed Sanctuary Basin', kind: 'Translucent Rippling Pond',
    desc: 'Real-time wave-displaced Fresnel surface revealing river pebbles, lily stems, sunlight caustics, and swimming koi below.',
  });

  const fallMain = add({
    name: 'Main Cascade Curtain',
    mesh: createCurvedWaterfall([
      [0.86, 0.96, -1.52],
      [0.86, 0.78, -1.28],
      [0.86, 0.52, -1.10],
      [0.86, 0.24, -1.01],
      [0.86, -0.05, -0.98],
    ], 0.14, 0.26, 12),
    color: [0.80, 0.96, 1.0, 0.88], roughness: 0.14, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  fallMain.setShader({
    module: WATERFALL_SHADER_BK, file: 'fall_main.bk',
    uniforms: { time: 0.0, flow: 1.0, glow: 1.0, pad: 0.0 },
  });

  const fallSide = add({
    name: 'Side Spring Veil',
    mesh: createCurvedWaterfall([
      [0.34, 0.72, -1.42],
      [0.34, 0.48, -1.20],
      [0.34, 0.22, -1.08],
      [0.34, -0.05, -1.04],
    ], 0.08, 0.14, 10),
    color: [0.82, 0.97, 1.0, 0.84], roughness: 0.16, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  fallSide.setShader({
    module: WATERFALL_SHADER_BK, file: 'fall_side.bk',
    uniforms: { time: 0.0, flow: 0.85, glow: 0.95, pad: 0.0 },
  });

  const mistParticles = scene.createParticles3D({
    name: 'Cascade Plunge Mist',
    position: [0.76, 0.04, -0.96],
    maxParticles: 70, rate: 18,
    lifetime: { min: 1.2, max: 2.2 },
    size: { start: 0.14, end: 0.38 },
    color: { start: [0.86, 0.96, 1.0, 0.28], end: [0.86, 0.96, 1.0, 0.0] },
    velocity: { direction: [0, 1, 0.35], spread: 55, speed: 0.22, speedSpread: 0.10 },
    gravity: [0, -0.05, 0], drag: 0.55, softness: 0.18,
    shape: { type: 'sphere', radius: 0.22 },
  });

  // 4. Connected Space-Colonized Japanese Maple Tree + 5-Lobed Palmate Leaves
  const mapleOrigin = [-1.72, islandHeightAt(-1.72, -1.16), -1.16];
  const mapleTree = buildJapaneseMaple(add, barkTex, leafCutoutTex, mapleOrigin, registerPick);

  // 5. Lush Pinnate Ferns + Merged Sedge/Cattail Clumps with Synchronized Rooted Sway
  const frondCard = paintUniformColor(Mesh.leafCard('frond', {
    width: 0.17, length: 0.52, bend: 0.65, cup: 0.16,
    fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 8,
  }), 1, 1, 1, 1);
  const fernSites = [[-2.78, 0.12], [-2.28, 1.92], [1.72, 2.02], [2.72, -0.96]];
  const plantNodes = [];
  fernSites.forEach(([fx, fz], fi) => {
    plantNodes.push(buildFernRosette(add, frondCard, fernTex, fx, fz, 2.1 + fi * 1.4, fi));
  });

  const cattailClumps = [[-2.35, 0.86], [2.46, 1.04], [2.52, -0.18]];
  cattailClumps.forEach(([rx, rz], ri) => {
    const ry = islandHeightAt(rx, rz);
    const sedgeNode = add({
      name: `Bank Sedge Clump ${ri + 1}`,
      mesh: createSedgeClumpGeo(14, ri + 1.0),
      position: [rx, ry, rz],
      color: '#4f7f38', roughness: 0.68, metallic: 0.0,
    });
    sedgeNode.setShader({ module: PLANT_SWAY_BK, file: `sedge_${ri}.bk`, uniforms: { time: 0, breeze: 0.52, maxH: 0.65, phase: ri * 1.7 } });
    plantNodes.push(sedgeNode);

    for (let k = 0; k < 3; ++k) {
      const ang = (k / 3) * Math.PI * 2 + ri;
      const sx = rx + Math.cos(ang) * 0.09, sz = rz + Math.sin(ang) * 0.09;
      const sy = islandHeightAt(sx, sz);
      const h = 0.68 + k * 0.11;
      const stalkMesh = createSmoothTube([[0, -0.04, 0], [0.012, h * 0.55, 0.008], [0.024, h + 0.06, 0.015]], [0.015, 0.011, 0.007], 8);
      const stalk = add({
        name: `Cattail Reed ${ri}_${k}`,
        mesh: stalkMesh,
        position: [sx, sy, sz],
        color: '#507d3a', roughness: 0.66, metallic: 0.0,
      });
      const headMesh = createSmoothTube([[0.018, h * 0.72, 0.011], [0.020, h * 0.84, 0.013], [0.023, h * 0.96, 0.015]], [0.016, 0.028, 0.014], 10);
      const head = add({
        name: `Cattail Seed Head ${ri}_${k}`,
        mesh: headMesh,
        position: [sx, sy, sz],
        color: '#5c361d', roughness: 0.92, metallic: 0.0,
      });
      const u = { time: 0.0, breeze: 0.52, maxH: h + 0.06, phase: ri * 1.7 + k * 0.35 };
      stalk.setShader({ module: PLANT_SWAY_BK, file: `cattail_s_${ri}_${k}.bk`, uniforms: u });
      head.setShader({ module: PLANT_SWAY_BK, file: `cattail_h_${ri}_${k}.bk`, uniforms: u });
      plantNodes.push(stalk, head);
    }
  });

  // 6. Rooted Water Lilies & Cupped Sacred Lotus Blossoms (stem stops -0.008u clear below pad, <0.028u structure contact)
  const lilyCoords = [
    [-1.44, 0.42, 0.24, true, 0.4],
    [-1.08, 1.06, 0.20, false, 1.9],
    [1.46, 0.58, 0.23, true, 2.7],
    [1.06, 1.28, 0.20, false, 4.1],
    [-0.12, 1.48, 0.24, true, 5.2],
  ];
  const lotusGeo = Mesh.flower({
    petalCount: 10, layers: 3, layerTwist: 0.42, petalShape: 'petal',
    petalLength: 0.115, petalWidth: 0.068, petalBend: 0.24, petalCup: 0.75,
    shapedPetals: true, outerTilt: -0.24, innerTilt: -0.14, centerRadius: 0.032, centerHeight: 0.022,
    centerColor: [0.98, 0.84, 0.22],
  });
  const lotusPink = paintLotusColors(lotusGeo.clone(), [0.98, 0.90, 0.92], [0.96, 0.56, 0.68]);
  const lotusIvory = paintLotusColors(lotusGeo.clone(), [1.0, 0.97, 0.94], [0.98, 0.80, 0.86]);
  const lilyGroups = [];
  lilyCoords.forEach(([lx, lz, rad, hasBloom, yaw], li) => {
    const bedY = islandHeightAt(lx, lz) - 0.03;
    add({
      name: `Lily Submerged Stem ${li + 1}`,
      mesh: createSmoothTube([[lx, bedY, lz], [lx + 0.025, bedY * 0.5, lz - 0.02], [lx, -0.008, lz]], 0.011, 8),
      color: '#2c5832', roughness: 0.72, metallic: 0.0,
    });
    const padPivot = add({ name: `Water Lily ${li + 1} Pivot`, position: [lx, 0.004, lz] });
    padPivot.rotationY = yaw;
    const pad = add({
      name: `Water Lily ${li + 1} Pad`,
      mesh: createCurledLilyPad(rad, 28),
      color: '#ffffff', vertexColorTint: true, roughness: 0.44, metallic: 0.02,
    });
    padPivot.add(pad);
    if (hasBloom) {
      const bloom = add({
        name: `Water Lily ${li + 1} Lotus`,
        mesh: li === 0 ? lotusPink : lotusIvory,
        position: [0, 0.012, 0],
        color: '#ffffff', vertexColorTint: true,
        emissive: 0.10, emissiveColor: [0.95, 0.75, 0.84], roughness: 0.42, metallic: 0.0,
        twoSided: true, subsurface: 0.45,
      });
      padPivot.add(bloom);
      registerPick(bloom, {
        id: `lotus_${li}`, name: 'Sacred Cupped Water Lotus', kind: 'Rooted Aquatic Bloom',
        desc: 'Three-tier cupped lotus floating flush on the translucent pond with its stem rooted into the pebble bed below.',
      });
    }
    lilyGroups.push({ padPivot, lx, lz, phase: li * 1.4 });
  });

  // 7. Carved Hexagonal Basalt Tōrō Lantern seated securely onto flat shore pocket (ember touches firebox floor)
  const lx = 2.18, lz = 0.44, ly = islandHeightAt(lx, lz) - 0.04;
  const lantern = createCarvedLanternMeshes();
  const lanternStone = add({
    name: 'Carved Basalt Lantern',
    mesh: lantern.stone,
    position: [lx, ly, lz],
    texture: basaltTex, color: '#464d4b', roughness: 0.84, metallic: 0.04,
  });
  attachTerrainShader(lanternStone, 0.75);
  const lanternEmber = add({
    name: 'Lantern Warm Ember',
    mesh: Mesh.sphere(0.060, 12, 10).translate(0, 0.60, 0),
    position: [lx, ly, lz],
    color: '#ffb44a', emissive: 2.2, emissiveColor: [1.0, 0.65, 0.22], roughness: 0.32, metallic: 0.0,
    castsShadow: false,
  });

  // 8. Five Seamless Underwater Nishikigoi Swimming Inside Translucent Pond
  const koiMesh = createAnatomicalKoi();
  const koiSpecs = [
    { name: 'Kohaku Matriarch', tex: koiTextures.kohaku, rx: 0.30, rz: 0.26, phase: 0.0, dir: 1, y: -0.095, scale: 0.96, bend: 0.046 },
    { name: 'Yamabuki Ogon', tex: koiTextures.yamabuki, rx: 0.62, rz: 0.52, phase: 2.1, dir: -1, y: -0.115, scale: 0.92, bend: 0.044 },
    { name: 'Showa Sanshoku', tex: koiTextures.showa, rx: 0.94, rz: 0.78, phase: 4.2, dir: 1, y: -0.090, scale: 0.90, bend: 0.044 },
    { name: 'Kohaku Prince', tex: koiTextures.kohaku, rx: 1.24, rz: 1.00, phase: 0.9, dir: -1, y: -0.105, scale: 0.88, bend: 0.042 },
    { name: 'Golden Showa', tex: koiTextures.showa, rx: 1.24, rz: 1.00, phase: 4.04, dir: -1, y: -0.100, scale: 0.86, bend: 0.042 },
  ];
  const koiList = koiSpecs.map((ks) => {
    const node = add({
      name: `Koi ${ks.name}`,
      mesh: koiMesh,
      position: [0, ks.y, 0.16],
      scale: [ks.scale, ks.scale, ks.scale],
      texture: ks.tex, color: '#ffffff', roughness: 0.22, metallic: 0.04,
    });
    node.setShader({
      module: KOI_SHADER_BK, file: `koi_${ks.name.replace(/\s+/g, '_')}.bk`,
      uniforms: { time: 0.0, swimPhase: ks.phase, bendAmp: ks.bend, turnCurve: ks.dir * 0.015 },
    });
    registerPick(node, {
      id: `koi_${ks.name}`, name: ks.name, kind: 'Continuous Living Nishikigoi',
      desc: 'Single-mesh sculpted carp propelling itself underwater via GPU travelling S-waves beneath sunlit caustics.',
    });
    return { ...ks, node };
  });

  // 9. Palmate Drifting Maple Leaves, Soft Additive Firefly Particles & Translucent Dragonflies
  const driftLeafCard = paintUniformColor(Mesh.leafCard('lobed', { width: 0.085, length: 0.105, bend: 0.35, cup: 0.28, fullUV: true, shapedSilhouette: true }), 1, 1, 1, 1);
  const driftingLeaves = [];
  for (let i = 0; i < 10; ++i) {
    const lf = add({
      name: `Drifting Leaf ${i + 1}`,
      mesh: driftLeafCard,
      texture: leafCutoutTex,
      color: i % 2 === 0 ? '#dc4520' : '#ea7e26',
      alphaCutoff: 0.42, twoSided: true, subsurface: 0.55, roughness: 0.60, metallic: 0.0,
      castsShadow: false,
    });
    driftingLeaves.push({
      node: lf,
      bx: Math.cos(i * 0.628) * 0.72,
      bz: 0.18 + Math.sin(i * 0.628) * 0.58,
      phase: i * 0.1,
    });
  }

  const dragonflies = [];
  const dfBodyGeo = createSmoothTube([[0, 0, 0], [-0.04, 0.006, 0], [-0.14, 0.002, 0]], [0.009, 0.007, 0.004], 8);
  const dfWingL = paintUniformColor(Mesh.leafCard('oval', { width: 0.024, length: 0.125, bend: 0.08, cup: 0.08, shapedSilhouette: true }).rotate(0, 1, 0, Math.PI * 0.5), 1, 1, 1, 1);
  const dfWingR = paintUniformColor(Mesh.leafCard('oval', { width: 0.024, length: 0.125, bend: 0.08, cup: 0.08, shapedSilhouette: true }).rotate(0, 1, 0, -Math.PI * 0.5), 1, 1, 1, 1);
  for (let i = 0; i < 2; ++i) {
    const piv = add({ name: `Dragonfly ${i + 1}`, position: [0.58 - i * 0.25, 0.56 + i * 0.16, 0.55 + i * 0.28] });
    piv.add(add({ name: `Dragonfly Body ${i + 1}`, mesh: dfBodyGeo, color: '#28cfe2', emissive: 0.25, emissiveColor: [0.15, 0.75, 0.90], roughness: 0.20, metallic: 0.68 }));
    const wL = add({ name: `Dragonfly Wing L ${i + 1}`, mesh: dfWingL, position: [-0.032, 0.008, 0.005], color: [0.85, 0.96, 1.0, 0.52], twoSided: true, roughness: 0.15, metallic: 0.1, castsShadow: false });
    const wR = add({ name: `Dragonfly Wing R ${i + 1}`, mesh: dfWingR, position: [-0.032, 0.008, -0.005], color: [0.85, 0.96, 1.0, 0.52], twoSided: true, roughness: 0.15, metallic: 0.1, castsShadow: false });
    piv.add(wL);
    piv.add(wR);
    dragonflies.push({
      piv, wL, wR, phase: i * 3.1,
      cx: 0.58 - i * 0.25, cz: 0.55 + i * 0.28,
      height: 0.56 + i * 0.16, radX: 0.52, radZ: 0.36,
    });
  }

  const fireflyParticles = scene.createParticles3D({
    name: 'Sanctuary Fireflies',
    position: [0.0, 0.72, 0.15],
    maxParticles: 48, rate: 9,
    lifetime: { min: 2.2, max: 3.8 },
    size: { start: 0.045, end: 0.008 },
    color: { start: [1.0, 0.88, 0.35, 1.0], end: [1.0, 0.65, 0.15, 0.0] },
    blend: 'additive',
    velocity: { direction: [0, 1, 0], spread: 180, speed: 0.14, speedSpread: 0.08 },
    gravity: [0, 0.02, 0], drag: 0.4, softness: 0.12,
    shape: { type: 'sphere', radius: 1.55 },
  });

  const lights = {
    key: scene.createLight({ name: 'Morning Canopy Sun', type: 'directional', position: [5.5, 8.5, 6.2], direction: [-0.48, -0.76, -0.58], color: [1.0, 0.96, 0.88], intensity: 3.6, castsShadow: true, shadowBias: 0.0005 }),
    rim: scene.createLight({ name: 'Cascade Mist Rim', type: 'directional', position: [-6.0, 5.0, -6.5], direction: [0.58, -0.45, 0.65], color: [0.68, 0.88, 1.0], intensity: 1.9, castsShadow: false }),
    poolFill: scene.createLight({ name: 'Basin Caustic Fill', type: 'point', position: [0.5, 1.8, 1.2], color: [0.76, 0.94, 0.98], intensity: 4.5, range: 11.0, castsShadow: false }),
    lanternLight: scene.createLight({ name: 'Stone Lantern Glow', type: 'point', position: [lx, ly + 0.62, lz], color: [1.0, 0.66, 0.26], intensity: 2.2, range: 4.8, castsShadow: false }),
  };

  return {
    pondWater, fallMain, fallSide, mistParticles, fireflyParticles,
    rockNodes, plantNodes, mapleTree, lilyGroups, koiList,
    dragonflies, driftingLeaves, lanternEmber, lights,
  };
}
