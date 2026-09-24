// export.js — the UV layout inset and mesh export.

const UV_COLORS = ['#74b9ff', '#7bed9f', '#ffa502', '#ff7675', '#a29bfe', '#fdcb6e'];

/** Draw every item's UV triangles into a 2D canvas. Returns how many meshes had UVs. */
export function drawUVs(canvas, items) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    let drawn = 0;
    (items || []).forEach((it, mi) => {
        const m = it.work;
        if (!m.hasUVs) return;
        const uv = m.uvs, idx = m.indices;
        ctx.strokeStyle = UV_COLORS[mi % UV_COLORS.length];
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        for (let t = 0; t < idx.length; t += 3) {
            const p = (k) => [uv[idx[t + k] * 2] * W, (1 - uv[idx[t + k] * 2 + 1]) * H];
            const [a, b, c] = [p(0), p(1), p(2)];
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(a[0], a[1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawn++;
    });
    if (!drawn) {
        ctx.fillStyle = '#666';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(items ? 'no UVs' : '', W / 2, H / 2);
    }
    return drawn;
}

export const EXPORT_FORMATS = ['glb', 'obj', 'ply', 'stl'];

/**
 * Save the loaded document to `path` as `format`. A skinned single-mesh file
 * with unmodified geometry keeps its skin, skeleton and clips (saved from the
 * bind-pose mesh, not the animated one); anything else saves every working
 * mesh merged into one. Returns true on success.
 */
export function exportDoc(doc, format, path, opts) {
    const o = opts || {};
    if (format === 'glb' || format === 'gltf') {
        if (o.skinned && doc.items.length === 1 && doc.hasSkin && doc.hasSkel) {
            return !!doc.items[0].bind.saveGLTF(path, { skin: doc.skin, skeleton: doc.skeleton, animations: doc.animations });
        }
        return !!merged(doc).saveGLTF(path);
    }
    const m = merged(doc);
    if (format === 'obj') return !!m.saveOBJ(path);
    if (format === 'ply') return !!m.savePLY(path);
    if (format === 'stl') return !!m.saveSTL(path);
    throw new Error('unknown format: ' + format);
}

function merged(doc) {
    const meshes = doc.items.map((it) => it.work);
    return meshes.length === 1 ? meshes[0] : Mesh.merge(meshes);
}
