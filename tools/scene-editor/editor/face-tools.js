// Tools that act on a picked face or point: Offset, Follow Me, Erase, Tape.
//
// Offset   pick a face, drag (or type) a distance, click: a new face,
//          coplanar with the source, inset (negative) or grown (positive).
//          The source face is left intact.
// Follow Me  select an edge primitive (the path) in the outliner, then click
//          a face (the profile): sweeps the profile along the path into a
//          new primitive. Profile and path are left intact.
// Erase    click a face to delete that face group; the last face of a
//          primitive deletes the primitive.
// Tape     click two points (inference snaps) to read their distance.
//
// Offset, Follow Me and Erase highlight the face under the cursor on hover.

import "/lib/sketch.js";
import { OffsetTool } from "../tools/offset-tool.js";
import { FollowMeTool } from "../tools/followme-tool.js";
import { TapeTool } from "../tools/tape-tool.js";
import {
    pickedGroup, faceGroupBoundaryWorld, planeForFaceGroup, edgePrimitiveToPath, polygonMesh,
} from "../model/mesh-ops.js";
import { Preview } from "./overlays.js";

// Hover feedback: highlight the face group a click would act on.
function hoverFace(ed, p) {
    const pick = ed.pickAt(p.cx, p.cy);
    if (pick) ed.highlight.faceGroup(pick.primitive, pickedGroup(pick));
    else ed.highlight.clear();
    return true;
}

export function offsetTool(ed) {
    const st = OffsetTool.createState();
    const preview = new Preview(ed.viewport.scene, 'offset-preview');
    const redraw = () => {
        const loop = OffsetTool.buildOffsetLoop(st);
        if (loop && loop.length >= 3) preview.polyline(loop, true);
        else preview.clear();
    };
    const end = () => { preview.clear(); ed.vcb.close(); };

    const tool = {
        state: st,
        busy: () => OffsetTool.active(st),

        /** Start on face group gIdx; false for faces with holes. */
        begin(prim, gIdx, clickPos) {
            const loop = faceGroupBoundaryWorld(prim, gIdx);
            if (!loop) { ed.status('offset: face boundary unsupported (multi-loop?)'); return false; }
            OffsetTool.begin(st, prim, gIdx, loop, planeForFaceGroup(prim, gIdx, loop), clickPos);
            redraw();
            ed.status('offset  [drag for distance · click to commit · Esc cancel]');
            ed.vcb.open(false);
            return true;
        },

        update(cursorWorld) {
            if (!OffsetTool.active(st)) return;
            OffsetTool.updateFromCursor(st, cursorWorld);
            redraw();
            ed.status(`offset  d = ${st.distance.toFixed(3)}`);
        },

        setDistance(d) {
            if (!OffsetTool.active(st)) return false;
            OffsetTool.setDistance(st, d);
            redraw();
            return true;
        },

        commit() {
            if (!OffsetTool.active(st)) return;
            const normal = st.plane.normal.slice();
            const loop = OffsetTool.commit(st);
            end();
            if (!loop || loop.length < 3) { ed.status('offset cancelled (collapsed or zero distance)'); return; }
            const data = polygonMesh(loop, normal, false);
            if (!data) { ed.status('offset failed (triangulation empty)'); return; }
            ed.cmd.addMesh('Offset', data);
        },

        cancel() {
            if (!OffsetTool.active(st)) return;
            OffsetTool.cancel(st);
            end();
            ed.status('offset cancelled');
        },

        down(p) {
            if (!OffsetTool.active(st)) {
                if (p.pick) tool.begin(p.pick.primitive, pickedGroup(p.pick), p.pick.hit.position);
                return;
            }
            const hit = Sketch.rayToPlane(p.ray, st.plane.origin, st.plane.normal);
            if (hit) tool.update(hit);
            tool.commit();
        },

        move(p) {
            if (!OffsetTool.active(st)) return hoverFace(ed, p);
            const hit = Sketch.rayToPlane(p.ray, st.plane.origin, st.plane.normal);
            if (hit) tool.update(hit);
            return true;
        },

        vcb: {
            live: (d) => tool.setDistance(d),
            commit: (d) => { if (d !== null) { tool.setDistance(d); tool.commit(); } },
        },
    };
    return tool;
}

export function followMeTool(ed) {
    const st = FollowMeTool.createState();

    const tool = {
        state: st,
        busy: () => FollowMeTool.active(st),
        cancel() {
            if (!FollowMeTool.active(st)) return;
            FollowMeTool.cancel(st);
            ed.status('follow-me cancelled');
        },

        /** Sweep face group `profileGroup` of profilePrim along an edge primitive. Returns the new id. */
        run(profilePrim, profileGroup, pathPrim) {
            const loop = faceGroupBoundaryWorld(profilePrim, profileGroup);
            if (!loop) { ed.status('follow-me: profile face boundary unsupported'); return null; }
            const path = edgePrimitiveToPath(pathPrim);
            if (!path || path.length < 2) { ed.status('follow-me: path must be a simple polyline'); return null; }
            const normal = profilePrim.localToWorldNormal(profilePrim.faceGroups.groups[profileGroup].normal);
            FollowMeTool.beginWithProfile(st, profilePrim, profileGroup, loop, normal);
            const mesh = FollowMeTool.commitWithPath(st, path);
            if (!mesh) { ed.status('follow-me: sweep failed'); return null; }
            const prim = ed.cmd.addMesh('Sweep', { positions: mesh.positions, indices: mesh.indices, normals: mesh.normals });
            return prim ? prim.id : null;
        },

        down(p) {
            if (!p.pick) { ed.status('follow-me: click a face to use as profile'); return; }
            const path = ed.registry.active;
            if (!path || path.kind !== 'edge-primitive') {
                ed.status('follow-me: select an edge primitive in the outliner first to use as the path');
                return;
            }
            tool.run(p.pick.primitive, pickedGroup(p.pick), path);
        },

        move: (p) => hoverFace(ed, p),
    };
    return tool;
}

export function eraseTool(ed) {
    return {
        down(p) {
            if (!p.pick) { ed.highlight.clear(); return; }
            ed.cmd.eraseFace(p.pick.primitive, pickedGroup(p.pick));
            ed.status('erased face');
        },
        move: (p) => hoverFace(ed, p),
    };
}

export function tapeTool(ed) {
    const st = TapeTool.createState();

    const tool = {
        state: st,
        busy: () => st.active,

        begin(pos) {
            TapeTool.begin(st, pos);
            ed.status('tape  [click second point]');
        },

        update(pos) {
            if (!st.active) return;
            TapeTool.update(st, pos);
            ed.status(`tape  distance = ${TapeTool.distance(st).toFixed(3)}`);
        },

        commit() {
            if (!st.active) return undefined;
            const d = TapeTool.commit(st);
            ed.status(`measured ${d.toFixed(3)}`);
            return d;
        },

        cancel() {
            if (!st.active) return;
            TapeTool.cancel(st);
            ed.status('tape cancelled');
        },

        down(p) {
            const snap = ed.snap.resolve(p.cx, p.cy, p.ray, true);
            if (!snap) return;
            if (!st.active) tool.begin(snap.position);
            else { tool.update(snap.position); tool.commit(); }
        },

        move(p) {
            if (!st.active) return false;
            const snap = ed.snap.resolve(p.cx, p.cy, p.ray, true);
            if (snap) tool.update(snap.position);
            ed.snap.show(snap);
            return true;
        },
    };
    return tool;
}
