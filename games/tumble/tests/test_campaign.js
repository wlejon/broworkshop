// Full-campaign verified solutions via bro-headless.
// Run: bro-headless games/tumble games/tumble/tests/test_campaign.js
//
// Asserts every level can be cleared with SOLUTIONS layouts (or free-fall).

function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    console.log("[campaign] " + parts.join(" "));
}

function waitFor(pred, maxMs, step) {
    step = step || 50;
    maxMs = maxMs || 15000;
    var waited = 0;
    while (waited < maxMs) {
        if (pred()) return true;
        advanceTime(step);
        flush();
        waited += step;
    }
    return pred();
}

advanceTime(150);
flush();

var T = window.__tumble;
assert(T, "__tumble exposed");
assert(T.SOLUTIONS && T.SOLUTIONS.length === 8, "8 solutions catalogued");
assert(typeof T.applySolution === "function", "applySolution available");

var results = [];

for (var li = 0; li < 8; li++) {
    T.resetProgress();
    // Unlock entire tour so startLevel can open any index.
    T.save.set("unlocked", 8);
    T.save.set("coachDone", true);
    T.save.set("plankCoachDone", true);
    T.save.save();

    T.startLevel(li);
    advanceTime(80);
    flush();

    var sol = T.SOLUTIONS[li];
    assert(sol && sol.id === T.run.level.id, "solution id matches " + T.run.level.id);

    var applied = T.applySolution(li);
    log("L" + (li + 1), sol.name, "—", sol.note);
    log("  applied placed=" + applied.placed + " skipped=" + applied.skipped);

    // Empty solutions must place 0; runway solutions must place every piece.
    if (sol.pieces.length === 0) {
        assert(applied.placed === 0, "empty sol places nothing");
    } else {
        assert(applied.placed === sol.pieces.length,
            "all solution pieces placed (" + applied.placed + "/" + sol.pieces.length + ")");
        assert(applied.skipped === 0, "no skipped pieces");
    }

    T.enterRun();
    var sawRun = false;
    var done = waitFor(function () {
        var s = T.snapshot();
        if (s.mode === "run") sawRun = true;
        return T.screen === "complete";
    }, 20000, 50);

    for (var k = 0; k < 15 && T.screen !== "complete"; k++) {
        advanceTime(40);
        flush();
    }

    assert(sawRun, "entered run on " + sol.name);
    assert(done && T.screen === "complete", "SOLUTION WINS " + sol.name);
    var t = (T.run.resultMs || 0) / 1000;
    var medal = T.medalFor(t, T.run.level);
    results.push({ name: sol.name, t: t, medal: medal });
    log("  WIN " + t.toFixed(2) + "s  medal=" + medal);
}

// Empty Plank must still fail (skill gate).
T.resetProgress();
T.save.set("unlocked", 8);
T.save.set("coachDone", true);
T.save.set("plankCoachDone", true);
T.save.save();
T.startLevel(1);
advanceTime(80);
flush();
T.enterRun();
var saw = false;
var failed = waitFor(function () {
    var s = T.snapshot();
    if (s.mode === "run") saw = true;
    return saw && s.mode === "build";
}, 20000, 100);
assert(failed, "empty Plank Walk fails (skill gate intact)");
log("empty Plank fail ok");

// Plank coach visible for fresh players on L2
T.resetProgress();
T.save.set("unlocked", 2);
T.save.set("coachDone", true); // finished Drop-In coach
T.save.set("plankCoachDone", false);
T.save.save();
T.startLevel(1);
advanceTime(80);
flush();
var tip = document.getElementById("hud-action-text").textContent || "";
assert(
    tip.indexOf("Booster") >= 0 || tip.indexOf("pad") >= 0 || tip.indexOf("place") >= 0,
    "Plank coach teaches build/aim: " + tip
);
log("Plank coach:", tip);

log("========================================");
log("CAMPAIGN SOLUTIONS — all 8 verified:");
for (var r = 0; r < results.length; r++) {
    log("  " + (r + 1) + ". " + results[r].name + "  " + results[r].t.toFixed(2) + "s  " + results[r].medal);
}
log("========================================");
console.log("tumble campaign solutions ok");
