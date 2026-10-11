// YuE2 Lab — drive YuE2-3B (bro.music) through every seam it has.
//
//   plan        lyrics + style -> an ABC score, streamed into an editable box
//   semantic    the score -> 25 Hz codec tokens (CFG), shown as a strip
//   synthesize  tokens -> 64-dim latents by flow matching, shown as a heatmap
//   decode      latents -> 48 kHz stereo through the YuE2 VAE, in exact tiles,
//               played while later tiles are still decoding
//
// Generate runs everything in one job. The stage buttons run one stage on
// the current take, so an edited score, a new seed for the semantic stage or
// other ODE settings can be tried without starting over. Sampling exposes
// every knob of both AR stages and the NAR solver. Expression captures
// residual states and steers with vectors derived from them. Takes keeps
// every run with its settings.

import { boot } from "/lib/kit/app.js";
import { $, ids } from "/lib/kit/dom.js";
import { logView, progressBar, tabs, segmented, readout, frameLoop, stats } from "/lib/kit/ui.js";
import { deviceBadge, modelRow, pickFolder, pickSaveFile } from "/lib/kit/ml.js";
import { bindControl } from "/lib/kit/params.js";
import { streamPlayer, interleave } from "/app/lib/player.js";
import { semanticView, latentView, waveView } from "/app/lib/views.js";
import { buildStyleTags, buildSectionTags, lyricsSummary, readExample } from "/app/lib/song.js";
import { buildSettings, resetSettings, samplingOptions, snapshotSettings, applySettings, play } from "/app/lib/settings.js";
import { buildExpression, captureOptions, steerOptions, steerSummary, setCapture } from "/app/lib/expression.js";
import { addTake, saveTake, loadTake, setTakeHandlers } from "/app/lib/takes.js";
import { audioContext } from "/lib/kit/audio.js";

const { status } = boot();
const el = ids('style', 'lyrics', 'seed', 'abc', 'cfg', 'progress');
const log = logView('#log', { newestFirst: true, time: true });
const progress = progressBar('#progress');
const badge = deviceBadge('#device');
tabs('#tabs');
const stat = stats('#stats', { model: 'model', vae: 'vae', job: 'job' });

// ── state ────────────────────────────────────────────────────────────────────
let yue = null, vae = null, job = null, jobKind = '';
const cur = { plan: null, abcModel: '', semantic: new Int32Array(0), frames: 0, take: null };
let t0 = 0, firstAbcMs = 0, firstSemMs = 0, firstLatMs = 0;

const player = streamPlayer({ prebufferSec: play.prebufferSec, onError: (e) => log.add('stream: ' + e.message, 'err') });
const semView = semanticView('#sem-view');
const latView = latentView('#lat-view');
const waveL = waveView('#wave-l'), waveR = waveView('#wave-r');
const wave = { l: new Float32Array(0), r: new Float32Array(0), n: 0 };

// ── models ───────────────────────────────────────────────────────────────────
const models = modelRow('#modelbar', {
    fields: [
        { id: 'model-dir', label: 'YuE2', what: 'YuE2-3B', candidates: ['YuE2-3B'], probe: 'qwen.tiktoken', width: 360 },
        { id: 'vae-dir', label: 'VAE', what: 'YuE2-Vae', candidates: ['brosoundml/weights/yue2-vae'], probe: 'model.safetensors', width: 360 },
    ],
    onLoad: ([modelDir, vaeDir]) => loadModels(modelDir, vaeDir),
    onMissing: (msg) => status.warn(msg),
});

function loadModels(modelDir, vaeDir) {
    if (!bro.music || bro.music.available === false) { status.error('bro.music is not in this build (BRO_WITH_SOUNDML)'); return; }
    if (job) { status.warn('stop the running job first'); return; }
    yue = null; vae = null;
    models.busy(true);
    badge.set('loading…', 'warn');
    status.busy('loading YuE2-3B + VAE…');
    const t = performance.now();
    let pending = 2;
    const finish = () => {
        if (--pending) return;
        models.busy(false);
        const ok = yue && vae;
        models.meta(ok ? 'YuE2 on ' + yue.device + ' · VAE on ' + vae.device + ' · ' + ((performance.now() - t) / 1000).toFixed(1) + ' s' : '');
        stat.set({ model: yue ? yue.device : '—', vae: vae ? vae.device : '—' });
        if (ok) badge.set(yue.device); else badge.set('load failed', 'err');
        if (ok) { status.ok('ready'); log.add('models loaded in ' + ((performance.now() - t) / 1000).toFixed(1) + ' s', 'ok'); }
        updateButtons();
    };
    bro.music.loadYuE2(modelDir, { onReady: (m) => { yue = m; finish(); },
                                    onError: (e) => { status.error('YuE2: ' + e); log.add('YuE2: ' + e, 'err'); finish(); } });
    bro.music.loadVae(vaeDir, { onReady: (v) => { vae = v; finish(); },
                                onError: (e) => { status.error('VAE: ' + e); log.add('VAE: ' + e, 'err'); finish(); } });
}

// ── song panel ───────────────────────────────────────────────────────────────
const cot = segmented('#cot', [['full', 'full score'], ['melody', 'melody'], ['off', 'none']],
                      { value: 'full', title: (v) => ({ full: 'a chord-annotated ABC score, then the music',
                                                         melody: 'a melody-only ABC score (no chords), then the music',
                                                         off: 'no score: straight to the music' })[v] });
buildStyleTags('#style-tags', el.style);
const lyricsMeta = () => { $('#lyrics-meta').textContent = lyricsSummary(el.lyrics.value); };
buildSectionTags('#section-tags', el.lyrics, lyricsMeta);
el.lyrics.addEventListener('input', lyricsMeta);
bindControl(el.cfg, { out: '#cfg-val', fmt: (v) => v.toFixed(2) });
$('#btn-dice').addEventListener('click', () => { el.seed.value = String(Math.floor(Math.random() * 2147483647)); });
$('#btn-example').addEventListener('click', () => {
    const ex = readExample(models.paths()[0]);
    if (!ex) { status.warn('no examples/*.json in the model folder'); return; }
    el.style.value = ex.style || '';
    el.lyrics.value = ex.lyrics || '';
    if (ex.seed != null) el.seed.value = String(ex.seed);
    el.style.dispatchEvent(new Event('input'));
    lyricsMeta();
    log.add('example: ' + (ex.title || 'song'));
});

buildSettings((key, v) => { if (key === 'prebufferSec') player.prebufferSec = v; if (key === 'live') player.live = v; });
$('#btn-defaults').addEventListener('click', () => { resetSettings(); log.add('sampling reset to protocol defaults'); });
buildExpression(() => {});

$('#btn-abc-revert').addEventListener('click', () => { el.abc.value = cur.abcModel; abcMeta(); });
el.abc.addEventListener('input', abcMeta);
function abcMeta() {
    const edited = cur.plan && el.abc.value !== cur.abcModel;
    $('#abc-meta').textContent = (el.abc.value.split('\n').length - 1) + ' lines' + (edited ? ' · edited (Semantic re-plans with it)' : '');
}

// ── pipeline display ─────────────────────────────────────────────────────────
const STAGES = ['plan', 'semantic', 'synthesize', 'decode'];
const stageEl = {};
for (const s of STAGES) {
    const bar = document.createElement('i');
    const sub = document.createElement('div'); sub.className = 'sub';
    const box = document.createElement('div'); box.className = 'stage';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = s;
    const track = document.createElement('div'); track.className = 'bar'; track.appendChild(bar);
    box.append(name, track, sub);
    $('#stages').appendChild(box);
    stageEl[s] = { box, bar, sub };
}
function stageState(s, state, frac, text) {
    const e = stageEl[s];
    if (state != null) e.box.className = 'stage' + (state ? ' ' + state : '');
    if (frac != null) e.bar.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    if (text != null) e.sub.textContent = text;
}
function resetStages(which) { for (const s of which) stageState(s, '', 0, ''); }

const timing = readout('#timing', {
    wall: 'wall', firstAbc: 'first score token', firstSem: 'first semantic token', firstLat: 'first latents',
    firstAudio: 'first audio', playStart: 'playback start', planTps: 'score tok/s', semTps: 'semantic tok/s',
    nar: 'NAR s / audio s', rtf: 'audio s / wall s',
});
const streamStats = readout('#stream-stats', { dur: 'decoded', buf: 'buffered', under: 'underrun', play: 'playing' });

// ── runs ─────────────────────────────────────────────────────────────────────
function seed() {
    if (!$('#seed-lock').checked) el.seed.value = String(Math.floor(Math.random() * 2147483647));
    const v = Number(el.seed.value);
    return Number.isFinite(v) && v >= 0 ? v : 831001;
}

function baseOptions() {
    const o = Object.assign({
        style: el.style.value.trim(),
        lyrics: el.lyrics.value,
        cot: cot.value,
        seed: seed(),
        steer: steerOptions(),
        capture: captureOptions(),
    }, samplingOptions());
    if ($('#cfg-on').checked) o.cfgScale = Number(el.cfg.value);
    return o;
}

function resetAudio() {
    player.reset();
    wave.l = new Float32Array(0); wave.r = new Float32Array(0); wave.n = 0;
    waveL.set(wave.l, 0); waveR.set(wave.r, 0);
}

function appendAudio(c) {
    const need = wave.n + c.frames;
    if (need > wave.l.length) {
        const cap = Math.max(need, wave.l.length * 2, 48000 * 10);
        const l = new Float32Array(cap), r = new Float32Array(cap);
        l.set(wave.l.subarray(0, wave.n)); r.set(wave.r.subarray(0, wave.n));
        wave.l = l; wave.r = r;
    }
    wave.l.set(c.samples.subarray(0, c.frames), wave.n);
    wave.r.set(c.samples.subarray(c.frames, 2 * c.frames), wave.n);
    wave.n = need;
    waveL.set(wave.l, wave.n); waveR.set(wave.r, wave.n);
    player.push(c);
    if (!stageEl.decode.box.classList.contains('run')) stageState('decode', 'run');
}

// Callbacks every job shares; `extra` adds per-kind ones.
function callbacks(onFinish) {
    return {
        onAbc: (text) => {
            if (!firstAbcMs) firstAbcMs = performance.now() - t0;
            el.abc.value += text;
            el.abc.scrollTop = el.abc.scrollHeight;
        },
        onSemantic: (ids) => {
            if (!firstSemMs) firstSemMs = performance.now() - t0;
            semView.append(ids);
        },
        onLatents: (c) => {
            if (!firstLatMs) firstLatMs = performance.now() - t0;
            latView.append(c.frame0, c.frames, c.latents);
        },
        onAudio: appendAudio,
        onProgress: (p) => {
            const frac = p.total ? p.done / p.total : 0;
            if (p.stage === 'plan') stageState('plan', 'run', frac, p.done + ' tokens');
            else if (p.stage === 'semantic') {
                if (!stageEl.plan.box.classList.contains('done') && jobKind !== 'semantic') stageState('plan', 'done', 1);
                stageState('semantic', 'run', frac, p.done + ' tokens · ' + (p.done / 25).toFixed(1) + ' s of song');
            } else {
                stageState('semantic', 'done', 1);
                stageState('synthesize', 'run', frac, p.done + ' / ' + p.total + ' ODE steps');
            }
            progress.set(frac);
        },
        onDone: (r, info) => onFinish(r, info),
    };
}

function begin(kind, stages) {
    jobKind = kind;
    t0 = performance.now(); firstAbcMs = firstSemMs = firstLatMs = 0;
    resetStages(stages);
    progress.set(0);
    stat.set('job', kind);
    status.busy(kind + '…');
    updateButtons();
}

function end(info, label) {
    job = null; jobKind = '';
    stat.set('job', '—');
    if (info && info.error) { status.error(label + ': ' + info.error); log.add(label + ': ' + info.error, 'err'); }
    else if (info && info.cancelled) { status.warn(label + ' stopped'); log.add(label + ' stopped', 'warn'); }
    else status.ok(label + ' done');
    updateButtons();
}

function showTiming(r) {
    const wall = (performance.now() - t0) / 1000;
    const ps = player.stats();
    const ms = (v) => v ? (v / 1000).toFixed(2) + ' s' : '—';
    const tm = (r && r.timing) || {};
    timing.set({
        wall: wall.toFixed(1) + ' s', firstAbc: ms(firstAbcMs), firstSem: ms(firstSemMs), firstLat: ms(firstLatMs),
        firstAudio: ms(ps.firstAudioMs), playStart: ms(ps.playStartMs),
        planTps: tm.planTps ? tm.planTps.toFixed(0) + ' (ttft ' + tm.planTtft.toFixed(2) + ' s)' : '—',
        semTps: tm.semanticTps ? tm.semanticTps.toFixed(0) + ' (ttft ' + tm.semanticTtft.toFixed(2) + ' s)' : '—',
        nar: tm.narSecondsPerAudioSecond ? tm.narSecondsPerAudioSecond.toFixed(3) : '—',
        rtf: ps.seconds ? (ps.seconds / wall).toFixed(2) + '×' : '—',
    });
}

function keepTake(kind, r, opts) {
    const a = player.audio();
    const t = addTake({
        kind, seed: opts.seed, style: opts.style, lyrics: opts.lyrics, cot: opts.cot, cfgScale: opts.cfgScale,
        settings: snapshotSettings(), steer: steerSummary(), timing: r.timing,
        abc: cur.plan ? cur.plan.abc : '', plan: cur.plan, semantic: cur.semantic,
        latents: latView.latents(), frames: latView.frames, audio: a,
    });
    cur.take = t;
    log.add('take #' + t.id + ': ' + (a ? (a.frames / a.sampleRate).toFixed(1) + ' s of audio' : 'no audio'), 'ok');
    if (a && !play.live && play.autoplay) player.replay();
}

function generate() {
    if (!ready()) return;
    const opts = baseOptions();
    el.abc.value = '';
    semView.set(new Int32Array(0)); latView.set(new Float32Array(0), 0); resetAudio();
    begin('generate', STAGES);
    if (opts.cot === 'off') stageState('plan', 'skip', 1, 'no score');
    job = yue.generate(Object.assign(opts, { vae }, callbacks((r, info) => {
        player.finish();
        cur.plan = r.plan; cur.abcModel = r.plan.abc; cur.semantic = r.semantic;
        if (r.plan.abc && el.abc.value !== r.plan.abc) el.abc.value = r.plan.abc;
        abcMeta();
        semView.set(r.semantic);
        if (r.frames) latView.set(r.latents, r.frames);
        for (const s of STAGES) if (!stageEl[s].box.classList.contains('skip')) stageState(s, info.cancelled ? '' : 'done', 1);
        stageState('decode', null, null, r.audio ? (r.audio.frames / r.audio.sampleRate).toFixed(1) + ' s' : '');
        showTiming(r);
        setCapture(r.hidden);
        if (!info.error && (r.frames || r.semantic.length)) keepTake('generate', r, opts);
        end(info, 'generate');
    })));
    updateButtons();
}

function planStage() {
    if (!ready()) return;
    const opts = baseOptions();
    el.abc.value = '';
    begin('plan', ['plan']);
    job = yue.plan(Object.assign(opts, callbacks((r, info) => {
        cur.plan = r.plan; cur.abcModel = r.plan.abc;
        el.abc.value = r.plan.abc; abcMeta();
        stageState('plan', info.cancelled ? '' : 'done', 1, r.plan.abcIds.length + ' tokens' + (r.plan.truncated ? ' (truncated)' : ''));
        showTiming(r);
        setCapture(r.hidden);
        end(info, 'plan');
    })));
    updateButtons();
}

// Semantic from the current score. An edited score (or none yet) is turned
// into a plan first: plan() with opts.abc samples nothing, it only builds the
// prefix around the given score.
function semanticStage() {
    if (!ready()) return;
    const opts = baseOptions();
    const edited = el.abc.value.trim();
    const run = (plan) => {
        semView.set(new Int32Array(0));
        begin('semantic', ['semantic']);
        job = yue.semantic(plan, Object.assign(opts, callbacks((r, info) => {
            cur.semantic = r.semantic;
            semView.set(r.semantic);
            stageState('semantic', info.cancelled ? '' : 'done', 1, r.semantic.length + ' tokens · ' + (r.semantic.length / 25).toFixed(1) + ' s' +
                       (r.semanticTruncated ? ' (truncated)' : ''));
            showTiming(r);
            setCapture(r.hidden);
            end(info, 'semantic');
        })));
        updateButtons();
    };
    const needPlan = !cur.plan || (opts.cot !== 'off' && edited && edited !== cur.plan.abc.trim());
    if (!needPlan) { run(cur.plan); return; }
    if (opts.cot === 'off') { status.warn('score is off: press Plan or Generate first'); return; }
    if (!edited) { status.warn('no score: run Plan first, or type one'); return; }
    begin('plan', ['plan']);
    job = yue.plan(Object.assign({}, opts, { abc: edited, capture: undefined, onDone: (r, info) => {
        end(info, 'plan');
        if (info.error || info.cancelled) return;
        cur.plan = r.plan; cur.abcModel = edited;
        stageState('plan', 'done', 1, 'your score');
        run(r.plan);
    } }));
    updateButtons();
}

function synthStage() {
    if (!ready()) return;
    if (!cur.plan || !cur.semantic.length) { status.warn('no semantic tokens yet: run Semantic or Generate first'); return; }
    const opts = baseOptions();
    latView.set(new Float32Array(0), 0); resetAudio();
    begin('synthesize', ['synthesize', 'decode']);
    job = yue.synthesize(cur.plan, cur.semantic, Object.assign(opts, { vae }, callbacks((r, info) => {
        player.finish();
        if (r.frames) latView.set(r.latents, r.frames);
        stageState('synthesize', info.cancelled ? '' : 'done', 1, r.frames + ' frames');
        stageState('decode', info.cancelled ? '' : 'done', 1, r.audio ? (r.audio.frames / r.audio.sampleRate).toFixed(1) + ' s' : '');
        showTiming(r);
        setCapture(r.hidden);
        if (!info.error && r.frames) keepTake('synthesize', r, opts);
        end(info, 'synthesize');
    })));
    updateButtons();
}

function decodeStage() {
    if (!vae) { status.warn('load the VAE first'); return; }
    if (job) { status.warn('a job is running'); return; }
    const lat = latView.latents();
    if (!lat.length) { status.warn('no latents yet'); return; }
    resetAudio();
    begin('decode', ['decode']);
    const core = samplingOptions().decodeCoreFrames;
    const frames = lat.length / 64;
    let done = 0;
    job = vae.decode(lat, {
        coreFrames: core,
        onChunk: (c) => { appendAudio(c); done += c.frames; stageState('decode', 'run', done / vae.outputLength(frames), (done / 48000).toFixed(1) + ' s'); },
        onDone: (r, info) => {
            player.finish();
            stageState('decode', info.cancelled ? '' : 'done', 1);
            showTiming(null);
            if (cur.take && !info.cancelled) cur.take.audio = player.audio();
            end(info, 'decode');
        },
    });
    updateButtons();
}

function ready() {
    if (!yue || !vae) { status.warn('load the models first'); return false; }
    if (job) { status.warn('a job is running: Stop it first'); return false; }
    return true;
}

function updateButtons() {
    const busy = !!job, loaded = !!(yue && vae);
    for (const id of ['btn-generate', 'btn-plan', 'btn-semantic', 'btn-synth']) $('#' + id).disabled = busy || !loaded;
    $('#btn-decode').disabled = busy || !vae;
    $('#btn-stop').disabled = !busy;
}

$('#btn-generate').addEventListener('click', generate);
$('#btn-plan').addEventListener('click', planStage);
$('#btn-semantic').addEventListener('click', semanticStage);
$('#btn-synth').addEventListener('click', synthStage);
$('#btn-decode').addEventListener('click', decodeStage);
$('#btn-stop').addEventListener('click', () => { if (job) { job.cancel(); log.add('cancel requested'); } player.stop(); });
$('#btn-play').addEventListener('click', () => { const s = player.replay(); if (!s) status.warn('nothing to play'); });
$('#btn-halt').addEventListener('click', () => player.stop());
$('#btn-save-wav').addEventListener('click', () => {
    const a = player.audio();
    if (!a) { status.warn('nothing to save'); return; }
    let p = pickSaveFile('WAV audio|wav', 'yue2-take.wav');
    if (!p) return;
    if (!/\.wav$/i.test(p)) p += '.wav';
    audioContext().saveWav(p, interleave(a.samples.subarray(0, a.frames), a.samples.subarray(a.frames)), 2, a.sampleRate);
    log.add('saved ' + p, 'ok');
});
$('#btn-save-take').addEventListener('click', () => {
    if (!cur.take) { status.warn('no take yet'); return; }
    const d = pickFolder();
    if (d) { saveTake(d, cur.take); log.add('take saved to ' + d, 'ok'); }
});
$('#btn-load-take').addEventListener('click', () => {
    const d = pickFolder();
    if (!d) return;
    try { openTake(loadTake(d)); log.add('loaded take from ' + d + ' (press Decode for audio)', 'ok'); }
    catch (e) { status.error('load take: ' + e.message); }
});

function openTake(t) {
    cur.plan = t.plan; cur.abcModel = t.plan ? t.plan.abc : ''; cur.semantic = t.semantic || new Int32Array(0);
    cur.take = t;
    el.abc.value = t.abc || ''; abcMeta();
    semView.set(cur.semantic);
    latView.set(t.latents || new Float32Array(0), t.frames || 0);
    resetAudio();
    if (t.audio) {
        player.setAudio(t.audio);
        wave.l = t.audio.samples.slice(0, t.audio.frames); wave.r = t.audio.samples.slice(t.audio.frames);
        wave.n = t.audio.frames;
        waveL.set(wave.l, wave.n); waveR.set(wave.r, wave.n);
    }
}

function restoreSettings(t) {
    el.style.value = t.style || ''; el.lyrics.value = t.lyrics || '';
    el.style.dispatchEvent(new Event('input')); lyricsMeta();
    el.seed.value = String(t.seed);
    if (t.cot) cot.value = t.cot;
    $('#cfg-on').checked = t.cfgScale != null;
    if (t.cfgScale != null) { el.cfg.value = t.cfgScale; el.cfg.dispatchEvent(new Event('input')); }
    applySettings(t.settings);
    log.add('restored settings of take #' + t.id);
}

setTakeHandlers({
    select: openTake,
    play: (t) => { openTake(t); player.replay(); },
    restore: restoreSettings,
    save: (t) => { const d = pickFolder(); if (d) { saveTake(d, t); log.add('take #' + t.id + ' saved to ' + d, 'ok'); } },
});

// ── frame loop ───────────────────────────────────────────────────────────────
frameLoop(() => {
    player.tick();
    semView.draw();
    latView.draw();
    const ps = player.stats();
    const head = ps.playedSec >= 0 ? Math.round(ps.playedSec * 48000) : -1;
    waveL.cursor(head); waveR.cursor(head);
    waveL.draw(); waveR.draw();
    $('#sem-meta').textContent = semView.ids.length ? semView.ids.length + ' tokens · ' + (semView.ids.length / 25).toFixed(1) + ' s' : '';
    $('#lat-meta').textContent = latView.frames ? latView.frames + ' frames · ' + (latView.frames / 25).toFixed(1) + ' s' : '';
    $('#audio-meta').textContent = wave.n ? (wave.n / 48000).toFixed(1) + ' s · 48 kHz stereo' : '';
    streamStats.set({
        dur: ps.seconds.toFixed(1) + ' s', buf: ps.bufferedSec.toFixed(2) + ' s',
        under: ps.underrunSec.toFixed(2) + ' s', play: ps.playing ? 'yes' : 'no',
    });
});

// ── boot ─────────────────────────────────────────────────────────────────────
lyricsMeta();
abcMeta();
updateButtons();
if (!bro.music || bro.music.available === false) {
    status.error('bro.music is not in this build (BRO_WITH_SOUNDML)');
} else if (models.found) {
    // Autoload only in the windowed app; headless tests drive the Load button.
    if (!globalThis.advanceTime) models.load();
    else status.set('ready to load');
} else {
    status.warn(models.check());
}
