// Arcade foundation — public entry points.
//
// Prefer importing boot from shell.js in app main.js:
//   import { boot } from "/lib/arcade/shell.js";

export { boot } from "/lib/arcade/shell.js";
export { createLoop } from "/lib/arcade/loop.js";
export { createView } from "/lib/arcade/view.js";
export { createInput, STANDARD_ACTIONS } from "/lib/arcade/input.js";
export { createAudio } from "/lib/arcade/audio.js";
export { createSave } from "/lib/arcade/save.js";
