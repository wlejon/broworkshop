// js/textures.js — Deterministic procedural PBR textures (albedo, metallicRoughness, normal)
// for hammered/brushed antique brass, honed obsidian slate, compass rose, and planetary surfaces.
// glTF metallicRoughness channel convention: G = roughness [0..255], B = metallic [0..255].

function clampByte(v) {
  return v <= 0 ? 0 : (v >= 255 ? 255 : (v | 0));
}

function hash2(x, y, seed = 1) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, seed = 1) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm2(x, y, seed = 1, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; ++i) {
    sum += amp * smoothNoise(x * freq, y * freq, seed + i * 17);
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

function fbm3(x, y, z, seed = 1) {
  // Periodic pseudo-3D noise by projecting to dual 2D planes so planetary spheres have zero UV seam.
  const n1 = fbm2(x * 3.1 + z * 1.7 + 11.3, y * 3.1 - z * 1.4 + 5.7, seed, 4);
  const n2 = fbm2(z * 3.3 - x * 1.9 + 23.1, y * 3.2 + x * 1.3 + 9.4, seed + 41, 4);
  return 0.5 * (n1 + n2);
}

function makeNormalFromHeight(h, w, hh, scale = 2.0) {
  const out = new Uint8Array(w * hh * 4);
  for (let y = 0; y < hh; ++y) {
    const ym = (y - 1 + hh) % hh, yp = (y + 1) % hh;
    for (let x = 0; x < w; ++x) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (h[y * w + xp] - h[y * w + xm]) * scale;
      const dy = (h[yp * w + x] - h[ym * w + x]) * scale;
      const nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = (y * w + x) * 4;
      out[o] = clampByte((nx / len * 0.5 + 0.5) * 255);
      out[o + 1] = clampByte((ny / len * 0.5 + 0.5) * 255);
      out[o + 2] = clampByte((nz / len * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return { width: w, height: hh, data: out };
}

/** Anisotropic brushed antique brass PBR texture set. */
export function makeBrushedBrass(size = 256, { dark = false } = {}) {
  const albedo = new Uint8Array(size * size * 4);
  const mr = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const baseR = dark ? 148 : 214;
  const baseG = dark ? 114 : 170;
  const baseB = dark ? 62 : 94;

  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const brush = smoothNoise(x * 0.08, y * 1.45, 7) * 0.65 + smoothNoise(x * 0.25, y * 3.1, 13) * 0.35;
      const patina = fbm2(x * 0.04, y * 0.04, 31, 3);
      const tone = 0.84 + brush * 0.22 - (patina - 0.5) * 0.14;
      const idx = y * size + x;
      height[idx] = brush * 0.4 + patina * 0.2;
      const o = idx * 4;
      albedo[o] = clampByte(baseR * tone);
      albedo[o + 1] = clampByte(baseG * tone);
      albedo[o + 2] = clampByte(baseB * (tone * 0.96));
      albedo[o + 3] = 255;
      mr[o] = 255;
      mr[o + 1] = clampByte(((dark ? 0.34 : 0.23) + (1 - brush) * 0.12) * 255); // roughness
      mr[o + 2] = 248; // metallic ~ 0.97
      mr[o + 3] = 255;
    }
  }
  return {
    texture: { width: size, height: size, data: albedo },
    metallicRoughnessTexture: { width: size, height: size, data: mr },
    normalTexture: makeNormalFromHeight(height, size, size, 1.3),
  };
}

/** Engraved brass ring texture with subtle ruled scale lines and patina. */
export function makeEngravedBrass(size = 256) {
  const set = makeBrushedBrass(size, { dark: false });
  const d = set.texture.data;
  const mr = set.metallicRoughnessTexture.data;
  for (let y = 0; y < size; ++y) {
    const band = Math.abs(y / size - 0.5);
    const inRule = (y % 32) < 2 || Math.abs(band - 0.38) < 0.015;
    for (let x = 0; x < size; ++x) {
      const tick = (x % 8) === 0 && band < 0.28;
      if (inRule || tick) {
        const o = (y * size + x) * 4;
        d[o] = Math.round(d[o] * 0.45);
        d[o + 1] = Math.round(d[o + 1] * 0.42);
        d[o + 2] = Math.round(d[o + 2] * 0.4);
        mr[o + 1] = clampByte(0.55 * 255);
      }
    }
  }
  return set;
}

/** Honed dark obsidian / slate surface for floor & plinth, catches crisp SSR reflections. */
export function makeObsidianSlate(size = 256, { roughnessBase = 0.46 } = {}) {
  const albedo = new Uint8Array(size * size * 4);
  const mr = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const f = fbm2(x * 0.035, y * 0.035, 91, 4);
      const v = Math.pow(Math.abs(Math.sin((x * 0.025 + f * 3.8))), 6.0);
      const tone = 11 + f * 14 + v * 10;
      const idx = y * size + x;
      height[idx] = f * 0.35 - v * 0.1;
      const o = idx * 4;
      albedo[o] = clampByte(tone * 0.88);
      albedo[o + 1] = clampByte(tone * 0.98);
      albedo[o + 2] = clampByte(tone * 1.24);
      albedo[o + 3] = 255;
      mr[o] = 255;
      mr[o + 1] = clampByte((roughnessBase + f * 0.14 - v * 0.04) * 255);
      mr[o + 2] = 8;
      mr[o + 3] = 255;
    }
  }
  return {
    texture: { width: size, height: size, data: albedo },
    metallicRoughnessTexture: { width: size, height: size, data: mr },
    normalTexture: makeNormalFromHeight(height, size, size, 0.9),
  };
}

/** Brass inlaid 32-point compass rose / celestial dial on top of the plinth deck. */
export function makeCompassDial(size = 512) {
  const albedo = new Uint8Array(size * size * 4);
  const mr = new Uint8Array(size * size * 4);
  const c = size * 0.5;

  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const sector32 = Math.abs(Math.sin(a * 16));
      const ringA = Math.abs(r - 0.92) < 0.018 || Math.abs(r - 0.72) < 0.012 || Math.abs(r - 0.45) < 0.012;
      const ticks = r > 0.72 && r < 0.91 && Math.abs(Math.sin(a * 36)) < 0.06;
      const star = r < 0.72 && (Math.abs(Math.sin(a * 4)) < 0.065 * (1 - r) || Math.abs(Math.cos(a * 4)) < 0.035 * (1 - r));
      const brass = ringA || ticks || star || (r < 0.14);

      const grain = smoothNoise(x * 0.15, y * 0.15, 53);
      const o = (y * size + x) * 4;
      if (brass) {
        const t = 0.88 + grain * 0.18 + (1 - sector32) * 0.04;
        albedo[o] = clampByte(220 * t);
        albedo[o + 1] = clampByte(176 * t);
        albedo[o + 2] = clampByte(96 * t);
        mr[o + 1] = clampByte(0.24 * 255);
        mr[o + 2] = 245;
      } else {
        const slate = 18 + grain * 12;
        albedo[o] = clampByte(slate * 0.9);
        albedo[o + 1] = clampByte(slate);
        albedo[o + 2] = clampByte(slate * 1.2);
        mr[o + 1] = clampByte(0.32 * 255);
        mr[o + 2] = 15;
      }
      albedo[o + 3] = 255;
      mr[o] = 255;
      mr[o + 3] = 255;
    }
  }
  return {
    texture: { width: size, height: size, data: albedo },
    metallicRoughnessTexture: { width: size, height: size, data: mr },
  };
}

/** Procedural planetary surface generator (seam-free spherical projection). */
export function makePlanetTexture(kind, w = 256, h = 128) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const v = y / (h - 1);
    const phi = v * Math.PI;
    const ny = Math.cos(phi), sinPhi = Math.sin(phi);
    const absLat = Math.abs(ny);
    for (let x = 0; x < w; ++x) {
      const theta = (x / w) * Math.PI * 2;
      const nx = Math.cos(theta) * sinPhi, nz = Math.sin(theta) * sinPhi;
      const n = fbm3(nx, ny, nz, 19);
      const nFine = fbm3(nx * 2.7 + 4, ny * 2.7, nz * 2.7, 73);
      let r = 180, g = 180, b = 180;

      if (kind === 'sol') {
        const gran = fbm3(nx * 4.5, ny * 4.5, nz * 4.5, 11);
        const cell = fbm3(nx * 9.0 + 3, ny * 9.0, nz * 9.0, 29);
        const spot = Math.max(0, 0.38 - nFine) * 1.65;
        const heat = 0.60 + gran * 0.35 + cell * 0.14 - spot;
        r = 255 * Math.min(1, heat * 1.15);
        g = 178 * Math.min(1, heat * 0.95);
        b = 58 * Math.min(1, heat * 0.80);
      } else if (kind === 'mercury' || kind === 'luna') {
        const crater = Math.sin(nFine * 18) * 0.14 + n * 0.55;
        const base = kind === 'mercury' ? [168, 152, 134] : [192, 194, 198];
        const s = 0.68 + crater * 0.55;
        r = base[0] * s; g = base[1] * s; b = base[2] * s;
      } else if (kind === 'venus') {
        const swirl = Math.sin(ny * 10 + n * 5.2) * 0.5 + 0.5;
        r = 228 - swirl * 24; g = 192 - swirl * 34; b = 128 - swirl * 30;
      } else if (kind === 'terra') {
        const ice = absLat > 0.85 - n * 0.08;
        const land = n + (nFine - 0.5) * 0.32 > 0.52;
        const clouds = Math.max(0, fbm3(nx * 2.1 + 9, ny * 3.5, nz * 2.1, 107) - 0.56) * 2.6;
        if (ice) { r = 236; g = 242; b = 248; }
        else if (land) {
          const elev = nFine;
          r = 58 + elev * 95; g = 104 + elev * 58; b = 52 + elev * 32;
        } else {
          r = 20 + n * 24; g = 68 + n * 48; b = 148 + n * 64;
        }
        const cMix = Math.min(0.75, clouds);
        r = r * (1 - cMix) + 245 * cMix;
        g = g * (1 - cMix) + 248 * cMix;
        b = b * (1 - cMix) + 252 * cMix;
      } else if (kind === 'mars') {
        const ice = absLat > 0.90 - n * 0.04;
        if (ice) { r = 236; g = 228; b = 222; }
        else {
          const rust = n * 0.7 + nFine * 0.3;
          r = 165 + rust * 68; g = 74 + rust * 48; b = 46 + rust * 24;
        }
      } else if (kind === 'saturn') {
        const band = Math.sin(ny * 26 + n * 2.1) * 0.5 + 0.5;
        const zone = Math.cos(ny * 11 + nFine * 1.4) * 0.5 + 0.5;
        r = 208 + band * 34 - zone * 18;
        g = 178 + band * 32 - zone * 24;
        b = 124 + band * 24 - zone * 18;
      } else if (kind === 'neptune') {
        const band = Math.sin(ny * 18 + n * 2.4) * 0.5 + 0.5;
        r = 38 + band * 28; g = 88 + band * 52; b = 196 + band * 48;
      }
      const o = (y * w + x) * 4;
      data[o] = clampByte(r);
      data[o + 1] = clampByte(g);
      data[o + 2] = clampByte(b);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Radial Saturn ring albedo with Cassini & Encke divisions (`u = 0..1` radial). */
export function makeSaturnRingTexture(w = 256, h = 16) {
  const data = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; ++x) {
    const t = x / (w - 1);
    const dC = (t - 0.62) / 0.032;
    const dE = (t - 0.86) / 0.015;
    const gapCassini = Math.exp(-(dC * dC));
    const gapEncke = Math.exp(-(dE * dE));
    const fadeEnds = Math.min(1, t / 0.07) * Math.min(1, (1 - t) / 0.05);
    const fine = 0.82 + 0.18 * Math.sin(t * 78) * Math.cos(t * 31);
    const density = Math.max(0.08, fadeEnds * fine * (1 - 0.85 * gapCassini - 0.5 * gapEncke));
    const r = clampByte(250 * (0.64 + 0.36 * density));
    const g = clampByte(230 * (0.62 + 0.38 * density));
    const b = clampByte(190 * (0.60 + 0.40 * density));
    const a = clampByte(density * 245);
    for (let y = 0; y < h; ++y) {
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return { width: w, height: h, data };
}
