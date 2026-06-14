// Listen Lab — tier-3.5 translation (non-English → English), per committed line.
// (load after transcript.js)
//
// Qwen3-ASR transcribes speech in its SOURCE language and tells us which language
// it was. For any non-English line we run a small instruction LLM (bro.lm, Qwen3)
// as a translation engine and attach the English result to the line, rendered as
// a second "→ …" row under the original. Translation runs only on COMMITTED final
// lines (never the rolling partials), so it is one short LLM generate per foreign
// utterance. The LLM is single-owner, so calls go through a serialized FIFO; a
// long backlog never overlaps a decode.
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const { fusionRow, langIsEnglish } = LL;

    const LM_CANDIDATES = [
        '../../../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
        'D:/projects/brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
        // smaller fallback if the 8B isn't present
        '../../../brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf',
        'D:/projects/brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf',
    ];
    const MAX_NEW = 160;

    const Translate = {
        model: null, tok: null, ready: false, enabled: true,
        stub: null,                // headless seam: (text, lang) => englishText
        busy: false, q: [],
    };

    // Qwen3 is a hybrid "thinking" model; we want a bare translation. Disable the
    // think pass (/no_think) and strip any <think>…</think> that slips through,
    // plus surrounding quotes the model sometimes adds.
    function clean(s) {
        return (s || '')
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
            .trim();
    }

    function maybeTranslate(st, line) {
        if (!Translate.enabled) return;
        if (langIsEnglish(line.lang)) return;             // already English
        if (!Translate.ready && !Translate.stub) return;
        Translate.q.push({ st, line });
        drain();
    }

    function drain() {
        if (Translate.busy || !Translate.q.length) return;
        const { st, line } = Translate.q.shift();
        Translate.busy = true;
        const done = (en) => {
            Translate.busy = false;
            line.en = clean(en);
            if (line.en) fusionRow(st, 'xlate', '→ “' + line.en + '”');
            if (st === LL.active && LL.renderLines) LL.renderLines();
            drain();
        };
        if (Translate.stub) { done(Translate.stub(line.text, line.lang)); return; }
        runLM(line.text, done);
    }

    function runLM(text, done) {
        const sys = 'You are a translation engine. Translate the user message into ' +
                    'English. Output ONLY the English translation — no notes, no ' +
                    'quotes, no original text. /no_think';
        const prompt = Translate.tok.applyChatTemplate(
            [{ role: 'system', content: sys }, { role: 'user', content: text }], true);
        const ids = Translate.tok.encode(prompt);
        try { Translate.model.allocateCache(ids.length + MAX_NEW + 8); } catch (e) {}
        bro.lm.generate(Translate.model, ids, {
            maxNewTokens: MAX_NEW,
            eosId: Translate.tok.imEndId,
            sampling: { temperature: 0 },                 // deterministic translation
            onDone: (out, info) => {
                if (info && (info.cancelled || info.error)) { done(''); return; }
                done(Translate.tok.decode(out ? Array.from(out) : []));
            },
        });
    }

    function tlLoad() {
        if (Translate.stub) return;
        let path = null;
        for (const p of LM_CANDIDATES) {
            try { if (fs.existsSync(p)) { path = p; break; } } catch (e) { /* next */ }
        }
        if (!path) { fusionRow(LL.active, 'info', 'translation off — no Qwen3 GGUF found'); return; }
        const small = /0\.6B/.test(path);
        fusionRow(LL.active, 'info', 'loading translator (Qwen3' + (small ? '-0.6B' : '-8B') + ')…');
        try {
            bro.lm.loadQwen(path, {
                onReady: (r) => {
                    Translate.model = r.model; Translate.tok = r.tokenizer; Translate.ready = true;
                    fusionRow(LL.active, 'info', 'translation ready — non-English lines get an English line');
                },
                onError: (e) => fusionRow(LL.active, 'info', 'translator load failed: ' + e),
            });
        } catch (e) { fusionRow(LL.active, 'info', 'translator load failed: ' + (e.message || e)); }
    }

    Object.assign(LL, { Translate, maybeTranslate, tlLoad });
})();
