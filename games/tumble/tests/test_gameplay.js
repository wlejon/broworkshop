// Thorough Tumble gameplay investigation — bro-headless.
// Run: bro-headless games/tumble games/tumble/tests/test_gameplay.js

function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    console.log("[tumble] " + parts.join(" "));
}

function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

function waitFor(pred, maxMs, step) {
    step = step || 50;
    maxMs = maxMs || 8000;
    var waited = 0;
    while (waited < maxMs) {
        if (pred()) return true;
        advanceTime(step);
        flush();
        waited += step;
    }
    return pred();
}

function untilCompleteOrFail(maxMs) {
    maxMs = maxMs || 12000;
    var sawRun = false;
    return waitFor(function () {
        var s = T.snapshot();
        if (s.mode === "run") sawRun = true;
        if (T.screen === "complete") return true;
        if (sawRun && s.mode === "build") return true;
        return false;
    }, maxMs, 50);
}

// ── Boot ─────────────────────────────────────────────────────────────────

advanceTime(150);
flush();

var T = window.__tumble;
assert(T, "__tumble hooks exposed");
assert(T.LEVELS && T.LEVELS.length === 8, "8 campaign levels");
assert(T.LEVELS[0].id === "drop-in", "L1 Drop-In");
assert(T.LEVELS[1].id === "plank", "L2 Plank Walk");
assert(T.LEVELS[7].id === "gauntlet", "L8 Grand Tour");
log("boot ok — campaign:", T.LEVELS.map(function (l) { return l.name; }).join(" → "));

// ── Title ────────────────────────────────────────────────────────────────

T.resetProgress();
if (T.shell.switchTo) T.shell.switchTo("title");
advanceTime(50);
flush();
assert(T.screen === "title", "title");
assert(document.getElementById("title-progress").textContent.length > 0, "title progress");
assert(/Play|Continue/.test(document.getElementById("title-play").textContent), "play label");
log("title:", document.getElementById("title-play").textContent);

// ── L1 Drop-In: free-fall tutorial win ────────────────────────────────────

log("--- L1 Drop-In free-fall ---");
T.startLevel(0);
advanceTime(100);
flush();
assert(T.screen === "playing", "playing");
assert(T.scene, "scene");
assert(!document.getElementById("hud-coach").hidden, "coach on L1");

// Placement rules
assert(T.place("block", 2, 0, 2) === true, "place ok");
assert(T.place("block", 2, 0, 2) === false, "dup reject");
assert(T.place("block", 99, 0, 99) === false, "oob reject");
assert(T.removeAt(2, 0, 2) === true, "remove ok");

try { screenshot("games/tumble/tests/out-1-build-empty.png"); } catch (e) { /* optional */ }

T.enterRun();
assert(untilCompleteOrFail(8000), "Drop-In settles");
for (var i = 0; i < 15 && T.screen !== "complete"; i++) { advanceTime(40); flush(); }
assert(T.screen === "complete", "Drop-In free-fall wins");
assert((T.save.get("unlocked") || 1) >= 2, "unlocks L2");
assert(T.save.get("best")["drop-in"] != null, "best saved");
log("L1 win", (T.run.resultMs / 1000).toFixed(2) + "s", document.getElementById("complete-medal").textContent);
assert(document.getElementById("complete-next").textContent.indexOf("Plank") >= 0, "next is Plank Walk");

try { screenshot("games/tumble/tests/out-2-complete-dropin.png"); } catch (e) { /* optional */ }

// ── L2 Plank Walk: empty fails, booster path wins ────────────────────────

log("--- L2 Plank Walk empty fail ---");
T.startLevel(1);
advanceTime(80);
flush();
assert(T.run.level.id === "plank", "plank loaded");
assert(document.getElementById("hud-coach").hidden, "coach done");

T.enterRun();
var sawRun = false;
var failed = waitFor(function () {
    var s = T.snapshot();
    if (s.mode === "run") sawRun = true;
    return sawRun && s.mode === "build";
}, 20000, 100);
assert(failed && sawRun, "empty Plank fails back to build (no soft-lock)");
log("L2 empty fail ok");

log("--- L2 Plank Walk booster runway win ---");
T.startLevel(1);
advanceTime(80);
flush();
// Boosters aim +X with rot 0 (arrow direction).
assert(T.place("booster", -3, 0, 0, 0), "booster 1");
assert(T.place("booster", -2, 0, 0, 0), "booster 2");
assert(T.place("booster", -1, 0, 0, 0), "booster 3");
assert(T.snapshot().placed >= 3, "runway placed");

try { screenshot("games/tumble/tests/out-5-sideways-build.png"); } catch (e) { /* optional */ }

T.enterRun();
untilCompleteOrFail(15000);
for (i = 0; i < 20 && T.screen !== "complete"; i++) { advanceTime(50); flush(); }
assert(T.screen === "complete", "Plank booster path wins");
log("L2 win", (T.run.resultMs / 1000).toFixed(2) + "s");
assert((T.save.get("unlocked") || 1) >= 3, "unlocks L3");

// ── Restart stability after complete ─────────────────────────────────────

log("--- restart after complete ---");
T.startLevel(0);
advanceTime(60);
flush();
T.enterRun();
untilCompleteOrFail(8000);
for (i = 0; i < 15 && T.screen !== "complete"; i++) { advanceTime(40); flush(); }
assert(T.screen === "complete", "second Drop-In win");
log("restart stable");

// ── Progression UI ───────────────────────────────────────────────────────

log("--- progression tour UI ---");
T.resetProgress();
for (var li = 0; li < T.LEVELS.length; li++) {
    T.startLevel(li);
    advanceTime(50);
    flush();
    assert(T.forceComplete(2000 + li * 150), "force L" + li);
    for (i = 0; i < 12 && T.screen !== "complete"; i++) { advanceTime(40); flush(); }
    assert(T.screen === "complete", "complete L" + li);
    if (li < T.LEVELS.length - 1) {
        assert(document.getElementById("complete-primary").getAttribute("data-action") === "next", "next action");
        assert(document.getElementById("complete-next").textContent.indexOf(T.LEVELS[li + 1].name) >= 0,
            "names next " + T.LEVELS[li + 1].name);
    } else {
        assert(document.getElementById("complete-primary").getAttribute("data-action") === "title", "tour end → title");
        assert(document.getElementById("complete-next").textContent.indexOf("Tour complete") >= 0, "tour copy");
    }
}
assert(Object.keys(T.save.get("best") || {}).length === 8, "8 bests");
if (T.shell.switchTo) T.shell.switchTo("levels");
advanceTime(40);
flush();
assert(document.getElementById("levels-grid").children.length === 8, "8 tiles");
assert(document.getElementById("levels-grid").querySelectorAll(".locked").length === 0, "all unlocked");
log("level select ok");

try { screenshot("games/tumble/tests/out-6-level-select.png"); } catch (e) { /* optional */ }

// ── Controls ─────────────────────────────────────────────────────────────

log("--- controls ---");
T.resetProgress();
T.startLevel(0);
advanceTime(60);
flush();
pressKey(" ");
advanceTime(60);
flush();
assert(T.snapshot().mode === "run", "Space → run");
pressKey(" ");
advanceTime(60);
flush();
assert(T.snapshot().mode === "build", "Space → build");

T.startLevel(3);
advanceTime(60);
flush();
assert(T.select("bumper"), "select bumper");
assert(T.select("ramp") && T.rotate(), "rotate ramp");
assert(T.setLayer(1), "layer");
assert(T.place("ramp", -2, 1, 0, 1) || T.place("ramp", -3, 1, 0, 1), "place ramp");
log("controls ok");

// ── Physics motion ───────────────────────────────────────────────────────

T.startLevel(0);
advanceTime(60);
flush();
T.enterRun();
var moved = waitFor(function () {
    var s = T.snapshot();
    return s.marbles && s.marbles[0] && s.marbles[0].y < 4.5;
}, 3000, 40);
assert(moved, "marble falls");
log("physics ok");

try { screenshot("games/tumble/tests/out-7-running.png"); } catch (e) { /* optional */ }

log("========================================");
log("SMALL FULL GAME CHECK:");
log("  8-level campaign with tool intro arc");
log("  L1 Drop-In free-fall tutorial — operational");
log("  L2 Plank Walk requires path (empty fails, boosters win)");
log("  Open cup lips allow lateral runway scores");
log("  Fail soft-lock fixed; restart-after-complete stable");
log("  Progression / medals / complete UI product-shaped");
log("========================================");
console.log("tumble gameplay investigation ok");
