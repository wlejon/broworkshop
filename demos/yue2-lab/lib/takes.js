// Takes: every finished run, with what made it. A take folder on disk holds
// take.json (conditioning, settings, score, plan, timing), semantic.i32,
// latents.f32, energy.f32 (when the energy knob moved), lyrics.txt and
// take.wav (a radio song's take points at its saved WAV instead), so a take
// can be reloaded and re-decoded or re-synthesized.

import { $, h, clear } from "/lib/kit/dom.js";
import { audioContext } from "/lib/kit/audio.js";
import { interleave } from "./player.js";

const takes = [];
let current = -1;
let handlers = {};

export function setTakeHandlers(hs) { handlers = hs; }
export function allTakes() { return takes; }
export function currentTake() { return current >= 0 ? takes[current] : null; }

export function addTake(t) {
    t.id = takes.length + 1;
    t.when = new Date();
    takes.push(t);
    current = takes.length - 1;
    render();
    return t;
}

export function selectTake(i) { current = i; render(); }

function fmtSec(s) { return s ? s.toFixed(1) + ' s' : '—'; }

function render() {
    const host = clear($('#takes'));
    if (!takes.length) { host.appendChild(h('span.dim', null, 'no takes yet')); return; }
    for (let i = takes.length - 1; i >= 0; i--) {
        const t = takes[i];
        const dur = t.audio ? t.audio.frames / t.audio.sampleRate : (t.frames ? t.frames / 25 : 0);
        host.appendChild(h('div.take' + (i === current ? '.current' : ''), null,
            h('div.k-row', null, h('b', null, '#' + t.id + ' ' + (t.kind || 'take')),
              h('span.dim', null, t.when.toLocaleTimeString() + ' · seed ' + t.seed + ' · ' + fmtSec(dur))),
            h('div.dim', null, (t.style || '').slice(0, 90)),
            t.steer && t.steer.length ? h('div.dim', null, 'steer: ' + t.steer.join(', ')) : null,
            h('div.k-row', null,
              h('button.small', { title: 'make this the current take (score, tokens, latents, audio)',
                                  onclick: () => { current = i; render(); if (handlers.select) handlers.select(t); } }, 'open'),
              h('button.small', { title: 'play this take', onclick: () => handlers.play && handlers.play(t) }, '▶'),
              h('button.small', { title: 'restore its style, lyrics, seed and settings into the panels',
                                  onclick: () => handlers.restore && handlers.restore(t) }, 'restore settings'),
              h('button.small', { title: 'save this take to a folder', onclick: () => handlers.save && handlers.save(t) }, 'save'))));
    }
}

/** Write a take folder. */
export function saveTake(dir, t) {
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
        kind: t.kind, seed: t.seed, style: t.style, lyrics: t.lyrics, cot: t.cot, cfgScale: t.cfgScale,
        settings: t.settings, steer: t.steer, timing: t.timing, abc: t.abc, frames: t.frames,
        plan: t.plan ? { abc: t.plan.abc, abcIds: Array.from(t.plan.abcIds || []), prefix: Array.from(t.plan.prefix || []),
                          truncated: !!t.plan.truncated } : null,
        when: t.when.toISOString(),
        title: t.title, tags: t.tags, wav: t.wav,   // a radio song: its name and the WAV saved beside the take
    };
    fs.writeFileSync(dir + '/take.json', JSON.stringify(meta, null, 2));
    const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    if (t.semantic && t.semantic.length) fs.writeFileSync(dir + '/semantic.i32', bytes(t.semantic));
    if (t.latents && t.latents.length) fs.writeFileSync(dir + '/latents.f32', bytes(t.latents));
    // The energy knob's per-frame offset, when it was ever moved (decode adds it).
    if (t.energy && t.energy.some((v) => v !== 0)) fs.writeFileSync(dir + '/energy.f32', bytes(t.energy));
    if (t.lyrics) fs.writeFileSync(dir + '/lyrics.txt', (t.title ? t.title + '\n' + (t.tags || '') + '\n\n' : '') + t.lyrics.trim() + '\n');
    if (t.audio && t.audio.frames) {
        const a = t.audio;
        audioContext().saveWav(dir + '/take.wav', interleave(a.samples.subarray(0, a.frames), a.samples.subarray(a.frames)),
                               2, a.sampleRate);
    }
    if (t.abc) fs.writeFileSync(dir + '/score.abc', t.abc);
    return dir;
}

/** Read a take folder back (audio is re-decoded from latents by the caller). */
export function loadTake(dir) {
    const fs = require('node:fs');
    const meta = JSON.parse(fs.readFileSync(dir + '/take.json', 'utf8'));
    const read = (name, T) => {
        try {
            const b = fs.readFileSync(dir + '/' + name);
            return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
        } catch (e) { return new T(0); }
    };
    const t = Object.assign({}, meta);
    t.kind = 'loaded';
    t.semantic = read('semantic.i32', Int32Array);
    t.latents = read('latents.f32', Float32Array);
    t.energy = read('energy.f32', Float32Array);
    t.frames = Math.floor(t.latents.length / 64);
    if (meta.plan) t.plan = { abc: meta.plan.abc, abcIds: Int32Array.from(meta.plan.abcIds),
                              prefix: Int32Array.from(meta.plan.prefix), truncated: meta.plan.truncated };
    t.audio = null;
    return t;
}
