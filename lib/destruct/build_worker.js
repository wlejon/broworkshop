// lib/destruct/build_worker.js — builder.js's Worker: structures built for a solver, off its thread.
//   in:  { id, s, at }     buildStructure's arguments
//   out: { id, built }     what it returns, its arrays moved across
import { buildStructure } from "./solver.js";

self.onmessage = (ev) => {
    const { id, s, at } = ev.data;
    const built = buildStructure(s, at);
    const move = [];
    for (const k in built) { if (built[k]?.buffer instanceof ArrayBuffer) move.push(built[k].buffer); }
    self.postMessage({ id, built }, move);
};
