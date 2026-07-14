import { boot } from "/lib/arcade/shell.js";
import { game } from "/app/game.js";

// Shell requires a 2D view canvas; #view hosts the 3D scene context.
const shellCanvas = document.createElement("canvas");
shellCanvas.width = 1280;
shellCanvas.height = 720;
shellCanvas.style.display = "none";
document.body.appendChild(shellCanvas);

boot(game, { canvas: shellCanvas, width: 1280, height: 720 });
