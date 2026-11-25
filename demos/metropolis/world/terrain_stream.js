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

export function createTerrainStream(scene, city) {
    // The city's ground data (lib/city/ground.js), shared by the produce kernel and the ground shader.
    const kbuf = (a) => { const b = bro.kernel.createBuffer(Math.max(16, a.byteLength)); if (a.byteLength) b.write(a); return b; };
    const segBuf = kbuf(city.segs), startBuf = kbuf(city.cellStart), cellBuf = kbuf(city.cellSegs), surfBuf = kbuf(city.surf);
    const paintStartBuf = kbuf(city.paintStart), paintBuf = kbuf(city.paintSegs);
    const gi = city.info;
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
        pixelsPerCell: 6.0,
        producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, surface: 4 },
        ranges: true,
        produce(batch) {
            // Selects go on past the last production for a late tile's ramp
            // in from its parent (24 selects, bro's tile cache): a still eye
            // would otherwise leave it part way, its parent's shape showing.
            settleUpdates = 26;
            kTile.dispatch(
                [CELLS, CELLS, batch.count],
                batch.table,
                this.layer('position'),
                this.layer('surface'),
                heightSpanBuf,
                BORDER,
                1 / TILE,
                MIN_HEIGHT,
                segBuf, startBuf, cellBuf,
                gi.half, gi.cell, gi.cells, gi.reach,
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
        uniforms: { time: 0, night: 0, pad1: 0, pad2: 0, city: [gi.half, gi.paintCell, gi.paintCells, gi.surfCell], city2: [gi.surfCells, 0, 0, 0] },
    }).then(() => {
        shaderReady = true;
        ground.setShaderTexture('pos', {
            buffer: cache.layer('position'),
            width: CELLS, height: CELLS, layers: CAPACITY, atlas: 2, channels: 4, format: 'float32',
        });
        ground.setShaderBuffer('tiles', cache.drawList);
        ground.setShaderBuffer('segs', segBuf);
        ground.setShaderBuffer('cell_start', paintStartBuf);
        ground.setShaderBuffer('cell_segs', paintBuf);
        ground.setShaderBuffer('surf', surfBuf);
    });

    const lastEye = [NaN, 0, 0], lastFwd = [0, 0, -1];
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
    }

    return {
        cache,
        node: ground,
        setNight(n) { if (shaderReady) ground.setShaderUniform('night', n); },
        whenReady: () => shaderPromise,
        update,
        /** The ground's heights into `out` (a KernelBuffer of dim * dim floats): `dim` a side, `cell` metres
         *  apart, about `origin`'s x and z, each less its y. The heights the tiles draw. */
        heights(out, { origin, dim, cell }) {
            kernelMod.kernel('k_heights').dispatch([dim, dim], out, dim, cell, origin[0], origin[1], origin[2],
                segBuf, startBuf, cellBuf, gi.half, gi.cell, gi.cells, gi.reach);
        },
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
