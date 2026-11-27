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
function jointLoad(J, kg, tipS) { return J.cont > 0 ? (J.hold + kg * G * (tipS - J.s)) / J.cont : Infinity; }

export function fmtKg(v) { return !isFinite(v) ? '∞' : v >= 1000 ? `${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)} t` : `${v.toFixed(v >= 10 ? 0 : 1)} kg`; }
export function fmtM(v) { return v >= 10 ? `${v.toFixed(0)} m` : v >= 1 ? `${v.toFixed(2)} m` : `${(v * 100).toFixed(0)} cm`; }
export function paintCss(p) { return p ? `rgb(${p.map((v) => Math.round(v * 255)).join(',')})` : '#777'; }

export function statusOf(c) {
    if (!c.ok) return 'err';
    if (!c.goal) return 'pass';
    return c.goal.pass ? 'pass' : 'fail';
}

// --- library -----------------------------------------------------------------

export function renderLibrary(el, lib, cache, currentId, onOpen, onUse) {
    clear(el);
    const byLevel = new Map();
    for (const d of Object.values(lib)) (byLevel.get(d.level) || byLevel.set(d.level, []).get(d.level)).push(d);
    for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
        el.append(h('div', { class: 'f-lvl' }, `Level ${lvl}`));
        for (const d of byLevel.get(lvl)) {
            const c = cache.get(d.id);
            const row = h('div', { class: 'f-design' + (d.id === currentId ? ' cur' : ''), 'data-id': d.id },
                h('span', { class: 'f-swatch', style: `background:${paintCss(d.paint)}` }),
                h('span', { class: 'name' }, d.name),
                d.id !== currentId ? h('button', { class: 'use small', title: `Add ${d.name} to the open design` }, 'use') : null,
                h('span', { class: 'f-dot ' + (c ? statusOf(c) : 'err') }),
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

export function renderTitle(el, c) {
    clear(el);
    el.append(
        h('div', { class: 'lvl' }, `Level ${c.level} · ${c.partCount} parts`),
        h('div', { class: 'nm' }, c.name),
        h('div', { class: 'note' }, c.note),
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
        for (const J of lc.joints) {
            el.append(arrow());
            const weak = lc.mount.weakest === J.label;
            const load = Math.min(1, jointLoad(J, opEffort || 0, lc.tipS));
            el.append(h('div', { class: 'f-stage-chip' + (weak ? ' weak' : ''), title: `${J.label}: ${J.limit} ${J.mode} past ${fmtEffort('rot', J.cont)}` },
                h('div', { class: 't' }, shortLabel(J.label)),
                h('div', { class: 's' }, `holds ${fmtEffort('rot', J.cont)} · carries ${fmtEffort('rot', J.hold)} · ${fmtM(lc.tipS - J.s)} out`),
                h('div', { class: 'bar' }, h('i', { style: `width:${(load * 100).toFixed(1)}%` })),
            ));
        }
        el.append(arrow(), h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, out.label), h('div', { class: 's' }, `lifts ${fmtKg(lc.mount.payloadKg)} at ${fmtM(lc.mount.reach)}`)));
        return;
    }
    const src = c.sources.find((s) => s.port === outId);
    const path = c.paths.find((p) => p.to === outId);
    const chain = src || path;
    if (!chain) return;
    const dom = out.domain;
    const tr = c.traces[outId];
    if (src) {
        const root = c.children.find((ch) => ch.id === tr.root.child);
        const rl = root.el.kind === 'contract' ? root.el.name : root.el.label;
        const rp = root.el.ports.find((p) => p.id === tr.root.src.port);
        const rd = rp ? rp.domain : dom;
        el.append(h('div', { class: 'f-stage-chip src' },
            h('div', { class: 't' }, rl),
            h('div', { class: 's' }, root.el.summary || `${fmtEffort(rd, tr.root.src.cont)} cont · ${fmtFlow(rd, tr.root.src.noLoad)}`),
        ));
    } else {
        const inp = c.ports.find((p) => p.id === path.from);
        el.append(h('div', { class: 'f-stage-chip io' }, h('div', { class: 't' }, inp ? inp.label : path.from), h('div', { class: 's' }, 'input')));
    }
    for (const s of chain.stages) {
        el.append(arrow());
        const weak = chain.weakest && s.label === chain.weakest.label;
        const guard = chain.guarded && s.label === chain.guarded.label;
        const load = opEffort > 0 && isFinite(s.peak) ? Math.min(1, opEffort / s.peak) : 0;
        const ratio = s.k !== 1 ? `×${s.k >= 10 ? s.k.toFixed(0) : s.k.toFixed(2)}` : '';
        el.append(h('div', { class: 'f-stage-chip' + (weak ? ' weak' : '') + (guard ? ' guard' : ''), title: `${s.label}: ${s.mode} at ${fmtEffort(dom, s.peak)} at the output` },
            h('div', { class: 't' }, shortLabel(s.label)),
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

export function renderGoal(el, c, pill) {
    clear(el);
    const g = c.goal;
    pill.className = 'f-pill ' + statusOf(c);
    pill.textContent = !c.ok ? 'Does not build' : !g ? 'No goal' : g.pass ? 'Goal met' : 'Goal not met';
    if (!g) { el.append(h('div', { class: 'f-empty' }, 'This design has no goal.')); return; }
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
    for (const p of c.ports) {
        let spec = '';
        const src = c.sources.find((s) => s.port === p.id);
        const path = c.paths.find((x) => x.to === p.id);
        const sup = c.supplies.find((s) => s.port === p.id);
        if (src) spec = `${fmtEffort(p.domain, src.cont)} cont · ${fmtFlow(p.domain, src.noLoad)}`;
        else if (path) spec = `×${path.k >= 10 ? path.k.toFixed(0) : path.k.toFixed(2)} · holds ${fmtEffort(p.domain, path.cont)}`;
        else if (sup) spec = `${si(sup.power, 'W')} · ${sup.energyWh} Wh`;
        else if (p.domain === 'mnt') {
            const m = (c.mounts || []).find((x) => x.port === p.id);
            spec = m ? `lifts ${fmtKg(m.payloadKg)} at ${fmtM(m.reach)}` : 'mount';
        }
        else if (p.dir === 'in') {
            const user = c.sources.find((s) => s.draw && s.draw.port === p.id);
            spec = user ? `draws ${si(user.power / user.draw.eff, 'W')}` : 'input';
        }
        ports.append(h('div', { class: 'f-port' },
            h('span', { class: 'd d-' + p.domain }), h('span', { class: 'dir' }, p.dir), h('span', {}, p.label), h('span', { class: 'spec' }, spec)));
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
    const L = 46, R = 10, T = 10, B = 22;
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
    const lift = (r) => Math.min(...lc.joints.map((J) => Math.max(0, J.cont - J.hold) / (G * Math.max(1e-6, r - J.s))));
    const want = c.goal && c.goal.lift;
    const maxKg = Math.max(lift(lc.tipS) * 2.2, want ? want.payloadKg * 1.3 : 0) || 1;
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
    if (want) { ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = 1.5; ctx.strokeRect(X(want.reachM) - 4, Y(want.payloadKg) - 4, 8, 8); }
    if (op && op.payloadKg != null) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(lc.tipS), Y(op.payloadKg), 4.5, 0, Math.PI * 2); ctx.fill(); }
}

// --- problems ---------------------------------------------------------------------

export function renderProblems(el, c) {
    clear(el);
    if (!c.errors.length && !c.warnings.length) { el.append(h('div', { class: 'f-prob none' }, 'None.')); return; }
    for (const e of c.errors) el.append(h('div', { class: 'f-prob err' }, e));
    for (const w of c.warnings) el.append(h('div', { class: 'f-prob warn' }, w));
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
    if (!isPart) { const o = h('button', { class: 'small primary', id: 'openChild' }, `Open ${ch.el.name}`); o.addEventListener('click', api.open); actions.append(o); }
    const r = h('button', { class: 'small danger', id: 'removeChild' }, 'Remove'); r.addEventListener('click', api.remove); actions.append(r);
    el.append(actions);
}
