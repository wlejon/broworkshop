// AI Arena — the bro.ai.game showcase: nav grids, agents and the reflex
// robot, scripted / tactical / options / MCTS / belief planners, a learned
// ExIt net, fog of war, rewind and .bgar replays, all in one arena.
// The app lives in lab.js (importable by tests and tools); this only boots it.
import { lab } from "/app/lab.js";
import { startControls } from "/app/controls.js";

const controls = startControls();
lab.start(document.getElementById("arena"));
lab.stage.vp.onFrame(controls.frame);
