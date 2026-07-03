// Node Forge — preset graphs.
//
// Empty for now: mega-nodes are self-contained (a RAVE/Kokoro/Qwen card
// loads its own model and needs no other node wired in for the common
// case), so "load a preset graph" is far less load-bearing than it was for
// tensor-lab's atomic-op graphs, where nothing worked until you'd wired up
// 6-10 boxes by hand. Revisit once a genuinely illustrative multi-node
// example exists (e.g. chaining one lab's audio output into another's
// reference-clone input).
  export const Presets = {
    list: () => [],
    load() { return false; },
  };
