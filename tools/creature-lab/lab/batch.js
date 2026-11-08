// A batch of creatures of one species on the GPU: their intent, state,
// pose and telemetry buffers, the rig dispatched over all of them at once,
// and (given a scene) the instanced mesh that draws them through the skin
// hook from the pose buffer, instance i being creature i. This is the path
// the planet takes; the lab draws nothing any other way.

import { INTENT, TELE, STATE_HEADER } from "./contract.js";
import { ROWS } from "./skeleton.js";
import { readApp, skinModules } from "./creature.js";

export const IDENTITY_ROW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1];

export class Batch {
    constructor(creature, count, opts = {}) {
        this.creature = creature;
        this.count = count;
        const nb = creature.skel.count;
        this.intent = new Float32Array(count * INTENT);
        this.intentBuf = bro.kernel.createBuffer(this.intent.byteLength);
        this.env = new Float32Array(16);
        this.envBuf = bro.kernel.createBuffer(this.env);
        this.stateBuf = bro.kernel.createBuffer(count * creature.stateStride * 4);
        this.poseBuf = bro.kernel.createBuffer(count * nb * ROWS * 4);
        this.teleBuf = bro.kernel.createBuffer(count * TELE * 4);
        this.dirty = true;
        this.node = null;
        if (opts.scene) this.node = drawBatch(opts.scene, creature, this.poseBuf, count, opts);
    }

    setGround(env) {
        this.env.set(env);
        this.envBuf.write(this.env);
    }

    // Put creature i at (x, z) facing yaw (rad): the rig plants it there on its next step.
    place(i, x, z, yaw = 0) {
        const h = new Float32Array(5);
        h[STATE_HEADER.POS] = x; h[STATE_HEADER.POS + 2] = z; h[STATE_HEADER.YAW] = yaw; h[STATE_HEADER.PLACED] = 0;
        // Zero the rest of the creature's state.
        const st = new Float32Array(this.creature.stateStride);
        st.set(h);
        this.stateBuf.write(st, i * this.creature.stateStride * 4);
    }

    setIntent(i, rec) {
        this.intent.set(rec, i * INTENT);
        this.dirty = true;
    }

    step(dt) {
        if (this.dirty) { this.intentBuf.write(this.intent); this.dirty = false; }
        this.creature.rig.dispatch(this.count, this.intentBuf, this.envBuf, this.stateBuf, this.poseBuf, this.teleBuf, dt);
    }

    readPose(out) { return this.poseBuf.read(out || new Float32Array(this.count * this.creature.skel.count * ROWS)); }
    readTele(out) { return this.teleBuf.read(out || new Float32Array(this.count * TELE)); }

    destroy() {
        for (const b of [this.intentBuf, this.envBuf, this.stateBuf, this.poseBuf, this.teleBuf]) b.destroy();
        if (this.node) this.node.destroy?.();
    }
}

// An instanced mesh drawing `count` creatures from a pose buffer. opts:
// rows (Float32Array of 16-float instance rows; identity by default),
// shadows, roughness.
export function drawBatch(scene, creature, poseBuf, count, opts = {}) {
    const node = scene.createInstancedMesh({
        mesh: creature.body.mesh, color: [1, 1, 1], vertexColorTint: true,
        roughness: opts.roughness ?? 0.85, metallic: 0,
        castsShadow: opts.shadows ?? true, receivesShadow: opts.shadows ?? true,
        module: readApp('lab/skin.bk'), file: 'lab/skin.bk',
        modules: skinModules(creature),
    });
    node.cullMargin = 1e5;   // the hook places every vertex
    if (!creature.skinBuf) creature.skinBuf = bro.kernel.createBuffer(creature.body.skin);
    node.setShaderBuffer('skin', creature.skinBuf);
    if (creature.body.piece) {
        if (!creature.pieceBuf) creature.pieceBuf = bro.kernel.createBuffer(creature.body.piece);
        node.setShaderBuffer('piece', creature.pieceBuf);
    }
    node.setShaderBuffer('pose', poseBuf);
    let rows = opts.rows;
    if (!rows) {
        rows = new Float32Array(count * 16);
        for (let i = 0; i < count; i++) rows.set(IDENTITY_ROW, 16 * i);
    }
    node.updateInstances(rows);
    return node;
}
