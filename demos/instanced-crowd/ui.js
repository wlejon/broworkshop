// ui.js — HUD bindings, input handling, metrics, and camera interaction.

export class CrowdUI {
    constructor(canvas, scene, cam, crowd, onConfigChange) {
        this.canvas = canvas;
        this.scene = scene;
        this.cam = cam;
        this.crowd = crowd;
        this.onConfigChange = onConfigChange;

        this.config = {
            count: 10000,
            pattern: 'swarming',
            colorScheme: 'cyberpunk',
            meshType: 'arrow',
            speed: 1.0,
            scale: 1.0,
            spread: 1.0,
            mouseMode: 'attract',
            orientToVelocity: true,
            noise: true,
            autoOrbit: false,
            paused: false
        };

        this.mouse3D = null;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
        this.fpsLast = performance.now();

        this.initDOM();
        this.initCameraControls();
        this.initKeyboard();
    }

    initDOM() {
        // Count buttons
        const countGroup = document.getElementById('count-group');
        if (countGroup) {
            const btns = countGroup.querySelectorAll('.btn-pill');
            btns.forEach(btn => {
                btn.addEventListener('click', () => {
                    btns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const c = parseInt(btn.dataset.count, 10);
                    this.config.count = c;
                    this.crowd.setCount(c);
                    const countEl = document.getElementById('count-val');
                    if (countEl) countEl.textContent = c.toLocaleString();
                });
            });
        }

        // Pattern selector
        const patternSel = document.getElementById('pattern-select');
        if (patternSel) {
            patternSel.addEventListener('change', (e) => {
                this.config.pattern = e.target.value;
            });
        }

        // Color selector
        const colorSel = document.getElementById('color-select');
        if (colorSel) {
            colorSel.addEventListener('change', (e) => {
                this.config.colorScheme = e.target.value;
            });
        }

        // Mesh selector
        const meshSel = document.getElementById('mesh-select');
        if (meshSel) {
            meshSel.addEventListener('change', (e) => {
                this.config.meshType = e.target.value;
                this.crowd.setMeshType(e.target.value);
            });
        }

        // Sliders
        const speedSl = document.getElementById('speed-slider');
        const speedVal = document.getElementById('speed-val');
        if (speedSl) {
            speedSl.addEventListener('input', (e) => {
                this.config.speed = parseFloat(e.target.value);
                if (speedVal) speedVal.textContent = this.config.speed.toFixed(2) + 'x';
            });
        }

        const scaleSl = document.getElementById('scale-slider');
        const scaleVal = document.getElementById('scale-val');
        if (scaleSl) {
            scaleSl.addEventListener('input', (e) => {
                this.config.scale = parseFloat(e.target.value);
                if (scaleVal) scaleVal.textContent = this.config.scale.toFixed(2) + 'x';
            });
        }

        const spreadSl = document.getElementById('spread-slider');
        const spreadVal = document.getElementById('spread-val');
        if (spreadSl) {
            spreadSl.addEventListener('input', (e) => {
                this.config.spread = parseFloat(e.target.value);
                if (spreadVal) spreadVal.textContent = this.config.spread.toFixed(1) + 'x';
            });
        }

        // Mouse mode selector
        const mouseSel = document.getElementById('mouse-mode-select');
        if (mouseSel) {
            mouseSel.addEventListener('change', (e) => {
                this.config.mouseMode = e.target.value;
            });
        }

        // Toggles
        const orientTog = document.getElementById('orient-toggle');
        if (orientTog) {
            orientTog.addEventListener('change', (e) => {
                this.config.orientToVelocity = e.target.checked;
            });
        }

        const noiseTog = document.getElementById('noise-toggle');
        if (noiseTog) {
            noiseTog.addEventListener('change', (e) => {
                this.config.noise = e.target.checked;
            });
        }

        const autoTog = document.getElementById('auto-orbit-toggle');
        if (autoTog) {
            autoTog.addEventListener('change', (e) => {
                this.config.autoOrbit = e.target.checked;
            });
        }
    }

    initCameraControls() {
        let isRightDown = false;
        let isMiddleDown = false;
        let isLeftDown = false;

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) isRightDown = true;
            if (e.button === 1) isMiddleDown = true;
            if (e.button === 0) isLeftDown = true;
            this.updateMouseRay(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) isRightDown = false;
            if (e.button === 1) isMiddleDown = false;
            if (e.button === 0) {
                isLeftDown = false;
                if (this.config.mouseMode !== 'attract' && this.config.mouseMode !== 'repel') {
                    this.mouse3D = null;
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isRightDown && typeof Camera !== 'undefined' && Camera.orbitLook) {
                Camera.orbitLook(this.cam, e.movementX, e.movementY);
            }
            if (isMiddleDown && typeof Camera !== 'undefined' && Camera.orbitPan) {
                Camera.orbitPan(this.cam, e.movementX, e.movementY);
            }
            this.updateMouseRay(e.clientX, e.clientY);
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.cam.dist = Math.max(5.0, Math.min(250.0, this.cam.dist * Math.exp(e.deltaY * 0.001)));
        }, { passive: false });
    }

    updateMouseRay(clientX, clientY) {
        if (!this.scene || typeof this.scene.unprojectLocal !== 'function') return;
        const rect = this.canvas.getBoundingClientRect();
        const lx = clientX - rect.left;
        const ly = clientY - rect.top;

        const ray = this.scene.unprojectLocal(lx, ly);
        if (!ray) return;

        // Intersect with plane passing through origin facing camera or Y=0
        const ro = ray.origin;
        const rd = ray.dir;

        // Plane intersection at y=0 or perpendicular to view at pivot
        const pivotY = this.cam.pivot ? this.cam.pivot[1] : 0;
        const denom = rd[1];
        if (Math.abs(denom) > 1e-4) {
            const t = (pivotY - ro[1]) / denom;
            if (t > 0 && t < 300) {
                this.mouse3D = [ro[0] + rd[0] * t, pivotY, ro[2] + rd[2] * t];
                return;
            }
        }

        // Fallback: point at distance 40 along ray
        this.mouse3D = [ro[0] + rd[0] * 40, ro[1] + rd[1] * 40, ro[2] + rd[2] * 40];
    }

    initKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                this.config.paused = !this.config.paused;
            } else if (e.key === 'r' || e.key === 'R') {
                if (typeof Camera !== 'undefined' && Camera.orbitReframe) {
                    Camera.orbitReframe(this.cam, [0, 0, 0], 48);
                }
            }
        });
    }

    updateMetrics(now) {
        this.fpsAccum += now - this.fpsLast;
        this.fpsLast = now;
        this.fpsFrames++;

        if (this.fpsFrames >= 20) {
            const avgMs = this.fpsAccum / this.fpsFrames;
            const fps = Math.round(1000 / avgMs);

            const fpsEl = document.getElementById('fps-val');
            const ftEl = document.getElementById('frametime-val');

            if (fpsEl) {
                fpsEl.textContent = fps + ' FPS';
                fpsEl.className = 'metric-val ' + (fps >= 55 ? 'green' : (fps >= 30 ? 'amber' : 'red'));
            }
            if (ftEl) {
                ftEl.textContent = avgMs.toFixed(1) + ' ms';
            }

            this.fpsAccum = 0;
            this.fpsFrames = 0;
        }
    }
}
