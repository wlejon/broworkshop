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
  makePondBedTexture,
} from './textures.js';
import {
  makeRockPbrSet,
  makeBarkPbrSet,
  makeLeafPbrSet,
  makeFernPbrSet,
  makeKoiPbrSet,
  makeSoftGlowTex,
} from './pbr_textures.js';
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
  createDragonflyMeshes,
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

function bakeLeafColors(mesh, crownCenter) {
  const pos = mesh.positions;
  const vc = mesh.vertexCount;
  const cols = new Float32Array(vc * 4);
  for (let i = 0; i < vc; ++i) {
    const px = pos[i * 3 + 0], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const h = Math.sin(px * 19.3 + py * 37.7 + pz * 11.1) * 43758.5453;
    const f = h - Math.floor(h);
    // True 3D crown-depth AO: shadowed deep burgundy inside & low vs sunlit crimson-vermilion on upper outer rim
    const dOut = Math.min(1.0, Math.hypot(px - crownCenter[0], pz - crownCenter[2]) / 1.35);
    const up = Math.max(0.0, Math.min(1.0, (py - (crownCenter[1] - 0.55)) / 1.25));
    const sunlit = Math.max(0.0, Math.min(1.0, dOut * 0.45 + up * 0.65 + (f - 0.5) * 0.25));

    const r = 0.24 + sunlit * 0.54;
    const g = 0.03 + sunlit * (sunlit * 0.16);
    const b = 0.03 + sunlit * 0.03;
    cols[i * 4 + 0] = Math.min(0.88, r);
    cols[i * 4 + 1] = Math.min(0.24, g);
    cols[i * 4 + 2] = Math.min(0.09, b);
    cols[i * 4 + 3] = 1.0;
  }
  mesh.colors = cols;
  return mesh;
}

function buildJapaneseMaple(add, barkSet, leafSet, rootPos, registerPick) {
  const [rx, ry, rz] = rootPos;
  const rootY = ry - 0.12;

  // Layered asymmetric horticultural Acer palmatum: 5 tiered horizontal cloud pads leaning over pond
  const tierCenters = [
    [rx + 0.34, rootY + 1.02, rz + 0.18, 0.92, 0.20],
    [rx + 0.98, rootY + 1.24, rz + 0.68, 1.12, 0.22],
    [rx + 1.32, rootY + 0.96, rz + 0.88, 0.78, 0.16],
    [rx + 0.56, rootY + 1.56, rz + 0.05, 1.10, 0.24],
    [rx + 0.14, rootY + 1.76, rz + 0.54, 0.86, 0.20],
  ];
  const attractors = [];
  for (let ti = 0; ti < tierCenters.length; ++ti) {
    const [tx, ty, tz, radXZ, flatY] = tierCenters[ti];
    for (let i = 0; i < 110; ++i) {
      const u = ((i * 0.6180339887 + ti * 0.17) % 1);
      const v = ((i * 0.3819660112 + ti * 0.31) % 1);
      const w = ((i * 0.7548776662) % 1) - 0.5;
      const th = u * Math.PI * 2;
      const rr = (0.14 + Math.pow(v, 0.55) * 0.86) * radXZ;
      attractors.push([tx + Math.cos(th) * rr, ty + w * flatY, tz + Math.sin(th) * rr * 0.88]);
    }
  }

  const trunkSegs = Mesh.spaceColonize(
    attractors,
    [[rx, rootY, rz]],
    [0.32, 0.90, 0.24],
    { attractionRadius: 2.4, killRadius: 0.14, segmentLength: 0.12, maxIterations: 120, tropism: [0.34, 0.10, 0.28], tropismWeight: 0.18 },
  );
  const thickened = Mesh.thickenBranches(trunkSegs, 0.007, 2.3);

  // Extract real overhanging outer branch tips for tree-to-water falling leaf lifecycle
  const twigTips = [];
  for (const seg of thickened) {
    if (seg.radius < 0.022 && seg.to[0] > -1.35 && seg.to[2] > -1.05 && seg.to[1] > 0.72) {
      twigTips.push(seg.to.slice());
    }
  }
  if (twigTips.length === 0) twigTips.push([rx + 0.85, rootY + 1.25, rz + 0.65]);

  // Merge 4 gnarled surface buttress roots gripping gently into terrain contour
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
  const leafUniforms = { time: 0.0, breeze: 0.52, rootPos: [rx, rootY, rz], flutterAmp: 0.014 };

  const trunkNode = add({
    name: 'Japanese Maple Wood',
    mesh: barkMesh,
    texture: barkSet.albedo, normalTexture: barkSet.normal, metallicRoughnessTexture: barkSet.mr,
    color: '#6e5042', roughness: 1.0, metallic: 0.02,
  });
  trunkNode.setShader({ module: TREE_SWAY_BK, file: 'tree_wood.bk', uniforms: treeUniforms });

  const leafCard = Mesh.leafCard('oval', {
    width: 0.155, length: 0.170, bend: 0.24, cup: 0.18,
    fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 4,
  });
  const scatteredLeaves = Mesh.scatterLeaves(thickened, leafCard, {
    maxRadius: 0.056, minDepth: 2, perUnitLength: 430,
    upBias: 0.72, tiltJitter: 0.38, rollJitter: 0.9,
    baseScale: 1.04, scaleJitter: 0.34, dedupRadius: 0.015,
    avoid: Mesh.capsuleFieldFromSegments(thickened, 1.02),
    obstaclePushout: 0.016, seed: 1892,
  });
  bakeLeafColors(scatteredLeaves, [rx + 0.55, rootY + 1.45, rz + 0.38]);

  const leavesNode = add({
    name: 'Japanese Maple Canopy',
    mesh: scatteredLeaves,
    texture: leafSet.albedo, normalTexture: leafSet.normal, metallicRoughnessTexture: leafSet.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.0,
    alphaCutoff: 0.42, twoSided: true, subsurface: 0.52, vertexColorTint: true,
    castsShadow: true, receivesShadow: true,
  });
  leavesNode.setShader({ module: TREE_SWAY_BK, file: 'tree_leaves.bk', uniforms: leafUniforms });

  registerPick(trunkNode, {
    id: 'maple', name: 'Gnarled Crimson Japanese Maple', kind: 'Acer palmatum · Tiered Cloud Canopy',
    desc: 'Layered space-colonized maple leaning over the spring basin with shaded oxblood interior and crimson outer tiers.',
  });
  registerPick(leavesNode, {
    id: 'maple_leaves', name: 'Palmate Autumn Maple Foliage', kind: 'Tiered Subsurface Crown',
    desc: 'Layered horizontal palmate leaf fans detaching in the breeze to fall onto the pond surface below.',
  });

  return { trunkNode, leavesNode, twigTips };
}

function buildFernRosette(add, frondMesh, fernSet, fx, fz, seed, fi) {
  const fy = islandHeightAt(fx, fz);
  const fronds = [];
  for (let k = 0; k < 12; ++k) {
    const a = (k / 12) * Math.PI * 2 + seed * 0.5;
    const tilt = -(0.32 + (k % 3) * 0.19);
    const f = frondMesh.clone();
    f.rotate(1, 0, 0, tilt).rotate(0, 1, 0, a).scale(0.86 + (k % 3) * 0.14);
    fronds.push(f);
  }
  const tuft = add({
    name: `Forest Fern Tussock ${fi + 1}`,
    mesh: Mesh.merge(fronds),
    position: [fx, fy + 0.01, fz],
    texture: fernSet.albedo, normalTexture: fernSet.normal, metallicRoughnessTexture: fernSet.mr,
    color: '#6ec052', roughness: 1.0, metallic: 0.0,
    alphaCutoff: 0.40, twoSided: true, subsurface: 0.48,
  });
  tuft.setShader({
    module: PLANT_SWAY_BK, file: `fern_${fi}.bk`,
    uniforms: { time: 0.0, breeze: 0.52, maxH: 0.46, phase: fi * 1.3 },
  });
  return tuft;
}

export function buildSylvanScene(scene, registerPick) {
  const rockSet = makeRockPbrSet();
  const barkSet = makeBarkPbrSet();
  const leafSet = makeLeafPbrSet();
  const fernSet = makeFernPbrSet();
  const softGlowTex = makeSoftGlowTex(64);
  const bedTex = makePondBedTexture(256, 256);
  const koiSets = {
    kohaku: makeKoiPbrSet('kohaku'),
    tancho: makeKoiPbrSet('tancho'),
    yamabuki: makeKoiPbrSet('yamabuki'),
    showa: makeKoiPbrSet('showa'),
    asagi: makeKoiPbrSet('asagi'),
  };

  // Ecosystem HDR sky, SSR, SSAO & MSAA (pure-sky IBL handles distant outdoor specular cleanly)
  skyEnvironment(scene, { hdri: 'kloofendal_43d_clear_puresky', intensity: 0.48, rotation: 0.6 });
  scene.setGroundBounce([0.10, 0.14, 0.07]);
  scene.setSSAO({ radius: 0.36, bias: 0.02, intensity: 1.0 });
  scene.setSSR({ enabled: true, maxDistance: 8, steps: 28, thickness: 0.18, intensity: 0.35, edgeFade: 0.16 });
  scene.setMSAA(4);

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

  // 2. Sculpted Mossy Garden Gorge & Natural Perimeter Basalt Boulders (PBR stratified normal + MR maps)
  const cascadeCliff = add({
    name: 'Cascade Recessed Cliff',
    mesh: createSculptedBoulder(1.12, 0.86, 0.56, 2.3),
    position: [0.85, islandHeightAt(0.85, -1.78) - 0.04, -1.78],
    texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
    color: '#747d7a', roughness: 1.0, metallic: 0.04,
  });
  attachTerrainShader(cascadeCliff, 1.0);
  const cascadeShelf = add({
    name: 'Cascade Spill Ledge',
    mesh: createSculptedBoulder(0.62, 0.34, 0.42, 6.7),
    position: [0.72, islandHeightAt(0.72, -1.42) + 0.14, -1.42],
    texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
    color: '#646e6c', roughness: 0.75, metallic: 0.05,
  });
  attachTerrainShader(cascadeShelf, 0.7);
  const cliffRight = add({
    name: 'Cascade Right Buttress',
    mesh: createSculptedBoulder(0.58, 0.66, 0.52, 3.7),
    position: [1.56, islandHeightAt(1.56, -1.36) - 0.03, -1.36],
    texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
    color: '#767f7c', roughness: 1.0, metallic: 0.04,
  });
  attachTerrainShader(cliffRight, 1.0);
  const cliffLeft = add({
    name: 'Cascade Left Buttress',
    mesh: createSculptedBoulder(0.54, 0.52, 0.48, 5.1),
    position: [-0.06, islandHeightAt(-0.06, -1.56) - 0.03, -1.56],
    texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
    color: '#6d7774', roughness: 0.90, metallic: 0.04,
  });
  attachTerrainShader(cliffLeft, 0.95);
  registerPick(cascadeCliff, {
    id: 'cascade', name: 'Terraced Mossy Basalt Cascade', kind: 'Garden Spring Rockery',
    desc: 'Stepped basalt gorge with slender refracting spring trickles clinging down glistening mossy rock faces.',
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
      texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
      color: '#58605d', roughness: 1.0, metallic: 0.04,
    });
    attachTerrainShader(bNode, 1.0);
  });

  // 3. Refractive Depth-Absorbing Pond Water + 3 Slender Rock Spring Trickles + Mist Particles
  const pondWater = add({
    name: 'Crystal Pond Water',
    mesh: createPondWaterDisk(2.08, 32, 64),
    position: [0, 0.0, 0],
    color: [0.06, 0.28, 0.32, 0.54], roughness: 0.03, metallic: 0.02,
    castsShadow: false, receivesShadow: true,
  });
  pondWater.setShader({
    module: WATER_SHADER_BK, file: 'pond_water.bk',
    uniforms: { time: 0.0, breeze: 0.52, clarity: 0.85, pad: 0.0 },
  });
  registerPick(pondWater, {
    id: 'pond', name: 'Refractive Spring-Fed Basin', kind: 'Optical Depth Pond · SSR',
    desc: 'Snell-refracting water surface with Beer-Lambert absorption, SSR sky sheen, and clear view of cobbles & koi below.',
  });

  const fallMain = add({
    name: 'Main Cascade Trickle',
    mesh: createCurvedWaterfall([
      [0.80, 0.88, -1.48],
      [0.80, 0.72, -1.28],
      [0.80, 0.48, -1.11],
      [0.80, 0.22, -1.03],
      [0.80, -0.04, -1.00],
    ], 0.055, 0.095, 10),
    color: [0.80, 0.96, 1.0, 0.88], roughness: 0.08, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  fallMain.setShader({
    module: WATERFALL_SHADER_BK, file: 'fall_main.bk',
    uniforms: { time: 0.0, flow: 1.0, glow: 0.85, pad: 0.0 },
  });

  const fallMid = add({
    name: 'Step Cascade Trickle',
    mesh: createCurvedWaterfall([
      [0.54, 0.54, -1.25],
      [0.54, 0.36, -1.14],
      [0.54, 0.16, -1.07],
      [0.54, -0.04, -1.04],
    ], 0.042, 0.072, 8),
    color: [0.82, 0.97, 1.0, 0.85], roughness: 0.08, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  fallMid.setShader({
    module: WATERFALL_SHADER_BK, file: 'fall_mid.bk',
    uniforms: { time: 0.0, flow: 0.92, glow: 0.82, pad: 0.0 },
  });

  const fallSide = add({
    name: 'Side Spring Trickle',
    mesh: createCurvedWaterfall([
      [0.26, 0.64, -1.36],
      [0.26, 0.44, -1.20],
      [0.26, 0.20, -1.10],
      [0.26, -0.04, -1.06],
    ], 0.036, 0.062, 8),
    color: [0.82, 0.97, 1.0, 0.84], roughness: 0.08, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  fallSide.setShader({
    module: WATERFALL_SHADER_BK, file: 'fall_side.bk',
    uniforms: { time: 0.0, flow: 0.84, glow: 0.80, pad: 0.0 },
  });

  const mistParticles = scene.createParticles3D({
    name: 'Cascade Plunge Mist',
    texture: softGlowTex,
    position: [0.62, 0.03, -1.02],
    maxParticles: 36, rate: 8,
    lifetime: { min: 0.8, max: 1.5 },
    size: { start: 0.045, end: 0.11 },
    color: { start: [0.88, 0.97, 1.0, 0.10], end: [0.88, 0.97, 1.0, 0.0] },
    velocity: { direction: [0, 1, 0.25], spread: 50, speed: 0.12, speedSpread: 0.05 },
    gravity: [0, -0.04, 0], drag: 0.65, softness: 0.14,
    shape: { type: 'sphere', radius: 0.14 },
  });

  // 4. Connected Space-Colonized Layered Japanese Maple Tree + 5-Lobed Palmate Leaves
  const mapleOrigin = [-1.68, islandHeightAt(-1.68, -1.18), -1.18];
  const mapleTree = buildJapaneseMaple(add, barkSet, leafSet, mapleOrigin, registerPick);

  // 5. Lush Pinnate Ferns + Merged Sedge/Cattail Clumps with Synchronized Rooted Sway
  const frondCard = paintUniformColor(Mesh.leafCard('frond', {
    width: 0.17, length: 0.52, bend: 0.65, cup: 0.16,
    fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 8,
  }), 1, 1, 1, 1);
  const fernSites = [[-2.78, 0.12], [-2.28, 1.92], [1.72, 2.02], [2.72, -0.96]];
  const plantNodes = [];
  fernSites.forEach(([fx, fz], fi) => {
    plantNodes.push(buildFernRosette(add, frondCard, fernSet, fx, fz, 2.1 + fi * 1.4, fi));
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
    texture: rockSet.albedo, normalTexture: rockSet.normal, metallicRoughnessTexture: rockSet.mr,
    color: '#464d4b', roughness: 1.0, metallic: 0.04,
  });
  attachTerrainShader(lanternStone, 0.75);
  const lanternEmber = add({
    name: 'Lantern Warm Ember',
    mesh: Mesh.sphere(0.060, 12, 10).translate(0, 0.60, 0),
    position: [lx, ly, lz],
    color: '#ffb44a', emissive: 2.2, emissiveColor: [1.0, 0.65, 0.22], roughness: 0.32, metallic: 0.0,
    castsShadow: false,
  });

  // 8. Five Seamless Individualized PBR Nishikigoi Swimming Inside Translucent Pond
  const koiMesh = createAnatomicalKoi();
  const koiSpecs = [
    { name: 'Kohaku Matriarch', pbr: koiSets.kohaku, rx: 0.32, rz: 0.28, phase: 0.0, dir: 1, y: -0.095, scale: 0.98, bend: 0.046 },
    { name: 'Tancho Sanke', pbr: koiSets.tancho, rx: 0.64, rz: 0.54, phase: 2.1, dir: -1, y: -0.112, scale: 0.92, bend: 0.044 },
    { name: 'Yamabuki Ogon', pbr: koiSets.yamabuki, rx: 0.94, rz: 0.78, phase: 4.2, dir: 1, y: -0.090, scale: 0.90, bend: 0.044 },
    { name: 'Showa Sanshoku', pbr: koiSets.showa, rx: 1.24, rz: 1.00, phase: 0.9, dir: -1, y: -0.105, scale: 0.90, bend: 0.042 },
    { name: 'Asagi Azure', pbr: koiSets.asagi, rx: 1.24, rz: 1.00, phase: 4.04, dir: -1, y: -0.100, scale: 0.86, bend: 0.042 },
  ];
  const koiList = koiSpecs.map((ks) => {
    const node = add({
      name: `Koi ${ks.name}`,
      mesh: koiMesh,
      position: [0, ks.y, 0.16],
      scale: [ks.scale, ks.scale, ks.scale],
      texture: ks.pbr.albedo, normalTexture: ks.pbr.normal, metallicRoughnessTexture: ks.pbr.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.02,
    });
    node.setShader({
      module: KOI_SHADER_BK, file: `koi_${ks.name.replace(/\s+/g, '_')}.bk`,
      uniforms: { time: 0.0, swimPhase: ks.phase, bendAmp: ks.bend, turnCurve: ks.dir * 0.015 },
    });
    registerPick(node, {
      id: `koi_${ks.name}`, name: ks.name, kind: 'Continuous Living Nishikigoi',
      desc: 'Individualized satin-scaled carp propelling itself underwater via GPU S-waves beneath refractive pond caustics.',
    });
    return { ...ks, node };
  });

  // 9. True Twig-to-Pond Floating Palmate Maple Leaves & 4-Winged Perp-Axis Dragonflies
  const driftLeafCard = paintUniformColor(Mesh.leafCard('lobed', { width: 0.075, length: 0.095, bend: 0.25, cup: 0.20, fullUV: true, shapedSilhouette: true }), 1, 1, 1, 1);
  const driftingLeaves = [];
  const tips = mapleTree.twigTips;
  for (let i = 0; i < 14; ++i) {
    const lf = add({
      name: `Drifting Leaf ${i + 1}`,
      mesh: driftLeafCard,
      texture: leafSet.albedo, normalTexture: leafSet.normal, metallicRoughnessTexture: leafSet.mr,
      color: i % 3 === 0 ? '#a82214' : (i % 3 === 1 ? '#c83a16' : '#8e1810'),
      alphaCutoff: 0.42, twoSided: true, subsurface: 0.48, roughness: 1.0, metallic: 0.0,
      castsShadow: false,
    });
    const tip = tips[i % tips.length];
    // Target landing spot beneath overhanging canopy in calm NW/center pool, then drift SW on pond current
    const landX = Math.max(-1.35, Math.min(0.65, tip[0] + 0.28 * Math.cos(i * 1.9)));
    const landZ = Math.max(-0.85, Math.min(0.85, tip[2] + 0.28 * Math.sin(i * 1.9)));
    driftingLeaves.push({
      node: lf,
      sx: tip[0], sy: tip[1], sz: tip[2],
      lx: landX, lz: landZ,
      phase: i / 14,
    });
  }

  const dragonflies = [];
  const dfParts = createDragonflyMeshes();
  for (let i = 0; i < 2; ++i) {
    const piv = add({ name: `Dragonfly ${i + 1}`, position: [0.58 - i * 0.25, 0.56 + i * 0.16, 0.55 + i * 0.28] });
    piv.add(add({ name: `Dragonfly Body ${i + 1}`, mesh: dfParts.body, color: '#24c4d8', emissive: 0.18, emissiveColor: [0.12, 0.65, 0.80], roughness: 0.24, metallic: 0.62 }));
    const wL = add({ name: `Dragonfly Wing L ${i + 1}`, mesh: dfParts.wingL, position: [-0.014, 0.008, 0.005], color: [0.80, 0.95, 1.0, 0.36], twoSided: true, roughness: 0.18, metallic: 0.08, castsShadow: false });
    const wR = add({ name: `Dragonfly Wing R ${i + 1}`, mesh: dfParts.wingR, position: [-0.014, 0.008, -0.005], color: [0.80, 0.95, 1.0, 0.36], twoSided: true, roughness: 0.18, metallic: 0.08, castsShadow: false });
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
    texture: softGlowTex,
    position: [0.0, 0.72, 0.15],
    maxParticles: 36, rate: 0,
    lifetime: { min: 2.2, max: 3.8 },
    size: { start: 0.016, end: 0.003 },
    color: { start: [1.0, 0.88, 0.35, 0.85], end: [1.0, 0.65, 0.15, 0.0] },
    blend: 'additive',
    velocity: { direction: [0, 1, 0], spread: 180, speed: 0.12, speedSpread: 0.06 },
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
    pondWater, fallMain, fallMid, fallSide, mistParticles, fireflyParticles,
    rockNodes, plantNodes, mapleTree, lilyGroups, lilyPads: lilyCoords, koiList,
    dragonflies, driftingLeaves, lanternEmber, lights,
  };
}
