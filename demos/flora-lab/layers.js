// The rendered plant: GPU nodes fed by the sim worker's frame packets.
//
//   branches    a tube node: the vertex shader sweeps each per-segment record
//               into a tapered 6-sided tube (only the compact buffer uploads)
//   foliage     a scatter node: leaf cards placed along the twigs in the
//               vertex shader from the per-segment + per-leaf buffers
//   blooms      two meshes, petals and emissive golden eyes, moved by pointer
//   organicSdf  the smooth-unioned SDF mesh of the whole world (off by default)
//
// Each layer's node is made on its first packet and updated in place after.

import { SPECIES, FOLIAGE, TUBE, leafCard } from "/app/shared.js";

/** Hot layers: shown only when on; the worker emits only those (lab.js). */
export const LAYERS = {
    branches:   { label: 'branches',         color: [0.33, 0.23, 0.14], on: true },
    organicSdf: { label: 'organic SDF mesh', color: [0.22, 0.65, 0.45], on: false },
    foliage:    { label: 'foliage',          color: [0.34, 0.55, 0.24], on: true },
    blooms:     { label: 'blooms',           color: [0.97, 0.62, 0.76], on: true },
};

export function createLayers(scene) {
    const leaf = leafCard();
    const leafTris = leaf.triangleCount;
    const nodes = { branches: null, organicSdf: null, foliage: null, petals: null, centers: null };
    const tris = { branches: 0, organicSdf: 0, foliage: 0, blooms: 0 };
    let emissiveGain = 0.5;

    const hide = (n) => { if (nodes[n]) nodes[n].visible = false; };

    function branches(t) {
        if (!t || t.segCount === 0) { hide('branches'); tris.branches = 0; return; }
        const desc = Object.assign({}, TUBE, t);
        if (!nodes.branches) {
            nodes.branches = scene.createInstancedMesh({
                tube: desc, color: LAYERS.branches.color, metallic: 0, roughness: 0.85,
                castsShadow: true, receivesShadow: true,
            });
        } else {
            nodes.branches.visible = true;
            nodes.branches.setTubeSegments(desc);
        }
        tris.branches = t.segCount * TUBE.sides * 2;
    }

    function foliage(s) {
        if (!s || s.segCount === 0) { hide('foliage'); tris.foliage = 0; return; }
        const scatter = Object.assign({}, FOLIAGE, s);
        if (!nodes.foliage) {
            nodes.foliage = scene.createInstancedMesh({
                mesh: leaf, scatter, color: SPECIES.sun.color, metallic: 0, roughness: 0.92,
                doubleSided: true, subsurface: 0.5, vertexColorTint: false,
                castsShadow: false, receivesShadow: true,
            });
        } else {
            nodes.foliage.visible = true;
            nodes.foliage.setScatterSegments(scatter);
        }
        tris.foliage = (s.instanceCount || 0) * leafTris;
    }

    function mesh(key, m, opts) {
        if (!m || !(m.triangleCount > 0)) { hide(key); return 0; }
        const n = m.triangleCount;
        if (!nodes[key]) nodes[key] = scene.createMesh(Object.assign({ data: m }, opts));
        else { nodes[key].visible = true; nodes[key].updateMesh(m); }
        return n;
    }

    function blooms(petals, centers) {
        tris.blooms = mesh('petals', petals, {
            color: LAYERS.blooms.color, metallic: 0, roughness: 0.55,
            twoSided: true, subsurface: 0.4, castsShadow: false, receivesShadow: true,
        }) + mesh('centers', centers, {
            color: [0.98, 0.80, 0.25], metallic: 0, roughness: 0.6,
            emissive: 0.3 * emissiveGain, castsShadow: false, receivesShadow: true,
        });
        if (nodes.centers) nodes.centers.emissive = 0.3 * emissiveGain;
    }

    function organicSdf(m) {
        tris.organicSdf = mesh('organicSdf', m, {
            color: LAYERS.organicSdf.color, metallic: 0, roughness: 0.8, castsShadow: true, receivesShadow: true,
        });
    }

    return {
        nodes,
        /** Upload a frame packet's buffers for the layers that are on. */
        apply(f) {
            if (LAYERS.branches.on) branches(f.branches);
            if (LAYERS.foliage.on) foliage(f.foliage);
            if (LAYERS.blooms.on) blooms(f.bloomPetals, f.bloomCenters);
            if (LAYERS.organicSdf.on) organicSdf(f.organicSdf);
        },
        /** Turn a layer on/off; an off layer gets no more packets, so hide it now. */
        set(key, on) {
            LAYERS[key].on = on;
            if (on) return;
            tris[key] = 0;
            if (key === 'blooms') { hide('petals'); hide('centers'); } else hide(key);
        },
        /** Flags for the worker's `layers` message. */
        flags() { return Object.fromEntries(Object.keys(LAYERS).map((k) => [k, LAYERS[k].on])); },
        /** The blooms' eyes glow by the time of day's emissive gain. */
        setEmissiveGain(g) {
            emissiveGain = g;
            if (nodes.centers) nodes.centers.emissive = 0.3 * g;
        },
        get triangles() { return tris.branches + tris.foliage + tris.blooms + tris.organicSdf; },
    };
}
