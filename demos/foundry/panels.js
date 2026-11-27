// demos/foundry/panels.js — the foundry's side panels: units, the library,
// the flow strip, goal, contract, output curve, problems and inspector.

import { h, clear } from "/lib/kit/dom.js";
import { PARTS, PART_CATEGORIES } from "/lib/foundry/parts.js";
import { MATERIALS } from "/lib/foundry/materials.js";

const RPM = (2 * Math.PI) / 60;

// --- units -------------------------------------------------------------------

function si(v, unit, digits = 3) {
    const a = Math.abs(v);
    if (!isFinite(v)) return '∞';
    const pre = a >= 1e9 ? ['G', 1e9] : a >= 1e6 ? ['M', 1e6] : a >= 1e3 ? ['k', 1e3] : ['', 1];
    const x = v / pre[1];
    const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
    return `${x.toFixed(Math.min(d, digits))} ${pre[0]}${unit}`;
}

export function fmtEffort(domain, v) {
    if (domain === 'rot') return si(v, 'N·m');
    if (domain === 'lin') return si(v, 'N');
    if (domain === 'hyd') return `${(v / 1e5).toFixed(0)} bar`;
    return si(v, 'W');
}

export function fmtFlow(domain, v) {
    if (domain === 'rot') { const r = v / RPM; return r >= 100 ? `${r.toFixed(0)} rpm` : `${r.toFixed(r >= 10 ? 1 : 2)} rpm`; }
    if (domain === 'lin') return v >= 1 ? `${v.toFixed(2)} m/s` : `${(v * 1000).toFixed(v >= 0.1 ? 0 : 1)} mm/s`;
    if (domain === 'hyd') return `${(v * 60000).toFixed(1)} L/min`;
    return si(v, 'A');
}

export function fmtLen(m) {
    return m >= 1 ? `${m.toFixed(2)} m` : m >= 0.1 ? `${(m * 100).toFixed(1)} cm` : `${(m * 1000).toFixed(0)} mm`;
}

export function fmtMass(kg) { return kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : kg >= 10 ? `${kg.toFixed(1)} kg` : `${kg.toFixed(2)} kg`; }
export function fmtBox(sz) {
    const top = Math.max(...sz);
    const [unit, k] = top >= 1 ? ['m', 1] : top >= 0.1 ? ['cm', 100] : ['mm', 1000];
    return sz.map((v) => (v * k).toFixed(unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2)).join(' × ') + ' ' + unit;
}

const DOMAIN_NAME = { rot: 'rotary', lin: 'linear', hyd: 'hydraulic', elec: 'electric', mnt: 'mount' };
const G = 9.81;

/** The joints a mount output hangs from, base outward, and that mount. */
function liftChain(c, outId) {
    const mount = (c.mounts || []).find((m) => m.port === outId);
    if (!mount) return null;
    const joints = c.joints.filter((J) => J.tips.includes(outId)).sort((a, b) => a.s - b.s);
    return { mount, joints, tipS: c.stretch ? c.stretch.tips[outId] : mount.reach };
}

/** What a payload of `kg` at the tip asks of joint J, as a fraction of what it holds. */
function jointLoad(J, kg, tipS) { const cap = J.carry ?? J.cont; return cap > 0 ? (J.hold + kg * G * (tipS - J.s)) / cap : Infinity; }

export function fmtKg(v) { return !isFinite(v) ? '∞' : v >= 1000 ? `${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)} t` : `${v.toFixed(v >= 10 ? 0 : 1)} kg`; }
export function fmtM(v) { return v >= 10 ? `${v.toFixed(0)} m` : v >= 1 ? `${v.toFixed(2)} m` : `${(v * 100).toFixed(0)} cm`; }
export function paintCss(p) { return p ? `rgb(${p.map((v) => Math.round(v * 255)).join(',')})` : '#777'; }

export function statusOf(c) {
    if (!c.ok) return 'err';
    if (!c.goal) return 'pass';
    return c.goal.pass ? 'pass' : 'fail';
}

// --- library -----------------------------------------------------------------

/**
 * Every design by level. `canUse(id)` says whether a design may go into the
 * open one (it does not contain the open one); those rows carry “use”.
 */
export function renderLibrary(el, lib, cache, currentId, onOpen, onUse, canUse) {
    clear(el);
    const byLevel = new Map();
    for (const d of Object.values(lib)) {
        const lvl = cache.get(d.id) ? cache.get(d.id).level : 1;
        (byLevel.get(lvl) || byLevel.set(lvl, []).get(lvl)).push(d);
    }
    for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
        el.append(h('div', { class: 'f-lvl' }, `Level ${lvl}`));
        for (const d of byLevel.get(lvl)) {
            const c = cache.get(d.id);
            const usable = d.id !== currentId && canUse(d.id);
            const row = h('div', { class: 'f-design' + (d.id === currentId ? ' cur' : ''), 'data-id': d.id },
                h('span', { class: 'f-swatch', style: `background:${paintCss(d.paint)}` }),
                h('span', { class: 'name' }, d.name),
                usable ? h('button', { class: 'use small', title: `Add ${d.name} to the open design, as a part` }, '+ use') : null,
                h('span', { class: 'f-dot ' + (c ? statusOf(c) : 'err'), title: c ? { err: 'does not build', pass: 'meets its goal', fail: 'misses its goal' }[statusOf(c)] : '' }),
            );
            row.addEventListener('click', (e) => {
                if (e.target.classList.contains('use')) onUse(d.id); else onOpen(d.id);
            });
            el.append(row);
        }
    }
}

export function renderPalette(el, onAdd) {
    clear(el);
    for (const cat of PART_CATEGORIES) {
        const types = Object.entries(PARTS).filter(([, d]) => d.cat === cat);
        if (!types.length) continue;
        el.append(h('div', { class: 'cat' }, cat));
        const row = h('div', { class: 'row' });
        for (const [type, d] of types) {
            const b = h('button', { class: 'small', title: d.note, 'data-part': type }, d.label);
            b.addEventListener('click', () => onAdd(type));
            row.append(b);
        }
        el.append(row);
    }
}

// --- title, flow strip ------------------------------------------------------------

/** Text that turns into a field when clicked; Enter or leaving it commits, Escape cancels. */
function editable(cls, text, placeholder, onCommit) {
    const span = h('div', { class: cls + ' f-editable' + (text ? '' : ' empty'), title: 'Click to edit' }, text || placeholder);
    span.addEventListener('click', () => {
        const inp = h('input', { type: 'text', class: cls + ' f-edit', value: text });
        let done = false;
        const finish = (keep) => { if (done) return; done = true; if (keep) onCommit(inp.value); else inp.replaceWith(span); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
        inp.addEventListener('blur', () => finish(true));
        span.replaceWith(inp);
        inp.focus();
        inp.select();
    });
    return span;
}

/** The open design's level, name and note; `api`: rename(name), note(text). */
export function renderTitle(el, c, api) {
    clear(el);
    el.append(
        h('div', { class: 'lvl' }, `Level ${c.level} · ${c.partCount} parts`),
        api ? editable('nm', c.name, 'Untitled', api.rename) : h('div', { class: 'nm' }, c.name),
        api ? editable('note', c.note, 'Add a note: what it is for…', api.note) : h('div', { class: 'note' }, c.note),
    );
}

/** The power path into the goal's output, upstream to downstream, each stage's limit at the output. */
export function renderFlow(el, c, outId, opEffort) {
    clear(el);
    const out = c.ports.find((p) => p.id === outId);
    if (!out) return;
    const arrow = () => h('div', { class: 'f-arrow' }, '›');
    if (out.domain === 'mnt') {
        // A lift: base, each joint it hangs from (what it holds, what it carries), the tip.
        const lc = liftChain(c, outId);
        if (!lc) return;
        el.append(h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, 'Base'), h('div', { class: 's' }, 'mount')));
        // Joints of the same name (a chain of one design) are told apart by the child they are in.
        const seen = new Set(), dup = new Set();
        for (const J of lc.joints) { const n = shortLabel(J.label); if (seen.has(n)) dup.add(n); seen.add(n); }
        for (const J of lc.joints) {
            el.append(arrow());
            const weak = lc.mount.weakest === J.label;
            const load = Math.min(1, jointLoad(J, opEffort || 0, lc.tipS));
            el.append(h('div', { class: 'f-stage-chip' + (weak ? ' weak' : ''), 'data-child': J.child || null, title: `${J.label}: ${J.limit} ${J.mode} past ${fmtEffort('rot', J.cont)}${J.lock != null ? `; locks at ${fmtEffort('rot', J.lock)} with the power off` : ''}` },
                h('div', { class: 't' }, (dup.has(shortLabel(J.label)) && J.child ? `${J.child} · ` : '') + shortLabel(J.label) + (J.lock != null ? ' 🔒' : '')),
                h('div', { class: 's' }, J.upright ? `turntable · drives ${fmtEffort('rot', J.cont)} · the boom carries ${fmtEffort('rot', J.hold)} · ${fmtM(lc.tipS - J.s)} out` : `drives ${fmtEffort('rot', J.cont)} · carries ${fmtEffort('rot', J.hold)} · ${fmtM(lc.tipS - J.s)} out`),
                h('div', { class: 'bar' }, h('i', { style: `width:${(load * 100).toFixed(1)}%` })),
            ));
        }
        el.append(arrow(), h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, out.label),
            h('div', { class: 's' }, `lifts ${fmtKg(lc.mount.payloadKg)} at ${fmtM(lc.mount.reach)}`),
            lc.mount.holdKg > 0 ? h('div', { class: 's' }, `holds ${fmtKg(lc.mount.holdKg)} with the power off`) : null));
        return;
    }
    const src = c.sources.find((s) => s.port === outId);
    const path = c.paths.find((p) => p.to === outId);
    const chain = src || path;
    if (!chain) return;
    const dom = out.domain;
    const tr = c.traces[outId];
    if (src) {
        // Drives side by side on a summing input show as one chip: how many, and what they give together.
        const P = tr.root.parallel, first = P ? P[0].root : tr.root;
        const root = c.children.find((ch) => ch.id === first.child);
        const name = root.el.kind === 'contract' ? root.el.name : root.el.label;
        const rl = P ? `${P.filter((b) => !b.dark).length}× ${name}` : name;
        const rp = root.el.ports.find((p) => p.id === tr.root.src.port);
        const rd = rp ? rp.domain : dom;
        el.append(h('div', { class: 'f-stage-chip src', 'data-child': first.child },
            h('div', { class: 't' }, rl),
            h('div', { class: 's' }, P ? `${fmtEffort(rd, tr.root.src.cont)} together · ${fmtFlow(rd, tr.root.src.noLoad)}` : root.el.summary || `${fmtEffort(rd, tr.root.src.cont)} cont · ${fmtFlow(rd, tr.root.src.noLoad)}`),
        ));
    } else {
        const froms = [].concat(path.from), inp = c.ports.find((p) => p.id === froms[0]);
        el.append(h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, (inp ? inp.label.replace(/ \(\w+\)$/, '') : froms[0]) + (froms.length > 1 ? ` ×${froms.length}` : '')), h('div', { class: 's' }, 'input')));
    }
    for (const s of chain.stages) {
        el.append(arrow());
        const weak = chain.weakest && s.label === chain.weakest.label;
        const guard = chain.guarded && s.label === chain.guarded.label;
        const load = opEffort > 0 && isFinite(s.peak) ? Math.min(1, opEffort / s.peak) : 0;
        const ratio = s.convert ? s.convert.split('>').map((x) => DOMAIN_NAME[x]).join(' → ') : s.k !== 1 ? `×${s.k >= 10 ? s.k.toFixed(0) : s.k.toFixed(2)}` : '';
        el.append(h('div', { class: 'f-stage-chip' + (weak ? ' weak' : '') + (guard ? ' guard' : ''), 'data-child': s.child, title: `${s.label}: ${s.mode} at ${fmtEffort(dom, s.peak)} at the output` },
            h('div', { class: 't' }, shortLabel(s.label) + (s.locks ? ' 🔒' : '')),
            h('div', { class: 's' }, [ratio, `${Math.round(s.eff * 100)}%`, `${s.role === 'limiter' ? 'slips' : s.role === 'fuse' ? 'breaks' : 'holds'} ${fmtEffort(dom, s.peak)}`].filter(Boolean).join(' · ')),
            h('div', { class: 'bar' }, h('i', { style: `width:${(load * 100).toFixed(1)}%` })),
        ));
    }
    el.append(arrow(), h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, out.label), h('div', { class: 's' }, DOMAIN_NAME[dom] + ' out')));
}

function shortLabel(l) {
    const parts = l.split(' › ');
    return parts.length > 1 ? parts[0] : l.replace(/ \((\w+)\)$/, '');
}

// --- goal ----------------------------------------------------------------------

// Units the goal is edited in: what a value reads as, and its SI scale.
const EFFORT_UNIT = { rot: ['N·m', 1], lin: ['N', 1], hyd: ['bar', 1e5], elec: ['W', 1] };
const FLOW_UNIT = { rot: ['rpm', RPM], lin: ['mm/s', 1e-3], hyd: ['L/min', 1 / 60000], elec: ['A', 1] };
let goalEditing = null;   // the design whose goal form is open

function num(v) { return +(+v).toPrecision(4); }

/** The goal form: every number of `g` in the units it reads in; each change sets a new goal. */
function goalForm(c, g, api) {
    const form = h('div', { class: 'f-goal-form' });
    const outs = c.ports.filter((p) => p.dir === 'out');
    const out = outs.find((p) => p.id === g.out) || outs[0];
    const dom = out ? out.domain : 'rot';
    const put = (fn) => { const n = structuredClone(g); fn(n); api.set(n); };
    const field = (label, value, unit, onSet, opts = {}) => {
        const inp = h('input', { type: 'number', step: 'any', min: 0, value: value == null ? '' : num(value), placeholder: opts.placeholder || '', 'data-goal': opts.key || label });
        inp.addEventListener('change', () => onSet(inp.value === '' ? null : +inp.value));
        form.append(h('label', { class: 'f-gf' }, h('span', {}, label), inp, h('span', { class: 'u' }, unit)));
    };
    if (g.drive) {
        field('Top speed', g.drive.speedMs, 'm/s', (v) => put((n) => { n.drive.speedMs = v || 0; }), { key: 'speed' });
        field('Carries', g.drive.payloadKg, 'kg', (v) => put((n) => { if (v != null) n.drive.payloadKg = v; else delete n.drive.payloadKg; }), { key: 'payload', placeholder: 'any' });
        field('Climbs, loaded', g.drive.gradePct, '%', (v) => put((n) => { if (v != null) n.drive.gradePct = v; else delete n.drive.gradePct; }), { key: 'grade', placeholder: 'any' });
        field('Mass under', g.massMax, 'kg', (v) => put((n) => { if (v > 0) n.massMax = v; else delete n.massMax; }), { key: 'mass', placeholder: 'any' });
        return form;
    }
    if (outs.length > 1) {
        const sel = h('select', { 'data-goal': 'out' }, ...outs.map((p) => h('option', { value: p.id, selected: p.id === g.out ? '' : null }, p.label)));
        sel.addEventListener('change', () => { const n = api.draft(sel.value); if (n) api.set(n); });
        form.append(h('label', { class: 'f-gf' }, h('span', {}, 'Output'), sel, h('span', {})));
    }
    if (g.lift) {
        field('Lifts', g.lift.payloadKg, 'kg', (v) => put((n) => { n.lift.payloadKg = v || 0; }), { key: 'payload' });
        field('Reach', g.lift.reachM, 'm', (v) => put((n) => { n.lift.reachM = v || 0; }), { key: 'reach' });
    } else {
        // Torque and force read in kilo- once they pass a thousand.
        const kilo = (dom === 'rot' || dom === 'lin') && g.need.effort >= 1000;
        const [eu, es] = kilo ? ['k' + EFFORT_UNIT[dom][0], 1e3] : EFFORT_UNIT[dom] || EFFORT_UNIT.rot, [fu, fs] = FLOW_UNIT[dom] || FLOW_UNIT.rot;
        if (g.given) {
            field('Given', g.given.effort, 'N·m in', (v) => put((n) => { n.given.effort = v || 0; }), { key: 'givenEffort' });
            field('at', g.given.flow / RPM, 'rpm in', (v) => put((n) => { n.given.flow = (v || 0) * RPM; }), { key: 'givenFlow' });
        }
        field('Holds', g.need.effort / es, eu, (v) => put((n) => { n.need.effort = (v || 0) * es; }), { key: 'effort' });
        field(g.given ? 'Speed' : 'at speed', g.need.flow / fs, fu, (v) => put((n) => { n.need.flow = (v || 0) * fs; }), { key: 'flow' });
    }
    const boxCm = g.box ? g.box.map((v) => v * 100) : [null, null, null];
    const row = h('label', { class: 'f-gf' }, h('span', {}, 'Fits in'));
    const bx = boxCm.map((v, i) => {
        const inp = h('input', { type: 'number', step: 'any', min: 0, value: v == null ? '' : num(v), placeholder: '—', class: 'third', 'data-goal': `box${i}` });
        inp.addEventListener('change', () => {
            const vals = bx.map((x) => (x.value === '' ? null : +x.value / 100));
            put((n) => { if (vals.every((x) => x > 0)) n.box = vals; else delete n.box; });
        });
        return inp;
    });
    row.append(h('span', { class: 'f-box3' }, ...bx), h('span', { class: 'u' }, 'cm'));
    form.append(row);
    field('Mass under', g.massMax, 'kg', (v) => put((n) => { if (v > 0) n.massMax = v; else delete n.massMax; }), { key: 'mass', placeholder: 'any' });
    return form;
}

/**
 * The goal: its checks, met or not, and its form. `api`:
 *   set(goal | null), draft(outId?) → a goal the design meets as it stands.
 */
export function renderGoal(el, c, pill, api) {
    clear(el);
    const g = c.goal;
    pill.className = 'f-pill ' + statusOf(c);
    pill.textContent = !c.ok ? 'Does not build' : !g ? 'No goal' : g.pass ? 'Goal met' : 'Goal not met';
    const editing = goalEditing === c.id;
    const bar = h('div', { class: 'f-goal-bar' });
    if (!g) {
        const draft = api && api.draft();
        el.append(h('div', { class: 'f-empty' }, draft ? 'No goal yet. Set one from what it does now, then ask for more.' : 'No goal: expose an output to aim it at.'));
        if (draft) {
            const b = h('button', { class: 'small primary', id: 'setGoal' }, 'Set a goal');
            b.addEventListener('click', () => { goalEditing = c.id; api.set(draft); });
            bar.append(b);
            el.append(bar);
        }
        return;
    }
    const out = c.ports.find((p) => p.id === g.out);
    const dom = out ? out.domain : 'rot';
    if (g.given) el.append(h('div', { class: 'f-given' }, `Given ${fmtEffort('rot', g.given.effort)} at ${fmtFlow('rot', g.given.flow)} in`));
    for (const k of g.checks) {
        let label = k.label, got = '', want = '', frac = 0, mark = 0;
        if (k.kind === 'effort' || k.kind === 'flow') {
            const f = k.kind === 'effort' ? (v) => fmtEffort(dom, v) : (v) => fmtFlow(dom, v);
            got = f(k.got); want = f(k.want);
            const top = Math.max(k.got, k.want) * 1.15 || 1;
            frac = k.got / top; mark = k.want / top;
            if (k.kind === 'effort' && c.sources.some((s) => s.port === g.out)) label = `at ${fmtFlow(dom, g.need.flow)}`;
        } else if (k.kind === 'box') {
            const top = Math.max(...k.want);
            const [unit, sc] = top >= 2 ? ['m', 1] : top >= 0.1 ? ['cm', 100] : ['mm', 1000];
            const compact = (v) => v.map((x) => Math.round(x * sc * (unit === 'm' ? 10 : 1)) / (unit === 'm' ? 10 : 1)).join('×');
            got = compact(k.got); want = compact(k.want) + ' ' + unit;
            label = 'box';
            const a = k.got.slice().sort((x, y) => x - y), b = k.want.slice().sort((x, y) => x - y);
            const worst = Math.max(...a.map((v, i) => v / b[i]));
            frac = Math.min(1, worst / Math.max(1.15, worst * 1.05)); mark = 1 / Math.max(1.15, worst * 1.05);
        } else if (k.kind === 'mass') {
            got = fmtMass(k.got); want = fmtMass(k.want);
            const top = Math.max(k.got, k.want) * 1.15; frac = k.got / top; mark = k.want / top;
        } else if (k.kind === 'speed' || k.kind === 'grade' || k.kind === 'push') {
            const f = k.kind === 'speed' ? (v) => `${v.toFixed(2)} m/s` : k.kind === 'push' ? (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kN` : `${v.toFixed(0)} N`) : (v) => `${v.toFixed(0)}%`;
            got = f(k.got); want = f(k.want);
            const top = Math.max(k.got, k.want) * 1.15 || 1;
            frac = Math.max(0, k.got) / top; mark = k.want / top;
        } else if (k.kind === 'payload' || k.kind === 'reach') {
            const f = k.kind === 'payload' ? fmtKg : fmtM;
            got = f(k.got); want = f(k.want);
            const top = (isFinite(k.got) ? Math.max(k.got, k.want) : k.want * 2) * 1.15 || 1;
            frac = Math.min(1, k.got / top); mark = k.want / top;
        } else {
            got = `${k.got} errors`; want = '0';
        }
        el.append(h('div', { class: 'f-check' + (k.pass ? '' : ' bad') },
            h('span', { class: 'k' }, label),
            h('span', { class: 'v' }, h('b', {}, got), `  /  ${k.kind === 'mass' ? 'max ' : ''}${want}`),
            h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` }), h('u', { style: `left:${Math.max(0, Math.min(1, mark)) * 100}%` })),
        ));
    }
    if (!api) return;
    const raw = g.drive ? { drive: g.drive } : { out: g.out, ...(g.lift ? { lift: g.lift } : { need: g.need, ...(g.given ? { given: g.given } : {}) }) };
    const box = g.checks.find((k) => k.kind === 'box'), mass = g.checks.find((k) => k.kind === 'mass');
    if (box) raw.box = box.want;
    if (mass) raw.massMax = mass.want;
    const edit = h('button', { class: 'small', id: 'editGoal' }, editing ? 'Done' : 'Edit goal');
    edit.addEventListener('click', () => { goalEditing = editing ? null : c.id; api.refresh(); });
    const clr = h('button', { class: 'small', id: 'clearGoal' }, 'Clear');
    clr.addEventListener('click', () => { goalEditing = null; api.set(null); });
    bar.append(edit, clr);
    el.append(bar);
    if (editing) el.append(goalForm(c, raw, api));
}

// --- contract ------------------------------------------------------------------

export function renderContract(el, c) {
    clear(el);
    el.append(h('div', { class: 'f-kv' },
        h('span', { class: 'k' }, 'Box'), h('span', { class: 'v' }, fmtBox(c.size)),
        h('span', { class: 'k' }, 'Mass'), h('span', { class: 'v' }, fmtMass(c.massKg)),
        h('span', { class: 'k' }, 'Parts'), h('span', { class: 'v' }, `${c.partCount} in ${c.children.length} children`),
    ));
    const ports = h('div', { class: 'f-ports' });
    const rows = new Map();
    for (const p of c.ports) {
        let spec = '';
        const src = c.sources.find((s) => s.port === p.id);
        const path = c.paths.find((x) => x.to === p.id);
        const sup = c.supplies.find((s) => s.port === p.id);
        if (src) spec = `${fmtEffort(p.domain, src.cont)} cont · ${fmtFlow(p.domain, src.noLoad)}`;
        else if (path) {
            // A ratio across a change of motion (rotary in, linear out) is between unlike units: name the change.
            const conv = (path.stages || []).filter((s) => s.convert);
            const head = conv.length ? `${DOMAIN_NAME[conv[0].convert.split('>')[0]]} → ${DOMAIN_NAME[p.domain]}` : `×${path.k >= 10 ? path.k.toFixed(0) : path.k.toFixed(2)}`;
            spec = `${head} · holds ${fmtEffort(p.domain, path.cont)}`;
        }
        else if (sup) spec = `${si(sup.power, 'W')} · ${sup.energyWh} Wh`;
        else if (p.domain === 'mnt') {
            const m = (c.mounts || []).find((x) => x.port === p.id);
            spec = m ? `${fmtKg(m.payloadKg)} at ${fmtM(m.reach)}${m.holdKg > 0 ? ` · 🔒 ${fmtKg(m.holdKg)}` : ''}` : 'mount';
        }
        else if (p.dir === 'in') {
            const user = c.sources.find((s) => s.draw && s.draw.port === p.id);
            spec = user ? `draws ${si(user.power / user.draw.eff, 'W')}` : 'input';
        }
        // Ports alike but for the child they come from (a power line per segment) read as one, counted.
        const key = `${p.dir}|${p.domain}|${p.label.replace(/ \([^)]*\)$/, '')}`;
        const row = rows.get(key);
        if (row) { row.n++; continue; }
        rows.set(key, { p, spec, n: 1 });
    }
    for (const { p, spec, n } of rows.values()) {
        const label = n > 1 ? `${p.label.replace(/ \([^)]*\)$/, '')} ×${n}` : p.label;
        ports.append(h('div', { class: 'f-port' },
            h('span', { class: 'd d-' + p.domain }), h('span', { class: 'dir' }, p.dir), h('span', {}, label), h('span', { class: 'spec' }, n > 1 && spec === 'input' ? 'inputs' : spec)));
    }
    el.append(ports);
}

// --- output curve -------------------------------------------------------------------

export function drawCurve(canvas, c, outId, op) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const out = c.ports.find((p) => p.id === outId);
    const L = 62, R = 10, T = 10, B = 22;
    const pw = w - L - R, ph = hgt - T - B;
    if (out && out.domain === 'mnt') { drawLiftCurve(ctx, c, outId, op, { L, T, pw, ph }); return; }
    const src = c.sources.find((s) => s.port === outId);
    const path = c.paths.find((p) => p.to === outId);
    if (!out || (!src && !path)) return;
    const dom = out.domain;
    let maxF, maxE, curve;
    if (src) {
        maxF = src.noLoad * 1.05;
        maxE = Math.max(src.stall, src.peak === Infinity ? 0 : src.peak, c.goal ? c.goal.need.effort : 0) * 1.12;
        curve = (f) => Math.max(0, Math.min(src.stall * (1 - f / src.noLoad), f > 0 ? src.power / f : Infinity));
    } else {
        const given = c.goal && c.goal.given;
        const fIn = given ? given.flow : 1;
        maxF = (fIn / path.k) * 1.6;
        maxE = Math.max(path.peak, given ? given.effort * path.k * path.eff : 0) * 1.12;
        curve = null;
    }
    const X = (f) => L + (f / maxF) * pw, Y = (e) => T + ph - (e / maxE) * ph;
    ctx.strokeStyle = '#252b33'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = T + (k / 4) * ph; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
    ctx.fillStyle = '#5d6672'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(fmtEffort(dom, maxE), L - 4, T + 8);
    ctx.fillText('0', L - 4, T + ph);
    ctx.textAlign = 'left'; ctx.fillText('0', L, T + ph + 14);
    ctx.textAlign = 'right'; ctx.fillText(fmtFlow(dom, maxF), L + pw, T + ph + 14);
    // Limits: continuous and breaking.
    const lim = src || path;
    for (const [v, col, label] of [[lim.cont, '#3ccf8e', 'cont'], [lim.peak, '#ff5a4f', lim.weakest && lim.weakest.role === 'limiter' ? 'slips' : 'breaks']]) {
        if (!isFinite(v) || v > maxE) continue;
        ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(label, L + 4, Y(v) - 3);
    }
    if (curve) {
        ctx.strokeStyle = '#f08a24'; ctx.lineWidth = 2; ctx.beginPath();
        for (let k = 0; k <= 64; k++) { const f = (k / 64) * src.noLoad; const y = Y(curve(f)); if (k) ctx.lineTo(X(f), y); else ctx.moveTo(X(f), y); }
        ctx.stroke();
    }
    if (c.goal) {
        const g = c.goal.need;
        ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 1.5;
        ctx.strokeRect(X(g.flow) - 4, Y(g.effort) - 4, 8, 8);
    }
    if (op) {
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(op.flow), Y(op.effort), 4.5, 0, Math.PI * 2); ctx.fill();
    }
}

/**
 * What the arm lifts at each reach: every joint's spare torque over the lever
 * from it to a payload r out from the base, the least of them. The tip is
 * marked where it is; a longer arm reaches further and lifts less.
 */
function drawLiftCurve(ctx, c, outId, op, { L, T, pw, ph }) {
    const lc = liftChain(c, outId);
    if (!lc || !lc.joints.length) return;
    const last = lc.joints[lc.joints.length - 1].s;
    const r0 = last + (lc.tipS - last) * 0.35, r1 = lc.tipS * 1.6;
    const lift = (r) => Math.min(...lc.joints.map((J) => Math.max(0, (J.carry ?? J.cont) - J.hold) / (G * Math.max(1e-6, r - J.s))));
    const want = c.goal && c.goal.lift;
    const l0 = lift(lc.tipS), maxKg = Math.max(Number.isFinite(l0) ? l0 * 2.2 : 0, want ? want.payloadKg * 1.3 : 0) || 1;
    const X = (r) => L + ((r - r0) / (r1 - r0)) * pw, Y = (kg) => T + ph - (Math.min(kg, maxKg) / maxKg) * ph;
    ctx.strokeStyle = '#252b33'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = T + (k / 4) * ph; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); }
    ctx.fillStyle = '#5d6672'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(fmtKg(maxKg), L - 4, T + 8);
    ctx.fillText('0', L - 4, T + ph);
    ctx.textAlign = 'left'; ctx.fillText(fmtM(r0), L, T + ph + 14);
    ctx.textAlign = 'right'; ctx.fillText(fmtM(r1) + ' reach', L + pw, T + ph + 14);
    ctx.strokeStyle = '#f08a24'; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k <= 64; k++) { const r = r0 + (k / 64) * (r1 - r0); const y = Y(lift(r)); if (k) ctx.lineTo(X(r), y); else ctx.moveTo(X(r), y); }
    ctx.stroke();
    ctx.strokeStyle = '#3ccf8e'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(lc.tipS), T); ctx.lineTo(X(lc.tipS), T + ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#3ccf8e'; ctx.textAlign = 'left'; ctx.fillText('tip', X(lc.tipS) + 4, T + 10);
    if (lift(lc.tipS) <= 0) {
        ctx.fillStyle = '#ff5a4f'; ctx.textAlign = 'center';
        ctx.fillText(`${shortLabel(lc.mount.weakest || 'a joint')} cannot hold up its own arm`, L + pw / 2, T + ph / 2);
    }
    if (want) { ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 1.5; ctx.strokeRect(X(want.reachM) - 4, Y(want.payloadKg) - 4, 8, 8); }
    if (op && op.payloadKg != null) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(lc.tipS), Y(op.payloadKg), 4.5, 0, Math.PI * 2); ctx.fill(); }
}

// --- problems ---------------------------------------------------------------------

/**
 * Errors and warnings. A problem that names a child (“… (worm1) …” or
 * “worm1: …”) selects it when clicked, via `onPick(childId)`.
 */
export function renderProblems(el, c, onPick) {
    clear(el);
    if (!c.errors.length && !c.warnings.length) { el.append(h('div', { class: 'f-prob none' }, 'None.')); return; }
    const ids = c.children.map((ch) => ch.id).sort((a, b) => b.length - a.length);
    const named = (t) => ids.find((id) => t.includes(`(${id})`) || t.startsWith(`${id}:`) || t.startsWith(`${id} `) || t.includes(` ${id}.`) || t.startsWith(`${id}.`));
    const row = (cls, t) => {
        const id = onPick && named(t);
        const r = h('div', { class: `f-prob ${cls}` + (id ? ' pick' : ''), title: id ? `Select ${id}` : '' }, t);
        if (id) { r.dataset.child = id; r.addEventListener('click', () => onPick(id)); }
        el.append(r);
    };
    for (const e of c.errors) row('err', e);
    for (const w of c.warnings) row('warn', w);
}

// --- inspector ----------------------------------------------------------------------

/**
 * The selected child: its parameters (a part) or its contract (a design),
 * its ports and what each links to. `api` carries the edits:
 *   setParam(key, value), open(), remove(), link(port, otherRef), unlink(port),
 *   spin(port), expose(port), unexpose(port)
 */
export function renderInspector(el, title, design, c, childId, api) {
    clear(el);
    const ch = c.children.find((x) => x.id === childId);
    const spec = design.children.find((x) => x.id === childId);
    if (!ch || !spec) {
        title.textContent = 'Selected';
        el.append(h('div', { class: 'f-empty' }, 'Click a part in the view, or a stage in the flow, to change it.'));
        return;
    }
    const isPart = ch.el.kind === 'part';
    title.textContent = `${childId} · ${isPart ? ch.el.label : ch.el.name}`;
    el.append(h('div', { class: 'f-insp-sum' }, isPart ? ch.el.summary : `${ch.el.partCount} parts · ${fmtBox(ch.el.size)} · ${fmtMass(ch.el.massKg)}`));
    if (isPart) {
        const def = PARTS[spec.part];
        for (const [key, sc] of Object.entries(def.schema)) {
            const val = ch.el.params[key];
            let input;
            if (sc.kind === 'material') {
                input = h('select', { 'data-param': key }, ...Object.values(MATERIALS).map((m) => h('option', { value: m.id, selected: m.id === val ? '' : null }, m.label)));
                input.addEventListener('change', () => api.setParam(key, input.value));
                el.append(h('div', { class: 'f-param' }, h('label', {}, sc.label), input, h('span', {})));
            } else if (sc.options) {
                input = h('select', { 'data-param': key }, ...Object.entries(sc.options).map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) ? '' : null }, l)));
                input.addEventListener('change', () => api.setParam(key, input.value));
                el.append(h('div', { class: 'f-param' }, h('label', {}, sc.label), input, h('span', {})));
            } else {
                const range = h('input', { type: 'range', min: sc.min, max: sc.max, step: sc.step, value: val, 'data-param': key });
                const num = h('input', { type: 'number', min: sc.min, max: sc.max, step: sc.step, value: val });
                range.addEventListener('input', () => { num.value = range.value; });
                range.addEventListener('change', () => api.setParam(key, +range.value));
                num.addEventListener('change', () => api.setParam(key, +num.value));
                el.append(h('div', { class: 'f-param' }, h('label', { title: sc.unit }, `${sc.label}${sc.unit ? ' (' + sc.unit + ')' : ''}`), range, num));
            }
        }
    }
    // Ports and links.
    const links = h('div', { class: 'f-links' });
    const linkedTo = new Map();
    for (const l of c.links) { linkedTo.set(l.out, l); linkedTo.set(l.in, l); }
    const exposedAt = new Map(design.ports.map((p) => [p.at, p]));
    for (const p of ch.el.ports) {
        const ref = `${childId}.${p.id}`;
        const l = linkedTo.get(ref);
        const ex = exposedAt.get(ref);
        const row = h('div', { class: 'f-link' }, h('span', { class: 'd d-' + p.domain, style: 'width:8px;height:8px;border-radius:2px;flex:none' }), h('span', { class: 'lbl' }, `${p.label}`));
        if (l) {
            const other = l.out === ref ? l.in : l.out;
            row.append(h('span', { class: 'to' }, `${p.dir === 'out' ? '→' : '←'} ${other}`));
            if (l.mech) { const b = h('button', { class: 'small', title: 'Turn what this brings into place a quarter turn about the shaft', 'data-spin': p.id }, '⟳'); b.addEventListener('click', () => api.spin(p.id)); row.append(b); }
            const u = h('button', { class: 'small', title: 'Unlink', 'data-unlink': p.id }, '×'); u.addEventListener('click', () => api.unlink(p.id)); row.append(u);
        } else if (ex) {
            row.append(h('span', { class: 'to' }, `exposed as “${ex.label}”`));
            const u = h('button', { class: 'small', title: 'Stop exposing' }, '×'); u.addEventListener('click', () => api.unexpose(p.id)); row.append(u);
        } else {
            const sel = h('select', { 'data-link': p.id }, h('option', { value: '' }, p.dir === 'out' ? 'drive…' : 'driven by…'));
            for (const o of c.children) {
                if (o.id === childId) continue;
                for (const q of o.el.ports) {
                    const oref = `${o.id}.${q.id}`;
                    if (q.domain !== p.domain || q.dir === p.dir || linkedTo.has(oref) || exposedAt.has(oref)) continue;
                    sel.append(h('option', { value: oref }, `${o.id} · ${q.label}`));
                }
            }
            sel.addEventListener('change', () => { if (sel.value) api.link(p.id, sel.value); });
            row.append(sel);
            const x = h('button', { class: 'small', title: 'Expose this port on the design' }, 'expose'); x.addEventListener('click', () => api.expose(p.id)); row.append(x);
        }
        links.append(row);
    }
    el.append(links);
    const actions = h('div', { class: 'f-actions' });
    if (!isPart) {
        const o = h('button', { class: 'small primary', id: 'openChild' }, `Open ${ch.el.name}`); o.addEventListener('click', api.open); actions.append(o);
        // Many of it, end to end: a chain of a design is how an arm gets long.
        const n = h('input', { type: 'number', min: 1, max: 500, step: 1, value: 9, id: 'chainCount', class: 'f-chain-n', title: 'How many more' });
        const b = h('button', { class: 'small', id: 'chainMore', title: `Add copies of ${ch.el.name} after this one, each into the next` }, 'Chain more');
        b.addEventListener('click', () => api.chain(+n.value));
        actions.append(h('span', { class: 'f-chain' }, b, n));
        // Another design in its place, kept wired: a variant (a copy changed) goes where the original was.
        const opts = api.swapOptions();
        if (opts.length) {
            const sel = h('select', { id: 'swapFor', title: 'Put another design in its place; its links stay' },
                h('option', { value: '' }, 'Swap for…'), ...opts.map((o) => h('option', { value: o.id }, o.name)));
            sel.addEventListener('change', () => { if (sel.value) api.swap(sel.value); });
            actions.append(sel);
        }
    }
    // Many inputs of one kind (a slewing ring's pinions): a drive on every free one, in one go.
    const F = api.fillOptions();
    if (F && F.options.length) {
        const sel = h('select', { id: 'fillWith', title: `Add one on each of ${F.ports.map((p) => p.label).join(', ')}, each wired in, each with its own power line` },
            h('option', { value: '' }, `Drive all ${F.ports.length} free inputs with…`), ...F.options.map((o) => h('option', { value: o.value }, o.label)));
        sel.addEventListener('change', () => { if (sel.value) api.fill(sel.value); });
        actions.append(sel);
    }
    const r = h('button', { class: 'small danger', id: 'removeChild' }, 'Remove'); r.addEventListener('click', api.remove); actions.append(r);
    el.append(actions);
}
