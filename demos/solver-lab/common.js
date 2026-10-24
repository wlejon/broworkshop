// Shared by every Solver Lab tab: kit colours for canvas drawing, compiling
// the editors' sources into functions the page can run itself, formatting.

import { kitColors } from "/lib/kit/evidence.js";

export { alpha, verdict, checks, legend, presetPicker } from "/lib/kit/evidence.js";

/** Kit token colours, read once. */
export const C = kitColors();

/** Compile a `function name(...) {...}` source into a callable. */
export function compileFn(src) {
  return (new Function('"use strict"; return (' + src.trim() + ');'))();
}

/** Parameter names of a function source, in order. */
export function paramNames(src) {
  const m = /\(([^)]*)\)/.exec(src);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** 0x-prefixed 8-digit hex of an int32. */
export function hex32(v) {
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

/** Short form of a long hash for display. */
export function short(hash, n) {
  return hash ? String(hash).slice(0, n || 12) + '…' : '—';
}

/** "1,234,567". */
export function num(n) {
  return Math.round(n).toLocaleString('en-US');
}
