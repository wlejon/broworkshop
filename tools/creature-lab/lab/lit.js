// A creature drawn as the live view draws it (main.js: the same sky light,
// sun and shadows, a checkered ground), from any camera, captured headless:
// the finder's scans (through the skin hook's debug views) and its close-ups.
// One scene is kept and parked between captures, as page.js parks the
// sheets' scene.

import { drawBatch } from "./batch.js";
import { ROWS } from "./skeleton.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";

let L = null;

// The live view's ground: 0.5 m checker over 16 m about the origin.
function groundMesh() {
    const st = 0.25, n = 64, o = -8;
    const pos = [], nrm = [], col = [], idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = o + i * st, z = o + j * st;
        const c = (Math.floor(x / 0.5 + 1000) + Math.floor(z / 0.5 + 1000)) % 2 ? 0.30 : 0.22;
        const b = pos.length / 3;
        for (const [a, d] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x + a * st, 0, z + d * st); nrm.push(0, 1, 0); col.push(c * 0.95, c, c * 0.85, 1); }
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(idx) });
}

function litScene() {
    if (L) return L;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'none';
    document.body.append(canvas);
    const scene = canvas.getContext('scene');
    scene.keepAlive = true;
    scene.setAmbient({ color: [0.85, 0.9, 1.0], intensity: 0.45 });
    scene.createLight({ type: 'directional', direction: [0.4, -0.8, 0.45], intensity: 2.4, castShadow: true });
    const ground = scene.createMesh({ mesh: groundMesh(), color: [1, 1, 1], vertexColorTint: true, roughness: 1, castsShadow: false });
    L = { canvas, scene, ground, node: null, creature: null, poseBuf: null };
    return L;
}

// Show `creature` in pose P (a creature-frame pose: lab/cycle.js relativePose).
export function setPose(creature, P) {
    const S = litScene();
    if (S.creature !== creature) {
        if (S.node) { try { S.node.destroy(); } catch (_) { S.node.visible = false; } S.poseBuf.destroy(); }
        S.poseBuf = bro.kernel.createBuffer(creature.skel.count * ROWS * 4);
        S.node = drawBatch(S.scene, creature, S.poseBuf, 1, { shadows: true });
        S.creature = creature;
    }
    S.poseBuf.write(P.subarray(0, creature.skel.count * ROWS));
}

export function showGround(on) { litScene().ground.visible = on; }

// A camera `dist` m from `target`, `yaw` degrees about it (0: in front of a
// creature facing +Z, 90: at its left, +X), `pitch` degrees looking down.
export function orbitView(target, yaw, pitch = 8, dist = 3, fov = 45) {
    const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    const d = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
    return { fov, near: 0.05, far: 200, position: target.map((t, i) => t + d[i] * dist), target: target.slice(), up: [0, 1, 0], yaw, pitch, dist };
}

// A camera on the line from `centre` toward `from` (a position), `dist` m out.
export function viewToward(centre, from, dist, fov = 40) {
    const d = from.map((v, i) => v - centre[i]);
    const l = Math.hypot(...d) || 1;
    return { fov, near: 0.03, far: 200, position: centre.map((c, i) => c + (d[i] / l) * dist), target: centre.slice(), up: [0, 1, 0] };
}

export function project(view, W, H, p) { return worldToScreen(p, view, W, H); }

// The scene from `view` at W x H: lit, or a debug view of the skin hook
// (`normal`, `depth`, `piece`). Returns ImageData.
export function capture(view, W, H, debug = null) {
    const S = litScene();
    S.scene.setCamera({ fov: view.fov, near: view.near, far: view.far, position: view.position, target: view.target, up: view.up });
    S.scene.setDebugView(debug);
    const rs = 1 / (globalThis.devicePixelRatio || 1);
    if (Math.abs(S.scene.renderScale - rs) > 1e-6) S.scene.renderScale = rs;
    S.canvas.width = W; S.canvas.height = H;
    if (!S.scene.attached) S.scene.attachTo(S.canvas);
    let f;
    try { f = S.scene.captureFrame(W, H); } finally { S.scene.detach(); S.scene.setDebugView(null); }
    if (!f || f.width !== W || f.height !== H) throw new Error(`lit: capture came back ${f && f.width}x${f && f.height} for ${W}x${H}`);
    return f;
}
