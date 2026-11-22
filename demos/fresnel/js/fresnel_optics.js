// js/fresnel_optics.js — Mercury-bath pedestal, rotating 1st-order catadioptric Fresnel drum, mantle, beams & gale rig.

import { boxFull, cylFull, revolveProfile, makeIndexedMesh, vNorm3 } from './sculpt_geom.js';
import { FRESNEL_GLASS_BK, MERCURY_BATH_BK, BEACON_BEAM_BK } from './fresnel_shaders.js';

/** Build a curved 60° cylindrical Fresnel panel (bullseye + dioptric & catadioptric prism ridges). */
function buildFresnelOpticPanelMesh(rMid = 0.88, aSpan = Math.PI / 3.4, yCenter = 1.12) {
  const glassParts = [];
  const segsU = 12;

  // Helper: extruded triangular/convex horizontal optical prism band swept across arc `-aSpan/2 .. +aSpan/2`
  const sweepBand = (yLo, yHi, rEdge, rPeak, yPeakFrac = 0.5) => {
    const prof = [
      [rEdge, yLo],
      [rPeak, yLo + (yHi - yLo) * yPeakFrac],
      [rEdge, yHi],
      [rEdge - 0.032, yHi],
      [rEdge - 0.032, yLo],
    ];
    glassParts.push(revolveProfile(prof, segsU, -aSpan * 0.5, aSpan * 0.5, true, 1.4));
  };

  // Central convex Fresnel bullseye belt
  sweepBand(yCenter - 0.22, yCenter + 0.22, rMid, rMid + 0.068, 0.5);
  // 3 stepped Dioptric upper/lower belts
  for (const s of [-1, 1]) {
    for (let k = 1; k <= 3; ++k) {
      const y0 = yCenter + s * (0.22 + (k - 1) * 0.13);
      const y1 = y0 + s * 0.125;
      sweepBand(Math.min(y0, y1), Math.max(y0, y1), rMid, rMid + 0.042 - k * 0.005, s > 0 ? 0.25 : 0.75);
    }
    // 3 inclined Catadioptric reflecting crown/sub-crown prisms tapering inward
    for (let k = 0; k < 3; ++k) {
      const y0 = yCenter + s * (0.62 + k * 0.115);
      const y1 = y0 + s * 0.105;
      const rIn = rMid - k * 0.055;
      sweepBand(Math.min(y0, y1), Math.max(y0, y1), rIn, rIn + 0.044, s > 0 ? 0.18 : 0.82);
    }
  }
  return Mesh.merge(glassParts);
}

/** Tapered horizontal volumetric beacon cone along +Z from bullseye out into coastal night air. */
function buildBeamCone(rStart = 0.22, rEnd = 1.45, len = 6.2, segs = 20) {
  const verts = [], uvs = [], tris = [];
  for (let i = 0; i <= 10; ++i) {
    const v = i / 10;
    const z = v * len;
    const r = rStart + (rEnd - rStart) * Math.pow(v, 0.92);
    for (let j = 0; j <= segs; ++j) {
      const u = j / segs;
      const th = u * Math.PI * 2;
      verts.push([r * Math.cos(th), r * Math.sin(th), z]);
      uvs.push([u, v]);
    }
  }
  const stride = segs + 1;
  for (let i = 0; i < 10; ++i) {
    for (let j = 0; j < segs; ++j) {
      const a = i * stride + j, b = a + stride, c = a + 1, d = b + 1;
      tris.push([a, d, b], [a, c, d]);
    }
  }
  return makeIndexedMesh(verts, uvs, tris);
}

export function buildFresnelOptics(scene, add, mats, registerPick) {
  // 1. Stationary Cast-Iron Fluted Pedestal Column + Wide Annular Mercury Bath Trough (Y = 0.00 .. 3.34)
  const pedestalMesh = revolveProfile([
    [0.64, 0.00],
    [0.64, 0.14],
    [0.44, 0.26],
    [0.36, 1.50],
    [0.34, 3.06],
    [0.96, 3.12],
    [0.96, 3.34],
    [0.895, 3.34],
    [0.895, 3.16],
    [0.48, 3.16],
    [0.48, 3.34],
    [0.24, 3.34],
    [0.24, 4.38],
    [0.12, 4.44],
    [0.02, 4.44],
    [0.02, 0.00],
  ], 40, 0, Math.PI * 2, false, 0.85);

  const pedNode = add({
    name: 'Cast-Iron Pedestal & Mercury Trough',
    mesh: pedestalMesh,
    texture: mats.iron.albedo, normalTexture: mats.iron.normal, metallicRoughnessTexture: mats.iron.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.62,
  });

  // Stationary brass mounting collar clamped flush around central cast-iron column (conformance test target)
  const collarMesh = revolveProfile([
    [0.382, 1.56],
    [0.382, 1.78],
    [0.348, 1.78],
    [0.348, 1.56],
  ], 32, 0, Math.PI * 2, false, 1.2);
  add({
    name: 'Pedestal Brass Mounting Collar',
    mesh: collarMesh,
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.78,
  });

  // Liquid Mercury surface inside trough (Y = 3.25 .. 3.27, r = 0.485 .. 0.890)
  const mercuryMesh = revolveProfile([
    [0.890, 3.25],
    [0.890, 3.27],
    [0.485, 3.27],
    [0.485, 3.25],
  ], 40, 0, Math.PI * 2, false, 1.0);
  const mercuryNode = add({
    name: 'Liquid Mercury Bath Surface',
    mesh: mercuryMesh,
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#a8b0ba', roughness: 0.34, metallic: 0.76,
  });
  mercuryNode.setShader({ module: MERCURY_BATH_BK, file: 'mercury_bath.bk', uniforms: { time: 0, spin: 0, pad0: 0, pad1: 0 } });

  // Central Incandescent Oil-Vapor Welsbach Mantle & Blown-Glass Chimney (world Y = 4.48)
  const mantleNode = add({
    name: 'Welsbach Vapor Mantle',
    mesh: cylFull(0.065, 0.16, 16).translate(0, 4.52, 0),
    color: '#ffd282', emissive: 1.15, emissiveColor: [1.0, 0.80, 0.42], roughness: 0.45, metallic: 0.0,
    castsShadow: false,
  });
  add({
    name: 'Lamp Glass Chimney',
    mesh: revolveProfile([
      [0.095, 4.38],
      [0.095, 4.86],
      [0.085, 4.86],
      [0.085, 4.38],
    ], 24, 0, Math.PI * 2, false, 1.0),
    color: [0.90, 0.96, 1.0, 0.34], roughness: 0.14, metallic: 0.02,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });

  // 2. Rotating First-Order Catadioptric Optical Assembly (pivot Y = 3.32)
  const lensPivot = add({ name: 'Rotating Fresnel Drum Pivot', position: [0, 3.32, 0] });

  // Floating brass mercury chariot ring (r = 0.56 .. 0.86, local y = -0.04 .. +0.14 -> world 3.28 .. 3.46, clear of trough!)
  const chariotRing = revolveProfile([
    [0.86, -0.04],
    [0.89, 0.06],
    [0.89, 0.14],
    [0.56, 0.14],
    [0.56, -0.04],
  ], 40, 0, Math.PI * 2, false, 1.1);

  const brassParts = [
    chariotRing,
    revolveProfile([[0.89, 2.02], [0.89, 2.10], [0.68, 2.10], [0.68, 2.02]], 40, 0, Math.PI * 2, false, 1.1),
  ];
  for (let i = 0; i < 6; ++i) {
    const a = (i / 6) * Math.PI * 2;
    const sx = 0.87 * Math.sin(a), sz = 0.87 * Math.cos(a);
    brassParts.push(cylFull(0.026, 1.94, 8).translate(sx, 1.08, sz));
  }
  const lensFrameNode = add({
    name: 'Fresnel Brass Chariot & Frame',
    mesh: Mesh.merge(brassParts),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.68,
  });
  lensPivot.add(lensFrameNode);

  // 6 Sculpted Crown-Glass Catadioptric Fresnel Panels mounted cleanly between vertical ribs
  const panelProto = buildFresnelOpticPanelMesh(0.87, Math.PI / 3.45, 1.16);
  const panelParts = [];
  for (let i = 0; i < 6; ++i) {
    const a = (i + 0.5) * (Math.PI / 3);
    panelParts.push(panelProto.clone().rotate(0, 1, 0, a));
  }
  const glassNode = add({
    name: 'First-Order Fresnel Optical Panels',
    mesh: Mesh.merge(panelParts),
    color: [0.76, 0.94, 0.90, 0.72], roughness: 0.16, metallic: 0.04,
    twoSided: true, castsShadow: false, receivesShadow: true,
  });
  glassNode.setShader({ module: FRESNEL_GLASS_BK, file: 'fresnel_glass.bk', uniforms: { time: 0, lampGlow: 1.0, dispersion: 1.0, pad: 0 } });
  lensPivot.add(glassNode);

  // 6 Rotating Volumetric Beacon Cones pointing outward from bullseye center (local y = 1.16 -> world Y = 4.48)
  const beamProto = buildBeamCone(0.18, 1.18, 6.2, 20);
  const beamParts = [];
  for (let i = 0; i < 6; ++i) {
    const a = (i + 0.5) * (Math.PI / 3);
    beamParts.push(beamProto.clone().translate(0, 1.16, 0.94).rotate(0, 1, 0, a));
  }
  const beamsNode = add({
    name: 'Fresnel Beacon Beams',
    mesh: Mesh.merge(beamParts),
    color: [1.0, 0.88, 0.58, 0.25], roughness: 0.9, metallic: 0.0,
    twoSided: true, castsShadow: false, receivesShadow: false,
  });
  beamsNode.setShader({ module: BEACON_BEAM_BK, file: 'beacon_beams.bk', uniforms: { beamGain: 0.85, time: 0, pad0: 0, pad1: 0 } });
  lensPivot.add(beamsNode);

  // 3. Rooftop Weathervane & Cornice-Mounted 4-Cup Robinson Anemometer (clear of spire & cupola!)
  const vanePivot = add({ name: 'Brass Weathervane Pivot', position: [0, 7.63, 0] });
  const vaneMesh = Mesh.merge([
    cylFull(0.020, 0.24, 8).translate(0, 0.12, 0),
    boxFull(0.014, 0.028, 0.64, 1.0).translate(0, 0.18, 0),
    boxFull(0.010, 0.14, 0.18, 1.0).translate(0, 0.18, -0.26),
    Mesh.cone(0.042, 0.11, 8).rotate(1, 0, 0, Math.PI * 0.5).translate(0, 0.18, 0.30),
  ]);
  vanePivot.add(add({
    name: 'Brass Weathervane Arrow',
    mesh: vaneMesh,
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.78,
  }));

  // Robinson 4-cup Anemometer mounted on outer East-North cornice edge ([1.94, 5.66, -1.30], rotor Y=6.08 clear above cupola!)
  const ax = 1.94, az = -1.30;
  add({
    name: 'Anemometer Cornice Mast',
    mesh: Mesh.merge([
      cylFull(0.036, 0.42, 10).translate(ax, 5.87, az),
      cylFull(0.065, 0.04, 12).translate(ax, 5.67, az),
    ]),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.78,
  });
  const anemPivot = add({ name: 'Anemometer Rotor Pivot', position: [ax, 6.095, az] });
  const spiderArms = [];
  for (let i = 0; i < 4; ++i) {
    const a = (i / 4) * Math.PI * 2;
    const armLen = 0.22;
    const cx = armLen * Math.sin(a), cz = armLen * Math.cos(a);
    spiderArms.push(cylFull(0.010, armLen, 6).rotate(1, 0, 0, Math.PI * 0.5).rotate(0, 1, 0, a).translate(cx * 0.5, 0, cz * 0.5));
    anemPivot.add(add({
      name: `Anemometer Cup ${i + 1}`,
      mesh: Mesh.sphere(0.042, 12, 8),
      position: [cx, 0, cz],
      texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
      color: '#ffffff', roughness: 1.0, metallic: 0.86,
    }));
  }
  anemPivot.add(add({
    name: 'Anemometer Rotor Arms',
    mesh: Mesh.merge(spiderArms),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.86,
  }));

  registerPick(glassNode, {
    id: 'optics', name: '1st-Order Catadioptric Fresnel Drum', kind: '6-Panel Crown Glass · 920mm Focal R',
    desc: 'Stepped bullseye dioptric belts and prism crown rings concentrating the oil-vapor mantle into six sweeping pencil beams.',
  });
  registerPick(pedNode, {
    id: 'pedestal', name: 'Mercury-Bath Chariot & Pedestal', kind: 'Frictionless Float Bearing · Y=3.30m',
    desc: 'Heavy cast-iron pedestal crowned by an annular liquid mercury trough floating the multi-ton brass optical lens drum.',
  });

  return {
    pedNode, mercuryNode, mantleNode, lensPivot, lensFrameNode, glassNode, beamsNode,
    vanePivot, anemPivot, lampPos: [0, 4.52, 0],
  };
}
