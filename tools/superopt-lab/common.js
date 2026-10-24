// Shared by every Superopt Lab tab: kit colours for canvas drawing, compiling
// the editors' sources into functions the page runs itself, a seeded int32
// generator for the page's own random testing, formatting.

import { kitColors } from "/lib/kit/evidence.js";

export { alpha, verdict, checks, legend, presetPicker } from "/lib/kit/evidence.js";

/** Kit token colours, read once. */
export const C = kitColors();

/** Canvas font for code: the kit's monospace token. */
export const MONO = '11px ' + ((getComputedStyle(document.documentElement).getPropertyValue('--k-font') || '').trim() || 'monospace');

export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;

/** Compile a `function name(...) {...}` source into a callable. */
export function compileFn(src) {
  return (new Function('"use strict"; return (' + src.trim() + ');'))();
}

/** Parameter names of a function source, in order. */
export function paramNames(src) {
  const m = /\(([^)]*)\)/.exec(src);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** A seeded xorshift32 stream of int32s: the page's random testing repeats run to run. */
export function int32Stream(seed) {
  let s = (seed | 0) || 0x9E3779B9;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return s | 0;
  };
}

/** Values a careful tester tries first: zero, ±1, the int32 limits and powers of two around them. */
export const EDGES = [0, 1, -1, 2, -2, 255, 256, -256, 65535, 65536, INT_MAX, INT_MAX - 1, INT_MIN, INT_MIN + 1, 1 << 30, -(1 << 30)];

/** Same value: NaN equals NaN, -0 and 0 differ. */
export const same = Object.is;

/** "1,234,567". */
export function num(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** "(3, -1)" */
export function tuple(args) {
  return '(' + args.join(', ') + ')';
}

/** Short form of a long hash for display. */
export function short(hash, n) {
  return hash ? String(hash).slice(0, n || 12) + '…' : '—';
}

/** Readable int32: the limits by name. */
export function int(v) {
  if (v === INT_MIN) return 'INT32_MIN';
  if (v === INT_MAX) return 'INT32_MAX';
  return String(v);
}
