// ═══ PROBE: pipeline — the DAG, stage by stage ══════════════════════════════
//
// Elevation is not one field but three UNets in series. This probe reads every
// stage at the same CENTRE and shows them as a strip, coarse→fine, so a feature
// can be followed up and down the pipeline: a coastline already in the coarse
// climate map came from conditioning; one that first appears in the residual came
// from the decoder. Each stage is shown at a legible cell count for its own scale
// (they are 256x apart, so no single window shows both), and labelled with the
// real span in km — the strip is the same centre zooming in, not one patch.

import { state, STAGE, cellDiv, rampFor, status, luts } from "/app/lib/core.js";
import { el, plane, drawField, fieldStats, mkSelect, fitContain } from "/app/lib/helpers.js";
import { registerProbe } from "/app/lib/registry.js";

// Legible cell counts per scale: the elevation window in native cells, floored so
// the coarse and latent stages show CONTEXT rather than a 3x3 block, capped so a
// big extent still generates quickly.
function stageCells(name) {
    return Math.max(48, Math.min(160, Math.round(state.region.extent / cellDiv(name))));
}

registerProbe({
    id: 'pipeline',
    name: 'Pipeline',
    blurb: 'The three UNets in series — coarse climate → latent → residual → elevation. Each stage at the same centre; the strip reads coarse-to-fine. Click a stage to inspect its channels.',

    build(mount) {
        const h = { results: {}, stage: 'elevation', channel: 0 };

        const bar = el('div', 'probe-bar');
        h.stageSel = mkSelect(bar, 'stage', STAGE.order, h.stage, (v) => {
            h.stage = v; h.channel = 0; syncChannels(h); paintMain(h);
        });
        // channel select is (re)filled from the result so a checkpoint with a
        // different layout can't be mislabelled here.
        h.chanWrap = el('label', 'ctl');
        h.chanWrap.appendChild(el('span', 'ctl-lbl', 'channel'));
        h.chanSel = document.createElement('select');
        h.chanSel.onchange = () => { h.channel = h.chanSel.selectedIndex; paintMain(h); };
        h.chanWrap.appendChild(h.chanSel);
        bar.appendChild(h.chanWrap);
        mount.appendChild(bar);

        const body = el('div', 'pipe-body');
        const mainCard = el('div', 'card grow');
        mainCard.appendChild(el('div', 'card-title', 'stage'));
        const mwrap = el('div', 'canvas-wrap fill fit');
        h.main = document.createElement('canvas');
        mwrap.appendChild(h.main);
        h.overlay = el('div', 'field-overlay');
        mwrap.appendChild(h.overlay);
        mainCard.appendChild(mwrap);
        body.appendChild(mainCard);
        mount.appendChild(body);

        const strip = el('div', 'stage-strip');
        h.thumbs = {};
        for (const name of STAGE.order) {
            const cell = el('div', 'thumb');
            cell.onclick = () => { h.stage = name; h.channel = 0; h.stageSel.value = name; syncChannels(h); paintMain(h); highlight(h); };
            const c = document.createElement('canvas'); c.width = 120; c.height = 120;
            const lbl = el('div', 'thumb-lbl', name);
            cell.appendChild(c); cell.appendChild(lbl);
            strip.appendChild(cell);
            h.thumbs[name] = { cell, canvas: c, label: lbl };
        }
        mount.appendChild(strip);
        return h;
    },

    onWorld(h) { h.results = {}; },

    regen(h) {
        const w = state.world;
        if (!w) return;
        const queue = STAGE.order.slice();
        const c = { ci: state.region.i + state.region.extent / 2,
                    cj: state.region.j + state.region.extent / 2 };
        const next = () => {
            if (!queue.length) { status('pipeline ready — seed ' + state.seed); return; }
            const name = queue.shift();
            const cells = stageCells(name), div = cellDiv(name);
            const oi = Math.round(c.ci / div - cells / 2);
            const oj = Math.round(c.cj / div - cells / 2);
            status('generating ' + name + '… (' + (STAGE.order.length - queue.length) + '/' + STAGE.order.length + ')');
            w.stage(name, oi, oj, oi + cells, oj + cells, {
                onDone: (r) => { h.results[name] = r; paintThumb(h, name); if (name === h.stage) { syncChannels(h); paintMain(h); } next(); },
                onError: (m) => status(name + ': ' + m, true),
            });
        };
        next();
    },
});

function syncChannels(h) {
    const res = h.results[h.stage];
    h.chanSel.innerHTML = '';
    const names = res ? res.names : ['—'];
    for (let c = 0; c < names.length; c++) {
        const o = document.createElement('option');
        const u = res && res.units[c];
        o.textContent = names[c] + (u && u !== '?' && u !== '' ? ' (' + u + ')' : '');
        h.chanSel.appendChild(o);
    }
    h.channel = Math.min(h.channel, names.length - 1);
    h.chanSel.selectedIndex = h.channel;
    h.chanWrap.style.display = names.length > 1 ? '' : 'none';
}

function highlight(h) {
    for (const name of STAGE.order)
        h.thumbs[name].label.classList.toggle('on', name === h.stage);
}

function paintThumb(h, name) {
    const res = h.results[name];
    if (!res) return;
    drawField(h.thumbs[name].canvas, plane(res, 0), res.width, res.height, rampFor(res, 0));
    highlight(h);
}

function paintMain(h) {
    const res = h.results[h.stage];
    if (!res) { h.overlay.textContent = ''; return; }
    // Preserve the field's aspect (it is square, so a wide card would stretch it):
    // fit a contain-box, and match the backing store to it so the colormap is 1:1.
    const box = fitContain(h.main, res.width, res.height);
    if (box) { h.main.width = box.dw; h.main.height = box.dh; }
    const field = plane(res, h.channel);
    drawField(h.main, field, res.width, res.height, rampFor(res, h.channel));
    const s = fieldStats(field);
    const unit = res.units[h.channel] || '';
    const km = (res.cellSize * res.width) / 1000;
    h.overlay.textContent =
        res.stage + '.' + res.names[h.channel] + '   ' +
        s.lo.toFixed(2) + ' .. ' + s.hi.toFixed(2) + ' ' + (unit === '?' ? '(unit unknown)' : unit) + '\n' +
        res.width + '×' + res.height + ' @ ' + res.cellSize + ' m/cell  =  ' + km.toFixed(1) + ' km across\n' +
        STAGE.blurb[res.stage];
}
