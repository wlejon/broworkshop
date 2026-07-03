// Node Forge — node-type registry, shared across all domain packs
// (nodes/rave-node.js, nodes/kokoro-node.js, nodes/qwen-node.js, ...).
//
// A node type is {type, label, color, ins, outs, mount, exec}:
//   mount(cardBody, node, graph, api) — hand-builds the node's ENTIRE UI into
//     the card body (no generic param form). This is where each audio lab's
//     own render.js/designer.js/curves.js logic lives, ported near-verbatim.
//     `api` exposes graph-facing calls a node needs: invalidate(node) (calls
//     graph.invalidateFrom + a debounced runner.continue so downstream
//     nodes/save-dirty tracking pick up a live edit) and markDirty().
//   exec(ins, params, node) -> outs — the deterministic SYNC recompute used
//     by Run/continue() and headless tests. A node's OWN live interaction
//     does NOT go through this — dragging a slider calls the model directly
//     and asynchronously, then calls api.invalidate(node) once the result
//     lands, exactly like the labs. exec() exists so Run/save-load/tests
//     have a reproducible path that doesn't depend on having driven the UI.
//
// Ports are almost always empty ({ins:[], outs:[{name:'audio',type:'audio-
// buffer'}]}) since these are self-contained cards, not decomposed pipeline
// stages — graph edges exist for chaining cards together (future: feed one
// node's audio into another's reference-clone input, a mixer, scene audio),
// not for wiring up a single pipeline by hand.

  const DEFS = {};
  const CATEGORIES = [];

  export function def(spec) {
    spec.ins = spec.ins || [];
    spec.outs = spec.outs || [];
    DEFS[spec.type] = spec;
  }

  export function registerCategory(name) {
    if (CATEGORIES.indexOf(name) === -1) CATEGORIES.push(name);
  }

  export const Nodes = {
    defs: DEFS,
    get: (type) => DEFS[type],
    list: () => Object.keys(DEFS).map((k) => DEFS[k]),
    categories: () => CATEGORIES,
    byCategory: (cat) => Object.keys(DEFS).map((k) => DEFS[k]).filter((d) => d.cat === cat),
  };

  // ---- port-type compatibility -------------------------------------------
  // Identity-only — a type with no entry here is assumed to only accept
  // itself. Cross-domain coercions (e.g. a future scene-audio node accepting
  // any audio-buffer regardless of source lab) still just need the SAME tag.
  const PORT_COMPAT = {
    'audio-buffer': ['audio-buffer'],
  };

  export function portsCompatible(fromType, toType) {
    const allowed = PORT_COMPAT[fromType];
    if (allowed) return allowed.indexOf(toType) !== -1;
    return fromType === toType;   // unknown type: fall back to exact match
  }

  export const fmtMs = function (ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1) return ms.toFixed(3) + ' ms';
    if (ms < 100) return ms.toFixed(2) + ' ms';
    return ms.toFixed(1) + ' ms';
  };
