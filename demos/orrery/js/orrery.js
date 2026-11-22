// js/orrery.js — Hierarchical 3D construction & astronomical kinematics of Aurelia.

import {
  createLatheMesh,
  createBeveledRing,
  createSpurGear,
  createTubeAlongPoints,
  createCantileverArm,
  createRingDisk,
  createDegreeTicks,
  createSphereUV,
  createFlatDisc,
} from './geometry.js';
import {
  makeBrushedBrass,
  makeEngravedBrass,
  makeObsidianSlate,
  makeCompassDial,
  makePlanetTexture,
  makeSaturnRingTexture,
} from './textures.js';

const DEG = Math.PI / 180;
const SOLAR_Y = 4.52;

export const VIEW_PRESETS = {
  hero:        { target: [0, 4.15, 0],  dist: 16.0, yaw: 0.44, pitch: -0.24, fov: 44 },
  ecliptic:    { target: [0, 4.48, 0],  dist: 12.8, yaw: 0.72, pitch: -0.06, fov: 42 },
  planisphere: { target: [0, 4.48, 0],  dist: 15.8, yaw: 0.0,  pitch: -1.36, fov: 46 },
  clockwork:   { target: [0.12, 0.84, 0], dist: 3.15, yaw: 0.56, pitch: -0.38, fov: 40 },
};

export const MOOD_PRESETS = {
  midnight: {
    label: 'Midnight',
    bg: '#060910',
    fogColor: [0.024, 0.032, 0.056],
    ambient: [0.055, 0.068, 0.10],
    keyColor: [1.0, 0.91, 0.76],
    keyIntensity: 3.1,
    rimColor: [0.40, 0.64, 0.98],
    rimIntensity: 1.85,
    sunLightColor: [1.0, 0.85, 0.54],
    sunLightIntensity: 14,
    exposure: -0.10,
    bloom: { threshold: 1.15, intensity: 0.34, radius: 0.85 },
    stars: 980,
  },
  golden: {
    label: 'Golden',
    bg: '#110b08',
    fogColor: [0.055, 0.036, 0.025],
    ambient: [0.075, 0.054, 0.038],
    keyColor: [1.0, 0.78, 0.48],
    keyIntensity: 3.5,
    rimColor: [0.86, 0.54, 0.36],
    rimIntensity: 1.25,
    sunLightColor: [1.0, 0.80, 0.46],
    sunLightIntensity: 15,
    exposure: -0.02,
    bloom: { threshold: 1.08, intensity: 0.40, radius: 0.90 },
    stars: 440,
  },
  gallery: {
    label: 'Gallery',
    bg: '#0b1018',
    fogColor: [0.045, 0.062, 0.095],
    ambient: [0.095, 0.105, 0.125],
    keyColor: [0.98, 0.96, 0.92],
    keyIntensity: 3.8,
    rimColor: [0.62, 0.78, 0.98],
    rimIntensity: 1.75,
    sunLightColor: [1.0, 0.88, 0.65],
    sunLightIntensity: 12,
    exposure: 0.06,
    bloom: { threshold: 1.22, intensity: 0.28, radius: 0.75 },
    stars: 280,
  },
};

export const PLANET_SPECS = [
  {
    id: 'mercury', name: 'Mercury', kind: 'Terrestrial Planet',
    radius: 0.095, orbitR: 0.90, collarY: 3.46, tiltDeg: 0.03,
    periodDays: 88, startAngle: 0.50, angularSpeed: 1.45, harmonicOrder: 6, spinSpeed: 0.55,
    desc: 'Swiftest inner world carried by the uppermost bronze sleeve, cratered and sunlit against the arbor.',
    texKind: 'mercury', roughness: 0.66, metallic: 0.08,
  },
  {
    id: 'venus', name: 'Venus', kind: 'Cloud-Shrouded Terrestrial',
    radius: 0.140, orbitR: 1.30, collarY: 3.06, tiltDeg: 2.6,
    periodDays: 225, startAngle: 2.15, angularSpeed: 0.92, harmonicOrder: 4, spinSpeed: -0.25,
    desc: 'Dense golden-ivory sulfurous cloud decks slowly turning retrograde atop its curved cantilever.',
    texKind: 'venus', roughness: 0.44, metallic: 0.02,
  },
  {
    id: 'terra', name: 'Terra & Luna', kind: 'Oceanic Biosphere + Moon',
    radius: 0.168, orbitR: 1.68, collarY: 2.66, tiltDeg: 23.4,
    periodDays: 365, startAngle: 4.10, angularSpeed: 0.62, harmonicOrder: 3, spinSpeed: 1.85,
    desc: 'Blue oceans, polar ice caps, and its own geared secondary bridge carrying Luna on a 27.3-day synodic arc.',
    texKind: 'terra', roughness: 0.40, metallic: 0.04,
    moon: { id: 'luna', name: 'Luna', radius: 0.048, orbitR: 0.30, speed: 3.1 },
  },
  {
    id: 'mars', name: 'Mars', kind: 'Iron-Oxide Terrestrial',
    radius: 0.125, orbitR: 2.04, collarY: 2.26, tiltDeg: 25.2,
    periodDays: 687, startAngle: 5.50, angularSpeed: 0.42, harmonicOrder: 2, spinSpeed: 1.65,
    desc: 'Ferric highlands and dark basaltic plains paired with opposing brass counterweight along the mid spindle.',
    texKind: 'mars', roughness: 0.70, metallic: 0.02,
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'Ringed Gas Giant',
    radius: 0.238, orbitR: 2.58, collarY: 1.86, tiltDeg: 26.7,
    periodDays: 10759, startAngle: 1.05, angularSpeed: 0.24, harmonicOrder: 1, spinSpeed: 2.4,
    desc: 'Banded amber-ochre atmosphere encircled by double-sided ice rings etched with the Cassini division.',
    texKind: 'saturn', roughness: 0.44, metallic: 0.02,
    rings: { innerR: 0.30, outerR: 0.48 },
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'Ice Giant + Triton',
    radius: 0.188, orbitR: 3.26, collarY: 1.46, tiltDeg: 28.3,
    periodDays: 60190, startAngle: 3.15, angularSpeed: 0.145, harmonicOrder: 0.6, spinSpeed: 1.9,
    desc: 'Deep cerulean outer world skirting inside the inner brass colure sphere with retrograde satellite Triton.',
    texKind: 'neptune', roughness: 0.42, metallic: 0.04,
    moon: { id: 'triton', name: 'Triton', radius: 0.042, orbitR: 0.24, speed: -2.4 },
  },
];

export class AureliaOrrery {
  constructor(scene, canvas) {
    this.scene = scene;
    this.canvas = canvas;
    this.bodies = [];
    this.gears = [];
    this.pickMap = new Map();
    this.rings = {};
    this.simTime = 0;
    this.simDays = 0;
    this.playing = true;
    this.direction = 1;
    this.speed = 1;
    this.law = 'kepler';
    this.mood = 'midnight';
    this.build();
    this.applyMood('midnight');
    this.updateKinematics(0);
  }

  registerPick(node, meta) {
    if (node) this.pickMap.set(node.id, meta);
  }

  lookupPick(node) {
    return node ? (this.pickMap.get(node.id) || null) : null;
  }

  build() {
    const { scene } = this;
    const brass = makeBrushedBrass(256, { dark: false });
    const darkBrass = makeBrushedBrass(256, { dark: true });
    const engravedBrass = makeEngravedBrass(256);
    const slate = makeObsidianSlate(256, { roughnessBase: 0.50 });
    const plinthSlate = makeObsidianSlate(256, { roughnessBase: 0.30 });
    const dial = makeCompassDial(512);

    scene.setToneMap({ mode: 'aces', gamma: 2.2 });
    scene.setSSAO({ radius: 0.35, bias: 0.02, intensity: 0.75 });
    scene.setSSR({ enabled: true, maxDistance: 12, steps: 36, thickness: 0.25, intensity: 0.45, edgeFade: 0.16 });
    scene.setFXAA(true);

    // Circular honed dark basalt observatory gallery floor fading into starlight
    scene.createMesh({
      name: 'Observatory Floor',
      mesh: createFlatDisc(16.5, 96),
      position: [0, 0, 0],
      ...slate,
      receivesShadow: true,
      castsShadow: false,
    });
    scene.createMesh({
      name: 'Floor Brass Inlay',
      mesh: createBeveledRing(3.75, 3.85, 0.014, 0.005, 96),
      position: [0, 0.008, 0],
      ...darkBrass,
      castsShadow: false, receivesShadow: true,
    });

    // Stepped obsidian base plinth resting cleanly on floor (y = 0.002 .. 0.34)
    const plinthMesh = createLatheMesh([
      [0.01, 0.002], [2.46, 0.002], [2.46, 0.08], [2.32, 0.14], [2.22, 0.14],
      [2.22, 0.24], [2.08, 0.31], [2.02, 0.34], [0.01, 0.34],
    ], 72, 24);
    scene.createMesh({
      name: 'Obsidian Plinth',
      mesh: plinthMesh,
      ...plinthSlate,
      castsShadow: true, receivesShadow: true,
    });

    scene.createMesh({
      name: 'Plinth Trim Ring',
      mesh: createBeveledRing(2.33, 2.47, 0.040, 0.010, 72),
      position: [0, 0.105, 0],
      ...brass,
      castsShadow: true, receivesShadow: true,
    });
    scene.createMesh({
      name: 'Deck Molding',
      mesh: createBeveledRing(1.95, 2.09, 0.048, 0.012, 72),
      position: [0, 0.352, 0],
      ...brass,
      castsShadow: true, receivesShadow: true,
    });

    scene.createMesh({
      name: 'Compass Dial',
      mesh: createFlatDisc(1.94, 72),
      position: [0, 0.343, 0],
      ...dial,
      receivesShadow: true, castsShadow: false,
    });

    // Central turned brass arbor & sleeve bearings (y = 0.345 .. 4.10)
    const arborMesh = createLatheMesh([
      [0.01, 0.345], [0.40, 0.345], [0.40, 0.42], [0.30, 0.46],
      [0.23, 0.51], [0.23, 1.32], [0.19, 1.36], [0.19, 3.68],
      [0.14, 3.74], [0.11, 3.98], [0.17, 4.04], [0.14, 4.10], [0.01, 4.10],
    ], 48, 28);
    scene.createMesh({
      name: 'Central Arbor',
      mesh: arborMesh,
      ...brass,
      castsShadow: true, receivesShadow: true,
    });

    for (const p of PLANET_SPECS) {
      scene.createMesh({
        name: `${p.name} Collar`,
        mesh: createBeveledRing(0.195, 0.27, 0.088, 0.014, 40),
        position: [0, p.collarY, 0],
        ...darkBrass,
        castsShadow: true, receivesShadow: true,
      });
    }

    // Precision meshing spur-gear differential stack
    const gearConfigs = [
      { name: 'Sun Drive Wheel', teeth: 36, pitchR: 0.72, thick: 0.055, hole: 0.235, spokes: 6, pos: [0, 0.56, 0], ratio: 1.0, phase: 0, mat: brass },
      { name: 'Idler Pinion A', teeth: 18, pitchR: 0.36, thick: 0.055, hole: 0.07, spokes: 4, pos: [1.10, 0.56, 0], ratio: -2.0, phase: Math.PI / 18, mat: darkBrass },
      { name: 'Compound Transfer Gear', teeth: 30, pitchR: 0.60, thick: 0.050, hole: 0.07, spokes: 6, pos: [1.10, 0.74, 0], ratio: -2.0, phase: 0.06, mat: brass },
      { name: 'Inner Arbor Wheel', teeth: 24, pitchR: 0.48, thick: 0.050, hole: 0.235, spokes: 5, pos: [0, 0.74, 0], ratio: 2.5, phase: 0.13, mat: darkBrass },
      { name: 'Counter Pinion B', teeth: 20, pitchR: 0.40, thick: 0.050, hole: 0.07, spokes: 5, pos: [-0.90, 0.74, 0], ratio: -3.0, phase: Math.PI / 20, mat: brass },
      { name: 'Ecliptic Crown Gear', teeth: 28, pitchR: 0.52, thick: 0.048, hole: 0.235, spokes: 6, pos: [0, 0.94, 0], ratio: 0.6, phase: 0, mat: brass },
    ];
    for (const g of gearConfigs) {
      const node = scene.createMesh({
        name: g.name,
        mesh: createSpurGear(g.teeth, g.pitchR, g.thick, g.hole, g.spokes),
        position: g.pos,
        ...g.mat,
        castsShadow: true, receivesShadow: true,
      });
      node.rotationY = g.phase;
      this.gears.push({ node, ratio: g.ratio, phase: g.phase });
    }

    for (const [sx, topY] of [[1.10, 0.83], [-0.90, 0.82]]) {
      const post = createLatheMesh([
        [0.01, 0.345], [0.13, 0.345], [0.13, 0.40], [0.068, 0.43],
        [0.068, topY], [0.095, topY + 0.02], [0.04, topY + 0.06], [0.01, topY + 0.06],
      ], 24, 28);
      scene.createMesh({
        name: sx > 0 ? 'Transfer Spindle' : 'Counter Spindle',
        mesh: post,
        position: [sx, 0, 0],
        ...darkBrass,
        castsShadow: true, receivesShadow: true,
      });
    }

    // Four symmetric arched quadrant cradles supporting Horizon Ring (r = 4.39)
    const cradlePts = [];
    for (let i = 0; i <= 28; ++i) {
      const t = i / 28;
      const a = t * Math.PI * 0.5;
      const r = 1.98 + (4.39 - 1.98) * Math.sin(a * 0.96);
      const y = 0.36 + (SOLAR_Y - 0.32 - 0.36) * (1 - Math.cos(a * 1.04)) * 0.98;
      cradlePts.push([r, y, 0]);
    }
    const cradleMesh = createTubeAlongPoints(cradlePts, (t) => 0.055 - 0.015 * Math.sin(t * Math.PI * 0.7), 14, true);
    const pierShoeMesh = createLatheMesh([
      [0.01, 0.345], [0.105, 0.345], [0.105, 0.38], [0.068, 0.43], [0.01, 0.43],
    ], 20, 28);
    for (let q = 0; q < 4; ++q) {
      const ang = (q / 4) * Math.PI * 2 + Math.PI * 0.25;
      const cradle = scene.createMesh({
        name: `Meridian Cradle ${q + 1}`,
        mesh: cradleMesh,
        ...darkBrass,
        castsShadow: true, receivesShadow: true,
      });
      cradle.rotationY = ang;
      const shoe = scene.createMesh({
        name: `Pier Shoe ${q + 1}`,
        mesh: pierShoeMesh,
        position: [Math.cos(ang) * 1.98, 0, -Math.sin(ang) * 1.98],
        ...brass,
        castsShadow: true, receivesShadow: true,
      });
      shoe.rotationY = ang;
    }

    // Engraved Horizon Ring (fixed horizontal datum outside the nested armillary sphere)
    const horizonNode = scene.createMesh({
      name: 'Horizon Zodiac Ring',
      mesh: createBeveledRing(4.20, 4.58, 0.11, 0.022, 128),
      position: [0, SOLAR_Y - 0.28, 0],
      ...engravedBrass,
      castsShadow: true, receivesShadow: true,
    });
    scene.createMesh({
      name: 'Horizon Degree Ticks',
      mesh: createDegreeTicks(4.39, SOLAR_Y - 0.222, 0.09, 0.18, 72, 6),
      ...brass,
      castsShadow: true, receivesShadow: true,
    });
    this.registerPick(horizonNode, {
      id: 'horizon', name: 'Horizon Ring', kind: 'Armillary Datum',
      distLabel: 'R = 4.39 u', periodLabel: 'Fixed', tiltLabel: '0.0°',
      desc: 'Engraved bronze horizon datum calibrated with 72 azimuth divisions supported on four arched quadrants.',
    });

    // Nested Moving 3D Interlocking Armillary Spheres centered around Sol [0, SOLAR_Y, 0]
    this.armillaryRoot = scene.createNode({ name: 'Armillary Center', position: [0, SOLAR_Y, 0] });

    // Outer Vertical Prime Meridian Ring + North Polar Finial
    const meridianRing = scene.createMesh({
      name: 'Prime Meridian Ring',
      mesh: createBeveledRing(3.96, 4.10, 0.095, 0.018, 128),
      ...brass,
      castsShadow: true, receivesShadow: true,
    });
    meridianRing.rotationX = Math.PI * 0.5;
    const finialNode = scene.createMesh({
      name: 'Polar Finial',
      mesh: createLatheMesh([
        [0.01, 4.09], [0.11, 4.09], [0.09, 4.15], [0.04, 4.20],
        [0.06, 4.26], [0.02, 4.38], [0.004, 4.48],
      ], 24, 28),
      ...brass,
      castsShadow: true, receivesShadow: true,
    });
    this.meridianPivot = scene.createNode({ name: 'Meridian Pivot' });
    this.meridianPivot.rotationY = 0.42;
    this.meridianPivot.add(meridianRing);
    this.meridianPivot.add(finialNode);
    this.armillaryRoot.add(this.meridianPivot);
    this.registerPick(meridianRing, {
      id: 'meridian', name: 'Prime Meridian', kind: 'Precessing Brass Ring',
      distLabel: 'R = 4.03 u', periodLabel: 'Precessional', tiltLabel: '90.0°',
      desc: 'Vertical outer beveled brass meridian hoop crowned by a turned polar finial.',
    });

    // Tilted 23.4° Ecliptic Zodiac Band
    const eclipticRing = scene.createMesh({
      name: 'Ecliptic Zodiac Band',
      mesh: createBeveledRing(3.74, 3.92, 0.16, 0.022, 128),
      ...engravedBrass,
      castsShadow: true, receivesShadow: true,
    });
    eclipticRing.rotationX = 23.4 * DEG;
    eclipticRing.rotationZ = 0.14;
    this.eclipticPivot = scene.createNode({ name: 'Ecliptic Pivot' });
    this.eclipticPivot.add(eclipticRing);
    this.armillaryRoot.add(this.eclipticPivot);
    this.rings.ecliptic = eclipticRing;
    this.registerPick(eclipticRing, {
      id: 'ecliptic', name: 'Ecliptic Zodiac Band', kind: 'Oblique Armillary Band',
      distLabel: 'R = 3.83 u', periodLabel: 'Oblique 23.4°', tiltLabel: '23.4°',
      desc: 'Wide ruled brass ecliptic tilted 23.4° to the equatorial plane, marking the apparent solar path.',
    });

    // Orthogonal Inner Vertical Colure Ring (clear outside Neptune orbitR = 3.26 + Triton 0.24 = 3.50)
    const colureRing = scene.createMesh({
      name: 'Equinoctial Colure Ring',
      mesh: createBeveledRing(3.56, 3.68, 0.08, 0.015, 112),
      ...darkBrass,
      castsShadow: true, receivesShadow: true,
    });
    colureRing.rotationZ = Math.PI * 0.5;
    this.colurePivot = scene.createNode({ name: 'Colure Pivot' });
    this.colurePivot.rotationY = -0.35;
    this.colurePivot.add(colureRing);
    this.armillaryRoot.add(this.colurePivot);

    // Calibrated Central Solar Core + Corona Collars
    const solMesh = scene.createMesh({
      name: 'Sol',
      mesh: createSphereUV(0.41, 48, 32),
      position: [0, SOLAR_Y, 0],
      texture: makePlanetTexture('sol', 256, 128),
      color: '#ffcf70',
      emissive: 2.1,
      emissiveColor: [1.0, 0.64, 0.20],
      roughness: 0.85,
      metallic: 0.0,
      castsShadow: false, receivesShadow: false,
    });
    this.solNode = solMesh;
    this.registerPick(solMesh, {
      id: 'sol', name: 'Sol', kind: 'Central G-Type Star',
      distLabel: '0.00 AU', periodLabel: '25.4 d Spin', tiltLabel: '7.25°',
      desc: 'Radiant solar sphere illuminating all inner gears, curved brass arms, and outer planetary spheres from within.',
    });

    const coronaRingA = scene.createMesh({
      name: 'Solar Collar A',
      mesh: createBeveledRing(0.50, 0.55, 0.026, 0.008, 64),
      position: [0, SOLAR_Y, 0],
      ...brass,
      emissive: 0.35,
      emissiveColor: [1.0, 0.72, 0.30],
    });
    coronaRingA.rotationX = 0.38;
    coronaRingA.rotationZ = 0.24;
    const coronaRingB = scene.createMesh({
      name: 'Solar Collar B',
      mesh: createBeveledRing(0.57, 0.61, 0.020, 0.006, 64),
      position: [0, SOLAR_Y, 0],
      ...brass,
    });
    coronaRingB.rotationX = -0.44;
    coronaRingB.rotationY = 0.5;
    coronaRingB.rotationZ = -0.20;
    this.coronaRingA = coronaRingA;
    this.coronaRingB = coronaRingB;

    // Planetary Cantilevers, Counterweights, Planets & Moons
    const sphereUnit = createSphereUV(1, 44, 28);
    const saturnRingTex = makeSaturnRingTexture(256, 16);
    const saturnRingGeo = createRingDisk(0.30, 0.48, 96);

    for (const spec of PLANET_SPECS) {
      const armPivot = scene.createNode({ name: `${spec.name} Arm Pivot` });

      const seatY = SOLAR_Y - spec.radius - 0.045;
      const armGeo = createCantileverArm(0.24, spec.collarY, spec.orbitR, seatY, 0.023, 28);
      const armNode = scene.createMesh({
        name: `${spec.name} Arm`,
        mesh: armGeo,
        ...brass,
        castsShadow: true, receivesShadow: true,
      });
      armPivot.add(armNode);

      const counterR = Math.min(0.62, 0.30 + spec.orbitR * 0.09);
      const cwBar = scene.createMesh({
        name: `${spec.name} Counterweight Bar`,
        mesh: createTubeAlongPoints([[-0.22, spec.collarY, 0], [-counterR, spec.collarY + 0.03, 0]], 0.017, 10, true),
        ...darkBrass,
        castsShadow: true, receivesShadow: true,
      });
      const cwBall = scene.createMesh({
        name: `${spec.name} Counterweight`,
        mesh: sphereUnit,
        scale: [0.055, 0.055, 0.055],
        position: [-counterR, spec.collarY + 0.03, 0],
        ...brass,
        castsShadow: true, receivesShadow: true,
      });
      armPivot.add(cwBar);
      armPivot.add(cwBall);

      const tiltPivot = scene.createNode({
        name: `${spec.name} Tilt Pivot`,
        position: [spec.orbitR, SOLAR_Y, 0],
      });
      tiltPivot.rotationZ = spec.tiltDeg * DEG;
      armPivot.add(tiltPivot);

      const cup = scene.createMesh({
        name: `${spec.name} Seat Cup`,
        mesh: createBeveledRing(0.015, Math.min(0.06, spec.radius * 0.45), 0.024, 0.006, 24),
        position: [spec.orbitR, seatY + 0.03, 0],
        ...darkBrass,
        castsShadow: true, receivesShadow: true,
      });
      armPivot.add(cup);

      const planetMesh = scene.createMesh({
        name: spec.name,
        mesh: sphereUnit,
        scale: [spec.radius, spec.radius, spec.radius],
        texture: makePlanetTexture(spec.texKind, 256, 128),
        roughness: spec.roughness,
        metallic: spec.metallic,
        castsShadow: true, receivesShadow: true,
      });
      tiltPivot.add(planetMesh);
      this.registerPick(planetMesh, {
        id: spec.id,
        name: spec.name,
        kind: spec.kind,
        distLabel: `${spec.orbitR.toFixed(2)} u`,
        periodLabel: `${spec.periodDays} d`,
        tiltLabel: `${spec.tiltDeg}°`,
        desc: spec.desc,
        armPivot,
        worldTarget: () => planetMesh.worldPosition,
        spec,
      });

      if (spec.rings) {
        const ringsNode = scene.createMesh({
          name: `${spec.name} Rings`,
          mesh: saturnRingGeo,
          texture: saturnRingTex,
          alphaCutoff: 0.20,
          twoSided: true,
          roughness: 0.40,
          metallic: 0.04,
          subsurface: 0.50,
          emissive: 0.08,
          emissiveColor: [0.96, 0.86, 0.66],
          castsShadow: true, receivesShadow: true,
        });
        tiltPivot.add(ringsNode);
      }

      let moonEntry = null;
      if (spec.moon) {
        const m = spec.moon;
        const moonPivot = scene.createNode({
          name: `${m.name} Orbit`,
          position: [spec.orbitR, SOLAR_Y, 0],
        });
        moonPivot.rotationX = 0.09;
        moonPivot.rotationZ = 0.05;
        armPivot.add(moonPivot);
        const moonBridge = scene.createMesh({
          name: `${m.name} Arm`,
          mesh: createTubeAlongPoints([[0, -spec.radius * 0.72, 0], [m.orbitR, -m.radius * 0.4, 0]], 0.009, 8, true),
          ...brass,
          castsShadow: true, receivesShadow: true,
        });
        const moonMesh = scene.createMesh({
          name: m.name,
          mesh: sphereUnit,
          position: [m.orbitR, 0, 0],
          scale: [m.radius, m.radius, m.radius],
          texture: makePlanetTexture(m.id === 'luna' ? 'luna' : 'neptune', 128, 64),
          roughness: 0.76,
          metallic: 0.04,
          castsShadow: true, receivesShadow: true,
        });
        moonPivot.add(moonBridge);
        moonPivot.add(moonMesh);
        this.registerPick(moonMesh, {
          id: m.id,
          name: m.name,
          kind: `Satellite of ${spec.name}`,
          distLabel: `${m.orbitR.toFixed(2)} u`,
          periodLabel: m.id === 'luna' ? '27.3 d' : '5.9 d',
          tiltLabel: '6.7°',
          desc: `Sub-geared brass moon arm circling ${spec.name}.`,
          worldTarget: () => moonMesh.worldPosition,
        });
        moonEntry = { pivot: moonPivot, speed: m.speed };
      }

      this.bodies.push({
        spec,
        armPivot,
        tiltPivot,
        planetMesh,
        moon: moonEntry,
        angle: spec.startAngle,
      });
    }

    // Studio & Solar Lights
    this.sunLight = scene.createLight({
      name: 'Sol Core Light',
      type: 'point',
      position: [0, SOLAR_Y, 0],
      color: [1.0, 0.85, 0.54],
      intensity: 14,
      range: 24,
      castsShadow: true,
    });
    this.keyLight = scene.createLight({
      name: 'Gallery Key',
      type: 'directional',
      position: [6, 9, 7],
      direction: [-0.55, -0.78, -0.58],
      color: [1.0, 0.91, 0.76],
      intensity: 3.1,
      castsShadow: true,
      shadowBias: 0.0005,
    });
    this.rimLight = scene.createLight({
      name: 'Observatory Rim',
      type: 'directional',
      position: [-6, 5, -7],
      direction: [0.58, -0.45, 0.65],
      color: [0.40, 0.64, 0.98],
      intensity: 1.85,
      castsShadow: false,
    });
    this.gearFill = scene.createLight({
      name: 'Clockwork Lamp',
      type: 'point',
      position: [1.85, 1.35, 1.85],
      color: [1.0, 0.86, 0.64],
      intensity: 4.0,
      range: 6.5,
      castsShadow: false,
    });

    this.motes = scene.createParticles3D({
      name: 'Observatory Motes',
      maxParticles: 64,
      rate: 5,
      blend: 'additive',
      position: [0, 2.2, 0],
      velocity: { angleSpread: 360, speed: 0.08, speedSpread: 0.05 },
      size: { start: 0.025, end: 0.005 },
      color: { start: [1.0, 0.86, 0.52, 0.30], end: [1.0, 0.86, 0.52, 0.0] },
      lifetime: { min: 4.0, max: 8.0 },
    });
  }

  applyMood(name) {
    const m = MOOD_PRESETS[name] || MOOD_PRESETS.midnight;
    this.mood = name;
    const { scene } = this;
    this.canvas.style.background = m.bg;
    scene.setAmbient(m.ambient);
    scene.setFog({ mode: 'linear', color: m.fogColor, start: 11.5, end: 19.5 });
    scene.setExposure({ mode: 'fixed', ev: m.exposure });
    scene.setBloom(m.bloom);
    scene.setStarfield({ starCount: m.stars, starSize: 0.9 });
    this.sunLight.color = m.sunLightColor;
    this.sunLight.intensity = m.sunLightIntensity;
    this.keyLight.color = m.keyColor;
    this.keyLight.intensity = m.keyIntensity;
    this.rimLight.color = m.rimColor;
    this.rimLight.intensity = m.rimIntensity;
    return m;
  }

  updateKinematics(dt) {
    if (!this.playing && dt !== 0) return;
    const step = dt * this.speed * this.direction;
    this.simTime += step;
    this.simDays += step * 24.0;

    this.solNode.rotationY = this.simTime * 0.25;
    this.coronaRingA.rotationY = this.simTime * 0.34;
    this.coronaRingB.rotationY = 0.5 - this.simTime * 0.28;

    this.meridianPivot.rotationY = 0.42 + this.simTime * 0.07;
    this.eclipticPivot.rotationY = -this.simTime * 0.045;
    this.colurePivot.rotationX = Math.sin(this.simTime * 0.16) * 0.10;
    this.colurePivot.rotationY = -0.35 + this.simTime * 0.085;

    const driveTheta = this.simTime * 1.10;
    for (const g of this.gears) {
      g.node.rotationY = driveTheta * g.ratio + g.phase;
    }

    for (const b of this.bodies) {
      const rate = this.law === 'kepler' ? b.spec.angularSpeed : b.spec.harmonicOrder * 0.32;
      b.angle = b.spec.startAngle + this.simTime * rate;
      b.armPivot.rotationY = b.angle;
      b.planetMesh.rotationY = this.simTime * b.spec.spinSpeed;
      if (b.moon) {
        b.moon.pivot.rotationY = this.simTime * b.moon.speed;
      }
    }
  }

  bodyLongitudeDeg(id) {
    const b = this.bodies.find((x) => x.spec.id === id);
    if (!b) return null;
    const deg = ((b.angle * 180) / Math.PI) % 360;
    return ((deg + 360) % 360).toFixed(1) + '°';
  }
}
