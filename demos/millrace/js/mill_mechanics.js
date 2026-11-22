// js/mill_mechanics.js — Overshot waterwheel, elevated oak aqueduct, meshing involute gears & runner millstone.

import { valleyHeightAt, pushSmoothTris, WATER_STREAM_BK } from './terrain_water.js';

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function cyl(r, h, segs = 12) {
  return Mesh.cylinder(r, h * 0.5, segs);
}

function boxAt(w, h, d, uvScale = 0.9) {
  const m = Mesh.box(w * 0.5, h * 0.5, d * 0.5);
  const pos = m.positions, nrm = m.normals;
  const uvs = new Float32Array(m.vertexCount * 2);
  for (let i = 0; i < m.vertexCount; ++i) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]);
    if (ax >= ay && ax >= Math.abs(nrm[i * 3 + 2])) {
      uvs[i * 2] = (pz + d * 0.5) * uvScale; uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    } else if (ay >= ax && ay >= Math.abs(nrm[i * 3 + 2])) {
      uvs[i * 2] = (px + w * 0.5) * uvScale; uvs[i * 2 + 1] = (pz + d * 0.5) * uvScale;
    } else {
      uvs[i * 2] = (px + w * 0.5) * uvScale; uvs[i * 2 + 1] = (py + h * 0.5) * uvScale;
    }
  }
  m.uvs = uvs;
  return m;
}

/**
 * Exact radial spur gear lying in the YZ plane (rotation axis = X) with involute-trapezoid teeth,
 * solid rim, spokes & hub so opposing pitch circles at `R1 + R2` mesh cleanly with zero clipping.
 */
function createSpurGearYZ(toothCount, pitchR, faceWidth, hubR = 0.08) {
  const mod = (2.0 * pitchR) / toothCount;
  const add = mod * 0.72;
  const ded = mod * 0.92;
  const rRoot = Math.max(hubR + 0.02, pitchR - ded);
  const rOuter = pitchR + add;
  const halfW = faceWidth * 0.5;
  const rimParts = [
    cyl(rRoot, faceWidth, Math.max(24, toothCount * 2)).rotate(0, 0, 1, Math.PI * 0.5),
  ];

  const baseTooth = (theta) => {
    const span = (Math.PI * 2) / toothCount;
    const hbRoot = span * 0.23;
    const hbTip = span * 0.13;
    const prof = [
      [rRoot * Math.cos(-hbRoot), rRoot * Math.sin(-hbRoot)],
      [rOuter * Math.cos(-hbTip), rOuter * Math.sin(-hbTip)],
      [rOuter * Math.cos(hbTip), rOuter * Math.sin(hbTip)],
      [rRoot * Math.cos(hbRoot), rRoot * Math.sin(hbRoot)],
    ];
    const verts = [], uvs = [], tris = [];
    for (const s of [-1, 1]) {
      for (const [py, pz] of prof) {
        const y = py * Math.cos(theta) - pz * Math.sin(theta);
        const z = py * Math.sin(theta) + pz * Math.cos(theta);
        verts.push([s * halfW, y, z]);
        uvs.push([0.5 + y * 1.4, 0.5 + z * 1.4]);
      }
    }
    // Left (-X: 0..3) and Right (+X: 4..7) faces + 4 side walls
    tris.push([0, 2, 1], [0, 3, 2]);
    tris.push([4, 5, 6], [4, 6, 7]);
    for (let k = 0; k < 4; ++k) {
      const k1 = (k + 1) % 4;
      tris.push([k, k1, 4 + k1], [k, 4 + k1, 4 + k]);
    }
    return pushSmoothTris(verts, uvs, tris);
  };

  for (let t = 0; t < toothCount; ++t) {
    rimParts.push(baseTooth((t / toothCount) * Math.PI * 2));
  }
  return Mesh.merge(rimParts);
}

/** Smooth continuous curved U-trough or parabolic jet ribbon between 3D waypoints. */
function buildParabolicSpillJet(start, end, midY, wTop, wBot, segsV = 14, segsW = 6) {
  const verts = [], uvs = [], tris = [];
  const stride = segsW + 1;
  for (let i = 0; i <= segsV; ++i) {
    const v = i / segsV;
    const x = start[0] + (end[0] - start[0]) * v;
    const z = start[2] + (end[2] - start[2]) * v;
    const y = (1 - v) * (1 - v) * start[1] + 2 * (1 - v) * v * midY + v * v * end[1];
    const hw = wTop + (wBot - wTop) * v;
    for (let j = 0; j <= segsW; ++j) {
      const u = j / segsW;
      const s = u * 2.0 - 1.0;
      const crown = (1.0 - s * s) * 0.014;
      verts.push([x + s * hw, y, z + crown]);
      uvs.push([u, v]);
    }
  }
  for (let i = 0; i < segsV; ++i) {
    for (let j = 0; j < segsW; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      tris.push([a, b, d], [a, d, c]);
    }
  }
  return pushSmoothTris(verts, uvs, tris);
}

/** Annular stone ring (hollow eye so kingpost passes cleanly through center). */
function buildStoneRing(innerR, outerR, height, segs = 20) {
  const hy = height * 0.5;
  const verts = [], uvs = [], tris = [];
  for (let i = 0; i <= segs; ++i) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    verts.push(
      [c * innerR, hy, s * innerR],
      [c * outerR, hy, s * outerR],
      [c * outerR, -hy, s * outerR],
      [c * innerR, -hy, s * innerR],
    );
    const u = i / segs;
    uvs.push([u * 2, 0.2], [u * 2, 0.8], [u * 2, 1.0], [u * 2, 0.0]);
  }
  for (let i = 0; i < segs; ++i) {
    const b0 = i * 4, b1 = (i + 1) * 4;
    tris.push([b0, b1, b1 + 1], [b0, b1 + 1, b0 + 1]); // top
    tris.push([b0 + 1, b1 + 1, b1 + 2], [b0 + 1, b1 + 2, b0 + 2]); // outer
    tris.push([b0 + 2, b1 + 2, b1 + 3], [b0 + 2, b1 + 3, b0 + 3]); // bottom
    tris.push([b0 + 3, b1 + 3, b1], [b0 + 3, b1, b0]); // inner eye
  }
  return pushSmoothTris(verts, uvs, tris);
}

export function buildMillMechanics(add, mats, registerPick) {
  const wx = -0.45, wy = 0.72, wz = -0.95;
  const wheelR = 1.02;

  // 1. Stone Wheelpit Pier (open U-cradle journal below West axle) + Upper Cliff Intake Headwall
  const pierY = valleyHeightAt(-1.14, wz);
  const pierBot = pierY - 0.22;
  const cradleTop = wy - 0.11;
  add({
    name: 'Wheelpit Bearing Pier',
    mesh: Mesh.merge([
      boxAt(0.38, cradleTop - pierBot, 0.56, 0.7).translate(-1.14, (pierBot + cradleTop) * 0.5, wz),
      boxAt(0.28, 0.18, 0.09, 0.7).translate(-1.14, cradleTop + 0.09, wz - 0.15),
      boxAt(0.28, 0.18, 0.09, 0.7).translate(-1.14, cradleTop + 0.09, wz + 0.15),
      // Upper cliff stone spring reservoir headwall at aqueduct intake
      boxAt(1.05, 0.65, 0.85, 0.7).translate(-3.45, valleyHeightAt(-3.45, -3.15) + 0.18, -3.15),
    ]),
    texture: mats.fieldstone.albedo, normalTexture: mats.fieldstone.normal, metallicRoughnessTexture: mats.fieldstone.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 2. Elevated Timber Aqueduct Flume & Grounded Oak A-Frame Trestles (all bents outside wheelpit!)
  const aq0 = [-3.35, 2.34, -3.05];
  const aq1 = [wx, 1.94, wz - 0.34];
  const dx = aq1[0] - aq0[0], dy = aq1[1] - aq0[1], dz = aq1[2] - aq0[2];
  const aqLen = Math.hypot(dx, dy, dz);
  const aqYaw = Math.atan2(dx, dz);
  const aqPitch = -Math.asin(dy / aqLen);
  const [latX, , latZ] = norm3(dz, 0, -dx);

  const flumeParts = [];
  const makeFlumeBeam = (w, h, len, offLat, offY) => {
    const b = boxAt(w, h, len, 0.75);
    b.translate(offLat, offY, 0);
    b.rotate(1, 0, 0, aqPitch);
    b.rotate(0, 1, 0, aqYaw);
    b.translate((aq0[0] + aq1[0]) * 0.5, (aq0[1] + aq1[1]) * 0.5, (aq0[2] + aq1[2]) * 0.5);
    return b;
  };
  flumeParts.push(
    makeFlumeBeam(0.36, 0.05, aqLen, 0, 0.0),
    makeFlumeBeam(0.05, 0.22, aqLen, -0.16, 0.11),
    makeFlumeBeam(0.05, 0.22, aqLen, 0.16, 0.11),
  );
  // 3 Grounded A-frame oak trestle bents seated firmly outside the wheelpit span
  for (const frac of [0.18, 0.42, 0.66]) {
    const tx = aq0[0] + dx * frac, ty = aq0[1] + dy * frac, tz = aq0[2] + dz * frac;
    for (const s of [-0.30, 0.30]) {
      const fx = tx + latX * s, fz = tz + latZ * s;
      const fy = valleyHeightAt(fx, fz) - 0.12;
      flumeParts.push(Mesh.tube([[fx, fy, fz], [tx + latX * s * 0.55, ty - 0.02, tz + latZ * s * 0.55]], 0.048, 6, { capStart: true, capEnd: true }));
    }
    flumeParts.push(Mesh.tube([
      [tx - latX * 0.24, ty - 0.04, tz - latZ * 0.24],
      [tx + latX * 0.24, ty - 0.04, tz + latZ * 0.24],
    ], 0.045, 6, { capStart: true, capEnd: true }));
  }
  const aqueductNode = add({
    name: 'Timber Aqueduct Flume & Trestles',
    mesh: Mesh.merge(flumeParts),
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.01,
  });

  // Flowing water ribbon inside the aqueduct trough + parabolic overshot spill jet onto wheel buckets
  const flumeWater = add({
    name: 'Aqueduct Trough Water',
    mesh: makeFlumeBeam(0.24, 0.04, aqLen - 0.06, 0, 0.09),
    color: [0.65, 0.90, 0.98, 0.84], roughness: 0.04, metallic: 0.02,
    castsShadow: false, receivesShadow: true,
  });
  flumeWater.setShader({
    module: WATER_STREAM_BK, file: 'flume_water.bk',
    uniforms: { time: 0.0, flow: 0.76, softTop: 0.0, pad: 0.0 },
  });

  const spillJet = add({
    name: 'Aqueduct Overshot Spill Jet',
    mesh: buildParabolicSpillJet([wx, 1.94, wz - 0.32], [wx, 0.02, wz + 1.15], 1.88, 0.11, 0.22, 16, 6),
    color: [0.78, 0.95, 1.0, 0.86], roughness: 0.05, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  spillJet.setShader({
    module: WATER_STREAM_BK, file: 'spill_jet.bk',
    uniforms: { time: 0.0, flow: 0.76, softTop: 0.15, pad: 0.0 },
  });

  // 3. Overshot Timber Waterwheel (rotates around +X axis inside wheelPivot at [wx, wy, wz])
  const wheelPivot = add({ name: 'Overshot Waterwheel Assembly', position: [wx, wy, wz] });
  const wheelOakParts = [
    // Continuous solid oak axle spanning West pier (-1.17) -> Pit Gear (+0.75) without entering wall
    cyl(0.080, 1.92, 12).rotate(0, 0, 1, Math.PI * 0.5).translate(0.24, 0, 0),
  ];
  const wheelIronParts = [
    // Forged hub collars & vertical YZ rim iron straps around both shrouds
    Mesh.torus(0.115, 0.020, 16, 8).rotate(0, 0, 1, Math.PI * 0.5).translate(-0.24, 0, 0),
    Mesh.torus(0.115, 0.020, 16, 8).rotate(0, 0, 1, Math.PI * 0.5).translate(0.24, 0, 0),
    Mesh.torus(wheelR, 0.018, 28, 8).rotate(0, 0, 1, Math.PI * 0.5).translate(-0.22, 0, 0),
    Mesh.torus(wheelR, 0.018, 28, 8).rotate(0, 0, 1, Math.PI * 0.5).translate(0.22, 0, 0),
  ];
  for (const xRim of [-0.22, 0.22]) {
    const rimSegs = 16;
    for (let i = 0; i < rimSegs; ++i) {
      const a0 = (i / rimSegs) * Math.PI * 2, a1 = ((i + 1) / rimSegs) * Math.PI * 2;
      wheelOakParts.push(Mesh.tube([
        [xRim, Math.sin(a0) * (wheelR - 0.04), Math.cos(a0) * (wheelR - 0.04)],
        [xRim, Math.sin(a1) * (wheelR - 0.04), Math.cos(a1) * (wheelR - 0.04)],
      ], 0.042, 6, { capStart: false, capEnd: false }));
    }
    for (let s = 0; s < 8; ++s) {
      const a = (s / 8) * Math.PI * 2;
      wheelOakParts.push(Mesh.tube([
        [xRim, 0, 0],
        [xRim, Math.sin(a) * (wheelR - 0.05), Math.cos(a) * (wheelR - 0.05)],
      ], 0.032, 6, { capStart: false, capEnd: false }));
    }
  }
  for (let b = 0; b < 16; ++b) {
    const a = (b / 16) * Math.PI * 2;
    const bk = boxAt(0.42, 0.035, 0.16, 1.0)
      .rotate(1, 0, 0, -a + 0.55)
      .translate(0, Math.sin(a) * (wheelR - 0.05), Math.cos(a) * (wheelR - 0.05));
    wheelOakParts.push(bk);
  }
  const wheelNode = add({
    name: 'Overshot Waterwheel Timber',
    mesh: Mesh.merge(wheelOakParts),
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });
  wheelPivot.add(wheelNode);
  wheelPivot.add(add({
    name: 'Waterwheel Iron Straps',
    mesh: Mesh.merge(wheelIronParts),
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 1.0,
  }));

  // 4. Open U-Cradle Pillow-Block Bearings + Perforated Oak Millstone Stand supporting exposed Gear Train
  const gearX = 0.62;
  const r1 = 0.40, r2 = 0.24;
  const pinionZ = wz + (r1 + r2); // exact sum of pitch radii = -0.31 -> clean meshing!
  const millX = 1.02;
  add({
    name: 'Gear Porch Pillow Bearings & Mill Frame',
    mesh: Mesh.merge([
      // East main-axle pillow-block cradle seated into sloping terrace bank (y=0.31..0.61, clearance > 0.080 axle radius)
      boxAt(0.20, 0.30, 0.32, 1.0).translate(0.42, 0.31 + 0.15, wz),
      boxAt(0.18, 0.16, 0.07, 1.0).translate(0.42, wy - 0.03, wz - 0.13),
      boxAt(0.18, 0.16, 0.07, 1.0).translate(0.42, wy - 0.03, wz + 0.13),
      // Pinion countershaft cradle stand seated onto terrace (y=0.40) at x=0.76
      boxAt(0.16, 0.25, 0.22, 1.0).translate(0.76, 0.40 + 0.125, pinionZ),
      boxAt(0.14, 0.12, 0.05, 1.0).translate(0.76, wy - 0.01, pinionZ - 0.08),
      boxAt(0.14, 0.12, 0.05, 1.0).translate(0.76, wy - 0.01, pinionZ + 0.08),
      // 4-leg open Oak Millstone Stand (x = millX ± 0.19, z = pinionZ ± 0.19) with center eye for kingpost
      boxAt(0.07, 0.48, 0.07, 0.85).translate(millX - 0.19, 0.40 + 0.24, pinionZ - 0.19),
      boxAt(0.07, 0.48, 0.07, 0.85).translate(millX + 0.19, 0.40 + 0.24, pinionZ - 0.19),
      boxAt(0.07, 0.48, 0.07, 0.85).translate(millX - 0.19, 0.40 + 0.24, pinionZ + 0.19),
      boxAt(0.07, 0.48, 0.07, 0.85).translate(millX + 0.19, 0.40 + 0.24, pinionZ + 0.19),
      boxAt(0.46, 0.04, 0.11, 0.85).translate(millX, 0.88, pinionZ - 0.18),
      boxAt(0.46, 0.04, 0.11, 0.85).translate(millX, 0.88, pinionZ + 0.18),
      boxAt(0.11, 0.04, 0.25, 0.85).translate(millX - 0.18, 0.88, pinionZ),
      boxAt(0.11, 0.04, 0.25, 0.85).translate(millX + 0.18, 0.88, pinionZ),
    ]),
    texture: mats.oak.albedo, normalTexture: mats.oak.normal, metallicRoughnessTexture: mats.oak.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.05,
  });

  // Stationary granite Bedstone Ring under Runner Stone (open r=0.07 eye so kingpost rotates freely!)
  add({
    name: 'Stationary Granite Bedstone',
    mesh: buildStoneRing(0.07, 0.24, 0.09, 20).translate(millX, 0.945, pinionZ),
    texture: mats.millstone.albedo, normalTexture: mats.millstone.normal, metallicRoughnessTexture: mats.millstone.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // Meshed Main Pit Wheel (N=20, R=0.40) mounted inside wheelPivot at localX = gearX - wx
  const mainGearMesh = createSpurGearYZ(20, r1, 0.09, 0.11).translate(gearX - wx, 0, 0);
  const mainGearNode = add({
    name: 'Main Cast-Iron Pit Gear',
    mesh: mainGearMesh,
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 1.0,
  });
  wheelPivot.add(mainGearNode);

  // Mathematically meshed Pinion Gear (N=12, R=0.24) + Countershaft & Drive Bevel Gear
  const pinionPivot = add({ name: 'Pinion Gear Countershaft Pivot', position: [gearX, wy, pinionZ] });
  const pinionGearMesh = Mesh.merge([
    createSpurGearYZ(12, r2, 0.095, 0.06),
    cyl(0.042, 0.34, 10).rotate(0, 0, 1, Math.PI * 0.5).translate(0.12, 0, 0),
    Mesh.cone(0.09, 0.045, 14).rotate(0, 0, 1, -Math.PI * 0.5).translate(0.285, 0, 0),
  ]);
  const pinionNode = add({
    name: 'Cast-Iron Pinion Gear',
    mesh: pinionGearMesh,
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 1.0,
  });
  pinionPivot.add(pinionNode);

  // Grooved Granite Runner Millstone (planar circular top UVs + granite perimeter) + Kingpost + Crown Bevel
  const stonePivot = add({ name: 'Runner Millstone Pivot', position: [millX, 1.055, pinionZ] });
  const runnerDrum = cyl(0.24, 0.10, 20);
  {
    const pos = runnerDrum.positions, nrm = runnerDrum.normals;
    const uvs = new Float32Array(runnerDrum.vertexCount * 2);
    for (let i = 0; i < runnerDrum.vertexCount; ++i) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      if (Math.abs(nrm[i * 3 + 1]) > 0.5) {
        uvs[i * 2] = 0.5 + px / 0.48;
        uvs[i * 2 + 1] = 0.5 + pz / 0.48;
      } else {
        uvs[i * 2] = (Math.atan2(pz, px) / (Math.PI * 2) + 0.5) * 1.6;
        uvs[i * 2 + 1] = (py + 0.05) * 2.5;
      }
    }
    runnerDrum.uvs = uvs;
  }
  const runnerNode = add({
    name: 'Rotating Granite Runner Millstone',
    mesh: Mesh.merge([
      runnerDrum,
      cyl(0.036, 0.25, 10).translate(0, -0.115, 0),
      Mesh.cone(0.09, 0.045, 14).translate(0, -0.23, 0),
    ]),
    texture: mats.millstone.albedo, normalTexture: mats.millstone.normal, metallicRoughnessTexture: mats.millstone.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });
  stonePivot.add(runnerNode);

  registerPick(wheelNode, {
    id: 'wheel', name: 'Overshot Oak Waterwheel', kind: 'Hydro-Mechanical Drive · 1.02m R',
    desc: 'Sixteen-bucket timber overshot wheel fed by the mountain aqueduct, delivering torque along a solid oak axle.',
  });
  registerPick(pinionNode, {
    id: 'gears', name: '20:12 Spur Gear & Granite Millstone', kind: 'Exposed Meshed Gear Train',
    desc: 'Cast-iron pit wheel (20T) driving a 12-tooth pinion shaft at 1.67x speed to spin the grooved runner millstone.',
  });
  registerPick(aqueductNode, {
    id: 'aqueduct', name: 'Elevated Timber Aqueduct', kind: 'Trestle Sluice Flume',
    desc: 'Mortised oak U-flume on grounded A-frame trestles diverting alpine spring runoff directly onto the wheel.',
  });

  return { wheelPivot, pinionPivot, stonePivot, flumeWater, spillJet };
}
