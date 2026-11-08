// The live view's flock: a Flock (lab/flock.js) on the page's scene, stepped
// live at the rig's 120 Hz with a fixed-step accumulator (at most a few
// steps a frame, so a slow frame slows the flock rather than piling up),
// on a checker ground sized to its field, with a marker where a threat is
// crossing (flee). The camera is the page's orbit camera, framed on the
// field when the flock is made.

import { Camera } from "/lib/kit/viewport3d.js";
import { Flock } from "./flock.js";
import { groundEnv } from "./scenarios.js";

const STEP = 1 / 120, MAX_STEPS = 4;

// A flat checker over a square of half-side `half`, cells about 1/40 of it.
function checker(half) {
    const st = Math.max(1, Math.round(half / 40)), n = Math.ceil((2 * half) / st);
    const pos = [], nrm = [], col = [], idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -half + i * st, z = -half + j * st;
        const c = (i + j) % 2 ? 0.30 : 0.24;
        const b = pos.length / 3;
        for (const [a, d] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x + a * st, 0, z + d * st); nrm.push(0, 1, 0); col.push(c * 0.95, c, c * 0.85, 1); }
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    return new Mesh({ positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(idx) });
}

export class FlockView {
    constructor(vp, creature, { count, behaviour, shadows }) {
        this.vp = vp;
        const scene = vp.scene;
        this.flock = new Flock(creature, count, { scene, shadows, behaviour });
        this.flock.setGround(groundEnv({}));
        const R = this.flock.radius;
        this.ground = scene.createMesh({ mesh: checker(R * 1.6), color: [1, 1, 1], vertexColorTint: true, roughness: 1, castsShadow: false });
        this.marker = scene.createMesh({ mesh: Mesh.cylinder(0.5, 1.2, 16), color: [0.75, 0.12, 0.08], roughness: 0.6 });
        this.marker.visible = false;
        this.acc = 0;
        this.speed = 1;
        this.steps = 0;
        vp.cam.far = Math.max(400, R * 8);
        vp.reframe([0, 0.5, 0], R * 1.6, { yaw: 0.6, pitch: -0.55 });
    }

    get count() { return this.flock.count; }
    get behaviour() { return this.flock.behaviour; }
    setBehaviour(b) { this.flock.setBehaviour(b); }
    threat() { if (this.flock.behaviour !== 'flee') this.flock.setBehaviour('flee'); this.flock.startThreat(); }

    // Advance by `dt` seconds of the page's frame (times the speed).
    frame(dt) {
        this.acc = Math.min(this.acc + dt * this.speed, MAX_STEPS * STEP);
        while (this.acc >= STEP) { this.flock.step(STEP); this.acc -= STEP; this.steps++; }
        const c = this.vp.canvas, h = c.clientHeight || 720;
        this.flock.draw(Camera.orbitViewOpts(this.vp.cam), h, (c.clientWidth || 1280) / h);
        const th = this.flock.threat;
        this.marker.visible = !!th;
        if (th) this.marker.position = [th.x, 1.2, th.z];
    }

    destroy() {
        this.flock.destroy();
        for (const n of [this.ground, this.marker]) { try { n.destroy(); } catch (_) { n.visible = false; } }
    }
}
