// Algorithm Visualizer boot. Tests import shell.js / viz/*, never this file.

import { boot } from "/lib/kit/app.js";
import { mountShell } from "./shell.js";

const app = boot();
const shell = mountShell(app.status);
if (shell.VIZ.length) shell.activate(shell.VIZ[0].id);
globalThis.algoViz = shell;
