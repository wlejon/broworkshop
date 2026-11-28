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
import { standOf, frameApply, frameMul, frameInv } from "/lib/foundry/operate.js";
import { tipAt, varsOf } from "/lib/foundry/pilot.js";

const IDENT = { q: [0, 0, 0, 1], t: [0, 0, 0] };
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
    let root = null, floor = null, terrain = null, floorParams = null;
    let movers = [];         // { node, axis, speed, angle, slide, s, dir, base }
    let selectNodes = new Map();
    let shown = null;
    // How the shown design stands (a quaternion on the root), and its box so stood.
    let stand = [0, 0, 0, 1], seen = null;
    // The top level as drawn (for posing), the exposed-port rings, and whether the machine is being run.
    let drawnTop = null, rings = [], operating = false;
    let visScale = 1;

    function partNode(el, paint, detail) {
        const key = el.type + JSON.stringify(el.params) + paint.join(',');
        let built = meshCache.get(key);
        if (!built) {
            const m = meshPart(el, lin(paint));
            // Movers that share a geometry (a ring's pinions) are baked and uploaded once.
            const once = new Map();
            const geometryOf = (geo) => once.get(geo) || once.set(geo, scene.createGeometry(geo.finish({ ao: 32 }))).get(geo);
            built = {
                body: m.body.count ? { geometry: scene.createGeometry(m.body.finish({ ao: 48 })) } : null,
                movers: m.movers.map((mv) => ({ ...mv, mesh: { geometry: geometryOf(mv.geo) }, geo: null })),
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
        n.setShader({ module: PART_BK, file: 'shaders/part.bk', uniforms: { detail, selected: 0, time: 0, clash: 0 } });
        return n;
    }

    // Draw contract `c` into `parent`; returns { movers, shaded per child id, shaftR per 'child.port' }.
    function drawContract(c, parent) {
        const out = { movers: [], byChild: new Map(), shaftR: new Map(), nodes: new Map(), lines: [] };
        const paint = c.paint || [0.5, 0.5, 0.52];
        for (const ch of c.children) {
            const g = scene.createNode({ name: ch.id });
            g.position = ch.pos.slice();
            g.quaternion = rotQuat(ch.rot);
            out.nodes.set(ch.id, { node: g, pos: ch.pos.slice(), quat: rotQuat(ch.rot) });
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
                out.movers.push({ node: pivot, base: pivot.quaternion, axis: 'z', ref: l.out, sign: 1, slide: 0, angle: 0, coupling: true, owner: splitRef(l.out)[0], restPos: A.pos.slice(), restBase: pivot.quaternion });
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
                out.lines.push(n);
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
        floorParams = { step, radius, fadeStart: size * 1.6, fadeEnd: size * 7 };
        floor.setShader({ module: FLOOR_BK, file: 'shaders/floor.bk', uniforms: floorParams });
        if (terrain) { terrain.destroy(); terrain = null; }
        scene.setFog({ enabled: false });
        scene.setSSAO({ enabled: true, radius: Math.max(0.01, size * 0.06), intensity: 1.1, bias: size * 0.001 });
        key.shadowDistance = size * 8;
    }

    function show(c, opts) {
        const o = opts || {};
        clear();
        shown = c;
        // A design is drawn in its own frame, its joints straight out and level: the pose its
        // statics are worked in. One whose base carries a turntable (an upright joint) knows
        // which way is down, and stands on its base.
        stand = standOf(c);
        const corners = [];
        for (let k = 0; k < 8; k++) corners.push(qRot(stand, [0, 1, 2].map((i) => ((k >> i) & 1 ? c.box.max[i] : c.box.min[i]))));
        const min = [0, 1, 2].map((i) => Math.min(...corners.map((p) => p[i]))), max = [0, 1, 2].map((i) => Math.max(...corners.map((p) => p[i])));
        seen = { box: { min, max }, size: max.map((v, i) => v - min[i]) };
        stage(seen);
        root = scene.createNode({ name: 'contract' });
        root.quaternion = stand;
        const drawn = drawContract(c, root);
        drawnTop = drawn; rings = [];
        collectMovers(drawn, (ref) => ref);
        // Children that run into one another are drawn red.
        const clashing = new Set((c.clashes || []).flatMap((x) => [x.a, x.b]));
        for (const [cid, rec] of drawn.byChild) {
            selectNodes.set(cid, rec.shaded);
            if (clashing.has(cid)) for (const n of rec.shaded) n.setShaderUniform('clash', 1);
        }
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
            rings.push(n);
        }
        if (o.frame !== false) frame();
        return placed;
    }

    // Flatten movers with the path from the top contract down, so setFlows can find each one's flow.
    function collectMovers(drawn, _ref, prefix = []) {
        for (const m of drawn.movers) { m.live = { ...m, path: prefix, kind: 'link' }; movers.push(m.live); }
        for (const [cid, rec] of drawn.byChild) {
            for (const m of rec.movers) movers.push({ ...m, path: prefix.concat(cid), kind: 'part' });
            if (rec.inner) collectMovers(rec.inner, _ref, prefix.concat(cid));
        }
    }

    function frame() {
        if (!shown) return;
        const s = seen.size;
        const size = Math.max(...s, 0.05);
        // Fit the bounding sphere, not the longest side, so long machines fill the view too.
        const radius = Math.max(0.025, 0.5 * Math.hypot(s[0], s[1], s[2]));
        const c = seen.box.min.map((v, i) => (v + seen.box.max[i]) / 2);
        // Look at the face the output comes out of, from three-quarters on.
        const outId = shown.goal ? shown.goal.out : (shown.ports.find((p) => p.dir === 'out') || {}).id;
        const out = shown.ports.find((p) => p.id === outId);
        const oa = out && qRot(stand, out.axis);
        let yaw = 0.72;
        if (oa && Math.abs(oa[1]) < 0.5) yaw = Math.atan2(oa[0], oa[2]) + 0.72;
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

    // --- running the machine ------------------------------------------------------------

    /**
     * Pose the shown design: `frames` holds, per joint of its contract, the rigid
     * move ({ q, t }, the design's frame) of what that joint carries from where
     * it was built. Every child moves with its carrier; a nested design's
     * children move with the joints of the shown design that record its own,
     * turned into the nested design's frame; couplings go with the child they turn.
     */
    function pose(frames) {
        if (!shown || !drawnTop) return;
        poseLevel(shown, drawnTop, frames);
    }

    function poseLevel(c, drawn, M) {
        const at = (carrier, pos, quat) => {
            const m = carrier != null ? M[carrier] : null;
            return m ? { pos: frameApply(m, pos), quat: qMul(m.q, quat) } : { pos, quat };
        };
        for (const ch of c.children) {
            const n = drawn.nodes.get(ch.id);
            if (!n) continue;
            const p = at(ch.carrier, n.pos, n.quat);
            n.node.position = p.pos;
            n.node.quaternion = p.quat;
            const rec = drawn.byChild.get(ch.id);
            if (rec && rec.inner) {
                // Inside the child: Place⁻¹ · F(carrier)⁻¹ · M(k) · Place, Place being where the child sits.
                const place = { q: n.quat, t: n.pos };
                const outer = frameInv(ch.carrier != null ? M[ch.carrier] : IDENT);
                const inner = new Array(ch.el.joints.length).fill(IDENT);
                c.joints.forEach((J, k) => {
                    if (!J.nested || J.nested.child !== ch.id) return;
                    inner[J.nested.index] = frameMul(frameInv(place), frameMul(outer, frameMul(M[k], place)));
                });
                poseLevel(ch.el, rec.inner, inner);
            }
        }
        const carrierOf = new Map(c.children.map((ch) => [ch.id, ch.carrier]));
        for (const m of drawn.movers) {
            if (!m.coupling || !m.live) continue;
            const p = at(carrierOf.get(m.owner), m.restPos, m.restBase);
            m.live.node.position = p.pos;
            m.live.base = p.quat;
            m.live.node.quaternion = qMul(p.quat, qAxisAngle('z', m.live.angle || 0));
        }
    }

    // The yard: the world's bodies other than the machine (crates, a person, the load on its rope).
    let yard = [];
    function setOperate(on) {
        operating = on;
        for (const n of rings) n.visible = !on;
        const hide = (drawn) => {
            for (const n of drawn.lines) n.visible = !on;
            for (const rec of drawn.byChild.values()) if (rec.inner) hide(rec.inner);
        };
        if (drawnTop) hide(drawnTop);
        for (const y of yard) { y.node.destroy(); if (y.rope) y.rope.destroy(); if (y.mark) y.mark.destroy(); }
        yard = [];
        if (!on || !seen) return;
        // Frame the ground it can sweep, not the pose it was built in: what it carries swings
        // round and lifts up to about its own length.
        {
            const s = seen.size, reach = Math.hypot(s[0], s[2]);
            const c = seen.box.min.map((v, i) => (v + seen.box.max[i]) / 2);
            vp.reframe([c[0], seen.box.min[1] + reach * 0.45, c[2]], reach * 2.3, { yaw: 0.72, pitch: -0.32 });
            vp.cam.far = Math.max(...s, 0.05) * 80;
        }
    }

    const COLORS = {
        crate: [0.45, 0.33, 0.2], concrete: [0.58, 0.58, 0.56], target: [0.2, 0.45, 0.75], person: [0.95, 0.42, 0.08], load: [0.3, 0.32, 0.36],
        pad: [0.16, 0.42, 0.3], padDone: [0.25, 0.75, 0.42], spot: [0.7, 0.55, 0.15], goal: [0.95, 0.85, 0.2], goalSide: [0.95, 0.45, 0.1], goalWay: [0.95, 0.85, 0.2], hook: [0.85, 0.65, 0.1], hooked: [0.95, 0.3, 0.15], drop: [0.15, 0.95, 0.35], reach: [0.45, 0.5, 0.58], reachOn: [0.95, 0.55, 0.15],
    };
    /**
     * Draw the world's other bodies where they are: `props` from the site
     * ({ kind, id?, half | radius + height, pose [x y z qx qy qz qw], from (a line's top) }):
     * crates, people, pads marked on the ground (lit when a delivery is done), test loads,
     * and each machine's hook on its line. A thing seen for the first time gets a mesh;
     * one gone loses it.
     */
    function setProps(props) {
        if (!operating) return;
        const key = (p) => p.id || (p.kind === 'hook' ? `hook:${p.machine.name}` : `${p.kind}:${p.body ?? 'load'}:${p.half ? p.half[0].toFixed(4) : ''}`);
        const want = new Set(props.map(key));
        yard = yard.filter((y) => { if (want.has(y.key)) return true; y.node.destroy(); if (y.rope) y.rope.destroy(); if (y.mark) y.mark.destroy(); return false; });
        for (const p of props) {
            let y = yard.find((x) => x.key === key(p));
            if (!y) {
                const node = p.kind === 'person'
                    ? scene.createMesh({ mesh: 'capsule', radius: p.radius, height: p.height, color: COLORS.person, castsShadow: true, receivesShadow: true })
                    : p.kind === 'hook'
                        ? scene.createMesh({ mesh: 'sphere', radius: p.radius, color: COLORS.hook, castsShadow: true })
                        : scene.createMesh({ mesh: 'box', halfW: p.half[0], halfH: p.half[1], halfD: p.half[2], color: COLORS[p.material === 'concrete' ? 'concrete' : p.kind] || COLORS.crate, castsShadow: p.kind !== 'pad' && p.kind !== 'spot' && p.kind !== 'target' && p.kind !== 'goal' && p.kind !== 'goalSide' && p.kind !== 'goalWay', receivesShadow: true });
                node.name = p.kind;
                y = { key: key(p), node, rope: null, lit: null };
                if (p.from) {
                    const r = p.kind === 'hook' ? p.radius * 0.25 : Math.max(0.004, p.half[0] * 0.06);
                    y.rope = scene.createMesh({ mesh: 'cylinder', radius: r, halfHeight: 0.5, color: [0.08, 0.08, 0.09], castsShadow: true });
                    y.rope.name = 'rope';
                }
                yard.push(y);
            }
            y.node.position = [p.pose[0], p.pose[1], p.pose[2]];
            y.node.quaternion = [p.pose[3], p.pose[4], p.pose[5], p.pose[6]];
            if ((p.kind === 'pad' || p.kind === 'target') && y.lit !== !!p.done) { y.lit = !!p.done; y.node.color = y.lit ? COLORS.padDone : COLORS[p.kind]; }
            if (p.kind === 'hook' && y.lit !== !!p.hooked) { y.lit = !!p.hooked; y.node.color = y.lit ? COLORS.hooked : COLORS.hook; }
            if (p.kind === 'hook') {
                // Where the hook would come down: a disc on whatever is under it, a crate's top
                // or the ground, so an operator sees over what the hook hangs from any angle.
                if (!y.mark) {
                    y.mark = scene.createMesh({ mesh: 'cylinder', radius: p.radius * 2.2, halfHeight: 0.002, color: COLORS.hook, castsShadow: false, receivesShadow: false });
                    y.mark.name = 'drop';
                }
                // Green over a free crate (to take) or over a pad (to set it down on).
                let floor = seen.groundAt ? seen.groundAt(p.pose[0], p.pose[2]) : seen.ground, on = false;
                for (const c of props) {
                    if ((c.kind !== 'crate' && c.kind !== 'pad') || c.held) continue;
                    const q = [c.pose[3], c.pose[4], c.pose[5], c.pose[6]], rel = qRot(qConj(q), [p.pose[0] - c.pose[0], 0, p.pose[2] - c.pose[2]]);
                    if (Math.abs(rel[0]) < c.half[0] && Math.abs(rel[2]) < c.half[2] && c.pose[1] < p.pose[1] && c.pose[1] + c.half[1] >= floor) {
                        floor = c.pose[1] + c.half[1];
                        on = c.kind === 'crate' ? !p.hooked : !!p.hooked;
                    }
                }
                // A machine's deck under it: a load can be set down there too.
                if (p.deck != null && p.deck >= floor) { floor = p.deck; on = !!p.hooked; }
                y.mark.position = [p.pose[0], floor + 0.003, p.pose[2]];
                y.mark.color = on ? COLORS.drop : COLORS.hook;
            }
            if (y.rope && p.from) {
                // From the tip to the hook, or to the middle of a block's top face.
                const top = p.kind === 'hook' ? p.pose.slice(0, 3) : qRot([p.pose[3], p.pose[4], p.pose[5], p.pose[6]], [0, p.half[1], 0]).map((v, i) => v + p.pose[i]);
                const d = top.map((v, i) => p.from[i] - v), len = Math.max(1e-3, Math.hypot(...d));
                y.rope.position = top.map((v, i) => v + d[i] / 2);
                y.rope.quaternion = quatYTo(d.map((v) => v / len));
                y.rope.scale = [1, len, 1];
            }
        }
    }

    // --- a yard: several machines in one world ------------------------------------------

    let yardMachines = [];      // { m, node, drawn, shaded, label, ring }
    let follow = null;          // the machine the camera keeps in view as it moves: { m, at }
    /**
     * Draw `site` (site.js): each of its machines from its contract, stood where the
     * site placed it, the ground under them all, and the yard's things (setProps).
     * The camera takes in the lot.
     */
    function showYard(site) {
        clear();
        for (const y of yardMachines) { y.node.destroy(); y.label.destroy(); if (y.ring) y.ring.destroy(); }
        yardMachines = [];
        for (const y of yard) { y.node.destroy(); if (y.rope) y.rope.destroy(); if (y.mark) y.mark.destroy(); }
        yard = [];
        shown = null; drawnTop = null; rings = [];
        operating = true;
        const lo = [Infinity, site.ground, Infinity], hi = [-Infinity, site.ground, -Infinity];
        for (const m of site.machines) {
            const node = scene.createNode({ name: `machine ${m.name}` });
            node.position = m.place.t.slice();
            node.quaternion = m.place.q.slice();
            const drawn = drawContract(m.contract, node);
            const hide = (d) => { for (const n of d.lines) n.visible = false; for (const rec of d.byChild.values()) if (rec.inner) hide(rec.inner); };
            hide(drawn);
            const shaded = [...drawn.byChild.values()].flatMap((r) => r.shaded);
            // Its name over it, so the yard says which machine is which.
            const label = scene.createHtmlNode({ width: 240, height: 56, pxPerUnit: 240 / (m.size * 0.45), billboard: "full", worldAnchor: [m.mid[0], m.ground + m.size * 0.42, m.mid[1]], html: "" });
            // How far out its hook goes, as a ring on the ground: where two rings overlap, both reach.
            const vars = varsOf(m), far = m.tipWorld() && tipAt(m, vars, vars.map(() => 0)), R = far ? Math.hypot(far[0] - m.mid[0], far[2] - m.mid[1]) : 0;
            const ring = R > 0.05 ? scene.createMesh({ mesh: "torus", majorRadius: R, minorRadius: Math.max(0.01, m.size * 0.006), majorSegments: 128, minorSegments: 6, color: COLORS.reach, castsShadow: false, receivesShadow: false }) : null;
            if (ring) { ring.position = [m.mid[0], m.ground + 0.004, m.mid[1]]; ring.scale = [1, 0.2, 1]; }
            yardMachines.push({ m, node, drawn, shaded, label, ring });
            tag(yardMachines.at(-1), false);
            const r = m.size * 0.9;
            lo[0] = Math.min(lo[0], m.mid[0] - r); hi[0] = Math.max(hi[0], m.mid[0] + r);
            lo[2] = Math.min(lo[2], m.mid[1] - r); hi[2] = Math.max(hi[2], m.mid[1] + r);
            hi[1] = Math.max(hi[1], site.ground + m.size * 0.6);
        }
        for (const p of [...site.pads, ...site.crates.map((c) => ({ at: [...site.poseOf(c).slice(0, 3)] }))]) {
            lo[0] = Math.min(lo[0], p.at[0] - 0.5); hi[0] = Math.max(hi[0], p.at[0] + 0.5);
            lo[2] = Math.min(lo[2], p.at[2] - 0.5); hi[2] = Math.max(hi[2], p.at[2] + 0.5);
        }
        seen = { box: { min: lo, max: hi }, size: hi.map((v, i) => v - lo[i]), ground: site.ground, groundAt: site.groundAt };
        stage({ size: [seen.size[0] * 0.25, seen.size[1], seen.size[2] * 0.25], box: { min: [0, site.ground, 0] } });
        // Ground that rises: the site's height field, gridded like the floor it rises from.
        const tm = site.terrainMesh && site.terrainMesh();
        if (tm) {
            terrain = scene.createMesh({ positions: tm.positions, indices: tm.indices, color: [1, 1, 1], castsShadow: true, receivesShadow: true });
            terrain.name = 'terrain';
            terrain.setShader({ module: FLOOR_BK, file: 'shaders/floor.bk', uniforms: floorParams });
        }
        const span = Math.hypot(seen.size[0], seen.size[2]);
        vp.cam.near = span * 0.005;
        vp.cam.far = span * 40;
        frameYard(null, { yaw: 0.35, pitch: -0.62 });
        poseYard(site);
    }

    /**
     * Frame the yard, or with `m` the machine being driven and its reach round it, inside
     * `free` ({ left, top, width, height } in canvas CSS px: the part of the view no panel
     * covers; default all of it). Looked at from where the camera is, unless `angles` says.
     */
    function frameYard(m, angles, free) {
        const R = vp.canvas.getBoundingClientRect();
        if (!R.width || !R.height) return;
        const f = free || { left: 0, top: 0, width: R.width, height: R.height };
        follow = m ? { m, at: [m.mid[0], m.mid[1]] } : null;
        let pivot, r;
        if (m) {
            // A machine on wheels or feet goes places: take in the ground round it, not just itself.
            r = m.contract.vehicle || m.contract.walker ? Math.max(m.size * 2.5, 6) : m.size * 1.1;
            pivot = [m.mid[0], m.ground + m.size * 0.1, m.mid[1]];
            // Driving, look down steeply from the same heading: over what the hook hangs
            // reads straight off the ground, not guessed through the perspective.
            if (!angles) { const f = qRot(vp.cam.rot, [0, 0, -1]); angles = { yaw: Math.atan2(-f[0], -f[2]), pitch: -1.0 }; }
        }
        else {
            if (!angles) { const f = qRot(vp.cam.rot, [0, 0, -1]); angles = { yaw: Math.atan2(-f[0], -f[2]), pitch: -0.62 }; }
            const lo = seen.box.min, hi = seen.box.max;
            r = 0.5 * Math.hypot(seen.size[0], seen.size[2]);
            pivot = [(lo[0] + hi[0]) / 2, seen.ground + r * 0.1, (lo[2] + hi[2]) / 2];
        }
        // Far enough that a circle of radius r fits the free part's height and width.
        const t = Math.tan((vp.cam.fov * Math.PI) / 360);
        const dist = 1.1 * Math.max(r / (t * f.height / R.height), r / (t * f.width / R.height));
        vp.reframe(pivot, dist, angles);
        // Slide the camera across so the pivot sits in the middle of the free part.
        const wpp = (2 * dist * t) / R.height;
        const dx = f.left + f.width / 2 - R.width / 2, dy = f.top + f.height / 2 - R.height / 2;
        const right = qRot(vp.cam.rot, [1, 0, 0]), up = qRot(vp.cam.rot, [0, 1, 0]);
        vp.cam.pos = vp.cam.pos.map((v, i) => v - right[i] * dx * wpp + up[i] * dy * wpp);
    }

    /** Pose every machine of the yard where its world has it, and the yard's things. */
    function poseYard(site) {
        for (const y of yardMachines) {
            const m = y.m;
            // A machine on wheels or feet goes where they take it: its node, its name and its ring with it.
            if (m.contract.vehicle || m.contract.walker) {
                y.node.position = m.place.t.slice();
                y.node.quaternion = m.place.q.slice();
                y.label.worldAnchor = [m.mid[0], m.ground + m.size * 0.42, m.mid[1]];
                if (y.ring) y.ring.position = [m.mid[0], m.ground + 0.004, m.mid[1]];
            }
            poseLevel(m.contract, y.drawn, m.frames());
        }
        // The camera keeps the driven machine where it was in the view as it goes.
        if (follow) {
            const d = [follow.m.mid[0] - follow.at[0], 0, follow.m.mid[1] - follow.at[1]];
            if (d[0] || d[2]) {
                vp.cam.pos = vp.cam.pos.map((v, i) => v + d[i]);
                if (vp.cam.pivot) vp.cam.pivot = vp.cam.pivot.map((v, i) => v + d[i]);
                follow.at = [follow.m.mid[0], follow.m.mid[1]];
            }
        }
        setProps(site.props());
    }

    /** The yard's machine under canvas pixel (px, py), or null. */
    function pickMachine(px, py) {
        const r = vp.ray(px, py);
        if (!r || !yardMachines.length) return null;
        const hit = scene.raycast(r.origin, r.dir, 1e4);
        let n = hit && hit.hit ? hit.node : null;
        while (n) {
            const y = yardMachines.find((x) => x.node.id === n.id);
            if (y) return y.m;
            n = n.parent;
        }
        return null;
    }

    /** Light machine `m` of the yard as the one being driven (null: none). */
    function selectMachine(m) {
        for (const y of yardMachines) {
            for (const n of y.shaded) n.setShaderUniform('selected', y.m === m ? 1 : 0);
            tag(y, y.m === m);
        }
    }

    /** A yard machine's name tag: outlined in orange while it is the one being driven. */
    function tag(y, driven) {
        if (y.ring) y.ring.color = driven ? COLORS.reachOn : COLORS.reach;
        const name = y.m.name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
        y.label.setHtml(`<div style="display:inline-block;padding:4px 14px;border-radius:8px;pointer-events:none;`
            + `background:rgba(18,20,26,0.78);border:2px solid ${driven ? '#f08a24' : 'rgba(255,255,255,0.25)'};`
            + `color:#fff;font:600 30px sans-serif;white-space:nowrap">${name}</div>`);
    }

    /** Leave the yard: its machines and things are taken down. */
    function closeYard() {
        for (const y of yardMachines) { y.node.destroy(); y.label.destroy(); if (y.ring) y.ring.destroy(); }
        yardMachines = [];
        for (const y of yard) { y.node.destroy(); if (y.rope) y.rope.destroy(); if (y.mark) y.mark.destroy(); }
        yard = [];
        operating = false;
    }

    return {
        show, frame, setFlows, tick, select, pick, pose, setOperate, setProps,
        showYard, poseYard, frameYard, pickMachine, selectMachine, closeYard,
        /**
         * Which way the ground direction [dx, dz] points on screen, as a CSS rotation in
         * degrees (0 up, clockwise): a dial drawn this way turns as the view shows it.
         */
        screenHeading(dx, dz) {
            const r = qRot(vp.cam.rot, [1, 0, 0]), f = qRot(vp.cam.rot, [0, 0, -1]);
            const fl = Math.hypot(f[0], f[2]) || 1, sx = dx * r[0] + dz * r[2], sy = (dx * f[0] + dz * f[2]) / fl;
            return (Math.atan2(sx, sy * Math.max(0.2, Math.abs(f[1]))) * 180) / Math.PI;
        },
        get contract() { return shown; }, get movers() { return movers; },
    };
}

function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

// The shortest turn taking +Y to unit vector `d`.
function quatYTo(d) {
    const c = d[1];
    if (c < -0.999999) return [1, 0, 0, 0];
    const ax = [d[2], 0, -d[0]], s = Math.sqrt((1 + c) * 2);
    return [ax[0] / s, ax[1] / s, ax[2] / s, s / 2];
}

function qRot(q, v) {
    const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
}

function qMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
