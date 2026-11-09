// The watch sheet: one run from one side, in a few frames large enough to
// judge by eye. It is what a motion is looked at in before any measure of
// it is read.
//
// A picture read whole has only so many pixels, and a sheet of forty cells
// gives each a fortieth of them: a creature a hundred pixels tall, in which
// a missing arm or a body that never shifts its weight cannot be seen. So
// this draws at most WATCH.frames frames of one scenario from one view, the
// creature filling each, and is run again for another view or another part
// of the cycle; it does not take more and shrink them.
//
// The frames are consecutive (even steps through one cycle, or through
// `span` of it from `from`; a run without a cycle is cut by time), and each
// carries what a still alone does not show:
//
//   camera   one camera for all of them, held where the creature stands at
//            its steady pace (not on its hips): the rise and fall, the sway
//            and the lean are in the picture
//   ghost    the outline of the frame before, so what moved since, and how
//            far, is seen in each
//   lines    a plumb line through where it stands and level lines at the
//            rest heights of its hips and head, to read lean, sway and
//            height against
//   feet     under each frame, which feet are down

import { lastCycle, relativePose, rootOf, planted } from "./cycle.js";
import { groundHeights } from "./run.js";
import { setPose, capture, orbitView, showGround, project } from "./lit.js";
import { debugPlanes } from "./shots.js";
import { boneHead, boneTail } from "./skeleton.js";
import { T, TELE } from "./contract.js";
import { beginSheet, saveSheet, text, rect, line, DIM } from "./page.js";

export const WATCH = {
    frames: 6,     // the most frames a sheet holds
    wide: 1548,    // px of frames across a sheet
    tall: 1400,    // px of frames down it
    fill: 0.84,    // share of a frame the creature's reach through the frames takes
};

export const WATCH_VIEWS = {
    side: { yaw: 90, pitch: 3 },
    front: { yaw: 0, pitch: 3 },
    back: { yaw: 180, pitch: 3 },
    'front-quarter': { yaw: 40, pitch: 10 },
    'back-quarter': { yaw: 140, pitch: 10 },
    top: { yaw: 0, pitch: 89 },
};

const GHOST = [31, 111, 208];

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
}

// The creature's pixels in `view`.
function maskOf(view, W, H) {
    const id = debugPlanes(view, W, H).piece;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = id[i] >= 0 ? 1 : 0;
    return m;
}

// The edge of mask m drawn into img, two pixels wide.
function outline(img, m, W, H, rgb) {
    const d = img.data;
    const put = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = 4 * (y * W + x);
        for (let k = 0; k < 3; k++) d[o + k] = Math.round(0.25 * d[o + k] + 0.75 * rgb[k]);
    };
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (m[i] && !(m[i - 1] && m[i + 1] && m[i - W] && m[i + W])) { put(x, y); put(x + 1, y); put(x, y + 1); }
    }
}

// The steps drawn: { step, label } for each frame, and the step before the first.
function framesOf(rec, cyc, n, { from, span, to }) {
    const clampStep = (s) => Math.max(0, Math.min(rec.steps - 1, Math.round(s)));
    if (cyc) {
        const f0 = from ?? 0, sp = span ?? 1, len = cyc.b - cyc.a;
        const at = (i) => clampStep(cyc.a + (f0 + (i * sp) / n) * len);
        const phase = (i) => { const p = f0 + (i * sp) / n; return p - Math.floor(p + 5e-4); };
        return {
            frames: Array.from({ length: n }, (_, i) => ({ step: at(i), label: `phase ${Math.abs(phase(i)).toFixed(2)}` })),
            before: at(-1), every: (sp * cyc.period) / n,
        };
    }
    const t0 = from ?? 0, t1 = to ?? rec.steps * rec.dt, gap = (t1 - t0) / n;
    const at = (i) => clampStep((t0 + (i + 0.5) * gap) / rec.dt);
    return { frames: Array.from({ length: n }, (_, i) => ({ step: at(i), label: `t ${(at(i) * rec.dt).toFixed(2)} s` })), before: at(-1), every: gap };
}

export function watchSheet(rec, { path, view = 'side', frames = WATCH.frames, from = null, span = null, to = null } = {}) {
    const t0 = Date.now();
    const V = WATCH_VIEWS[view];
    if (!V) throw new Error(`watch: no view '${view}' (have ${Object.keys(WATCH_VIEWS).join(', ')})`);
    if (!(frames >= 1 && frames <= WATCH.frames)) throw new Error(`watch: 1 to ${WATCH.frames} frames a sheet (asked ${frames}): more would be too small to judge; draw another part of the cycle with --from and --span`);
    const creature = rec.creature, skel = creature.skel;
    // A run that turns where it stands is not a cycle seen from a camera
    // that turns with it (which shows no turn at all): it is drawn through
    // its whole length from a camera that stays where it began.
    const first = rootOf(rec, 0), last = rootOf(rec, rec.steps - 1);
    const turned = Math.abs(Math.atan2(Math.sin(last.yaw - first.yaw), Math.cos(last.yaw - first.yaw)));
    const turns = turned > 0.6 && rec.scenario.track.every((key) => !key.speed);
    const cyc = turns ? null : lastCycle(rec);
    const F = framesOf(rec, cyc, frames, { from, span, to });
    const poseAt = (step) => {
        const r = rootOf(rec, step);
        return relativePose(rec, step, groundHeights(rec.env, new Float32Array([r.x, r.z]))[0], new Float32Array(rec.poseStride), 0, turns ? first : null);
    };
    const poses = F.frames.map((f) => poseAt(f.step));
    const before = poseAt(F.before);

    // One camera: everything the bones reach through the frames, on the
    // ground, fills the frame.
    const lo = [Infinity, 0, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const P of [...poses, before]) for (const b of skel.bones) for (const p of [boneHead(P, 0, b.index), boneTail(P, 0, b)]) {
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    const mid = lo.map((v, k) => (v + hi[k]) / 2);
    const yw = (V.yaw * Math.PI) / 180, top = V.pitch > 60;
    const across = (Math.abs(Math.cos(yw)) * (hi[0] - lo[0]) + Math.abs(Math.sin(yw)) * (hi[2] - lo[2])) / 2;
    const up = top ? (Math.abs(Math.sin(yw)) * (hi[0] - lo[0]) + Math.abs(Math.cos(yw)) * (hi[2] - lo[2])) / 2 : (hi[1] - lo[1]) / 2;
    // The frames are shaped to what they hold (a tall creature from the
    // front gets tall frames) and laid out in the columns that draw it
    // largest. (The skin stands off the bones: a tenth more, and no frame
    // narrower than 0.45 of its height or wider than 2.2.)
    const LAB = 30, TM = 78, GAP = 6;
    const shape = Math.max(0.45, Math.min(2.2, across / up));
    let cols = 1, cw = 0, ch = 0;
    for (let c = 1; c <= frames; c++) {
        const r = Math.ceil(frames / c);
        const h = Math.min(Math.floor(WATCH.tall / r) - LAB, Math.floor((WATCH.wide - (c - 1) * GAP) / c / shape));
        if (h > ch) { cols = c; ch = h; cw = Math.round(h * shape); }
    }
    const rows = Math.ceil(frames / cols), cell = ch;
    const fov = 18;
    const dist = (1.1 * Math.max(up, across / shape)) / WATCH.fill / Math.tan((fov * Math.PI) / 360);
    const cam = orbitView(mid, V.yaw, V.pitch, dist, fov);
    const W = Math.max(900, 12 + cols * cw + (cols - 1) * GAP), H = TM + rows * (ch + LAB) + 8;

    showGround(true);
    setPose(creature, before);
    let prev = maskOf(cam, cw, ch);
    const shots = poses.map((P) => {
        setPose(creature, P);
        const img = capture(cam, cw, ch);
        const m = maskOf(cam, cw, ch);
        outline(img, prev, cw, ch, GHOST);
        prev = m;
        return img;
    });

    // The lines: where it stands, and the rest heights of its hips and head.
    const track = (name) => { const t = skel.tracks.find((x) => x.name === name); if (!t) return null; const b = skel.bones[t.boneIndex]; return b.head[1] + (b.tail[1] - b.head[1]) * t.at; };
    const levels = [['hips at rest', track('hips')], ['head at rest', track('head')]].filter((l) => l[1] != null);
    const feet = skel.feet;
    const k0 = F.frames[0].step * TELE;
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · watch · ${view}`, 12, 30, { size: 22, weight: 700 });
    text(g, `${rec.scenario.about || ''} — ${cyc ? `cycle ${cyc.period.toFixed(3)} s, ` : ''}${rec.tele[k0 + T.SPEED].toFixed(2)} m/s, a frame every ${(1000 * F.every).toFixed(0)} ms; one camera, ${turns ? 'staying where the creature began (it turns on the spot)' : 'standing where the creature does at its steady pace'}`, 12, 52, { size: 14, color: DIM });
    text(g, 'blue outline: the frame before · plumb line: where it stands · level lines: its hips and head at rest · ▼ foot down △ up', 12, 70, { size: 13, color: DIM });
    F.frames.forEach((f, i) => {
        const x0 = 6 + (i % cols) * (cw + GAP), y0 = TM + Math.floor(i / cols) * (ch + LAB);
        g.drawImage(toCanvas(shots[i]), x0, y0);
        if (!top) {
            const a = project(cam, cw, ch, [0, 0, 0]), b = project(cam, cw, ch, [0, hi[1] * 1.05, 0]);
            line(g, x0 + a.x, y0 + a.y, x0 + b.x, y0 + b.y, 'rgba(20,20,20,0.55)', 1, [5, 5]);
            // (Two lines close together, as a low creature's are: the lower
            // one's name goes under it, so the names do not run together.)
            const ys = levels.map(([, h]) => project(cam, cw, ch, [0, h, 0]).y);
            const close = ys.length === 2 && Math.abs(ys[0] - ys[1]) < 18;
            levels.forEach(([name], j) => {
                line(g, x0, y0 + ys[j], x0 + cw, y0 + ys[j], 'rgba(20,20,20,0.4)', 1, [2, 6]);
                const under = close && ys[j] === Math.max(...ys);
                if (i === 0) text(g, name, x0 + 6, y0 + ys[j] + (under ? 13 : -4), { size: 11, color: '#333' });
            });
        }
        const down = feet.map((ft, k) => `${ft.name}${planted(rec, f.step, k) ? '▼' : '△'}`).join(' ');
        text(g, f.label, x0 + 4, y0 + ch + 20, { size: 15, weight: 700 });
        text(g, down, x0 + cw - 4, y0 + ch + 20, { size: 13, color: DIM, align: 'right' });
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0, cell };
}
