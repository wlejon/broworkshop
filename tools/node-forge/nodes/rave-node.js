// RAVE Morph: rave-lab on one card. Encode a tone or a file into RAVE's
// per-latent-dim curves, paint them, decode and hear it.
//
// bro.rave's load / encode / decode are synchronous, so recompute() is both
// the live path (a debounced paint) and exec() (Run, tests): one function,
// two callers, always in agreement.

import { h } from "/lib/kit/dom.js";
import { types } from "./types.js";
import { mountCurvePainter } from "../widgets/curve-painter.js";
import { section, row, pathRow, checkbox, audioOut, genTone, decodeMono, TONES, AUDIO_FILTER } from "./common.js";

const DEFAULTS = { dir: '', kind: 'harm', freq: 220, secs: 2.0, file: '', addNoise: false, stereo: false, width: 1.0, autoplay: true };

function seedDefaults(p) {
    for (const k in DEFAULTS) if (p[k] === undefined) p[k] = DEFAULTS[k];
}

function ensureRave(node) {
    const p = node.params;
    if (node._raveDir !== p.dir) {
        node._rave = null; node._enc = null;
        if (p.dir) {
            if (!bro.rave) throw new Error('bro.rave unavailable in this build');
            node._rave = bro.rave.loadRave(p.dir);
        }
        node._raveDir = p.dir;
    }
    return node._rave;
}

function ensureSource(node, rave) {
    const p = node.params;
    const sig = [p.kind, p.freq, p.secs, p.file, rave.sampleRate].join('|');
    if (node._srcSig !== sig) {
        let samples;
        if (p.kind === 'file') {
            if (!p.file) throw new Error('set a source file path');
            samples = decodeMono(p.file, rave.sampleRate);
            if (!samples) throw new Error('could not decode file: ' + p.file);
        } else {
            samples = genTone(p.kind, p.freq, p.secs, rave.sampleRate);
        }
        node._src = samples;
        node._srcSig = sig;
        node._enc = null;
    }
    return node._src;
}

function ensureEncode(node, rave, samples) {
    if (node._enc) return node._enc;
    const enc = rave.encode(samples);
    node._enc = enc;
    node._original = [];
    for (let c = 0; c < enc.nLatent; c++) node._original.push(Array.from(enc.latent.subarray(c * enc.frames, (c + 1) * enc.frames)));
    // Keep painted curves from a reopened project when the shape still fits.
    const cur = node.params.curves;
    const fits = cur && cur.length === enc.nLatent && (enc.nLatent === 0 || (cur[0] && cur[0].length === enc.frames));
    if (!fits) node.params.curves = node._original.map((r) => r.slice());
    return enc;
}

/** The one recompute path, shared by the live UI and exec(). */
function recompute(node) {
    const p = node.params;
    if (!p.dir) throw new Error('set a model directory');
    const rave = ensureRave(node);
    const enc = ensureEncode(node, rave, ensureSource(node, rave));
    const flat = new Float32Array(enc.nLatent * enc.frames);
    for (let c = 0; c < enc.nLatent; c++) {
        const r = p.curves[c];
        for (let t = 0; t < enc.frames; t++) flat[c * enc.frames + t] = r[t];
    }
    const out = rave.decode(flat, enc.frames, {
        addNoise: p.addNoise, seed: 1,
        channels: p.stereo ? 2 : 1, stereoWidth: p.stereo ? p.width : 0,
    });
    return { samples: out.samples, sampleRate: out.sampleRate, channels: out.channels || 1 };
}

types.define({
    type: 'rave', label: 'RAVE Morph', cat: 'Audio', color: '#34d399',
    desc: 'RAVE autoencoder: encode a tone or file, paint the latent curves, decode',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) { return [recompute(node)]; },

    mount(body, node, graph, api) {
        seedDefaults(node.params);
        const p = node.params;

        // --- model & source (dialog) -----------------------------------------------------
        const dir = pathRow({ label: 'Model dir', value: p.dir, onChange: (v) => { p.dir = v; structural(); } });
        const kind = h('select.form-input', null, TONES.concat(['file']).map((k) => h('option', { value: k }, k)));
        kind.value = p.kind;
        const freq = h('input.form-input', { type: 'number', value: String(p.freq) });
        const secs = h('input.form-input', { type: 'number', step: '0.1', value: String(p.secs) });
        const toneRow = row('Freq / secs', freq, secs);
        const file = pathRow({ label: 'File path', value: p.file, folder: false, filter: AUDIO_FILTER, onChange: (v) => { p.file = v; structural(); } });
        kind.addEventListener('change', () => { p.kind = kind.value; structural(); });
        freq.addEventListener('change', () => { p.freq = parseFloat(freq.value) || 0; structural(); });
        secs.addEventListener('change', () => { p.secs = parseFloat(secs.value) || 0; structural(); });

        // --- decode options (dialog) -------------------------------------------------------
        const noise = checkbox('Add noise', p.addNoise, (v) => { p.addNoise = v; structural(); });
        const stereo = checkbox('Stereo', p.stereo, (v) => { p.stereo = v; structural(); });
        const width = h('input.form-input', { type: 'range', min: '0', max: '3', step: '0.1', value: String(p.width) });
        width.addEventListener('change', () => { p.width = parseFloat(width.value) || 0; structural(); });
        const widthRow = row('Stereo width', width);

        function syncVisibility() {
            toneRow.style.display = p.kind === 'file' ? 'none' : '';
            file.row.style.display = p.kind === 'file' ? '' : 'none';
            widthRow.style.display = p.stereo ? '' : 'none';
        }

        // --- curves: one dim on the card, every dim in the dialog ----------------------------
        const dimSel = h('select.form-input');
        const cardCurve = h('div'), dialogCurve = h('div');
        const out = audioOut(node, { empty: 'no audio yet — set a model directory', wavName: 'rave.wav' });
        body.append(row('Latent dim', dimSel), cardCurve, out.el);
        api.dialogBody.append(
            section('Model & source', dir.row, row('Source', kind), toneRow, file.row),
            dialogCurve,
            section('Decode options', row(null, noise.el), row(null, stereo.el), widthRow));

        let dim = 0;
        function rebuildDimPicker() {
            dimSel.textContent = '';
            const n = node._enc ? node._enc.nLatent : 0;
            for (let i = 0; i < n; i++) dimSel.appendChild(h('option', { value: String(i) }, 'dim ' + i));
            if (dim >= n) dim = 0;
            dimSel.value = String(dim);
        }
        const curveCfg = (all) => ({
            count: (n) => (n._enc ? (all ? n._enc.nLatent : 1) : 0),
            label: (n, i) => 'dim ' + (all ? i : dim),
            get: (n, i) => n.params.curves && n.params.curves[all ? i : dim],
            original: (n, i) => n._original && n._original[all ? i : dim],
        });
        function rebuildCurve(host, all) {
            host.textContent = '';
            host.appendChild(mountCurvePainter(node, curveCfg(all), { onEdit: scheduleDecode }));
        }
        dimSel.addEventListener('change', () => { dim = parseInt(dimSel.value, 10) || 0; rebuildCurve(cardCurve, false); });
        // The card and the dialog edit the same arrays; refresh whichever is about to show.
        api.onDialogToggle((open) => rebuildCurve(open ? dialogCurve : cardCurve, open));

        function decodeNow() {
            const t0 = performance.now();
            const res = recompute(node);
            api.invalidate(node, [res], performance.now() - t0);
            out.publish(res.samples, res.sampleRate, res.channels);
            api.setBadge('ready · ' + node._enc.nLatent + ' latent', false);
        }
        let timer = 0;
        function scheduleDecode() {
            clearTimeout(timer);
            timer = setTimeout(() => {
                try { decodeNow(); } catch (e) { api.setBadge(String((e && e.message) || e), true); }
                api.markDirty();
            }, 40);
        }
        api.onUnmount(() => clearTimeout(timer));

        // A model / source / option change: maybe a fresh encode and new curve panels.
        function structural(quiet) {
            syncVisibility();
            if (quiet !== true) api.markDirty();
            if (!p.dir) { api.setBadge('', false); return; }
            try {
                const prev = node._enc;
                api.setBadge('loading…', false);
                decodeNow();
                if (node._enc !== prev) { rebuildDimPicker(); rebuildCurve(cardCurve, false); rebuildCurve(dialogCurve, true); }
            } catch (e) { api.setBadge(String((e && e.message) || e), true); }
        }

        syncVisibility();
        rebuildDimPicker(); rebuildCurve(cardCurve, false); rebuildCurve(dialogCurve, true);
        if (p.dir) structural(true);   // a reopened project / restored card
    },
});
