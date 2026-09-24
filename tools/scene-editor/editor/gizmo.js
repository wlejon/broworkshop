// Transform gizmo wiring. The engine (bro.gizmo) renders the handles, hit-
// tests them, runs the drag and reports per-frame deltas; the editor anchors
// the pivot at the selection's centroid and turns those deltas into move /
// rotate / scale edits (the same MoveTool / RotateTool / ScaleTool state
// machines the tools use), with one undo entry per drag.
//
// The mode follows the current tool (move / rotate / scale); every other
// tool hides the gizmo so its handles never compete with picking.

import { MoveTool } from "../tools/move-tool.js";
import { RotateTool } from "../tools/rotate-tool.js";
import { ScaleTool } from "../tools/scale-tool.js";
import { captureTransform, applyTransform, transformChanged } from "../model/snapshots.js";

const MODE_FOR_TOOL = { move: 'translate', rotate: 'rotate', scale: 'scale' };
const GIZMO_PX = 80;
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const fmt3 = (v) => '[' + v.map(x => x.toFixed(3)).join(', ') + ']';
const quatDegrees = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI).toFixed(1) + '°';

/**
 * World-space centroid of a SceneObject: a primitive's bbox centroid, the
 * mean of the descendant primitives' for groups and component instances,
 * else the object's translation.
 */
export function objectCentroid(obj) {
    if (!obj) return [0, 0, 0];
    if (obj.worldCentroid) return obj.worldCentroid();
    let sx = 0, sy = 0, sz = 0, n = 0;
    obj.traverseLeaves((leaf) => {
        if (!leaf.worldCentroid) return;
        const c = leaf.worldCentroid();
        sx += c[0]; sy += c[1]; sz += c[2]; n++;
    });
    return n ? [sx / n, sy / n, sz / n] : obj.translation.slice(0, 3);
}

/** ed: { registry, tools, history, status(text), highlight, snap }. */
export function createGizmo(ed) {
    const move = MoveTool.createState();
    const rotate = RotateTool.createState();
    const scale = ScaleTool.createState();
    const drag = {
        active: false,
        mode: 'translate',
        object: null,
        axis: [0, 0, 0],
        total: [0, 0, 0],       // accumulated translate delta
        prev: null,             // TRS at drag start, for undo
    };

    const mode = () => MODE_FOR_TOOL[ed.tools ? ed.tools.name : 'select'];
    const target = () => {
        const obj = ed.registry.active;
        return obj && obj.visible ? obj : null;
    };
    const machine = (m) => m === 'translate' ? [MoveTool, move] : m === 'rotate' ? [RotateTool, rotate] : [ScaleTool, scale];

    const endDrag = () => {
        drag.active = false;
        drag.object = null;
        drag.prev = null;
        ed.snap.clear();
        gizmo.update();
    };

    const gizmo = {
        get drag() { return drag; },
        busy() { return drag.active; },

        /** Re-anchor and show/hide for the current tool + selection. */
        update() {
            const obj = target(), m = mode();
            if (!obj || !m) { bro.gizmo.hide(); return; }
            bro.gizmo.setMode(m);
            const c = objectCentroid(obj);
            bro.gizmo.setPosition(c[0], c[1], c[2]);
            bro.gizmo.show();
        },

        cancel() {
            if (!drag.active) return;
            const [M, st] = machine(drag.mode);
            M.cancel(st);
            ed.highlight.follow(drag.object);
            ed.status('gizmo cancelled');
            endDrag();
        },

        /** Cancel the drag if it is on `obj` (being deleted). */
        release(obj) {
            if (drag.active && obj && drag.object.id === obj.id) gizmo.cancel();
        },
    };

    bro.gizmo.configure({ size: GIZMO_PX });
    bro.gizmo.attach({
        // Called every frame: the pivot tracks the selection through edits.
        position: () => objectCentroid(target()),

        beginDrag: () => {
            const obj = ed.registry.active;
            if (!obj) return;
            const m = mode() || 'translate';
            const axisName = bro.gizmo.hovered;
            const c = objectCentroid(obj);
            drag.active = true;
            drag.mode = m;
            drag.object = obj;
            drag.axis = (AXES[axisName] || [0, 0, 0]).slice();
            drag.total = [0, 0, 0];
            drag.prev = captureTransform(obj);
            if (m === 'translate') MoveTool.begin(move, obj, c, drag.axis);
            else if (m === 'rotate') RotateTool.begin(rotate, obj, c);
            else ScaleTool.begin(scale, obj, c);
            ed.status(`gizmo  ${m}  ${axisName ? axisName.toUpperCase() : ''}  [${obj.name}]`);
        },

        translate: (dx, dy, dz) => {
            if (!drag.active || drag.mode !== 'translate') return;
            const t = drag.total;
            t[0] += dx; t[1] += dy; t[2] += dz;
            MoveTool.applyDelta(move, t[0], t[1], t[2]);
            ed.highlight.follow(drag.object);
            const d = t[0] * drag.axis[0] + t[1] * drag.axis[1] + t[2] * drag.axis[2];
            const label = Math.abs(drag.axis[0]) > 0.5 ? 'X' : Math.abs(drag.axis[1]) > 0.5 ? 'Y' : 'Z';
            ed.status(`gizmo  ${label}  [${drag.object.name}]  ${d.toFixed(3)}`);
        },

        rotate: (qx, qy, qz, qw) => {
            if (!drag.active || drag.mode !== 'rotate') return;
            RotateTool.applyDelta(rotate, qx, qy, qz, qw);
            ed.highlight.follow(drag.object);
            ed.status(`gizmo  rotate  [${drag.object.name}]  ${quatDegrees(rotate.accumQ)}`);
        },

        scale: (sx, sy, sz) => {
            if (!drag.active || drag.mode !== 'scale') return;
            ScaleTool.applyDelta(scale, sx, sy, sz);
            ed.highlight.follow(drag.object);
            ed.status(`gizmo  scale  [${drag.object.name}]  ${fmt3(scale.accumScale)}`);
        },

        endDrag: () => {
            if (!drag.active) return;
            const obj = drag.object, m = drag.mode, prev = drag.prev;
            const [M, st] = machine(m);
            const result = M.commit(st);
            if (result) {
                if (m === 'translate') ed.status(`moved [${obj.name}] by ${fmt3(result.delta)}`);
                else if (m === 'rotate') ed.status(`rotated [${obj.name}] by ${quatDegrees(result.quat)}`);
                else ed.status(`scaled [${obj.name}] by ${fmt3(result.scale)}`);
                if (transformChanged(prev, obj)) {
                    const next = captureTransform(obj);
                    const label = m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Scale';
                    ed.history.record(label, () => applyTransform(obj, next), () => applyTransform(obj, prev));
                }
            }
            ed.highlight.follow(obj);
            endDrag();
        },
    });

    return gizmo;
}
