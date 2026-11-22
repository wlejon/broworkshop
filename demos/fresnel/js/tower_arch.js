// js/tower_arch.js — Granite watchroom tower, corbels, gallery railing, helical lantern glazing, cupola & spiral stair.

import { boxFull, cylFull, revolveProfile, buildCorbelBracket, buildSpiralStaircase } from './sculpt_geom.js';
import { LANTERN_PANE_BK } from './fresnel_shaders.js';

export function buildTowerArchitecture(scene, add, mats, registerPick) {
  const cutA0 = 0.42 * Math.PI;
  const cutA1 = (2.0 - 0.42) * Math.PI;
  const murA0 = 0.36 * Math.PI;
  const murA1 = (2.0 - 0.36) * Math.PI;

  // 1. Coastal granite plinth foundation (grounded Y = -0.34 .. 0.00) + Ashlar cutaway watchroom walls (0.00 .. 2.52)
  const plinthMesh = revolveProfile([
    [2.78, -0.34],
    [2.72, -0.08],
    [2.58, 0.00],
    [0.02, 0.00],
    [0.02, -0.34],
  ], 48, 0, Math.PI * 2, false, 0.75);

  const watchWallMesh = revolveProfile([
    [2.54, 0.00],
    [2.54, 0.16],
    [2.48, 0.22],
    [2.48, 2.48],
    [2.18, 2.48],
    [2.18, 0.00],
  ], 36, cutA0, cutA1, true, 0.72);

  // Sculpted cantilevered granite gallery deck (Y = 2.48 .. 2.76) supported by 16 exterior corbels
  const deckParts = [
    revolveProfile([
      [2.20, 2.48],
      [3.04, 2.54],
      [3.06, 2.74],
      [2.20, 2.74],
    ], 48, 0, Math.PI * 2, false, 0.78),
  ];
  const corbelProto = buildCorbelBracket(2.46, 2.98, 1.94, 2.50, 0.20);
  for (let i = 0; i < 16; ++i) {
    const a = (i / 16) * Math.PI * 2;
    deckParts.push(corbelProto.clone().rotate(0, 1, 0, a));
  }
  const masonryNode = add({
    name: 'Granite Watchroom & Gallery Masonry',
    mesh: Mesh.merge([plinthMesh, watchWallMesh, ...deckParts]),
    texture: mats.granite.albedo, normalTexture: mats.granite.normal, metallicRoughnessTexture: mats.granite.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 2. Inlaid 16-point compass rose slate watchroom deck floor (Y = -0.02 .. 0.008)
  const floorDisc = cylFull(2.26, 0.03, 40, 0.5).translate(0, -0.007, 0);
  {
    const pos = floorDisc.positions, uvs = floorDisc.uvs;
    for (let i = 0; i < floorDisc.vertexCount; ++i) {
      uvs[i * 2] = 0.5 + pos[i * 3] / 4.52;
      uvs[i * 2 + 1] = 0.5 + pos[i * 3 + 2] / 4.52;
    }
    floorDisc.uvs = uvs;
  }
  add({
    name: 'Compass Rose Watchroom Floor',
    mesh: floorDisc,
    texture: mats.slate.albedo, normalTexture: mats.slate.normal, metallicRoughnessTexture: mats.slate.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 3. Riveted Cast-Iron Lantern Murette (2.74 .. 3.34) + Interior Service Deck (2.54, open at stair hatch) + Exterior Gallery Railing
  const muretteMesh = revolveProfile([
    [2.28, 2.74],
    [2.28, 3.32],
    [2.08, 3.32],
    [2.08, 2.74],
  ], 34, murA0, murA1, true, 0.90);

  const serviceDeckMesh = revolveProfile([
    [2.19, 2.48],
    [2.19, 2.57],
    [0.64, 2.57],
    [0.64, 2.48],
  ], 24, 1.19 * Math.PI, (2.0 + 0.44) * Math.PI, true, 0.85);

  const railParts = [
    Mesh.torus(2.92, 0.022, 48, 10).translate(0, 3.55, 0),
    Mesh.torus(2.92, 0.016, 48, 10).translate(0, 3.14, 0),
  ];
  for (let i = 0; i < 24; ++i) {
    const a = (i / 24) * Math.PI * 2;
    const rx = 2.92 * Math.sin(a), rz = 2.92 * Math.cos(a);
    railParts.push(cylFull(0.020, 0.81, 8).translate(rx, 2.74 + 0.405, rz));
    railParts.push(Mesh.sphere(0.030, 10, 8).translate(rx, 3.55, rz));
  }

  const ironworkNode = add({
    name: 'Cast-Iron Murette & Gallery Railing',
    mesh: Mesh.merge([muretteMesh, serviceDeckMesh, ...railParts]),
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  });

  // 4. Spiral Cast-Iron Staircase ascending cleanly inside East cutaway quarter
  const stair = buildSpiralStaircase(16, 1.46, 2.08, 0.48 * Math.PI, 1.15 * Math.PI);
  add({
    name: 'Spiral Staircase Treads',
    mesh: stair.treadMesh,
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.82,
  });
  add({
    name: 'Spiral Staircase Handrail',
    mesh: stair.handrailMesh,
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  });

  // 5. Helical Diamond-Astragal Bronze Lantern Bars (3.32 .. 5.56) + Full Cornice Ring
  const lanternR = 2.14;
  const barParts = [];
  for (let k = 0; k < 5; ++k) {
    const baseA = murA0 + 0.03 + (k / 4) * (murA1 - murA0 - 0.06);
    barParts.push(cylFull(0.028, 2.24, 8).translate(lanternR * Math.sin(baseA), 4.44, lanternR * Math.cos(baseA)));
  }
  // Intersecting left & right helical bronze glazing astragals
  const helixDirs = [1, -1];
  for (const dir of helixDirs) {
    for (let h = 0; h < 6; ++h) {
      const aStart = murA0 + 0.04 + (h / 5) * (murA1 - murA0 - 0.08);
      const pts = [];
      for (let s = 0; s <= 12; ++s) {
        const f = s / 12;
        const th = Math.max(murA0 + 0.02, Math.min(murA1 - 0.02, aStart + dir * f * 0.48));
        pts.push([lanternR * Math.sin(th), 3.32 + f * 2.24, lanternR * Math.cos(th)]);
      }
      barParts.push(Mesh.tube(pts, 0.017, 6, { capStart: true, capEnd: true }));
    }
  }
  barParts.push(revolveProfile([
    [2.04, 5.52],
    [2.42, 5.56],
    [2.46, 5.66],
    [2.02, 5.66],
    [2.02, 5.52],
  ], 48, 0, Math.PI * 2, false, 0.90));

  add({
    name: 'Helical Lantern Astragals & Cornice',
    mesh: Mesh.merge(barParts),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  });

  // Curved glazed lantern panes inside rear 230° lantern bay
  const paneMesh = revolveProfile([
    [2.13, 3.34],
    [2.13, 5.52],
  ], 32, murA0 + 0.02, murA1 - 0.02, false, 0.65);
  const lanternPane = add({
    name: 'Curved Lantern Glazing',
    mesh: paneMesh,
    color: [0.64, 0.82, 0.88, 0.28], roughness: 0.22, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  lanternPane.setShader({ module: LANTERN_PANE_BK, file: 'lantern_pane.bk', uniforms: { wind: 0.55, lampGlow: 1.0, pad0: 0, pad1: 0 } });

  // 6. Standing-Seam Verdigris Copper Ogee Cupola (5.64 .. 6.64) + Brass Ventilator Sphere + Spire
  const cupolaMesh = revolveProfile([
    [2.24, 5.64],
    [2.08, 5.88],
    [1.62, 6.24],
    [0.86, 6.50],
    [0.24, 6.64],
    [0.02, 6.64],
    [0.02, 5.64],
  ], 44, 0, Math.PI * 2, false, 0.80);

  const seamPts = [
    [2.24, 5.66],
    [2.09, 5.90],
    [1.63, 6.26],
    [0.87, 6.52],
    [0.25, 6.65],
  ];
  const cupParts = [cupolaMesh];
  for (let i = 0; i < 12; ++i) {
    const a = (i / 12) * Math.PI * 2;
    const rib = seamPts.map(([r, y]) => [r * Math.sin(a), y, r * Math.cos(a)]);
    cupParts.push(Mesh.tube(rib, 0.022, 6, { capStart: true, capEnd: true }));
  }
  const cupolaNode = add({
    name: 'Patina Copper Cupola',
    mesh: Mesh.merge(cupParts),
    texture: mats.copper.albedo, normalTexture: mats.copper.normal, metallicRoughnessTexture: mats.copper.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.35,
  });

  add({
    name: 'Ventilator Sphere & Lightning Spire',
    mesh: Mesh.merge([
      cylFull(0.28, 0.14, 24).translate(0, 6.69, 0),
      Mesh.sphere(0.26, 20, 14).translate(0, 6.92, 0),
      cylFull(0.026, 0.52, 10).translate(0, 7.36, 0),
    ]),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.78,
  });

  registerPick(masonryNode, {
    id: 'tower', name: 'Ashlar Granite Watchroom & Gallery', kind: 'Dressed Cornish Granite · Cutaway',
    desc: 'Interlocking granite masonry tower cantilevered by 16 carved corbels to support the forged-iron exterior gallery deck.',
  });
  registerPick(ironworkNode, {
    id: 'railing', name: 'Cast-Iron Murette & Spiral Stair', kind: 'Foundry Ironwork · 24 Stanchions',
    desc: 'Riveted cast-iron service parapet, perforated gallery hatch, and helical 16-tread staircase ascending from the compass floor.',
  });
  registerPick(cupolaNode, {
    id: 'cupola', name: 'Verdigris Copper Ogee Cupola', kind: 'Standing-Seam Copper Roof · Y=5.64m',
    desc: 'Ribbed salt-patinated copper ventilator dome crowned with a spun-brass ball vent, lightning conductor spire, and gale instruments.',
  });

  return { masonryNode, ironworkNode, cupolaNode, lanternPane };
}
