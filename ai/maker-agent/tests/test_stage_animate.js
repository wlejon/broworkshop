// Deterministic, no-network check that the managed animation hook draws onto the
// SAME canvas `look` captures — the fix for the agent creating its own hidden
// canvas. Run: bro-headless <app> tests/test_stage_animate.js
advanceTime(50); flush();

function nonWhiteFraction() {
    const cap = window.__makerDebug.captureStage();
    assert(cap && cap.imageData, "captureStage returned imageData");
    const d = cap.imageData.data;
    let nonWhite = 0, total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++;
    }
    return nonWhite / total;
}

// 1. Blank stage reads as white.
window.__makerDebug.clearStage();
flush();
const blank = nonWhiteFraction();
assert(blank < 0.01, "blank stage is white (got " + blank.toFixed(3) + ")");

// 2. stageAnimate draws a spectrum onto stageCanvas — visible to look immediately
//    (first frame is synchronous), no self-created canvas.
let frames = 0;
stageAnimate((t) => {
    frames++;
    stageCtx.fillStyle = "#0a0a1a";
    stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
    const bars = 64, bw = stageCanvas.width / bars;
    for (let i = 0; i < bars; i++) {
        const h = (Math.sin(i * 0.4 + t) * 0.5 + 0.5) * stageCanvas.height * 0.8;
        stageCtx.fillStyle = `hsl(${i * 4}, 80%, 55%)`;
        stageCtx.fillRect(i * bw, stageCanvas.height - h, bw * 0.8, h);
    }
});
flush();
const drawn = nonWhiteFraction();
assert(frames >= 1, "drawFrame ran (frames=" + frames + ")");
assert(drawn > 0.5, "animation is visible on the captured stage (got " + drawn.toFixed(3) + ")");

// 3. querySelectorAll('canvas') is unchanged — the agent did NOT create a canvas.
const canvasCount = document.querySelectorAll("canvas").length;
assert(canvasCount === 1, "no extra canvas created (found " + canvasCount + ")");

// 4. stageStop halts the loop: frame count freezes after a few ticks.
stageStop();
const at = frames;
advanceTime(200); flush(); advanceTime(200); flush();
assert(frames === at, "stageStop halted the loop (was " + at + ", now " + frames + ")");

// 5. A new stageAnimate supersedes the previous (no stacking).
let a = 0, b = 0;
stageAnimate(() => { a++; });
stageAnimate(() => { b++; });   // cancels the first
const aAfter = a;
advanceTime(100); flush(); advanceTime(100); flush();
assert(a === aAfter, "first animation was superseded (a froze at " + aAfter + ")");
assert(b >= 1, "second animation is running (b=" + b + ")");
stageStop();

console.log("STAGE ANIMATE PASSED: managed animation draws on the captured canvas, stops, and never stacks.");
