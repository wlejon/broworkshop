// Voice Pipeline: mic -> Whisper -> Qwen3-8B -> Kokoro / Qwen3-TTS -> speaker.
//
//   setup.js       pick a voice + wake word, download what is missing, Start
//   engines.js     load the models behind the pipeline's interface
//   pipeline.js    one turn: STT -> streaming LM -> per-sentence TTS queue
//   speech.js      text cleanup, sentence split, word timing, the TTS voices
//   capture.js     bro.mic tap, "computer" wake word, end-of-utterance detection
//   playback.js    scheduled reply audio, word highlight, earcons
//   transcript.js  the You / Bro rows (lib/kit/chat.css)
//
// Say "computer" (wake word) or hold the button / Space to talk. Speaking or
// pressing again mid-reply interrupts it; "stop" / "never mind" ends a turn.
// `voice` below is the app's surface for tests and the console.

import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { resolved } from "/app/models.js";
import { setupScreen } from "/app/setup.js";
import { voiceTranscript } from "/app/transcript.js";
import { createPlayer } from "/app/playback.js";
import { createCapture, WAKE_THRESHOLD } from "/app/capture.js";
import { createPipeline } from "/app/pipeline.js";
import { loadEngines } from "/app/engines.js";

boot();
const statusEl = $('#status'), meter = $('#meter'), talk = $('#talk'), convo = $('#convo');

let phaseKind = 'idle';
function phase(kind, text) {
    phaseKind = kind === 'error' ? 'err' : kind;
    statusEl.className = phaseKind;
    statusEl.textContent = text;
    meter.classList.toggle('thinking', kind === 'transcribing');
    if (kind !== 'transcribing' && kind !== 'loading') setMeter(0);
}
function setMeter(frac, opacity) {
    meter.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    meter.style.opacity = opacity == null ? '1' : String(opacity);
}

const transcript = voiceTranscript($('#transcript'));
const player = createPlayer({ transcript: transcript.el, onDrained: () => pipeline && pipeline.drained() });
let pipeline = null, config = null, speechOn = false;

const TALK_IDLE = () => (capture.wakeActive ? 'say “computer” or hold to talk' : 'hold to talk (Space)');
function resetTalk() { talk.classList.remove('recording'); talk.textContent = TALK_IDLE(); }

function goIdle() {
    if (capture.recording) return;          // a press already started the next capture
    if (phaseKind !== 'err') {
        const suffix = speechOn ? '' : ' (text-only)';
        phase('idle', (capture.wakeActive ? 'listening for “computer”…' : 'idle') + suffix);
    }
    setMeter(0);
    capture.resumeWake();
}

const capture = createCapture({
    onStart: (fromWake) => {
        phase('listening', fromWake ? 'recording…' : 'listening…');
        talk.classList.add('recording');
        talk.textContent = fromWake ? 'recording (wake)…' : 'release to send';
    },
    onUtterance: (samples) => { resetTalk(); pipeline.run(samples); },
    onAbort: (reason) => { resetTalk(); phase('idle', reason); setTimeout(goIdle, 50); },
    onLevel: (v) => setMeter(v),
});

// The idle meter shows the wake detector's score.
setInterval(() => {
    if (!pipeline || capture.recording || player.busy || pipeline.busy || !capture.wakeActive) return;
    const s = capture.wakeScore();
    setMeter(s, (0.25 + 0.75 * Math.min(1, s / WAKE_THRESHOLD)).toFixed(2));
}, 100);

function listen(fromWake) {
    if (!pipeline || capture.recording) return;
    if (pipeline.busy) pipeline.interrupt();
    if (fromWake) player.cue('wake');
    try { capture.start(fromWake); }
    catch (e) { phase('error', 'mic: ' + e.message); }
}
const talkDown = () => { if (!talk.disabled) listen(false); };
const talkUp = () => { if (capture.recording && !capture.fromWake) capture.stop(); };

talk.addEventListener('mousedown', talkDown);
talk.addEventListener('mouseup', talkUp);
talk.addEventListener('mouseleave', talkUp);
window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat && pipeline && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { e.preventDefault(); talkDown(); }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ' && pipeline) { e.preventDefault(); talkUp(); } });

/** Engines are loaded (or injected by a test): open the conversation. */
function attach(engines, cfg) {
    speechOn = !!engines.voice;
    setup.el.hidden = true;
    convo.hidden = false;
    pipeline = createPipeline({ engines, player, view: transcript, phase, onIdle: goIdle });
    if (cfg.wake) {
        try { capture.startWake(resolved().wake, () => { if (!talk.disabled) listen(true); }); }
        catch (e) { console.warn('wake init failed: ' + e.message); }
    }
    talk.disabled = false;
    talk.title = 'Say "computer" to activate, or hold (Space) to talk manually.';
    resetTalk();
    setTimeout(goIdle, 0);
}

function start(cfg) {
    config = cfg;
    convo.hidden = false;
    phase('loading', 'loading models…');
    setMeter(0, 0.6);
    loadEngines(cfg, resolved(), {
        onProgress: (done, total) => setMeter(done / total, 0.6),
        onReady: (engines) => attach(engines, cfg),
        onError: (stage, msg) => phase('error', stage + ': ' + msg),
    });
}

const setup = setupScreen('#setup', { onStart: start });

/** The app's surface for tests and the console. */
export const voice = {
    setup, transcript, player, capture, start, attach, talkDown, talkUp, listen,
    get pipeline() { return pipeline; },
    get config() { return config; },
    get phase() { return phaseKind; },
    get statusText() { return statusEl.textContent; },
};

setup.show();
phase('idle', 'choose a voice');
