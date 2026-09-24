// lib/kit/index.js — the kit's core in one import: boot, DOM helpers, widgets,
// bound controls, prefs and weight lookup. Domain modules (viewport3d, audio,
// ml, imagegen, speech, agent, ...) and the headless test helpers have their
// own entry points.
//
//   import { boot, $, h, statusLine, params, findWeights } from "/lib/kit/index.js";

export { boot } from "./app.js";
export { $, $$, h, clear, ids, fmtBytes, fmtMs, fmtClock, clock, trackDrag } from "./dom.js";
export { statusLine, progressBar, logView, stats, readout, fpsMeter, toggleButton, segmented, tabs, frameLoop, fixedStep, foldPanels } from "./ui.js";
export { bindControl, logMap, params } from "./params.js";
export { prefStore } from "./prefs.js";
export { weightsRoot, weightPath, findWeights, requireWeights, missingWeights, candidatePaths, modelCacheDir } from "./weights.js";
