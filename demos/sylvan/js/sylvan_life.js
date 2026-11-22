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
    fireflyRate: 0,
    sunBoost: 1.0,
    exposure: 0.40,
    bloom: { enabled: false },
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
    fireflyRate: 2,
    sunBoost: 1.35,
    exposure: 0.44,
    bloom: { enabled: false },
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
    bloom: { enabled: true, threshold: 1.55, intensity: 0.24, radius: 0.65 },
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

    // 1. Living translucent water waves, rock trickles & underwater caustic time
    rig.pondWater.setShaderUniform('time', t);
    rig.pondWater.setShaderUniform('breeze', br);
    rig.fallMain.setShaderUniform('time', t);
    if (rig.fallMid) rig.fallMid.setShaderUniform('time', t);
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

    // 6. C1-continuous twig-to-pond lifecycle: soft deceleration, zero XZ/yaw/scale magnet snap at touchdown
    const repelPads = (px, pz) => {
      for (let pass = 0; pass < 2; ++pass) {
        for (const [cx, cz, rad] of rig.lilyPads || []) {
          const dx = px - cx, dz = pz - cz;
          const d = Math.hypot(dx, dz);
          const minD = rad + 0.16;
          if (d < minD) {
            const s = d > 1e-4 ? (minD / d) : 1.0;
            px = cx + (d > 1e-4 ? dx * s : minD);
            pz = cz + (d > 1e-4 ? dz * s : 0.0);
          }
        }
      }
      const r = Math.hypot(px, pz);
      if (r > 1.50) { px *= 1.50 / r; pz *= 1.50 / r; }
      return [px, pz];
    };
    for (const dl of rig.driftingLeaves) {
      const cyc = ((t * 0.045 + dl.phase) % 1 + 1) % 1;
      const [landX, landZ] = repelPads(dl.lx, dl.lz);
      const yawAtTouch = dl.phase * 12.0 + 1.8;
      if (cyc < 0.36) {
        const f = cyc / 0.36;
        const ease = f * f * (3.0 - 2.0 * f);
        const env = Math.sin(f * Math.PI);
        const swayX = Math.sin(f * Math.PI * 3.0) * env * 0.13 * (0.4 + 0.6 * br);
        const swayZ = Math.sin(f * Math.PI * 2.0) * env * 0.07 * (0.4 + 0.6 * br);
        const [x, z] = repelPads(dl.sx + (landX - dl.sx) * ease + swayX, dl.sz + (landZ - dl.sz) * ease + swayZ);
        // C1 zero-velocity twig departure & feather-soft water kiss (dy/dt = 0 at f=0 and f=1)
        const fallArc = 0.5 + 0.5 * Math.cos(f * Math.PI);
        const y = 0.006 + (dl.sy - 0.006) * fallArc;
        dl.node.setPosition(x, y, z);
        dl.node.scale = [1.0, 1.0, 1.0];
        dl.node.rotationY = dl.phase * 12.0 + 1.8 * ease;
        dl.node.rotationX = Math.sin(f * 9.0 + dl.phase * 8.0) * 0.40 * env;
        dl.node.rotationZ = Math.cos(f * 7.0 + dl.phase * 6.0) * 0.26 * env;
      } else if (cyc < 0.90) {
        const u = (cyc - 0.36) / 0.54;
        const curX = -0.34 * u + Math.sin(u * Math.PI * 2.0) * 0.04 * Math.cos(dl.phase * 6.0);
        const curZ = 0.46 * u + Math.sin(u * Math.PI * 2.0) * 0.03 * Math.sin(dl.phase * 5.0);
        const [px, pz] = repelPads(landX + curX, landZ + curZ);
        const waveBob = Math.sin(px * 6.8 + pz * 4.8 + t * 2.2) * 0.0018 * Math.min(1.0, u * 6.0);
        dl.node.setPosition(px, 0.006 + waveBob, pz);
        dl.node.scale = [1.0, 1.0, 1.0];
        dl.node.rotationY = yawAtTouch + u * 1.4;
        dl.node.rotationX = 0.0;
        dl.node.rotationZ = 0.0;
      } else {
        const u = (cyc - 0.90) / 0.10;
        const [px, pz] = repelPads(landX - 0.34, landZ + 0.46);
        dl.node.setPosition(px, 0.006 - u * 0.045, pz);
        const s = 1.0 - u * 0.90;
        dl.node.scale = [s, s, s];
        dl.node.rotationY = yawAtTouch + 1.4;
        dl.node.rotationX = 0.0;
        dl.node.rotationZ = 0.0;
      }
    }
  }
}
