// WAAPI Lab — element.animate() on a stage, a transport that drives the
// Animation objects, and an inspector that reads everything back from them.
//
//   presets.js  keyframe sequences, one per stage element
//   waapi.js    the current animation set + transport + telemetry
//   plotter.js  requested easing curve vs measured progress
//   compare.js  the same motion via WAAPI, CSS @keyframes and rAF, measured
//   support.js  what this engine implements, probed at startup
//   lab.js      the page wiring and per-frame readback
//
// This file is the thin boot; tests import lab.js and the modules under it.

import { boot } from "/lib/kit/index.js";
import { start } from "/app/lab.js";

const app = boot({});
start(app);
app.status.ok('ready');
