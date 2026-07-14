// Headless smoke for Tumble product chrome (DOM / screens).
// Scene create needs GPU; this only validates shell screens and title wiring.
//   bro-headless games/tumble games/tumble/tests/test_smoke.js

assert(!!document.getElementById("view"), "canvas #view present");
assert(!!document.getElementById("overlay"), "overlay present");
assert(!!document.getElementById("screen-title"), "title screen present");
assert(!!document.getElementById("screen-levels"), "levels screen present");
assert(!!document.getElementById("screen-complete"), "complete screen present");
assert(!!document.getElementById("screen-howto"), "howto screen present");
assert(!!document.getElementById("hud-tagline"), "tagline hud present");
assert(!!document.getElementById("hud-objective"), "objective banner present");
assert(!!document.getElementById("hud-action"), "action strip present");
assert(!!document.getElementById("hud-piece-desc"), "piece description present");
assert(!!document.getElementById("hud-action-text"), "action text present");
assert(!!document.getElementById("title-progress"), "title progress present");
assert(!!document.getElementById("complete-newbest"), "new-best badge present");
assert(!!document.getElementById("complete-next"), "complete next line present");

advanceTime(100);
flush();

const title = document.getElementById("screen-title");
assert(title && title.style.display !== "none" && !title.hidden, "title visible after boot");

const play = document.getElementById("title-play");
assert(play, "title play button");
assert(play.getAttribute("data-action") === "play", "play action wired");
assert(play.textContent.length > 0, "play label filled");

const progress = document.getElementById("title-progress");
assert(progress && progress.textContent.length > 0, "title progress filled by onEnterScreen");

// Navigate to levels via keyboard (second menu item)
function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

pressKey("ArrowDown");
advanceTime(20);
flush();
pressKey("Enter");
advanceTime(50);
flush();

const levels = document.getElementById("screen-levels");
assert(levels && !levels.hidden && levels.style.display !== "none", "levels screen shown");

const grid = document.getElementById("levels-grid");
assert(grid && grid.children.length >= 1, "level tiles rendered");

const firstTile = grid.querySelector(".level-tile");
assert(firstTile, "first level tile");
assert(firstTile.className.indexOf("locked") < 0, "level 1 unlocked by default");

console.log("tumble smoke ok");
