// time.js — the bro.time panel.
//
// bro.time is the Godot `Engine.time_scale` / `SceneTree.paused` analog: one
// engine-owned scaled clock that setTimeout, setInterval, requestAnimationFrame
// timestamps, performance.now(), CSS transitions/animations, physics, scene
// animations, AI agents, iframes AND secondary windows all run on. Pausing also
// suspends audio as a transport freeze; timescale deliberately does not touch
// audio, so nothing ever pitch-shifts.
//
// Every arcade game in this tree hand-rolls a `paused` flag and threads it
// through its update loop. None of them need to.
//
// The animation below integrates dt from the rAF TIMESTAMP, which is the scaled
// clock — so it obeys timescale without a single line of scale-aware code. The
// readout beside it compares elapsed scaled time against elapsed wall time
// (Date.now(), which bro.time never touches); the ratio between them is the
// timescale, measured rather than echoed back from the slider.

const canvas = document.getElementById('timeStage');
const ctx = canvas.getContext('2d');
const readoutEl = document.getElementById('timeReadout');
const scaleEl = document.getElementById('scale');
const scaleVEl = document.getElementById('scaleV');
const pauseBtn = document.getElementById('pause');
const timeModeEl = document.getElementById('timeMode');

// Baselines for the divergence measurement, re-zeroed whenever the user changes
// the scale so the ratio reflects the CURRENT setting rather than a lifetime
// average across every setting they have tried.
export const clocks = {
    wallStart: Date.now(),
    scaledStart: bro.time.now,
    wallElapsed: 0,
    scaledElapsed: 0,
    measuredRatio: 1,
    frames: 0,
};

export function rebase() {
    clocks.wallStart = Date.now();
    clocks.scaledStart = bro.time.now;
    clocks.wallElapsed = 0;
    clocks.scaledElapsed = 0;
}

// --- the subject -------------------------------------------------------------
// Balls under gravity with a rotating sweep hand behind them. Deliberately
// physical-looking: slow motion reads instantly on a bouncing ball in a way it
// never does on a spinner.

const BALLS = 7;
const balls = [];
for (let i = 0; i < BALLS; i++) {
    balls.push({
        x: 40 + i * 74,
        y: 30 + (i % 3) * 24,
        vx: (i % 2 ? 1 : -1) * (60 + i * 14),
        vy: 0,
        r: 7 + (i % 3) * 2,
        hue: 190 + i * 22,
        trail: [],
    });
}

let lastT = null;
let sweep = 0;

function step(dtSec) {
    const w = canvas.width, h = canvas.height;
    const g = 900;
    for (const b of balls) {
        b.vy += g * dtSec;
        b.x += b.vx * dtSec;
        b.y += b.vy * dtSec;
        if (b.y + b.r > h) { b.y = h - b.r; b.vy *= -0.86; }
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x + b.r > w) { b.x = w - b.r; b.vx = -Math.abs(b.vx); }
        b.trail.push([b.x, b.y]);
        if (b.trail.length > 26) b.trail.shift();
    }
    sweep += dtSec * 1.6;
}

function render() {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);

    // sweep hand — a second reading of the same clock
    const cx = w * 0.5, cy = h * 0.5, r = h * 0.42;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(159,214,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep - Math.PI / 2) * r, cy + Math.sin(sweep - Math.PI / 2) * r);
    ctx.stroke();

    for (const b of balls) {
        for (let i = 0; i < b.trail.length; i++) {
            const a = (i / b.trail.length) * 0.30;
            ctx.fillStyle = `hsla(${b.hue}, 80%, 62%, ${a})`;
            ctx.beginPath();
            ctx.arc(b.trail[i][0], b.trail[i][1], b.r * (0.35 + 0.6 * i / b.trail.length), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = `hsl(${b.hue}, 85%, 65%)`;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }

    if (bro.time.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 20px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED — rAF is not firing', cx, cy);
    }
}

/**
 * Per-frame tick, called from the app's single rAF loop with the rAF timestamp.
 * `t` is scaled engine time: at 0.25x it advances a quarter as fast per wall
 * second, which is the entire slow-motion effect, for free.
 */
export function tickTime(t) {
    if (lastT === null) lastT = t;
    // Clamp: the first frame after a long pause hands over a big delta.
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    clocks.frames++;
    step(dt);
    render();
    refreshTimeReadout();
}

export function refreshTimeReadout() {
    clocks.wallElapsed = Date.now() - clocks.wallStart;
    clocks.scaledElapsed = bro.time.now - clocks.scaledStart;
    clocks.measuredRatio = clocks.wallElapsed > 0
        ? clocks.scaledElapsed / clocks.wallElapsed : 0;

    const mode = bro.time.paused ? 'PAUSED' : bro.time.scale.toFixed(2) + '×';
    timeModeEl.textContent = mode;

    readoutEl.textContent =
        `bro.time.scale     ${bro.time.scale.toFixed(2)}      paused ${bro.time.paused}\n` +
        `bro.time.now       ${bro.time.now.toFixed(1)} ms  (scaled engine clock)\n` +
        `Date.now()         ${Date.now()}  (wall clock — never scaled)\n` +
        `since rebase       scaled ${clocks.scaledElapsed.toFixed(0)} ms  vs  ` +
            `wall ${clocks.wallElapsed} ms\n` +
        `measured ratio     ${clocks.measuredRatio.toFixed(3)}×  ` +
            `(this is the timescale, measured)\n` +
        `frames since       ${clocks.frames}` +
        (bro.time.paused
            ? '\n\nrAF callbacks are SKIPPED while paused, so this readout is\n' +
              'frozen at the moment of the pause — that is the demonstration.'
            : '');
}

// --- controls ----------------------------------------------------------------

export function setScale(v) {
    bro.time.scale = v;
    scaleEl.value = String(Math.round(v * 100));
    scaleVEl.textContent = v.toFixed(2) + '×';
    rebase();
    refreshTimeReadout();
}

/**
 * Set the scale WITHOUT re-zeroing the divergence baseline.
 *
 * The measured-ratio readout compares scaled elapsed against wall elapsed since
 * the last rebase, so anything that changes the scale every frame — the game's
 * slow-mo ramp — must not rebase, or the window being measured over is never
 * more than one frame long and the ratio reads as noise. The ramp wants the
 * ratio to sag and recover; that IS the measurement.
 */
export function rampScale(v) {
    bro.time.scale = v;
    scaleEl.value = String(Math.round(v * 100));
    scaleVEl.textContent = v.toFixed(2) + '×';
    refreshTimeReadout();
}

export function setPaused(p) {
    bro.time.paused = p;
    pauseBtn.textContent = p ? 'Resume' : 'Pause';
    pauseBtn.className = p ? 'on' : 'primary';
    rebase();
    // DOM events still dispatch while paused, so this repaint lands even though
    // rAF has stopped — which is exactly why a pause overlay built from
    // ordinary elements keeps working.
    refreshTimeReadout();
    render();
}

export function bindTimePanel() {
    pauseBtn.addEventListener('click', () => setPaused(!bro.time.paused));

    scaleEl.addEventListener('input', () => {
        setScale(scaleEl.value / 100);
    });

    const presets = document.querySelectorAll('#p-time .presets button');
    for (let i = 0; i < presets.length; i++) {
        const b = presets[i];
        b.addEventListener('click', () => {
            if (bro.time.paused) setPaused(false);
            setScale(parseFloat(b.dataset.scale));
        });
    }

    // Match the canvas backing store to its laid-out width once, so the balls
    // are not stretched by the CSS width:100%.
    if (canvas.clientWidth > 0) canvas.width = canvas.clientWidth;

    setScale(1);
    setPaused(false);
}
