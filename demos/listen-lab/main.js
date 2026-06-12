// Listen Lab — the listening stack on one dashboard.
//
// Jonny-architecture demo: listening is a STACK of sensors fused into a
// consensus signal, not one model. This app runs two tiers of it live on the
// shared listen host (one mic tap, one PCEN front-end, one PhonemeNet
// forward) and fuses their evidence in a single poll loop:
//
//   tier-0  bro.sense.snapshot()  — model-free DSP, 10 ms latency: level,
//           energy VAD, spectral-flux onsets, autocorrelation tonality.
//   tier-2  bro.kws.progress()    — per-template Viterbi alignment as it
//           accumulates: prefix depth + the SAME geometric-mean confidence
//           the firing threshold tests, readable mid-word.
//
// The fusion feed shows the consensus story: voice starts (counter delta),
// transients, sustained tones, "phrase is 5/7 deep above threshold — a
// confirmation tier would arm HERE, seconds before onSpot", and finally the
// completed spot itself, annotated with the tier-0 context it fired in.
//
// Rhythm gestures: ● Record captures raw mic PCM via bro.mic (its own tap —
// independent of the listen host) and enrolls it with enrollGaps, so internal
// silence becomes TIMED gap states: click·gap·click is the template, and a
// re-performance at the wrong tempo is an illegal path, not a low score.
//
// Headless note: no live mic — test.js drives the same shared stream through
// bro.kws.feed() (one stream: it advances bro.sense too) and enrolls rhythm
// templates through the listenLab.enrollRhythm seam.

const fs = require('fs');

const WEIGHT_CANDIDATES = [
    '../../../brosoundml/weights/phoneme/english.bpm',
    '../../../brosoundml/build-cuda/english.bpm',
    'D:/projects/brosoundml/weights/phoneme/english.bpm',
    'D:/projects/brosoundml/build-cuda/english.bpm',
];

const $ = (sel) => document.querySelector(sel);
const $dbBig = $('#dbBig'), $levelFill = $('#levelFill'), $floorMark = $('#floorMark');
const $levelSmall = $('#levelSmall');
const $voiceDot = $('#voiceDot'), $voiceTxt = $('#voiceTxt'), $voiceSmall = $('#voiceSmall');
const $onsetDot = $('#onsetDot'), $onsetTxt = $('#onsetTxt');
const $tonalDot = $('#tonalDot'), $tonalTxt = $('#tonalTxt'), $tonalSmall = $('#tonalSmall');
const $chart = $('#chart'), $feed = $('#feed');
const $phrase = $('#phrase'), $enroll = $('#enroll'), $record = $('#record');
const $threshold = $('#threshold'), $listen = $('#listen');
const $tmpls = $('#tmpls'), $noTmpls = $('#noTmpls');
const $status = $('#status'), $streamT = $('#streamT'), $spotCount = $('#spotCount');

let kwsReady = false;
let listening = false;
let recording = false;
let spots = 0;
let gestureN = 0;
const rhythmNames = {};        // name -> true for templates enrolled with gaps

function status(text, isErr) {
    $status.textContent = text;
    $status.className = isErr ? 'err' : '';
}

// ── fusion feed ──────────────────────────────────────────────────────────────

function fusionRow(kind, text) {
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
}

// ── tier-0 sensor cards ──────────────────────────────────────────────────────

const dbPct = (db) => Math.max(0, Math.min(100, (db + 80) / 80 * 100));

function updateSensorCards(s) {
    $dbBig.textContent = (s.db <= -90 ? '−∞' : s.db.toFixed(1)) + ' dB';
    $levelFill.style.width = dbPct(s.db).toFixed(0) + '%';
    $floorMark.style.left = dbPct(s.noiseFloorDb).toFixed(0) + '%';
    $levelSmall.textContent = 'floor ' + s.noiseFloorDb.toFixed(0) +
        ' dB · snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB';

    $voiceDot.className = 'dot' + (s.voice ? ' on' : '');
    $voiceTxt.textContent = s.voice ? 'voice' : 'quiet';
    $voiceSmall.textContent = s.voice
        ? 'run ' + (s.voiceFrames / 100).toFixed(1) + ' s · events ' + s.voiceEvents
        : 'events ' + s.voiceEvents;

    // Onset is true only on its trigger frame; hold the dot lit briefly via
    // the last-event frame index instead of trying to catch that one frame.
    $onsetDot.className = 'dot onset' + (s.frames - s.lastOnsetFrame < 15 ? ' on' : '');
    $onsetTxt.textContent = String(s.onsets);

    $tonalDot.className = 'dot tonal' + (s.tonal ? ' on' : '');
    $tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
    $tonalSmall.textContent = 'periodicity ' + s.periodicity.toFixed(2) +
        (s.tonal ? ' · run ' + (s.tonalFrames / 100).toFixed(1) + ' s' : '');

    $streamT.textContent = s.t.toFixed(1) + ' s';
}

// ── timeline chart ───────────────────────────────────────────────────────────
// One column per mel frame observed by the poll loop: dB trace + adaptive
// noise floor, voice/tonal shading, onset ticks.

const hist = [];
let histMax = 800;

function pushHist(prev, s) {
    hist.push({
        db: s.db, floor: s.noiseFloorDb, voice: s.voice, tonal: s.tonal,
        onset: prev ? s.onsets > prev.onsets : false,
    });
    while (hist.length > histMax) hist.shift();
}

function drawChart() {
    const ctx = $chart.getContext('2d');
    const W = $chart.width, H = $chart.height;
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, W, H);
    const y = (db) => (1 - Math.max(0, Math.min(1, (db + 80) / 80))) * (H - 10) + 5;
    const x0 = W - hist.length;
    for (let i = 0; i < hist.length; i++) {
        const e = hist[i], x = x0 + i;
        if (x < 0) continue;
        if (e.voice) { ctx.fillStyle = 'rgba(84,214,138,.10)'; ctx.fillRect(x, 0, 1, H); }
        if (e.tonal) { ctx.fillStyle = 'rgba(106,166,255,.14)'; ctx.fillRect(x, 0, 1, H); }
    }
    ctx.strokeStyle = '#5a657a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
        const x = x0 + i;
        if (x < 0) continue;
        const yy = y(hist[i].floor);
        i === 0 || x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = '#8be0ae';
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
        const x = x0 + i;
        if (x < 0) continue;
        const yy = y(hist[i].db);
        i === 0 || x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffb454';
    for (let i = 0; i < hist.length; i++) {
        const x = x0 + i;
        if (x >= 0 && hist[i].onset) ctx.fillRect(x - 1, 0, 2, 9);
    }
}

// ── tier-0 event edges → fusion feed ─────────────────────────────────────────

let tonalAnnounced = false;

function emitTier0Events(prev, s) {
    if (s.voiceEvents > prev.voiceEvents)
        fusionRow('voice', 'voice started (snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB)');
    if (!s.voice && prev.voice)
        fusionRow('voice', 'voice ended after ' + (prev.voiceFrames / 100).toFixed(1) + ' s');
    if (s.onsets > prev.onsets) {
        const n = s.onsets - prev.onsets;
        fusionRow('onset', n === 1 ? 'transient' : n + ' transients');
    }
    if (s.tonal && s.tonalFrames >= 30 && !tonalAnnounced) {
        tonalAnnounced = true;
        fusionRow('tonal', 'sustained tone ~' + Math.round(s.dominantHz) +
            ' Hz (periodicity ' + s.periodicity.toFixed(2) + ')');
    }
    if (!s.tonal) tonalAnnounced = false;
}

// ── tier-2 template rows (bro.kws.progress) ──────────────────────────────────

const tmplRows = {};           // name -> { root, fill, meta }
let lastGeneration = -1;
const armState = {};           // name -> announced "arming" for the current attempt
const lastCompletions = {};

function rebuildTemplateRows(p) {
    Object.keys(tmplRows).forEach((k) => { tmplRows[k].root.remove(); delete tmplRows[k]; });
    $noTmpls.style.display = p.templates.length ? 'none' : '';
    for (const t of p.templates) {
        const root = document.createElement('div');
        root.className = 'tmpl';
        root.innerHTML =
            '<div class="trow"><span class="tname"></span>' +
            (rhythmNames[t.name] ? '<span class="badge">rhythm</span>' : '') +
            '<button class="rm">×</button></div>' +
            '<div class="tbar"><div class="tfill"></div></div>' +
            '<span class="tmeta"></span>';
        root.querySelector('.tname').textContent = t.name;
        root.querySelector('.rm').addEventListener('click', () => withMutableSpotter(() => {
            bro.kws.remove(t.name);
            delete rhythmNames[t.name];
        }));
        $tmpls.appendChild(root);
        tmplRows[t.name] = { root, fill: root.querySelector('.tfill'), meta: root.querySelector('.tmeta') };
        lastCompletions[t.name] = t.completions;
    }
    $listen.disabled = !kwsReady || p.templates.length === 0;
}

function updateTemplateRows(p, s) {
    if (p.generation !== lastGeneration) {
        lastGeneration = p.generation;
        rebuildTemplateRows(p);
    }
    for (const t of p.templates) {
        const row = tmplRows[t.name];
        if (!row) continue;
        row.fill.style.width = (t.progress * 100).toFixed(0) + '%';
        row.meta.textContent = t.matched + '/' + t.length +
            ' · conf ' + t.confidence.toFixed(2) + ' · fires ' + t.completions;
        if (t.completions > (lastCompletions[t.name] || 0)) flashRow(t.name);
        lastCompletions[t.name] = t.completions;

        // The fusion moment: most of a template has aligned and its partial
        // confidence is already in threshold territory — this is where a
        // heavier tier (streaming STT confirmation) would spin up, seconds
        // before any onSpot fires.
        if (!armState[t.name] && t.matched < t.length && t.progress >= 0.5) {
            armState[t.name] = true;
            fusionRow('arm', '"' + t.name + '" ' + t.matched + '/' + t.length +
                ' aligned @ conf ' + t.confidence.toFixed(2) +
                (s && s.voice ? ' · voice live' : '') +
                ' — confirmation tier would arm here');
        } else if (armState[t.name] && t.progress < 0.3) {
            armState[t.name] = false;
        }
    }
}

function flashRow(name) {
    const row = tmplRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    // Re-look-up at expiry: a template-set rebuild may have replaced (and
    // detached) this row in the meantime.
    setTimeout(() => { if (tmplRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── the poll loop — ONE place fuses every tier ───────────────────────────────

let lastS = null;

function tick() {
    const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
    if (s) {
        updateSensorCards(s);
        if (!lastS || s.frames > lastS.frames) pushHist(lastS, s);
        if (lastS) emitTier0Events(lastS, s);
        lastS = s;
    }
    if (kwsReady && bro.kws.isLoaded()) {
        const p = bro.kws.progress();
        if (p) updateTemplateRows(p, s);
    }
    drawChart();
    requestAnimationFrame(tick);
}

// ── enroll / record / listen ─────────────────────────────────────────────────

// Template mutators share the spotter's feed thread, so they're rejected while
// listening; bounce the live session around any mutation.
function withMutableSpotter(fn) {
    const wasListening = listening;
    if (wasListening) stopListening();
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    if (wasListening && bro.kws.templates().length) startListening();
    $listen.disabled = !kwsReady || bro.kws.templates().length === 0;
}

function enrollPhrase() {
    const text = $phrase.value.trim();
    if (!text || !kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enroll(text, bro.tts.phonemize(text), { threshold: +$threshold.value });
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        fusionRow('info', 'enrolled phrase "' + text + '" (' + len + ' classes)');
        $phrase.value = '';
    });
}

// Rhythm enrollment: keep internal silence >= 50 ms as timed gap states.
// Wrong-tempo re-performance becomes an illegal path, not a low score.
function enrollRhythm(name, clip) {
    if (!kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enrollFromAudio(name, clip, {
            enrollGaps: true, threshold: +$threshold.value,
        });
        rhythmNames[name] = true;
        status('enrolled rhythm "' + name + '" (' + len + ' states incl. gaps)');
        fusionRow('info', 'enrolled rhythm "' + name + '" (' + len +
            ' states, ' + (clip.length / bro.kws.sampleRate()).toFixed(1) + ' s clip)');
    });
}

// ● Record: capture raw (no-AGC) mic PCM at the spotter rate via bro.mic —
// its own broaudio tap, so it runs happily alongside the live listen host.
let recChunks = [];

function toggleRecord() {
    if (!kwsReady) return;
    if (!recording) {
        recChunks = [];
        try {
            bro.mic.start({
                chunkFrames: 160, targetRate: bro.kws.sampleRate(), agc: false, samples: true,
                onChunk: (c) => { if (c.samples) recChunks.push(c.samples.slice()); },
            });
        } catch (e) { status('mic: ' + (e.message || e), true); return; }
        recording = true;
        $record.textContent = '■ Stop';
        $record.classList.add('rec');
        status('recording — perform the gesture (clicks, taps, a rhythm), then Stop');
    } else {
        bro.mic.stop();
        recording = false;
        $record.textContent = '● Record';
        $record.classList.remove('rec');
        let n = 0;
        for (const c of recChunks) n += c.length;
        if (n < bro.kws.sampleRate() / 10) { status('recording too short, discarded', true); return; }
        const clip = new Float32Array(n);
        let o = 0;
        for (const c of recChunks) { clip.set(c, o); o += c.length; }
        recChunks = [];
        enrollRhythm($phrase.value.trim() || ('gesture-' + (++gestureN)), clip);
        $phrase.value = '';
    }
}

function startListening() {
    bro.kws.listen({
        onSpot: (name, confidence) => {
            spots++;
            $spotCount.textContent = String(spots);
            const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
            fusionRow('spot', '"' + name + '" completed @ conf ' + confidence.toFixed(3) +
                (s && s.voice ? ' · voice run ' + (s.voiceFrames / 100).toFixed(1) + ' s' : ''));
            flashRow(name);
            armState[name] = false;
        },
    });
    listening = true;
    $listen.textContent = 'Stop';
    $listen.classList.add('active');
}

function stopListening() {
    bro.kws.stop();
    listening = false;
    $listen.textContent = 'Listen';
    $listen.classList.remove('active');
}

$enroll.addEventListener('click', enrollPhrase);
$phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
$record.addEventListener('click', toggleRecord);
$listen.addEventListener('click', () => (listening ? stopListening() : startListening()));

// ── boot ─────────────────────────────────────────────────────────────────────

(function boot() {
    $chart.width = Math.max(400, $chart.clientWidth || 800);
    histMax = $chart.width;

    // Tier-0 first: model-free, always available, no weights needed.
    bro.sense.start({});
    fusionRow('info', 'tier-0 sensors live (level / voice / onset / tonality)');

    // require('fs') resolves relative paths against the app dir, but the C++
    // loader resolves against the process CWD — hand it an absolute path.
    let weights = null;
    for (const p of WEIGHT_CANDIDATES) {
        try { if (fs.existsSync(p)) { weights = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!weights) {
        status('tier-0 only — no PhonemeNet checkpoint found (' + WEIGHT_CANDIDATES.join(', ') + ')', true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }
    try {
        bro.kws.load({ weights, threshold: +$threshold.value });
        kwsReady = true;
    } catch (e) {
        status('kws load failed: ' + (e.message || e), true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }

    // Seed one phrase template and go live — the dashboard is the demo.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'),
                       { threshold: +$threshold.value });
    });
    startListening();
    fusionRow('info', 'tier-2 spotter live on the shared host (template "hello there")');
    status('listening — speak, click, whistle; enroll phrases or record a rhythm gesture');

    requestAnimationFrame(tick);
})();

// Headless test seam: drive the rhythm-enroll path with a synthesized clip
// (no live mic to record from).
globalThis.listenLab = { enrollRhythm };
