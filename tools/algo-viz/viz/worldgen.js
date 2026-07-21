// Learned terrain — the diffusion pipeline's stages, side by side.
//
// The sibling of noise.js, and deliberately the same shape. There, FBm is the
// sum of octaves and the strip shows each octave. Here, elevation is the
// product of three UNets in series and the strip shows each stage:
//
//   coarse  ->  latentInit  ->  latent  ->  residual  ->  elevation
//   7.68 km      240 m          240 m       30 m         30 m
//
// The decomposition is the whole point. FBm has no notion of water flowing
// downhill, which is why its ridges and drainage never look like a planet's;
// this model does, and the strip is where you can see WHICH stage puts that
// structure in. A coastline already present in the coarse net came from the
// climate conditioning; one that appears at the residual came from the
// decoder.
//
// MAIN  The selected stage and channel, colour-mapped, auto-ranged.
// STRIP One thumbnail per stage at the same world position, so a feature can
//       be followed up and down the DAG.
//
// Generation is SECONDS per stage, not milliseconds, so nothing here runs on a
// timer. Each request is explicit, goes through the async binding so the frame
// loop stays live, and reports what it is waiting on.

import { VIZ } from "/app/viz/_registry.js";
import { AVUI } from "/app/viz/pathfinding.js";

(function () {
    // Order is DAG order, which is also coarse-to-fine. The strip reads left
    // to right as the pipeline runs.
    const STAGES = ['coarse', 'latentInit', 'latent', 'residual', 'elevation'];

    // Where a converted checkpoint usually lives. Editable in the panel — the
    // viz is useless without one and guessing silently would be worse than
    // saying so.
    const DEFAULT_DIR = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';

    const THUMB = 96;
    const EXTENT = 96;      // cells per request, per axis

    VIZ.push({
        id: 'worldgen',
        name: 'Terrain diffusion — stage decomposition',
        category: 'Noise',
        subtitle: 'Elevation is three UNets in series, not one field. Coarse climate + elevation at 7.68 km, a latent refined over two TrigFlow steps at 240 m, then a Laplacian residual at 30 m. Every stage reads 96 of its own cells anchored at one corner, so the strip is that corner zooming in — coarse spans ~740 km, elevation ~2.9 km.',

        init({ stage, params }) {
            const state = {
                // Default view: a shoreline (seed 1, ~46% land, ~1.2 km relief,
                // −1111..+130 m) so the elevation panel opens on land meeting
                // water rather than a featureless seabed. Found by reading a
                // block of native elevation and sliding a window to the spot
                // that straddles sea level with the most balanced coast.
                world: null, busy: false, dir: DEFAULT_DIR, seed: 1,
                i: -560, j: -128, stage: 'elevation', channel: 0,
                results: {}, disposed: false,
            };

            // --- layout ------------------------------------------------------
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:8px;box-sizing:border-box';
            stage.appendChild(wrap);

            const mainBox = document.createElement('div');
            mainBox.style.cssText = 'position:relative;flex:1 1 auto;background:#080808;border:1px solid #222;overflow:hidden;min-height:0';
            wrap.appendChild(mainBox);

            const mainCanvas = document.createElement('canvas');
            mainCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated';
            mainBox.appendChild(mainCanvas);

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute;left:8px;top:8px;font:11px ui-monospace,Consolas,monospace;color:#9aa;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre';
            mainBox.appendChild(overlay);

            const stripRow = document.createElement('div');
            stripRow.style.cssText = 'flex:0 0 auto;display:flex;gap:6px';
            wrap.appendChild(stripRow);

            const thumbs = {};
            for (const name of STAGES) {
                const cell = document.createElement('div');
                cell.style.cssText = 'display:flex;flex-direction:column;gap:3px;align-items:center;cursor:pointer';
                cell.onclick = () => { state.stage = name; state.channel = 0; syncChannelSelect(); draw(); };

                const c = document.createElement('canvas');
                c.width = THUMB; c.height = THUMB;
                c.style.cssText = 'width:96px;height:96px;background:#080808;border:1px solid #222;image-rendering:pixelated';
                const lbl = document.createElement('div');
                lbl.style.cssText = 'font:10px ui-monospace,Consolas,monospace;color:#667';
                lbl.textContent = name;

                cell.appendChild(c); cell.appendChild(lbl);
                stripRow.appendChild(cell);
                thumbs[name] = { canvas: c, label: lbl };
            }

            const statusEl = document.createElement('div');
            statusEl.style.cssText = 'flex:0 0 auto;font:11px ui-monospace,Consolas,monospace;color:#7a8;min-height:14px';
            wrap.appendChild(statusEl);
            const status = (msg, bad) => {
                statusEl.textContent = msg;
                statusEl.style.color = bad ? '#e88' : '#7a8';
            };

            // Elevation reads as a planet: ocean, shelf, lowland, snow. Every
            // other channel is a scalar field with no such convention, so it
            // gets a neutral ramp rather than a fake landscape palette.
            const terrainLut = bro.image.gradient([
                [0.00,  10,  30,  80],
                [0.45, 230, 220, 150],
                [0.55, 100, 170,  90],
                [0.75, 250, 250, 250],
            ], 256);
            const scalarLut = bro.image.gradient([
                [0.00,  20,  20,  45],
                [0.50, 140, 130, 120],
                [1.00, 245, 240, 220],
            ], 256);

            const isElevation = (res, ch) =>
                res && res.units && res.units[ch] === 'm';

            // --- drawing -----------------------------------------------------
            // One channel out of a planar buffer. autoRange does the scaling,
            // which matters because these channels span wildly different
            // domains — metres, degrees C, mm/yr, and a standardised residual.
            function plane(res, ch) {
                const n = res.width * res.height;
                return res.data.subarray(ch * n, (ch + 1) * n);
            }

            function paint(canvas, res, ch) {
                if (!res) return;
                const lut = isElevation(res, ch) ? terrainLut : scalarLut;
                bro.image.gpu.colormap(canvas, plane(res, ch), lut, {
                    srcW: res.width, srcH: res.height, autoRange: true,
                });
            }

            function draw() {
                const res = state.results[state.stage];
                for (const name of STAGES) {
                    const r = state.results[name];
                    if (r) paint(thumbs[name].canvas, r, 0);
                    thumbs[name].label.style.color =
                        (name === state.stage) ? '#e0a860' : '#667';
                }
                if (!res) { overlay.textContent = ''; return; }

                const cw = mainBox.clientWidth | 0, chh = mainBox.clientHeight | 0;
                if (cw > 0 && chh > 0) {
                    mainCanvas.width = cw; mainCanvas.height = chh;
                }
                paint(mainCanvas, res, state.channel);

                // Range and units, because "auto-ranged colour" alone cannot
                // tell you whether you are looking at 3 km of relief or 3 cm.
                const p = plane(res, state.channel);
                let lo = Infinity, hi = -Infinity;
                for (let i = 0; i < p.length; i++) {
                    if (p[i] < lo) lo = p[i];
                    if (p[i] > hi) hi = p[i];
                }
                const unit = res.units[state.channel] || '';
                const km = (res.cellSize * res.width) / 1000;
                overlay.textContent =
                    `${res.stage}.${res.names[state.channel]}  ${lo.toFixed(2)} .. ${hi.toFixed(2)} ${unit === '?' ? '(unit unknown)' : unit}\n` +
                    `${res.width}x${res.height} @ ${res.cellSize} m/cell  =  ${km.toFixed(1)} km across`;
            }

            // --- generation --------------------------------------------------
            // Strictly one request in flight: the pipeline memoises tiles and
            // that cache is not thread-safe, so the binding refuses a second.
            // The queue is this recursion rather than a data structure.
            function generateAll(done) {
                if (!state.world) return;
                const queue = STAGES.slice();
                state.busy = true;

                const next = () => {
                    if (state.disposed) return;
                    if (!queue.length) {
                        state.busy = false;
                        status(`ready — seed ${state.seed} at (${state.i}, ${state.j})`);
                        draw();
                        if (done) done();
                        return;
                    }
                    const name = queue.shift();
                    status(`generating ${name}… (${STAGES.length - queue.length}/${STAGES.length})`);

                    // Bounds are in THIS stage's cells. Scaling the origin by
                    // the cell ratio anchors every stage at the same corner —
                    // but with a fixed 96-cell EXTENT the stages still cover very
                    // different EXTENTS (coarse ~740 km, elevation ~2.9 km), so
                    // the strip reads as that corner zooming in, not one fixed
                    // patch decomposed. That is inherent: the scales are 256x
                    // apart and no single window shows both.
                    const div = name === 'coarse' ? 256 : (name.startsWith('latent') ? 8 : 1);
                    const oi = Math.floor(state.i / div), oj = Math.floor(state.j / div);

                    state.world.stage(name, oi, oj, oi + EXTENT, oj + EXTENT, {
                        onDone: (r) => {
                            if (state.disposed) return;
                            state.results[name] = r;
                            draw();
                            next();
                        },
                        onError: (m) => {
                            if (state.disposed) return;
                            state.busy = false;
                            status(`${name}: ${m}`, true);
                        },
                    });
                };
                next();
            }

            function loadWorld() {
                if (state.busy) return;
                state.results = {};
                state.world = null;
                state.busy = true;
                status(`loading checkpoint from ${state.dir}…`);
                try {
                    bro.worldgen.init();
                    bro.worldgen.loadWorld(state.dir, {
                        seed: state.seed,
                        onReady: (w) => {
                            if (state.disposed) return;
                            state.world = w;
                            state.busy = false;
                            generateAll();
                        },
                        onError: (m) => {
                            if (state.disposed) return;
                            state.busy = false;
                            status(`load failed: ${m}`, true);
                        },
                    });
                } catch (e) {
                    state.busy = false;
                    status(`load failed: ${e.message}`, true);
                }
            }

            // --- controls ----------------------------------------------------
            const dirInput = document.createElement('label');
            dirInput.className = 'field';
            dirInput.innerHTML = '<span class="lbl">weights</span>';
            const dirText = document.createElement('input');
            dirText.type = 'text'; dirText.value = state.dir;
            dirText.style.width = '260px';
            dirText.onchange = () => { state.dir = dirText.value.trim(); };
            dirInput.appendChild(dirText);
            params.appendChild(dirInput);

            AVUI.mkButton(params, 'Load', () => loadWorld());

            AVUI.mkNumber(params, 'seed', state.seed, 1, (v) => {
                state.seed = v | 0;
            });
            AVUI.mkNumber(params, 'i', state.i, 256, (v) => { state.i = v | 0; });
            AVUI.mkNumber(params, 'j', state.j, 256, (v) => { state.j = v | 0; });

            const stageSel = AVUI.mkSelect(params, 'view', STAGES, state.stage, (v) => {
                state.stage = v; state.channel = 0; syncChannelSelect(); draw();
            });

            // Channel names come from the binding rather than from a table
            // here, so a checkpoint with a different layout cannot be
            // mislabelled by this file.
            const chanWrap = document.createElement('label');
            chanWrap.className = 'field';
            chanWrap.innerHTML = '<span class="lbl">channel</span>';
            const chanSel = document.createElement('select');
            chanSel.onchange = () => { state.channel = chanSel.selectedIndex; draw(); };
            chanWrap.appendChild(chanSel);
            params.appendChild(chanWrap);

            function syncChannelSelect() {
                const res = state.results[state.stage];
                chanSel.innerHTML = '';
                const names = res ? res.names : ['—'];
                for (let c = 0; c < names.length; c++) {
                    const o = document.createElement('option');
                    const u = res && res.units[c];
                    o.textContent = names[c] + (u && u !== '?' && u !== '' ? ` (${u})` : '');
                    chanSel.appendChild(o);
                }
                chanSel.selectedIndex = Math.min(state.channel, names.length - 1);
                state.channel = chanSel.selectedIndex;
            }

            AVUI.mkButton(params, 'Regenerate', () => {
                if (!state.world) { status('load a checkpoint first', true); return; }
                if (state.busy) return;
                generateAll();
            });
            AVUI.mkButton(params, 'Reseed', () => {
                if (state.busy) return;
                state.seed = (state.seed + 1) | 0;
                loadWorld();          // seed is fixed at load, so this reloads
            });

            syncChannelSelect();

            // --- availability ------------------------------------------------
            // Compiled out in every profile below `full`, so say so plainly
            // rather than throwing out of init() and blanking the stage.
            if (!window.bro || !bro.worldgen || bro.worldgen.available === false) {
                status('bro.worldgen is not available in this build — needs BRO_WITH_DIFFUSION', true);
            } else {
                status('press Load to read the checkpoint (~2 s), then each stage generates in turn');
            }

            return { state };
        },

        destroy(handle) {
            // Requests are monolithic: a cancel drops the result rather than
            // stopping the work, so the flag is what keeps a late callback
            // from touching a torn-down stage.
            if (handle && handle.state) {
                handle.state.disposed = true;
                handle.state.world = null;
            }
        },
    });
})();
