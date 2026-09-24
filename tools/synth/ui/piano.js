// ui/piano.js — the on-screen piano and the computer keyboard.
//
// 17 keys (C .. E an octave up) are visible at a time; Tab / Shift+Tab move
// the window an octave. The home row plays white keys (A S D F G H J K L ;),
// the row above plays sharps (W E T Y U O P). Keys light while their note
// sounds, whatever played it (mouse, keys, MIDI).

import { h, clear } from "/lib/kit/dom.js";
import { LOWEST, HIGHEST, isBlack, noteName } from "../audio/notes.js";

const KEY_MAP = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
    k: 12, o: 13, l: 14, p: 15, ';': 16,
};
const KEY_OF = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));
const VIEW = 17;

function isField(t) {
    const tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/**
 * opts: { player, octaveLabel, handleKey(e) -> true when another handler
 * (the clip editor) consumed the key }.
 * Handle: base (lowest visible MIDI note), shift(semitones), keyFor(midi).
 */
export function piano(host, opts) {
    const { player } = opts;
    const keys = new Map();          // midi -> element
    const down = new Map();          // computer key -> midi it started
    let base = 48;                   // C3
    let mouseNote = -1;

    function build() {
        clear(host);
        keys.clear();
        const notes = [];
        for (let m = base; m < base + VIEW; m++) notes.push(m);
        const whites = notes.filter((m) => !isBlack(m));
        const w = 100 / whites.length;
        for (const m of notes) {
            const rel = m - base;
            const label = KEY_OF[rel] ? KEY_OF[rel].toUpperCase() : '';
            let el;
            if (isBlack(m)) {
                const left = whites.filter((x) => x < m).length * w - w * 0.3;
                el = h('div.key.black', { dataset: { midi: m }, style: { left: left + '%', width: w * 0.6 + '%' } },
                    h('span.bind', null, label));
            } else {
                el = h('div.key.white', { dataset: { midi: m } },
                    h('span.name', null, noteName(m)), h('span.bind', null, label));
            }
            if (player.isHeld(m)) el.classList.add('pressed');
            keys.set(m, el);
            host.appendChild(el);
        }
        if (opts.octaveLabel) opts.octaveLabel.textContent = noteName(base);
    }

    function shift(semis) {
        for (const m of down.values()) player.noteOff(m);
        down.clear();
        const next = Math.max(LOWEST, Math.min(HIGHEST + 1 - VIEW, base + semis));
        if (next !== base) { base = next; build(); }
    }

    // mouse: press a key, drag across keys, release anywhere
    const midiAt = (t) => {
        while (t && t !== host) {
            if (t.dataset && t.dataset.midi) return +t.dataset.midi;
            t = t.parentNode;
        }
        return -1;
    };
    host.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const m = midiAt(e.target);
        if (m < 0) return;
        mouseNote = m;
        player.noteOn(m);
        e.preventDefault();
    });
    host.addEventListener('mousemove', (e) => {
        if (mouseNote < 0) return;
        const m = midiAt(e.target);
        if (m >= 0 && m !== mouseNote) { player.noteOff(mouseNote); mouseNote = m; player.noteOn(m); }
    });
    document.addEventListener('mouseup', () => {
        if (mouseNote >= 0) { player.noteOff(mouseNote); mouseNote = -1; }
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            shift(e.shiftKey ? -12 : 12);
            return;
        }
        if (e.repeat) return;
        if (opts.handleKey && opts.handleKey(e)) { e.preventDefault(); return; }
        const k = (e.key || '').toLowerCase();
        if (k in KEY_MAP && !down.has(k)) {
            const m = base + KEY_MAP[k];
            down.set(k, m);
            player.noteOn(m);
        }
    });
    document.addEventListener('keyup', (e) => {
        const k = (e.key || '').toLowerCase();
        if (down.has(k)) { player.noteOff(down.get(k)); down.delete(k); }
    });

    player.on(({ midi, on }) => {
        const el = keys.get(midi);
        if (el) el.classList.toggle('pressed', on);
    });

    build();
    return {
        get base() { return base; },
        shift,
        keyFor(midi) { return keys.get(midi) || null; },
    };
}
