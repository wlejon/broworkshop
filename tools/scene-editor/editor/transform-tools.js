// Select, Move, Rotate and Scale.
//
// Select picks (the outermost object in the current edit context) and
// highlights the clicked face group. Move drags a whole object: the drag
// plane faces the camera through the grab point, and an inference snap
// (never on the moving object itself) overrides the plane hit, so dragging
// from a corner to another corner lands exactly. Rotate and Scale work
// through the engine gizmo (editor/gizmo.js), which Move also shows.
//
// Tool objects follow lib/kit/editor.js's toolbox contract plus the editor's
// input hooks: down(p) / move(p) / up(p) with p = { cx, cy, ray, pick }.

import { MoveTool } from "../tools/move-tool.js";
import { captureTransform, applyTransform, transformChanged } from "../model/snapshots.js";
import { pickedGroup } from "../model/mesh-ops.js";

const fmt3 = (v) => '[' + v.map(x => x.toFixed(3)).join(', ') + ']';

export function selectTool(ed) {
    return {
        down(p) {
            if (!p.pick) { ed.highlight.clear(); return; }
            ed.registry.setActive(p.pick.object.id);
            ed.highlight.faceGroup(p.pick.primitive, pickedGroup(p.pick));
        },
    };
}

export function moveTool(ed) {
    const st = MoveTool.createState();
    let prev = null;          // TRS at drag start, for undo

    const finish = () => {
        prev = null;
        ed.snap.clear();
        ed.highlight.clear();
    };

    const tool = {
        state: st,
        busy: () => st.active || ed.gizmo.busy(),
        cancel() {
            ed.gizmo.cancel();
            if (!st.active) return;
            MoveTool.cancel(st);
            ed.status('move cancelled');
            finish();
        },
        release(obj) {
            if (st.active && obj && st.object.id === obj.id) tool.cancel();
        },

        /** Start dragging `object` from world point hit.position. */
        begin(object, hit) {
            if (!object || !hit) return;
            prev = captureTransform(object);
            MoveTool.begin(st, object, hit.position, ed.viewport.forward());
            ed.status(`move  [${object.name}]  0`);
        },

        applyDelta(dx, dy, dz) { MoveTool.applyDelta(st, dx, dy, dz); },

        commit() {
            if (!st.active) return;
            const obj = st.object, before = prev;
            const result = MoveTool.commit(st);
            if (result) {
                ed.status(`moved [${result.object.name}] by ${fmt3(result.delta)}`);
                if (transformChanged(before, obj)) {
                    const after = captureTransform(obj);
                    ed.history.record('Move', () => applyTransform(obj, after), () => applyTransform(obj, before));
                }
            }
            finish();
            ed.gizmo.update();
        },

        down(p) {
            if (!p.pick) { ed.highlight.clear(); return; }
            ed.registry.setActive(p.pick.object.id);
            tool.begin(p.pick.object, p.pick.hit);
        },

        move(p) {
            if (!st.active) return false;
            const snap = ed.snap.resolve(p.cx, p.cy, p.ray, true, null, st.object.id);
            let target;
            if (snap) {
                target = snap.position;
                ed.snap.show(snap);
            } else {
                target = MoveTool.rayVsPlane(p.ray, st.pivot, st.planeNormal);
                ed.snap.clear();
                if (!target) return true;
            }
            const d = [target[0] - st.pivot[0], target[1] - st.pivot[1], target[2] - st.pivot[2]];
            MoveTool.applyDelta(st, d[0], d[1], d[2]);
            ed.status(`move  [${st.object.name}]  ${fmt3(d)}`);
            return true;
        },

        up() { tool.commit(); },
    };
    return tool;
}

/** Rotate / Scale: all interaction is the gizmo's. */
export function gizmoTool(ed) {
    return {
        busy: () => ed.gizmo.busy(),
        cancel: () => ed.gizmo.cancel(),
        down(p) {
            if (p.pick) ed.registry.setActive(p.pick.object.id);
            else ed.highlight.clear();
        },
    };
}
