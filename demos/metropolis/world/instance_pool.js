// Pre-warmed zero-churn InstancedMeshNode pool registry for camera-relative city geometry.
// Every batch preallocates its Float32Array (row-major 3x4 affine + RGBA tint), warms with
// 1 zero-scale instance for 2 frames, compiles hull_instanced.bk asynchronously, and updates
// via buffer.subarray(0, n * 16) with zero per-frame node creation/destruction.

const fs = require('fs');

const EMPTY_MAT = new Float32Array(0);
const NO_SIZE = new Float32Array(16);

let cachedHullSource = null;
function getHullShaderSource() {
    if (!cachedHullSource) {
        cachedHullSource = fs.readFileSync(bro.resolvePath('/app/shaders/hull_instanced.bk'), 'utf-8');
    }
    return cachedHullSource;
}

function createInstanceBatch(scene, meshOrFactory, opts = {}) {
    const {
        name = 'batch',
        capacity = 2048,
        glowScale = 1.0,
        castsShadow = false,
        receivesShadow = true,
        doubleSided = false,
        drawOrder = 10,
        fadeOutDist = 0,
        cullMargin = 0,
        cullBounds = null,
        cullSpheres = null,
        color = [1, 1, 1],
        module = null,
        file = null,
        modules = null,
        knobs = null,
        uniforms = null,
        asyncShader = true,
    } = opts;

    const buffer = new Float32Array(capacity * 16);
    const prevBuffer = new Float32Array(capacity * 16);
    let prevCount = -1;
    const meshObj = typeof meshOrFactory === 'function' ? meshOrFactory() : meshOrFactory;

    const node = scene.createInstancedMesh({
        name,
        mesh: meshObj,
        capacity,
        instances: EMPTY_MAT,
        color,
        vertexColorTint: true,
        castsShadow,
        receivesShadow,
        doubleSided,
    });
    node.cullMargin = cullMargin;
    node.drawOrder = drawOrder;
    if (fadeOutDist > 0) node.fadeOutDist = fadeOutDist;
    if (cullBounds && cullBounds.length === 2) node.setCullBounds(cullBounds[0], cullBounds[1]);
    if (cullSpheres) node.setInstanceCullSpheres(cullSpheres);
    node.visible = false;

    let glow = glowScale;
    let instCount = 0;
    let warmFor = 0;
    let warmed = false;
    let disposed = false;
    let shaderReady = false;
    const pendingUniforms = new Map();
    const pendingBuffers = new Map();

    const shaderSrc = module ?? getHullShaderSource();
    const shaderFile = file ?? 'shaders/hull_instanced.bk';
    const initUniforms = uniforms ? { ...uniforms, glow_scale: glow } : { glow_scale: glow };

    let shaderReadyPromise;
    if (asyncShader && typeof node.setShaderAsync === 'function') {
        shaderReadyPromise = node.setShaderAsync({
            module: shaderSrc,
            file: shaderFile,
            modules: modules ?? undefined,
            knobs: knobs ?? undefined,
            uniforms: initUniforms,
        }).then(() => {
            shaderReady = true;
            if (!disposed) {
                try { node.setShaderUniform('glow_scale', glow); } catch (_) {}
                for (const [k, val] of pendingUniforms) {
                    try { node.setShaderUniform(k, val); } catch (_) {}
                }
                for (const [k, buf] of pendingBuffers) {
                    try { node.setShaderBuffer(k, buf); } catch (_) {}
                }
            }
            return batch;
        });
    } else {
        node.setShader({
            module: shaderSrc,
            file: shaderFile,
            modules: modules ?? undefined,
            knobs: knobs ?? undefined,
            uniforms: initUniforms,
        });
        shaderReady = true;
        shaderReadyPromise = null;
    }

    function warm() {
        if (disposed || warmed) return false;
        warmed = true;
        node.visible = true;
        node.setInstances(NO_SIZE);
        warmFor = 2;
        return true;
    }

    function begin() {
        instCount = 0;
    }

    function writeTint(o, colorOrR, g, b, a) {
        if (colorOrR == null) {
            buffer[o + 12] = 1; buffer[o + 13] = 1; buffer[o + 14] = 1; buffer[o + 15] = 1;
        } else if (typeof colorOrR === 'number') {
            buffer[o + 12] = colorOrR;
            buffer[o + 13] = g ?? 1;
            buffer[o + 14] = b ?? 1;
            buffer[o + 15] = a ?? 1;
        } else {
            buffer[o + 12] = colorOrR[0] ?? 1;
            buffer[o + 13] = colorOrR[1] ?? 1;
            buffer[o + 14] = colorOrR[2] ?? 1;
            buffer[o + 15] = colorOrR[3] ?? 1;
        }
    }

    // Camera-relative placement: wx - camPos[0] in f64 before f32 packing.
    // Euler rotation order: Ry(ry) * Rx(rx) * Rz(rz), scaled by (sx, sy, sz).
    function pushRel(wx, wy, wz, camPos, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, colorOrR, g, b, a) {
        if (disposed || instCount >= capacity) return -1;
        const px = wx - camPos[0];
        const py = wy - camPos[1];
        const pz = wz - camPos[2];
        const o = instCount * 16;

        if (rx === 0 && ry === 0 && rz === 0) {
            buffer[o + 0] = sx;  buffer[o + 1] = 0;   buffer[o + 2] = 0;   buffer[o + 3] = px;
            buffer[o + 4] = 0;   buffer[o + 5] = sy;  buffer[o + 6] = 0;   buffer[o + 7] = py;
            buffer[o + 8] = 0;   buffer[o + 9] = 0;   buffer[o + 10] = sz; buffer[o + 11] = pz;
        } else if (rx === 0 && rz === 0) {
            const cy = Math.cos(ry), syr = Math.sin(ry);
            buffer[o + 0] = cy * sx;   buffer[o + 1] = 0;   buffer[o + 2] = syr * sz;  buffer[o + 3] = px;
            buffer[o + 4] = 0;         buffer[o + 5] = sy;  buffer[o + 6] = 0;         buffer[o + 7] = py;
            buffer[o + 8] = -syr * sx; buffer[o + 9] = 0;   buffer[o + 10] = cy * sz;  buffer[o + 11] = pz;
        } else {
            const cx = Math.cos(rx), sxr = Math.sin(rx);
            const cy = Math.cos(ry), syr = Math.sin(ry);
            const cz = Math.cos(rz), szr = Math.sin(rz);
            buffer[o + 0] = (cy * cz + syr * sxr * szr) * sx;
            buffer[o + 1] = (-cy * szr + syr * sxr * cz) * sy;
            buffer[o + 2] = (syr * cx) * sz;
            buffer[o + 3] = px;
            buffer[o + 4] = (cx * szr) * sx;
            buffer[o + 5] = (cx * cz) * sy;
            buffer[o + 6] = (-sxr) * sz;
            buffer[o + 7] = py;
            buffer[o + 8] = (-syr * cz + cy * sxr * szr) * sx;
            buffer[o + 9] = (syr * szr + cy * sxr * cz) * sy;
            buffer[o + 10] = (cy * cx) * sz;
            buffer[o + 11] = pz;
        }
        writeTint(o, colorOrR, g, b, a);
        return instCount++;
    }

    // Accepts either 12-float row-major 3x4 affine or 16-float column-major 4x4 matrix.
    function pushLocalMatrix(m, colorOrR, g, b, a) {
        if (disposed || instCount >= capacity) return -1;
        const o = instCount * 16;
        if (m.length === 16) {
            buffer[o + 0] = m[0]; buffer[o + 1] = m[4]; buffer[o + 2] = m[8];  buffer[o + 3] = m[12];
            buffer[o + 4] = m[1]; buffer[o + 5] = m[5]; buffer[o + 6] = m[9];  buffer[o + 7] = m[13];
            buffer[o + 8] = m[2]; buffer[o + 9] = m[6]; buffer[o + 10] = m[10]; buffer[o + 11] = m[14];
        } else {
            for (let i = 0; i < 12; i++) buffer[o + i] = m[i];
        }
        writeTint(o, colorOrR, g, b, a);
        return instCount++;
    }

    function commit(explicitCount = instCount) {
        if (disposed) return;
        const n = Math.min(capacity, Math.max(0, explicitCount | 0));
        instCount = n;
        if (n === 0) {
            if (warmFor > 0) {
                warmFor--;
                return;
            }
            prevCount = 0;
            if (node.visible || node.instanceCount !== 0) {
                node.visible = false;
                if (node.instanceCount !== 0) {
                    node.setInstances(EMPTY_MAT);
                    node.setInstanceCount(0);
                }
            }
            return;
        }
        warmFor = 0;
        node.visible = true;
        const len = n * 16;
        let same = (n === prevCount);
        if (same) {
            for (let i = 0; i < len; i++) {
                if (buffer[i] !== prevBuffer[i]) {
                    same = false;
                    break;
                }
            }
        }
        if (!same) {
            prevBuffer.set(buffer.subarray(0, len));
            prevCount = n;
            node.setInstances(buffer.subarray(0, len));
        }
    }

    function destroy() {
        if (disposed) return;
        disposed = true;
        try { scene.destroyNode(node); } catch (_) { node.visible = false; }
    }

    const batch = {
        name,
        capacity,
        get node() { return node; },
        get buffer() { return buffer; },
        get ready() { return shaderReady; },
        whenReady: () => readyPromise,
        warm,
        begin,
        reset: begin,
        pushRel,
        pushLocalMatrix,
        commit,
        count: () => instCount,
        setGlow(g) {
            if (g === glow) return;
            glow = g;
            if (shaderReady && !disposed) {
                try { node.setShaderUniform('glow_scale', g); } catch (_) {}
            }
        },
        setUniform(uName, val) {
            if (pendingUniforms.get(uName) === val) return;
            pendingUniforms.set(uName, val);
            if (shaderReady && !disposed) {
                try { node.setShaderUniform(uName, val); } catch (_) {}
            }
        },
        setBuffer(bName, buf) {
            pendingBuffers.set(bName, buf);
            if (shaderReady && !disposed) {
                try { node.setShaderBuffer(bName, buf); } catch (_) {}
            }
        },
        setFadeOutDist(d) {
            if (!disposed) node.fadeOutDist = d > 0 ? d : 0;
        },
        setCullBounds(min, max) {
            if (!disposed) node.setCullBounds(min, max);
        },
        setInstanceCullSpheres(buf) {
            if (!disposed) node.setInstanceCullSpheres(buf ?? null);
        },
        destroy,
    };
    const readyPromise = shaderReadyPromise ?? Promise.resolve(batch);

    return batch;
}

export function createPoolRegistry(scene) {
    const batches = new Map();

    function registerBatch(name, mesh, opts = {}) {
        if (batches.has(name)) return batches.get(name);
        const batch = createInstanceBatch(scene, mesh, { name: `pool_${name}`, ...opts });
        batches.set(name, batch);
        return batch;
    }

    function get(name) {
        return batches.get(name) || null;
    }

    function warmAll() {
        let count = 0;
        for (const b of batches.values()) if (b.warm()) count++;
        return count;
    }

    function beginAll() {
        for (const b of batches.values()) b.begin();
    }

    function commitAll() {
        for (const b of batches.values()) b.commit();
    }

    function setGlowAll(g) {
        for (const b of batches.values()) b.setGlow(g);
    }

    function setUniformAll(uName, val) {
        for (const b of batches.values()) b.setUniform(uName, val);
    }

    function whenReady() {
        const list = [];
        for (const b of batches.values()) list.push(b.whenReady());
        return Promise.all(list);
    }

    function stats() {
        let activeBatches = 0;
        let totalInstances = 0;
        for (const b of batches.values()) {
            const c = b.count();
            if (c > 0) {
                activeBatches++;
                totalInstances += c;
            }
        }
        return {
            batchCount: batches.size,
            activeBatches,
            totalInstances,
            drawCalls: activeBatches,
        };
    }

    function dispose() {
        for (const b of batches.values()) b.destroy();
        batches.clear();
    }

    return {
        registerBatch,
        register: registerBatch,
        get,
        warmAll,
        beginAll,
        commitAll,
        setGlowAll,
        setUniformAll,
        whenReady,
        stats,
        dispose,
    };
}
