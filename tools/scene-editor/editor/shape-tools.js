// Rectangle and Circle: two clicks on a sketch plane, committed as a filled
// face primitive ready for push/pull.
//
// The first click locks the sketch plane (the face under the cursor, else
// the ground) and later clicks stay on it. While drawing, the VCB takes an
// exact size: "W,H" for a rectangle, a radius for a circle; the sign / bearing
// follow the cursor. Tools stay selected after a commit, so the next shape
// can start right away.

import { Sketch } from "../model/sketch.js";
import { RectangleTool } from "../tools/rectangle-tool.js";
import { CircleTool } from "../tools/circle-tool.js";
import { groundPlane, sketchPlaneFromRay } from "../model/mesh-ops.js";
import { Preview } from "./overlays.js";

const meshData = (mesh) => ({
    positions: new Float32Array(mesh.positions),
    indices:   new Uint32Array(mesh.indices),
    normals:   new Float32Array(mesh.normals),
});

// Shared click routing: the plane is resolved on the first click, then locked.
function planeHit(ed, st, p) {
    const plane = st.active ? st.plane : sketchPlaneFromRay(ed.registry, p.ray);
    const hit = Sketch.rayToPlane(p.ray, plane.origin, plane.normal);
    return hit ? { plane, hit } : null;
}

export function rectangleTool(ed) {
    const st = RectangleTool.createState();
    const preview = new Preview(ed.viewport.scene, 'rect-preview');
    const redraw = () => preview.mesh(RectangleTool.buildMesh(st));

    const tool = {
        state: st,
        busy: () => st.active,

        begin(pos, plane) {
            RectangleTool.begin(st, plane || groundPlane(), pos);
            ed.status('rectangle  [corner 1 set — click for corner 2]');
            ed.vcb.open(true);
        },

        update(pos) {
            if (!st.active) return;
            RectangleTool.update(st, pos);
            redraw();
            const sz = RectangleTool.size(st);
            if (sz) ed.status(`rectangle  ${sz.w.toFixed(3)} × ${sz.h.toFixed(3)}`);
        },

        /** Snap the live corner to exactly w x h in the plane's (u, v) axes. */
        setSize(w, h) {
            if (!st.active) return false;
            const c0 = st.corner0, c1 = st.corner1, { u, v } = st.plane;
            const d = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
            const du = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) < 0 ? -Math.abs(w) : Math.abs(w);
            const dv = (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) < 0 ? -Math.abs(h) : Math.abs(h);
            RectangleTool.update(st, [
                c0[0] + du * u[0] + dv * v[0],
                c0[1] + du * u[1] + dv * v[1],
                c0[2] + du * u[2] + dv * v[2],
            ]);
            redraw();
            return true;
        },

        commit() {
            if (!st.active) return;
            const mesh = RectangleTool.commit(st);
            preview.clear();
            ed.vcb.close();
            if (!mesh) { ed.status('rectangle cancelled (zero area)'); return; }
            ed.cmd.addMesh('Rectangle', meshData(mesh));
        },

        cancel() {
            if (!st.active) return;
            RectangleTool.cancel(st);
            preview.clear();
            ed.vcb.close();
            ed.status('rectangle cancelled');
        },

        down(p) {
            const r = planeHit(ed, st, p);
            if (!r) return;
            if (!st.active) tool.begin(r.hit, r.plane);
            else { tool.update(r.hit); tool.commit(); }
        },

        move(p) {
            if (!st.active) return false;
            const hit = Sketch.rayToPlane(p.ray, st.plane.origin, st.plane.normal);
            if (hit) tool.update(hit);
            return true;
        },

        vcb: {
            pair: true,
            live: (wh) => tool.setSize(wh[0], wh[1]),
            commit: (wh) => { if (wh) { tool.setSize(wh[0], wh[1]); tool.commit(); } },
        },
    };
    return tool;
}

export function circleTool(ed) {
    const st = CircleTool.createState();
    const preview = new Preview(ed.viewport.scene, 'circle-preview');
    const redraw = () => preview.mesh(CircleTool.buildMesh(st));

    const tool = {
        state: st,
        busy: () => st.active,

        begin(pos, plane) {
            CircleTool.begin(st, plane || groundPlane(), pos);
            ed.status('circle  [center set — move + click for radius]');
            ed.vcb.open(false);
        },

        update(pos) {
            if (!st.active) return;
            CircleTool.update(st, pos);
            redraw();
            ed.status(`circle  r = ${CircleTool.radius(st).toFixed(3)}`);
        },

        /** Exact radius along the cursor's bearing from the center (plane u if none yet). */
        setRadius(r) {
            if (!st.active) return false;
            const c = st.center, e = st.edge;
            let d = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
            const L = Math.hypot(d[0], d[1], d[2]);
            d = L > 1e-9 ? [d[0] / L, d[1] / L, d[2] / L] : st.plane.u;
            const rr = Math.abs(r);
            CircleTool.update(st, [c[0] + d[0] * rr, c[1] + d[1] * rr, c[2] + d[2] * rr]);
            redraw();
            return true;
        },

        commit() {
            if (!st.active) return;
            const mesh = CircleTool.commit(st);
            preview.clear();
            ed.vcb.close();
            if (!mesh) { ed.status('circle cancelled (zero radius)'); return; }
            ed.cmd.addMesh('Circle', meshData(mesh));
        },

        cancel() {
            if (!st.active) return;
            CircleTool.cancel(st);
            preview.clear();
            ed.vcb.close();
            ed.status('circle cancelled');
        },

        down(p) {
            const r = planeHit(ed, st, p);
            if (!r) return;
            if (!st.active) tool.begin(r.hit, r.plane);
            else { tool.update(r.hit); tool.commit(); }
        },

        move(p) {
            if (!st.active) return false;
            const hit = Sketch.rayToPlane(p.ray, st.plane.origin, st.plane.normal);
            if (hit) tool.update(hit);
            return true;
        },

        vcb: {
            live: (r) => tool.setRadius(r),
            commit: (r) => { if (r !== null) { tool.setRadius(r); tool.commit(); } },
        },
    };
    return tool;
}
