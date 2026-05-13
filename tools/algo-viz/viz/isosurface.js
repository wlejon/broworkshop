// Isosurface extraction — marching cubes / dual contour / surface nets.
// All three turn a scalar 3D field into a polygon mesh by finding where
// the field crosses the iso level. The viz makes both halves of that
// pipeline visible:
//   - LEFT  3D scene view of the extracted mesh (the result)
//   - RIGHT 2D slice through the field with the iso contour drawn via
//           marching squares, and "active" cells (cells the algorithm
//           would emit a polygon for) highlighted
// Scrub the slice slider to move through Z. As you change `iso`, you can
// watch the contour move on the slice AND the surface deform on the mesh.

(function () {
    const ALGOS = ['marchingCubes', 'dualContour', 'surfaceNets'];
    const FIELDS = ['sphere', 'torus', 'noise', 'gyroid'];

    // Per-algorithm one-liner shown in the description panel.
    const ALGO_BLURB = {
        marchingCubes: 'Marching Cubes: each cell tests 8 corners against the iso level; '
            + 'the 256-case table emits up to 5 triangles whose vertices are linearly '
            + 'interpolated along each crossing edge. Always produces a topologically '
            + 'consistent surface; sharp features get rounded.',
        dualContour: 'Dual Contour: emits one vertex per active cell, placed by '
            + 'minimizing a QEF over edge crossings + normals — this preserves sharp '
            + 'features (corners, creases). Edges connect dual vertices of cells '
            + 'sharing an active edge.',
        surfaceNets: 'Surface Nets: emit one vertex per active cell at the centroid of '
            + 'its edge crossings (no normals — no QEF). Cheap, smooth, and topologically '
            + 'sound; sharp features are rounded off but less aggressively than MC.',
    };

    function buildField(kind, n, seed) {
        const field = new Float32Array(n * n * n);
        const half = (n - 1) * 0.5;
        const r = half * 0.7;

        if (kind === 'noise') {
            const base = FastNoise.Simplex();
            const fbm = FastNoise.FractalFBm();
            fbm.set('Source', base); fbm.set('Octaves', 3);
            for (let z = 0; z < n; z++) {
                const slice = fbm.genUniformGrid2D(0, z * 13, n, n, 0.06, seed);
                for (let i = 0; i < n * n; i++) {
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
                    } else {
                        const k = 0.45;
                        const sx = Math.sin(dx*k), cx_ = Math.cos(dx*k);
                        const sy = Math.sin(dy*k), cy = Math.cos(dy*k);
                        const sz = Math.sin(dz*k), cz = Math.cos(dz*k);
                        const sd = Math.sqrt(dx*dx + dy*dy + dz*dz) - r;
                        v = Math.max(sx*cy + sy*cz + sz*cx_, sd);
                    }
                    field[z * n * n + y * n + x] = v;
                }
            }
        }
        return field;
    }

    // Marching-squares case table.  Each entry is a list of edges to draw,
    // where edge 0..3 means: 0=bottom (00→10), 1=right (10→11), 2=top (11→01),
    // 3=left (01→00). Each pair of values [a,b] is one line segment.
    // Built from the standard 16-case table (cases 5 and 10 are the saddle cases).
    const MSQ_TABLE = [
        [],           // 0
        [3, 0],       // 1
        [0, 1],       // 2
        [3, 1],       // 3
        [1, 2],       // 4
        [3, 2, 1, 0], // 5 saddle (split toward outside)
        [0, 2],       // 6
        [3, 2],       // 7
        [2, 3],       // 8
        [2, 0],       // 9
        [1, 0, 3, 2], // 10 saddle
        [2, 1],       // 11
        [1, 3],       // 12
        [1, 0],       // 13
        [0, 3],       // 14
        [],           // 15
    ];

    VIZ.push({
        id: 'isosurface',
        name: 'Isosurface extraction',
        category: 'Voxels & Geometry',
        subtitle: 'Same scalar field through marching cubes / dual contour / surface nets — and a 2D slice through that field with the iso contour drawn.',

        init({ stage, params }) {
            // --- layout -----------------------------------------------------------
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;inset:0;display:flex;gap:6px;padding:6px;box-sizing:border-box';
            stage.appendChild(wrap);

            const leftCol = document.createElement('div');
            leftCol.style.cssText = 'flex:1 1 auto;position:relative;min-width:0;background:#080808;border:1px solid #222';
            wrap.appendChild(leftCol);
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
            leftCol.appendChild(canvas);
            void canvas.offsetWidth;
            const scene = canvas.getContext('scene');

            const meshLabel = document.createElement('div');
            meshLabel.style.cssText = 'position:absolute;left:8px;top:8px;'
                + 'padding:4px 8px;background:rgba(0,0,0,0.6);color:#ddd;'
                + 'font:11px monospace;white-space:pre;pointer-events:none';
            leftCol.appendChild(meshLabel);

            const rightCol = document.createElement('div');
            rightCol.style.cssText = 'flex:0 0 320px;display:flex;flex-direction:column;gap:6px;min-height:0';
            wrap.appendChild(rightCol);

            const sliceBox = document.createElement('div');
            sliceBox.style.cssText = 'position:relative;background:#080808;border:1px solid #222;width:100%;height:320px;flex:0 0 auto';
            rightCol.appendChild(sliceBox);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated';
            sliceBox.appendChild(sliceCanvas);

            const sliceLabel = document.createElement('div');
            sliceLabel.style.cssText = 'position:absolute;left:6px;top:6px;'
                + 'padding:3px 6px;background:rgba(0,0,0,0.6);color:#ddd;'
                + 'font:10px monospace;white-space:pre;pointer-events:none';
            sliceBox.appendChild(sliceLabel);

            const sliceSlider = document.createElement('input');
            sliceSlider.type = 'range';
            sliceSlider.style.cssText = 'width:100%';
            rightCol.appendChild(sliceSlider);

            const algoBlurb = document.createElement('div');
            algoBlurb.style.cssText = 'padding:8px;background:#0c0c0c;border:1px solid #1c1c1c;'
                + 'font:11px monospace;color:#bbb;line-height:1.5;flex:1 1 auto;overflow:auto';
            rightCol.appendChild(algoBlurb);

            // --- scene setup ------------------------------------------------------
            scene.setToneMap({ mode: 'aces', exposure: 1.0 });
            scene.setAmbient({ color: [0.10, 0.11, 0.13] });
            scene.createLight({
                type: 'directional', direction: [-0.4, -1.0, -0.3],
                color: [1.0, 0.96, 0.88], intensity: 3.2, castsShadow: true,
            });
            scene.createLight({
                type: 'directional', direction: [0.6, -0.4, 0.5],
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
                showActive: true,
                sliceZ: 24,
                autoRotate: true,
                mesh: null,
                fieldData: null,
                triCount: 0,
                animFrame: null,
            };

            function rebuildField() {
                state.fieldData = buildField(state.field, state.gridN, state.seed);
                state.sliceZ = Math.min(state.sliceZ, state.gridN - 1);
                sliceSlider.min = 0; sliceSlider.max = state.gridN - 1;
                sliceSlider.value = state.sliceZ;
                rebuildMesh();
                redrawSlice();
            }

            function rebuildMesh() {
                if (state.mesh) { state.mesh.destroy(); state.mesh = null; }
                const n = state.gridN;
                const built = Mesh[state.algo](state.fieldData, n, n, n,
                                               state.isoLevel, state.cellSize);
                state.triCount = 0;
                if (!built) return;
                if (built.indices) state.triCount = built.indices.length / 3;
                else if (built.positions) state.triCount = built.positions.length / 9;
                const offset = -(n - 1) * 0.5 * state.cellSize;
                state.mesh = scene.createMesh({
                    data: built,
                    color: [0.55, 0.75, 0.95],
                    metallic: 0.05,
                    roughness: 0.55,
                    x: offset, y: offset, z: offset,
                });
                meshLabel.textContent =
                    `algo:    ${state.algo}\n` +
                    `field:   ${state.field}\n` +
                    `grid:    ${n}³ = ${n*n*n} samples\n` +
                    `iso:     ${state.isoLevel.toFixed(2)}\n` +
                    `tris:    ${state.triCount | 0}`;
                algoBlurb.textContent = ALGO_BLURB[state.algo];
            }

            // --- slice rendering (marching squares for the iso contour) ----------
            //
            // Two-pass: first build the colored pixel field at n×n on an offscreen
            // canvas, then draw it scaled onto the visible canvas (at display res)
            // and overlay crisp marching-squares contour lines on top.

            const fieldOff = document.createElement('canvas');
            fieldOff.width = 1; fieldOff.height = 1;
            const fieldCtx = fieldOff.getContext('2d');

            function redrawSlice() {
                const n = state.gridN;
                const z = Math.max(0, Math.min(n - 1, state.sliceZ | 0));
                const iso = state.isoLevel;
                const sliceStart = z * n * n;

                // Pass 1: build n×n pixel image on offscreen.
                if (fieldOff.width !== n) { fieldOff.width = n; fieldOff.height = n; }
                const img = fieldCtx.createImageData(n, n);

                let mn = Infinity, mx = -Infinity;
                for (let i = 0; i < n * n; i++) {
                    const v = state.fieldData[sliceStart + i];
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }

                let activeCells = 0;
                // Track which cells are "active" (sign change) so we can tint them
                // in the pixel pass. A cell (x,y) is the quad with corners
                // (x,y), (x+1,y), (x+1,y+1), (x,y+1).
                const active = state.showActive
                    ? new Uint8Array((n - 1) * (n - 1)) : null;

                for (let y = 0; y < n; y++) {
                    for (let x = 0; x < n; x++) {
                        const v = state.fieldData[sliceStart + y * n + x];
                        const d = v - iso;
                        const lo = mn - iso, hi = mx - iso;
                        const t = d < 0 ? -d / Math.max(1e-6, -lo)
                                        :  d / Math.max(1e-6,  hi);
                        let r, g, b;
                        if (d < 0) {
                            r = 20 + (1 - t) * 50;
                            g = 60 + (1 - t) * 80;
                            b = 140 + (1 - t) * 50;
                        } else {
                            r = 130 + (1 - t) * 80;
                            g = 90  + (1 - t) * 60;
                            b = 40  + (1 - t) * 30;
                        }
                        const p = (y * n + x) * 4;
                        img.data[p  ] = r | 0;
                        img.data[p+1] = g | 0;
                        img.data[p+2] = b | 0;
                        img.data[p+3] = 255;
                    }
                }

                // Count active cells + (optionally) tint them.
                for (let y = 0; y < n - 1; y++) {
                    for (let x = 0; x < n - 1; x++) {
                        const v00 = state.fieldData[sliceStart + y * n + x] - iso;
                        const v10 = state.fieldData[sliceStart + y * n + (x + 1)] - iso;
                        const v11 = state.fieldData[sliceStart + (y + 1) * n + (x + 1)] - iso;
                        const v01 = state.fieldData[sliceStart + (y + 1) * n + x] - iso;
                        let code = 0;
                        if (v00 < 0) code |= 1;
                        if (v10 < 0) code |= 2;
                        if (v11 < 0) code |= 4;
                        if (v01 < 0) code |= 8;
                        if (code === 0 || code === 15) continue;
                        activeCells++;
                        if (active) {
                            active[y * (n - 1) + x] = code;
                            const p = (y * n + x) * 4;
                            img.data[p  ] = Math.min(255, img.data[p  ] + 50);
                            img.data[p+1] = Math.min(255, img.data[p+1] + 50);
                            img.data[p+2] = Math.min(255, img.data[p+2] + 10);
                        }
                    }
                }
                fieldCtx.putImageData(img, 0, 0);

                // Pass 2: draw scaled to the visible canvas + contour overlay.
                const rect = sliceCanvas.getBoundingClientRect();
                const W = Math.max(1, (rect.width  | 0));
                const H = Math.max(1, (rect.height | 0));
                if (sliceCanvas.width !== W || sliceCanvas.height !== H) {
                    sliceCanvas.width = W; sliceCanvas.height = H;
                }
                const ctx = sliceCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, W, H);
                ctx.drawImage(fieldOff, 0, 0, W, H);

                // Marching-squares contour, in pixel space.
                const sx = W / n, sy = H / n;
                ctx.strokeStyle = '#ffe066';
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                for (let y = 0; y < n - 1; y++) {
                    for (let x = 0; x < n - 1; x++) {
                        const v00 = state.fieldData[sliceStart + y * n + x] - iso;
                        const v10 = state.fieldData[sliceStart + y * n + (x + 1)] - iso;
                        const v11 = state.fieldData[sliceStart + (y + 1) * n + (x + 1)] - iso;
                        const v01 = state.fieldData[sliceStart + (y + 1) * n + x] - iso;
                        let code = 0;
                        if (v00 < 0) code |= 1;
                        if (v10 < 0) code |= 2;
                        if (v11 < 0) code |= 4;
                        if (v01 < 0) code |= 8;
                        if (code === 0 || code === 15) continue;
                        const ex = [
                            x + lerpT(v00, v10), y,
                            x + 1, y + lerpT(v10, v11),
                            x + lerpT(v01, v11), y + 1,
                            x, y + lerpT(v00, v01),
                        ];
                        const segs = MSQ_TABLE[code];
                        for (let s = 0; s < segs.length; s += 2) {
                            const a = segs[s], b = segs[s + 1];
                            ctx.moveTo(ex[a*2] * sx, ex[a*2 + 1] * sy);
                            ctx.lineTo(ex[b*2] * sx, ex[b*2 + 1] * sy);
                        }
                    }
                }
                ctx.stroke();

                sliceLabel.textContent =
                    `slice z = ${z} / ${n - 1}\n` +
                    `range  ${mn.toFixed(2)} .. ${mx.toFixed(2)}\n` +
                    `active cells: ${activeCells}`;
            }

            function lerpT(a, b) {
                const denom = a - b;
                if (Math.abs(denom) < 1e-9) return 0.5;
                return a / denom;
            }

            // --- camera input ----------------------------------------------------
            let dragging = null;
            canvas.addEventListener('mousedown', e => {
                state.autoRotate = false;
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

            sliceSlider.oninput = () => {
                state.sliceZ = parseInt(sliceSlider.value, 10);
                redrawSlice();
            };

            function tick() {
                if (state.autoRotate && !dragging) {
                    Camera.orbitLook(cam, 0.4, 0);
                    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
                }
                // Slice canvas adapts to layout size on first paint and on resize.
                // Cheap re-render — 48² scalars on the hot path.
                const rect = sliceCanvas.getBoundingClientRect();
                const W = Math.max(1, rect.width | 0), H = Math.max(1, rect.height | 0);
                if (W > 4 && (sliceCanvas.width !== W || sliceCanvas.height !== H)) {
                    redrawSlice();
                }
                state.animFrame = requestAnimationFrame(tick);
            }

            // --- params ----------------------------------------------------------
            AVUI.mkSelect(params, 'algo', ALGOS, state.algo, v => { state.algo = v; rebuildMesh(); });
            AVUI.mkSelect(params, 'field', FIELDS, state.field, v => { state.field = v; rebuildField(); });
            AVUI.mkRange(params, 'iso', state.isoLevel, -3.0, 3.0, 0.05,
                v => { state.isoLevel = v; rebuildMesh(); redrawSlice(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'grid', state.gridN, 16, 80, 4,
                v => { state.gridN = v | 0; rebuildField(); }, v => `${v|0}`);
            AVUI.mkRange(params, 'cell', state.cellSize, 0.2, 1.0, 0.05,
                v => { state.cellSize = v; rebuildMesh(); }, v => v.toFixed(2));
            AVUI.mkNumber(params, 'seed', state.seed, 1,
                v => { state.seed = v | 0; if (state.field === 'noise') rebuildField(); });
            const activeBtn = AVUI.mkButton(params, 'active cells', () => {
                state.showActive = !state.showActive;
                activeBtn.classList.toggle('toggled', state.showActive);
                redrawSlice();
            });
            activeBtn.classList.toggle('toggled', state.showActive);
            const rotBtn = AVUI.mkButton(params, 'auto-rotate', () => {
                state.autoRotate = !state.autoRotate;
                rotBtn.classList.toggle('toggled', state.autoRotate);
            });
            rotBtn.classList.toggle('toggled', state.autoRotate);

            rebuildField();
            tick();
            return { scene, state, wrap };
        },

        destroy(handle) {
            if (handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.state.mesh) handle.state.mesh.destroy();
            if (handle.wrap) handle.wrap.remove();
        },
    });
})();
