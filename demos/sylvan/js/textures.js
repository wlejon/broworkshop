// js/textures.js — Procedural natural textures: wet volcanic slate, furrowed bark, autumn maple foliage, pebbles, waterfall & koi scales.

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

/** Dark fractured basalt stone with patchy velvet emerald moss restricted to upper pockets. */
export function makeMossyBasalt(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const topBias = Math.max(0, 1.0 - (y / h) * 1.95);
    for (let x = 0; x < w; ++x) {
      const rock = fbm(x * 0.09, y * 0.09);
      const crack = Math.abs(fbm(x * 0.22 + 3, y * 0.22 + 5) - 0.5) * 2.0;
      const grain = fbm(x * 0.34 + 13, y * 0.34 + 7);
      const mossMask = Math.max(0, Math.min(1, (topBias * 1.05 + grain * 0.42 - 0.68) * 3.4));
      const shade = 0.72 + rock * 0.46 - (1.0 - crack) * 0.16;
      const baseR = 56 * shade;
      const baseG = 61 * shade;
      const baseB = 65 * shade;
      const mossR = 46 + grain * 34;
      const mossG = 94 + grain * 48;
      const mossB = 36 + grain * 22;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(baseR * (1 - mossMask) + mossR * mossMask);
      data[o + 1] = clampByte(baseG * (1 - mossMask) + mossG * mossMask);
      data[o + 2] = clampByte(baseB * (1 - mossMask) + mossB * mossMask);
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
      const furrow = 0.5 + 0.5 * Math.sin(x * 0.38 + fbm(x * 0.09, y * 0.06) * 4.8);
      const fin = fbm(x * 0.24, y * 0.14);
      const lichen = Math.max(0, fin - 0.68) * 2.8;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(50 + furrow * 42 + lichen * 48);
      data[o + 1] = clampByte(38 + furrow * 34 + lichen * 72);
      data[o + 2] = clampByte(32 + furrow * 26 + lichen * 40);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Variegated autumn Japanese maple leaf-canopy texture (deep crimson, scarlet & warm gold leaf clusters). */
export function makeMapleFoliage(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const patch = fbm(x * 0.10, y * 0.10);
      const leaf = fbm(x * 0.44 + 5, y * 0.44 + 11);
      const darkPocket = Math.max(0, 1.0 - leaf * 1.45) * 0.35;
      const warm = Math.max(0, Math.min(1, patch * 1.4 - 0.18));
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte((146 + warm * 88 + leaf * 24) * (1 - darkPocket));
      data[o + 1] = clampByte((30 + warm * 78 + leaf * 20) * (1 - darkPocket));
      data[o + 2] = clampByte((20 + warm * 16) * (1 - darkPocket));
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Textured river-stone basin floor & dappled woodland moss/soil plinth margin. */
export function makePondBedTexture(w = 256, h = 256) {
  const data = new Uint8Array(w * h * 4);
  const cx = w * 0.5, cy = h * 0.5;
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const r = Math.hypot(x - cx, y - cy) / (w * 0.5);
      const peb = fbm(x * 0.14, y * 0.14);
      const fine = fbm(x * 0.45 + 4, y * 0.45 + 9);
      const loam = fbm(x * 0.08 + 19, y * 0.08 + 23);
      const mix = r < 0.54 ? 0.0 : Math.min(1, (r - 0.54) * 5.0);
      const bedR = 40 + peb * 34 + fine * 16;
      const bedG = 52 + peb * 38 + fine * 14;
      const bedB = 50 + peb * 32 + fine * 14;
      // Mottled forest earth & mossy turf on outer bank
      const mossPatch = Math.max(0, Math.min(1, (loam - 0.36) * 2.4));
      const dither = (hash2(x, y) - 0.5) * 6.0;
      const rimR = 46 * (1 - mossPatch) + (38 + peb * 28) * mossPatch + fine * 10 + dither;
      const rimG = 42 * (1 - mossPatch) + (74 + peb * 42) * mossPatch + fine * 12 + dither;
      const rimB = 34 * (1 - mossPatch) + (34 + peb * 20) * mossPatch + fine * 8 + dither;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(bedR * (1 - mix) + rimR * mix);
      data[o + 1] = clampByte(bedG * (1 - mix) + rimG * mix);
      data[o + 2] = clampByte(bedB * (1 - mix) + rimB * mix);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Flowing striated white-turquoise cascade foam curtain texture (tiled). */
export function makeWaterfallTexture(w = 128, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const streak = fbm(x * 0.30, y * 0.05);
      const foam = Math.max(0, Math.min(1, (streak - 0.30) * 2.3));
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(150 + foam * 104);
      data[o + 1] = clampByte(218 + foam * 36);
      data[o + 2] = clampByte(234 + foam * 20);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Authentic Kohaku / Yamabuki / Showa ornamental koi pattern. */
export function makeKoiTexture(variant = 'kohaku', w = 128, h = 64) {
  const data = new Uint8Array(w * h * 4);
  const seed = variant === 'yamabuki' ? 2.1 : (variant === 'showa' ? 5.7 : 0.9);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const u = x / w, v = Math.abs(y / h - 0.5) * 2.0;
      const pat = fbm(u * 4.2 + seed, v * 3.2 + seed);
      let r = 248, g = 244, b = 236;
      if (variant === 'yamabuki') {
        r = 248; g = 192 + pat * 34; b = 50;
      } else if (variant === 'kohaku') {
        if (pat > 0.50 && v < 0.78) { r = 232; g = 62; b = 30; }
      } else {
        if (pat > 0.56) { r = 232; g = 58; b = 28; }
        else if (pat < 0.37) { r = 28; g = 30; b = 36; }
      }
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(r);
      data[o + 1] = clampByte(g);
      data[o + 2] = clampByte(b);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
