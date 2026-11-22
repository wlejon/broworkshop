// js/engine_build.js — Precision structurally grounded & meshed 3D assembly for Vulcan No. 4 (v4).

import {
  createLatheMesh,
  createTubeAlongPoints,
  createHelicalSpring,
  createChamferedBox,
  createSpurGear,
  createBevelGear,
  createSpokedFlywheel,
  createCutawayCylinder,
  createConnectingRod,
  createCrankWeb,
  createCamLobe,
  createBearingSaddle,
  createBearingCap,
} from './geometry.js';
import {
  makeCastIronEnamel,
  makeSatinBrass,
  makeMachinedSteel,
  makeBurnishedCopper,
  makeFoundryFloor,
  makeGaugeDial,
} from './textures.js';

export const CONSTANTS = {
  SHAFT_Y: 1.48,
  CRANK_X: 1.70,
  CRANK_R: 0.36,
  ROD_L: 1.78,
  BANK_Z: 0.92,
  G1_POS: [1.70, 1.48, 1.64],
  G2_POS: [1.70 - 0.90 * Math.cos(Math.PI / 6), 1.48 + 0.90 * Math.sin(Math.PI / 6), 1.64],
  G3_POS: [1.70 - 0.90 * Math.cos(Math.PI / 6), 1.48 + 0.90 * Math.sin(Math.PI / 6), 1.78],
  G4_POS: [
    1.70 - 0.90 * Math.cos(Math.PI / 6) - 0.81 * Math.cos(Math.PI / 6),
    1.48 + 0.90 * Math.sin(Math.PI / 6) + 0.81 * Math.sin(Math.PI / 6),
    1.78,
  ],
  G5_POS: [2.30, 1.48, 1.64],
  GOV_X: 1.70,
  GOV_Z: -1.78,
  CAM_Y: 1.48 + 0.90 * Math.sin(Math.PI / 6) + 0.81 * Math.sin(Math.PI / 6),
  CAM_X: 1.70 - 0.90 * Math.cos(Math.PI / 6) - 0.81 * Math.cos(Math.PI / 6),
};

export function buildEngineScene(scene, registerPick) {
  const ironTex = makeCastIronEnamel();
  const brassTex = makeSatinBrass();
  const steelTex = makeMachinedSteel();
  const copperTex = makeBurnishedCopper();
  const floorTex = makeFoundryFloor();

  const iron = { texture: ironTex, color: '#53626e', roughness: 0.36, metallic: 0.78 };
  const darkIron = { texture: ironTex, color: '#39454e', roughness: 0.42, metallic: 0.72 };
  const brass = { texture: brassTex, color: '#eec476', roughness: 0.22, metallic: 0.93 };
  const darkBrass = { texture: brassTex, color: '#bf8e42', roughness: 0.28, metallic: 0.90 };
  const steel = { texture: steelTex, color: '#d7dfe8', roughness: 0.18, metallic: 0.95 };
  const darkSteel = { texture: steelTex, color: '#9ea8b4', roughness: 0.24, metallic: 0.92 };
  const copper = { texture: copperTex, color: '#e48a5e', roughness: 0.24, metallic: 0.90 };
  const crimson = { color: '#b52d26', roughness: 0.34, metallic: 0.25 };

  const mesh = (opts) => scene.createMesh({ castsShadow: true, receivesShadow: true, ...opts });

  // Foundry slate floor & machined brass pit pan (pit narrowed cleanly to z = -0.26..+0.26 so inner pedestals never overhang!)
  mesh({
    name: 'Foundry Floor',
    mesh: createLatheMesh([[0.01, -0.05], [16, -0.05], [16, 0.0], [0.01, 0.0]], 56, 'y', 8, 8),
    texture: floorTex, color: '#3b4452', roughness: 0.40, metallic: 0.08, castsShadow: false,
  });
  mesh({
    name: 'Pit Brass Drip Tray',
    mesh: createChamferedBox(4.24, 0.04, 0.50, [1.03, 0.02, 0]),
    ...darkBrass,
  });

  // Grounded Cast-Iron Bedplate + Side Brackets (z = -1.50..+1.50; inner pit -0.26..+0.26)
  mesh({ name: 'Bedplate Rear Block', mesh: createChamferedBox(2.30, 0.34, 3.00, [-2.25, 0.17, 0]), ...darkIron });
  mesh({ name: 'Bedplate Right Bridge', mesh: createChamferedBox(0.52, 0.34, 3.00, [3.43, 0.17, 0]), ...darkIron });
  mesh({ name: 'Bedplate Front Rail', mesh: createChamferedBox(4.27, 0.34, 1.24, [1.035, 0.17, 0.88]), ...darkIron });
  mesh({ name: 'Bedplate Back Rail', mesh: createChamferedBox(4.27, 0.34, 1.24, [1.035, 0.17, -0.88]), ...darkIron });
  mesh({ name: 'Bedplate Governor Wing', mesh: createChamferedBox(0.52, 0.34, 0.58, [1.70, 0.17, -1.78]), ...darkIron });
  mesh({ name: 'Bedplate Lubricator Wing', mesh: createChamferedBox(0.50, 0.34, 0.56, [2.30, 0.17, 1.77]), ...darkIron });
  mesh({ name: 'Bedplate Brass Trim', mesh: createChamferedBox(7.08, 0.036, 0.03, [0.14, 0.32, 1.51]), ...brass });

  const boltGeo = createLatheMesh([[0.01, 0.0], [0.05, 0.0], [0.05, 0.046], [0.04, 0.056], [0.01, 0.056]], 6, 'y');
  for (let bx = -3.15; bx <= 3.55; bx += 1.11) {
    for (const bz of [-1.42, 1.42]) {
      mesh({ name: 'Anchor Bolt', mesh: boltGeo, position: [bx, 0.34, bz], ...steel });
    }
  }

  // True Curved Semi-Circular Split Pillow-Block Pedestals (100% seated on bedplate rails, boreR = 0.092 hugging 0.088r shaft!)
  const oilCupGeo = createLatheMesh([
    [0.01, 0.0], [0.024, 0.0], [0.024, 0.03], [0.045, 0.045], [0.045, 0.11], [0.028, 0.13], [0.01, 0.13],
  ], 18, 'y');
  for (const [pz, pw] of [[0.42, 0.22], [-0.42, 0.22], [1.38, 0.22], [-1.38, 0.22]]) {
    const lbl = pz > 0 ? 'Front' : 'Rear';
    const isOuter = Math.abs(pz) > 1.0;
    const ped = mesh({
      name: `${isOuter ? 'Outer' : 'Inner'} Pedestal ${lbl}`,
      mesh: createBearingSaddle(0.42, 0.335, CONSTANTS.SHAFT_Y, pw, 0.092),
      position: [CONSTANTS.CRANK_X, 0, pz],
      ...iron,
    });
    mesh({
      name: `Bearing Brass Cap ${lbl}`,
      mesh: createBearingCap(0.38, CONSTANTS.SHAFT_Y, CONSTANTS.SHAFT_Y + 0.175, pw, 0.092),
      position: [CONSTANTS.CRANK_X, 0, pz],
      ...brass,
    });
    mesh({
      name: `Bearing Oil Cup ${lbl}`,
      mesh: oilCupGeo,
      position: [CONSTANTS.CRANK_X, CONSTANTS.SHAFT_Y + 0.168, pz],
      ...copper,
    });
    if (isOuter) {
      registerPick(ped, {
        id: 'crankshaft', name: 'Main Crankshaft & Split Pillow Blocks', kind: 'Forged Alloy Steel Assembly',
        desc: 'Two open-throw quartered crankshaft journals seated tightly inside curved split babbitted brass bearings.',
      });
    }
  }

  // Segmented Crankshaft (extends rear stub to -1.60 cleanly holding meshed Crank Bevel Drive)
  const crankPivot = scene.createNode({ name: 'Crankshaft Pivot', position: [CONSTANTS.CRANK_X, CONSTANTS.SHAFT_Y, 0] });
  crankPivot.add(mesh({
    name: 'Crankshaft Center Journal',
    mesh: createLatheMesh([[0.01, -0.745], [0.088, -0.745], [0.088, 0.745], [0.01, 0.745]], 28, 'z'),
    ...steel,
  }));
  crankPivot.add(mesh({
    name: 'Crankshaft Front Stub',
    mesh: createLatheMesh([[0.01, 1.098], [0.088, 1.098], [0.088, 1.50], [0.072, 1.50], [0.072, 1.62], [0.01, 1.62]], 28, 'z'),
    ...steel,
  }));
  crankPivot.add(mesh({
    name: 'Crankshaft Rear Stub',
    mesh: createLatheMesh([[0.01, -1.60], [0.068, -1.60], [0.068, -1.50], [0.088, -1.50], [0.088, -1.098], [0.01, -1.098]], 28, 'z'),
    ...steel,
  }));

  const flywheel = mesh({ name: '8-Spoke Cast Flywheel', mesh: createSpokedFlywheel(1.36, 0.19, 0.22, 0.23, 8), ...iron });
  crankPivot.add(flywheel);
  crankPivot.add(mesh({ name: 'Flywheel Brass Trim Ring', mesh: createLatheMesh([[1.362, -0.075], [1.380, -0.075], [1.380, 0.075], [1.362, 0.075]], 64, 'z'), ...brass }));
  crankPivot.add(mesh({ name: 'Flywheel Brass Hub Ring Front', mesh: createLatheMesh([[0.10, 0.115], [0.22, 0.115], [0.22, 0.145], [0.10, 0.145]], 32, 'z'), ...brass }));
  registerPick(flywheel, {
    id: 'flywheel', name: '8-Spoke Cast Flywheel', kind: 'Inertial Energy Store',
    desc: 'Heavy 2.72-unit cast-iron flywheel with machined brass rim and hub rings clearing the sunken drip pit.',
  });

  // Twin Open Crank Throws, Forked Crossheads, Connecting Rods, Cutaway Cylinders & Live Thermodynamic Steam Volumes
  const webGeo = createCrankWeb(CONSTANTS.CRANK_R, 0.076, 0.135, 0.068);
  const pinGeo = createLatheMesh([[0.01, -0.105], [0.044, -0.105], [0.044, 0.105], [0.01, 0.105]], 24, 'z');
  const wristPinGeo = createLatheMesh([[0.01, -0.062], [0.025, -0.062], [0.025, 0.062], [0.01, 0.062]], 20, 'z');
  const steamUnitGeo = createLatheMesh([[0.008, 0.0], [0.232, 0.0], [0.232, 1.0], [0.008, 1.0]], 28, 'x');
  const crankSteamGeo = createLatheMesh([[0.052, 0.0], [0.232, 0.0], [0.232, 1.0], [0.052, 1.0]], 28, 'x');
  const dValveGeo = createChamferedBox(0.32, 0.11, 0.18, [0, 0, 0]);

  const banks = [];
  const cutaways = [];

  for (let bi = 0; bi < 2; ++bi) {
    const zC = bi === 0 ? CONSTANTS.BANK_Z : -CONSTANTS.BANK_Z;
    const phase = bi === 0 ? 0 : Math.PI * 0.5;
    const bankLbl = bi === 0 ? 'Front HP' : 'Rear LP';

    const throwPivot = scene.createNode({ name: `${bankLbl} Throw Pivot` });
    throwPivot.rotationZ = phase;
    throwPivot.add(mesh({ name: `${bankLbl} Web Inner`, mesh: webGeo, position: [0, 0, zC - 0.135], ...darkSteel }));
    throwPivot.add(mesh({ name: `${bankLbl} Web Outer`, mesh: webGeo, position: [0, 0, zC + 0.135], ...darkSteel }));
    throwPivot.add(mesh({ name: `${bankLbl} Crankpin`, mesh: pinGeo, position: [CONSTANTS.CRANK_R, 0, zC], ...brass }));
    crankPivot.add(throwPivot);

    mesh({ name: `${bankLbl} Cylinder Saddle`, mesh: createChamferedBox(1.48, 0.80, 0.56, [-2.08, 0.74, zC]), ...darkIron });
    const cutCy = mesh({ name: `${bankLbl} Cutaway Cylinder`, mesh: createCutawayCylinder(0.255, 0.34, 1.48, 0.15, 1.85), position: [-2.08, CONSTANTS.SHAFT_Y, zC], ...iron });
    const fullCy = mesh({ name: `${bankLbl} Closed Cylinder`, mesh: createLatheMesh([[0.256, -0.74], [0.34, -0.74], [0.34, 0.74], [0.256, 0.74]], 36, 'x'), position: [-2.08, CONSTANTS.SHAFT_Y, zC], ...iron });
    fullCy.visible = false;

    mesh({ name: `${bankLbl} Rear Head`, mesh: createLatheMesh([[0.01, -0.05], [0.39, -0.05], [0.39, -0.002], [0.22, 0.04], [0.01, 0.04]], 36, 'x'), position: [-2.835, CONSTANTS.SHAFT_Y, zC], ...brass });
    mesh({ name: `${bankLbl} Front Flange`, mesh: createLatheMesh([[0.052, 0.002], [0.38, 0.002], [0.38, 0.05], [0.11, 0.08], [0.052, 0.08]], 36, 'x'), position: [-1.335, CONSTANTS.SHAFT_Y, zC], ...brass });
    mesh({ name: `${bankLbl} Cylinder Oiler`, mesh: oilCupGeo, position: [-1.36, CONSTANTS.SHAFT_Y + 0.375, zC], ...copper });
    // Solid flanged copper steam branch risers connecting cylinder up into Steam Distribution Chest
    mesh({ name: `${bankLbl} Steam Riser Pipe`, mesh: createLatheMesh([[0.01, 1.79], [0.075, 1.79], [0.075, 1.84], [0.01, 1.84]], 20, 'y'), position: [-2.12, 0, zC], ...copper });

    mesh({ name: `${bankLbl} Slide Pillar`, mesh: createChamferedBox(0.32, 0.84, 0.34, [0.40, 0.76, zC]), ...iron });
    mesh({ name: `${bankLbl} Upper Slide`, mesh: createChamferedBox(1.66, 0.055, 0.12, [-0.45, CONSTANTS.SHAFT_Y + 0.265, zC]), ...steel });
    mesh({ name: `${bankLbl} Lower Slide`, mesh: createChamferedBox(1.66, 0.055, 0.12, [-0.45, CONSTANTS.SHAFT_Y - 0.265, zC]), ...steel });

    const pistonAssembly = scene.createNode({ name: `${bankLbl} Piston Assembly`, position: [0, CONSTANTS.SHAFT_Y, zC] });
    const pistonHead = mesh({
      name: `${bankLbl} Piston`,
      mesh: createLatheMesh([[0.01, -0.14], [0.242, -0.14], [0.242, -0.08], [0.225, -0.06], [0.225, 0.06], [0.242, 0.08], [0.242, 0.14], [0.01, 0.14]], 32, 'x'),
      ...steel,
    });
    pistonAssembly.add(pistonHead);
    pistonAssembly.add(mesh({ name: `${bankLbl} Compression Rings`, mesh: createLatheMesh([[0.228, -0.05], [0.248, -0.05], [0.248, 0.05], [0.228, 0.05]], 32, 'x'), ...brass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Piston Rod`, mesh: createLatheMesh([[0.01, 0.142], [0.042, 0.142], [0.042, 1.66], [0.01, 1.66]], 20, 'x'), ...steel }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Crosshead Block`, mesh: createChamferedBox(0.21, 0.22, 0.18, [1.765, 0, 0]), ...darkBrass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Crosshead Top Shoe`, mesh: createChamferedBox(0.24, 0.045, 0.14, [1.78, 0.212, 0]), ...brass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Crosshead Bot Shoe`, mesh: createChamferedBox(0.24, 0.045, 0.14, [1.78, -0.212, 0]), ...brass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Clevis Fork Front`, mesh: createChamferedBox(0.16, 0.11, 0.024, [1.95, 0, 0.052]), ...darkBrass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Clevis Fork Rear`, mesh: createChamferedBox(0.16, 0.11, 0.024, [1.95, 0, -0.052]), ...darkBrass }));
    pistonAssembly.add(mesh({ name: `${bankLbl} Wrist Pin`, mesh: wristPinGeo, position: [1.98, 0, 0], ...steel }));
    registerPick(pistonHead, {
      id: `piston${bi}`, name: `${bankLbl} Cutaway Cylinder & Steam Chambers`, kind: 'Live Thermodynamic Power Cycle',
      desc: 'Glow transitions dynamically from pressurized amber admission steam to cool blue exhaust across the double-acting stroke.',
    });

    // Dynamic Head-End & Crank-End Thermodynamic Steam Volumes + Exposed Brass D-Valve inside cutaway chest window
    const headSteam = mesh({
      name: `${bankLbl} Head Steam Chamber`,
      mesh: steamUnitGeo,
      position: [-2.77, CONSTANTS.SHAFT_Y, zC],
      color: '#ffbe62', emissive: 0.42, emissiveColor: [1.0, 0.65, 0.20], roughness: 0.45, metallic: 0.0,
      castsShadow: false, receivesShadow: false,
    });
    const crankSteam = mesh({
      name: `${bankLbl} Crank Steam Chamber`,
      mesh: crankSteamGeo,
      position: [-1.80, CONSTANTS.SHAFT_Y, zC],
      color: '#5a82b5', emissive: 0.12, emissiveColor: [0.35, 0.55, 0.90], roughness: 0.45, metallic: 0.0,
      castsShadow: false, receivesShadow: false,
    });
    const dValve = mesh({
      name: `${bankLbl} Slide D-Valve`,
      mesh: dValveGeo,
      position: [-2.08, 1.94, zC],
      ...brass,
    });
    cutaways.push({ cutCy, fullCy, headSteam, crankSteam, dValve });

    const conRod = mesh({
      name: `${bankLbl} Connecting Rod`,
      mesh: createConnectingRod(CONSTANTS.ROD_L, 0.115, 0.072, 0.062),
      position: [CONSTANTS.CRANK_X, CONSTANTS.SHAFT_Y, zC],
      ...steel,
    });
    registerPick(conRod, {
      id: `rod${bi}`, name: `${bankLbl} Forged Connecting Rod`, kind: 'Crank-Slider Linkage',
      desc: 'Tapered steel connecting rod articulating cleanly inside the open crank webs and crosshead fork.',
    });

    banks.push({ bi, phase, zC, pistonAssembly, conRod, headSteam, crankSteam, dValve });
  }

  // Front Outboard 5-Gear Involute Spur Train
  const gearDefs = [
    { id: 'g1', name: 'Crank Pinion (24T)', teeth: 24, r: 0.36, thick: 0.075, pos: CONSTANTS.G1_POS, ratio: 1.0, phase: 0, mat: brass },
    { id: 'g2', name: 'Intermediate Bull Gear (36T)', teeth: 36, r: 0.54, thick: 0.075, pos: CONSTANTS.G2_POS, ratio: -2 / 3, alpha: (5 * Math.PI) / 6, mat: iron },
    { id: 'g3', name: 'Compound Transfer Pinion (18T)', teeth: 18, r: 0.27, thick: 0.075, pos: CONSTANTS.G3_POS, ratio: -2 / 3, alpha: (5 * Math.PI) / 6, mat: brass },
    { id: 'g4', name: 'Camshaft Drive Gear (36T)', teeth: 36, r: 0.54, thick: 0.075, pos: CONSTANTS.G4_POS, ratio: 1 / 3, alpha: (5 * Math.PI) / 6, mat: iron },
    { id: 'g5', name: 'Lubricator Drive Pinion (16T)', teeth: 16, r: 0.24, thick: 0.075, pos: CONSTANTS.G5_POS, ratio: -1.5, alpha: 0, mat: darkBrass },
  ];
  const p2 = gearDefs[1].alpha + Math.PI + Math.PI / 36 + gearDefs[1].alpha * (24 / 36);
  gearDefs[1].phase = p2;
  gearDefs[2].phase = p2;
  const p4 = gearDefs[3].alpha + Math.PI + Math.PI / 36 - ((p2 - gearDefs[3].alpha) * 18) / 36;
  gearDefs[3].phase = p4;
  gearDefs[4].phase = Math.PI + Math.PI / 16;

  const gears = [];
  for (const gd of gearDefs) {
    const gNode = mesh({ name: gd.name, mesh: createSpurGear(gd.teeth, gd.r, gd.thick, 0.075, gd.teeth >= 30 ? 6 : 5), position: gd.pos, ...gd.mat });
    gears.push({ node: gNode, ...gd });
    registerPick(gNode, {
      id: gd.id, name: gd.name, kind: 'Compound Involute Gear Train',
      desc: 'Precision-cut involute spur gear transferring crankshaft timing forward to the overhead valve camshaft at 1:3 reduction.',
    });
  }

  // Idler & Lubricator Spindles grounded cleanly onto Idler Carrier Frame / Lubricator Wing
  mesh({ name: 'Idler Carrier Frame', mesh: createChamferedBox(0.32, 0.62, 0.14, [CONSTANTS.G2_POS[0], 1.56, 1.44]), ...darkIron });
  mesh({ name: 'Idler Base Pedestal', mesh: createChamferedBox(0.34, 0.94, 0.22, [CONSTANTS.G2_POS[0], 0.80, 1.40]), ...darkIron });
  mesh({ name: 'Idler Stub Spindle', mesh: createLatheMesh([[0.01, 1.40], [0.068, 1.40], [0.068, 1.84], [0.01, 1.84]], 24, 'z'), position: [CONSTANTS.G2_POS[0], CONSTANTS.G2_POS[1], 0], ...steel });
  mesh({ name: 'Lubricator Carrier Post', mesh: createChamferedBox(0.24, 1.24, 0.22, [CONSTANTS.G5_POS[0], 0.95, 1.42]), ...darkIron });
  mesh({ name: 'Lubricator Pinion Spindle', mesh: createLatheMesh([[0.01, 1.38], [0.068, 1.38], [0.068, 1.72], [0.01, 1.72]], 24, 'z'), position: [CONSTANTS.G5_POS[0], CONSTANTS.G5_POS[1], 0], ...steel });

  // Sight-Feed Lubricator Pump seated squarely on Bedplate Lubricator Wing (z = 1.82)
  const pumpBase = mesh({
    name: 'Sight-Feed Lubricator Pump',
    mesh: createLatheMesh([[0.01, 0.335], [0.14, 0.335], [0.14, 0.42], [0.09, 0.46], [0.09, 0.63], [0.12, 0.655], [0.01, 0.655]], 24, 'y'),
    position: [2.30, 0, 1.82],
    ...darkIron,
  });
  const pumpPlunger = mesh({
    name: 'Lubricator Pump Plunger',
    mesh: createLatheMesh([[0.01, -0.14], [0.028, -0.14], [0.028, -0.04], [0.045, -0.04], [0.045, -0.036], [0.01, -0.036]], 18, 'y'),
    position: [2.30, 1.02, 1.82],
    ...brass,
  });
  const pumpRod = mesh({
    name: 'Lubricator Eccentric Rod',
    mesh: createConnectingRod(0.56, 0.036, 0.032, 0.024),
    position: [2.30, 1.48, 1.77],
    ...copper,
  });
  const g5EccPin = mesh({
    name: 'Lubricator Eccentric Pin',
    mesh: createLatheMesh([[0.01, 1.682], [0.014, 1.682], [0.014, 1.785], [0.01, 1.785]], 16, 'z'),
    position: [2.30, 1.48, 0],
    ...brass,
  });
  registerPick(pumpBase, {
    id: 'lubricator', name: 'Mechanical Sight-Feed Oil Pump', kind: 'Eccentric Reciprocating Pump',
    desc: 'G5 pinion eccentric rod driving a vertical brass lubricator plunger seated on the bolted bedplate wing.',
  });

  // Curved Camshaft Arch Stanchions (z = ±1.42 cleanly inside ±1.50 bedplate!) + Bolted Overhead Valve Guide Bridge!
  for (const pz of [1.42, -1.42]) {
    const lbl = pz > 0 ? 'Front' : 'Rear';
    mesh({ name: `Camshaft Arch Stanchion ${lbl}`, mesh: createBearingSaddle(0.24, 0.335, CONSTANTS.CAM_Y, 0.14, 0.058), position: [CONSTANTS.CAM_X, 0, pz], ...darkIron });
    mesh({ name: `Camshaft Brass Cap ${lbl}`, mesh: createBearingCap(0.22, CONSTANTS.CAM_Y, CONSTANTS.CAM_Y + 0.115, 0.14, 0.058), position: [CONSTANTS.CAM_X, 0, pz], ...brass });
    mesh({ name: `Cam Bridge Pillar ${lbl}`, mesh: createChamferedBox(0.16, 0.50, 0.14, [CONSTANTS.CAM_X, CONSTANTS.CAM_Y + 0.35, pz]), ...darkIron });
    mesh({ name: `Cam Bearing Oiler ${lbl}`, mesh: oilCupGeo, position: [CONSTANTS.CAM_X, CONSTANTS.CAM_Y + 0.625, pz], ...copper });
  }
  mesh({ name: 'Overhead Valve Guide Bridge', mesh: createChamferedBox(0.26, 0.045, 2.98, [CONSTANTS.CAM_X, CONSTANTS.CAM_Y + 0.61, 0]), ...darkIron });

  // Overhead Camshaft + Guided Valve Tappets with Spring Seat Washers & Central Guide Stems passing through outward-wound Springs!
  const camShaftPivot = scene.createNode({ name: 'Overhead Camshaft Pivot', position: [CONSTANTS.CAM_X, CONSTANTS.CAM_Y, 0] });
  camShaftPivot.add(mesh({
    name: 'Overhead Camshaft',
    mesh: createLatheMesh([[0.01, -1.50], [0.054, -1.50], [0.054, 1.82], [0.01, 1.82]], 24, 'z'),
    ...steel,
  }));
  const camGeo = createCamLobe(0.11, 0.095, 0.075);
  // Stem reaches +0.36 (< 0.587 bridge bottom even at peak lift +0.212!) while riding inside brass guide boss
  const followerGeo = createLatheMesh([
    [0.01, 0.0], [0.068, 0.0], [0.068, 0.032], [0.028, 0.042], [0.028, 0.092],
    [0.102, 0.092], [0.102, 0.120], [0.020, 0.120], [0.020, 0.36], [0.01, 0.36],
  ], 24, 'y');
  const springGeo = createHelicalSpring(0.085, 0.016, 5.0, 0.26, 20);
  const camUnits = [];
  for (let bi = 0; bi < 2; ++bi) {
    const zCam = bi === 0 ? 0.56 : -0.56;
    const camPhase = bi === 0 ? 0 : Math.PI * 0.5;
    const camNode = mesh({ name: `Cam Lobe ${bi + 1}`, mesh: camGeo, position: [0, 0, zCam], ...brass });
    camNode.rotationZ = camPhase;
    camShaftPivot.add(camNode);

    const fNode = mesh({ name: `Valve Tappet ${bi + 1}`, mesh: followerGeo, position: [CONSTANTS.CAM_X, CONSTANTS.CAM_Y + 0.12, zCam], ...steel });
    const spNode = mesh({ name: `Valve Spring ${bi + 1}`, mesh: springGeo, position: [CONSTANTS.CAM_X, CONSTANTS.CAM_Y + 0.26, zCam], ...darkBrass });
    mesh({ name: `Valve Guide Boss ${bi + 1}`, mesh: createLatheMesh([[0.024, 0.50], [0.060, 0.50], [0.060, 0.588], [0.024, 0.588]], 20, 'y'), position: [CONSTANTS.CAM_X, CONSTANTS.CAM_Y, zCam], ...brass });
    registerPick(spNode, {
      id: `cam${bi}`, name: `Overhead Cam, Guide Stem & Spring ${bi + 1}`, kind: 'Harmonic Egg-Cam Valvetrain',
      desc: 'Centered valve guide stem sliding inside a brass overhead bridge boss while the tappet shoulder compresses a outward-wound spring.',
    });
    camUnits.push({ phase: camPhase, fNode, spNode });
  }

  // Open-Window Cutaway Steam Distribution Chest seated solidly atop both risers + center cast-iron support column
  mesh({ name: 'Steam Manifold Pillar', mesh: createChamferedBox(0.32, 1.54, 0.36, [-2.08, 1.10, 0]), ...darkIron });
  mesh({ name: 'Steam Distribution Chest Back', mesh: createChamferedBox(0.84, 0.16, 1.38, [-2.08, 1.94, -0.40]), ...copper });
  mesh({ name: 'Steam Distribution Chest Cap', mesh: createChamferedBox(0.84, 0.07, 2.16, [-2.08, 2.045, 0]), ...copper });
  mesh({ name: 'Steam Chest Front Frame', mesh: createChamferedBox(0.84, 0.16, 0.24, [-2.08, 1.94, 1.18]), ...copper });
  const intakePipe = mesh({
    name: 'Main Steam Intake Pipe',
    mesh: createTubeAlongPoints([
      [-2.08, 2.06, 0], [-2.08, 2.66, 0], [-1.72, 2.86, 0], [-1.25, 2.86, 0], [-1.25, 2.10, 0], [-1.25, 0.335, 0],
    ], 0.070, 16, true),
    ...copper,
  });
  registerPick(intakePipe, {
    id: 'throttle', name: 'Corliss Steam Valve & Copper Manifold', kind: 'Live Throttle Admission',
    desc: 'Burnished copper admission pipe with crimson handwheel mounted on a brass bonnet stem linked to the governor.',
  });
  mesh({ name: 'Throttle Valve Bonnet Stem', mesh: createLatheMesh([[0.01, -0.02], [0.032, -0.02], [0.032, 0.24], [0.01, 0.24]], 16, 'z'), position: [-1.42, 2.86, 0.0], ...brass });
  mesh({ name: 'Throttle Valve Handwheel', mesh: createSpokedFlywheel(0.22, 0.032, 0.04, 0.045, 5), position: [-1.42, 2.86, 0.21], ...crimson });

  const gaugeDialTexRpm = makeGaugeDial(12, 0.78);
  const gaugeDialTexBar = makeGaugeDial(10, 0.75);
  const gaugeNeedles = [];
  for (const [gi, tex] of [[0, gaugeDialTexRpm], [1, gaugeDialTexBar]]) {
    const gPos = [-2.08 + (gi === 0 ? -0.34 : 0.34), 2.34, 0.96];
    mesh({ name: `Gauge Stem ${gi}`, mesh: createLatheMesh([[0.01, 2.07], [0.025, 2.07], [0.025, 2.17], [0.01, 2.17]], 14, 'y'), position: [gPos[0], 0, gPos[2]], ...brass });
    mesh({ name: gi === 0 ? 'RPM Brass Gauge Case' : 'Pressure Brass Gauge Case', mesh: createLatheMesh([[0.01, -0.045], [0.18, -0.045], [0.18, 0.045], [0.01, 0.045]], 28, 'z'), position: gPos, ...brass });
    mesh({ name: gi === 0 ? 'RPM Dial Face' : 'BAR Dial Face', mesh: createChamferedBox(0.28, 0.28, 0.01, [gPos[0], gPos[1], gPos[2] + 0.046]), texture: tex, color: '#f5eedc', roughness: 0.45, metallic: 0.0 });
    const needlePivot = scene.createNode({ name: `Gauge Needle ${gi}`, position: [gPos[0], gPos[1], gPos[2] + 0.056] });
    needlePivot.add(mesh({ name: `Gauge Needle Mesh ${gi}`, mesh: createChamferedBox(0.016, 0.11, 0.008, [0, 0.042, 0]), ...crimson }));
    gaugeNeedles.push(needlePivot);
  }

  // Tightly Meshed Rear 90-deg Mitre Bevel Drive (clear flanks, <0.02u pitch gap: zero collision, zero unmeshed gap!)
  const bevelHGeo = createBevelGear(18, 0.19, 0.10, 0.046);
  const crankBevel = mesh({ name: 'Crank Bevel Drive', mesh: bevelHGeo, position: [0, 0, -1.566], ...brass });
  crankBevel.rotationX = -Math.PI * 0.5;
  crankPivot.add(crankBevel);

  mesh({
    name: 'Governor Pedestal Mast',
    mesh: createLatheMesh([[0.01, 0.335], [0.19, 0.335], [0.16, 0.46], [0.10, 0.56], [0.10, 1.22], [0.13, 1.262], [0.01, 1.262]], 24, 'y'),
    position: [CONSTANTS.GOV_X, 0, CONSTANTS.GOV_Z],
    ...darkIron,
  });

  const govSpinPivot = scene.createNode({ name: 'Governor Spindle Pivot', position: [CONSTANTS.GOV_X, 1.266, CONSTANTS.GOV_Z] });
  const govBevel = mesh({ name: 'Governor Driven Bevel', mesh: bevelHGeo, position: [0, 0.0, 0], ...brass });
  govBevel.rotationY = Math.PI / 18;
  govSpinPivot.add(govBevel);
  govSpinPivot.add(mesh({ name: 'Governor Vertical Shaft', mesh: createLatheMesh([[0.01, 0.0], [0.032, 0.0], [0.032, 2.00], [0.01, 2.00]], 18, 'y'), ...steel }));
  govSpinPivot.add(mesh({ name: 'Governor Crown Cap', mesh: createLatheMesh([[0.01, 1.92], [0.062, 1.92], [0.062, 1.98], [0.035, 2.04], [0.01, 2.04]], 24, 'y'), ...brass }));

  const govCollar = mesh({ name: 'Governor Sliding Collar', mesh: createLatheMesh([[0.036, -0.065], [0.082, -0.065], [0.082, 0.065], [0.036, 0.065]], 24, 'y'), position: [0, 1.22, 0], ...darkBrass });
  govSpinPivot.add(govCollar);

  const armGeo = createTubeAlongPoints([[0, 0, 0], [0, -0.50, 0]], 0.020, 10, true);
  const ballGeo = createLatheMesh((() => {
    const p = [];
    for (let i = 0; i <= 14; ++i) {
      const a = -Math.PI * 0.5 + (i / 14) * Math.PI;
      p.push([Math.max(0.005, Math.cos(a) * 0.118), Math.sin(a) * 0.118]);
    }
    return p;
  })(), 24, 'y');

  const govArms = [], govLinks = [];
  for (let side = 0; side < 2; ++side) {
    const sign = side === 0 ? 1 : -1;
    const armPivot = scene.createNode({ name: `Governor Arm Pivot ${side + 1}`, position: [sign * 0.084, 1.90, 0] });
    armPivot.add(mesh({ name: `Governor Arm ${side + 1}`, mesh: armGeo, ...brass }));
    const flyball = mesh({ name: `Governor Flyball ${side + 1}`, mesh: ballGeo, position: [0, -0.54, 0], ...brass });
    armPivot.add(flyball);
    govSpinPivot.add(armPivot);
    govArms.push({ armPivot, sign });

    const linkRod = mesh({ name: `Governor Scissor Link ${side + 1}`, mesh: createTubeAlongPoints([[0, 0, 0], [0, 0.40, 0]], 0.015, 8, true), position: [sign * 0.104, 1.22, 0], ...steel });
    govSpinPivot.add(linkRod);
    govLinks.push({ linkRod, sign });

    registerPick(flyball, {
      id: 'governor', name: 'Watt Centrifugal Flyball Governor', kind: 'Closed-Loop Speed Regulator',
      desc: 'Meshed bevel-geared vertical spindle driving twin brass flyballs whose lift regulates throttle admission.',
    });
  }

  mesh({ name: 'Bellcrank Stanchion', mesh: createTubeAlongPoints([[1.24, 0.335, -1.16], [1.24, 2.40, -1.16]], 0.030, 12, true), ...darkIron });
  const govReachRod = mesh({
    name: 'Governor Control Linkage Rod',
    mesh: createTubeAlongPoints([
      [1.61, 2.30, -1.78], [1.24, 2.30, -1.78], [1.24, 2.30, -1.24], [1.24, 2.54, -1.24], [-1.25, 2.54, -1.24], [-1.25, 2.54, -0.068],
    ], 0.018, 10, true),
    ...brass,
  });

  const lights = {
    key: scene.createLight({ name: 'Studio Key', type: 'directional', position: [6, 9, 8], direction: [-0.52, -0.76, -0.62], color: [1.0, 0.94, 0.84], intensity: 3.8, castsShadow: true, shadowBias: 0.0005 }),
    rim: scene.createLight({ name: 'Cool Machined Rim', type: 'directional', position: [-6, 5, -7], direction: [0.58, -0.44, 0.65], color: [0.55, 0.78, 1.0], intensity: 2.6, castsShadow: false }),
    fill: scene.createLight({ name: 'Gear Train Lamp', type: 'point', position: [1.2, 2.4, 3.4], color: [1.0, 0.90, 0.74], intensity: 8.5, range: 11.0, castsShadow: false }),
  };

  return {
    crankPivot, banks, gears, camShaftPivot, camUnits, cutaways,
    pumpPlunger, pumpRod, g5EccPin,
    govSpinPivot, govCollar, govArms, govLinks, govReachRod, gaugeNeedles, lights,
  };
}
