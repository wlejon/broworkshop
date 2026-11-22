// js/pbr_textures.js — Procedural PBR texture baker: tangent-space normal maps, roughness/metallic
// maps, veined botanical cards, stratified rock, fissured maple bark, and 5 unique koi cultivars.

function hash2(x, y) {
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
    x *= 2.02; y *= 2.02; a *= 0.5;
  }
  return v;
}

export function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function smoothMask(v, e0, e1) {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Bake tangent-space RGBA normal map from a scalar height buffer in [0..1]. */
export function heightToNormalMap(heightGrid, w, h, strength = 3.0) {
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

/** Pack glTF-style metallic-roughness texture (G = roughness, B = metallic). */
export function packMRMap(roughGrid, metalVal, w, h) {
  const data = new Uint8Array(w * h * 4);
  const m = clampByte(metalVal * 255);
  for (let i = 0; i < w * h; ++i) {
    const o = i * 4;
    const rg = clampByte(roughGrid[i] * 255);
    data[o + 0] = 255;
    data[o + 1] = rg;
    data[o + 2] = m;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Crisp fractured volcanic basalt PBR trio (albedo, normal, mr). */
export function makeRockPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const n1 = fbm(x * 0.08, y * 0.08);
      const n2 = fbm(x * 0.24 + 9, y * 0.24 + 5);
      const strata = Math.abs(fbm(x * 0.04, y * 0.14 + n1 * 1.4) - 0.5) * 2.0;
      const elev = n1 * 0.55 + strata * 0.30 + n2 * 0.15;
      const idx = y * w + x;
      hg[idx] = elev;
      rg[idx] = 0.68 + (1.0 - strata) * 0.24 + n2 * 0.06;
      const c = 112 + elev * 78 - (1.0 - strata) * 24;
      const o = idx * 4;
      albedo[o + 0] = clampByte(c * 0.94);
      albedo[o + 1] = clampByte(c * 0.97);
      albedo[o + 2] = clampByte(c * 1.00);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 3.8),
    mr: packMRMap(rg, 0.02, w, h),
  };
}

/** Vertically fissured weathered Japanese maple bark PBR trio. */
export function makeBarkPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const warp = fbm(x * 0.07, y * 0.03) * 4.8;
      const fur = 0.5 + 0.5 * Math.sin(x * 0.38 + warp);
      const fin = fbm(x * 0.22, y * 0.12);
      const lichen = Math.max(0, fin - 0.68) * 2.4;
      const elev = fur * 0.68 + fin * 0.32;
      const idx = y * w + x;
      hg[idx] = elev;
      rg[idx] = 0.84 + (1.0 - fur) * 0.12;
      const o = idx * 4;
      albedo[o + 0] = clampByte(48 + fur * 40 + lichen * 42);
      albedo[o + 1] = clampByte(37 + fur * 31 + lichen * 58);
      albedo[o + 2] = clampByte(31 + fur * 24 + lichen * 32);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 4.2),
    mr: packMRMap(rg, 0.01, w, h),
  };
}

/** Delicate multi-leaf 5-lobed serrated Japanese maple spray PBR set. */
export function makeLeafPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);

  const evalLobe = (u, v, cx, cy, sc, rot) => {
    const cu = Math.cos(rot), su = Math.sin(rot);
    const rx = (u - cx) * cu - (v - cy) * su;
    const ry = (u - cx) * su + (v - cy) * cu;
    const dx = rx / sc, dy = (ry - 0.16 * sc) / sc;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dx, Math.max(1e-4, dy));
    // Slender palmate Acer palmatum fingers + delicate tooth serration
    const lobeCos = Math.cos(ang * 2.55);
    const tooth = 0.032 * Math.sin(r * 58.0);
    const maxR = (0.28 + 0.48 * Math.pow(Math.max(0, lobeCos), 1.35) + tooth) * smoothMask(dy, -0.05, 0.10);
    const petiole = ry >= 0 && ry < 0.18 * sc && Math.abs(rx) < 0.022 * sc;
    const inside = petiole || (dy > -0.05 && r < maxR && ry < 0.90 * sc);
    const rib = Math.exp(-Math.abs(Math.sin(ang * 2.55)) * 14.0) * Math.max(0, 1.0 - r * 0.9);
    const subVein = Math.sin(r * 42.0 - Math.abs(ang) * 8.0) * 0.15 * (1.0 - r);
    return { inside, r, rib: rib + Math.max(0, subVein) * 0.35 };
  };

  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1);
    for (let x = 0; x < w; ++x) {
      const u = (x / (w - 1)) * 2.0 - 1.0;
      const a = evalLobe(u, v, 0.0, 0.26, 0.70, 0.0);
      const b = evalLobe(u, v, -0.36, 0.16, 0.56, 0.55);
      const c = evalLobe(u, v, 0.36, 0.16, 0.56, -0.55);
      const d = evalLobe(u, v, -0.46, -0.02, 0.48, 1.08);
      const e = evalLobe(u, v, 0.46, -0.02, 0.48, -1.08);
      const inside = (v < 0.24 && Math.abs(u) < 0.024) || a.inside || b.inside || c.inside || d.inside || e.inside;
      const rib = Math.max(a.rib, b.rib, c.rib, d.rib, e.rib);
      const grain = fbm(x * 0.14, y * 0.14);
      const idx = y * w + x;
      hg[idx] = inside ? (0.4 + rib * 0.45 + grain * 0.12) : 0.2;
      rg[idx] = 0.64 + rib * 0.16 + grain * 0.10;
      const o = idx * 4;
      const edge = Math.max(0, Math.min(1, Math.min(a.r, Math.min(b.r, Math.min(c.r, Math.min(d.r, e.r))))));
      albedo[o + 0] = clampByte(218 + edge * 24 + rib * 16);
      albedo[o + 1] = clampByte(174 + edge * 30 + rib * 18);
      albedo[o + 2] = clampByte(138 + edge * 18 + rib * 14);
      albedo[o + 3] = inside ? 255 : 0;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.2),
    mr: packMRMap(rg, 0.0, w, h),
  };
}

/** Pinnate woodland fern frond PBR set with tapered serrated leaflets & central rachis. */
export function makeFernPbrSet(w = 192, h = 384) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1);
    for (let x = 0; x < w; ++x) {
      const u = (x / (w - 1)) * 2.0 - 1.0;
      const absU = Math.abs(u);
      const rachis = absU < 0.036 * (1.0 - v * 0.72);
      const pairs = 17.0;
      const pinnaIdx = Math.floor(v * pairs);
      const localY = (v * pairs) - pinnaIdx;
      const envW = Math.sin(Math.pow(v, 0.70) * Math.PI) * 0.86 + 0.06;
      const sweepY = localY - absU * 0.30;
      const subTooth = 0.04 * Math.sin(absU * 52.0);
      const pinnaThick = Math.max(0, (0.31 + subTooth) * (1.0 - absU / Math.max(0.05, envW)));
      const inPinna = v > 0.06 && v < 0.98 && absU < envW && Math.abs(sweepY - 0.48) < pinnaThick;
      const inside = rachis || inPinna;
      const vein = inPinna ? Math.max(0, 1.0 - Math.abs(sweepY - 0.48) / Math.max(0.02, pinnaThick)) : (rachis ? 1.0 : 0.0);
      const shade = 0.84 + 0.20 * fbm(x * 0.12, y * 0.09);
      const idx = y * w + x;
      hg[idx] = inside ? (0.35 + vein * 0.55) : 0.2;
      rg[idx] = 0.50 + vein * 0.22;
      const o = idx * 4;
      albedo[o + 0] = clampByte((rachis ? 105 : 74 + vein * 20) * shade);
      albedo[o + 1] = clampByte((rachis ? 136 : 154 + v * 28 + vein * 18) * shade);
      albedo[o + 2] = clampByte((rachis ? 58 : 50 + vein * 14) * shade);
      albedo[o + 3] = inside ? 255 : 0;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.5),
    mr: packMRMap(rg, 0.0, w, h),
  };
}

/**
 * High-resolution 512x256 Nishikigoi PBR map generator for 5 distinct individuals:
 * 'kohaku' | 'tancho' | 'yamabuki' | 'showa' | 'asagi'
 */
export function makeKoiPbrSet(variant = 'kohaku', w = 512, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);
  const seed = variant === 'yamabuki' ? 2.1 : (variant === 'showa' ? 5.7 : (variant === 'tancho' ? 8.3 : (variant === 'asagi' ? 4.4 : 0.9)));

  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const u = x / w;                       // 0 = snout tip, 1 = caudal fin trailing edge
      const vRaw = y / h - 0.5;
      const v = Math.abs(vRaw) * 2.0;        // 0 = dorsal spine, 1 = belly midline
      const idx = y * w + x;
      const pat = fbm(u * 4.2 + seed, v * 3.1 + seed);
      const pat2 = fbm(u * 8.5 + seed * 1.7, v * 6.0);

      // Diamond koi scale relief & fine fin-ray striations
      const scU = u * 54.0, scV = (vRaw + 0.5) * 34.0 + (Math.floor(scU) % 2) * 0.5;
      const fu = (scU - Math.floor(scU)) - 0.5, fv = (scV - Math.floor(scV)) - 0.5;
      const scaleDome = Math.max(0, 1.0 - Math.hypot(fu, fv) * 1.55);
      const scaleEdge = Math.max(0, 1.0 - Math.abs(Math.hypot(fu, fv) - 0.56) * 5.0);
      const inBody = u > 0.14 && u < 0.74 && v < 0.88;
      const inFin = u >= 0.74;
      const finRay = inFin ? (0.5 + 0.5 * Math.sin(vRaw * 95.0)) : 0.0;

      // Subtle curved operculum gill cover ridge at u ~ 0.14..0.17
      const gillArc = 0.155 - v * 0.035;
      const gillDist = Math.abs(u - gillArc);
      const gillShade = gillDist < 0.010 ? (1.0 - gillDist / 0.010) * 0.25 : 0.0;

      let hVal = 0.5;
      if (inBody) hVal = 0.45 + scaleDome * 0.42;
      else if (inFin) hVal = 0.42 + finRay * 0.35;
      if (gillDist < 0.014) hVal -= (1.0 - gillDist / 0.014) * 0.28;
      hg[idx] = hVal;

      // Natural satin mucus skin (0.40..0.58) rather than plastic gloss
      rg[idx] = inFin ? 0.58 : (0.42 + (1.0 - scaleDome) * 0.12 + pat2 * 0.06);

      // Base pearl/ivory koi skin
      let r = 242, g = 236, b = 224;
      if (variant === 'yamabuki') {
        r = 244; g = 186 + pat * 34; b = 46;
        if (inBody) { r -= scaleEdge * 22; g -= scaleEdge * 18; }
      } else if (variant === 'kohaku') {
        // Stepped crisp vermilion hi dorsal saddles + slight lip blush
        const hi = (u > 0.16 && u < 0.36 && pat > 0.42) || (u > 0.44 && u < 0.68 && pat > 0.45) || (u < 0.05 && pat > 0.5);
        if (hi && v < 0.74) { r = 216; g = 46; b = 22; }
      } else if (variant === 'tancho') {
        // Iconic crimson crown circle at u=0.075, dorsal v=0 + subtle sumi specks
        const crownD = Math.hypot((u - 0.082) * 1.6, v * 0.9);
        if (crownD < 0.085) { r = 224; g = 34; b = 24; }
        else if (u > 0.25 && u < 0.70 && pat2 > 0.72 && v < 0.55) { r = 34; g = 36; b = 42; }
      } else if (variant === 'showa') {
        const isBlack = (pat < 0.40 && v < 0.84) || (u < 0.12 && vRaw > 0.0 && pat < 0.55);
        const isRed = pat > 0.54 && v < 0.76;
        if (isBlack) { r = 28; g = 30; b = 36; }
        else if (isRed) { r = 214; g = 44; b = 22; }
      } else if (variant === 'asagi') {
        // Indigo-slate dorsal scale reticulation + warm persimmon gill plates & flanks
        if (v < 0.58) {
          r = 86 - scaleEdge * 34; g = 112 - scaleEdge * 32; b = 148 - scaleEdge * 24;
        }
        if ((u > 0.10 && u < 0.22 && v > 0.34) || (u > 0.20 && v > 0.56 && v < 0.80 && pat > 0.38)) {
          r = 226; g = 88; b = 46;
        }
      }

      if (inBody && variant !== 'asagi' && variant !== 'yamabuki') {
        const net = scaleEdge * 12;
        r -= net; g -= net; b -= net;
      }

      // Cranial variety: nostrils, mouth cleft shading, operculum crease, glossy amber-ringed eye
      const eyeD = Math.hypot((u - 0.088) * 1.9, v - 0.42);
      if (u < 0.025 && v < 0.22) {
        r *= 0.72; g *= 0.72; b *= 0.72;
      } else if (eyeD < 0.044) {
        if (eyeD < 0.025) { r = 14; g = 16; b = 20; rg[idx] = 0.12; }
        else { r = 208; g = 172; b = 88; rg[idx] = 0.25; }
      }

      // Pale silk fin ray margins
      if (inFin) {
        const ft = (u - 0.74) / 0.26;
        const rayM = 0.88 + finRay * 0.14;
        r = (r * (1 - ft * 0.42) + 245 * ft * 0.42) * rayM;
        g = (g * (1 - ft * 0.42) + 238 * ft * 0.42) * rayM;
        b = (b * (1 - ft * 0.42) + 224 * ft * 0.42) * rayM;
      }

      const shade = 1.0 - gillShade;
      const o = idx * 4;
      albedo[o + 0] = clampByte(r * shade);
      albedo[o + 1] = clampByte(g * shade);
      albedo[o + 2] = clampByte(b * shade);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.2),
    mr: packMRMap(rg, 0.02, w, h),
  };
}

/** Radial soft Gaussian alpha sprite so mist & fireflies never render as hard white quads. */
export function makeSoftGlowTex(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    const dy = (y / (size - 1)) * 2.0 - 1.0;
    for (let x = 0; x < size; ++x) {
      const dx = (x / (size - 1)) * 2.0 - 1.0;
      const r2 = dx * dx + dy * dy;
      const a = r2 >= 1.0 ? 0.0 : Math.exp(-r2 * 4.2) * (1.0 - r2);
      const o = (y * size + x) * 4;
      data[o + 0] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = clampByte(a * 255);
    }
  }
  return { width: size, height: size, data };
}
