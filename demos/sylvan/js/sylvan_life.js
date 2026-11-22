// js/sylvan_life.js — Ecosystem moods (2K HDRI skies), shader uniform animation & smooth swimming.

import { skyEnvironment } from '/lib/kit/sky.js';

export const VIEW_PRESETS = {
  sanctuary: { target: [-0.08, 0.72, 0.05], dist: 7.2, fov: 42, yaw: 0.48, pitch: -0.44 },
  cascade:   { target: [0.72, 0.56, -1.08], dist: 3.3, fov: 40, yaw: 0.28, pitch: -0.28 },
  pond:      { target: [0.02, 0.02, 0.24], dist: 3.8, fov: 42, yaw: 0.34, pitch: -0.58 },
  canopy:    { target: [-1.06, 1.56, -0.58], dist: 4.4, fov: 42, yaw: 0.56, pitch: -0.26 },
};

export const MOOD_PRESETS = {
  mist: {
    label: 'Morning Mist',
    hdri: 'kloofendal_43d_clear_puresky',
    envIntensity: 0.48,
    envRotation: 0.6,
    bg: '#0c1618',
    ambient: [0.05, 0.08, 0.08],
    fogColor: [0.05, 0.09, 0.10],
    keyColor: [1.0, 0.96, 0.88],
    keyIntensity: 3.1,
    rimColor: [0.58, 0.84, 1.0],
    rimIntensity: 1.5,
    fillColor: [0.74, 0.94, 0.96],
    fillIntensity: 2.4,
    lanternIntensity: 2.0,
    fireflyRate: 6,
    sunBoost: 1.0,
    exposure: 0.42,
    bloom: { threshold: 1.22, intensity: 0.18, radius: 0.68 },
  },
  sunbeam: {
    label: 'Golden Sunbeam',
    hdri: 'belfast_sunset_puresky',
    envIntensity: 0.56,
    envRotation: 1.2,
    bg: '#16120c',
    ambient: [0.06, 0.05, 0.04],
    fogColor: [0.09, 0.07, 0.05],
    keyColor: [1.0, 0.84, 0.54],
    keyIntensity: 3.8,
    rimColor: [1.0, 0.70, 0.40],
    rimIntensity: 1.4,
    fillColor: [0.96, 0.84, 0.62],
    fillIntensity: 2.8,
    lanternIntensity: 2.4,
    fireflyRate: 8,
    sunBoost: 1.35,
    exposure: 0.46,
    bloom: { threshold: 1.15, intensity: 0.22, radius: 0.72 },
  },
  dusk: {
    label: 'Firefly Dusk',
    hdri: 'dikhololo_night',
    envIntensity: 0.42,
    envRotation: 0.2,
    bg: '#080e1c',
    ambient: [0.04, 0.06, 0.10],
    fogColor: [0.03, 0.05, 0.10],
    keyColor: [0.52, 0.70, 1.0],
    keyIntensity: 1.6,
    rimColor: [0.42, 0.74, 0.96],
    rimIntensity: 1.8,
    fillColor: [0.46, 0.68, 0.95],
    fillIntensity: 2.0,
    lanternIntensity: 4.8,
    fireflyRate: 24,
    sunBoost: 0.55,
    exposure: 0.34,
    bloom: { threshold: 0.96, intensity: 0.32, radius: 0.76 },
  },
};

export class SylvanController {
  constructor(rig, scene, canvas) {
    this.rig = rig;
    this.scene = scene;
    this.canvas = canvas;
    this.time = 0.0;
    this.playing = true;
    this.breeze = 0.52;
    this.breezeSmooth = 0.52;
    this.mood = 'mist';
    this.applyMood('mist');
    this.applyState();
  }

  applyMood(name) {
    const m = MOOD_PRESETS[name] || MOOD_PRESETS.mist;
    this.mood = name;
    this.canvas.style.background = m.bg;
    skyEnvironment(this.scene, {
      hdri: m.hdri, intensity: m.envIntensity, rotation: m.envRotation, fallbackAmbient: m.ambient,
    });
    this.scene.setFog({ mode: 'linear', color: m.fogColor, start: 12, end: 26 });
    this.scene.setExposure({ mode: 'fixed', ev: m.exposure });
    this.scene.setBloom(m.bloom);
    const l = this.rig.lights;
    l.key.color = m.keyColor;
    l.key.intensity = m.keyIntensity;
    l.rim.color = m.rimColor;
    l.rim.intensity = m.rimIntensity;
    l.poolFill.color = m.fillColor;
    l.poolFill.intensity = m.fillIntensity;
    l.lanternLight.intensity = m.lanternIntensity;
    this.rig.lanternEmber.emissive = 1.2 + m.lanternIntensity * 0.45;
    if (this.rig.fireflyParticles) this.rig.fireflyParticles.rate = m.fireflyRate;
    for (const rn of this.rig.rockNodes) rn.node.setShaderUniform('sunBoost', m.sunBoost);
    return m;
  }

  /** Deterministically set cyclic phase (`0..1`) & breeze (`0..1`) for verification. */
  setPose(phaseNorm, breezeVal = this.breeze) {
    this.time = phaseNorm * Math.PI * 2.0 * 4.0;
    this.breeze = Math.max(0, Math.min(1, breezeVal));
    this.breezeSmooth = this.breeze;
    this.applyState();
  }

  step(dt) {
    const k = 1 - Math.exp(-dt * 4.0);
    this.breezeSmooth += (this.breeze - this.breezeSmooth) * k;
    if (this.playing) this.time += dt * 1.15;
    this.applyState();
  }

  applyState() {
    const rig = this.rig;
    const t = this.time;
    const br = this.breezeSmooth;

    // 1. Living translucent water waves, waterfalls & underwater caustic time
    rig.pondWater.setShaderUniform('time', t);
    rig.pondWater.setShaderUniform('breeze', br);
    rig.fallMain.setShaderUniform('time', t);
    rig.fallSide.setShaderUniform('time', t);
    for (const rn of rig.rockNodes) rn.node.setShaderUniform('time', t);

    // 2. Five single-mesh bending Koi gliding gracefully inside clear pond water
    for (const k of rig.koiList) {
      const u = k.phase + t * 0.42 * k.dir;
      const px = -0.04 + Math.cos(u) * k.rx;
      const pz = 0.16 + Math.sin(u) * k.rz;
      const dx = -Math.sin(u) * k.rx * k.dir;
      const dz = Math.cos(u) * k.rz * k.dir;
      const yaw = Math.atan2(-dz, dx);
      const bob = Math.sin(t * 2.0 + k.phase) * 0.005;
      k.node.setPosition(px, k.y + bob, pz);
      k.node.rotationY = yaw;
      k.node.setShaderUniform('time', t);
      k.node.setShaderUniform('swimPhase', t * 5.6 + k.phase * 2.0);
    }

    // 3. Synchronized GPU wind sway across rooted maple wood, palmate leaves, ferns & sedge clumps
    for (const pn of rig.plantNodes) {
      pn.setShaderUniform('time', t);
      pn.setShaderUniform('breeze', br);
    }
    rig.mapleTree.trunkNode.setShaderUniform('time', t);
    rig.mapleTree.trunkNode.setShaderUniform('breeze', br);
    rig.mapleTree.leavesNode.setShaderUniform('time', t);
    rig.mapleTree.leavesNode.setShaderUniform('breeze', br);

    // 4. Water lily gentle ripple rock on water surface
    for (const lg of rig.lilyGroups) {
      lg.padPivot.rotationZ = Math.sin(t * 1.4 + lg.phase) * 0.015 * (0.4 + 0.6 * br);
      lg.padPivot.rotationX = Math.cos(t * 1.1 + lg.phase) * 0.014 * (0.4 + 0.6 * br);
    }

    // 5. Dragonfly figure-8 aerial patrol over open south-east pond basin (clear of maple canopy)
    for (const df of rig.dragonflies) {
      const u = t * 0.55 + df.phase;
      const x = df.cx + Math.sin(u) * df.radX;
      const z = df.cz + Math.sin(u * 2.0) * (df.radZ * 0.52);
      const y = df.height + Math.sin(t * 2.1 + df.phase) * 0.05;
      const vx = Math.cos(u) * df.radX;
      const vz = Math.cos(u * 2.0) * df.radZ * 1.04;
      df.piv.setPosition(x, y, z);
      df.piv.rotationY = Math.atan2(-vz, vx);
      const flap = Math.sin(t * 24.0 + df.phase) * 0.40;
      df.wL.rotationX = flap;
      df.wR.rotationX = -flap;
    }

    // 6. Helical drifting palmate crimson leaves cleanly between pond surface & lower boughs
    for (const dl of rig.driftingLeaves) {
      const cyc = ((t * 0.08 + dl.phase) % 1 + 1) % 1;
      const y = 0.72 - cyc * 0.50;
      const x = dl.bx + Math.sin(t * 1.1 + dl.phase * 6.28) * 0.22 * (0.3 + br);
      const z = dl.bz + Math.cos(t * 0.95 + dl.phase * 6.28) * 0.20 * (0.3 + br);
      dl.node.setPosition(x, y, z);
      dl.node.rotationY = t * 0.8 + dl.phase * 12;
      dl.node.rotationX = Math.sin(t * 2.0 + dl.phase * 9) * 0.45;
    }
  }
}
