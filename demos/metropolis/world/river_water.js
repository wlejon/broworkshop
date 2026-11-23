// Curved optical river ribbon following riverCenterX(z) at WATER_Y.

import { WORLD_HALF, WATER_Y, riverCenterX, riverHalfWidth } from "/app/world/terrain_field.js";

const fs = require('fs');

export function createRiverWater(scene) {
    const segsZ = 220;
    const extraW = 22.0; // extend slightly under carved banks so shorelines never gap
    const pos = [], nrm = [], uvs = [], idx = [];
    for (let i = 0; i <= segsZ; i++) {
        const z = -WORLD_HALF + (i / segsZ) * (WORLD_HALF * 2);
        const cx = riverCenterX(z);
        const hw = riverHalfWidth(z) + extraW;
        pos.push(cx - hw, WATER_Y, z, cx + hw, WATER_Y, z);
        nrm.push(0, 1, 0, 0, 1, 0);
        uvs.push(0, i / 12, 1, i / 12);
        if (i < segsZ) {
            const b = i * 2;
            idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
    }
    const mesh = new Mesh({
        positions: new Float32Array(pos),
        normals: new Float32Array(nrm),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(idx),
    });
    const node = scene.createMesh({
        name: 'river_water',
        data: mesh,
        color: [1, 1, 1],
        castsShadow: false,
        receivesShadow: true,
    });
    const src = fs.readFileSync(bro.resolvePath('/app/shaders/river_water.bk'), 'utf-8');
    node.setShader({
        module: src,
        file: 'shaders/river_water.bk',
        uniforms: { time: [0, 0, 0, 0] },
    });
    return {
        node,
        update(timeSec) { node.setShaderUniform('time', [timeSec, 0, 0, 0]); },
        destroy() { node.destroy(); },
    };
}
