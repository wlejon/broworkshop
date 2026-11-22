// js/sylvan_build.js — Grounded 3D natural sanctuary scene graph for Sylvan.

import {
  makeMossyBasalt,
  makeMapleBark,
  makeMapleFoliage,
  makePondBedTexture,
  makeWaterfallTexture,
  makeKoiTexture,
} from './textures.js';
import {
  createOrganicBoulder,
  createOrganicBranch,
  createFoliageCluster,
  createFernFrond,
  createLilyPad,
  createLotusBloom,
  createKoiSegment,
} from './organic_geometry.js';

function createDiskSlab(radius, yBot, yTop, segs = 48) {
  const pos = [], norm = [], uv = [], idx = [];
  const pushVert = (x, y, z, nx, ny, nz, u, v) => {
    pos.push(x, y, z); norm.push(nx, ny, nz); uv.push(u, v);
    return (pos.length / 3) - 1;
  };
  const topC = pushVert(0, yTop, 0, 0, 1, 0, 0.5, 0.5);
  const botC = pushVert(0, yBot, 0, 0, -1, 0, 0.5, 0.5);
  const tRing = [], bRing = [], stRing = [], sbRing = [];
  for (let i = 0; i <= segs; ++i) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = ca * radius, z = -sa * radius;
    const u = 0.5 + ca * 0.5, v = 0.5 - sa * 0.5;
    tRing.push(pushVert(x, yTop, z, 0, 1, 0, u, v));
    bRing.push(pushVert(x, yBot, z, 0, -1, 0, u, v));
    stRing.push(pushVert(x, yTop, z, ca, 0, -sa, i / segs, 1));
    sbRing.push(pushVert(x, yBot, z, ca, 0, -sa, i / segs, 0));
  }
  for (let i = 0; i < segs; ++i) {
    idx.push(topC, tRing[i], tRing[i + 1]);
    idx.push(botC, bRing[i + 1], bRing[i]);
    idx.push(sbRing[i], sbRing[i + 1], stRing[i + 1], sbRing[i], stRing[i + 1], stRing[i]);
  }
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function createWaterfallRibbon(pts, halfW, thick = 0.048) {
  const pos = [], norm = [], uv = [], idx = [];
  const pushQuad = (a, b, c, d, nx, ny, nz, v0, v1) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uv.push(0, v0, 1, v0, 1, v1, 0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < pts.length - 1; ++i) {
    const [x0, y0, z0] = pts[i];
    const [x1, y1, z1] = pts[i + 1];
    const v0 = i / (pts.length - 1), v1 = (i + 1) / (pts.length - 1);
    const w0 = halfW * (0.72 + 0.32 * v0);
    const w1 = halfW * (0.72 + 0.32 * v1);
    const dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dy, dz) || 1;
    const f0L = [x0 - w0, y0, z0], f0R = [x0 + w0, y0, z0];
    const f1L = [x1 - w1, y1, z1], f1R = [x1 + w1, y1, z1];
    const b0L = [x0 - w0, y0, z0 - thick], b0R = [x0 + w0, y0, z0 - thick];
    const b1L = [x1 - w1, y1, z1 - thick], b1R = [x1 + w1, y1, z1 - thick];
    const fnY = -dz / len, fnZ = Math.abs(dy / len);
    pushQuad(f0L, f1L, f1R, f0R, 0, fnY, fnZ, v0, v1);
    pushQuad(b0R, b1R, b1L, b0L, 0, -fnY, -fnZ, v0, v1);
    pushQuad(b0L, b1L, f1L, f0L, -1, 0, 0, v0, v1);
    pushQuad(f0R, f1R, b1R, b0R, 1, 0, 0, v0, v1);
    if (i === 0) pushQuad(b0L, f0L, f0R, b0R, 0, 1, 0, 0, 0.1);
    if (i === pts.length - 2) pushQuad(f1L, b1L, b1R, f1R, 0, -1, 0, 0.9, 1);
  }
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function createSplashRingGeo(rIn, rOut, thick = 0.010, segs = 28) {
  const pos = [], norm = [], uv = [], idx = [];
  const pushQ = (a, b, c, d, n) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    norm.push(...n, ...n, ...n, ...n);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const hy = thick * 0.5;
  for (let i = 0; i < segs; ++i) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const o0 = [c0 * rOut, hy, -s0 * rOut], o1 = [c1 * rOut, hy, -s1 * rOut];
    const i0 = [c0 * rIn, hy, -s0 * rIn], i1 = [c1 * rIn, hy, -s1 * rIn];
    const ob0 = [c0 * rOut, -hy, -s0 * rOut], ob1 = [c1 * rOut, -hy, -s1 * rOut];
    const ib0 = [c0 * rIn, -hy, -s0 * rIn], ib1 = [c1 * rIn, -hy, -s1 * rIn];
    pushQ(i0, o0, o1, i1, [0, 1, 0]);
    pushQ(ib0, ib1, ob1, ob0, [0, -1, 0]);
    pushQ(ob0, ob1, o1, o0, [c0, 0, -s0]);
    pushQ(i0, i1, ib1, ib0, [-c0, 0, s0]);
  }
  return new Mesh({
    positions: new Float32Array(pos),
    normals: new Float32Array(norm),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  });
}

function buildSculptedLantern(addNode, rockMat) {
  const lx = 2.42, lz = 0.42;
  addNode({ name: 'Lantern Plinth', mesh: createOrganicBoulder(0.30, 0.14, 0.30, 11.2, 10, 14), position: [lx, 0, lz], ...rockMat });
  // Flared stone pedestal capital supports 100% of Lantern Firebox base (no overhang)
  addNode({
    name: 'Lantern Column',
    mesh: createOrganicBranch([[0, 0.08, 0], [0, 0.36, 0], [0, 0.54, 0]], (t) => (t > 0.78 ? 0.165 : 0.105), 12, true),
    position: [lx, 0, lz], ...rockMat,
  });
  for (const [px, pz, idx] of [[-0.085, -0.085, 1], [0.085, -0.085, 2], [0.085, 0.085, 3], [-0.085, 0.085, 4]]) {
    addNode({
      name: `Lantern Mullion ${idx}`,
      mesh: createOrganicBranch([[lx + px, 0.52, lz + pz], [lx + px, 0.73, lz + pz]], 0.022, 8, true),
      ...rockMat,
    });
  }
  const ember = addNode({
    name: 'Lantern Warm Ember',
    mesh: createOrganicBoulder(0.068, 0.082, 0.068, 3.1, 8, 12),
    position: [lx, 0.54, lz],
    color: '#ffb04a', emissive: 1.5, emissiveColor: [1.0, 0.65, 0.22], roughness: 0.35, metallic: 0.0,
    castsShadow: false,
  });
  addNode({ name: 'Lantern Canopy Roof', mesh: createDiskSlab(0.28, 0.71, 0.80, 6), position: [lx, 0, lz], ...rockMat });
  addNode({ name: 'Lantern Finial', mesh: createOrganicBoulder(0.08, 0.11, 0.08, 4.4, 8, 10), position: [lx, 0.78, lz], ...rockMat });
  return ember;
}

export function buildSylvanScene(scene, registerPick) {
  const basaltTex = makeMossyBasalt();
  const barkTex = makeMapleBark();
  const foliageTex = makeMapleFoliage();
  const bedTex = makePondBedTexture();
  const waterTex = makeWaterfallTexture();
  const koiTextures = {
    kohaku: makeKoiTexture('kohaku'),
    yamabuki: makeKoiTexture('yamabuki'),
    showa: makeKoiTexture('showa'),
  };

  const add = (opts) => (opts.mesh ? scene.createMesh({ castsShadow: true, receivesShadow: true, ...opts }) : scene.createNode(opts));
  const rockMat = { texture: basaltTex, color: '#9ca8a0', roughness: 0.88, metallic: 0.03 };
  const wetRockMat = { texture: basaltTex, color: '#788882', roughness: 0.56, metallic: 0.06 };
  const barkMat = { texture: barkTex, color: '#8a6856', roughness: 0.88, metallic: 0.02 };

  // 1. Grounded Forest Plinth & Deep Emerald-Teal Reflective Lagoon (r = 2.08, top y = 0.018)
  add({
    name: 'Forest Sanctuary Plinth',
    mesh: createDiskSlab(3.95, -0.18, 0.0, 56),
    texture: bedTex, color: '#889a82', roughness: 0.92, metallic: 0.02,
  });
  const pondWater = add({
    name: 'Crystal Pond Water',
    mesh: createDiskSlab(2.08, 0.0, 0.018, 48),
    color: '#11444e', roughness: 0.06, metallic: 0.24,
  });
  registerPick(pondWater, {
    id: 'pond', name: 'Spring-Fed Sanctuary Basin', kind: 'Hydrological Mirror Pool',
    desc: 'Quiet oxygenated basin fed by terraced basalt falls and framed by cool volcanic river stones.',
  });

  // 2. Sculpted Ravine Waterfall Gorge (recessed back cliff + left/right framing boulders)
  const cascadeBase = add({
    name: 'Cascade Main Terrace Rock',
    mesh: createOrganicBoulder(1.18, 0.72, 0.44, 2.3, 14, 24),
    position: [0.95, 0.0, -1.78], ...wetRockMat,
  });
  add({ name: 'Cascade Mid Ledge Rock', mesh: createOrganicBoulder(0.86, 0.64, 0.44, 6.7, 12, 20), position: [0.95, 0.36, -1.82], ...wetRockMat });
  add({ name: 'Cascade Upper Spring Bowl', mesh: createOrganicBoulder(0.46, 0.42, 0.34, 9.1, 12, 18), position: [0.95, 0.56, -1.80], ...rockMat });
  add({ name: 'Cascade Right Cliff Buttress', mesh: createOrganicBoulder(0.62, 0.66, 0.54, 3.7, 12, 18), position: [1.66, 0.0, -1.42], ...rockMat });
  add({ name: 'Cascade Left Cliff Buttress', mesh: createOrganicBoulder(0.56, 0.56, 0.52, 5.1, 12, 18), position: [-0.08, 0.0, -1.58], ...wetRockMat });
  registerPick(cascadeBase, {
    id: 'cascade', name: 'Terraced Mossy Basalt Cascade', kind: 'Layered Spring Waterfall',
    desc: 'Dark volcanic basalt ledges draped in velvet moss, aerating cold spring water directly into the koi basin.',
  });

  // Compact varied volcanic perimeter boulders set cleanly outside r = 2.15
  const rimStones = [
    [-2.18, -0.22, 0.54, 0.38, 0.48, 1.5],
    [-1.82, 1.38, 0.50, 0.34, 0.46, 3.2],
    [-0.64, 2.16, 0.58, 0.28, 0.44, 5.4],
    [0.86, 2.12, 0.54, 0.30, 0.44, 7.1],
    [1.96, 1.34, 0.48, 0.34, 0.46, 4.3],
    [2.32, -0.44, 0.56, 0.42, 0.52, 8.6],
    [-0.78, -2.06, 0.60, 0.46, 0.50, 2.9],
  ];
  rimStones.forEach(([x, z, rx, ry, rz, seed], i) => {
    add({
      name: `Basin Rim Boulder ${i + 1}`,
      mesh: createOrganicBoulder(rx, ry, rz, seed, 12, 18),
      position: [x, 0.0, z],
      ...(i % 2 === 0 ? rockMat : wetRockMat),
    });
  });

  // 3. Exposed Stepped Cascading Waterfall Curtains pouring cleanly down the open ravine gorge
  const fallMain = add({
    name: 'Main Cascade Curtain',
    mesh: createWaterfallRibbon([
      [0.88, 0.94, -1.42],
      [0.88, 0.72, -1.24],
      [0.88, 0.42, -1.10],
      [0.88, 0.012, -1.04],
    ], 0.24, 0.048),
    texture: waterTex, color: '#aaf0fa', emissive: 0.44, emissiveColor: [0.52, 0.90, 1.0], roughness: 0.14, metallic: 0.06,
  });
  const fallSide = add({
    name: 'Side Spring Veil',
    mesh: createWaterfallRibbon([
      [0.36, 0.72, -1.36],
      [0.36, 0.44, -1.18],
      [0.36, 0.012, -1.08],
    ], 0.12, 0.040),
    texture: waterTex, color: '#b4f4fc', emissive: 0.36, emissiveColor: [0.52, 0.90, 1.0], roughness: 0.16, metallic: 0.05,
  });
  const splashRings = [
    { pos: [0.88, 0.031, -0.86], rIn: 0.13, rOut: 0.16, phase: 0.0 },
    { pos: [0.36, 0.031, -0.90], rIn: 0.09, rOut: 0.12, phase: 0.5 },
  ].map((sp, i) => ({
    node: add({
      name: `Cascade Splash Ring ${i + 1}`,
      mesh: createSplashRingGeo(sp.rIn, sp.rOut, 0.010, 28),
      position: sp.pos,
      color: '#d6faff', emissive: 0.42, emissiveColor: [0.58, 0.94, 1.0], roughness: 0.18, metallic: 0.0,
      castsShadow: false,
    }),
    phase: sp.phase,
  }));

  // 4. Sculpted Crimson Japanese Maple with Flared Roots & Lush Layered Autumn Canopy (10 clouds)
  add({
    name: 'Maple Bank Moss Mound',
    mesh: createOrganicBoulder(0.86, 0.42, 0.78, 4.1, 14, 20),
    position: [-1.85, 0.0, -1.28], ...rockMat,
  });
  const trunkPts = [
    [-1.85, 0.08, -1.28],
    [-1.66, 0.58, -1.12],
    [-1.36, 1.16, -0.88],
    [-1.04, 1.66, -0.64],
    [-0.72, 2.08, -0.40],
  ];
  const trunkNode = add({
    name: 'Japanese Maple Trunk',
    mesh: createOrganicBranch(trunkPts, (t) => 0.19 * (1 - t * 0.56), 14, true),
    ...barkMat,
  });
  registerPick(trunkNode, {
    id: 'maple', name: 'Gnarled Crimson Japanese Maple', kind: 'Acer palmatum Specimen',
    desc: 'Windswept heirloom maple anchored by buttress roots into mossy basalt, shading the water lilies.',
  });
  const rootPaths = [
    [[-1.78, 0.36, -1.20], [-1.42, 0.18, -0.96], [-1.14, 0.0, -0.78]],
    [[-1.88, 0.36, -1.32], [-2.22, 0.18, -1.52], [-2.42, 0.0, -1.62]],
    [[-1.86, 0.34, -1.20], [-2.10, 0.18, -0.86], [-2.26, 0.0, -0.62]],
    [[-1.80, 0.34, -1.34], [-1.54, 0.18, -1.66], [-1.32, 0.0, -1.86]],
  ];
  rootPaths.forEach((pts, i) => {
    add({
      name: `Maple Buttress Root ${i + 1}`,
      mesh: createOrganicBranch(pts, (t) => 0.085 * (1 - t * 0.58), 10, true),
      ...barkMat,
    });
  });

  // 8 well-separated multi-tier canopy pads (pivot height tip.y + 0.036 -> <= 0.015u gap from limb top!)
  const foliageAnchors = [];
  const canopySpecs = [
    { base: [-1.24, 1.38, -0.78], mid: [-0.90, 1.70, -0.22], tip: [-0.46, 1.90, 0.18], r: 0.42, seed: 2.1, col: '#cc3a28', phase: 0.0 },
    { base: [-1.08, 1.56, -0.66], mid: [-1.48, 1.88, -0.26], tip: [-1.84, 2.02, 0.04], r: 0.40, seed: 4.5, col: '#dc5024', phase: 1.2 },
    { base: [-0.88, 1.86, -0.48], mid: [-0.44, 2.16, -0.74], tip: [-0.04, 2.28, -0.92], r: 0.44, seed: 7.3, col: '#a8221d', phase: 2.3 },
    { base: [-0.72, 2.04, -0.38], mid: [-0.94, 2.40, -0.10], tip: [-1.14, 2.58, 0.08], r: 0.42, seed: 9.8, col: '#e67828', phase: 3.1 },
    { base: [-0.72, 2.04, -0.38], mid: [-0.22, 2.34, 0.02], tip: [0.18, 2.46, 0.24], r: 0.38, seed: 5.9, col: '#cc3b22', phase: 4.4 },
    { base: [-1.36, 1.16, -0.88], mid: [-1.78, 1.48, -1.18], tip: [-2.12, 1.66, -1.40], r: 0.40, seed: 1.7, col: '#b0251c', phase: 5.0 },
    { base: [-1.04, 1.66, -0.64], mid: [-1.34, 2.08, -0.78], tip: [-1.58, 2.28, -0.92], r: 0.38, seed: 8.4, col: '#d44820', phase: 2.8 },
    { base: [-0.72, 2.04, -0.38], mid: [-0.42, 2.52, -0.36], tip: [-0.14, 2.74, -0.34], r: 0.36, seed: 6.1, col: '#ea8630', phase: 0.9 },
  ];
  canopySpecs.forEach((sp, i) => {
    add({
      name: `Maple Branch ${i + 1}`,
      mesh: createOrganicBranch([sp.base, sp.mid, sp.tip], (t) => 0.068 * (1 - t * 0.55), 10, true),
      ...barkMat,
    });
    const piv = add({ name: `Canopy Bough Pivot ${i + 1}`, position: [sp.tip[0], sp.tip[1] + 0.036, sp.tip[2]] });
    const leafCloud = add({
      name: `Maple Foliage Cushion ${i + 1}`,
      mesh: createFoliageCluster(sp.r, 0.34, sp.seed),
      texture: foliageTex, color: sp.col, roughness: 0.72, metallic: 0.0,
    });
    piv.add(leafCloud);
    foliageAnchors.push({ pivot: piv, phase: sp.phase });
  });

  // 5. Forest Fern Rosettes & Bank Cattails cleanly clear of all perimeter boulders & lantern
  const fernSites = [
    [-3.22, -0.04],
    [-2.54, 2.08],
    [1.96, 2.28],
    [3.12, -1.12],
  ];
  const frondNodes = [];
  const frondGeo = createFernFrond(0.36, 0.14, 6);
  fernSites.forEach(([fx, fz], si) => {
    add({
      name: `Fern Moss Mound ${si + 1}`,
      mesh: createOrganicBoulder(0.24, 0.11, 0.24, 12 + si * 2, 10, 14),
      position: [fx, 0.0, fz],
      ...rockMat,
    });
    add({
      name: `Fern Crown Post ${si + 1}`,
      mesh: createOrganicBranch([[fx, 0.08, fz], [fx, 0.21, fz]], 0.044, 8, true),
      ...barkMat,
    });
    for (let k = 0; k < 4; ++k) {
      const ang = (k / 4) * Math.PI * 2 + si * 0.4;
      const dx = Math.cos(ang) * 0.068, dz = -Math.sin(ang) * 0.068;
      const fp = add({ name: `Fern Frond Pivot ${si}_${k}`, position: [fx + dx, 0.222, fz + dz] });
      fp.rotationY = ang;
      const frond = add({
        name: `Fern Frond ${si}_${k}`,
        mesh: frondGeo,
        color: k % 2 === 0 ? '#46823e' : '#5b9a44', roughness: 0.72, metallic: 0.0,
      });
      fp.add(frond);
      frondNodes.push({ node: frond, phase: si * 1.1 + k * 0.7 });
    }
  });

  const reedSites = [[-2.68, 0.66], [3.08, 0.10], [2.62, 1.32]];
  const reedNodes = [];
  reedSites.forEach(([rx, rz], ri) => {
    for (let k = 0; k < 3; ++k) {
      const ox = rx + (k - 1) * 0.16, oz = rz + ((k % 2) - 0.5) * 0.16;
      add({
        name: `Cattail Base Sheath ${ri}_${k}`,
        mesh: createOrganicBranch([[ox, 0.0, oz], [ox, 0.11, oz]], 0.020, 8, true),
        color: '#3e6830', roughness: 0.70, metallic: 0.0,
      });
      const rp = add({ name: `Cattail Reed Pivot ${ri}_${k}`, position: [ox, 0.122, oz] });
      rp.add(add({
        name: `Cattail Stalk ${ri}_${k}`,
        mesh: createOrganicBranch([[0, 0, 0], [0.015, 0.36 + k * 0.08, 0.01], [0.03, 0.74 + k * 0.12, 0.02]], 0.015, 8, true),
        color: '#4e7d3c', roughness: 0.65, metallic: 0.0,
      }));
      rp.add(add({
        name: `Cattail Head ${ri}_${k}`,
        mesh: createOrganicBranch([[0.026, 0.58 + k * 0.08, 0.016], [0.032, 0.73 + k * 0.11, 0.020]], 0.029, 10, true),
        color: '#5a3822', roughness: 0.90, metallic: 0.0,
      }));
      reedNodes.push({ pivot: rp, phase: ri * 1.5 + k * 0.6 });
    }
  });

  // 6. Grounded Water Lilies & Lotus Blooms cleanly in open water coves (flat stem y = 0.020 -> pad bottom y = 0.035)
  const lilySpecs = [
    [-1.56, 0.44, 0.22, true, 0.2],
    [-1.18, 1.12, 0.19, false, 1.9],
    [1.54, 0.62, 0.21, true, 2.7],
    [1.14, 1.36, 0.19, false, 4.1],
    [-0.12, 1.56, 0.22, true, 5.2],
  ];
  const lotusBloomGeo = createLotusBloom(0.12);
  const lilyGroups = [];
  lilySpecs.forEach(([lx, lz, rad, hasBloom, yaw], li) => {
    add({
      name: `Lily Root Stem ${li + 1}`,
      mesh: createOrganicBranch([[lx, 0.0, lz], [lx, 0.020, lz]], 0.013, 8, true),
      color: '#326338', roughness: 0.72, metallic: 0.0,
    });
    const padPivot = add({ name: `Water Lily Pivot ${li + 1}`, position: [lx, 0.042, lz] });
    padPivot.rotationY = yaw;
    const pad = add({
      name: `Water Lily Pad ${li + 1}`,
      mesh: createLilyPad(rad, 0.014, 26),
      color: li % 2 === 0 ? '#4d924b' : '#5ca354', roughness: 0.48, metallic: 0.02,
    });
    padPivot.add(pad);
    if (hasBloom) {
      const bloom = add({
        name: `Lotus Blossom ${li + 1}`,
        mesh: lotusBloomGeo,
        position: [0, 0.014, 0],
        color: li === 0 ? '#f6b8cb' : '#fae8ee',
        emissive: 0.14, emissiveColor: [0.95, 0.65, 0.78], roughness: 0.42, metallic: 0.0,
      });
      padPivot.add(bloom);
      registerPick(bloom, {
        id: `lotus${li}`, name: 'Blooming Sacred Water Lotus', kind: 'Rooted Aquatic Flora',
        desc: 'Two-tier cupped lotus blossom resting cleanly upon a notched pond lily pad anchored to the river-pebble floor.',
      });
    }
    lilyGroups.push({ padPivot, yaw, phase: li * 1.4 });
  });

  // 7. Zen Carved Basalt Lantern
  const lanternEmber = buildSculptedLantern(add, rockMat);

  // 8. Five Articulated Swimming Koi on wide non-overlapping concentric lanes (dr >= 0.30u!)
  const koiHeadGeo = createKoiSegment(0.095, 0.032, 0.048, 1.18);
  const koiMidGeo = createKoiSegment(0.115, 0.046, 0.036, 1.15);
  const koiTailGeo = createKoiSegment(0.095, 0.034, 0.013, 1.02);
  const koiCaudalGeo = createKoiSegment(0.068, 0.011, 0.028, 0.42);
  const pectoralGeoL = createOrganicBranch([[0, 0, 0], [-0.025, 0, 0.034], [-0.038, 0, 0.040]], (t) => 0.010 * (1 - t * 0.45), 8, true);
  const pectoralGeoR = createOrganicBranch([[0, 0, 0], [-0.025, 0, -0.034], [-0.038, 0, -0.040]], (t) => 0.010 * (1 - t * 0.45), 8, true);

  const koiPlans = [
    { name: 'Kohaku Matriarch', tex: koiTextures.kohaku, cx: -0.02, cz: 0.24, rx: 0.24, rz: 0.20, speed: 1.0, phase: 0.0, dir: 1, y: 0.094, scale: 0.84 },
    { name: 'Yamabuki Ogon', tex: koiTextures.yamabuki, cx: -0.02, cz: 0.24, rx: 0.66, rz: 0.56, speed: 1.0, phase: 2.0, dir: -1, y: 0.092, scale: 0.90 },
    { name: 'Showa Sanshoku', tex: koiTextures.showa, cx: -0.02, cz: 0.24, rx: 0.98, rz: 0.80, speed: 1.0, phase: 4.1, dir: 1, y: 0.090, scale: 0.88 },
    { name: 'Kohaku Prince', tex: koiTextures.kohaku, cx: -0.02, cz: 0.24, rx: 1.28, rz: 1.04, speed: 1.0, phase: 0.8, dir: -1, y: 0.090, scale: 0.86 },
    { name: 'Golden Showa', tex: koiTextures.showa, cx: -0.02, cz: 0.24, rx: 1.28, rz: 1.04, speed: 1.0, phase: 3.94, dir: -1, y: 0.090, scale: 0.85 },
  ];
  const koiList = [];
  for (const kp of koiPlans) {
    const root = add({ name: `Koi Root ${kp.name}`, position: [kp.cx, kp.y, kp.cz], scale: [kp.scale, kp.scale, kp.scale] });
    const kMat = { texture: kp.tex, color: '#ffffff', roughness: 0.22, metallic: 0.05 };
    const head = add({ name: `Koi Head ${kp.name}`, mesh: koiHeadGeo, ...kMat });
    const finL = add({ name: `Koi Fin L ${kp.name}`, mesh: pectoralGeoL, position: [-0.05, -0.008, 0.064], ...kMat });
    const finR = add({ name: `Koi Fin R ${kp.name}`, mesh: pectoralGeoR, position: [-0.05, -0.008, -0.064], ...kMat });
    const mid = add({ name: `Koi Mid ${kp.name}`, mesh: koiMidGeo, position: [-0.104, 0, 0], ...kMat });
    const tail = add({ name: `Koi Tail ${kp.name}`, mesh: koiTailGeo, position: [-0.124, 0, 0], ...kMat });
    const caudal = add({ name: `Koi Caudal ${kp.name}`, mesh: koiCaudalGeo, position: [-0.104, 0, 0], ...kMat });
    root.add(head);
    head.add(finL);
    head.add(finR);
    head.add(mid);
    mid.add(tail);
    tail.add(caudal);
    registerPick(head, {
      id: `koi_${kp.name}`, name: kp.name, kind: 'Articulated Swimming Koi',
      desc: '4-jointed ornamental carp swimming along smooth non-intersecting currents with travelling S-wave propulsion.',
    });
    koiList.push({ ...kp, root, head, mid, tail, caudal, finL, finR });
  }

  // 9. Two Iridescent Dragonflies + 10 Drifting Maple Leaves + 10 Dusk Fireflies
  const dragonflies = [];
  const dfBodyGeo = createOrganicBranch([[0, 0, 0], [-0.14, 0, 0]], (t) => 0.011 * (1 - t * 0.45), 8, true);
  const dfWingGeoL = createOrganicBranch([[0, 0, 0], [0.02, 0.01, 0.13]], (t) => 0.016 * Math.sin(t * Math.PI + 0.15), 8, true);
  const dfWingGeoR = createOrganicBranch([[0, 0, 0], [0.02, 0.01, -0.13]], (t) => 0.016 * Math.sin(t * Math.PI + 0.15), 8, true);
  for (let i = 0; i < 2; ++i) {
    const piv = add({ name: `Dragonfly ${i + 1}`, position: [0.3 * (i === 0 ? 1 : -1), 0.72 + i * 0.25, 0.1] });
    piv.add(add({ name: `Dragonfly Body ${i + 1}`, mesh: dfBodyGeo, color: '#2bd4e6', emissive: 0.25, emissiveColor: [0.15, 0.75, 0.90], roughness: 0.22, metallic: 0.65 }));
    const wL = add({ name: `Dragonfly Wing L ${i + 1}`, mesh: dfWingGeoL, position: [-0.03, 0.012, 0.022], color: '#d8f6ff', roughness: 0.18, metallic: 0.2 });
    const wR = add({ name: `Dragonfly Wing R ${i + 1}`, mesh: dfWingGeoR, position: [-0.03, 0.012, -0.022], color: '#d8f6ff', roughness: 0.18, metallic: 0.2 });
    piv.add(wL);
    piv.add(wR);
    dragonflies.push({ piv, wL, wR, phase: i * 2.6, height: 1.18 + i * 0.24, radX: 0.82 + i * 0.25, radZ: 0.68 + i * 0.18 });
  }

  const driftingLeaves = [];
  const leafGeo = createOrganicBoulder(0.055, 0.008, 0.048, 8.2, 6, 8);
  for (let i = 0; i < 10; ++i) {
    const lf = add({
      name: `Drifting Leaf ${i + 1}`,
      mesh: leafGeo,
      position: [-0.8 + (i % 5) * 0.4, 0.5 + (i % 4) * 0.35, -0.3 + (i % 3) * 0.45],
      color: i % 2 === 0 ? '#d94524' : '#e8792c', roughness: 0.62, metallic: 0.0,
      castsShadow: false,
    });
    driftingLeaves.push({
      node: lf,
      bx: 0.15 + Math.cos(i * 0.628) * 0.55,
      bz: 0.35 + Math.sin(i * 0.628) * 0.55,
      phase: i * 0.1,
    });
  }

  const fireflies = [];
  const flyGeo = createOrganicBoulder(0.020, 0.020, 0.020, 3.3, 6, 8);
  for (let i = 0; i < 10; ++i) {
    const ang = (i / 10) * Math.PI * 2;
    const fx = Math.cos(ang) * 0.85;
    const fz = 0.25 + Math.sin(ang) * 0.72;
    const fy = 0.82 + (i % 3) * 0.05;
    const ff = add({
      name: `Firefly ${i + 1}`,
      mesh: flyGeo,
      position: [fx, fy, fz],
      color: '#ffd866', emissive: 0.95, emissiveColor: [1.0, 0.85, 0.30], roughness: 0.3, metallic: 0.0,
      castsShadow: false,
    });
    fireflies.push({ node: ff, bx: fx, bz: fz, by: fy, phase: i * 0.85 });
  }

  const lights = {
    key: scene.createLight({ name: 'Morning Canopy Sun', type: 'directional', position: [5.5, 8.5, 6.2], direction: [-0.48, -0.76, -0.58], color: [1.0, 0.96, 0.86], intensity: 3.6, castsShadow: true, shadowBias: 0.0005 }),
    rim: scene.createLight({ name: 'Cascade Mist Rim', type: 'directional', position: [-6.0, 5.0, -6.5], direction: [0.58, -0.45, 0.65], color: [0.68, 0.88, 1.0], intensity: 2.0, castsShadow: false }),
    poolFill: scene.createLight({ name: 'Basin Caustic Fill', type: 'point', position: [0.6, 1.9, 1.4], color: [0.76, 0.94, 0.98], intensity: 5.5, range: 11.0, castsShadow: false }),
    lanternLight: scene.createLight({ name: 'Stone Lantern Glow', type: 'point', position: [2.42, 0.62, 0.42], color: [1.0, 0.68, 0.26], intensity: 2.2, range: 4.5, castsShadow: false }),
  };

  return {
    fallMain, fallSide, splashRings, foliageAnchors, frondNodes, reedNodes,
    lilyGroups, koiList, dragonflies, driftingLeaves, fireflies, lanternEmber, lights,
  };
}
