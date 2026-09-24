// Document edits: every change to the scene tree that is not a tool drag
// goes through here, and each one is a single undoable history entry.
// Tools call addMesh / addEdges to create what they drew; the outliner,
// toolbar and keyboard call the rest.

import { Group } from "../model/scene-object.js";
import { polylineData, withoutFaceGroup } from "../model/mesh-ops.js";

// Colours for new objects, cycled. One entry today: every object starts in
// the same neutral grey, like SketchUp's default material.
const PALETTE = ['#b8bcc2'];

// Default parameters for the outliner's + buttons.
const PRIMITIVE_PARAMS = {
    box:      { sx: 1, sy: 1, sz: 1 },
    sphere:   { r: 1, seg: 24, rings: 16 },
    cylinder: { r: 0.8, h: 2, seg: 24 },
    plane:    { w: 2, d: 2, sx: 1, sz: 1 },
};

const trsOf = (o) => ({ t: o.translation.slice(), r: o.rotation.slice(), s: o.scale.slice() });

/** ed: { registry, history, status(text), release(obj) }. */
export function createCommands(ed) {
    const reg = ed.registry;
    // New primitives from the outliner spawn along +X so they don't stack on
    // the default box. Deletions don't reclaim slots: each add lands in fresh
    // space. Saved with the project.
    let nextAddX = 3;

    const colorAt = (i) => PALETTE[i % PALETTE.length];

    // Create inside history. The id is reserved up front so redo recreates
    // the same object and outside references (VCB re-apply, outliner) hold.
    const addRecorded = (label, create) => {
        const id = reg.nextId();
        let created = null;
        ed.history.do(label, () => { created = create(id); }, () => { reg.remove(id); });
        return created;
    };

    const cmd = {
        get nextAddX() { return nextAddX; },
        set nextAddX(x) { nextAddX = x; },

        /** Reset to a new document: one box at the origin. */
        resetScene() {
            reg.clear();
            reg.create({ type: 'box', name: 'Box', color: colorAt(0), params: PRIMITIVE_PARAMS.box });
        },

        /** Outliner "+ Box" etc. */
        addPrimitive(type) {
            const i = reg.primitives.length;
            const spec = {
                type,
                name: type[0].toUpperCase() + type.slice(1) + ' ' + (i + 1),
                color: colorAt(i),
                position: [nextAddX, 0, 0],
                params: PRIMITIVE_PARAMS[type],
            };
            nextAddX += 2.5;
            return addRecorded('Add ' + spec.name, (id) => reg.createWithId(spec, id));
        },

        /** A face primitive from local mesh buffers ("Rectangle 3"). Returns it. */
        addMesh(baseName, data) {
            const i = reg.primitives.length;
            const spec = { name: baseName + ' ' + (i + 1), color: colorAt(i) };
            const prim = addRecorded('Add ' + spec.name, (id) => reg.createFromMesh(spec, data, id));
            ed.status('added ' + spec.name);
            return prim;
        },

        /** A free-standing polyline (EdgePrimitive) through world points. */
        addEdges(points, baseName) {
            if (!points || points.length < 2) { ed.status('line chain ended'); return null; }
            const data = polylineData(points, false);
            const i = reg.primitives.length +
                reg.root.children.filter(c => c.kind === 'edge-primitive').length;
            const spec = { name: (baseName || 'Edges') + ' ' + (i + 1), color: colorAt(i) };
            addRecorded('Add ' + spec.name, (id) => reg.createEdgePrimitive(spec, data, id));
            const n = data.edges.length;
            ed.status('added ' + spec.name + ' (' + n + ' edge' + (n === 1 ? '' : 's') + ')');
            return spec.name;
        },

        /**
         * Delete a primitive or edge primitive (undoable). Groups and
         * component instances are destroyed without an undo entry: restoring
         * a whole subtree needs snapshot support the registry lacks.
         */
        deleteObject(obj) {
            if (!obj) return;
            ed.release(obj);
            if (obj.kind === 'edge-primitive') {
                const snap = reg.snapshotEdgePrimitive(obj);
                ed.history.do('Delete ' + obj.name,
                    () => reg.remove(snap.id),
                    () => reg.restoreEdgePrimitiveFromSnapshot(snap));
            } else if (obj.kind === 'primitive') {
                const snap = reg.snapshotPrimitive(obj);
                ed.history.do('Delete ' + obj.name,
                    () => reg.remove(snap.id),
                    () => reg.restoreFromSnapshot(snap));
            } else {
                if (obj.destroy) obj.destroy();
                if (reg.active === obj) reg.active = reg.primitives[0] || null;
                reg._emit();
            }
        },

        /** Erase one face group; erasing the last face deletes the primitive. */
        eraseFace(prim, gIdx) {
            if (!prim || !prim.faceGroups || !prim.faceGroups.groups[gIdx]) return;
            if (prim.faceGroups.groups.length === 1) { cmd.deleteObject(prim); return; }
            const before = {
                positions: new Float32Array(prim.positions),
                indices:   new Uint32Array(prim.indices),
                normals:   prim.normals ? new Float32Array(prim.normals) : null,
            };
            const after = withoutFaceGroup(prim, gIdx);
            ed.release(prim);
            ed.history.do('Erase face on ' + prim.name,
                () => prim.updateGeometry(after.positions, after.indices, after.normals),
                () => prim.updateGeometry(before.positions, before.indices, before.normals));
        },

        rename(obj, name) {
            const prev = obj.name;
            if (!name || name === prev) return false;
            ed.history.do('Rename', () => reg.setName(obj.id, name), () => reg.setName(obj.id, prev));
            return true;
        },

        /** Wrap the selection in a new Group (Ctrl+G). */
        group() {
            const obj = reg.active;
            if (!obj) { ed.status('group: nothing selected'); return; }
            // Undo restores parent, index and local TRS: createGroup reparents
            // preserving world transform, which rewrites the local one.
            const prev = { parent: obj.parent, trs: trsOf(obj) };
            let created = null;
            ed.history.do('Group',
                () => { created = reg.createGroup([obj], { name: 'Group' }); },
                () => {
                    if (created) reg.explodeGroup(created);
                    if (obj.parent !== prev.parent) prev.parent.addChild(obj);
                    obj.setTRS(prev.trs.t, prev.trs.r, prev.trs.s);
                    created = null;
                });
        },

        /** Dissolve the selected Group into its parent (Ctrl+Shift+G). */
        ungroup() {
            const g = reg.active;
            if (!g || g.kind !== 'group') { ed.status('ungroup: no group selected'); return; }
            const parent = g.parent, index = parent.children.indexOf(g);
            const members = g.children.map(m => ({ obj: m, trs: trsOf(m) }));
            const groupTRS = trsOf(g), groupId = g.id, groupName = g.name;
            ed.history.do('Ungroup',
                () => reg.explodeGroup(reg.getById(groupId)),
                () => {
                    // Rebuild the group at its old slot with the members'
                    // pre-ungroup local transforms.
                    const ng = new Group({ id: groupId, name: groupName,
                        translation: groupTRS.t, rotation: groupTRS.r, scale: groupTRS.s });
                    parent.children.splice(index, 0, ng);
                    ng.parent = parent;
                    for (const m of members) {
                        if (m.obj.parent) m.obj.parent.removeChild(m.obj);
                        ng.addChild(m.obj);
                        m.obj.setTRS(m.trs.t, m.trs.r, m.trs.s);
                    }
                    ng._invalidateWorld();
                    reg.active = ng;
                    reg._emit();
                });
        },

        /**
         * Turn the selection into a component definition plus one instance in
         * its place. Not undoable yet: moving the subtree into and out of a
         * definition needs the same scaffolding as group/ungroup.
         */
        makeComponent() {
            if (!reg.active) { ed.status('make-component: nothing selected'); return; }
            if (reg.makeComponent([reg.active], { name: 'Component' })) ed.status('made component');
        },
    };
    return cmd;
}
