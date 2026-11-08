// A flock: a batch whose intents come from lab/flock.bk, the group's brain
// on the GPU, so a step is four dispatches (the neighbour grid cleared and
// filled, the brain, then the rig) and no work a creature on the CPU. The group lives on a round field (center,
// radius) sized to its count; the brain keeps it there, so a camera can
// frame the field without reading anything back.
//
// Behaviours: graze, travel (round the field after a goal that circles it),
// mill (circling the middle), flee (graze until a threat crosses the field;
// the alarm spreads and the group bolts).

import { Batch } from "./batch.js";
import { labModules, readApp } from "./creature.js";

export const BEHAVIOURS = ['graze', 'travel', 'mill', 'flee'];

let brainCache = null;
function brain() {
    if (!brainCache) {
        const mod = bro.kernel.compile(readApp('lab/flock.bk'), { file: 'lab/flock.bk', modules: labModules() });
        brainCache = {
            mod, kernel: mod.kernel('k_flock'), clear: mod.kernel('k_grid_clear'), bin: mod.kernel('k_grid_bin'),
            MIND: mod.consts.MIND, PARAMS: mod.consts.PARAMS, SEE: mod.consts.SEE, P: mod.consts,
        };
    }
    return brainCache;
}

// The field a group of `count` needs: room for each at its spacing, and more.
export function fieldRadius(count, space = 2.2) { return Math.max(18, Math.sqrt(count) * space * 1.25); }

export class Flock {
    // opts: behaviour, scene, shadows, space (m kept between neighbours), seed
    constructor(creature, count, opts = {}) {
        const b = brain();
        this.b = b;
        this.creature = creature;
        this.count = count;
        this.space = opts.space ?? 2.2;
        this.radius = fieldRadius(count, this.space);
        this.center = [0, 0];
        this.batch = new Batch(creature, count, opts);
        this.batch.dirty = false;        // the brain writes the intents
        this.mind = [bro.kernel.createBuffer(count * b.MIND * 4), bro.kernel.createBuffer(count * b.MIND * 4)];
        for (const m of this.mind) m.write(new Float32Array(count * b.MIND));
        this.params = new Float32Array(b.PARAMS);
        this.paramsBuf = bro.kernel.createBuffer(this.params);
        // The neighbour grid covers 1.5 field radii each way; a creature
        // beyond it counts in the edge cell.
        this.grid = Math.max(3, Math.ceil(3 * this.radius / b.SEE));
        this.headBuf = bro.kernel.createBuffer(this.grid * this.grid * 4);
        this.nextBuf = bro.kernel.createBuffer(count * 4);
        this.time = 0;
        this.threat = null;               // {x, z, vx, vz} when one is crossing
        this.setBehaviour(opts.behaviour || 'graze');
        this.batch.intentBuf.write(new Float32Array(count * 16));
        let s = (opts.seed ?? 1) * 9301 + 49297;
        const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
        // Scattered over the inner part of the field, roughly at their spacing.
        const r0 = Math.sqrt(count) * this.space * 0.62;
        for (let i = 0; i < count; i++) {
            const a = rnd() * Math.PI * 2, r = r0 * Math.sqrt(rnd());
            this.batch.place(i, Math.sin(a) * r, Math.cos(a) * r, rnd() * Math.PI * 2);
        }
        // One rig step with no intent places them, so the brain's first look
        // sees where they are.
        this.batch.step(1 / 120);
    }

    setBehaviour(name) {
        const k = BEHAVIOURS.indexOf(name);
        if (k < 0) throw new Error(`no behaviour '${name}' (have ${BEHAVIOURS.join(', ')})`);
        this.behaviour = name;
        this.mode = k;
        this.threat = null;
    }

    setGround(env) { this.batch.setGround(env); }

    // Send a threat across the field (flee): from outside the edge, through
    // the middle, at a run.
    startThreat(angle = Math.random() * Math.PI * 2) {
        const R = this.radius * 1.3, sp = 9;
        this.threat = { x: Math.sin(angle) * R, z: Math.cos(angle) * R, vx: -Math.sin(angle) * sp, vz: -Math.cos(angle) * sp, t: 0 };
    }

    writeParams(dt) {
        const P = this.b.P, p = this.params, sp = this.creature.def.speeds || {};
        p[P.P_MODE] = this.mode;
        p[P.P_TIME] = this.time;
        p[P.P_CENTER] = this.center[0]; p[P.P_CENTER + 1] = this.center[1];
        p[P.P_RADIUS] = this.radius;
        p[P.P_WALK] = sp.walk ?? 1.1;
        p[P.P_TROT] = sp.trot ?? 3.0;
        p[P.P_GALLOP] = sp.gallop ?? 7.5;
        // travel: a goal circling the field at a trot's pace, ahead of the group
        const ga = this.time * (p[P.P_TROT] * 0.8) / (this.radius * 0.6);
        p[P.P_GOAL] = this.center[0] + Math.sin(ga) * this.radius * 0.6;
        p[P.P_GOAL + 1] = this.center[1] + Math.cos(ga) * this.radius * 0.6;
        // flee: a threat crossing 4 s in, then every 24 s
        if (this.mode === 3) {
            if (!this.threat && this.time >= 4 && ((this.time - 4) % 24) < dt) this.startThreat(this.time * 0.77);
            if (this.threat) {
                const th = this.threat;
                th.x += th.vx * dt; th.z += th.vz * dt; th.t += dt;
                if (th.t > 2.6 * this.radius * 1.3 / 9) this.threat = null;
            }
        }
        p[P.P_THREAT_ON] = this.threat ? 1 : 0;
        p[P.P_THREAT] = this.threat ? this.threat.x : 0;
        p[P.P_THREAT + 1] = this.threat ? this.threat.z : 0;
        p[P.P_ALARM] = 9;
        p[P.P_COUNT] = this.count;
        p[P.P_SPACE] = this.space;
        p[P.P_GRID] = this.grid;
        this.paramsBuf.write(p);
    }

    step(dt) {
        this.writeParams(dt);
        const bt = this.batch, b = this.b;
        b.clear.dispatch(this.grid * this.grid, this.headBuf);
        b.bin.dispatch(this.count, bt.teleBuf, this.paramsBuf, this.headBuf, this.nextBuf);
        b.kernel.dispatch(this.count, bt.teleBuf, this.mind[0], this.mind[1], this.paramsBuf, this.headBuf, this.nextBuf, bt.intentBuf, dt);
        this.mind.reverse();
        bt.creature.rig.dispatch(this.count, bt.intentBuf, bt.envBuf, bt.stateBuf, bt.poseBuf, bt.teleBuf, dt);
        this.time += dt;
    }

    readTele(out) { return this.batch.readTele(out); }
    readMind(out) { return this.mind[0].read(out || new Float32Array(this.count * this.b.MIND)); }

    destroy() {
        this.batch.destroy();
        for (const m of this.mind) m.destroy();
        for (const buf of [this.paramsBuf, this.headBuf, this.nextBuf]) buf.destroy();
    }
}
