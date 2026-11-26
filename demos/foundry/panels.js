// The read-only side of the designer: the headline numbers, the mass
// breakdown, what each regime asks of each line, what is wrong, and what the
// machine loses with each part shot away. All of it is the report, laid out.

import { h, clear } from "/lib/kit/dom.js";
import { REGIMES, REGIME_KEYS, LINES, LINE_KINDS, fmt } from "/lib/mech/catalog.js";

export const tonnes = (kg) => (kg >= 1e6 ? (kg / 1e6).toFixed(2) + ' kt' : (kg / 1e3).toFixed(kg >= 1e5 ? 0 : 1) + ' t');
const secs = (s) => (s === Infinity ? '∞' : s >= 120 ? (s / 60).toFixed(1) + ' min' : s.toFixed(0) + ' s');
const kmh = (v) => (v * 3.6).toFixed(0) + ' km/h';

// --- small form pieces, shared with the inspector ------------------------------------

export function field(label, control, title) {
    return h('label.k-field', title ? { title } : null, h('span', null, label), control);
}

/** A range with its value beside it. onInput(value) while dragging. */
export function slider(value, o, onInput) {
    const out = h('span.k-val', null, '');
    const show = (v) => { out.textContent = o.fmt ? o.fmt(v) : (+v).toFixed(o.digits ?? (o.step < 1 ? (o.step < 0.1 ? 2 : 1) : 0)) + (o.unit || ''); };
    const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 1, value });
    input.addEventListener('input', () => { show(+input.value); onInput(+input.value); });
    show(value);
    const wrap = h('span.f-slider', null, input, out);
    wrap.set = (v) => { input.value = v; show(v); };
    return wrap;
}

export function number(value, o, onInput) {
    const input = h('input.f-num', { type: 'number', min: o.min, max: o.max, step: o.step ?? 1, value: +(+value).toFixed(o.digits ?? 2) });
    input.addEventListener('change', () => {
        let v = +input.value;
        if (!isFinite(v)) return;
        if (o.min != null) v = Math.max(o.min, v);
        if (o.max != null) v = Math.min(o.max, v);
        input.value = v;
        onInput(v);
    });
    return input;
}

export function select(value, options, onChange) {
    const el = h('select', null, Object.entries(options).map(([v, label]) => h('option', { value: v }, label)));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
}

export function button(label, onClick, cls, title) {
    return h('button' + (cls ? '.' + cls : ''), { onclick: onClick, title: title || '' }, label);
}

/** A bar: `value` of `max`, coloured by `tone` ('ok' | 'warn' | 'err'). */
export function bar(frac, tone, text) {
    return h('div.f-bar' + (tone ? '.' + tone : ''), null, h('div', { style: { width: Math.max(0, Math.min(1, frac)) * 100 + '%' } }), h('span', null, text || ''));
}

// --- panels ---------------------------------------------------------------------------

export function renderHeadline(el, r) {
    const cb = r.regimes.combat;
    const tone = (ok, warn) => (ok ? '' : warn ? 'warn' : 'err');
    const item = (label, value, cls) => h('span' + (cls ? '.' + cls : ''), null, label + ' ', h('b', null, value));
    clear(el);
    el.append(
        item('mass', tonnes(r.mass.total)),
        item('height', r.height.toFixed(1) + ' m'),
        item('run', r.move.stands ? kmh(r.move.sprint) : 'cannot stand', tone(r.move.stands)),
        item('thrust/weight', r.flight.tw.toFixed(2), tone(r.flight.hover.ok, r.flight.tw >= 1)),
        item('power', (cb.power.supply > 0 ? Math.round(100 * cb.power.demand / cb.power.supply) : 0) + '%', tone(cb.power.sat >= 0.995, cb.power.sat > 0.8)),
        item('heat', (cb.coolant.supply > 0 ? Math.round(100 * cb.coolant.demand / cb.coolant.supply) : 0) + '%', tone(cb.coolant.sat >= 0.995, cb.coolant.sat > 0.8)),
        item('fire', fmt.mw(r.dps)),
    );
}

export function renderSummary(el, r) {
    clear(el);
    const parts = [['frame', r.mass.frame], ['armour', r.mass.armor], ['modules', r.mass.modules - r.mass.fuel - r.mass.ammo], ['fuel', r.mass.fuel],
                   ['ammunition', r.mass.ammo], ['actuators', r.mass.actuators], ['lines', r.mass.lines]];
    const rows = h('div.f-mass');
    for (const [label, kg] of parts) rows.append(h('div', null, h('span', null, label), bar(kg / r.mass.total, '', tonnes(kg))));
    const mv = r.move, fl = r.flight, b = mv.balance;
    const kv = (k, v, cls) => h('div' + (cls ? '.' + cls : ''), null, h('span', null, k), h('b', null, v));
    const ground = h('div.k-kv');
    if (mv.stands) {
        ground.append(kv('walk / run', kmh(mv.walk) + ' / ' + kmh(mv.sprint)), kv('run held back by', mv.limit),
            kv('jump', mv.jump.toFixed(0) + ' m'), kv('turns', mv.turn.toFixed(0) + ' °/s'),
            kv('under each foot', mv.footPressure.toFixed(0) + ' kPa standing, ' + mv.stepPressure.toFixed(0) + ' striding'),
            kv('tips past', b.tip.toFixed(0) + '° (' + b.least.toFixed(1) + ' m to the edge of its feet)'));
    } else ground.append(kv('on the ground', 'cannot stand', 'err'));
    const air = h('div.k-kv');
    air.append(kv('thrust', fmt.mn(fl.thrust) + ', ' + fl.tw.toFixed(2) + ' of its weight upward', fl.tw >= 1 ? '' : 'err'));
    if (fl.tw >= 1) {
        air.append(kv('hover', fl.hover.ok ? Math.round(fl.hover.throttle * 100) + '% throttle, for ' + secs(fl.endurance.hover) : fl.hover.lifts ? 'tumbles' : 'cannot hold still', fl.hover.ok ? '' : 'err'),
            kv('full burn', 'climbs at ' + (fl.climb / 9.81).toFixed(2) + ' g, for ' + secs(fl.endurance.burn)),
            kv('top speed', kmh(Math.min(fl.topSpeed, 340))),
            kv('pitch / yaw / roll', fl.authority.map((v) => v.toFixed(0)).join(' / ') + ' °/s²'));
    }
    el.append(rows, h('div.k-cap', null, 'on the ground'), ground, h('div.k-cap', null, 'in the air'), air,
        h('div.k-cap', null, 'weapons'), h('div.k-kv', null, kv('sustained', fmt.mw(r.dps)), kv('one salvo', r.alpha.toFixed(0) + ' MJ'),
            kv('magazines last', secs(r.regimes.fire.ammo.endurance) + ' of all guns')));
}

export function renderRegimes(el, r) {
    clear(el);
    const head = h('div.f-reg.head', null, h('span'), ...LINE_KINDS.map((k) => h('span', { style: { color: `rgb(${LINES[k].color.map((c) => Math.round(c * 255)).join(',')})` } }, LINES[k].label)));
    el.append(head);
    for (const key of REGIME_KEYS) {
        const g = r.regimes[key];
        const row = h('div.f-reg', null, h('span', null, REGIMES[key].label));
        for (const k of LINE_KINDS) {
            const x = g[k];
            let cell;
            if (!(x.demand > 0)) cell = h('span.dim', null, '–');
            else if (k === 'fuel' || k === 'ammo') cell = h('span' + (x.store > 0 ? (x.endurance < 60 ? '.warn' : '') : '.err'), { title: x.demand.toFixed(0) + ' kg/s' }, x.store > 0 ? secs(x.endurance) : 'none');
            else {
                const f = x.supply > 0 ? x.demand / x.supply : 9;
                const tone = f <= 1.005 ? (f > 0.85 ? 'warn' : 'ok') : 'err';
                const unit = k === 'data' ? ' ch' : ' MW';
                cell = h('span', { title: x.demand.toFixed(0) + ' of ' + x.supply.toFixed(0) + unit + (f > 1.005 && x.endurance !== Infinity ? ', holds ' + secs(x.endurance) : '') },
                    bar(f, tone, Math.round(f * 100) + '%' + (f > 1.005 && x.endurance !== Infinity ? ' · ' + secs(x.endurance) : '')));
            }
            row.append(cell);
        }
        el.append(row);
    }
}

export function renderIssues(el, countEl, r, onPick) {
    clear(el);
    const errs = r.issues.filter((i) => i.level === 'error').length;
    countEl.textContent = r.issues.length ? `${errs ? errs + ' that stop it, ' : ''}${r.issues.length - errs} to look at` : 'none';
    if (!r.issues.length) { el.append(h('div.dim', null, 'Nothing is wrong with it.')); return; }
    for (const i of r.issues) {
        el.append(h('div.f-issue.' + (i.level === 'error' ? 'err' : 'warn'), { onclick: () => i.where && onPick(i.where) }, i.text));
    }
}

export function renderFailures(el, r, onPick) {
    clear(el);
    if (!r.failures || !r.failures.length) { el.append(h('div.dim', null, 'Nothing it cannot lose.')); return; }
    for (const f of r.failures) {
        el.append(h('div.f-fail', { onclick: () => onPick(f.seg) }, h('b', null, f.name), h('span', null, 'loses ' + f.lost.join(', '))));
    }
}
