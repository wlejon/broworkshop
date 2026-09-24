// Diffusion Lab — the cross-attention inspector (right-hand panel).
//
// Owns the prompt's token chips, the per-token steering map, the run's
// aggregated trace and the heatmap overlay controls:
//
//   chips      the prompt tokenized live with the model's own CLIP BPE, so
//              each chip is the exact column k of the trace's K axis
//   steering   a token -> logit-bias map; a steered run traces step 0 to
//              learn each layer's (Lq, Lk) and sends attnBias from step 1
//   trace      every step's per-layer maps summed, divided by the step count
//              at the end: diffuse, composition-scale concepts (sky, light)
//              are placed in the first steps, so a last-step trace misses them
//   overlay    one token's contrastive heatmap (attention.js) colour-mapped
//              and drawn over the final frame

import { ids } from "/lib/kit/dom.js";
import { Attention } from "/app/lab/attention.js";

// turbo-lite ramp for the heatmap: low -> cool, high -> hot.
const HEAT_STOPS = [[0.00, 30, 40, 90], [0.35, 40, 150, 200], [0.65, 240, 200, 60], [1.00, 240, 60, 50]];

const fmtBias = (v) => (!v ? 'neutral' : v > 0 ? '+' + v + ' · boost' : v + ' · suppress');

export function createInspector(view) {
    const el = ids('tokens', 'steer-empty', 'steer-ctl', 'steer-tok', 'steer-val', 'steer-bias',
                   'steer-clear', 'block', 'overlay-on', 'opacity', 'op-val');
    const heatLut = (typeof bro !== 'undefined' && bro.image) ? bro.image.gradient(HEAT_STOPS) : null;

    let tokenizer = null, enc = null;
    let bias = {};                 // contextIndex -> logit bias
    let runBias = null;            // snapshot for the active run
    let runTrace = false;
    let shapes = null;             // [{Lq, Lk}] per layer, learned from the first trace
    let agg = null, aggSteps = 0;  // summed trace, then the mean
    let latent = { w: 0, h: 0 };
    let traceCapable = true;
    let overlayToken = 0;
    let onLastFrame = true;

    const chips = Attention.create(el.tokens, {
        onSelect() {
            syncSteer();
            if (agg) el.overlayOn.checked = true;
            refresh();
        },
    });

    function labelFor(k) {
        if (!enc) return '?';
        if (k === enc.bosIndex) return '[start]';
        if (k === enc.eosIndex) return '[end]';
        const t = enc.tokens.find((x) => x.contextIndex === k);
        return t ? (t.text || '·') : '?';
    }

    function syncSteer() {
        const k = chips.activeIndex();
        const has = k >= 0 && enc != null;
        el.steerEmpty.hidden = has;
        el.steerCtl.hidden = !has;
        if (!has) return;
        const v = bias[k] || 0;
        el.steerTok.textContent = labelFor(k);
        el.steerBias.value = String(v);
        el.steerVal.textContent = el.steerBias.disabled ? 'unavailable · INT8' : fmtBias(v);
    }

    function buildChips(prompt) {
        if (!tokenizer) { chips.clear(); enc = null; el.tokens.textContent = 'Load a model to tokenize the prompt.'; return; }
        enc = tokenizer.encodeContext(prompt);
        chips.setTokens(enc);
        for (const k of Object.keys(bias)) chips.setBias(+k, bias[k]);
        syncSteer();
    }

    function resetOverlayControls() {
        el.block.textContent = '';
        el.block.disabled = true;
        el.overlayOn.disabled = true;
        el.overlayOn.checked = false;
        el.opacity.disabled = true;
        setOverlay(null);
    }

    function dropTrace() { agg = null; aggSteps = 0; shapes = null; resetOverlayControls(); }

    // Colour-map a heat grid into an ImageBitmap; alpha tracks magnitude so
    // weak attention stays see-through while hot regions read clearly.
    async function overlayBitmap(grid) {
        const n = grid.w * grid.h;
        const rgba = new Uint8ClampedArray(n * 4);
        if (heatLut) bro.image.lookup(rgba, grid.values, heatLut, { lo: 0, hi: 1 });
        for (let i = 0; i < n; i++) {
            const t = Math.max(0, Math.min(1, grid.values[i]));
            rgba[i * 4 + 3] = Math.round((0.15 + 0.85 * t) * t * 255);
        }
        return createImageBitmap(new ImageData(rgba, grid.w, grid.h));
    }

    function refresh() {
        const token = ++overlayToken;
        const k = chips.activeIndex();
        if (!el.overlayOn.checked || !agg || k < 0 || !onLastFrame) { setOverlay(null); return; }
        const sel = el.block.value;
        const blockSel = sel === 'avg' ? 'avg' : (parseInt(sel, 10) || 0);
        // Content-token columns drive the contrastive baseline: the prompt's
        // real words, excluding BOS / EOS / padding.
        const content = enc ? enc.tokens.map((t) => t.contextIndex) : null;
        const grid = Attention.computeHeatmap(agg, k, blockSel, latent.w, latent.h, content);
        if (!grid) { setOverlay(null); return; }
        overlayBitmap(grid).then((bmp) => {
            if (token !== overlayToken) { bmp.close(); return; }      // superseded
            setOverlay(bmp, +el.opacity.value / 100);
        });
    }
    // The view borrows the overlay bitmap; this module made it, so it closes it.
    function setOverlay(bmp, a) {
        const old = view.overlay;
        view.setOverlay(bmp, a);
        if (old && old !== bmp) { try { old.close(); } catch (_) {} }
    }

    // ---- wiring ----------------------------------------------------------------
    el.steerBias.addEventListener('input', () => {
        const k = chips.activeIndex();
        if (k < 0) return;
        const v = parseFloat(el.steerBias.value) || 0;
        if (v) bias[k] = v; else delete bias[k];
        el.steerVal.textContent = fmtBias(v);
        chips.setBias(k, v);
    });
    el.steerClear.addEventListener('click', () => {
        for (const k of Object.keys(bias)) chips.setBias(+k, 0);
        bias = {};
        syncSteer();
    });
    el.overlayOn.addEventListener('change', refresh);
    el.block.addEventListener('change', refresh);
    el.opacity.addEventListener('input', () => {
        el.opVal.textContent = el.opacity.value + '%';
        view.setOpacity(+el.opacity.value / 100);
    });
    resetOverlayControls();
    syncSteer();

    return {
        chips,
        /** Adopt a model's tokenizer (null clears); steering resets. */
        setTokenizer(tk, prompt) {
            tokenizer = tk;
            bias = {};
            chips.setActive(-1);
            dropTrace();
            buildChips(prompt);
        },
        /** A prompt edit shifts token indices: steering and the trace no longer line up. */
        promptChanged(prompt) {
            bias = {};
            chips.setActive(-1);
            dropTrace();
            buildChips(prompt);
        },
        /** INT8 U-Nets cannot trace (traced cross-attention is FP16-only). */
        setTraceCapable(on) {
            traceCapable = !!on;
            el.steerBias.disabled = !on;
            syncSteer();
        },
        get traceCapable() { return traceCapable; },
        /** Snapshot steering for a run; a steered run always traces. Returns { trace, steered }. */
        beginRun(wantTrace) {
            runBias = null;
            if (traceCapable && Object.keys(bias).length) runBias = Object.assign({}, bias);
            runTrace = traceCapable && (wantTrace || !!runBias);
            dropTrace();
            onLastFrame = true;
            return { trace: runTrace, steered: runBias ? Object.keys(runBias).length : 0 };
        },
        /** The stepOnce ctrl for the next step: bias once shapes are known, else trace. */
        stepCtrl() {
            if (runBias && shapes) {
                const layers = Attention.buildAttnBias(runBias, shapes);
                return { ctrl: { attnBias: layers }, transfer: layers.map((b) => b.data.buffer) };
            }
            return runTrace ? { ctrl: { trace: true } } : null;
        },
        /** Fold one step's trace into the aggregate. */
        accumulate(trace) {
            if (!shapes) shapes = trace.map((t) => ({ Lq: t.Lq, Lk: t.Lk }));
            if (!agg) {
                agg = trace.map((t) => ({ Lq: t.Lq, Lk: t.Lk, data: Float32Array.from(t.data) }));
                aggSteps = 1;
                return;
            }
            for (let b = 0; b < trace.length && b < agg.length; b++) {
                const src = trace[b].data, dst = agg[b].data;
                const n = Math.min(src.length, dst.length);
                for (let i = 0; i < n; i++) dst[i] += src[i];
            }
            aggSteps++;
        },
        /** End of run: the summed trace becomes the mean; the layer picker fills. */
        finish(lw, lh) {
            latent = { w: lw, h: lh };
            if (!agg) return;
            if (aggSteps > 1) for (const b of agg) for (let i = 0; i < b.data.length; i++) b.data[i] /= aggSteps;
            el.block.textContent = '';
            for (const o of Attention.blockOptions(agg, lw, lh)) {
                const opt = document.createElement('option');
                opt.value = String(o.value);
                opt.textContent = o.label;
                el.block.appendChild(opt);
            }
            el.block.disabled = false;
            el.overlayOn.disabled = false;
            el.opacity.disabled = false;
            refresh();
        },
        /** The overlay belongs on the run's final frame only. */
        setOnLastFrame(on) { onLastFrame = !!on; refresh(); },
        refresh,
        get hasTrace() { return !!agg; },
        get bias() { return bias; },
        get encoding() { return enc; },
        /** Steer token k by v (the slider's job; for scripts and tests). */
        steer(k, v) {
            if (v) bias[k] = v; else delete bias[k];
            chips.setBias(k, v);
            syncSteer();
        },
    };
}
