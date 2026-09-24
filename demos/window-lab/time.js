// time.js — the bro.time panel.
//
// bro.time is the Godot `Engine.time_scale` / `SceneTree.paused` analog: one
// engine-owned scaled clock that setTimeout, setInterval, rAF timestamps,
// performance.now(), CSS transitions/animations, physics, scene animations,
// iframes AND secondary windows all run on. Pausing also freezes audio;
// timescale deliberately does not touch audio, so nothing pitch-shifts.
//
// The balls integrate dt from the rAF TIMESTAMP (the scaled clock), so they
// obey timescale with no scale-aware code. The readout compares scaled elapsed
// against wall elapsed (Date.now(), which bro.time never touches): their
// ratio is the timescale, measured rather than echoed from the slider.

import { readout } from "/lib/kit/index.js";

let canvas, ctx, ro, scaleEl, scaleVEl, pauseBtn;

// Baselines for the divergence measurement, re-zeroed on every scale change so
// the ratio reflects the CURRENT setting, not a lifetime average.
export const clocks = {
    wallStart: Date.now(), scaledStart: bro.time.now,
    wallElapsed: 0, scaledElapsed: 0, measuredRatio: 1, frames: 0,
};

export function rebase() {
    clocks.wallStart = Date.now();
    clocks.scaledStart = bro.time.now;
    clocks.wallElapsed = 0;
    clocks.scaledElapsed = 0;
}

// --- the subject: balls under gravity plus a sweep hand -----------------------
// Slow motion reads instantly on a bouncing ball in a way it never does on a spinner.

const balls = [];
for (let i = 0; i < 7; i++) {
    balls.push({
        x: 40 + i * 74, y: 30 + (i % 3) * 24,
        vx: (i % 2 ? 1 : -1) * (60 + i * 14), vy: 0,
        r: 7 + (i % 3) * 2, hue: 190 + i * 22, trail: [],
    });
}
let lastT = null, sweep = 0;

function step(dt) {
    const w = canvas.width, hgt = canvas.height;
    for (const b of balls) {
        b.vy += 900 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y + b.r > hgt) { b.y = hgt - b.r; b.vy *= -0.86; }
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x + b.r > w) { b.x = w - b.r; b.vx = -Math.abs(b.vx); }
        b.trail.push([b.x, b.y]);
        if (b.trail.length > 26) b.trail.shift();
    }
    sweep += dt * 1.6;
}

function render() {
    const w = canvas.width, hgt = canvas.height;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, hgt);

    const cx = w / 2, cy = hgt / 2, r = hgt * 0.42;       // sweep hand: a second reading of the clock
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
            const f = i / b.trail.length;
            ctx.fillStyle = `hsla(${b.hue}, 80%, 62%, ${f * 0.3})`;
            ctx.beginPath(); ctx.arc(b.trail[i][0], b.trail[i][1], b.r * (0.35 + 0.6 * f), 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `hsl(${b.hue}, 85%, 65%)`;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }

    if (bro.time.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, hgt);
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 20px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED — rAF is not firing', cx, cy);
    }
}

/** Per-frame tick with the rAF timestamp: scaled engine time. */
export function tickTime(t) {
    if (lastT === null) lastT = t;
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));   // clamp the post-pause jump
    lastT = t;
    clocks.frames++;
    step(dt);
    render();
    refreshTimeReadout();
}

export function refreshTimeReadout() {
    clocks.wallElapsed = Date.now() - clocks.wallStart;
    clocks.scaledElapsed = bro.time.now - clocks.scaledStart;
    clocks.measuredRatio = clocks.wallElapsed > 0 ? clocks.scaledElapsed / clocks.wallElapsed : 0;

    document.getElementById('timeMode').textContent = bro.time.paused ? 'PAUSED' : bro.time.scale.toFixed(2) + '×';
    ro.set({
        scale: `${bro.time.scale.toFixed(2)}   paused ${bro.time.paused}`,
        now: `${bro.time.now.toFixed(1)} ms (scaled)`,
        wall: `${Date.now()} (never scaled)`,
        since: `scaled ${clocks.scaledElapsed.toFixed(0)} ms vs wall ${clocks.wallElapsed} ms`,
        ratio: `${clocks.measuredRatio.toFixed(3)}×  (the timescale, measured)`,
        frames: clocks.frames + (bro.time.paused ? '  (frozen: rAF is skipped while paused)' : ''),
    });
}

function showScale(v) {
    scaleEl.value = String(Math.round(v * 100));
    scaleVEl.textContent = v.toFixed(2) + '×';
}

export function setScale(v) {
    bro.time.scale = v;
    showScale(v);
    rebase();
    refreshTimeReadout();
}

/**
 * Set the scale WITHOUT re-zeroing the divergence baseline: the slow-mo ramp
 * changes the scale every frame, and rebasing each time would shrink the
 * measured window to one frame. The ramp wants the ratio to sag and recover.
 */
export function rampScale(v) {
    bro.time.scale = v;
    showScale(v);
    refreshTimeReadout();
}

export function setPaused(p) {
    bro.time.paused = p;
    pauseBtn.textContent = p ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('active', p);
    rebase();
    // DOM events still dispatch while paused, so this repaint lands even
    // though rAF has stopped: why a pause overlay made of elements still works.
    refreshTimeReadout();
    render();
}

export function bindTimePanel() {
    canvas = document.getElementById('timeStage');
    ctx = canvas.getContext('2d');
    scaleEl = document.getElementById('scale');
    scaleVEl = document.getElementById('scaleV');
    pauseBtn = document.getElementById('pause');
    ro = readout('#timeReadout', {
        scale: 'bro.time.scale', now: 'bro.time.now', wall: 'Date.now()',
        since: 'since rebase', ratio: 'measured ratio', frames: 'frames',
    });

    pauseBtn.addEventListener('click', () => setPaused(!bro.time.paused));
    scaleEl.addEventListener('input', () => setScale(scaleEl.value / 100));
    for (const b of document.querySelectorAll('#timePresets button')) {
        b.addEventListener('click', () => {
            if (bro.time.paused) setPaused(false);
            setScale(parseFloat(b.dataset.scale));
        });
    }
    // Match the backing store to the laid-out width so the balls are not stretched.
    if (canvas.clientWidth > 0) canvas.width = canvas.clientWidth;

    setScale(1);
    setPaused(false);
}
