// The hard-line finder's scan of one scenario: every `every`th step of the
// run measured on the mesh (lab/seams.js), then the frames where the mesh
// is worst, and frames spread evenly over the run, looked at from the live
// view's cameras (lab/shots.js), so a site is ranked by the line a viewer
// sees. Also the body's shape without a reference: how many pieces it is
// and where they cross at rest, each closed piece's volume through the run,
// and how far the skin pulls from or into its bone.
//
// The scan is written as <out>/finder/<scenario>.json; lab/finder-out.js
// ranks every scanned scenario's moments and draws the worst.

import { runScenario } from "./run.js";
import { relativePose } from "./cycle.js";
import { restPose } from "./skeleton.js";
import { skinPositions } from "./form.js";
import { measureMesh, pieceVolume, pieceClosed, seamTopology } from "./seams.js";
import { setPose, orbitView, showGround } from "./lit.js";
import { imageLines } from "./shots.js";
import { screenRay } from "/lib/kit/viewport3d.js";

// The cameras a scan looks from: the live view's distance and height, at
// the creature's sides and quarters (yaw 90 is its left, +X).
export const SCAN_VIEWS = [
    { name: 'left', yaw: 90 }, { name: 'front-left', yaw: 35 }, { name: 'back-left', yaw: 145 }, { name: 'right', yaw: -90 },
];
export const SCAN = { W: 960, H: 640, dist: 3.0, pitch: 8, target: [0, 0.72, 0.0], frames: 8, worst: 6 };

const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

// The scan cameras are set for a deer (SCAN); a smaller creature's come in
// by its size, aimed at its own middle, so it fills the frame as a deer
// does (at 3 m a rabbit is a few pixels, and the deer's aim is over its back).
export function scanScale(creature) {
    const s = creature.def.scale || {};
    return { len: Math.min(1, (s.length || 1.6) / 1.6), h: Math.min(1, (s.height || 0.95) / 0.95) };
}

export function scanView(v, creature) {
    const f = scanScale(creature);
    const target = [SCAN.target[0], SCAN.target[1] * f.h, SCAN.target[2]];
    return { ...orbitView(target, v.yaw, SCAN.pitch, SCAN.dist * f.len), name: v.name };
}

// The body at rest: its pieces and the curves where they cross.
export function restShape(creature) {
    const P = restPose(creature.skel);
    const m = measureMesh(creature, skinPositions(creature, P), P, 0);
    const topo = seamTopology(creature);
    return {
        pieces: topo.pieces.map((p, i) => ({ name: p.name, kind: p.kind, triangles: (p.end - p.start) / 3, closed: pieceClosed(creature, i) })),
        crossings: m.sites.filter((s) => s.kind === 'cross').map((s) => ({ pieces: `${s.a} x ${s.b}`, cm: r1(100 * s.length), meanAngle: s.meanAngle, angleMax: s.angleMax, score: s.score })),
        folds: m.sites.filter((s) => s.kind !== 'cross').map((s) => ({ key: s.key, cm: r1(100 * s.length), score: s.score })),
    };
}

// Scan one scenario. opts: every (steps, 4), frames (even image frames),
// worst (image frames from the mesh's worst), views (SCAN_VIEWS), seed.
export function scanScenario(creature, scName, opts = {}) {
    const t0 = Date.now();
    const every = opts.every || 4;
    const rec = runScenario(creature, scName, { seed: opts.seed || 1 });
    const rel = new Float32Array(rec.poseStride);
    const topo = seamTopology(creature);
    const closed = topo.pieces.map((p, i) => (pieceClosed(creature, i) ? i : -1)).filter((i) => i >= 0);
    const P0 = restPose(creature.skel);
    const X0 = skinPositions(creature, P0);
    const vol0 = closed.map((i) => pieceVolume(X0, creature.body.indices, topo.pieces[i]));
    const volume = Object.fromEntries(closed.map((i) => [topo.pieces[i].name, { min: Infinity, max: -Infinity, minT: 0, maxT: 0 }]));
    const pull = {};
    const frames = [];
    for (let k = 0; k < rec.steps; k += every) {
        const P = relativePose(rec, k, 0, rel);
        const X = skinPositions(creature, P);
        const m = measureMesh(creature, X, P, 0);
        const t = k * rec.dt;
        closed.forEach((i, j) => {
            const v = pieceVolume(X, creature.body.indices, topo.pieces[i]) / vol0[j], s = volume[topo.pieces[i].name];
            if (v < s.min) { s.min = v; s.minT = t; }
            if (v > s.max) { s.max = v; s.maxT = t; }
        });
        for (const [label, r] of Object.entries(m.pull)) {
            const s = pull[label] || (pull[label] = { min: Infinity, max: -Infinity, minT: 0, maxT: 0 });
            if (r.min < s.min) { s.min = r.min; s.minT = t; }
            if (r.max > s.max) { s.max = r.max; s.maxT = t; }
        }
        frames.push({ k, t: r3(t), total: r1(m.sites.reduce((a, s) => a + s.score, 0)), sites: m.sites.slice(0, 16) });
    }
    const meshMs = Date.now() - t0;
    // The frames to look at: the mesh's worst, apart by 0.2 s, and even ones.
    const pick = new Set();
    const byTotal = [...frames].sort((a, b) => b.total - a.total);
    const gap = Math.round(0.2 / rec.dt);
    for (const f of byTotal) {
        if ([...pick].filter((k) => Math.abs(k - f.k) < gap).length) continue;
        pick.add(f.k);
        if (pick.size >= (opts.worst ?? SCAN.worst)) break;
    }
    const nEven = opts.frames ?? SCAN.frames;
    for (let i = 0; i < nEven; i++) pick.add(frames[Math.floor(((i + 0.5) / nEven) * frames.length)].k);
    const views = (opts.views || SCAN_VIEWS).map((v) => scanView(v, creature));
    const looks = [];
    for (const k of [...pick].sort((a, b) => a - b)) {
        const P = relativePose(rec, k, 0, rel);
        const X = skinPositions(creature, P);
        setPose(creature, P);
        showGround(true);
        const look = { k, t: r3(k * rec.dt), views: {} };
        for (const view of views) {
            const r = imageLines(creature, X, view, SCAN.W, SCAN.H);
            const sites = [...r.sites.values()].sort((a, b) => b.score - a.score).slice(0, 14).map((s) => {
                // The site's centre in the world: the pixels' centre at their distance.
                const xi = Math.max(0, Math.min(SCAN.W - 1, Math.round(s.x))), yi = Math.max(0, Math.min(SCAN.H - 1, Math.round(s.y)));
                const d = nearestDepth(r.planes, xi, yi);
                const ray = screenRay(view, SCAN.W, SCAN.H, s.x, s.y);
                return { key: s.key, kind: s.kind, cm: r1(s.cm), score: r1(s.score), angleMax: Math.round(s.angleMax), x: Math.round(s.x), y: Math.round(s.y),
                         centre: d ? ray.origin.map((o, q) => r3(o + ray.dir[q] * d)) : null };
            });
            look.views[view.name] = { sites, kinks: r.kinks.length };
        }
        looks.push(look);
    }
    const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, { min: r3(s.min), minT: r3(s.minT), max: r3(s.max), maxT: r3(s.maxT) }]));
    return {
        creature: creature.label, scenario: scName, dt: rec.dt, steps: rec.steps, every, views: views.map((v) => ({ name: v.name, yaw: v.yaw })),
        frames, looks, volume: fin(volume), pull: fin(pull), ms: { mesh: meshMs, total: Date.now() - t0 },
    };
}

// The distance at (x, y), or at the nearest body pixel within 6 px.
function nearestDepth(D, x, y) {
    for (let r = 0; r <= 6; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const xx = x + i, yy = y + j;
        if (xx < 0 || yy < 0 || xx >= D.W || yy >= D.H) continue;
        const d = D.depth[yy * D.W + xx];
        if (d) return d;
    }
    return 0;
}
