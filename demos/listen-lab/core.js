// Listen Lab — shared foundation (load FIRST).
//
// The lab is split across several <script src> files that share one global
// namespace, `LL`, following the bro app convention (see lib/camera.js): a
// classic script's top-level const/let does NOT cross <script> boundaries in
// QuickJS, so every cross-module symbol is published on `LL` and read back from
// it. This file owns the things every module touches: the DOM element handles,
// the fusion-feed + status helpers, a tiny audio-clip player, and the small set
// of mutable cross-cutting flags (kwsReady / spots / gestureN).
//
// Load order (see index.html): core → timeline → transcript → gestures →
// streams → main. Each later file may alias anything this one (and earlier
// ones) put on LL.

;(function (global) {
    const LL = (global.LL = global.LL || {});

    const $ = (sel) => document.querySelector(sel);
    LL.$ = $;

    // Every DOM handle the lab uses, queried once and shared. (Scripts run at
    // the end of <body>, so the elements exist by the time this executes.)
    Object.assign(LL, {
        $dbBig: $('#dbBig'), $levelFill: $('#levelFill'), $floorMark: $('#floorMark'),
        $levelSmall: $('#levelSmall'),
        $voiceDot: $('#voiceDot'), $voiceTxt: $('#voiceTxt'), $voiceSmall: $('#voiceSmall'),
        $onsetDot: $('#onsetDot'), $onsetTxt: $('#onsetTxt'),
        $tonalDot: $('#tonalDot'), $tonalTxt: $('#tonalTxt'), $tonalSmall: $('#tonalSmall'),
        $chart: $('#chart'), $feed: $('#feed'),
        $overview: $('#overview'), $detail: $('#detail'), $scratch: $('#scratch'),
        $tlLive: $('#tlLive'), $tlSpan: $('#tlSpan'), $tlHover: $('#tlHover'),
        $phrase: $('#phrase'), $enroll: $('#enroll'), $record: $('#record'),
        $threshold: $('#threshold'), $coverage: $('#coverage'), $listen: $('#listen'),
        $tmpls: $('#tmpls'), $noTmpls: $('#noTmpls'),
        $gestures: $('#gestures'), $noGest: $('#noGest'),
        $status: $('#status'), $streamT: $('#streamT'), $spotCount: $('#spotCount'),
        $transcript: $('#transcript'), $txStat: $('#txStat'),
        $txLive: $('#txLive'), $txLines: $('#txLines'), $txToggle: $('#txToggle'),
        $streamsSub: $('#streamsSub'), $srcSel: $('#srcSel'),
        $addStream: $('#addStream'), $refreshApps: $('#refreshApps'),
        $streamCards: $('#streamCards'),
    });

    LL.FPS = 100;                 // sensor frame rate (10 ms hop)

    // Cross-cutting mutable flags. These are read AND written from more than one
    // module, so they live on LL (an aliased local would capture a stale value).
    LL.kwsReady = false;          // PhonemeNet checkpoint loaded + bro.kws live
    LL.spots = 0;                 // total fires (phrases + gestures), for the statusbar
    LL.gestureN = 0;              // auto-name counter for unnamed gesture clips

    const $status = LL.$status, $feed = LL.$feed;

    LL.status = function (text, isErr) {
        $status.textContent = text;
        $status.className = isErr ? 'err' : '';
    };

    // ── fusion feed ───────────────────────────────────────────────────────────
    LL.fusionRow = function (kind, text) {
        const row = document.createElement('div');
        row.className = 'row';
        const t = new Date();
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        row.innerHTML = '<span class="t">' + hh + ':' + mm + ':' + ss + '</span>' +
            '<span class="kind ' + kind + '">' + kind + '</span><span class="txt"></span>';
        row.querySelector('.txt').textContent = text;
        $feed.insertBefore(row, $feed.firstChild);
        while ($feed.children.length > 200) $feed.removeChild($feed.lastChild);
    };

    LL.mkbtn = function (label, fn) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
    };

    // A typed phrase carries minCoverage: a completion must have at least that
    // fraction of its phonemes ACTUALLY heard (not riding the emission floor), so
    // "what is the first" no longer fires on just "first" with the head floored.
    LL.phrasePolicy = function () {
        return { threshold: +LL.$threshold.value, minCoverage: +LL.$coverage.value };
    };

    // ── shared audio-clip playback (bro's native AudioContext clip API) ────────
    // One AudioContext, one live clip at a time — timeline playback and stream
    // WAV export both reach it through here so neither owns the singleton.
    let audioCtx = null, lastClip = -1;
    LL.ensureAudioCtx = function () { if (!audioCtx) audioCtx = new AudioContext(); return audioCtx; };
    LL.playPcm = function (pcm, rate) {
        const c = LL.ensureAudioCtx();
        if (lastClip >= 0) c.deleteClip(lastClip);     // free the previous so plays don't accumulate
        lastClip = c.createClip(pcm, 1, rate || 16000);
        c.playClip(lastClip, 1.0, false);
    };
})(globalThis);
