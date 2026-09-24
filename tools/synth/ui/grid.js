// ui/grid.js — the layer rows under the scopes: one strip per layer (select,
// seq/arp, mute, duplicate, delete, level meter, 16 steps) with its
// automation lane underneath, plus a strip for the mic once it is on.
//
// Clicking an empty step writes the last note played on the piano into it;
// clicking a filled step clears it. The grid is rebuilt on structural song
// changes; the playhead and meters update in place every frame.

import { h, clear } from "/lib/kit/dom.js";
import { levelMeter } from "/lib/kit/gauges.js";
import { NUM_STEPS, AUTOMATION_TARGETS } from "../model/song.js";
import { noteName } from "../audio/notes.js";
import { automationLane } from "./automation.js";

const INTERP_LABEL = { linear: 'L', smooth: 'S', step: 'H' };
const meterOpts = { curve: (t) => Math.min(1, Math.sqrt(t) * 1.4) };

export function grid(host, { song, player, sequencer, ctx }) {
    let rows = [];        // { layer, steps: [el], meter, lane }
    let micMeter = null;
    let playing = -1;

    function stepEl(layer, li, s) {
        const n = layer.steps[s];
        const el = h('div.step' + (n != null ? '.on' : '') + (s % 4 === 0 ? '.beat' : ''), {
            dataset: { step: s },
            style: n != null ? { background: layer.color + '30', borderColor: layer.color + '90', color: layer.color } : null,
            onclick: () => {
                song.selectLayer(li);
                song.setStep(li, s, layer.steps[s] != null ? null : player.lastNote);
            },
        }, n != null ? noteName(n) : '');
        if (s === playing) el.classList.add('playing');
        return el;
    }

    function laneRow(layer, li) {
        const lane = layer.automation[0];
        const row = h('div.auto-row', { dataset: { layer: li } },
            h('button.small.auto' + (lane ? '.active' : ''), {
                title: lane ? 'remove the automation lane' : 'add an automation lane',
                onclick: () => song.toggleAutomation(li),
            }, 'A'));
        if (!lane) return { row, lane: null };
        const sel = h('select.auto-target', { onchange: () => song.setAutomationTarget(li, sel.value) },
            Object.keys(AUTOMATION_TARGETS).map((k) =>
                h('option', { value: k, selected: k === lane.target }, AUTOMATION_TARGETS[k].label)));
        const canvas = h('canvas.auto-canvas');
        row.appendChild(sel);
        row.appendChild(h('button.small.interp', { title: 'interpolation: ' + lane.interpMode, onclick: () => song.cycleInterp(li) },
            INTERP_LABEL[lane.interpMode]));
        row.appendChild(canvas);
        const editor = automationLane(canvas, { lane, color: layer.color, onEdit: () => song.automationEdited(li) });
        return { row, lane: editor };
    }

    function render() {
        clear(host);
        rows = [];
        const many = song.layers.length > 1;
        song.layers.forEach((layer, li) => {
            const selected = !song.editingMic && li === song.activeIndex;
            const meterEl = h('span.lane-meter');
            const steps = [];
            for (let s = 0; s < NUM_STEPS; s++) steps.push(stepEl(layer, li, s));
            const arp = layer.mode === 'arpeggiator';
            host.appendChild(h('div.lane-row' + (selected ? '.selected' : ''), { dataset: { layer: li } },
                h('button.lane-name', { style: { borderLeftColor: layer.color }, onclick: () => song.selectLayer(li) }, layer.name),
                h('button.small.mode' + (arp ? '.active' : ''), {
                    title: arp ? 'arpeggiator (click for sequencer)' : 'sequencer (click for arpeggiator)',
                    onclick: () => song.setLayer(li, 'mode', arp ? 'sequencer' : 'arpeggiator'),
                }, arp ? 'A' : 'S'),
                h('button.small.mute' + (layer.muted ? '.active' : ''), { title: 'mute', onclick: () => song.setLayer(li, 'muted', !layer.muted) }, 'M'),
                h('button.small.dup', { title: 'duplicate', onclick: () => song.duplicateLayer(li) }, 'D'),
                many ? h('button.small.del', { title: 'delete', onclick: () => song.removeLayer(li) }, 'X') : null,
                meterEl,
                h('div.steps', null, steps)));
            const auto = laneRow(layer, li);
            host.appendChild(auto.row);
            rows.push({ layer, steps, meter: levelMeter(meterEl, meterOpts), lane: auto.lane });
        });
        micMeter = null;
        if (song.mic) {
            const meterEl = h('span.lane-meter');
            host.appendChild(h('div.lane-row.mic' + (song.editingMic ? '.selected' : ''), null,
                h('button.lane-name', { style: { borderLeftColor: song.mic.color }, onclick: () => song.selectMic() }, 'Mic'),
                h('span.dim', null, 'input effects: click to edit'), h('span.k-spacer'), meterEl));
            micMeter = levelMeter(meterEl, meterOpts);
        }
        // automation canvases need their laid-out size
        requestAnimationFrame(() => { for (const r of rows) if (r.lane) r.lane.draw(); });
    }

    const busLevel = (rt) => (ctx ? Math.max(ctx.getBusPeakL(rt.bus), ctx.getBusPeakR(rt.bus)) : 0);

    song.on((what) => { if (what !== 'sound' && what !== 'tempo') render(); });
    sequencer.on((s) => {
        playing = s;
        for (const r of rows) r.steps.forEach((el, i) => el.classList.toggle('playing', i === s));
    });
    render();

    return {
        render,
        /** Once a frame: meters. */
        update() {
            for (const r of rows) r.meter.set(busLevel(r.layer.rt));
            if (micMeter && song.mic) micMeter.set(busLevel(song.mic.rt));
        },
    };
}
