// js/sylvan_life.js — Camera presets, seasonal lighting moods, aquatic koi locomotion & breeze kinematics.

export const VIEW_PRESETS = {
  sanctuary: { target: [-0.08, 0.82, 0.05], dist: 7.4, fov: 42, yaw: 0.48, pitch: -0.44 },
  cascade:   { target: [0.78, 0.62, -1.05], dist: 3.6, fov: 40, yaw: 0.28, pitch: -0.30 },
  pond:      { target: [0.02, 0.14, 0.24], dist: 4.0, fov: 42, yaw: 0.34, pitch: -0.58 },
  canopy:    { target: [-1.10, 1.56, -0.58], dist: 4.6, fov: 42, yaw: 0.56, pitch: -0.28 },
};

export const MOOD_PRESETS = {
  mist: {
    label: 'Morning Mist',
    bg: '#0c1618',
    ambient: [0.15, 0.20, 0.20],
    fogColor: [0.05, 0.09, 0.10],
    keyColor: [0.98, 0.96, 0.88],
    keyIntensity: 3.4,
    rimColor: [0.68, 0.90, 1.0],
    rimIntensity: 2.2,
    fillColor: [0.74, 0.94, 0.96],
    fillIntensity: 5.2,
    lanternIntensity: 1.8,
    fireflyGlow: 0.55,
    exposure: 0.30,
    bloom: { threshold: 1.15, intensity: 0.22, radius: 0.68 },
  },
  sunbeam: {
    label: 'Golden Sunbeam',
    bg: '#16120c',
    ambient: [0.16, 0.14, 0.11],
    fogColor: [0.09, 0.07, 0.05],
    keyColor: [1.0, 0.88, 0.64],
    keyIntensity: 4.3,
    rimColor: [1.0, 0.72, 0.42],
    rimIntensity: 1.9,
    fillColor: [0.96, 0.86, 0.66],
    fillIntensity: 5.8,
    lanternIntensity: 2.0,
    fireflyGlow: 0.45,
    exposure: 0.34,
    bloom: { threshold: 1.08, intensity: 0.26, radius: 0.72 },
  },
  dusk: {
    label: 'Firefly Dusk',
    bg: '#090f1d',
    ambient: [0.09, 0.12, 0.18],
    fogColor: [0.03, 0.05, 0.10],
    keyColor: [0.58, 0.72, 1.0],
    keyIntensity: 2.1,
    rimColor: [0.46, 0.78, 0.96],
    rimIntensity: 2.6,
    fillColor: [0.52, 0.74, 0.96],
    fillIntensity: 4.0,
    lanternIntensity: 4.2,
    fireflyGlow: 2.2,
    exposure: 0.28,
    bloom: { threshold: 0.92, intensity: 0.36, radius: 0.78 },
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
    this.scene.setAmbient(m.ambient);
    this.scene.setFog({ mode: 'linear', color: m.fogColor, start: 11, end: 24 });
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
    this.rig.lanternEmber.emissive = 0.9 + m.lanternIntensity * 0.4;
    for (const f of this.rig.fireflies) f.node.emissive = m.fireflyGlow;
    return m;
  }

  /** Deterministically set cyclic phase (`0..1`) & breeze (`0..1`) for inspection & clearance tests. */
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
    const br = 0.22 + this.breezeSmooth * 1.05;

    // 1. Waterfall cascade shimmer + cyclic plunge splash rings (strictly >=0.008u clear of water y=0.018)
    const flowPulse = 0.28 + 0.08 * Math.sin(t * 5.2);
    rig.fallMain.emissive = flowPulse;
    rig.fallSide.emissive = 0.24 + 0.07 * Math.cos(t * 4.8);
    for (const sr of rig.splashRings) {
      const cyc = ((t * 0.42 + sr.phase) % 1 + 1) % 1;
      const sc = 0.55 + cyc * 0.85;
      sr.node.setScale(sc, 1.0 - cyc * 0.25, sc);
      sr.node.emissive = Math.max(0.04, 0.44 * (1.0 - cyc));
    }

    // 2. Five articulated Koi swimming smoothly along separated pond lanes (zero collision!)
    for (const k of rig.koiList) {
      const u = k.phase + t * 0.44 * k.dir;
      const px = k.cx + Math.cos(u) * k.rx;
      const pz = k.cz + Math.sin(u) * k.rz;
      const dx = -Math.sin(u) * k.rx * k.dir;
      const dz = Math.cos(u) * k.rz * k.dir;
      // Forward axis of koi mesh is +X (tail extends -X), and rotationY tilts +X toward -Z -> yaw = Math.atan2(-dz, dx)
      const yaw = Math.atan2(-dz, dx);
      const bob = Math.sin(t * 2.2 + k.phase) * 0.004;
      k.root.setPosition(px, k.y + bob, pz);
      k.root.rotationY = yaw;

      // Travelling spinal propulsion wave across Head -> Mid -> Tail -> Caudal
      const wagBase = t * 5.4 + k.phase * 2.0;
      k.head.rotationY = Math.sin(wagBase) * 0.06;
      k.mid.rotationY = Math.sin(wagBase - 0.8) * 0.14;
      k.tail.rotationY = Math.sin(wagBase - 1.6) * 0.20;
      k.caudal.rotationY = Math.sin(wagBase - 2.4) * 0.28;
      const finSw = Math.sin(wagBase * 0.9) * 0.20;
      k.finL.rotationY = finSw;
      k.finR.rotationY = -finSw;
    }

    // 3. Breeze-driven Japanese Maple canopy, fern fronds, and cattail reeds
    for (const fa of rig.foliageAnchors) {
      const swayZ = Math.sin(t * 1.35 + fa.phase) * 0.018 * br;
      const swayX = Math.cos(t * 1.05 + fa.phase * 1.3) * 0.015 * br;
      fa.pivot.rotationZ = swayZ;
      fa.pivot.rotationX = swayX;
    }
    for (const fr of rig.frondNodes) {
      fr.node.rotationZ = Math.sin(t * 1.9 + fr.phase) * 0.065 * br;
    }
    for (const rd of rig.reedNodes) {
      rd.pivot.rotationZ = Math.sin(t * 1.55 + rd.phase) * 0.072 * br;
      rd.pivot.rotationX = Math.cos(t * 1.25 + rd.phase) * 0.045 * br;
    }

    // 4. Water lily gentle ripple rock & lantern ember breathe
    for (const lg of rig.lilyGroups) {
      lg.padPivot.rotationZ = Math.sin(t * 1.4 + lg.phase) * 0.018;
      lg.padPivot.rotationX = Math.cos(t * 1.1 + lg.phase) * 0.016;
    }

    // 5. Dragonfly figure-8 aerial patrol + rapid iridescent wingbeat (strictly y = 1.12..1.48)
    for (const df of rig.dragonflies) {
      const u = t * 0.55 + df.phase;
      const x = Math.sin(u) * df.radX;
      const z = Math.sin(u * 2.0) * (df.radZ * 0.48);
      const y = df.height + Math.sin(t * 2.1 + df.phase) * 0.06;
      const vx = Math.cos(u) * df.radX;
      const vz = Math.cos(u * 2.0) * df.radZ * 0.96;
      df.piv.setPosition(x, y, z);
      df.piv.rotationY = Math.atan2(-vz, vx);
      const flap = Math.sin(t * 24.0 + df.phase) * 0.42;
      df.wL.rotationX = flap;
      df.wR.rotationX = -flap;
    }

    // 6. Helical drifting crimson leaves (y = 0.22..0.68) & dusk fireflies (y = 0.78..0.98)
    for (const dl of rig.driftingLeaves) {
      const cyc = ((t * 0.08 + dl.phase) % 1 + 1) % 1;
      const y = 0.68 - cyc * 0.46;
      const x = dl.bx + Math.sin(t * 1.1 + dl.phase * 6.28) * 0.22 * br;
      const z = dl.bz + Math.cos(t * 0.95 + dl.phase * 6.28) * 0.20 * br;
      dl.node.setPosition(x, y, z);
      dl.node.rotationY = t * 0.8 + dl.phase * 12;
      dl.node.rotationX = Math.sin(t * 2.0 + dl.phase * 9) * 0.45;
    }
    for (const ff of rig.fireflies) {
      ff.node.setPosition(
        ff.bx + Math.sin(t * 1.2 + ff.phase) * 0.16,
        ff.by + Math.sin(t * 1.7 + ff.phase * 1.3) * 0.04,
        ff.bz + Math.cos(t * 1.1 + ff.phase) * 0.16,
      );
    }
  }
}
