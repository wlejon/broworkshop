// demos/foundry/bay.js — Sunlit Assembly Bay with calibration grid, direct 3D
// part & face-socket picking, flush attachment, live alloy/nudge/delete, and Bench Test.

import { MATERIALS } from "/lib/machine/materials.js";
import { compileMachine } from "/lib/machine/compiler.js";
import { BUILTIN_CATALOG, createCatalogResolver, listCatalogEntries } from "/lib/machine/assemblies.js";
import { createBayView } from "/lib/machine/view.js";

function clone(v) { return JSON.parse(JSON.stringify(v)); }

const FACE_NORMALS = {
    '+X': [1, 0, 0], '-X': [-1, 0, 0],
    '+Y': [0, 1, 0], '-Y': [0, -1, 0],
    '+Z': [0, 0, 1], '-Z': [0, 0, -1],
};

function createGridStrips(scene) {
    const meshes = [];
    for (let i = -8; i <= 8; i += 2) {
        const major = i === 0;
        const col = major ? '#3b495e' : '#2b3442';
        const mx = scene.createMesh({ mesh: 'box', halfW: 9, halfH: 0.008, halfD: major ? 0.03 : 0.015, color: col, roughness: 0.8 });
        mx.y = 0.01; mx.z = i;
        meshes.push(mx);
        const mz = scene.createMesh({ mesh: 'box', halfW: major ? 0.03 : 0.015, halfH: 0.008, halfD: 9, color: col, roughness: 0.8 });
        mz.y = 0.01; mz.x = i;
        meshes.push(mz);
    }
    return meshes;
}

export function createFoundryBay(scene, vp) {
    const customUnits = {};
    const resolver = createCatalogResolver(customUnits);
    const view = createBayView(scene);
    const history = [];

    const floor = scene.createMesh({
        mesh: 'cylinder', radius: 13.5, halfHeight: 0.14, segments: 48,
        color: '#202630', roughness: 0.82, metallic: 0.25, receivesShadow: true,
    });
    floor.y = -0.14;
    const gridStrips = createGridStrips(scene);

    const state = {
        presetId: 'siege_howitzer',
        blueprint: clone(BUILTIN_CATALOG.siege_howitzer),
        compiled: null,
        loadCase: 'off',       // Clean Alloy PBR view by default; Recoil/Actuate/Gravity 1 click away
        sweepJointIdx: 0,
        sweepValue: 0,
        activeAlloy: 'titanium',
        selectedNodeId: null,
        selectedSocket: '+Y',
        mirrorX: true,
        benchTest: false,
        seq: 1,
        customUnits,
    };

    const selectedCompiledNode = () => {
        if (!state.compiled) return null;
        return state.compiled.nodes.find((n) => n.id === state.selectedNodeId) || state.compiled.nodes[0];
    };

    const recompile = () => {
        state.compiled = compileMachine(state.blueprint, resolver);
        if (!selectedCompiledNode()) state.selectedNodeId = state.compiled.nodes[0]?.id || null;
        if (state.sweepJointIdx >= state.compiled.joints.length) {
            state.sweepJointIdx = state.compiled.joints.length ? 0 : -1;
            state.sweepValue = 0;
        }
        render();
        return state.compiled;
    };

    const render = () => {
        view.render(state.compiled, {
            loadCase: state.loadCase,
            sweepJointIdx: state.sweepJointIdx,
            sweepValue: state.sweepValue,
            selectedNodeId: state.selectedNodeId,
            selectedSocket: state.selectedSocket,
            ghostHalf: [0.35, 0.22, 0.45],
            showSockets: true,
            groundY: 0,
        });
    };

    const pushUndo = () => {
        history.push(clone(state.blueprint));
        if (history.length > 24) history.shift();
    };

    const loadPreset = (id) => {
        const bp = resolver(id);
        if (!bp) return null;
        history.length = 0;
        state.presetId = id;
        state.blueprint = clone(bp);
        state.sweepJointIdx = 0;
        state.sweepValue = 0;
        state.selectedNodeId = bp.nodes?.[0]?.id || null;
        state.selectedSocket = '+Y';
        const c = recompile();
        const ext = c.bounds.max, min = c.bounds.min;
        const span = Math.hypot(ext[0] - min[0], ext[1] - min[1], ext[2] - min[2]);
        vp.reframe([0, (ext[1] - min[1]) * 0.48, 0], Math.max(2.3, span * 1.15));
        return c;
    };

    const resolveEditableTarget = () => {
        const cn = selectedCompiledNode();
        if (!cn) return { kind: 'root', id: null };
        const topSeg = cn.unitPath ? cn.unitPath.split('/')[0] : cn.rawId;
        const directNode = (state.blueprint.nodes || []).find((n) => n.id === cn.id || n.id === topSeg);
        if (directNode) return { kind: 'node', item: directNode, cn };
        const unitRef = (state.blueprint.units || []).find((u) => u.id === topSeg);
        if (unitRef) return { kind: 'unit', item: unitRef, cn };
        return { kind: 'node', item: state.blueprint.nodes[0], cn };
    };

    const addArmorPlate = () => {
        const sel = selectedCompiledNode();
        if (!sel) return state.compiled;
        pushUndo();
        const n = FACE_NORMALS[state.selectedSocket] || [0, 1, 0];
        const half = Math.abs(n[0]) > 0.5 ? [0.16, 0.36, 0.95] : Math.abs(n[1]) > 0.5 ? [0.85, 0.16, 0.65] : [0.95, 0.28, 0.22];
        const pos = [
            sel.pos[0] + n[0] * (sel.half[0] + half[0]),
            sel.pos[1] + n[1] * (sel.half[1] + half[1]),
            sel.pos[2] + n[2] * (sel.half[2] + half[2]),
        ];
        const rootId = state.blueprint.nodes[0].id;
        const addAt = (p, tag) => {
            const id = `plate_${tag}_${state.seq++}`;
            state.blueprint.nodes.push({ id, kind: 'beam', meshKind: 'hull', parent: rootId, pos: p, half, material: state.activeAlloy, role: 'armor' });
            state.selectedNodeId = id;
        };
        addAt(pos, 'A');
        if (state.mirrorX && Math.abs(pos[0]) > 0.15) addAt([-pos[0], pos[1], pos[2]], 'B');
        return recompile();
    };

    const attachUnit = (unitId) => {
        const sub = resolver(unitId);
        const sel = selectedCompiledNode();
        if (!sub || !sel) return state.compiled;
        pushUndo();
        const n = FACE_NORMALS[state.selectedSocket] || [0, 1, 0];
        const subCompiled = compileMachine(sub, resolver);
        const sh = [
            (subCompiled.bounds.max[0] - subCompiled.bounds.min[0]) * 0.5,
            (subCompiled.bounds.max[1] - subCompiled.bounds.min[1]) * 0.5,
            (subCompiled.bounds.max[2] - subCompiled.bounds.min[2]) * 0.5,
        ];
        const subCenterY = (subCompiled.bounds.max[1] + subCompiled.bounds.min[1]) * 0.5;
        const targetCenter = [
            sel.pos[0] + n[0] * (sel.half[0] + sh[0] * 0.72),
            sel.pos[1] + n[1] * (sel.half[1] + sh[1] * 0.72) - subCenterY,
            sel.pos[2] + n[2] * (sel.half[2] + sh[2] * 0.72),
        ];
        state.blueprint.units = state.blueprint.units || [];
        const rootId = state.blueprint.nodes[0].id;
        const pushOne = (p, mirror, tag) => {
            const id = `u_${unitId}_${tag}_${state.seq++}`;
            state.blueprint.units.push({ id, unitId, parent: rootId, mountPos: p, mirrorX: mirror, scale: 1, material: state.activeAlloy });
            state.selectedNodeId = `${id}/${sub.nodes[0].id}`;
        };
        pushOne(targetCenter, false, 'A');
        if (state.mirrorX && Math.abs(targetCenter[0]) > 0.2) pushOne([-targetCenter[0], targetCenter[1], targetCenter[2]], true, 'B');
        return recompile();
    };

    const setSelectedAlloy = (alloyId) => {
        if (!MATERIALS[alloyId]) return state.compiled;
        pushUndo();
        state.activeAlloy = alloyId;
        const tgt = resolveEditableTarget();
        if (tgt.kind === 'node' && tgt.item) tgt.item.material = alloyId;
        else if (tgt.kind === 'unit' && tgt.item) tgt.item.material = alloyId;
        return recompile();
    };

    const nudgeSelected = (dx, dy, dz) => {
        const tgt = resolveEditableTarget();
        if (!tgt.item) return state.compiled;
        pushUndo();
        const p = tgt.kind === 'unit' ? (tgt.item.mountPos || [0, 0, 0]) : (tgt.item.pos || [0, 0, 0]);
        p[0] += dx; p[1] += dy; p[2] += dz;
        if (tgt.kind === 'unit') tgt.item.mountPos = p;
        else tgt.item.pos = p;
        return recompile();
    };

    const deleteSelected = () => {
        const tgt = resolveEditableTarget();
        if (!tgt.item) return state.compiled;
        if (tgt.kind === 'node') {
            if (tgt.item.id === state.blueprint.nodes[0].id) return state.compiled;
            pushUndo();
            state.blueprint.nodes = state.blueprint.nodes.filter((n) => n.id !== tgt.item.id);
        } else if (tgt.kind === 'unit') {
            pushUndo();
            state.blueprint.units = state.blueprint.units.filter((u) => u.id !== tgt.item.id);
        }
        state.selectedNodeId = state.blueprint.nodes[0]?.id || null;
        return recompile();
    };

    const saveAsCustomUnit = (customName) => {
        const clean = (customName || '').trim() || `Custom Rig ${Object.keys(customUnits).length + 1}`;
        const id = 'custom_' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + (Object.keys(customUnits).length + 1);
        const bpCopy = clone(state.blueprint);
        bpCopy.id = id;
        bpCopy.name = clean;
        bpCopy.tier = Math.min(3, Math.max(1, bpCopy.units?.length ? 2 : 1));
        bpCopy.category = bpCopy.category || 'custom';
        bpCopy.description = `User-compiled ${state.compiled.nameplate.partCount}-part unit (${Math.round(state.compiled.nameplate.massKg)} kg, grade ${state.compiled.nameplate.rating}).`;
        customUnits[id] = bpCopy;
        return bpCopy;
    };

    const undo = () => {
        if (!history.length) return state.compiled;
        state.blueprint = history.pop();
        return recompile();
    };

    const handleClick = (ray) => {
        const hit = view.pick(ray);
        if (!hit) return false;
        if (hit.type === 'socket') { state.selectedSocket = hit.socket; render(); return true; }
        if (hit.type === 'part') { state.selectedNodeId = hit.nodeId; render(); return true; }
        return false;
    };

    const tick = (t) => { if (state.benchTest) view.animateBench(t); };

    const setVisible = (v) => {
        floor.visible = v;
        for (const g of gridStrips) g.visible = v;
        if (!v) view.destroy();
        else render();
    };

    loadPreset('siege_howitzer');

    return {
        state, resolver, selectedCompiledNode, resolveEditableTarget,
        catalogList: () => listCatalogEntries(customUnits),
        loadPreset, recompile, render, tick, handleClick,
        addArmorPlate, attachUnit, setSelectedAlloy, nudgeSelected, deleteSelected, saveAsCustomUnit, undo, setVisible,
        destroy() { view.destroy(); floor.destroy(); for (const g of gridStrips) g.destroy(); },
    };
}
