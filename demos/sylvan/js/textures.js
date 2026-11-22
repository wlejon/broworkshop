// js/textures.js — High-detail botanical alpha cutouts, bark, basalt, and vivid carp scale maps.

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fbm(x, y) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; ++i) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const r00 = hash2(ix, iy), r10 = hash2(ix + 1, iy);
    const r01 = hash2(ix, iy + 1), r11 = hash2(ix + 1, iy + 1);
    const n = (r00 * (1 - ux) + r10 * ux) * (1 - uy) + (r01 * (1 - ux) + r11 * ux) * uy;
    v += a * n;
    x *= 2.02; y *= 2.02; a *= 0.5;
  }
  return v;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, v | 0));
}

/** Crisp fractured volcanic basalt grain (moss masking is computed seamlessly in world-space shader). */
export function makeMossyBasalt(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const rock = fbm(x * 0.10, y * 0.10);
      const grain = fbm(x * 0.36 + 7, y * 0.36 + 13);
      const v = 132 + rock * 56 + grain * 28;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(v * 0.94);
      data[o + 1] = clampByte(v * 0.98);
      data[o + 2] = clampByte(v * 1.02);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Furrowed weathered Japanese maple bark with faint lichen flecks. */
export function makeMapleBark(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const furrow = 0.5 + 0.5 * Math.sin(x * 0.42 + fbm(x * 0.09, y * 0.05) * 5.2);
      const fin = fbm(x * 0.25, y * 0.14);
      const lichen = Math.max(0, fin - 0.69) * 2.5;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(56 + furrow * 42 + lichen * 48);
      data[o + 1] = clampByte(44 + furrow * 34 + lichen * 68);
      data[o + 2] = clampByte(37 + furrow * 26 + lichen * 36);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Crisp lush multi-leaf Japanese maple spray RGBA cutout with 5-lobed serrated leaves & fine veins. */
export function makePalmateMapleLeaf(w = 128, h = 128) {
  const data = new Uint8Array(w * h * 4);
  const drawLobeLeaf = (u, v, cx, cy, scale, rot) => {
    const cu = Math.cos(rot), su = Math.sin(rot);
    const rx = (u - cx) * cu - (v - cy) * su;
    const ry = (u - cx) * su + (v - cy) * cu;
    const dx = rx / scale, dy = (ry - 0.16 * scale) / scale;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dx, Math.max(1e-4, dy));
    const lobeCos = Math.cos(ang * 2.55);
    const serrate = 0.045 * Math.sin(r * 46.0);
    const maxR = (0.38 + 0.40 * Math.max(0, lobeCos) + serrate) * smoothMask(dy, -0.06, 0.12);
    const petiole = ry >= 0 && ry < 0.18 * scale && Math.abs(rx) < 0.032 * scale;
    const inside = petiole || (dy > -0.06 && r < maxR && ry < 0.92 * scale);
    const vein = Math.exp(-Math.abs(Math.sin(ang * 2.55)) * 10.0) * Math.max(0, 1.0 - r);
    return { inside, r, vein };
  };

  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1);
    for (let x = 0; x < w; ++x) {
      const u = (x / (w - 1)) * 2.0 - 1.0;
      const a = drawLobeLeaf(u, v, 0.0, 0.12, 0.88, 0.0);
      const b = drawLobeLeaf(u, v, -0.28, 0.04, 0.62, 0.58);
      const c = drawLobeLeaf(u, v, 0.28, 0.04, 0.62, -0.58);
      const stem = v < 0.18 && Math.abs(u) < 0.032;
      const inside = stem || a.inside || b.inside || c.inside;

      const grain = fbm(x * 0.16, y * 0.16);
      const vein = Math.max(a.vein, b.vein, c.vein);
      const tipWarm = Math.max(0, Math.min(1, Math.min(a.r, Math.min(b.r, c.r)) * 1.1 + grain * 0.25));
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(215 + tipWarm * 30 + vein * 14);
      data[o + 1] = clampByte(168 + tipWarm * 42 + vein * 18);
      data[o + 2] = clampByte(126 + tipWarm * 24 + vein * 12);
      data[o + 3] = inside ? 255 : 0;
    }
  }
  return { width: w, height: h, data };
}

function smoothMask(v, e0, e1) {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Pinnate forest fern frond RGBA alpha-cutout with opposite tapered leaflets and central rachis. */
export function makeFernFrondTex(w = 128, h = 256) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1);
    for (let x = 0; x < w; ++x) {
      const u = (x / (w - 1)) * 2.0 - 1.0;
      const absU = Math.abs(u);
      const rachis = absU < 0.042 * (1.0 - v * 0.72);
      const pairs = 15.0;
      const pinnaIdx = Math.floor(v * pairs);
      const localY = (v * pairs) - pinnaIdx;
      const envW = Math.sin(Math.pow(v, 0.72) * Math.PI) * 0.88 + 0.08;
      // Slight upward sweep of each pinna + tapered blade
      const sweepY = localY - absU * 0.28;
      const pinnaThick = Math.max(0, 0.34 * (1.0 - absU / Math.max(0.05, envW)));
      const inPinna = v > 0.06 && v < 0.98 && absU < envW && Math.abs(sweepY - 0.48) < pinnaThick;
      const inside = rachis || inPinna;

      const shade = 0.82 + 0.22 * fbm(x * 0.14, y * 0.10);
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte((rachis ? 115 : 88) * shade);
      data[o + 1] = clampByte((rachis ? 156 : 162 + v * 32) * shade);
      data[o + 2] = clampByte((rachis ? 70 : 62) * shade);
      data[o + 3] = inside ? 255 : 0;
    }
  }
  return { width: w, height: h, data };
}

/** Variegated autumn leaf albedo modulation map (legacy compatibility if referenced). */
export function makeMapleFoliage(w = 192, h = 192) {
  return makePalmateMapleLeaf(w, h);
}

/** Detailed multi-pebble submerged riverbed & dark soil island substrate texture. */
export function makePondBedTexture(w = 256, h = 256) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const peb = fbm(x * 0.18, y * 0.18);
      const sand = fbm(x * 0.45 + 11, y * 0.45 + 3);
      const stone = Math.pow(peb, 1.15);
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(72 + stone * 58 + sand * 20);
      data[o + 1] = clampByte(74 + stone * 54 + sand * 18);
      data[o + 2] = clampByte(66 + stone * 46 + sand * 16);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Rich Nishikigoi diamond-scale Kohaku / Yamabuki / Showa pattern texture. */
export function makeKoiTexture(variant = 'kohaku', w = 256, h = 128) {
  const data = new Uint8Array(w * h * 4);
  const seed = variant === 'yamabuki' ? 2.1 : (variant === 'showa' ? 5.7 : 0.9);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const u = x / w; // 0 = nose, 1 = caudal tail
      const v = Math.abs(y / h - 0.5) * 2.0; // 0 = dorsal ridge, 1 = belly
      const pat = fbm(u * 4.5 + seed, v * 3.0 + seed);
      const scale = 0.93 + 0.07 * Math.sin(u * 82.0) * Math.sin((y / h) * 42.0);
      // Warm pearlescent belly + white/pearl base
      let r = 248, g = 242, b = 232;
      if (variant === 'yamabuki') {
        r = 250; g = 190 + pat * 36; b = 44;
      } else if (variant === 'kohaku') {
        if (pat > 0.48 && v < 0.72) { r = 232; g = 52; b = 22; }
      } else {
        if (pat > 0.54 && v < 0.78) { r = 228; g = 48; b = 22; }
        else if (pat < 0.36 && v < 0.82) { r = 24; g = 26; b = 32; }
      }
      // Glossy dark eyes with subtle golden iris ring near head snout
      const eyeD = Math.hypot((u - 0.088) * 1.8, (v - 0.42));
      if (eyeD < 0.042) {
        if (eyeD < 0.024) { r = 16; g = 18; b = 22; }
        else { r = 216; g = 182; b = 96; }
      } else if (u > 0.80) {
        const ft = (u - 0.80) / 0.20;
        r = r * (1 - ft * 0.35) + 252 * ft * 0.35;
        g = g * (1 - ft * 0.35) + 244 * ft * 0.35;
        b = b * (1 - ft * 0.35) + 228 * ft * 0.35;
      }
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(r * scale);
      data[o + 1] = clampByte(g * scale);
      data[o + 2] = clampByte(b * scale);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
