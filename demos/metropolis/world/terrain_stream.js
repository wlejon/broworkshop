// Streams 126.9 km^2 of natural terrain tiles using bro.tiles plane domain.

import { WORLD_HALF, ROOT_SIZE } from "/app/world/terrain_field.js";

const fs = require('fs');

const TILE = 32;
const BORDER = 2;
const CELLS = TILE + 2 * BORDER; // 36
const CAPACITY = 1024;
const MAX_LEVEL = 9;
const PRODUCE_PER_UPDATE = 20;
const MIN_HEIGHT = -10.0;
const MAX_HEIGHT = 155.0;

function readApp(relPath) {
    return fs.readFileSync(bro.resolvePath('/app/' + relPath), 'utf-8');
}

function patchMesh() {
    const N = TILE + 1;
    const pos = [], idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.push(i, 0, j);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, d, a, d, b);
    }
    const edges = [[], [], [], []];
    for (let k = 0; k < N; k++) {
        edges[0].push([k, 0]);
        edges[1].push([TILE, k]);
        edges[2].push([TILE - k, TILE]);
        edges[3].push([0, TILE - k]);
    }
    for (const e of edges) {
        const base = pos.length / 3;
        for (const [i, j] of e) pos.push(i, 1, j);
        for (let k = 0; k + 1 < e.length; k++) {
            const t0 = e[k][1] * N + e[k][0], t1 = e[k + 1][1] * N + e[k + 1][0];
            idx.push(t0, t1, base + k, t1, base + k + 1, base + k);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({ positions: new Float32Array(pos), normals, indices: new Uint32Array(idx) });
}

export function createTerrainStream(scene) {
    const produceSrc = readApp('shaders/terrain_produce.bk');
    const groundSrc = readApp('shaders/ground_mesh.bk');

    const kernelMod = bro.kernel.compile(produceSrc, {
        file: 'shaders/terrain_produce.bk',
        modules: { tiles: bro.tiles.module },
    });
    const kTile = kernelMod.kernel('k_tile');
    const kRange = kernelMod.kernel('k_range');

    const heightSpanBuf = bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 2 * 4);
    heightSpanBuf.write(new Int32Array(PRODUCE_PER_UPDATE * 2));

    let settleUpdates = 0;
    const cache = bro.tiles.createCache({
        domain: { type: 'plane', origin: [-WORLD_HALF, -WORLD_HALF], size: ROOT_SIZE, roots: [4, 4] },
        tileSize: TILE,
        border: BORDER,
        capacity: CAPACITY,
        maxLevel: MAX_LEVEL,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        pixelsPerCell: 3.0,
        producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, surface: 4 },
        ranges: true,
        produce(batch) {
            settleUpdates = 6;
            kTile.dispatch(
                [CELLS, CELLS, batch.count],
                batch.table,
                this.layer('position'),
                this.layer('surface'),
                heightSpanBuf,
                BORDER,
                1 / TILE,
                MIN_HEIGHT,
            );
            kRange.dispatch(
                [batch.count],
                batch.table,
                heightSpanBuf,
                this.ranges,
                MAX_HEIGHT,
                MIN_HEIGHT,
            );
        },
    });

    const ground = scene.createInstancedMesh({
        name: 'metropolis_ground',
        mesh: patchMesh(),
        capacity: CAPACITY,
        instances: new Float32Array(0),
        color: [1, 1, 1],
        castsShadow: false,
        receivesShadow: true,
        doubleSided: false,
    });
    ground.setCullBounds([-20000, -1000, -20000], [20000, 1000, 20000]);
    ground.drawOrder = 4;

    let shaderReady = false;
    const shaderPromise = ground.setShaderAsync({
        module: groundSrc,
        file: 'shaders/ground_mesh.bk',
        uniforms: { cam_hi: [0, 0, 0], time: 0, cam_lo: [0, 0, 0], pad0: 0 },
    }).then(() => {
        shaderReady = true;
        ground.setShaderTexture('pos', {
            buffer: cache.layer('position'),
            width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'float32',
        });
        ground.setShaderTexture('surf', {
            buffer: cache.layer('surface'),
            width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'unorm8',
        });
        ground.setShaderBuffer('tiles', cache.drawList);
    });

    const lastEye = [NaN, 0, 0], lastFwd = [0, 0, -1];
    const camHi = [0, 0, 0], camLo = [0, 0, 0];
    let lastUniformX = NaN, lastUniformY = NaN, lastUniformZ = NaN;
    let lastPending = -1, disposed = false;

    function update(camPos, fwd = [0, -0.3, -0.95], up = [0, 1, 0], viewport = { width: 1600, height: 960, fov: 60 }) {
        if (disposed) return;
        const dx = camPos[0] - lastEye[0], dy = camPos[1] - lastEye[1], dz = camPos[2] - lastEye[2];
        const thresh = Math.max(0.75, Math.abs(camPos[1]) * 0.0025);
        const dotFwd = fwd[0] * lastFwd[0] + fwd[1] * lastFwd[1] + fwd[2] * lastFwd[2];
        if (Number.isNaN(lastEye[0]) || cache.pending > 0 || settleUpdates > 0 ||
            (dx * dx + dy * dy + dz * dz) > thresh * thresh || dotFwd < 0.99995) {
            if (cache.pending === 0 && settleUpdates > 0) settleUpdates--;
            cache.update({
                position: camPos, forward: fwd, up,
                fov: viewport.fov ?? 60,
                viewportWidth: viewport.width ?? 1600,
                viewportHeight: viewport.height ?? 960,
            });
            lastEye[0] = camPos[0]; lastEye[1] = camPos[1]; lastEye[2] = camPos[2];
            lastFwd[0] = fwd[0]; lastFwd[1] = fwd[1]; lastFwd[2] = fwd[2];
        }
        if (cache.pending !== lastPending) {
            lastPending = cache.pending;
            scene.setPendingWork?.('terrain tiles', lastPending);
        }
        if (ground.instanceCount !== cache.drawCount) ground.setInstanceCount(cache.drawCount);
        if (shaderReady && (camPos[0] !== lastUniformX || camPos[1] !== lastUniformY || camPos[2] !== lastUniformZ)) {
            lastUniformX = camPos[0]; lastUniformY = camPos[1]; lastUniformZ = camPos[2];
            for (let k = 0; k < 3; k++) { camHi[k] = Math.fround(camPos[k]); camLo[k] = camPos[k] - camHi[k]; }
            ground.setShaderUniform('cam_hi', camHi);
            ground.setShaderUniform('cam_lo', camLo);
        }
    }

    return {
        cache,
        node: ground,
        whenReady: () => shaderPromise,
        update,
        stats: () => ({ drawCount: cache.drawCount, wanted: cache.wanted, resident: cache.resident, pending: cache.pending }),
        destroy() {
            if (disposed) return;
            disposed = true;
            try { ground.destroy(); } catch {}
            try { cache.destroy(); } catch {}
            try { heightSpanBuf.destroy?.(); } catch {}
        },
    };
}
