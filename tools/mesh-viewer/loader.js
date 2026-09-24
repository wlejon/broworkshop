// loader.js — read a mesh file into scene nodes. glTF brings materials,
// textures, skins, skeletons and clips; OBJ / PLY / STL are geometry only.

export const LOAD_EXTS = ['.glb', '.gltf', '.obj', '.ply', '.stl'];
const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
                 '#16a085', '#d35400', '#c0392b', '#8e44ad'];

export function fileExt(p) {
    const m = /\.([^.\\/]+)$/.exec(p);
    return m ? '.' + m[1].toLowerCase() : '';
}
export const fileName = (p) => p.replace(/\\/g, '/').split('/').pop();

/** Mesh.loadGLTF's scene shape for any supported file. Throws on failure. */
export function readMeshFile(path) {
    const ext = fileExt(path);
    if (ext === '.glb' || ext === '.gltf') return Mesh.loadGLTF(path);
    const loaders = { '.obj': 'loadOBJ', '.ply': 'loadPLY', '.stl': 'loadSTL' };
    if (!loaders[ext]) throw new Error('unsupported file type: ' + ext);
    const m = Mesh[loaders[ext]](path);
    return { meshes: [m], skins: [], skeletons: [], animations: [], materials: [], images: [], meshMaterial: [] };
}

/** Union bbox of meshes: { min, max, center, size (largest extent) }. */
export function boundsOf(meshes) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) {
        const bb = m.computeBBox();
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], bb.min[i]); hi[i] = Math.max(hi[i], bb.max[i]); }
    }
    return {
        min: lo, max: hi,
        center: [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2),
        extent: [0, 1, 2].map((i) => hi[i] - lo[i]),
        size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1,
    };
}

/**
 * createMesh options for mesh `i` of a glTF scene: base colour (texture or
 * factor, else a palette colour), PBR factors and maps, emission.
 */
function materialOptions(gltf, i) {
    const materials = gltf.materials || [], images = gltf.images || [];
    const matIdx = (gltf.meshMaterial || [])[i];
    const mat = matIdx != null && matIdx >= 0 ? materials[matIdx] : null;
    const opts = {};
    if (!mat) { opts.color = PALETTE[i % PALETTE.length]; return opts; }

    // glTF names textures by image index (-1 = none).
    const img = (idx) => {
        const im = idx != null && idx >= 0 ? images[idx] : null;
        return im && im.data && im.width > 0 && im.height > 0 ? { width: im.width, height: im.height, data: im.data } : null;
    };
    const base = img(mat.baseColorTexture);
    if (base) opts.texture = base;
    opts.color = mat.baseColorFactor || (base ? [1, 1, 1, 1] : PALETTE[i % PALETTE.length]);
    // Factors multiply the sampled maps, as in glTF.
    opts.metallic = mat.metallicFactor != null ? mat.metallicFactor : 0;
    opts.roughness = mat.roughnessFactor != null ? mat.roughnessFactor : 1;
    const maps = { normalTexture: mat.normalTexture, metallicRoughnessTexture: mat.metallicRoughnessTexture,
                   occlusionTexture: mat.occlusionTexture };
    for (const k in maps) { const t = img(maps[k]); if (t) opts[k] = t; }

    // Emission = factor x texture. With a map, emit through it; without one,
    // emit flat only for a non-zero factor (a [1,1,1] factor with no map
    // would otherwise light the whole mesh).
    const ef = mat.emissiveFactor || [0, 0, 0];
    const em = img(mat.emissiveTexture);
    if (em) {
        opts.emissiveTexture = em;
        opts.emissive = 1;
        opts.emissiveColor = ef;
    } else {
        const k = Math.max(ef[0], ef[1], ef[2]);
        if (k > 0) { opts.emissive = k; opts.emissiveColor = ef.map((v) => v / k); }
    }
    return opts;
}

/**
 * Load `path` into `scene`. Returns the loaded document:
 * { path, name, gltf, items, skin, skeleton, animations, hasSkin, hasSkel,
 *   hasAnim, bounds } where each item is { bind (file mesh), work (edited
 * copy), basePositions, baseNormals, baseColors, node, loadedEmissive,
 * baseTexture, hullNode, selfxNode }. opts: { texture } (false creates the
 * nodes without their base colour map).
 */
export function loadIntoScene(scene, path, opts) {
    const o = opts || {};
    const gltf = readMeshFile(path);
    // The loaders hand back an empty mesh for a missing or unreadable file.
    if (!gltf || !gltf.meshes || !gltf.meshes.some((m) => m.vertexCount > 0)) {
        throw new Error('no geometry in ' + fileName(path));
    }
    const skin = gltf.skins && gltf.skins[0] && gltf.skins[0].boneCount > 0 ? gltf.skins[0] : null;
    const skeleton = gltf.skeletons && gltf.skeletons[0] && gltf.skeletons[0].boneCount > 0 ? gltf.skeletons[0] : null;
    const animations = gltf.animations || [];

    const items = gltf.meshes.map((bind, i) => {
        if (!bind.hasNormals) bind.computeNormals();
        const work = bind.clone();
        const mat = materialOptions(gltf, i);
        const nodeOpts = Object.assign({ mesh: work, name: 'mesh-' + i, castsShadow: true, receivesShadow: true }, mat);
        if (o.texture === false) delete nodeOpts.texture;
        return {
            bind, work,
            basePositions: new Float32Array(bind.positions),
            baseNormals: bind.hasNormals ? new Float32Array(bind.normals) : null,
            baseColors: bind.hasColors ? new Float32Array(bind.colors) : null,
            node: scene.createMesh(nodeOpts),
            loadedEmissive: mat.emissive || 0,
            baseTexture: mat.texture || null,
            hullNode: null, selfxNode: null,
        };
    });
    return {
        path, name: fileName(path), gltf, items, skin, skeleton, animations,
        hasSkin: !!skin, hasSkel: !!skeleton, hasAnim: animations.length > 0,
        bounds: boundsOf(gltf.meshes),
    };
}

/** Destroy every node a loaded document created. */
export function disposeLoaded(doc) {
    for (const it of doc.items) {
        for (const k of ['node', 'hullNode', 'selfxNode']) if (it[k]) { it[k].destroy(); it[k] = null; }
    }
}
