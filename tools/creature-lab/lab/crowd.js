// A crowd's drawing: a batch's creatures at three levels of detail, chosen
// on the GPU each frame by their size on screen, nothing read back. Each
// frame (update):
//
//   k_dq          the pose rows as dual quaternions, a bone each
//   k_lod         each creature appended to its level's list with its
//                 sphere; the lists' lengths are the level nodes' instance
//                 counts (SceneNode.setInstanceCountBuffer) and the spheres
//                 what the engine culls each view's instances by, the
//                 camera's and every shadow view's
//                 (setInstanceCullSpheres) (lab/crowd.bk)
//
// The levels are the creature's body meshed again to smaller budgets
// (body(skel, detail): the same masses, so the same shape and coat a little
// coarser), each an instanced node drawing its list through
// lab/skin-crowd.bk. A creature draws full while it stands taller than
// NEAR_PX on screen, at the middle level while taller than MID_PX, else at
// the far one (as does one out of view: it only casts). The near and mid levels hold at most `near` and `mid`
// creatures (the rest step down a level), so what a crowd costs has a
// ceiling whatever the camera does.

import { IDENTITY_ROW } from "./batch.js";
import { labModules, readApp } from "./creature.js";

export const LEVELS = [
    { name: 'near', detail: null },
    { name: 'mid', detail: { triangles: 2400, cell: 0.008, simplifyError: 0.01 } },
    { name: 'far', detail: { triangles: 500, cell: 0.014, simplifyError: 0.05 } },
];
export const NEAR_PX = 240, MID_PX = 70;

// The creature's body at each level (built once a creature, on first use).
export function levelBodies(creature) {
    if (!creature.levels) {
        creature.levels = LEVELS.map((l) => (l.detail ? creature.def.body(creature.skel, l.detail) : creature.body));
    }
    return creature.levels;
}

function crowdKernels(creature) {
    if (!creature.crowdKernels) {
        const mod = bro.kernel.compile(readApp('lab/crowd.bk'), {
            file: 'lab/crowd.bk', modules: { ...labModules(), 'creature::skeleton': creature.skel.module },
        });
        creature.crowdKernels = { dq: mod.kernel('k_dq'), clear: mod.kernel('k_lod_clear'), lod: mod.kernel('k_lod'), C: mod.consts };
    }
    return creature.crowdKernels;
}

// The creature at rest: its height (m, what its size on screen is measured
// by) and a sphere about it (centre cy above its root, radius r, with room
// for a stride's reach).
function restExtent(body) {
    const P = body.positions;
    let lo = Infinity, hi = -Infinity;
    for (let v = 1; v < P.length; v += 3) { lo = Math.min(lo, P[v]); hi = Math.max(hi, P[v]); }
    const cy = (lo + hi) / 2;
    let r = 0;
    for (let v = 0; v < P.length; v += 3) r = Math.max(r, Math.hypot(P[v], P[v + 1] - cy, P[v + 2]));
    return { height: hi - lo, cy, r: r * 1.25 };
}

export class Crowd {
    // opts: near (the most drawn full, 150), mid (the most at the middle
    // level, 1500), shadows (every level casts and receives; true), bounds
    // ([min, max]: the box every creature stays in, for culling; without
    // it the nodes are never culled)
    constructor(scene, creature, count, opts = {}) {
        const K = crowdKernels(creature), C = K.C;
        this.K = K;
        this.creature = creature;
        this.count = count;
        const nb = creature.skel.count;
        this.caps = [Math.min(count, opts.near ?? 150), Math.min(count, opts.mid ?? 1500), count];
        const bodies = levelBodies(creature);
        const ext = restExtent(bodies[0]);
        this.height = ext.height;
        this.params = new Float32Array(C.LOD_PARAMS);
        this.params.set(this.caps, C.R_CAPS);
        this.params[C.R_CY] = ext.cy;
        this.params[C.R_RAD] = ext.r;
        this.paramsBuf = bro.kernel.createBuffer(this.params);
        this.dqBuf = bro.kernel.createBuffer(count * nb * 2 * 16);
        this.countsBuf = bro.kernel.createBuffer(16);
        this.lists = this.caps.map((n) => bro.kernel.createBuffer(n * 4));
        // Each listed creature's sphere: the engine culls every view's
        // instances by them (setInstanceCullSpheres).
        this.spheres = this.caps.map((n) => bro.kernel.createBuffer(n * 16));
        const shadows = opts.shadows ?? true;
        this.skins = [];
        this.nodes = [];
        LEVELS.forEach((lv, l) => {
            const body = bodies[l], n = this.caps[l];
            const skinBuf = bro.kernel.createBuffer(body.skin);
            this.skins.push(skinBuf);
            const node = scene.createInstancedMesh({
                mesh: body.mesh, color: [1, 1, 1], vertexColorTint: true, roughness: 0.85, metallic: 0,
                castsShadow: shadows, receivesShadow: shadows,
                module: readApp('lab/skin-crowd.bk'), file: 'lab/skin-crowd.bk',
                modules: { 'creature::skeleton': creature.skel.module },
            });
            // The hook places every vertex: where, the owner says (bounds).
            if (opts.bounds) node.setCullBounds(opts.bounds[0], opts.bounds[1]);
            else node.cullMargin = 1e5;
            node.setShaderBuffer('dq', this.dqBuf);
            node.setShaderBuffer('skin', skinBuf);
            node.setShaderBuffer('order', this.lists[l]);
            const rows = new Float32Array(n * 16);
            for (let i = 0; i < n; i++) rows.set(IDENTITY_ROW, 16 * i);
            node.updateInstances(rows);
            node.setInstanceCountBuffer(this.countsBuf, l);
            if (opts.cull ?? true) node.setInstanceCullSpheres(this.spheres[l]);
            this.nodes.push(node);
        });
        this.levelTriangles = bodies.map((b) => b.triangles);
    }

    // Choose this frame's levels for a view ({ position, target, fov (deg) },
    // the viewport's height in px and aspect w / h) and turn the poses into
    // what the hook blends.
    update(poseBuf, teleBuf, view, heightPx = 720, aspect = 16 / 9) {
        const K = this.K, C = K.C, p = this.params;
        const e = view.position, t = view.target;
        const f = [t[0] - e[0], t[1] - e[1], t[2] - e[2]], fl = Math.hypot(...f) || 1;
        const tanHalf = Math.tan(((view.fov || 50) * Math.PI) / 360);
        const half = Math.atan(tanHalf * Math.hypot(1, aspect));
        // Its height on screen at d: height * heightPx / (2 tan(fov/2) d).
        const pxAt1 = (this.height * heightPx) / (2 * tanHalf);
        p.set(e, C.R_EYE);
        p.set(f.map((x) => x / fl), C.R_FWD);
        p[C.R_COS] = Math.cos(Math.min(Math.PI, half + 0.15));
        p[C.R_NEAR_D] = pxAt1 / NEAR_PX;
        p[C.R_MID_D] = pxAt1 / MID_PX;
        this.paramsBuf.write(p);
        K.dq.dispatch(this.count * this.creature.skel.count, poseBuf, this.dqBuf);
        K.clear.dispatch(4, this.countsBuf);
        K.lod.dispatch(this.count, teleBuf, this.paramsBuf, this.countsBuf, ...this.lists, ...this.spheres);
    }

    // How many each level drew last update (a readback: for tests and stats).
    readCounts() {
        const c = new Int32Array(this.countsBuf.read(new Float32Array(4)).buffer);
        return [0, 1, 2].map((l) => Math.min(c[l], this.caps[l]));
    }

    destroy() {
        for (const n of this.nodes) { try { n.destroy(); } catch (_) { n.visible = false; } }
        for (const b of [this.paramsBuf, this.dqBuf, this.countsBuf, ...this.lists, ...this.spheres, ...this.skins]) b.destroy();
    }
}
