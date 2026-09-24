// Push/Pull: press on a face, drag along its normal, release to commit.
//
// The drag snapshots the primitive once and re-runs pushPullSurgery from
// that snapshot every frame (model/pushpull-surgery.js), previewing the
// result without touching the committed mesh; cancel just reverts the
// preview. The axis and pivot are primitive-LOCAL (surgery edits local
// positions), so cursor rays and snaps are mapped into the local frame.
//
// Distance comes from, in order: a typed VCB value, an inference snap
// projected onto the axis, or the closest point on the axis to the cursor
// ray. After a commit the VCB offers to re-apply the push at a typed
// distance (SketchUp's "pull, then type 3 Enter").

import { pushPullSurgery, rayVsAxisDistance } from "../model/pushpull-surgery.js";
import { captureMesh, applyMesh, meshChanged } from "../model/snapshots.js";
import { worldRayToLocal } from "../model/mesh-ops.js";
import { snapAxisDistance } from "./snap.js";

const SNAP_EXCLUDE = ['on-edge'];   // edge snaps project badly onto the axis

export function pushPullTool(ed) {
    // Drag state. Exposed to tests as __editor.pushpull.
    const pp = {
        active: false,
        primitive: null,
        groupIdx: -1,
        faceTriangles: null,    // pushed group's tris in the snapshot
        axis: [0, 0, 0],        // pushed face's outward normal (local)
        pivot: [0, 0, 0],       // grab point (local)
        distance: 0,
        snap: null,             // { positions, indices, normals, triToGroup, faceGroups } pre-drag
        prevMesh: null,         // captureMesh(primitive), for undo
        working: null,          // last pushPullSurgery output; commit consumes it
    };

    const reset = () => {
        pp.active = false;
        pp.primitive = null;
        pp.faceTriangles = null;
        pp.snap = null;
        pp.prevMesh = null;
        pp.working = null;
    };

    // Stop the drag without keeping anything: revert the preview.
    const abandon = (message) => {
        pp.primitive.revertMesh();
        ed.status(message);
        reset();
        ed.snap.clear();
        ed.highlight.clear();
        ed.vcb.dismiss();
    };

    const tool = {
        state: pp,
        busy: () => pp.active,
        cancel() { if (pp.active) abandon('push/pull cancelled'); },
        release(obj) { if (pp.active && obj && pp.primitive.id === obj.id) tool.cancel(); },

        /** Start on the face group under `hit` (hit.triangleIndex). */
        begin(prim, hit) {
            if (!prim) return;
            const gIdx = prim.faceGroups.triToGroup[hit.triangleIndex];
            const g = prim.faceGroups.groups[gIdx];
            pp.active = true;
            pp.primitive = prim;
            pp.prevMesh = captureMesh(prim);
            pp.groupIdx = gIdx;
            pp.axis = g.normal.slice();
            // Primitive.raycastWorld fills _localPosition; synthesized hits may not.
            pp.pivot = hit._localPosition ? hit._localPosition.slice() : prim.worldToLocalPoint(hit.position);
            pp.distance = 0;
            pp.faceTriangles = g.tris.slice();
            pp.snap = {
                positions:  new Float32Array(prim.positions),
                indices:    new Uint32Array(prim.indices),
                normals:    prim.normals ? new Float32Array(prim.normals) : null,
                triToGroup: new Int32Array(prim.faceGroups.triToGroup),
                faceGroups: prim.faceGroups,
            };
            pp.working = null;
            ed.highlight.triangles(prim, pp.faceTriangles, pp.axis);
            ed.vcb.open(false);
            // Seed at t = 0 so a click without a drag still has buffers to commit.
            tool.apply(0);
        },

        /** Preview the push at local distance t. */
        apply(t) {
            if (!pp.active) return;
            pp.distance = t;
            const out = pushPullSurgery(pp.snap, pp.groupIdx, pp.axis, t);
            pp.working = out;
            pp.primitive.previewMesh(out.positions, out.indices, out.normals);
            ed.highlight.triangles(pp.primitive, out.faceTris, pp.axis, out.positions, out.indices);
            ed.status(`push/pull  ${t.toFixed(3)}`);
        },

        commit() {
            if (!pp.active) return;
            const prim = pp.primitive, prevMesh = pp.prevMesh, distance = pp.distance;
            // Zero distance would leave zero-length bridges and duplicate
            // boundary vertices: revert instead.
            if (distance === 0) { abandon('push/pull cancelled (zero distance)'); return; }

            // The re-apply offer is kept in WORLD space: the pushed face is
            // found again by normal + centroid on the committed geometry.
            const normal = prim.localToWorldNormal(pp.axis);
            const centroid = prim.faceGroupCentroid(pp.groupIdx);
            for (let i = 0; i < 3; i++) centroid[i] += normal[i] * distance;
            const lastOp = { primitiveId: prim.id, normal, centroid, distance };

            // The surgery's group assignment is authoritative: passing it as
            // priorTriToGroup keeps bridge groups from re-merging with caps.
            const w = pp.working;
            prim.updateGeometry(new Float32Array(w.positions), new Uint32Array(w.indices),
                new Float32Array(w.normals), { priorTriToGroup: w.triToGroup, cleanRender: true });
            if (meshChanged(prevMesh, prim)) {
                const nextMesh = captureMesh(prim);
                ed.history.record('Push/pull', () => applyMesh(prim, nextMesh), () => applyMesh(prim, prevMesh));
            }
            ed.status(`extruded ${distance.toFixed(3)}`);
            reset();
            ed.snap.clear();
            ed.highlight.clear();
            ed.vcb.offerRedo(lastOp);
            ed.gizmo.update();
        },

        /** Re-run the last committed push/pull at a new distance. */
        redoLast(distance) {
            const op = ed.vcb.state.lastOp;
            const prim = op && ed.registry.getById(op.primitiveId);
            if (!prim) return false;
            const gIdx = prim.findFaceGroupByNormal(op.normal, op.centroid);
            if (gIdx < 0) return false;
            const g = prim.faceGroups.groups[gIdx];
            tool.begin(prim, { triangleIndex: g.tris[0], position: prim.faceGroupCentroid(gIdx),
                normal: g.normal.slice(), distance: 0 });
            tool.apply(distance);
            tool.commit();
            return true;
        },

        down(p) {
            if (!p.pick) { ed.highlight.clear(); return; }
            // Push/pull edits primitive geometry, so it works on the leaf even
            // inside a group (SketchUp enters the group implicitly).
            ed.registry.setActive(p.pick.object.id);
            tool.begin(p.pick.primitive, p.pick.hit);
        },

        move(p) {
            if (!pp.active) return false;
            const prim = pp.primitive;
            const snap = ed.snap.resolve(p.cx, p.cy, p.ray, false, SNAP_EXCLUDE, prim.id);
            if (ed.vcb.value() !== null) {         // a typed distance wins
                ed.snap.show(snap);
                return true;
            }
            let dist;
            if (snap) {
                dist = snapAxisDistance({ position: prim.worldToLocalPoint(snap.position) }, pp.pivot, pp.axis);
                ed.snap.show(snap);
            } else {
                dist = rayVsAxisDistance(worldRayToLocal(p.ray, prim), pp.pivot, pp.axis);
                ed.snap.clear();
            }
            tool.apply(dist);
            return true;
        },

        up() { tool.commit(); },

        vcb: {
            live: (v) => tool.apply(v),
            commit: (v) => { tool.apply(v); tool.commit(); },
        },
    };
    return tool;
}
