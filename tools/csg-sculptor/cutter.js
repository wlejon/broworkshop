// cutter.js — Cutter shape generation, ghost preview, and 3D gizmo manipulation.

export class CutterTool {
    constructor(scene) {
        this.scene = scene;

        this.shape = 'box';
        this.operation = 'carve'; // 'carve' | 'union' | 'intersect'

        this.position = [0.8, 0.8, 0.8];
        this.rotation = [0, 0, 0]; // Euler angles (radians)
        this.scale = [1.0, 1.0, 1.0];

        this.dim = {
            width: 1.2,
            height: 1.2,
            depth: 1.2,
            radius: 0.7
        };

        this.gridSnap = 0.25;
        this.useSnap = false;
        this.gizmoMode = 'translate'; // 'translate' | 'rotate' | 'scale'

        this.previewNode = null;
        this.initGizmo();
        this.rebuildPreview();
    }

    initGizmo() {
        if (typeof bro !== 'undefined' && bro.gizmo) {
            bro.gizmo.show();
            bro.gizmo.setMode(this.gizmoMode);
            bro.gizmo.attach({
                position: () => [this.position[0], this.position[1], this.position[2]],
                translate: (dx, dy, dz) => {
                    this.position[0] += dx;
                    this.position[1] += dy;
                    this.position[2] += dz;
                    if (this.useSnap && this.gridSnap > 0) {
                        this.position[0] = Math.round(this.position[0] / this.gridSnap) * this.gridSnap;
                        this.position[1] = Math.round(this.position[1] / this.gridSnap) * this.gridSnap;
                        this.position[2] = Math.round(this.position[2] / this.gridSnap) * this.gridSnap;
                    }
                    this.syncPreviewTransform();
                },
                rotate: (qx, qy, qz, qw) => {
                    // Approximate rotation increment
                    this.rotation[1] += qy * 2.0;
                    this.rotation[0] += qx * 2.0;
                    this.syncPreviewTransform();
                },
                scale: (sx, sy, sz) => {
                    this.scale[0] = Math.max(0.1, this.scale[0] * sx);
                    this.scale[1] = Math.max(0.1, this.scale[1] * sy);
                    this.scale[2] = Math.max(0.1, this.scale[2] * sz);
                    this.syncPreviewTransform();
                }
            });
        }
    }

    setShape(shape) {
        if (this.shape === shape) return;
        this.shape = shape;
        this.rebuildPreview();
    }

    setOperation(op) {
        this.operation = op;
        this.rebuildPreview();
    }

    setGizmoMode(mode) {
        this.gizmoMode = mode;
        if (typeof bro !== 'undefined' && bro.gizmo) {
            bro.gizmo.setMode(mode);
        }
    }

    setDimension(key, val) {
        this.dim[key] = val;
        this.rebuildPreview();
    }

    /**
     * Builds raw cutter mesh based on current shape and dimensions
     */
    buildRawMesh() {
        switch (this.shape) {
            case 'cylinder':
                return Mesh.cylinder(this.dim.radius, this.dim.height * 0.5, 24);
            case 'sphere':
                return Mesh.sphere(this.dim.radius, 24, 18);
            case 'cone':
                return Mesh.cone(this.dim.radius, this.dim.height, 24);
            case 'torus':
                return Mesh.torus(this.dim.radius, this.dim.radius * 0.35, 24, 16);
            case 'box':
            default:
                return Mesh.box(this.dim.width * 0.5, this.dim.height * 0.5, this.dim.depth * 0.5);
        }
    }

    /**
     * Creates or updates the translucent preview mesh
     */
    rebuildPreview() {
        if (this.previewNode) {
            this.previewNode.destroy();
            this.previewNode = null;
        }

        const raw = this.buildRawMesh();
        let color = '#ff4757'; // Carve
        let emissiveColor = '#ff4757';
        if (this.operation === 'union') {
            color = '#2ed573';
            emissiveColor = '#2ed573';
        } else if (this.operation === 'intersect') {
            color = '#1e90ff';
            emissiveColor = '#1e90ff';
        }

        this.previewNode = this.scene.createMesh({
            mesh: raw,
            color,
            emissive: 0.45,
            emissiveColor,
            roughness: 0.2,
            metalness: 0.1
        });

        this.syncPreviewTransform();
    }

    syncPreviewTransform() {
        if (!this.previewNode) return;
        this.previewNode.position = [this.position[0], this.position[1], this.position[2]];
        this.previewNode.scale = [this.scale[0], this.scale[1], this.scale[2]];

        // Euler rotation
        const rx = this.rotation[0], ry = this.rotation[1], rz = this.rotation[2];
        const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
        const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
        const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);

        this.previewNode.quaternion = [
            sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz
        ];

        if (typeof bro !== 'undefined' && bro.gizmo) {
            bro.gizmo.setPosition(this.position[0], this.position[1], this.position[2]);
        }
    }

    /**
     * Returns a transformed clone of the cutter ready for CSG Boolean operation
     */
    getTransformedMesh() {
        const mesh = this.buildRawMesh();

        // 1. Scale
        mesh.scale(this.scale[0], this.scale[1], this.scale[2]);

        // 2. Rotate
        if (this.rotation[0]) mesh.rotate(1, 0, 0, this.rotation[0]);
        if (this.rotation[1]) mesh.rotate(0, 1, 0, this.rotation[1]);
        if (this.rotation[2]) mesh.rotate(0, 0, 1, this.rotation[2]);

        // 3. Translate
        mesh.translate(this.position[0], this.position[1], this.position[2]);

        mesh.computeNormals();
        return mesh;
    }

    resetTransform() {
        this.position = [0.8, 0.8, 0.8];
        this.rotation = [0, 0, 0];
        this.scale = [1.0, 1.0, 1.0];
        this.syncPreviewTransform();
    }
}
