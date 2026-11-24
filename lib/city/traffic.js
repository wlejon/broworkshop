// lib/city/traffic.js — cars driving the road graph.
//
// Lanes: every edge carries lanes both ways (arterials two a side, streets
// one), right-hand traffic, each a line offset from the edge's centre line
// and following its graded heights (bridges included, so cars cross the
// river on the decks and nowhere else).
//
// Cars: each belongs to one lane, a queue in which no car passes another;
// it follows the car ahead (an intelligent-driver law) and, at the lane's
// end, the junction: it stops on red, takes a turn onto a lane of another
// edge when the light is green and that lane has room, and crosses the
// junction on a curve (a cubic from its lane's end to the next lane's
// start) counted as the head of its new lane, so the cars behind it there
// follow it already. Junctions of three or more roads have lights: two
// phases, the roads grouped by direction, each node offset in time.
//
// Trams: opts.lines (transit.js planLines) are run by routed vehicles,
// which follow their line's steps in the inner lane and dwell at its stops.
// That lane carries the rails, and where a road has another lane each way it
// is the trams' alone: cars are neither placed in it nor turn into it.
//
// createTraffic(graph, { count, seed, edgeDensity, lines }) -> traffic {
//   cars: [{ lane, s, v, type, paint, ... }], lanes, step(dt, eye),
//   pose(car, out) -> out: [x, y, z, dx, dz] (dx, dz: the unit heading) }

import { CAR_TYPES } from "./car_mesh.js";
import { tramEdges } from "./transit.js";

const LANE_W = 3.4;
const JR = 11;            // the junction box: lanes end and start this far from a junction's centre
const CYCLE = 34;         // signal cycle (s): two greens of 15 s, each followed by 2 s all red
const GAP = 2.2;          // standstill gap (m)
const HEADWAY = 1.2;      // time headway (s)
const ACCEL = 1.6, DECEL = 2.6;

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function createTraffic(graph, opts = {}) {
    const rand = rng(opts.seed ?? 7);
    const nodes = graph.nodes, edges = graph.edges;
    const degree = nodes.map((n) => n.edges.length);

    // Edge geometry: cumulative arc length per point.
    const geo = edges.map((e) => {
        const p = e.pts, m = p.length / 2, cum = new Float32Array(m);
        for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < m; k++) { x0 = Math.min(x0, p[2 * k]); x1 = Math.max(x1, p[2 * k]); z0 = Math.min(z0, p[2 * k + 1]); z1 = Math.max(z1, p[2 * k + 1]); }
        return { cum, len: cum[m - 1], cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 12 };
    });
    // How far from each end the lanes run: the junction box at a junction, a
    // little at a bend (so a turn has room for its curve), never past half.
    const endR = (node, len) => Math.min(len * 0.3, degree[node] > 2 ? JR : degree[node] === 2 ? 2 : 0.5);

    // Lanes.
    const lanes = [];
    const lanesFrom = nodes.map(() => []);      // lanes leaving each node
    edges.forEach((e, ei) => {
        const g = geo[ei];
        if (g.len < 1) return;
        const per = e.level === 0 ? Math.max(1, Math.floor(e.halfW / LANE_W)) : 1;
        for (const dir of [0, 1]) {
            const from = dir ? e.b : e.a, to = dir ? e.a : e.b;
            for (let i = 0; i < per; i++) {
                const off = e.level === 0 ? (i + 0.5) * LANE_W : e.halfW * 0.5;
                const s0 = endR(from, g.len), s1 = g.len - endR(to, g.len);
                const lane = {
                    id: lanes.length, edge: ei, dir, idx: i, per, off, from, to,
                    s0, s1, len: g.len, cars: [],
                    speed: e.kind === 'street' ? 10 : 15,
                    cx: g.cx, cz: g.cz, r: g.r,      // a circle holding the lane
                    sigOff: -1, group: 0,            // its light at `to` (sigOff < 0: none)
                    acc: 0,                          // time it has not been stepped for
                };
                lanes.push(lane);
                lanesFrom[from].push(lane);
            }
        }
    });

    // An edge's lanes one way, innermost first.
    const laneOf = new Map();
    for (const l of lanes) {
        const k = l.edge * 2 + l.dir;
        if (!laneOf.has(k)) laneOf.set(k, []);
        laneOf.get(k)[l.idx] = l;
    }
    // Edges with tram rails (in their inner lanes): where a road has another
    // lane each way, the inner one is the tram's, and cars keep off it.
    const railed = tramEdges(opts.lines ?? []);

    // A point of an edge's centre line at arc length s (from its a end), its
    // height and direction a -> b.
    function edgeAt(ei, s, out) {
        const e = edges[ei], p = e.pts, cum = geo[ei].cum, m = cum.length;
        // The segment holding s, by bisection.
        let lo = 0, hi = m - 2;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
        const k = lo;
        const l = Math.max(1e-6, cum[k + 1] - cum[k]);
        const t = Math.max(0, Math.min(1, (s - cum[k]) / l));
        const dx = (p[2 * k + 2] - p[2 * k]) / l, dz = (p[2 * k + 3] - p[2 * k + 1]) / l;
        out.x = p[2 * k] + (p[2 * k + 2] - p[2 * k]) * t;
        out.z = p[2 * k + 1] + (p[2 * k + 3] - p[2 * k + 1]) * t;
        out.y = e.ys[k] + (e.ys[k + 1] - e.ys[k]) * t;
        out.dx = dx; out.dz = dz;
        return out;
    }
    // A lane's point at its own arc length s (0 at its from-node): offset to
    // the right of travel.
    const tmp = {};
    function laneAt(lane, s, out) {
        const es = lane.dir ? lane.len - s : s;
        edgeAt(lane.edge, es, tmp);
        let dx = tmp.dx, dz = tmp.dz;
        if (lane.dir) { dx = -dx; dz = -dz; }
        out.x = tmp.x - dz * lane.off; out.z = tmp.z + dx * lane.off; out.y = tmp.y;
        out.dx = dx; out.dz = dz;
        return out;
    }

    // Signals: at each junction the incoming roads in two groups by direction.
    const signal = nodes.map((n, ni) => {
        if (degree[ni] < 3) return null;
        const groupOf = new Map();
        let ref = null;
        for (const ei of n.edges) {
            const e = edges[ei], p = e.pts, m = p.length;
            // The edge's heading away from this node.
            const [x0, z0, x1, z1] = e.a === ni ? [p[0], p[1], p[2], p[3]] : [p[m - 2], p[m - 1], p[m - 4], p[m - 3]];
            const ang = Math.atan2(z1 - z0, x1 - x0);
            if (ref === null) ref = ang;
            groupOf.set(ei, Math.abs(Math.cos(ang - ref)) >= Math.SQRT1_2 ? 0 : 1);
        }
        return { groupOf, offset: rand() * CYCLE };
    });
    for (const l of lanes) {
        const sg = signal[l.to];
        if (sg) { l.sigOff = sg.offset; l.group = sg.groupOf.get(l.edge); }
    }
    let time = 0;
    function green(lane) {
        if (lane.sigOff < 0) return true;
        const t = (time + lane.sigOff) % CYCLE;
        return lane.group === 0 ? t < 15 : (t >= 17 && t < 32);
    }

    // The turn a car takes at its lane's end: a lane leaving the node on
    // another edge (back the way it came only at a dead end), straight on
    // more likely than a turn.
    function chooseNext(lane, car) {
        if (car && car.route) {
            // A routed vehicle: its route's next step, in the inner lane.
            const R = car.route, ri = (car.ri + 1) % R.steps.length, st = R.steps[ri];
            const nl = laneOf.get(st.edge * 2 + st.dir)?.[0];
            if (nl && nl.from === lane.to) { car.nextRi = ri; return nl; }
        }
        const outs = lanesFrom[lane.to];
        const cands = [];
        // A car keeps its lane index where the next road has it, off the rails
        // where the road has another lane its way.
        const keep = (nl) => {
            const k = Math.min(lane.idx, nl.per - 1);
            return railed.has(nl.edge) && nl.per > 1 ? Math.max(1, k) : k;
        };
        let wsum = 0;
        const inDx = laneAt(lane, lane.s1, {}), hx = inDx.dx, hz = inDx.dz;
        for (const nl of outs) {
            if (nl.edge === lane.edge && outs.some((o) => o.edge !== lane.edge)) continue;
            if (nl.idx !== keep(nl)) continue;
            const o = laneAt(nl, nl.s0, {});
            const straight = hx * o.dx + hz * o.dz;
            const w = 0.25 + Math.max(0, straight) * 2.5 + (nl.speed > 12 ? 0.5 : 0);
            cands.push([nl, w]); wsum += w;
        }
        if (!cands.length) return null;
        let r = rand() * wsum;
        for (const [nl, w] of cands) { r -= w; if (r <= 0) return nl; }
        return cands[cands.length - 1][0];
    }

    // Cars, placed by the density of the city around each lane.
    const typeNames = Object.keys(CAR_TYPES);
    const typeW = typeNames.map((n) => CAR_TYPES[n].weight);
    const typeSum = typeW.reduce((a, b) => a + b, 0);
    const PAINTS = [
        [0.02, 0.02, 0.022], [0.65, 0.66, 0.67], [0.85, 0.85, 0.84], [0.30, 0.31, 0.33], [0.42, 0.04, 0.03],
        [0.04, 0.09, 0.25], [0.12, 0.13, 0.14], [0.50, 0.45, 0.36], [0.05, 0.18, 0.10], [0.70, 0.55, 0.08],
    ];
    const PAINT_W = [0.22, 0.17, 0.2, 0.12, 0.07, 0.07, 0.08, 0.03, 0.02, 0.02];
    const pick = (w, sum) => { let r = rand() * sum; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0 && w[i] > 0) return i; } return 0; };
    const cars = [];
    const count = opts.count ?? 8000;
    // The city's density about each edge (opts.edgeDensity, by edge index).
    const dens = opts.edgeDensity;
    const weights = lanes.map((l) => {
        if (railed.has(l.edge) && l.per > 1 && l.idx === 0) return 0;   // the tram's
        const d = dens ? dens[l.edge] : 1;
        return Math.max(0, l.s1 - l.s0) * (0.05 + d * d) * (l.speed > 12 ? 1.6 : 1);
    });
    const wTotal = weights.reduce((a, b) => a + b, 0);
    const want = weights.map((w) => (w / wTotal) * count);
    lanes.forEach((l, li) => {
        let n = Math.floor(want[li] + rand());
        const room = l.s1 - l.s0;
        n = Math.min(n, Math.floor(room / 9));
        for (let k = 0; k < n; k++) {
            // From the lane's head back: the queue's order.
            const s = l.s1 - (k + rand() * 0.6) * (room / Math.max(1, n));
            const type = typeNames[pick(typeW, typeSum)];
            const car = {
                lane: l, s, v: l.speed * (0.6 + 0.3 * rand()), type, len: CAR_TYPES[type].L,
                paint: PAINTS[pick(PAINT_W, 1)], next: null, turn: null, brake: 0, id: cars.length,
            };
            l.cars.push(car);
            cars.push(car);
        }
    });

    // Routed vehicles (trams): each line out along its steps and back,
    // a vehicle every ~900 m of the round trip, each in its step's inner lane.
    for (const line of opts.lines ?? []) {
        const n = line.steps.length;
        const steps = line.steps.concat(line.steps.slice().reverse().map((st) => ({ edge: st.edge, dir: 1 - st.dir })));
        const stopAt = new Map();
        for (const sp of line.stops) {
            const len = geo[line.steps[sp.step].edge].len;
            stopAt.set(sp.step, sp.s);
            stopAt.set(2 * n - 1 - sp.step, len - sp.s);
        }
        const route = { steps, stopAt, name: line.name };
        let total = 0;
        for (const st of steps) total += geo[st.edge].len;
        const count = Math.max(2, Math.round(total / 900));
        const type = opts.routeType ?? 'tram';
        for (let v = 0; v < count; v++) {
            // Walk the route to this vehicle's place.
            let want = (v + 0.5) * (total / count), ri = 0;
            while (ri < steps.length - 1 && want > geo[steps[ri].edge].len) { want -= geo[steps[ri].edge].len; ri++; }
            const lane = laneOf.get(steps[ri].edge * 2 + steps[ri].dir)?.[0];
            if (!lane) continue;
            const s = Math.max(lane.s0 + CAR_TYPES[type].L, Math.min(lane.s1, want));
            const car = {
                lane, s, v: 0, type, len: CAR_TYPES[type].L, paint: line.colour, next: null, turn: null,
                brake: 0, id: cars.length, route, ri, nextRi: ri, served: -1, dwell: 0,
            };
            // Into the lane's queue at its place (the queue runs head first).
            let at = lane.cars.findIndex((c) => c.s < s);
            if (at < 0) at = lane.cars.length;
            lane.cars.splice(at, 0, car);
            cars.push(car);
        }
    }

    // The curve through a junction from `lane`'s end to `next`'s start.
    function makeTurn(lane, next) {
        const a = laneAt(lane, lane.s1, {}), b = laneAt(next, next.s0, {});
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        const k = d * 0.45;
        const c = {
            p0: [a.x, a.y, a.z], p1: [a.x + a.dx * k, a.y, a.z + a.dz * k],
            p2: [b.x - b.dx * k, b.y, b.z - b.dz * k], p3: [b.x, b.y, b.z],
        };
        // Its length, by a few chords.
        let L = 0, px = a.x, pz = a.z;
        for (let i = 1; i <= 8; i++) { const q = bez(c, i / 8, {}); L += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; }
        c.L = Math.max(0.5, L);
        return c;
    }
    function bez(c, t, out) {
        const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        out.x = w0 * c.p0[0] + w1 * c.p1[0] + w2 * c.p2[0] + w3 * c.p3[0];
        out.y = w0 * c.p0[1] + w1 * c.p1[1] + w2 * c.p2[1] + w3 * c.p3[1];
        out.z = w0 * c.p0[2] + w1 * c.p1[2] + w2 * c.p2[2] + w3 * c.p3[2];
        const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
        out.dx = d0 * (c.p1[0] - c.p0[0]) + d1 * (c.p2[0] - c.p1[0]) + d2 * (c.p3[0] - c.p2[0]);
        out.dz = d0 * (c.p1[2] - c.p0[2]) + d1 * (c.p2[2] - c.p1[2]) + d2 * (c.p3[2] - c.p2[2]);
        const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l;
        return out;
    }

    // Intelligent-driver acceleration toward `v0`, `gap` metres behind
    // something moving at `vl`.
    function idm(v, v0, gap, vl) {
        const ss = GAP + Math.max(0, v * HEADWAY + (v * (v - vl)) / (2 * Math.sqrt(ACCEL * DECEL)));
        const g = Math.max(0.1, gap);
        const r = v / v0, q = ss / g;
        return ACCEL * (1 - r * r * r * r - q * q);
    }

    // Lanes further than FAR from `eye` step at most every FAR_DT seconds
    // (their cars are small or out of sight); near ones every frame.
    const FAR = 1800, FAR_DT = 0.25;
    function step(dt0, eye) {
        dt0 = Math.min(dt0, 0.1);
        time += dt0;
        const ex = eye ? eye[0] : 0, ez = eye ? eye[2] : 0;
        for (let li = 0; li < lanes.length; li++) {
            const lane = lanes[li];
            const q = lane.cars;
            if (!q.length) { lane.acc = 0; continue; }
            lane.acc += dt0;
            if (eye) {
                const dx = lane.cx - ex, dz = lane.cz - ez, far = FAR + lane.r;
                if (dx * dx + dz * dz > far * far && lane.acc < FAR_DT) continue;
            }
            const dt = Math.min(lane.acc, 0.3);
            lane.acc = 0;
            for (let i = 0; i < q.length; i++) {
                const car = q[i];
                let gap, vl;
                if (i > 0) {
                    const ahead = q[i - 1];
                    gap = ahead.s - ahead.len - car.s; vl = ahead.v;
                } else {
                    // The head of the lane: the junction ahead.
                    gap = Infinity; vl = 0;
                    if (!car.next) car.next = chooseNext(lane, car);
                    const nx = car.next;
                    let go = green(lane) && !!nx;
                    if (go && nx.cars.length) {
                        const tail = nx.cars[nx.cars.length - 1];
                        if (tail.s - tail.len < nx.s0 + 1) go = false;   // no room beyond the junction
                    }
                    if (!go) gap = lane.s1 - car.s;
                }
                let v0 = lane.speed * (car.turn ? 0.55 : 1);
                if (car.route) {
                    v0 = Math.min(v0, 12);
                    // A stop on this step not yet served: brake for it, then dwell.
                    const stopS = car.route.stopAt.get(car.ri);
                    if (stopS !== undefined && car.served !== car.ri) {
                        if (car.dwell > 0) {
                            car.dwell -= dt;
                            if (car.dwell <= 0) car.served = car.ri;
                            gap = 0; vl = 0;
                        } else if (stopS - car.s < gap) {
                            gap = stopS - car.s + GAP; vl = 0;
                            if (stopS - car.s < 1.5 && car.v < 0.5) { car.dwell = 15; car.v = 0; }
                        }
                    }
                }
                const a = idm(car.v, v0, gap, vl);
                car.brake = a < -0.5 ? 1 : 0;
                car.v = car.dwell > 0 ? 0 : Math.max(0, car.v + a * dt);
                car.s += car.v * dt;
                // Never into the car ahead (long far steps overshoot).
                if (i > 0) { const ahead = q[i - 1]; const lim = ahead.s - ahead.len - 0.5; if (car.s > lim) { car.s = lim; car.v = Math.min(car.v, ahead.v); } }
                if (car.turn && car.s >= lane.s0) car.turn = null;
            }
            // The head crosses into its next lane: it becomes that lane's
            // tail, at minus the curve's remaining length before its start.
            while (q.length && q[0].s >= lane.s1 && q[0].next) {
                const car = q.shift();
                const nx = car.next;
                const turn = makeTurn(lane, nx);
                car.turn = turn;
                car.s = nx.s0 - turn.L + (car.s - lane.s1);
                car.lane = nx;
                car.next = null;
                if (car.route) car.ri = car.nextRi;
                nx.cars.push(car);
            }
            // A dead lane end with nowhere to go: hold.
            for (const car of q) if (car.s > lane.s1 + 0.5 && !car.next) car.s = lane.s1;
        }
    }

    // A car's position, height and heading: [x, y, z, dx, dz].
    const tp = {};
    function pose(car, out) {
        const lane = car.lane;
        if (car.turn && car.s < lane.s0) {
            const t = Math.max(0, Math.min(1, 1 - (lane.s0 - car.s) / car.turn.L));
            bez(car.turn, t, tp);
        } else {
            laneAt(lane, Math.max(lane.s0, Math.min(car.s, lane.len)), tp);
        }
        out[0] = tp.x; out[1] = tp.y; out[2] = tp.z; out[3] = tp.dx; out[4] = tp.dz;
        return out;
    }

    return { cars, lanes, step, pose, get time() { return time; } };
}

/** The city's density at each edge's middle, for createTraffic's edgeDensity. */
export function edgeDensity(graph, density) {
    return Float32Array.from(graph.edges, (e) => { const p = e.pts, k = (p.length / 4 | 0) * 2; return density(p[k], p[k + 1]); });
}

/** The road graph reduced to what traffic reads, to send to a worker. */
export function trafficGraph(graph) {
    return {
        nodes: graph.nodes.map((n) => ({ edges: n.edges })),
        edges: graph.edges.map((e) => ({ a: e.a, b: e.b, pts: Float64Array.from(e.pts), ys: Float32Array.from(e.ys), halfW: e.halfW, level: e.level, kind: e.kind })),
    };
}

/**
 * The cars within `range` of `eye` (and not behind it) as instance records
 * (16 floats: a 4x3 transform, the paint as tint), one array a body type (in
 * `names` order) and tier: tier 0 nearer than tiers[0] (full detail, casting
 * shadows), tier i to tiers[i] (coarser levels), the last to `range`.
 */
export function carInstances(traffic, names, eye, fwd, range, tiers) {
    const typeIndex = new Map(names.map((n, i) => [n, i]));
    const nt = tiers.length + 1;
    const t2 = tiers.map((t) => t * t);
    const counts = new Int32Array(names.length * nt);
    // Size: every car could be in range at worst; count first.
    const sel = [];
    const pose = [0, 0, 0, 0, 0];
    const r2 = range * range;
    for (const lane of traffic.lanes) {
        if (!lane.cars.length) continue;
        const lx = lane.cx - eye[0], lz = lane.cz - eye[2], lr = range + lane.r;
        if (lx * lx + lz * lz > lr * lr) continue;
        for (const car of lane.cars) {
            traffic.pose(car, pose);
            const dx = pose[0] - eye[0], dy = pose[1] - eye[1], dz = pose[2] - eye[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            if (d2 > 1600 && dx * fwd[0] + dy * fwd[1] + dz * fwd[2] < -0.3 * Math.sqrt(d2)) continue;
            let tier = 0;
            while (tier < t2.length && d2 >= t2[tier]) tier++;
            const slot = typeIndex.get(car.type) * nt + tier;
            counts[slot]++;
            sel.push(slot, pose[0], pose[1], pose[2], pose[3], pose[4], car.paint[0], car.paint[1], car.paint[2]);
        }
    }
    const out = Array.from(counts, (c) => new Float32Array(c * 16));
    const k = new Int32Array(counts.length);
    for (let i = 0; i < sel.length; i += 9) {
        const slot = sel[i], B = out[slot], o = k[slot]++ * 16;
        const c = sel[i + 4], sn = sel[i + 5];
        B[o] = c; B[o + 1] = 0; B[o + 2] = -sn; B[o + 3] = sel[i + 1];
        B[o + 4] = 0; B[o + 5] = 1; B[o + 6] = 0; B[o + 7] = sel[i + 2];
        B[o + 8] = sn; B[o + 9] = 0; B[o + 10] = c; B[o + 11] = sel[i + 3];
        B[o + 12] = sel[i + 6]; B[o + 13] = sel[i + 7]; B[o + 14] = sel[i + 8]; B[o + 15] = 1;
    }
    return out;
}
