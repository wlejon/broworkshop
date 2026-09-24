// ui/controls.js — the header (presets, master volume, mic, MIDI port) and
// the sequencer bar (play, record, tempo, seq/arp mode, arp pattern, save
// loop, add layer).

import { $, h, clear } from "/lib/kit/dom.js";
import { segmented } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { levelMeter } from "/lib/kit/audio-ui.js";
import { saveWav } from "/lib/kit/audio.js";
import { ARP_PATTERNS } from "../model/song.js";
import { renderLoop } from "../audio/render.js";

/** Preset picker: loading applies to the selected layer (or the mic). */
export function presetControls({ song, presets, status }) {
    const sel = $('#preset');
    const fill = (value) => {
        clear(sel);
        for (const n of presets.names()) sel.appendChild(h('option', { value: n }, (presets.isFactory(n) ? '' : '* ') + n));
        if (value) sel.value = value;
        $('#preset-del').disabled = presets.isFactory(sel.value);
    };
    sel.addEventListener('change', () => {
        song.applyPreset(presets.get(sel.value), sel.value);
        $('#preset-del').disabled = presets.isFactory(sel.value);
        status.ok('preset ' + sel.value + ' on ' + song.activeSignal().name);
    });
    $('#preset-save').addEventListener('click', () => {
        const s = song.activeSignal();
        const name = presets.save(sel.value || 'Preset', s.sound, song.lfo);
        fill(name);
        status.ok('saved preset ' + name);
    });
    $('#preset-del').addEventListener('click', () => {
        const name = sel.value;
        if (presets.remove(name)) { fill('Init'); status.ok('deleted preset ' + name); }
    });
    fill('Init');
    return { fill, get value() { return sel.value; } };
}

/** Master volume, mic monitor, MIDI port. */
export function headerControls({ ctx, song, mic, midi, scopes, status }) {
    const master = bindControl('#volume', { onChange: (v) => { if (ctx) ctx.masterGain = v; } });
    if (ctx) ctx.masterGain = master.value;

    const micBtn = $('#mic');
    const micMeter = levelMeter('#mic-meter');
    const micVol = bindControl('#mic-volume', { onChange: (v) => mic.setVolume(v) });
    mic.setVolume(micVol.value);
    micBtn.addEventListener('click', async () => {
        if (!mic.available) {
            status.busy('opening the microphone...');
            if (!(await mic.open())) { status.warn('no microphone available'); return; }
            song.enableMicSignal();
        }
        mic.setEnabled(!mic.enabled);
        micBtn.classList.toggle('active', mic.enabled);
        if (mic.enabled) song.selectMic();
        scopes.render();
        status.ok(mic.enabled ? 'mic on: its effects are in the sidebar' : 'mic off');
    });

    const port = $('#midi-port');
    const fillPorts = () => {
        clear(port);
        port.appendChild(h('option', { value: '-1' }, midi.supported ? 'none' : 'unavailable'));
        for (const p of midi.ports()) port.appendChild(h('option', { value: String(p.index) }, p.name));
        port.value = String(midi.port);
    };
    port.addEventListener('mousedown', fillPorts);      // rescan when opened
    port.addEventListener('change', () => {
        const idx = +port.value;
        const ok = midi.open(idx);
        if (idx >= 0) status[ok ? 'ok' : 'warn'](ok ? 'MIDI port open' : 'could not open that MIDI port');
    });
    fillPorts();
    port.disabled = !midi.supported;

    return {
        master,
        /** Once a frame. */
        update() { micMeter.set(Math.min(1, mic.level() * 3)); },
    };
}

/** The sequencer bar. */
export function seqControls({ ctx, song, sequencer, recorder, status }) {
    const play = $('#seq-play');
    const paint = () => {
        play.textContent = sequencer.playing ? 'stop' : 'play';
        play.classList.toggle('active', sequencer.playing);
        play.classList.toggle('primary', !sequencer.playing);
    };
    play.addEventListener('click', () => { sequencer.toggle(); paint(); });
    sequencer.on(paint);

    const bpm = bindControl('#bpm', { out: '#bpm-val', onChange: (v) => song.setBpm(v) });

    const mode = segmented('#seq-mode', { sequencer: 'Seq', arpeggiator: 'Arp' }, {
        onChange: (v) => song.setLayer(song.activeIndex, 'mode', v),
    });
    const pattern = segmented('#arp-pattern', ARP_PATTERNS, {
        title: (v) => 'arpeggio ' + v,
        onChange: (v) => song.setLayer(song.activeIndex, 'arpPattern', v),
    });
    const sync = () => {
        const l = song.activeLayer();
        if (!l) return;
        mode.value = l.mode;
        pattern.value = l.arpPattern;
        bpm.value = song.bpm;
        for (const b of pattern.buttons) b.disabled = l.mode !== 'arpeggiator';
    };
    song.on(sync);
    sync();

    const rec = $('#seq-rec');
    rec.addEventListener('click', () => {
        if (recorder.owner === 'seq') {
            const pcm = recorder.stop();
            rec.textContent = 'rec';
            rec.classList.remove('danger', 'active');
            if (!pcm) { status.warn('nothing was recorded'); return; }
            const path = saveWav(pcm, recorder.rate, { defaultName: 'recording.wav' });
            if (path) status.ok('saved ' + path); else status.set('recording discarded');
        } else if (recorder.start('seq')) {
            rec.textContent = 'stop rec';
            rec.classList.add('danger', 'active');
            status.busy('recording the output...');
        } else {
            status.warn('the clip editor is recording');
        }
    });

    $('#save-loop').addEventListener('click', () => {
        const out = ctx ? renderLoop(ctx, song) : null;
        if (!out) { status.warn('nothing to save: add notes to the grid'); return; }
        const path = saveWav(out.pcm, out.rate, { defaultName: 'loop.wav' });
        if (path) status.ok('loop saved: ' + path + ' (' + (out.pcm.length / out.rate).toFixed(2) + ' s)');
    });

    $('#layer-add').addEventListener('click', () => {
        if (!song.addLayer()) status.warn('8 layers is the limit');
    });

    return { sync, paint };
}
