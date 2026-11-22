// js/mill_life.js — Three HDRI moods, wheel/gear kinematics, water shaders, smoke, spray & C1 leaves.

import { skyEnvironment } from '/lib/kit/sky.js';

export const VIEW_PRESETS = {
  valley: { target: [-0.25, 0.95, 0.15], dist: 11.4, fov: 42, yaw: 0.46, pitch: -0.44 },
  wheel:  { target: [-0.45, 0.88, -0.85], dist: 4.0, fov: 40, yaw: 0.58, pitch: -0.24 },
  gears:  { target: [0.78, 0.78, -0.58], dist: 2.35, fov: 40, yaw: -0.78, pitch: -0.22 },
  pond:   { target: [-0.95, 0.10, 2.35], dist: 5.4, fov: 42, yaw: 0.40, pitch: -0.50 },
  bridge: { target: [-0.45, 0.55, 0.88], dist: 4.5, fov: 42, yaw: 0.35, pitch: -0.28 },
};

export const MOOD_PRESETS = {
  morning: {
    label: 'Alpine Morning',
    hdri: 'kloofendal_43d_clear_puresky',
    envIntensity: 0.52,
    envRotation: 0.5,
    bg: '#0c161e',
    ambient: [0.05, 0.08, 0.10],
    fogColor: [0.06, 0.09, 0.12],
    keyColor: [1.0, 0.96, 0.88],
    keyIntensity: 3.3,
    rimColor: [0.64, 0.86, 1.0],
    rimIntensity: 1.15,
    lanternIntensity: 1.2,
    windowEmissive: 0.25,
    fireflyRate: 0,
    sunBoost: 1.0,
    exposure: 0.38,
    bloom: { enabled: false },
  },
  harvest: {
    label: 'Golden Harvest',
    hdri: 'belfast_sunset_puresky',
    envIntensity: 0.58,
    envRotation: 1.15,
    bg: '#16110c',
    ambient: [0.06, 0.05, 0.04],
    fogColor: [0.10, 0.07, 0.05],
    keyColor: [1.0, 0.82, 0.52],
    keyIntensity: 3.8,
    rimColor: [1.0, 0.68, 0.38],
    rimIntensity: 1.4,
    lanternIntensity: 2.2,
    windowEmissive: 0.65,
    fireflyRate: 4,
    sunBoost: 1.25,
    exposure: 0.42,
    bloom: { enabled: false },
  },
  twilight: {
    label: 'Lantern Twilight',
    hdri: 'dikhololo_night',
    envIntensity: 0.44,
    envRotation: 0.2,
    bg: '#070d1a',
    ambient: [0.04, 0.06, 0.10],
    fogColor: [0.03, 0.05, 0.10],
    keyColor: [0.54, 0.72, 1.0],
    keyIntensity: 1.7,
    rimColor: [0.46, 0.76, 0.98],
    rimIntensity: 1.25,
    lanternIntensity: 5.5,
    windowEmissive: 2.4,
    fireflyRate: 28,
    sunBoost: 0.5,
    exposure: 0.36,
    bloom: { enabled: true, threshold: 1.55, intensity: 0.24, radius: 0.64 },
  },
};

export class MillraceController {
  constructor(rig, scene, canvas) {
    this.rig = rig;
    this.scene = scene;
    this.canvas = canvas;
    this.time = 0.0;
    this.wheelAngle = 0.0;
    this.playing = true;
    this.flow = 0.76;
    this.flowSmooth = 0.76;
    this.breeze = 0.48;
    this.breezeSmooth = 0.48;
    this.mood = 'morning';
    this.applyMood('morning');
    this.applyState();
  }

  applyMood(name) {
    const m = MOOD_PRESETS[name] || MOOD_PRESETS.morning;
    this.mood = name;
    this.canvas.style.background = m.bg;
    skyEnvironment(this.scene, {
      hdri: m.hdri, intensity: m.envIntensity, rotation: m.envRotation, fallbackAmbient: m.ambient,
    });
    this.scene.setFog({ mode: 'linear', color: m.fogColor, start: 18, end: 40 });
    this.scene.setExposure({ mode: 'fixed', ev: m.exposure });
    this.scene.setBloom(m.bloom);

    const l = this.rig.lights;
    l.key.color = m.keyColor;
    l.key.intensity = m.keyIntensity;
    l.rim.color = m.rimColor;
    l.rim.intensity = m.rimIntensity;
    l.lantern.intensity = m.lanternIntensity;
    this.rig.arch.lanternBulb.emissive = 1.0 + m.lanternIntensity * 0.45;
    this.rig.arch.windowsNode.emissive = m.windowEmissive;
    if (this.rig.fireflies) this.rig.fireflies.rate = m.fireflyRate;
    for (const rn of this.rig.terrainNodes) rn.setShaderUniform('sunBoost', m.sunBoost);
    return m;
  }

  setPose(phaseNorm, flowVal = this.flow, breezeVal = this.breeze) {
    this.time = phaseNorm * Math.PI * 2.0 * 4.0;
    this.flow = Math.max(0, Math.min(1, flowVal));
    this.flowSmooth = this.flow;
    this.breeze = Math.max(0, Math.min(1, breezeVal));
    this.breezeSmooth = this.breeze;
    // Wheel turns an integer multiple per normalized loop phase for clean gear continuity
    this.wheelAngle = phaseNorm * Math.PI * 2.0 * 3.0;
    this.applyState();
  }

  step(dt) {
    const k = 1 - Math.exp(-dt * 4.0);
    this.flowSmooth += (this.flow - this.flowSmooth) * k;
    this.breezeSmooth += (this.breeze - this.breezeSmooth) * k;
    if (this.playing) {
      this.time += dt;
      this.wheelAngle += dt * (0.25 + 1.05 * this.flowSmooth);
    }
    this.applyState();
  }

  applyState() {
    const rig = this.rig;
    const t = this.time;
    const fl = this.flowSmooth;
    const br = this.breezeSmooth;

    // 1. Water & terrain shaders
    rig.pondWater.setShaderUniform('time', t);
    rig.pondWater.setShaderUniform('flow', fl);
    rig.pondWater.setShaderUniform('breeze', br);
    for (const st of rig.streams) {
      st.setShaderUniform('time', t);
      st.setShaderUniform('flow', fl);
    }
    for (const tn of rig.terrainNodes) tn.setShaderUniform('time', t);
    if (rig.sprayParticles) rig.sprayParticles.rate = 2.0 + fl * 18.0;

    // 2. Exact kinematic gear train & overshot waterwheel (20T pit wheel : 12T pinion -> 1.6667x speed)
    rig.mech.wheelPivot.rotationX = this.wheelAngle;
    rig.mech.pinionPivot.rotationX = -this.wheelAngle * (20.0 / 12.0) + Math.PI / 12.0;
    rig.mech.stonePivot.rotationY = this.wheelAngle * (20.0 / 12.0);

    // 3. Rooted trees sway + hanging lantern + bobbing rowboat
    for (const tree of [rig.nature.autumnTree, rig.nature.pineTree]) {
      tree.woodNode.setShaderUniform('time', t);
      tree.woodNode.setShaderUniform('breeze', br);
      tree.leafNode.setShaderUniform('time', t);
      tree.leafNode.setShaderUniform('breeze', br);
    }
    rig.arch.lanPivot.rotationZ = Math.sin(t * 1.6) * (0.04 + 0.08 * br);
    rig.arch.lanPivot.rotationX = Math.cos(t * 1.2) * (0.03 + 0.05 * br);
    rig.arch.boatPivot.positionY = 0.015 + Math.sin(t * 1.7) * 0.008;
    rig.arch.boatPivot.rotationZ = Math.sin(t * 1.4) * (0.02 + 0.03 * br);
    rig.arch.boatPivot.rotationX = Math.cos(t * 1.1) * (0.015 + 0.02 * br);

    // 4. Three swimming brook trout
    for (const tr of rig.nature.troutList) {
      const u = tr.phase + t * 0.45 * tr.dir;
      const px = tr.cx + Math.cos(u) * tr.rx;
      const pz = tr.cz + Math.sin(u) * tr.rz;
      const dx = -Math.sin(u) * tr.rx * tr.dir;
      const dz = Math.cos(u) * tr.rz * tr.dir;
      tr.node.setPosition(px, tr.y + Math.sin(t * 2.0 + tr.phase) * 0.006, pz);
      tr.node.rotationY = Math.atan2(-dz, dx);
      tr.node.setShaderUniform('time', t);
      tr.node.setShaderUniform('swimPhase', t * 5.8 + tr.phase * 2.0);
    }

    // 5. C1-continuous autumn leaf lifecycle (tree twig -> pond surface -> slow current drift)
    for (const dl of rig.nature.driftingLeaves) {
      const cyc = ((t * 0.042 + dl.phase) % 1 + 1) % 1;
      const yawAtTouch = dl.phase * 12.0 + 1.6;
      if (cyc < 0.36) {
        const f = cyc / 0.36;
        const ease = f * f * (3.0 - 2.0 * f);
        const env = Math.sin(f * Math.PI);
        const x = dl.sx + (dl.lx - dl.sx) * ease + Math.sin(f * Math.PI * 3.0) * env * 0.16 * (0.4 + 0.6 * br);
        const z = dl.sz + (dl.lz - dl.sz) * ease + Math.sin(f * Math.PI * 2.0) * env * 0.10 * (0.4 + 0.6 * br);
        const y = 0.006 + (dl.sy - 0.006) * (0.5 + 0.5 * Math.cos(f * Math.PI));
        dl.node.setPosition(x, y, z);
        dl.node.scale = [1, 1, 1];
        dl.node.rotationY = dl.phase * 12.0 + 1.6 * ease;
        dl.node.rotationX = Math.sin(f * 8.0 + dl.phase * 6.0) * 0.38 * env;
        dl.node.rotationZ = Math.cos(f * 6.0 + dl.phase * 5.0) * 0.25 * env;
      } else if (cyc < 0.90) {
        const u = (cyc - 0.36) / 0.54;
        const du = u * u * (3.0 - 2.0 * u);
        const env = Math.sin(u * Math.PI);
        const px = dl.lx + 0.35 * du + Math.sin(u * Math.PI * 2.0) * 0.04 * env * Math.cos(dl.phase * 6.0);
        const pz = dl.lz + 0.42 * du + Math.sin(u * Math.PI * 2.0) * 0.03 * env * Math.sin(dl.phase * 5.0);
        dl.node.setPosition(px, 0.006 + Math.sin(px * 4.5 + pz * 3.8 + t * 2.0) * 0.002 * env, pz);
        dl.node.scale = [1, 1, 1];
        dl.node.rotationY = yawAtTouch + du * 1.2;
        dl.node.rotationX = 0; dl.node.rotationZ = 0;
      } else {
        const u = (cyc - 0.90) / 0.10;
        const sEase = u * u * (3.0 - 2.0 * u);
        dl.node.setPosition(dl.lx + 0.35, 0.006 - sEase * 0.05, dl.lz + 0.42);
        const s = 1.0 - sEase * 0.88;
        dl.node.scale = [s, s, s];
        dl.node.rotationY = yawAtTouch + 1.2;
        dl.node.rotationX = 0; dl.node.rotationZ = 0;
      }
    }
  }
}
