// The finder's and the naturalness measures measure what they say.
//   seams     two crossing tubes cross along the curves where they meet, at the
//             angle between their surfaces; parallel tubes do not; a closed
//             tube's volume is its prism's
//   deer      the rest body is one closed skin with no crossing or fold; the
//             debug views decode (the body is piece 0, depths are distances
//             from the eye) and the image finds no seam
//   flesh     a blob meshes to its ellipsoid's volume and sections; two
//             limbs on two bones blend into one skin whose weights hand from
//             one bone to the other, and the masses' volumes sum to the body's
//   natural   on a deer run with a defect put in: a corner in a joint's speed
//             is a kink, noise on a joint is jitter, a body raised along a
//             line in the air is flight off free fall gaining energy, and the
//             same height on a free-fall arc is not
//   scripts/validate.sh tools/creature-lab/tests/test_measures.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { loadCreature } from "/app/lab/creature.js";
import { runScenario, scenarioOf } from "/app/lab/run.js";
import { series } from "/app/lab/analyze.js";
import { restPose } from "/app/lab/skeleton.js";
import { skinPositions, massVolumes, cutSection } from "/app/lab/form.js";
import { Flesh } from "/app/lab/flesh.js";
import { measureMesh, pieceVolume, pieceClosed } from "/app/lab/seams.js";
import { setPose } from "/app/lab/lit.js";
import { debugPlanes, imageLines } from "/app/lab/shots.js";
import { restShape, scanView, SCAN, SCAN_VIEWS } from "/app/lab/finder.js";
import { NATURAL, smoothness, variety, massPhysics, steadyCycles } from "/app/lab/natural.js";

globalThis.creatureLab?.dispose?.();

// --- a body of tubes -------------------------------------------------------------

// A capped tube: centre c, unit axis a, radius r, length L, n sides.
function tube(c, a, r, L, n = 24, rings = 24) {
    const u = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const e1 = cross(a, u), l1 = Math.hypot(...e1), E1 = e1.map((v) => v / l1), E2 = cross(a, E1);
    const P = [], T = [];
    for (let j = 0; j <= rings; j++) {
        const s = (j / rings - 0.5) * L;
        for (let i = 0; i < n; i++) {
            const t = (2 * Math.PI * i) / n, ct = Math.cos(t) * r, st = Math.sin(t) * r;
            P.push([0, 1, 2].map((k) => c[k] + a[k] * s + E1[k] * ct + E2[k] * st));
        }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < n; i++) {
        const p = j * n + i, q = j * n + (i + 1) % n;
        T.push([p, q, q + n], [p, q + n, p + n]);
    }
    const c0 = P.length, c1 = c0 + 1;
    P.push(c.map((v, k) => v - a[k] * L / 2), c.map((v, k) => v + a[k] * L / 2));
    for (let i = 0; i < n; i++) {
        T.push([c0, (i + 1) % n, i]);
        T.push([c1, rings * n + i, rings * n + (i + 1) % n]);
    }
    return { P, T };
}

// A one-bone creature of the given tubes, each its own piece.
function tubeCreature(tubes) {
    const pos = [], idx = [], pieceOf = [], pieces = [];
    tubes.forEach((tb, i) => {
        const base = pos.length / 3, start = idx.length;
        for (const p of tb.P) { pos.push(...p); pieceOf.push(i); }
        for (const t of tb.T) idx.push(base + t[0], base + t[1], base + t[2]);
        pieces.push({ name: `tube${i}`, kind: 'loft', start, end: idx.length, count: tb.P.length });
    });
    const bone = { name: 'bone', index: 0, parentIndex: -1, head: [-1, 0, 0], tail: [1, 0, 0] };
    return {
        skel: { bones: [bone], count: 1 },
        body: {
            positions: Float32Array.from(pos), indices: Uint32Array.from(idx), pieces, piece: Float32Array.from(pieceOf),
            weights: pieceOf.map(() => [{ index: 0, w: 1 }]),
        },
    };
}

await test('seams: crossing tubes, parallel tubes, a closed tube', () => {
    const X = (c) => c.body.positions;
    // A 5 cm tube through a 10 cm one, square to it: it crosses in and out,
    // two loops a little over its own circumference each.
    const cr = tubeCreature([tube([0, 0, 0], [1, 0, 0], 0.1, 1), tube([0, 0, 0], [0, 1, 0], 0.05, 0.6)]);
    const m = measureMesh(cr, X(cr));
    const s = m.sites.find((x) => x.kind === 'cross');
    check(s, 'crossing found');
    eq(s.key, 'cross tube0 x tube1', 'crossing key');
    check(s.length > 0.55 && s.length < 0.8, `crossing ${s.length} m long, expected about 0.66`);
    // The surfaces meet at 60-90 degrees round the loop (acos(sin^2 / 2)).
    check(s.meanAngle > 60 && s.meanAngle < 90, `mean angle ${s.meanAngle}`);
    check(s.angleMax > 80, `sharpest ${s.angleMax}`);
    check(Math.abs(s.centre[0]) < 0.01 && Math.abs(s.centre[2]) < 0.01, `centre ${s.centre}`);
    check(!m.sites.some((x) => x.kind === 'fold' || x.kind === 'crease'), 'nothing else at rest');

    const par = tubeCreature([tube([0, 0, 0], [1, 0, 0], 0.1, 1), tube([0, 0, 0.3], [1, 0, 0], 0.1, 1)]);
    eq(measureMesh(par, X(par)).sites.length, 0, 'parallel tubes draw no line');

    // Closed, and the volume of its 24-sided prism.
    const one = tubeCreature([tube([0, 0, 0], [1, 0, 0], 0.1, 1)]);
    check(pieceClosed(one, 0), 'capped tube is closed');
    const want = 12 * 0.01 * Math.sin(Math.PI / 12);
    const v = pieceVolume(X(one), one.body.indices, one.body.pieces[0]);
    check(Math.abs(v - want) / want < 0.01, `volume ${v} against ${want}`);
});

// --- the deer -----------------------------------------------------------------------

const deer = await loadCreature('deer');

await test('deer at rest: one skin, and the debug views', () => {
    const rs = restShape(deer);
    eq(rs.pieces.length, 1, 'the body is one piece');
    check(rs.pieces[0].closed, 'and closed');
    eq(rs.crossings.length, 0, 'nothing crosses at rest');
    eq(rs.folds.length, 0, 'nothing folds at rest');

    const P = restPose(deer.skel), X = skinPositions(deer, P);
    setPose(deer, P);
    const view = scanView(SCAN_VIEWS[0]);
    const D = debugPlanes(view, SCAN.W, SCAN.H);
    let body = 0, zero = 0, near = 0, far = 0;
    for (let i = 0; i < D.piece.length; i++) {
        if (D.piece[i] < 0) continue;
        body++;
        if (D.piece[i] === 0) zero++;
        if (D.depth[i] < 2.4) near++;
        if (D.depth[i] > 3.6) far++;
    }
    check(body > 0.05 * SCAN.W * SCAN.H, `body covers ${body} px`);
    check(zero > 0.99 * body, `piece 0 is ${Math.round((100 * zero) / body)}% of the body`);
    // Seen from 3 m, the body lies within its own half-width of that.
    check(near + far < 0.01 * body, `${near} px nearer than 2.4 m, ${far} farther than 3.6 m`);
    // The centre column of the body faces the camera (the left side: +X).
    const cx = SCAN.W >> 1;
    let nx = 0, nn = 0;
    for (let y = 0; y < SCAN.H; y++) { const i = y * SCAN.W + cx; if (D.piece[i] === 0) { nx += D.normal[3 * i]; nn++; } }
    check(nn > 0 && nx / nn > 0.5, `the body under the centre column faces the eye (mean normal x ${(nx / nn).toFixed(2)})`);

    const L = imageLines(deer, X, view, SCAN.W, SCAN.H, D);
    eq([...L.sites.values()].filter((s) => s.kind === 'cross').length, 0, 'no seam seen between pieces');
});

// --- flesh: masses blended into one skin -------------------------------------------

await test('flesh: a blob is its ellipsoid, two blend into one skin, volumes add up', () => {
    const skel = { count: 2, index: (n) => ({ a: 0, b: 1 })[n], bones: [
        { name: 'a', index: 0, head: [0, 0, -0.5], tail: [0, 0, 0] }, { name: 'b', index: 1, head: [0, 0, 0], tail: [0, 0, 0.5] }] };
    const one = new Flesh(skel, { triangles: 6000 });
    one.blob('egg', 'a', [0, 0, 0], [0.1, 0.15, 0.2], { blend: 0.02 });
    const b1 = one.build();
    const c1 = { skel, body: b1 };
    const want = (4 / 3) * Math.PI * 0.1 * 0.15 * 0.2;
    const v1 = massVolumes(c1, b1.positions);
    check(Math.abs(v1.body - want) / want < 0.02, `blob volume ${v1.body.toFixed(5)} against ${want.toFixed(5)}`);
    const cut = cutSection(c1, b1.positions, { at: [0, 0, 0], normal: [0, 0, 1], bones: [0], radius: 0.3 });
    check(Math.abs(cut.width - 0.2) < 0.004 && Math.abs(cut.depth - 0.3) < 0.004, `section ${cut.width.toFixed(3)} x ${cut.depth.toFixed(3)}`);

    // Two capsules end to end on two bones: one closed skin, its weights
    // handing from a to b across the blend, and the masses' volumes summing
    // to the body's.
    const two = new Flesh(skel, { triangles: 8000 });
    two.limb('back', ['a'], [{ c: [0, 0, -0.45], r: 0.08 }, { c: [0, 0, 0.02], r: 0.08 }], { blend: 0.03 });
    two.limb('front', ['b'], [{ c: [0, 0, -0.02], r: 0.06 }, { c: [0, 0, 0.45], r: 0.06 }], { blend: 0.03 });
    const b2 = two.build();
    const c2 = { skel, body: b2 };
    const rs = measureMesh(c2, b2.positions);
    eq(rs.sites.length, 0, 'one skin: no crossing, no fold');
    const v2 = massVolumes(c2, b2.positions);
    const sum = v2.masses.reduce((s, v) => s + v, 0);
    check(Math.abs(sum - v2.body) / v2.body < 1e-3, `masses ${sum.toFixed(5)} sum to the body's ${v2.body.toFixed(5)}`);
    const wb = (z) => {
        let best = null;
        for (let v = 0; v < b2.vertices; v++) if (!best || Math.abs(b2.positions[3 * v + 2] - z) < Math.abs(b2.positions[3 * best + 2] - z)) best = v;
        return (b2.weights[best].find((x) => x.index === 1) || { w: 0 }).w;
    };
    check(wb(-0.3) < 0.05 && wb(0.3) > 0.95, `ends on their own bones (${wb(-0.3).toFixed(2)}, ${wb(0.3).toFixed(2)})`);
    check(wb(0) > 0.2 && wb(0) < 0.8, `the joint shared (${wb(0).toFixed(2)})`);
});

// --- natural, with defects put in -------------------------------------------------

const walk = runScenario(deer, { ...scenarioOf(deer, 'walk'), duration: 12 }, { seed: 1 });

// A copy of a run with its poses changed: fn(pose, k, offset) per step.
function tampered(rec, fn) {
    const pose = Float32Array.from(rec.pose);
    for (let k = 0; k < rec.steps; k++) fn(pose, k, k * rec.poseStride);
    return { ...rec, pose, _series: undefined };
}

// Turn bone b's world rotation about its own x axis by th (radians).
function turnBone(P, o, b, th) {
    const q = o + 12 * b, c = Math.cos(th), s = Math.sin(th);
    for (let r = 0; r < 3; r++) {
        const y = P[q + 4 * r + 1], z = P[q + 4 * r + 2];
        P[q + 4 * r + 1] = y * c + z * s;
        P[q + 4 * r + 2] = -y * s + z * c;
    }
}

await test('natural: a corner in a joint\'s speed is a kink', () => {
    // The walk's calmest joint (least acceleration off its neighbours').
    const name = [...smoothness(walk).joints].sort((a, b) => a.medAcc - b.medAcc)[0].bone;
    const bone = deer.skel.bones.find((b) => b.name === name).index;
    const spikesAt = (rec) => smoothness(rec).joints.find((j) => j.bone === name)?.spikes ?? [];
    // A moment that joint is smooth around (the first after 6 s).
    const own = spikesAt(walk);
    let t0 = 6;
    while (t0 < 8 && own.some((s) => Math.abs(s.t - t0) < 0.08)) t0 = Math.round((t0 + 0.01) * 100) / 100;
    const k0 = Math.round(t0 / walk.dt);
    const before = own.filter((s) => Math.abs(s.t - t0) < 0.05).length;
    // From t0 the bone turns at 4 rad/s: its speed jumps by 230 deg/s in a step.
    const rec = tampered(walk, (P, k, o) => { if (k > k0) turnBone(P, o, bone, (k - k0) * walk.dt * 4); });
    const after = spikesAt(rec).filter((s) => Math.abs(s.t - t0) < 0.05).length;
    eq(before, 0, 'no kink there before');
    eq(after, 1, 'one kink at the corner');
});

await test('natural: noise on a joint is jitter', () => {
    const cyc = steadyCycles(walk);
    check(cyc.length >= 3, `${cyc.length} steady cycles`);
    const V = variety(walk, cyc);
    const j = V.joints[0];
    check(j && j.verdict !== 'jitters', `${j?.bone} ${j?.verdict} before`);
    const b = deer.skel.bones.find((x) => x.name === j.bone).index;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
    const amp = (0.25 * j.range * Math.PI) / 180;
    const rec = tampered(walk, (P, k, o) => turnBone(P, o, b, rnd() * amp));
    const after = variety(rec, cyc).joints.find((x) => x.bone === j.bone);
    check(after.jitter > NATURAL.jitter, `jitter ${after.jitter}`);
    eq(after.verdict, 'jitters', 'verdict');
});

await test('natural: flight is free fall, or it is flagged', () => {
    const g = 9.81, t0 = 5, T = 0.5, k0 = Math.round(t0 / walk.dt), k1 = Math.round((t0 + T) / walk.dt);
    const com = series(walk).com;
    // The whole body moved so its centre of mass rises by h(t) from where it
    // was at t0 (the walk's own bob taken out, which is not free fall).
    const lift = (h) => tampered(walk, (P, k, o) => {
        const dy = k <= k0 || k >= k1 ? 0 : h((k - k0) * walk.dt) + com[k0][1] - com[k][1];
        for (let b = 0; b < deer.skel.count; b++) P[o + 12 * b + 7] += dy;
    });
    // On a free-fall arc, and up along a line to the same height then dropped.
    const top = (g * T * T) / 8;
    const arc = massPhysics(lift((t) => (g * T / 2) * t - (g * t * t) / 2));
    const line = massPhysics(lift((t) => Math.min(t, T * 0.8) * (top / (T * 0.8))));
    const flightNear = (m) => m.flights.find((f) => Math.abs(f.t - t0) < 0.1);
    const fa = flightNear(arc), fl = flightNear(line);
    eq(massPhysics(walk).flights.length, 0, 'the walk never flies');
    check(fa && fl, 'both are flights');
    check(fa.gain < NATURAL.energy, `the arc gains ${fa.gain} J/kg`);
    check(fl.gain > NATURAL.energy, `the line gains ${fl.gain} J/kg`);
    check(fa.ms > 300, `the arc flies ${fa.ms} ms`);
    // In the arc's air the centre of mass falls freely (but for the walk's
    // own surge, which is kept); on the line it does not fall at all.
    const off = (m) => m.violations.filter((v) => v.kind === 'flight' && Math.abs(v.t - t0 - T / 2) < T / 2 - 0.05).length;
    const oa = off(arc), ol = off(line);
    check(ol > 10 && oa * 3 < ol, `off free fall at ${oa} sampled steps on the arc, ${ol} on the line`);
    check(arc.worstFlight.a < line.worstFlight.a, `worst off free fall ${arc.worstFlight.a} against ${line.worstFlight.a}`);
});

done('creature-lab measures');
