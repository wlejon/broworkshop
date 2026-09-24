// Optional local models: Qwen3-32B (bro.lm) as the villagers' minds and
// Kokoro (bro.tts) as their voices. Both load in the background when their
// weights are found (kit weights.js, BRO_WEIGHTS aware); without them the
// village runs on tier 0 alone and stays silent.

import { findWeights } from "/lib/kit/weights.js";
import { loadKokoro, kokoroVoicePath } from "/lib/kit/kokoro.js";
import { VILLAGER_DEFS } from "/app/defs.js";

export const QWEN_CANDIDATES = ["brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf"];
const MAX_THINK_TOKENS = 200;

const chatmlTurn = (role, content) => "<|im_start|>" + role + "\n" + content + "<|im_end|>\n";

function setMind(sim, status, text) {
    sim.mind.status = status;
    sim.mind.statusText = "minds: " + text;
}

// One model per app, loaded on the first village and shared by later ones.
const qwen = { status: "idle", model: null, tokenizer: null, waiting: [] };

function startQwen() {
    const path = typeof bro !== "undefined" && bro.lm ? findWeights(QWEN_CANDIDATES) : null;
    if (!path) { qwen.status = "missing"; return; }
    const settle = (status, e) => {
        qwen.status = status;
        if (e) console.error("mind load failed:", e);
        for (const fn of qwen.waiting.splice(0)) fn();
    };
    qwen.status = "loading";
    try {
        bro.lm.loadQwen(path, {
            onReady: ({ model, tokenizer }) => {
                qwen.model = model;
                qwen.tokenizer = tokenizer;
                settle("ready");
            },
            onError: (e) => settle("failed", e),
        });
    } catch (e) { settle("failed", e); }
}

/** Give `sim` the Qwen mind, loading the model on first use. */
export function loadMind(sim) {
    sim.mind.stats = { tokens: 0, genMs: 0 };
    if (qwen.status === "idle") startQwen();
    const attach = () => {
        if (qwen.status === "missing") { setMind(sim, "off", "off — model not found"); return; }
        if (qwen.status !== "ready") { setMind(sim, "off", "off — load failed"); return; }
        sim.mind.generate = (promptText, parts) => generate(sim, qwen.model, qwen.tokenizer, parts);
        setMind(sim, "ready", "on (Qwen3-32B)");
        sim.addEvent("The villagers’ minds awaken", "day");
    };
    if (qwen.status === "loading") {
        setMind(sim, "loading", "loading…");
        qwen.waiting.push(attach);
    } else attach();
}

function generate(sim, model, tokenizer, parts) {
    return new Promise((resolve, reject) => {
        const chatml = chatmlTurn("system", parts.system) + chatmlTurn("user", parts.user) +
            "<|im_start|>assistant\n";
        const t0 = Date.now();
        try {
            bro.lm.generate(model, tokenizer.encode(chatml), {
                maxNewTokens: MAX_THINK_TOKENS,
                eosId: tokenizer.imEndId,
                sampling: { temperature: 0.7, topK: 40, topP: 0.95 },
                onDone: (outIds, info) => {
                    sim.mind.stats.tokens += outIds.length;
                    sim.mind.stats.genMs += Date.now() - t0;
                    if (info && info.error) { reject(new Error(String(info.error))); return; }
                    resolve(tokenizer.decode(Array.from(outIds)));
                },
            });
        } catch (e) { reject(e); }
    });
}

/**
 * Villager voices (create once per app). Returns { enabled, spoken,
 * say(name, text) }: say() queues a line (at most two waiting) and plays it
 * through an AudioContext clip. `enabled` turns true once Kokoro and every
 * villager's voice pack loaded.
 */
export function createVoices() {
    const tts = { enabled: false, spoken: 0, say() {} };
    const queue = [];
    const voices = {};
    let kokoro = null, busy = false, audio = null;

    const dir = loadKokoro({
        onReady: (k) => {
            kokoro = k;
            try {
                for (const def of VILLAGER_DEFS) voices[def.name] = k.loadVoice(kokoroVoicePath(dir, def.voice));
                try { audio = new AudioContext(); } catch (e) { return; }
                tts.enabled = true;
            } catch (e) { console.warn("voice load failed:", e.message); }
        },
        onError: (m) => console.warn("kokoro:", m),
    });

    function pump() {
        if (!tts.enabled || busy || queue.length === 0) return;
        const item = queue.shift();
        const voice = voices[item.name];
        if (!voice) return;
        let ids;
        try { ids = bro.tts.phonemize(item.text); } catch (e) { return; }
        busy = true;
        const next = () => { busy = false; pump(); };
        try {
            bro.tts.synthesize(kokoro, ids, voice, {
                speed: 1.05,
                onDone: (res) => {
                    if (res && res.samples && res.samples.length) play(res);
                    next();
                },
                onError: next,
            });
        } catch (e) { busy = false; }
    }

    function play(res) {
        try {
            const clip = audio.createClip(res.samples, 1, res.sampleRate);
            audio.playClip(clip, 0.9, false);
            tts.spoken++;
            setTimeout(() => {
                try { audio.deleteClip(clip); } catch (e) { /* already gone */ }
            }, (res.samples.length / res.sampleRate) * 1000 + 500);
        } catch (e) { /* playback is best-effort */ }
    }

    tts.say = (name, text) => {
        if (!tts.enabled || queue.length >= 2) return;
        queue.push({ name, text });
        pump();
    };
    return tts;
}
