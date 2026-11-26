// demos/foundry/bay.js — Interactive Machine Assembly Bay with live recompilation,
// recursive custom unit saving, mount sockets, mirror symmetry, and physical-form overlay.

import { MATERIALS, materialOf } from "/lib/machine/materials.js";
import { compileMachine } from "/lib/machine/compiler.js";
import { BUILTIN_CATALOG, createCatalogResolver, listCatalogEntries } from "/lib/machine/assemblies.js";
import { createBayView } from "/lib/machine/view.js";

function clone(v) { return JSON.parse(JSON.stringify(v)); }

const MOUNT_PRESETS = {
    top:   { pos: [0, 2.25, 0],     mirror: false, label: 'Top Deck' },
    front: { pos: [0, 1.45, -2.35], mirror: false, label: 'Front Prow' },
    rear:  { pos: [0, 1.45, 2.35],  mirror: false, label: 'Rear Stern' },
    side:  { pos: [1.75, 1.25, 0],  mirror: true,  label: 'Side Mount' },
    under: { pos: [1.55, 1.05, 0],  mirror: true,  label: 'Undercarriage' },
};

export function createFoundryBay(scene, vp) {
    const customUnits = {};
    const resolver = createCatalogResolver(customUnits);
    const view = createBayView(scene);
    const history = [];

    // Ground turntable + subtle grid lines on bay floor.
    const floor = scene.createMesh({
        mesh: 'cylinder', radius: 14, halfHeight: 0.15, segments: 48,
        color: '#21262e', roughness: 0.88, metallic: 0.2,
    });
    floor.y = -0.15;

    const ring = scene.createMesh({
        mesh: 'cylinder', radius: 8.5, halfHeight: 0.015, segments: 48,
        color: '#29323f', roughness: 0.7, metallic: 0.35,
    });
    ring.y = 0.01;

    const state = {
        presetId: 'siege_howitzer',
        blueprint: clone(BUILTIN_CATALOG.siege_howitzer),
        compiled: null,
        loadCase: 'recoil',
        sweepJointIdx: 0,
        sweepValue: 0,
        activeAlloy: 'titanium',
        mountSlot: 'top',
        mirrorX: true,
        selectedNodeId: null,
        seq: 1,
        customUnits,
    };

    const recompile = () => {
        state.compiled = compileMachine(state.blueprint, resolver);
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
        state.selectedNodeId = state.blueprint.nodes?.[0]?.id || null;
        const c = recompile();
        const ext = c.bounds.max;
        const min = c.bounds.min;
        const span = Math.max(4, Math.hypot(ext[0] - min[0], ext[1] - min[1], ext[2] - min[2]));
        vp.reframe([0, (ext[1] - min[1]) * 0.45, 0], Math.max(8, span * 1.45));
        return c;
    };

    const rootNodeId = () => (state.blueprint.nodes && state.blueprint.nodes[0] ? state.blueprint.nodes[0].id : null);

    const addArmorPlate = (mountKey = state.mountSlot) => {
        pushUndo();
        const mp = MOUNT_PRESETS[mountKey] || MOUNT_PRESETS.front;
        const parent = rootNodeId();
        const baseY = state.blueprint.nodes?.[0]?.pos?.[1] ?? 1.2;
        const addOne = (sx, tag) => {
            const id = `plate_${tag}_${state.seq++}`;
            state.blueprint.nodes = state.blueprint.nodes || [];
            state.blueprint.nodes.push({
                id,
                kind: 'beam',
                parent,
                pos: [mp.pos[0] * sx, mp.pos[1] * 0.5 + baseY * 0.5, mp.pos[2]],
                half: mountKey === 'side' ? [0.16, 0.42, 1.55] : [1.25, 0.22, 0.32],
                material: state.activeAlloy,
                role: 'armor',
            });
            state.selectedNodeId = id;
        };
        if (state.mirrorX && Math.abs(mp.pos[0]) > 0.1) {
            addOne(1, 'R');
            addOne(-1, 'L');
        } else {
            addOne(1, 'C');
        }
        return recompile();
    };

    const attachUnit = (unitId, mountKey = state.mountSlot) => {
        if (!resolver(unitId)) return state.compiled;
        pushUndo();
        const mp = MOUNT_PRESETS[mountKey] || MOUNT_PRESETS.top;
        const parent = rootNodeId();
        const baseY = state.blueprint.nodes?.[0]?.pos?.[1] ?? 1.2;
        state.blueprint.units = state.blueprint.units || [];
        const mountY = mountKey === 'top' ? (state.compiled.bounds.max[1] + 0.15) : (mountKey === 'under' ? 0.95 : baseY);

        const pushUnit = (mirror, tag) => {
            const id = `u_${unitId}_${tag}_${state.seq++}`;
            state.blueprint.units.push({
                id,
                unitId,
                parent,
                mountPos: [mirror ? -mp.pos[0] : mp.pos[0], mountY, mp.pos[2]],
                mirrorX: mirror,
                scale: 1,
                material: state.activeAlloy,
            });
        };
        if (state.mirrorX && Math.abs(mp.pos[0]) > 0.1) {
            pushUnit(false, 'R');
            pushUnit(true, 'L');
        } else {
            pushUnit(false, 'C');
        }
        return recompile();
    };

    const applyAlloyToFrame = (alloyId) => {
        if (!MATERIALS[alloyId]) return state.compiled;
        pushUndo();
        state.activeAlloy = alloyId;
        for (const n of state.blueprint.nodes || []) {
            if (!state.selectedNodeId || n.id === state.selectedNodeId || n.role === 'frame' || n.role === 'armor' || n.role === 'chassis') {
                n.material = alloyId;
            }
        }
        for (const u of state.blueprint.units || []) u.material = alloyId;
        return recompile();
    };

    const saveAsCustomUnit = (customName) => {
        const clean = (customName || '').trim() || `Custom Unit ${Object.keys(customUnits).length + 1}`;
        const id = 'custom_' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + (Object.keys(customUnits).length + 1);
        const bpCopy = clone(state.blueprint);
        bpCopy.id = id;
        bpCopy.name = clean;
        bpCopy.tier = Math.min(3, Math.max(1, (bpCopy.units?.length ? 2 : 1)));
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

    const setVisible = (v) => {
        floor.visible = v;
        ring.visible = v;
        if (!v) view.destroy();
        else render();
    };

    loadPreset('siege_howitzer');

    return {
        state,
        resolver,
        mountPresets: MOUNT_PRESETS,
        catalogList: () => listCatalogEntries(customUnits),
        loadPreset,
        recompile,
        render,
        addArmorPlate,
        attachUnit,
        applyAlloyToFrame,
        saveAsCustomUnit,
        undo,
        setVisible,
        destroy() { view.destroy(); floor.destroy(); ring.destroy(); },
    };
}
