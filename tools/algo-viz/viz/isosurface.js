// Isosurface extraction comparison: marching cubes vs dual contour vs surface
// nets. Same scalar field, same iso level — different algorithm. The field
// itself can come from a sphere/torus distance function or noise.

(function () {
    const ALGOS = ['marchingCubes', 'dualContour', 'surfaceNets'];
    const FIELDS = ['sphere', 'torus', 'noise', 'gyroid'];

    function buildField(kind, n, seed) {
        const field = new Float32Array(n * n * n);
        const half = (n - 1) * 0.5;
        const r = half * 0.7;

        if (kind === 'noise') {
            const base = FastNoise.Simplex();
            const fbm = FastNoise.FractalFBm();
            fbm.set('Source', base);
            fbm.set('Octaves', 3);
            // Sample a 3D field by stacking 2D slices — quick and good enough
            // for visualization.
            for (let z = 0; z < n; z++) {
                const slice = fbm.genUniformGrid2D(0, z * 13, n, n, 0.06, seed);
                for (let i = 0; i < n * n; i++) {
                    // Push toward sphere shell so we always get a closed surface.
                    const x = i % n, y = (i / n) | 0;
                    const dx = x - half, dy = y - half, dz = z - half;
                    const d = Math.sqrt(dx*dx + dy*dy + dz*dz) - r;
                    field[z * n * n + i] = d * 0.4 - slice[i] * 1.6;
                }
            }
            return field;
        }

        for (let z = 0; z < n; z++) {
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    const dx = x - half, dy = y - half, dz = z - half;
                    let v;
                    if (kind === 'sphere') {
                        v = Math.sqrt(dx*dx + dy*dy + dz*dz) - r;
                    } else if (kind === 'torus') {
                        const R = r * 0.7, tr = r * 0.3;
                        const q = Math.sqrt(dx*dx + dz*dz) - R;
                        v = Math.sqrt(q*q + dy*dy) - tr;
                    } else { // gyroid clipped to sphere (intersection = max)
                        const k = 0.45;
                        const sx = Math.sin(dx*k), cx = Math.cos(dx*k);
                        const sy = Math.sin(dy*k), cy = Math.cos(dy*k);
                        const sz = Math.sin(dz*k), cz = Math.cos(dz*k);
                        const sd = Math.sqrt(dx*dx + dy*dy + dz*dz) - r;
                        v = Math.max(sx*cy + sy*cz + sz*cx, sd);
                    }
                    field[z * n * n + y * n + x] = v;
                }
            }
        }
        return field;
    }

    VIZ.push({
        id: 'isosurface',
        name: 'Isosurface extraction',
        category: 'Voxels & Geometry',
        subtitle: 'bromesh: same scalar field through marching cubes / dual contour / surface nets.',

        init({ stage, params }) {
            const canvas = document.createElement('canvas');
            stage.appendChild(canvas);
            // Force layout so scene context captures correct viewport size.
            void canvas.offsetWidth;
            const scene = canvas.getContext('scene');

            scene.setToneMap({ mode: 'aces', exposure: 1.0 });
            scene.setAmbient({ color: [0.10, 0.11, 0.13] });
            scene.createLight({
                type: 'directional',
                direction: [-0.4, -1.0, -0.3],
                color: [1.0, 0.96, 0.88], intensity: 3.2, castsShadow: true,
            });
            scene.createLight({
                type: 'directional',
                direction: [0.6, -0.4, 0.5],
                color: [0.7, 0.82, 1.0], intensity: 1.0,
            });

            const cam = Camera.createOrbit({ target: [0, 0, 0], dist: 28 });
            scene.setCamera(Camera.orbitViewOpts(cam, canvas));

            const state = {
                algo: 'marchingCubes',
                field: 'sphere',
                gridN: 48,
                isoLevel: 0,
                cellSize: 0.5,
                seed: 1,
                mesh: null,
                fieldData: null,
                animFrame: null,
            };

            function rebuildField() {
                state.fieldData = buildField(state.field, state.gridN, state.seed);
                rebuildMesh();
            }

            function rebuildMesh() {
                if (state.mesh) { state.mesh.destroy(); state.mesh = null; }
                const n = state.gridN;
                const built = Mesh[state.algo](state.fieldData, n, n, n,
                                               state.isoLevel, state.cellSize);
                if (!built) return;
                const offset = -(n - 1) * 0.5 * state.cellSize;
                state.mesh = scene.createMesh({
                    data: built,
                    color: [0.55, 0.75, 0.95],
                    metallic: 0.05,
                    roughness: 0.55,
                    x: offset, y: offset, z: offset,
                });
            }

            // --- camera input ----------------------------------------------------
            let dragging = null;
            canvas.addEventListener('mousedown', e => {
                dragging = { btn: e.button, x: e.clientX, y: e.clientY };
            });
            window.addEventListener('mousemove', e => {
                if (!dragging) return;
                const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
                dragging.x = e.clientX; dragging.y = e.clientY;
                if (dragging.btn === 2 || dragging.btn === 0) Camera.orbitLook(cam, dx, dy);
                else if (dragging.btn === 1) Camera.orbitPan(cam, dx, dy);
                scene.setCamera(Camera.orbitViewOpts(cam, canvas));
            });
            window.addEventListener('mouseup', () => { dragging = null; });
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            canvas.addEventListener('wheel', e => {
                cam.dist = Math.max(2, Math.min(80, cam.dist + e.deltaY * 0.02));
                scene.setCamera(Camera.orbitViewOpts(cam, canvas));
                e.preventDefault();
            });

            // Slow auto-rotate when the user isn't dragging.
            function tick() {
                if (!dragging) {
                    Camera.orbitLook(cam, 0.4, 0);
                    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
                }
                state.animFrame = requestAnimationFrame(tick);
            }

            // Params
            AVUI.mkSelect(params, 'algo', ALGOS, state.algo,
                v => { state.algo = v; rebuildMesh(); });
            AVUI.mkSelect(params, 'field', FIELDS, state.field,
                v => { state.field = v; rebuildField(); });
            AVUI.mkRange(params, 'iso', state.isoLevel, -3.0, 3.0, 0.05,
                v => { state.isoLevel = v; rebuildMesh(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'grid', state.gridN, 16, 80, 4,
                v => { state.gridN = v | 0; rebuildField(); }, v => `${v|0}`);
            AVUI.mkRange(params, 'cell', state.cellSize, 0.2, 1.0, 0.05,
                v => { state.cellSize = v; rebuildMesh(); }, v => v.toFixed(2));
            AVUI.mkNumber(params, 'seed', state.seed, 1,
                v => { state.seed = v | 0; if (state.field === 'noise') rebuildField(); });

            rebuildField();
            tick();
            return { scene, state };
        },

        destroy(handle) {
            if (handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.state.mesh) handle.state.mesh.destroy();
        },
    });
})();
