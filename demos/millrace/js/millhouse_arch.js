// js/millhouse_arch.js — Fieldstone & half-timbered Alpine Watermill, Gear Porch, Footbridge & Moored Boat.

import { valleyHeightAt, pushSmoothTris } from './terrain_water.js';

/** Add an axis-aligned box with clean per-face UVs proportional to dimensions (no stretched mortar/bricks). */
function uvBox(w, h, d, uvScale = 0.65) {
  const m = Mesh.box(w * 0.5, h * 0.5, d * 0.5);
  const pos = m.positions, nrm = m.normals;
  const uvs = new Float32Array(m.vertexCount * 2);
  for (let i = 0; i < m.vertexCount; ++i) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
    if (ax >= ay && ax >= az) {
      uvs[i * 2] = (pz + d * 0.5) * uvScale;
      uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    } else if (ay >= ax && ay >= az) {
      uvs[i * 2] = (px + w * 0.5) * uvScale;
      uvs[i * 2 + 1] = (pz + d * 0.5) * uvScale;
    } else {
      uvs[i * 2] = (px + w * 0.5) * uvScale;
      uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    }
  }
  m.uvs = uvs;
  return m;
}

/** Pitched gable roof with crisp shingle UVs & closed triangular gable walls. */
function buildGableRoofAndGables(w, len, ridgeH, overhang) {
  const hw = w * 0.5 + overhang, hl = len * 0.5 + overhang;
  const thick = 0.08;
  const buildSlope = (side) => {
    const slopeLen = Math.hypot(hw, ridgeH);
    const ang = Math.atan2(ridgeH, hw) * (side > 0 ? -1 : 1);
    const slab = uvBox(slopeLen, thick, len + overhang * 2.0, 0.72);
    slab.translate(0, thick * 0.5, 0).rotate(0, 0, 1, ang);
    slab.translate(side * hw * 0.5, ridgeH * 0.5, 0);
    return slab;
  };
  const roofMesh = Mesh.merge([buildSlope(-1), buildSlope(1)]);

  // Closed triangular plaster/timber gable end walls under the roof slopes
  const gHw = w * 0.5, gHz = len * 0.5;
  const gVerts = [], gUvs = [], gTris = [];
  for (const s of [-1, 1]) {
    const z = s * gHz;
    const base = gVerts.length;
    gVerts.push([-gHw, 0, z], [gHw, 0, z], [0, ridgeH, z]);
    gUvs.push([0, 0], [w * 0.5, 0], [w * 0.25, ridgeH * 0.5]);
    if (s > 0) gTris.push([base, base + 1, base + 2]);
    else gTris.push([base, base + 2, base + 1]);
  }
  return { roofMesh, gableMesh: pushSmoothTris(gVerts, gUvs, gTris) };
}

export function buildMillhouseArchitecture(scene, add, mats, registerPick) {
  const mx = 2.45, my = 0.42, mz = -1.10;
  const stoneW = 2.25, stoneD = 2.65, wallH = 1.22;

  // 1. Fieldstone ground story + chimney + front steps + porch stone plinths (buried -0.16m into terrace)
  const stoneParts = [
    uvBox(stoneW, wallH + 0.16, stoneD, 0.62).translate(mx, my + (wallH - 0.16) * 0.5, mz),
    // South-front stone threshold stoop
    uvBox(0.95, 0.18, 0.48, 0.7).translate(mx + 0.25, my + 0.04, mz + stoneD * 0.5 + 0.20),
    uvBox(0.85, 0.10, 0.26, 0.7).translate(mx + 0.25, my - 0.02, mz + stoneD * 0.5 + 0.48),
    // Rising stone chimney on East gable
    uvBox(0.50, 3.15, 0.50, 0.65).translate(mx + stoneW * 0.5 - 0.14, my + 1.48, mz - 0.55),
    uvBox(0.60, 0.10, 0.60, 0.65).translate(mx + stoneW * 0.5 - 0.14, my + 3.06, mz - 0.55),
  ];

  // Two front/back grounded stone plinths under the open West Gear Porch (clear center gap for gear view)
  const porchW = 0.98;
  const postX = mx - stoneW * 0.5 - porchW + 0.10;
  const postZs = [mz - 1.05, mz + 1.05];
  for (const pz of postZs) {
    stoneParts.push(uvBox(0.24, 0.26, 0.24, 0.7).translate(postX, my + 0.04, pz));
  }
  const millStoneNode = add({
    name: 'Millhouse Fieldstone Masonry',
    mesh: Mesh.merge(stoneParts),
    texture: mats.fieldstone.albedo, normalTexture: mats.fieldstone.normal, metallicRoughnessTexture: mats.fieldstone.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 2. Half-timbered upper story plaster infill + triangular gables
  const upperY = my + wallH;
  const upperH = 0.96, upperW = stoneW + 0.08, upperD = stoneD + 0.08;
  const { roofMesh, gableMesh } = buildGableRoofAndGables(upperW, upperD, 0.92, 0.24);
  const plasterMesh = Mesh.merge([
    uvBox(upperW, upperH, upperD, 0.55).translate(mx, upperY + upperH * 0.5, mz),
    gableMesh.translate(mx, upperY + upperH, mz),
  ]);
  add({
    name: 'Millhouse Lime Stucco',
    mesh: plasterMesh,
    texture: mats.plaster.albedo, normalTexture: mats.plaster.normal, metallicRoughnessTexture: mats.plaster.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.0,
  });

  // 3. Weathered oak half-timber framing, front doorway, gear-porch roof & posts, & dock
  const timberParts = [
    // Horizontal sill & wall plates around upper story
    uvBox(upperW + 0.08, 0.11, upperD + 0.08, 0.8).translate(mx, upperY + 0.05, mz),
    uvBox(upperW + 0.08, 0.11, upperD + 0.08, 0.8).translate(mx, upperY + upperH - 0.04, mz),
    // Front oak doorway & lintel
    uvBox(0.56, 0.96, 0.10, 0.8).translate(mx + 0.25, my + 0.54, mz + stoneD * 0.5 + 0.02),
    uvBox(0.68, 0.12, 0.14, 0.8).translate(mx + 0.25, my + 1.04, mz + stoneD * 0.5 + 0.02),
    // Gear Porch sloped timber shelter overhead (framing exposed gear train!)
    uvBox(porchW + 0.34, 0.08, stoneD + 0.26, 0.7).rotate(0, 0, 1, 0.24)
      .translate(mx - stoneW * 0.5 - porchW * 0.48, upperY + 0.18, mz),
    // Horizontal tie beam connecting porch posts
    uvBox(0.14, 0.14, stoneD - 0.15, 0.8).translate(postX, upperY + 0.04, mz),
  ];
  for (const cx of [-upperW * 0.5, 0.0, upperW * 0.5]) {
    for (const cz of [-upperD * 0.5, upperD * 0.5]) {
      timberParts.push(uvBox(0.11, upperH, 0.11, 0.8).translate(mx + cx, upperY + upperH * 0.5, mz + cz));
    }
  }
  for (const pz of postZs) {
    timberParts.push(uvBox(0.14, upperY - my - 0.06, 0.14, 0.8).translate(postX, my + 0.14 + (upperY - my - 0.06) * 0.5, pz));
  }

  // Timber dock on south-west millpond shore (x = -3.15, z = 3.25)
  const dockX = -2.95, dockZ = 3.15;
  timberParts.push(
    uvBox(0.85, 0.07, 1.35, 0.8).translate(dockX, 0.16, dockZ),
    uvBox(0.10, 0.92, 0.10, 0.8).translate(dockX - 0.32, -0.22, dockZ - 0.52),
    uvBox(0.10, 0.92, 0.10, 0.8).translate(dockX + 0.32, -0.22, dockZ - 0.52),
    uvBox(0.10, 0.96, 0.10, 0.8).translate(dockX - 0.32, -0.20, dockZ + 0.54),
    uvBox(0.10, 1.08, 0.10, 0.8).translate(dockX + 0.32, -0.14, dockZ + 0.54),
  );

  // Arched Timber Footbridge spanning tailrace channel (x = -1.65..+0.75 at z = 0.88)
  const bz = 0.88;
  const brSegs = 12;
  for (let i = 0; i < brSegs; ++i) {
    const t0 = i / brSegs, t1 = (i + 1) / brSegs;
    const x0 = -1.65 + t0 * 2.40, x1 = -1.65 + t1 * 2.40;
    const xm = (x0 + x1) * 0.5;
    const xmNorm = (xm + 0.45) / 1.20;
    const archY = 0.32 + 0.24 * (1.0 - xmNorm * xmNorm);
    const slope = -0.48 * xmNorm / 1.20;
    const plank = uvBox(0.19, 0.06, 0.72, 0.8).rotate(0, 0, 1, slope).translate(xm, archY, bz);
    timberParts.push(plank);
    if (i % 3 === 0 || i === brSegs - 1) {
      timberParts.push(
        uvBox(0.06, 0.42, 0.06, 0.8).translate(xm, archY + 0.21, bz - 0.32),
        uvBox(0.06, 0.42, 0.06, 0.8).translate(xm, archY + 0.21, bz + 0.32),
      );
    }
  }
  for (const s of [-0.32, 0.32]) {
    const rail = Mesh.tube([
      [-1.65, 0.72, bz + s],
      [-0.45, 0.98, bz + s],
      [0.75, 0.72, bz + s],
    ], 0.032, 6, { capStart: true, capEnd: true });
    timberParts.push(rail);
  }
  // Horizontal oak wall bracket fixed cleanly to SW porch post (0.20m cantilever)
  timberParts.push(uvBox(0.20, 0.032, 0.032, 0.8).translate(postX - 0.15, upperY - 0.04, mz + 1.05));
  const timberNode = add({
    name: 'Millhouse & Footbridge Oak Timber',
    mesh: Mesh.merge(timberParts),
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // Grounded stone abutments under both ends of the footbridge
  add({
    name: 'Footbridge Stone Abutments',
    mesh: Mesh.merge([
      uvBox(0.45, 0.56, 0.90, 0.65).translate(-1.62, 0.14, bz),
      uvBox(0.45, 0.56, 0.90, 0.65).translate(0.72, 0.14, bz),
    ]),
    texture: mats.fieldstone.albedo, normalTexture: mats.fieldstone.normal, metallicRoughnessTexture: mats.fieldstone.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 4. Shingled Cedar Roof
  add({
    name: 'Millhouse Cedar Shingle Roof',
    mesh: roofMesh.translate(mx, upperY + upperH, mz),
    texture: mats.shingles.albedo, normalTexture: mats.shingles.normal, metallicRoughnessTexture: mats.shingles.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.01,
  });

  // 5. Warm Leaded-Glass Windows (with dark oak mullion frames, castsShadow enabled)
  const winSites = [
    { pos: [mx - 0.52, my + 0.68, mz + stoneD * 0.5 + 0.01], rotY: 0 },
    { pos: [mx - 0.45, upperY + 0.48, mz + upperD * 0.5 + 0.02], rotY: 0 },
    { pos: [mx + 0.45, upperY + 0.48, mz + upperD * 0.5 + 0.02], rotY: 0 },
    { pos: [mx - stoneW * 0.5 - 0.01, my + 0.72, mz + 0.65], rotY: Math.PI * 0.5 },
  ];
  const winPaneParts = [], winFrameParts = [];
  for (const w of winSites) {
    winPaneParts.push(uvBox(0.40, 0.44, 0.04, 1.0).rotate(0, 1, 0, w.rotY).translate(...w.pos));
    const wf = Mesh.merge([
      uvBox(0.48, 0.05, 0.07, 1.0).translate(0, 0.22, 0),
      uvBox(0.48, 0.05, 0.07, 1.0).translate(0, -0.22, 0),
      uvBox(0.05, 0.44, 0.07, 1.0).translate(-0.215, 0, 0),
      uvBox(0.05, 0.44, 0.07, 1.0).translate(0.215, 0, 0),
      uvBox(0.03, 0.40, 0.06, 1.0),
      uvBox(0.40, 0.03, 0.06, 1.0),
    ]);
    winFrameParts.push(wf.rotate(0, 1, 0, w.rotY).translate(...w.pos));
  }
  add({
    name: 'Millhouse Oak Window Mullions',
    mesh: Mesh.merge(winFrameParts),
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#6b4c30', roughness: 1.0, metallic: 0.02,
  });
  const windowsNode = add({
    name: 'Millhouse Warm Windows',
    mesh: Mesh.merge(winPaneParts),
    texture: mats.plaster.albedo, normalTexture: mats.plaster.normal, metallicRoughnessTexture: mats.plaster.mr,
    color: '#ffcf78', emissive: 0.25, emissiveColor: [1.0, 0.72, 0.30], roughness: 0.42, metallic: 0.0,
    castsShadow: true,
  });

  // 6. Hanging Cast-Iron Porch Lantern (suspended below tip of oak wall bracket, clear of post!)
  const lanPivot = add({ name: 'Porch Lantern Pivot', position: [postX - 0.23, upperY - 0.058, mz + 1.05] });
  const lanIron = Mesh.merge([
    Mesh.tube([[0, 0, 0], [0, -0.13, 0]], 0.011, 6, { capStart: false, capEnd: false }),
    Mesh.cone(0.095, 0.08, 6).translate(0, -0.13, 0),
    Mesh.cylinder(0.075, 0.012, 6).translate(0, -0.31, 0),
  ]);
  lanPivot.add(add({
    name: 'Porch Lantern Iron',
    mesh: lanIron,
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  }));
  const lanternBulb = add({
    name: 'Porch Lantern Glass',
    mesh: Mesh.sphere(0.045, 10, 8).translate(0, -0.245, 0),
    color: '#ffba52', emissive: 1.4, emissiveColor: [1.0, 0.68, 0.24], roughness: 0.28, metallic: 0.0,
    castsShadow: false,
  });
  lanPivot.add(lanternBulb);

  // 7. Tapered Moored Wooden Rowboat on Millpond
  const boatPivot = add({ name: 'Moored Rowboat Pivot', position: [-1.95, 0.015, 3.05] });
  boatPivot.rotationY = 0.52;
  const boatHull = Mesh.merge([
    uvBox(0.40, 0.06, 0.88, 0.9).translate(0, 0.02, 0.02),
    uvBox(0.05, 0.18, 0.72, 0.9).rotate(0, 0, 1, -0.26).translate(-0.22, 0.11, 0.10),
    uvBox(0.05, 0.18, 0.72, 0.9).rotate(0, 0, 1, 0.26).translate(0.22, 0.11, 0.10),
    // Tapered V-bow planks converging cleanly to a pointed prow (z = -0.58)
    uvBox(0.05, 0.18, 0.42, 0.9).rotate(0, 1, 0, -0.48).translate(-0.11, 0.11, -0.40),
    uvBox(0.05, 0.18, 0.42, 0.9).rotate(0, 1, 0, 0.48).translate(0.11, 0.11, -0.40),
    uvBox(0.42, 0.04, 0.14, 0.9).translate(0, 0.13, -0.10),
    uvBox(0.42, 0.04, 0.14, 0.9).translate(0, 0.13, 0.20),
    uvBox(0.44, 0.18, 0.05, 0.9).translate(0, 0.11, 0.46),
  ]);
  boatPivot.add(add({
    name: 'Moored Wooden Rowboat',
    mesh: boatHull,
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#d4b896', roughness: 1.0, metallic: 0.01,
  }));

  registerPick(millStoneNode, {
    id: 'millhouse', name: 'Fieldstone Alpine Watermill', kind: 'Half-Timbered Millhouse · Masonry',
    desc: 'Two-story stone and timber watermill anchored into the east terrace with chimney, open gear porch & arched footbridge.',
  });
  registerPick(timberNode, {
    id: 'bridge', name: 'Arched Oak Footbridge & Dock', kind: 'Joinery Carpentry',
    desc: 'Camfered oak footbridge spanning the tailrace channel onto stone abutments, paired with a moored pond rowboat.',
  });

  return {
    wallSurfaceNode: millStoneNode,
    windowsNode,
    lanPivot,
    lanternBulb,
    lanternWorldPos: [postX - 0.23, upperY - 0.315, mz + 1.05],
    chimneyTopPos: [mx + stoneW * 0.5 - 0.14, my + 3.12, mz - 0.55],
    boatPivot,
    porchOrigin: [mx - stoneW * 0.5, my, mz],
  };
}
