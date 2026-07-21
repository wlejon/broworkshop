// impostor.js — bake a grown tree "master" mesh into an octahedral impostor atlas.
//
import { growPrototype } from '/app/lib/flora.js';
//
// CHUNK 1 of the foliage-LOD system. A tree master ({ branchMesh, leafMesh }) is
// rendered from a grid of view directions with an ORTHOGRAPHIC camera (constant
// screen size across angles) into one RGBA atlas texture. Background pixels come
// back transparent (RGBA 0,0,0,0) from scene.captureFrame — that alpha IS the
// impostor cutout. A later chunk's billboard shader inverts the mapping below to
// pick the cell that best matches the tree->camera direction.
//
// ===========================================================================
// OCTAHEDRAL MAPPING  (cell (col,row) <-> unit view direction, +Y world up)
// ===========================================================================
// Upper-hemisphere (hemi-octahedron) parametrization — all 64 cells are spent on
// the top half of the sphere (trees sit on the ground; the underside is a later
// LOD layer, not this atlas). It is the standard hemi-oct used by Brucks-style
// octahedral impostors, and is exactly invertible.
//
//   Grid -> square coord, cell CENTERS (col,row in [0..N-1]):
//     u = (col + 0.5) / cols;   coordX = u * 2 - 1     // in (-1, 1)
//     v = (row + 0.5) / rows;   coordY = v * 2 - 1
//
//   Square coord -> direction (dir points FROM the tree center TOWARD the camera):
//     // rotate the square 45 deg into octahedron space
//     a = (coordX + coordY) * 0.5
//     b = (coordX - coordY) * 0.5
//     dir = normalize( vec3( a, 1 - (|a| + |b|), b ) )      // +Y up
//
//   Inverse (direction -> square coord), for the CHUNK 2 shader:
//     d = dir / (|dir.x| + |dir.y| + |dir.z|)              // project to octahedron
//     coordX = d.x + d.z
//     coordY = d.x - d.z
//     u = coordX * 0.5 + 0.5;  col = floor(u * cols)
//     v = coordY * 0.5 + 0.5;  row = floor(v * rows)
//
//   Landmarks:  straight up (0,1,0) -> coord (0,0) (grid center);
//               the four horizontal cardinals map to the four square corners;
//               the square edges are the horizon (side-on views).
//
// The camera is placed at  center + dir * distance  looking at center, world +Y
// up (a tiny epsilon guard swaps up for the degenerate near-vertical case, which
// the chosen cell centers never actually hit). So +Y stays "up" in every cell —
// the billboard is always upright.
// ===========================================================================

// Deciduous master species params — mirrors flora.js initFlora()'s `decid`.
const DECID_SPECIES = {
    shadeTolerance: 0.35, moduleMatureAge: 0.6,
    tropismG2: 0.12, growthScale: 1.0,
    orthotropy: 0.4, rootVigorMax: 3.0,
    apicalControl: 0.35, apicalControlMature: 0.3,
    individualVariation: 0.15, maxAge: 60,
};

// Materials mirror flora.js populateFlora()'s createInst (wood + leaf cards).
const WOOD_COLOR = [0.26, 0.18, 0.12];
const DECID_LEAF_COLOR = [0.18, 0.35, 0.14];

// hemi-octahedron: square coord in [-1,1]^2 -> unit direction (+Y up).
function hemiOctToDir(coordX, coordY) {
    const a = (coordX + coordY) * 0.5;
    const b = (coordX - coordY) * 0.5;
    const y = 1 - (Math.abs(a) + Math.abs(b));
    const inv = 1 / Math.hypot(a, y, b);
    return [a * inv, y * inv, b * inv];
}

// The grown leaf/branch meshes carry a DATA payload in their vertex colors
// (scatterLeaves packs per-leaf params into the R channel; G/B are 0), not an
// albedo — so createMesh(color:...) renders them red. For a clean albedo
// impostor, return a clone whose vertex colors are all `rgb`. Paired with a
// white material `color`, the rendered albedo is exactly `rgb` whether the
// shader multiplies or replaces the base color with the vertex color.
function meshWithFlatColor(mesh, rgb) {
    if (!mesh || !mesh.vertexCount) return mesh;
    const out = mesh.clone();
    const n = out.vertexCount;
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        cols[i * 4] = rgb[0]; cols[i * 4 + 1] = rgb[1]; cols[i * 4 + 2] = rgb[2]; cols[i * 4 + 3] = 1;
    }
    out.colors = cols;
    return out;
}

// Edge-bleed (dilate) opaque RGB outward into transparent (alpha==0) texels of
// ONE cell buffer, in place. The atlas texture samples with mipmaps + bilinear
// (GL_LINEAR_MIPMAP_LINEAR), which pulls the transparent-black background
// (RGBA 0,0,0,0) into cutout-edge texels and paints a dark fringe. Bleeding the
// silhouette colour a few px into the border means interpolation never samples
// pure black, so the cutout edge stays clean green. Alpha is LEFT at 0 on
// filled texels, so the shader's alpha cutout still trims at the true
// silhouette (filled texels only contribute colour to the bilinear blend).
// Operates on a single cell buffer so it can never bleed across cell borders.
function dilateEdgesRGBA(data, w, h, passes) {
    const opaque = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) opaque[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    const nbr = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (let p = 0; p < passes; p++) {
        const filled = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (opaque[idx]) continue;
                let r = 0, g = 0, b = 0, n = 0;
                for (const [dx, dy] of nbr) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const ni = ny * w + nx;
                    if (!opaque[ni]) continue;
                    const s = ni * 4;
                    r += data[s]; g += data[s + 1]; b += data[s + 2]; n++;
                }
                if (n > 0) {
                    const d = idx * 4;
                    data[d] = r / n; data[d + 1] = g / n; data[d + 2] = b / n; // alpha stays 0
                    filled.push(idx);
                }
            }
        }
        for (const idx of filled) opaque[idx] = 1;   // grow the source set
    }
}

// Combined axis-aligned bounds over one or more meshes' positions.
function combinedBounds(meshes) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
        if (!m || !m.vertexCount) continue;
        const p = m.positions;
        for (let i = 0; i < p.length; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
    }
    const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    // Bounding-sphere radius from the center -> guarantees the tree fits the
    // ortho frame at EVERY rotation (constant screen size, no clipping).
    const dx = maxX - center[0], dy = maxY - center[1], dz = maxZ - center[2];
    const radius = Math.hypot(dx, dy, dz);
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, radius };
}

/**
 * Bake a tree master into an octahedral impostor atlas using the given (ideally
 * hidden, off-document) capture scene.
 *
 * @param {SceneGraph} scene   a dedicated capture scene (canvas.getContext('scene'))
 * @param {{branchMesh:Mesh, leafMesh:Mesh}} master
 * @param {Object} [opts]  { cols=8, rows=8, cell=256, leafColor, woodColor, margin=1.03 }
 * @returns {{ atlasRGBA:Uint8ClampedArray, width:number, height:number,
 *             cols:number, rows:number, cellSize:number,
 *             tintRGB:[number,number,number], coverage:number[] }}
 */
export function bakeImpostorAtlas(scene, master, opts) {
    opts = opts || {};
    const cols = opts.cols || 8;
    const rows = opts.rows || 8;
    const cell = opts.cell || 256;
    const margin = opts.margin != null ? opts.margin : 1.03;
    const leafColor = opts.leafColor || DECID_LEAF_COLOR;
    const woodColor = opts.woodColor || WOOD_COLOR;

    const width = cols * cell;
    const height = rows * cell;

    const bnd = combinedBounds([master.branchMesh, master.leafMesh]);
    const center = bnd.center;
    const radius = Math.max(bnd.radius, 1e-3);
    const size = 2 * radius * margin;       // ortho view height = bounding diameter
    const distance = radius * 3;            // ortho: distance is arbitrary but safe
    const near = Math.max(0.001, radius * 0.1);
    const far = radius * 6 + distance;

    // UNLIT bake: capture ~linear albedo, no scene lighting/tonemap baked in.
    // The billboard feeds the atlas back as `emissive`, where the LIVE scene's
    // ACES tonemap runs once. If we baked LIT (ACES here) AND emitted it, the
    // tree got tonemapped twice -> washed-out/pale. Unlit meshes output
    // baseColor x texture x vertex color directly (bypassing this scene's
    // tonemap), so the atlas holds the raw albedo and the round-trip is a
    // single tonemap. No env/fog; ambient + lights are irrelevant to unlit
    // draws but left neutral for the transparent background clear.
    scene.setEnvironment(null);
    scene.setAmbient([0.0, 0.0, 0.0]);
    scene.setToneMap({ mode: 'linear', exposure: 1.0, gamma: 1.0 });
    if (scene.setFog) scene.setFog(null);

    // Wood branches. Bake albedo into vertex colors (see meshWithFlatColor).
    if (master.branchMesh && master.branchMesh.triangleCount > 0) {
        scene.createMesh({
            mesh: meshWithFlatColor(master.branchMesh, woodColor),
            color: [1, 1, 1],
            metallic: 0.0,
            roughness: 0.9,
            unlit: true,
            castsShadow: false,
            receivesShadow: false,
        });
    }
    // Leaf cards — doubleSided so both faces show; albedo baked into vertices.
    if (master.leafMesh && master.leafMesh.triangleCount > 0) {
        scene.createMesh({
            mesh: meshWithFlatColor(master.leafMesh, leafColor),
            color: [1, 1, 1],
            metallic: 0.0,
            roughness: 0.85,
            doubleSided: true,
            unlit: true,
            castsShadow: false,
            receivesShadow: false,
        });
    }

    // Warm-up render: the tonemap FBO is allocated lazily on the first 3D pass,
    // so the very first captureFrame comes back pre-tonemap (blown-out white).
    // Throw one away with the real camera framing so cell (0,0) is correct.
    scene.setCamera({
        mode: 'orthographic', size, aspect: 1.0, near, far,
        position: [center[0], center[1] + distance, center[2] + 1e-3],
        target: center, up: [0, 0, -1],
    });
    scene.captureFrame(cell, cell);

    const atlasRGBA = new Uint8ClampedArray(width * height * 4);
    const coverage = new Array(cols * rows).fill(0);

    // Direction (and pixels) of the most top-down cell, for the canopy tint.
    let bestTopIdx = -1, bestTopY = -Infinity;

    const tintAccum = [0, 0, 0];
    let tintCount = 0;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const coordX = ((col + 0.5) / cols) * 2 - 1;
            const coordY = ((row + 0.5) / rows) * 2 - 1;
            const dir = hemiOctToDir(coordX, coordY);

            const pos = [
                center[0] + dir[0] * distance,
                center[1] + dir[1] * distance,
                center[2] + dir[2] * distance,
            ];
            // World +Y up; guard the degenerate near-vertical view.
            let up = [0, 1, 0];
            if (Math.abs(dir[1]) > 0.999) up = [0, 0, dir[1] > 0 ? -1 : 1];

            scene.setCamera({
                mode: 'orthographic',
                size,
                aspect: 1.0,
                near, far,
                position: pos,
                target: center,
                up,
            });

            const img = scene.captureFrame(cell, cell);
            const cellIdx = row * cols + col;
            if (!img || !img.data) { coverage[cellIdx] = 0; continue; }
            const data = img.data;

            // Bleed silhouette colour into the transparent border of THIS cell
            // so bilinear/mip sampling can't pull black into cutout edges.
            dilateEdgesRGBA(data, cell, cell, 4);

            // Blit cell into the atlas (both are top-down row order).
            let nonEmpty = 0;
            let cellR = 0, cellG = 0, cellB = 0, cellN = 0;
            for (let y = 0; y < cell; y++) {
                const srcRow = y * cell * 4;
                const dstRow = ((row * cell + y) * width + col * cell) * 4;
                for (let x = 0; x < cell; x++) {
                    const s = srcRow + x * 4;
                    const d = dstRow + x * 4;
                    const r = data[s], g = data[s + 1], b = data[s + 2], al = data[s + 3];
                    atlasRGBA[d] = r; atlasRGBA[d + 1] = g; atlasRGBA[d + 2] = b; atlasRGBA[d + 3] = al;
                    if (al > 0) { nonEmpty++; cellR += r; cellG += g; cellB += b; cellN++; }
                }
            }
            coverage[cellIdx] = nonEmpty / (cell * cell);

            // Track the most top-down cell for the tint.
            if (dir[1] > bestTopY) {
                bestTopY = dir[1];
                bestTopIdx = cellIdx;
                tintAccum[0] = cellR; tintAccum[1] = cellG; tintAccum[2] = cellB;
                tintCount = cellN;
            }
        }
    }

    const tintRGB = tintCount > 0
        ? [Math.round(tintAccum[0] / tintCount), Math.round(tintAccum[1] / tintCount), Math.round(tintAccum[2] / tintCount)]
        : [0, 0, 0];

    return {
        atlasRGBA, width, height, cols, rows, cellSize: cell,
        tintRGB, coverage, topCell: bestTopIdx,
        bounds: bnd,
    };
}

/**
 * Grow the `decid` (deciduous) master and bake its octahedral impostor atlas in
 * a dedicated hidden capture scene. Runs fully headless without the worldgen
 * diffusion model.
 *
 * @param {Object} [opts]  passed through to bakeImpostorAtlas
 * @returns {Object} the bakeImpostorAtlas result, plus `.master`
 */
export function bakeDecidImpostor(opts) {
    opts = opts || {};
    // Grow the deciduous master (mirrors flora.js initFlora's `decid`).
    const master = growPrototype('decid', 4, 0.7, DECID_SPECIES);

    const cvs = document.createElement('canvas');
    cvs.width = opts.cell || 256;
    cvs.height = cvs.width;
    const capScene = cvs.getContext('scene');

    const result = bakeImpostorAtlas(capScene, master, opts);
    result.master = master;
    return result;
}
