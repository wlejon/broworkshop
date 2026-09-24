// instances.js — the crowd: particle arrays, agent meshes and the per-frame
// instance upload. One InstancedMeshNode draws every agent; setInstances()
// takes 16 floats each (a row-major 3x4 affine, then an RGBA tint).

import { writeColor } from "./patterns.js";

export const MESHES = {
    arrow: 'Arrow jet', fish: 'Boid fish', biped: 'Biped drone',
    crystal: 'Diamond crystal', capsule: 'Capsule', box: 'Cube',
};

function hull(positions, indices) {
    const m = new Mesh({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
    m.computeNormals();
    return m;
}

/** Agent geometry, nose along +Z (the instance basis points +Z along velocity). */
export function agentMesh(type) {
    switch (type) {
        case 'arrow':          // delta dart: nose, wing tips, keel, belly, tail
            return hull([0, 0, 0.9,  -0.65, 0, -0.6,  0.65, 0, -0.6,  0, 0.35, -0.2,  0, -0.15, -0.2,  0, 0, -0.55],
                [0, 1, 3,  0, 3, 2,  0, 4, 1,  0, 2, 4,  1, 5, 3,  2, 3, 5,  1, 4, 5,  2, 5, 4]);
        case 'fish':           // head, dorsal, ventral, flanks, tail base + fin
            return hull([0, 0, 0.8,  0, 0.35, 0.1,  0, -0.25, 0.1,  -0.3, 0, 0,  0.3, 0, 0,  0, 0, -0.5,  0, 0.4, -0.85,  0, -0.3, -0.85],
                [0, 3, 1,  0, 1, 4,  0, 4, 2,  0, 2, 3,  1, 3, 5,  1, 5, 4,  2, 4, 5,  2, 5, 3,  5, 6, 7]);
        case 'biped':
            return Mesh.merge([
                Mesh.box(0.2, 0.3, 0.15),
                Mesh.sphere(0.16, 12, 8).translate(0, 0.45, 0),
                Mesh.cylinder(0.06, 0.25, 8).translate(-0.3, 0.05, 0),
                Mesh.cylinder(0.06, 0.25, 8).translate(0.3, 0.05, 0),
                Mesh.cylinder(0.07, 0.3, 8).translate(-0.12, -0.55, 0),
                Mesh.cylinder(0.07, 0.3, 8).translate(0.12, -0.55, 0),
            ]);
        case 'crystal': return Mesh.octahedron(0.4).scale(1.0, 1.8, 1.0);
        case 'capsule': return Mesh.capsule(0.2, 0.4, 12);
        case 'box':
        default:        return Mesh.box(0.25, 0.25, 0.35);
    }
}

function particles(count) {
    const f = () => new Float32Array(count);
    const P = {
        count, px: f(), py: f(), pz: f(), vx: f(), vy: f(), vz: f(),
        phase: f(), baseRadius: f(), baseAngle: f(),
    };
    for (let i = 0; i < count; i++) {
        // Radial spread through a ball of radius 20.
        const r = Math.sqrt(Math.random()) * 20.0;
        const th = Math.random() * Math.PI * 2, ph = (Math.random() - 0.5) * Math.PI;
        P.px[i] = Math.cos(th) * Math.cos(ph) * r;
        P.py[i] = Math.sin(ph) * r;
        P.pz[i] = Math.sin(th) * Math.cos(ph) * r;
        P.vx[i] = (Math.random() - 0.5) * 4.0;
        P.vy[i] = (Math.random() - 0.5) * 4.0;
        P.vz[i] = (Math.random() - 0.5) * 4.0;
        P.phase[i] = Math.random() * Math.PI * 2;
        P.baseRadius[i] = 0.2 + 0.8 * Math.random();
        P.baseAngle[i] = Math.random() * Math.PI * 2;
    }
    return P;
}

export class Crowd {
    constructor(scene, count, meshType) {
        this.scene = scene;
        this.meshType = meshType;
        this.node = null;
        this.setCount(count);
    }

    get count() { return this.particles.count; }

    /** Re-seed the crowd at a new size (a fresh buffer and particles). */
    setCount(n) {
        if (this.particles && n === this.particles.count) return;
        this.particles = particles(n);
        this.buffer = new Float32Array(n * 16);
        this.rebuild();
    }

    setMeshType(type) {
        if (type === this.meshType) return;
        this.meshType = type;
        this.rebuild();
    }

    rebuild() {
        if (this.node) this.node.destroy();
        this.node = this.scene.createInstancedMesh({ mesh: agentMesh(this.meshType), roughness: 0.35, metallic: 0.15 });
        this.node.setInstances(this.buffer);
    }

    /**
     * Fill the instance buffer from the particles and upload it. `orient`
     * builds a basis with +Z along the velocity; otherwise agents keep the
     * identity rotation. No per-instance allocation.
     */
    upload(scale, scheme, orient) {
        const { count, px, py, pz, vx, vy, vz, phase } = this.particles;
        const b = this.buffer;
        for (let i = 0, o = 0; i < count; i++, o += 16) {
            const dx = vx[i], dy = vy[i], dz = vz[i];
            const speed = Math.hypot(dx, dy, dz);
            if (orient && speed > 1e-4) {
                const fx = dx / speed, fy = dy / speed, fz = dz / speed;
                // right = up x forward (up = +Y, or +X when flying vertically)
                const flat = Math.abs(fy) <= 0.98;
                let rx = flat ? fz : 0, ry = flat ? 0 : -fz, rz = flat ? -fx : fy;
                const rl = Math.hypot(rx, ry, rz) || 1;
                rx /= rl; ry /= rl; rz /= rl;
                const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
                b[o] = rx * scale; b[o + 1] = ux * scale; b[o + 2] = fx * scale;
                b[o + 4] = ry * scale; b[o + 5] = uy * scale; b[o + 6] = fy * scale;
                b[o + 8] = rz * scale; b[o + 9] = uz * scale; b[o + 10] = fz * scale;
            } else {
                b[o] = scale; b[o + 1] = 0; b[o + 2] = 0;
                b[o + 4] = 0; b[o + 5] = scale; b[o + 6] = 0;
                b[o + 8] = 0; b[o + 9] = 0; b[o + 10] = scale;
            }
            b[o + 3] = px[i]; b[o + 7] = py[i]; b[o + 11] = pz[i];
            writeColor(scheme, i, count, speed, px[i], py[i], pz[i], phase[i], b, o + 12);
        }
        this.node.setInstances(b);
    }
}
