// Damped spherical orbit camera + smooth manifold morph animator + exact GPU projection parity.

export class OrbitView {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.yaw = opts.yaw ?? 0.45;
        this.pitch = opts.pitch ?? 0.35;
        this.dist = opts.dist ?? 3.0;
        this.minDist = opts.minDist ?? 0.2;
        this.maxDist = opts.maxDist ?? 40.0;
        this.target = (opts.target && opts.target.slice(0, 3)) || [0, 0, 0];

        this.goalYaw = this.yaw;
        this.goalPitch = this.pitch;
        this.goalDist = this.dist;
        this.goalTarget = this.target.slice();

        this.fromManifold = 0;
        this.toManifold = 0;
        this.morphT = 1.0;
        this.morphSpeed = opts.morphSpeed ?? 2.6;
        this.autoRotate = !!opts.autoRotate;
        this.autoRotateSpeed = opts.autoRotateSpeed ?? 0.08;

        this.fovScale = opts.fovScale ?? 0.92;
        this.onProbe = opts.onProbe || null;
        this._bindEvents();
    }

    setManifold(idx) {
        const next = idx | 0;
        if (next === this.toManifold && this.morphT >= 1.0) return;
        this.fromManifold = this.morphT < 0.5 ? this.fromManifold : this.toManifold;
        this.toManifold = next;
        this.morphT = 0.0;
    }

    setView(opts) {
        if (opts.yaw != null) this.goalYaw = opts.yaw;
        if (opts.pitch != null) this.goalPitch = opts.pitch;
        if (opts.dist != null) this.goalDist = opts.dist;
        if (opts.target) this.goalTarget = [opts.target[0], opts.target[1], opts.target[2]];
        if (opts.immediate) {
            this.yaw = this.goalYaw;
            this.pitch = this.goalPitch;
            this.dist = this.goalDist;
            this.target = this.goalTarget.slice();
        }
    }

    step(dt) {
        const s = Math.min(0.05, Math.max(0.0005, dt));
        if (this.autoRotate) {
            this.goalYaw += s * this.autoRotateSpeed;
        }
        const k = 1.0 - Math.exp(-s * 14.0);
        this.yaw += (this.goalYaw - this.yaw) * k;
        this.pitch += (this.goalPitch - this.pitch) * k;
        this.dist += (this.goalDist - this.dist) * k;
        this.target[0] += (this.goalTarget[0] - this.target[0]) * k;
        this.target[1] += (this.goalTarget[1] - this.target[1]) * k;
        this.target[2] += (this.goalTarget[2] - this.target[2]) * k;

        if (this.morphT < 1.0) {
            this.morphT = Math.min(1.0, this.morphT + s * this.morphSpeed);
        }
    }

    get smoothMorph() {
        const t = this.morphT;
        return t * t * (3.0 - 2.0 * t);
    }

    camVecs() {
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const rx = cy, ry = 0.0, rz = -sy;
        const ux = -sp * sy, uy = cp, uz = -sp * cy;
        const fx = -cp * sy, fy = -sp, fz = -cp * cy;
        return {
            R: [rx, ry, rz],
            U: [ux, uy, uz],
            F: [fx, fy, fz],
            T: this.target,
            dist: this.dist,
        };
    }

    // Builds 4 vec4 camera parameters matching sci::splat::project_point:
    //   camR = [rx, ry, rz, dist], camU = [ux, uy, uz, fovScale],
    //   camF = [fx, fy, fz, 0], camT = [tx, ty, tz, 0]
    gpuCamParams(w, h) {
        const v = this.camVecs();
        const fpx = Math.min(w, h) * this.fovScale;
        return {
            camR: [v.R[0], v.R[1], v.R[2], this.dist],
            camU: [v.U[0], v.U[1], v.U[2], fpx],
            camF: [v.F[0], v.F[1], v.F[2], 0.0],
            camT: [this.target[0], this.target[1], this.target[2], 0.0],
        };
    }

    project(x, y, z, w, h) {
        const v = this.camVecs();
        const dx = x - this.target[0];
        const dy = y - this.target[1];
        const dz = z - this.target[2];
        const depth = this.dist + dx * v.F[0] + dy * v.F[1] + dz * v.F[2];
        if (depth <= 0.05) return null;
        const px = dx * v.R[0] + dy * v.R[1] + dz * v.R[2];
        const py = dx * v.U[0] + dy * v.U[1] + dz * v.U[2];
        const fpx = Math.min(w, h) * this.fovScale;
        return {
            x: w * 0.5 + (px / depth) * fpx,
            y: h * 0.5 - (py / depth) * fpx,
            depth,
        };
    }

    // Maps screen pixel onto view plane passing through `target` (depth == dist).
    unprojectAtTarget(px, py, w, h) {
        const v = this.camVecs();
        const fpx = Math.min(w, h) * this.fovScale;
        const nx = (px - w * 0.5) / fpx * this.dist;
        const ny = (h * 0.5 - py) / fpx * this.dist;
        return [
            this.target[0] + v.R[0] * nx + v.U[0] * ny,
            this.target[1] + v.R[1] * nx + v.U[1] * ny,
            this.target[2] + v.R[2] * nx + v.U[2] * ny,
        ];
    }

    _bindEvents() {
        let mode = 0; // 1 = orbit, 2 = pan
        let lastX = 0, lastY = 0, downX = 0, downY = 0;

        this.canvas.addEventListener('pointerdown', (e) => {
            lastX = downX = e.clientX;
            lastY = downY = e.clientY;
            mode = (e.button === 2 || e.shiftKey) ? 2 : 1;
            try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (!mode) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            if (mode === 1) {
                this.autoRotate = false;
                this.goalYaw -= dx * 0.0065;
                this.goalPitch = Math.max(-1.48, Math.min(1.48, this.goalPitch + dy * 0.0065));
            } else if (mode === 2) {
                const v = this.camVecs();
                const scale = this.goalDist * 0.0018;
                this.goalTarget[0] += (-v.R[0] * dx + v.U[0] * dy) * scale;
                this.goalTarget[1] += (-v.R[1] * dx + v.U[1] * dy) * scale;
                this.goalTarget[2] += (-v.R[2] * dx + v.U[2] * dy) * scale;
            }
        });

        const endDrag = (e) => {
            if (mode === 1 && Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && this.onProbe) {
                const rect = this.canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const pt = this.unprojectAtTarget(sx, sy, Math.max(1, rect.width), Math.max(1, rect.height));
                this.onProbe(pt, sx, sy, e);
            }
            mode = 0;
        };
        this.canvas.addEventListener('pointerup', endDrag);
        this.canvas.addEventListener('pointercancel', () => { mode = 0; });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const f = Math.exp(e.deltaY * 0.0011);
            this.goalDist = Math.max(this.minDist, Math.min(this.maxDist, this.goalDist * f));
        }, { passive: false });
    }
}
