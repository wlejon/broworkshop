// Inference snapping UI: resolve the best snap under the cursor across every
// visible primitive, and show it as a 2D marker over the canvas plus a small
// 3D sphere at the snapped point.

import { Inference } from "../model/inference.js";

// Marker glyphs per snap type (18x18 SVG).
const SHAPES = {
    'endpoint': '<circle cx="9" cy="9" r="5" fill="#2ecc71" stroke="#fff" stroke-width="1.5"/>',
    'midpoint': '<polygon points="9,2 16,9 9,16 2,9" fill="none" stroke="#1abc9c" stroke-width="2"/>',
    'on-edge':  '<rect x="3" y="3" width="12" height="12" fill="none" stroke="#e74c3c" stroke-width="2"/>',
    'on-face':  '<polygon points="9,3 15,9 9,15 3,9" fill="#3498db" fill-opacity="0.4" stroke="#3498db" stroke-width="1.5"/>',
};
const SPHERE_RADIUS = 0.04;

/**
 * ed: { registry, viewport }. markerEl sits over the canvas (same origin);
 * infoEl gets the snap label.
 */
export function createSnap(ed, markerEl, infoEl) {
    const sphereMesh = Mesh.sphere(SPHERE_RADIUS, 12, 8);
    const spheres = {};
    for (const [type, color] of Object.entries(Inference._COLOR)) {
        const node = ed.viewport.scene.createMesh({ data: sphereMesh, color, unlit: true, name: 'snap-sphere-' + type });
        node.visible = false;
        spheres[type] = node;
    }
    let active = null;

    const hideSpheres = () => { for (const t in spheres) spheres[t].visible = false; };

    return {
        get active() { return active; },

        /** Show `snap` (from resolve), or hide everything for null. */
        show(snap) {
            active = snap || null;
            hideSpheres();
            if (!snap) {
                markerEl.style.display = 'none';
                infoEl.textContent = '';
                return;
            }
            markerEl.style.display = 'block';
            markerEl.style.left = snap.screen.x + 'px';
            markerEl.style.top = snap.screen.y + 'px';
            markerEl.innerHTML = '<svg width="18" height="18">' + (SHAPES[snap.type] || '') + '</svg>';
            infoEl.innerHTML = 'snap: <b style="color:' + snap.color + '">' + snap.label + '</b>';
            const s = spheres[snap.type];
            if (s) { s.x = snap.position[0]; s.y = snap.position[1]; s.z = snap.position[2]; s.visible = true; }
        },

        clear() { this.show(null); },

        /**
         * Best snap at canvas (cx, cy) for world `ray`. `face` adds the
         * on-face fallback (nearest primitive under the ray); `excludeTypes`
         * drops snap kinds; `excludeId` ignores one object (the one being
         * dragged, so it cannot snap to itself).
         */
        resolve(cx, cy, ray, face, excludeTypes, excludeId) {
            const filter = excludeId != null ? { excludeId } : null;
            let onFaceHit = null;
            if (face) {
                const pick = ed.registry.pickAt(ray.origin, ray.dir, filter);
                if (pick) onFaceHit = pick.hit;
            }
            const [width, height] = ed.viewport.size();
            return Inference.findSnap({
                cursorX: cx, cursorY: cy, ray,
                camOpts: ed.viewport.view(), width, height,
                geos: ed.registry.collectInferenceGeos(filter),
                onFaceHit, excludeTypes,
            });
        },
    };
}

/** Signed distance of a snap point from `pivot` along `axis`. */
export function snapAxisDistance(snap, pivot, axis) {
    return (snap.position[0] - pivot[0]) * axis[0] +
           (snap.position[1] - pivot[1]) * axis[1] +
           (snap.position[2] - pivot[2]) * axis[2];
}
