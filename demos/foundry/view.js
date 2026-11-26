// The machine in the scene: a node per segment instance carrying its frame,
// armour, module bodies, what the modules show outside, and what glows; the
// overlays the editing modes draw over it; and picking against the design
// itself (hulls and bays), so a click answers with a segment, a face and a
// cell rather than a triangle.

import { buildMech, bayLines, cellBoxMesh, linesMesh } from "/lib/mech/build.js";
import { hullBasis, rayHull, rayBox, moduleBox, bay, firstFreeCell, poseWorld } from "/lib/mech/skeleton.js";
import { MeshBuilder } from "/lib/mech/geom.js";
import { takenCells } from "/lib/mech/design.js";
import { sub, qrot, qconj, mirrorV, QI } from "/lib/mech/vec.js";

const LAYERS = ['frame', 'armor', 'inner', 'outer', 'glow', 'hull'];
const MATERIAL = {
    frame: { metallic: 0.85, roughness: 0.55 },
    armor: { metallic: 0.35, roughness: 0.62 },
    inner: { metallic: 0.5, roughness: 0.5 },
    outer: { metallic: 0.9, roughness: 0.38 },
    glow:  { metallic: 0, roughness: 0.6, emissive: 2.4 },
    hull:  { metallic: 0.1, roughness: 0.8, color: [0.25, 0.35, 0.50, 0.05], castsShadow: false, receivesShadow: false },
};

export function createMechView(scene) {
    let nodes = {};           // instance id -> { group, frame, armor, ... }
    let insts = [], design = null, report = null;
    let pose = null;          // instance id -> { pos, rot }, as drawn
    const show = { frame: true, armor: true, inner: true, outer: true, glow: true, hull: false };
    const overlays = [];
    let glowLevel = 1;

    function clearOverlays() {
        for (const n of overlays.splice(0)) n.destroy();
    }
    function clear() {
        clearOverlays();
        for (const id in nodes) nodes[id].group.destroy();
        nodes = {};
    }

    /** Rebuilds every mesh from the design. `opts.armor`: 'paint' | 'thickness'. */
    function sync(d, r, opts) {
        clear();
        design = d; report = r; insts = r.insts;
        const built = buildMech(d, r, opts);
        for (const it of insts) {
            const group = scene.createNode({ name: it.id });
            const rec = { group, inst: it };
            for (const layer of LAYERS) {
                const data = built[it.seg.id][layer](it.side < 0);
                if (!data) continue;
                const o = Object.assign({ name: it.id + ':' + layer }, MATERIAL[layer], data);
                if (layer === 'hull') delete o.colors; else o.vertexColorTint = true;
                const node = scene.createMesh(o);
                node.visible = show[layer];
                group.add(node);
                rec[layer] = node;
            }
            nodes[it.id] = rec;
        }
        setPose(null);
        setGlow(glowLevel);
    }

    /** A design whose segments only moved: the meshes stay, the rest pose is taken again. */
    function update(d, r) {
        design = d; report = r; insts = r.insts;
        for (const it of insts) nodes[it.id].inst = it;
        setPose(null);
    }

    /** Puts every segment where `p` says (instance id -> { pos, rot }); null stands it at rest. */
    function setPose(p) {
        if (!report) return;
        pose = p || poseWorld(design, insts, report.rest.pos[insts[0].id], QI, null);
        for (const it of insts) {
            const g = nodes[it.id].group, t = pose[it.id];
            g.position = t.pos; g.quaternion = t.rot;
        }
    }

    function setLayers(o) {
        Object.assign(show, o);
        for (const id in nodes) for (const layer of LAYERS) if (nodes[id][layer]) nodes[id][layer].visible = show[layer];
    }

    /** How brightly the lit parts burn: one level, or instance id -> level. */
    function setGlow(level) {
        glowLevel = level;
        for (const id in nodes) {
            const n = nodes[id].glow;
            if (n) n.emissive = typeof level === 'number' ? level : (level[id] ?? level['*'] ?? 1);
        }
    }

    /** Dims everything but the instances of `segId` (null: nothing dimmed). */
    function focus(segId) {
        for (const id in nodes) {
            const on = !segId || nodes[id].inst.seg.id === segId;
            const c = on ? [1, 1, 1] : [0.32, 0.34, 0.38];
            for (const layer of ['frame', 'armor', 'inner', 'outer']) if (nodes[id][layer]) nodes[id][layer].color = c;
            if (nodes[id].hull) nodes[id].hull.color = on && segId ? [0.30, 0.50, 0.80, 0.10] : [0.25, 0.35, 0.50, 0.05];
        }
    }

    // --- overlays -----------------------------------------------------------------

    function overlayIn(instId, o) {
        const node = scene.createMesh(Object.assign({ castsShadow: false, receivesShadow: false }, o));
        (instId ? nodes[instId].group : scene.root).add(node);
        overlays.push(node);
        return node;
    }

    /** The cells of a segment's bay, drawn on each of its instances. */
    function showBay(segId) {
        for (const it of insts) {
            if (it.seg.id !== segId) continue;
            const data = bayLines(it.seg, it.side < 0);
            if (!data) continue;
            // Thin bars rather than a line mesh: lines draw at full white under the metered sky.
            const mb = new MeshBuilder(), p = data.positions, ix = data.indices;
            for (let i = 0; i < ix.length; i += 2) {
                const a = ix[i] * 3, b = ix[i + 1] * 3;
                mb.beam([p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], 0.035, [1, 1, 1]);
            }
            const bars = mb.data(false);
            delete bars.colors;
            overlayIn(it.id, Object.assign({ color: [0.20, 0.42, 0.70], emissive: 0.25, roughness: 1 }, bars));
        }
    }

    /** A box of cells in a segment's bay, outlined in `color` on each instance. */
    function showCells(segId, cell, size, color, grow) {
        for (const it of insts) {
            if (it.seg.id !== segId) continue;
            const data = cellBoxMesh(it.seg, cell, size, [1, 1, 1], it.side < 0, grow ?? 0.06);
            if (data) { delete data.colors; overlayIn(it.id, Object.assign({ color, emissive: 0.6, roughness: 1 }, data)); }
        }
    }

    /** The lines of `kind` (null: all) through the frame. */
    function showLines(kind) {
        const data = linesMesh(design, report, kind);
        if (data) overlayIn(null, Object.assign({ vertexColorTint: true, metallic: 0.2, roughness: 0.5, emissive: 0.35 }, data));
    }

    /** A marker ball at a world point. */
    function showMarker(p, radius, color) {
        return overlayIn(null, { mesh: 'sphere', radius, segments: 16, rings: 10, color, emissive: 1.2, roughness: 1, position: p });
    }

    /** An arrow from a world point along `v` (its length), as a thin box and a head. */
    function showArrow(p, v, color, width) {
        const l = Math.hypot(v[0], v[1], v[2]);
        if (!(l > 1e-3)) return;
        const d = [v[0] / l, v[1] / l, v[2] / l];
        const node = overlayIn(null, { mesh: 'cylinder', radius: width || 0.25, height: l, segments: 8, color, emissive: 1.2, roughness: 1,
            position: [p[0] + v[0] / 2, p[1] + v[1] / 2, p[2] + v[2] / 2] });
        // A cylinder lies along y; turn y onto d.
        const c = [d[2], 0, -d[0]], s = Math.hypot(c[0], c[2]), w = 1 + d[1];
        const q = s < 1e-6 ? (d[1] > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0]) : (() => { const n = Math.hypot(c[0], c[2], w); return [c[0] / n, 0, c[2] / n, w / n]; })();
        node.quaternion = q;
    }

    /** A flat outline through world points (a support polygon), as tubes. */
    function showLoop(points, color, width) {
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            showArrow(a, sub(b, a), color, width || 0.15);
        }
    }

    // --- picking --------------------------------------------------------------------

    /** A world ray in an instance's own space, right-handed side. */
    function localRay(it, origin, dir) {
        const t = pose[it.id], inv = qconj(t.rot);
        let o = qrot(inv, sub(origin, t.pos)), d = qrot(inv, dir);
        if (it.side < 0) { o = mirrorV(o); d = mirrorV(d); }
        return { o, d };
    }

    /**
     * What a world ray meets first: { inst, seg, face, point (hull coordinates), t, ray }.
     * `only`: a segment id to pick against alone.
     */
    function pick(origin, dir, only) {
        let best = null;
        for (const it of insts) {
            if (only && it.seg.id !== only) continue;
            const r = localRay(it, origin, dir);
            const hit = rayHull(it.seg, hullBasis(it.seg), r.o, r.d);
            if (hit && (!best || hit.t < best.t)) best = { inst: it, seg: it.seg, face: hit.face, point: hit.point, t: hit.t, hit };
        }
        return best;
    }

    /**
     * Inside a segment's bay along a ray that hit its hull: the module the ray
     * meets first, and the first empty cell.
     */
    function pickBay(hullHit) {
        const seg = hullHit.seg, grid = bay(seg), h = hullHit.hit;
        let mod = null;
        for (const m of design.modules) {
            if (m.seg !== seg.id) continue;
            const box = moduleBox(grid, m), rb = rayBox(h.origin, h.dir, box.min, box.max);
            if (rb && (!mod || rb.t < mod.t)) mod = { m, t: rb.t, face: rb.face };
        }
        const cell = firstFreeCell(grid, takenCells(design, seg.id), h.origin, h.dir, h.t, mod ? Math.min(mod.t, h.t1) : h.t1);
        return { mod, cell, grid };
    }

    return { sync, update, setPose, setLayers, setGlow, focus, clearOverlays, showBay, showCells, showLines, showMarker, showArrow, showLoop,
             pick, pickBay, get nodes() { return nodes; }, get pose() { return pose; }, show };
}
