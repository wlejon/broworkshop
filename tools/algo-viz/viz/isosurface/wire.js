// The 3D wire: every committed segment as a thin extruded box (a flat
// ribbon would vanish edge-on), with per-vertex colours matching the 2D
// output, rebuilt into one scene mesh.

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
// Two caps then four sides; CCW from outside. 0..3 sit at p0, 4..7 at p1.
const FACES = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
];

/** Box geometry for `segs` ({x0,y0,z0,x1,y1,z1,r,g,b}) of side `thick`, or null if empty. */
export function buildWireGeometry(segs, thick) {
    const count = segs.length;
    if (count === 0) return null;
    const half = thick * 0.5;
    const positions = new Float32Array(count * 8 * 3);
    const normals = new Float32Array(count * 8 * 3);
    const colors = new Float32Array(count * 8 * 4);
    const indices = new Uint32Array(count * FACES.length);
    let p = 0, c = 0, ii = 0;
    for (let s = 0; s < count; s++) {
        const g = segs[s];
        const dx = g.x1 - g.x0, dy = g.y1 - g.y0, dz = g.z1 - g.z0;
        const L = Math.hypot(dx, dy, dz) || 1;
        const ux = dx / L, uy = dy / L, uz = dz / L;
        // perp1 = u x +Z unless u is nearly along Z, then +X; perp2 = u x perp1.
        let ax = 1, ay = 0, az = 0;
        if (Math.abs(uz) < 0.95) { ax = uy; ay = -ux; az = 0; }
        const m1 = Math.hypot(ax, ay, az) || 1;
        ax /= m1; ay /= m1; az /= m1;
        const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
        for (let i = 0; i < 8; i++) {
            const e = i < 4;
            const [sa, sb] = CORNERS[i & 3];
            const nx = sa * ax + sb * bx, ny = sa * ay + sb * by, nz = sa * az + sb * bz;
            positions[p] = (e ? g.x0 : g.x1) + half * nx;
            positions[p + 1] = (e ? g.y0 : g.y1) + half * ny;
            positions[p + 2] = (e ? g.z0 : g.z1) + half * nz;
            const nm = Math.hypot(nx, ny, nz) || 1;
            normals[p] = nx / nm; normals[p + 1] = ny / nm; normals[p + 2] = nz / nm;
            p += 3;
            colors[c++] = g.r; colors[c++] = g.g; colors[c++] = g.b; colors[c++] = 1;
        }
        const base = s * 8;
        for (let f = 0; f < FACES.length; f++) indices[ii++] = base + FACES[f];
    }
    return { positions, normals, colors, indices };
}

/**
 * One scene mesh holding the wire. update(segs, cellSize, offset) rebuilds
 * it (or removes it when there are no segments); dispose() removes it.
 */
export function wireMesh(scene) {
    let node = null;
    const drop = () => { if (node) { node.destroy(); node = null; } };
    return {
        get node() { return node; },
        update(segs, cellSize, offset) {
            const geom = buildWireGeometry(segs, cellSize * 0.06);
            if (!geom) { drop(); return; }
            if (node) { node.updateMesh(geom); return; }
            node = scene.createMesh({
                positions: geom.positions, normals: geom.normals,
                colors: geom.colors, indices: geom.indices,
                color: [1, 1, 1], emissive: 0.85, emissiveColor: [1.0, 0.95, 0.8],
                roughness: 0.5, castsShadow: false, twoSided: true,
                x: offset, y: offset, z: offset,
            });
        },
        dispose: drop,
    };
}
