// Object inspector: the selection's kind, name and local transform as
// editable numbers (rotation in degrees). Each edited field is one undoable
// 'Transform' entry; the panel follows selection, undo/redo and drags.

import { h, clear } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { Mat4Lib } from "../model/mat4.js";
import { captureTransform, applyTransform, transformChanged } from "../model/snapshots.js";

const KIND_LABEL = {
    'primitive': 'Mesh', 'edge-primitive': 'Edges', 'group': 'Group', 'component-instance': 'Component',
};
const DEG = 180 / Math.PI;
const ROWS = [
    ['position', 'translation', 0.1],
    ['rotation', 'rotation', 5],
    ['scale', 'scale', 0.1],
];

/** ed: { registry, history, gizmo, highlight }. el: the panel body. */
export function createInspector(ed, el) {
    const reg = ed.registry;
    const title = h('div.insp-title');
    const empty = h('div.dim', null, 'Nothing selected');
    const grid = h('div.insp-grid');
    const inputs = {};            // 'translation0' -> bound control

    // Set one component of the selection's local TRS.
    const edit = (field, axis, value) => {
        const obj = reg.active;
        if (!obj || !isFinite(value)) return;
        const prev = captureTransform(obj);
        const next = captureTransform(obj);
        if (field === 'rotation') {
            const e = Mat4Lib.quatToEuler(obj.rotation);
            e[axis] = value / DEG;
            next.rotation = Mat4Lib.eulerToQuat(e);
        } else {
            next[field][axis] = value;
        }
        applyTransform(obj, next);
        if (transformChanged(prev, obj)) {
            ed.history.record('Transform', () => applyTransform(obj, next), () => applyTransform(obj, prev));
        }
        ed.highlight.follow(obj);
        ed.gizmo.update();
        inspector.refresh();
    };

    for (const [label, field, step] of ROWS) {
        grid.appendChild(h('span.insp-label', null, label));
        for (let axis = 0; axis < 3; axis++) {
            const input = h('input', { type: 'number', step: String(step), title: label + ' ' + 'xyz'[axis] });
            input.dataset.field = field + axis;
            grid.appendChild(input);
            inputs[field + axis] = bindControl(input, { onChange: (v) => edit(field, axis, v) });
        }
    }
    el.appendChild(empty);
    el.appendChild(title);
    el.appendChild(grid);

    const inspector = {
        refresh() {
            const obj = reg.active;
            empty.hidden = !!obj;
            title.hidden = grid.hidden = !obj;
            if (!obj) return;
            clear(title);
            title.appendChild(h('span.dim', null, (KIND_LABEL[obj.kind] || obj.kind) + ' '));
            title.appendChild(h('b', null, obj.name));
            const euler = Mat4Lib.quatToEuler(obj.rotation);
            for (let i = 0; i < 3; i++) {
                inputs['translation' + i].value = +obj.translation[i].toFixed(4);
                inputs['rotation' + i].value = +(euler[i] * DEG).toFixed(2);
                inputs['scale' + i].value = +obj.scale[i].toFixed(4);
            }
        },
    };
    inspector.refresh();
    return inspector;
}
