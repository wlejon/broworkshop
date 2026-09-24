// workbench.js — everything that edits or analyses the loaded meshes: stats
// checks, colour modes, hull / self-intersection overlays, modify ops and the
// ProgressiveMesh LOD chain. Heavy work runs in mesh-worker.js; this module
// holds no DOM, so app.js renders what it reports.

import { workerClient } from "/lib/kit/worker-rpc.js";
import { meshToData, meshFromData } from "./mesh-data.js";

export const COLOR_MODES = {
    original: 'original', normals: 'normals', curvature: 'curvature',
    ao: 'ambient occlusion', thickness: 'thickness',
};
const BAKES = { ao: ['bakeAO', 'Baking AO'], curvature: ['bakeCurv', 'Baking curvature'],
                thickness: ['bakeThick', 'Baking thickness'] };

/** The modify ops: id -> [label, worker op, params]. */
export const MODIFY = {
    subLoop:   ['Subdivide Loop', 'subdivideLoop', { iters: 1 }],
    subCC:     ['Subdivide Catmull-Clark', 'subdivideCC', { iters: 1 }],
    subMid:    ['Subdivide Midpoint', 'subdivideMid', { iters: 1 }],
    smoothLap: ['Smooth Laplacian', 'smoothLap', { lambda: 0.5, iters: 5 }],
    smoothTau: ['Smooth Taubin', 'smoothTau', { lambda: 0.5, mu: -0.53, iters: 10 }],
    unwrap:    ['UV unwrap', 'unwrap', {}],
};

/** Each triangle edge once, as line-list index pairs. */
export function edgeIndices(tri) {
    const seen = new Set(), out = [];
    for (let t = 0; t < tri.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const a = tri[t + k], b = tri[t + (k + 1) % 3];
            const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
            if (!seen.has(key)) { seen.add(key); out.push(a, b); }
        }
    }
    return new Uint32Array(out);
}

/**
 * opts: { status (kit statusLine), onBusy(on), onChange() — geometry or view
 * state changed }. Handle documented on `api` below.
 */
export function createWorkbench(scene, opts) {
    const rpc = workerClient('mesh-worker.js', { type: 'module' });
    /** A worker request, sent once the worker has installed its handlers. */
    const ask = async (msg) => { await rpc.ready; return rpc.request(msg); };
    const status = opts.status;
    const changed = () => { if (opts.onChange) opts.onChange(); };
    const freshLod = () => ({ built: false, encoded: null, ratio: 1, tris: 0 });

    const api = {
        rpc,
        doc: null,
        busy: false,
        /** Geometry differs from the file (skinning pauses until reset). */
        dirty: false,
        lod: freshLod(),
        view: { color: 'original', hull: false, selfx: false },

        /** Start working on a freshly loaded document. */
        attach(doc) {
            api.doc = doc;
            api.dirty = false;
            api.lod = freshLod();
            api.view = { color: 'original', hull: false, selfx: false };
            changed();
        },
        detach() { api.doc = null; api.lod = freshLod(); changed(); },

        /** Totals over the working meshes: { meshes, verts, tris, size [x,y,z], uvs, colors }. */
        summary() {
            const d = api.doc;
            if (!d) return null;
            let verts = 0, tris = 0, uvs = false, colors = false;
            const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (const it of d.items) {
                const w = it.work;
                verts += w.vertexCount; tris += w.triangleCount;
                uvs = uvs || w.hasUVs; colors = colors || w.hasColors;
                const bb = w.computeBBox();
                for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], bb.min[i]); hi[i] = Math.max(hi[i], bb.max[i]); }
            }
            return { meshes: d.items.length, verts, tris, size: [0, 1, 2].map((i) => hi[i] - lo[i]), uvs, colors };
        },

        /**
         * Run a worker op over every item's working mesh in turn, calling
         * apply(item, reply). Returns true when every item finished.
         */
        async runForEach(label, op, params, apply) {
            if (!api.doc) return false;
            if (api.busy) { status.warn('busy: wait for the current op'); return false; }
            setBusy(true, label);
            const t0 = Date.now();
            try {
                const items = api.doc.items;
                for (let i = 0; i < items.length; i++) {
                    if (items.length > 1) status.busy(label + ' (' + (i + 1) + '/' + items.length + ')');
                    const reply = await ask({ type: op, mesh: meshToData(items[i].work), params: params || {} });
                    apply(items[i], reply);
                }
                status.ok(label + ' · ' + (Date.now() - t0) + ' ms');
                return true;
            } catch (e) {
                status.error(label + ' failed: ' + e.message);
                return false;
            } finally {
                setBusy(false);
            }
        },

        /** Manifold, volume and self-intersection of a single-mesh file: { manifold, volume, pairs }. */
        async checks(onPartial) {
            const d = api.doc;
            if (!d || d.items.length !== 1 || api.busy) return null;
            setBusy(true, 'Running checks');
            try {
                const mesh = meshToData(d.items[0].work);
                const m = await ask({ type: 'isManifold', mesh });
                const out = { manifold: m.manifold, volume: m.volume, pairs: null };
                if (onPartial) onPartial(out);
                // Self-intersection can be slow on dense meshes, so it reports second.
                const s = await ask({ type: 'selfInt', mesh });
                out.pairs = s.pairs ? s.pairs.length : 0;
                status.ok('checks done');
                return out;
            } catch (e) {
                status.error('checks failed: ' + e.message);
                return null;
            } finally {
                setBusy(false);
            }
        },

        /** Vertex-colour view: original, normals (cheap, here) or a worker bake. */
        async setColorMode(mode) {
            api.view.color = mode;
            const d = api.doc;
            if (!d) return;
            if (mode === 'original') {
                for (const it of d.items) {
                    it.work.colors = it.baseColors ? new Float32Array(it.baseColors) : new Float32Array(0);
                    it.node.updateMesh(it.work);
                }
            } else if (mode === 'normals') {
                for (const it of d.items) {
                    const w = it.work;
                    if (!w.hasNormals) w.computeNormals();
                    const n = w.normals, c = new Float32Array(w.vertexCount * 4);
                    for (let i = 0; i < w.vertexCount; i++) {
                        c[i * 4] = n[i * 3] * 0.5 + 0.5;
                        c[i * 4 + 1] = n[i * 3 + 1] * 0.5 + 0.5;
                        c[i * 4 + 2] = n[i * 3 + 2] * 0.5 + 0.5;
                        c[i * 4 + 3] = 1;
                    }
                    w.colors = c;
                    it.node.updateMesh(w);
                }
            } else {
                const [op, label] = BAKES[mode];
                await api.runForEach(label, op, {}, (it, r) => {
                    if (r.mesh.colors) it.work.colors = r.mesh.colors;
                    if (r.mesh.normals) it.work.normals = r.mesh.normals;
                    it.node.updateMesh(it.work);
                });
            }
            changed();
        },

        /** Convex hull overlay, built lazily per item. */
        async setHull(on) {
            api.view.hull = on;
            const d = api.doc;
            if (d && on && d.items.some((it) => !it.hullNode)) {
                await api.runForEach('Convex hull', 'convexHull', {}, (it, r) => {
                    if (it.hullNode) it.hullNode.destroy();
                    // Drawn as its edges, so the model stays visible inside it.
                    it.hullNode = scene.createMesh({
                        mesh: new Mesh({ positions: r.mesh.positions, indices: edgeIndices(r.mesh.indices) }),
                        color: [1.0, 0.85, 0.2, 1.0], unlit: true, castsShadow: false,
                        drawMode: 'lines', lineWidth: 1.5, name: 'hull-' + it.node.name,
                    });
                });
            }
            if (d) for (const it of d.items) if (it.hullNode) it.hullNode.visible = on;
            changed();
        },

        /** Red overlay on every triangle in a self-intersecting pair. Returns the pair count. */
        async setSelfx(on) {
            api.view.selfx = on;
            const d = api.doc;
            let total = 0;
            if (d) for (const it of d.items) if (it.selfxNode) { it.selfxNode.destroy(); it.selfxNode = null; }
            if (d && on) {
                await api.runForEach('Self-intersect', 'selfInt', {}, (it, r) => {
                    const pairs = r.pairs || [];
                    total += pairs.length;
                    if (!pairs.length) return;
                    const tris = [...new Set(pairs.flatMap((p) => [p.triA, p.triB]))];
                    const src = it.work.indices, idx = new Uint32Array(tris.length * 3);
                    tris.forEach((t, i) => { idx.set(src.subarray(t * 3, t * 3 + 3), i * 3); });
                    it.selfxNode = scene.createMesh({
                        mesh: new Mesh({ positions: new Float32Array(it.work.positions), indices: idx }),
                        color: [1.0, 0.15, 0.15, 1.0], unlit: true, castsShadow: false,
                        depthBias: [-1, -1000], name: 'selfx-' + it.node.name,
                    });
                });
            }
            changed();
            return total;
        },

        /** Replace every working mesh with the worker's result of `op`. */
        async modify(label, op, params) {
            const ok = await api.runForEach(label, op, params, (it, r) => {
                it.work = meshFromData(r.mesh);
                it.node.updateMesh(it.work);
            });
            if (ok) {
                api.dirty = true;
                await afterGeometry();
            }
            return ok;
        },

        /** Back to the file's meshes. */
        async reset() {
            const d = api.doc;
            if (!d || api.busy) return;
            for (const it of d.items) { it.work = it.bind.clone(); it.node.updateMesh(it.work); }
            api.dirty = false;
            await afterGeometry();
            status.ok('reset to the file');
        },

        /** Build a ProgressiveMesh chain for a single-mesh file. */
        async buildLOD() {
            const d = api.doc;
            if (!d || api.busy) return false;
            if (d.items.length !== 1) { status.warn('LOD chain: single-mesh files only'); return false; }
            setBusy(true, 'Building LOD chain');
            try {
                const r = await ask({ type: 'lodBuild', mesh: meshToData(d.items[0].work) });
                api.lod = { built: true, encoded: r.encoded, ratio: 1, tris: d.items[0].work.triangleCount };
                status.ok('LOD chain built');
                return true;
            } catch (e) {
                status.error('LOD build failed: ' + e.message);
                return false;
            } finally {
                setBusy(false);
                changed();
            }
        },

        /**
         * Show the chain at `ratio`. Slider drags coalesce: while one request
         * is in flight only the latest ratio runs next. Resolves when shown.
         */
        async setLOD(ratio) {
            if (!api.doc || !api.lod.built) return;
            api.lod.ratio = ratio;
            if (lodBusy) return;
            lodBusy = true;
            try {
                let shown = -1;
                while (shown !== api.lod.ratio && api.lod.built) {
                    const r = api.lod.ratio;
                    const reply = await ask({ type: 'lodAt', params: { encoded: api.lod.encoded, ratio: r } });
                    if (!api.doc || !api.lod.built) break;
                    const m = meshFromData(reply.mesh);
                    api.doc.items[0].node.updateMesh(m);
                    api.lod.shownTris = m.triangleCount;
                    shown = r;
                    status.set('LOD ' + Math.round(r * 100) + '% · ' + m.triangleCount.toLocaleString() + ' tris');
                }
            } catch (e) {
                status.error('LOD failed: ' + e.message);
            } finally {
                lodBusy = false;
                changed();
            }
        },

        clearLOD() {
            api.lod = freshLod();
            if (api.doc) for (const it of api.doc.items) it.node.updateMesh(it.work);
            changed();
        },
    };
    let lodBusy = false;

    function setBusy(on, label) {
        api.busy = on;
        if (on && label) status.busy(label);
        if (opts.onBusy) opts.onBusy(on);
    }

    /** Geometry changed: drop the LOD chain and overlays, then rebuild the active views. */
    async function afterGeometry() {
        api.lod = freshLod();
        for (const it of api.doc.items) if (it.hullNode) { it.hullNode.destroy(); it.hullNode = null; }
        await api.setColorMode(api.view.color);
        if (api.view.hull) await api.setHull(true);
        if (api.view.selfx) await api.setSelfx(true);
        changed();
    }

    return api;
}
