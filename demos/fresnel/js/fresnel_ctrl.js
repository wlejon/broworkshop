// js/fresnel_ctrl.js — Three original HDRI maritime moods, rotating optical chariot kinematics, wind & beam shutter.

import { skyEnvironment } from '/lib/kit/sky.js';

export const VIEW_PRESETS = {
  overview:  { target: [0.0, 3.75, 0.0], dist: 14.2, fov: 42, yaw: 0.36, pitch: -0.20 },
  lens:      { target: [0.0, 4.46, 0.0], dist: 3.35, fov: 40, yaw: 0.42, pitch: -0.14 },
  pedestal:  { target: [0.0, 3.05, 0.0], dist: 2.95, fov: 40, yaw: -0.45, pitch: -0.24 },
  watchroom: { target: [0.0, 1.25, 0.0], dist: 5.05, fov: 42, yaw: 0.18, pitch: -0.18 },
  cupola:    { target: [0.25, 6.20, -0.2], dist: 4.10, fov: 40, yaw: 0.62, pitch: -0.20 },
};

export const MOOD_PRESETS = {
  dawn: {
    label: 'Dawn Foghorn',
    hdri: 'qwantani_puresky',
    envIntensity: 0.52,
    envRotation: 1.05,
    bg: '#0c1522',
    ambient: [0.06, 0.08, 0.12],
    fogColor: [0.09, 0.12, 0.17],
    keyColor: [1.0, 0.88, 0.72],
    keyIntensity: 2.35,
    rimColor: [0.58, 0.78, 0.98],
    rimIntensity: 1.05,
    lampGlow: 0.95,
    beamMult: 0.70,
    mantleIntensity: 1.65,
    exposure: 0.36,
    bloom: { enabled: false },
  },
  sunset: {
    label: 'Amber Squall Sunset',
    hdri: 'kloppenheim_06_puresky',
    envIntensity: 0.50,
    envRotation: 0.55,
    bg: '#140f18',
    ambient: [0.07, 0.05, 0.06],
    fogColor: [0.12, 0.08, 0.10],
    keyColor: [1.0, 0.74, 0.46],
    keyIntensity: 2.25,
    rimColor: [0.76, 0.66, 0.96],
    rimIntensity: 0.95,
    lampGlow: 1.10,
    beamMult: 0.90,
    mantleIntensity: 1.95,
    exposure: 0.36,
    bloom: { enabled: false },
  },
  midnight: {
    label: 'Midnight Beacon',
    hdri: 'kloppenheim_06_puresky',
    envIntensity: 0.14,
    envRotation: 2.4,
    bg: '#040810',
    ambient: [0.03, 0.05, 0.09],
    fogColor: [0.02, 0.04, 0.08],
    keyColor: [0.46, 0.66, 0.96],
    keyIntensity: 1.15,
    rimColor: [0.38, 0.64, 0.92],
    rimIntensity: 0.85,
    lampGlow: 1.30,
    beamMult: 1.20,
    mantleIntensity: 2.40,
    exposure: 0.34,
    bloom: { enabled: true, threshold: 1.95, intensity: 0.18, radius: 0.56 },
  },
};

export class FresnelController {
  constructor(rig, scene, canvas) {
    this.rig = rig;
    this.scene = scene;
    this.canvas = canvas;
    this.time = 0.0;
    this.drumAngle = 0.0;
    this.anemAngle = 0.0;
    this.playing = true;
    this.speed = 0.72;
    this.speedSmooth = 0.72;
    this.wind = 0.55;
    this.windSmooth = 0.55;
    this.shutterOpen = true;
    this.mood = 'dawn';
    this.applyMood('dawn');
    this.applyState();
  }

  applyMood(name) {
    const m = MOOD_PRESETS[name] || MOOD_PRESETS.dawn;
    this.mood = name;
    this.canvas.style.background = m.bg;
    skyEnvironment(this.scene, {
      hdri: m.hdri, intensity: m.envIntensity, rotation: m.envRotation, fallbackAmbient: m.ambient,
    });
    this.scene.setFog({ mode: 'linear', color: m.fogColor, start: 22, end: 52 });
    this.scene.setExposure({ mode: 'fixed', ev: m.exposure });
    this.scene.setBloom(m.bloom);

    const l = this.rig.lights;
    l.key.color = m.keyColor;
    l.key.intensity = m.keyIntensity;
    l.rim.color = m.rimColor;
    l.rim.intensity = m.rimIntensity;
    l.mantle.intensity = m.mantleIntensity;
    this.rig.optics.mantleNode.emissive = 0.9 + m.lampGlow * 0.42;
    this.rig.optics.glassNode.setShaderUniform('lampGlow', m.lampGlow);
    this.rig.tower.lanternPane.setShaderUniform('lampGlow', m.lampGlow);
    return m;
  }

  setShutter(open) {
    this.shutterOpen = Boolean(open);
    this.applyState();
  }

  setPose(phaseNorm, speedVal = this.speed, windVal = this.wind) {
    this.time = phaseNorm * Math.PI * 2.0 * 3.0;
    this.speed = Math.max(0, Math.min(1, speedVal));
    this.speedSmooth = this.speed;
    this.wind = Math.max(0, Math.min(1, windVal));
    this.windSmooth = this.wind;
    // Exact integer revolutions per cycle so trace trajectories loop cleanly without snaps
    this.drumAngle = phaseNorm * Math.PI * 2.0;
    this.anemAngle = phaseNorm * Math.PI * 2.0 * 3.0;
    this.applyState();
  }

  step(dt) {
    const k = 1 - Math.exp(-dt * 4.5);
    this.speedSmooth += (this.speed - this.speedSmooth) * k;
    this.windSmooth += (this.wind - this.windSmooth) * k;
    if (this.playing) {
      this.time += dt;
      this.drumAngle += dt * (0.14 + 0.54 * this.speedSmooth);
      this.anemAngle += dt * (0.45 + 3.8 * this.windSmooth);
    }
    this.applyState();
  }

  applyState() {
    const { optics, interior, tower, mistParticles, lights } = this.rig;
    const t = this.time;
    const w = this.windSmooth;
    const preset = MOOD_PRESETS[this.mood] || MOOD_PRESETS.dawn;

    // 1. Rotating Fresnel chariot, sweeping beams & mercury bath ripples
    optics.lensPivot.rotationY = this.drumAngle;
    optics.mercuryNode.setShaderUniform('time', t);
    optics.mercuryNode.setShaderUniform('spin', this.drumAngle);
    optics.glassNode.setShaderUniform('time', t);

    const beamGain = this.shutterOpen ? preset.beamMult : 0.0;
    optics.beamsNode.visible = this.shutterOpen;
    optics.beamsNode.setShaderUniform('beamGain', beamGain);
    optics.beamsNode.setShaderUniform('time', t);

    // Subtle beacon sweep illumination synced to primary lens facet
    const bAng = this.drumAngle + Math.PI / 6.0;
    lights.beacon.direction = [Math.sin(bAng), -0.18, Math.cos(bAng)];
    lights.beacon.intensity = this.shutterOpen ? (0.45 + 0.55 * preset.beamMult) : 0.0;

    // 2. Gale instruments & watchroom gimbal lamp
    optics.anemPivot.rotationY = this.anemAngle;
    optics.vanePivot.rotationY = 0.45 + Math.sin(t * 0.85) * (0.08 + 0.22 * w) + Math.cos(t * 1.45) * 0.08 * w;
    tower.lanternPane.setShaderUniform('wind', w);

    interior.gimbalPivot.rotationZ = Math.sin(t * 1.35) * (0.02 + 0.05 * w);
    interior.gimbalPivot.rotationX = Math.cos(t * 1.05) * (0.015 + 0.04 * w);

    if (mistParticles) mistParticles.rate = 3.0 + w * 14.0;
  }
}
