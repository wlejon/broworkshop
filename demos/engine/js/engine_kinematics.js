// js/engine_kinematics.js — Exact analytical crank-slider, gear train, cam, & Watt governor solver.

import { CONSTANTS } from './engine_build.js';

export const VIEW_PRESETS = {
  gallery:  { target: [-0.25, 1.48, 0.0], dist: 8.8, yaw: 0.56, pitch: -0.34, fov: 42 },
  crank:    { target: [0.75, 1.48, 0.82], dist: 3.85, yaw: 0.42, pitch: -0.26, fov: 40 },
  gears:    { target: [1.02, 1.88, 1.65], dist: 3.15, yaw: 0.22, pitch: -0.22, fov: 40 },
  governor: { target: [1.55, 2.24, -1.65], dist: 3.20, yaw: -2.42, pitch: -0.24, fov: 40 },
};

export const MOOD_PRESETS = {
  atelier: {
    label: 'Atelier',
    bg: '#0e131b',
    ambient: [0.11, 0.125, 0.155],
    keyColor: [1.0, 0.94, 0.84],
    keyIntensity: 3.8,
    rimColor: [0.55, 0.78, 1.0],
    rimIntensity: 2.6,
    fillColor: [1.0, 0.90, 0.74],
    fillIntensity: 8.5,
    exposure: 0.24,
    bloom: { threshold: 1.24, intensity: 0.20, radius: 0.75 },
  },
  foundry: {
    label: 'Foundry',
    bg: '#160b07',
    ambient: [0.095, 0.065, 0.052],
    keyColor: [1.0, 0.78, 0.48],
    keyIntensity: 4.1,
    rimColor: [0.46, 0.66, 0.96],
    rimIntensity: 1.9,
    fillColor: [1.0, 0.74, 0.40],
    fillIntensity: 9.5,
    exposure: 0.18,
    bloom: { threshold: 1.15, intensity: 0.28, radius: 0.82 },
  },
  drafting: {
    label: 'Drafting',
    bg: '#131d2a',
    ambient: [0.15, 0.17, 0.20],
    keyColor: [0.96, 0.97, 1.0],
    keyIntensity: 4.2,
    rimColor: [0.70, 0.88, 1.0],
    rimIntensity: 2.5,
    fillColor: [0.92, 0.95, 1.0],
    fillIntensity: 7.2,
    exposure: 0.30,
    bloom: { threshold: 1.35, intensity: 0.14, radius: 0.65 },
  },
};

export class EngineController {
  constructor(rig, scene, canvas) {
    this.rig = rig;
    this.scene = scene;
    this.canvas = canvas;
    this.theta = 0.45;
    this.playing = true;
    this.direction = 1;
    this.throttle = 0.68;
    this.rpmSmooth = 0.68 * 120.0;
    this.cutaway = true;
    this.mood = 'atelier';
    this.govLift = 0.24;
    this.pistonOffsetMm = 0;
    this.applyMood('atelier');
    this.applyState();
  }

  applyMood(name) {
    const m = MOOD_PRESETS[name] || MOOD_PRESETS.atelier;
    this.mood = name;
    this.canvas.style.background = m.bg;
    this.scene.setAmbient(m.ambient);
    this.scene.setFog({ mode: 'linear', color: [0.03, 0.04, 0.055], start: 13, end: 26 });
    this.scene.setExposure({ mode: 'fixed', ev: m.exposure });
    this.scene.setBloom(m.bloom);
    const l = this.rig.lights;
    l.key.color = m.keyColor;
    l.key.intensity = m.keyIntensity;
    l.rim.color = m.rimColor;
    l.rim.intensity = m.rimIntensity;
    l.fill.color = m.fillColor;
    l.fill.intensity = m.fillIntensity;
    return m;
  }

  setCutaway(enabled) {
    this.cutaway = Boolean(enabled);
    for (const c of this.rig.cutaways) {
      c.cutCy.visible = this.cutaway;
      c.fullCy.visible = !this.cutaway;
      if (c.headSteam) c.headSteam.visible = this.cutaway;
      if (c.crankSteam) c.crankSteam.visible = this.cutaway;
      if (c.dValve) c.dValve.visible = this.cutaway;
    }
  }

  /** Deterministically set crank angle (radians) & normalized speed `rpmNorm` (0..1). */
  setPose(thetaRad, rpmNorm = this.throttle) {
    this.theta = thetaRad;
    this.rpmSmooth = Math.max(0, Math.min(1, rpmNorm)) * 120.0;
    this.applyState();
  }

  step(dt) {
    const targetRpm = this.playing ? (this.throttle * 120.0) : 0.0;
    // Flywheel rotational inertia smooths RPM transitions without discontinuous jumps
    const k = 1 - Math.exp(-dt * 4.5);
    this.rpmSmooth += (targetRpm - this.rpmSmooth) * k;
    const omega = (this.rpmSmooth / 60.0) * Math.PI * 2.0 * this.direction;
    if (this.playing) this.theta += omega * dt;
    this.applyState();
  }

  applyState() {
    const rig = this.rig;
    const th = this.theta;
    rig.crankPivot.rotationZ = th;

    // 1. Exact analytical crank-slider kinematics for twin 90-deg banks
    for (const b of rig.banks) {
      const ang = th + b.phase;
      const cx = CONSTANTS.CRANK_X + CONSTANTS.CRANK_R * Math.cos(ang);
      const cy = CONSTANTS.SHAFT_Y + CONSTANTS.CRANK_R * Math.sin(ang);
      const dy = cy - CONSTANTS.SHAFT_Y;
      const horiz = Math.sqrt(Math.max(0.0001, CONSTANTS.ROD_L * CONSTANTS.ROD_L - dy * dy));
      const xCH = cx - horiz;
      const xP = xCH - 1.98;
      if (b.bi === 0) this.pistonOffsetMm = (xP + 2.08) * 100.0;

      b.pistonAssembly.setPosition(xP, CONSTANTS.SHAFT_Y, b.zC);
      b.conRod.setPosition(cx, cy, b.zC);
      b.conRod.rotationZ = Math.atan2(dy, cx - xCH);

      // Active internal cutaway thermodynamics: chamber length + pressure vs exhaust glow + D-valve quadrature
      const headLen = Math.max(0.04, (xP - 0.145) - (-2.77));
      const crankStart = xP + 0.145;
      const crankLen = Math.max(0.04, -1.39 - crankStart);
      b.headSteam.setPosition(-2.77, CONSTANTS.SHAFT_Y, b.zC);
      b.headSteam.setScale(headLen, 1, 1);
      b.crankSteam.setPosition(crankStart, CONSTANTS.SHAFT_Y, b.zC);
      b.crankSteam.setScale(crankLen, 1, 1);

      const pressHead = 0.5 + 0.5 * Math.sin(ang);
      const pressCrank = 1.0 - pressHead;
      const mixCol = (p) => [0.28 + 0.72 * p, 0.45 + 0.34 * p, 0.85 - 0.58 * p];
      b.headSteam.color = mixCol(pressHead);
      b.headSteam.emissiveColor = mixCol(pressHead);
      b.headSteam.emissive = 0.08 + 0.46 * pressHead;
      b.crankSteam.color = mixCol(pressCrank);
      b.crankSteam.emissiveColor = mixCol(pressCrank);
      b.crankSteam.emissive = 0.08 + 0.46 * pressCrank;
      b.dValve.setPosition(-2.08 + 0.16 * Math.sin(ang), 1.94, b.zC);
    }

    // 2. Meshed 5-gear front involute spur train
    for (const g of rig.gears) {
      g.node.rotationZ = th * g.ratio + g.phase;
    }

    // 3. Overhead camshaft (1:3 speed), valve springs seated flush on tappet disc up to overhead bridge + Lubricator Pump
    const camAngle = th / 3.0;
    rig.camShaftPivot.rotationZ = camAngle;
    for (const cu of rig.camUnits) {
      const camRot = camAngle + cu.phase;
      let camTop = 0.11;
      for (let s = -10; s <= 10; ++s) {
        const phi = s * 0.10;
        const a = Math.PI * 0.5 + phi - camRot;
        const r = 0.11 + 0.095 * Math.pow(Math.max(0, Math.cos(a)), 2.2);
        const yUp = r * Math.cos(phi);
        if (yUp > camTop) camTop = yUp;
      }
      const footY = CONSTANTS.CAM_Y + camTop + 0.007;
      cu.fNode.setPosition(CONSTANTS.CAM_X, footY, cu.fNode.position[2]);
      const baseH = 0.26;
      const topAnchor = CONSTANTS.CAM_Y + 0.568;
      const springBottom = footY + 0.140;
      const curH = Math.max(0.06, topAnchor - springBottom);
      cu.spNode.setScale(1, curH / baseH, 1);
      cu.spNode.setPosition(CONSTANTS.CAM_X, springBottom, cu.spNode.position[2]);
    }

    // Auxiliary lubricator pump driven by eccentric crankpin on G5 (ratio -1.5)
    const g5Theta = th * rig.gears[4].ratio + rig.gears[4].phase;
    const eccR = 0.11;
    const ex = CONSTANTS.G5_POS[0] + eccR * Math.cos(g5Theta);
    const ey = CONSTANTS.G5_POS[1] + eccR * Math.sin(g5Theta);
    const dxL = ex - 2.30;
    const pyBot = ey - Math.sqrt(Math.max(0.01, 0.56 * 0.56 - dxL * dxL));
    rig.g5EccPin.setPosition(ex, ey, 0);
    rig.pumpPlunger.setPosition(2.30, pyBot, 1.82);
    rig.pumpRod.setPosition(ex, ey, 1.77);
    rig.pumpRod.rotationZ = Math.atan2(ey - pyBot, dxL);

    // 4. Bevel-driven Watt centrifugal flyball governor (non-intersecting scissored linkage)
    rig.govSpinPivot.rotationY = th;
    const rpmNorm = Math.min(1, Math.max(0, this.rpmSmooth / 120.0));
    const spread = 0.18 + 0.50 * Math.pow(rpmNorm, 1.35);
    const armLen = 0.50;
    const elbowY = 1.92 - armLen * 0.52 * Math.cos(spread);
    const collarY = 1.05 + 0.34 * rpmNorm;
    this.govLift = (collarY - 1.05) * 100.0;
    rig.govCollar.setPosition(0, collarY, 0);

    for (const a of rig.govArms) {
      a.armPivot.rotationZ = a.sign * spread;
    }
    for (const l of rig.govLinks) {
      const targetX = l.sign * (0.084 + armLen * 0.52 * Math.sin(spread));
      const startX = l.sign * 0.104;
      const startY = collarY + 0.025;
      const dx = targetX - startX;
      const dy = elbowY - startY;
      const dist = Math.hypot(dx, dy);
      l.linkRod.setPosition(startX, startY, 0);
      l.linkRod.setScale(1, Math.max(0.20, (dist - 0.060) / 0.40), 1);
      l.linkRod.rotationZ = -Math.atan2(dx, dy);
    }

    // External brass governor reach rod raises/lowers subtly outside flyball envelope
    rig.govReachRod.setPosition(0, (collarY - 1.24) * 0.25, 0);

    // 5. Calibrated analog dial needles (-135 deg .. +135 deg -> Z rotation = +135 deg -> -135 deg)
    const sweep = Math.PI * 1.5;
    rig.gaugeNeedles[0].rotationZ = Math.PI * 0.75 - rpmNorm * sweep;
    const steamFrac = this.playing ? (0.12 + 0.80 * this.throttle) : 0.10;
    rig.gaugeNeedles[1].rotationZ = Math.PI * 0.75 - steamFrac * sweep;
  }
}
