// Listen Lab — tier-3.5 translation (non-English → English), LIVE + per sentence.
// (load after transcript.js)
//
// TWO models, TWO tiers — a fast one that keeps up with the stream and a slower
// one that makes it correct:
//
//   • LIVE / FAST tier — NLLB-200 (bro.lm.loadNllb), a dedicated 600M encoder-
//     decoder MT model. It translates the streaming partial and each sealed
//     sentence the instant it lands, so an English line shows up immediately.
//     But NLLB is SENTENCE-LEVEL: it sees one line at a time with no context,
//     and pro-drop languages (Japanese drops subjects/pronouns) lose meaning
//     when each line is translated in isolation ("Yeah, I'm your guy." for a
//     line that, in context, means "Yes, your partner is me.").
//
//   • CORRECTNESS tier — Qwen3-1.7B (bro.lm.loadQwen, Q8 GGUF). A general LLM
//     prompted with the RUNNING, speaker-tagged dialogue as context and asked to
//     re-translate one line, recovering the dropped subject / referent / who is
//     speaking to whom. It runs behind the fast tier at a steady pace and only
//     REPLACES a line's English when it actually improves on the NLLB pass
//     (marked `refined`). The dialogue is segmented into SCENES (a long silence
//     gap starts a new one — e.g. a scene cut), so context never bleeds across a
//     cut, and each line is re-translated again once the NEXT line lands (the
//     following context can only sharpen the read) — "progressively more correct".
//
// Both models are single-owner (one decode in flight each) but INDEPENDENT, so
// the two tiers run as two serialized pumps that never block one another.
//
// NLLB's three lanes share its one model through a serialized pump:
//   • LIVE   — the streaming partial of the ACTIVE stream, greedy. Coalesces:
//              only the latest partial is ever pending.
//   • FAST   — each committed sentence gets an immediate greedy translation.
//   • (no slow beam lane — the Qwen correctness tier replaced it.)
// Committed lines are SEEDED from the last live translation so they don't flash
// empty, then sharpened by the fast pass and the Qwen correctness pass.
import { LL } from "/app/core.js";
    const fs = require('fs');
    const { fusionRow, langIsEnglish, $txTl } = LL;

    // NLLB-200 distilled-600M, converted HF layout (config.json + tokenizer.json
    // + model.safetensors). The Translator owns its own tokenizer.
    const NLLB_CANDIDATES = [
        '../../../brolm/weights/nllb-200-distilled-600M',
        'D:/projects/brolm/weights/nllb-200-distilled-600M',
    ];
    // Qwen3-1.7B Q8_0 GGUF — the context-aware correctness tier (see
    // brolm/scripts/download_qwen3_translate.sh). 1.7B is the size/quality sweet
    // spot: it recovers the pro-drop meaning NLLB loses and stays a fraction of
    // the 8B's VRAM. DO NOT quant small models below Q6 — they malfunction.
    const QWEN_CANDIDATES = [
        '../../../brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
        'D:/projects/brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
    ];
    const MAX_NEW    = 200;  // NLLB beam-search cap (matches NLLB default)
    const FAST_BEAMS = 1;    // live + sentence pass: greedy, lowest latency

    // Correctness-tier knobs.
    const SCENE_GAP  = 350;  // frames (~3.5 s) of silence between lines → new scene
    const CTX_BEFORE = 6;    // scene lines of prior context fed to the LLM
    const CTX_AFTER  = 2;    // scene lines of FOLLOWING context (progressive refine)
    const REF_MAXNEW = 96;   // a subtitle line is short

    // Qwen3-ASR language NAMES (its detected-language strings) → FLORES-200 codes
    // NLLB speaks. Covers Qwen3-ASR's languages; anything not here (or that the
    // loaded model reports it can't speak) is skipped — the source line stays,
    // untranslated, rather than erroring. Target is always English (eng_Latn).
    const LANG2FLORES = {
        chinese: 'zho_Hans', mandarin: 'zho_Hans', cantonese: 'yue_Hant',
        spanish: 'spa_Latn', french: 'fra_Latn', german: 'deu_Latn',
        italian: 'ita_Latn', portuguese: 'por_Latn', russian: 'rus_Cyrl',
        japanese: 'jpn_Jpan', korean: 'kor_Hang', arabic: 'arb_Arab',
        hindi: 'hin_Deva', turkish: 'tur_Latn', vietnamese: 'vie_Latn',
        thai: 'tha_Thai', indonesian: 'ind_Latn', dutch: 'nld_Latn',
        polish: 'pol_Latn', ukrainian: 'ukr_Cyrl', greek: 'ell_Grek',
        czech: 'ces_Latn', swedish: 'swe_Latn', romanian: 'ron_Latn',
        hungarian: 'hun_Latn', finnish: 'fin_Latn', danish: 'dan_Latn',
        norwegian: 'nob_Latn', hebrew: 'heb_Hebr', persian: 'pes_Arab',
        farsi: 'pes_Arab', malay: 'zsm_Latn', filipino: 'tgl_Latn',
        tagalog: 'tgl_Latn', bengali: 'ben_Beng', tamil: 'tam_Taml',
        urdu: 'urd_Arab', bulgarian: 'bul_Cyrl', croatian: 'hrv_Latn',
        slovak: 'slk_Latn', catalan: 'cat_Latn', serbian: 'srp_Cyrl',
        lithuanian: 'lit_Latn', slovenian: 'slv_Latn', estonian: 'est_Latn',
        latvian: 'lvs_Latn', icelandic: 'isl_Latn', afrikaans: 'afr_Latn',
        swahili: 'swh_Latn', welsh: 'cym_Latn',
    };

    const Translate = {
        model: null, tag: '', ready: false, enabled: true,
        stub: null,                 // headless seam: (text, lang) => englishText
        busy: false,
        flores: {},                 // detected-language name → resolved FLORES code (cached)
        finalQ: [],                 // [{ st, line, text, lang }] sealed-sentence FAST lane
        live: null,                 // { st, text, lang } latest coalesced partial
    };

    // Correctness tier (Qwen3-1.7B). Independent single-owner model + its own
    // serialized queue, so it never stalls the NLLB fast/live path.
    const Refine = {
        model: null, tok: null, ready: false, enabled: true,
        busy: false, cacheN: 0,
        q: [],                      // [{ st, line }] lines awaiting a context pass
    };

    function setTlStatus(kind, text) {
        if (!$txTl) return;
        $txTl.className = 'txtl ' + kind;       // load | ok | err
        $txTl.textContent = text;
    }

    // NLLB / the LLM return a bare translation; trim whitespace + wrapping quotes.
    function clean(s) {
        return (s || '').replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
    }

    // Detected-language name → FLORES-200 code the loaded model actually speaks,
    // or '' to skip. Cached per name.
    function floresFor(lang) {
        const key = (lang || '').toLowerCase().replace(/^\s*language\s*/, '').trim();
        if (!key) return '';
        if (key in Translate.flores) return Translate.flores[key];
        let code = LANG2FLORES[key] || '';
        if (code && Translate.model && !Translate.stub) {
            try { if (!Translate.model.hasLanguage(code)) code = ''; } catch (e) { code = ''; }
        }
        Translate.flores[key] = code;
        return code;
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

    // ── FAST: a sealed sentence / committed line (every stream) ────────────────
    function maybeTranslate(st, line) {
        tagScene(st, line);                      // chronological commit hook: scene + ordering
        if (!Translate.enabled) return;
        if (langIsEnglish(line.lang)) return;    // already English
        if (!Translate.ready && !Translate.stub) return;
        if (st._liveEn) line.en = st._liveEn;    // seed from the live line (no flash)
        else line.enPending = true;
        Translate.finalQ.push({ st, line, text: line.text, lang: line.lang });
        if (st === LL.active) LL.renderLines();
        pump();
    }

    // ── one serialized, single-in-flight NLLB pump (fast first, then live) ─────
    function pump() {
        if (Translate.busy) return;
        let task = null;
        if (Translate.finalQ.length) {
            const j = Translate.finalQ.shift();
            task = { kind: 'final', st: j.st, line: j.line, text: j.text, lang: j.lang, beams: FAST_BEAMS };
        } else if (Translate.live) {
            task = { kind: 'live', st: Translate.live.st, text: Translate.live.text,
                     lang: Translate.live.lang, beams: FAST_BEAMS };
            Translate.live = null;
        }
        if (!task) return;
        Translate.busy = true;
        const finishTask = (raw) => {
            Translate.busy = false;
            const en = clean(raw);
            if (task.kind === 'final') {
                if (en) {
                    task.line.en = en; task.line.refined = false;
                    fusionRow(task.st, 'xlate', '→ “' + en + '”');
                    // Hand the line to the slow context tier for a correctness pass.
                    ctxRefine(task.st, task.line);
                }
                task.line.enPending = false;
                if (task.st === LL.active) LL.renderLines();
            } else if (en && task.st === LL.active) {     // live: only the visible stream
                task.st._liveEn = en;
                LL.renderActiveLiveEn(en, false);
            }
            pump();                                       // drain the next request
        };
        translateTask(task, finishTask);
    }

    function translateTask(task, cb) {
        if (Translate.stub) { cb(Translate.stub(task.text, task.lang)); return; }
        const src = floresFor(task.lang);
        if (!src) { cb(''); return; }                     // unmapped language → skip
        try { runNllb(task.text, src, task.beams, cb); }
        catch (e) { fusionRow(LL.active, 'info', 'translate error: ' + (e.message || e)); cb(''); }
    }

    function runNllb(text, src, beams, cb) {
        Translate.model.translate(text, src, 'eng_Latn', {
            numBeams: beams,
            maxNewTokens: MAX_NEW,
            onDone:  (out) => cb(out || ''),
            onError: (e)   => { fusionRow(LL.active, 'info', 'translate error: ' + e); cb(''); },
        });
    }

    // ── CORRECTNESS tier: scene tracking + Qwen3-1.7B context pump ─────────────

    // Tag each committed line with a per-stream scene id. A scene cut shows up as
    // a long silence gap between consecutive lines (a camera/scene change, a new
    // conversation); within a scene, chunker-sealed sentences are contiguous. The
    // scene bounds the context window so dialogue never bleeds across a cut.
    function tagScene(st, line) {
        if (st._sceneSeq == null) { st._sceneSeq = 0; st._lastB = -1; }
        if (st._lastB < 0 || (line.a - st._lastB) > SCENE_GAP) st._sceneSeq++;
        line.scene = st._sceneSeq;
        st._lastB = line.b;
    }

    // Find the previous line in the same scene (chronologically before `line`).
    function prevInScene(st, line) {
        let best = null;
        for (const l of st.txLines)               // newest-first
            if (l !== line && l.scene === line.scene && l.b < line.b &&
                (!best || l.b > best.b)) best = l;
        return best;
    }

    // Build the speaker-tagged dialogue the LLM translates against: the target
    // line's scene-mates, a few before and a couple after (the "after" lines are
    // newer — they're what makes a re-translation progressively more correct).
    // The target is marked ►; everything else is context.
    function buildDialogue(st, target) {
        const scene = st.txLines.filter((l) => l.scene === target.scene)
                                .sort((a, b) => a.b - b.b);
        const ti = scene.indexOf(target);
        if (ti < 0) return '► S' + (target.speaker || '?') + ': ' + target.text;
        const lo = Math.max(0, ti - CTX_BEFORE);
        const hi = Math.min(scene.length, ti + CTX_AFTER + 1);
        const rows = [];
        for (let i = lo; i < hi; i++) {
            const l = scene[i];
            rows.push((l === target ? '► ' : '') + 'S' + (l.speaker || '?') + ': ' + l.text);
        }
        return rows.join('\n');
    }

    // Strip the LLM's wrapping: a <think> block, a leading ► / bullet, an echoed
    // "S2:" speaker tag, then the shared quote/space trim.
    function cleanRefine(s) {
        let t = (s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        t = t.replace(/^[►>\-*•\s]+/, '');
        t = t.replace(/^S\??\d*\s*[:：]\s*/i, '');
        return clean(t);
    }

    // Enqueue a line for a context pass (and, progressively, the line before it —
    // it now has following context). Dedups: a line already queued is skipped; a
    // processed line can be re-queued when its successor lands.
    function ctxRefine(st, line) {
        if (!Refine.ready || !Refine.enabled) return;
        if (langIsEnglish(line.lang)) return;
        enqueueRefine(st, line);
        const prev = prevInScene(st, line);
        if (prev && !langIsEnglish(prev.lang)) enqueueRefine(st, prev);
    }

    function enqueueRefine(st, line) {
        if (line._refIn) return;                  // already queued
        line._refIn = true;
        Refine.q.push({ st, line });
        refineDrain();
    }

    function ensureCache(n) {
        if (Refine.cacheN >= n) return;
        const want = Math.max(n, 1024);
        Refine.model.allocateCache(want);
        Refine.cacheN = want;
    }

    function refineDrain() {
        if (Refine.busy || !Refine.q.length) return;
        if (!Refine.ready || !Refine.enabled) { Refine.q.length = 0; return; }
        const job = Refine.q.shift();
        job.line._refIn = false;
        if (langIsEnglish(job.line.lang)) { refineDrain(); return; }
        Refine.busy = true;
        runRefine(job.st, job.line, (raw) => {
            Refine.busy = false;
            const en = cleanRefine(raw);
            if (en && en !== job.line.en) {
                job.line.en = en; job.line.refined = true;
                if (job.st === LL.active) LL.renderLines();
            }
            refineDrain();
        });
    }

    function runRefine(st, line, cb) {
        const lang = LL.normLang(line.lang) || line.lang;
        if (Refine.stub) {                         // headless seam: (text, lang, dialogue) → english
            try { cb(Refine.stub(line.text, lang, buildDialogue(st, line))); }
            catch (e) { cb(null); }
            return;
        }
        const sys =
            'You translate ' + lang + ' TV dialogue into natural English subtitles. ' +
            'The conversation is given line by line with speaker labels (S1, S2…). ' +
            lang + ' frequently drops the subject and pronouns, so use the WHOLE ' +
            'exchange — who is speaking to whom — to recover who and what is meant. ' +
            'Output ONLY the English translation of the single line marked ►: ' +
            'no notes, no quotes, no speaker label, no romanization.';
        const dlg = buildDialogue(st, line);
        // A 1.7B doesn't reliably honour an in-text ► marker (it latches onto the
        // most salient line), so ALSO quote the target verbatim in the ask — the
        // exact source string it must translate, plus its speaker.
        const ask = 'Using the conversation above for context, translate ONLY this one ' +
                    'line into natural English — S' + (line.speaker || '?') + ': 「' + line.text +
                    '」. Output only that line’s translation. /no_think';
        let prompt;
        try {
            prompt = Refine.tok.applyChatTemplate(
                [{ role: 'system', content: sys },
                 { role: 'user',   content: dlg + '\n\n' + ask }],
                true);
        } catch (e) { cb(null); return; }
        const ids = Refine.tok.encode(prompt);
        ensureCache(ids.length + REF_MAXNEW + 8);
        try {
            bro.lm.generate(Refine.model, ids, {
                maxNewTokens: REF_MAXNEW,
                eosId: Refine.tok.imEndId,
                sampling: { temperature: 0 },          // greedy → deterministic, stable
                onDone: (out, info) => {
                    if (info && (info.cancelled || info.error)) { cb(null); return; }
                    cb(Refine.tok.decode(out));
                },
            });
        } catch (e) {
            fusionRow(LL.active, 'info', 'correctness pass error: ' + (e.message || e));
            cb(null);
        }
    }

    // ── load NLLB (fast tier), falling back through the candidate list ─────────
    function tlLoad() {
        ctxLoad();                                 // bring up the correctness tier alongside
        if (Translate.stub) return;
        // Resolve to an ABSOLUTE path (like txLoad): brokit's fs reads the relative
        // candidate against the app mount root, but bro.lm's loader reads it against
        // the process CWD — so hand the loader the realpath, not the relative string.
        let dir = null;
        for (const p of NLLB_CANDIDATES) {
            try { if (fs.existsSync(p + '/config.json')) { dir = fs.realpathSync(p); break; } } catch (e) {}
        }
        if (!dir) {
            setTlStatus('err', 'translate off');
            fusionRow(LL.active, 'info', 'translation off — no NLLB-200 checkpoint found');
            return;
        }
        setTlStatus('load', 'translate: loading NLLB-200…');
        try {
            bro.lm.loadNllb(dir, {
                onReady: (m) => {
                    Translate.model = m; Translate.tag = 'NLLB-200';
                    Translate.ready = true; Translate.flores = {};
                    setTlStatus('ok', 'translate: NLLB-200');
                    fusionRow(LL.active, 'info',
                        'translation ready (NLLB-200, ' + m.languageCount +
                        ' languages) — non-English speech gets a live + per-sentence English line');
                },
                onError: (e) => {
                    setTlStatus('err', 'translate off');
                    fusionRow(LL.active, 'info', 'NLLB-200 load failed: ' + e);
                },
            });
        } catch (e) {
            setTlStatus('err', 'translate off');
            fusionRow(LL.active, 'info', 'NLLB-200 load threw: ' + (e.message || e));
        }
    }

    // ── load Qwen3-1.7B (correctness tier) ─────────────────────────────────────
    function ctxLoad() {
        if (Refine.stub || Refine.ready) return;
        let path = null;
        for (const p of QWEN_CANDIDATES) {
            try { if (fs.existsSync(p)) { path = fs.realpathSync(p); break; } } catch (e) {}
        }
        if (!path) {
            fusionRow(LL.active, 'info',
                'correctness tier off — Qwen3-1.7B GGUF not found ' +
                '(run brolm/scripts/download_qwen3_translate.sh)');
            return;
        }
        try {
            bro.lm.loadQwen(path, {
                onReady: ({ model, tokenizer }) => {
                    Refine.model = model; Refine.tok = tokenizer;
                    Refine.cacheN = 0; Refine.ready = true;
                    fusionRow(LL.active, 'info',
                        'correctness tier ready (Qwen3-1.7B) — translations refine with ' +
                        'speaker-tagged scene context');
                },
                onError: (e) => fusionRow(LL.active, 'info', 'Qwen3-1.7B load failed: ' + e),
            });
        } catch (e) {
            fusionRow(LL.active, 'info', 'Qwen3-1.7B load threw: ' + (e.message || e));
        }
    }

    Object.assign(LL, { Translate, Refine, maybeTranslate, onLivePartial, tlLoad, ctxLoad, ctxRefine });
