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
// Headless note: with no audio device the live mic can't capture; test.js
// drives the same spotter via bro.kws.feed() with Kokoro-synthesized speech.

import { installSystemMenu } from "/lib/system-menu.js";

const fs = require('fs');

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const WEIGHT_CANDIDATES = [
    '../../../brosoundml/weights/phoneme/english.bpm',
    '../../../brosoundml/build-cuda/english.bpm',
    WROOT + '/brosoundml/weights/phoneme/english.bpm',
    WROOT + '/brosoundml/build-cuda/english.bpm',
];

const $phrase    = document.querySelector('#phrase');
const $enroll    = document.querySelector('#enroll');
const $threshold = document.querySelector('#threshold');
const $listen    = document.querySelector('#listen');
const $templates = document.querySelector('#templates');
const $none      = document.querySelector('#noTemplates');
const $fill      = document.querySelector('#progressFill');
const $pct       = document.querySelector('#progressPct');
const $log       = document.querySelector('#log');
const $status    = document.querySelector('#status');
const $spotCount = document.querySelector('#spotCount');

let listening = false;
let spots = 0;
const chips = {};   // name -> chip element

function status(text, isErr) {
    $status.textContent = text;
    $status.className = isErr ? 'err' : '';
}

function logSpot(name, confidence) {
    spots++;
    $spotCount.textContent = String(spots);
    const row = document.createElement('div');
    row.className = 'row';
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    row.innerHTML = '<span class="t">' + hh + ':' + mm + ':' + ss + '</span>' +
        '<span class="name"></span><span class="conf"></span>';
    row.querySelector('.name').textContent = name;
    row.querySelector('.conf').textContent = 'confidence ' + confidence.toFixed(3);
    $log.insertBefore(row, $log.firstChild);
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
    $none.style.display = names.length ? 'none' : '';
    for (const name of names) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const label = document.createElement('span');
        label.textContent = name;
        const rm = document.createElement('button');
        rm.textContent = '×';
        rm.addEventListener('click', () => withMutableSpotter(() => {
            bro.kws.remove(name);
        }));
        chip.appendChild(label);
        chip.appendChild(rm);
        $templates.appendChild(chip);
        chips[name] = chip;
    }
    $listen.disabled = names.length === 0;
}

// Run a template mutation, bouncing the live session around it (mutators share
// the spotter's feed thread, so they're rejected while listening).
function withMutableSpotter(fn) {
    const wasListening = listening;
    if (wasListening) stopListening();
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    renderTemplates();
    if (wasListening && bro.kws.templates().length) startListening();
}

function enrollPhrase() {
    const text = $phrase.value.trim();
    if (!text) return;
    withMutableSpotter(() => {
        const ids = bro.tts.phonemize(text);
        const len = bro.kws.enroll(text, ids, { threshold: +$threshold.value });
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        $phrase.value = '';
    });
}

function startListening() {
    bro.kws.listen({ onSpot: logSpot });
    listening = true;
    $listen.textContent = 'Stop';
    $listen.classList.add('active');
    status('listening — say an enrolled phrase');
}

function stopListening() {
    bro.kws.stop();
    listening = false;
    $listen.textContent = 'Listen';
    $listen.classList.remove('active');
    status('stopped');
}

$enroll.addEventListener('click', enrollPhrase);
$phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
$listen.addEventListener('click', () => (listening ? stopListening() : startListening()));

// Prefix-progress meter — a lock-free read, safe while the inference thread
// feeds, so polling it per frame is free.
function tick() {
    const p = listening ? bro.kws.prefixProgress() : 0;
    $fill.style.width = (p * 100).toFixed(0) + '%';
    $pct.textContent = 'prefix ' + (p * 100).toFixed(0) + '%';
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

installSystemMenu();

// ── boot ─────────────────────────────────────────────────────────────────────
(function boot() {
    // require('fs') resolves relative paths against the app dir, but the C++
    // loader resolves against the process CWD — hand it an absolute path.
    let weights = null;
    for (const p of WEIGHT_CANDIDATES) {
        try { if (fs.existsSync(p)) { weights = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!weights) {
        status('no PhonemeNet checkpoint found (' + WEIGHT_CANDIDATES.join(', ') + ')', true);
        return;
    }
    try {
        bro.kws.load({ weights, threshold: +$threshold.value });
        status('spotter loaded (' + bro.kws.sampleRate() + ' Hz) — enroll a phrase');
    } catch (e) {
        status('load failed: ' + (e.message || e), true);
        return;
    }
    // Point the phonemizer at the brosoundml sibling (portable: BRO_WEIGHTS
    // overrides the default ../brosoundml search) so phonemize() resolves its
    // g2p assets regardless of where the weights live.
    try {
        const sib = WROOT + '/brosoundml';
        if (fs.existsSync(sib + '/weights/kokoro/config.json')) bro.tts.setAssetRoot(sib);
    } catch (e) { /* fall back to the default sibling search */ }
    // Seed one template so Listen works out of the box.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'),
                       { threshold: +$threshold.value });
    });
})();
