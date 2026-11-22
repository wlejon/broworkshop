// js/textures.js — Procedural foundry metals, masonry floor, and calibrated enamel dials.

function hash2(x, y) {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function clampByte(v) {
  return Math.max(0, Math.min(255, v | 0));
}

/** Hammered cast-iron engine enamel (subtle dark graphite-green industrial cast finish). */
export function makeCastIronEnamel(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const n1 = hash2(x * 0.55, y * 0.55);
      const n2 = hash2(x * 0.18 + 9, y * 0.18 + 3);
      const grain = 0.84 + 0.10 * n1 + 0.08 * n2;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(44 * grain);
      data[o + 1] = clampByte(53 * grain);
      data[o + 2] = clampByte(58 * grain);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Brushed warm satin brass texture with subtle axial lathe grain. */
export function makeSatinBrass(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const band = 0.90 + 0.12 * Math.sin(y * 0.42) * 0.5 + 0.08 * hash2(1, y);
    for (let x = 0; x < w; ++x) {
      const fine = 0.94 + 0.08 * hash2(x * 0.15, y);
      const s = band * fine;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(226 * s);
      data[o + 1] = clampByte(182 * s);
      data[o + 2] = clampByte(98 * s);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Precision machined bright steel with circumferential tool marks. */
export function makeMachinedSteel(w = 192, h = 192) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const ring = 0.90 + 0.10 * Math.sin(y * 0.75) + 0.06 * hash2(7, y);
    for (let x = 0; x < w; ++x) {
      const s = ring * (0.95 + 0.06 * hash2(x * 0.12, y));
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(192 * s);
      data[o + 1] = clampByte(198 * s);
      data[o + 2] = clampByte(206 * s);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Burnished piping copper with subtle warm oxidation variation. */
export function makeBurnishedCopper(w = 160, h = 160) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) {
    const tone = 0.88 + 0.14 * Math.sin(y * 0.31);
    for (let x = 0; x < w; ++x) {
      const m = tone * (0.93 + 0.09 * hash2(x * 0.25, y * 0.25));
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(218 * m);
      data[o + 1] = clampByte(126 * m);
      data[o + 2] = clampByte(84 * m);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Dark honed quarry-slate engine house floor with subtle machined tile seams. */
export function makeFoundryFloor(w = 256, h = 256) {
  const data = new Uint8Array(w * h * 4);
  const tile = 64;
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const gx = x % tile, gy = y % tile;
      const seam = (gx <= 1 || gy <= 1) ? 0.64 : 1.0;
      const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      const tileTone = 0.90 + 0.14 * hash2(tx * 3.1, ty * 5.7);
      const fine = 0.92 + 0.10 * hash2(x * 0.4, y * 0.4);
      const m = seam * tileTone * fine;
      const o = (y * w + x) * 4;
      data[o + 0] = clampByte(34 * m);
      data[o + 1] = clampByte(39 * m);
      data[o + 2] = clampByte(47 * m);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** High-contrast circular Victorian ivory enamel gauge dial (270 deg sweep). */
export function makeGaugeDial(maxTicks = 12, dangerStart = 0.78, w = 256, h = 256) {
  const data = new Uint8Array(w * h * 4);
  const cx = (w - 1) * 0.5, cy = (h - 1) * 0.5;
  const maxR = Math.min(w, h) * 0.48;
  const a0 = Math.PI * 0.75; // bottom-left (-135 deg visual)
  const sweep = Math.PI * 1.5;

  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      const rn = r / maxR;
      const o = (y * w + x) * 4;
      if (rn > 1.0) {
        data[o + 0] = 48; data[o + 1] = 42; data[o + 2] = 32; data[o + 3] = 255;
        continue;
      }
      // Ivory porcelain base with subtle edge vignette
      const vig = 1.0 - 0.14 * Math.pow(rn, 3);
      let cr = 242 * vig, cg = 235 * vig, cb = 216 * vig;

      // Outer chapter ring & danger arc
      if (rn > 0.89 && rn < 0.95) {
        cr = 38; cg = 42; cb = 48;
      } else if (rn > 0.72 && rn < 0.88) {
        let ang = Math.atan2(dy, dx);
        let rel = (ang - a0) % (Math.PI * 2);
        if (rel < 0) rel += Math.PI * 2;
        const frac = rel / sweep;
        if (frac >= 0 && frac <= 1.005) {
          if (frac >= dangerStart && rn > 0.80 && rn < 0.86) {
            cr = 192; cg = 48; cb = 42;
          }
          const sub = frac * maxTicks * 2;
          const distMajor = Math.abs(frac * maxTicks - Math.round(frac * maxTicks));
          const distMinor = Math.abs(sub - Math.round(sub));
          if (distMajor < 0.08 && rn > 0.72) {
            cr = 26; cg = 28; cb = 34;
          } else if (distMinor < 0.06 && rn > 0.79) {
            cr = 62; cg = 65; cb = 72;
          }
        }
      }
      // Center hub dot
      if (rn < 0.09) {
        cr = 44; cg = 46; cb = 52;
      }

      data[o + 0] = clampByte(cr);
      data[o + 1] = clampByte(cg);
      data[o + 2] = clampByte(cb);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
