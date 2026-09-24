// RAVE Lab — encode a sound into RAVE's latent curves, reshape them, and hear
// the resynthesis morph.
//
//   tone / file ──► mono PCM @ model rate ──rave.encode──► latent (nLatent × frames)
//        edit curves (drag, smooth, flatten, invert, nudge) ──rave.decode──► morph
//
// encode/decode are synchronous GPU calls (a few ms for a few seconds of
// audio), so edits re-decode on a short debounce. The decode seed is fixed,
// so the stochastic branches (noise synth, per-channel stereo pad) stay
// reproducible while editing: only the latent edits change the sound.

import { boot } from "/lib/kit/app.js";
import { h, ids } from "/lib/kit/dom.js";
import { deviceBadge, modelRow, pickFile, baseName } from "/lib/kit/ml.js";
import { weightPath } from "/lib/kit/weights.js";
import { clipPlayer, saveWav, decodeAudioFile, downmix, peakOf } from "/lib/kit/audio.js";
import { waveView } from "/lib/kit/audio-ui.js";
import { curveEditor } from "/app/curves.js";

/** Converted RAVE v2 models (config.json + model.safetensors), first found wins. */
export const RAVE = ['brosoundml-data/rave/magnets_z8', 'brosoundml-data/rave/birds_dawnchorus_z8'];
const RAVE_ROOT = 'brosoundml-data/rave';

/** Live app state (tests read it; module `let` exports would be snapshots). */
export const lab = {
    rave: null,         // bro.rave handle
    src: null,          // source PCM at rave.sampleRate
    enc: null,          // { latent, nLatent, frames } — the original encode
    work: null,         // editable latent copy (channel-major)
    out: null,          // last decode { samples, channels }
    decodes: 0,         // decode counter (tests wait on it)
    error: '',
    ui: null,
};

/** Tone generators at rate `sr`: 0.3 amplitude, 10 ms fades both ends. */
export function genTone(kind, freq, secs, sr) {
    const n = Math.max(1, Math.floor(secs * sr)), out = new Float32Array(n);
    const w = 2 * Math.PI * freq / sr, fade = sr * 0.01;
    let ph = 0;
    for (let i = 0; i < n; i++) {
        let v = 0;
        if (kind === 'sine') v = Math.sin(w * i);
        else if (kind === 'harm') v = Math.sin(w * i) + 0.5 * Math.sin(2 * w * i) + 0.25 * Math.sin(3 * w * i) + 0.12 * Math.sin(4 * w * i);
        else if (kind === 'saw') v = 2 * ((i * freq / sr) % 1) - 1;
        else if (kind === 'sweep') { ph += 2 * Math.PI * freq * Math.pow(8, i / n) / sr; v = Math.sin(ph); }  // up 3 octaves
        else v = Math.random() * 2 - 1;
        out[i] = 0.3 * v * Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
    }
    return out;
}

/** Converted models under the RAVE root (dirs holding config.json). */
function presets() {
    const root = weightPath(RAVE_ROOT);
    try {
        const fs = require('fs');
        return fs.readdirSync(root).filter((d) => fs.existsSync(root + '/' + d + '/config.json')).sort()
            .map((d) => ({ name: d, dir: root + '/' + d }));
    } catch (e) { return []; }
}

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('preset', 'tone-freq', 'tone-secs', 'tone-kind', 'btn-tone', 'src-file', 'btn-browse-file',
                   'btn-loadfile', 'src-meta', 'btn-play-src', 'btn-play-out', 'btn-save', 'btn-decode',
                   'btn-reset', 'noise', 'stereo', 'width', 'autoplay', 'run-meta', 'curves-head', 'curves', 'hint');
    const srcPlayer = clipPlayer(), outPlayer = clipPlayer();
    const waveSrc = waveView('#wave-src', { height: 84 });
    const waveOut = waveView('#wave-out', { height: 84 });
    let editor = null, timer = 0, dragging = false;

    const row = modelRow('#model-bar', {
        fields: [{ id: 'model-dir', label: 'model', what: 'RAVE model', candidates: RAVE }],
        onLoad: ([dir]) => load(dir),
        onMissing: (m) => { lab.error = m; status.error(m); },
    });

    // preset picker: every converted model found beside the default
    const list = presets();
    for (const p of list) el.preset.appendChild(h('option', { value: p.dir }, p.name));
    if (!list.length) el.preset.appendChild(h('option', { value: '' }, '(none found)'));
    el.preset.disabled = !list.length;
    const cur = list.find((p) => p.dir === row.path);
    if (cur) el.preset.value = cur.dir;
    el.preset.addEventListener('change', () => { if (el.preset.value) { row.inputs[0].value = el.preset.value; row.load(); } });

    function refresh() {
        const ok = !!lab.rave;
        el.btnTone.disabled = !ok;
        el.btnLoadfile.disabled = !ok;
        el.btnPlaySrc.disabled = !lab.src;
        el.btnPlayOut.disabled = !lab.out;
        el.btnSave.disabled = !lab.out;
        el.btnDecode.disabled = !lab.enc;
        el.btnReset.disabled = !lab.enc;
    }

    function load(dir) {
        lab.rave = null; lab.enc = null; lab.work = null; lab.out = null; lab.error = '';
        if (editor) { editor.dispose(); editor = null; }
        el.curves.textContent = '';
        el.curvesHead.hidden = true;
        el.hint.hidden = false;
        row.busy(true); row.meta('');
        refresh();
        status.busy('loading ' + baseName(dir) + '…');
        const fail = (m) => { lab.error = 'model error: ' + m; row.busy(false); status.error(lab.error); };
        try {
            bro.rave.loadRave(dir, {
                device: 'cuda',
                onReady: (r) => {
                    lab.rave = r;
                    row.busy(false);
                    row.meta('sr ' + r.sampleRate + ' · ' + r.nLatent + ' latents (of ' + r.fullLatent + ') · ' +
                             r.nBand + ' bands · ' + r.totalRatio + ' samp/frame');
                    if (r.device) badge.set(r.device);
                    el.hint.textContent = 'Make a tone or open a file to encode it into editable latent curves.';
                    status.ok('ready · make a tone or load a file');
                    refresh();
                },
                onError: fail,
            });
        } catch (e) { fail(e.message || e); }
    }

    // ── source → encode ──────────────────────────────────────────────────
    function setSource(pcm, label) {
        if (!lab.rave) { status.error('load a model first'); return; }
        const sr = lab.rave.sampleRate;
        lab.src = pcm;
        waveSrc.set({ clip: pcm, gain: 1 / Math.max(1e-6, peakOf(pcm)) });
        el.srcMeta.textContent = label + ' · ' + (pcm.length / sr).toFixed(2) + ' s';
        try {
            lab.enc = lab.rave.encode(pcm);
            lab.work = Float32Array.from(lab.enc.latent);
        } catch (e) { lab.error = 'encode failed: ' + (e.message || e); status.error(lab.error); refresh(); return; }
        if (editor) editor.dispose();
        editor = curveEditor(el.curves, lab.enc, lab.work, {
            locked: () => !lab.enc,
            onEdit: () => schedule(),
            onDragStart: () => { dragging = true; },
            onCommit: () => { dragging = false; decode(el.autoplay.checked); },
        });
        el.curvesHead.hidden = false;
        el.hint.hidden = true;
        status.ok('encoded · ' + lab.enc.nLatent + ' × ' + lab.enc.frames);
        refresh();
        decode(el.autoplay.checked);
    }

    function makeTone() {
        if (!lab.rave) return;
        const kind = el.toneKind.value, f = +el.toneFreq.value || 220, secs = +el.toneSecs.value || 1.5;
        setSource(genTone(kind, f, secs, lab.rave.sampleRate), kind + ' ' + f + ' Hz');
    }

    function loadFile() {
        const path = el.srcFile.value.trim();
        if (!lab.rave || !path) return;
        const d = decodeAudioFile(path, lab.rave.sampleRate);
        if (!d) { status.error('could not decode ' + path); return; }
        setSource(d.pcm, baseName(path));
    }

    // ── decode ───────────────────────────────────────────────────────────
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(() => { if (!dragging) decode(el.autoplay.checked); }, 40);
    }

    function decode(play) {
        if (!lab.rave || !lab.enc) return;
        const stereo = el.stereo.checked, t0 = Date.now();
        try {
            lab.out = lab.rave.decode(lab.work, lab.enc.frames, {
                addNoise: el.noise.checked, seed: 1, channels: stereo ? 2 : 1,
                stereoWidth: Math.max(0, +el.width.value || 0),
            });
        } catch (e) { lab.error = 'decode failed: ' + (e.message || e); status.error(lab.error); return; }
        lab.decodes++;
        const ch = lab.out.channels || 1, s = lab.out.samples;
        const mono = ch > 1 ? downmix(s, ch, s.length / ch) : s;
        waveOut.set({ clip: mono, gain: 1 / Math.max(1e-6, peakOf(mono)) });
        el.runMeta.textContent = 'decode ' + (Date.now() - t0) + ' ms · ' + (ch > 1 ? 'stereo' : 'mono') +
                                 (el.noise.checked ? ' · noise' : '');
        status.ok('morph ready');
        refresh();
        if (play) setTimeout(playOut, 30);   // let the edit settle before the audition
    }

    function playOut() {
        if (lab.out) outPlayer.play(lab.out.samples, lab.rave.sampleRate, { channels: lab.out.channels || 1 });
    }

    // ── wiring ───────────────────────────────────────────────────────────
    el.btnTone.onclick = makeTone;
    el.btnLoadfile.onclick = loadFile;
    el.srcFile.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFile(); });
    el.btnBrowseFile.onclick = () => {
        const p = pickFile('Audio|wav;flac;mp3;ogg');
        if (p) { el.srcFile.value = p; loadFile(); }
    };
    el.btnPlaySrc.onclick = () => { if (lab.src) srcPlayer.play(lab.src, lab.rave.sampleRate); };
    el.btnPlayOut.onclick = playOut;
    el.btnSave.onclick = () => {
        if (!lab.out) return;
        const p = saveWav(lab.out.samples, lab.rave.sampleRate, { channels: lab.out.channels || 1, defaultName: 'rave-morph.wav' });
        if (p) status.ok('saved ' + p);
    };
    el.btnDecode.onclick = () => decode(el.autoplay.checked);
    el.btnReset.onclick = () => {
        if (!lab.enc) return;
        lab.work.set(lab.enc.latent);
        editor.redrawAll();
        decode(el.autoplay.checked);
    };
    for (const c of [el.noise, el.stereo, el.width]) c.addEventListener('change', () => decode(el.autoplay.checked));

    lab.ui = { status, row, badge, get editor() { return editor; }, waveSrc, waveOut, decode };
    refresh();
    row.autoLoad();
}
