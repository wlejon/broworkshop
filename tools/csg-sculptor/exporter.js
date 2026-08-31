// exporter.js — Mesh export handler for OBJ, STL, and GLTF 3D file formats.

/**
 * Downloads text or binary data as a local file in browser/desktop environment
 */
export function downloadFile(filename, content, mimeType = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Exports mesh to Wavefront OBJ format
 */
export function exportMeshToOBJ(mesh, name = 'csg_sculpture') {
    if (!mesh) {
        throw new Error('No active mesh to export');
    }

    let objText = '';
    if (typeof mesh.toOBJ === 'function') {
        objText = mesh.toOBJ();
    } else {
        // Fallback OBJ generator from positions and indices
        const pos = mesh.positions;
        const idx = mesh.indices;
        const norm = mesh.normals;

        const lines = [`# Wavefront OBJ exported by CSG Sculptor`, `o ${name}`];

        if (pos) {
            for (let i = 0; i < pos.length; i += 3) {
                lines.push(`v ${pos[i].toFixed(5)} ${pos[i + 1].toFixed(5)} ${pos[i + 2].toFixed(5)}`);
            }
        }
        if (norm) {
            for (let i = 0; i < norm.length; i += 3) {
                lines.push(`vn ${norm[i].toFixed(5)} ${norm[i + 1].toFixed(5)} ${norm[i + 2].toFixed(5)}`);
            }
        }
        if (idx) {
            for (let i = 0; i < idx.length; i += 3) {
                const i1 = idx[i] + 1;
                const i2 = idx[i + 1] + 1;
                const i3 = idx[i + 2] + 1;
                lines.push(`f ${i1} ${i2} ${i3}`);
            }
        }
        objText = lines.join('\n');
    }

    const filename = `${name}_${new Date().toISOString().slice(0, 10)}.obj`;
    downloadFile(filename, objText, 'text/plain');
    return filename;
}

/**
 * Exports mesh to ASCII STL format
 */
export function exportMeshToSTL(mesh, name = 'csg_sculpture') {
    if (!mesh) throw new Error('No active mesh to export');
    let stlData = '';
    if (typeof mesh.toSTL === 'function') {
        stlData = mesh.toSTL();
    } else if (typeof mesh.toSTLB === 'function') {
        stlData = mesh.toSTLB();
    }
    const filename = `${name}_${new Date().toISOString().slice(0, 10)}.stl`;
    downloadFile(filename, stlData, 'application/sla');
    return filename;
}
