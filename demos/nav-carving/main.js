// NavMesh Carving & Links — boots the lab (lab.js, importable by tests) and the HUD.
import { boot } from "/lib/kit/app.js";
import { startLab } from "/app/lab.js";
import { wireHud } from "/app/hud.js";

boot();
startLab(document.getElementById('stage'));
wireHud();
