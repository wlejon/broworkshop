// Laya triage — the Laya decision model (bro.lm.loadLaya) as a support-ticket
// triage desk: one request with its calibrated answers, and open-loop traffic
// against the request scheduler.
//
// lib/model.js    checkpoint discovery + loading, the page session
// lib/presets.js  the question set, example tickets, traffic bodies
// lib/traffic.js  open-loop Poisson arrivals + bursts, latency window
// lib/render.js   answer cards, latency / forward charts, metric tiles
// lib/app.js      wiring
import { start } from "/app/lib/app.js";

start();
