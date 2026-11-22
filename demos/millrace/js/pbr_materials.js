// js/pbr_materials.js — Procedural PBR texture trios (albedo, tangent-space normal, glTF MR) for Millrace.

export function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function fbm(x, y, oct = 4) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; ++i) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const r00 = hash2(ix, iy), r10 = hash2(ix + 1, iy);
    const r01 = hash2(ix, iy + 1), r11 = hash2(ix + 1, iy + 1);
    const n = (r00 * (1 - ux) + r10 * ux) * (1 - uy) + (r01 * (1 - ux) + r11 * ux) * uy;
    v += a * n;
    x *= 2.03; y *= 2.03; a *= 0.5;
  }
  return v;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function smoothMask(v, e0, e1) {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function heightToNormalMap(heightGrid, w, h, strength = 3.2) {
  const data = new Uint8Array(w * h * 4);
  const at = (x, y) => heightGrid[((y % h + h) % h) * w + ((x % w + w) % w)];
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(-dx, -dy, 1.0) || 1.0;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(((-dx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = clampByte(((-dy / l) * 0.5 + 0.5) * 255);
      data[o + 2] = clampByte(((1.0 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function packMRMap(roughGrid, metalVal, w, h) {
  const data = new Uint8Array(w * h * 4);
  const m = clampByte(metalVal * 255);
  for (let i = 0; i < w * h; ++i) {
    const o = i * 4;
    data[o + 0] = 255;
    data[o + 1] = clampByte(roughGrid[i] * 255);
    data[o + 2] = m;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Alpine stratified granite & pond-bed cobble grain. */
export function makeGraniteRockPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const n1 = fbm(x * 0.06, y * 0.06);
      const n2 = fbm(x * 0.22 + 7, y * 0.22 + 3);
      const strata = Math.abs(fbm(x * 0.035, y * 0.12 + n1 * 1.6) - 0.5) * 2.0;
      const mica = n2 > 0.72 ? 0.14 : 0.0;
      const elev = n1 * 0.54 + strata * 0.30 + n2 * 0.16;
      const idx = y * w + x;
      hg[idx] = elev;
      rg[idx] = Math.max(0.58, 0.76 + (1.0 - strata) * 0.18 - mica * 0.6);
      const c = 104 + elev * 78 - (1.0 - strata) * 22 + mica * 40;
      const o = idx * 4;
      albedo[o + 0] = clampByte(c * 0.96);
      albedo[o + 1] = clampByte(c * 0.97);
      albedo[o + 2] = clampByte(c * 0.99);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 3.8), mr: packMRMap(rg, 0.02, w, h) };
}

/** Coursed weathered alpine fieldstone & lime mortar masonry. */
export function makeFieldstoneWallPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  const rows = 7, cols = 5;
  for (let y = 0; y < h; ++y) {
    const v = (y / h) * rows;
    const row = Math.floor(v), fv = v - row;
    for (let x = 0; x < w; ++x) {
      const shift = (row % 2) * 0.5;
      const u = (x / w) * cols + shift;
      const col = Math.floor(u), fu = u - col;
      const wobble = (fbm(x * 0.08, y * 0.08) - 0.5) * 0.12;
      const edgeDist = Math.min(fv, 1.0 - fv, fu, 1.0 - fu) + wobble;
      const isMortar = edgeDist < 0.075;
      const stoneSeed = hash2(col + row * 17.0, row * 31.0);
      const grain = fbm(x * 0.18 + stoneSeed * 19.0, y * 0.18);
      const idx = y * w + x;
      hg[idx] = isMortar ? 0.15 + grain * 0.10 : (0.55 + Math.min(0.35, edgeDist * 0.9) + grain * 0.18);
      rg[idx] = isMortar ? 0.94 : (0.78 + grain * 0.16);

      const tone = 112 + stoneSeed * 46 + (grain - 0.5) * 34;
      const o = idx * 4;
      if (isMortar) {
        albedo[o + 0] = clampByte(138 + grain * 22);
        albedo[o + 1] = clampByte(133 + grain * 22);
        albedo[o + 2] = clampByte(120 + grain * 18);
      } else {
        albedo[o + 0] = clampByte(tone * 1.02);
        albedo[o + 1] = clampByte(tone * 0.98);
        albedo[o + 2] = clampByte(tone * 0.91);
      }
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 4.4), mr: packMRMap(rg, 0.01, w, h) };
}

/** Weathered planked oak timber grain for waterwheel, aqueduct, beams, bridge & boat. */
export function makeWeatheredOakPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const v = y / h;
    const plank = Math.floor(v * 5.0);
    const pv = (v * 5.0) - plank;
    const seam = (pv < 0.045 || pv > 0.955) ? 1.0 : 0.0;
    for (let x = 0; x < w; ++x) {
      const grain = 0.5 + 0.5 * Math.sin(y * 0.52 + fbm(x * 0.03 + plank * 4.1, y * 0.18) * 6.5);
      const streak = fbm(x * 0.04, y * 0.25 + plank * 3.0);
      const idx = y * w + x;
      hg[idx] = seam > 0.5 ? 0.14 : (0.50 + grain * 0.24 + streak * 0.16);
      rg[idx] = seam > 0.5 ? 0.95 : (0.80 + (1.0 - grain) * 0.14);
      const pVar = (hash2(plank, 3.7) - 0.5) * 16;
      const base = (66 + grain * 24 + streak * 16 + pVar) * (seam > 0.5 ? 0.45 : 1.0);
      const o = idx * 4;
      albedo[o + 0] = clampByte(base * 1.18);
      albedo[o + 1] = clampByte(base * 0.86);
      albedo[o + 2] = clampByte(base * 0.58);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 3.6), mr: packMRMap(rg, 0.01, w, h) };
}

/** Overlapping weathered cedar roof shingles with crisp shadow courses. */
export function makeCedarShinglePbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  const rows = 9, cols = 8;
  for (let y = 0; y < h; ++y) {
    const v = (y / h) * rows;
    const row = Math.floor(v), fv = v - row;
    for (let x = 0; x < w; ++x) {
      const u = (x / w) * cols + (row % 2) * 0.5;
      const col = Math.floor(u), fu = u - col;
      const gap = (fu < 0.04 || fu > 0.96 || fv < 0.06) ? 1.0 : 0.0;
      const wood = fbm(x * 0.22 + col * 3.1, y * 0.05);
      const seed = hash2(col + row * 13, row * 7);
      const lichen = Math.max(0, fbm(x * 0.06, y * 0.06) - 0.68) * 1.8;
      const idx = y * w + x;
      hg[idx] = gap > 0.5 ? 0.15 : (0.45 + fv * 0.42 + wood * 0.12);
      rg[idx] = 0.80 + (1.0 - wood) * 0.14;
      const tone = (68 + seed * 32 + wood * 22 + fv * 14) * (gap > 0.5 ? 0.52 : 1.0);
      const o = idx * 4;
      albedo[o + 0] = clampByte(tone * 1.12 + lichen * 28);
      albedo[o + 1] = clampByte(tone * 0.82 + lichen * 44);
      albedo[o + 2] = clampByte(tone * 0.62 + lichen * 16);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 4.0), mr: packMRMap(rg, 0.01, w, h) };
}

/** Aged warm lime stucco & troweled plaster for upper timbered story. */
export function makePlasterPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const broad = fbm(x * 0.06, y * 0.06);
      const grit = fbm(x * 0.26, y * 0.26);
      const idx = y * w + x;
      hg[idx] = 0.25 + broad * 0.45 + grit * 0.30;
      rg[idx] = 0.88 + grit * 0.09;
      const c = 186 + (broad - 0.5) * 44 + (grit - 0.5) * 24;
      const o = idx * 4;
      albedo[o + 0] = clampByte(c * 1.02);
      albedo[o + 1] = clampByte(c * 0.96);
      albedo[o + 2] = clampByte(c * 0.84);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 4.6), mr: packMRMap(rg, 0.0, w, h) };
}

/** Forged cast-iron with worn metallic tooth/rim edges for gears, bands & bearings. */
export function makeCastIronPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const pit = fbm(x * 0.20, y * 0.20);
      const streak = fbm(x * 0.08, y * 0.32);
      const polish = smoothMask(pit, 0.62, 0.78);
      const idx = y * w + x;
      hg[idx] = pit * 0.65 + streak * 0.35;
      rg[idx] = 0.48 - polish * 0.14 + (1.0 - pit) * 0.24;
      const base = 54 + pit * 34 + polish * 30;
      const rust = smoothMask(0.32 - pit, 0.0, 0.18);
      const o = idx * 4;
      albedo[o + 0] = clampByte(base + rust * 42);
      albedo[o + 1] = clampByte(base * 0.96 + rust * 14);
      albedo[o + 2] = clampByte(base * 0.95);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 3.0), mr: packMRMap(rg, 0.76, w, h) };
}

/** Chiseled French-buhr granite runner millstone PBR set. */
export function makeMillstonePbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const ny = (y / (h - 1)) * 2.0 - 1.0;
    for (let x = 0; x < w; ++x) {
      const nx = (x / (w - 1)) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const coarse = fbm(x * 0.10, y * 0.10);
      const speck = fbm(x * 0.28 + 3, y * 0.28 + 7);
      const furrow = 0.5 + 0.5 * Math.sin(ang * 10.0 + r * 14.0 + coarse * 2.4);
      const idx = y * w + x;
      hg[idx] = (coarse * 0.52 + speck * 0.30 + furrow * 0.18) * smoothMask(r, 0.10, 0.24);
      rg[idx] = 0.78 + (1.0 - coarse) * 0.16;
      const v = 94 + hg[idx] * 52 + (speck - 0.5) * 32;
      const o = idx * 4;
      albedo[o + 0] = clampByte(v * 0.99);
      albedo[o + 1] = clampByte(v * 0.94);
      albedo[o + 2] = clampByte(v * 0.86);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 3.8), mr: packMRMap(rg, 0.02, w, h) };
}

/** Weathered dark tree bark for autumn birch/maple and alpine pine. */
export function makeTreeBarkPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const fur = 0.5 + 0.5 * Math.sin(x * 0.42 + fbm(x * 0.07, y * 0.03) * 5.0);
      const fin = fbm(x * 0.22, y * 0.14);
      const idx = y * w + x;
      hg[idx] = fur * 0.68 + fin * 0.32;
      rg[idx] = 0.85 + (1.0 - fur) * 0.11;
      const o = idx * 4;
      albedo[o + 0] = clampByte(56 + fur * 46);
      albedo[o + 1] = clampByte(44 + fur * 36);
      albedo[o + 2] = clampByte(36 + fur * 26);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 4.0), mr: packMRMap(rg, 0.01, w, h) };
}

/** Alpha-cutout serrated botanical spray PBR trio (`autumn` | `pine` | `ivy` | `fern`). */
export function makeFoliagePbrSet(kind = 'autumn', w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);

  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1);
    for (let x = 0; x < w; ++x) {
      const u = (x / (w - 1)) * 2.0 - 1.0;
      const absU = Math.abs(u);
      const idx = y * w + x;
      let inside = false, vein = 0.0;
      let r = 180, g = 140, b = 80;

      if (kind === 'pine') {
        const stem = absU < 0.04 * (1.0 - v * 0.6);
        const needles = Math.sin(v * 52.0 - absU * 24.0) > -0.15 && absU < (0.85 * Math.sin(Math.pow(v, 0.6) * Math.PI) + 0.06);
        inside = stem || (v > 0.04 && needles);
        vein = stem ? 1.0 : 0.45;
        const n = fbm(x * 0.18, y * 0.18);
        r = (46 + n * 24 + (stem ? 28 : 0));
        g = (88 + v * 28 + n * 26);
        b = (42 + n * 16);
      } else if (kind === 'fern') {
        const stem = absU < 0.036 * (1.0 - v * 0.72);
        const localY = (v * 16.0) % 1.0;
        const envW = Math.sin(Math.pow(v, 0.7) * Math.PI) * 0.86 + 0.06;
        const sweepY = localY - absU * 0.30;
        const thick = Math.max(0, 0.32 * (1.0 - absU / Math.max(0.05, envW)));
        inside = stem || (v > 0.06 && v < 0.98 && absU < envW && Math.abs(sweepY - 0.48) < thick);
        vein = inside ? 0.55 : 0.0;
        const n = fbm(x * 0.14, y * 0.12);
        r = 72 + n * 26; g = 138 + v * 32 + n * 22; b = 48 + n * 16;
      } else {
        // Broad leaf (autumn amber/crimson or climbing ivy heart-lobes)
        const lobeCos = Math.cos(Math.atan2(u, Math.max(0.05, v - 0.14)) * (kind === 'autumn' ? 2.5 : 1.5));
        const rad = Math.hypot(u, (v - 0.18) * 1.1);
        const maxR = (0.32 + 0.46 * Math.max(0, lobeCos)) * smoothMask(v, 0.04, 0.18);
        inside = (v < 0.22 && absU < 0.024) || (v > 0.04 && v < 0.94 && rad < maxR);
        vein = Math.exp(-Math.abs(u) * 10.0) * (1.0 - v * 0.4) + 0.2 * Math.max(0, Math.sin(rad * 32.0));
        const n = fbm(x * 0.14, y * 0.14);
        if (kind === 'ivy') {
          r = 46 + vein * 34 + n * 22;
          g = 94 + vein * 36 + n * 26;
          b = 38 + vein * 18 + n * 14;
        } else {
          r = 212 + n * 28 + vein * 16;
          g = 152 + n * 42 + vein * 18;
          b = 82 + n * 20;
        }
      }

      hg[idx] = inside ? (0.40 + vein * 0.45) : 0.2;
      rg[idx] = kind === 'ivy' ? (0.48 + vein * 0.14) : (0.62 + vein * 0.14);
      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = inside ? 255 : 0;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 2.4), mr: packMRMap(rg, 0.0, w, h) };
}

/** Speckled alpine brook trout PBR trio (`u = 0 snout -> 1 tail`). */
export function makeTroutPbrSet(w = 256, h = 128) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const vRaw = y / h - 0.5;
    const v = Math.abs(vRaw) * 2.0; // 0 dorsal -> 1 belly
    for (let x = 0; x < w; ++x) {
      const u = x / w;
      const idx = y * w + x;
      const sc = 0.5 + 0.5 * Math.sin(u * 140.0) * Math.sin(vRaw * 76.0);
      const spot = fbm(u * 26.0, v * 16.0);
      hg[idx] = 0.45 + sc * 0.35;
      rg[idx] = 0.48 + (1.0 - sc) * 0.14;

      let r = 82, g = 104, b = 78; // olive back
      if (v > 0.36 && v < 0.72) {
        r = 148; g = 142; b = 126;  // silver-bronze flank
        if (spot > 0.68) { r = 212; g = 84; b = 52; } // brook trout vermilion spots
      } else if (v >= 0.72) {
        r = 228; g = 218; b = 198;
      } else if (spot > 0.65) {
        r = 166; g = 178; b = 112;  // dorsal vermiculation
      }
      const eyeD = Math.hypot((u - 0.088) * 1.9, v - 0.42);
      if (eyeD < 0.040) {
        if (eyeD < 0.022) { r = 14; g = 16; b = 18; rg[idx] = 0.14; }
        else { r = 205; g = 175; b = 95; }
      }
      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: heightToNormalMap(hg, w, h, 2.0), mr: packMRMap(rg, 0.02, w, h) };
}

/** Soft radial Gaussian alpha sprite for waterwheel mist, chimney smoke & twilight fireflies. */
export function makeSoftSpriteTex(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    const dy = (y / (size - 1)) * 2.0 - 1.0;
    for (let x = 0; x < size; ++x) {
      const dx = (x / (size - 1)) * 2.0 - 1.0;
      const r2 = dx * dx + dy * dy;
      const a = r2 >= 1.0 ? 0.0 : Math.exp(-r2 * 4.2) * (1.0 - r2);
      const o = (y * size + x) * 4;
      data[o + 0] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = clampByte(a * 255);
    }
  }
  return { width: size, height: size, data };
}
