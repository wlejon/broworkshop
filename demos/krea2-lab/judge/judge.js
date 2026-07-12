// krea2-lab identity judge — a bro.net JSON server the lab's character
// search talks to. Runs as a separate bro-headless process so the judge
// models live on their own GPU (launch with CUDA_VISIBLE_DEVICES=1; the
// Krea 2 pipeline fills the other card).
//
//   CUDA_VISIBLE_DEVICES=1 bro-headless <this dir> judge.js
//
// Protocol (reliable string messages, one JSON object each):
//   → {type:'init', qwenDir, dinoDir, refPath, headBox:[x0,y0,x1,y1],
//      schema:[[name, "opt, opt, ..."], ...]}
//     Loads Qwen3-VL + DINOv2 (once), embeds the reference, crops its head
//     (box is in reference-image pixels), extracts the reference answers
//     greedy + K sampled fills.
//   ← {type:'ready', refAnswers, refCropPath}
//   → {type:'judge', id, path}          — greedy score for stage pruning
//   ← {type:'score', id, score, answers}
//   → {type:'soft', id, path}           — K-sample soft score for finals
//   ← {type:'softscore', id, soft}
//   → {type:'shutdown'}                 — exit
// Any handler error → {type:'error', id?, message}.
//
// The judging protocol is the one validated in D:/projects/identity-research
// (metric v7 + v9 soft): DINOv2 patch-vote localization from the reference
// head box, fixed-scale head crops, forced-choice questionnaire answered per
// image in isolation, match fraction computed in code.

const fs = require('fs');
const PORT = parseInt(process.env.BRO_JUDGE_PORT || '27071', 10);
const K = 5;                       // sampled fills for soft scoring
const RES = 518, GRID = 37, PATCH = 14;
const IMGTOK = '<|vision_start|><|image_pad|><|vision_end|>';

let qwen = null, dino = null;
let schema = null, refPatches = null, headIdx = null;
let refAnswers = null, refFills = null;

// ── image helpers ───────────────────────────────────────────────────────────

function loadBitmap(path) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(createImageBitmap(im));
        im.onerror = () => reject(new Error('image load failed: ' + path));
        im.src = path;
    });
}

// Square crop of `half` radius at (cx, cy), clamped inside, upscaled to at
// least 256 px (the judge needs detail) — canvas-based, returns ImageBitmap.
async function cropSquare(bmp, cx, cy, half) {
    half = Math.min(half, bmp.width / 2, bmp.height / 2);
    const x0 = Math.round(Math.min(Math.max(cx - half, 0), bmp.width - 2 * half));
    const y0 = Math.round(Math.min(Math.max(cy - half, 0), bmp.height - 2 * half));
    const side = Math.round(2 * half);
    const out = Math.max(side, 256);
    const c = document.createElement('canvas');
    c.width = out; c.height = out;
    c.getContext('2d').drawImage(bmp, x0, y0, side, side, 0, 0, out, out);
    return createImageBitmap(c);
}

function saveBitmapPng(bmp, path) {
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const cctx = c.getContext('2d');
    cctx.drawImage(bmp, 0, 0);
    const d = cctx.getImageData(0, 0, c.width, c.height);
    bro.image.encodePngFile(path, d.data, c.width, c.height, 4, c.width * 4);
}

// ── DINOv2 localization (identity-research metric2, validated in-engine) ───

function embedPatches(bmp) {
    const r = dino.encode(bmp, { size: RES });
    const f = r.features[r.features.length - 1];
    const dim = r.dim, P = GRID * GRID;
    const out = new Float32Array(P * dim);
    for (let p = 0; p < P; p++) {
        const off = (r.numPrefixTokens + p) * dim;
        let s = 0;
        for (let d = 0; d < dim; d++) s += f[off + d] * f[off + d];
        s = 1 / Math.sqrt(s);
        for (let d = 0; d < dim; d++) out[p * dim + d] = f[off + d] * s;
    }
    return { p: out, dim };
}

// Head-box pixels (on an image of side `srcSize`) → patch indices at 518.
function headRows(box, srcSize) {
    const [x0, y0, x1, y1] = box.map((v) => v * RES / srcSize);
    const idx = [];
    for (let r = 0; r < GRID; r++) {
        const cy = (r + 0.5) * PATCH;
        for (let c = 0; c < GRID; c++) {
            const cx = (c + 0.5) * PATCH;
            if (x0 <= cx && cx < x1 && y0 <= cy && cy < y1) idx.push(r * GRID + c);
        }
    }
    return idx;
}

// Reference head patches vote over the candidate grid → (cx, cy) in
// candidate-image pixels.
function localize(cand, candW, candH) {
    const { p: rp, dim } = refPatches, cp = cand.p, P = GRID * GRID;
    let wcx = 0, wcy = 0, wsum = 0;
    for (const hi of headIdx) {
        let bestSim = -2, best = 0;
        for (let q = 0; q < P; q++) {
            let s = 0;
            for (let d = 0; d < dim; d++) s += rp[hi * dim + d] * cp[q * dim + d];
            if (s > bestSim) { bestSim = s; best = q; }
        }
        const row = (best / GRID) | 0, col = best % GRID;
        wcx += (col + 0.5) * bestSim;
        wcy += (row + 0.5) * bestSim;
        wsum += bestSim;
    }
    return [wcx / wsum * PATCH * candW / RES, wcy / wsum * PATCH * candH / RES];
}

// ── VLM questionnaire (identity-research metric v7 / v9) ───────────────────

function questionnaire() {
    const qs = schema.map(([k, v]) => `${k}: choose exactly one of [${v}]`);
    return 'This is the head of a character. Fill in this questionnaire ' +
           'about the character from what you can SEE. Answer every line ' +
           "with exactly one option word, one line per attribute, format " +
           "'name: answer'. No other text.\n" + qs.join('\n');
}

function extract(bmp, sampling) {
    const prompt = '<|im_start|>user\n' + IMGTOK + questionnaire() +
                   '<|im_end|>\n<|im_start|>assistant\n';
    const ids = qwen.generate(prompt, {
        images: bmp, maxNewTokens: 120,
        sampling: sampling || { temperature: 0 } });
    const text = qwen.decode(ids);
    const ans = {};
    for (const [k] of schema) {
        const m = text.match(new RegExp(k + '\\s*:\\s*([a-z_]+)', 'i'));
        ans[k] = m ? m[1].toLowerCase() : '?';
    }
    return ans;
}

function matchScore(ref, cand) {
    const keys = Object.keys(ref).filter((k) => ref[k] !== '?' &&
                                                (cand[k] ?? '?') !== '?');
    if (!keys.length) return NaN;
    return keys.filter((k) => ref[k] === cand[k]).length / keys.length;
}

// Localize + fixed-scale head crop for a candidate image; crop side scales
// with the image (160 px half-size at 512, the validated setting).
async function headCrop(path) {
    const bmp = await loadBitmap(path);
    const [cx, cy] = localize(embedPatches(bmp), bmp.width, bmp.height);
    const crop = await cropSquare(bmp, cx, cy, 160 * bmp.width / 512);
    saveBitmapPng(crop, path.replace(/\.png$/, '_crop.png'));
    return crop;
}

// ── protocol ────────────────────────────────────────────────────────────────

async function handleInit(m) {
    if (!qwen) qwen = bro.lm.loadQwen3VL(m.qwenDir);
    if (!dino) dino = bro.vision.loadDinov2(m.dinoDir, { variant: 'base' });
    schema = m.schema;
    const refBmp = await loadBitmap(m.refPath);
    refPatches = embedPatches(refBmp);
    headIdx = headRows(m.headBox, refBmp.width);
    if (!headIdx.length) throw new Error('head box covers no patches');
    const [x0, y0, x1, y1] = m.headBox;
    const half = Math.max(x1 - x0, y1 - y0) / 2 * 1.3;
    const refCrop = await cropSquare(refBmp, (x0 + x1) / 2, (y0 + y1) / 2, half);
    // Unique per init: the lab shows this in an <img>, and the engine's image
    // loader takes the src as a literal file path (no ?cache-buster support).
    const refCropPath = m.refPath.replace(/\.png$/, '_refcrop_' + Date.now() + '.png');
    saveBitmapPng(refCrop, refCropPath);
    refAnswers = extract(refCrop);
    refFills = [];
    for (let i = 0; i < 2 * K - 1; i++) {
        refFills.push(extract(refCrop,
            { temperature: 0.7, topP: 0.95, seed: 1000 + i }));
    }
    return { type: 'ready', refAnswers, refCropPath };
}

async function handleJudge(m) {
    const crop = await headCrop(m.path);
    const answers = extract(crop);
    return { type: 'score', id: m.id, score: matchScore(refAnswers, answers),
             answers };
}

async function handleSoft(m) {
    const crop = await headCrop(m.path);
    const vals = [];
    for (let i = 0; i < K; i++) {
        const fill = extract(crop,
            { temperature: 0.7, topP: 0.95, seed: 2000 + i });
        for (const rf of refFills) {
            const v = matchScore(rf, fill);
            if (v === v) vals.push(v);
        }
    }
    return { type: 'softscore', id: m.id,
             soft: vals.length ? vals.reduce((a, b) => a + b) / vals.length
                               : NaN };
}

bro.net.host(PORT);
console.log('[judge] hosting on ' + PORT);

// One judge serves one lab session. Exit when the lab's connection drops —
// an orphaned judge would squat on the port and GPU, and its STALE reference
// anchor could silently answer the next lab's requests.
let hadClient = false;
bro.net.onconnect = () => { hadClient = true; console.log('[judge] client connected'); };
bro.net.ondisconnect = () => {
    if (hadClient) { console.log('[judge] client gone — exiting'); process.exit(0); }
};

bro.net.onmessage = (connId, data) => {
    let m;
    try { m = JSON.parse(new TextDecoder().decode(data)); } catch (e) {
        bro.net.send(connId, JSON.stringify(
            { type: 'error', message: 'bad json' }));
        return;
    }
    const run = m.type === 'init' ? handleInit
              : m.type === 'judge' ? handleJudge
              : m.type === 'soft' ? handleSoft
              : null;
    if (m.type === 'shutdown') { console.log('[judge] shutdown'); process.exit(0); return; }
    if (!run) {
        bro.net.send(connId, JSON.stringify(
            { type: 'error', id: m.id, message: 'unknown type ' + m.type }));
        return;
    }
    run(m).then((resp) => bro.net.send(connId, JSON.stringify(resp)))
          .catch((e) => bro.net.send(connId, JSON.stringify(
              { type: 'error', id: m.id, message: String(e.message || e) })));
};

// Serve until told to shut down. This runs as a headless SCRIPT, so nothing
// pumps the engine for us: net callbacks are delivered by a frame pump that
// only runs inside advanceTime(), and a bare `await` would park module eval
// in a microtask-only spin where onmessage can never fire. Pump explicitly —
// advanceTime drains net events + timers + microtasks, wallSleep yields real
// time to the wire. process.exit(0) on 'shutdown' is the way out.
for (;;) {
    advanceTime(16);
    wallSleep(16);
}

