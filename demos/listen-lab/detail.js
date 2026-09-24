// Listen Lab — click-to-inspect detail panel and region playback.
//
// Selecting a timeline marker (spot / arm / gesture / speech) opens a panel
// with what fired, where, the sensor context at that frame, the template it
// matched, what the phoneme model heard over the region, and buttons to replay
// or export the retained audio. Playback sweeps a playhead across the region.

import { h, clear } from "/lib/kit/dom.js";
import { D, FPS, status, exportWav, playPcm } from "/app/state.js";
import { cur, decodedOver, fmtFrame } from "/app/ring.js";

function sensorContextAt(frame) {
    const R = cur.ring, sl = R.nearest(frame);
    if (sl < 0) return '';
    const fl = R.flags[sl];
    return R.db[sl].toFixed(1) + ' dB · floor ' + R.floor[sl].toFixed(0) + ' dB' +
        (fl & 1 ? ' · voice' : ' · quiet') +
        (fl & 2 ? ' · tonal ' + Math.round(R.domHz[sl]) + ' Hz' : '') +
        (fl & 4 ? ' · onset' : '');
}

const chip = (text, gap) => h('span.dchip' + (gap ? '.gap' : ''), null, text);

const gapChip = (s, frameMs) =>
    chip('gap ' + Math.round(s.gapLo * frameMs) + '–' + Math.round(s.gapHi * frameMs) + ' ms', true);

/** The frame region an event covers: its exact span, else an estimate from its template. */
export function eventRegion(ev) {
    if (ev.span) return { a: ev.span.a, b: ev.span.b };
    const end = ev.frame;
    if (ev.type === 'gesture') {
        const v = bro.gesture.inspect(ev.name);
        if (v) {
            const ms = v.kind === 'tone' ? v.toneMs : v.intervalsMs.reduce((a, b) => a + b, 0);
            return { a: end - ms / 10, b: end };
        }
    }
    if ((ev.type === 'spot' || ev.type === 'arm') && cur.src.kws.isLoaded()) {
        const v = cur.src.kws.inspect(ev.name);
        const states = ev.type === 'arm' && ev.detail && ev.detail.matched > 0
            ? ev.detail.matched
            : (v ? v.states.length : 10);
        return { a: end - states * 6, b: end };
    }
    return { a: end - 60, b: end };
}

// ── playhead: sweep a marker across the region being auditioned ─────────────

function startPlayhead(a, b, durSec, key) {
    const P = cur.playback;
    P.active = true; P.a = a; P.b = b;
    P.startMs = Date.now(); P.durMs = Math.max(60, durSec * 1000);
    P.key = key || '';
}

/** 0..1 through the playing region, or -1 when nothing plays. */
export function playFrac() {
    const P = cur.playback;
    if (!P.active) return -1;
    return Math.min(1, (Date.now() - P.startMs) / P.durMs);
}

/** Retire a finished playhead; true when it just ended (the caller re-renders). */
export function updatePlayback() {
    const P = cur.playback;
    if (P.active && Date.now() - P.startMs >= P.durMs) {
        P.active = false;
        return true;
    }
    return false;
}

/** Play the retained audio of a frame region (with 250 ms of padding each side). */
export function playRegion(region, key) {
    const info = cur.src.listen.info();
    if (!info.active) { status('audio retention is off', true); return; }
    const pad = Math.round(0.25 * (info.frameRate || info.rate || 16000));
    const a = Math.round(region.a) - pad, b = Math.round(region.b) + pad;
    const pcm = cur.src.listen.audio(a, b);
    if (!pcm || !pcm.length) { status('audio for that region is no longer retained', true); return; }
    playPcm(pcm, info.rate);
    startPlayhead(a, b, pcm.length / info.rate, key);
    status('playing ' + (pcm.length / info.rate).toFixed(2) + ' s clip');
}

export function playSamples(pcm, rate) {
    if (!pcm || !pcm.length) { status('nothing to play', true); return; }
    playPcm(pcm, rate || 16000);
    status('playing ' + (pcm.length / (rate || 16000)).toFixed(2) + ' s clip');
}

// ── the panel ───────────────────────────────────────────────────────────────

export function selectEvent(ev) {
    const V = cur.view, src = cur.src;
    V.selId = ev.id;
    V.selRegion = eventRegion(ev);
    const panel = D.detail;
    panel.classList.remove('hidden');
    clear(panel);

    panel.appendChild(h('div.dhdr', null,
        h('span.dkind.' + ev.type, null, ev.type),
        h('span.dname', null, ev.name + (ev.kind ? ' (' + ev.kind + ')' : '')),
        ev.conf != null ? h('span.dconf', null, 'conf ' + ev.conf.toFixed(3)) : null,
        h('button.dclose', { onclick: closeDetail }, '×')));

    panel.appendChild(h('div.drow', null, 'at ', h('b', null, fmtFrame(ev.frame)), ' · ' + sensorContextAt(ev.frame)));

    const region = V.selRegion;
    if (region) {
        const row = h('div.drow', null,
            'matched span: ', h('b', null, ((region.b - region.a) / FPS).toFixed(2) + ' s'),
            ' · frames ' + Math.round(region.a) + '–' + Math.round(region.b) + ' ',
            ev.span ? null : h('span.dim', null, '(estimated) '));
        if (src.listen.info().active) {
            row.appendChild(h('button.dplay', {
                title: 'replay the retained audio for this region', onclick: () => playRegion(region),
            }, '▶ play'));
            row.appendChild(h('button.dplay', {
                title: 'save this region to a .wav file',
                onclick: () => exportWav(src.listen.audio(Math.round(region.a), Math.round(region.b)),
                                         src.listen.info().rate, 'listen-' + ev.type + '.wav'),
            }, '💾 wav'));
        }
        panel.appendChild(row);
    }

    if (ev.type === 'gesture') {
        const v = bro.gesture.inspect(ev.name);
        panel.appendChild(h('div.drow', null, !v ? '(template removed)'
            : v.kind === 'tone'
                ? ['tone template · ', h('b', null, Math.round(v.toneHz) + ' Hz'), ' · ' + Math.round(v.toneMs) + ' ms']
                : ['rhythm template · ', h('b', null, (v.intervalsMs.length + 1) + ' taps'),
                   ' · ' + v.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms']));
    } else if ((ev.type === 'spot' || ev.type === 'arm') && src.kws.isLoaded()) {
        const v = src.kws.inspect(ev.name);
        if (v) {
            panel.appendChild(h('div.drow', null, 'decoded as ', h('b', null, String(v.states.length)),
                ' ' + (v.hasGaps ? 'rhythm states' : 'phonemes') + ':'));
            panel.appendChild(h('div.dchips', null,
                v.states.map((s) => s.gap ? gapChip(s, v.frameMs) : chip(s.label, false))));
        }
    }

    if (region) {
        const heard = decodedOver(region.a, region.b);
        panel.appendChild(heard.length
            ? h('div.drow', null, 'model heard here: ',
                h('span.dchips.inline', null, heard.map((l) => chip(l, false))),
                ev.type === 'gesture'
                    ? h('div.drow', null, '⚠ phonemes present — this non-speech match overlaps speech')
                    : null)
            : h('div.drow', null, 'model heard here: ', h('b', null, 'no phonemes'), ' (non-speech)'));
    }
}

export function closeDetail() {
    cur.view.selId = -1;
    cur.view.selRegion = null;
    D.detail.classList.add('hidden');
}
