// FBm decomposition. FBm = sum_i gain^i * noise(lacunarity^i * x).
//
// LEFT  The full FBm sum. For 'Simplex' it is one GPU draw
//       (bro.image.gpu.fbm2D: no CPU buffer, no upload); the other types
//       generate on the CPU with FastNoise2 in a Worker (noise-worker.js)
//       and upload through bro.image.gpu.colormap. Either way a tile wider
//       than the view is generated at most once a second (or when the
//       params change / the scroll runs off it), and every frame between is
//       a cheap colormap pass over a sliding viewRect, so the field scrolls
//       at frame rate while generation runs at 1 Hz.
// RIGHT One thumbnail per octave: the BASE noise at that octave's frequency
//       (x lacunarity^i), refreshed at 1 Hz.

import { h } from "/lib/kit/dom.js";
import { register } from "./registry.js";
import { controls, toggle, overlay, lifetime } from "./ui.js";

const TYPES = ['Simplex', 'SuperSimplex', 'Perlin', 'Value', 'CellularValue', 'CellularDistance'];
const THUMB = 96;
const EXTRA_BUFFER_PX = 512;     // scroll buffer beyond the visible width
const TILE_REGEN_MS = 1000;
const THUMB_REGEN_MS = 1000;

register({
    id: 'noise',
    name: 'FastNoise2 — FBm decomposition',
    category: 'Noise',
    subtitle: 'Fractional Brownian motion (FBm) = sum of octaves. Each octave is the base noise at frequency × lacunarityⁱ scaled by gainⁱ. Watch the sum (left) build from the octaves (right).',

    init({ stage, params }) {
        const life = lifetime();
        const mainCanvas = h('canvas.av-fill');
        const mainBox = h('div.av-box.av-grow', null, mainCanvas);
        const label = overlay(mainBox);
        const formula = h('div.av-formula');
        const octCol = h('div.av-octaves', null, h('div.k-cap', null, 'Octaves (base × gainⁱ)'));
        stage.appendChild(h('div.av-split', null,
            h('div.av-col.av-grow', null, mainBox, formula), octCol));

        const gl = mainCanvas.getContext('webgl2');
        if (!gl) throw new Error('noise: webgl2 is not available on this canvas');

        const state = {
            type: 'Simplex', frequency: 0.008, octaves: 4, gain: 0.5, lacunarity: 2.0,
            speed: 6, seed: 1337, running: true,
            ox: 0, oy: 0, animTime: 0, lastT: 0,
            tileOx: 0, tileW: 0, tileH: 0, tileRegenT: 0, dirty: true,
            thumbsRegenT: 0, thumbsDirty: true,
        };
        const cpu = { busy: false, ready: false, ox: 0, w: 0, h: 0, spare: null };

        const colorLut = bro.image.gradient([
            [0.00, 10, 30, 80], [0.45, 230, 220, 150], [0.55, 100, 170, 90], [0.75, 250, 250, 250],
        ], 256);
        const octaveLut = bro.image.gradient([
            [0.00, 30, 30, 60], [0.50, 130, 130, 150], [1.00, 240, 240, 240],
        ], 256);

        // Thumbnails sample the base noise here (tiny 96x96 reads at 1 Hz);
        // the FBm tile's own nodes live in the worker.
        // Feature Scale 1: `frequency` is features per unit, as in the GPU
        // shader (FastNoise2's default scale is ~100 units per feature).
        const makeBase = (type) => { const n = FastNoise.create(type); n.set('Feature Scale', 1); return n; };
        let baseNode = makeBase(state.type);
        const thumbs = [];
        function rebuildOctaves() {
            while (thumbs.length > state.octaves) thumbs.pop().row.remove();
            while (thumbs.length < state.octaves) {
                const cv = h('canvas.av-thumb', { width: THUMB, height: THUMB });
                const ctx = cv.getContext('2d');
                const name = h('div.av-octname'), info = h('div');
                const row = h('div.av-octave', null, cv, h('div.av-octinfo', null, name, info));
                octCol.appendChild(row);
                thumbs.push({ row, ctx, img: ctx.createImageData(THUMB, THUMB), name, info,
                              buf: bro.image.alloc(THUMB, THUMB, 1), text: '' });
            }
        }
        rebuildOctaves();
        const markDirty = () => { state.dirty = true; state.thumbsDirty = true; };

        // --- CPU tile worker -------------------------------------------------
        const worker = new Worker('viz/noise-worker.js');
        worker.onmessage = (e) => {
            const r = e.data;
            cpu.busy = false;
            if (!life.alive) return;
            const buf = new Float32Array(r.buffer);
            bro.image.gpu.colormap(mainCanvas, buf, colorLut, {
                srcW: r.tileW, srcH: r.tileH, autoRange: true,
                viewRect: { x: state.ox - r.tileOx, y: 0, w: mainCanvas.width | 0, h: mainCanvas.height | 0 },
            });
            Object.assign(cpu, { ready: true, ox: r.tileOx, w: r.tileW, h: r.tileH, spare: buf });
        };
        function dispatchCpuTile(tileW, tileH) {
            if (!cpu.spare || cpu.spare.length < tileW * tileH) cpu.spare = new Float32Array(tileW * tileH);
            const buf = cpu.spare;
            cpu.spare = null;                       // ownership moves to the worker
            cpu.busy = true;
            worker.postMessage({
                type: state.type, octaves: state.octaves, gain: state.gain,
                lacunarity: state.lacunarity, frequency: state.frequency, seed: state.seed,
                tileOx: state.ox, oy: state.oy, tileW, tileH, buffer: buf.buffer,
            }, [buf.buffer]);
        }

        function renderMain(now) {
            const cw = mainCanvas.clientWidth | 0, ch = mainCanvas.clientHeight | 0;
            if (cw < 4 || ch < 4) return;
            let sized = false;
            if (mainCanvas.width !== cw || mainCanvas.height !== ch) {
                mainCanvas.width = cw; mainCanvas.height = ch; sized = true;
            }
            const tileW = cw + EXTRA_BUFFER_PX, tileH = ch;
            const stale = (ox, w, hh) => sized || state.dirty
                || state.ox - ox < 0 || state.ox - ox > tileW - cw
                || tileW !== w || tileH !== hh
                || now - state.tileRegenT >= TILE_REGEN_MS;

            if (state.type === 'Simplex') {
                // GPU FBm. Still tile-cached: autoRange's EMA wants a stable input.
                if (stale(state.tileOx, state.tileW, state.tileH)) {
                    Object.assign(state, { tileOx: state.ox, tileRegenT: now, dirty: false, tileW, tileH });
                    bro.image.gpu.fbm2D(mainCanvas, colorLut, {
                        type: 'Simplex', frequency: state.frequency, octaves: state.octaves,
                        gain: state.gain, lacunarity: state.lacunarity, seed: state.seed,
                        ox: state.tileOx, oy: state.oy, srcW: tileW, srcH: tileH,
                        autoRange: true, viewRect: { x: 0, y: 0, w: cw, h: ch },
                    });
                } else {
                    bro.image.gpu.fbm2D(mainCanvas, colorLut, {
                        regenerate: false, autoRange: true,
                        viewRect: { x: state.ox - state.tileOx, y: 0, w: cw, h: ch },
                    });
                }
            } else {
                if ((!cpu.ready || stale(cpu.ox, cpu.w, cpu.h)) && !cpu.busy) {
                    state.dirty = false;
                    state.tileRegenT = now;
                    dispatchCpuTile(tileW, tileH);
                }
                if (cpu.ready) {
                    bro.image.gpu.colormap(mainCanvas, null, colorLut, {
                        regenerate: false, autoRange: true,
                        viewRect: { x: state.ox - cpu.ox, y: 0, w: cw, h: ch },
                    });
                }
            }
            label.set('FBm sum  (' + state.octaves + ' octaves)\ntype     ' + state.type + '\nrange    auto (GPU EMA)');
        }

        function renderThumbnails(now) {
            if (!state.thumbsDirty && now - state.thumbsRegenT < THUMB_REGEN_MS) return;
            state.thumbsRegenT = now;
            state.thumbsDirty = false;
            const cw = mainCanvas.width || mainCanvas.clientWidth || 1;
            let totalAmp = 0;
            for (let i = 0, a = 1; i < state.octaves; i++, a *= state.gain) totalAmp += a;
            let lac = 1, amp = 1;
            for (const t of thumbs) {
                const f = state.frequency * lac;
                // Offsets are world space: the view's origin at this octave's frequency.
                baseNode.genUniformGrid2DInto(t.buf, state.ox * f, state.oy * f, THUMB, THUMB, f * (cw / THUMB), state.seed);
                const { min, max } = bro.image.reduce(t.buf, 'minmax', { stride: 4 });
                bro.image.lookup(t.img.data, t.buf, octaveLut, { lo: min, hi: max - min > 1e-6 ? max : min + 1e-6 });
                t.ctx.putImageData(t.img, 0, 0);
                const text = 'freq  ' + f.toFixed(4) + '\namp   ' + amp.toFixed(4) + '\n'
                    + (amp / totalAmp * 100).toFixed(1) + '% of FBm';
                if (text !== t.text) {
                    t.text = text;
                    t.name.textContent = 'octave ' + (thumbs.indexOf(t) + 1);
                    t.info.textContent = text;
                }
                lac *= state.lacunarity;
                amp *= state.gain;
            }
        }

        let formulaKey = '';
        function renderFormula() {
            const key = [state.gain, state.frequency, state.lacunarity, state.octaves, state.type].join('|');
            if (key === formulaKey) return;
            formulaKey = key;
            formula.replaceChildren(
                h('span.av-accent', null, 'FBm(x,y)'), ' = (1 / Σ aᵢ) · Σ aᵢ · noise(fᵢ · x, fᵢ · y)  ',
                h('span.dim', null, 'where'), '  aᵢ = ' + state.gain + 'ⁱ,  fᵢ = ' + state.frequency
                    + ' · ' + state.lacunarity + 'ⁱ,  i = 0..' + (state.octaves - 1) + '  ',
                h('span.dim', null, '(' + state.type + ')'));
        }

        life.loop((now) => {
            if (state.lastT === 0) state.lastT = now;
            const dt = Math.min(0.1, (now - state.lastT) / 1000);
            state.lastT = now;
            if (state.running) { state.animTime += dt * state.speed; state.ox = state.animTime; }
            renderMain(now);
            renderThumbnails(now);
            renderFormula();
        });

        controls(params, state, {
            type:       { options: TYPES },
            frequency:  { min: 0.001, max: 0.05, step: 0.001, label: 'freq' },
            octaves:    { min: 1, max: 8, step: 1 },
            gain:       { min: 0.1, max: 0.9, step: 0.05 },
            lacunarity: { min: 1.5, max: 4.0, step: 0.1, label: 'lacun' },
            speed:      { min: 0, max: 40, step: 1, fmt: (v) => (v | 0) + '/s' },
            seed:       { type: 'number', step: 1 },
        }, (key) => {
            if (key === 'speed') return;
            if (key === 'seed') state.seed |= 0;
            if (key === 'type') baseNode = makeBase(state.type);
            if (key === 'octaves') rebuildOctaves();
            markDirty();
        });
        toggle(params, 'Animate', state.running, (on) => { state.running = on; });

        return { life, worker, state, cpu };
    },

    destroy(handle) {
        handle.life.dispose();
        handle.worker.terminate();
    },
});
