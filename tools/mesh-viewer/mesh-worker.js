// mesh-worker.js — every heavy bromesh operation, off the main thread
// (Mesh and ProgressiveMesh exist in worker realms). A lib/kit/worker-rpc.js
// server: each request is { type: op, mesh?, params } where `mesh` is
// mesh-data.js data; replies carry { mesh?, atlas?, pairs?, manifold?,
// volume?, encoded? }. Streams are copied, not transferred: bro cannot yet
// transfer a buffer whose view is in the payload (ENGINE-ISSUES.md,
// "postMessage({ v: view }, [view.buffer])").

import { serveWorker } from "/lib/kit/worker-rpc.js";
import { meshToData, meshFromData } from "./mesh-data.js";

function withMesh(m, extra) {
    return Object.assign({ type: 'mesh', mesh: meshToData(m) }, extra);
}

/** Handlers that edit the posted mesh in place and send it back. */
const EDITS = {
    subdivideLoop: (m, p) => m.subdivideLoop(p.iters || 1),
    subdivideCC:   (m, p) => m.subdivideCatmullClark(p.iters || 1),
    subdivideMid:  (m, p) => m.subdivideMidpoint(p.iters || 1),
    smoothLap:     (m, p) => m.smoothLaplacian(p.lambda || 0.5, p.iters || 5),
    smoothTau:     (m, p) => m.smoothTaubin(p.lambda || 0.5, p.mu || -0.53, p.iters || 10),
    remesh:        (m, p) => m.remeshIsotropic(p.edgeLen, p.iters || 3),
    simplify:      (m, p) => m.simplify(p.ratio, p.error || 0.01),
    bakeAO:        (m, p) => m.bakeAmbientOcclusion(p.rays || 64, p.maxDist || 0),
    bakeCurv:      (m, p) => m.bakeCurvature(p.scale || 1.0),
    bakeThick:     (m, p) => m.bakeThickness(p.rays || 32, p.maxDist || 0),
};

const handlers = {
    unwrap(msg) {
        const m = meshFromData(msg.mesh);
        const atlas = m.unwrapUVs();
        return withMesh(m, { atlas });
    },
    convexHull(msg) { return withMesh(meshFromData(msg.mesh).convexHull()); },
    selfInt(msg) {
        return { type: 'pairs', pairs: meshFromData(msg.mesh).findSelfIntersections() || [] };
    },
    isManifold(msg) {
        const m = meshFromData(msg.mesh);
        const manifold = m.isManifold();
        let volume = null;
        if (manifold) { try { volume = m.computeVolume(); } catch (_) { volume = null; } }
        return { type: 'manifold', manifold, volume };
    },
    lodBuild(msg) {
        return { type: 'lod', encoded: new ProgressiveMesh(meshFromData(msg.mesh)).serialize() };
    },
    lodAt(msg) {
        const pm = ProgressiveMesh.deserialize(msg.params.encoded);
        return withMesh(pm.atRatio(msg.params.ratio));
    },
};
for (const op of Object.keys(EDITS)) {
    handlers[op] = (msg) => {
        const m = meshFromData(msg.mesh);
        EDITS[op](m, msg.params || {});
        return withMesh(m);
    };
}

serveWorker(handlers);
