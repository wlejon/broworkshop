// Tumble chrome: screens exist, the title fills in, and the keyboard menu
// reaches level select through the engine's real key path.
import { check, frames, press, q, text, shot } from "/lib/kit/test.js";

for (const id of [
    "view", "overlay", "screen-title", "screen-levels", "screen-howto", "screen-pause",
    "screen-complete", "screen-gameover", "hud-palette", "hud-action", "hud-action-text",
    "hud-piece-desc", "hud-tagline", "hud-objective", "title-progress", "complete-newbest",
    "complete-next", "complete-menu-item",
]) {
    check(document.getElementById(id), "#" + id + " present");
}

frames(6);
window.__tumble.resetProgress();
window.__tumble.shell.switchTo("title");
frames(2);

check(!q("#screen-title").hidden, "title visible after boot");
check(q("#title-play").getAttribute("data-action") === "play", "play wired");
check(/^Play — Drop-In$/.test(text("#title-play")), "fresh save offers Play — Drop-In: " + text("#title-play"));
check(/8 levels/.test(text("#title-progress")), "title progress: " + text("#title-progress"));
shot("title");

press("ArrowDown");
press("Enter");
frames(2);
check(!q("#screen-levels").hidden, "levels screen shown");
const tiles = q("#levels-grid").querySelectorAll(".level-tile");
check(tiles.length === 8, "8 level tiles");
check(!tiles[0].classList.contains("locked"), "level 1 unlocked");
check(tiles[1].classList.contains("locked") && tiles[1].classList.contains("disabled"), "level 2 locked on a fresh save");
check(!tiles[1].getAttribute("data-action"), "locked tile has no action");

press("Escape");
frames(2);
check(!q("#screen-title").hidden, "Esc returns to the title");

console.log("tumble smoke ok");
