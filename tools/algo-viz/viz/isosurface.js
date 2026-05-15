// Isosurface extraction — visualized as the algorithm RUNNING.
//
// LEFT  3D mesh from the selected algorithm. Unchanged.
// RIGHT One big slice panel that animates the algorithm working cell by
//       cell. A cursor sweeps through active cells in scan order. At each
//       cell, the algorithm's micro-steps unfold over time and you watch
//       the result accumulate behind the cursor:
//
//   marchingCubes
//     highlight cell → classify corners (sign dots fade in) → pulse the
//     matching entry in the 16-case table strip above the slice → draw
//     the segment(s) the table emitted.
//
//   surfaceNets
//     highlight cell → classify corners → edge crossings appear as dots →
//     construction lines from each crossing converge on the cell centroid
//     → dual vertex appears → threads extend to existing neighbor
//     vertices.
//
//   dualContour
//     highlight cell → classify corners → crossings appear → gradient
//     normals extend as arrows from each crossing → tangent constraint
//     lines extend perpendicular through each crossing → vertex appears
//     at the constraints' intersection (QEF solution) → threads to
//     neighbors.
//
// Controls: Play / Pause / Step / Reset, plus a speed slider. Switching
// algo, field, iso, grid, seed, or slice z resets the sweep.

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

    // edges: 0=bottom (00→10), 1=right (10→11), 2=top (11→01), 3=left (01→00)
    const MSQ_TABLE = [
        [], [3,0], [0,1], [3,1], [1,2], [3,2,1,0], [0,2], [3,2],
        [2,3], [2,0], [1,0,3,2], [2,1], [1,3], [1,0], [0,3], [],
    ];

    function lerpT(a, b) {
        const denom = a - b;
        if (Math.abs(denom) < 1e-9) return 0.5;
        return a / denom;
    }

    // Per-case color used by the table strip + matching segments below.
    const CASE_COLOR = (() => {
        const out = new Array(16);
        out[0] = '#1c1c22'; out[15] = '#22221c';
        for (let i = 1; i < 15; i++) {
            const h = ((i - 1) / 14) * 360;
            out[i] = 'hsl(' + h.toFixed(0) + ', 80%, 62%)';
        }
        return out;
    })();

    // Smooth easing in [0,1] for phase progress.
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) {
        return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
    }

    // Phase definitions per algorithm. Each entry: {id, ms}.
    // Phase durations are milliseconds at speed = 1.0.
    const PHASES = {
        marchingCubes: [
            { id: 'highlight', ms: 120 },
            { id: 'classify',  ms: 180 },
            { id: 'lookup',    ms: 220 },
            { id: 'emit',      ms: 260 },
        ],
        surfaceNets: [
            { id: 'highlight', ms: 100 },
            { id: 'classify',  ms: 140 },
            { id: 'crossings', ms: 180 },
            { id: 'average',   ms: 260 },
            { id: 'place',     ms: 160 },
            { id: 'thread',    ms: 180 },
        ],
        dualContour: [
            { id: 'highlight',   ms: 100 },
            { id: 'classify',    ms: 140 },
            { id: 'crossings',   ms: 160 },
            { id: 'normals',     ms: 200 },
            { id: 'constraints', ms: 240 },
            { id: 'solve',       ms: 240 },
            { id: 'thread',      ms: 180 },
        ],
    };

    VIZ.push({
        id: 'isosurface',
        name: 'Isosurface extraction',
        category: 'Voxels & Geometry',
        subtitle: 'Watch the chosen algorithm run cell by cell on a 2D slice — micro-steps animate, the contour/net assembles behind the cursor. MC: lookup-table emit. SN: centroid + threading. DC: QEF from normal constraints.',

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


            // The right column hosts the animation panel + its controls. Two
            // compact rows of controls (action buttons, then mode + speed),
            // then a slice slider row, then the panel which flex-fills the
            // remaining vertical space.
            const rightCol = document.createElement('div');
            rightCol.style.cssText = 'flex:0 0 500px;display:flex;flex-direction:column;'
                + 'gap:6px;min-height:0;min-width:0';
            wrap.appendChild(rightCol);

            // Small helper for a labeled section header (used at top of panel).
            function mkSectionHeader(text) {
                const h = document.createElement('div');
                h.style.cssText = 'font:10px monospace;color:#666;letter-spacing:1px;'
                    + 'text-transform:uppercase;padding:0 2px;flex:0 0 auto';
                h.textContent = text;
                return h;
            }

            // ---- Row 1: action buttons -----------------------------------------
            const bar1 = document.createElement('div');
            bar1.style.cssText = 'display:flex;gap:5px;align-items:center;flex:0 0 auto;'
                + 'padding:6px 7px;background:#0c0c0c;border:1px solid #1c1c1c;'
                + 'font:11px monospace;color:#bbb';
            rightCol.appendChild(bar1);

            function mkBtn(parent, label, onClick) {
                const b = document.createElement('button');
                b.className = 'opbtn';
                b.textContent = label;
                b.style.cssText = 'white-space:nowrap;flex:0 0 auto';
                b.onclick = onClick;
                parent.appendChild(b);
                return b;
            }
            const playBtn = mkBtn(bar1, 'Play', () => {
                state.playing = !state.playing;
                playBtn.textContent = state.playing ? 'Pause' : 'Play';
                playBtn.classList.toggle('toggled', state.playing);
            });
            mkBtn(bar1, 'Step', () => {
                state.playing = false;
                playBtn.textContent = 'Play';
                playBtn.classList.remove('toggled');
                advancePhase(1);
            });
            mkBtn(bar1, 'Skip', () => {
                state.playing = false;
                playBtn.textContent = 'Play';
                playBtn.classList.remove('toggled');
                // Skip flushes whichever phase is in flight: fill → done,
                // stitch → commit all connectors, sweep → finish current cell.
                if (state.filling) {
                    state.ghostAlpha = state.filling.toA;
                    createGhostMesh(state.filling.toA);
                    state.filling = null;
                } else if (state.stitching) {
                    flushStitchRemaining();
                    state.stitching = null;
                    snapshotCurrentSlice();
                } else {
                    completeCurrentCell();
                }
            });
            mkBtn(bar1, 'Finish', () => {
                state.playing = false;
                playBtn.textContent = 'Play';
                playBtn.classList.remove('toggled');
                if (state.filling) {
                    state.ghostAlpha = state.filling.toA;
                    createGhostMesh(state.filling.toA);
                    state.filling = null;
                } else if (state.stitching) {
                    flushStitchRemaining();
                    state.stitching = null;
                    snapshotCurrentSlice();
                } else {
                    finishSlice();
                }
            });
            mkBtn(bar1, 'Reset', () => { resetAnim(); });

            // ---- Row 2: mode toggle + speed -----------------------------------
            const bar2 = document.createElement('div');
            bar2.style.cssText = 'display:flex;gap:8px;align-items:center;flex:0 0 auto;'
                + 'padding:6px 7px;background:#0c0c0c;border:1px solid #1c1c1c;'
                + 'font:11px monospace;color:#bbb';
            rightCol.appendChild(bar2);
            const sweepBtn = mkBtn(bar2, 'Sweep volume', () => {
                state.sweepVolume = !state.sweepVolume;
                sweepBtn.classList.toggle('toggled', state.sweepVolume);
            });
            const speedWrap = document.createElement('div');
            speedWrap.style.cssText = 'display:flex;gap:6px;align-items:center;flex:1 1 auto;min-width:0';
            const speedLbl = document.createElement('span');
            speedLbl.style.cssText = 'color:#888;flex:0 0 auto';
            speedLbl.textContent = 'speed';
            const speedSlider = document.createElement('input');
            // Slider position t ∈ [0,1] maps exponentially to speed ∈ [1,50]x,
            // so small movements near the low end yield small bumps (you can
            // really watch the algorithm), and dragging to the top scrubs
            // through entire slices in a frame.
            speedSlider.type = 'range';
            speedSlider.min = '0'; speedSlider.max = '1';
            speedSlider.step = '0.001'; speedSlider.value = '0';
            speedSlider.style.cssText = 'flex:1 1 auto;min-width:0';
            const speedNum = document.createElement('span');
            speedNum.style.cssText = 'color:#ddd;flex:0 0 auto;min-width:44px;text-align:right';
            speedNum.textContent = '1.0x';
            const SPEED_MAX = 50;
            // Update the readout to show effective ramped speed; called from
            // both the slider and the tick loop.
            function refreshSpeedLabel() {
                speedNum.textContent =
                    state.speed.toFixed(state.speed >= 10 ? 0 : 1) + 'x';
            }
            speedSlider.oninput = () => {
                state.speedExp = parseFloat(speedSlider.value);
                refreshSpeedLabel();
            };
            speedWrap.appendChild(speedLbl);
            speedWrap.appendChild(speedSlider);
            speedWrap.appendChild(speedNum);
            bar2.appendChild(speedWrap);

            // ---- Row 3: slice slider with inline label/stats ------------------
            const sliceRow = document.createElement('div');
            sliceRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex:0 0 auto;'
                + 'padding:6px 7px;background:#0c0c0c;border:1px solid #1c1c1c;'
                + 'font:11px monospace;color:#bbb';
            rightCol.appendChild(sliceRow);
            const sliceLbl = document.createElement('span');
            sliceLbl.style.cssText = 'color:#888;flex:0 0 auto';
            sliceLbl.textContent = 'slice';
            const sliceSlider = document.createElement('input');
            sliceSlider.type = 'range';
            sliceSlider.style.cssText = 'flex:1 1 auto;min-width:0';
            const sliceZNum = document.createElement('span');
            sliceZNum.style.cssText = 'color:#ddd;flex:0 0 auto;font-variant-numeric:tabular-nums';
            sliceZNum.textContent = '0 / 0';
            sliceRow.appendChild(sliceLbl);
            sliceRow.appendChild(sliceSlider);
            sliceRow.appendChild(sliceZNum);

            // ---- Slice stats line (range + active cells), thin and quiet ------
            const sliceLabel = document.createElement('div');
            sliceLabel.style.cssText = 'padding:3px 8px;color:#777;font:10px monospace;'
                + 'flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
            rightCol.appendChild(sliceLabel);

            // ---- Animation panel ----------------------------------------------
            // Box with explicit header (algo + phase + speed) above the canvas,
            // so the live status reads cleanly without overlapping the slice
            // render. The case-table strip (MC only) is drawn at the top of the
            // canvas itself; this header sits above it.
            const panel = document.createElement('div');
            panel.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;'
                + 'position:relative;background:#080808;border:1px solid #222;min-height:0';
            rightCol.appendChild(panel);

            const panelHdr = document.createElement('div');
            panelHdr.style.cssText = 'padding:5px 9px;background:#101015;border-bottom:1px solid #1c1c1c;'
                + 'font:11px monospace;color:#bbb;flex:0 0 auto;display:flex;gap:12px;align-items:center';
            panel.appendChild(panelHdr);
            const hdrAlgo = document.createElement('span');
            hdrAlgo.style.cssText = 'color:#9ad1ff;font-weight:bold;flex:0 0 auto';
            const hdrPhase = document.createElement('span');
            hdrPhase.style.cssText = 'color:#ddd;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            const hdrCell = document.createElement('span');
            hdrCell.style.cssText = 'color:#888;flex:0 0 auto;font-variant-numeric:tabular-nums';
            panelHdr.appendChild(hdrAlgo);
            panelHdr.appendChild(hdrPhase);
            panelHdr.appendChild(hdrCell);

            const panelCvWrap = document.createElement('div');
            panelCvWrap.style.cssText = 'position:relative;flex:1 1 auto;min-height:0';
            panel.appendChild(panelCvWrap);
            const animCanvas = document.createElement('canvas');
            animCanvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%';
            panelCvWrap.appendChild(animCanvas);
            const animCtx = animCanvas.getContext('2d');

            // Tiny status footer (e.g. "COMPLETE" indicator) — empty most of the time.
            const status = document.createElement('div');
            status.style.cssText = 'position:absolute;left:8px;bottom:6px;'
                + 'padding:2px 8px;background:rgba(0,0,0,0.65);color:#9ad1ff;'
                + 'font:10px monospace;border-radius:2px;pointer-events:none';
            panelCvWrap.appendChild(status);
            status.style.display = 'none';

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
                field: 'gyroid',
                gridN: 32,
                isoLevel: 0,
                cellSize: 0.7,
                seed: 1,
                sliceZ: 16,
                autoRotate: false,
                mesh: null,
                fieldData: null,
                triCount: 0,
                animFrame: null,

                // Slice cache.
                cached: {
                    n: 0, z: -1, iso: NaN, fieldKey: '',
                    signed: null, cases: null, gradX: null, gradY: null,
                    mn: 0, mx: 0,
                },
                cellPts: [],            // per-cell crossings + normals
                cellOrder: [],          // scan-order indices of ACTIVE cells

                // Animation cursor.
                playing: true,
                speed: 1.0, speedExp: 0,
                // Auto-ramp: effective speed grows from 1x toward target
                // (Math.pow(50, speedExp)) over rampMs of accumulated play
                // time. Lets the first cells crawl so the user actually
                // reads them, then accelerates through the bulk.
                playTimeMs: 0,
                rampMs: 6000,
                cellStep: 0,            // index into cellOrder
                phaseIdx: 0,            // index into PHASES[algo]
                phaseT: 0,              // 0..1 progress through current phase
                lastT: 0,               // last rAF timestamp

                // Accumulated emitted geometry (drawn behind the cursor).
                emittedMC: [],          // [{x,y,segs:[a,b,...], code}]
                vertices: {},           // cellIdx → {u,v} (SN: centroid; DC: QEF)
                threads: [],            // [{a:cellIdx, b:cellIdx}] dual edges

                // 3D wireframe build: every committed cell contributes line
                // segments at its slice's Z. They accumulate across slices so
                // the volume gets wrapped in algorithm-output ribbons.
                segments3D: [],         // {x0,y0,z0,x1,y1,z1,r,g,b}
                wireMesh: null,
                wireDirty: false,
                sweepVolume: true,      // auto-advance Z when slice completes

                // Multi-slice construction.
                //   prevSlice: snapshot of the slice we just finished sweeping,
                //     kept so the next slice's commit can stitch features that
                //     share an in-plane cell column across z.
                //   stitching: in-flight inter-slice connect animation between
                //     prevSlice.z and cached.z. Holds a precomputed segment
                //     list; segments fold into segments3D as t advances.
                //   filling:   after the final slice's stitch, ramp the ghost
                //     mesh from translucent to nearly-solid in discrete steps
                //     so the wireframe visibly "fills in" to the real surface.
                //   builtCached: bromesh output cached during rebuildMesh so
                //     the fill pass can recreate the mesh with new opacity
                //     without recomputing the algorithm.
                prevSlice: null,
                stitching: null,
                filling: null,
                builtCached: null,
                ghostAlpha: 0.18,
                finished: false,
            };

            const fieldOff = document.createElement('canvas');
            fieldOff.width = 1; fieldOff.height = 1;
            const fieldOffCtx = fieldOff.getContext('2d');

            function rebuildField() {
                state.fieldData = buildField(state.field, state.gridN, state.seed);
                state.sliceZ = Math.min(state.sliceZ, state.gridN - 1);
                sliceSlider.min = 0; sliceSlider.max = state.gridN - 1;
                sliceSlider.value = state.sliceZ;
                invalidateSlice();
                rebuildMesh();
                recomputeSliceCache();
                paintFieldOff();
                resetAnim();
            }

            function rebuildMesh() {
                if (state.mesh) { state.mesh.destroy(); state.mesh = null; }
                const n = state.gridN;
                const built = Mesh[state.algo](state.fieldData, n, n, n,
                                               state.isoLevel, state.cellSize);
                state.builtCached = built;
                state.triCount = 0;
                if (!built) return;
                if (built.indices) state.triCount = built.indices.length / 3;
                else if (built.positions) state.triCount = built.positions.length / 9;
                state.ghostAlpha = 0.18;
                createGhostMesh(state.ghostAlpha);
                meshLabel.textContent =
                    'algo:    ' + state.algo + '\n' +
                    'field:   ' + state.field + '\n' +
                    'grid:    ' + n + '³ = ' + (n*n*n) + ' samples\n' +
                    'iso:     ' + state.isoLevel.toFixed(2) + '\n' +
                    'tris:    ' + (state.triCount | 0);
            }

            // (Re)create the translucent ghost mesh at a target alpha. Used
            // both at rebuild time (low alpha = "we're going to build this")
            // and during the final fill pass (alpha ramps up to ~0.85 so the
            // wireframe visibly resolves into solid geometry).
            function createGhostMesh(alpha) {
                if (state.mesh) { state.mesh.destroy(); state.mesh = null; }
                if (!state.builtCached) return;
                const n = state.gridN;
                const offset = -(n - 1) * 0.5 * state.cellSize;
                state.mesh = scene.createMesh({
                    data: state.builtCached,
                    color: [0.55, 0.75, 0.95, alpha],
                    metallic: 0.0, roughness: 0.85,
                    twoSided: true,
                    castsShadow: false,
                    x: offset, y: offset, z: offset,
                });
            }

            function invalidateSlice() { state.cached.z = -1; }

            function recomputeSliceCache() {
                const n = state.gridN;
                const z = Math.max(0, Math.min(n - 1, state.sliceZ | 0));
                const iso = state.isoLevel;
                const fieldKey = state.field + '|' + state.seed + '|' + n;
                const c = state.cached;
                if (c.n === n && c.z === z && c.iso === iso && c.fieldKey === fieldKey) return c;

                if (c.n !== n) {
                    c.signed = new Float32Array(n * n);
                    c.gradX = new Float32Array(n * n);
                    c.gradY = new Float32Array(n * n);
                    c.cases = new Uint8Array((n - 1) * (n - 1));
                }
                const sliceStart = z * n * n;
                let mn = Infinity, mx = -Infinity;
                for (let i = 0; i < n * n; i++) {
                    const v = state.fieldData[sliceStart + i];
                    c.signed[i] = v - iso;
                    if (v < mn) mn = v;
                    if (v > mx) mx = v;
                }
                for (let y = 0; y < n; y++) {
                    for (let x = 0; x < n; x++) {
                        const i = y * n + x;
                        const xl = x > 0 ? c.signed[i - 1] : c.signed[i];
                        const xr = x < n - 1 ? c.signed[i + 1] : c.signed[i];
                        c.gradX[i] = (xr - xl) / ((x > 0 && x < n - 1) ? 2 : 1);
                        const yu = y > 0 ? c.signed[i - n] : c.signed[i];
                        const yd = y < n - 1 ? c.signed[i + n] : c.signed[i];
                        c.gradY[i] = (yd - yu) / ((y > 0 && y < n - 1) ? 2 : 1);
                    }
                }
                state.cellOrder.length = 0;
                for (let y = 0; y < n - 1; y++) {
                    for (let x = 0; x < n - 1; x++) {
                        const v00 = c.signed[y * n + x];
                        const v10 = c.signed[y * n + x + 1];
                        const v11 = c.signed[(y + 1) * n + x + 1];
                        const v01 = c.signed[(y + 1) * n + x];
                        let code = 0;
                        if (v00 < 0) code |= 1;
                        if (v10 < 0) code |= 2;
                        if (v11 < 0) code |= 4;
                        if (v01 < 0) code |= 8;
                        c.cases[y * (n - 1) + x] = code;
                        if (code !== 0 && code !== 15) state.cellOrder.push(y * (n - 1) + x);
                    }
                }
                c.n = n; c.z = z; c.iso = iso; c.fieldKey = fieldKey;
                c.mn = mn; c.mx = mx;

                state.cellPts.length = (n - 1) * (n - 1);
                for (let y = 0; y < n - 1; y++) {
                    for (let x = 0; x < n - 1; x++) {
                        const code = c.cases[y * (n - 1) + x];
                        if (code === 0 || code === 15) {
                            state.cellPts[y * (n - 1) + x] = null;
                            continue;
                        }
                        const v00 = c.signed[y * n + x];
                        const v10 = c.signed[y * n + x + 1];
                        const v11 = c.signed[(y + 1) * n + x + 1];
                        const v01 = c.signed[(y + 1) * n + x];
                        const gx00 = c.gradX[y * n + x],     gx10 = c.gradX[y * n + x + 1];
                        const gx01 = c.gradX[(y+1)*n + x],   gx11 = c.gradX[(y+1)*n + x + 1];
                        const gy00 = c.gradY[y * n + x],     gy10 = c.gradY[y * n + x + 1];
                        const gy01 = c.gradY[(y+1)*n + x],   gy11 = c.gradY[(y+1)*n + x + 1];
                        const pts = [];
                        const pushPt = (u, vv, edge) => {
                            const gx = (gx00*(1-u) + gx10*u) * (1-vv) + (gx01*(1-u) + gx11*u) * vv;
                            const gy = (gy00*(1-u) + gy10*u) * (1-vv) + (gy01*(1-u) + gy11*u) * vv;
                            const m = Math.hypot(gx, gy) || 1;
                            pts.push(u, vv, gx / m, gy / m, edge);
                        };
                        if ((v00 < 0) !== (v10 < 0)) pushPt(lerpT(v00, v10), 0, 0);
                        if ((v10 < 0) !== (v11 < 0)) pushPt(1, lerpT(v10, v11), 1);
                        if ((v01 < 0) !== (v11 < 0)) pushPt(lerpT(v01, v11), 1, 2);
                        if ((v00 < 0) !== (v01 < 0)) pushPt(0, lerpT(v00, v01), 3);
                        state.cellPts[y * (n - 1) + x] = pts;
                    }
                }
                return c;
            }

            // Paint the field colormap once per cache change. Used as the
            // animated panel's static background.
            function paintFieldOff() {
                const c = state.cached;
                const n = c.n;
                if (fieldOff.width !== n) { fieldOff.width = n; fieldOff.height = n; }
                const img = fieldOffCtx.createImageData(n, n);
                const lo = c.mn - c.iso, hi = c.mx - c.iso;
                for (let i = 0; i < n * n; i++) {
                    const d = c.signed[i];
                    let r, g, b;
                    if (d < 0) {
                        const t = -d / Math.max(1e-6, -lo);
                        r = 18 + (1 - t) * 30;
                        g = 40 + (1 - t) * 50;
                        b = 90 + (1 - t) * 30;
                    } else {
                        const t = d / Math.max(1e-6, hi);
                        r = 90 + (1 - t) * 50;
                        g = 55 + (1 - t) * 35;
                        b = 24 + (1 - t) * 18;
                    }
                    const p = i * 4;
                    img.data[p  ] = r | 0;
                    img.data[p+1] = g | 0;
                    img.data[p+2] = b | 0;
                    img.data[p+3] = 255;
                }
                fieldOffCtx.putImageData(img, 0, 0);
            }

            // ----- animation state machine --------------------------------------
            function resetAnim() {
                state.cellStep = 0;
                state.phaseIdx = 0;
                state.phaseT = 0;
                state.emittedMC.length = 0;
                state.vertices = {};
                state.threads.length = 0;
                clearWireframe();
                state.prevSlice = null;
                state.stitching = null;
                state.filling = null;
                state.finished = false;
                state.ghostAlpha = 0.18;
                if (state.builtCached) createGhostMesh(state.ghostAlpha);
                state.playTimeMs = 0;
                state.speed = 1.0;
                state.sliceZ = 0;
                sliceSlider.value = 0;
                invalidateSlice();
                recomputeSliceCache();
                paintFieldOff();
                state.playing = true;
                playBtn.textContent = 'Pause';
                playBtn.classList.add('toggled');
            }

            // Restart sweep on the current slice without clearing 3D wire.
            // Also cancels any in-flight stitch (its segments will be
            // recomputed when this slice completes again).
            function restartSlice() {
                state.cellStep = 0;
                state.phaseIdx = 0;
                state.phaseT = 0;
                state.emittedMC.length = 0;
                state.vertices = {};
                state.threads.length = 0;
                state.stitching = null;
            }

            // Advance to the next slice (auto-sweep) or finish if past end.
            function advanceSlice() {
                if (state.sliceZ < state.gridN - 1) {
                    state.sliceZ++;
                    sliceSlider.value = state.sliceZ;
                    invalidateSlice();
                    recomputeSliceCache();
                    paintFieldOff();
                    restartSlice();
                    return true;
                }
                return false;
            }

            // Compute SN centroid or DC QEF vertex for a cell, in cell-local (u,v).
            function solveVertex(algo, pts) {
                if (!pts || pts.length === 0) return null;
                const k = pts.length / 5;
                let su = 0, sv = 0;
                for (let i = 0; i < pts.length; i += 5) { su += pts[i]; sv += pts[i + 1]; }
                if (algo === 'surfaceNets') return { u: su / k, v: sv / k };
                // dualContour QEF
                let a = 0, b = 0, d = 0, bx = 0, by = 0;
                for (let i = 0; i < pts.length; i += 5) {
                    const u = pts[i], v = pts[i + 1];
                    const nx = pts[i + 2], ny = pts[i + 3];
                    const rhs = nx * u + ny * v;
                    a += nx*nx; b += nx*ny; d += ny*ny;
                    bx += nx*rhs; by += ny*rhs;
                }
                const det = a*d - b*b;
                if (Math.abs(det) < 1e-6) return { u: su / k, v: sv / k };
                let u = (d*bx - b*by) / det;
                let v = (a*by - b*bx) / det;
                u = Math.max(0, Math.min(1, u));
                v = Math.max(0, Math.min(1, v));
                return { u, v };
            }

            // Connections (dual edges) emitted when committing a cell.
            function activeNeighborEdges(cellIdx) {
                const c = state.cached;
                const n = c.n;
                const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
                const out = [];
                // east neighbor: shared grid edge is ((cx+1,cy),(cx+1,cy+1))
                if (cx < n - 2) {
                    const a = c.signed[cy * n + (cx + 1)];
                    const b = c.signed[(cy + 1) * n + (cx + 1)];
                    if ((a < 0) !== (b < 0)) {
                        const other = cy * (n - 1) + (cx + 1);
                        if (state.vertices[other]) out.push(other);
                    }
                }
                // south neighbor: shared grid edge is ((cx,cy+1),(cx+1,cy+1))
                if (cy < n - 2) {
                    const a = c.signed[(cy + 1) * n + cx];
                    const b = c.signed[(cy + 1) * n + (cx + 1)];
                    if ((a < 0) !== (b < 0)) {
                        const other = (cy + 1) * (n - 1) + cx;
                        if (state.vertices[other]) out.push(other);
                    }
                }
                // also check west and north (previously-emitted neighbors)
                if (cx > 0) {
                    const a = c.signed[cy * n + cx];
                    const b = c.signed[(cy + 1) * n + cx];
                    if ((a < 0) !== (b < 0)) {
                        const other = cy * (n - 1) + (cx - 1);
                        if (state.vertices[other]) out.push(other);
                    }
                }
                if (cy > 0) {
                    const a = c.signed[cy * n + cx];
                    const b = c.signed[cy * n + (cx + 1)];
                    if ((a < 0) !== (b < 0)) {
                        const other = (cy - 1) * (n - 1) + cx;
                        if (state.vertices[other]) out.push(other);
                    }
                }
                return out;
            }

            // Commit a cell's final result to the "emitted" accumulators so it
            // stays drawn after the cursor moves on. Also pushes 3D segments
            // for the wireframe build at the current slice's Z.
            function commitCell(cellIdx) {
                const c = state.cached;
                const n = c.n;
                const pts = state.cellPts[cellIdx];
                if (!pts) return;
                if (state.algo === 'marchingCubes') {
                    const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
                    const code = c.cases[cellIdx];
                    state.emittedMC.push({ cellIdx, cx, cy, code });
                } else {
                    const v = solveVertex(state.algo, pts);
                    if (v) {
                        state.vertices[cellIdx] = v;
                        const neighbors = activeNeighborEdges(cellIdx);
                        for (const other of neighbors) {
                            state.threads.push({ a: cellIdx, b: other });
                        }
                    }
                }
                appendCellTo3D(cellIdx);
                state.wireDirty = true;
            }

            // Parse a CSS color expression to linear [r,g,b] in 0..1. Used to
            // colorize 3D wireframe segments to match the 2D output.
            function parseColor(str) {
                if (str.startsWith('hsl')) {
                    const m = str.match(/hsl\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%?,\s*(-?\d+(?:\.\d+)?)%?\)/);
                    if (!m) return [1, 1, 1];
                    let h = parseFloat(m[1]) / 360;
                    const s = parseFloat(m[2]) / 100;
                    const l = parseFloat(m[3]) / 100;
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;
                    const h2rgb = (t) => {
                        if (t < 0) t += 1; if (t > 1) t -= 1;
                        if (t < 1/6) return p + (q - p) * 6 * t;
                        if (t < 1/2) return q;
                        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                        return p;
                    };
                    return [h2rgb(h + 1/3), h2rgb(h), h2rgb(h - 1/3)];
                }
                if (str.startsWith('#')) {
                    const v = parseInt(str.slice(1), 16);
                    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
                }
                return [1, 1, 1];
            }

            // Push 3D wire segments for a committed cell at the current slice.
            //   MC: one segment per emitted edge, colored by case.
            //   SN/DC: one segment per thread to each already-emitted neighbor.
            // All segments lie in the slice's XY plane at world Z = z*cellSize.
            function appendCellTo3D(cellIdx) {
                const c = state.cached;
                const n = c.n, cs = state.cellSize;
                const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
                const zW = c.z * cs;
                const pts = state.cellPts[cellIdx];
                if (!pts) return;
                if (state.algo === 'marchingCubes') {
                    const code = c.cases[cellIdx];
                    const segs = MSQ_TABLE[code];
                    if (!segs.length) return;
                    const v00 = c.signed[cy * n + cx];
                    const v10 = c.signed[cy * n + cx + 1];
                    const v11 = c.signed[(cy + 1) * n + cx + 1];
                    const v01 = c.signed[(cy + 1) * n + cx];
                    const ex = [
                        (cx + lerpT(v00, v10)) * cs, cy * cs,
                        (cx + 1) * cs, (cy + lerpT(v10, v11)) * cs,
                        (cx + lerpT(v01, v11)) * cs, (cy + 1) * cs,
                        cx * cs, (cy + lerpT(v00, v01)) * cs,
                    ];
                    const col = parseColor(CASE_COLOR[code]);
                    for (let s = 0; s < segs.length; s += 2) {
                        const a = segs[s], b = segs[s + 1];
                        state.segments3D.push({
                            x0: ex[a*2], y0: ex[a*2 + 1], z0: zW,
                            x1: ex[b*2], y1: ex[b*2 + 1], z1: zW,
                            r: col[0], g: col[1], b: col[2],
                        });
                    }
                } else {
                    const v = solveVertex(state.algo, pts);
                    if (!v) return;
                    const x0 = (cx + v.u) * cs, y0 = (cy + v.v) * cs;
                    const neighbors = activeNeighborEdges(cellIdx);
                    const col = state.algo === 'dualContour' ? [1.0, 0.62, 0.83]
                                                             : [0.65, 0.88, 1.0];
                    for (const other of neighbors) {
                        const ov = state.vertices[other];
                        if (!ov) continue;
                        const ocx = other % (n - 1), ocy = (other / (n - 1)) | 0;
                        const x1 = (ocx + ov.u) * cs, y1 = (ocy + ov.v) * cs;
                        state.segments3D.push({
                            x0, y0, z0: zW, x1, y1, z1: zW,
                            r: col[0], g: col[1], b: col[2],
                        });
                    }
                }
            }

            // ----- multi-slice stitching ----------------------------------------
            // Snapshot just enough of the just-finished slice that the next
            // slice's stitch pass can reach back and connect features. We copy
            // only the small arrays we need; the field grid itself is not
            // duplicated.
            function snapshotCurrentSlice() {
                const c = state.cached;
                const n = c.n;
                const cellCount = (n - 1) * (n - 1);
                const signed = c.signed ? c.signed.slice() : null;
                const cases = c.cases ? c.cases.slice() : null;
                const cellPts = new Array(cellCount);
                for (let i = 0; i < cellCount; i++) {
                    const p = state.cellPts[i];
                    cellPts[i] = p ? p.slice() : null;
                }
                const vertices = {};
                for (const k in state.vertices) vertices[k] = state.vertices[k];
                state.prevSlice = {
                    z: c.z, n, signed, cases, cellPts, vertices,
                };
            }

            // Build the inter-slice connector segments between prevSlice and
            // the just-committed current slice. For MC we connect crossings
            // that exist on the SAME in-plane edge of the SAME cell column in
            // both slices (these are the four vertical "side faces" of the
            // 3D marching cube — the missing geometry that turns stacked 2D
            // contours into a closed surface). For SN/DC we connect dual
            // vertices in shared cell columns.
            function computeStitchSegments() {
                const prev = state.prevSlice;
                const c = state.cached;
                if (!prev || prev.n !== c.n) return [];
                const n = c.n, cs = state.cellSize;
                const zPrev = prev.z * cs, zCur = c.z * cs;
                const segs = [];
                if (state.algo === 'marchingCubes') {
                    for (let y = 0; y < n - 1; y++) {
                        for (let x = 0; x < n - 1; x++) {
                            const idx = y * (n - 1) + x;
                            const cp = prev.cases[idx], cc = c.cases[idx];
                            if (cp === 0 || cp === 15) continue;
                            if (cc === 0 || cc === 15) continue;
                            const ptsP = prev.cellPts[idx];
                            const ptsC = state.cellPts[idx];
                            if (!ptsP || !ptsC) continue;
                            // Index crossings by edge (5th tuple element).
                            const byEdgeP = [-1, -1, -1, -1];
                            for (let i = 0; i < ptsP.length; i += 5) {
                                byEdgeP[ptsP[i + 4]] = i;
                            }
                            const colVec = parseColor(CASE_COLOR[cc]);
                            for (let i = 0; i < ptsC.length; i += 5) {
                                const edge = ptsC[i + 4];
                                const j = byEdgeP[edge];
                                if (j < 0) continue;
                                segs.push({
                                    x0: (x + ptsP[j])     * cs,
                                    y0: (y + ptsP[j + 1]) * cs,
                                    z0: zPrev,
                                    x1: (x + ptsC[i])     * cs,
                                    y1: (y + ptsC[i + 1]) * cs,
                                    z1: zCur,
                                    r: colVec[0], g: colVec[1], b: colVec[2],
                                });
                            }
                        }
                    }
                } else {
                    const colVec = state.algo === 'dualContour'
                        ? [1.0, 0.62, 0.83] : [0.65, 0.88, 1.0];
                    for (let y = 0; y < n - 1; y++) {
                        for (let x = 0; x < n - 1; x++) {
                            const idx = y * (n - 1) + x;
                            const vp = prev.vertices[idx];
                            const vc = state.vertices[idx];
                            if (!vp || !vc) continue;
                            segs.push({
                                x0: (x + vp.u) * cs, y0: (y + vp.v) * cs, z0: zPrev,
                                x1: (x + vc.u) * cs, y1: (y + vc.v) * cs, z1: zCur,
                                r: colVec[0], g: colVec[1], b: colVec[2],
                            });
                        }
                    }
                }
                return segs;
            }

            // Begin a stitch animation. Returns true if segments are pending
            // (caller should keep playing); false if nothing to stitch (caller
            // can immediately advance to the next slice).
            function startStitch() {
                const segs = computeStitchSegments();
                if (segs.length === 0) return false;
                state.stitching = {
                    t: 0, ms: 600,
                    segs, added: 0,
                };
                return true;
            }

            function flushStitchRemaining() {
                const st = state.stitching;
                if (!st) return;
                while (st.added < st.segs.length) {
                    state.segments3D.push(st.segs[st.added++]);
                }
                state.wireDirty = true;
            }

            // Begin the final fill pass: ramp ghost mesh opacity in N discrete
            // steps so the wireframe-wrapped volume visibly resolves into a
            // solid mesh. Steps are spaced so the user actually sees the
            // fade rather than the GPU upload thrash blurring through it.
            function startFill() {
                state.filling = {
                    t: 0, ms: 1500,
                    steps: 6,
                    lastStep: -1,
                    fromA: state.ghostAlpha,
                    toA: 0.85,
                };
            }

            // Build a positions+indices mesh from the accumulated segments.
            // Each segment becomes a thin extruded box so it's visible from any
            // angle (a flat ribbon would disappear edge-on). The box runs
            // along the segment, with small thickness in the two perpendicular
            // axes. Per-vertex colors carry the segment color.
            function buildWireGeometry() {
                const segs = state.segments3D;
                const segCount = segs.length;
                if (segCount === 0) return null;
                const thick = state.cellSize * 0.06;
                const h = thick * 0.5;
                // 8 verts per segment, 36 indices (12 tris × 3) per segment.
                const positions = new Float32Array(segCount * 8 * 3);
                const normals = new Float32Array(segCount * 8 * 3);
                const colors = new Float32Array(segCount * 8 * 4);
                const indices = new Uint32Array(segCount * 12 * 3);
                let pi = 0, ni = 0, ci = 0, ii = 0;
                for (let s = 0; s < segCount; s++) {
                    const g = segs[s];
                    const dx = g.x1 - g.x0, dy = g.y1 - g.y0, dz = g.z1 - g.z0;
                    const L = Math.hypot(dx, dy, dz) || 1;
                    const ux = dx / L, uy = dy / L, uz = dz / L;
                    // perp1: u × world-up (0,0,1) when not collinear, else world-X.
                    let n1x, n1y, n1z;
                    if (Math.abs(uz) < 0.95) {
                        n1x = uy; n1y = -ux; n1z = 0;
                    } else {
                        n1x = 1; n1y = 0; n1z = 0;
                    }
                    const m1 = Math.hypot(n1x, n1y, n1z) || 1;
                    n1x /= m1; n1y /= m1; n1z /= m1;
                    // perp2 = u × perp1
                    const n2x = uy * n1z - uz * n1y;
                    const n2y = uz * n1x - ux * n1z;
                    const n2z = ux * n1y - uy * n1x;
                    // 8 corners: indices [0..3] at p0, [4..7] at p1.
                    // signs in (perp1, perp2): (-,-), (+,-), (+,+), (-,+)
                    const ss = [[-1,-1],[1,-1],[1,1],[-1,1]];
                    const base = s * 8;
                    for (let i = 0; i < 8; i++) {
                        const endP = i < 4 ? [g.x0, g.y0, g.z0] : [g.x1, g.y1, g.z1];
                        const sgn = ss[i & 3];
                        const x = endP[0] + sgn[0]*h*n1x + sgn[1]*h*n2x;
                        const y = endP[1] + sgn[0]*h*n1y + sgn[1]*h*n2y;
                        const z = endP[2] + sgn[0]*h*n1z + sgn[1]*h*n2z;
                        positions[pi++] = x;
                        positions[pi++] = y;
                        positions[pi++] = z;
                        // Crude normal: outward from box axis. Just sgn1*n1 + sgn2*n2.
                        let nx = sgn[0]*n1x + sgn[1]*n2x;
                        let ny = sgn[0]*n1y + sgn[1]*n2y;
                        let nz = sgn[0]*n1z + sgn[1]*n2z;
                        const nm = Math.hypot(nx, ny, nz) || 1;
                        normals[ni++] = nx / nm;
                        normals[ni++] = ny / nm;
                        normals[ni++] = nz / nm;
                        colors[ci++] = g.r;
                        colors[ci++] = g.g;
                        colors[ci++] = g.b;
                        colors[ci++] = 1;
                    }
                    // Faces (CCW from outside). p0 face = (0,1,2,3) viewed from -u;
                    // p1 face = (4,5,6,7) viewed from +u; side faces wrap around.
                    const faces = [
                        // p0 cap (facing -u)
                        [0, 2, 1], [0, 3, 2],
                        // p1 cap (facing +u)
                        [4, 5, 6], [4, 6, 7],
                        // sides
                        [0, 1, 5], [0, 5, 4],
                        [1, 2, 6], [1, 6, 5],
                        [2, 3, 7], [2, 7, 6],
                        [3, 0, 4], [3, 4, 7],
                    ];
                    for (const f of faces) {
                        indices[ii++] = base + f[0];
                        indices[ii++] = base + f[1];
                        indices[ii++] = base + f[2];
                    }
                }
                return { positions, normals, indices, colors };
            }

            function refreshWireMesh() {
                if (!state.wireDirty) return;
                state.wireDirty = false;
                const geom = buildWireGeometry();
                const n = state.gridN;
                const offset = -(n - 1) * 0.5 * state.cellSize;
                if (!geom) {
                    if (state.wireMesh) { state.wireMesh.destroy(); state.wireMesh = null; }
                    return;
                }
                if (state.wireMesh) {
                    state.wireMesh.updateMesh({
                        positions: geom.positions,
                        indices: geom.indices,
                        normals: geom.normals,
                    });
                } else {
                    state.wireMesh = scene.createMesh({
                        positions: geom.positions,
                        indices: geom.indices,
                        normals: geom.normals,
                        color: [1.0, 1.0, 1.0],
                        emissive: 0.85,
                        emissiveColor: [1.0, 0.95, 0.8],
                        roughness: 0.5,
                        castsShadow: false,
                        twoSided: true,
                        x: offset, y: offset, z: offset,
                    });
                }
            }

            function clearWireframe() {
                state.segments3D.length = 0;
                if (state.wireMesh) {
                    state.wireMesh.destroy();
                    state.wireMesh = null;
                }
            }

            // Move the cursor forward by one or more phases.
            function advancePhase(count) {
                for (let k = 0; k < count; k++) {
                    if (state.cellStep >= state.cellOrder.length) return;
                    const phases = PHASES[state.algo];
                    state.phaseIdx++;
                    if (state.phaseIdx >= phases.length) {
                        // Finished this cell. Commit it.
                        commitCell(state.cellOrder[state.cellStep]);
                        state.cellStep++;
                        state.phaseIdx = 0;
                    }
                    state.phaseT = 0;
                }
            }

            function completeCurrentCell() {
                if (state.cellStep >= state.cellOrder.length) return;
                commitCell(state.cellOrder[state.cellStep]);
                state.cellStep++;
                state.phaseIdx = 0;
                state.phaseT = 0;
            }

            function finishSlice() {
                while (state.cellStep < state.cellOrder.length) {
                    commitCell(state.cellOrder[state.cellStep]);
                    state.cellStep++;
                }
                state.phaseIdx = 0;
                state.phaseT = 0;
            }

            // ----- rendering ----------------------------------------------------
            function fitSlice(W, H, padTop) {
                padTop = padTop || 0;
                const usableH = H - padTop;
                const side = Math.min(W - 8, usableH - 8);
                const ox = ((W - side) / 2) | 0;
                const oy = padTop + (((usableH - side) / 2) | 0);
                return { ox, oy, side };
            }

            function drawCaseStrip(ctx, W, n) {
                const stripH = 42;
                const padY = 4;
                const cellW = Math.max(14, ((W - 8) / 16) | 0);
                const stripY = padY;
                const phases = PHASES[state.algo];
                const phase = phases[state.phaseIdx];
                const c = state.cached;
                let highlightCase = -1;
                if (state.cellStep < state.cellOrder.length &&
                    state.algo === 'marchingCubes' && phase &&
                    (phase.id === 'lookup' || phase.id === 'emit')) {
                    highlightCase = c.cases[state.cellOrder[state.cellStep]];
                }
                for (let i = 0; i < 16; i++) {
                    const x0 = 4 + i * cellW;
                    const isHi = i === highlightCase;
                    ctx.fillStyle = CASE_COLOR[i];
                    ctx.globalAlpha = isHi ? (0.6 + 0.35 * Math.sin(Date.now() / 90)) : 0.18;
                    ctx.fillRect(x0, stripY, cellW - 1, stripH - padY);
                    ctx.globalAlpha = 1;
                    // Slightly thicker border for the highlighted entry.
                    if (isHi) {
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x0 + 0.5, stripY + 0.5, cellW - 2, stripH - padY - 1);
                    }
                    const cx = x0 + 4, cy = stripY + 4;
                    const cw = cellW - 9, ch = stripH - padY - 14;
                    const corners = [
                        [0, 0, (i & 1) ? 1 : 0],
                        [1, 0, (i & 2) ? 1 : 0],
                        [1, 1, (i & 4) ? 1 : 0],
                        [0, 1, (i & 8) ? 1 : 0],
                    ];
                    for (const [u, v, inside] of corners) {
                        ctx.fillStyle = inside ? '#7ab0ff' : '#ffb37a';
                        ctx.beginPath();
                        ctx.arc(cx + u * cw, cy + v * ch, 1.6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    const ex = [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5];
                    const segs = MSQ_TABLE[i];
                    if (segs.length) {
                        ctx.strokeStyle = isHi ? '#ffffff' : CASE_COLOR[i];
                        ctx.lineWidth = isHi ? 2.2 : 1.4;
                        ctx.beginPath();
                        for (let s = 0; s < segs.length; s += 2) {
                            const a = segs[s], b = segs[s + 1];
                            ctx.moveTo(cx + ex[a*2] * cw, cy + ex[a*2 + 1] * ch);
                            ctx.lineTo(cx + ex[b*2] * cw, cy + ex[b*2 + 1] * ch);
                        }
                        ctx.stroke();
                    }
                    // Case number label, bottom-centered.
                    ctx.fillStyle = isHi ? '#fff' : '#777';
                    ctx.font = '9px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(String(i), x0 + cellW / 2, stripY + stripH - 3);
                    ctx.textAlign = 'start';
                }
                ctx.strokeStyle = '#1c1c22';
                ctx.beginPath();
                ctx.moveTo(0, stripY + stripH + 2);
                ctx.lineTo(W, stripY + stripH + 2);
                ctx.stroke();
                return stripY + stripH + 6;
            }

            // Sized in cell-grid coordinates (0..n) → pixels.
            function makeMap(ox, oy, side, n) {
                const sx = side / n, sy = side / n;
                return (x, y) => [ox + x * sx, oy + y * sy];
            }

            // Render the already-emitted history (everything behind the cursor).
            function drawEmitted(ctx, map, c) {
                const n = c.n;
                if (state.algo === 'marchingCubes') {
                    ctx.lineWidth = 1.8;
                    ctx.lineCap = 'round';
                    for (const e of state.emittedMC) {
                        const segs = MSQ_TABLE[e.code];
                        if (!segs.length) continue;
                        const v00 = c.signed[e.cy * n + e.cx];
                        const v10 = c.signed[e.cy * n + e.cx + 1];
                        const v11 = c.signed[(e.cy + 1) * n + e.cx + 1];
                        const v01 = c.signed[(e.cy + 1) * n + e.cx];
                        const ex = [
                            e.cx + lerpT(v00, v10), e.cy,
                            e.cx + 1, e.cy + lerpT(v10, v11),
                            e.cx + lerpT(v01, v11), e.cy + 1,
                            e.cx, e.cy + lerpT(v00, v01),
                        ];
                        ctx.strokeStyle = CASE_COLOR[e.code];
                        ctx.beginPath();
                        for (let s = 0; s < segs.length; s += 2) {
                            const a = segs[s], b = segs[s + 1];
                            const p0 = map(ex[a*2], ex[a*2 + 1]);
                            const p1 = map(ex[b*2], ex[b*2 + 1]);
                            ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
                        }
                        ctx.stroke();
                    }
                } else {
                    // threads
                    ctx.strokeStyle = state.algo === 'dualContour' ? '#ff9ed2' : '#a7e1ff';
                    ctx.lineWidth = 1.8;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    for (const t of state.threads) {
                        const va = state.vertices[t.a], vb = state.vertices[t.b];
                        if (!va || !vb) continue;
                        const ax = t.a % (n - 1), ay = (t.a / (n - 1)) | 0;
                        const bx = t.b % (n - 1), by = (t.b / (n - 1)) | 0;
                        const p0 = map(ax + va.u, ay + va.v);
                        const p1 = map(bx + vb.u, by + vb.v);
                        ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
                    }
                    ctx.stroke();
                    // vertices
                    ctx.fillStyle = state.algo === 'dualContour' ? '#ffd9ee' : '#dffaff';
                    for (const k in state.vertices) {
                        const cellIdx = +k;
                        const v = state.vertices[cellIdx];
                        const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
                        const p = map(cx + v.u, cy + v.v);
                        ctx.beginPath();
                        ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // Render the currently-active cell's in-flight phase animation.
            function drawCurrentCell(ctx, map, c, sxPx, syPx) {
                if (state.cellStep >= state.cellOrder.length) return;
                const cellIdx = state.cellOrder[state.cellStep];
                const n = c.n;
                const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
                const pts = state.cellPts[cellIdx];
                const code = c.cases[cellIdx];
                const phases = PHASES[state.algo];
                const phase = phases[state.phaseIdx];
                const phaseT = state.phaseT;

                // ----- common pre-phase visuals: cell highlight + corners -----
                // Cell highlight (always while a cell is active).
                const p00 = map(cx, cy), p11 = map(cx + 1, cy + 1);
                const cellW = p11[0] - p00[0], cellH = p11[1] - p00[1];
                const pulse = 0.4 + 0.35 * Math.sin(Date.now() / 120);
                ctx.strokeStyle = 'rgba(255,255,255,' + pulse.toFixed(2) + ')';
                ctx.lineWidth = 2;
                ctx.strokeRect(p00[0] - 1, p00[1] - 1, cellW + 2, cellH + 2);
                ctx.fillStyle = 'rgba(255,255,255,0.04)';
                ctx.fillRect(p00[0], p00[1], cellW, cellH);

                // For phases past 'classify', corner sign dots are visible.
                const phaseRank = state.phaseIdx;
                const rankOf = (id) => phases.findIndex(p => p.id === id);
                const showCorners = phaseRank >= rankOf('classify');
                if (showCorners) {
                    const cornerVis = phase.id === 'classify' ? easeOutCubic(phaseT) : 1;
                    const corners = [
                        [cx,     cy,     c.signed[cy * n + cx]],
                        [cx + 1, cy,     c.signed[cy * n + cx + 1]],
                        [cx + 1, cy + 1, c.signed[(cy + 1) * n + cx + 1]],
                        [cx,     cy + 1, c.signed[(cy + 1) * n + cx]],
                    ];
                    for (const [px, py, sv] of corners) {
                        const p = map(px, py);
                        ctx.fillStyle = sv < 0 ? '#7ab0ff' : '#ffb37a';
                        ctx.globalAlpha = cornerVis;
                        ctx.beginPath();
                        ctx.arc(p[0], p[1], 3.6, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = 1;
                    }
                }

                // ----- per-algo phase drawing -----
                if (state.algo === 'marchingCubes') {
                    if (phase.id === 'emit' && code !== 0 && code !== 15) {
                        // Animate segment growing in.
                        const v00 = c.signed[cy * n + cx];
                        const v10 = c.signed[cy * n + cx + 1];
                        const v11 = c.signed[(cy + 1) * n + cx + 1];
                        const v01 = c.signed[(cy + 1) * n + cx];
                        const ex = [
                            cx + lerpT(v00, v10), cy,
                            cx + 1, cy + lerpT(v10, v11),
                            cx + lerpT(v01, v11), cy + 1,
                            cx, cy + lerpT(v00, v01),
                        ];
                        const segs = MSQ_TABLE[code];
                        const tt = easeInOutCubic(phaseT);
                        ctx.strokeStyle = CASE_COLOR[code];
                        ctx.lineWidth = 2.4;
                        ctx.lineCap = 'round';
                        ctx.beginPath();
                        for (let s = 0; s < segs.length; s += 2) {
                            const a = segs[s], b = segs[s + 1];
                            const a0 = map(ex[a*2], ex[a*2 + 1]);
                            const a1 = map(ex[b*2], ex[b*2 + 1]);
                            const mx = a0[0] + (a1[0] - a0[0]) * tt;
                            const my = a0[1] + (a1[1] - a0[1]) * tt;
                            ctx.moveTo(a0[0], a0[1]);
                            ctx.lineTo(mx, my);
                        }
                        ctx.stroke();
                    }
                } else if (state.algo === 'surfaceNets' || state.algo === 'dualContour') {
                    if (!pts) return;
                    // crossings dots (visible from 'crossings' onward)
                    const showCrossings = phaseRank >= rankOf('crossings');
                    if (showCrossings) {
                        const t = phase.id === 'crossings' ? easeOutCubic(phaseT) : 1;
                        ctx.fillStyle = '#7ec8e3';
                        ctx.globalAlpha = t;
                        for (let j = 0; j < pts.length; j += 5) {
                            const p = map(cx + pts[j], cy + pts[j + 1]);
                            ctx.beginPath();
                            ctx.arc(p[0], p[1], 3.0 * t + 1, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        ctx.globalAlpha = 1;
                    }

                    if (state.algo === 'surfaceNets') {
                        // Average phase: construction lines + dot that travels
                        // from each crossing toward the centroid.
                        if (phase.id === 'average' || phaseRank > rankOf('average')) {
                            const v = solveVertex('surfaceNets', pts);
                            const t = phase.id === 'average' ? easeInOutCubic(phaseT) : 1;
                            const cp = map(cx + v.u, cy + v.v);
                            ctx.strokeStyle = 'rgba(167,225,255,' + (0.3 + 0.4*t).toFixed(2) + ')';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            for (let j = 0; j < pts.length; j += 5) {
                                const u = pts[j], vv = pts[j + 1];
                                const p0 = map(cx + u, cy + vv);
                                // Endpoint moves from crossing toward centroid.
                                const ex2 = p0[0] + (cp[0] - p0[0]) * t;
                                const ey2 = p0[1] + (cp[1] - p0[1]) * t;
                                ctx.moveTo(p0[0], p0[1]);
                                ctx.lineTo(ex2, ey2);
                            }
                            ctx.stroke();
                        }
                        // Place phase: dual vertex pops in.
                        if (phase.id === 'place' || phaseRank > rankOf('place')) {
                            const v = solveVertex('surfaceNets', pts);
                            const t = phase.id === 'place' ? easeOutCubic(phaseT) : 1;
                            const cp = map(cx + v.u, cy + v.v);
                            ctx.fillStyle = '#dffaff';
                            ctx.beginPath();
                            ctx.arc(cp[0], cp[1], 1.5 + 2.5 * t, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        // Thread phase: lines extend from new vertex to existing
                        // neighbor vertices.
                        if (phase.id === 'thread') {
                            const v = solveVertex('surfaceNets', pts);
                            const cp = map(cx + v.u, cy + v.v);
                            const neighbors = activeNeighborEdges(cellIdx);
                            const t = easeInOutCubic(phaseT);
                            ctx.strokeStyle = '#a7e1ff';
                            ctx.lineWidth = 2;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            for (const other of neighbors) {
                                const ov = state.vertices[other];
                                if (!ov) continue;
                                const ox2 = other % (n - 1), oy2 = (other / (n - 1)) | 0;
                                const op = map(ox2 + ov.u, oy2 + ov.v);
                                const ex2 = cp[0] + (op[0] - cp[0]) * t;
                                const ey2 = cp[1] + (op[1] - cp[1]) * t;
                                ctx.moveTo(cp[0], cp[1]);
                                ctx.lineTo(ex2, ey2);
                            }
                            ctx.stroke();
                        }
                    } else {
                        // dualContour
                        // Normals: animate arrows growing from each crossing.
                        const showNormals = phaseRank >= rankOf('normals');
                        if (showNormals) {
                            const t = phase.id === 'normals' ? easeOutCubic(phaseT) : 1;
                            ctx.strokeStyle = '#ff9ed2';
                            ctx.lineWidth = 1.6;
                            ctx.beginPath();
                            for (let j = 0; j < pts.length; j += 5) {
                                const u = pts[j], vv = pts[j + 1];
                                const nx = pts[j + 2], ny = pts[j + 3];
                                const L = 0.32 * t;
                                const a = map(cx + u, cy + vv);
                                const b = map(cx + u + nx * L, cy + vv + ny * L);
                                ctx.moveTo(a[0], a[1]);
                                ctx.lineTo(b[0], b[1]);
                            }
                            ctx.stroke();
                        }
                        // Constraint lines: tangent through each crossing.
                        const showConstraints = phaseRank >= rankOf('constraints');
                        if (showConstraints) {
                            const t = phase.id === 'constraints' ? easeOutCubic(phaseT) : 1;
                            ctx.strokeStyle = 'rgba(255,158,210,' + (0.35 * (0.4 + 0.6*t)).toFixed(2) + ')';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            for (let j = 0; j < pts.length; j += 5) {
                                const u = pts[j], vv = pts[j + 1];
                                const nx = pts[j + 2], ny = pts[j + 3];
                                const tx = -ny, ty = nx;
                                const L = 0.55 * t;
                                const a = map(cx + u - tx*L, cy + vv - ty*L);
                                const b = map(cx + u + tx*L, cy + vv + ty*L);
                                ctx.moveTo(a[0], a[1]);
                                ctx.lineTo(b[0], b[1]);
                            }
                            ctx.stroke();
                        }
                        // Solve: vertex appears at QEF intersection (and phantom
                        // centroid is shown faded for contrast).
                        if (phase.id === 'solve' || phaseRank > rankOf('solve')) {
                            const v = solveVertex('dualContour', pts);
                            const vsn = solveVertex('surfaceNets', pts);
                            const t = phase.id === 'solve' ? easeOutCubic(phaseT) : 1;
                            const cp = map(cx + v.u, cy + v.v);
                            const sp2 = map(cx + vsn.u, cy + vsn.v);
                            // phantom centroid
                            ctx.fillStyle = 'rgba(180,200,220,0.6)';
                            ctx.beginPath();
                            ctx.arc(sp2[0], sp2[1], 1.8, 0, Math.PI * 2);
                            ctx.fill();
                            // displacement connector
                            ctx.strokeStyle = 'rgba(255,158,210,' + (0.6*t).toFixed(2) + ')';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(sp2[0], sp2[1]);
                            ctx.lineTo(cp[0], cp[1]);
                            ctx.stroke();
                            // vertex
                            ctx.fillStyle = '#ffd9ee';
                            ctx.beginPath();
                            ctx.arc(cp[0], cp[1], 1.5 + 2.5 * t, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        // Thread phase
                        if (phase.id === 'thread') {
                            const v = solveVertex('dualContour', pts);
                            const cp = map(cx + v.u, cy + v.v);
                            const neighbors = activeNeighborEdges(cellIdx);
                            const t = easeInOutCubic(phaseT);
                            ctx.strokeStyle = '#ff9ed2';
                            ctx.lineWidth = 2;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            for (const other of neighbors) {
                                const ov = state.vertices[other];
                                if (!ov) continue;
                                const ox2 = other % (n - 1), oy2 = (other / (n - 1)) | 0;
                                const op = map(ox2 + ov.u, oy2 + ov.v);
                                const ex2 = cp[0] + (op[0] - cp[0]) * t;
                                const ey2 = cp[1] + (op[1] - cp[1]) * t;
                                ctx.moveTo(cp[0], cp[1]);
                                ctx.lineTo(ex2, ey2);
                            }
                            ctx.stroke();
                        }
                    }
                }
            }

            function renderAnimation() {
                const r = animCanvas.getBoundingClientRect();
                const W = Math.max(1, r.width | 0), H = Math.max(1, r.height | 0);
                if (animCanvas.width !== W || animCanvas.height !== H) {
                    animCanvas.width = W; animCanvas.height = H;
                }
                const ctx = animCtx;
                ctx.clearRect(0, 0, W, H);
                const c = state.cached;
                if (!c.signed) return;
                const n = c.n;

                // MC reserves the top strip for the case table.
                let padTop = 0;
                if (state.algo === 'marchingCubes') {
                    padTop = drawCaseStrip(ctx, W, n);
                }
                const fit = fitSlice(W, H, padTop);
                const { ox, oy, side } = fit;

                // Dim field background.
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(fieldOff, ox, oy, side, side);
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(ox, oy, side, side);

                const map = makeMap(ox, oy, side, n);
                drawEmitted(ctx, map, c);
                drawCurrentCell(ctx, map, c, side / n, side / n);

                // Status line.
                const phases = PHASES[state.algo];
                const phase = phases[state.phaseIdx];
                const total = state.cellOrder.length;
                const sweepDone = state.cellStep >= total;
                // Panel header is structured (algo · phase · cell counter).
                hdrAlgo.textContent = state.algo;
                if (state.filling) {
                    hdrPhase.textContent = 'phase: fill (' +
                        (state.filling.t * 100 | 0) + '%)';
                    hdrCell.textContent = 'slices ' + state.gridN +
                        ' · α ' + state.ghostAlpha.toFixed(2);
                } else if (state.stitching) {
                    const st = state.stitching;
                    hdrPhase.textContent = 'phase: stitch ' +
                        (state.prevSlice ? state.prevSlice.z : '?') +
                        '→' + state.cached.z;
                    hdrCell.textContent = st.added + ' / ' + st.segs.length +
                        ' connectors';
                } else {
                    hdrPhase.textContent = sweepDone ? 'slice swept'
                        : (phase ? 'phase: ' + phase.id : '');
                    hdrCell.textContent = 'cell ' + Math.min(state.cellStep, total) +
                        ' / ' + total;
                }
                if (state.filling) {
                    status.textContent = 'filling surface';
                    status.style.display = '';
                } else if (state.stitching) {
                    status.textContent = 'stitching slices';
                    status.style.display = '';
                } else if (state.finished && !state.playing) {
                    status.textContent = 'mesh complete';
                    status.style.display = '';
                } else if (sweepDone && total > 0) {
                    status.textContent = 'slice complete';
                    status.style.display = '';
                } else {
                    status.style.display = 'none';
                }
            }

            // ----- main loop ----------------------------------------------------
            // Animation modes layered on top of the per-slice cell sweep:
            //   1. cell sweep    — phase-by-phase per active cell (original).
            //   2. stitch        — between slice Z and Z-1, fold in inter-slice
            //                      connector segments (the missing geometry
            //                      that turns stacked 2D contours into a
            //                      closed surface).
            //   3. fill          — after the last stitched slice, ramp the
            //                      ghost mesh opacity up in steps so the
            //                      wireframe resolves into solid geometry.
            function pauseAnimation() {
                state.playing = false;
                playBtn.textContent = 'Play';
                playBtn.classList.remove('toggled');
            }

            function triggerFillOrEnd() {
                if (!state.finished && state.prevSlice) {
                    state.finished = true;
                    startFill();
                } else {
                    pauseAnimation();
                }
            }

            // Called once the current slice's per-cell sweep is exhausted.
            // Decides whether to stitch, advance, fill, or stop.
            function onSliceComplete() {
                const hasFeatures = state.cellOrder.length > 0;
                const hasPrev = state.prevSlice != null;

                if (hasFeatures && hasPrev) {
                    // Try to start a stitch to the previously snapshotted slice.
                    if (startStitch()) return;
                    // If no shared columns produced segments, fall through.
                }
                if (hasFeatures) snapshotCurrentSlice();

                if (!state.sweepVolume) { pauseAnimation(); return; }

                // We've finished a (possibly empty) slice. If we just left a
                // non-empty run and entered emptiness, that's the cue to fill.
                if (!hasFeatures && hasPrev) { triggerFillOrEnd(); return; }

                // Walk forward through any empty slices. If we left a non-empty
                // run we'd already have returned above; here we only iterate
                // leading-empty or interior-empty (rare) gaps.
                while (state.sliceZ < state.gridN - 1) {
                    if (!advanceSlice()) break;
                    if (state.cellOrder.length > 0) return; // resume cell sweep
                    if (hasPrev) { triggerFillOrEnd(); return; }
                }
                triggerFillOrEnd();
            }

            function stepCellSweep(dt) {
                const phases = PHASES[state.algo];
                const phase = phases[state.phaseIdx];
                const dur = phase.ms / state.speed;
                state.phaseT += dt / Math.max(1, dur);
                while (state.phaseT >= 1) {
                    state.phaseT -= 1;
                    state.phaseIdx++;
                    if (state.phaseIdx >= phases.length) {
                        commitCell(state.cellOrder[state.cellStep]);
                        state.cellStep++;
                        state.phaseIdx = 0;
                        if (state.cellStep >= state.cellOrder.length) {
                            state.phaseT = 0;
                            return;
                        }
                    }
                }
            }

            function stepStitch(dt) {
                const st = state.stitching;
                st.t += dt / Math.max(1, st.ms / state.speed);
                if (st.t > 1) st.t = 1;
                const target = Math.floor(st.t * st.segs.length);
                while (st.added < target) {
                    state.segments3D.push(st.segs[st.added++]);
                }
                state.wireDirty = state.wireDirty || (st.added > 0);
                if (st.t >= 1) {
                    flushStitchRemaining();
                    state.stitching = null;
                    // Snapshot what we just stitched-from so the next non-empty
                    // slice can chain to it.
                    snapshotCurrentSlice();
                    if (state.sweepVolume) {
                        if (!advanceSlice()) triggerFillOrEnd();
                    } else {
                        pauseAnimation();
                    }
                }
            }

            function stepFill(dt) {
                const f = state.filling;
                f.t += dt / Math.max(1, f.ms / state.speed);
                if (f.t > 1) f.t = 1;
                const step = Math.min(f.steps, Math.floor(f.t * (f.steps + 1)));
                if (step !== f.lastStep) {
                    f.lastStep = step;
                    const k = f.steps > 0 ? step / f.steps : 1;
                    const a = f.fromA + (f.toA - f.fromA) * k;
                    state.ghostAlpha = a;
                    createGhostMesh(a);
                }
                if (f.t >= 1) {
                    if (state.ghostAlpha !== f.toA) {
                        state.ghostAlpha = f.toA;
                        createGhostMesh(f.toA);
                    }
                    state.filling = null;
                    pauseAnimation();
                }
            }

            function tick(now) {
                if (state.autoRotate) {
                    Camera.orbitLook(cam, 0.4, 0);
                    scene.setCamera(Camera.orbitViewOpts(cam, canvas));
                }
                if (state.lastT === 0) state.lastT = now;
                const dt = Math.min(100, now - state.lastT);   // clamp ms
                state.lastT = now;

                if (state.playing) {
                    state.playTimeMs += dt;
                    const target = Math.pow(SPEED_MAX, state.speedExp);
                    const rt = Math.min(1, state.playTimeMs / state.rampMs);
                    state.speed = 1 + (target - 1) * rt;
                    refreshSpeedLabel();
                    if (state.filling) {
                        stepFill(dt);
                    } else if (state.stitching) {
                        stepStitch(dt);
                    } else if (state.cellStep < state.cellOrder.length) {
                        stepCellSweep(dt);
                    } else {
                        onSliceComplete();
                    }
                }

                // Throttled wireframe rebuild — only after at least one new
                // commit, and never more than ~10Hz to keep updateMesh cost
                // bounded when the speed slider is cranked up.
                if (state.wireDirty && now - (state.lastWireRebuild || 0) > 90) {
                    refreshWireMesh();
                    state.lastWireRebuild = now;
                }
                renderAnimation();

                // Slice label.
                // Slice header & stats.
                sliceZNum.textContent = state.cached.z + ' / ' + (state.cached.n - 1);
                sliceLabel.textContent =
                    'range ' + state.cached.mn.toFixed(2) +
                    ' .. ' + state.cached.mx.toFixed(2) +
                    '    active cells: ' + state.cellOrder.length;

                state.animFrame = requestAnimationFrame(tick);
            }

            // ----- input --------------------------------------------------------
            // Main canvas: wheel zoom + middle-button pan only. Rotation is
            // delegated to the engine gizmo (bro.gizmo in rotate mode) so a
            // stray drag on the scene doesn't tear the shape out of view.
            let panDrag = null;
            canvas.addEventListener('mousedown', e => {
                if (e.button !== 1) return;
                state.autoRotate = false;
                panDrag = { x: e.clientX, y: e.clientY };
                e.preventDefault();
            });
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            canvas.addEventListener('wheel', e => {
                cam.dist = Math.max(2, Math.min(80, cam.dist + e.deltaY * 0.02));
                scene.setCamera(Camera.orbitViewOpts(cam, canvas));
                e.preventDefault();
            });
            window.addEventListener('mousemove', e => {
                if (!panDrag) return;
                const dx = e.clientX - panDrag.x, dy = e.clientY - panDrag.y;
                panDrag.x = e.clientX; panDrag.y = e.clientY;
                Camera.orbitPan(cam, dx, dy);
                scene.setCamera(Camera.orbitViewOpts(cam, canvas));
            });
            window.addEventListener('mouseup', () => { panDrag = null; });

            // ----- view gizmo (engine) -----------------------------------------
            // bro.gizmo in rotate mode at the scene origin (which is the
            // center of the iso volume). User grabs a ring → we orbit the
            // camera around its pivot by the same world-space quaternion.
            function applyOrbitDelta(qx, qy, qz, qw) {
                const q = [qx, qy, qz, qw];
                cam.rot = Camera.quatNorm(Camera.quatMul(q, cam.rot));
                const ox = cam.pos[0] - cam.pivot[0];
                const oy = cam.pos[1] - cam.pivot[1];
                const oz = cam.pos[2] - cam.pivot[2];
                const off = Camera.quatRotVec(q, [ox, oy, oz]);
                cam.pos = [cam.pivot[0]+off[0], cam.pivot[1]+off[1], cam.pivot[2]+off[2]];
                scene.setCamera(Camera.orbitViewOpts(cam, canvas));
            }
            if (typeof bro !== 'undefined' && bro.gizmo) {
                bro.gizmo.setMode('rotate');
                bro.gizmo.setSpace('world');
                bro.gizmo.setPosition(0, 0, 0);
                bro.gizmo.configure({ size: 80, alwaysOnTop: true });
                bro.gizmo.attach({
                    beginDrag: () => { state.autoRotate = false; },
                    rotate: applyOrbitDelta,
                });
            }

            sliceSlider.oninput = () => {
                state.sliceZ = parseInt(sliceSlider.value, 10);
                invalidateSlice();
                recomputeSliceCache();
                paintFieldOff();
                // Don't blow away the 3D wireframe just because the user scrubbed
                // to inspect a different slice. Only restart the per-slice sweep.
                restartSlice();
            };

            // --- params ----------------------------------------------------------
            AVUI.mkSelect(params, 'algo', ALGOS, state.algo, v => {
                state.algo = v;
                rebuildMesh();
                resetAnim();
            });
            AVUI.mkSelect(params, 'field', FIELDS, state.field, v => {
                state.field = v;
                rebuildField();
            });
            AVUI.mkRange(params, 'iso', state.isoLevel, -3.0, 3.0, 0.05, v => {
                state.isoLevel = v;
                invalidateSlice();
                rebuildMesh();
                recomputeSliceCache();
                paintFieldOff();
                resetAnim();
            }, v => v.toFixed(2));
            AVUI.mkRange(params, 'grid', state.gridN, 16, 64, 4, v => {
                state.gridN = v | 0;
                rebuildField();
            }, v => `${v|0}`);
            AVUI.mkRange(params, 'cell', state.cellSize, 0.2, 1.0, 0.05, v => {
                state.cellSize = v;
                rebuildMesh();
            }, v => v.toFixed(2));
            AVUI.mkNumber(params, 'seed', state.seed, 1, v => {
                state.seed = v | 0;
                if (state.field === 'noise') rebuildField();
            });
            const rotBtn = AVUI.mkButton(params, 'auto-rotate', () => {
                state.autoRotate = !state.autoRotate;
                rotBtn.classList.toggle('toggled', state.autoRotate);
            });
            rotBtn.classList.toggle('toggled', state.autoRotate);

            sweepBtn.classList.add('toggled');
            playBtn.classList.add('toggled');
            playBtn.textContent = 'Pause';
            rebuildField();
            state.animFrame = requestAnimationFrame(tick);
            return { scene, state, wrap };
        },

        destroy(handle) {
            if (handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.state.mesh) handle.state.mesh.destroy();
            if (handle.state.wireMesh) handle.state.wireMesh.destroy();
            if (typeof bro !== 'undefined' && bro.gizmo) {
                bro.gizmo.detach();
                bro.gizmo.hide();
            }
            if (handle.wrap) handle.wrap.remove();
        },
    });
})();
