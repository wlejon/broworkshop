// csg.js — CSG Boolean modeling engine and undo/redo history manager.

export class CSGEngine {
    constructor(scene) {
        this.scene = scene;
        this.currentMesh = null;
        this.meshNode = null;

        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 30;

        this.materialTheme = 'studio';
        this.wireframe = false;
    }

    /**
     * Initializes workpiece with a given base preset shape
     */
    initWorkpiece(preset = 'box') {
        let mesh = null;
        switch (preset) {
            case 'sphere':
                mesh = Mesh.sphere(1.6, 32, 24);
                break;
            case 'cylinder':
                mesh = Mesh.cylinder(1.4, 1.6, 32);
                break;
            case 'torus':
                mesh = Mesh.torus(1.5, 0.6, 32, 24);
                break;
            case 'column': {
                const shaft = Mesh.cylinder(0.9, 1.8, 28);
                const capTop = Mesh.box(1.2, 0.18, 1.2).translate(0, 1.9, 0);
                const capBottom = Mesh.box(1.2, 0.18, 1.2).translate(0, -1.9, 0);
                mesh = Mesh.merge([shaft, capTop, capBottom]);
                break;
            }
            case 'bracket': {
                const base = Mesh.box(1.6, 0.25, 1.2);
                const upright = Mesh.box(0.25, 1.2, 1.2).translate(-1.35, 1.2, 0);
                const rib = Mesh.box(0.18, 0.9, 0.18).rotate(0, 0, 1, Math.PI / 4).translate(-0.6, 0.6, 0);
                mesh = Mesh.merge([base, upright, rib]);
                break;
            }
            case 'box':
            default:
                mesh = Mesh.box(1.4, 1.4, 1.4);
                break;
        }

        mesh.computeNormals();
        this.setMesh(mesh, `Create ${preset}`);
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }

    /**
     * Updates the active mesh and scene node
     */
    setMesh(mesh, description = 'Update') {
        this.currentMesh = mesh;

        if (this.meshNode) {
            this.meshNode.destroy();
            this.meshNode = null;
        }

        const mat = this.getMaterialProps();
        this.meshNode = this.scene.createMesh({
            mesh: this.currentMesh,
            ...mat
        });
    }

    getMaterialProps() {
        switch (this.materialTheme) {
            case 'clay':
                return { color: '#c05c46', roughness: 0.85, metalness: 0.05 };
            case 'metal':
                return { color: '#e2e8f0', roughness: 0.18, metalness: 0.92 };
            case 'gold':
                return { color: '#d4af37', roughness: 0.25, metalness: 0.88 };
            case 'jade':
                return { color: '#2ed573', roughness: 0.45, metalness: 0.1 };
            case 'studio':
            default:
                return { color: '#94a3b8', roughness: 0.4, metalness: 0.25 };
        }
    }

    setMaterialTheme(theme) {
        this.materialTheme = theme;
        if (this.currentMesh) {
            this.setMesh(this.currentMesh, 'Change material');
        }
    }

    /**
     * Executes a boolean operation (Carve, Union, Intersect)
     */
    applyBoolean(cutterMesh, op = 'carve') {
        if (!this.currentMesh || !cutterMesh) return false;

        // Push current state to undo stack
        this.pushUndo(this.currentMesh.clone(), `${op.toUpperCase()} operation`);

        let result = null;
        try {
            switch (op) {
                case 'union':
                case 'add':
                    if (typeof this.currentMesh.csgUnion === 'function') {
                        result = this.currentMesh.csgUnion(cutterMesh);
                    } else if (typeof this.currentMesh.booleanUnion === 'function') {
                        result = this.currentMesh.booleanUnion(cutterMesh);
                    }
                    break;
                case 'intersect':
                    if (typeof this.currentMesh.csgIntersect === 'function') {
                        result = this.currentMesh.csgIntersect(cutterMesh);
                    } else if (typeof this.currentMesh.booleanIntersection === 'function') {
                        result = this.currentMesh.booleanIntersection(cutterMesh);
                    }
                    break;
                case 'carve':
                case 'subtract':
                default:
                    if (typeof this.currentMesh.csgSubtract === 'function') {
                        result = this.currentMesh.csgSubtract(cutterMesh);
                    } else if (typeof this.currentMesh.booleanDifference === 'function') {
                        result = this.currentMesh.booleanDifference(cutterMesh);
                    }
                    break;
            }
        } catch (err) {
            console.error('CSG Operation failed:', err);
            return false;
        }

        if (!result || result.empty || result.vertexCount === 0) {
            console.warn('CSG produced empty mesh; aborting.');
            return false;
        }

        result.computeNormals();
        this.setMesh(result, `${op} applied`);
        this.redoStack.length = 0; // Clear redo on new action
        return true;
    }

    pushUndo(meshSnapshot, label) {
        this.undoStack.push({ mesh: meshSnapshot, label });
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        const state = this.undoStack.pop();
        this.redoStack.push({ mesh: this.currentMesh.clone(), label: 'Redo' });
        this.setMesh(state.mesh, 'Undo: ' + state.label);
        return state.label;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const state = this.redoStack.pop();
        this.undoStack.push({ mesh: this.currentMesh.clone(), label: 'Undo' });
        this.setMesh(state.mesh, 'Redo: ' + state.label);
        return state.label;
    }

    getStats() {
        if (!this.currentMesh) {
            return { verts: 0, tris: 0 };
        }
        return {
            verts: this.currentMesh.vertexCount || 0,
            tris: this.currentMesh.triangleCount || 0
        };
    }
}
