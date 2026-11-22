// js/watchroom_interior.js — Curved mahogany keeper desk, nautical logbook, copper kerosene tank, gauges & gimbal lamp.

import { boxFull, cylFull, revolveProfile } from './sculpt_geom.js';

export function buildWatchroomInterior(add, mats, registerPick) {
  // 1. Curved Mahogany Keeper's Watch Desk seated firmly at Y = 0.00 in West watchroom quadrant
  //    Angular span: theta in [-0.90*PI, -0.54*PI] (i.e. 1.10*PI .. 1.46*PI), r = 1.48 .. 2.06 (clear of wall r=2.18 & pedestal r=0.64)
  const dA0 = 1.10 * Math.PI, dA1 = 1.46 * Math.PI;
  const deskTopMesh = revolveProfile([
    [2.06, 0.70],
    [2.06, 0.75],
    [1.48, 0.75],
    [1.48, 0.70],
  ], 18, dA0, dA1, true, 0.9);
  const deskApronMesh = revolveProfile([
    [2.02, 0.56],
    [2.02, 0.70],
    [1.54, 0.70],
    [1.54, 0.56],
  ], 16, dA0 + 0.03, dA1 - 0.03, true, 0.9);

  const deskParts = [deskTopMesh, deskApronMesh];
  for (const ang of [dA0 + 0.04, dA1 - 0.04]) {
    for (const rLeg of [1.56, 1.98]) {
      deskParts.push(cylFull(0.032, 0.70, 8).translate(rLeg * Math.sin(ang), 0.35, rLeg * Math.cos(ang)));
    }
  }
  const deskNode = add({
    name: 'Mahogany Watch Desk',
    mesh: Mesh.merge(deskParts),
    texture: mats.mahogany.albedo, normalTexture: mats.mahogany.normal, metallicRoughnessTexture: mats.mahogany.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 2. Open Curved-Page Keeper's Watch Logbook flush atop desk top (Y = 0.750 .. 0.785 -> conformance pair!)
  const bookTheta = 1.28 * Math.PI;
  const bookR = 1.77;
  const bx = bookR * Math.sin(bookTheta), bz = bookR * Math.cos(bookTheta);
  const logBookMesh = Mesh.merge([
    boxFull(0.24, 0.010, 0.34, 1.2).rotate(0, 1, 0, bookTheta).translate(bx, 0.755, bz),
    boxFull(0.21, 0.010, 0.31, 1.8).rotate(0, 1, 0, bookTheta).translate(bx, 0.764, bz),
  ]);
  add({
    name: 'Keeper Watch Logbook',
    mesh: logBookMesh,
    texture: mats.parchment.albedo, normalTexture: mats.parchment.normal, metallicRoughnessTexture: mats.parchment.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.0,
  });

  // Brass sextant dividers / inkwell beside logbook on desk
  const inkTheta = 1.40 * Math.PI;
  const ix = 1.72 * Math.sin(inkTheta), iz = 1.72 * Math.cos(inkTheta);
  add({
    name: 'Desk Brass Inkwell',
    mesh: Mesh.merge([
      cylFull(0.048, 0.052, 12).translate(ix, 0.776, iz),
      cylFull(0.028, 0.026, 12).translate(ix, 0.815, iz),
    ]),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  });

  // 3. Pressurized Riveted Copper Kerosene Fuel Tank (grounded Y = 0.00) + Swept Copper Feed Pipe into Pedestal Collar
  const tankR = 1.24, tankA = 0.96 * Math.PI;
  const tx = tankR * Math.sin(tankA), tz = tankR * Math.cos(tankA);
  const fountMesh = Mesh.merge([
    cylFull(0.26, 0.05, 16).translate(tx, 0.025, tz),
    cylFull(0.24, 0.84, 18).translate(tx, 0.47, tz),
    Mesh.sphere(0.24, 16, 10).translate(tx, 0.89, tz),
    cylFull(0.045, 0.14, 10).translate(tx, 1.15, tz),
    // Swept insulated copper fuel feed line from tank crown up to pedestal collar (r=0.35, Y=1.66)
    Mesh.tube([
      [tx, 1.18, tz],
      [tx * 0.85, 1.48, tz * 0.85],
      [0.37 * Math.sin(tankA), 1.66, 0.37 * Math.cos(tankA)],
    ], 0.018, 8, { capStart: true, capEnd: true }),
  ]);
  const fountNode = add({
    name: 'Pressurized Copper Kerosene Fount',
    mesh: fountMesh,
    texture: mats.copper.albedo, normalTexture: mats.copper.normal, metallicRoughnessTexture: mats.copper.mr,
    color: '#e08e62', roughness: 1.0, metallic: 0.72,
  });

  // 4. Wall-Mounted Brass Marine Barometer & Ship's Chronometer inside rear watchroom wall (r = 2.15)
  const instGroup = [];
  const dialPlates = [];
  for (const [theta, y, rDial] of [[1.18 * Math.PI, 1.48, 0.14], [1.02 * Math.PI, 1.54, 0.16]]) {
    const cx = 2.14 * Math.sin(theta), cz = 2.14 * Math.cos(theta);
    instGroup.push(
      cylFull(rDial + 0.032, 0.06, 18).rotate(1, 0, 0, Math.PI * 0.5).rotate(0, 1, 0, theta).translate(cx, y, cz),
    );
    const dial = cylFull(rDial, 0.02, 18).rotate(1, 0, 0, Math.PI * 0.5).rotate(0, 1, 0, theta)
      .translate(2.105 * Math.sin(theta), y, 2.105 * Math.cos(theta));
    dialPlates.push(dial);
  }
  add({
    name: 'Brass Chronometer & Barometer Bezels',
    mesh: Mesh.merge(instGroup),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.86,
  });
  add({
    name: 'Marine Enamel Instrument Dials',
    mesh: Mesh.merge(dialPlates),
    texture: mats.dial.albedo, normalTexture: mats.dial.normal, metallicRoughnessTexture: mats.dial.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.02,
  });

  // 5. Gimballed Watchroom Oil Lamp hanging from West wall bracket (clear above desk & clear of wall!)
  const lampA = 1.48 * Math.PI;
  const wallX = 2.16 * Math.sin(lampA), wallZ = 2.16 * Math.cos(lampA);
  const tipX = 1.76 * Math.sin(lampA), tipZ = 1.76 * Math.cos(lampA);
  add({
    name: 'Watchroom Lamp Wall Bracket',
    mesh: Mesh.tube([[wallX, 1.88, wallZ], [tipX, 1.90, tipZ]], 0.016, 8, { capStart: true, capEnd: true }),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.85,
  });
  const gimbalPivot = add({ name: 'Watchroom Gimbal Lamp Pivot', position: [tipX, 1.88, tipZ] });
  gimbalPivot.add(add({
    name: 'Gimballed Brass Lamp Body',
    mesh: Mesh.merge([
      cylFull(0.010, 0.14, 6).translate(0, -0.07, 0),
      Mesh.cone(0.11, 0.07, 12).translate(0, -0.18, 0),
      cylFull(0.068, 0.05, 12).translate(0, -0.29, 0),
    ]),
    texture: mats.brass.albedo, normalTexture: mats.brass.normal, metallicRoughnessTexture: mats.brass.mr,
    color: '#ffffff', roughness: 1.0, metallic: 0.86,
  }));
  const gimbalFlame = add({
    name: 'Gimballed Lamp Mantle',
    mesh: Mesh.sphere(0.042, 10, 8).translate(0, -0.23, 0),
    color: '#ffc66e', emissive: 1.35, emissiveColor: [1.0, 0.72, 0.30], roughness: 0.35, metallic: 0.0,
    castsShadow: false,
  });
  gimbalPivot.add(gimbalFlame);

  registerPick(deskNode, {
    id: 'watchroom', name: 'Curved Mahogany Watch Desk & Logbook', kind: 'Keeper Watchroom · Interior Cutaway',
    desc: 'Curved shipwright mahogany watch desk with inlaid slate compass deck, nautical logbook, brass barometer & pressurized fuel fount.',
  });
  registerPick(fountNode, {
    id: 'fount', name: 'Pressurized Copper Kerosene Fount', kind: 'Vapour Feed Tank · 1.2 Bar',
    desc: 'Riveted copper service tank supplying vaporized kerosene up the central cast-iron column directly to the incandescent mantle.',
  });

  return { deskNode, fountNode, gimbalPivot, gimbalFlame, watchLightPos: [tipX, 1.65, tipZ] };
}
