// lib/city/building_render.js — every mass of a city as two instanced draws
// (walls box, roof prism) through building.bk. The mass records are the
// instance data; nothing per building lives on the CPU side of a frame.

import { MASS_FLOATS } from "./buildings.js";

function boxMesh() {
    // Unit box, 4 vertices a face so normals are flat.
    const P = [], N = [], I = [];
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
        [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, a, b] of faces) {
        const base = P.length / 3;
        for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            P.push(0.5 * (n[0] + sa * a[0] + sb * b[0]), 0.5 * (n[1] + sa * a[1] + sb * b[1]), 0.5 * (n[2] + sa * a[2] + sb * b[2]));
            N.push(...n);
        }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { P, N, I };
}

function roofMesh() {
    // Prism: base rectangle x,z in [-0.5,0.5] at y 0, ridge along x at y 1, z 0.
    // Normals only carry which face it is; the vertex stage computes real ones.
    const P = [], N = [], I = [];
    const quad = (v, n) => { const b = P.length / 3; for (const p of v) { P.push(...p); N.push(...n); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const tri = (v, n) => { const b = P.length / 3; for (const p of v) { P.push(...p); N.push(...n); } I.push(b, b + 1, b + 2); };
    quad([[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0]], [0, 0.7, 0.7]);
    quad([[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0]], [0, 0.7, -0.7]);
    // Ends: quads so a hip can pull the ridge in (the two top vertices coincide for a gable).
    quad([[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [0.5, 1, 0]], [1, 0, 0]);
    quad([[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [-0.5, 1, 0]], [-1, 0, 0]);
    return { P, N, I };
}

export async function createBuildingRenderer(scene, masses, src) {
    const { Mesh } = bro.mesh;
    const mk = ({ P, N, I }) => new Mesh({ positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I) });
    const count = masses.count;
    const buf = bro.kernel.createBuffer(masses.data.byteLength);
    buf.write(masses.data);
    const nodes = [];
    for (const part of [0, 1]) {
        const node = scene.createInstancedMesh({
            name: part ? 'city_roofs' : 'city_walls',
            mesh: mk(part ? roofMesh() : boxMesh()),
            capacity: count,
            instances: new Float32Array(0),
            color: [1, 1, 1],
            castsShadow: true,
            receivesShadow: true,
        });
        node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
        await node.setShaderAsync({ module: src, file: 'lib/city/building.bk', uniforms: { night: 0, room_day: 60, room_night: 10, part } });
        node.setShaderBuffer('masses', buf);
        node.setInstanceCount(count);
        nodes.push(node);
    }
    return {
        nodes,
        setNight(n, dayK = 60, nightK = 10) { for (const nd of nodes) { nd.setShaderUniform('night', n); nd.setShaderUniform('room_day', dayK); nd.setShaderUniform('room_night', nightK); } },
    };
}
