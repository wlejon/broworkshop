// js/mill_nature.js — Space-colonized trees, wall-hugging ivy, boulders, cliff cascade, trout, flora & props.

import {
  valleyHeightAt,
  createSculptedGraniteBoulder,
  createRockHuggingCascade,
  WIND_SWAY_BK,
  TROUT_SWAY_BK,
  pushSmoothTris,
} from './terrain_water.js';

function bakeCrownColors(mesh, center, topHex, shadeHex) {
  const pos = mesh.positions;
  const vc = mesh.vertexCount;
  const cols = new Float32Array(vc * 4);
  for (let i = 0; i < vc; ++i) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const d = Math.min(1.0, Math.hypot(px - center[0], pz - center[2]) / 1.6);
    const u = Math.max(0.0, Math.min(1.0, (py - (center[1] - 0.6)) / 1.4));
    const k = Math.max(0.0, Math.min(1.0, d * 0.45 + u * 0.65));
    cols[i * 4 + 0] = shadeHex[0] + (topHex[0] - shadeHex[0]) * k;
    cols[i * 4 + 1] = shadeHex[1] + (topHex[1] - shadeHex[1]) * k;
    cols[i * 4 + 2] = shadeHex[2] + (topHex[2] - shadeHex[2]) * k;
    cols[i * 4 + 3] = 1.0;
  }
  mesh.colors = cols;
  return mesh;
}

function buildTree(add, barkMat, leafMat, rootXZ, crownOffset, isPine, namePrefix) {
  const [rx, rz] = rootXZ;
  const ry = valleyHeightAt(rx, rz);
  const rootY = ry - 0.14;
  const attractors = [];
  const tiers = isPine
    ? [[0, 1.35, 0, 1.10, 0.35], [0, 1.95, 0, 0.85, 0.32], [0, 2.55, 0, 0.55, 0.30], [0, 3.05, 0, 0.25, 0.25]]
    : [
        [crownOffset[0] * 0.4, 1.35, crownOffset[2] * 0.4, 1.05, 0.26],
        [crownOffset[0] * 0.9, 1.65, crownOffset[2] * 0.9, 1.25, 0.30],
        [crownOffset[0] * 0.2, 2.15, crownOffset[2] * 0.2, 1.20, 0.30],
      ];

  for (let ti = 0; ti < tiers.length; ++ti) {
    const [tx, ty, tz, rad, flat] = tiers[ti];
    for (let i = 0; i < 85; ++i) {
      const th = ((i * 0.6180339 + ti * 0.21) % 1) * Math.PI * 2;
      const rr = (0.15 + 0.85 * Math.pow((i * 0.381966) % 1, 0.55)) * rad;
      const w = ((i * 0.75487) % 1) - 0.5;
      attractors.push([rx + tx + Math.cos(th) * rr, rootY + ty + w * flat, rz + tz + Math.sin(th) * rr]);
    }
  }
  const segs = Mesh.spaceColonize(
    attractors,
    [[rx, rootY, rz]],
    [crownOffset[0] * 0.18, 1.0, crownOffset[2] * 0.18],
    { attractionRadius: 3.0, killRadius: 0.18, segmentLength: 0.15, maxIterations: 110, tropism: [0.2, 0.15, 0.1], tropismWeight: 0.15 },
  );
  const thick = Mesh.thickenBranches(segs, 0.008, 2.3);

  // Grab outermost overhanging twigs for falling autumn leaves
  const twigTips = [];
  for (const seg of thick) {
    if (seg.radius < 0.022 && seg.to[1] > ry + 0.85 && seg.to[1] < ry + 1.95) twigTips.push(seg.to.slice());
  }
  twigTips.sort((a, b) => (b[0] + b[2]) - (a[0] + a[2]));

  // Tucked root buttresses with capStart: false (zero white cap or protruding root!)
  const woodParts = [Mesh.meshBranches(thick, 8)];
  for (let i = 0; i < 4; ++i) {
    const ang = (i / 4) * Math.PI * 2 + 0.4;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const pts = [];
    for (let s = 0; s <= 4; ++s) {
      const f = s / 4;
      const px = rx + dx * f * 0.60, pz = rz + dz * f * 0.60;
      const gh = valleyHeightAt(px, pz);
      pts.push([px, s === 0 ? ry + 0.05 : (s === 4 ? gh - 0.08 : gh + (1 - f) * 0.08), pz]);
    }
    woodParts.push(Mesh.tube(pts, [0.085, 0.062, 0.042, 0.024, 0.015], 8, { capStart: false, capEnd: true }));
  }

  const woodNode = add({
    name: `${namePrefix} Trunk`,
    mesh: Mesh.merge(woodParts),
    texture: barkMat.albedo, normalTexture: barkMat.normal, metallicRoughnessTexture: barkMat.mr,
    color: '#6e5042', roughness: 1.0, metallic: 0.01,
  });
  woodNode.setShader({ module: WIND_SWAY_BK, file: `${namePrefix}_wood.bk`, uniforms: { time: 0, breeze: 0.48, rootPos: [rx, rootY, rz], flutterAmp: 0.0 } });

  const card = Mesh.leafCard('oval', {
    width: isPine ? 0.24 : 0.22, length: isPine ? 0.30 : 0.24, bend: 0.24, cup: 0.16,
    fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 4,
  });
  const crown = Mesh.scatterLeaves(thick, card, {
    maxRadius: 0.065, minDepth: 2, perUnitLength: isPine ? 380 : 350,
    upBias: 0.68, tiltJitter: 0.42, rollJitter: 0.9, baseScale: 1.05, scaleJitter: 0.34,
    dedupRadius: 0.018, avoid: Mesh.capsuleFieldFromSegments(thick, 1.02), obstaclePushout: 0.018, seed: isPine ? 901 : 404,
  });
  bakeCrownColors(crown, [rx + crownOffset[0] * 0.5, rootY + 1.75, rz + crownOffset[2] * 0.5],
    isPine ? [0.85, 0.96, 0.85] : [1.0, 0.72, 0.26],
    isPine ? [0.42, 0.54, 0.44] : [0.58, 0.24, 0.08]);

  const leafNode = add({
    name: `${namePrefix} Canopy`,
    mesh: crown,
    texture: leafMat.albedo, normalTexture: leafMat.normal, metallicRoughnessTexture: leafMat.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.0,
    alphaCutoff: 0.40, twoSided: true, subsurface: 0.46, vertexColorTint: true,
  });
  leafNode.setShader({ module: WIND_SWAY_BK, file: `${namePrefix}_leaf.bk`, uniforms: { time: 0, breeze: 0.48, rootPos: [rx, rootY, rz], flutterAmp: 0.014 } });

  return { woodNode, leafNode, twigTips };
}

/** Build a slim brook trout mesh along local +X (nose at x=0, tail at x=-0.36). */
function createBrookTroutMesh() {
  const verts = [], uvs = [], tris = [];
  const xSegs = 28, rSegs = 14, len = 0.36;
  verts.push([0.004, 0, 0]); uvs.push([0, 0.5]);
  for (let i = 1; i < xSegs; ++i) {
    const t = i / xSegs;
    let w = 0, h = 0;
    if (t < 0.76) {
      const u = t / 0.76;
      const b = Math.sin(Math.pow(u, 0.58) * Math.PI * 0.90);
      w = 0.032 * b + 0.005 * (1 - u);
      h = 0.038 * b + 0.006 * (1 - u);
    } else {
      const u = (t - 0.76) / 0.24;
      w = 0.004 * (1 - u * 0.6) + 0.0015;
      h = 0.008 + 0.034 * Math.sin(u * Math.PI * 0.75);
    }
    for (let j = 0; j <= rSegs; ++j) {
      const a = (j / rSegs) * Math.PI * 2;
      verts.push([-t * len, Math.sin(a) * h, Math.cos(a) * w]);
      uvs.push([t, 0.5 - Math.sin(a) * 0.45]);
    }
  }
  const tailIdx = verts.length;
  verts.push([-len + 0.02, 0, 0]); uvs.push([1, 0.5]);
  const stride = rSegs + 1;
  for (let j = 0; j < rSegs; ++j) tris.push([0, 1 + j + 1, 1 + j]);
  for (let i = 0; i < xSegs - 2; ++i) {
    const r0 = 1 + i * stride, r1 = r0 + stride;
    for (let j = 0; j < rSegs; ++j) {
      const a = r0 + j, b = a + 1, c = r1 + j, d = c + 1;
      tris.push([a, b, d], [a, d, c]);
    }
  }
  const last = 1 + (xSegs - 2) * stride;
  for (let j = 0; j < rSegs; ++j) tris.push([tailIdx, last + j, last + j + 1]);
  return pushSmoothTris(verts, uvs, tris);
}

export function buildMillNature(scene, add, mats, attachTerrainShader, registerPick) {
  // 1. Alpine Granite Cliff Outcrops & Pond Shoreline Boulders
  const cliffBoulders = [
    [-2.85, -3.55, 1.35, 0.95, 1.05, 1.7],
    [-2.05, -2.15, 1.15, 0.92, 0.95, 3.1],
    [-3.85, -1.95, 1.25, 0.88, 1.00, 5.4],
    [-1.85, -1.55, 0.65, 0.52, 0.58, 7.2],
  ];
  const cliffTargets = [];
  cliffBoulders.forEach(([bx, bz, rx, ry, rz, seed], i) => {
    const by = valleyHeightAt(bx, bz) - 0.14;
    const mesh = createSculptedGraniteBoulder(rx, ry, rz, seed);
    cliffTargets.push({ mesh, pos: [bx, by, bz] });
    const bn = add({
      name: `Granite Cliff Boulder ${i + 1}`,
      mesh, position: [bx, by, bz],
      texture: mats.granite.albedo, normalTexture: mats.granite.normal, metallicRoughnessTexture: mats.granite.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.02,
    });
    attachTerrainShader(bn, 0.0);
  });

  const shoreRocks = [
    [-2.55, 1.45, 0.55, 0.36, 0.48, 2.2],
    [-3.55, 2.25, 0.62, 0.42, 0.52, 4.4],
    [-2.15, 4.45, 0.58, 0.34, 0.46, 6.1],
    [0.55, 4.25, 0.64, 0.38, 0.52, 8.3],
    [1.75, 2.75, 0.54, 0.35, 0.48, 9.5],
  ];
  shoreRocks.forEach(([bx, bz, rx, ry, rz, seed], i) => {
    const bn = add({
      name: `Shoreline Boulder ${i + 1}`,
      mesh: createSculptedGraniteBoulder(rx, ry, rz, seed),
      position: [bx, valleyHeightAt(bx, bz) - 0.08, bz],
      texture: mats.granite.albedo, normalTexture: mats.granite.normal, metallicRoughnessTexture: mats.granite.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.02,
    });
    attachTerrainShader(bn, 0.0);
  });

  // Raycast Cliff Overflow Cascade clinging strictly to granite cliff & terrain into NW pond
  const cliffStream = createRockHuggingCascade(cliffTargets, -2.55, -2.25, -1.75, -0.35, 0.10, 0.26, 36, 10);
  const cliffCascade = add({
    name: 'Granite Cliff Overflow Cascade',
    mesh: cliffStream.mesh,
    color: [0.80, 0.96, 1.0, 0.86], roughness: 0.05, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });

  // 2. Autumn Birch/Maple + Upper Alpine Pine + Climbing Wall Ivy (flush against millhouse wall!)
  const autumnTree = buildTree(add, mats.bark, mats.autumnLeaf, [-3.95, 0.62], [1.45, 0.0, 1.35], false, 'Autumn Maple');
  const pineTree = buildTree(add, mats.bark, mats.pineNeedle, [-3.85, -3.55], [0.1, 0.0, 0.1], true, 'Alpine Pine');
  registerPick(autumnTree.leafNode, {
    id: 'autumn_tree', name: 'Overhanging Autumn Maple', kind: 'Space-Colonized Grove',
    desc: 'Gold-crimson autumn maple rooted on the west knoll, shedding leaves gently onto the millpond below.',
  });

  // Wall-hugging organic climbing ivy clusters along South & West stone walls (x=2.45, z=-1.10, W=2.25, D=2.65)
  const ivyCard = Mesh.leafCard('lobed', { width: 0.16, length: 0.18, bend: 0.05, cup: 0.04, fullUV: true, shapedSilhouette: true });
  const ivyWc = ivyCard.vertexCount;
  const whiteVc = new Float32Array(ivyWc * 4).fill(1.0);
  ivyCard.colors = whiteVc;
  const ivyParts = [];
  // Irregular trailing clusters clinging tightly to South masonry wall (z = 0.225 -> +0.238)
  for (let i = 0; i < 34; ++i) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = 1.46 + col * 0.14 + Math.sin(i * 2.3) * 0.055;
    const y = 0.60 + row * 0.14 + Math.cos(i * 1.9) * 0.045;
    if (x > 1.72 && y > 0.84) continue; // natural asymmetric trailing corner growth
    const s = 0.72 + (i % 3) * 0.16;
    ivyParts.push(
      ivyCard.clone()
        .scale(s, s, s)
        .rotate(1, 0, 0, Math.PI * 0.5)
        .rotate(0, 0, 1, Math.sin(i * 1.7) * 0.65)
        .translate(x, y, 0.238),
    );
  }
  for (let i = 0; i < 24; ++i) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const z = -2.18 + col * 0.16 + Math.sin(i * 2.1) * 0.05;
    const y = 0.62 + row * 0.16 + Math.cos(i * 1.4) * 0.04;
    const s = 0.74 + (i % 3) * 0.15;
    ivyParts.push(
      ivyCard.clone()
        .scale(s, s, s)
        .rotate(1, 0, 0, Math.PI * 0.5)
        .rotate(0, 0, 1, Math.sin(i * 1.5) * 0.55)
        .rotate(0, 1, 0, -Math.PI * 0.5)
        .translate(1.312, y, z),
    );
  }
  add({
    name: 'Millhouse Wall Ivy',
    mesh: Mesh.merge(ivyParts),
    texture: mats.ivyLeaf.albedo, normalTexture: mats.ivyLeaf.normal, metallicRoughnessTexture: mats.ivyLeaf.mr,
    color: '#5c8c42', roughness: 1.0, metallic: 0.0, alphaCutoff: 0.42, twoSided: true,
  });

  // 3. Woodland Ferns around Pond & Cliff + Timber Mill Barrels on Terrace
  const frond = Mesh.leafCard('frond', { width: 0.22, length: 0.65, bend: 0.62, cup: 0.16, fullUV: true, shapedSilhouette: false, widthSegments: 3, lengthSegments: 7 });
  const fw = new Float32Array(frond.vertexCount * 4).fill(1.0);
  frond.colors = fw;
  const fernSites = [[-2.95, 0.05], [-3.85, 3.85], [1.45, 3.65], [3.65, 1.05], [-1.95, -2.85]];
  fernSites.forEach(([fx, fz], fi) => {
    const parts = [];
    for (let k = 0; k < 10; ++k) {
      const a = (k / 10) * Math.PI * 2 + fi * 0.6;
      parts.push(frond.clone().rotate(1, 0, 0, -0.35 - (k % 3) * 0.18).rotate(0, 1, 0, a).scale(0.85 + (k % 3) * 0.15));
    }
    add({
      name: `Alpine Fern ${fi + 1}`,
      mesh: Mesh.merge(parts),
      position: [fx, valleyHeightAt(fx, fz), fz],
      texture: mats.fern.albedo, normalTexture: mats.fern.normal, metallicRoughnessTexture: mats.fern.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.0, alphaCutoff: 0.42, twoSided: true, subsurface: 0.45,
    });
  });

  // Grounded oak grain barrels beside front doorway
  const barrelMesh = Mesh.merge([
    Mesh.cylinder(0.18, 0.22, 14).translate(3.45, 0.42 + 0.21, 0.38),
    Mesh.cylinder(0.18, 0.22, 14).translate(3.86, 0.42 + 0.21, 0.26),
  ]);
  add({
    name: 'Oak Grain Barrels',
    mesh: barrelMesh,
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 4. Three Swimming Brook Trout + 12 Twig-to-Millpond Drifting Autumn Leaves
  const troutGeo = createBrookTroutMesh();
  const troutList = [
    { name: 'Brook Trout 1', rx: 0.95, rz: 0.72, cx: -0.95, cz: 2.35, phase: 0.0, dir: 1, y: -0.22 },
    { name: 'Brook Trout 2', rx: 1.45, rz: 0.98, cx: -0.65, cz: 2.55, phase: 2.2, dir: -1, y: -0.26 },
    { name: 'Brook Trout 3', rx: 0.65, rz: 0.55, cx: -1.15, cz: 1.95, phase: 4.4, dir: 1, y: -0.19 },
  ].map((ts) => {
    const node = add({
      name: ts.name,
      mesh: troutGeo,
      position: [ts.cx, ts.y, ts.cz],
      texture: mats.trout.albedo, normalTexture: mats.trout.normal, metallicRoughnessTexture: mats.trout.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.02,
    });
    node.setShader({ module: TROUT_SWAY_BK, file: `${ts.name.replace(/\s+/g, '_')}.bk`, uniforms: { time: 0, swimPhase: ts.phase, bendAmp: 0.045, turnCurve: ts.dir * 0.015 } });
    return { ...ts, node };
  });

  const driftCard = Mesh.leafCard('lobed', { width: 0.09, length: 0.11, bend: 0.22, cup: 0.16, fullUV: true, shapedSilhouette: true });
  driftCard.colors = new Float32Array(driftCard.vertexCount * 4).fill(1.0);
  const tips = autumnTree.twigTips.length > 0 ? autumnTree.twigTips : [[-2.4, 1.55, 1.7]];
  const driftingLeaves = [];
  for (let i = 0; i < 12; ++i) {
    const tip = tips[i % tips.length];
    const ang = i * 2.39996;
    const rad = 0.35 + ((i % 4) / 4) * 0.95;
    const landX = Math.max(-2.65, Math.min(0.45, -1.25 + Math.cos(ang) * rad));
    const landZ = Math.max(0.85, Math.min(3.55, 2.20 + Math.sin(ang) * rad * 0.85));
    const lf = add({
      name: `Drifting Leaf ${i + 1}`,
      mesh: driftCard,
      texture: mats.autumnLeaf.albedo, normalTexture: mats.autumnLeaf.normal, metallicRoughnessTexture: mats.autumnLeaf.mr,
      color: i % 3 === 0 ? '#e08622' : (i % 3 === 1 ? '#c84818' : '#ebb234'),
      alphaCutoff: 0.42, twoSided: true, subsurface: 0.45, roughness: 1.0, metallic: 0.0,
      castsShadow: true,
    });
    driftingLeaves.push({ node: lf, sx: tip[0], sy: tip[1], sz: tip[2], lx: landX, lz: landZ, phase: i / 12 });
  }

  return { cliffCascade, autumnTree, pineTree, troutList, driftingLeaves };
}
