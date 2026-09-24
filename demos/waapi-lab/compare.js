// compare.js — the same motion three ways, measured side by side.
//
//   1. WAAPI      element.animate(COMPARE.keyframes, COMPARE.timing), started by
//                 main.js through the transport so Pause/Reverse/rate act on it
//   2. CSS        @keyframes waapiCompare in style.css, toggled by a class
//   3. rAF        this file writes style.transform every frame from the same
//                 keyframes and the same cubic-bezier
//
// The easing is PER KEYFRAME in all three. That matters: a CSS animation's
// timing function applies to each keyframe interval, while a WAAPI
// `options.easing` applies to the whole iteration. Putting the easing on the
// keyframes is what makes lane 1 the same motion as lane 2, and lane 3 then
// reproduces that interval-by-interval curve by hand.
//
// All three read bro's scaled clock (document.timeline / the engine's
// animation time), so bro.time pause and headless advanceTime move them
// together. The readout is the measured rotation of each lane, parsed back out
// of getComputedStyle — not the value the lane was asked for.

import { parseEasing, ease } from '/app/plotter.js';

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const STOPS = [
    { y: 0, r: 0, s: 1, c: [0x5c, 0x9d, 0xff] },
    { y: -30, r: 180, s: 1.15, c: [0xa8, 0x55, 0xf7] },
    { y: 0, r: 360, s: 1, c: [0x5c, 0x9d, 0xff] },
];
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const tf = (st) => `translateY(${st.y}px) rotate(${st.r}deg) scale(${st.s})`;

export const COMPARE = {
    duration: 2000,
    keyframes: STOPS.map((st) => ({ transform: tf(st), backgroundColor: hex(st.c), easing: EASE })),
    timing: { duration: 2000, iterations: Infinity },
};

const lanes = { waapi: null, css: null, raf: null };
let running = false, raf = 0, t0 = 0;
const E = parseEasing(EASE);

export function initCompare(nodes) { Object.assign(lanes, nodes); }

export function startCompare() {
    stopCompare();
    running = true;
    t0 = document.timeline.currentTime;
    lanes.css.classList.add('animating');
    const tick = () => {
        if (!running) return;
        applyRaf(document.timeline.currentTime - t0);
        raf = requestAnimationFrame(tick);
    };
    applyRaf(0);
    raf = requestAnimationFrame(tick);
}

export function stopCompare() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (lanes.css) lanes.css.classList.remove('animating');
    if (lanes.raf) { lanes.raf.style.transform = ''; lanes.raf.style.backgroundColor = ''; }
}

export const compareRunning = () => running;

function applyRaf(ms) {
    const f = (ms % COMPARE.duration) / COMPARE.duration;
    const seg = f < 0.5 ? 0 : 1;
    const k = ease(E, (f - seg * 0.5) / 0.5);
    const a = STOPS[seg], b = STOPS[seg + 1];
    const mix = (p, q) => p + (q - p) * k;
    lanes.raf.style.transform = tf({ y: mix(a.y, b.y), r: mix(a.r, b.r), s: mix(a.s, b.s) });
    lanes.raf.style.backgroundColor = hex(a.c.map((v, i) => mix(v, b.c[i])));
}

/** Rotation in degrees [0, 360) read back from computed style, or null. */
export function rotationOf(el) {
    const t = getComputedStyle(el).transform || '';
    let m = /rotate\((-?[\d.e+-]+)deg\)/.exec(t);
    if (m) return ((+m[1] % 360) + 360) % 360;
    m = /matrix\(\s*([-\d.e+]+)\s*,\s*([-\d.e+]+)/.exec(t);
    if (m) return ((Math.atan2(+m[2], +m[1]) * 180 / Math.PI) + 360) % 360;
    return t === 'none' || t === '' ? 0 : null;
}

/** { waapi, css, raf } rotations plus the largest pairwise gap (wrap-aware). */
export function measureCompare() {
    const r = { waapi: rotationOf(lanes.waapi), css: rotationOf(lanes.css), raf: rotationOf(lanes.raf) };
    const vals = [r.waapi, r.css, r.raf].filter((v) => v != null);
    let spread = 0;
    for (const a of vals) for (const b of vals) {
        const d = Math.abs(a - b);
        spread = Math.max(spread, Math.min(d, 360 - d));
    }
    r.spread = spread;
    return r;
}
