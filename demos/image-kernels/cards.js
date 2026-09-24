// cards.js — one card per pipeline stage in the side column. A card's header
// carries the stage name, the bro.image verb, its last-frame time and an
// on/off toggle; an OFF card collapses to its header. Controls write straight
// into the stage's cfg.

import { h, clear } from "/lib/kit/dom.js";
import { STENCIL_KERNELS, kernelLabel, kernelMatrixText } from "/app/kernels.js";
import { MAP_OPS, COMBINE_OPS, COMBINE_SOURCES, EDGES, FACTORS, FILTERS } from "/app/pipeline.js";

const fmt2 = (v) => (+v).toFixed(2);

function select(key, options, value, labelOf) {
    return h('select', { dataset: { k: key } }, options.map((o) =>
        h('option', { value: String(o), selected: String(o) === String(value) }, labelOf ? labelOf(o) : String(o))));
}

function slider(key, min, max, step, value, cls) {
    return h('label.k-field' + (cls ? '.' + cls : ''), null,
        h('span', null, key),
        h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), dataset: { k: key } }),
        h('span.k-val', { dataset: { v: key } }, fmt2(value)));
}

const field = (label, control) => h('label.k-field', null, h('span', null, label), control);

function body(s) {
    const c = s.cfg;
    switch (s.id) {
        case 'map': return [
            field('op', select('op', MAP_OPS, c.op)),
            slider('a', -4, 4, 0.1, c.a, 'p-affine'),
            slider('b', -1, 1, 0.05, c.b, 'p-affine'),
            slider('exp', 0.2, 4, 0.1, c.exp, 'p-pow'),
        ];
        case 'combine': return [
            field('op', select('op', COMBINE_OPS, c.op)),
            field('2nd src', select('src2', COMBINE_SOURCES, c.src2)),
            slider('t', 0, 1, 0.02, c.t, 'p-lerp'),
            slider('wa', 0, 2, 0.05, c.wa, 'p-wsum'),
            slider('wb', 0, 2, 0.05, c.wb, 'p-wsum'),
        ];
        case 'stencil': return [
            field('kernel', select('kernel', STENCIL_KERNELS, c.kernel, kernelLabel)),
            field('edge', select('edge', EDGES, c.edge)),
            h('pre.kmat', { dataset: { kmat: '' } }),
        ];
        case 'resample': return [
            field('factor', select('factor', FACTORS, c.factor, (f) => '1/' + f)),
            field('filter', select('filter', FILTERS, c.filter)),
        ];
        default: return [h('pre.kmat', null, "build an eq LUT from reduce('histogram')'s CDF,\nthen lookup() through it")];
    }
}

// Show only the rows relevant to the chosen op; refresh the kernel matrix.
function refresh(card, s) {
    const show = (cls, on) => { for (const n of card.querySelectorAll('.' + cls)) n.hidden = !on; };
    if (s.id === 'map') { show('p-affine', s.cfg.op === 'affine'); show('p-pow', s.cfg.op === 'pow'); }
    if (s.id === 'combine') { show('p-lerp', s.cfg.op === 'lerp'); show('p-wsum', s.cfg.op === 'wsum'); }
    if (s.id === 'stencil') card.querySelector('[data-kmat]').textContent = kernelMatrixText(s.cfg.kernel);
}

/** Set a stage on/off and repaint its card. */
export function setStageOn(card, s, on) {
    s.on = !!on;
    card.classList.toggle('off', !s.on);
    const btn = card.querySelector('[data-toggle]');
    btn.textContent = s.on ? 'on' : 'off';
    btn.classList.toggle('active', s.on);
}

/** Build every card into `host`. Returns { id: cardElement }. */
export function buildCards(host, stages) {
    clear(host);
    const cards = {};
    for (const s of stages) {
        const toggle = h('button.small', { dataset: { toggle: '' } });
        const card = h('div.k-panel.stage', { dataset: { id: s.id } },
            h('div.head', null,
                h('span.name', null, s.name), h('span.verb', null, s.verb),
                h('span.k-spacer'), h('span.ms', { dataset: { ms: '' } }, '—'), toggle),
            h('div.body', null, body(s)));
        toggle.addEventListener('click', () => setStageOn(card, s, !s.on));
        for (const input of card.querySelectorAll('[data-k]')) {
            const k = input.dataset.k;
            const onInput = () => {
                const v = input.type === 'range' || k === 'factor' ? +input.value : input.value;
                s.cfg[k] = v;
                const out = card.querySelector('[data-v="' + k + '"]');
                if (out) out.textContent = fmt2(v);
                refresh(card, s);
            };
            input.addEventListener('input', onInput);
            input.addEventListener('change', onInput);
        }
        host.appendChild(card);
        setStageOn(card, s, s.on);
        refresh(card, s);
        cards[s.id] = card;
    }
    return cards;
}

/** Per-frame: each card's last-frame time. */
export function paintTimes(cards, stages) {
    for (const s of stages) {
        const el = cards[s.id].querySelector('[data-ms]');
        const text = s.on ? s.ms.toFixed(2) + ' ms' : '—';
        if (el.textContent !== text) el.textContent = text;
    }
}
