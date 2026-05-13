// FBm decomposition. FBm = sum_i (gain^i) * noise(lacunarity^i * x).
//
// LEFT  The full FBm sum.  Driven by bro.image.gpu.fbm2D for type='Simplex'
//       (one GPU draw — no CPU buffer, no upload), and by the CPU FastNoise
//       gen + bro.image.gpu.colormap path for the other types. Either way,
//       the underlying tile is regenerated only at TILE_REGEN_MS, and every
//       frame in between is a cheap colormap pass with a sliding viewRect —
//       so the field scrolls smoothly at frame-rate while the expensive
//       generation runs at 1Hz.
//
// RIGHT One thumbnail per octave, showing the BASE noise at that octave's
//       frequency (×lacunarityⁱ). Thumbnails are tiny (96×96) and refresh at
//       1Hz; labels are diffed so we only touch innerHTML on actual changes.

(function () {
    const TYPES = ['Simplex', 'SuperSimplex', 'Perlin', 'Value',
                   'CellularValue', 'CellularDistance'];

    const THUMB_RES = 96;

    // Tile sizing for the main view's pre-render-wide + slide-window pattern.
    // EXTRA_BUFFER_PX is the horizontal scroll buffer beyond the visible
    // canvas; TILE_REGEN_MS is how often we re-run the gen pass at minimum
    // (we'll also regen any time we exhaust the buffer or params change).
    const EXTRA_BUFFER_PX = 512;
    const TILE_REGEN_MS = 1000;
    const THUMB_REGEN_MS = 1000;

    VIZ.push({
        id: 'noise',
        name: 'FastNoise2 — FBm decomposition',
        category: 'Noise',
        subtitle: 'Fractional Brownian motion (FBm) = sum of octaves. Each octave is the base noise at frequency × lacunarityⁱ scaled by gainⁱ. Watch the sum (left) build from the octaves (right).',

        init({ stage, params }) {
            // --- layout -----------------------------------------------------------
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;inset:0;display:flex;gap:8px;padding:8px;box-sizing:border-box';
            stage.appendChild(wrap);

            const leftCol = document.createElement('div');
            leftCol.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;gap:6px;min-width:0';
            wrap.appendChild(leftCol);

            const mainBox = document.createElement('div');
            mainBox.style.cssText = 'position:relative;flex:1 1 auto;background:#080808;border:1px solid #222;overflow:hidden';
            leftCol.appendChild(mainBox);

            const mainCanvas = document.createElement('canvas');
            mainCanvas.style.cssText = 'background:#000;display:block;position:absolute;inset:0;width:100%;height:100%';
            mainBox.appendChild(mainCanvas);

            const mainLabel = document.createElement('div');
            mainLabel.style.cssText = 'position:absolute;left:8px;top:8px;'
                + 'padding:4px 8px;background:rgba(0,0,0,0.6);color:#ddd;'
                + 'font:11px monospace;white-space:pre;pointer-events:none';
            mainBox.appendChild(mainLabel);

            const formula = document.createElement('div');
            formula.style.cssText = 'flex:0 0 auto;padding:6px 10px;background:#0c0c0c;border:1px solid #1c1c1c;font:11px monospace;color:#bbb;line-height:1.5';
            leftCol.appendChild(formula);

            const rightCol = document.createElement('div');
            rightCol.style.cssText = 'flex:0 0 ' + (THUMB_RES + 130) + 'px;display:flex;flex-direction:column;gap:4px;overflow:auto';
            wrap.appendChild(rightCol);

            const octHeader = document.createElement('div');
            octHeader.style.cssText = 'font:10px monospace;color:#666;letter-spacing:1px;text-transform:uppercase;padding:2px 0';
            octHeader.textContent = 'Octaves (base × gainⁱ)';
            rightCol.appendChild(octHeader);

            // --- state -------------------------------------------------------------
            const state = {
                type: 'Simplex',
                octaves: 4,
                gain: 0.5,
                lacunarity: 2.0,
                frequency: 0.008,
                seed: 1337,
                running: true,
                scrollSpeed: 6,    // grid units / sec (matches FastNoise2 GenUniformGrid2D semantics)
                ox: 0, oy: 0,
                animTime: 0,
                lastT: 0,
                animFrame: null,

                // Main tile state for the pre-render-wide + slide pattern.
                tileOx: 0,           // grid origin of the current tile
                tileRegenT: 0,       // ms of last full regen (rAF clock)
                tileW: 0, tileH: 0,  // last allocated tile dims
                tileDirty: true,     // structural params changed → force regen
                tileBuf: null,       // Float32Array (CPU-path only)

                // Thumbnails refresh at 1Hz; track last regen and whether
                // any structural param changed.
                thumbsRegenT: 0,
                thumbsDirty: true,

                // innerHTML diff caches so we only touch the DOM when text
                // actually changed.
                formulaCache: '',
                lastMainLabel: '',
            };

            const octThumbs = [];           // {row, canvas, ctx, img, lbl, buf, lblCache}
            const mainCtx2D = mainCanvas.getContext('webgl2');
            if (!mainCtx2D) {
                // Fall back gracefully — the engine path needs webgl2.
                throw new Error('algo-viz noise.js: webgl2 not supported on this canvas');
            }

            const colorLut = bro.image.gradient([
                [0.00,  10,  30,  80],
                [0.45, 230, 220, 150],
                [0.55, 100, 170,  90],
                [0.75, 250, 250, 250],
            ], 256);
            const octaveLut = bro.image.gradient([
                [0.00,  30,  30,  60],
                [0.50, 130, 130, 150],
                [1.00, 240, 240, 240],
            ], 256);

            // FastNoise nodes drive (a) the thumbnails always, and (b) the
            // main tile when type !== 'Simplex' (Simplex goes through the
            // GPU FBm shader). Rebuilt when structural params change.
            let baseNode = null, fbmNode = null;
            function rebuildNodes() {
                baseNode = FastNoise.create(state.type);
                if (state.octaves > 1) {
                    fbmNode = FastNoise.FractalFBm();
                    fbmNode.set('Source', baseNode);
                    fbmNode.set('Octaves', state.octaves | 0);
                    fbmNode.set('Gain', state.gain);
                    fbmNode.set('Lacunarity', state.lacunarity);
                } else {
                    fbmNode = baseNode;
                }
            }
            rebuildNodes();

            function rebuildOctaves() {
                for (let i = state.octaves; i < octThumbs.length; i++) {
                    octThumbs[i].row.remove();
                }
                octThumbs.length = state.octaves;
                for (let i = 0; i < state.octaves; i++) {
                    if (!octThumbs[i]) {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;gap:6px;align-items:center';
                        const cv = document.createElement('canvas');
                        cv.width = THUMB_RES; cv.height = THUMB_RES;
                        cv.style.cssText = 'image-rendering:pixelated;background:#000;border:1px solid #1f1f1f;position:static;flex:0 0 auto';
                        cv.style.width = THUMB_RES + 'px'; cv.style.height = THUMB_RES + 'px';
                        const ctx = cv.getContext('2d');
                        const img = ctx.createImageData(THUMB_RES, THUMB_RES);
                        const lbl = document.createElement('div');
                        lbl.style.cssText = 'font:10px monospace;color:#bbb;line-height:1.4';
                        row.appendChild(cv); row.appendChild(lbl);
                        rightCol.appendChild(row);
                        octThumbs[i] = {
                            row, cv, ctx, img, lbl,
                            buf: bro.image.alloc(THUMB_RES, THUMB_RES, 1),
                            lblCache: '',
                        };
                    }
                }
            }
            rebuildOctaves();

            // Bumped whenever structural params change so the next frame
            // forces both a tile regen and a thumbnail refresh.
            function markDirty() {
                state.tileDirty = true;
                state.thumbsDirty = true;
            }

            // --- frame -----------------------------------------------------------

            function ensureTileBuf(w, h) {
                if (!state.tileBuf || state.tileBuf.length < w * h) {
                    state.tileBuf = bro.image.alloc(w, h, 1);
                }
            }

            function renderMain(now) {
                // Sync canvas backing-store to display size.
                const cw = mainCanvas.clientWidth | 0;
                const ch = mainCanvas.clientHeight | 0;
                if (cw < 4 || ch < 4) return;
                let sized = false;
                if (mainCanvas.width !== cw || mainCanvas.height !== ch) {
                    mainCanvas.width = cw;
                    mainCanvas.height = ch;
                    sized = true;
                }

                const tileW = cw + EXTRA_BUFFER_PX;
                const tileH = ch;
                const scrollPx = state.ox - state.tileOx;

                // Regen the tile when the buffer is exhausted, params changed,
                // canvas size changed, or the regen timer has fired.
                const needRegen = sized || state.tileDirty
                    || scrollPx < 0
                    || scrollPx > tileW - cw
                    || tileW !== state.tileW || tileH !== state.tileH
                    || (now - state.tileRegenT) >= TILE_REGEN_MS;

                if (needRegen) {
                    state.tileOx = state.ox;
                    state.tileRegenT = now;
                    state.tileDirty = false;
                    state.tileW = tileW;
                    state.tileH = tileH;

                    if (state.type === 'Simplex') {
                        bro.image.gpu.fbm2D(mainCanvas, colorLut, {
                            type: 'Simplex',
                            frequency: state.frequency,
                            octaves: state.octaves,
                            gain: state.gain,
                            lacunarity: state.lacunarity,
                            seed: state.seed,
                            ox: state.tileOx, oy: state.oy,
                            srcW: tileW, srcH: tileH,
                            autoRange: true,
                            viewRect: { x: 0, y: 0, w: cw, h: ch },
                        });
                    } else {
                        ensureTileBuf(tileW, tileH);
                        fbmNode.genUniformGrid2DInto(
                            state.tileBuf, state.tileOx, state.oy,
                            tileW, tileH, state.frequency, state.seed);
                        bro.image.gpu.colormap(mainCanvas, state.tileBuf, colorLut, {
                            srcW: tileW, srcH: tileH,
                            autoRange: true,
                            viewRect: { x: 0, y: 0, w: cw, h: ch },
                        });
                    }
                } else {
                    // Cheap path: one colormap quad with a translated viewRect.
                    const view = { x: scrollPx, y: 0, w: cw, h: ch };
                    if (state.type === 'Simplex') {
                        bro.image.gpu.fbm2D(mainCanvas, colorLut, {
                            regenerate: false,
                            autoRange: true,
                            viewRect: view,
                        });
                    } else {
                        bro.image.gpu.colormap(mainCanvas, null, colorLut, {
                            regenerate: false,
                            autoRange: true,
                            viewRect: view,
                        });
                    }
                }

                // Main label updated only when octave count / type changes
                // (autoRange means the live min/max isn't on CPU anymore).
                const newLabel = 'FBm sum  (' + state.octaves + ' octaves)\n'
                    + 'type     ' + state.type + '\n'
                    + 'range    auto (GPU EMA)';
                if (newLabel !== state.lastMainLabel) {
                    mainLabel.textContent = newLabel;
                    state.lastMainLabel = newLabel;
                }
            }

            function renderThumbnails(now) {
                if (!state.thumbsDirty &&
                    (now - state.thumbsRegenT) < THUMB_REGEN_MS) return;
                state.thumbsRegenT = now;
                state.thumbsDirty = false;

                const cw = mainCanvas.width || mainCanvas.clientWidth || 1;
                let amp = 1, totalAmp = 0;
                for (let i = 0; i < state.octaves; i++) { totalAmp += amp; amp *= state.gain; }

                let lac = 1; amp = 1;
                for (let i = 0; i < state.octaves; i++) {
                    const t = octThumbs[i];
                    const f = state.frequency * lac;
                    baseNode.genUniformGrid2DInto(
                        t.buf, state.ox, state.oy,
                        THUMB_RES, THUMB_RES,
                        f * (cw / THUMB_RES),
                        state.seed);
                    const { min: tmn, max: tmx } = bro.image.reduce(t.buf, 'minmax', { stride: 4 });
                    const tlo = tmn, thi = (tmx - tmn) > 1e-6 ? tmx : tmn + 1e-6;
                    bro.image.lookup(t.img.data, t.buf, octaveLut, { lo: tlo, hi: thi });
                    t.ctx.putImageData(t.img, 0, 0);

                    const contribution = (amp / totalAmp) * 100;
                    const lblText =
                        '<div style="color:#74b9ff;font-weight:bold">octave ' + (i + 1) + '</div>' +
                        'freq  ' + f.toFixed(4) + '<br>' +
                        'amp   ' + amp.toFixed(4) + '<br>' +
                        '<span style="color:#888">' + contribution.toFixed(1) + '% of FBm</span>';
                    if (lblText !== t.lblCache) {
                        t.lbl.innerHTML = lblText;
                        t.lblCache = lblText;
                    }
                    lac *= state.lacunarity;
                    amp *= state.gain;
                }
            }

            function renderFormula() {
                const text =
                    '<span style="color:#74b9ff">FBm(x,y)</span> = ' +
                    '(1 / Σ aᵢ) · Σ aᵢ · noise(fᵢ · x, fᵢ · y) ' +
                    '<span style="color:#666">where</span> ' +
                    '<span style="color:#eee">aᵢ = ' + state.gain + 'ⁱ</span>, ' +
                    '<span style="color:#eee">fᵢ = ' + state.frequency + ' · ' + state.lacunarity + 'ⁱ</span>, ' +
                    '<span style="color:#eee">i = 0..' + (state.octaves - 1) + '</span> ' +
                    '&nbsp;&nbsp;<span style="color:#888">(' + state.type + ')</span>';
                if (text !== state.formulaCache) {
                    formula.innerHTML = text;
                    state.formulaCache = text;
                }
            }

            function loop(now) {
                if (state.lastT === 0) state.lastT = now;
                const dt = Math.min(0.1, (now - state.lastT) / 1000);
                state.lastT = now;
                if (state.running) {
                    state.animTime += dt * state.scrollSpeed;
                    state.ox = state.animTime;
                }
                renderMain(now);
                renderThumbnails(now);
                renderFormula();
                state.animFrame = requestAnimationFrame(loop);
            }

            // --- params ----------------------------------------------------------

            AVUI.mkSelect(params, 'type', TYPES, state.type, v => {
                state.type = v; rebuildNodes(); markDirty();
            });
            AVUI.mkRange(params, 'freq', state.frequency, 0.001, 0.05, 0.001,
                v => { state.frequency = v; markDirty(); }, v => v.toFixed(3));
            AVUI.mkRange(params, 'octaves', state.octaves, 1, 8, 1, v => {
                state.octaves = v | 0; rebuildOctaves(); rebuildNodes(); markDirty();
            }, v => `${v|0}`);
            AVUI.mkRange(params, 'gain', state.gain, 0.1, 0.9, 0.05,
                v => { state.gain = v; rebuildNodes(); markDirty(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'lacun', state.lacunarity, 1.5, 4.0, 0.1,
                v => { state.lacunarity = v; rebuildNodes(); markDirty(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'speed', state.scrollSpeed, 0, 40, 1,
                v => { state.scrollSpeed = v; }, v => `${v|0}/s`);
            AVUI.mkNumber(params, 'seed', state.seed, 1, v => {
                state.seed = v | 0; markDirty();
            });
            const animBtn = AVUI.mkButton(params, 'Animate', () => {
                state.running = !state.running;
                animBtn.classList.toggle('toggled', state.running);
            });
            animBtn.classList.add('toggled');

            state.animFrame = requestAnimationFrame(loop);
            return { state, wrap };
        },

        destroy(handle) {
            if (handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.wrap) handle.wrap.remove();
        },
    });
})();
