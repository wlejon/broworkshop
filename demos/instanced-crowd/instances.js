// instances.js — GPU Instanced Mesh and buffer management.

import { computeColor } from "./patterns.js";

/**
 * Creates custom 3D geometries for crowd agents using bro Mesh primitives
 */
export function createAgentMesh(type) {
    switch (type) {
        case 'arrow': {
            // Sleek aerodynamic delta dart
            const positions = new Float32Array([
                // Nose
                0.0, 0.0, 0.9,
                // Left wing tip
                -0.65, 0.0, -0.6,
                // Right wing tip
                0.65, 0.0, -0.6,
                // Top keel/cockpit
                0.0, 0.35, -0.2,
                // Bottom belly
                0.0, -0.15, -0.2,
                // Tail center
                0.0, 0.0, -0.55
            ]);
            const indices = new Uint32Array([
                // Top surfaces
                0, 1, 3,
                0, 3, 2,
                // Bottom surfaces
                0, 4, 1,
                0, 2, 4,
                // Wing rear
                1, 5, 3,
                2, 3, 5,
                1, 4, 5,
                2, 5, 4
            ]);
            const m = new Mesh({ positions, indices });
            m.computeNormals();
            return m;
        }
        case 'fish': {
            // Streamlined boid fish with tail
            const positions = new Float32Array([
                // Head
                0.0, 0.0, 0.8,
                // Dorsal
                0.0, 0.35, 0.1,
                // Ventral
                0.0, -0.25, 0.1,
                // Left flank
                -0.3, 0.0, 0.0,
                // Right flank
                0.3, 0.0, 0.0,
                // Tail base
                0.0, 0.0, -0.5,
                // Tail top
                0.0, 0.4, -0.85,
                // Tail bottom
                0.0, -0.3, -0.85
            ]);
            const indices = new Uint32Array([
                0, 3, 1,   0, 1, 4,   0, 4, 2,   0, 2, 3,
                1, 3, 5,   1, 5, 4,   2, 4, 5,   2, 5, 3,
                5, 6, 7
            ]);
            const m = new Mesh({ positions, indices });
            m.computeNormals();
            return m;
        }
        case 'biped': {
            // Stylized robot / biped drone
            const torso = Mesh.box(0.2, 0.3, 0.15);
            const head = Mesh.sphere(0.16, 12, 8).translate(0, 0.45, 0);
            const leftArm = Mesh.cylinder(0.06, 0.25, 8).translate(-0.3, 0.05, 0);
            const rightArm = Mesh.cylinder(0.06, 0.25, 8).translate(0.3, 0.05, 0);
            const leftLeg = Mesh.cylinder(0.07, 0.3, 8).translate(-0.12, -0.55, 0);
            const rightLeg = Mesh.cylinder(0.07, 0.3, 8).translate(0.12, -0.55, 0);
            return Mesh.merge([torso, head, leftArm, rightArm, leftLeg, rightLeg]);
        }
        case 'crystal': {
            // Tapered diamond crystal
            return Mesh.octahedron(0.4).scale(1.0, 1.8, 1.0);
        }
        case 'capsule': {
            return Mesh.capsule(0.2, 0.4, 12);
        }
        case 'box':
        default: {
            return Mesh.box(0.25, 0.25, 0.35);
        }
    }
}

/**
 * Crowd Manager class for instanced meshes
 */
export class CrowdManager {
    constructor(scene, initialCount = 10000, initialMeshType = 'arrow') {
        this.scene = scene;
        this.count = initialCount;
        this.meshType = initialMeshType;
        this.node = null;

        // Particle dynamics arrays
        this.particles = {
            count: this.count,
            px: new Float32Array(this.count),
            py: new Float32Array(this.count),
            pz: new Float32Array(this.count),
            vx: new Float32Array(this.count),
            vy: new Float32Array(this.count),
            vz: new Float32Array(this.count),
            phase: new Float32Array(this.count),
            baseRadius: new Float32Array(this.count),
            baseAngle: new Float32Array(this.count),
            origX: new Float32Array(this.count),
            origZ: new Float32Array(this.count)
        };

        // 16 floats per instance (4x3 affine rows + RGBA color)
        this.instanceBuffer = new Float32Array(this.count * 16);

        this.initParticlePositions();
        this.rebuildNode();
    }

    initParticlePositions() {
        const p = this.particles;
        for (let i = 0; i < this.count; i++) {
            // Uniform spherical / radial spread
            const r = Math.pow(Math.random(), 0.5) * 20.0;
            const theta = Math.random() * Math.PI * 2;
            const phi = (Math.random() - 0.5) * Math.PI;

            p.px[i] = Math.cos(theta) * Math.cos(phi) * r;
            p.py[i] = Math.sin(phi) * r;
            p.pz[i] = Math.sin(theta) * Math.cos(phi) * r;

            p.vx[i] = (Math.random() - 0.5) * 4.0;
            p.vy[i] = (Math.random() - 0.5) * 4.0;
            p.vz[i] = (Math.random() - 0.5) * 4.0;

            p.phase[i] = Math.random() * Math.PI * 2;
            p.baseRadius[i] = 0.2 + 0.8 * Math.random();
            p.baseAngle[i] = Math.random() * Math.PI * 2;

            p.origX[i] = p.px[i];
            p.origZ[i] = p.pz[i];
        }
    }

    rebuildNode() {
        if (this.node) {
            this.node.destroy();
            this.node = null;
        }

        const mesh = createAgentMesh(this.meshType);
        this.node = this.scene.createInstancedMesh({
            mesh,
            roughness: 0.35,
            metalness: 0.15
        });

        this.node.setInstances(this.instanceBuffer);
    }

    setCount(newCount) {
        if (newCount === this.count) return;

        this.count = newCount;
        this.particles = {
            count: this.count,
            px: new Float32Array(this.count),
            py: new Float32Array(this.count),
            pz: new Float32Array(this.count),
            vx: new Float32Array(this.count),
            vy: new Float32Array(this.count),
            vz: new Float32Array(this.count),
            phase: new Float32Array(this.count),
            baseRadius: new Float32Array(this.count),
            baseAngle: new Float32Array(this.count),
            origX: new Float32Array(this.count),
            origZ: new Float32Array(this.count)
        };

        this.instanceBuffer = new Float32Array(this.count * 16);
        this.initParticlePositions();
        this.rebuildNode();
    }

    setMeshType(type) {
        if (this.meshType === type) return;
        this.meshType = type;
        this.rebuildNode();
    }

    /**
     * Compute 3x3 rotation matrix pointing forward along velocity vector
     */
    computeLookRotation(vx, vy, vz, scale, outMatrix) {
        const len = Math.hypot(vx, vy, vz);
        if (len < 1e-4) {
            // Identity * scale
            outMatrix[0] = scale; outMatrix[1] = 0;     outMatrix[2] = 0;
            outMatrix[3] = 0;     outMatrix[4] = scale; outMatrix[5] = 0;
            outMatrix[6] = 0;     outMatrix[7] = 0;     outMatrix[8] = scale;
            return;
        }

        // Forward (+Z)
        const fX = vx / len;
        const fY = vy / len;
        const fZ = vz / len;

        // Up reference (+Y)
        let upX = 0, upY = 1, upZ = 0;
        if (Math.abs(fY) > 0.98) {
            upX = 1; upY = 0; upZ = 0;
        }

        // Right = Cross(up, forward)
        let rX = upY * fZ - upZ * fY;
        let rY = upZ * fX - upX * fZ;
        let rZ = upX * fY - upY * fX;
        const rLen = Math.hypot(rX, rY, rZ) || 1;
        rX /= rLen; rY /= rLen; rZ /= rLen;

        // True Up = Cross(forward, right)
        const uX = fY * rZ - fZ * rY;
        const uY = fZ * rX - fX * rZ;
        const uZ = fX * rY - fY * rX;

        // Row 0 (X): rX, uX, fX
        outMatrix[0] = rX * scale;
        outMatrix[1] = uX * scale;
        outMatrix[2] = fX * scale;

        // Row 1 (Y): rY, uY, fY
        outMatrix[3] = rY * scale;
        outMatrix[4] = uY * scale;
        outMatrix[5] = fY * scale;

        // Row 2 (Z): rZ, uZ, fZ
        outMatrix[6] = rZ * scale;
        outMatrix[7] = uZ * scale;
        outMatrix[8] = fZ * scale;
    }

    /**
     * Updates the 16-float buffer per instance and uploads to GPU
     */
    updateBuffers(config, colorScheme, orientToVelocity) {
        const { count, px, py, pz, vx, vy, vz, phase } = this.particles;
        const buf = this.instanceBuffer;
        const scale = config.scale;
        const rotMat = new Float32Array(9);

        let ptr = 0;
        for (let i = 0; i < count; i++) {
            const x = px[i], y = py[i], z = pz[i];
            const dx = vx[i], dy = vy[i], dz = vz[i];
            const speed = Math.hypot(dx, dy, dz);

            if (orientToVelocity) {
                this.computeLookRotation(dx, dy, dz, scale, rotMat);
            } else {
                rotMat[0] = scale; rotMat[1] = 0;     rotMat[2] = 0;
                rotMat[3] = 0;     rotMat[4] = scale; rotMat[5] = 0;
                rotMat[6] = 0;     rotMat[7] = 0;     rotMat[8] = scale;
            }

            const [cr, cg, cb, ca] = computeColor(colorScheme, i, count, speed, x, y, z, phase[i]);

            // Row 0: r00, r01, r02, tx
            buf[ptr++] = rotMat[0];
            buf[ptr++] = rotMat[1];
            buf[ptr++] = rotMat[2];
            buf[ptr++] = x;

            // Row 1: r10, r11, r12, ty
            buf[ptr++] = rotMat[3];
            buf[ptr++] = rotMat[4];
            buf[ptr++] = rotMat[5];
            buf[ptr++] = y;

            // Row 2: r20, r21, r22, tz
            buf[ptr++] = rotMat[6];
            buf[ptr++] = rotMat[7];
            buf[ptr++] = rotMat[8];
            buf[ptr++] = z;

            // Color: r, g, b, a
            buf[ptr++] = cr;
            buf[ptr++] = cg;
            buf[ptr++] = cb;
            buf[ptr++] = ca;
        }

        if (this.node) {
            this.node.setInstances(buf);
        }
    }
}
