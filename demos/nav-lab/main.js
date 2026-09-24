// Navigation Lab — bro.ai.game's navmesh, grid, links, obstacles, crowd and
// steering on one multi-storey level. The lab lives in lab.js (importable by
// tests); this only boots it and wires the HUD.
import { boot } from "/lib/kit/app.js";
import { startLab } from "/app/lab.js";
import { wireHud } from "/app/hud.js";

boot();
startLab(document.getElementById('stage'));
wireHud();
