// ═══ PROBE: climate — the coarse net's conditioning, and the biome it implies ═
//
// The coarse net emits six channels: elevation, a low (p5) elevation, and four
// climate fields (temperature °C, precipitation mm/yr, and each one's
// seasonality). The rest of the pipeline is CONDITIONED on these — so this is
// where a coastline's climate is decided before any 30 m detail exists. The panel
// shows every channel raw, and the Whittaker biome each cell falls into from its
// real temperature and precipitation (ocean below sea level, tundra/alpine by
// cold and altitude). Climate is a coarse-scale property, so this reads a wide
// coarse window centred on the region, not the narrow elevation patch.

import { state, rampFor, luts, status } from "/app/lib/core.js";
import { el, plane, drawField, fieldStats, fitContain } from "/app/lib/helpers.js";
import { registerProbe } from "/app/lib/registry.js";

const CELLS = 128;             // coarse cells across (~983 km)

// A compact Whittaker-ish table. Real thresholds, since the channels are in degC
// and mm/yr; ocean and alpine come off elevation. Order matters only for the
// legend; classify() returns an index into this array.
const BIOMES = [
    { name: 'deep ocean',        rgb: [ 14,  34,  74] },
    { name: 'shelf / sea',       rgb: [ 30,  92, 150] },
    { name: 'ice / tundra',      rgb: [220, 232, 240] },
    { name: 'alpine',            rgb: [170, 165, 185] },
    { name: 'boreal / taiga',    rgb: [ 52,  96,  84] },
    { name: 'cold desert',       rgb: [176, 168, 132] },
    { name: 'grassland',         rgb: [166, 186,  96] },
    { name: 'temperate forest',  rgb: [ 66, 128,  62] },
    { name: 'subtropical desert',rgb: [220, 190, 120] },
    { name: 'savanna',           rgb: [190, 176,  86] },
    { name: 'seasonal tropical', rgb: [110, 160,  54] },
    { name: 'rainforest',        rgb: [ 24, 104,  48] },
];
export function classify(E, T, P) {
    if (E < -1000) return 0;
    if (E < 0)     return 1;
    if (T < -5)    return 2;                       // ice / tundra
    if (E > 2200 && T < 4) return 3;               // alpine
    if (T < 5)     return 4;                       // boreal
    if (P < 250)   return T > 18 ? 8 : 5;          // desert (subtropical / cold)
    if (P < 600)   return T > 20 ? 9 : 6;          // savanna / grassland
    if (P < 1200)  return T > 22 ? 10 : 7;         // seasonal tropical / temperate forest
    return T > 22 ? 11 : 7;                         // rainforest / temperate forest
}

registerProbe({
    id: 'climate',
    name: 'Climate',
    blurb: 'The six coarse channels and the biome they imply. This is the conditioning the rest of the pipeline is built on — temperature °C, precipitation mm/yr, elevation for ocean and alpine.',

    build(mount) {
        const h = {};
        const body = el('div', 'climate-body');

        // biome map (2D canvas) + legend
        const left = el('div', 'climate-left');
        const bcard = el('div', 'card grow');
        bcard.appendChild(el('div', 'card-title', 'biome (Whittaker from T · P · elevation)'));
        const bwrap = el('div', 'canvas-wrap fill fit');
        h.biome = document.createElement('canvas');
        bwrap.appendChild(h.biome);
        bcard.appendChild(bwrap);
        left.appendChild(bcard);
        h.legend = el('div', 'legend');
        left.appendChild(h.legend);
        body.appendChild(left);

        // the six raw channels as a tile grid — canvases built ONCE, up front, so
        // they are laid out and composited before the first colormap.
        const grid = el('div', 'chan-grid');
        h.tiles = [];
        h.grid = grid;
        body.appendChild(grid);

        mount.appendChild(body);
        // coarse always emits six channels; ensureTiles rebuilds if a checkpoint differs.
        for (let c = 0; c < 6; c++) {
            const tile = el('div', 'chan-tile');
            const cv = document.createElement('canvas'); cv.width = 150; cv.height = 150;
            const name = el('div', 'chan-name'); const stat = el('div', 'chan-stat');
            tile.appendChild(cv); tile.appendChild(name); tile.appendChild(stat);
            grid.appendChild(tile);
            h.tiles.push({ cv, name, stat });
        }
        return h;
    },

    regen(h) {
        const w = state.world;
        if (!w) return;
        const div = w.coarseCellSize / w.cellSize;    // native cells per coarse cell (256)
        const c = { ci: state.region.i + state.region.extent / 2,
                    cj: state.region.j + state.region.extent / 2 };
        const oi = Math.round(c.ci / div - CELLS / 2);
        const oj = Math.round(c.cj / div - CELLS / 2);
        status('generating climate…');
        w.stage('coarse', oi, oj, oi + CELLS, oj + CELLS, {
            onDone: (r) => { paint(h, r); status('climate ready — seed ' + state.seed); },
            onError: (m) => status('climate: ' + m, true),
        });
    },
});

function chanIndex(res, name) { return res.names.indexOf(name); }

// Channel tile canvases are built ONCE and reused — recreating a colormap canvas
// each paint thrashes the engine's canvas-scene lifecycle and leaves it unsized.
function ensureTiles(h, res) {
    if (h.tiles.length === res.names.length) return;
    h.grid.innerHTML = ''; h.tiles = [];
    for (let c = 0; c < res.names.length; c++) {
        const tile = el('div', 'chan-tile');
        const cv = document.createElement('canvas'); cv.width = 150; cv.height = 150;
        const name = el('div', 'chan-name'); const stat = el('div', 'chan-stat');
        tile.appendChild(cv); tile.appendChild(name); tile.appendChild(stat);
        h.grid.appendChild(tile);
        h.tiles.push({ cv, name, stat });
    }
}

function paint(h, res) {
    ensureTiles(h, res);
    for (let c = 0; c < res.names.length; c++) {
        const f = plane(res, c), s = fieldStats(f);
        const u = res.units[c]; const unit = (u && u !== '?' && u !== '') ? u : '';
        h.tiles[c].name.textContent = res.names[c];
        h.tiles[c].stat.textContent = s.lo.toFixed(1) + '…' + s.hi.toFixed(1) + (unit ? ' ' + unit : '');
        drawField(h.tiles[c].cv, f, res.width, res.height, rampFor(res, c));
    }

    // biome map
    const iE = chanIndex(res, 'elevation'), iT = chanIndex(res, 'temperature'), iP = chanIndex(res, 'precipitation');
    const bcv = h.biome, W = res.width, H = res.height;
    bcv.width = W; bcv.height = H;
    const ctx = bcv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const E = plane(res, iE), T = plane(res, iT), P = plane(res, iP);
    const present = new Array(BIOMES.length).fill(0);
    for (let p = 0; p < W * H; p++) {
        const b = classify(E[p], T[p], P[p]);
        present[b]++;
        const rgb = BIOMES[b].rgb, o = p * 4;
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    fitContain(bcv, W, H);            // display box preserves the square; backing store stays native

    // legend — only biomes actually on screen, by area share
    h.legend.innerHTML = '';
    const total = W * H;
    BIOMES.map((b, i) => ({ b, i, n: present[i] }))
        .filter((x) => x.n > 0)
        .sort((a, z) => z.n - a.n)
        .forEach((x) => {
            const row = el('div', 'legend-row');
            const sw = el('span', 'legend-sw');
            sw.style.background = 'rgb(' + x.b.rgb.join(',') + ')';
            row.appendChild(sw);
            row.appendChild(el('span', 'legend-name', x.b.name));
            row.appendChild(el('span', 'legend-pct', (100 * x.n / total).toFixed(0) + '%'));
            h.legend.appendChild(row);
        });
}
