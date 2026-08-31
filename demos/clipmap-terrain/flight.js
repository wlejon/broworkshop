// demos/clipmap-terrain/flight.js

export class FlightCamera {
    constructor(cameraNode, clipmap, domCanvas) {
        this.camera = cameraNode;
        this.clipmap = clipmap;
        this.canvas = domCanvas;

        this.position = [0, 800, 1200];
        this.pitch = -0.3; // radians
        this.yaw = Math.PI;

        this.velocity = [0, 0, 0];
        this.speed = 250.0; // meters per second
        this.boostMultiplier = 3.0;

        this.keys = {};
        this.isLocked = false;
        this.minAGL = 15.0; // Minimum altitude above ground level

        this.initEvents();
    }

    initEvents() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        this.canvas.addEventListener('click', () => {
            if (!this.isLocked && document.pointerLockElement !== this.canvas) {
                this.canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = (document.pointerLockElement === this.canvas);
            const tip = document.getElementById('centerTip');
            if (tip) tip.style.opacity = this.isLocked ? '0' : '1';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            const sens = 0.0022;
            this.yaw -= e.movementX * sens;
            this.pitch -= e.movementY * sens;

            // Clamp pitch to avoid gimbal flip
            const limit = Math.PI * 0.48;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
        });
    }

    setPreset(name) {
        switch (name) {
            case 'peak':
                this.position = [150, 1350, -400];
                this.pitch = -0.15;
                this.yaw = 2.4;
                break;
            case 'valley':
                this.position = [-800, 180, 500];
                this.pitch = 0.05;
                this.yaw = 0.8;
                break;
            case 'orbit':
                this.position = [0, 3500, 4500];
                this.pitch = -0.65;
                this.yaw = Math.PI;
                break;
            case 'ridge':
                this.position = [600, 1500, 100];
                this.pitch = -0.2;
                this.yaw = 3.8;
                break;
        }
        this.velocity = [0, 0, 0];
        this.update(0.016);
    }

    update(dt) {
        // Forward, right, up vectors from yaw & pitch
        const cosP = Math.cos(this.pitch);
        const sinP = Math.sin(this.pitch);
        const cosY = Math.cos(this.yaw);
        const sinY = Math.sin(this.yaw);

        const fwd = [sinY * cosP, sinP, cosY * cosP];
        const right = [cosY, 0, -sinY];
        const up = [0, 1, 0];

        // Acceleration inputs
        let moveX = 0, moveY = 0, moveZ = 0;

        if (this.keys['KeyW'] || this.keys['ArrowUp']) moveZ += 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) moveZ -= 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveX -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) moveX += 1;
        if (this.keys['Space']) moveY += 1;
        if (this.keys['KeyC'] || this.keys['ControlLeft']) moveY -= 1;

        let currentSpeed = this.speed;
        if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
            currentSpeed *= this.boostMultiplier;
        }

        // Target movement vector
        const targetVelX = (fwd[0] * moveZ + right[0] * moveX) * currentSpeed;
        const targetVelY = (fwd[1] * moveZ + up[1] * moveY) * currentSpeed;
        const targetVelZ = (fwd[2] * moveZ + right[2] * moveX) * currentSpeed;

        // Smooth damping
        const smooth = Math.min(1.0, dt * 10.0);
        this.velocity[0] += (targetVelX - this.velocity[0]) * smooth;
        this.velocity[1] += (targetVelY - this.velocity[1]) * smooth;
        this.velocity[2] += (targetVelZ - this.velocity[2]) * smooth;

        this.position[0] += this.velocity[0] * dt;
        this.position[1] += this.velocity[1] * dt;
        this.position[2] += this.velocity[2] * dt;

        // Terrain collision elevation check
        let groundElev = 0;
        if (this.clipmap && typeof this.clipmap.elevationAt === 'function') {
            groundElev = this.clipmap.elevationAt(this.position[0], this.position[2]);
            if (this.position[1] < groundElev + this.minAGL) {
                this.position[1] = groundElev + this.minAGL;
                if (this.velocity[1] < 0) this.velocity[1] = 0;
            }
        }

        // Apply to camera node
        if (this.camera) {
            this.camera.position = this.position;
            // Target point looking forward
            const lookTarget = [
                this.position[0] + fwd[0] * 10.0,
                this.position[1] + fwd[1] * 10.0,
                this.position[2] + fwd[2] * 10.0
            ];
            this.camera.lookAt(lookTarget, [0, 1, 0]);
        }

        return {
            x: this.position[0],
            y: this.position[1],
            z: this.position[2],
            groundElev: groundElev,
            agl: this.position[1] - groundElev
        };
    }
}
