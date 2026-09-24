// lib/kit/agent-backend.js — pick and load the model an agent app talks to.
//
//   import { agentBackend } from "/lib/kit/agent-backend.js";
//   const backend = agentBackend('#backend', {
//       kinds: ['openrouter', 'brolm'],          // or ['brolm'] for local only
//       prefs,                                    // a lib/kit/prefs.js store
//       status,                                   // a kit statusLine
//       localCandidates: LOCAL_MODELS,            // weights-root-relative paths
//       vision: true,                             // show the "Eyes" (vision model) slot
//       onChange: () => { session = null; },      // backend or model changed
//   });
//   const stream = backend.stream();              // lib/kit/agent-llm.js provider, or null
//
// Local models: a Qwen3 GGUF file (bro.lm.loadQwen) or a Qwen3.5 checkpoint
// directory (bro.lm.loadQwen35), chosen by the path. OpenRouter: an API key,
// a tool-calling "brain" and (optionally) a vision model picked from the full
// catalog with lib/openrouter.js's explorer. Everything persists in `prefs`
// (keys: backend, orKey, brain, vision, localPath). With several kinds the
// backend picker is select#backend-kind.

import { h } from "./dom.js";
import { findWeights, weightPath } from "./weights.js";
import { pickFile, pickFolder } from "./ml.js";
import { brolmStream, openrouterStream } from "./agent-llm.js";
import { fetchModels, priceOf, formatPrice, openModelPicker } from "../openrouter.js";

export const DEFAULT_BRAIN = 'nvidia/nemotron-3-super-120b-a12b:free';
export const DEFAULT_VISION = 'google/gemma-4-31b-it:free';
const OR_CONTEXT = 131072;

/**
 * Load a local model. path ending in .gguf -> Qwen3 (loadQwen), else a
 * Qwen3.5 directory (loadQwen35). Calls onReady({ brolm, contextWindow,
 * layers }) / onError(msg). The brolm object is what brolmStream takes.
 */
export function loadLocalModel(path, { onReady, onError }) {
    const fail = (e) => onError && onError(String((e && e.message) || e));
    const windowOf = (m) => m.maxSeqLen || m.contextLength || m.nCtx || 8192;
    try {
        if (/\.gguf$/i.test(path)) {
            bro.lm.loadQwen(path, {
                onReady: ({ model, tokenizer }) => onReady({
                    brolm: { model, tokenizer, family: 'qwen3', eosId: tokenizer.imEndId,
                             decode: (ids) => tokenizer.decode(Array.from(ids)) },
                    contextWindow: windowOf(model), layers: model.numLayers,
                }),
                onError: fail,
            });
        } else {
            bro.lm.loadQwen35(path, {
                onReady: (model) => onReady({
                    brolm: { model, family: 'qwen35', decode: (ids) => model.decode(Array.from(ids)) },
                    contextWindow: windowOf(model), layers: model.numLayers,
                }),
                onError: fail,
            });
        }
    } catch (e) { fail(e); }
}

export function agentBackend(host, opts) {
    const node = typeof host === 'string' ? document.querySelector(host) : host;
    const o = Object.assign({ kinds: ['brolm'], vision: false, localCandidates: [] }, opts);
    const prefs = o.prefs;
    const P = prefs.data;
    const changed = () => { if (o.onChange) o.onChange(); };
    const say = (fn, text) => { if (o.status) o.status[fn](text); };

    let local = null;          // { brolm, contextWindow, layers, path }
    let catalog = null;        // OpenRouter model list, fetched once
    let loading = false;

    // --- controls ---------------------------------------------------------------
    const kindSel = h('select#backend-kind', { title: 'Where the agent model runs' },
        o.kinds.map((k) => h('option', { value: k }, k === 'openrouter' ? 'OpenRouter (cloud)' : 'Local (brolm)')));
    if (o.kinds.length > 1) node.appendChild(h('label.k-field', null, h('span', null, 'backend'), kindSel));

    const keyInput = h('input#or-key', { type: 'password', spellcheck: false, placeholder: 'sk-or-…',
                                         value: P.orKey || '', style: { width: '160px' } });
    const brainOut = h('span.k-chip#brain-display', { title: 'Tool-calling model' });
    const visionOut = h('span.k-chip#vision-display', { title: 'Vision model used by look' });
    const orGroup = h('span.k-row#or-controls', null,
        h('label.k-field', null, h('span', null, 'API key'), keyInput),
        h('label.k-field', null, h('span', null, 'brain'), brainOut),
        h('button.small#btn-browse-brain', { title: 'Browse every tool-capable model with pricing', onclick: () => browse('brain') }, 'Browse…'),
        o.vision ? h('label.k-field', null, h('span', null, 'eyes'), visionOut) : null,
        o.vision ? h('button.small#btn-browse-vision', { title: 'Browse every vision model with pricing', onclick: () => browse('vision') }, 'Browse…') : null);

    const defaultLocal = findWeights(o.localCandidates) || (o.localCandidates[0] ? weightPath(o.localCandidates[0]) : '');
    const pathInput = h('input#model-path', { type: 'text', spellcheck: false, value: P.localPath || defaultLocal,
        placeholder: 'Qwen3 .gguf or Qwen3.5 directory', title: 'A Qwen3 GGUF file or a Qwen3.5 checkpoint directory',
        style: { width: '420px' } });
    const loadBtn = h('button#btn-load', { onclick: () => api.loadLocal() }, 'Load');
    const localGroup = h('span.k-row#brolm-controls', null,
        h('label.k-field', null, h('span', null, 'model'), pathInput),
        h('button.small', { title: 'Choose a GGUF file (Shift: a Qwen3.5 directory)', onclick: (e) => {
            const p = e && e.shiftKey ? pickFolder(pathInput.value) : pickFile('GGUF|gguf');
            if (p) { pathInput.value = p; pathInput.dispatchEvent(new Event('change')); }
        } }, '…'),
        loadBtn);
    node.appendChild(orGroup);
    node.appendChild(localGroup);

    kindSel.value = o.kinds.includes(P.backend) ? P.backend : o.kinds[0];
    keyInput.addEventListener('change', () => { prefs.set({ orKey: keyInput.value.trim() }); changed(); });
    pathInput.addEventListener('change', () => prefs.set({ localPath: pathInput.value.trim() }));
    pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') api.loadLocal(); });
    kindSel.addEventListener('change', () => { prefs.set({ backend: kindSel.value }); paint(); changed(); });

    // --- OpenRouter model slots -----------------------------------------------------
    const label = (id) => {
        const m = catalog && catalog.find((x) => x.id === id);
        if (!m) return id.replace(/:free$/, '');
        const pr = priceOf(m);
        return m.id.replace(/:free$/, '') + ' · ' + (pr.isFree ? 'free' : formatPrice(pr.promptPerM));
    };
    const brain = () => P.brain || DEFAULT_BRAIN;
    const vision = () => P.vision || DEFAULT_VISION;

    async function browse(slot) {
        const key = keyInput.value.trim();
        if (!catalog) {
            say('busy', 'loading model list…');
            try { catalog = await fetchModels(key); say('ok', 'ready'); }
            catch (e) { say('error', 'model list failed: ' + ((e && e.message) || e)); return; }
        }
        const isBrain = slot === 'brain';
        const picked = await openModelPicker({
            key, models: catalog,
            filter: isBrain ? { tools: true } : { vision: true },
            initial: isBrain ? brain() : vision(),
            title: isBrain ? 'Choose a brain (tool-calling)' : 'Choose eyes (vision)',
        });
        if (!picked) return;
        prefs.set(isBrain ? { brain: picked } : { vision: picked });
        paint();
        if (isBrain) changed();
    }

    function paint() {
        const or = kindSel.value === 'openrouter';
        orGroup.hidden = !or;
        localGroup.hidden = or;
        brainOut.textContent = label(brain());
        visionOut.textContent = label(vision());
        loadBtn.disabled = loading;
        if (o.onPaint) o.onPaint();
    }

    const api = {
        /** 'openrouter' | 'brolm' */
        get kind() { return kindSel.value; },
        get key() { return keyInput.value.trim(); },
        get brain() { return brain(); },
        get vision() { return vision(); },
        get local() { return local; },
        get loading() { return loading; },
        /** Context window of the current backend (tokens). */
        get contextWindow() { return api.kind === 'openrouter' ? OR_CONTEXT : (local ? local.contextWindow : 8192); },
        /** True when stream() can build a provider. */
        get ready() { return api.kind === 'openrouter' ? !!(api.key && brain()) : !!local; },
        /** The lib/kit/agent-llm.js provider for the current choice, or null. */
        stream() {
            if (!api.ready) return null;
            if (api.kind === 'brolm') return brolmStream(local.brolm);
            return openrouterStream({
                apiKey: api.key, model: brain(), referer: 'https://bro.dev', title: o.title || document.title,
                onRateLimit: ({ waitMs }) => say('warn', 'rate-limited, retrying in ' + Math.round(waitMs / 1000) + ' s…'),
            });
        },
        /** Load the model at the path field (bro.lm, background). */
        loadLocal() {
            const path = pathInput.value.trim();
            if (!path || loading) return;
            loading = true;
            paint();
            say('busy', 'loading model…');
            loadLocalModel(path, {
                onReady: (r) => {
                    local = Object.assign({ path }, r);
                    loading = false;
                    paint();
                    say('ok', 'ready (' + r.layers + ' layers)');
                    changed();
                },
                onError: (m) => { loading = false; paint(); say('error', 'load failed: ' + m); },
            });
        },
        /** Programmatic setup (tests, automation): { kind, key, brain, vision, path }. */
        configure(c) {
            const patch = {};
            if (c.kind && o.kinds.includes(c.kind)) { kindSel.value = c.kind; patch.backend = c.kind; }
            if (c.key != null) { keyInput.value = c.key; }
            if (c.brain) patch.brain = c.brain;
            if (c.vision) patch.vision = c.vision;
            if (c.path) pathInput.value = c.path;
            prefs.set(patch);
            paint();
            changed();
        },
        paint,
        inputs: { kind: kindSel, key: keyInput, path: pathInput, load: loadBtn },
    };
    paint();
    return api;
}
