// procwatch — leftover-process monitor, system gauges and an opt-in
// auto-reaper for the tool processes agents leave behind.
//
// lib/procs.js    the process model (snapshots + events + enrich, classification)
// lib/feeds.js    the PowerShell / typeperf / nvidia-smi children, kill + reveal
// lib/reaper.js   auto-kill rules
// lib/table.js    the process table and its detail row
// lib/gauges.js   CPU / RAM / GPU cards
// lib/cmdline.js  raw command line -> readable one-liner
// lib/app.js      wiring
import { start } from "/app/lib/app.js";

start();
