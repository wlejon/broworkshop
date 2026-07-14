// Thorough Tumble gameplay investigation via bro-headless.
// Run: bro-headless games/tumble games/tumble/tests/test_gameplay.js
//
// Asserts shell/hooks/placement/physics win+fail paths, progression, and
// product chrome. Logs a playability report for subjective review.

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

// ── Boot ─────────────────────────────────────────────────────────────────

advanceTime(150);
flush();

var T = window.__tumble;
assert(T, "__tumble hooks exposed");
assert(T.shell, "shell on hooks");
assert(T.LEVELS && T.LEVELS.length === 8, "8 campaign levels");
assert(T.PIECE_ORDER.length === 7, "7 piece types");
assert(typeof Physics === "object", "Physics global present");
assert(document.getElementById("screen-title"), "title screen DOM");
assert(document.getElementById("hud-coach"), "coach DOM");

log("boot ok — levels=" + T.LEVELS.length + " pieces=" + T.PIECE_ORDER.join(","));

// ── Title chrome ─────────────────────────────────────────────────────────

T.resetProgress();
if (T.shell.switchTo) T.shell.switchTo("title");
advanceTime(50);
flush();

assert(T.screen === "title", "on title after reset");
var playLabel = document.getElementById("title-play");
var titleProg = document.getElementById("title-progress");
assert(playLabel && /Play|Continue/.test(playLabel.textContent), "play label present: " + (playLabel && playLabel.textContent));
assert(titleProg && titleProg.textContent.length > 0, "title progress: " + (titleProg && titleProg.textContent));
log("title:", playLabel.textContent, "|", titleProg.textContent);

// ── Drop-In free-fall win (tutorial: spout over cup) ──────────────────────

log("--- Drop-In free-fall win ---");
var run = T.startLevel(0);
advanceTime(100);
flush();
assert(run && run.level, "run created");
assert(run.level.id === "drop-in", "level drop-in");
assert(run.mode === "build", "starts in build");
assert(T.scene, "scene context created");
assert(T.screen === "playing", "playing screen");

var snap = T.snapshot();
log("build snap:", JSON.stringify({
    level: snap.levelName, mode: snap.mode, placed: snap.placed,
    budget: snap.budgetUsed + "/" + snap.budgetLimit, coach: snap.coachStep,
}));
assert(snap.coachStep === 0, "coach starts at tip 0");
assert(!document.getElementById("hud-coach").hidden, "coach visible on first level");

var tag = document.getElementById("hud-tagline");
assert(tag && tag.textContent.indexOf("Catch") >= 0, "tagline: " + (tag && tag.textContent));

try { screenshot("games/tumble/tests/out-1-build-empty.png"); log("shot: out-1-build-empty.png"); } catch (e) { log("shot skip:", e.message); }

// Placement rules — goal AABB reserves cup cells
assert(T.place("block", 2, 0, 2) === true, "place block in bounds (outside goal)");
assert(T.place("block", 2, 0, 2) === false, "reject duplicate cell");
assert(T.place("block", 99, 0, 99) === false, "reject OOB");
assert(T.place("block", 0, 0, 0) === false, "reject goal-reserved cell");
assert(T.removeAt(2, 0, 2) === true, "remove works");
assert(T.snapshot().placed === 0, "empty after remove");

// Coach advances on place
assert(T.place("block", 2, 0, -1) === true, "place for coach");
assert(T.snapshot().coachStep >= 1, "coach advanced after place");
assert(T.removeAt(2, 0, -1) === true, "clear coach block");

// Free-fall complete
T.enterRun();
advanceTime(50);
flush();
assert(T.snapshot().mode === "run", "entered run mode");
assert(document.getElementById("hud-mode").classList.contains("run"), "RUN mode class");

waitFor(function () {
    return T.screen === "complete" || (T.run && T.run.resultMs != null);
}, 6000, 50);
for (var i = 0; i < 20 && T.screen !== "complete"; i++) {
    advanceTime(50);
    flush();
}

snap = T.snapshot();
log("after free-fall:", JSON.stringify({
    screen: snap.screen, resultMs: snap.resultMs, mode: snap.mode,
    spawned: snap.marblesSpawned, alive: snap.marblesAlive,
    unlocked: snap.unlocked, newBest: snap.newBest,
}));

assert(snap.screen === "complete" || T.screen === "complete", "complete screen shown");
assert(snap.resultMs != null || T.run.resultMs != null, "result time recorded");

advanceTime(50);
flush();
var cTitle = document.getElementById("complete-title");
var cTime = document.getElementById("complete-time");
var cMedal = document.getElementById("complete-medal");
var cNext = document.getElementById("complete-next");
log("complete UI:", cTitle && cTitle.textContent, cTime && cTime.textContent, cMedal && cMedal.textContent, cNext && cNext.textContent);
assert(cTitle && cTitle.textContent.indexOf("Drop-In") >= 0, "complete title names level");
assert(cTime && /\d+\.\d+s/.test(cTime.textContent), "time formatted");
assert(cNext && cNext.textContent.indexOf("Sideways") >= 0, "next up Sideways");
assert((T.save.get("unlocked") || 1) >= 2, "unlocked level 2 after clear");
assert(T.save.get("best") && T.save.get("best")["drop-in"] != null, "best time saved");
assert(T.save.get("coachDone") === true, "coach marked done");

try { screenshot("games/tumble/tests/out-2-complete-dropin.png"); log("shot: out-2-complete-dropin.png"); } catch (e) { log("shot skip:", e.message); }

var freeFallMs = T.run && T.run.resultMs;
log("FUN-NOTE free-fall Drop-In time:", freeFallMs != null ? (freeFallMs / 1000).toFixed(2) + "s" : "n/a",
    "medal", cMedal && cMedal.textContent);

// ── Restart after complete + decorative stack still wins ─────────────────

log("--- Drop-In restart with decorative stack ---");
T.startLevel(0);
advanceTime(80);
flush();
assert(T.place("block", 2, 0, 0), "stack base");
assert(T.place("block", 2, 1, 0), "stack mid");
assert(T.place("block", 2, 2, 0), "stack high");
assert(T.place("block", 2, 3, 0), "stack top");
assert(T.place("block", -2, 0, 2) === false, "budget exhausted");

try { screenshot("games/tumble/tests/out-3-build-stack.png"); log("shot: out-3-build-stack.png"); } catch (e) { log("shot skip:", e.message); }

T.enterRun();
waitFor(function () { return T.screen === "complete"; }, 8000, 50);
for (i = 0; i < 20 && T.screen !== "complete"; i++) { advanceTime(50); flush(); }
assert(T.screen === "complete", "stack path still completes (spout over cup)");
log("stack path time:", T.run && T.run.resultMs != null ? (T.run.resultMs / 1000).toFixed(2) + "s" : "n/a");

// ── Fail path: Sideways with no pieces (must not soft-lock) ──────────────

log("--- Sideways fail (no pieces) ---");
T.startLevel(1);
advanceTime(80);
flush();
assert(T.run.level.id === "offset", "Sideways loaded");
assert(document.getElementById("hud-coach").hidden, "coach hidden after coachDone");

T.enterRun();
var sawRun = false;
var peakSpawned = 0;
var failedBack = waitFor(function () {
    var s = T.snapshot();
    if (s.mode === "run") {
        sawRun = true;
        if (s.marblesSpawned > peakSpawned) peakSpawned = s.marblesSpawned;
    }
    return sawRun && s.mode === "build";
}, 25000, 100);
snap = T.snapshot();
log("fail snap:", JSON.stringify({
    mode: snap.mode, screen: snap.screen, peakSpawned: peakSpawned,
    resultMs: snap.resultMs, alive: snap.marblesAlive,
}));
assert(failedBack, "fail returns to build within timeout (no soft-lock)");
assert(sawRun, "entered run before fail");
assert(peakSpawned >= 1, "at least one marble spawned before fail (peak=" + peakSpawned + ")");
assert(snap.mode === "build", "fail returns to build mode");
assert(snap.resultMs == null, "no result on fail");
assert(snap.screen === "playing", "still playing after fail (not gameover)");

try { screenshot("games/tumble/tests/out-4-fail-rebuild.png"); log("shot: out-4-fail-rebuild.png"); } catch (e) { log("shot skip:", e.message); }
log("FUN-NOTE fail path: ground-rest no longer soft-locks — ok (peakSpawned=" + peakSpawned + ")");

// ── Sideways rough path (challenge probe) ────────────────────────────────

log("--- Sideways solve attempt ---");
T.startLevel(1);
advanceTime(80);
flush();
var placed = 0;
function tryPlace(type, cx, cy, cz, rot) {
    if (T.place(type, cx, cy, cz, rot || 0)) placed++;
}
for (var x = -2; x <= 2; x++) tryPlace("block", x, 0, 0);
tryPlace("block", -2, 1, 0);
tryPlace("block", -1, 1, 0);
tryPlace("ramp", 0, 1, 0, 0);
tryPlace("ramp", 1, 1, 0, 0);
tryPlace("block", 2, 1, 0);
log("Sideways pieces placed:", placed, "budget", JSON.stringify(T.snapshot().budget));

try { screenshot("games/tumble/tests/out-5-sideways-build.png"); log("shot: out-5-sideways-build.png"); } catch (e) { log("shot skip:", e.message); }

T.enterRun();
var sideOk = waitFor(function () { return T.screen === "complete"; }, 15000, 50);
for (i = 0; i < 30 && T.screen !== "complete"; i++) { advanceTime(50); flush(); }
snap = T.snapshot();
log("Sideways result:", JSON.stringify({
    complete: T.screen === "complete", resultMs: snap.resultMs,
    mode: snap.mode, peakNote: "see logs",
}));
if (T.screen === "complete") {
    log("FUN-NOTE Sideways solvable with rough path — time",
        snap.resultMs != null ? (snap.resultMs / 1000).toFixed(2) + "s" : "?");
} else {
    log("FUN-NOTE Sideways rough path did NOT complete — challenge present");
    if (snap.mode === "run") {
        T.enterBuild();
        advanceTime(100);
        flush();
    }
}

// ── Progression / complete menu / last-level UI ──────────────────────────

log("--- progression + complete UI ---");
T.resetProgress();
for (var li = 0; li < T.LEVELS.length; li++) {
    T.startLevel(li);
    advanceTime(60);
    flush();
    var time = 2000 + li * 200;
    assert(T.forceComplete(time), "forceComplete L" + li);
    for (i = 0; i < 15 && T.screen !== "complete"; i++) { advanceTime(40); flush(); }
    assert(T.screen === "complete", "complete screen L" + li);
    var unlocked = T.save.get("unlocked") || 1;
    if (li < T.LEVELS.length - 1) {
        assert(unlocked >= li + 2, "unlock after L" + li + " → " + unlocked);
        assert(document.getElementById("complete-next").textContent.indexOf(T.LEVELS[li + 1].name) >= 0,
            "next names " + T.LEVELS[li + 1].name);
        var primary = document.getElementById("complete-primary");
        assert(primary && primary.getAttribute("data-action") === "next", "primary is next");
    } else {
        assert(document.getElementById("complete-next").textContent.indexOf("Tour complete") >= 0,
            "tour complete copy");
        primary = document.getElementById("complete-primary");
        assert(primary && primary.getAttribute("data-action") === "title", "last primary → title");
    }
    var nb = document.getElementById("complete-newbest");
    assert(nb && !nb.hidden, "new best shown on first clear L" + li);
}
log("unlock after tour:", T.save.get("unlocked"), "clears:", Object.keys(T.save.get("best") || {}).length);
assert(Object.keys(T.save.get("best") || {}).length === 8, "all 8 bests stored");

if (T.shell.switchTo) T.shell.switchTo("levels");
advanceTime(40);
flush();
var grid = document.getElementById("levels-grid");
assert(grid && grid.children.length === 8, "8 level tiles");
assert(grid.querySelectorAll(".level-tile.locked").length === 0, "all unlocked after tour");
var medals = grid.querySelectorAll(".level-medal");
assert(medals.length === 8, "medal labels on tiles");
log("level select ok — first medal:", medals[0] && medals[0].textContent);

try { screenshot("games/tumble/tests/out-6-level-select.png"); log("shot: out-6-level-select.png"); } catch (e) { log("shot skip:", e.message); }

// ── Keyboard Space toggle ────────────────────────────────────────────────

log("--- keyboard Space toggle ---");
T.resetProgress();
T.startLevel(0);
advanceTime(80);
flush();
assert(T.snapshot().mode === "build", "build before space");
pressKey(" ");
advanceTime(80);
flush();
assert(T.snapshot().mode === "run", "Space enters run");
pressKey(" ");
advanceTime(80);
flush();
assert(T.snapshot().mode === "build", "Space resets to build");

// ── Piece controls ───────────────────────────────────────────────────────

log("--- piece controls ---");
T.startLevel(3);
advanceTime(80);
flush();
assert(T.select("bumper"), "select bumper");
assert(T.run.build.selected === "bumper", "selected bumper");
assert(T.select("ramp"), "select ramp");
assert(T.rotate() === true, "rotate ramp");
assert(T.run.build.rot === 1, "rot=1");
assert(T.setLayer(2), "layer 2");
assert(T.run.build.layer === 2, "layer set");
assert(T.place("ramp", 0, 2, 0, 1), "place rotated ramp on layer");
assert(T.place("bumper", 1, 0, 0), "place bumper");
log("controls ok placed=", T.snapshot().placed);

// ── Physics marble motion ────────────────────────────────────────────────

log("--- physics marble motion ---");
T.startLevel(0);
advanceTime(80);
flush();
T.enterRun();
var moved = waitFor(function () {
    var s = T.snapshot();
    if (!s.marbles || !s.marbles.length) return false;
    return s.marbles[0].y < 5.5;
}, 3000, 40);
snap = T.snapshot();
log("marble motion:", JSON.stringify(snap.marbles), "moved=", moved);
assert(snap.marblesSpawned >= 1, "marble spawned");
assert(moved, "marble falls under gravity");

try { screenshot("games/tumble/tests/out-7-running.png"); log("shot: out-7-running.png"); } catch (e) { log("shot skip:", e.message); }

// ── Report ───────────────────────────────────────────────────────────────

log("========================================");
log("OPERATIONAL: shell, scene, physics, place/remove, budget,");
log("  run/build toggle, win complete, fail rebuild, unlocks,");
log("  coach, complete UI, level select, keyboard Space — exercised.");
log("FUN NOTES:");
log("  - Drop-In free-fall works (~1.1s gold) — intentional free cookie tutorial");
log("  - Fail path returns to build without soft-lock (ground-rest timeout)");
log("  - Sideways rough auto-path: " + (sideOk ? "SUCCESS" : "FAILED (challenge present)"));
log("  - Campaign: 8 levels, 7 piece types, medal pars, progression UI solid");
log("========================================");
console.log("tumble gameplay investigation ok");
