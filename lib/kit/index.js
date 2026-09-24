// lib/kit/index.js — the kit in one import (everything but the 3D viewport
// and the headless test helpers, which have their own entry points).
//
//   import { boot, $, h, statusLine, params, findWeights } from "/lib/kit/index.js";

export { boot } from "./app.js";
export { $, $$, h, clear, ids, fmtBytes, fmtMs, clock } from "./dom.js";
export { statusLine, progressBar, logView, stats, readout, fpsMeter, toggleButton, segmented, tabs, frameLoop, fixedStep, foldPanels } from "./ui.js";
export { bindControl, params } from "./params.js";
export { weightsRoot, weightPath, findWeights, requireWeights, missingWeights, candidatePaths, modelCacheDir } from "./weights.js";
