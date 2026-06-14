// Listen Lab — shared foundation (load FIRST).
//
// The lab is split across several <script src> files that share one global
// namespace, `LL`, following the bro app convention (see lib/camera.js): a
// classic script's top-level const/let does NOT cross <script> boundaries in
// QuickJS, so every cross-module symbol is published on `LL` and read back from
// it. This file owns the things every module touches: the DOM element handles,
// the status helper, a tiny audio-clip player, the per-stream fusion feed, and
// the small set of mutable cross-cutting flags.
//
// Multi-stream: the dashboard is a per-stream component. `LL.streams` holds one
// state object per source (the mic = tab #0, plus any added stream); `LL.active`
// is the one whose dashboard is currently shown. The shared DOM (sensor cards,
// timeline, transcript, feed) renders whichever stream is active.
//
// Load order (see index.html): core → timeline → transcript → gestures →
// streams → main. Each later file may alias anything this one put on LL.

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
        $transcript: $('#transcript'), $txStat: $('#txStat'), $txTl: $('#txTl'),
        $txLive: $('#txLive'), $txLiveEn: $('#txLiveEn'),
        $txLines: $('#txLines'), $txToggle: $('#txToggle'),
        $srcSel: $('#srcSel'), $addStream: $('#addStream'), $refreshApps: $('#refreshApps'),
        $tabStrip: $('#tabStrip'),
    });

    LL.FPS = 100;                 // sensor frame rate (10 ms hop)

    // The per-stream dashboards. main.js seeds streams[0] (the mic) at boot.
    LL.streams = [];
    LL.active = null;

    // Cross-cutting mutable flags. Read AND written from more than one module, so
    // they live on LL (an aliased local would capture a stale value).
    LL.kwsReady = false;          // PhonemeNet checkpoint loaded + bro.kws live
    LL.gestureN = 0;              // auto-name counter for unnamed gesture clips

    const $status = LL.$status, $feed = LL.$feed;

    LL.status = function (text, isErr) {
        $status.textContent = text;
        $status.className = isErr ? 'err' : '';
    };

    // ── per-stream fusion feed ──────────────────────────────────────────────────
    // Each stream keeps its OWN feed (so switching tabs shows that stream's
    // events). fusionRow appends to a stream's feed and, if it's the active tab,
    // renders the row into the shared #feed; renderFeed rebuilds it on tab switch.
    function pad(n) { return String(n).padStart(2, '0'); }

    function makeFeedRow(entry) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span class="t">' + entry.ts + '</span>' +
            '<span class="kind ' + entry.kind + '">' + entry.kind + '</span><span class="txt"></span>';
        row.querySelector('.txt').textContent = entry.text;
        return row;
    }

    LL.fusionRow = function (st, kind, text) {
        if (!st) st = LL.active;
        if (!st) return;
        const t = new Date();
        const entry = { kind, text, ts: pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) };
        st.feed.unshift(entry);
        while (st.feed.length > 200) st.feed.pop();
        if (st === LL.active) {
            $feed.insertBefore(makeFeedRow(entry), $feed.firstChild);
            while ($feed.children.length > 200) $feed.removeChild($feed.lastChild);
        }
    };

    LL.renderFeed = function (st) {
        $feed.innerHTML = '';
        if (!st) return;
        for (const entry of st.feed) $feed.appendChild(makeFeedRow(entry));  // st.feed is newest-first
    };

    LL.mkbtn = function (label, fn) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
    };

    // A typed phrase carries minCoverage: a completion must have at least that
    // fraction of its phonemes ACTUALLY heard (not riding the emission floor).
    LL.phrasePolicy = function () {
        return { threshold: +LL.$threshold.value, minCoverage: +LL.$coverage.value };
    };

    // ── shared audio-clip playback (bro's native AudioContext clip API) ────────
    let audioCtx = null, lastClip = -1;
    LL.ensureAudioCtx = function () { if (!audioCtx) audioCtx = new AudioContext(); return audioCtx; };
    LL.playPcm = function (pcm, rate) {
        const c = LL.ensureAudioCtx();
        if (lastClip >= 0) c.deleteClip(lastClip);
        lastClip = c.createClip(pcm, 1, rate || 16000);
        c.playClip(lastClip, 1.0, false);
    };
})(globalThis);
