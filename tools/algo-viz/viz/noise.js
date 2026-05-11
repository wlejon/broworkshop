// FastNoise2 2D heatmap, GPU-colormapped via bro.image.gpu.colormap.
// Noise is generated each frame on CPU (FastNoise2 SIMD, fast), uploaded
// to a R32F texture, and colormapped by a fragment shader that samples a
// 256-entry RGBA8 LUT — no ImageData / putImageData on the hot path.

(function () {
    const TYPES = ['Simplex', 'SuperSimplex', 'Perlin', 'Value',
                   'CellularValue', 'CellularDistance'];
    const FRACTALS = ['None', 'FBm', 'Ridged'];

    function buildNode(type, octaves, gain, lacunarity, fractal) {
        const base = FastNoise.create(type);
        if (fractal === 'None' || octaves <= 1) return base;
        const wrap = fractal === 'Ridged' ? FastNoise.FractalRidged()
                                          : FastNoise.FractalFBm();
        wrap.set('Source', base);
        wrap.set('Octaves', octaves | 0);
        wrap.set('Gain', gain);
        wrap.set('Lacunarity', lacunarity);
        return wrap;
    }

    VIZ.push({
        id: 'noise',
        name: 'FastNoise2',
        category: 'Noise',
        subtitle: 'SIMD-accelerated coherent + cellular noise. Optional FractalFBm wraps the base node.',

        init({ stage, params }) {
            // Container holds the WebGL canvas + an HTML readout overlay,
            // since the GPU canvas can't host canvas2d text.
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;width:100%;height:100%';
            stage.appendChild(wrap);

            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'display:block;width:100%;height:100%';
            wrap.appendChild(canvas);

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute;left:6px;top:6px;'
                + 'padding:4px 8px;background:rgba(0,0,0,0.55);color:#ddd;'
                + 'font:11px monospace;pointer-events:none;line-height:1.3';
            wrap.appendChild(overlay);

            const state = {
                type: 'Simplex',
                octaves: 4,
                gain: 0.5,
                lacunarity: 2.0,
                frequency: 0.008,
                seed: 1337,
                fractal: 'FBm',
                grayscale: false,
                ox: 0, oy: 0,
                animTime: 0,
                // Frame-rate-independent scroll. ~12 noise units / second
                // is slow enough to follow features without nausea.
                scrollSpeed: 12,
                running: true,
                animFrame: null,
                lastT: 0,
                dirty: true,
                // EMA-tracked colormap range. Adapts to the actual output
                // distribution of the current node so colors fill the LUT
                // without clamping or breathing. Reset when structure changes.
                emaLo: null,
                emaHi: null,
            };

            // Cached FastNoise node; invalidated when any structural param changes.
            let cachedNode = null;
            let cachedKey = '';
            function getNode() {
                const key = `${state.type}|${state.fractal}|${state.octaves}|${state.gain}|${state.lacunarity}`;
                if (key !== cachedKey) {
                    cachedNode = buildNode(state.type, state.octaves, state.gain,
                                           state.lacunarity, state.fractal);
                    cachedKey = key;
                    // Output distribution will differ — let EMA re-converge.
                    state.emaLo = null; state.emaHi = null;
                }
                return cachedNode;
            }

            // LUTs are CPU-built once; the GPU helper uploads them as
            // 256x1 RGBA8 textures and reuses the upload across frames.
            const colorLut = bro.image.gradient([
                [0.00,  10,  30,  80],
                [0.45, 230, 220, 150],
                [0.55, 100, 170,  90],
                [0.75, 250, 250, 250],
            ], 256);
            const grayLut = bro.image.gradient([
                [0, 0, 0, 0], [1, 255, 255, 255],
            ], 256);

            function regen() {
                const cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
                if (cw < 4 || ch < 4) return;
                const w = cw, h = ch;
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w; canvas.height = h;
                }
                const node = getNode();
                const data = node.genUniformGrid2D(state.ox, state.oy,
                                                   w, h, state.frequency, state.seed);

                // EMA-track the observed min/max so the LUT spans the actual
                // distribution. Snap on first frame (or after a structural
                // change) so we don't start from a degenerate range; otherwise
                // converge slowly (~1s @ 60fps) so scrolling can't breathe.
                const { min: mn, max: mx } = bro.image.reduce(data, 'minmax');
                if (state.emaLo === null) {
                    state.emaLo = mn; state.emaHi = mx;
                } else {
                    const a = 0.02;
                    state.emaLo += a * (mn - state.emaLo);
                    state.emaHi += a * (mx - state.emaHi);
                }
                // Guard against a degenerate flat frame producing lo === hi.
                let lo = state.emaLo, hi = state.emaHi;
                if (hi - lo < 1e-6) hi = lo + 1e-6;

                const lut = state.grayscale ? grayLut : colorLut;
                bro.image.gpu.colormap(canvas, data, lut, {
                    lo, hi, srcW: w, srcH: h,
                });

                const tag = state.fractal === 'None' ? state.type
                          : `${state.type} + ${state.fractal}`;
                overlay.textContent = `${tag}\nmin ${mn.toFixed(3)}  max ${mx.toFixed(3)}`
                    + `\nrange ${lo.toFixed(3)}..${hi.toFixed(3)}`;
                overlay.style.whiteSpace = 'pre';
            }

            function loop(now) {
                if (state.lastT === 0) state.lastT = now;
                const dt = Math.min(0.1, (now - state.lastT) / 1000);
                state.lastT = now;
                if (state.running) {
                    state.animTime += dt * state.scrollSpeed;
                    state.ox = state.animTime;
                    state.dirty = true;
                }
                if (state.dirty) {
                    state.dirty = false;
                    regen();
                }
                state.animFrame = requestAnimationFrame(loop);
            }

            // Type/seed/fractal changes alter the output distribution — reset
            // the EMA so the LUT range re-converges instead of dragging the
            // old range across the new noise.
            function mark() { state.dirty = true; }
            function structuralChange() { state.emaLo = null; state.emaHi = null; state.dirty = true; }

            // Params
            AVUI.mkSelect(params, 'type', TYPES, state.type, v => { state.type = v; structuralChange(); });
            AVUI.mkSelect(params, 'fractal', FRACTALS, state.fractal, v => { state.fractal = v; structuralChange(); });
            AVUI.mkRange(params, 'freq', state.frequency, 0.001, 0.05, 0.001,
                v => { state.frequency = v; mark(); }, v => v.toFixed(3));
            AVUI.mkRange(params, 'octaves', state.octaves, 1, 8, 1,
                v => { state.octaves = v | 0; structuralChange(); }, v => `${v|0}`);
            AVUI.mkRange(params, 'gain', state.gain, 0.1, 0.9, 0.05,
                v => { state.gain = v; structuralChange(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'lacun', state.lacunarity, 1.5, 4.0, 0.1,
                v => { state.lacunarity = v; structuralChange(); }, v => v.toFixed(2));
            AVUI.mkRange(params, 'speed', state.scrollSpeed, 0, 60, 1,
                v => { state.scrollSpeed = v; }, v => `${v|0}/s`);
            AVUI.mkNumber(params, 'seed', state.seed, 1, v => { state.seed = v | 0; structuralChange(); });
            const grayBtn = AVUI.mkButton(params, 'Gray', () => {
                state.grayscale = !state.grayscale;
                grayBtn.classList.toggle('toggled', state.grayscale);
                mark();
            });
            const animBtn = AVUI.mkButton(params, 'Animate', () => {
                state.running = !state.running;
                animBtn.classList.toggle('toggled', state.running);
            });
            animBtn.classList.add('toggled');

            state.animFrame = requestAnimationFrame(loop);
            return { state };
        },

        destroy(handle) {
            if (handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
        },
    });
})();
