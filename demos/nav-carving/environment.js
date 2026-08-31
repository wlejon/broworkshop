// environment.js — Multilevel arena geometry, interactive gates, moving elevator, and opening bridge.

export const FLOORS = {
    GROUND: 0.0,
    MEZZANINE: 3.5,
    ROOFTOP: 7.0
};

export class Environment {
    constructor(scene) {
        this.scene = scene;

        // Interactive Objects State
        this.gate = {
            open: false,
            progress: 0.0, // 0 = closed, 1 = fully open
            pos: { x: 0.0, y: 0.0, z: -4.0 },
            size: { w: 3.2, h: 2.8, d: 0.4 },
            mesh: null
        };

        this.bridge = {
            extended: true,
            progress: 1.0, // 0 = retracted, 1 = extended
            start: { x: 4.0, y: FLOORS.ROOFTOP, z: 2.0 },
            end: { x: 9.0, y: FLOORS.ROOFTOP, z: 2.0 },
            mesh: null
        };

        this.elevator = {
            currentFloor: 0,
            targetFloor: 0,
            y: FLOORS.GROUND,
            speed: 2.5,
            isMoving: false,
            doorOpen: 1.0, // 0 = closed, 1 = open
            pos: { x: -6.0, z: 0.0 },
            size: { w: 2.4, h: 0.2, d: 2.4 },
            mesh: null
        };

        this.barricade = {
            active: true,
            pos: { x: 2.5, y: FLOORS.GROUND, z: 2.5 },
            size: { w: 1.8, h: 1.2, d: 1.2 },
            mesh: null
        };

        // Static Level Geometry Blocks
        this.blocks = [
            // Floor 0: Ground Slab & Courtyard
            { x: 0, y: -0.2, z: 0, w: 22, h: 0.4, d: 20, color: '#161d2b' },
            // Ground perimeter walls
            { x: -11, y: 1.5, z: 0, w: 0.5, h: 3.0, d: 20, color: '#253046' },
            { x: 11, y: 1.5, z: 0, w: 0.5, h: 3.0, d: 20, color: '#253046' },
            { x: 0, y: 1.5, z: 10, w: 22, h: 3.0, d: 0.5, color: '#253046' },
            // Blast Gate Wall dividing ground floor
            { x: -5.5, y: 1.5, z: -4.0, w: 8.5, h: 3.0, d: 0.5, color: '#253046' },
            { x: 5.5, y: 1.5, z: -4.0, w: 8.5, h: 3.0, d: 0.5, color: '#253046' },

            // Floor 1: Mezzanine / Catwalk (y = 3.5)
            { x: 0, y: FLOORS.MEZZANINE - 0.2, z: -6.0, w: 18, h: 0.4, d: 6.0, color: '#1f293d' },
            // Ramp connecting Floor 0 to Floor 1
            { x: 7.0, y: 1.6, z: -1.0, w: 2.8, h: 0.3, d: 7.0, rotX: -24 * (Math.PI / 180), color: '#2a3752' },

            // Floor 2: High Rooftop (y = 7.0)
            { x: -2.0, y: FLOORS.ROOFTOP - 0.2, z: 2.0, w: 8.0, h: 0.4, d: 7.0, color: '#233047' },
            // Ladder Structure Tower (from Floor 1 to Floor 2)
            { x: -5.5, y: 5.2, z: -3.5, w: 0.4, h: 3.8, d: 0.4, color: '#f59e0b' },

            // Floor 2: High Island Pad (across the 5.0m chasm)
            { x: 11.5, y: FLOORS.ROOFTOP - 0.2, z: 2.0, w: 5.0, h: 0.4, d: 6.0, color: '#2a3a57' },

            // Elevator Shaft Frame Pillars
            { x: -7.2, y: 4.0, z: -1.2, w: 0.3, h: 8.0, d: 0.3, color: '#00f0ff' },
            { x: -4.8, y: 4.0, z: -1.2, w: 0.3, h: 8.0, d: 0.3, color: '#00f0ff' },
            { x: -7.2, y: 4.0, z: 1.2, w: 0.3, h: 8.0, d: 0.3, color: '#00f0ff' },
            { x: -4.8, y: 4.0, z: 1.2, w: 0.3, h: 8.0, d: 0.3, color: '#00f0ff' }
        ];

        this.initVisuals();
    }

    initVisuals() {
        if (!this.scene || typeof this.scene.createMesh !== 'function') return;

        // Static Blocks
        for (const b of this.blocks) {
            try {
                this.scene.createMesh({
                    mesh: 'box',
                    width: b.w,
                    height: b.h,
                    depth: b.d,
                    color: b.color,
                    roughness: 0.8,
                    x: b.x,
                    y: b.y,
                    z: b.z
                });
            } catch (_) {}
        }

        // Gate Mesh
        try {
            this.gate.mesh = this.scene.createMesh({
                mesh: 'box',
                width: this.gate.size.w,
                height: this.gate.size.h,
                depth: this.gate.size.d,
                color: '#ff2850',
                emissive: 0.2,
                roughness: 0.4,
                x: this.gate.pos.x,
                y: this.gate.pos.y + this.gate.size.h / 2,
                z: this.gate.pos.z
            });
        } catch (_) {}

        // Bridge Mesh
        try {
            this.bridge.mesh = this.scene.createMesh({
                mesh: 'box',
                width: 5.0,
                height: 0.3,
                depth: 2.2,
                color: '#39ff14',
                roughness: 0.5,
                x: 6.5,
                y: FLOORS.ROOFTOP - 0.15,
                z: 2.0
            });
        } catch (_) {}

        // Elevator Mesh
        try {
            this.elevator.mesh = this.scene.createMesh({
                mesh: 'box',
                width: this.elevator.size.w,
                height: this.elevator.size.h,
                depth: this.elevator.size.d,
                color: '#00f0ff',
                emissive: 0.3,
                roughness: 0.3,
                x: this.elevator.pos.x,
                y: this.elevator.y,
                z: this.elevator.pos.z
            });
        } catch (_) {}

        // Barricade Mesh
        try {
            this.barricade.mesh = this.scene.createMesh({
                mesh: 'box',
                width: this.barricade.size.w,
                height: this.barricade.size.h,
                depth: this.barricade.size.d,
                color: '#f59e0b',
                roughness: 0.7,
                x: this.barricade.pos.x,
                y: this.barricade.pos.y + this.barricade.size.h / 2,
                z: this.barricade.pos.z
            });
        } catch (_) {}
    }

    toggleGate() {
        this.gate.open = !this.gate.open;
        return this.gate.open;
    }

    toggleBridge() {
        this.bridge.extended = !this.bridge.extended;
        return this.bridge.extended;
    }

    toggleBarricade() {
        this.barricade.active = !this.barricade.active;
        if (this.barricade.mesh) {
            this.barricade.mesh.visible = this.barricade.active;
        }
        return this.barricade.active;
    }

    callElevator(floorIndex) {
        if (floorIndex === 0) this.elevator.targetFloor = 0;
        else if (floorIndex === 1) this.elevator.targetFloor = 1;
        else if (floorIndex === 2) this.elevator.targetFloor = 2;
        this.elevator.isMoving = true;
    }

    update(dt) {
        // 1. Gate Animation
        const targetGateProg = this.gate.open ? 1.0 : 0.0;
        this.gate.progress += (targetGateProg - this.gate.progress) * Math.min(1.0, dt * 4.0);
        const gateLiftY = this.gate.pos.y + (this.gate.size.h / 2) + this.gate.progress * 3.0;
        if (this.gate.mesh) {
            this.gate.mesh.position = [this.gate.pos.x, gateLiftY, this.gate.pos.z];
        }

        // 2. Bridge Animation
        const targetBridgeProg = this.bridge.extended ? 1.0 : 0.0;
        this.bridge.progress += (targetBridgeProg - this.bridge.progress) * Math.min(1.0, dt * 3.0);
        if (this.bridge.mesh) {
            // Retract along X
            const bridgeX = 4.0 + (this.bridge.progress * 5.0) / 2;
            this.bridge.mesh.position = [bridgeX, FLOORS.ROOFTOP - 0.15, 2.0];
            this.bridge.mesh.scale = [this.bridge.progress, 1, 1];
        }

        // 3. Elevator Animation
        const targetElevY = this.elevator.targetFloor === 2 ? FLOORS.ROOFTOP : (this.elevator.targetFloor === 1 ? FLOORS.MEZZANINE : FLOORS.GROUND);
        const elevDiff = targetElevY - this.elevator.y;

        if (Math.abs(elevDiff) > 0.05) {
            const dir = Math.sign(elevDiff);
            this.elevator.y += dir * this.elevator.speed * dt;
            this.elevator.isMoving = true;
            this.elevator.doorOpen = 0.0;
        } else {
            this.elevator.y = targetElevY;
            this.elevator.currentFloor = this.elevator.targetFloor;
            this.elevator.isMoving = false;
            this.elevator.doorOpen = Math.min(1.0, this.elevator.doorOpen + dt * 3.0);
        }

        if (this.elevator.mesh) {
            this.elevator.mesh.position = [this.elevator.pos.x, this.elevator.y, this.elevator.pos.z];
        }
    }
}
