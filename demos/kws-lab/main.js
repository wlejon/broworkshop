// KWS Lab — a worked consumer of bro.kws (open-vocabulary keyword spotting).
//
// Type any phrase → bro.tts.phonemize turns it into Kokoro phoneme ids →
// bro.kws.enroll registers it as a streaming Viterbi template. Listen puts the
// PhonemeSpotter on the live mic (resampled tap → lock-free ring → inference
// worker) and every completed alignment fires onSpot(name, confidence) here on
// the main thread. The prefix bar polls bro.kws.prefixProgress() — the
// lock-free "how much of some template has matched so far" meter.
//
// bro.kws's mutators (enroll/remove/clear) share the spotter's feed thread, so
// they are rejected while listening; this app stops, mutates, and re-listens
// so the UI stays free-form.
//
// Headless note: with no audio device the live mic can't capture;
// tests/test_main.js drives the same spotter via bro.kws.feed() with
// Kokoro-synthesized speech.

import { boot } from "/lib/kit/app.js";
import { h, ids } from "/lib/kit/dom.js";
import { logView, progressBar } from "/lib/kit/ui.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";

const PHONEME_NET = ['brosoundml/weights/phoneme/english.bpm', 'brosoundml/build-cuda/english.bpm'];

const { status } = boot();
const el = ids('phrase', 'enroll', 'threshold', 'listen', 'templates', 'noTemplates',
               'progressPct', 'spotCount');
const log = logView('#log', { newestFirst: true });
const progress = progressBar('#progress');

let listening = false;
let spots = 0;
const chips = {};   // name -> chip element

function logSpot(name, confidence) {
    spots++;
    el.spotCount.textContent = String(spots);
    log.add(h('span', null, h('span.name', null, name),
                            h('span.conf', null, 'confidence ' + confidence.toFixed(3))));
    flashChip(name);
}

function flashChip(name) {
    const chip = chips[name];
    if (!chip) return;
    chip.classList.add('fired');
    setTimeout(() => chip.classList.remove('fired'), 600);
}

function renderTemplates() {
    Object.keys(chips).forEach((k) => { chips[k].remove(); delete chips[k]; });
    const names = bro.kws.templates();
    el.noTemplates.hidden = names.length > 0;
    for (const name of names) {
        const chip = h('span.k-chip', null,
            h('span', null, name),
            h('button', { onclick: () => withMutableSpotter(() => bro.kws.remove(name)) }, '×'));
        el.templates.appendChild(chip);
        chips[name] = chip;
    }
    el.listen.disabled = names.length === 0;
}

// Run a template mutation, bouncing the live session around it (mutators share
// the spotter's feed thread, so they're rejected while listening).
function withMutableSpotter(fn) {
    const wasListening = listening;
    if (wasListening) stopListening();
    try { fn(); }
    catch (e) { status.error(e); }
    renderTemplates();
    if (wasListening && bro.kws.templates().length) startListening();
}

function enrollPhrase() {
    const text = el.phrase.value.trim();
    if (!text) return;
    withMutableSpotter(() => {
        const phonemes = bro.tts.phonemize(text);
        const len = bro.kws.enroll(text, phonemes, { threshold: +el.threshold.value });
        status.set('enrolled "' + text + '" (' + len + ' phoneme classes)');
        el.phrase.value = '';
    });
}

function startListening() {
    bro.kws.listen({ onSpot: logSpot });
    listening = true;
    el.listen.textContent = 'Stop';
    el.listen.classList.add('active');
    status.set('listening — say an enrolled phrase');
}

function stopListening() {
    bro.kws.stop();
    listening = false;
    el.listen.textContent = 'Listen';
    el.listen.classList.remove('active');
    status.set('stopped');
}

el.enroll.addEventListener('click', enrollPhrase);
el.phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
el.listen.addEventListener('click', () => (listening ? stopListening() : startListening()));

// Prefix-progress meter — a lock-free read, safe while the inference thread
// feeds, so polling it per frame is free.
function tick() {
    const p = listening ? bro.kws.prefixProgress() : 0;
    progress.set(p);
    el.progressPct.textContent = 'prefix ' + (p * 100).toFixed(0) + '%';
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── boot ─────────────────────────────────────────────────────────────────────
(function start() {
    const weights = findWeights(PHONEME_NET);
    if (!weights) { status.error(missingWeights('PhonemeNet checkpoint', PHONEME_NET)); return; }
    try {
        bro.kws.load({ weights, threshold: +el.threshold.value });
        status.set('spotter loaded (' + bro.kws.sampleRate() + ' Hz) — enroll a phrase');
    } catch (e) {
        status.error('load failed: ' + (e.message || e));
        return;
    }
    // Point the phonemizer at the brosoundml sibling so phonemize() resolves
    // its g2p assets wherever the weights live.
    const sib = findWeights(['brosoundml'], { probe: 'weights/kokoro/config.json' });
    if (sib) bro.tts.setAssetRoot(sib);
    // Seed one template so Listen works out of the box.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'),
                       { threshold: +el.threshold.value });
    });
})();
