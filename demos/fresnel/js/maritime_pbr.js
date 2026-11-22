// js/maritime_pbr.js — Original procedural PBR materials for Fresnel Lighthouse (zero copied generators).

function prng2(ix, iy) {
  const v = Math.sin(ix * 139.7 + iy * 283.3) * 49157.317;
  return v - Math.floor(v);
}

function fbm2(x, y, octaves = 4) {
  let acc = 0, amp = 0.5;
  for (let o = 0; o < octaves; ++o) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = prng2(ix, iy), b = prng2(ix + 1, iy);
    const c = prng2(ix, iy + 1), d = prng2(ix + 1, iy + 1);
    acc += amp * ((a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy);
    x *= 2.04; y *= 2.04; amp *= 0.5;
  }
  return acc;
}

function u8(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function linstep(a, b, v) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

function buildNormalTex(hg, w, h, gain = 3.6) {
  const data = new Uint8Array(w * h * 4);
  const sample = (x, y) => hg[((y % h + h) % h) * w + ((x % w + w) % w)];
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const gx = (sample(x + 1, y) - sample(x - 1, y)) * gain;
      const gy = (sample(x, y + 1) - sample(x, y - 1)) * gain;
      const inv = 1 / (Math.hypot(-gx, -gy, 1) || 1);
      const o = (y * w + x) * 4;
      data[o + 0] = u8((-gx * inv * 0.5 + 0.5) * 255);
      data[o + 1] = u8((-gy * inv * 0.5 + 0.5) * 255);
      data[o + 2] = u8((inv * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function buildMRTex(rg, metal, w, h) {
  const data = new Uint8Array(w * h * 4);
  const m = u8(metal * 255);
  for (let i = 0; i < w * h; ++i) {
    const o = i * 4;
    data[o + 0] = 255;
    data[o + 1] = u8(Math.max(0.28, rg[i]) * 255);
    data[o + 2] = m;
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Ashlar dressed coastal Cornish granite blocks with deep salt-weathered mortar joints. */
export function makeDressedGranitePbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  const rows = 8, cols = 4;
  for (let y = 0; y < h; ++y) {
    const v = (y / h) * rows, row = Math.floor(v), fv = v - row;
    for (let x = 0; x < w; ++x) {
      const u = (x / w) * cols + (row % 2) * 0.5, col = Math.floor(u), fu = u - col;
      const joint = Math.min(fv, 1 - fv, fu * 0.65, (1 - fu) * 0.65);
      const isJoint = joint < 0.055;
      const seed = prng2(col + row * 19, row * 23);
      const grain = fbm2(x * 0.14 + seed * 11, y * 0.14 + seed * 7);
      const chisel = Math.sin(x * 0.45 + grain * 4.0) * 0.08;
      const lichen = Math.max(0, fbm2(x * 0.045, y * 0.045) - 0.68) * 1.4;
      const idx = y * w + x;
      hg[idx] = isJoint ? 0.12 : (0.54 + Math.min(0.32, joint * 1.2) + grain * 0.14 + chisel);
      rg[idx] = isJoint ? 0.94 : Math.max(0.68, 0.80 + (1 - grain) * 0.14);
      const base = (98 + seed * 36 + (grain - 0.5) * 32) * (isJoint ? 0.66 : 1.0);
      const o = idx * 4;
      albedo[o + 0] = u8(base * 0.99 - lichen * 18);
      albedo[o + 1] = u8(base * 0.97 + lichen * 10);
      albedo[o + 2] = u8(base * 0.93 - lichen * 22);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 4.4), mr: buildMRTex(rg, 0.01, w, h) };
}

/** 16-point compass rose inlaid slate-and-limestone watchroom deck floor. */
export function makeInlaidSlateFloorPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const ny = (y / (h - 1)) * 2 - 1;
    for (let x = 0; x < w; ++x) {
      const nx = (x / (w - 1)) * 2 - 1;
      const r = Math.hypot(nx, ny), ang = Math.atan2(ny, nx);
      const tex = fbm2(x * 0.12, y * 0.12);
      const star = Math.abs(((ang / Math.PI * 8) % 2 + 2) % 2 - 1);
      const ray = linstep(0.18 + r * 0.42, 0.14 + r * 0.42, star) * (1 - linstep(0.76, 0.82, r));
      const outerRing = Math.abs(r - 0.84) < 0.03 || Math.abs(r - 0.28) < 0.022;
      const pale = Math.max(ray, outerRing ? 1 : 0);
      const idx = y * w + x;
      hg[idx] = 0.45 + tex * 0.30 + pale * 0.18;
      rg[idx] = pale > 0.5 ? 0.78 : (0.74 + (1 - tex) * 0.16);
      const slateR = 44 + tex * 22, slateG = 54 + tex * 24, slateB = 64 + tex * 26;
      const stone = 166 + (tex - 0.5) * 24;
      const o = idx * 4;
      albedo[o + 0] = u8(slateR * (1 - pale) + stone * 1.02 * pale);
      albedo[o + 1] = u8(slateG * (1 - pale) + stone * 0.96 * pale);
      albedo[o + 2] = u8(slateB * (1 - pale) + stone * 0.84 * pale);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 3.2), mr: buildMRTex(rg, 0.02, w, h) };
}

/** Riveted foundry cast-iron plate for pedestal, stair treads & lantern murette. */
export function makeRivetedCastIronPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const ry = ((y % 48) - 24) / 24;
    for (let x = 0; x < w; ++x) {
      const rx = ((x % 48) - 24) / 24;
      const seam = Math.abs(x % 48 - 24) > 21 || Math.abs(y % 48 - 24) > 21;
      const rivet = (Math.abs(Math.hypot(rx - 0.68, ry - 0.68)) < 0.16) || (Math.abs(Math.hypot(rx + 0.68, ry - 0.68)) < 0.16);
      const grain = fbm2(x * 0.22, y * 0.22);
      const idx = y * w + x;
      hg[idx] = rivet ? 0.95 : (seam ? 0.18 : 0.45 + grain * 0.25);
      rg[idx] = rivet ? 0.60 : (0.60 + (1 - grain) * 0.22);
      const v = rivet ? 78 : (seam ? 34 : 48 + grain * 24);
      const o = idx * 4;
      albedo[o + 0] = u8(v * 0.98);
      albedo[o + 1] = u8(v * 1.00);
      albedo[o + 2] = u8(v * 1.06);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 3.6), mr: buildMRTex(rg, 0.72, w, h) };
}

/** Lathe-turned naval brass with warm satin brushed micro-grooves. */
export function makeBrushedBrassPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const brush = fbm2(x * 0.04, y * 0.55);
      const tarnish = linstep(0.55, 0.85, fbm2(x * 0.09 + 4, y * 0.09 + 9));
      const idx = y * w + x;
      hg[idx] = 0.45 + brush * 0.35;
      rg[idx] = 0.56 + tarnish * 0.20 + (1 - brush) * 0.12;
      const base = 138 + brush * 30 - tarnish * 34;
      const o = idx * 4;
      albedo[o + 0] = u8(base * 1.04);
      albedo[o + 1] = u8(base * 0.82);
      albedo[o + 2] = u8(base * 0.42);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 2.8), mr: buildMRTex(rg, 0.84, w, h) };
}

/** Salt-spray verdigris copper dome sheets with standing seam ribs. */
export function makeVerdigrisCopperPbrSet(w = 256, h = 256) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const u = (x / w) * 6;
      const seam = Math.abs(u - Math.round(u)) < 0.045;
      const pat = fbm2(x * 0.055, y * 0.055);
      const drip = fbm2(x * 0.14, y * 0.03);
      const ox = linstep(0.30, 0.72, pat * 0.65 + drip * 0.35);
      const idx = y * w + x;
      hg[idx] = seam ? 0.90 : (0.35 + pat * 0.35 + drip * 0.15);
      rg[idx] = seam ? 0.55 : (0.62 + ox * 0.24);
      const o = idx * 4;
      albedo[o + 0] = u8(122 * (1 - ox) + 64 * ox);
      albedo[o + 1] = u8(78 * (1 - ox) + 148 * ox);
      albedo[o + 2] = u8(56 * (1 - ox) + 128 * ox);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 3.8), mr: buildMRTex(rg, 0.35, w, h) };
}

/** French-polished shipwright mahogany wood for curved watchroom desk & trim. */
export function makeMahoganyWoodPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const ring = 0.5 + 0.5 * Math.sin(y * 0.38 + fbm2(x * 0.04, y * 0.15) * 7.0);
      const pore = fbm2(x * 0.18, y * 0.06);
      const idx = y * w + x;
      hg[idx] = 0.42 + ring * 0.36 + pore * 0.18;
      rg[idx] = 0.58 + (1 - ring) * 0.16;
      const s = 68 + ring * 34 + pore * 16;
      const o = idx * 4;
      albedo[o + 0] = u8(s * 1.18);
      albedo[o + 1] = u8(s * 0.54);
      albedo[o + 2] = u8(s * 0.34);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 3.0), mr: buildMRTex(rg, 0.02, w, h) };
}

/** Ruled keeper logbook parchment with ink entries & compass margin lines. */
export function makeParchmentChartPbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const rule = (y % 18) < 2;
    for (let x = 0; x < w; ++x) {
      const gutter = Math.abs(x - w * 0.5) < 4;
      const fiber = fbm2(x * 0.15, y * 0.15);
      const script = rule && x % 14 > 3 && fbm2(x * 0.35, y * 0.35) > 0.48;
      const idx = y * w + x;
      hg[idx] = gutter ? 0.15 : (0.55 + fiber * 0.30);
      rg[idx] = 0.84 + (1 - fiber) * 0.10;
      const p = gutter ? 110 : (script ? 68 : (184 + (fiber - 0.5) * 26));
      const o = idx * 4;
      albedo[o + 0] = u8(p * 1.02);
      albedo[o + 1] = u8(p * 0.96);
      albedo[o + 2] = u8(p * 0.82);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 2.2), mr: buildMRTex(rg, 0.0, w, h) };
}

/** Enamel marine barometer/chronometer dial with crisp radial ticks & needle. */
export function makeDialFacePbrSet(w = 192, h = 192) {
  const albedo = new Uint8Array(w * h * 4), hg = new Float32Array(w * h), rg = new Float32Array(w * h);
  for (let y = 0; y < h; ++y) {
    const ny = (y / (h - 1)) * 2 - 1;
    for (let x = 0; x < w; ++x) {
      const nx = (x / (w - 1)) * 2 - 1;
      const r = Math.hypot(nx, ny), ang = Math.atan2(ny, nx);
      const tick = r > 0.68 && r < 0.88 && Math.abs(Math.sin(ang * 12)) > 0.96;
      const hand = r < 0.72 && Math.abs(Math.sin(ang - 0.65)) < 0.05 && nx > -0.1;
      const idx = y * w + x;
      hg[idx] = r > 0.88 ? 0.3 : 0.65;
      rg[idx] = 0.52;
      const v = (tick || hand) ? 32 : 196;
      const o = idx * 4;
      albedo[o + 0] = v;
      albedo[o + 1] = u8(v * 0.97);
      albedo[o + 2] = u8(v * 0.90);
      albedo[o + 3] = 255;
    }
  }
  return { albedo: { width: w, height: h, data: albedo }, normal: buildNormalTex(hg, w, h, 2.0), mr: buildMRTex(rg, 0.02, w, h) };
}

/** Soft circular dust-mote / mist sprite texture. */
export function makeSoftMistSprite(sz = 64) {
  const data = new Uint8Array(sz * sz * 4);
  for (let y = 0; y < sz; ++y) {
    const dy = (y + 0.5) / sz * 2 - 1;
    for (let x = 0; x < sz; ++x) {
      const dx = (x + 0.5) / sz * 2 - 1;
      const a = Math.pow(Math.max(0, 1 - Math.hypot(dx, dy)), 2.2);
      const o = (y * sz + x) * 4;
      data[o + 0] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = u8(a * 255);
    }
  }
  return { width: sz, height: sz, data };
}
