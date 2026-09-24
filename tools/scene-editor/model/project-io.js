// Project file format (lib/kit/project.js bundles: my-scene.bro/project.json).
//
// Schema 2 stores the whole SceneObject tree: every node's id, name,
// visibility, kind and local TRS; primitives add their local mesh buffers as
// plain arrays (JSON-safe, fine at the sizes the editor targets), component
// instances reference their definition by id, groups nest children.
//
//   { components: [{ id, name, root }], tree: { children: [...] },
//     primitives: [...],   // flat depth-first primitive list, for tooling
//     activeId, ...extra }
//
// `primitives` is a convenience projection of `tree`; loading reads `tree`.

import { SceneRegistry } from "./scene-registry.js";
import { Primitive } from "./primitive.js";
import { Group, ComponentDefinition, ComponentInstance } from "./scene-object.js";

export const PROJECT_SCHEMA = 2;

function nodeToJSON(n) {
    const base = {
        id:          n.id,
        name:        n.name,
        visible:     n.visible,
        kind:        n.kind,
        translation: Array.from(n.translation),
        rotation:    Array.from(n.rotation),
        scale:       Array.from(n.scale),
    };
    if (n.kind === 'primitive') {
        base.color     = n.color;
        base.positions = Array.from(n.positions);
        base.indices   = Array.from(n.indices);
        base.normals   = n.normals ? Array.from(n.normals) : null;
    } else if (n.kind === 'component-instance') {
        base.definitionId = n.definition ? n.definition.id : null;
    } else {
        base.children = n.children.map(nodeToJSON);
    }
    return base;
}

/** Registry -> project data. `extra` fields are merged in (editor state). */
export function serializeScene(registry, extra) {
    const tree = { children: registry.root.children.map(nodeToJSON) };
    const primitives = [];
    (function walk(node) {
        if (node.kind === 'primitive') primitives.push(node);
        else if (node.children) node.children.forEach(walk);
    })(tree);
    return Object.assign({
        components: registry.components.map(def => ({ id: def.id, name: def.name, root: nodeToJSON(def.root) })),
        tree,
        primitives,
        activeId: registry.active ? registry.active.id : null,
    }, extra);
}

function reserveId(registry, id) {
    if (id >= registry._nextId) registry._nextId = id + 1;
}

// Build `data` under `parent`. Top-down, so children attach to their
// already-built parent directly.
function nodeFromJSON(registry, parent, data, componentsById) {
    let node;
    if (data.kind === 'primitive') {
        node = new Primitive({
            id: data.id, name: data.name, color: data.color,
            scene: registry.scene,
            mesh: SceneRegistry.buildMeshFromSpec({ type: 'box', params: { sx: 1, sy: 1, sz: 1 } }),
            translation: data.translation, rotation: data.rotation, scale: data.scale,
        });
        node.updateGeometry(
            new Float32Array(data.positions),
            new Uint32Array(data.indices),
            data.normals ? new Float32Array(data.normals) : null);
        node.setVisible(data.visible !== false);
    } else if (data.kind === 'component-instance') {
        const def = componentsById.get(data.definitionId);
        if (!def) return null;
        node = new ComponentInstance({
            id: data.id, name: data.name, scene: registry.scene, definition: def,
            translation: data.translation, rotation: data.rotation, scale: data.scale,
            visible: data.visible,
        });
    } else {
        node = new Group({
            id: data.id, name: data.name, visible: data.visible,
            translation: data.translation, rotation: data.rotation, scale: data.scale,
        });
    }
    parent.addChild(node);
    reserveId(registry, data.id);
    if (node.kind === 'group' && data.children) {
        for (const c of data.children) nodeFromJSON(registry, node, c, componentsById);
    }
    return node;
}

/** Replace the registry's contents with project data. Returns `data`. */
export function deserializeScene(registry, data) {
    registry.clear();
    registry._nextId = 1;

    // Components first: instances reference them by id.
    const componentsById = new Map();
    for (const cd of data.components || []) {
        const def = new ComponentDefinition({ id: cd.id, name: cd.name });
        reserveId(registry, cd.id);
        for (const c of (cd.root && cd.root.children) || []) nodeFromJSON(registry, def.root, c, componentsById);
        registry.components.push(def);
        componentsById.set(def.id, def);
    }
    for (const c of (data.tree && data.tree.children) || []) {
        nodeFromJSON(registry, registry.root, c, componentsById);
    }
    if (data.activeId != null) {
        const t = registry.getById(data.activeId);
        if (t) registry.active = t;
    }
    registry._emit();
    return data;
}
