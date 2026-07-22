// impostor.js — bake a grown plant/tree master mesh into an octahedral impostor atlas.
// Works hand-in-hand with bro.impostor.createLayer(...) for fast merged billboard rendering.

const DECID_LEAF_COLOR = [0.18, 0.35, 0.14];
const WOOD_COLOR = [0.26, 0.18, 0.12];

function hemiOctToDir(coordX, coordY) {
    const a = (coordX + coordY) * 0.5;
    const b = (coordX - coordY) * 0.5;
    const y = 1 - (Math.abs(a) + Math.abs(b));
    const inv = 1 / Math.hypot(a, y, b);
    return [a * inv, y * inv, b * inv];
}

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
                    data[d] = r / n; data[d + 1] = g / n; data[d + 2] = b / n;
                    filled.push(idx);
                }
            }
        }
        for (const idx of filled) opaque[idx] = 1;
    }
}

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
    const dx = maxX - center[0], dy = maxY - center[1], dz = maxZ - center[2];
    const radius = Math.hypot(dx, dy, dz);
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, radius };
}

/**
 * Bake a tree/plant master into an octahedral impostor atlas.
 *
 * @param {SceneGraph} scene dedicated capture scene
 * @param {{branchMesh:Mesh, leafMesh:Mesh}} master
 * @param {Object} [opts] { cols=8, rows=8, cell=256, leafColor, woodColor, margin=1.03 }
 * @returns {Object} atlas result with atlasRGBA, width, height, cols, rows, bounds
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
    const size = 2 * radius * margin;
    const distance = radius * 3;
    const near = Math.max(0.001, radius * 0.1);
    const far = radius * 6 + distance;

    scene.setEnvironment(null);
    scene.setAmbient([0.0, 0.0, 0.0]);
    scene.setToneMap({ mode: 'linear', exposure: 1.0, gamma: 1.0 });
    if (scene.setFog) scene.setFog(null);

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

    scene.setCamera({
        mode: 'orthographic', size, aspect: 1.0, near, far,
        position: [center[0], center[1] + distance, center[2] + 1e-3],
        target: center, up: [0, 0, -1],
    });
    scene.captureFrame(cell, cell);

    const atlasRGBA = new Uint8ClampedArray(width * height * 4);
    const coverage = new Array(cols * rows).fill(0);

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
            let up = [0, 1, 0];
            if (Math.abs(dir[1]) > 0.999) up = [0, 0, dir[1] > 0 ? -1 : 1];

            scene.setCamera({
                mode: 'orthographic',
                size,
                aspect: 1.0,
                near, far,
                position: pos,
                target: center,
            });

            const img = scene.captureFrame(cell, cell);
            const cellIdx = row * cols + col;
            if (!img || !img.data) { coverage[cellIdx] = 0; continue; }
            const data = img.data;

            dilateEdgesRGBA(data, cell, cell, 4);

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
