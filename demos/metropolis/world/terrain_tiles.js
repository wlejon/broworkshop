// 150.99 km^2 streamed city terrain via bro.tiles plane domain and ring-buffered tile-binned parcels.

const fs = require('fs');

const TILE = 32;
const BORDER = 2;
const CELLS = TILE + 2 * BORDER; // 36
const CAPACITY = 2048;
const MAX_LEVEL = 10;
const PRODUCE_PER_UPDATE = 24;
const RING_SIZE = 8;
const MAX_PARCELS_PER_BATCH = 8192;
const MIN_HEIGHT = -6.0;
const MAX_HEIGHT = 64.0;
const BLOCK_SIZE = 128;

function readApp(relPath) {
    return fs.readFileSync(bro.resolvePath('/app/' + relPath), 'utf-8');
}

// Outward-CCW skirted (TILE+1)^2 patch mesh (doubleSided: false).
function patchMesh() {
    const N = TILE + 1;
    const pos = [];
    const idx = [];
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            pos.push(i, 0, j);
        }
    }
    for (let j = 0; j < TILE; j++) {
        for (let i = 0; i < TILE; i++) {
            const a = j * N + i;
            const b = a + 1;
            const c = a + N;
            const d = c + 1;
            idx.push(a, c, d, a, d, b);
        }
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
            const t0 = e[k][1] * N + e[k][0];
            const t1 = e[k + 1][1] * N + e[k + 1][0];
            idx.push(t0, t1, base + k, t1, base + k + 1, base + k);
        }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    return new Mesh({
        positions: new Float32Array(pos),
        normals,
        indices: new Uint32Array(idx),
    });
}

export function createTerrainTiles(scene, layout) {
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

    const spanRing = [];
    const parcelRing = [];
    for (let r = 0; r < RING_SIZE; r++) {
        spanRing.push(bro.kernel.createBuffer(PRODUCE_PER_UPDATE * 4 * 4));
        parcelRing.push(bro.kernel.createBuffer(MAX_PARCELS_PER_BATCH * 2 * 16));
    }
    const tileSpansScratch = new Int32Array(PRODUCE_PER_UPDATE * 4);
    const parcelFloatsScratch = new Float32Array(MAX_PARCELS_PER_BATCH * 8);
    let ringIdx = 0;

    const warpPad = layout.MAX_WARP || 42.0;

    const cache = bro.tiles.createCache({
        domain: { type: 'plane', origin: [-6144, -6144], size: 4096, roots: [3, 3] },
        tileSize: TILE,
        border: BORDER,
        capacity: CAPACITY,
        maxLevel: MAX_LEVEL,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        pixelsPerCell: 8.5,
        producePerUpdate: PRODUCE_PER_UPDATE,
        layers: { position: 16, surface: 4 },
        ranges: true,
        produce(batch) {
            settleUpdates = 8;
            ringIdx = (ringIdx + 1) % RING_SIZE;
            const spanBuf = spanRing[ringIdx];
            const parcelBuf = parcelRing[ringIdx];

            tileSpansScratch.fill(0);
            let totalParcels = 0;

            for (let ti = 0; ti < batch.count; ti++) {
                const tile = batch.tiles[ti];
                const start = totalParcels;
                let count = 0;
                if (tile.level >= 3) {
                    const pad = BORDER * (tile.extent / TILE) + 6.0;
                    const minX = tile.origin[0] - pad;
                    const maxX = tile.origin[0] + tile.extent + pad;
                    const minZ = tile.origin[2] - pad;
                    const maxZ = tile.origin[2] + tile.extent + pad;
                    const bx0 = Math.floor((minX - warpPad) / BLOCK_SIZE);
                    const bx1 = Math.floor((maxX + warpPad) / BLOCK_SIZE);
                    const bz0 = Math.floor((minZ - warpPad) / BLOCK_SIZE);
                    const bz1 = Math.floor((maxZ + warpPad) / BLOCK_SIZE);

                    for (let bz = bz0; bz <= bz1 && totalParcels < MAX_PARCELS_PER_BATCH; bz++) {
                        for (let bx = bx0; bx <= bx1 && totalParcels < MAX_PARCELS_PER_BATCH; bx++) {
                            const parcels = layout.getParcelsInBlock(bx, bz);
                            for (let pi = 0; pi < parcels.length && totalParcels < MAX_PARCELS_PER_BATCH; pi++) {
                                const p = parcels[pi];
                                if (p.padSkirt <= 0) continue;
                                const reach = Math.hypot(p.padHalfW, p.padHalfD) + p.padSkirt;
                                if (p.cx + reach < minX || p.cx - reach > maxX) continue;
                                if (p.cz + reach < minZ || p.cz - reach > maxZ) continue;
                                const off = totalParcels * 8;
                                parcelFloatsScratch[off + 0] = p.cx;
                                parcelFloatsScratch[off + 1] = p.cz;
                                parcelFloatsScratch[off + 2] = p.padHalfW;
                                parcelFloatsScratch[off + 3] = p.padHalfD;
                                parcelFloatsScratch[off + 4] = p.padY;
                                parcelFloatsScratch[off + 5] = p.padSkirt;
                                const pr = p.padRot || 0;
                                parcelFloatsScratch[off + 6] = Math.cos(pr);
                                parcelFloatsScratch[off + 7] = Math.sin(pr);
                                totalParcels++;
                                count++;
                            }
                        }
                    }
                }
                tileSpansScratch[ti * 4 + 0] = start;
                tileSpansScratch[ti * 4 + 1] = count;
            }

            spanBuf.write(tileSpansScratch.subarray(0, batch.count * 4));
            if (totalParcels > 0) {
                parcelBuf.write(parcelFloatsScratch.subarray(0, totalParcels * 8));
            }

            kTile.dispatch(
                [CELLS, CELLS, batch.count],
                batch.table,
                this.layer('position'),
                this.layer('surface'),
                heightSpanBuf,
                spanBuf,
                parcelBuf,
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
    ground.drawOrder = 6;

    let shaderReady = false;
    const shaderPromise = ground.setShaderAsync({
        module: groundSrc,
        file: 'shaders/ground_mesh.bk',
        uniforms: {
            cam_hi: [0, 0, 0],
            time: 0,
            cam_lo: [0, 0, 0],
            pad0: 0,
        },
    }).then(() => {
        shaderReady = true;
        ground.setShaderTexture('pos', {
            buffer: cache.layer('position'),
            width: CELLS,
            height: CELLS,
            layers: CAPACITY,
            atlas: 2,
            channels: 4,
            format: 'float32',
        });
        ground.setShaderTexture('surf', {
            buffer: cache.layer('surface'),
            width: CELLS,
            height: CELLS,
            layers: CAPACITY,
            atlas: 2,
            channels: 4,
            format: 'unorm8',
        });
        ground.setShaderBuffer('tiles', cache.drawList);
    });

    const lastEye = [NaN, 0, 0];
    const lastFwd = [0, 0, -1];
    const camHi = [0, 0, 0];
    const camLo = [0, 0, 0];
    let lastPending = -1;
    let settleUpdates = 0;
    let disposed = false;

    let lastUniformX = NaN;
    let lastUniformY = NaN;
    let lastUniformZ = NaN;

    function update(camPos, fwd, up, viewport = { width: 1600, height: 960, fov: 60 }, timeSec = 0) {
        if (disposed) return;
        const dx = camPos[0] - lastEye[0];
        const dy = camPos[1] - lastEye[1];
        const dz = camPos[2] - lastEye[2];
        const alt = Math.max(1.0, Math.abs(camPos[1]));
        const thresh = Math.max(0.75, alt * 0.0025);
        const dotFwd = fwd[0] * lastFwd[0] + fwd[1] * lastFwd[1] + fwd[2] * lastFwd[2];
        const needUpdate = Number.isNaN(lastEye[0])
            || cache.pending > 0
            || settleUpdates > 0
            || (dx * dx + dy * dy + dz * dz) > thresh * thresh
            || dotFwd < 0.99995;

        if (needUpdate) {
            if (cache.pending === 0 && settleUpdates > 0) settleUpdates--;
            cache.update({
                position: camPos,
                forward: fwd,
                up,
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

        const n = cache.drawCount;
        if (ground.instanceCount !== n) ground.setInstanceCount(n);

        if (shaderReady && (camPos[0] !== lastUniformX || camPos[1] !== lastUniformY || camPos[2] !== lastUniformZ)) {
            lastUniformX = camPos[0];
            lastUniformY = camPos[1];
            lastUniformZ = camPos[2];
            for (let k = 0; k < 3; k++) {
                camHi[k] = Math.fround(camPos[k]);
                camLo[k] = camPos[k] - camHi[k];
            }
            ground.setShaderUniform('cam_hi', camHi);
            ground.setShaderUniform('cam_lo', camLo);
        }
    }

    function forceUpdate(camPos, fwd, up, viewport = { width: 1600, height: 960, fov: 60 }) {
        lastEye[0] = NaN;
        update(camPos, fwd, up, viewport, 0);
    }

    function getStats() {
        const s = cache.stats;
        return {
            drawCount: cache.drawCount,
            wanted: cache.wanted,
            resident: cache.resident,
            pending: cache.pending,
            produced: s.produced,
            evicted: s.evicted,
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        try { scene.destroyNode(ground); } catch (_) {}
        try { cache.destroy(); } catch (_) {}
        try { heightSpanBuf.destroy?.(); } catch (_) {}
        for (const b of spanRing) { try { b.destroy?.(); } catch (_) {} }
        for (const b of parcelRing) { try { b.destroy?.(); } catch (_) {} }
    }

    return {
        cache,
        node: ground,
        whenReady: () => shaderPromise,
        update,
        forceUpdate,
        getStats,
        dispose,
    };
}
