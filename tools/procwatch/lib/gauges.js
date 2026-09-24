// gauges.js — the CPU / RAM / GPU cards above the table.

import { h } from "/lib/kit/dom.js";
import { historyPlot, levelMeter, fitCanvas } from "/lib/kit/audio-ui.js";

const HOT = '#ff6b5c', WARN = '#ffc857', COOL = '#3a9ad9';
const heat = (f, warn, hot) => (f > hot ? HOT : f > warn ? WARN : '');

export function gauges(els) {
    const cpu = historyPlot(els.cpuSpark, { size: 120, min: 0, max: 100, labels: false, color: '#5cc8ff' });
    const ram = levelMeter(els.ramBar);
    let cores = [];
    const cards = new Map();                  // gpu index -> { val, meter, sub }

    function drawCores() {
        const { ctx, w, h: hh } = fitCanvas(els.cpuCores);
        ctx.clearRect(0, 0, w, hh);
        const bw = w / (cores.length || 1);
        for (let i = 0; i < cores.length; i++) {
            const v = Math.min(100, cores[i] || 0) / 100;
            ctx.fillStyle = v > 0.85 ? HOT : v > 0.5 ? WARN : COOL;
            ctx.fillRect(i * bw + 0.5, hh * (1 - v), bw - 1, hh * v);
        }
    }

    return {
        /** One typeperf sample: total % (or null) and per-core %. */
        cpu(total, perCore) {
            if (total !== null) {
                cpu.push(total);
                els.cpuVal.textContent = total.toFixed(0) + '%';
                cpu.draw();
            }
            if (perCore.length) { cores = perCore; drawCores(); }
        },
        ram(total, avail) {
            if (!total || !avail) return;
            const used = total - avail, f = used / total;
            els.ramVal.textContent = (f * 100).toFixed(0) + '%';
            els.ramSub.textContent = (used / 2 ** 30).toFixed(1) + ' / ' + (total / 2 ** 30).toFixed(0) + ' GB';
            ram.set(f);
            ram.color(heat(f, 0.75, 0.9));
        },
        gpus(list) {
            for (const g of list) {
                let c = cards.get(g.idx);
                if (!c) {
                    c = { val: h('span.g-val'), bar: h('span.k-meter.block'), sub: h('div.g-sub') };
                    els.gpus.appendChild(h('div.gauge', { id: 'gpu-' + g.idx },
                        h('div.g-head', null, h('span.g-label', null, 'gpu ' + g.idx), c.val), c.bar, c.sub));
                    c.meter = levelMeter(c.bar, { max: 100 });
                    cards.set(g.idx, c);
                }
                c.val.textContent = g.util + '%';
                c.meter.set(g.util);
                c.meter.color(heat(g.util, 60, 90));
                c.sub.textContent = g.name.replace(/^NVIDIA (GeForce )?/, '') + ' · ' +
                    (g.memUsed / 1024).toFixed(1) + '/' + (g.memTotal / 1024).toFixed(0) + ' GB · ' + g.temp + '°C';
            }
        },
    };
}
