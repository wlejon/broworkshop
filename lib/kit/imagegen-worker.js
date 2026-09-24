// lib/kit/imagegen-worker.js — the worker half of the bro.diffusion labs.
//
// A lab's worker owns one native Pipeline and serves the step-wise protocol
// the page drives through imagegen.js's runGeneration():
//
//   prime  {prompt, opts, controls?, identityWeight?} -> primed {numSteps, latentWidth, latentHeight}
//   step   {ctrl?, decode?}                           -> stepped {stepIndex, numSteps, done, ms,
//                                                               bitmap?, width?, height?, trace?}
//   reset  (posted, no reply)                         drops the active state
//   search {neg[], pos[], name}                       -> axisBuilt {name, negN, posN, sep}
//   remove {name}                                     -> removed {name}
//
// The page paces the loop one step per request, so cancelling is just not
// asking for the next step. `ctrl` goes verbatim to PipelineState.stepOnce()
// ({ trace: true } or { attnBias }); the decoded frame comes back as a
// transferred ImageBitmap whenever `decode` is set and always on the last step.
//
//   import { serveWorker } from "/lib/kit/worker-rpc.js";
//   import { stepHandlers, backendName } from "/lib/kit/imagegen-worker.js";
//   let pipeline = null;
//   serveWorker(Object.assign(stepHandlers(() => pipeline), {
//       load(msg) { pipeline = bro.diffusion.loadModel(msg.modelDir); return { type: 'loaded', ... }; },
//   }));

/** 'cuda' / 'metal' / ... when bro.tensor has a GPU backend, else 'cpu'. */
export function backendName() {
    const t = (typeof bro !== 'undefined' && bro.tensor) ? bro.tensor : null;
    return t && t.available ? String(t.backend || 'gpu') : 'cpu';
}

/** Throw unless bro.diffusion exists in this realm. */
export function requireDiffusion() {
    if (typeof bro === 'undefined' || !bro.diffusion) {
        throw new Error('bro.diffusion is not available in this build');
    }
    return bro.diffusion;
}

/** loadModel() that refuses a cancelled load and the wrong model family. */
export function loadFamily(modelDir, family, why) {
    const pipe = requireDiffusion().loadModel(modelDir);
    if (!pipe || pipe.cancelled) throw new Error('load cancelled');
    const cfg = pipe.config();
    if (family && cfg.modelClass !== family) {
        try { pipe.dispose(); } catch (_) {}
        throw new Error('expected a ' + family + ' model, got ' + cfg.modelClass +
                        (why ? ' — ' + why : ''));
    }
    return pipe;
}

/** An ImageResult ({data, width, height}) as a reply carrying a transferred ImageBitmap. */
export async function imageReply(type, img, extra) {
    const bitmap = await createImageBitmap(new ImageData(img.data, img.width, img.height));
    return Object.assign({ type, bitmap, width: img.width, height: img.height, transfer: [bitmap] }, extra);
}

/**
 * Apply a { axisName: alpha } conditioning-control map from scratch: clear,
 * then set only the nonzero axes, so a run carries nothing sticky from the
 * last one and an axis at 0 is a true no-op. Returns the active count.
 */
export function applyControls(pipeline, controls) {
    if (!pipeline || !pipeline.clearControl) return 0;
    pipeline.clearControl();
    const active = {};
    let n = 0;
    for (const name of Object.keys(controls || {})) {
        const a = +controls[name];
        if (a) { active[name] = a; n++; }
    }
    if (n) pipeline.setControl(active);
    return n;
}

// Mean of one phrase's content-token conditioning rows (row 0, BOS, skipped).
function meanContent(pipeline, prompt) {
    const enc = pipeline.encodeConditioning(prompt);     // { rows, cols, data }
    const { rows, cols, data } = enc;
    const out = new Float64Array(cols);
    for (let r = 1; r < rows; r++) {
        const off = r * cols;
        for (let c = 0; c < cols; c++) out[c] += data[off + c];
    }
    if (rows > 1) for (let c = 0; c < cols; c++) out[c] /= rows - 1;
    return out;
}

function setMean(pipeline, phrases) {
    let sum = null;
    for (const p of phrases) {
        const m = meanContent(pipeline, p);
        if (!sum) sum = new Float64Array(m.length);
        for (let c = 0; c < m.length; c++) sum[c] += m[c];
    }
    for (let c = 0; c < sum.length; c++) sum[c] /= phrases.length;
    return sum;
}

/**
 * A conditioning-space direction from two phrase sets: diff of the set means
 * (B − A), with `zeroDims` channels zeroed (Gemma's massive-activation sink
 * dims for Sana; none for CLIP), unit-normalised. Returns { unit, sep } where
 * sep is the norm before normalising (how far apart the sets are).
 */
export function wordAxis(pipeline, neg, pos, zeroDims) {
    const clean = (a) => (a || []).map((s) => String(s).trim()).filter(Boolean);
    const A = clean(neg), B = clean(pos);
    if (!A.length || !B.length) throw new Error('need at least one phrase in each set');
    if (!pipeline.encodeConditioning || !pipeline.setControlVector) {
        throw new Error('this build lacks the conditioning-control API');
    }
    const ma = setMean(pipeline, A), mb = setMean(pipeline, B);
    const v = new Float64Array(mb.length);
    for (let c = 0; c < v.length; c++) v[c] = mb[c] - ma[c];
    for (const d of zeroDims || []) if (d < v.length) v[d] = 0;
    let norm = 0;
    for (let c = 0; c < v.length; c++) norm += v[c] * v[c];
    norm = Math.sqrt(norm);
    const unit = new Float32Array(v.length);
    if (norm > 0) for (let c = 0; c < v.length; c++) unit[c] = v[c] / norm;
    return { unit, sep: norm, negN: A.length, posN: B.length };
}

/**
 * The shared prime / step / reset / search / remove handlers over the
 * pipeline `getPipeline()` returns. opts.zeroDims: channels a word axis
 * zeroes (see wordAxis). Registered axes use weight 0 and scale 1, so the
 * strength a page sends in `controls` is the literal injection norm.
 */
export function stepHandlers(getPipeline, opts) {
    const o = opts || {};
    let state = null;
    const pipe = () => {
        const p = getPipeline();
        if (!p) throw new Error('no model loaded');
        return p;
    };
    return {
        prime(msg) {
            const p = pipe();
            state = null;
            applyControls(p, msg.controls);
            if (msg.identityWeight != null && p.setIdentityWeight) p.setIdentityWeight(+msg.identityWeight || 0);
            state = p.prime(msg.prompt, msg.opts || {});
            return { type: 'primed', numSteps: state.numSteps,
                     latentWidth: state.latentWidth, latentHeight: state.latentHeight };
        },
        async step(msg) {
            if (!state) throw new Error('no active generation');
            const st = state;
            if (st.done) return { type: 'stepped', done: true, stepIndex: st.stepIndex, numSteps: st.numSteps };
            const t0 = Date.now();
            const res = st.stepOnce(msg.ctrl);
            if (res && res.cancelled) throw new Error('cancelled');
            const out = { stepIndex: st.stepIndex, numSteps: st.numSteps, done: st.done };
            const transfer = [];
            if (res && res.trace) {
                out.trace = res.trace;
                for (const t of res.trace) if (t && t.data) transfer.push(t.data.buffer);
            }
            let reply = Object.assign({ type: 'stepped' }, out);
            if (msg.decode || st.done) reply = await imageReply('stepped', st.decode(), out);
            reply.ms = Date.now() - t0;
            reply.transfer = (reply.transfer || []).concat(transfer);
            if (st.done && state === st) state = null;
            return reply;
        },
        reset() { state = null; },
        search(msg) {
            const p = pipe();
            const ax = wordAxis(p, msg.neg, msg.pos, o.zeroDims);
            const name = msg.name || 'search';
            p.setControlVector(name, ax.unit, 0.0, 1.0);
            return { type: 'axisBuilt', name, negN: ax.negN, posN: ax.posN, sep: ax.sep };
        },
        remove(msg) {
            const p = getPipeline();
            if (p && p.removeControl && msg.name) p.removeControl(msg.name);
            return { type: 'removed', name: msg.name };
        },
    };
}
