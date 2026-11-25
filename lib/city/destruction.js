// lib/city/destruction.js — a city's buildings made breakable: lib/destruct's
// simulation over the city's masses (structure.js turns a building into its
// members the first time something touches it), drawn by destruction.bk, with
// its dust a lit medium (lib/destruct/dust.js), debris and glass particles.
//
// createCityDestruction(scene, city, buildings, opts) -> {
//   sim, fire({ shape, radius, halfExtents, mass, position, velocity }),
//   update(dt), setNight(n), stats }
// `buildings` is building_render's (its masses stop drawing as they wake);
// opts.interiors closes a woken building's rooms; opts.src the shader source.

import { MASS_FLOATS } from "./buildings.js";
import { buildingStructure } from "./structure.js";
import { facadeSource } from "./building_render.js";
import { createDestruction } from "../destruct/destruct.js";
import { createDust } from "../destruct/dust.js";

const CELL = 64;
const CAP_PIECES = 1 << 17;
const CAP_BODIES = 1 << 16;

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

export async function createCityDestruction(scene, city, buildings, opts = {}) {
    const { data: D, count, buildings: blds } = city.masses;
    const groundAt = city.graded;

    // Each mass's building, and the masses by 64 m cells of their footprints.
    const owner = new Int32Array(count).fill(-1);
    blds.forEach((b, bi) => { for (let k = 0; k < b.count; k++) owner[b.first + k] = bi; });
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    for (let i = 0; i < count; i++) {
        const o = i * MASS_FLOATS, r = Math.hypot(D[o + 4], D[o + 6]);
        for (let ci = Math.floor((D[o] - r) / CELL); ci <= Math.floor((D[o] + r) / CELL); ci++) {
            for (let cj = Math.floor((D[o + 2] - r) / CELL); cj <= Math.floor((D[o + 2] + r) / CELL); cj++) {
                const k = key(ci, cj);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(i);
            }
        }
    }
    const gone = (i) => (Math.round(D[i * MASS_FLOATS + 14]) & 4) !== 0;
    function massesNear(x, z, r) {
        const out = new Set();
        for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
            for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
                for (const i of grid.get(key(ci, cj)) ?? []) out.add(i);
            }
        }
        return [...out].sort((a, b) => a - b);
    }
    // Distance from a point to mass i's solid (walls, foundation and roof).
    function massDist(i, x, y, z) {
        const o = i * MASS_FLOATS;
        const yaw = D[o + 3], c = Math.cos(yaw), s = Math.sin(yaw);
        const dx = x - D[o], dz = z - D[o + 2];
        const lx = c * dx - s * dz, lz = s * dx + c * dz, ly = y - D[o + 1];
        const top = D[o + 5] + (D[o + 12] > 0.5 ? D[o + 13] : 0);
        const ex = Math.max(0, Math.abs(lx) - D[o + 4]), ez = Math.max(0, Math.abs(lz) - D[o + 6]);
        const ey = Math.max(0, -D[o + 9] - ly, ly - top);
        return Math.hypot(ex, ey, ez);
    }

    const shown = new Set();
    const enclosed = new Set();
    const STANDS = 0.7;   // the share of its members standing that keeps a building's rooms indoors
    let encloseCheck = 0;
    // A standing building's rooms indoors, opened to the daylight by its
    // breaches as they come (the share of its members down, out of what may
    // fall before it counts as down), and outdoors for good once it is down.
    function checkEnclosed(dt) {
        encloseCheck -= dt;
        if (encloseCheck > 0 || !enclosed.size) return;
        encloseCheck = 0.1;
        for (const g of [...enclosed]) {
            const r = sim.report(g);
            if (!r) continue;
            if (r.standing < STANDS * r.members) { opts.interiors.unenclose(g); enclosed.delete(g); continue; }
            opts.interiors.breach?.(g, (1 - r.standing / r.members) / (1 - STANDS));
        }
    }
    const source = {
        frame: (i) => { const o = i * MASS_FLOATS; return { x: D[o], y: D[o + 1], z: D[o + 2], yaw: D[o + 3] }; },
        structure: (g) => buildingStructure(D, blds[g], groundAt),
        groupsNear(x, y, z, r) {
            const out = new Set();
            for (const i of massesNear(x, z, r)) if (owner[i] >= 0 && !gone(i) && massDist(i, x, y, z) <= r) out.add(owner[i]);
            return [...out].sort((a, b) => a - b);
        },
        solidsNear(x, z, r) {
            const out = [];
            for (const i of massesNear(x, z, r)) {
                if (owner[i] < 0 || gone(i)) continue;
                const o = i * MASS_FLOATS;
                if (Math.hypot(D[o] - x, D[o + 2] - z) > r + Math.hypot(D[o + 4], D[o + 6])) continue;
                const h = D[o + 5], pl = D[o + 9];
                out.push({ key: i, group: owner[i], c: [D[o], D[o + 1] + (h - pl) / 2, D[o + 2]], h: [D[o + 4], (h + pl) / 2, D[o + 6]], yaw: D[o + 3] });
            }
            return out;
        },
        groundAt,
        onActivate(g) {
            const b = blds[g];
            const ids = [];
            for (let k = 0; k < b.count; k++) ids.push(b.first + k);
            buildings.hide(ids);
            opts.interiors?.forget(g);
            // Its rooms stay indoors while it stands.
            if (opts.interiors?.enclose(g)) enclosed.add(g);
            shown.add(g);
        },
    };
    const sim = createDestruction(source, { maxBodies: 60000 });

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

    function writePieces() {
        const ch = sim.changed;
        if (!ch.size) return;
        let lo = Infinity, hi = -1;
        for (const i of ch) {
            const m = sim.members[i], o = i * 12;
            if (i >= CAP_PIECES) continue;
            pieceData[o] = m.c[0]; pieceData[o + 1] = m.c[1]; pieceData[o + 2] = m.c[2]; pieceData[o + 3] = m.frame;
            const alive = m.alive ? 1 : 0;
            pieceData[o + 4] = m.h[0] * alive; pieceData[o + 5] = m.h[1] * alive; pieceData[o + 6] = m.h[2] * alive;
            pieceData[o + 7] = m.cluster + 1;
            pieceData[o + 8] = m.kind; pieceData[o + 9] = m.mat; pieceData[o + 10] = m.rough; pieceData[o + 11] = m.seed;
            lo = Math.min(lo, i); hi = Math.max(hi, i);
        }
        ch.clear();
        if (hi >= lo) pieceBuf.write(pieceData.subarray(lo * 12, (hi + 1) * 12), lo * 48);
        node.setInstanceCount(Math.min(sim.members.length, CAP_PIECES));
    }

    function slerp(a, b, t) {
        let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        const s = d < 0 ? -1 : 1; d *= s;
        const q = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    }
    function writeBodies() {
        const n = Math.min(sim.clusters.length, CAP_BODIES);
        if (!n) return;
        const t = sim.alpha;
        for (let i = 0; i < n; i++) {
            const C = sim.clusters[i], o = i * 12;
            if (!C.alive) continue;
            const p = [0, 1, 2].map((k) => C.prevPos[k] + (C.pos[k] - C.prevPos[k]) * t);
            const q = slerp(C.prevQuat, C.quat, t);
            bodyData[o] = C.pivot[0]; bodyData[o + 1] = C.pivot[1]; bodyData[o + 2] = C.pivot[2];
            bodyData[o + 4] = p[0]; bodyData[o + 5] = p[1]; bodyData[o + 6] = p[2];
            bodyData[o + 8] = q[0]; bodyData[o + 9] = q[1]; bodyData[o + 10] = q[2]; bodyData[o + 11] = q[3];
        }
        bodyBuf.write(bodyData.subarray(0, n * 12));
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
    function writeProjectiles() {
        const balls = [], boxes = [];
        const t = sim.alpha;
        for (const P of sim.projectiles) {
            const p = P.flying ? P.p : [0, 1, 2].map((k) => P.prevP[k] + (P.p[k] - P.prevP[k]) * t);
            const q = P.flying ? P.q : slerp(P.prevQ, P.q, t);
            if (P.shape === 'box') boxes.push(...mat4(p, q, P.he[0] * 2, P.he[1] * 2, P.he[2] * 2));
            else balls.push(...mat4(p, q, P.r * 2, P.r * 2, P.r * 2));
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

    return {
        sim, node, dust,
        fire: (o) => sim.fire(o),
        /** Advance the simulation dt seconds and draw it. */
        update(dt) {
            sim.step(dt);
            for (const ev of sim.drain()) emit(ev);
            dust.update(dt);
            checkEnclosed(dt);
            writePieces();
            writeBodies();
            writeProjectiles();
        },
        setNight(n, dayK = 60, nightK = 5) {
            node.setShaderUniform('night', n); node.setShaderUniform('room_day', dayK); node.setShaderUniform('room_night', nightK);
            light = n < 0.3 ? 6000 : n < 0.8 ? 1500 : 2;
            // The city's lights on its dust: sodium and window light.
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() { return { ...sim.stats, members: sim.members.length, groups: sim.groups.size }; },
        /** The building (index into city.masses.buildings) mass i belongs to. */
        buildingOf: (i) => owner[i],
    };
}
