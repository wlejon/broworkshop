// ui/automation.js — one layer's automation lane: a curve over the 4-beat
// loop that the sequencer plays into a bus parameter.
//
//   click empty space   add a point          drag a point   move it
//   right / ctrl-click  delete a point
//
// The curve drawn here is evaluated in JS with the same interpolation modes
// the native Sequence uses (linear, smooth = cosine, step = hold).

import { fitCanvas } from "/lib/kit/audio-ui.js";
import { AUTOMATION_TARGETS } from "../model/song.js";

const R = 4;            // point radius
const HIT = 8;          // grab distance, px
const BEATS = 4;

/** Value of a lane at `beat` (points sorted by beat). */
export function evaluateLane(points, beat, mode, def) {
    if (!points.length) return def;
    if (beat <= points[0].beat) return points[0].value;
    const last = points[points.length - 1];
    if (beat >= last.beat) return last.value;
    let i = 0;
    while (i < points.length - 2 && beat >= points[i + 1].beat) i++;
    const a = points[i], b = points[i + 1];
    if (mode === 'step') return a.value;
    let t = (beat - a.beat) / Math.max(1e-9, b.beat - a.beat);
    if (mode === 'smooth') t = (1 - Math.cos(t * Math.PI)) * 0.5;
    return a.value + t * (b.value - a.value);
}

/** Map a target value to 0..1 of the lane height (log for frequency). */
function norm(v, tgt) {
    if (tgt.log) return (Math.log(Math.max(v, tgt.min)) - Math.log(tgt.min)) / (Math.log(tgt.max) - Math.log(tgt.min));
    return (v - tgt.min) / (tgt.max - tgt.min);
}
function denorm(n, tgt) {
    n = Math.max(0, Math.min(1, n));
    if (tgt.log) return Math.exp(Math.log(tgt.min) + n * (Math.log(tgt.max) - Math.log(tgt.min)));
    return tgt.min + n * (tgt.max - tgt.min);
}

/**
 * Attach the lane editor to `canvas` for `lane` ({ target, interpMode,
 * points }). onEdit() after every change (the caller records it and resyncs
 * the sequencer). Handle: draw().
 */
export function automationLane(canvas, { lane, color, onEdit }) {
    let drag = -1;
    const size = () => ({ w: canvas.clientWidth || 1, h: canvas.clientHeight || 1 });
    const target = () => AUTOMATION_TARGETS[lane.target];
    const xy = (p, s) => ({ x: p.beat / BEATS * s.w, y: (1 - norm(p.value, target())) * s.h });
    const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const find = (pt, s) => lane.points.findIndex((p) => {
        const q = xy(p, s);
        return Math.abs(q.x - pt.x) < HIT && Math.abs(q.y - pt.y) < HIT;
    });

    function draw() {
        const { ctx, w, h } = fitCanvas(canvas);
        ctx.fillStyle = '#12121a';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let s = 0; s <= 16; s++) { const x = Math.round(s / 16 * w) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        ctx.stroke();
        const tgt = target();
        if (!tgt || !lane.points.length) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '10px system-ui';
            ctx.fillText('click to add points', 6, h / 2 + 3);
            return;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
            const v = evaluateLane(lane.points, x / w * BEATS, lane.interpMode, tgt.def);
            const y = (1 - norm(v, tgt)) * h;
            if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        for (const p of lane.points) {
            const q = xy(p, { w, h });
            ctx.beginPath();
            ctx.arc(q.x, q.y, R, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    const sort = () => lane.points.sort((a, b) => a.beat - b.beat);

    canvas.addEventListener('mousedown', (e) => {
        const tgt = target();
        if (!tgt) return;
        const s = size(), pt = local(e);
        const i = find(pt, s);
        e.preventDefault();
        if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
            if (i >= 0) { lane.points.splice(i, 1); draw(); onEdit(); }
            return;
        }
        if (e.button !== 0) return;
        if (i >= 0) { drag = i; return; }
        const p = { beat: Math.max(0, Math.min(BEATS, pt.x / s.w * BEATS)), value: denorm(1 - pt.y / s.h, tgt) };
        lane.points.push(p);
        sort();
        drag = lane.points.indexOf(p);
        draw();
        onEdit();
    });
    canvas.addEventListener('mousemove', (e) => {
        if (drag < 0) return;
        const s = size(), pt = local(e), p = lane.points[drag];
        p.beat = Math.max(0, Math.min(BEATS, pt.x / s.w * BEATS));
        p.value = denorm(1 - pt.y / s.h, target());
        draw();
    });
    const release = () => {
        if (drag < 0) return;
        const p = lane.points[drag];
        drag = -1;
        sort();
        if (p) onEdit();
    };
    canvas.addEventListener('mouseup', release);
    canvas.addEventListener('mouseleave', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    return { draw };
}
