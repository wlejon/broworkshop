// Learned terrain: the diffusion pipeline's stages, side by side.
//
// The sibling of noise.js, and deliberately the same shape. There, FBm is the
// sum of octaves and the strip shows each octave. Here, elevation is the
// product of UNets in series and the strip shows each stage:
//
//   coarse  ->  latent  ->  residual  ->  elevation
//   7.68 km     240 m       30 m          30 m
//
// The decomposition is the point. FBm has no notion of water flowing
// downhill, which is why its ridges and drainage never look like a planet's;
// this model does, and the strip is where you can see WHICH stage puts that
// structure in. A coastline already present in the coarse net came from the
// climate conditioning; one that appears at the residual came from the
// decoder.
//
// MAIN  The selected stage and channel, colour-mapped, auto-ranged.
// STRIP One thumbnail per stage at the same world corner, so a feature can be
//       followed up and down the DAG. Click one to view it.
//
// bro.diffusion.loadTerrain is synchronous and a cold stage costs seconds, so
// the world lives in terrain-worker.js and every read is an explicit request.
// (The old bro.worldgen binding also exposed the latent before refinement,
// 'latentInit'; TerrainWorld does not, so the strip has four stages.)

import { h } from "/lib/kit/dom.js";
import { findWeights } from "/lib/kit/weights.js";
import { pickFolder } from "/lib/kit/ml.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { register } from "./registry.js";
import { controls, button, overlay } from "./ui.js";

export const STAGES = ['coarse', 'latent', 'residual', 'elevation'];

/** Channel labels and units per stage (the binding returns bare planes). */
export const CHANNELS = {
    coarse:    [['elevation', ''], ['derived', ''], ['temperature', ''], ['temp seasonality', ''],
                ['precipitation', ''], ['precip seasonality', '']],
    latent:    [0, 1, 2, 3, 4].map((c) => ['latent ' + c, '']),
    residual:  [['residual', 'σ']],
    elevation: [['elevation', 'm']],
};

// Stage cells per native (30 m) cell: bounds are in each stage's own cells,
// so dividing the origin anchors every stage at the same world corner.
const ORIGIN_DIV = { coarse: 256, latent: 8, residual: 1, elevation: 1 };

export const WEIGHT_CANDIDATES = ['brodiffusion/weights/terrain-diffusion-30m-bro'];

const THUMB = 96;
const EXTENT = 96;      // cells per request, per axis

/** The cell size in metres of `stage`, from TerrainWorld.config(). */
export function cellMetres(config, stage) {
    if (!config) return 0;
    if (stage === 'coarse') return config.coarseCellMetres;
    if (stage === 'latent') return config.latentCellMetres;
    return config.elevationCellMetres;
}

/** Channel `ch` of a channel-major region as a view (no copy). */
export function plane(res, ch) {
    const n = res.width * res.height;
    return res.data.subarray(ch * n, (ch + 1) * n);
}

/** [min, max] of a plane. */
export function minMax(p) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.length; i++) {
        if (p[i] < lo) lo = p[i];
        if (p[i] > hi) hi = p[i];
    }
    return [lo, hi];
}

register({
    id: 'terrain',
    name: 'Terrain diffusion — stage decomposition',
    category: 'Noise',
    subtitle: 'Elevation is UNets in series, not one field. Coarse climate + elevation at 7.68 km, a latent at 240 m, then a Laplacian residual at 30 m. Every stage reads 96 of its own cells anchored at one corner, so the strip is that corner zooming in: coarse spans ~740 km, elevation ~2.9 km.',

    init({ stage, params, status }) {
        // Default view: a shoreline (seed 1, ~46% land, ~1.2 km relief) so
        // the elevation panel opens on land meeting water, not a seabed.
        const state = {
            dir: findWeights(WEIGHT_CANDIDATES, { probe: 'config.json' }) || '',
            seed: 1, i: -560, j: -128, view: 'elevation', channel: 0,
            config: null, results: {}, busy: false, disposed: false,
        };
        let rpc = null;

        // --- layout ------------------------------------------------------
        const mainCanvas = h('canvas.av-fill.av-pixel');
        const placeholder = h('div.av-placeholder');
        const mainBox = h('div.av-box.av-grow', null, mainCanvas, placeholder);
        const label = overlay(mainBox);
        const thumbs = {};
        const strip = h('div.av-strip', null, STAGES.map((name) => {
            const canvas = h('canvas.av-thumb.av-pixel', { width: THUMB, height: THUMB });
            const lbl = h('div.av-octname', null, name);
            const cell = h('div.av-stagecell', {
                dataset: { stage: name },
                onclick: () => { pos.set('view', name); },
            }, canvas, lbl);
            thumbs[name] = { canvas, cell };
            return cell;
        }));
        stage.appendChild(h('div.av-col.av-fill-col', null, mainBox, strip));

        // Elevation reads as a planet: ocean, shelf, lowland, snow. Every
        // other channel is a scalar field with no such convention, so it
        // gets a neutral ramp rather than a fake landscape palette.
        const terrainLut = bro.image.gradient([
            [0.00, 10, 30, 80], [0.45, 230, 220, 150], [0.55, 100, 170, 90], [0.75, 250, 250, 250],
        ], 256);
        const scalarLut = bro.image.gradient([
            [0.00, 20, 20, 45], [0.50, 140, 130, 120], [1.00, 245, 240, 220],
        ], 256);

        // --- drawing -----------------------------------------------------
        // An explicit range, not autoRange: autoRange is an EMA across draws
        // (for animated fields), so a still image drawn once starts far off.
        function paint(canvas, res, ch) {
            const isElev = CHANNELS[res.stage][ch][0] === 'elevation';
            const p = plane(res, ch), [lo, hi] = minMax(p);
            bro.image.gpu.colormap(canvas, p, isElev ? terrainLut : scalarLut,
                { srcW: res.width, srcH: res.height, lo, hi: hi > lo ? hi : lo + 1e-6 });
        }

        function draw() {
            if (state.disposed) return;
            for (const name of STAGES) {
                const r = state.results[name];
                if (r) paint(thumbs[name].canvas, r, 0);
                thumbs[name].cell.classList.toggle('on', name === state.view);
            }
            const res = state.results[state.view];
            placeholder.style.display = res ? 'none' : '';
            if (!res) { label.set(''); return; }

            const cw = mainBox.clientWidth | 0, chh = mainBox.clientHeight | 0;
            if (cw > 0 && chh > 0 && (mainCanvas.width !== cw || mainCanvas.height !== chh)) {
                mainCanvas.width = cw; mainCanvas.height = chh;
            }
            paint(mainCanvas, res, state.channel);

            // Range and units, because "auto-ranged colour" alone cannot tell
            // you whether you are looking at 3 km of relief or 3 cm.
            const [lo, hi] = minMax(plane(res, state.channel));
            const [name, unit] = CHANNELS[res.stage][state.channel];
            const cell = cellMetres(state.config, res.stage);
            label.set(`${res.stage}.${name}  ${lo.toFixed(2)} .. ${hi.toFixed(2)} ${unit || '(normalised)'}\n`
                + `${res.width}x${res.height} @ ${cell} m/cell  =  ${(cell * res.width / 1000).toFixed(1)} km across`
                + `   (${res.ms} ms)`);
        }

        // --- generation --------------------------------------------------
        // Strictly one request in flight: the pipeline memoises tiles and its
        // cache is not thread-safe. The queue is this loop.
        async function generateAll() {
            state.busy = true;
            try {
                for (let k = 0; k < STAGES.length; k++) {
                    const name = STAGES[k];
                    status.busy(`generating ${name}… (${k + 1}/${STAGES.length})`);
                    const div = ORIGIN_DIV[name];
                    const i1 = Math.floor(state.i / div), j1 = Math.floor(state.j / div);
                    const r = await rpc.request({ type: 'read', stage: name, i1, j1, i2: i1 + EXTENT, j2: j1 + EXTENT });
                    if (state.disposed) return;
                    state.results[name] = r;
                    draw();
                }
                status.ok(`ready — seed ${state.seed} at (${state.i}, ${state.j})`);
            } catch (e) {
                if (!e.abandoned && !state.disposed) status.error(e);
            } finally {
                state.busy = false;
            }
        }

        async function load() {
            if (state.busy) return;
            if (!state.dir) { status.error('no terrain checkpoint: set the weights folder'); return; }
            state.busy = true;
            state.results = {};
            draw();
            status.busy(`loading checkpoint from ${state.dir}…`);
            try {
                if (!rpc) { rpc = workerClient('viz/terrain-worker.js'); await rpc.ready; }
                const r = await rpc.request({ type: 'load', dir: state.dir, seed: state.seed });
                if (state.disposed) return;
                state.config = r.config;
                state.busy = false;
                await generateAll();
            } catch (e) {
                state.busy = false;
                if (!e.abandoned && !state.disposed) status.error('load failed: ' + e.message);
            }
        }

        // --- controls ----------------------------------------------------
        const chanSel = h('select', { onchange: () => { state.channel = chanSel.selectedIndex; draw(); } });
        function syncChannels() {
            const list = CHANNELS[state.view];
            state.channel = Math.min(state.channel, list.length - 1);
            chanSel.replaceChildren(...list.map(([n, u], c) =>
                h('option', { value: String(c), selected: c === state.channel }, n + (u ? ` (${u})` : ''))));
        }

        const panel = controls(params, state, {
            dir:  { type: 'text', label: 'weights', hint: 'terrain-diffusion checkpoint folder (config.json inside)' },
        }, () => {});
        panel.rows.dir.querySelector('input').classList.add('av-path');
        button(params, 'Browse…', () => {
            const d = pickFolder(state.dir || null);
            if (d) panel.set('dir', d.replace(/\\/g, '/'), true);
        });
        button(params, 'Load', () => load()).classList.add('primary');
        const pos = controls(params, state, {
            seed: { type: 'number', step: 1 },
            i:    { type: 'number', step: 256 },
            j:    { type: 'number', step: 256 },
            view: { options: STAGES },
        }, (key) => {
            if (key === 'seed' || key === 'i' || key === 'j') state[key] |= 0;
            if (key === 'view') { state.channel = 0; syncChannels(); draw(); }
        });
        params.appendChild(h('label.k-field', null, h('span', null, 'channel'), chanSel));
        button(params, 'Regenerate', () => {
            if (!state.config) { status.error('load a checkpoint first'); return; }
            if (!state.busy) generateAll();
        });
        button(params, 'Reseed', () => {
            if (state.busy) return;
            pos.set('seed', (state.seed + 1) | 0, true);
            load();                     // the seed is fixed at load, so this reloads
        });
        syncChannels();

        // --- availability ------------------------------------------------
        // Compiled out below the `full` profile: say so plainly rather than
        // throwing out of init() and blanking the stage.
        if (!globalThis.bro || !bro.diffusion || typeof bro.diffusion.loadTerrain !== 'function') {
            placeholder.textContent = 'bro.diffusion is not in this build';
            status.error('bro.diffusion.loadTerrain is not available — needs the full profile (BRO_WITH_DIFFUSION)');
        } else if (!state.dir) {
            placeholder.textContent = 'No terrain checkpoint found';
            status.warn('terrain-diffusion-30m-bro not found: set the weights folder, then Load');
        } else {
            placeholder.textContent = 'Press Load to read the checkpoint';
            status.set('press Load to read the checkpoint (~2 s), then each stage generates in turn');
        }
        draw();

        return {
            state, load, generateAll, pos,
            get rpc() { return rpc; },
        };
    },

    destroy(handle) {
        // A read is monolithic: abandoning drops its reply rather than stopping
        // the work, so `disposed` keeps a late reply off a torn-down stage.
        handle.state.disposed = true;
        if (handle.rpc) handle.rpc.terminate();
    },
});
