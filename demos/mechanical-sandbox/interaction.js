// interaction.js — Mouse raycasting, virtual spring dragging, and impulse application.

import { createDynamicRod } from "./visuals.js";

export class PhysicsInteraction {
    constructor(canvas, scene, cam) {
        this.canvas = canvas;
        this.scene = scene;
        this.cam = cam;

        this.grabbed = null; // { tag, localOffset, targetDistance, dragPlaneDist }
        this.springRod = createDynamicRod(scene, '#00f2fe', 0.025, 0.6);
        this.springRod.setVisible(false);

        this.mouseRay = null;
        this.isLeftDown = false;
        this.isRightDown = false;
        this.isMiddleDown = false;

        this.initEvents();
    }

    initEvents() {
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const lx = e.clientX - rect.left;
            const ly = e.clientY - rect.top;
            this.updateRay(lx, ly);

            if (e.button === 0) {
                this.isLeftDown = true;
                this.tryGrab();
            } else if (e.button === 2) {
                this.isRightDown = true;
            } else if (e.button === 1) {
                this.isMiddleDown = true;
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.isLeftDown = false;
                this.releaseGrab();
            }
            if (e.button === 2) this.isRightDown = false;
            if (e.button === 1) this.isMiddleDown = false;
        });

        window.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const lx = e.clientX - rect.left;
            const ly = e.clientY - rect.top;
            this.updateRay(lx, ly);

            // Orbit & pan camera if not dragging a body
            if (!this.grabbed) {
                if (this.isRightDown && typeof Camera !== 'undefined' && Camera.orbitLook) {
                    Camera.orbitLook(this.cam, e.movementX, e.movementY);
                }
                if (this.isMiddleDown && typeof Camera !== 'undefined' && Camera.orbitPan) {
                    Camera.orbitPan(this.cam, e.movementX, e.movementY);
                }
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.cam.dist = Math.max(3.0, Math.min(150.0, this.cam.dist * Math.exp(e.deltaY * 0.001)));
        }, { passive: false });
    }

    updateRay(lx, ly) {
        if (!this.scene || typeof this.scene.unprojectLocal !== 'function') return;
        const r = this.scene.unprojectLocal(lx, ly);
        if (r) {
            this.mouseRay = { origin: r.origin, dir: r.dir };
        }
    }

    tryGrab() {
        if (!this.mouseRay) return;
        const { origin, dir } = this.mouseRay;

        // Cast ray in physics world
        const hit = Physics.raycastClosest(
            origin[0], origin[1], origin[2],
            dir[0], dir[1], dir[2],
            200
        );

        if (hit && hit.bodyId) {
            const bodyProps = Physics.getBodyProperties ? Physics.getBodyProperties(hit.bodyId) : null;
            const tf = Physics.getTransform(hit.bodyId);
            if (!tf) return;

            // Compute distance from camera
            const hitPos = hit.position || { x: origin[0] + dir[0] * hit.distance, y: origin[1] + dir[1] * hit.distance, z: origin[2] + dir[2] * hit.distance };
            const dist = Math.hypot(hitPos.x - origin[0], hitPos.y - origin[1], hitPos.z - origin[2]);

            this.grabbed = {
                tag: hit.bodyId,
                targetDistance: dist,
                hitPos: { ...hitPos },
                bodyPos: { ...tf.position }
            };

            Physics.activate(hit.bodyId);
            this.springRod.setVisible(true);
        }
    }

    releaseGrab() {
        if (this.grabbed) {
            this.grabbed = null;
            this.springRod.setVisible(false);
        }
    }

    update(dt) {
        if (!this.grabbed || !this.mouseRay) {
            this.springRod.setVisible(false);
            return;
        }

        const { tag, targetDistance } = this.grabbed;
        const tf = Physics.getTransform(tag);
        if (!tf) {
            this.releaseGrab();
            return;
        }

        Physics.activate(tag);

        const { origin, dir } = this.mouseRay;
        const targetX = origin[0] + dir[0] * targetDistance;
        const targetY = origin[1] + dir[1] * targetDistance;
        const targetZ = origin[2] + dir[2] * targetDistance;

        const curX = tf.position.x;
        const curY = tf.position.y;
        const curZ = tf.position.z;

        const diffX = targetX - curX;
        const diffY = targetY - curY;
        const diffZ = targetZ - curZ;

        // Spring-damper force calculation
        const kSpring = 280.0;
        const kDamping = 12.0;

        const vel = Physics.getVelocity ? Physics.getVelocity(tag) : { x: 0, y: 0, z: 0 };
        const vx = vel.x || 0, vy = vel.y || 0, vz = vel.z || 0;

        const fx = diffX * kSpring - vx * kDamping;
        const fy = diffY * kSpring - vy * kDamping;
        const fz = diffZ * kSpring - vz * kDamping;

        Physics.addImpulse(tag, fx * dt, fy * dt, fz * dt);

        // Visual spring line
        this.springRod.set(
            { x: curX, y: curY, z: curZ },
            { x: targetX, y: targetY, z: targetZ }
        );
        this.springRod.setVisible(true);
    }
}
