// audio/notes.js — the note table: MIDI numbers, names, frequencies.
//
// Everything in the app addresses notes by MIDI number (steps, the piano,
// MIDI input). The playable range is C1 (24) .. B7 (107).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const LOWEST = 24;    // C1
export const HIGHEST = 107;  // B7

/** MIDI note -> Hz (A4 = 69 = 440 Hz). */
export function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/** MIDI note -> "C#4". */
export function noteName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

/** True for the sharps (black keys). */
export function isBlack(m) { return [1, 3, 6, 8, 10].indexOf(((m % 12) + 12) % 12) >= 0; }

/** Hz -> { midi (nearest), name, cents (off that note) }. */
export function hzToNote(hz) {
    const exact = 12 * Math.log2(hz / 440) + 69;
    const midi = Math.round(exact);
    return { midi, name: noteName(midi), cents: Math.round((exact - midi) * 100) };
}
