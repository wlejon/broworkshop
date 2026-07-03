// Node Forge — op + port-type registry, shared across all domain packs
// (ops/tensor-ops.js, ops/rave-ops.js, ops/kokoro-ops.js, ...).
//
// Port format is {name, type}. def() also accepts legacy bare-string ports
// (e.g. ins: ['x']) and normalizes them to {name:'x', type:'tensor'} at
// registration time — this lets ops/tensor-ops.js stay a byte-for-byte copy
// of tensor-lab's op defs with no per-line port-format migration.
//
// Categories are registered by whichever domain pack first declares them
// (registerCategory), rather than a single hardcoded list, since new domain
// packs (audio, later vision/diffusion/scene) each own their own category
// names and load order shouldn't matter for the palette grouping.

  const DEFS = {};
  const CATEGORIES = [];

  function normPort(p) {
    return typeof p === 'string' ? { name: p, type: 'tensor' } : p;
  }

  export function def(spec) {
    spec.ins = (spec.ins || []).map(normPort);
    spec.outs = (spec.outs || []).map(normPort);
    DEFS[spec.type] = spec;
  }

  export function registerCategory(name) {
    if (CATEGORIES.indexOf(name) === -1) CATEGORIES.push(name);
  }

  export const Ops = {
    defs: DEFS,
    get: (type) => DEFS[type],
    list: () => Object.keys(DEFS).map((k) => DEFS[k]),
    categories: () => CATEGORIES,
    byCategory: (cat) => Object.keys(DEFS).map((k) => DEFS[k]).filter((d) => d.cat === cat),
  };

  // ---- port-type compatibility -----------------------------------------
  // Identity-only for Milestone 1 — no cross-domain coercions needed yet.
  // A type with no entry here is assumed to only accept itself; ports
  // declared with an unrecognized type still work (see portsCompatible).
  const PORT_COMPAT = {
    'tensor':            ['tensor'],
    'audio-buffer':      ['audio-buffer'],
    'audio-latent-grid': ['audio-latent-grid'],
    'text':              ['text'],
    'phoneme-ids':       ['phoneme-ids'],
    'model-handle':      ['model-handle'],
    'voice-handle':      ['voice-handle'],
    'voice-basis':       ['voice-basis'],
    'kokoro-trace':      ['kokoro-trace'],
  };

  // Wire-time check: eager, on the type TAG only. Fine-grained shape
  // details within a type (e.g. audio-latent-grid's nLatent, or a tensor's
  // rows/cols) are intentionally NOT checked here — those stay in each op's
  // own shape() function, run during Graph.propagate(), because they're
  // often only known after a model loads (RAVE's nLatent varies per
  // checkpoint) and so cannot be resolved at wire time.
  export function portsCompatible(fromType, toType) {
    const allowed = PORT_COMPAT[fromType];
    if (allowed) return allowed.indexOf(toType) !== -1;
    return fromType === toType;   // unknown type: fall back to exact match
  }

  // ---- number formatting (shared across modules) -------------------------
  export const fmtNum = function (n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'G';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n | 0);
  };
  export const fmtMs = function (ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1) return ms.toFixed(3) + ' ms';
    if (ms < 100) return ms.toFixed(2) + ' ms';
    return ms.toFixed(1) + ' ms';
  };
