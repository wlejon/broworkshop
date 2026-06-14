// Listen Lab — tier-3.5 translation (non-English → English), LIVE + per sentence.
// (load after transcript.js)
//
// Qwen3-ASR transcribes speech in its SOURCE language and tells us which it is.
// For any non-English speech we run NLLB-200 (bro.lm.loadNllb) — a dedicated
// encoder-decoder machine-translation model — rather than prompting a general
// LLM. It is small (600M), fast, and purpose-built, so it keeps up with the
// streaming transcript and frees the VRAM the 8B translator used to hold.
//
// THREE priority lanes share the one (single-op) NLLB model through a serialized
// pump. The first two keep up with the stream; the third improves quality at a
// steady pace without ever blocking the live output:
//   • LIVE   — the streaming partial of the ACTIVE stream, greedy (1 beam).
//              Requests COALESCE: only the latest partial is ever pending, so a
//              slow translate never backs up behind stale text.
//   • FAST   — each committed sentence (transcript.js seals sentences mid-utterance
//              via its chunker) gets an immediate greedy translation, shown right
//              away as a "→ …" row. Low latency.
//   • REFINE — after a sentence's fast pass lands, it's re-translated with beam
//              search (5 beams) for a more correct result; if it differs, the
//              rendered line is replaced (marked refined). This lane only runs
//              when the two fast lanes are idle, so it catches up during pauses.
// Committed lines are SEEDED from the last live translation so they don't flash
// empty, then refined by the fast + beam passes.
import { LL } from "/app/core.js";
    const fs = require('fs');
    const { fusionRow, langIsEnglish, $txTl } = LL;

    // NLLB-200 distilled-600M, converted HF layout (config.json + tokenizer.json
    // + model.safetensors). The Translator owns its own tokenizer.
    const NLLB_CANDIDATES = [
        '../../../brolm/weights/nllb-200-distilled-600M',
        'D:/projects/brolm/weights/nllb-200-distilled-600M',
    ];
    const MAX_NEW   = 200;   // beam-search cap (matches NLLB default)
    const FAST_BEAMS   = 1;  // live + first sentence pass: greedy, lowest latency
    const REFINE_BEAMS = 5;  // correctness pass: beam search

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
        refineQ: [],                // [{ st, line, text, lang }] beam-search CORRECTNESS lane
        live: null,                 // { st, text, lang } latest coalesced partial
    };

    function setTlStatus(kind, text) {
        if (!$txTl) return;
        $txTl.className = 'txtl ' + kind;       // load | ok | err
        $txTl.textContent = text;
    }

    // NLLB returns a bare translation; just trim whitespace + wrapping quotes.
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
        if (!Translate.enabled) return;
        if (langIsEnglish(line.lang)) return;    // already English
        if (!Translate.ready && !Translate.stub) return;
        if (st._liveEn) line.en = st._liveEn;    // seed from the live line (no flash)
        else line.enPending = true;
        Translate.finalQ.push({ st, line, text: line.text, lang: line.lang });
        if (st === LL.active) LL.renderLines();
        pump();
    }

    // ── one serialized, single-in-flight pump (fast first, then live, then refine) ─
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
        } else if (Translate.refineQ.length) {
            const j = Translate.refineQ.shift();
            task = { kind: 'refine', st: j.st, line: j.line, text: j.text, lang: j.lang, beams: REFINE_BEAMS };
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
                    // Queue the slower, higher-quality pass (skip under the stub).
                    if (!Translate.stub)
                        Translate.refineQ.push({ st: task.st, line: task.line, text: task.text, lang: task.lang });
                }
                task.line.enPending = false;
                if (task.st === LL.active) LL.renderLines();
            } else if (task.kind === 'refine') {
                // Only repaint if the beam search actually improved on the greedy pass.
                if (en && en !== task.line.en) {
                    task.line.en = en; task.line.refined = true;
                    if (task.st === LL.active) LL.renderLines();
                }
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

    // ── load (fallback through the candidate list on miss / error) ────────────
    function tlLoad() {
        if (Translate.stub) return;
        let dir = null;
        for (const p of NLLB_CANDIDATES) {
            try { if (fs.existsSync(p + '/config.json')) { dir = p; break; } } catch (e) {}
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

    Object.assign(LL, { Translate, maybeTranslate, onLivePartial, tlLoad });
