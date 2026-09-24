// Line and Arc: polylines drawn on a locked sketch plane.
//
// Line is a click chain. Clicking back onto an earlier vertex closes the loop
// into a filled face (self-crossing loops split into one face per simple
// sub-loop); the dangling prefix before the closing vertex, or the whole
// chain when it is ended open (right-click, double-click, tool switch), is
// kept as a free-standing edge primitive.
//
// Arc is SketchUp's two-point + bulge arc: click start, click end, click the
// bulge. It is kept as an edge primitive (usable as a Follow Me path).
// Inference snaps work on every click, so arcs chain off existing geometry.

import "/lib/sketch.js";
import { LineTool } from "../tools/line-tool.js";
import { ArcTool } from "../tools/arc-tool.js";
import { groundPlane, sketchPlaneFromRay, polygonMesh } from "../model/mesh-ops.js";
import { Preview } from "./overlays.js";

// World distance within which a click lands on an earlier vertex and closes
// the loop.
const CLOSE_EPS = 0.05;
const LINE_THICKNESS = 0.015;

export function lineTool(ed) {
    const st = LineTool.createState();
    const preview = new Preview(ed.viewport.scene, 'line-preview');

    // Committed points plus the rubber band to the cursor.
    const redraw = () => {
        if (!st.active || st.points.length === 0) { preview.clear(); return; }
        preview.polyline(st.preview ? st.points.concat([st.preview]) : st.points, false, LINE_THICKNESS);
    };
    const reset = () => { LineTool.cancel(st); preview.clear(); };

    // Fill a closed loop. The 2D projection is split at self-crossings into
    // simple CCW sub-loops, each lifted back to 3D and triangulated.
    const fillLoop = (polygon, plane) => {
        if (!polygon || polygon.length < 3) {
            ed.status('line  (sub-loop too small, discarded)');
            reset();
            return;
        }
        const uv = polygon.map(p => Sketch.project3Dto2D(p, plane.origin, plane.u, plane.v));
        const loops = Sketch.splitSelfIntersectingPolygon(uv);
        if (loops.length === 0) {
            ed.status('line  (degenerate polygon, discarded)');
            reset();
            return;
        }
        const added = [];
        for (const loop2D of loops) {
            const loop3D = loop2D.map(q => [
                plane.origin[0] + q[0] * plane.u[0] + q[1] * plane.v[0],
                plane.origin[1] + q[0] * plane.u[1] + q[1] * plane.v[1],
                plane.origin[2] + q[0] * plane.u[2] + q[1] * plane.v[2],
            ]);
            const data = polygonMesh(loop3D, plane.normal, true);
            if (data) added.push(ed.cmd.addMesh('Polygon', data));
        }
        if (added.length === 0) ed.status('line  (face triangulation failed)');
        else if (added.length > 1) {
            const cuts = loops.length - 1;
            ed.status(`added ${added.length} faces (split at ${cuts} crossing${cuts === 1 ? '' : 's'})`);
        }
        reset();
    };

    const tool = {
        state: st,
        busy: () => st.active,

        begin(pos, plane) {
            LineTool.begin(st, plane || groundPlane(), pos);
            redraw();
            ed.status('line  [click to extend · close to finish]');
        },

        /**
         * Canvas point -> position on the locked plane, snapped to an earlier
         * vertex when within CLOSE_EPS: { position, closureIndex } or null.
         */
        resolvePoint(cx, cy) {
            if (!st.active || !st.plane) return null;
            const hit = Sketch.rayToPlane(ed.viewport.ray(cx, cy), st.plane.origin, st.plane.normal);
            if (!hit) return null;
            const i = LineTool.findClosureIndex(st, hit, CLOSE_EPS);
            return i >= 0 ? { position: st.points[i].slice(), closureIndex: i } : { position: hit, closureIndex: -1 };
        },

        update(pos) {
            if (!st.active) return;
            LineTool.update(st, pos);
            redraw();
            if (LineTool.findClosureIndex(st, pos, CLOSE_EPS) >= 0) ed.status('line  [click to close loop ✕]');
        },

        addPoint(pos) {
            if (!st.active) return null;
            const plane = st.plane;     // addPoint clears the state when the loop closes
            const result = LineTool.addPoint(st, pos, CLOSE_EPS);
            if (result.kind !== 'closed') { redraw(); return result; }
            preview.clear();
            fillLoop(result.polygon, plane);
            if (result.orphan && result.orphan.length >= 2) ed.cmd.addEdges(result.orphan, 'Polyline');
            return result;
        },

        /** End the chain open; its points become an edge primitive. */
        commit() {
            if (!st.active) return;
            const points = st.points.slice();
            LineTool.commit(st);
            preview.clear();
            ed.cmd.addEdges(points, 'Polyline');
        },

        cancel() {
            if (!st.active) return;
            reset();
            ed.status('line cancelled');
        },

        down(p) {
            if (!st.active) {
                const plane = sketchPlaneFromRay(ed.registry, p.ray);
                const hit = Sketch.rayToPlane(p.ray, plane.origin, plane.normal);
                if (hit) tool.begin(hit, plane);
                return;
            }
            const r = tool.resolvePoint(p.cx, p.cy);
            if (r) tool.addPoint(r.position);
        },

        move(p) {
            if (!st.active) return false;
            const r = tool.resolvePoint(p.cx, p.cy);
            if (r) tool.update(r.position);
            return true;
        },

        // Right-click and double-click finish the chain open (SketchUp).
        claimsRightClick: () => st.active,
        rightClick() { tool.commit(); },
        dblclick() {
            if (!st.active) return false;
            tool.commit();
            return true;
        },
    };
    return tool;
}

export function arcTool(ed) {
    const st = ArcTool.createState();
    const preview = new Preview(ed.viewport.scene, 'arc-preview');
    const redraw = () => preview.polyline(ArcTool.buildPolyline(st), false);

    const tool = {
        state: st,
        busy: () => ArcTool.active(st),

        begin(pos, plane) {
            ArcTool.begin(st, plane || groundPlane(), pos);
            redraw();
            ed.status('arc  [click endpoint]');
        },

        update(pos) {
            if (!ArcTool.active(st)) return;
            ArcTool.update(st, pos);
            redraw();
        },

        /** Second click: lock the chord end. False for a zero-length chord. */
        setEnd(pos) {
            const ok = ArcTool.setEnd(st, pos, 1e-4);
            if (ok) { redraw(); ed.status('arc  [click bulge point]'); }
            return ok;
        },

        commit() {
            if (!ArcTool.active(st)) return;
            const poly = ArcTool.commit(st);
            preview.clear();
            if (!poly || poly.length < 2) { ed.status('arc cancelled (degenerate)'); return; }
            ed.cmd.addEdges(poly, 'Arc');
        },

        cancel() {
            if (!ArcTool.active(st)) return;
            ArcTool.cancel(st);
            preview.clear();
            ed.status('arc cancelled');
        },

        down(p) {
            const active = ArcTool.active(st);
            const plane = active ? st.plane : sketchPlaneFromRay(ed.registry, p.ray);
            const hit = Sketch.rayToPlane(p.ray, plane.origin, plane.normal);
            if (!hit) return;
            if (!active) tool.begin(hit, plane);
            else if (st.stage === 'await-end') tool.setEnd(hit);
            else if (st.stage === 'await-bulge') { ArcTool.update(st, hit); tool.commit(); }
        },

        move(p) {
            if (!ArcTool.active(st)) return false;
            const hit = Sketch.rayToPlane(p.ray, st.plane.origin, st.plane.normal);
            if (hit) tool.update(hit);
            return true;
        },
    };
    return tool;
}
