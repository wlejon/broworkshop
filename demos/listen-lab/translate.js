// Listen Lab — tier-3.5 translation (non-English → English), LIVE + per line.
// (load after transcript.js)
//
// Qwen3-ASR transcribes speech in its SOURCE language and tells us which it is.
// For any non-English speech we run a small instruction LLM (bro.lm, Qwen3) as a
// translation engine. Two paths share one serialized, single-in-flight pump
// (bro.lm is single-owner):
//   • LIVE  — the streaming partial of the ACTIVE stream is translated as words
//             arrive and shown under the live transcript. Requests COALESCE: only
//             the latest partial is ever pending, so a slow translate never backs
//             up behind stale text. It's fine for this to change as words land.
//   • FINAL — each committed line gets a translation rendered as a "→ …" row;
//             these are persistent, so they take priority over the live partial.
// Committed lines are SEEDED from the last live translation so they don't flash
// empty, then refined by a full-text pass.
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const { fusionRow, langIsEnglish, $txTl } = LL;

    // Quality first (VRAM is ample); fall back to the small/fast model if the
    // bigger one is absent or fails to load.
    const LM_CANDIDATES = [
        { tag: 'Qwen3-8B',   path: '../../../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf' },
        { tag: 'Qwen3-8B',   path: 'D:/projects/brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf' },
        { tag: 'Qwen3-0.6B', path: '../../../brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf' },
        { tag: 'Qwen3-0.6B', path: 'D:/projects/brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf' },
    ];
    const MAX_NEW = 160;

    const Translate = {
        model: null, tok: null, tag: '', ready: false, enabled: true,
        stub: null,                 // headless seam: (text) => englishText
        busy: false,
        finalQ: [],                 // [{ st, line, text }] persistent committed lines
        live: null,                 // { st, text, lang } latest coalesced partial
    };

    function setTlStatus(kind, text) {
        if (!$txTl) return;
        $txTl.className = 'txtl ' + kind;       // load | ok | err
        $txTl.textContent = text;
    }

    // Qwen3 is a hybrid "thinking" model; we want a bare translation. /no_think in
    // the system prompt plus a strip of any <think>…</think> and wrapping quotes.
    function clean(s) {
        return (s || '')
            .replace(/<think>[\s\S]*?<\/think>/g, '')
            .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
            .trim();
    }

    // ── LIVE partial (active stream only) ─────────────────────────────────────
    function onLivePartial(st, text, lang) {
        if (!Translate.enabled || st !== LL.active) return;
        if (!text || langIsEnglish(lang)) {      // nothing to translate / English
            Translate.live = null; st._liveEn = null; LL.renderActiveLiveEn('');
            return;
        }
        if (!Translate.ready && !Translate.stub) return;
        // First partial of a new utterance: show a pending cursor immediately.
        if (!st._liveEn) LL.renderActiveLiveEn('', true);
        Translate.live = { st, text, lang };     // coalesce — keep only the latest
        pump();
    }

    // ── FINAL committed line (every stream) ───────────────────────────────────
    function maybeTranslate(st, line) {
        if (!Translate.enabled) return;
        if (langIsEnglish(line.lang)) return;    // already English
        if (!Translate.ready && !Translate.stub) return;
        if (st._liveEn) line.en = st._liveEn;    // seed from the live line (no flash)
        else line.enPending = true;
        Translate.finalQ.push({ st, line, text: line.text });
        if (st === LL.active) LL.renderLines();
        pump();
    }

    // ── one serialized, single-in-flight pump (finals first, then live) ───────
    function pump() {
        if (Translate.busy) return;
        let task = null;
        if (Translate.finalQ.length) {
            const j = Translate.finalQ.shift();
            task = { kind: 'final', st: j.st, line: j.line, text: j.text };
        } else if (Translate.live) {
            task = { kind: 'live', st: Translate.live.st, text: Translate.live.text };
            Translate.live = null;
        }
        if (!task) return;
        Translate.busy = true;
        const finishTask = (raw) => {
            Translate.busy = false;
            const en = clean(raw);
            if (task.kind === 'final') {
                if (en) { task.line.en = en; fusionRow(task.st, 'xlate', '→ “' + en + '”'); }
                task.line.enPending = false;
                if (task.st === LL.active) LL.renderLines();
            } else if (en && task.st === LL.active) {     // live: only the visible stream
                task.st._liveEn = en;
                LL.renderActiveLiveEn(en, false);
            }
            pump();                                       // drain the next request
        };
        translateText(task.text, finishTask);
    }

    function translateText(text, cb) {
        if (Translate.stub) { cb(Translate.stub(text)); return; }
        try { runLM(text, cb); }
        catch (e) { fusionRow(LL.active, 'info', 'translate error: ' + (e.message || e)); cb(''); }
    }

    function runLM(text, cb) {
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
                if (info && (info.cancelled || info.error)) { cb(''); return; }
                cb(Translate.tok.decode(out ? Array.from(out) : []));
            },
        });
    }

    // ── load (fallback through the candidate list on miss / error) ────────────
    function tlLoad() {
        if (Translate.stub) return;
        loadFrom(0);
    }

    function loadFrom(i) {
        if (i >= LM_CANDIDATES.length) {
            setTlStatus('err', 'translate off');
            fusionRow(LL.active, 'info', 'translation off — no Qwen3 GGUF found');
            return;
        }
        const cand = LM_CANDIDATES[i];
        let exists = false;
        try { exists = fs.existsSync(cand.path); } catch (e) {}
        if (!exists) { loadFrom(i + 1); return; }
        setTlStatus('load', 'translate: loading ' + cand.tag + '…');
        try {
            bro.lm.loadQwen(cand.path, {
                onReady: (r) => {
                    Translate.model = r.model; Translate.tok = r.tokenizer;
                    Translate.tag = cand.tag; Translate.ready = true;
                    setTlStatus('ok', 'translate: ' + cand.tag);
                    fusionRow(LL.active, 'info',
                        'translation ready (' + cand.tag + ') — non-English speech gets a live English line');
                },
                onError: (e) => {
                    fusionRow(LL.active, 'info', 'translator ' + cand.tag + ' failed: ' + e + ' — trying next');
                    loadFrom(i + 1);
                },
            });
        } catch (e) {
            fusionRow(LL.active, 'info', 'translator ' + cand.tag + ' threw: ' + (e.message || e));
            loadFrom(i + 1);
        }
    }

    Object.assign(LL, { Translate, maybeTranslate, onLivePartial, tlLoad });
})();
