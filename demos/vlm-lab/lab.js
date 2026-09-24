// VLM Lab — chat with a vision-language model about an image.
//
//   Qwen3-VL / Qwen3.5   bro.lm.generate(model, chatml, { images: [{ data, width, height }] })
//                        streams token ids; model.decode() turns them into text.
//                        Each <|vision_start|><|image_pad|><|vision_end|> in the
//                        prompt takes the next entry of `images`.
//   CLIP ViT-L/14        clip.score(captions, image): cosine per caption.
//
// Grounding: ask Qwen3-VL to locate objects and it answers with
// { "bbox_2d": [x1, y1, x2, y2], "label" } on a 0..1000 grid; the lab parses
// every complete box out of the reply and draws it over the image.
//
// A conversation keeps its turns: the image rides on the first user turn
// after it changed, so follow-up questions do not re-encode it.

import { boot } from "/lib/kit/app.js";
import { h, ids, clear } from "/lib/kit/dom.js";
import { deviceBadge, modelRow, pickFile } from "/lib/kit/ml.js";
import { chatView } from "/lib/kit/chat-view.js";
import { imageStage, parseBoxes } from "/app/stage.js";

export const QWEN3VL = ['brolm/weights/Qwen3-VL-4B-Instruct', 'brolm/weights/Qwen3-VL-8B-Instruct'];
export const QWEN35 = ['brolm/weights/Qwen3.5-0.8B'];
export const CLIP = ['brodiffusion/weights/clip-vit-l-14'];
export const CLIP_TOK = ['brodiffusion/weights/sd15/tokenizer'];

const VISION = '<|vision_start|><|image_pad|><|vision_end|>';
const FAMILIES = {
    qwen3vl: { name: 'Qwen3-VL', fields: [{ id: 'model-dir', label: 'model', what: 'Qwen3-VL Instruct', candidates: QWEN3VL }] },
    qwen35: { name: 'Qwen3.5', fields: [{ id: 'model-dir', label: 'model', what: 'Qwen3.5-0.8B', candidates: QWEN35 }] },
    clip: {
        name: 'CLIP',
        fields: [
            { id: 'model-dir', label: 'weights', what: 'CLIP ViT-L/14', candidates: CLIP, probe: 'model.safetensors', width: 320 },
            { id: 'tok-dir', label: 'tokenizer', what: 'CLIP BPE tokenizer', candidates: CLIP_TOK, probe: 'vocab.json', width: 320 },
        ],
    },
};

/** Live app state (tests read it; module `let` exports would be snapshots). */
export const lab = {
    family: 'qwen3vl',
    model: null,        // Qwen3VLModel | Qwen35Model | ClipModel
    loading: false,
    running: false,
    handle: null,
    turns: [],          // { role: 'user'|'assistant', text, image?: ImageData }
    replies: 0,         // settled replies (done / stopped / error / CLIP score)
    reply: '',          // last reply text (thinking stripped)
    boxes: [],          // boxes parsed from the last reply
    scores: null,       // last CLIP [{ caption, score }]
    firstMs: 0, rate: 0,
    error: '',
    ui: null,
};

/** Split a Qwen reply into its <think> block and the answer. */
export function splitThinking(text) {
    const m = /^\s*<think>([\s\S]*?)(<\/think>|$)([\s\S]*)$/.exec(text);
    return m ? { thinking: m[1].trim(), text: m[3].trim() } : { thinking: '', text };
}

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('family', 'model-bar', 'sample', 'btn-open', 'btn-clear-boxes', 'image-meta', 'stage', 'drop-hint',
                   'tags', 'temperature', 'max-tokens', 'btn-clear', 'quick', 'prompt', 'btn-send', 'btn-stop',
                   'badge-rate', 'badge-latency');
    const chat = chatView('#chat', { status, labels: { user: 'You', agent: 'Model' } });
    let imageVersionSent = -1;

    const stage = imageStage(document.getElementById('image'), document.getElementById('overlay'), {
        onChange: (label) => { el.imageMeta.textContent = label; showTags([]); },
    });

    // ── model row, rebuilt per family (fields and probes differ) ─────────
    const rowHost = h('span.k-row');
    el.modelBar.appendChild(rowHost);
    let row = null;
    function buildRow() {
        clear(rowHost);
        row = modelRow(rowHost, {
            fields: FAMILIES[lab.family].fields,
            onLoad: (paths) => load(paths),
            onMissing: (m) => { lab.error = m; status.error(m); },
        });
        if (lab.ui) lab.ui.row = row;
    }

    function refresh() {
        el.btnSend.disabled = !lab.model || lab.running || lab.loading;
        el.btnStop.disabled = !lab.running;
        el.prompt.disabled = lab.running;
        for (const b of el.quick.querySelectorAll('button')) {
            b.disabled = !lab.model || lab.running || (lab.family === 'clip') !== !!b.dataset.clip;
        }
    }

    function load(paths) {
        lab.model = null; lab.error = ''; lab.loading = true;
        const fam = lab.family;
        row.busy(true); row.meta('');
        refresh();
        status.busy('loading ' + FAMILIES[fam].name + '…');
        const ready = (m, meta) => {
            if (lab.family !== fam) return;               // switched away meanwhile
            lab.model = m; lab.loading = false;
            row.busy(false); row.meta(meta);
            badge.set(m.device || 'cuda');
            status.ok(FAMILIES[fam].name + ' ready · ask about the image');
            refresh();
        };
        const fail = (e) => {
            lab.loading = false;
            lab.error = 'load failed: ' + (e && e.message || e);
            row.busy(false); status.error(lab.error); refresh();
        };
        try {
            if (fam === 'clip') {
                setTimeout(() => {                         // sync load: let the status paint first
                    try {
                        const m = bro.lm.loadClip({ vocabPath: paths[1] + '/vocab.json', mergesPath: paths[1] + '/merges.txt',
                                                    weightsPath: paths[0] + '/model.safetensors', device: 'cuda' });
                        ready(m, 'projection ' + m.projectionDim);
                    } catch (e) { fail(e); }
                }, 30);
            } else {
                const loader = fam === 'qwen3vl' ? bro.lm.loadQwen3VL : bro.lm.loadQwen35;
                loader(paths[0], {
                    onReady: (m) => ready(m, m.numLayers + ' layers · hidden ' + m.hiddenSize + ' · ctx ' + m.maxSeqLen),
                    onError: fail,
                });
            }
        } catch (e) { fail(e); }
    }

    // ── chat ─────────────────────────────────────────────────────────────
    function chatml(turns) {
        let s = '';
        for (const t of turns) {
            s += '<|im_start|>' + t.role + '\n' + (t.image ? VISION : '') + t.text + '<|im_end|>\n';
        }
        return s + '<|im_start|>assistant\n';
    }

    function send(given) {
        if (!lab.model || lab.running) return;
        const text = (given != null ? String(given) : el.prompt.value).trim();
        if (!text) return;
        if (given == null) el.prompt.value = '';
        chat.addUser(text);
        if (lab.family === 'clip') return scoreClip(text);

        const turn = { role: 'user', text };
        if (stage.version !== imageVersionSent) { turn.image = stage.image(); imageVersionSent = stage.version; }
        lab.turns.push(turn);
        const images = lab.turns.filter((t) => t.image).map((t) => ({ data: t.image.data, width: t.image.width, height: t.image.height }));
        lab.running = true; lab.error = '';
        refresh();
        status.busy('thinking…');
        const t0 = Date.now(), acc = [];
        let tFirst = 0;
        const model = lab.model;
        const decode = (ids) => { try { return model.decode(Array.from(ids)); } catch (_) { return ''; } };
        const content = (raw) => {
            const s = splitThinking(raw), c = [];
            if (s.thinking) c.push({ type: 'thinking', thinking: s.thinking });
            c.push({ type: 'text', text: s.text });
            return { role: 'assistant', content: c };
        };
        try {
            lab.handle = bro.lm.generate(model, chatml(lab.turns), {
                images,
                maxNewTokens: parseInt(el.maxTokens.value, 10) || 384,
                sampling: { temperature: Math.max(0, +el.temperature.value || 0) },
                onToken: (id) => {
                    if (!tFirst) { tFirst = Date.now(); status.busy('streaming…'); }
                    acc.push(id);
                    chat.onEvent({ type: 'message_update', message: content(decode(acc)) });
                },
                onDone: (ids, info) => {
                    const all = ids && ids.length ? ids : acc;
                    const raw = decode(all);
                    const msg = content(raw);
                    chat.onEvent({ type: 'message_end', message: msg });
                    const answer = splitThinking(raw).text;
                    lab.turns.push({ role: 'assistant', text: answer });
                    lab.reply = answer;
                    lab.firstMs = (tFirst || Date.now()) - t0;
                    const secs = (Date.now() - (tFirst || t0)) / 1000;
                    lab.rate = all.length / Math.max(0.001, secs);
                    el.badgeLatency.textContent = lab.firstMs + ' ms';
                    el.badgeRate.textContent = lab.rate.toFixed(1) + ' tok/s';
                    lab.boxes = parseBoxes(answer);
                    if (lab.boxes.length) { stage.boxes(lab.boxes); showTags(lab.boxes); }
                    finish(info && info.error ? 'error: ' + info.error
                         : info && info.cancelled ? 'stopped' : 'done · ' + all.length + ' tokens', info && info.error);
                },
            });
        } catch (e) {
            chat.finalize();
            finish('error: ' + (e.message || e), true);
        }
    }

    function finish(msg, isErr) {
        lab.running = false; lab.handle = null; lab.replies++;
        if (isErr) { lab.error = msg; status.error(msg); } else status.ok(msg);
        refresh();
    }

    // CLIP: each |- or newline-separated caption scored against the image.
    function scoreClip(text) {
        const caps = text.split(/[|\n]/).map((s) => s.trim()).filter(Boolean);
        try {
            const t0 = Date.now();
            let sc = lab.model.score(caps, stage.image());
            if (!Array.isArray(sc) && !(sc && sc.length != null)) sc = [sc];
            lab.scores = caps.map((caption, i) => ({ caption, score: sc[i] })).sort((a, b) => b.score - a.score);
            const hi = lab.scores[0].score, lo = lab.scores[lab.scores.length - 1].score;
            const table = h('table.clip-scores');
            lab.scores.forEach((s, i) => {
                const f = hi > lo ? (s.score - lo) / (hi - lo) : 1;
                table.appendChild(h('tr' + (i === 0 ? '.best' : ''), null,
                    h('td', null, s.score.toFixed(4)),
                    h('td.bar', null, h('div', { style: { width: Math.round(8 + f * 92) + '%' } })),
                    h('td', null, s.caption)));
            });
            const r = chat.addAgent('Cosine similarity of each caption to the image (best first):');
            r.lastChild.appendChild(table);
            el.badgeLatency.textContent = (Date.now() - t0) + ' ms';
            el.badgeRate.textContent = '— tok/s';
            finish('scored ' + caps.length + ' captions');
        } catch (e) { finish('error: ' + (e.message || e), true); }
    }

    function showTags(boxes) {
        clear(el.tags);
        if (!boxes.length) { el.tags.appendChild(h('span.dim', null, 'none yet: ask the model to locate objects')); return; }
        boxes.forEach((b, i) => el.tags.appendChild(h('span.tag', null, h('i', { style: { background: stage.color(i) } }), b.label)));
    }

    function clearChat() {
        if (lab.running && lab.handle) lab.handle.cancel();
        lab.turns = []; lab.reply = ''; imageVersionSent = -1;
        chat.reset();
        stage.clearBoxes(); showTags([]);
    }

    // ── wiring ───────────────────────────────────────────────────────────
    el.family.addEventListener('change', () => {
        if (lab.running && lab.handle) lab.handle.cancel();
        lab.family = el.family.value;
        lab.model = null;
        clearChat();
        buildRow();
        refresh();
        row.autoLoad();
    });
    el.sample.addEventListener('change', () => stage.sample(el.sample.value));
    el.btnOpen.onclick = () => {
        const p = pickFile('Images|png;jpg;jpeg;webp;bmp');
        if (!p) return;
        try { stage.openPath(p); } catch (e) { status.error(e.message); }
    };
    el.btnClearBoxes.onclick = () => { stage.clearBoxes(); showTags([]); };
    el.stage.addEventListener('dragover', (e) => { e.preventDefault(); el.stage.classList.add('drag'); el.dropHint.hidden = false; });
    el.stage.addEventListener('dragleave', () => { el.stage.classList.remove('drag'); el.dropHint.hidden = true; });
    el.stage.addEventListener('drop', (e) => {
        e.preventDefault();
        el.stage.classList.remove('drag'); el.dropHint.hidden = true;
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) stage.openFile(f).catch((err) => status.error('could not open ' + f.name + ': ' + err.message));
    });
    el.btnSend.onclick = () => send();
    el.btnStop.onclick = () => { if (lab.handle) { lab.handle.cancel(); status.busy('stopping…'); } };
    el.btnClear.onclick = clearChat;
    el.prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    for (const b of el.quick.querySelectorAll('button')) b.onclick = () => send(b.dataset.prompt);

    stage.sample(el.sample.value);
    buildRow();
    lab.ui = { status, row, badge, chat, stage, send, clearChat };
    refresh();
    row.autoLoad();
}
