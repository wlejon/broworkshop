// demos/foundry/view.js — the foundry's 3D view of one contract.
//
// show(contract) draws its children where the compiler put them: parts as
// their meshes (partmesh.js), nested designs as their own children, down to
// any depth, each in its own paint. Where two mechanical ports meet the view
// draws a coupling; cables and hoses hang between their ports. Movers turn
// at the flows the bench gives (setFlows), so the gears run at their ratios.

import { skyEnvironment } from "/lib/kit/sky.js";
import { rotQuat, rotApply } from "/lib/foundry/rot.js";
import { flowsFor } from "/lib/foundry/compile.js";
import { Geo, M, lin } from "/app/geom.js";
import { meshPart } from "/app/partmesh.js";

const fs = require('fs');
const PART_BK = fs.readFileSync(bro.resolvePath('/app/shaders/part.bk'), 'utf8');
const FLOOR_BK = fs.readFileSync(bro.resolvePath('/app/shaders/floor.bk'), 'utf8');

const DOMAIN_COLOR = { rot: [1.0, 0.62, 0.15], lin: [0.75, 0.45, 1.0], hyd: [0.15, 0.8, 0.95], elec: [0.35, 0.7, 1.0], mnt: [0.75, 0.8, 0.85] };

function qAxisAngle(axis, ang) {
    const s = Math.sin(ang / 2), c = Math.cos(ang / 2);
    if (axis === 'x') return [s, 0, 0, c];
    if (axis === 'y') return [0, s, 0, c];
    return [0, 0, s, c];
}

function splitRef(ref) { const i = ref.lastIndexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)]; }

export function createFoundryView(vp) {
    const scene = vp.scene;
    // The sky lights and is reflected, but the backdrop is the canvas's own
    // (foundry.css): a studio, not a place.
    skyEnvironment(scene, { hdri: 'kloppenheim_06_puresky', intensity: 0.8, rotation: 2.2 });
    scene.setEnvironment({ background: false });
    scene.setAmbient([0.05, 0.055, 0.065]);
    scene.setToneMap({ mode: 'aces' });
    scene.setExposure({ mode: 'fixed', ev: 0.15 });
    if (scene.setMSAA) scene.setMSAA(4);
    scene.setBloom({ threshold: 1.6, intensity: 0.22, radius: 0.5, iterations: 4 });
    const key = scene.createLight({ type: 'directional', direction: [-0.45, -0.8, -0.38], color: [1.0, 0.97, 0.92], intensity: 3.2, castsShadow: true, shadowMapSize: 2048, pcf: 3 });
    scene.createLight({ type: 'directional', direction: [0.7, -0.25, 0.6], color: [0.55, 0.72, 1.0], intensity: 1.1, castsShadow: false });
    scene.createLight({ type: 'directional', direction: [0.1, -0.2, -1.0], color: [1.0, 0.8, 0.6], intensity: 0.8, castsShadow: false });

    // Geometry made once per part (type, params, paint) and per coupling size,
    // drawn by every node that shows one: a long chain of the same assembly
    // uploads each of its parts once.
    const meshCache = new Map();
    let root = null, floor = null;
    let movers = [];         // { node, axis, speed, angle, slide, s, dir, base }
    let selectNodes = new Map();
    let shown = null;
    let visScale = 1;

    function partNode(el, paint, detail) {
        const key = el.type + JSON.stringify(el.params) + paint.join(',');
        let built = meshCache.get(key);
        if (!built) {
            const m = meshPart(el, lin(paint));
            built = {
                body: m.body.count ? { geometry: scene.createGeometry(m.body.finish({ ao: 48 })) } : null,
                movers: m.movers.map((mv) => ({ ...mv, mesh: { geometry: scene.createGeometry(mv.geo.finish({ ao: 32 })) }, geo: null })),
                shaftR: m.shaftR,
            };
            meshCache.set(key, built);
        }
        const group = scene.createNode({ name: 'part' });
        const shaded = [];
        if (built.body) {
            const n = meshNode(built.body, detail, `${el.type}:body`);
            group.add(n); shaded.push(n);
        }
        const mv = [];
        for (const m of built.movers) {
            const pivot = scene.createNode({ name: 'pivot' });
            pivot.position = m.pivot.slice();
            const n = meshNode(m.mesh, detail, `${el.type}:${m.port}`);
            pivot.add(n);
            group.add(pivot);
            shaded.push(n);
            mv.push({ node: m.slide ? n : pivot, axis: m.axis, port: m.port, sign: m.sign, slide: m.slide || 0, angle: 0, s: 0, dir: 1 });
        }
        return { group, shaded, movers: mv, shaftR: built.shaftR };
    }

    /** A shaded node of `src`: a Mesh, or { geometry } made once with scene.createGeometry. */
    function meshNode(src, detail, name) {
        const n = scene.createMesh({ ...(src.geometry ? { geometry: src.geometry } : { mesh: src }), color: [1, 1, 1], vertexColorTint: true, castsShadow: true, receivesShadow: true });
        if (name) n.name = name;
        n.setShader({ module: PART_BK, file: 'shaders/part.bk', uniforms: { detail, selected: 0, time: 0, pad0: 0 } });
        return n;
    }

    // Draw contract `c` into `parent`; returns { movers, shaded per child id, shaftR per 'child.port' }.
    function drawContract(c, parent) {
        const out = { movers: [], byChild: new Map(), shaftR: new Map() };
        const paint = c.paint || [0.5, 0.5, 0.52];
        for (const ch of c.children) {
            const g = scene.createNode({ name: ch.id });
            g.position = ch.pos.slice();
            g.quaternion = rotQuat(ch.rot);
            parent.add(g);
            let rec;
            if (ch.el.kind === 'part') {
                const size = Math.max(...ch.el.box.max.map((v, i) => v - ch.el.box.min[i]));
                const pn = partNode(ch.el, paint, 1 / Math.max(0.02, size));
                g.add(pn.group);
                rec = { movers: pn.movers, shaded: pn.shaded, inner: null };
                for (const [port, r] of Object.entries(pn.shaftR)) out.shaftR.set(`${ch.id}.${port}`, r);
            } else {
                const sub = drawContract(ch.el, g);
                const shaded = [];
                for (const v of sub.byChild.values()) shaded.push(...v.shaded);
                rec = { movers: [], shaded, inner: sub };
                // The nested contract's exposed ports carry the shaft radius of what they expose.
                for (const p of ch.el.ports) {
                    const r = sub.shaftR.get(p.at);
                    if (r) out.shaftR.set(`${ch.id}.${p.id}`, r);
                }
            }
            out.byChild.set(ch.id, rec);
        }
        // Couplings, cables and hoses.
        const placed = new Map(c.children.map((ch) => [ch.id, ch]));
        const portWorld = (ref) => {
            const [cid, pid] = splitRef(ref);
            const ch = placed.get(cid);
            const p = ch.el.ports.find((x) => x.id === pid);
            return { pos: rotApply(ch.rot, p.pos).map((v, i) => v + ch.pos[i]), axis: rotApply(ch.rot, p.axis) };
        };
        out.links = [];
        for (const l of c.links) {
            if (l.domain === 'mnt') continue;      // a bolted face: the parts draw their own plates
            const A = portWorld(l.out), B = portWorld(l.in);
            if (l.mech) {
                const r = Math.max(out.shaftR.get(l.out) || 0.004, out.shaftR.get(l.in) || 0.004);
                const R = r * 1.75, ck = 'coupling' + r.toPrecision(6);
                let mesh = meshCache.get(ck);
                if (!mesh) {
                    const g = new Geo();
                    const len = r * 2.6;
                    g.lathe([[r * 0.9, -len / 2], [R * 0.92, -len / 2], [R, -len / 2 + R * 0.08], [R, len / 2 - R * 0.08], [R * 0.92, len / 2], [r * 0.9, len / 2]], { color: lin([0.24, 0.25, 0.27]), mat: M.CAST, segs: 32 });
                    for (let k = 0; k < 2; k++) g.bolt([R * Math.cos(k * Math.PI), R * Math.sin(k * Math.PI), 0], k ? '-x' : 'x', r * 0.35);
                    mesh = { geometry: scene.createGeometry(g.finish({ ao: 0 })) };
                    meshCache.set(ck, mesh);
                }
                const pivot = scene.createNode({ name: 'coupling' });
                pivot.position = A.pos;
                pivot.quaternion = quatZTo(A.axis);
                const n = meshNode(mesh, 1 / Math.max(0.01, R * 6), `coupling ${l.out}`);
                pivot.add(n);
                parent.add(pivot);
                out.movers.push({ node: pivot, base: pivot.quaternion, axis: 'z', ref: l.out, sign: 1, slide: 0, angle: 0, coupling: true });
            } else {
                const g = new Geo();
                const span = Math.hypot(B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]);
                const reach = Math.max(0.02, span * 0.45);
                const pts = [];
                for (let k = 0; k <= 24; k++) {
                    const t = k / 24, u = 1 - t;
                    const P0 = A.pos, P1 = A.pos.map((v, i) => v + A.axis[i] * reach), P2 = B.pos.map((v, i) => v + B.axis[i] * reach), P3 = B.pos;
                    pts.push([0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]));
                }
                const size = Math.max(...c.size);
                const r = l.domain === 'hyd' ? Math.max(0.004, size * 0.012) : Math.max(0.0025, size * 0.008);
                g.tube(pts, r, { color: l.domain === 'hyd' ? lin([0.05, 0.05, 0.06]) : lin([0.9, 0.35, 0.05]), mat: M.RUBBER, segs: 10 });
                for (const E of [A, B]) {
                    g.lathe([[0, 0], [r * 1.5, 0], [r * 1.5, r * 3], [r * 1.1, r * 3.6]], { at: E.pos, axis: axisName(E.axis), color: l.domain === 'hyd' ? lin([0.86, 0.7, 0.36]) : lin([0.08, 0.08, 0.09]), mat: l.domain === 'hyd' ? M.BRASS : M.RUBBER, segs: 6 });
                }
                const n = meshNode(g.finish({ ao: 0 }), 1 / Math.max(0.01, size), `line ${l.out}`);
                parent.add(n);
            }
        }
        return out;
    }

    function axisName(a) {
        if (a[0] > 0.5) return 'x'; if (a[0] < -0.5) return '-x';
        if (a[1] > 0.5) return 'y'; if (a[1] < -0.5) return '-y';
        return a[2] < -0.5 ? '-z' : 'z';
    }

    function quatZTo(a) {
        const n = axisName(a);
        const s = Math.SQRT1_2;
        return { z: [0, 0, 0, 1], '-z': [0, 1, 0, 0], x: [0, s, 0, s], '-x': [0, -s, 0, s], y: [-s, 0, 0, s], '-y': [s, 0, 0, s] }[n];
    }

    function clear() {
        if (root) root.destroy();
        root = null;
        movers = []; selectNodes = new Map();
    }

    function stage(c) {
        const size = Math.max(...c.size, 0.05);
        const floorY = c.box.min[1] - size * 0.002;
        const radius = Math.max(2, size * 14);
        if (floor) floor.destroy();
        floor = scene.createMesh({ mesh: 'plane', halfW: radius, halfD: radius, color: [1, 1, 1], alphaToCoverage: true, castsShadow: false, receivesShadow: true });
        floor.name = 'floor';
        floor.position = [0, floorY, 0];
        const step = Math.pow(10, Math.floor(Math.log10(size * 0.6)));
        floor.setShader({ module: FLOOR_BK, file: 'shaders/floor.bk', uniforms: { step, radius, fadeStart: size * 1.6, fadeEnd: size * 7 } });
        scene.setFog({ enabled: false });
        scene.setSSAO({ enabled: true, radius: Math.max(0.01, size * 0.06), intensity: 1.1, bias: size * 0.001 });
        key.shadowDistance = size * 8;
    }

    function show(c, opts) {
        const o = opts || {};
        clear();
        shown = c;
        stage(c);
        root = scene.createNode({ name: 'contract' });
        const drawn = drawContract(c, root);
        collectMovers(drawn, (ref) => ref);
        for (const [cid, rec] of drawn.byChild) selectNodes.set(cid, rec.shaded);
        const placed = new Map(c.children.map((ch) => [ch.id, ch]));
        // Exposed ports: a ring in the domain's colour, sized to the child it is on (a hundred
        // segments' power lines are a hundred small rings, not a tube the length of the arm).
        const size = Math.max(...c.size);
        for (const p of c.ports) {
            const g = new Geo();
            const on = p.at && placed.get(p.at.slice(0, p.at.lastIndexOf('.')));
            const scale = on ? Math.max(...on.el.box.max.map((v, i) => v - on.el.box.min[i])) : size;
            const r = Math.max(0.006, Math.min(size * 0.03, scale * 0.08));
            g.lathe([[r * 0.78, 0], [r, 0], [r, r * 0.18], [r * 0.78, r * 0.18]], { color: lin(DOMAIN_COLOR[p.domain] || [1, 1, 1]), mat: M.GLOW, segs: 40 });
            const n = meshNode(g.finish({ ao: 0 }), 1 / size, `port ${p.id}`);
            n.position = p.pos.slice();
            n.quaternion = quatZTo(p.axis);
            root.add(n);
        }
        if (o.frame !== false) frame();
        return placed;
    }

    // Flatten movers with the path from the top contract down, so setFlows can find each one's flow.
    function collectMovers(drawn, _ref, prefix = []) {
        for (const m of drawn.movers) movers.push({ ...m, path: prefix, kind: 'link' });
        for (const [cid, rec] of drawn.byChild) {
            for (const m of rec.movers) movers.push({ ...m, path: prefix.concat(cid), kind: 'part' });
            if (rec.inner) collectMovers(rec.inner, _ref, prefix.concat(cid));
        }
    }

    function frame() {
        if (!shown) return;
        const s = shown.size;
        const size = Math.max(...s, 0.05);
        // Fit the bounding sphere, not the longest side, so long machines fill the view too.
        const radius = Math.max(0.025, 0.5 * Math.hypot(s[0], s[1], s[2]));
        const c = shown.box.min.map((v, i) => (v + shown.box.max[i]) / 2);
        // Look at the face the output comes out of, from three-quarters on.
        const outId = shown.goal ? shown.goal.out : (shown.ports.find((p) => p.dir === 'out') || {}).id;
        const out = shown.ports.find((p) => p.id === outId);
        let yaw = 0.72;
        if (out && Math.abs(out.axis[1]) < 0.5) yaw = Math.atan2(out.axis[0], out.axis[2]) + 0.72;
        // Pivot a little below the centre: the flow strip covers the bottom of the view.
        vp.reframe([c[0], c[1] - radius * 0.2, c[2]], radius * 2.8, { yaw, pitch: -0.38 });
        vp.cam.near = size * 0.02;
        vp.cam.far = size * 60;
    }

    /** portFlows: { exposedPortId: flow } of the shown contract. */
    function setFlows(portFlows) {
        const map = flowsFor(shown, portFlows);
        let maxW = 0;
        for (const m of movers) {
            let rec = { inner: map };
            let ok = true;
            for (const cid of m.path) { rec = rec.inner && rec.inner.get(cid); if (!rec) { ok = false; break; } }
            if (!ok) { m.speed = 0; continue; }
            if (m.kind === 'part') m.speed = (rec.ports[m.port] || 0) * m.sign;
            else {
                const inner = rec.inner;
                const [cid, pid] = splitRef(m.ref);
                const r = inner && inner.get(cid);
                m.speed = r ? (r.ports[pid] || 0) : 0;
            }
            if (!m.slide) maxW = Math.max(maxW, Math.abs(m.speed));
        }
        visScale = maxW > 0 ? Math.min(1, (2 * Math.PI * 1.2) / maxW) : 1;
    }

    function tick(dt) {
        for (const m of movers) {
            if (!m.speed) continue;
            if (m.slide) {
                m.s += m.dir * Math.abs(m.speed) * dt * Math.max(visScale, 0.25) * 6;
                if (m.s > m.slide) { m.s = m.slide; m.dir = -1; }
                if (m.s < 0) { m.s = 0; m.dir = 1; }
                const p = [0, 0, 0];
                p[{ x: 0, y: 1, z: 2 }[m.axis]] = m.s;
                m.node.position = p;
            } else {
                m.angle += m.speed * visScale * dt;
                const q = qAxisAngle(m.axis, m.angle);
                m.node.quaternion = m.base ? qMul(m.base, q) : q;
            }
        }
    }

    function select(cid) {
        for (const [id, nodes] of selectNodes) {
            for (const n of nodes) n.setShaderUniform('selected', id === cid ? 1 : 0);
        }
    }

    /** The child under canvas pixel (px, py), or null. */
    function pick(px, py) {
        // The mesh actually under the pointer, then up to the child of the
        // shown contract that holds it.
        const r = vp.ray(px, py);
        if (!r || !root) return null;
        const hit = scene.raycast(r.origin, r.dir, 1e4);
        let n = hit && hit.hit ? hit.node : null;
        while (n && n.parent && n.parent.id !== root.id) n = n.parent;
        return n && n.parent && shown.children.some((c) => c.id === n.name) ? n.name : null;
    }

    return { show, frame, setFlows, tick, select, pick, get contract() { return shown; }, get movers() { return movers; } };
}

function qMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
