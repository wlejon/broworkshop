// lib/city/destruction.js — a city's buildings made breakable: lib/destruct's
// simulation over the city's masses (destruction_sim.js), stepped in a Worker
// (opts.worker: the app's script calling destruction_worker.js's
// serveDestruction) or here on the page, and drawn by destruction.bk, with its
// dust a lit medium (lib/destruct/dust.js), debris and glass particles.
//
// createCityDestruction(scene, city, buildings, opts) -> {
//   sim (the page's, else null), worker (whether it steps in one),
//   fire({ shape, radius, halfExtents, mass, position, velocity, tick?, key? }),
//   update(dt), setNight(n), stats, tick, stepTo(tick, { hash }), log(),
//   join(log, tick), buildingOf(i) }
// `buildings` is building_render's (its masses stop drawing as they wake);
// opts.interiors keeps a woken building's rooms as they were until it breaks
// (cutting its pieces' glass as the walls' is cut), then indoors until it is
// down; opts.src the shader source; opts.sources the city's cache sources (the
// worker reads the city the page grew).
//
// The page keeps the clock: each frame it asks for the steps due (60 Hz) and
// draws the last snapshot it has, a step behind (between the poses of its last
// two steps), never waiting for the next. A worker fallen behind is asked for
// at most 8 steps at once; the time beyond them is dropped.

import { MASS_FLOATS } from "./buildings.js";
import { facadeSource } from "./building_render.js";
import { cacheWhere } from "./cache.js";
import { createCitySim, CAP_PIECES, CAP_BODIES, BODY_FLOATS, PROJ_FLOATS } from "./destruction_sim.js";
import { createDust } from "../destruct/dust.js";

const MAX_BEHIND = 8;

function boxMesh(N) {
    // A unit box, N x N quads a face, 4 normals per corner so faces stay flat
    // (the vertex stage displaces the broken ones).
    const P = [], Nn = [], I = [];
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, a, b] of faces) {
        const base = P.length / 3;
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
            const sa = i / N * 2 - 1, sb = j / N * 2 - 1;
            P.push(0.5 * (n[0] + sa * a[0] + sb * b[0]), 0.5 * (n[1] + sa * a[1] + sb * b[1]), 0.5 * (n[2] + sa * a[2] + sb * b[2]));
            Nn.push(...n);
        }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = base + j * (N + 1) + i;
            I.push(k, k + 1, k + N + 2, k, k + N + 2, k + N + 1);
        }
    }
    return new bro.mesh.Mesh({ positions: new Float32Array(P), normals: new Float32Array(Nn), indices: new Uint32Array(I) });
}

// Start the worker and wait for its city: null if it fails (stepped here then).
function startWorker(url, sources, maxBodies) {
    return new Promise((resolve) => {
        const w = new Worker(url, { type: 'module' });
        w.onmessage = (ev) => {
            if (ev.data.ready) { console.log(`destruction: stepping in a worker (its city in ${ev.data.ms.toFixed(0)} ms)`); resolve(w); return; }
            console.warn(`destruction: worker failed (${ev.data.error}); stepping on the page`);
            w.terminate();
            resolve(null);
        };
        w.onerror = (e) => { console.warn(`destruction: worker failed (${e.message}); stepping on the page`); w.terminate(); resolve(null); };
        w.postMessage({ init: { ...cacheWhere(sources), maxBodies } });
    });
}

export async function createCityDestruction(scene, city, buildings, opts = {}) {
    const { count, buildings: blds } = city.masses;
    const groundAt = city.graded;
    const maxBodies = opts.maxBodies ?? 60000;
    const owner = new Int32Array(count).fill(-1);
    blds.forEach((b, bi) => { for (let k = 0; k < b.count; k++) owner[b.first + k] = bi; });

    const worker = opts.worker ? await startWorker(opts.worker, opts.sources ?? [], maxBodies) : null;
    const host = worker ? null : createCitySim(city, { maxBodies });

    // A standing building's rooms indoors, opened to the daylight by its
    // breaches as they come, and outdoors for good once it is down. What
    // counts is what has left its place (gone, or in a piece moved half a
    // metre from where it stood: destruction_sim.js): a panel cracked loose
    // and still in its wall keeps the room behind it dark.
    const DOWN = 0.3;        // the share of its members out of place that makes a building down
    const enclosed = new Set();
    const down = new Map();  // group -> its share out of place, as the last snapshot had it
    let encloseCheck = 0;
    function checkEnclosed(dt) {
        encloseCheck -= dt;
        if (encloseCheck > 0 || !enclosed.size) return;
        encloseCheck = 0.1;
        for (const g of [...enclosed]) {
            const d = down.get(g) ?? 0;
            if (d > 0) opts.interiors.release?.(g);
            if (d >= DOWN) { opts.interiors.unenclose(g); enclosed.delete(g); continue; }
            // (Any breach at all lets a little of the sky in.)
            opts.interiors.breach?.(g, d > 0 ? Math.max(0.1, d / DOWN) : 0);
        }
    }
    // A building woken: its masses stop drawing (its pieces draw it now), in
    // the frame its pieces first do.
    function activate(g) {
        const b = blds[g];
        const ids = [];
        for (let k = 0; k < b.count; k++) ids.push(b.first + k);
        buildings.hide(ids);
        // Its rooms stay indoors while it stands, and, if it is open, as
        // they were (rooms and glass) until it breaks.
        if (opts.interiors?.enclose(g)) { enclosed.add(g); opts.interiors.hold?.(g); }
        else opts.interiors?.forget(g);
    }

    // ---------------------------------------------------------------------
    // Drawing: the members, the bodies' poses, the projectiles
    // ---------------------------------------------------------------------

    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/city/destruction.bk'), 'utf8');
    const node = scene.createInstancedMesh({
        name: 'city_pieces', mesh: boxMesh(6), capacity: CAP_PIECES, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: true, receivesShadow: true,
    });
    node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    await node.setShaderAsync({ module: src, file: 'lib/city/destruction.bk', modules: { facade: facadeSource() }, uniforms: { night: 0, room_day: 60, room_night: 5 } });
    const pieceData = new Float32Array(CAP_PIECES * 12);
    const pieceBuf = bro.kernel.createBuffer(pieceData.byteLength);
    pieceBuf.write(pieceData);
    const bodyData = new Float32Array(CAP_BODIES * 12);
    const bodyBuf = bro.kernel.createBuffer(bodyData.byteLength);
    bodyBuf.write(bodyData);
    node.setShaderBuffer('masses', buildings.masses);
    // (Its glass cut where an open building's is: one held open standing.)
    if (opts.interiors?.addWalls) opts.interiors.addWalls(node);
    else node.setShaderBuffer('open_state', bro.kernel.createBuffer(16));
    node.setShaderBuffer('pieces', pieceBuf);
    node.setShaderBuffer('bodies', bodyBuf);
    node.setInstanceCount(0);

    const ball = scene.createInstancedMesh({
        name: 'city_projectiles', mesh: bro.mesh.Mesh.sphere ? bro.mesh.Mesh.sphere(0.5, 24, 16) : boxMesh(1), capacity: 256,
        instances: new Float32Array(0), color: [0.18, 0.18, 0.2], metallic: 0.8, roughness: 0.35, castsShadow: true, receivesShadow: true,
    });
    ball.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    const block = scene.createInstancedMesh({
        name: 'city_projectile_boxes', mesh: boxMesh(1), capacity: 256, instances: new Float32Array(0),
        color: [0.18, 0.18, 0.2], metallic: 0.8, roughness: 0.35, castsShadow: true, receivesShadow: true,
    });
    block.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);

    // Dust: a lit medium (lib/destruct/dust.js); debris: grit that falls;
    // glass: glints that fall.
    const dust = createDust(scene, { groundAt });
    const grit = scene.createParticles3D({
        maxParticles: 30000, autoplay: false, rate: 0, lifetime: { min: 2, max: 4 },
        size: { start: 0.22, end: 0.18 }, color: { start: [0.34, 0.33, 0.31, 1], end: [0.34, 0.33, 0.31, 1] },
        velocity: { direction: [0, 1, 0], spread: 140, speed: 6, speedSpread: 5 }, gravity: [0, -9.81, 0], drag: 0.98,
        shape: { type: 'sphere', radius: 0.8 }, blend: 'normal',
    });
    const glass = scene.createParticles3D({
        maxParticles: 20000, autoplay: false, rate: 0, lifetime: { min: 1.5, max: 3.5 },
        size: { start: 0.12, end: 0.08 }, color: { start: [1.6, 1.7, 1.8, 0.9], end: [0.8, 0.9, 1.0, 0.4] },
        velocity: { direction: [0, 1, 0], spread: 170, speed: 5, speedSpread: 4 }, gravity: [0, -9.81, 0], drag: 0.97,
        shape: { type: 'sphere', radius: 1.5 }, blend: 'additive',
    });

    // The last snapshot's bodies (BODY_FLOATS each, by cluster) and the ones moving in it.
    const bodyState = new Float32Array(CAP_BODIES * BODY_FLOATS);
    const moving = new Set();
    let projectiles = new Float32Array(0);
    let snapTick = 0, stats = {};
    const fired = [];   // the shots the worker's sim launched, as its snapshots told

    // Snapshot s (destruction_sim.js), for groups `watch`: what it changed
    // into the buffers, its events into the particles and dust.
    function apply(s, watch) {
        for (const g of s.activated) activate(g);
        for (const f of s.fired ?? []) fired.push(f);
        if (s.pieceIdx.length) {
            let lo = Infinity, hi = -1;
            for (let k = 0; k < s.pieceIdx.length; k++) {
                const i = s.pieceIdx[k];
                pieceData.set(s.pieces.subarray(k * 12, k * 12 + 12), i * 12);
                if (i < lo) lo = i;
                if (i > hi) hi = i;
            }
            pieceBuf.write(pieceData.subarray(lo * 12, (hi + 1) * 12), lo * 48);
        }
        node.setInstanceCount(Math.min(s.members, CAP_PIECES));
        if (s.bodyIdx.length) {
            let lo = Infinity, hi = -1;
            for (let k = 0; k < s.bodyIdx.length; k++) {
                const i = s.bodyIdx[k], o = k * BODY_FLOATS;
                bodyState.set(s.bodies.subarray(o, o + BODY_FLOATS), i * BODY_FLOATS);
                if (s.bodies[o + 17]) { moving.add(i); continue; }
                // Come to rest: drawn once where it lies.
                moving.delete(i);
                const d = i * 12;
                bodyData[d] = s.bodies[o]; bodyData[d + 1] = s.bodies[o + 1]; bodyData[d + 2] = s.bodies[o + 2];
                bodyData[d + 4] = s.bodies[o + 6]; bodyData[d + 5] = s.bodies[o + 7]; bodyData[d + 6] = s.bodies[o + 8];
                bodyData[d + 8] = s.bodies[o + 13]; bodyData[d + 9] = s.bodies[o + 14]; bodyData[d + 10] = s.bodies[o + 15]; bodyData[d + 11] = s.bodies[o + 16];
                if (i < lo) lo = i;
                if (i > hi) hi = i;
            }
            if (hi >= lo) bodyBuf.write(bodyData.subarray(lo * 12, (hi + 1) * 12), lo * 48);
        }
        projectiles = s.projectiles;
        for (const ev of s.events) emit(ev);
        for (let k = 0; k < watch.length; k++) down.set(watch[k], s.down[k]);
        // (stepMs: the host's time for the steps and the snapshot.)
        stats = { ...s.stats, stepMs: s.ms ?? 0 };
        snapTick = s.tick;
    }

    // The moving bodies, a step behind: between their last two poses.
    function drawBodies(t) {
        let lo = CAP_BODIES, hi = -1;
        for (const i of moving) {
            const s = i * BODY_FLOATS, o = i * 12, B = bodyState;
            bodyData[o] = B[s]; bodyData[o + 1] = B[s + 1]; bodyData[o + 2] = B[s + 2];
            bodyData[o + 4] = B[s + 3] + (B[s + 6] - B[s + 3]) * t;
            bodyData[o + 5] = B[s + 4] + (B[s + 7] - B[s + 4]) * t;
            bodyData[o + 6] = B[s + 5] + (B[s + 8] - B[s + 5]) * t;
            // (Normalized lerp along the short arc.)
            const dq = B[s + 9] * B[s + 13] + B[s + 10] * B[s + 14] + B[s + 11] * B[s + 15] + B[s + 12] * B[s + 16];
            const sg = dq < 0 ? -1 : 1;
            const x = B[s + 9] + (B[s + 13] * sg - B[s + 9]) * t, y = B[s + 10] + (B[s + 14] * sg - B[s + 10]) * t;
            const z = B[s + 11] + (B[s + 15] * sg - B[s + 11]) * t, w = B[s + 12] + (B[s + 16] * sg - B[s + 12]) * t;
            const l = Math.hypot(x, y, z, w) || 1;
            bodyData[o + 8] = x / l; bodyData[o + 9] = y / l; bodyData[o + 10] = z / l; bodyData[o + 11] = w / l;
            if (i < lo) lo = i;
            if (i > hi) hi = i;
        }
        if (hi >= lo) bodyBuf.write(bodyData.subarray(lo * 12, (hi + 1) * 12), lo * 48);
    }
    function mat4(p, q, sx, sy, sz) {
        const [x, y, z, w] = q;
        return [
            (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
            2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
            2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
            p[0], p[1], p[2], 1,
        ];
    }
    function drawProjectiles(t) {
        const balls = [], boxes = [], P = projectiles;
        for (let o = 0; o < P.length; o += PROJ_FLOATS) {
            const flying = P[o + 1] > 0;
            const p = [0, 1, 2].map((k) => flying ? P[o + 8 + k] : P[o + 5 + k] + (P[o + 8 + k] - P[o + 5 + k]) * t);
            let q = [P[o + 15], P[o + 16], P[o + 17], P[o + 18]];
            if (!flying) {
                const a = [P[o + 11], P[o + 12], P[o + 13], P[o + 14]];
                const d = a[0] * q[0] + a[1] * q[1] + a[2] * q[2] + a[3] * q[3], sg = d < 0 ? -1 : 1;
                q = a.map((v, k) => v + (q[k] * sg - v) * t);
                const l = Math.hypot(...q) || 1;
                q = q.map((v) => v / l);
            }
            const m = mat4(p, q, P[o + 2] * 2, P[o + 3] * 2, P[o + 4] * 2);
            if (P[o] > 0) boxes.push(...m); else balls.push(...m);
        }
        ball.setInstances(new Float32Array(balls));
        block.setInstances(new Float32Array(boxes));
    }
    // The particles are unlit: their colours are luminances (cd/m^2), an
    // albedo times the light the scene has (lib/kit/sky.js's physical sky:
    // a sunlit and shaded mix by day).
    let light = 6000;
    function emit(ev) {
        const c = ev.color ?? [0.6, 0.58, 0.54];
        if (ev.type === 'dust') {
            dust.add(ev);
        } else if (ev.type === 'spall') {
            const sp = ev.speed ?? 4;
            const k = light * 0.6;
            grit.emit({ count: Math.min(300, ev.n), position: ev.p, direction: ev.v, spread: 120, speed: sp, speedSpread: sp * 0.7,
                        sizeScale: Math.max(0.6, Math.min(3, ev.r)), lifeScale: 1, tint: [c[0] / 0.34 * k, c[1] / 0.33 * k, c[2] / 0.31 * k, 1] });
        } else if (ev.type === 'glass') {
            const k = light * 1.5;
            glass.emit({ count: Math.min(60, ev.n), position: ev.p, direction: [ev.v[0], 1, ev.v[2]], spread: 170, speed: 4, speedSpread: 4, sizeScale: 1, lifeScale: 1, tint: [k, k, k, 1] });
        }
    }

    // ---------------------------------------------------------------------
    // Stepping: the page's clock, the host's steps
    // ---------------------------------------------------------------------

    let clock = 0;               // in steps (60 Hz)
    const queued = [];           // shots for the worker's next request
    let inFlight = null;         // the groups watched by the request the worker is answering
    let answered = [];           // waiting on the worker's answer (stepTo)
    let stepping = 0;            // stepTo calls waiting
    if (worker) {
        worker.onmessage = (ev) => {
            const watch = inFlight;
            inFlight = null;
            if (ev.data.error) console.error(`destruction: worker: ${ev.data.error}`);
            else apply(ev.data, watch);
            for (const r of answered.splice(0)) r(ev.data);
        };
    }
    const answer = () => new Promise((r) => answered.push(r));
    function request() {
        let to = Math.floor(clock);
        // (Fallen behind: the time past MAX_BEHIND steps dropped.)
        if (to - snapTick > MAX_BEHIND) { clock -= to - snapTick - MAX_BEHIND; to = snapTick + MAX_BEHIND; }
        const watch = [...enclosed];
        if (host) {
            // (A script stepping the page's sim itself: the clock follows it.)
            if (host.sim.tick > to) { clock += host.sim.tick - to; to = host.sim.tick; }
            apply(host.advance(to, [], watch), watch);
            return;
        }
        if (inFlight || stepping || (to <= snapTick && !queued.length)) return;
        inFlight = watch;
        worker.postMessage({ toTick: to, fires: queued.splice(0), watch });
    }

    return {
        sim: host?.sim ?? null, worker: Boolean(worker), node, dust,
        /** Fire a shot (destruct.js fire's options): now, or at its `tick`. On the page the
         *  projectile is returned; a worker launches it with its next steps. */
        fire(o) {
            if (host) return host.sim.fire(o);
            queued.push(o);
            return null;
        },
        /** Advance the clock dt seconds, take the steps due, and draw the last snapshot. */
        update(dt) {
            clock += Math.min(dt, 0.25) * 60;
            request();
            const t = Math.max(0, Math.min(1, clock - snapTick));
            dust.update(dt);
            checkEnclosed(dt);
            drawBodies(t);
            drawProjectiles(t);
        },
        setNight(n, dayK = 60, nightK = 5) {
            node.setShaderUniform('night', n); node.setShaderUniform('room_day', dayK); node.setShaderUniform('room_night', nightK);
            light = n < 0.3 ? 6000 : n < 0.8 ? 1500 : 2;
            // The city's lights on its dust: sodium and window light.
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() { return host ? { ...host.sim.stats, members: host.sim.members.length, groups: host.sim.groups.size } : stats; },
        /** Take every step to `tick` now (a peer catching up; tests), however many,
         *  with the queued shots: resolves to the snapshot after, with the sim's
         *  state `hash` if asked. The clock moves on to it. */
        async stepTo(tick, { hash = false } = {}) {
            const watch = [...enclosed];
            let s;
            if (host) {
                s = host.advance(tick, [], watch, { maxSteps: Infinity, hash });
                apply(s, watch);
            } else {
                // (The frames' requests hold off meanwhile: one answered could
                // otherwise be followed by the next frame's before this went.)
                stepping++;
                try {
                    while (inFlight) await answer();
                    inFlight = watch;
                    worker.postMessage({ toTick: tick, fires: queued.splice(0), watch, maxSteps: Infinity, hash });
                    s = await answer();
                } finally { stepping--; }
            }
            clock = Math.max(clock, snapTick);
            return s;
        },
        /** The shots launched so far, stamped for a replay from tick 0: what a
         *  peer joining late is sent, with the tick to `join` at. */
        log() { return host ? host.sim.fired() : fired.slice(); },
        /** Join late: fire `log` (another peer's `log()`) and take every step to
         *  `tick` now; resolves as stepTo does. The city must be fresh (tick 0). */
        join(log, tick, opts) {
            for (const f of log) { if (host) host.sim.fire(f); else queued.push(f); }
            return this.stepTo(tick, opts);
        },
        /** The step the last snapshot drawn is of. */
        get tick() { return snapTick; },
        /** The building (index into city.masses.buildings) mass i belongs to. */
        buildingOf: (i) => owner[i],
    };
}
