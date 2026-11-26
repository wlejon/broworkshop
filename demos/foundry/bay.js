// demos/foundry/bay.js — Industrial Foundry Turntable Assembly Bay with
// machined steel plinth, gantry frame, forward-chevron calibration grid,
// direct 3D part/socket picking, bro.gizmo translation, and Bench Test.

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

// Front 3/4 hero viewing angle looking at the -Z front face of every machine
export const BAY_HERO_YAW = Math.PI - 0.62;
export const BAY_HERO_PITCH = -0.28;

function buildWorkshopStage(scene) {
    const meshes = [];
    const add = (opts, pos, quat) => {
        const m = scene.createMesh(opts);
        if (pos) { m.x = pos[0]; m.y = pos[1]; m.z = pos[2]; }
        if (quat) m.quaternion = quat;
        meshes.push(m);
        return m;
    };

    // Expansive dark slate workshop hangar floor
    add({ mesh: 'cylinder', radius: 64, halfHeight: 0.20, segments: 48, color: '#11151b', roughness: 0.90, metallic: 0.12, receivesShadow: true }, [0, -0.34, 0]);

    // Stepped beveled cast-iron turntable outer curb + machined turntable deck
    add({ mesh: 'cylinder', radius: 8.15, halfHeight: 0.08, segments: 64, color: '#161b23', roughness: 0.72, metallic: 0.55, receivesShadow: true }, [0, -0.10, 0]);
    add({ mesh: 'cylinder', radius: 7.72, halfHeight: 0.085, segments: 64, color: '#8f6224', roughness: 0.42, metallic: 0.78, receivesShadow: true }, [0, -0.09, 0]);
    add({ mesh: 'cylinder', radius: 7.50, halfHeight: 0.09, segments: 64, color: '#1d232d', roughness: 0.64, metallic: 0.36, receivesShadow: true }, [0, -0.09, 0]);

    // Fine metric calibration grid lines recessed flush on the turntable
    for (let i = -6; i <= 6; i += 1.5) {
        const major = Math.abs(i) < 0.01;
        const len = Math.sqrt(Math.max(0, 7.25 * 7.25 - i * i));
        const col = major ? '#3c4d63' : '#26303d';
        add({ mesh: 'box', halfW: len, halfH: 0.005, halfD: major ? 0.024 : 0.011, color: col, roughness: 0.75 }, [0, 0.005, i]);
        add({ mesh: 'box', halfW: major ? 0.024 : 0.011, halfH: 0.005, halfD: len, color: col, roughness: 0.75 }, [i, 0.005, 0]);
    }

    // 24 radial perimeter calibration ticks + glowing front (-Z) nose chevron
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const cardinal = i % 6 === 0;
        const r = 7.12;
        add({
            mesh: 'box', halfW: cardinal ? 0.06 : 0.03, halfH: 0.007, halfD: cardinal ? 0.32 : 0.16,
            color: cardinal ? '#d98a2b' : '#3b4a5e',
            emissive: cardinal ? 0.35 : 0, emissiveColor: '#f59e0b', roughness: 0.6,
        }, [Math.sin(a) * r, 0.008, Math.cos(a) * r], [0, Math.sin(a * 0.5), 0, Math.cos(a * 0.5)]);
    }
    // Forward (-Z) floor indicator chevron strips
    add({ mesh: 'box', halfW: 0.55, halfH: 0.008, halfD: 0.07, color: '#f59e0b', emissive: 0.7, emissiveColor: '#f59e0b' }, [-0.36, 0.01, -5.85], [0, Math.sin(0.32), 0, Math.cos(0.32)]);
    add({ mesh: 'box', halfW: 0.55, halfH: 0.008, halfD: 0.07, color: '#f59e0b', emissive: 0.7, emissiveColor: '#f59e0b' }, [0.36, 0.01, -5.85], [0, Math.sin(-0.32), 0, Math.cos(-0.32)]);

    // Circular industrial hangar enclosure (12 matte gunmetal wall bays + pilasters + clerestory light strips)
    // Screens out outdoor HDRI horizon while keeping real IBL metal reflections & architectural depth!
    const wallN = 12, wallR = 23.0;
    const segW = (Math.PI * wallR / wallN) * 1.06;
    for (let i = 0; i < wallN; i++) {
        const a = (i / wallN) * Math.PI * 2 + Math.PI / wallN;
        const ca = Math.cos(a), sa = Math.sin(a);
        const q = [0, Math.sin(a * 0.5), 0, Math.cos(a * 0.5)];
        // Main hangar wall bay panel
        add({ mesh: 'box', halfW: segW, halfH: 10.5, halfD: 0.45, color: '#141922', roughness: 0.90, metallic: 0.22, receivesShadow: true }, [sa * wallR, 9.8, ca * wallR], q);
        // Horizontal mid-wall structural dado rail
        add({ mesh: 'box', halfW: segW * 0.96, halfH: 0.28, halfD: 0.58, color: '#1d2430', roughness: 0.72, metallic: 0.55 }, [sa * (wallR - 0.18), 3.6, ca * (wallR - 0.18)], q);
        // Heavy vertical steel pilaster column at panel seam
        const pa = (i / wallN) * Math.PI * 2;
        const pq = [0, Math.sin(pa * 0.5), 0, Math.cos(pa * 0.5)];
        add({ mesh: 'box', halfW: 0.42, halfH: 10.5, halfD: 0.65, color: '#1a202b', roughness: 0.68, metallic: 0.62 }, [Math.sin(pa) * (wallR - 0.55), 9.8, Math.cos(pa) * (wallR - 0.55)], pq);
        // Recessed warm industrial clerestory light bar high on every second bay
        if (i % 2 === 0) {
            add({ mesh: 'box', halfW: segW * 0.55, halfH: 0.12, halfD: 0.12, color: '#ffbe6b', emissive: 1.5, emissiveColor: '#ffa33b' }, [sa * (wallR - 0.62), 9.6, ca * (wallR - 0.62)], q);
        }
    }

    return meshes;
}

export function createFoundryBay(scene, vp, opts = {}) {
    const customUnits = {};
    const resolver = createCatalogResolver(customUnits);
    const view = createBayView(scene);
    const history = [];
    const onChanged = opts.onChanged || null;

    const stageMeshes = buildWorkshopStage(scene);

    const state = {
        presetId: 'siege_howitzer',
        blueprint: clone(BUILTIN_CATALOG.siege_howitzer),
        compiled: null,
        loadCase: 'off',
        sweepJointIdx: 0,
        sweepValue: 0,
        activeAlloy: 'titanium',
        selectedNodeId: null,
        selectedSocket: '+Y',
        showGhostFrame: false,
        mirrorX: true,
        benchTest: false,
        visible: true,
        seq: 1,
        customUnits,
    };

    const selectedCompiledNode = () => {
        if (!state.compiled) return null;
        return state.compiled.nodes.find((n) => n.id === state.selectedNodeId) || state.compiled.nodes[0];
    };

    const resolveEditableTarget = () => {
        const cn = selectedCompiledNode();
        if (!cn) return { kind: 'root', id: null };
        const topSeg = cn.unitPath ? cn.unitPath.split('/')[0] : cn.rawId;
        const directNode = (state.blueprint.nodes || []).find((n) => n.id === cn.id || n.id === topSeg);
        if (directNode) return { kind: 'node', item: directNode, cn, isRoot: directNode.id === state.blueprint.nodes[0]?.id };
        const unitRef = (state.blueprint.units || []).find((u) => u.id === topSeg);
        if (unitRef) return { kind: 'unit', item: unitRef, cn, isRoot: false };
        return { kind: 'node', item: state.blueprint.nodes[0], cn, isRoot: true };
    };

    const syncGizmo = () => {
        if (typeof bro === 'undefined' || !bro.gizmo) return;
        if (!state.visible || !state.compiled) { bro.gizmo.detach(); return; }
        const tgt = resolveEditableTarget();
        if (!tgt.item || tgt.isRoot) { bro.gizmo.detach(); return; }
        bro.gizmo.configure({ size: 0.9, alwaysOnTop: true, emissive: 0.65, emissiveHover: 1.1 });
        bro.gizmo.setMode('translate');
        bro.gizmo.attach({
            position: () => view.getSelectedWorldCenter() || [0, 1, 0],
            beginDrag: () => { pushUndo(); },
            translate: (dx, dy, dz) => {
                const cur = resolveEditableTarget();
                if (!cur.item || cur.isRoot) return;
                const p = cur.kind === 'unit' ? (cur.item.mountPos || [0, 0, 0]) : (cur.item.pos || [0, 0, 0]);
                p[0] += dx; p[1] += dy; p[2] += dz;
                if (cur.kind === 'unit') cur.item.mountPos = p;
                else cur.item.pos = p;
                recompile();
                if (onChanged) onChanged();
            },
            endDrag: () => {
                const cur = resolveEditableTarget();
                if (!cur.item || cur.isRoot) return;
                const p = cur.kind === 'unit' ? cur.item.mountPos : cur.item.pos;
                if (p) {
                    p[0] = Math.round(p[0] * 20) / 20;
                    p[1] = Math.round(p[1] * 20) / 20;
                    p[2] = Math.round(p[2] * 20) / 20;
                    recompile();
                    if (onChanged) onChanged();
                }
            },
        });
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
        if (!state.visible) return;
        view.render(state.compiled, {
            loadCase: state.loadCase,
            sweepJointIdx: state.sweepJointIdx,
            sweepValue: state.sweepValue,
            selectedNodeId: state.selectedNodeId,
            selectedSocket: state.selectedSocket,
            ghostHalf: [0.38, 0.24, 0.46],
            showGhostFrame: state.showGhostFrame,
            showSockets: true,
            groundY: 0,
        });
        syncGizmo();
    };

    const pushUndo = () => {
        history.push(clone(state.blueprint));
        if (history.length > 24) history.shift();
    };

    const frameMachine = (resetAngle = true) => {
        const c = state.compiled;
        if (!c) return;
        const ext = c.bounds.max, min = c.bounds.min;
        const span = Math.hypot(ext[0] - min[0], ext[1] - min[1], ext[2] - min[2]);
        const target = [0, (ext[1] - min[1]) * 0.48, 0];
        const dist = Math.max(2.15, span * 1.08);
        if (resetAngle) vp.reframe(target, dist, { yaw: BAY_HERO_YAW, pitch: BAY_HERO_PITCH });
        else vp.reframe(target, dist);
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
        state.showGhostFrame = false;
        const c = recompile();
        frameMachine(true);
        return c;
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
        state.showGhostFrame = false;
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
        state.showGhostFrame = false;
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

    const setSelectedSocket = (faceKey, showGhost = true) => {
        if (!FACE_NORMALS[faceKey]) return;
        state.selectedSocket = faceKey;
        state.showGhostFrame = !!showGhost;
        render();
    };

    const setGhostPreview = (on) => {
        if (state.showGhostFrame === !!on) return;
        state.showGhostFrame = !!on;
        render();
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
        if (!tgt.item || tgt.isRoot) return state.compiled;
        pushUndo();
        if (tgt.kind === 'node') {
            state.blueprint.nodes = state.blueprint.nodes.filter((n) => n.id !== tgt.item.id);
        } else if (tgt.kind === 'unit') {
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
        if (hit.type === 'socket') {
            state.selectedSocket = hit.socket;
            state.showGhostFrame = true;
            render();
            return true;
        }
        if (hit.type === 'part') {
            state.selectedNodeId = hit.nodeId;
            render();
            return true;
        }
        return false;
    };

    const pickHover = (ray) => view.pick(ray);

    const tick = (t) => { if (state.benchTest) view.animateBench(t); };

    const setVisible = (v) => {
        state.visible = !!v;
        for (const m of stageMeshes) m.visible = state.visible;
        if (!state.visible) {
            if (typeof bro !== 'undefined' && bro.gizmo) bro.gizmo.detach();
            view.destroy();
        } else {
            render();
        }
    };

    loadPreset('siege_howitzer');

    return {
        state, resolver, selectedCompiledNode, resolveEditableTarget, frameMachine,
        catalogList: () => listCatalogEntries(customUnits),
        loadPreset, recompile, render, tick, handleClick, pickHover,
        addArmorPlate, attachUnit, setSelectedAlloy, setSelectedSocket, setGhostPreview,
        nudgeSelected, deleteSelected, saveAsCustomUnit, undo, setVisible,
        destroy() {
            if (typeof bro !== 'undefined' && bro.gizmo) bro.gizmo.detach();
            view.destroy();
            for (const m of stageMeshes) m.destroy();
        },
    };
}
