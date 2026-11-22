// js/flora_pbr.js — Procedural botanical & aquatic insect PBR texture trios (albedo, normal, metallic-roughness).

import { fbm, clampByte, heightToNormalMap, packMRMap } from './pbr_textures.js';

function smoothMask(v, e0, e1) {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Water lily pad PBR trio (256x256 planar polar UVs centered at [0.5, 0.5]):
 * radial dichotomous veins, subtle burgundy-bronze upturned rim, dewdrop beads & waxy satin cuticle.
 */
export function makeLilyPadPbrSet(size = 256) {
  const albedo = new Uint8Array(size * size * 4);
  const hg = new Float32Array(size * size);
  const rg = new Float32Array(size * size);

  for (let y = 0; y < size; ++y) {
    const ny = 1.0 - (y / (size - 1)) * 2.0;
    for (let x = 0; x < size; ++x) {
      const nx = (x / (size - 1)) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const idx = y * size + x;

      // Primary 13 radiating ribs + dichotomous fork past r > 0.36
      const rib1 = Math.pow(0.5 + 0.5 * Math.cos(ang * 13.0 + Math.sin(r * 5.0) * 0.14), 8.0) * smoothMask(r, 0.04, 0.16);
      const forkW = smoothMask(r, 0.34, 0.62);
      const rib2 = Math.pow(0.5 + 0.5 * Math.cos(ang * 26.0 + r * 3.0), 10.0) * forkW;
      const rib3 = Math.pow(0.5 + 0.5 * Math.cos(ang * 52.0 - r * 4.0), 12.0) * smoothMask(r, 0.62, 0.85);
      const vein = Math.min(1.0, rib1 * 0.9 + rib2 * 0.65 + rib3 * 0.40);

      const mottle = fbm(nx * 5.2 + 3.1, ny * 5.2 + 7.4);
      const fine = fbm(nx * 16.0, ny * 16.0);
      const cen = Math.exp(-r * r * 14.0);
      const rim = smoothMask(r, 0.78, 0.98);

      // Sparse micro water droplets on waxy surface
      const dCell = fbm(nx * 12.5 + 1.7, ny * 12.5 + 4.3);
      const droplet = smoothMask(dCell, 0.72, 0.78) * (1.0 - smoothMask(r, 0.88, 1.0));

      hg[idx] = 0.45 + vein * 0.34 + fine * 0.08 + droplet * 0.38;
      rg[idx] = Math.max(0.08, (0.44 + mottle * 0.12 - vein * 0.06) * (1.0 - droplet * 0.78));

      let rr = 48 + mottle * 34 + vein * 36 + cen * 28 + rim * 56;
      let gg = 104 + mottle * 38 + vein * 38 + cen * 22 - rim * 26;
      let bb = 38 + mottle * 20 + vein * 14 + cen * 10 + rim * 10;
      if (droplet > 0.1) {
        rr = rr * (1 - droplet * 0.15) + 215 * droplet * 0.15;
        gg = gg * (1 - droplet * 0.15) + 235 * droplet * 0.15;
        bb = bb * (1 - droplet * 0.15) + 220 * droplet * 0.15;
      }

      const o = idx * 4;
      albedo[o + 0] = clampByte(rr);
      albedo[o + 1] = clampByte(gg);
      albedo[o + 2] = clampByte(bb);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: size, height: size, data: albedo },
    normal: heightToNormalMap(hg, size, size, 3.0),
    mr: packMRMap(rg, 0.0, size, size),
  };
}

/**
 * Sacred water-lily / lotus petal PBR trio (256x256 cutout card):
 * rounded obovate petal silhouette, silky longitudinal vascular striations & warm rose/ivory blush.
 */
export function makeLotusPetalPbrSet(variant = 'pink', size = 256) {
  const albedo = new Uint8Array(size * size * 4);
  const hg = new Float32Array(size * size);
  const rg = new Float32Array(size * size);
  const isPink = variant === 'pink';

  for (let y = 0; y < size; ++y) {
    const v = 1.0 - y / (size - 1); // 0 = base at center, 1 = petal tip
    for (let x = 0; x < size; ++x) {
      const u = (x / (size - 1)) * 2.0 - 1.0; // -1..1 across petal width
      const idx = y * size + x;

      // Graceful obovate rounded lotus petal profile (narrow claw -> broad spoon -> gentle pointed arch)
      const envW = Math.sin(Math.pow(Math.max(0, Math.min(1, v)), 0.62) * Math.PI) * 0.88 + 0.06 * (1.0 - v);
      const tipTaper = 1.0 - 0.14 * Math.pow(Math.max(0, v - 0.75) / 0.25, 2.0);
      const inside = v >= 0.01 && v <= 0.99 && Math.abs(u) <= envW * tipTaper;

      // Fine radiating silk striations along petal length + central keel crease
      const uNorm = envW > 1e-3 ? u / envW : 0.0;
      const crease = Math.sin(uNorm * 22.0 + Math.sin(v * 6.0) * 0.4) * 0.5 + 0.5;
      const subRib = Math.sin(uNorm * 46.0) * 0.5 + 0.5;
      const vein = (crease * 0.65 + subRib * 0.35) * (0.4 + 0.6 * v);
      const silk = fbm(u * 6.0 + 1.2, v * 10.0 + 3.4);

      hg[idx] = inside ? (0.38 + vein * 0.36 + silk * 0.10 - Math.abs(uNorm) * 0.12) : 0.3;
      rg[idx] = 0.46 + vein * 0.14 + silk * 0.08;

      const tipMix = smoothMask(v, 0.25, 0.92);
      const edgeBlush = smoothMask(Math.abs(uNorm), 0.55, 0.98) * smoothMask(v, 0.20, 0.70);
      let r = 248, g = 242, b = 228;
      if (isPink) {
        const blush = Math.max(tipMix * 0.85, edgeBlush * 0.55);
        r = 250 - blush * 8;
        g = 242 - blush * 116 - vein * 10;
        b = 224 - blush * 56 - vein * 6;
      } else {
        const blush = tipMix * 0.42;
        r = 252 - blush * 4;
        g = 246 - blush * 36 - vein * 6;
        b = 226 - blush * 18 - vein * 4;
      }
      // Subtle honeyed claw warming right at petal base
      const claw = Math.exp(-v * 9.0);
      r = r * (1 - claw * 0.18) + 245 * claw * 0.18;
      g = g * (1 - claw * 0.18) + 218 * claw * 0.18;
      b = b * (1 - claw * 0.18) + 128 * claw * 0.18;

      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = inside ? 255 : 0;
    }
  }
  return {
    albedo: { width: size, height: size, data: albedo },
    normal: heightToNormalMap(hg, size, size, 2.4),
    mr: packMRMap(rg, 0.0, size, size),
  };
}

/** Fibrous parallel-veined sedge grass & cattail reed PBR trio. */
export function makeSedgePbrSet(w = 128, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);

  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1); // 0 = base at ground -> 1 = blade tip
    for (let x = 0; x < w; ++x) {
      const u = x / (w - 1);
      const idx = y * w + x;
      const mid = Math.abs(Math.sin(u * Math.PI));
      const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 18.0);
      const fiber = fbm(u * 20.0 + 2.0, v * 5.0 + 1.0);
      const tipDry = smoothMask(v, 0.78, 1.0);
      const rootDark = 1.0 - smoothMask(v, 0.0, 0.22);

      hg[idx] = 0.38 + rib * 0.32 + mid * 0.22;
      rg[idx] = 0.56 + rib * 0.14 + tipDry * 0.18;

      const shade = (0.78 + 0.24 * fiber) * (1.0 - rootDark * 0.34);
      const r = (68 + v * 46 + tipDry * 62 + rib * 12) * shade;
      const g = (128 + v * 36 - tipDry * 24 + rib * 18) * shade;
      const b = (44 + v * 18 + tipDry * 8) * shade;

      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.8),
    mr: packMRMap(rg, 0.0, w, h),
  };
}

/** Velvety densely packed Typha (cattail) seed-head PBR trio. */
export function makeCattailHeadPbrSet(size = 128) {
  const albedo = new Uint8Array(size * size * 4);
  const hg = new Float32Array(size * size);
  const rg = new Float32Array(size * size);

  for (let y = 0; y < size; ++y) {
    const v = 1.0 - y / (size - 1);
    for (let x = 0; x < size; ++x) {
      const u = x / (size - 1);
      const idx = y * size + x;
      const fuzz = fbm(u * 38.0 + 5.1, v * 48.0 + 2.3);
      const band = fbm(u * 6.0, v * 16.0);
      const tipFrost = smoothMask(v, 0.86, 1.0) * 0.45 + smoothMask(0.14, 0.0, v) * 0.35;

      hg[idx] = 0.25 + fuzz * 0.65 + band * 0.10;
      rg[idx] = 0.90 + fuzz * 0.08;

      const r = 46 + fuzz * 26 + band * 12 + tipFrost * 34;
      const g = 24 + fuzz * 14 + band * 7 + tipFrost * 24;
      const b = 11 + fuzz * 8 + band * 4 + tipFrost * 16;
      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: size, height: size, data: albedo },
    normal: heightToNormalMap(hg, size, size, 4.2),
    mr: packMRMap(rg, 0.0, size, size),
  };
}

/**
 * Iridescent segmented Anisoptera (dragonfly) body PBR trio (axial u: 0 = head/eyes, 1 = tail tip).
 */
export function makeDragonflyBodyPbrSet(w = 256, h = 128) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);

  for (let y = 0; y < h; ++y) {
    const vRaw = y / (h - 1);
    const side = Math.abs(vRaw - 0.5) * 2.0; // 0 = dorsal spine, 1 = outer side
    for (let x = 0; x < w; ++x) {
      const u = x / (w - 1);
      const idx = y * w + x;
      const micro = fbm(u * 24.0, vRaw * 16.0);

      // Head & large wraparound compound eyes (u < 0.12), thorax (0.12..0.34), 9 abdominal segments (0.34..1.0)
      const isHead = u < 0.12;
      const isThorax = u >= 0.12 && u < 0.34;
      const abdT = Math.max(0, (u - 0.34) / 0.66);
      const segPhase = (abdT * 9.0) % 1.0;
      const seam = Math.exp(-Math.pow(Math.min(segPhase, 1.0 - segPhase) * 10.0, 2.0));

      let r = 24, g = 132, b = 152;
      let rough = 0.28 + micro * 0.10;
      let hVal = 0.55 - seam * 0.35 + micro * 0.08;

      if (isHead) {
        // Faceted dark amber-plum compound eyes vs turquoise frons
        if (side > 0.26) {
          const facet = 0.5 + 0.5 * Math.sin(u * 320.0) * Math.sin(vRaw * 180.0);
          r = 34 + facet * 22; g = 42 + facet * 24; b = 52 + facet * 28;
          rough = 0.18 + facet * 0.06;
          hVal = 0.62 + facet * 0.14;
        } else {
          r = 46; g = 165; b = 158;
        }
      } else if (isThorax) {
        const stripe = 0.5 + 0.5 * Math.sin((u - 0.14) * 58.0 + side * 4.5);
        r = 26 + stripe * 44; g = 112 + stripe * 72; b = 128 + stripe * 34;
        hVal = 0.52 + stripe * 0.12;
      } else {
        // Dark obsidian dorsal bands + sapphire-turquoise chitin plates + subtle pale lateral rings
        const ringTone = smoothMask(segPhase, 0.12, 0.30) * (1.0 - smoothMask(segPhase, 0.72, 0.92));
        r = 18 + ringTone * 16 + side * 8;
        g = 36 + ringTone * 116 + side * 14;
        b = 46 + ringTone * 142 + side * 12;
        rough = 0.24 + seam * 0.34 + micro * 0.06;
      }

      hg[idx] = hVal;
      rg[idx] = rough;
      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.8),
    mr: packMRMap(rg, 0.42, w, h),
  };
}

/**
 * Translucent veined dragonfly wing PBR trio (`leafCard` fullUV: v = 0 base -> 1 tip, u = 0..1 chord):
 * thick leading costa, dark pterostigma patch, and polygonal chitin venation lattice.
 */
export function makeDragonflyWingPbrSet(w = 192, h = 256) {
  const albedo = new Uint8Array(w * h * 4);
  const hg = new Float32Array(w * h);
  const rg = new Float32Array(w * h);

  for (let y = 0; y < h; ++y) {
    const v = 1.0 - y / (h - 1); // 0 = wing root at thorax, 1 = wing tip
    for (let x = 0; x < w; ++x) {
      const u = x / (w - 1);     // 0 = trailing edge, 1 = leading costa edge
      const idx = y * w + x;

      // Asymmetric tapered dragonfly wing planform (broadest near v=0.38, rounded tip at v=1)
      const lead = 0.94 - 0.16 * Math.pow(Math.max(0, v - 0.55) / 0.45, 2.0);
      const trail = 0.52 - 0.42 * Math.sin(Math.pow(v, 0.65) * Math.PI) + 0.22 * v;
      const inside = v >= 0.01 && v <= 0.99 && u >= trail && u <= lead;

      const costaDist = Math.abs(u - lead);
      const chordNorm = lead > trail + 1e-3 ? (u - trail) / (lead - trail) : 0.5;
      const longVein = Math.pow(Math.max(0, Math.cos(chordNorm * Math.PI * 5.0 + v * 2.2)), 14.0);
      const crossVein = Math.pow(Math.max(0, Math.cos(v * 68.0 + chordNorm * 4.0)), 18.0);
      const vein = Math.min(1.0, (costaDist < 0.045 ? 1.0 : 0.0) + Math.max(longVein, crossVein * 0.85));
      const pterostigma = v > 0.72 && v < 0.84 && u > lead - 0.14 && u <= lead;

      hg[idx] = inside ? (0.42 + vein * 0.48) : 0.3;
      rg[idx] = pterostigma ? 0.44 : (vein > 0.4 ? 0.36 : 0.14);

      const iridescence = fbm(u * 8.0 + v * 3.0, v * 8.0);
      let r = 216 + iridescence * 28;
      let g = 234 + iridescence * 18;
      let b = 246;
      if (pterostigma) { r = 46; g = 38; b = 34; }
      else if (vein > 0.35) {
        const k = Math.min(1.0, (vein - 0.35) * 1.6);
        r = r * (1 - k) + 36 * k;
        g = g * (1 - k) + 34 * k;
        b = b * (1 - k) + 32 * k;
      }

      // Gossamer chitin wing: high enough alpha on veins + costa to pass cutout or crisp blend
      const alpha = inside ? (pterostigma ? 245 : Math.round(138 + vein * 115)) : 0;
      const o = idx * 4;
      albedo[o + 0] = clampByte(r);
      albedo[o + 1] = clampByte(g);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = alpha;
    }
  }
  return {
    albedo: { width: w, height: h, data: albedo },
    normal: heightToNormalMap(hg, w, h, 2.2),
    mr: packMRMap(rg, 0.05, w, h),
  };
}
