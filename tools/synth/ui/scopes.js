// ui/scopes.js — the stack of live views above the grid: a scrolling level
// envelope per layer (its bus peak), the mic waveform while it is on, and the
// combined output waveform (an AnalyserNode on the engine mix). Click a
// row's label to fold it.

import { h, clear } from "/lib/kit/dom.js";
import { peakScope, oscilloscope } from "/lib/kit/audio-ui.js";

const GAIN = 12;       // bus peaks are small; scale them into view
const DECAY = 0.92;    // falling edge smoothing per frame

export function scopes(host, { song, mic, ctx }) {
    const folded = new Set();
    let rows = [];
    let analyser = null, buf = null;
    if (ctx) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.source = 2;          // engine output + the mic while it is heard
        buf = new Float32Array(analyser.fftSize);
    }

    function row(key, name, color, kind) {
        const canvas = h('canvas');
        const el = h('div.scope-row' + (kind === 'mix' ? '.mix' : '') + (folded.has(key) ? '.folded' : ''), { dataset: { scope: key } },
            h('div.scope-label', { onclick: () => {
                if (folded.has(key)) folded.delete(key); else folded.add(key);
                el.classList.toggle('folded', folded.has(key));
            } }, h('span.swatch', { style: { background: color } }), name),
            canvas);
        host.appendChild(el);
        const r = { key, el, kind, level: 0 };
        r.view = kind === 'env' ? peakScope(canvas, { history: 600, color: () => color })
                                : oscilloscope(canvas, { color });
        return r;
    }

    function render() {
        clear(host);
        rows = song.layers.map((l) => Object.assign(row('L' + l.uid, l.name, l.color, 'env'), { layer: l }));
        if (song.mic && mic.enabled) rows.push(row('mic', 'Mic', song.mic.color, 'mic'));
        rows.push(row('mix', 'Combined', '#00e5ff', 'mix'));
    }

    song.on((what) => { if (what === 'layers' || what === 'all') render(); });
    render();

    return {
        render,
        /** Once a frame (only while visible). */
        draw() {
            for (const r of rows) {
                if (folded.has(r.key)) continue;
                if (r.kind === 'env') {
                    const rt = r.layer.rt;
                    let p = ctx ? Math.min(1, Math.max(ctx.getBusPeakL(rt.bus), ctx.getBusPeakR(rt.bus)) * GAIN) : 0;
                    if (p < r.level) p = r.level * DECAY;
                    r.level = p;
                    r.view.push(p);
                    r.view.draw();
                } else if (r.kind === 'mic') {
                    r.view.draw(mic.waveform());
                } else if (analyser) {
                    analyser.getFloatTimeDomainData(buf);
                    r.view.draw(buf);
                }
            }
        },
        get rowCount() { return rows.length; },
    };
}
